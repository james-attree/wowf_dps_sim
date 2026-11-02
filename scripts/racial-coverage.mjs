import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import { raceCatalogue, racialStatus } from "../js/racials.js";

// Racial coverage check (roadmap D12a, issue #277, P5-02), the racial twin of
// npm run talents:coverage (scripts/talent-coverage.mjs). Racial effects are
// hand-authored (data/racial-effects.js), so after a snapshot refresh (npm
// run data:refresh) a racial can have no entry, or the text an entry was
// written from can have changed. This reads the race catalogue
// (js/racials.js) and the effects map and reports both.
//
//   npm run racials:coverage
//
// Every racial of every rogue race must be covered, so all three are
// FAILURES (exit 1):
//
//   uncovered   a racial with no entry. An entry always has modifiers, a
//               noDpsEffect or a notSimulated reason (js/racials.js
//               checkRacialEffects refuses any other at load).
//   changed     an entry whose stored `textHash` is not the SHA-256 of the
//               racial's text any more: its numbers were read from the old
//               text. test/racials.test.js fails on the same condition; this
//               names the racial and prints the new text.
//   orphan      an entry for a racial id the catalogue no longer has.
//
// It also counts the racials by status (simulated, inert against the default
// target, notSimulated, noDpsEffect), so the run log shows the split.
// Exit status: 0 with no failure, 1 with one, 2 for a bad argument. Under
// GitHub Actions each failure is also a workflow annotation.

const HASH_ALGORITHM = "sha256";
const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const SHORT_HASH = 12;
const STATUSES = ["simulated", "inert", "notSimulated", "noDpsEffect"];

// SHA-256 in hex of a racial's text: the textHash of its entry.
export function racialTextHash(text) {
  return createHash(HASH_ALGORITHM).update(text).digest("hex");
}

// The coverage of `effects` over `catalogue`. Returns
//   {
//     total, covered,
//     statuses:  { simulated, inert, notSimulated, noDpsEffect } counts
//     uncovered: [{ id }]
//     changed:   [{ id, storedHash, currentHash, text }]
//     orphans:   [{ id }]
//     failures, ok
//   }
// in catalogue order (orphans in the order of the effects map).
export function checkCoverage(
  effects = RACIAL_EFFECTS,
  catalogue = raceCatalogue,
) {
  const uncovered = [];
  const changed = [];
  const statuses = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const racial of catalogue.racials) {
    const status = racialStatus(racial.id, effects);
    if (status === "unmapped") {
      uncovered.push({ id: racial.id });
      continue;
    }
    statuses[status] += 1;
    const currentHash = racialTextHash(racial.text);
    if (effects[racial.id].textHash !== currentHash) {
      changed.push({
        id: racial.id,
        storedHash: effects[racial.id].textHash,
        currentHash,
        text: racial.text,
      });
    }
  }
  const orphans = Object.keys(effects)
    .filter((id) => catalogue.racial(id) === undefined)
    .map((id) => ({ id }));
  const failures = uncovered.length + changed.length + orphans.length;
  return {
    total: catalogue.racials.length,
    covered: catalogue.racials.length - uncovered.length,
    statuses,
    uncovered,
    changed,
    orphans,
    failures,
    ok: failures === 0,
  };
}

function short(hash) {
  return typeof hash === "string" ? hash.slice(0, SHORT_HASH) : String(hash);
}

// The report as lines of plain text.
export function formatReport(report) {
  const { statuses } = report;
  const lines = [
    `Racial coverage: ${report.covered} of ${report.total} racials have an effect or a reason.`,
    `  ${statuses.simulated} simulated, ${statuses.inert} for other target types, ${statuses.notSimulated} not simulated yet, ${statuses.noDpsEffect} with no DPS effect.`,
  ];
  for (const item of report.uncovered) {
    lines.push(
      `FAIL ${item.id}: no entry in data/racial-effects.js (an effect, noDpsEffect or notSimulated)`,
    );
  }
  for (const item of report.changed) {
    lines.push(
      `FAIL ${item.id}: text changed since the entry was written (stored hash ${item.storedHash}, current hash ${item.currentHash}); re-read the entry against the text and set textHash`,
      `  text: ${item.text}`,
    );
  }
  for (const item of report.orphans) {
    lines.push(`FAIL ${item.id}: an entry for a racial the catalogue lacks`);
  }
  lines.push(`${report.failures} failure${report.failures === 1 ? "" : "s"}.`);
  return lines.join("\n");
}

function escapeData(text) {
  return text
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

// GitHub workflow commands, one error per failure.
export function annotations(report) {
  const error = (text) => `::error title=Racial coverage::${escapeData(text)}`;
  return [
    ...report.uncovered.map((item) => error(`${item.id}: no entry`)),
    ...report.changed.map((item) =>
      error(
        `${item.id}: text changed (stored hash ${short(item.storedHash)}, current hash ${short(item.currentHash)})`,
      ),
    ),
    ...report.orphans.map((item) =>
      error(`${item.id}: an entry for a racial the catalogue lacks`),
    ),
  ];
}

const HELP_TEXT = `Usage: npm run racials:coverage

Lists the racials with no entry in data/racial-effects.js, the entries whose
stored text hash no longer matches the snapshot, and entries for racials that
are gone. Every racial of every rogue race must be covered (failures, exit 1).`;

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
    effects = RACIAL_EFFECTS,
    catalogue = raceCatalogue,
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
