import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { SET_BONUSES } from "../data/set-bonuses.js";
import { deriveSheet } from "../js/gear-derive.js";
import { hashText, manifestSelfText } from "../scripts/refresh-items.mjs";

const root = resolve(import.meta.dirname, "..");
const gearDir = resolve(root, "data", "items");

function loadTables() {
  return {
    items: JSON.parse(readFileSync(join(gearDir, "rogue-items.json"), "utf8")),
    enchants: JSON.parse(readFileSync(join(gearDir, "enchants.json"), "utf8")),
    suffixes: JSON.parse(readFileSync(join(gearDir, "suffixes.json"), "utf8")),
  };
}

const tables = loadTables();
const human = { race: "human", level: 60 };

function sheet(slots, character = human, source = tables) {
  return deriveSheet({ slots }, character, source);
}

describe("level-60 rogue base stats (#297)", () => {
  const offsets = {
    human: { strength: 0, agility: 0, stamina: 0, intellect: 0, spirit: 0 },
    orc: { strength: 3, agility: -3, stamina: 2, intellect: -3, spirit: 3 },
    dwarf: { strength: 2, agility: -4, stamina: 3, intellect: -1, spirit: -1 },
    "night-elf": {
      strength: -3,
      agility: 5,
      stamina: -1,
      intellect: 0,
      spirit: 0,
    },
    undead: { strength: -1, agility: -2, stamina: 1, intellect: -2, spirit: 5 },
    gnome: { strength: -5, agility: 3, stamina: -1, intellect: 3, spirit: 0 },
    troll: { strength: 1, agility: 2, stamina: 1, intellect: -4, spirit: 1 },
    "skyborne-high-order": {
      strength: -3,
      agility: 4,
      stamina: -1,
      intellect: 4,
      spirit: -3,
    },
    "skyborne-windshaper": {
      strength: -4,
      agility: 3,
      stamina: 0,
      intellect: -1,
      spirit: 3,
    },
  };

  it("matches the pinned race offsets and a naked human sheet", () => {
    for (const [race, offset] of Object.entries(offsets)) {
      assert.deepEqual(k(`sheet.raceOffset.${race}`), offset, race);
      const derived = sheet({}, { race, level: 60 });
      const base = k("sheet.classBase");
      assert.equal(derived.breakdown.strength, base.strength + offset.strength);
      assert.equal(derived.breakdown.agility, base.agility + offset.agility);
    }
    const naked = sheet({});
    assert.equal(naked.character.attackPower, 310);
    assert.equal(naked.character.critChance, 0.04485);
    assert.equal(naked.character.bonusHitChance, 0);
    assert.equal(naked.character.haste, 0);
    assert.equal(naked.breakdown.dodgeChance, 0.0897);
    assert.equal(naked.weapons.mainHand, null);
    assert.equal(naked.weapons.offHand, null);
  });
});

describe("deriveSheet (#297)", () => {
  it("adds a known item, an enchant, a suffix, and a weapon-damage enchant", () => {
    const hoj = sheet({ trinket1: { item: 11815 } });
    assert.equal(hoj.character.attackPower, 322);
    assert.deepEqual(hoj.notModelled, [
      {
        slot: "trinket1",
        name: "Hand of Justice (15600)",
        kind: "proc",
        reason: "not modelled",
      },
    ]);

    const agility = sheet({
      head: { item: 11735, enchant: 1508 },
    });
    assert.equal(agility.breakdown.strength, 80 + 6);
    assert.equal(agility.breakdown.agility, 130 + 8);
    assert.equal(agility.character.attackPower, 310 + 6 + 8);

    const band = sheet({ finger1: { item: 12926, suffix: 13200 } });
    assert.equal(band.breakdown.stamina, 75 + 6);

    const striking = sheet({
      mainHand: { item: 19019, enchant: 943 },
    });
    assert.deepEqual(striking.weapons.mainHand, {
      min: 47,
      max: 118,
      speed: 1.9,
      type: "sword",
      weaponSkill: 300,
    });
    assert.equal(striking.weapons.offHand, null);
  });

  it("applies set bonuses only at the piece threshold, including weapon skill", () => {
    const one = sheet({ legs: { item: 15062 } });
    assert.equal(one.character.bonusHitChance, 0);
    const two = sheet({ legs: { item: 15062 }, hands: { item: 15063 } });
    assert.equal(two.character.bonusHitChance, 0.02);

    const gloves = sheet({ hands: { item: 21278 } });
    assert.equal(gloves.character.attackPower, 310);
    const deaths = sheet({ mainHand: { item: 21126 } });
    assert.equal(deaths.weapons.mainHand.weaponSkill, 303);
    assert.equal(deaths.weapons.mainHand.type, "dagger");

    const piece = (id, slot) => ({
      id,
      name: `Defias ${slot}`,
      slot,
      quality: 2,
      setId: 161,
    });
    const dagger = {
      id: 1,
      name: "Defias dagger",
      slot: "weapon",
      quality: 2,
      setId: 161,
      weapon: { min: 10, max: 20, speed: 1.8, type: "dagger", hand: "one" },
    };
    const defias = sheet(
      {
        chest: { item: 2 },
        hands: { item: 3 },
        waist: { item: 4 },
        legs: { item: 5 },
        mainHand: { item: 1 },
      },
      human,
      {
        items: [
          dagger,
          piece(2, "chest"),
          piece(3, "hands"),
          piece(4, "waist"),
          piece(5, "legs"),
        ],
        enchants: [],
        suffixes: [],
      },
    );
    assert.equal(defias.weapons.mainHand.weaponSkill, 301);
    const four = sheet(
      {
        chest: { item: 2 },
        hands: { item: 3 },
        waist: { item: 4 },
        mainHand: { item: 1 },
      },
      human,
      {
        items: [
          dagger,
          piece(2, "chest"),
          piece(3, "hands"),
          piece(4, "waist"),
        ],
        enchants: [],
        suffixes: [],
      },
    );
    assert.equal(four.weapons.mainHand.weaponSkill, 300);
    assert.ok(four.notModelled.some((row) => row.kind === "damage"));
  });

  it("rejects a bad slot, a repeated unique, and a level other than 60", () => {
    assert.throws(
      () => sheet({ feet: { item: 11735 } }),
      /does not go in feet/,
    );
    assert.throws(
      () => sheet({ trinket1: { item: 11815 }, trinket2: { item: 11815 } }),
      /unique/,
    );
    assert.throws(() => sheet({}, { race: "human", level: 59 }), /level 60/);
  });

  it("is pure and deterministic", () => {
    const build = { slots: { trinket1: { item: 11815 } } };
    const character = { race: "night-elf", level: 60 };
    const frozenTables = {
      items: tables.items,
      enchants: tables.enchants,
      suffixes: tables.suffixes,
    };
    const first = deriveSheet(build, character, frozenTables);
    const second = deriveSheet(build, character, frozenTables);
    assert.deepEqual(first, second);
    assert.equal(build.slots.trinket1.item, 11815);
    assert.equal(character.race, "night-elf");
  });

  it("derives the wowsims Forever P1 combat build to the hand-checked sheet", () => {
    const ids = [
      11735, 22150, 272105, 21187, 13944, 22204, 21278, 272395, 15062, 18506,
      19325, 21189, 272437, 19120, 19324, 17016, 22347,
    ];
    const enchants = [
      1508,
      null,
      null,
      7667,
      7645,
      7656,
      8206,
      null,
      1508,
      911,
      null,
      null,
      null,
      null,
      1900,
      2564,
      null,
    ];
    const names = [
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
    const slots = {};
    ids.forEach((item, index) => {
      slots[names[index]] = { item };
      if (enchants[index] != null) {
        slots[names[index]].enchant = enchants[index];
      }
    });
    const derived = sheet(slots);
    assert.equal(derived.character.attackPower, 608);
    assert.equal(derived.character.critChance, 0.179705);
    assert.equal(derived.character.bonusHitChance, 0.087);
    assert.equal(derived.character.haste, 0);
    assert.equal(derived.breakdown.strength, 121);
    assert.equal(derived.breakdown.agility, 289);
    assert.equal(derived.breakdown.stamina, 180);
    assert.deepEqual(derived.weapons.mainHand, {
      min: 54,
      max: 102,
      speed: 1.8,
      type: "dagger",
      weaponSkill: 300,
    });
    assert.deepEqual(derived.weapons.offHand, {
      min: 71,
      max: 134,
      speed: 2.4,
      type: "axe",
      weaponSkill: 300,
    });
    assert.ok(
      derived.notModelled.some(
        (row) => row.name === "Enchant Weapon - Crusader",
      ),
    );
  });
});

describe("set bonus comments (#297)", () => {
  it("keeps each modelled value in the cited comment", () => {
    const source = readFileSync(
      resolve(root, "data", "set-bonuses.js"),
      "utf8",
    );
    for (const set of SET_BONUSES) {
      assert.ok(source.includes(set.source), set.name);
      for (const bonus of set.bonuses) {
        assert.ok(source.includes(bonus.comment), bonus.comment);
        const stat = Object.values(bonus.stats ?? {})[0];
        if (stat != null) {
          assert.ok(bonus.comment.includes(String(stat)), bonus.comment);
        }
      }
    }
  });
});

describe("item manifest hashes (#297)", () => {
  it("matches the committed files, and a mutated file does not", () => {
    const manifest = JSON.parse(
      readFileSync(join(gearDir, "manifest.json"), "utf8"),
    );
    for (const name of ["rogue-items.json", "enchants.json", "suffixes.json"]) {
      const text = readFileSync(join(gearDir, name), "utf8");
      assert.equal(hashText(text), manifest.files[name].sha256, name);
      assert.equal(JSON.parse(text).length, manifest.files[name].count, name);
    }
    assert.equal(
      hashText(manifestSelfText(manifest)),
      manifest.files["manifest.json"].sha256,
    );
    const mutated = `${readFileSync(join(gearDir, "rogue-items.json"), "utf8")} `;
    assert.notEqual(
      hashText(mutated),
      manifest.files["rogue-items.json"].sha256,
    );
    const dir = mkdtempSync(join(tmpdir(), "gear-"));
    for (const name of readdirSync(gearDir)) {
      writeFileSync(join(dir, name), readFileSync(join(gearDir, name)));
    }
    const copy = readFileSync(join(dir, "enchants.json"), "utf8").replace(
      "Light",
      "Night",
    );
    writeFileSync(join(dir, "enchants.json"), copy);
    const copiedManifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    assert.notEqual(
      hashText(copy),
      copiedManifest.files["enchants.json"].sha256,
    );
  });
});
