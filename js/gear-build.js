// Gear build rules (#297). A build is items, enchants and suffixes per slot.
// Any slot may be empty. This module does not derive stats.

export const GEAR_SLOTS = Object.freeze([
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "mainHand",
  "offHand",
  "ranged",
]);

const SLOT_ITEM = {
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
};

const HAND_SLOT = { main: "mainHand", off: "offHand", one: null };

function fail(message) {
  throw new Error(message);
}

function slotEntry(build, slot) {
  if (build == null || typeof build !== "object") {
    fail("A gear build must be an object.");
  }
  const slots = build.slots ?? {};
  const entry = slots[slot];
  if (entry == null) {
    return null;
  }
  if (typeof entry !== "object" || typeof entry.item !== "number") {
    fail(`${slot} needs an item id.`);
  }
  return entry;
}

export function validateBuild(build, tables) {
  const worn = [];
  const seenUnique = new Set();
  for (const slot of GEAR_SLOTS) {
    const entry = slotEntry(build, slot);
    if (entry == null) {
      continue;
    }
    const item = tables.items.get(entry.item);
    if (!item) {
      fail(`${slot} item ${entry.item} is not in the rogue snapshot.`);
    }
    if (item.slot !== SLOT_ITEM[slot]) {
      fail(`${item.name} does not go in ${slot}.`);
    }
    if (item.weapon?.hand) {
      const only = HAND_SLOT[item.weapon.hand];
      if (only !== null && only !== slot) {
        fail(
          `${item.name} is ${item.weapon.hand}-hand and does not go in ${slot}.`,
        );
      }
    }
    if (item.unique) {
      if (seenUnique.has(item.id)) {
        fail(`${item.name} is unique and is already worn.`);
      }
      seenUnique.add(item.id);
    }
    if (entry.enchant != null && !tables.enchants.get(entry.enchant)) {
      fail(`${slot} enchant ${entry.enchant} is not in the rogue snapshot.`);
    }
    if (entry.suffix != null && !tables.suffixes.get(entry.suffix)) {
      fail(`${slot} suffix ${entry.suffix} is not in the snapshot.`);
    }
    worn.push({ slot, entry, item });
  }
  return worn;
}
