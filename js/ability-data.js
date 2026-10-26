// The rogue abilities the engine casts, as data (roadmap D2). One generic
// executor (js/ability.js) turns each entry into a castable ability, so an
// ability is a row here and no code. There is no subclass per ability.
//
// An entry says what an ability does and where its numbers are. It holds no
// number of its own: every cost, cooldown, multiplier and table is read from
// data/constants.js with k(), under the row named by `row`, so provenance and
// the retune list stay in one place. The name is not here either. The
// executor reads it from the ability catalogue (js/abilities.js, D1) by `id`,
// so a display name is written once, in the spell data.
//
//   key           the property on Rogue.abilities ("sinisterStrike")
//   id            the catalogue id (slugify of the name); the engine keys
//                 cooldowns, auras and the result's breakdown by it
//   row           the constants row with the ability's numbers: its energy
//                 cost, cooldown and combo points are read from it
//   icon          the page's icon for the ability, the combat log and its aura
//   comboPoints   "gain" adds the row's `comboPoints`; "spend" needs at least
//                 one and clears them. Absent: the cast neither adds nor spends
//   expiresComboPoints
//                 Premeditation: the points it added expire (Rogue.arm/clear/
//                 tickPremeditation) unless a later cast adds one or a finisher
//                 spends them
//   damage        absent: the cast is not an attack and logs a "Cast" event.
//                 Otherwise one of:
//                   { kind: "weapon", multiplier?, bonus? }
//                       a weapon strike: the weapon roll times `multiplier`
//                       plus `bonus`, both fields of the row. A multiplier is a
//                       number, or { dagger, other } by the main-hand weapon type
//                   { kind: "finisherRoll", apPerCp, bands }
//                       attack power times combo points times the constant
//                       `apPerCp`, plus a random value inside the row's `bands`
//                       entry for the combo points (min and max)
//                   { kind: "dot", ap, bleed? }
//                       a damage over time: the row's `damageByCp` plus attack
//                       power times the constant `ap` for the combo points. This
//                       is the total, and the tick count divides it. `bleed`
//                       marks the ticks as bleeds (they skip armor)
//   aura          the aura (js/auras.js, AURAS key) a landed cast puts up and
//                 `duration` says for how long: { field } is a field of
//                 the row, { row, field } a field of another constants row, and
//                 { byComboPoints } a table in the row, one entry per combo
//                 point spent. No entry for the combo points means no aura
//
// Whether an ability starts the global cooldown comes from the catalogue
// (startsGcd, which is abilities.offGcd). The order here is the order of
// Rogue.abilities.
export const ABILITY_DEFINITIONS = Object.freeze([
  {
    key: "premeditation",
    id: "premeditation",
    row: "premeditation",
    icon: "./img/premeditation.jpg",
    comboPoints: "gain",
    expiresComboPoints: true,
  },
  {
    key: "sinisterStrike",
    id: "sinister-strike",
    row: "sinisterStrike",
    icon: "./img/sinister_strike.jpg",
    comboPoints: "gain",
    damage: { kind: "weapon", bonus: "bonusDamage" },
  },
  {
    key: "eviscerate",
    id: "eviscerate",
    row: "eviscerate",
    icon: "./img/eviscerate.jpg",
    comboPoints: "spend",
    damage: {
      kind: "finisherRoll",
      apPerCp: "eviscerate.apPerCP",
      bands: "damageByCp",
    },
  },
  {
    key: "adrenalineRush",
    id: "adrenaline-rush",
    row: "adrenalineRush",
    icon: "./img/adrenaline_rush.jpg",
    aura: { id: "adrenalineRush", duration: { field: "duration" } },
  },
  {
    key: "sliceAndDice",
    id: "slice-and-dice",
    row: "sliceAndDice",
    icon: "./img/slice_and_dice.jpg",
    comboPoints: "spend",
    aura: { id: "sliceAndDice", duration: { byComboPoints: "durationByCp" } },
  },
  {
    key: "ghostlyStrike",
    id: "ghostly-strike",
    row: "ghostlyStrike",
    icon: "./img/ghostly_strike.jpg",
    comboPoints: "gain",
    damage: { kind: "weapon", multiplier: "weaponMultiplier" },
    aura: { id: "ghostlyStrike", duration: { field: "duration" } },
  },
  {
    key: "backstab",
    id: "backstab",
    row: "backstab",
    icon: "./img/backstab.jpg",
    comboPoints: "gain",
    damage: {
      kind: "weapon",
      multiplier: "weaponMultiplier",
      bonus: "bonusDamage",
    },
  },
  {
    key: "ambush",
    id: "ambush",
    row: "ambush",
    icon: "./img/ambush.jpg",
    comboPoints: "gain",
    damage: {
      kind: "weapon",
      multiplier: "weaponMultiplier",
      bonus: "bonusDamage",
    },
  },
  {
    key: "bladeFlurry",
    id: "blade-flurry",
    row: "bladeFlurry",
    icon: "./img/blade_flurry.jpg",
    aura: { id: "bladeFlurry", duration: { field: "duration" } },
  },
  {
    key: "rupture",
    id: "rupture",
    row: "rupture",
    icon: "./img/rupture.jpg",
    comboPoints: "spend",
    damage: { kind: "dot", ap: "rupture.apByCP", bleed: true },
    aura: { id: "rupture", duration: { byComboPoints: "durationByCp" } },
  },
  {
    key: "hemorrhage",
    id: "hemorrhage",
    row: "hemorrhage",
    icon: "./img/hemorrhage.jpg",
    comboPoints: "gain",
    damage: { kind: "weapon", multiplier: "weaponMultiplier" },
    aura: {
      id: "hemorrhage",
      duration: { row: "hemorrhage.ruptureBonus", field: "duration" },
    },
  },
]);
