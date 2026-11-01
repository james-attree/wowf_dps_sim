import { k } from "./constants.js";
import { referenceBuild as combatReferenceTalents } from "./reference-build.js";
import { talentLevelRange } from "../js/talent-build.js";

// The reference build each preset rotation is written for (issue #272), as
// data: the talent ranks and the two weapons. Nothing here, and nothing in
// js/preset-reference-builds.js, puts a build into a config. Loading a preset
// (js/rotation-presets.js loadPreset) sets the rotation only; a page that
// offers "use this preset's build" (#273) reads a build from here and decides
// what to change.
//
// PRESET_REFERENCE_BUILDS is keyed by the preset id (data/rotation-presets.js).
// Every preset has one (James's decision, relayed by Scout on 1 Nov 2026: the
// Combat swords preset gets one too). A preset with no entry would have no
// reference build, and js/preset-reference-builds.js referenceBuild would give
// null for it. Each entry:
//
//   name          the build's display name
//   talentLevel   the talent level the build is for: 60 for every build
//                 (James's decision, relayed by Scout). It is the
//                 SimConfig.talentLevel field, so #273's button can set
//                 config.talentLevel to it when the config is below it (and
//                 the page says so). Nothing in #272 applies it.
//   talents       { talent id: rank }, as SimConfig.talents: a rank of 0 is
//                 left out. A legal build at its talentLevel (51 points at 60).
//   weapons       { mainHand, offHand }, each { type, min, max, speed }: the
//                 SimConfig weapon shape (js/sim-config.js), so a hand can be
//                 put into config.weapons as it is.
//   poisons       { mainHand, offHand }, each a poison id (config.poisonIds):
//                 the SimConfig poisons shape, so it can be put into
//                 config.poisons as it is. Instant Poison on the main hand and
//                 Deadly Poison on the off hand for every build (James's
//                 ruling, relayed by Scout: presetReferenceBuild.poisons).
//
// js/preset-reference-builds.js checks every entry when it is imported.

// The dagger alternate (#127): Perdition's Blade and Core Hound Tooth, the
// rows defaultDaggerConfig() uses.
const DAGGERS = {
  mainHand: k("weapon.dagger.mainHand"),
  offHand: k("weapon.dagger.offHand"),
};

// The default config's swords (js/sim-config.js defaultConfig reads the same
// weapon.mainHand and weapon.offHand rows), in the SimConfig shape: the
// offhand's initial swing is not a config field.
const swordHand = (hand) => {
  const { type, min, max, speed } = k(`weapon.${hand}`);
  return { min, max, speed, type };
};
const SWORDS = {
  mainHand: swordHand("mainHand"),
  offHand: swordHand("offHand"),
};

// Every build's poisons (James's ruling, relayed by Scout), a copy for each
// build so freezing a build leaves the constant as it is.
const poisons = () => ({ ...k("presetReferenceBuild.poisons") });

// Every build is for level 60, the top talent level (51 points).
const LEVEL_60 = talentLevelRange().max;

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
  // The current defaults: the #151 reference Combat build (data/reference-
  // build.js, the build the combat-swords preset and its #164 golden use)
  // with the default config's swords in both hands.
  "combat-swords": {
    name: "Combat swords (the #151 reference build)",
    talentLevel: LEVEL_60,
    talents: combatReferenceTalents(),
    weapons: SWORDS,
    poisons: poisons(),
  },
  "assassination-daggers": {
    name: "Assassination daggers (Mutilate, Venom)",
    talentLevel: LEVEL_60,
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
    poisons: poisons(),
  },
  // The #271 Cutthroat build: 15 Assassination, 36 Subtlety with Ghostly
  // Strike, Premeditation, Preparation, Hemorrhage, Quietus, Cutthroat,
  // Improved Ambush, Initiative and Thousand Cuts: 51 points.
  "subtlety-daggers": {
    name: "Subtlety daggers (Hemorrhage, Cutthroat)",
    talentLevel: LEVEL_60,
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
    poisons: poisons(),
  },
});
