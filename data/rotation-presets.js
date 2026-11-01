import { k } from "./constants.js";

// The preset rotations (R5, issue #142), as data: a list of
// { id, name, description, rotation }, where `rotation` is a RotationRule
// rotation (js/rotation-schema.js, docs/rotation.md). Nothing here runs
// anything. js/rotation-presets.js lists them for a page and loads one into a
// config, and checks every one against the validator when it is imported.
//
// A rotation is plain JSON. Its numbers are read from data/constants.js
// where a row holds them (the finisher's combo points, the Blade Flurry cost,
// the energy cap and the pooling window, rotation.pooling), so they keep
// their provenance and a retune moves the preset with them. An ability is
// named by its id, and the rule that follows says when it can be cast: the
// interpreter holds the walk at an on-GCD rule that holds but cannot be cast
// (docs/rotation.md, "The walk"), so a rule for Blade Flurry or Adrenaline
// Rush says `abilityUnlocked`, `cooldownReady` and the cost.
//
// A preset is for one weapon setup. combat-swords casts nothing that needs a
// dagger, so it runs on any main hand, and it is not written for another spec.
// assassination-daggers and subtlety-daggers (issue #272) are written for the
// dagger alternate and their reference builds
// (data/preset-reference-builds.js); loading one sets the rotation only. On
// other talents or weapons a rule whose ability the character lacks is passed
// over (abilityGranted, or the interpreter's weapon check), as for any
// rotation. Neither casts Expose Armor or a stealth opener.
//
// id             the preset's key: lower-case words joined by "-"
// name           the display name, and the rotation's own `name`
// description    one sentence for the preset list

const FINISHER = k("rotation.finisherComboPoints");
const { windowSeconds, recastSeconds } = k("rotation.pooling");
const SLICE_AND_DICE = "slice-and-dice";

const comboPointsAtFinisher = {
  type: "comboPoints",
  op: ">=",
  value: FINISHER,
};
const sliceAndDice = (op, value) => ({
  type: "auraRemaining",
  aura: SLICE_AND_DICE,
  op,
  value,
});
const underFinisher = { type: "comboPoints", op: "<", value: FINISHER };
const granted = (ability) => ({ type: "abilityGranted", ability });
const ready = (ability) => ({ type: "cooldownReady", ability });
const onCooldown = (ability) => ({
  type: "cooldownReady",
  ability,
  ready: false,
});
// A debuff is recast when it has under recastSeconds left, as Slice and Dice.
const debuffEnding = (debuff) => ({
  type: "debuffRemaining",
  debuff,
  op: "<",
  value: recastSeconds,
});
const energy = (value) => ({
  type: "resource",
  resource: "energy",
  op: ">=",
  value,
});

// Frozen all the way down (#155): a preset is read and copied
// (js/rotation-presets.js presetRotation), never changed in place.
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Slice and Dice, recast when it is about to end, or at full energy in the
// pooling window (the combat-swords pair below, shared by the dagger presets).
const sliceAndDiceRules = () => [
  {
    action: SLICE_AND_DICE,
    conditions: [comboPointsAtFinisher, sliceAndDice("<", recastSeconds)],
  },
  {
    action: SLICE_AND_DICE,
    conditions: [
      comboPointsAtFinisher,
      sliceAndDice("<=", windowSeconds),
      energy(k("energy.max")),
    ],
  },
];
const ruptureRule = () => ({
  action: "rupture",
  conditions: [comboPointsAtFinisher, debuffEnding("rupture")],
});
const eviscerateRule = () => ({
  action: "eviscerate",
  conditions: [comboPointsAtFinisher, sliceAndDice(">", windowSeconds)],
});

export const ROTATION_PRESETS = deepFreeze([
  {
    id: "combat-swords",
    name: "Combat swords",
    description:
      "Slice and Dice kept up and recast just before it ends, Eviscerate with Cold Blood, Sinister Strike to build, Blade Flurry and Adrenaline Rush on cooldown.",
    rotation: {
      schemaVersion: 1,
      name: "Combat swords",
      rules: [
        {
          action: "blade-flurry",
          conditions: [
            { type: "abilityUnlocked", ability: "blade-flurry" },
            { type: "cooldownReady", ability: "blade-flurry" },
            energy(k("bladeFlurry").energy),
          ],
        },
        {
          action: "adrenaline-rush",
          conditions: [
            { type: "abilityUnlocked", ability: "adrenaline-rush" },
            { type: "cooldownReady", ability: "adrenaline-rush" },
          ],
        },
        // Slice and Dice, recast when it is about to end (issue #122).
        {
          action: SLICE_AND_DICE,
          conditions: [comboPointsAtFinisher, sliceAndDice("<", recastSeconds)],
        },
        // The pooling window has no rule for Eviscerate or the builder, so the
        // energy is kept for Slice and Dice, unless energy is full: then it is
        // cast at once and not waited for.
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPointsAtFinisher,
            sliceAndDice("<=", windowSeconds),
            energy(k("energy.max")),
          ],
        },
        {
          action: "cold-blood",
          conditions: [
            { type: "abilityGranted", ability: "cold-blood" },
            comboPointsAtFinisher,
            sliceAndDice(">", windowSeconds),
          ],
        },
        {
          action: "eviscerate",
          conditions: [comboPointsAtFinisher, sliceAndDice(">", windowSeconds)],
        },
        {
          action: "sinister-strike",
          conditions: [{ type: "comboPoints", op: "<", value: FINISHER }],
        },
      ],
    },
  },
  // Issue #272. Assassination on daggers: the finishers keep Slice and Dice,
  // Rupture and Venom up, and Eviscerate takes the 5 CP none of them needs;
  // Mutilate builds. Cold Blood goes on the next Mutilate (its crits roll
  // Seal Fate), as Cold Blood does nothing for Rupture or Venom.
  {
    id: "assassination-daggers",
    name: "Assassination daggers",
    description:
      "Slice and Dice, Rupture and Venom kept up, Eviscerate with the spare 5 CP, Cold Blood on cooldown for Mutilate, Mutilate to build.",
    rotation: {
      schemaVersion: 1,
      name: "Assassination daggers",
      rules: [
        ...sliceAndDiceRules(),
        ruptureRule(),
        {
          action: "venom",
          conditions: [
            granted("venom"),
            comboPointsAtFinisher,
            { type: "auraRemaining", aura: "venom", op: "<=", value: 0 },
          ],
        },
        eviscerateRule(),
        {
          action: "cold-blood",
          conditions: [granted("cold-blood"), underFinisher],
        },
        {
          action: "mutilate",
          conditions: [granted("mutilate"), underFinisher],
        },
      ],
    },
  },
  // Issue #272. Subtlety on daggers: Premeditation on cooldown when its 2 CP
  // fit, Preparation while Ghostly Strike is on cooldown (Premeditation is
  // too), the Slice and Dice and Rupture finishers and Eviscerate, then
  // Ambush (only when a Cutthroat proc allows it: there is no stealth
  // opener, and the rule has no aura condition, so it is passed over
  // otherwise), Ghostly Strike, Hemorrhage to keep its debuff up, and
  // Backstab.
  {
    id: "subtlety-daggers",
    name: "Subtlety daggers",
    description:
      "Premeditation and Ghostly Strike on cooldown and Preparation to reset them, Slice and Dice and Rupture kept up, Eviscerate, Ambush when Cutthroat allows it, Hemorrhage kept up, Backstab to build.",
    rotation: {
      schemaVersion: 1,
      name: "Subtlety daggers",
      rules: [
        // Off the GCD, so while it is on cooldown the rule is passed over
        // and needs no cooldownReady.
        {
          action: "premeditation",
          conditions: [
            granted("premeditation"),
            {
              type: "comboPoints",
              op: "<=",
              value: FINISHER - k("premeditation").comboPoints,
            },
          ],
        },
        // On the GCD, so it needs cooldownReady. Premeditation is cast at the
        // start (rule 1), so it is on cooldown too when Ghostly Strike is.
        {
          action: "preparation",
          conditions: [
            granted("preparation"),
            ready("preparation"),
            onCooldown("ghostly-strike"),
          ],
        },
        // Only the recast rule of the Slice and Dice pair: a share link of
        // this preset must stay under 2,048 characters (#284), and the
        // full-energy rule never fired with the reference build (the same
        // DPS over 120 seeds at 60 s and 300 s without it; PR for #272).
        sliceAndDiceRules()[0],
        ruptureRule(),
        eviscerateRule(),
        { action: "ambush", conditions: [underFinisher] },
        {
          action: "ghostly-strike",
          conditions: [
            granted("ghostly-strike"),
            underFinisher,
            ready("ghostly-strike"),
          ],
        },
        {
          action: "hemorrhage",
          conditions: [
            granted("hemorrhage"),
            underFinisher,
            debuffEnding("hemorrhage"),
          ],
        },
        { action: "backstab", conditions: [underFinisher] },
      ],
    },
  },
]);
