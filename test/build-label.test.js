import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLabel, LABEL_SEPARATOR, poisonName } from "../js/build-label.js";
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
      "Combat 18/33/0 · Combat swords · Instant MH, Deadly OH",
    );
  });

  it("labels the reference build with the default rotation", () => {
    assert.equal(
      buildLabel(reference()),
      "Combat 18/33/0 · Default (Combat) · Instant MH, Deadly OH",
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
    const poisons = { byKey: () => undefined };
    const label = (ranks) =>
      buildLabel({ talents: ranks }, { talents, poisons }).split(
        LABEL_SEPARATOR,
      )[0];
    assert.equal(label({ x: 1, y: 3 }), "Beta 1/3/0");
    assert.equal(label({ x: 2, y: 2, z: 2 }), "Alpha 2/2/2");
    assert.equal(label({ z: 5, unknown: 9 }), "Gamma 0/0/5");
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
