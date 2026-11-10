// James, 10 Nov 2026, #340: Subtlety daggers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { buildProblems } from "../js/talent-build.js";
import { pointsText } from "../js/preset-build.js";
import { referenceBuild } from "../js/rotation-presets.js";

const ID = "subtlety-daggers";

describe("Subtlety daggers (#340)", () => {
  it("is a live preset on the dagger sheet, with Instant and Deadly", () => {
    assert.ok(ROTATION_PRESETS.some((preset) => preset.id === ID));
    const build = referenceBuild(ID);
    assert.deepEqual(build.poisons, { mainHand: "instant", offHand: "deadly" });
    assert.deepEqual(build.character, {
      attackPower: k("character.dagger.attackPower"),
      critChance: k("character.dagger.critChance"),
    });
    assert.equal(build.weapons.mainHand.type, "dagger");
    assert.equal(build.weapons.offHand.min, 59);
    assert.equal(pointsText(build.talents), "12/8/31");
    assert.deepEqual(buildProblems(build.talents, { talentLevel: 60 }), []);
  });

  it("follows James's order, with the labelled dev choices", () => {
    const rules = ROTATION_PRESETS.find((preset) => preset.id === ID).rotation
      .rules;
    assert.deepEqual(
      rules.map((rule) => rule.action),
      [
        "blood-fury",
        "elunes-light",
        "berserking",
        "eureka",
        "premeditation",
        "preparation",
        "slice-and-dice",
        "rupture",
        "death-mark",
        "ghostly-strike",
        "garrote",
        "shank",
        "hemorrhage",
      ],
    );
    const numbers = k("presetRotation.subtletyDaggers");
    assert.equal(numbers.refreshSeconds, 2);
    assert.equal(numbers.deathMarkRemainingSeconds, 6);
    assert.equal(numbers.builderComboPointsBelow, 4);
    const snd = rules.find((rule) => rule.action === "slice-and-dice");
    const rupture = rules.find((rule) => rule.action === "rupture");
    const mark = rules.find((rule) => rule.action === "death-mark");
    assert.equal(
      snd.conditions.find((c) => c.type === "auraRemaining").value,
      2,
    );
    assert.equal(
      rupture.conditions.find((c) => c.type === "debuffRemaining").value,
      2,
    );
    assert.deepEqual(
      mark.conditions
        .filter((c) => c.type === "debuffRemaining")
        .map((c) => c.debuff),
      ["garrote", "rupture"],
    );
    assert.ok(
      mark.conditions
        .filter((c) => c.type === "debuffRemaining")
        .every((c) => c.op === ">" && c.value === 6),
    );
    assert.ok(
      mark.conditions.some(
        (c) => c.type === "cooldownReady" && c.ability === "death-mark",
      ),
    );
    const strike = rules.find((rule) => rule.action === "ghostly-strike");
    assert.deepEqual(
      strike.conditions.find((c) => c.type === "debuffActive"),
      { type: "debuffActive", debuff: "garrote", active: false },
    );
    const shank = rules.find((rule) => rule.action === "shank");
    assert.equal(shank.conditions.find((c) => c.type === "resource").value, 50);
    const hemo = rules.find((rule) => rule.action === "hemorrhage");
    assert.equal(
      hemo.conditions.find((c) => c.type === "comboPoints").value,
      4,
    );
  });
});
