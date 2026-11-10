// TR-11 / #341: the 70755 sweep. Coverage has no pending talent left, and
// the era-0 goldens (Cutthroat, Venom as an ability, the old presets) stay
// retired. Assassination daggers is live again (#340), so its seed-142 golden
// is not on this list. A later preset golden is appended in scripts/golden-update.mjs;
// this file does not list the fixture names it would have to rewrite.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { talentCatalogue } from "../js/talents.js";
import {
  GOLDEN_CASES,
  GOLDEN_DIR,
  IGNORED_FILES,
} from "../scripts/golden-update.mjs";
import { checkCoverage } from "../scripts/talent-coverage.mjs";

const RETIRED = [
  "cutthroat",
  "venom-expose-armor",
  "combat-swords-preset",
  "subtlety-daggers-preset",
];

describe("TR-11 coverage (#341)", () => {
  it("has zero pending talents and no coverage failure", () => {
    const pending = Object.entries(TALENT_EFFECTS)
      .filter(([, effect]) => typeof effect?.pending === "string")
      .map(([id]) => id);
    assert.deepEqual(pending, []);
    const report = checkCoverage();
    assert.equal(report.ok, true);
    assert.equal(report.failures, 0);
    assert.equal(report.warnings, 0);
    assert.equal(report.uncovered.length, 0);
    assert.equal(report.covered, talentCatalogue.talents.length);
  });

  it("accounts for every catalogue talent as simulated or no DPS", () => {
    const rows = talentCatalogue.talents.map((talent) => {
      const effect = TALENT_EFFECTS[talent.id];
      const kind =
        typeof effect?.noDpsEffect === "string" ? "noDps" : "simulated";
      return `${talent.id} ${kind}`;
    });
    assert.equal(rows.length, Object.keys(TALENT_EFFECTS).length);
    assert.ok(rows.some((row) => row.endsWith(" noDps")));
    assert.ok(rows.some((row) => row.endsWith(" simulated")));
    assert.ok(rows.includes("assassination.venom simulated"));
    assert.ok(rows.includes("combat.flash-of-steel simulated"));
    assert.ok(rows.includes("subtlety.boot-knife simulated"));
    assert.ok(rows.includes("subtlety.death-mark simulated"));
    assert.ok(rows.includes("assassination.blood-splatter simulated"));
  });
});

describe("TR-11 retired goldens (#341)", () => {
  it("does not pin a removed-talent or era-0 preset fight", async () => {
    const names = GOLDEN_CASES.map((goldenCase) => goldenCase.name);
    const files = (await readdir(GOLDEN_DIR)).filter(
      (file) => !IGNORED_FILES.includes(file),
    );
    for (const gone of RETIRED) {
      assert.equal(
        names.some((name) => name.includes(gone)),
        false,
        gone,
      );
      assert.equal(
        files.some((file) => file.includes(gone)),
        false,
        gone,
      );
    }
  });
});
