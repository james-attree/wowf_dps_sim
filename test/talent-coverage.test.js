import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { snapshot } from "../js/snapshot.js";
import { buildTalentCatalogue, talentCatalogue } from "../js/talents.js";
import {
  FULL_COVERAGE_TREES,
  annotations,
  checkCoverage,
  cli,
  formatReport,
  rankTextHash,
} from "../scripts/talent-coverage.mjs";

// D6 (#103): the coverage check. The real data passes with warnings, and
// deliberately broken copies of the effects map and of the snapshot prove that
// a missing effect and a changed text are both found.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMBAT_TALENT = "combat.precision";
const ASSASSINATION_MAPPED = "assassination.malice";
const ASSASSINATION_UNMAPPED = "assassination.murder";
const SUBTLETY_UNMAPPED = "subtlety.opportunity";

// A copy of the effects map that a test may change.
function effectsCopy() {
  return structuredClone(TALENT_EFFECTS);
}

// A catalogue built from the snapshot with one rank text of one talent changed.
function catalogueWithEditedText(id, rank, text) {
  const source = structuredClone(snapshot);
  const talent = talentCatalogue.get(id);
  const tree = source.talents.trees.find(
    (item) => item.name.toLowerCase() === talent.tree,
  );
  const entry = tree.talents.find((item) => item.name === talent.name);
  entry.desc[rank - 1] = text;
  return buildTalentCatalogue(source);
}

function run(argv, options) {
  const out = [];
  const err = [];
  const status = cli(argv, {
    log: (text) => out.push(text),
    logError: (text) => err.push(text),
    env: {},
    ...options,
  });
  return { status, out: out.join("\n"), err: err.join("\n") };
}

describe("the coverage of the real data", () => {
  const report = checkCoverage();

  it("has no failure: every Combat talent is covered and every hash matches", () => {
    assert.deepEqual(FULL_COVERAGE_TREES, ["combat"]);
    assert.equal(report.ok, true);
    assert.equal(report.failures, 0);
    assert.deepEqual(report.changed, []);
    assert.deepEqual(report.orphans, []);
    assert.equal(
      report.uncovered.some((item) => item.tree === "combat"),
      false,
    );
  });

  it("warns for every Assassination and Subtlety talent without an effect, by id", () => {
    assert.equal(report.total, talentCatalogue.talents.length);
    assert.equal(report.covered, Object.keys(TALENT_EFFECTS).length);
    assert.equal(report.covered + report.uncovered.length, report.total);
    assert.equal(report.warnings, report.uncovered.length);
    assert.equal(
      report.uncovered.every((item) => item.severity === "warning"),
      true,
    );
    const ids = report.uncovered.map((item) => item.id);
    assert.ok(ids.includes(ASSASSINATION_UNMAPPED));
    assert.ok(ids.includes(SUBTLETY_UNMAPPED));
    assert.equal(
      ids.includes(ASSASSINATION_MAPPED),
      false,
      "Malice is covered",
    );
    for (const item of report.uncovered) {
      assert.ok(["assassination", "subtlety"].includes(item.tree), item.id);
      assert.ok(item.id.startsWith(`${item.tree}.`), item.id);
    }
  });
});

describe("a Combat talent with no effect fails", () => {
  it("fails when the entry is missing, naming the talent", () => {
    const effects = effectsCopy();
    delete effects[COMBAT_TALENT];
    const report = checkCoverage(effects);
    assert.equal(report.ok, false);
    assert.deepEqual(
      report.uncovered.filter((item) => item.severity === "failure"),
      [{ id: COMBAT_TALENT, tree: "combat", severity: "failure" }],
    );
    assert.equal(report.failures, 1);
    const result = run([], { effects });
    assert.equal(result.status, 1);
    assert.match(
      result.out,
      /FAIL combat\.precision: no effect and no noDpsEffect/,
    );
  });

  it("fails when the entry has a hash and nothing else", () => {
    const effects = effectsCopy();
    effects[COMBAT_TALENT] = { textHash: effects[COMBAT_TALENT].textHash };
    assert.equal(checkCoverage(effects).failures, 1);
    effects[COMBAT_TALENT] = {
      textHash: effects[COMBAT_TALENT].textHash,
      modifiers: [],
      procs: [],
      noDpsEffect: "",
    };
    assert.equal(checkCoverage(effects).failures, 1);
  });

  it("is covered by any one of modifiers, procs, ability or a noDpsEffect reason", () => {
    const { textHash } = TALENT_EFFECTS[COMBAT_TALENT];
    for (const effect of [
      { modifiers: [{}] },
      { procs: [{}] },
      { ability: "blade-flurry" },
      { noDpsEffect: "no damage" },
    ]) {
      const effects = effectsCopy();
      effects[COMBAT_TALENT] = { textHash, ...effect };
      assert.equal(checkCoverage(effects).ok, true, JSON.stringify(effect));
    }
  });
});

describe("an entry that does nothing", () => {
  it("counts a null entry, and an empty ability name, as uncovered", () => {
    const effects = effectsCopy();
    effects[ASSASSINATION_MAPPED] = null;
    const report = checkCoverage(effects);
    assert.ok(
      report.uncovered.some((item) => item.id === ASSASSINATION_MAPPED),
    );
    assert.deepEqual(report.changed, []);
    effects[ASSASSINATION_MAPPED] = {
      textHash: TALENT_EFFECTS[ASSASSINATION_MAPPED].textHash,
      ability: "",
    };
    assert.ok(
      checkCoverage(effects).uncovered.some(
        (item) => item.id === ASSASSINATION_MAPPED,
      ),
    );
  });

  it("keeps the warning count apart from the failure count", () => {
    const effects = effectsCopy();
    delete effects[COMBAT_TALENT];
    const report = checkCoverage(effects);
    assert.equal(report.warnings, checkCoverage().warnings);
    assert.equal(report.failures, 1);
    assert.equal(report.uncovered.length, report.warnings + 1);
  });
});

describe("an uncovered Assassination or Subtlety talent only warns", () => {
  it("does not fail when a mapped Assassination talent loses its entry", () => {
    const effects = effectsCopy();
    delete effects[ASSASSINATION_MAPPED];
    const report = checkCoverage(effects);
    assert.equal(report.ok, true);
    assert.equal(report.failures, 0);
    assert.ok(
      report.uncovered.some(
        (item) =>
          item.id === ASSASSINATION_MAPPED && item.severity === "warning",
      ),
    );
    const result = run([], { effects });
    assert.equal(result.status, 0);
    assert.match(result.out, /WARN assassination\.malice: no effect yet/);
    assert.match(result.out, /WARN subtlety\.opportunity: no effect yet/);
  });
});

describe("a changed rank text is found", () => {
  it("names the talent with the stored and current hash and every rank text", () => {
    const text = "Increases your chance to hit with melee attacks by 9%.";
    const catalogue = catalogueWithEditedText(COMBAT_TALENT, 2, text);
    const report = checkCoverage(TALENT_EFFECTS, catalogue);
    assert.equal(report.ok, false);
    assert.equal(report.failures, 1);
    const [item, ...rest] = report.changed;
    assert.equal(rest.length, 0);
    assert.equal(item.id, COMBAT_TALENT);
    assert.equal(item.storedHash, TALENT_EFFECTS[COMBAT_TALENT].textHash);
    assert.equal(
      item.currentHash,
      rankTextHash(catalogue.get(COMBAT_TALENT).ranks),
    );
    assert.notEqual(item.currentHash, item.storedHash);
    assert.equal(item.ranks.length, 3);
    assert.equal(item.ranks[1], text);

    const result = run([], { catalogue });
    assert.equal(result.status, 1);
    assert.ok(result.out.includes(`FAIL ${COMBAT_TALENT}: rank text changed`));
    assert.ok(result.out.includes(`stored hash ${item.storedHash}`));
    assert.ok(result.out.includes(`current hash ${item.currentHash}`));
    assert.ok(result.out.includes(`  rank 2: ${text}`));
  });

  it("fails for an encoded Assassination talent too, but not for an uncovered one", () => {
    const changedMapped = catalogueWithEditedText(
      ASSASSINATION_MAPPED,
      1,
      "Changed.",
    );
    assert.equal(checkCoverage(TALENT_EFFECTS, changedMapped).failures, 1);
    const changedUnmapped = catalogueWithEditedText(
      ASSASSINATION_UNMAPPED,
      1,
      "Changed.",
    );
    const report = checkCoverage(TALENT_EFFECTS, changedUnmapped);
    assert.equal(report.ok, true);
    assert.deepEqual(report.changed, []);
  });

  it("hashes the rank texts joined with a newline, as the effects data does", () => {
    for (const talent of talentCatalogue.talents) {
      const entry = TALENT_EFFECTS[talent.id];
      if (entry !== undefined) {
        assert.equal(rankTextHash(talent.ranks), entry.textHash, talent.id);
      }
    }
  });
});

describe("an effect for a talent that is gone", () => {
  it("fails, naming the id", () => {
    const effects = effectsCopy();
    effects["combat.no-such-talent"] = { ...effects[COMBAT_TALENT] };
    const report = checkCoverage(effects);
    assert.deepEqual(report.orphans, [{ id: "combat.no-such-talent" }]);
    assert.equal(report.ok, false);
    assert.match(
      run([], { effects }).out,
      /FAIL combat\.no-such-talent: an effect for a talent the catalogue lacks/,
    );
  });
});

describe("the command", () => {
  const real = checkCoverage();

  it("prints a header, one line per warning and a summary, each on its own line", () => {
    const lines = run([]).out.split("\n");
    assert.equal(lines.length, real.warnings + 2);
    assert.equal(
      lines.filter((line) => line.startsWith("WARN ")).length,
      real.warnings,
    );
  });

  it("prints -h as help too", () => {
    assert.match(run(["-h"]).out, /Usage: npm run talents:coverage/);
  });

  it("lists the warnings and exits 0 on the real data", () => {
    const result = run([]);
    assert.equal(result.status, 0);
    assert.ok(
      result.out.startsWith(
        `Talent coverage: ${real.covered} of ${real.total} talents`,
      ),
    );
    assert.ok(result.out.endsWith(`0 failures, ${real.warnings} warnings.`));
    assert.equal(
      result.out.includes("::warning"),
      false,
      "no annotations off Actions",
    );
  });

  it("writes one warning annotation listing the ids under GitHub Actions", () => {
    const result = run([], { env: { GITHUB_ACTIONS: "true" } });
    const lines = result.out
      .split("\n")
      .filter((line) => line.startsWith("::"));
    assert.equal(lines.length, 1);
    assert.ok(
      lines[0].startsWith(
        `::warning title=Talent coverage::${real.warnings} talents have no effect yet`,
      ),
    );
    assert.ok(lines[0].includes(ASSASSINATION_UNMAPPED));
    assert.ok(lines[0].includes(SUBTLETY_UNMAPPED));
    assert.equal(lines[0].includes("\n"), false);
  });

  it("writes an error annotation for each failure under GitHub Actions", () => {
    const effects = effectsCopy();
    delete effects[COMBAT_TALENT];
    const catalogue = catalogueWithEditedText(
      ASSASSINATION_MAPPED,
      1,
      "Changed.",
    );
    const report = checkCoverage(effects, catalogue);
    const errors = annotations(report).filter((line) =>
      line.startsWith("::error"),
    );
    assert.equal(errors.length, 2);
    assert.ok(
      errors.some((line) => line.includes(`${COMBAT_TALENT}: no effect`)),
    );
    assert.ok(
      errors.some((line) =>
        line.includes(`${ASSASSINATION_MAPPED}: rank text changed`),
      ),
    );
  });

  it("refuses an argument and prints help on request", () => {
    const bad = run(["--nope"]);
    assert.equal(bad.status, 2);
    assert.match(bad.err, /Unknown argument: --nope/);
    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.out, /Usage: npm run talents:coverage/);
  });

  it("formats a report with no failures and no warnings", () => {
    const effects = effectsCopy();
    const report = checkCoverage(effects, buildTalentCatalogue(snapshot));
    assert.match(
      formatReport({ ...report, uncovered: [], warnings: 0 }),
      /0 failures, 0 warnings\.$/,
    );
  });

  it("runs as a process and exits 0 on the real data", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/talent-coverage.mjs"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`0 failures, ${real.warnings} warnings.`));
  });
});
