import assert from "node:assert/strict";
import { describe, it } from "node:test";
import enchants from "../data/items/enchants.json" with { type: "json" };
import items from "../data/items/rogue-items.json" with { type: "json" };
import suffixes from "../data/items/suffixes.json" with { type: "json" };
import {
  CLASSIC_NOTE,
  CONFLICT_COPY,
  LEAVE_EMPTY,
  SEARCH_HINT,
  enchantFitsSlot,
  enchantsForSlot,
  indexTables,
  itemFitsSlot,
  itemInitials,
  matchStatus,
  noResultStatus,
  normalizeSearch,
  qualityName,
  searchSlotItems,
  slotConflict,
  suffixesForItem,
  uniqueTakenIds,
} from "../js/gear-search.js";

const tables = indexTables({ items, enchants, suffixes });
const SEARCH_START = 2;
const RESULT_CAP = 20;
const search = (query, slot, slots = {}) =>
  searchSlotItems(query, slot, tables, slots, SEARCH_START, RESULT_CAP);

function itemNamed(name) {
  for (const item of tables.items.values()) {
    if (item.name === name) {
      return item;
    }
  }
  throw new Error(`missing ${name}`);
}

describe("gear search helpers (#384)", () => {
  it("names the lookalike qualities, never the canonical rare or epic hex", () => {
    // Mutant M1: quality 3 or 4 maps to the wrong word, or #0070dd / #a335ee
    // sneak back in as the name.
    assert.equal(qualityName(0), "Poor");
    assert.equal(qualityName(1), "Common");
    assert.equal(qualityName(2), "Uncommon");
    assert.equal(qualityName(3), "Rare");
    assert.equal(qualityName(4), "Epic");
    assert.equal(qualityName(5), "Legendary");
    assert.equal(qualityName(6), "Artifact");
    assert.equal(qualityName(7), "Heirloom");
    assert.equal(qualityName(3) === "#0070dd", false);
    assert.equal(qualityName(4) === "#a335ee", false);
  });

  it("builds initials from letters, skipping apostrophes (M2)", () => {
    // Mutant M2: apostrophes kept, or a one-word name uses only its first
    // letter, or the third word is preferred over the second.
    assert.equal(itemInitials("Earthstrike"), "EA");
    assert.equal(itemInitials("The Lobotomizer"), "TL");
    assert.equal(itemInitials("Don Julio's Band"), "DJ");
    assert.equal(itemInitials("Smotts' Compass"), "SC");
    assert.equal(itemInitials("Fahrad's Reloading Repeater"), "FR");
  });

  it("normalises case, accents and apostrophes (M3)", () => {
    // Mutant M3: apostrophes stay, so "viskag" misses Vis'kag, or accents
    // are compared in NFD form.
    assert.equal(normalizeSearch("Vis'kag"), "viskag");
    assert.equal(normalizeSearch("VISKAG"), "viskag");
    assert.equal(normalizeSearch("Smotts' Compass"), "smotts compass");
    assert.equal(normalizeSearch("Café"), "cafe");
    assert.ok(normalizeSearch("Shadowcraft").includes(normalizeSearch("shad")));
  });

  it("does not search until two characters, then matches Smotts' Compass (M4)", () => {
    // Mutant M4: SEARCH_START is 1 or 3. "s" would then list items, or
    // "sm" would not.
    assert.equal(SEARCH_START, 2);
    const empty = search("s", "trinket1");
    assert.equal(empty.started, false);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.status, SEARCH_HINT);
    const hits = search("sm", "trinket1");
    assert.equal(hits.started, true);
    assert.ok(
      hits.items.some((item) => item.name === "Smotts' Compass"),
      "sm matches Smotts' Compass",
    );
  });

  it("caps the list at 20 and says to refine the search (M5)", () => {
    // Mutant M5: the cap is raised or dropped, so a short query returns
    // more than 20 rows, or the refine note is omitted when it should show.
    const hits = search("of", "finger1");
    assert.ok(
      hits.total > RESULT_CAP,
      "the snapshot has more than 20 'of' rings",
    );
    assert.equal(hits.items.length, RESULT_CAP);
    assert.equal(hits.capped, true);
    assert.equal(hits.status, matchStatus(hits.total, true));
    assert.match(hits.status, /Refine your search if you do not see the item/);
  });

  it("filters to the slot and to legal hand types (M6)", () => {
    // Mutant M6: a chest query returns a weapon, or an off-hand-only
    // weapon is offered for the main hand.
    const chest = search("shad", "chest");
    assert.ok(chest.items.length > 0);
    for (const item of chest.items) {
      assert.equal(item.slot, "chest");
    }
    const offOnly = [...tables.items.values()].filter(
      (item) => item.weapon?.hand === "off",
    );
    assert.ok(offOnly.length > 0, "the snapshot has off-hand-only weapons");
    for (const item of offOnly) {
      assert.equal(itemFitsSlot(item, "mainHand"), false, item.name);
      assert.equal(itemFitsSlot(item, "offHand"), true, item.name);
    }
    const mainOnly = [...tables.items.values()].filter(
      (item) => item.weapon?.hand === "main",
    );
    assert.ok(mainOnly.length > 0);
    for (const item of mainOnly) {
      assert.equal(itemFitsSlot(item, "offHand"), false, item.name);
      assert.equal(itemFitsSlot(item, "mainHand"), true, item.name);
    }
    const lobo = itemNamed("The Lobotomizer");
    assert.equal(itemFitsSlot(lobo, "mainHand"), true);
    assert.equal(itemFitsSlot(lobo, "offHand"), true);
    assert.equal(itemFitsSlot(lobo, "ranged"), false);
  });

  it("omits a unique item already worn in the other slot (M7)", () => {
    // Mutant M7: uniqueTakenIds does not skip the other finger, so Don
    // Julio's Band can be offered twice.
    const band = itemNamed("Don Julio's Band");
    assert.equal(band.unique, true);
    const worn = { finger1: { item: band.id, enchant: null, suffix: null } };
    const taken = uniqueTakenIds(worn, "finger2");
    assert.ok(taken.has(band.id));
    const hits = search("don jul", "finger2", worn);
    assert.equal(
      hits.items.some((item) => item.id === band.id),
      false,
    );
    const sameSlot = search("don jul", "finger1", worn);
    assert.ok(sameSlot.items.some((item) => item.id === band.id));
  });

  it("keeps Leave empty out of the hit list and names a miss (M8)", () => {
    // Mutant M8: a miss drops the classic-items note, or Leave empty is
    // pushed into the item array so the cap is 19 real hits.
    const miss = search("viskag", "feet");
    assert.deepEqual(miss.items, []);
    assert.equal(miss.status, noResultStatus("feet", "viskag"));
    assert.match(miss.status, /No feet items match “viskag”/);
    assert.ok(miss.status.includes(CLASSIC_NOTE));
    assert.equal(miss.items.includes(LEAVE_EMPTY), false);
  });

  it("flags an item that cannot be worn in that slot (M9)", () => {
    // Mutant M9: a weapon left in the head slot after a data refresh is
    // silently dropped instead of “Can't be worn here”.
    const lobo = itemNamed("The Lobotomizer");
    const slots = { head: { item: lobo.id, enchant: null, suffix: null } };
    const conflict = slotConflict("head", slots.head, tables, slots);
    assert.deepEqual(conflict, {
      name: "The Lobotomizer",
      reason: CONFLICT_COPY,
    });
    assert.equal(slotConflict("head", null, tables, {}), null);
  });

  it("lists enchants for the slot and suffixes only when the item has them (M10)", () => {
    // Mutant M10: a chest enchant is offered on a ring, or a fixed-name
    // item is treated as if it had suffixes.
    const chest = enchantsForSlot("chest", tables);
    assert.ok(chest.length > 0);
    assert.ok(chest.every((enchant) => enchantFitsSlot(enchant, "chest")));
    const finger = enchantsForSlot("finger1", tables);
    for (const enchant of finger) {
      assert.ok(enchantFitsSlot(enchant, "finger1"));
    }
    const lobo = itemNamed("The Lobotomizer");
    assert.deepEqual(suffixesForItem(lobo, tables), []);
    const ring = [...tables.items.values()].find(
      (item) => item.slot === "finger" && item.suffixes,
    );
    assert.ok(ring, "a suffix ring exists");
    const options = suffixesForItem(ring, tables);
    assert.ok(options.length > 0);
    assert.ok(options.every((suffix) => suffix.name));
  });
});
