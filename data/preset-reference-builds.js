import { k } from "./constants.js";
import {
  decodeBuildLink,
  referenceBuild as combatReferenceTalents,
} from "./reference-build.js";
import { talentLevelRange } from "../js/talent-build.js";

// The reference build each preset rotation is written for (issue #272).
// TR-03 / #333: the temporary Combat swords build stays the page default.
// TR-10 / #340: Combat daggers and Assassination daggers, from James's
// 10 Nov 2026 talentsforever links.

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

// #328's Combat daggers weapons, still in data: Perdition's Blade
// (weapon.dagger.mainHand) and the unnamed 59–111 off hand
// (presetReferenceBuild.daggerOffHand). James, 10 Nov 2026, issue #340: use
// those daggers. James, 10 Nov 2026, issue #340: the sheet is character.dagger
// (Core Hound Tooth's attack power and crit) even though the off hand is the
// unnamed 59-111. presetReferenceBuild.daggerCharacter records that assumption.
const daggerHand = (id) => {
  const { type, min, max, speed } = k(id);
  return { min, max, speed, type };
};

const DAGGERS = {
  mainHand: daggerHand("weapon.dagger.mainHand"),
  offHand: daggerHand("presetReferenceBuild.daggerOffHand"),
};

const daggerSheetId = k("presetReferenceBuild.daggerCharacter");
const DAGGER_SHEET = {
  attackPower: k(`${daggerSheetId}.attackPower`),
  critChance: k(`${daggerSheetId}.critChance`),
};

// Glyphs and the query string are ignored by decodeBuildLink.
const COMBAT_DAGGERS_LINK =
  "https://talentsforever.com/rogue/60/005303002-3203032002012321551-003-mCFDISRUWaXde2cfghije-12?b=70755h&d=261110";

const ASSASSINATION_DAGGERS_LINK =
  "https://talentsforever.com/rogue/60/00530321251551031-320303-003-CFDIHGLKJ4NMJPQSRUWm-12?b=70755h&d=261110";

const SUBTLETY_DAGGERS_LINK =
  "https://talentsforever.com/rogue/60/00530301-320003-025233031301001151-mpntrsvo2yzol05SRWCDFH-12?b=70755h&d=261110";

function talentsFromLink(link) {
  const { ranks } = decodeBuildLink(link);
  return Object.fromEntries(
    Object.entries(ranks).filter(([, rank]) => rank > 0),
  );
}

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
  "combat-daggers": {
    name: "Combat daggers (#340)",
    talentLevel: LEVEL_60,
    talents: talentsFromLink(COMBAT_DAGGERS_LINK),
    weapons: DAGGERS,
    // Assumption (dev choice): Instant MH / Deadly OH, recorded as an
    // assumption when #328 was logged on 2 Nov 2026; James has not ruled
    // Combat daggers poisons.
    poisons: poisonsOf("combat-daggers"),
    character: DAGGER_SHEET,
  },
  "assassination-daggers": {
    name: "Assassination daggers (#340)",
    talentLevel: LEVEL_60,
    talents: talentsFromLink(ASSASSINATION_DAGGERS_LINK),
    weapons: DAGGERS,
    // Assassination daggers uses Instant MH / Deadly OH (James 11 Nov 2026 confirmation).
    poisons: poisonsOf("assassination-daggers"),
    character: DAGGER_SHEET,
  },
  "subtlety-daggers": {
    name: "Subtlety daggers (#340)",
    talentLevel: LEVEL_60,
    talents: talentsFromLink(SUBTLETY_DAGGERS_LINK),
    weapons: DAGGERS,
    // Assumption (dev choice): Subtlety daggers uses Instant MH / Deadly OH,
    // matching the Combat and Assassination dagger presets. James has not
    // ruled Subtlety poisons. Cf. his 1 Nov ruling for the historical #273
    // reference builds.
    poisons: poisonsOf("subtlety-daggers"),
    character: DAGGER_SHEET,
  },
});
