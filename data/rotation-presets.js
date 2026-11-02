import { k } from "./constants.js";

// The preset rotations (R5, issue #142), as data: a list of
// { id, name, description, rotation }, where `rotation` is a RotationRule
// rotation (js/rotation-schema.js, docs/rotation.md). Nothing here runs
// anything. js/rotation-presets.js lists them for a page and loads one into a
// config, and checks every one against the validator when it is imported.
//
// A rotation is plain JSON. Its numbers are read from data/constants.js: each
// preset's own row (presetRotation.combat, .assassination, .subtlety, James's
// builds from his share links, issue #310), so they keep their provenance and
// a retune moves the preset with them. An ability is
// named by its id, and the rule that follows says when it can be cast: the
// interpreter holds the walk at an on-GCD rule that holds but cannot be cast
// (docs/rotation.md, "The walk"), so a rule for Blade Flurry or Adrenaline
// Rush says `abilityUnlocked` and `cooldownReady`. Combat's Blade Flurry rule
// gives no energy condition (James's link), so when it holds and Blade Flurry
// cannot be afforded yet, the walk pools energy for it.
//
// A preset is for one weapon setup. combat-swords casts nothing that needs a
// dagger, so it runs on any main hand, and it is not written for another spec.
// assassination-daggers and subtlety-daggers (issue #272) are written for
// daggers and their reference builds (data/preset-reference-builds.js);
// loading one sets the rotation only. On other talents or weapons a rule
// whose ability the character lacks is passed over (abilityGranted, or the
// interpreter's weapon check), as for any rotation. Neither casts Expose Armor or a stealth opener.
//
// id             the preset's key: lower-case words joined by "-"
// name           the display name, and the rotation's own `name`
// description    one sentence for the preset list

const SLICE_AND_DICE = "slice-and-dice";
const COMBAT = k("presetRotation.combat");
const ASSASSINATION = k("presetRotation.assassination");
const SUBTLETY = k("presetRotation.subtlety");
const COMBAT_DAGGERS = k("presetRotation.combatDaggers");

const comboPoints = (op, value) => ({ type: "comboPoints", op, value });
const sliceAndDice = (op, value) => ({
  type: "auraRemaining",
  aura: SLICE_AND_DICE,
  op,
  value,
});
const sliceAndDiceUp = { type: "auraActive", aura: SLICE_AND_DICE };
const rupture = (op, value) => ({
  type: "debuffRemaining",
  debuff: "rupture",
  op,
  value,
});
const granted = (ability) => ({ type: "abilityGranted", ability });
const unlocked = (ability) => ({ type: "abilityUnlocked", ability });
const ready = (ability) => ({ type: "cooldownReady", ability });
const onCooldown = (ability) => ({
  type: "cooldownReady",
  ability,
  ready: false,
});
const energy = (op, value) => ({
  type: "resource",
  resource: "energy",
  op,
  value,
});

// Frozen all the way down (#155): a preset is read and copied
// (js/rotation-presets.js presetRotation), never changed in place.
// The on-use racials (P5-03a #278, P5-03b #279, Phase 5 decision 6): a preset
// opens by casting its race's on-use racial on cooldown. Each rule says only
// abilityGranted: the race grants the ability (data/racial-effects.js), and
// the ability is off the GCD (A21), so a rule that holds while the ability is
// on cooldown is passed over, as Premeditation's would be, and needs no
// cooldownReady. With no race, or another race, none is granted and the rules
// are skipped, so the preset fights as before (G4). Not in James's #310
// links: test/presets-310.test.js lists them as a documented difference.
// Every preset has all four, Combat included (Scout, 2 Nov 2026, on #315):
// the app's share link cap is LINK_CAP, 8,192 (js/views/share-link.js), and
// each racial rule adds about 112 characters.
const ON_USE_RACIALS = ["blood-fury", "elunes-light", "berserking", "eureka"];
const onUseRacialRules = (abilities = ON_USE_RACIALS) =>
  abilities.map((ability) => ({
    action: ability,
    conditions: [granted(ability)],
  }));

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Each rotation is James's share link's (issue #310), its rules and their
// conditions in the link's order, so test/presets-310.test.js can compare
// them. The one change: Combat's link opens with two Slice and Dice rules,
// at 5 CP and at 3 CP, each with under 1 s left; the first is the second's
// case with more points, so it never decides, and it is folded into the
// second (the same fights over every seed measured; PR for #310).
export const ROTATION_PRESETS = deepFreeze([
  {
    id: "combat-swords",
    name: "Combat swords",
    description:
      "Slice and Dice recast at 3 CP or more just before it ends, Adrenaline Rush (under 25 energy) and Blade Flurry with Slice and Dice up, Eviscerate at 5 CP with Cold Blood while Slice and Dice has 12 s or more, Sinister Strike to build, and Eviscerate at 3 CP or more to spend energy at the cap.",
    rotation: {
      schemaVersion: 1,
      name: "Combat swords",
      rules: [
        ...onUseRacialRules(),
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPoints(">=", COMBAT.sliceAndDiceComboPoints),
            sliceAndDice("<", COMBAT.sliceAndDiceRecastSeconds),
          ],
        },
        {
          action: "adrenaline-rush",
          conditions: [
            unlocked("adrenaline-rush"),
            ready("adrenaline-rush"),
            energy("<", COMBAT.adrenalineRushEnergyBelow),
            sliceAndDiceUp,
          ],
        },
        {
          action: "blade-flurry",
          conditions: [
            unlocked("blade-flurry"),
            ready("blade-flurry"),
            sliceAndDiceUp,
          ],
        },
        {
          action: "cold-blood",
          conditions: [
            granted("cold-blood"),
            comboPoints(">=", COMBAT.finisherComboPoints),
            sliceAndDice(">", COMBAT.coldBloodSliceAndDiceSeconds),
          ],
        },
        {
          action: "eviscerate",
          conditions: [
            comboPoints(">=", COMBAT.finisherComboPoints),
            sliceAndDice(">=", COMBAT.eviscerateSliceAndDiceSeconds),
          ],
        },
        {
          action: "sinister-strike",
          conditions: [comboPoints("<", COMBAT.finisherComboPoints)],
        },
        // Below the builder, so it is reached only when Sinister Strike is
        // passed over (at 5 CP) and the energy would otherwise go to waste.
        {
          action: "eviscerate",
          conditions: [
            comboPoints(">=", COMBAT.sliceAndDiceComboPoints),
            { type: "energyToCap", op: "<", value: COMBAT.energyToCapSeconds },
          ],
        },
      ],
    },
  },
  // Issue #310 (first #272). Assassination on daggers: every finisher at
  // 4 CP. Slice and Dice recast just before it ends, or early at full
  // energy; Venom kept up; Eviscerate with the energy to spare; Cold Blood on
  // cooldown for the next Mutilate (its crits roll Seal Fate). No Rupture.
  {
    id: "assassination-daggers",
    name: "Assassination",
    description:
      "Finishers at 4 CP: Slice and Dice kept up (recast early at full energy), Venom kept up, Eviscerate at 75 energy or more; Cold Blood on cooldown for Mutilate, Mutilate to build. No Rupture.",
    rotation: {
      schemaVersion: 1,
      name: "Assassination",
      rules: [
        ...onUseRacialRules(),
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPoints(">=", ASSASSINATION.finisherComboPoints),
            sliceAndDice("<", ASSASSINATION.sliceAndDiceRecastSeconds),
          ],
        },
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPoints(">=", ASSASSINATION.finisherComboPoints),
            sliceAndDice("<=", ASSASSINATION.sliceAndDiceWindowSeconds),
            energy(">=", ASSASSINATION.sliceAndDiceEnergy),
          ],
        },
        {
          action: "venom",
          conditions: [
            granted("venom"),
            comboPoints(">=", ASSASSINATION.finisherComboPoints),
            {
              type: "auraRemaining",
              aura: "venom",
              op: "<=",
              value: ASSASSINATION.venomRecastSeconds,
            },
          ],
        },
        {
          action: "eviscerate",
          conditions: [
            comboPoints(">=", ASSASSINATION.finisherComboPoints),
            energy(">=", ASSASSINATION.eviscerateEnergy),
          ],
        },
        {
          action: "cold-blood",
          conditions: [
            granted("cold-blood"),
            comboPoints("<", ASSASSINATION.coldBloodBelowComboPoints),
          ],
        },
        {
          action: "mutilate",
          conditions: [
            granted("mutilate"),
            comboPoints("<", ASSASSINATION.finisherComboPoints),
          ],
        },
      ],
    },
  },
  // Issue #310 (first #272). Subtlety on daggers: Rupture kept up at 5 CP,
  // Premeditation on cooldown when its 2 CP fit, Preparation while Ghostly
  // Strike is on cooldown, Slice and Dice at 3 CP or more only while Rupture
  // has 10 s or more, then Ghostly Strike and Hemorrhage to build. No
  // Eviscerate, Ambush or Backstab.
  {
    id: "subtlety-daggers",
    name: "Subtlety",
    description:
      "Rupture kept up at 5 CP, Premeditation on cooldown and Preparation to reset Ghostly Strike, Slice and Dice at 3 CP or more while Rupture has 10 s or more, Ghostly Strike on cooldown and Hemorrhage to build.",
    rotation: {
      schemaVersion: 1,
      name: "Subtlety",
      rules: [
        ...onUseRacialRules(),
        {
          action: "rupture",
          conditions: [
            comboPoints(">=", SUBTLETY.ruptureComboPoints),
            rupture("<", SUBTLETY.ruptureRecastSeconds),
          ],
        },
        // Off the GCD, so while it is on cooldown the rule is passed over
        // and needs no cooldownReady.
        {
          action: "premeditation",
          conditions: [
            granted("premeditation"),
            comboPoints("<=", SUBTLETY.premeditationMaxComboPoints),
          ],
        },
        // On the GCD, so it needs cooldownReady.
        {
          action: "preparation",
          conditions: [
            granted("preparation"),
            ready("preparation"),
            onCooldown("ghostly-strike"),
          ],
        },
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPoints(">=", SUBTLETY.sliceAndDiceComboPoints),
            rupture(">=", SUBTLETY.sliceAndDiceRuptureSeconds),
            sliceAndDice("<", SUBTLETY.sliceAndDiceRecastSeconds),
          ],
        },
        {
          action: "ghostly-strike",
          conditions: [
            granted("ghostly-strike"),
            comboPoints("<", SUBTLETY.builderBelowComboPoints),
            ready("ghostly-strike"),
          ],
        },
        {
          action: "hemorrhage",
          conditions: [
            granted("hemorrhage"),
            comboPoints("<", SUBTLETY.builderBelowComboPoints),
          ],
        },
      ],
    },
  },
  // Issue #328. Combat on daggers, James's link as sent: every finisher at
  // 4 CP. Slice and Dice recast just before it ends, or early at full
  // energy; Eviscerate; Backstab to build. Blade Flurry and Adrenaline Rush
  // are talented but not in the rotation, so no rule casts them. The
  // builder's combo point check is the link's (a resource condition on
  // comboPoints, the same as a comboPoints one).
  {
    id: "combat-daggers",
    name: "Combat daggers",
    description:
      "Finishers at 4 CP: Slice and Dice kept up (recast early at full energy), then Eviscerate; Backstab to build. Blade Flurry and Adrenaline Rush are talented but not cast.",
    rotation: {
      schemaVersion: 1,
      name: "Combat daggers",
      rules: [
        ...onUseRacialRules(),
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPoints(">=", COMBAT_DAGGERS.finisherComboPoints),
            sliceAndDice("<", COMBAT_DAGGERS.sliceAndDiceRecastSeconds),
          ],
        },
        {
          action: SLICE_AND_DICE,
          conditions: [
            comboPoints(">=", COMBAT_DAGGERS.finisherComboPoints),
            sliceAndDice("<=", COMBAT_DAGGERS.sliceAndDiceWindowSeconds),
            energy(">=", COMBAT_DAGGERS.sliceAndDiceEnergy),
          ],
        },
        {
          action: "eviscerate",
          conditions: [comboPoints(">=", COMBAT_DAGGERS.finisherComboPoints)],
        },
        {
          action: "backstab",
          conditions: [
            {
              type: "resource",
              resource: "comboPoints",
              op: "<",
              value: COMBAT_DAGGERS.finisherComboPoints,
            },
          ],
        },
      ],
    },
  },
]);
