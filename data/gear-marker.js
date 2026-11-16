import p1 from "./gear/p1-bscombat.gear.json" with { type: "json" };

// The frozen wowsims Forever Backstab Combat list. An empty gear-part slot
// mask means this object, not whatever the page default happens to be.
// coordinator call 16 Nov (James delegated 15 Nov).
const SLOT_NAMES = [
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
];

function slotsOf(items) {
  const slots = {};
  items.forEach((entry, index) => {
    slots[SLOT_NAMES[index]] = {
      item: entry.id,
      enchant: entry.enchant ?? null,
      suffix: null,
    };
  });
  return Object.freeze(slots);
}

export const GEAR_MARKER_P1_BSCOMBAT_92E67A7A = Object.freeze({
  id: "p1_bscombat",
  commit: "92e67a7ae61f984e8a1fc006ebdeb012f31ac7d1",
  slots: slotsOf(p1.items),
});
