// Slot search and display helpers for the #297 PR6 gear screen. Pure: no
// DOM, so the tests run it in Node. The view (js/views/gear-screen.js)
// draws from these results. Search is over the slim rogue snapshot only;
// there are no live API calls.
//
// coordinator call 15 Nov (James delegated): Q12, 3,766 rogue-usable
// items plus suffixes; no gems or sockets.

import { GEAR_SLOTS } from "./gear-build.js";

const FIRST = 0;
const SECOND = 1;
const QUALITY_NAMES = Object.freeze([
  "Poor",
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Artifact",
  "Heirloom",
]);

const SLOT_ITEM = Object.freeze({
  head: "head",
  neck: "neck",
  shoulder: "shoulder",
  back: "back",
  chest: "chest",
  wrist: "wrist",
  hands: "hands",
  waist: "waist",
  legs: "legs",
  feet: "feet",
  finger1: "finger",
  finger2: "finger",
  trinket1: "trinket",
  trinket2: "trinket",
  mainHand: "weapon",
  offHand: "weapon",
  ranged: "ranged",
});

const SLOT_LABEL = Object.freeze({
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulder",
  back: "Back",
  chest: "Chest",
  wrist: "Wrist",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger1: "Finger",
  finger2: "Finger",
  trinket1: "Trinket",
  trinket2: "Trinket",
  mainHand: "Main hand",
  offHand: "Off hand",
  ranged: "Ranged",
});

const SLOT_GLYPH = Object.freeze({
  head: "Hd",
  neck: "Nk",
  shoulder: "Sh",
  back: "Bk",
  chest: "Ch",
  wrist: "Wr",
  hands: "Ha",
  waist: "Wz",
  legs: "Lg",
  feet: "Ft",
  finger1: "F1",
  finger2: "F2",
  trinket1: "T1",
  trinket2: "T2",
  mainHand: "MH",
  offHand: "OH",
  ranged: "Rg",
});

const LEFT_SLOTS = Object.freeze([
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
]);
const RIGHT_SLOTS = Object.freeze([
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "trinket1",
  "finger2",
  "trinket2",
]);
const WEAPON_SLOTS = Object.freeze(["mainHand", "offHand", "ranged"]);

const HAND_ONLY = Object.freeze({
  main: "mainHand",
  off: "offHand",
});

const EMPTY_COPY = "Empty";
const CONFLICT_COPY = "Can't be worn here";
const NO_ENCHANT = "No enchant";
const NO_SUFFIX = "No suffix (this item has a fixed name)";
const LEAVE_EMPTY = "Leave empty";
const LEAVE_EMPTY_META = "Clear this slot";
const SEARCH_HINT = "Type at least two letters. “Leave empty” is always first.";
const REFINE_NOTE = "Refine your search if you do not see the item.";
const CLASSIC_NOTE =
  "Classic items that are not in WoW Forever will not appear.";

export {
  QUALITY_NAMES,
  SLOT_ITEM,
  SLOT_LABEL,
  SLOT_GLYPH,
  LEFT_SLOTS,
  RIGHT_SLOTS,
  WEAPON_SLOTS,
  EMPTY_COPY,
  CONFLICT_COPY,
  NO_ENCHANT,
  NO_SUFFIX,
  LEAVE_EMPTY,
  LEAVE_EMPTY_META,
  SEARCH_HINT,
  REFINE_NOTE,
  CLASSIC_NOTE,
};

export function qualityName(quality) {
  return QUALITY_NAMES[quality] ?? null;
}

export function qualityClass(quality) {
  const name = qualityName(quality);
  return name === null ? "" : `q-${name.toLowerCase()}`;
}

// Letters only, apostrophes dropped; one word uses its first two letters
// (Earthstrike → EA), two or more words use the first letter of the first
// two (Don Julio's Band → DJ).
export function itemInitials(name) {
  const words = String(name ?? "")
    .replace(/['’]/g, "")
    .split(/[^A-Za-z]+/)
    .filter((word) => word !== "");
  if (words.length === FIRST) {
    return "";
  }
  if (words.length === SECOND) {
    const word = words[FIRST];
    return `${word[FIRST] ?? ""}${word[SECOND] ?? ""}`.toUpperCase();
  }
  return `${words[FIRST][FIRST]}${words[SECOND][FIRST]}`.toUpperCase();
}

export function slotLabel(slot) {
  return SLOT_LABEL[slot] ?? slot;
}

export function slotGlyph(slot) {
  return SLOT_GLYPH[slot] ?? "";
}

export function slotItemType(slot) {
  return SLOT_ITEM[slot] ?? null;
}

// Case, accents and apostrophes are ignored ("viskag" matches Vis'kag;
// "shad" matches Shadowcraft; "smotts" matches Smotts' Compass).
export function normalizeSearch(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase();
}

export function itemFitsSlot(item, slot) {
  if (!item || item.slot !== SLOT_ITEM[slot]) {
    return false;
  }
  const only = HAND_ONLY[item.weapon?.hand];
  if (only !== undefined && only !== slot) {
    return false;
  }
  return true;
}

export function uniqueTakenIds(slots, exceptSlot) {
  const taken = new Set();
  for (const slot of GEAR_SLOTS) {
    if (slot === exceptSlot) {
      continue;
    }
    const entry = slots?.[slot];
    if (entry == null || typeof entry.item !== "number") {
      continue;
    }
    taken.add(entry.item);
  }
  return taken;
}

function isUniqueBlocked(item, taken) {
  return item.unique === true && taken.has(item.id);
}

export function slotConflict(slot, entry, tables, slots) {
  if (entry == null) {
    return null;
  }
  const item = tables.items.get(entry.item);
  if (!item) {
    return {
      name: `Item ${entry.item}`,
      reason: CONFLICT_COPY,
    };
  }
  if (!itemFitsSlot(item, slot)) {
    return { name: item.name, reason: CONFLICT_COPY };
  }
  const taken = uniqueTakenIds(slots, slot);
  if (isUniqueBlocked(item, taken)) {
    return { name: item.name, reason: CONFLICT_COPY };
  }
  if (entry.enchant != null && !tables.enchants.get(entry.enchant)) {
    return { name: item.name, reason: CONFLICT_COPY };
  }
  if (entry.suffix != null && !tables.suffixes.get(entry.suffix)) {
    return { name: item.name, reason: CONFLICT_COPY };
  }
  if (
    entry.suffix != null &&
    item.suffixes &&
    !decodeSuffixes(item.suffixes).includes(entry.suffix)
  ) {
    return { name: item.name, reason: CONFLICT_COPY };
  }
  return null;
}

export function decodeSuffixes(text) {
  if (typeof text !== "string" || text === "") {
    return [];
  }
  const parts = text.split("+").map(Number);
  const ids = [parts[FIRST]];
  for (let index = SECOND; index < parts.length; index += SECOND) {
    ids.push(ids[index - SECOND] + parts[index]);
  }
  return ids;
}

export function enchantFitsSlot(enchant, slot) {
  if (!enchant) {
    return false;
  }
  const type = SLOT_ITEM[slot];
  if (enchant.slot === type) {
    return true;
  }
  const extras = enchant.extraSlots ?? [];
  return extras.includes(slot) || extras.includes(type);
}

export function enchantsForSlot(slot, tables) {
  const rows = [];
  for (const enchant of tables.enchants.values()) {
    if (enchantFitsSlot(enchant, slot)) {
      rows.push(enchant);
    }
  }
  return rows;
}

export function suffixesForItem(item, tables) {
  if (!item?.suffixes) {
    return [];
  }
  const rows = [];
  for (const id of decodeSuffixes(item.suffixes)) {
    const suffix = tables.suffixes.get(id);
    if (suffix) {
      rows.push(suffix);
    }
  }
  return rows;
}

function keyStats(item) {
  const parts = [];
  const stats = item.stats ?? {};
  if (stats.attackPower) {
    parts.push(`${stats.attackPower} AP`);
  }
  if (stats.agility) {
    parts.push(`${stats.agility} Agi`);
  }
  if (item.weapon) {
    parts.push(
      `${item.weapon.min}–${item.weapon.max} / ${item.weapon.speed} s`,
    );
  }
  if (parts.length === FIRST && item.reqLvl != null) {
    parts.push(`Requires ${item.reqLvl}`);
  }
  return parts.join(" · ");
}

export function resultMeta(item) {
  const quality = qualityName(item.quality) ?? "";
  const stats = keyStats(item);
  return stats === "" ? quality : `${quality} · ${stats}`;
}

export function noResultStatus(slot, query) {
  const label = slotLabel(slot).toLowerCase();
  return `No ${label} items match “${query}”. Try another name, or leave the slot empty. ${CLASSIC_NOTE}`;
}

export function matchStatus(count, capped) {
  const noun = count === SECOND - FIRST ? "match" : "matches";
  const line = `${count} ${noun}.`;
  return capped ? `${line} ${REFINE_NOTE}` : line;
}

// Filter the snapshot to one slot: legal hand types, unique items already
// worn in another slot omitted. Search starts at `start` characters. The
// list is capped at `cap`. “Leave empty” is not a search hit; the view
// always puts it first.
export function searchSlotItems(query, slot, tables, slots, start, cap) {
  const taken = uniqueTakenIds(slots, slot);
  const needle = normalizeSearch(query);
  const started = needle.length >= start;
  const hits = [];
  if (started) {
    for (const item of tables.items.values()) {
      if (!itemFitsSlot(item, slot)) {
        continue;
      }
      if (isUniqueBlocked(item, taken)) {
        continue;
      }
      if (!normalizeSearch(item.name).includes(needle)) {
        continue;
      }
      hits.push(item);
    }
  }
  const capped = hits.length > cap;
  const items = capped ? hits.slice(FIRST, cap) : hits;
  const status = started
    ? hits.length === FIRST
      ? noResultStatus(slot, query)
      : matchStatus(hits.length, capped)
    : SEARCH_HINT;
  return { started, items, total: hits.length, capped, status };
}

export function indexTables({ items, enchants, suffixes }) {
  const byId = (rows, key = "id") =>
    rows instanceof Map
      ? rows
      : new Map(rows.map((row) => [row[key] ?? row.effectId, row]));
  return {
    items: byId(items),
    enchants: byId(enchants, "effectId"),
    suffixes: byId(suffixes),
  };
}
