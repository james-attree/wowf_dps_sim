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

// James 15 Nov 2026, to the coordinator: 'Remove the link between weapons and talent/rotation choices.' (supersedes the 10 Nov #340 preset-sets-weapons rulings)
// Presets set talents, poisons and the rotation, not weapons or the character
// sheet. Those values are frozen in data/legacy-sheets.js for the goldens.

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
    poisons: poisonsOf("combat-swords-temp"),
  },
  "combat-daggers": {
    name: "Combat daggers (#340)",
    talentLevel: LEVEL_60,
    talents: talentsFromLink(COMBAT_DAGGERS_LINK),
    // James 11 Nov 2026: Instant on the main hand, Deadly on the off hand.
    // Weapons and the character sheet are not part of the preset.
    // James 15 Nov 2026, to the coordinator: 'Remove the link between weapons and talent/rotation choices.' (supersedes the 10 Nov #340 preset-sets-weapons rulings)
    // The old numbers live in data/legacy-sheets.js.
    poisons: poisonsOf("combat-daggers"),
  },
  "assassination-daggers": {
    name: "Assassination daggers (#340)",
    talentLevel: LEVEL_60,
    talents: talentsFromLink(ASSASSINATION_DAGGERS_LINK),
    // James 11 Nov 2026: Instant on the main hand, Deadly on the off hand.
    poisons: poisonsOf("assassination-daggers"),
  },
  "subtlety-daggers": {
    name: "Subtlety daggers (#340)",
    talentLevel: LEVEL_60,
    talents: talentsFromLink(SUBTLETY_DAGGERS_LINK),
    // Assumption (dev choice): Subtlety daggers uses Instant MH / Deadly OH,
    // matching the Combat and Assassination dagger presets. James has not
    // ruled Subtlety poisons.
    poisons: poisonsOf("subtlety-daggers"),
  },
});
