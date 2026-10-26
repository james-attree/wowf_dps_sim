import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { talentCatalogue } from "../js/talents.js";

// Talent coverage check (roadmap D6, issue #103). Talent effects are
// hand-authored (data/talent-effects.js), so two things can go wrong after a
// snapshot refresh (npm run data:refresh): a talent has no effect and is not
// marked as a deliberate no-op, or the rank text an effect was written from
// has changed, so the encoded numbers may be stale. This reads the catalogue
// (js/talents.js) and the effects map and reports both.
//
//   npm run talents:coverage
//
// What it reports, and what each does to the exit status:
//
//   uncovered   A talent with no entry, or an entry with no effect and no
//               `noDpsEffect`. In a tree of FULL_COVERAGE_TREES (Combat) it
//               is a FAILURE. In any other tree (Assassination, Subtlety) it
//               is a WARNING that does not fail: those talents are expected
//               to be uncovered until Phase 4 (D8).
//   changed     An entry whose stored `textHash` is not the hash of the
//               catalogue's rank texts any more. It is a FAILURE in every
//               tree, because the entry exists and its numbers were read from
//               the old text. The unit test in test/talent-effects.test.js
//               fails on the same condition, so CI is red either way; this
//               names the talent with the old and new hash and the new rank
//               texts, so the fix is to re-read them and set the new hash.
//   orphan      An entry for a talent id the catalogue no longer has. FAILURE.
//
// Exit status: 0 when there are no failures (warnings are listed), 1 when
// there is one, 2 for a bad argument. Under GitHub Actions the warnings and
// failures are also written as workflow annotations, so they show on the run.
//
// The stored hash is of all of a talent's rank texts together, so the check
// cannot say which rank changed, only that one did. It prints every current
// rank text next to the hashes for that reason.

// The trees whose talents must all be covered (Phase 2: Combat). Every other
// tree is a warning only, until D8 covers it.
export const FULL_COVERAGE_TREES = Object.freeze(["combat"]);

const HASH_ALGORITHM = "sha256";
const RANK_JOINER = "\n";
const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const SHORT_HASH = 12;

// SHA-256 in hex of the rank texts joined with "\n": the textHash of an entry.
export function rankTextHash(ranks) {
  return createHash(HASH_ALGORITHM)
    .update(ranks.join(RANK_JOINER))
    .digest("hex");
}

// An entry covers a talent when it does something or says why it does not.
function hasEffect(entry) {
  const { modifiers, procs, ability, noDpsEffect } = entry;
  return (
    (Array.isArray(modifiers) && modifiers.length > 0) ||
    (Array.isArray(procs) && procs.length > 0) ||
    (typeof ability === "string" && ability !== "") ||
    (typeof noDpsEffect === "string" && noDpsEffect !== "")
  );
}

// The coverage of `effects` over `catalogue`. Both default to the real ones;
// tests pass broken copies. Returns
//   {
//     total, covered,
//     uncovered: [{ id, tree, severity }]   severity "failure" | "warning"
//     changed:   [{ id, tree, storedHash, currentHash, ranks: [text...] }]
//     orphans:   [{ id }]
//     failures, warnings                    counts
//     ok                                    no failures
//   }
// in catalogue order (orphans in the order of the effects map).
export function checkCoverage(
  effects = TALENT_EFFECTS,
  catalogue = talentCatalogue,
) {
  const uncovered = [];
  const changed = [];
  let covered = 0;
  for (const talent of catalogue.talents) {
    const entry = effects[talent.id];
    if (entry === undefined || entry === null || !hasEffect(entry)) {
      uncovered.push({
        id: talent.id,
        tree: talent.tree,
        severity: FULL_COVERAGE_TREES.includes(talent.tree)
          ? "failure"
          : "warning",
      });
    } else {
      covered += 1;
    }
    if (entry !== undefined && entry !== null) {
      const currentHash = rankTextHash(talent.ranks);
      if (entry.textHash !== currentHash) {
        changed.push({
          id: talent.id,
          tree: talent.tree,
          storedHash: entry.textHash,
          currentHash,
          ranks: [...talent.ranks],
        });
      }
    }
  }
  const orphans = Object.keys(effects)
    .filter((id) => catalogue.get(id) === undefined)
    .map((id) => ({ id }));
  const uncoveredFailures = uncovered.filter(
    (item) => item.severity === "failure",
  ).length;
  const failures = uncoveredFailures + changed.length + orphans.length;
  const warnings = uncovered.length - uncoveredFailures;
  return {
    total: catalogue.talents.length,
    covered,
    uncovered,
    changed,
    orphans,
    failures,
    warnings,
    ok: failures === 0,
  };
}

function short(hash) {
  return typeof hash === "string" ? hash.slice(0, SHORT_HASH) : String(hash);
}

// The report as lines of plain text.
export function formatReport(report) {
  const lines = [
    `Talent coverage: ${report.covered} of ${report.total} talents have an effect or a noDpsEffect.`,
  ];
  for (const item of report.uncovered) {
    lines.push(
      item.severity === "failure"
        ? `FAIL ${item.id}: no effect and no noDpsEffect (${item.tree} talents must be covered)`
        : `WARN ${item.id}: no effect yet (${item.tree}: expected until Phase 4, D8)`,
    );
  }
  for (const item of report.changed) {
    lines.push(
      `FAIL ${item.id}: rank text changed since the effect was written (stored hash ${item.storedHash}, current hash ${item.currentHash}); re-read the effect against the text and set textHash`,
    );
    item.ranks.forEach((text, index) => {
      lines.push(`  rank ${index + 1}: ${text}`);
    });
  }
  for (const item of report.orphans) {
    lines.push(`FAIL ${item.id}: an effect for a talent the catalogue lacks`);
  }
  lines.push(
    `${report.failures} failure${report.failures === 1 ? "" : "s"}, ${report.warnings} warning${report.warnings === 1 ? "" : "s"}.`,
  );
  return lines.join("\n");
}

// GitHub workflow commands. One warning lists every uncovered non-Combat
// talent, because Actions shows only a few annotations per step.
function escapeData(text) {
  return text
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

export function annotations(report) {
  const lines = [];
  const warned = report.uncovered
    .filter((item) => item.severity === "warning")
    .map((item) => item.id);
  if (warned.length > 0) {
    lines.push(
      `::warning title=Talent coverage::${escapeData(
        `${warned.length} talents have no effect yet (expected until Phase 4, D8): ${warned.join(", ")}`,
      )}`,
    );
  }
  for (const item of report.uncovered) {
    if (item.severity === "failure") {
      lines.push(
        `::error title=Talent coverage::${escapeData(`${item.id}: no effect and no noDpsEffect`)}`,
      );
    }
  }
  for (const item of report.changed) {
    lines.push(
      `::error title=Talent coverage::${escapeData(
        `${item.id}: rank text changed (stored hash ${short(item.storedHash)}, current hash ${short(item.currentHash)}, ${item.ranks.length} rank${item.ranks.length === 1 ? "" : "s"})`,
      )}`,
    );
  }
  for (const item of report.orphans) {
    lines.push(
      `::error title=Talent coverage::${escapeData(`${item.id}: an effect for a talent the catalogue lacks`)}`,
    );
  }
  return lines;
}

const HELP_TEXT = `Usage: npm run talents:coverage

Lists the talents with no effect and no noDpsEffect, the effects whose stored
rank-text hash no longer matches the snapshot, and effects for talents that are
gone. Combat talents must be covered and an encoded effect must match its text
(failures, exit 1). Other trees are warnings until Phase 4 (exit 0).`;

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

// The whole command, with its input and output passed in so a test can check
// the status on broken data. Returns the exit status.
export function cli(
  argv,
  {
    effects = TALENT_EFFECTS,
    catalogue = talentCatalogue,
    env = process.env,
    log = (text) => console.log(text),
    logError = (text) => console.error(text),
  } = {},
) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    log(HELP_TEXT);
    return EXIT_OK;
  }
  if (argv.length > 0) {
    logError(`Unknown argument: ${argv[0]}\n\n${HELP_TEXT}`);
    return EXIT_USAGE;
  }
  const report = checkCoverage(effects, catalogue);
  log(formatReport(report));
  if (env.GITHUB_ACTIONS === "true") {
    for (const line of annotations(report)) {
      log(line);
    }
  }
  return report.ok ? EXIT_OK : EXIT_FAIL;
}

if (isDirectRun()) {
  process.exitCode = cli(process.argv.slice(2));
}
