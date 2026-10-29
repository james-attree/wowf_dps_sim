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
const energy = (value) => ({
  type: "resource",
  resource: "energy",
  op: ">=",
  value,
});

export const ROTATION_PRESETS = Object.freeze([
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
]);
