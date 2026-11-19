// Refusal times round up to the next tenth (#287 PR4). The run clock still floors.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legacyPresetGear } from "../data/legacy-sheets.js";
import { createManualFight } from "../js/manual-fight.js";
import { refusalTime } from "../js/views/run-model.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";

describe("refusal time (#287)", () => {
  it("rounds remaining time up to the next tenth and keeps an exact tenth", () => {
    assert.equal(refusalTime(0.01), "0.1 s");
    assert.equal(refusalTime(0.1), "0.1 s");
    assert.equal(refusalTime(0.15), "0.2 s");
    assert.equal(refusalTime(1), "1.0 s");
    assert.equal(refusalTime(0.30000000000000004), "0.3 s");
  });

  it("reads a GCD under a tenth as 0.1 s left", () => {
    const build = referenceBuild("assassination-daggers");
    const manual = createManualFight({
      seed: 1,
      duration: 30,
      config: loadPreset("assassination-daggers", {
        talents: build.talents,
        talentLevel: build.talentLevel,
        weapons: legacyPresetGear("assassination-daggers").weapons,
        poisons: build.poisons,
        character: build.character,
      }),
    });
    assert.equal(manual.cast("mutilate").ok, true);
    manual.advanceTo(0.95);
    const later = manual.peekState();
    const cold = later.slots.find((slot) => slot.abilityId === "cold-blood");
    assert.equal(cold.castable, false);
    assert.equal(cold.reason.code, "gcd");
    assert.ok(cold.reason.seconds > 0);
    assert.ok(cold.reason.seconds < 0.1);
    assert.equal(cold.reason.text, "GCD, 0.1 s left");
    manual.dispose();
  });
});
