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
const SHEET_KEYS = [
  "attackPower",
  "critChance",
  "bonusHitChance",
  "haste",
  "expertise",
];
const WEAPON_KEYS = ["min", "max", "speed", "type"];

// True when the combat stats and the weapon damage still come from `gear`.
// Per-hand weapon skill and the character's weapon skill are not part of
// that check: they can sit on a gear-derived sheet.
export function sheetIsDerived(config) {
  if (config?.gear == null) return false;
  let derived;
  try {
    derived = sheetFromGear(config.gear, { race: config.race });
  } catch {
    return false;
  }
  for (const key of SHEET_KEYS) {
    if (config.character?.[key] !== derived.character[key]) return false;
  }
  for (const hand of ["mainHand", "offHand"]) {
    const now = config.weapons?.[hand] ?? null;
    const was = derived.weapons[hand];
    if (now == null || was == null) {
      if (now !== was) return false;
      continue;
    }
    for (const key of WEAPON_KEYS) {
      if (now[key] !== was[key]) return false;
    }
  }
  return true;
}

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
