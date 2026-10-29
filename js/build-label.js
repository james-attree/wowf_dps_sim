import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { poisonCatalogue } from "./poisons.js";
import { DEFAULT_TALENT_LEVEL, talentPointCap } from "./talent-build.js";
import { talentCatalogue } from "./talents.js";

// The build label of the batch results panel (#154, Fran's spec section 1a):
// "<Top tree> <a>/<c>/<s> · <Rotation name> · <Poisons>", generated from the
// config a batch ran (result.config), never from free text and never from the
// live form, so it cannot drift while a run is going.
//
// - Talents: the points spent in each tree, in catalogue order; prefixed with
//   the tree with the most points (the first in catalogue order on a tie).
//   "No talents" with no point spent. A talent the catalogue does not know is
//   not counted. Then, below the default level 60, the level, and then the
//   points spent out of the cap (config.talentLevel - 9, 51 at 60; #190):
//   "Combat 18/33/0 · 51/51", "Combat 7/22/0 · level 40 · 29/31" (Fran's U6
//   spec D17, #204). Then the count of the build's talents the sim does not
//   model yet (no entry in data/talent-effects.js, spec section 6):
//   "· 11 not simulated yet". "No talents" with no point spent ("No talents
//   · level 40" below 60). The talent tree's summary row (#204) shows the
//   same text.
// - Rotation: its name; "Default rotation" when it has none.
// - Poisons: "<Name> MH, <Name> OH" without the word "Poison", an empty hand
//   left out; "No poisons" with neither.
//
// It reads ranks only. js/main.js hands it to the results panel view, which
// may not import the talent or poison catalogues itself (eslint.config.js).

export const LABEL_SEPARATOR = " · ";

// The cap of a config's talent level; a level that is not valid is shown
// against 51, since the label never throws.
function capOf(level) {
  try {
    return talentPointCap(level ?? DEFAULT_TALENT_LEVEL);
  } catch {
    return k("talents.maxPoints");
  }
}

function talentPart(talents, catalogue, level, effects) {
  const trees = catalogue.trees;
  const points = new Map(trees.map((tree) => [tree.id, 0]));
  let notSimulated = 0;
  for (const [id, rank] of Object.entries(talents ?? {})) {
    const talent = catalogue.get(id);
    if (talent !== undefined && Number.isFinite(rank)) {
      points.set(talent.tree, points.get(talent.tree) + rank);
      if (rank > 0 && !(id in effects)) {
        notSimulated += 1;
      }
    }
  }
  const counts = trees.map((tree) => points.get(tree.id));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const levelText =
    Number.isInteger(level) && level < DEFAULT_TALENT_LEVEL
      ? `${LABEL_SEPARATOR}level ${level}`
      : "";
  if (total === 0) {
    return `No talents${levelText}`;
  }
  let top = 0;
  counts.forEach((count, index) => {
    if (count > counts[top]) {
      top = index;
    }
  });
  const spent = `${LABEL_SEPARATOR}${total}/${capOf(level)}`;
  const missing =
    notSimulated > 0
      ? `${LABEL_SEPARATOR}${notSimulated} not simulated yet`
      : "";
  return `${trees[top].name} ${counts.join("/")}${levelText}${spent}${missing}`;
}

// The talents part alone, for the talent tree's summary row (#204).
export function talentLabel(
  talents,
  level,
  { catalogue = talentCatalogue, effects = TALENT_EFFECTS } = {},
) {
  return talentPart(talents, catalogue, level, effects);
}

function shortPoisonName(key, catalogue) {
  return poisonName(key, catalogue).replace(/ Poison$/, "");
}

// A poison's full name for the run details ("Instant Poison"), or the key
// with a capital when the catalogue does not know it.
export function poisonName(key, catalogue = poisonCatalogue) {
  const poison = catalogue.byKey(key);
  return poison === undefined
    ? `${key.charAt(0).toUpperCase()}${key.slice(1)}`
    : poison.name;
}

function poisonPart(poisons, catalogue) {
  const { mainHand, offHand } = poisons ?? {};
  const hands = [
    mainHand ? `${shortPoisonName(mainHand, catalogue)} MH` : null,
    offHand ? `${shortPoisonName(offHand, catalogue)} OH` : null,
  ].filter((hand) => hand !== null);
  return hands.length === 0 ? "No poisons" : hands.join(", ");
}

export function buildLabel(
  config,
  {
    talents = talentCatalogue,
    poisons = poisonCatalogue,
    effects = TALENT_EFFECTS,
  } = {},
) {
  const rotation = config?.rotation?.name;
  return [
    talentPart(config?.talents, talents, config?.talentLevel, effects),
    typeof rotation === "string" && rotation !== ""
      ? rotation
      : "Default rotation",
    poisonPart(config?.poisons, poisons),
  ].join(LABEL_SEPARATOR);
}
