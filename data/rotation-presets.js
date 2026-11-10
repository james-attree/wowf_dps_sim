import { k } from "./constants.js";

// The preset rotations (R5, issue #142), as data: a list of
// { id, name, description, rotation }, where `rotation` is a RotationRule
// rotation (js/rotation-schema.js, docs/rotation.md). Nothing here runs
// anything. js/rotation-presets.js lists them for a page and loads one into a
// config, and checks every one against the validator when it is imported.
//
// TR-03 / #333: James's temporary Combat swords (16/35/0) stays selectable
// and stays the page default. TR-04 / #337: Shank when energy < 50 is live
// in COMBAT_SWORDS_TEMP_RULES. TR-10 / #340: Combat daggers is the same
// rotation with Sinister Strike replaced by Backstab (James, 10 Nov 2026).

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// The only Shank rule James ruled for the temporary Combat swords preset
// (5 Nov 2026 / TR-04 #337): cast when energy < 50 and the cooldown is ready.
export const COMBAT_SWORDS_SHANK_RULE = deepFreeze({
  action: "shank",
  conditions: [
    { type: "cooldownReady", ability: "shank" },
    { type: "resource", resource: "energy", op: "<", value: 50 },
  ],
});

const COMBAT_SWORDS_TEMP_RULES = deepFreeze([
  {
    action: "blood-fury",
    conditions: [
      {
        type: "abilityGranted",
        ability: "blood-fury",
      },
    ],
  },
  {
    action: "elunes-light",
    conditions: [
      {
        type: "abilityGranted",
        ability: "elunes-light",
      },
    ],
  },
  {
    action: "berserking",
    conditions: [
      {
        type: "abilityGranted",
        ability: "berserking",
      },
    ],
  },
  {
    action: "eureka",
    conditions: [
      {
        type: "abilityGranted",
        ability: "eureka",
      },
    ],
  },
  {
    action: "slice-and-dice",
    conditions: [
      {
        type: "comboPoints",
        op: ">=",
        value: 3,
      },
      {
        type: "auraRemaining",
        aura: "slice-and-dice",
        op: "<",
        value: 1,
      },
    ],
  },
  {
    action: "adrenaline-rush",
    conditions: [
      {
        type: "abilityUnlocked",
        ability: "adrenaline-rush",
      },
      {
        type: "cooldownReady",
        ability: "adrenaline-rush",
      },
      {
        type: "resource",
        resource: "energy",
        op: "<",
        value: 25,
      },
      {
        type: "auraActive",
        aura: "slice-and-dice",
      },
    ],
  },
  {
    action: "blade-flurry",
    conditions: [
      {
        type: "abilityUnlocked",
        ability: "blade-flurry",
      },
      {
        type: "cooldownReady",
        ability: "blade-flurry",
      },
      {
        type: "auraActive",
        aura: "slice-and-dice",
      },
    ],
  },
  COMBAT_SWORDS_SHANK_RULE,
  {
    action: "eviscerate",
    conditions: [
      {
        type: "comboPoints",
        op: ">=",
        value: 5,
      },
      {
        type: "auraRemaining",
        aura: "slice-and-dice",
        op: ">=",
        value: 12,
      },
    ],
  },
  {
    action: "sinister-strike",
    conditions: [
      {
        type: "comboPoints",
        op: "<",
        value: 5,
      },
    ],
  },
  {
    action: "eviscerate",
    conditions: [
      {
        type: "comboPoints",
        op: ">=",
        value: 3,
      },
      {
        type: "energyToCap",
        op: "<",
        value: 1,
      },
    ],
  },
]);

// James, 10 Nov 2026, issue #340: the temporary Combat swords rotation with
// Sinister Strike replaced by Backstab. Every other rule stays identical,
// including Shank below 50 energy.
const COMBAT_DAGGERS_RULES = deepFreeze(
  COMBAT_SWORDS_TEMP_RULES.map((rule) =>
    rule.action === "sinister-strike" ? { ...rule, action: "backstab" } : rule,
  ),
);

// James, 10 Nov 2026, issue #340. Finishers at 4+ CP, in order: Slice and Dice,
// Rupture, Eviscerate. Cold Blood whenever it is ready, before Mutilate.
// Mutilate before Shank. The builder cap (CP below the finisher threshold)
// is the Combat swords pattern. Mutilate also requires energy at or above
// the Shank line so that rule can be reached (an unpaid on-GCD rule pools).
// The four racials are the opening every live preset uses.
const ASSASSINATION_NUMBERS = k("presetRotation.assassinationDaggers");
const FINISHER_CP = {
  type: "comboPoints",
  op: ">=",
  value: ASSASSINATION_NUMBERS.finisherComboPoints,
};

const ASSASSINATION_DAGGERS_RULES = deepFreeze([
  {
    action: "blood-fury",
    conditions: [{ type: "abilityGranted", ability: "blood-fury" }],
  },
  {
    action: "elunes-light",
    conditions: [{ type: "abilityGranted", ability: "elunes-light" }],
  },
  {
    action: "berserking",
    conditions: [{ type: "abilityGranted", ability: "berserking" }],
  },
  {
    action: "eureka",
    conditions: [{ type: "abilityGranted", ability: "eureka" }],
  },
  {
    action: "slice-and-dice",
    conditions: [
      FINISHER_CP,
      {
        type: "auraRemaining",
        aura: "slice-and-dice",
        op: "<",
        value: ASSASSINATION_NUMBERS.refreshSeconds,
      },
    ],
  },
  {
    action: "rupture",
    conditions: [
      FINISHER_CP,
      {
        type: "debuffRemaining",
        debuff: "rupture",
        op: "<",
        value: ASSASSINATION_NUMBERS.refreshSeconds,
      },
    ],
  },
  {
    action: "eviscerate",
    conditions: [
      FINISHER_CP,
      {
        type: "auraRemaining",
        aura: "slice-and-dice",
        op: ">",
        value: ASSASSINATION_NUMBERS.bothRemainingSeconds,
      },
      {
        type: "debuffRemaining",
        debuff: "rupture",
        op: ">",
        value: ASSASSINATION_NUMBERS.bothRemainingSeconds,
      },
    ],
  },
  {
    action: "cold-blood",
    conditions: [
      { type: "abilityGranted", ability: "cold-blood" },
      { type: "cooldownReady", ability: "cold-blood" },
    ],
  },
  {
    action: "mutilate",
    conditions: [
      { type: "abilityUnlocked", ability: "mutilate" },
      {
        type: "comboPoints",
        op: "<",
        value: ASSASSINATION_NUMBERS.finisherComboPoints,
      },
      {
        type: "resource",
        resource: "energy",
        op: ">=",
        value: ASSASSINATION_NUMBERS.shankEnergyBelow,
      },
    ],
  },
  {
    action: "shank",
    conditions: [
      { type: "cooldownReady", ability: "shank" },
      {
        type: "resource",
        resource: "energy",
        op: "<",
        value: ASSASSINATION_NUMBERS.shankEnergyBelow,
      },
    ],
  },
]);

// James, 10 Nov 2026, issue #340. Finishers at 4+ CP: Slice and Dice, Rupture,
// Death Mark. Ghostly Strike when Garrote is down, then Garrote, Shank below
// 50 energy, Hemorrhage. Premeditation and Preparation are on cooldown.
// Their place (after the racials, before the finishers) and Hemorrhage's
// combo-point cap are dev choices. See presetRotation.subtletyDaggers.
const SUBTLETY_NUMBERS = k("presetRotation.subtletyDaggers");
const SUBTLETY_FINISHER = {
  type: "comboPoints",
  op: ">=",
  value: SUBTLETY_NUMBERS.finisherComboPoints,
};

const SUBTLETY_DAGGERS_RULES = deepFreeze([
  {
    action: "blood-fury",
    conditions: [{ type: "abilityGranted", ability: "blood-fury" }],
  },
  {
    action: "elunes-light",
    conditions: [{ type: "abilityGranted", ability: "elunes-light" }],
  },
  {
    action: "berserking",
    conditions: [{ type: "abilityGranted", ability: "berserking" }],
  },
  {
    action: "eureka",
    conditions: [{ type: "abilityGranted", ability: "eureka" }],
  },
  {
    action: "premeditation",
    conditions: [
      { type: "abilityGranted", ability: "premeditation" },
      { type: "cooldownReady", ability: "premeditation" },
    ],
  },
  {
    action: "preparation",
    conditions: [
      { type: "abilityGranted", ability: "preparation" },
      { type: "cooldownReady", ability: "preparation" },
    ],
  },
  {
    action: "slice-and-dice",
    conditions: [
      SUBTLETY_FINISHER,
      {
        type: "auraRemaining",
        aura: "slice-and-dice",
        op: "<",
        value: SUBTLETY_NUMBERS.refreshSeconds,
      },
    ],
  },
  {
    action: "rupture",
    conditions: [
      SUBTLETY_FINISHER,
      {
        type: "debuffRemaining",
        debuff: "rupture",
        op: "<",
        value: SUBTLETY_NUMBERS.refreshSeconds,
      },
    ],
  },
  {
    action: "death-mark",
    conditions: [
      { type: "abilityGranted", ability: "death-mark" },
      { type: "cooldownReady", ability: "death-mark" },
      SUBTLETY_FINISHER,
      {
        type: "debuffRemaining",
        debuff: "garrote",
        op: ">",
        value: SUBTLETY_NUMBERS.deathMarkRemainingSeconds,
      },
      {
        type: "debuffRemaining",
        debuff: "rupture",
        op: ">",
        value: SUBTLETY_NUMBERS.deathMarkRemainingSeconds,
      },
    ],
  },
  {
    action: "ghostly-strike",
    conditions: [
      { type: "abilityUnlocked", ability: "ghostly-strike" },
      { type: "cooldownReady", ability: "ghostly-strike" },
      { type: "debuffActive", debuff: "garrote", active: false },
    ],
  },
  { action: "garrote", conditions: [] },
  {
    action: "shank",
    conditions: [
      { type: "cooldownReady", ability: "shank" },
      {
        type: "resource",
        resource: "energy",
        op: "<",
        value: SUBTLETY_NUMBERS.shankEnergyBelow,
      },
    ],
  },
  {
    action: "hemorrhage",
    conditions: [
      { type: "abilityUnlocked", ability: "hemorrhage" },
      {
        type: "comboPoints",
        op: "<",
        value: SUBTLETY_NUMBERS.builderComboPointsBelow,
      },
    ],
  },
]);

export const ROTATION_PRESETS = deepFreeze([
  {
    id: "combat-swords-temp",
    name: "Combat swords (temporary)",
    description:
      "James's temporary Combat swords build for the 70755 rework (TR-03 / #333, Shank in TR-04 / #337): Assassination 16 / Combat 35 / Subtlety 0. Casts Shank when energy is below 50.",
    rotation: {
      schemaVersion: 1,
      name: "Combat swords (temporary)",
      rules: COMBAT_SWORDS_TEMP_RULES,
    },
  },
  {
    id: "combat-daggers",
    name: "Combat daggers",
    description:
      "James, 10 Nov 2026, issue #340: the temporary Combat swords rotation with Sinister Strike replaced by Backstab. Talents are the 70755 link (Assassination 13 / Combat 35 / Subtlety 3). Two daggers, Instant on the main hand and Deadly on the off hand.",
    rotation: {
      schemaVersion: 1,
      name: "Combat daggers",
      rules: COMBAT_DAGGERS_RULES,
    },
  },
  {
    id: "assassination-daggers",
    name: "Assassination daggers",
    description:
      "James, 10 Nov 2026, issue #340: finishers at 4 or more combo points (Slice and Dice, then Rupture, then Eviscerate). Slice and Dice and Rupture refresh when missing or under 2s. Eviscerate only when both have more than 10s left. Cold Blood when it is ready, before Mutilate. Shank when energy is below 50. Talents are the 70755 link (Assassination 37 / Combat 11 / Subtlety 3). Two daggers, Instant on the main hand and Deadly on the off hand.",
    rotation: {
      schemaVersion: 1,
      name: "Assassination daggers",
      rules: ASSASSINATION_DAGGERS_RULES,
    },
  },
  {
    id: "subtlety-daggers",
    name: "Subtlety daggers",
    description:
      "James, 10 Nov 2026, issue #340: finishers at 4 or more combo points (Slice and Dice, then Rupture, then Death Mark). Death Mark only when Garrote and Rupture each have more than 6s left. Ghostly Strike when Garrote is not up, then Garrote, Shank below 50 energy, Hemorrhage. Premeditation and Preparation on cooldown. Talents are the 70755 link (Assassination 12 / Combat 8 / Subtlety 31). Two daggers. Instant on the main hand and Deadly on the off hand are James's 1 Nov 2026 ruling that every preset reference build uses that pair, carried forward to this TR-10 preset as an assumption.",
    rotation: {
      schemaVersion: 1,
      name: "Subtlety daggers",
      rules: SUBTLETY_DAGGERS_RULES,
    },
  },
]);
