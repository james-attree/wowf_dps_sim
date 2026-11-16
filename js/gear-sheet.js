import { k } from "../data/constants.js";
import enchants from "../data/items/enchants.json" with { type: "json" };
import items from "../data/items/rogue-items.json" with { type: "json" };
import suffixes from "../data/items/suffixes.json" with { type: "json" };
import { deriveSheet } from "./gear-derive.js";

const tables = { items, enchants, suffixes };

// Rating the page stores. deriveSheet reports expertise as a fraction.
export function expertiseRating(fraction) {
  return Math.round(
    fraction * k("sheet.percent") * k("sheet.expertiseRatingPerPercent"),
  );
}

// The engine sheet for a gear build. Race and level stay on the character
// (coordinator call 15 Nov (James delegated), Q5). Throws when the build
// does not check out: an unknown item, an illegal slot, a bad enchant.
export function sheetFromGear(gear, { race = "human" } = {}) {
  const derived = deriveSheet(
    gear,
    { level: k("items.v1Level"), race },
    tables,
  );
  return {
    character: {
      attackPower: derived.character.attackPower,
      critChance: derived.character.critChance,
      bonusHitChance: derived.character.bonusHitChance,
      haste: derived.character.haste,
      expertise: expertiseRating(derived.breakdown.expertise),
    },
    weapons: {
      mainHand: derived.weapons.mainHand,
      offHand: derived.weapons.offHand,
    },
  };
}
