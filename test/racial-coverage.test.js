import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import { snapshot } from "../js/snapshot.js";
import { buildRaceCatalogue, raceCatalogue } from "../js/racials.js";
import {
  annotations,
  checkCoverage,
  cli,
  formatReport,
  racialTextHash,
} from "../scripts/racial-coverage.mjs";

// D12a (#277): the racial coverage check. The real data passes, and broken
// copies of the effects map and of the snapshot prove that a missing entry, a
// changed text and an orphan entry each fail.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUTHLESS = "human.ruthless";

function effectsCopy() {
  return structuredClone(RACIAL_EFFECTS);
}

function quiet(argv, options) {
  const out = [];
  const err = [];
  const status = cli(argv, {
    env: {},
    log: (text) => out.push(text),
    logError: (text) => err.push(text),
    ...options,
  });
  return { status, out: out.join("\n"), err: err.join("\n") };
}

describe("racials:coverage (#277)", () => {
  it("passes on the real data: every racial covered, none changed", () => {
    const report = checkCoverage();
    assert.equal(report.ok, true);
    assert.equal(report.total, 36);
    assert.equal(report.covered, 36);
    assert.deepEqual(report.statuses, {
      // Blood Fury and Elune's Light are simulated since #278.
      simulated: 7,
      inert: 4,
      notSimulated: 3,
      noDpsEffect: 22,
    });
    assert.equal(quiet([]).status, 0);
  });

  it("hashes the text the way the entries were written", () => {
    assert.equal(
      racialTextHash(raceCatalogue.racial(RUTHLESS).text),
      RACIAL_EFFECTS[RUTHLESS].textHash,
    );
  });

  it("fails on a racial with no entry", () => {
    const effects = effectsCopy();
    delete effects[RUTHLESS];
    const report = checkCoverage(effects);
    assert.deepEqual(report.uncovered, [{ id: RUTHLESS }]);
    assert.equal(report.ok, false);
    const run = quiet([], { effects });
    assert.equal(run.status, 1);
    assert.match(run.out, /FAIL human\.ruthless: no entry/);
  });

  it("fails on a changed text, and prints the new one", () => {
    const changed = structuredClone(snapshot);
    const human = changed.racials.Alliance.find(
      (entry) => entry.race === "Human",
    );
    human.abilities[0][1] = "Increases critical strike chance by 2%.";
    const catalogue = buildRaceCatalogue(changed);
    const report = checkCoverage(RACIAL_EFFECTS, catalogue);
    assert.deepEqual(
      report.changed.map((item) => item.id),
      [RUTHLESS],
    );
    const text = formatReport(report);
    assert.match(text, /text changed/);
    assert.match(text, /by 2%/);
    assert.equal(quiet([], { catalogue }).status, 1);
  });

  it("fails on an entry for a racial that is gone", () => {
    const effects = { ...effectsCopy(), "human.savage": { textHash: "0" } };
    const report = checkCoverage(effects);
    assert.deepEqual(report.orphans, [{ id: "human.savage" }]);
    assert.equal(report.ok, false);
  });

  it("annotates failures under GitHub Actions, and refuses an argument", () => {
    const effects = effectsCopy();
    delete effects[RUTHLESS];
    assert.deepEqual(annotations(checkCoverage(effects)), [
      "::error title=Racial coverage::human.ruthless: no entry",
    ]);
    const run = quiet([], { effects, env: { GITHUB_ACTIONS: "true" } });
    assert.match(run.out, /::error title=Racial coverage::/);
    assert.equal(quiet(["--nope"]).status, 2);
    assert.equal(quiet(["--help"]).status, 0);
  });

  it("runs as npm run racials:coverage", () => {
    const run = spawnSync(process.execPath, ["scripts/racial-coverage.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /36 of 36 racials/);
  });
});
