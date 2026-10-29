import { k } from "../data/constants.js";
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
//   not counted. A partial build (#190), one that spends fewer points than
//   its cap (config.talentLevel - 9, 51 at the default level 60), adds the
//   points out of the cap: "Combat 0/10/0 (10/51)". A full build has none, so
//   the reference build is still "Combat 18/33/0".
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

function talentPart(talents, catalogue, level) {
  const trees = catalogue.trees;
  const points = new Map(trees.map((tree) => [tree.id, 0]));
  for (const [id, rank] of Object.entries(talents ?? {})) {
    const talent = catalogue.get(id);
    if (talent !== undefined && Number.isFinite(rank)) {
      points.set(talent.tree, points.get(talent.tree) + rank);
    }
  }
  const counts = trees.map((tree) => points.get(tree.id));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return "No talents";
  }
  let top = 0;
  counts.forEach((count, index) => {
    if (count > counts[top]) {
      top = index;
    }
  });
  const cap = capOf(level);
  const spent = total < cap ? ` (${total}/${cap})` : "";
  return `${trees[top].name} ${counts.join("/")}${spent}`;
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
  { talents = talentCatalogue, poisons = poisonCatalogue } = {},
) {
  const rotation = config?.rotation?.name;
  return [
    talentPart(config?.talents, talents, config?.talentLevel),
    typeof rotation === "string" && rotation !== ""
      ? rotation
      : "Default rotation",
    poisonPart(config?.poisons, poisons),
  ].join(LABEL_SEPARATOR);
}
