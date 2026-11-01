import { k } from "./constants.js";

// The reference build each preset rotation is written for (issue #272), as
// data: the talent ranks and the two weapons. Nothing here, and nothing in
// js/preset-reference-builds.js, puts a build into a config. Loading a preset
// (js/rotation-presets.js loadPreset) sets the rotation only; a page that
// offers "use this preset's build" (#273) reads a build from here and decides
// what to change.
//
// PRESET_REFERENCE_BUILDS is keyed by the preset id (data/rotation-presets.js).
// A preset with no entry has no reference build: js/preset-reference-builds.js
// referenceBuild gives null for it. Each entry:
//
//   name          the build's display name
//   talents       { talent id: rank }, as SimConfig.talents: a rank of 0 is
//                 left out. A legal build for its level (all 51 points at 60).
//   weapons       { mainHand, offHand }, each { type, min, max, speed }: the
//                 SimConfig weapon shape (js/sim-config.js), so a hand can be
//                 put into config.weapons as it is.
//
// Optional fields the shape allows, so #273 can add them without a change
// here. Neither is set today; James has not decided either:
//
//   talentLevel   the level the build is for (10 to 60). When it is set, the
//                 talents must be legal at that level, and a button may set
//                 config.talentLevel to it. Absent: the talents are checked
//                 at level 60, and nothing says the config's level changes.
//   (an entry for "combat-swords")  the Combat preset may get a reference
//                 build of its own, e.g. the #151 build on the sword alternate.
//                 Absent: referenceBuild("combat-swords") is null.
//
// js/preset-reference-builds.js checks every entry when it is imported.

// The dagger alternate (#127): Perdition's Blade and Core Hound Tooth, the
// rows defaultDaggerConfig() uses.
const DAGGERS = {
  mainHand: k("weapon.dagger.mainHand"),
  offHand: k("weapon.dagger.offHand"),
};

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const PRESET_REFERENCE_BUILDS = deepFreeze({
  // The #268 Venom build without Improved Expose Armor (the preset casts no
  // Expose Armor): its two points go to Puncturing Wounds 2/3, Mutilate's
  // crit. 41 Assassination (Cold Blood, Seal Fate, Mutilate, Venom) and 10
  // Combat: 51 points.
  "assassination-daggers": {
    name: "Assassination daggers (Mutilate, Venom)",
    talents: {
      "assassination.remorseless-attacks": 2,
      "assassination.malice": 5,
      "assassination.ruthlessness": 3,
      "assassination.murder": 2,
      "assassination.improved-slice-and-dice": 3,
      "assassination.relentless-strikes": 1,
      "assassination.lethality": 5,
      "assassination.vile-poisons": 5,
      "assassination.cold-blood": 1,
      "assassination.improved-poisons": 5,
      "assassination.vigor": 2,
      "assassination.mutilate": 1,
      "assassination.seal-fate": 5,
      "assassination.venom": 1,
      "combat.improved-eviscerate": 3,
      "combat.improved-sinister-strike": 2,
      "combat.precision": 3,
      "combat.puncturing-wounds": 2,
    },
    weapons: DAGGERS,
  },
  // The #271 Cutthroat build: 15 Assassination, 36 Subtlety with Ghostly
  // Strike, Premeditation, Preparation, Hemorrhage, Quietus, Cutthroat,
  // Improved Ambush, Initiative and Thousand Cuts: 51 points.
  "subtlety-daggers": {
    name: "Subtlety daggers (Hemorrhage, Cutthroat)",
    talents: {
      "assassination.malice": 5,
      "assassination.ruthlessness": 3,
      "assassination.murder": 2,
      "assassination.lethality": 5,
      "subtlety.master-of-deception": 3,
      "subtlety.opportunity": 2,
      "subtlety.setup": 3,
      "subtlety.dirty-tricks": 2,
      "subtlety.improved-ambush": 3,
      "subtlety.initiative": 3,
      "subtlety.ghostly-strike": 1,
      "subtlety.premeditation": 1,
      "subtlety.serrated-blades": 3,
      "subtlety.dirty-deeds": 2,
      "subtlety.preparation": 1,
      "subtlety.hemorrhage": 1,
      "subtlety.quietus": 5,
      "subtlety.cutthroat": 5,
      "subtlety.thousand-cuts": 1,
    },
    weapons: DAGGERS,
  },
});
