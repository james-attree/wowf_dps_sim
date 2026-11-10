// James, 10 Nov 2026, #340: Assassination daggers. Finishers at 4+ CP
// (Slice and Dice, Rupture, Eviscerate). Refresh under 2s. Eviscerate only
// when both have more than 10s left. Cold Blood when ready, before Mutilate.
// Shank when energy < 50. The builder cap mirrors Combat swords.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { buildProblems } from "../js/talent-build.js";
import { pointsText } from "../js/preset-build.js";
import { referenceBuild } from "../js/rotation-presets.js";

const ID = "assassination-daggers";
const NUMBERS = k("presetRotation.assassinationDaggers");
const CP = {
  type: "comboPoints",
  op: ">=",
  value: NUMBERS.finisherComboPoints,
};

describe("Assassination daggers (#340)", () => {
  it("is the third live preset", () => {
    assert.deepEqual(
      ROTATION_PRESETS.map((preset) => preset.id),
      [
        "combat-swords-temp",
        "combat-daggers",
        "assassination-daggers",
        "subtlety-daggers",
      ],
    );
  });

  it("poisons are Instant on the main hand and Deadly on the off hand", () => {
    assert.deepEqual(referenceBuild(ID).poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
  });

  it("uses the dagger pair and the character.dagger sheet", () => {
    const build = referenceBuild(ID);
    assert.deepEqual(build.weapons, {
      mainHand: {
        min: k("weapon.dagger.mainHand").min,
        max: k("weapon.dagger.mainHand").max,
        speed: k("weapon.dagger.mainHand").speed,
        type: "dagger",
      },
      offHand: { ...k("presetReferenceBuild.daggerOffHand") },
    });
    assert.deepEqual(build.character, {
      attackPower: k("character.dagger.attackPower"),
      critChance: k("character.dagger.critChance"),
    });
    assert.equal(pointsText(build.talents), "37/11/3");
    assert.deepEqual(buildProblems(build.talents, { talentLevel: 60 }), []);
    assert.equal(build.talents["assassination.mutilate"], 1);
    assert.equal(build.talents["assassination.cold-blood"], 1);
  });

  it("locks the character.dagger sheet row as an assumption (Kira N2)", () => {
    const row = CONSTANTS["presetReferenceBuild.daggerCharacter"];
    assert.equal(row.source, "assumption");
    assert.equal(row.value, "character.dagger");
    assert.match(row.ref, /James, 10 Nov 2026, issue #340/);
    assert.match(row.ref, /Core Hound Tooth/);
    assert.match(row.ref, /59-111/);
  });

  it("casts James's rules, in order, with the mirrored builder cap", () => {
    const rules = ROTATION_PRESETS.find((preset) => preset.id === ID).rotation
      .rules;
    assert.deepEqual(
      rules.map((rule) => rule.action),
      [
        "blood-fury",
        "elunes-light",
        "berserking",
        "eureka",
        "slice-and-dice",
        "rupture",
        "eviscerate",
        "cold-blood",
        "mutilate",
        "shank",
      ],
    );
    assert.deepEqual(rules[4], {
      action: "slice-and-dice",
      conditions: [
        CP,
        {
          type: "auraRemaining",
          aura: "slice-and-dice",
          op: "<",
          value: NUMBERS.refreshSeconds,
        },
      ],
    });
    assert.deepEqual(rules[5], {
      action: "rupture",
      conditions: [
        CP,
        {
          type: "debuffRemaining",
          debuff: "rupture",
          op: "<",
          value: NUMBERS.refreshSeconds,
        },
      ],
    });
    assert.deepEqual(rules[6], {
      action: "eviscerate",
      conditions: [
        CP,
        {
          type: "auraRemaining",
          aura: "slice-and-dice",
          op: ">",
          value: NUMBERS.bothRemainingSeconds,
        },
        {
          type: "debuffRemaining",
          debuff: "rupture",
          op: ">",
          value: NUMBERS.bothRemainingSeconds,
        },
      ],
    });
    assert.deepEqual(rules[7], {
      action: "cold-blood",
      conditions: [
        { type: "abilityGranted", ability: "cold-blood" },
        { type: "cooldownReady", ability: "cold-blood" },
      ],
    });
    assert.deepEqual(rules[8], {
      action: "mutilate",
      conditions: [
        { type: "abilityUnlocked", ability: "mutilate" },
        {
          type: "comboPoints",
          op: "<",
          value: NUMBERS.finisherComboPoints,
        },
        {
          type: "resource",
          resource: "energy",
          op: ">=",
          value: NUMBERS.shankEnergyBelow,
        },
      ],
    });
    assert.deepEqual(rules[9], {
      action: "shank",
      conditions: [
        { type: "cooldownReady", ability: "shank" },
        {
          type: "resource",
          resource: "energy",
          op: "<",
          value: NUMBERS.shankEnergyBelow,
        },
      ],
    });
    assert.equal(
      rules.some((rule) => rule.action === "death-mark"),
      false,
    );
  });

  it("locks the 2s refreshes and the 10s Eviscerate gate", () => {
    const rules = ROTATION_PRESETS.find((preset) => preset.id === ID).rotation
      .rules;
    const valueOf = (rule, type) =>
      rule.conditions.find((condition) => condition.type === type).value;
    assert.equal(NUMBERS.refreshSeconds, 2);
    assert.equal(NUMBERS.bothRemainingSeconds, 10);
    assert.equal(valueOf(rules[4], "auraRemaining"), 2);
    assert.equal(valueOf(rules[5], "debuffRemaining"), 2);
    assert.equal(valueOf(rules[6], "auraRemaining"), 10);
    assert.equal(valueOf(rules[6], "debuffRemaining"), 10);
  });
});
