import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLabel,
  LABEL_SEPARATOR,
  poisonName,
  talentLabel,
} from "../js/build-label.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { loadPreset } from "../js/rotation-presets.js";
import { referenceBuild } from "../data/reference-build.js";

// Issue #154: the build label of the batch results panel (Fran's spec,
// section 1a and the section 10 checks).

// The page defaults (#152) with the reference talents (18/33/0).
const reference = () => ({ ...pageDefaultConfig(), talents: referenceBuild() });

describe("buildLabel (#154)", () => {
  it("labels the reference build with the Combat swords preset", () => {
    const config = loadPreset("combat-swords", reference());
    assert.equal(
      buildLabel(config),
      "Combat 18/33/0 · 51/51 · Combat swords · Instant MH, Deadly OH",
    );
  });

  it("labels the reference build with the default rotation", () => {
    assert.equal(
      buildLabel(reference()),
      "Combat 18/33/0 · 51/51 · Default (Combat) · Instant MH, Deadly OH",
    );
  });

  it("says so when there are no talents, no rotation name and no poisons", () => {
    assert.equal(
      buildLabel({ talents: {}, rotation: {}, poisons: {} }),
      "No talents · Default rotation · No poisons",
    );
    assert.equal(
      buildLabel(undefined),
      "No talents · Default rotation · No poisons",
    );
  });

  it("puts the tree with the most points first, the first one on a tie", () => {
    const trees = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
      { id: "c", name: "Gamma" },
    ];
    const talents = {
      trees,
      get: (id) =>
        ({ x: { tree: "a" }, y: { tree: "b" }, z: { tree: "c" } })[id],
    };
    const label = (ranks) =>
      talentLabel(ranks, 60, {
        catalogue: talents,
        effects: { x: {}, y: {}, z: {} },
      });
    // Every build carries its points out of the cap (#190, #204 D17).
    assert.equal(label({ x: 1, y: 3 }), "Beta 1/3/0 · 4/51");
    assert.equal(label({ x: 2, y: 2, z: 2 }), "Alpha 2/2/2 · 6/51");
    assert.equal(label({ z: 5, unknown: 9 }), "Gamma 0/0/5 · 5/51");
  });

  it("leaves out an empty hand and names a poison the catalogue lacks", () => {
    const label = (poisons) =>
      buildLabel({ poisons }).split(LABEL_SEPARATOR)[2];
    assert.equal(label({ mainHand: "instant" }), "Instant MH");
    assert.equal(label({ offHand: "deadly" }), "Deadly OH");
    assert.equal(poisonName("instant"), "Instant Poison");
    assert.equal(poisonName("mystery"), "Mystery");
  });
});

describe("the talents part of the label (#204, Fran's U6 spec D17 and section 6)", () => {
  const combat = {
    "combat.improved-sinister-strike": 2,
    "combat.lightning-reflexes": 5,
  };
  it("shows the level only below 60, before the points", () => {
    assert.equal(talentLabel(combat, 60), "Combat 0/7/0 · 7/51");
    assert.equal(talentLabel(combat, 40), "Combat 0/7/0 · level 40 · 7/31");
    assert.equal(talentLabel({}, 60), "No talents");
    assert.equal(talentLabel({}, 40), "No talents · level 40");
    assert.equal(talentLabel(combat, undefined), "Combat 0/7/0 · 7/51");
  });

  it("counts the picked talents the sim does not model yet", () => {
    const ranks = { ...combat, "subtlety.opportunity": 2 };
    assert.equal(
      talentLabel(ranks, 60),
      "Combat 0/7/2 · 9/51 · 1 not simulated yet",
    );
    assert.equal(
      buildLabel({ talents: ranks, talentLevel: 30 }),
      "Combat 0/7/2 · level 30 · 9/21 · 1 not simulated yet · Default rotation · No poisons",
    );
  });

  it("never throws on a level outside 10 to 60", () => {
    assert.equal(talentLabel(combat, 999), "Combat 0/7/0 · 7/51");
  });
});
