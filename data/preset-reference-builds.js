import { k } from "./constants.js";
import { referenceBuild as combatReferenceTalents } from "./reference-build.js";
import { talentLevelRange } from "../js/talent-build.js";

// The reference build each preset rotation is written for (issue #272).
// TR-03 / #333: only the temporary Combat swords build.

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const swordHand = (hand) => {
  const { type, min, max, speed } = k(`weapon.${hand}`);
  return { min, max, speed, type };
};

// assumption: MH/OH sword damage and speed from the prior Combat swords
// preset / page defaults until James sends a sim share link (#333).
const SWORDS = {
  mainHand: swordHand("mainHand"),
  offHand: swordHand("offHand"),
};

const LEVEL_60 = talentLevelRange().max;

const poisonsOf = (presetId) => ({
  ...k("presetReferenceBuild.poisons")[presetId],
});

export const PRESET_REFERENCE_BUILDS = deepFreeze({
  "combat-swords-temp": {
    name: "Combat swords (temporary, #333)",
    talentLevel: LEVEL_60,
    talents: combatReferenceTalents(),
    weapons: SWORDS,
    poisons: poisonsOf("combat-swords-temp"),
  },
});
