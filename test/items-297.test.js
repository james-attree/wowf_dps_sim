import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { k } from "../data/constants.js";
import {
  buildSnapshot,
  decodeSuffixes,
  parseLevelRatings,
  parseRogueBaseStats,
  rogueUsableItem,
  slimItem,
  snapshotFiles,
} from "../scripts/refresh-items.mjs";

const root = resolve(import.meta.dirname, "..");
const gearDir = resolve(root, "data", "items");
const fixtureDir = resolve(root, "test", "fixtures", "items");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function gear(name) {
  return readJson(resolve(gearDir, name));
}

const ITEM_SLOTS = new Set([
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
  "finger",
  "trinket",
  "weapon",
  "ranged",
]);
const STATS = new Set([
  "strength",
  "agility",
  "stamina",
  "attackPower",
  "hit",
  "crit",
  "haste",
  "expertise",
]);
const WEAPON_TYPES = new Set([
  "axe",
  "dagger",
  "fist",
  "mace",
  "sword",
  "bow",
  "crossbow",
  "gun",
  "thrown",
]);
const HANDS = new Set(["main", "one", "off"]);

describe("item snapshot schema (#297)", () => {
  const items = gear("rogue-items.json");
  const enchants = gear("enchants.json");
  const suffixes = gear("suffixes.json");
  const manifest = gear("manifest.json");

  it("ships the pinned rogue, enchant, and suffix counts", () => {
    assert.equal(items.length, k("items.rogueCount"));
    assert.equal(enchants.length, k("items.enchantCount"));
    assert.equal(suffixes.length, k("items.suffixCount"));
    assert.equal(manifest.counts.items, items.length);
    assert.equal(manifest.counts.enchants, enchants.length);
    assert.equal(manifest.counts.suffixes, suffixes.length);
  });

  it("gives every item the slim fields and no sockets", () => {
    for (const item of items) {
      assert.equal(typeof item.id, "number");
      assert.equal(typeof item.name, "string");
      assert.ok(ITEM_SLOTS.has(item.slot), item.name);
      assert.equal(typeof item.quality, "number");
      for (const key of Object.keys(item.stats ?? {})) {
        assert.ok(STATS.has(key), key);
      }
      if (item.weapon) {
        assert.ok(WEAPON_TYPES.has(item.weapon.type), item.name);
        if (item.weapon.hand !== undefined) {
          assert.ok(HANDS.has(item.weapon.hand), item.name);
        }
      }
      if (item.suffixes !== undefined) {
        assert.ok(decodeSuffixes(item.suffixes).length > 0);
      }
      for (const effect of item.effects ?? []) {
        assert.equal(typeof effect.name, "string");
        assert.ok(["proc", "use", "stackProc", "equip"].includes(effect.kind));
      }
      assert.equal(item.socket, undefined);
      assert.equal(item.gems, undefined);
      assert.equal(item.sockets, undefined);
    }
    assert.deepEqual(
      items.map((item) => item.id),
      [...items.map((item) => item.id)].sort((a, b) => a - b),
    );
  });

  it("gives every enchant and suffix a name and stats", () => {
    for (const enchant of enchants) {
      assert.equal(typeof enchant.effectId, "number");
      assert.equal(typeof enchant.name, "string");
      assert.ok(ITEM_SLOTS.has(enchant.slot), enchant.name);
      for (const key of Object.keys(enchant.stats ?? {})) {
        assert.ok(STATS.has(key), key);
      }
    }
    for (const suffix of suffixes) {
      assert.equal(typeof suffix.id, "number");
      assert.equal(typeof suffix.name, "string");
      for (const key of Object.keys(suffix.stats ?? {})) {
        assert.ok(STATS.has(key), key);
      }
    }
  });

  it("matches the upstream spot checks", () => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const hoj = byId.get(11815);
    assert.equal(hoj.name, "Hand of Justice");
    assert.equal(hoj.stats.attackPower, 12);
    const thunderfury = byId.get(19019);
    assert.equal(thunderfury.weapon.min, 44);
    assert.equal(thunderfury.weapon.max, 115);
    assert.equal(thunderfury.weapon.speed, 1.9);
    assert.equal(thunderfury.weapon.type, "sword");
    const deathsSting = byId.get(21126);
    assert.deepEqual(deathsSting.weaponSkills, { daggers: 3 });
    const mugger = byId.get(18505);
    assert.deepEqual(mugger.weaponSkills, { daggers: 1 });
    assert.equal(byId.has(14551), false);
  });

  it("records provenance on the manifest", () => {
    assert.equal(manifest.upstream, "https://github.com/wowsims/forever");
    assert.equal(manifest.commit, k("items.upstreamCommit"));
    assert.equal(manifest.date, "2026-11-15");
    assert.equal(manifest.clientBuild, k("items.clientBuild"));
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.level, k("items.v1Level"));
    assert.equal(manifest.baseStats.strength, 80);
    assert.equal(manifest.baseStats.agility, 130);
    assert.equal(manifest.baseStats.attackPower, 100);
    assert.equal(k("items.sockets"), false);
    assert.equal(k("items.ciFetches"), false);
  });
});

describe("item snapshot filter (#297)", () => {
  const db = readJson(resolve(fixtureDir, "db-slice.json"));
  const files = snapshotFiles(
    buildSnapshot(db, {
      commit: k("items.upstreamCommit"),
      date: "2026-11-15",
      clientBuild: k("items.clientBuild"),
      level: k("items.v1Level"),
      sources: ["assets/database/db.json"],
      baseStats: { strength: 80, agility: 130, attackPower: 100 },
      ratings: { hit: 10, crit: 14, haste: 10, expertise: 10 },
    }),
  );
  const items = JSON.parse(files["rogue-items.json"]);

  it("drops mail, plate, two-hand, polearm, staff, and the wrong class", () => {
    const ids = new Set(items.map((item) => item.id));
    for (const dropped of [
      14551, 7930, 647, 1726, 791, 4547, 1168, 1992, 16400,
    ]) {
      assert.equal(ids.has(dropped), false, String(dropped));
    }
    for (const kept of [11815, 19019, 21126, 18505, 2505, 7950]) {
      assert.equal(ids.has(kept), true, String(kept));
    }
    const edgemaster = db.items.find((item) => item.id === 14551);
    assert.equal(rogueUsableItem(edgemaster), false);
    assert.deepEqual(slimItem(edgemaster).weaponSkills, {
      axes: 1,
      swords: 1,
      daggers: 1,
    });
  });

  it("writes the same bytes when the pinned fixture is rebuilt", () => {
    const again = snapshotFiles(
      buildSnapshot(db, {
        commit: k("items.upstreamCommit"),
        date: "2026-11-15",
        clientBuild: k("items.clientBuild"),
        level: k("items.v1Level"),
        sources: ["assets/database/db.json"],
        baseStats: { strength: 80, agility: 130, attackPower: 100 },
        ratings: { hit: 10, crit: 14, haste: 10, expertise: 10 },
      }),
    );
    for (const name of Object.keys(files).sort()) {
      assert.equal(again[name], files[name], name);
      const expected = readFileSync(
        resolve(fixtureDir, "expected", name),
        "utf8",
      );
      assert.equal(files[name], expected, name);
    }
  });
});

describe("item snapshot size (#297)", () => {
  it("stays within 800 KB raw and 120 KB gzip-9", () => {
    const names = readdirSync(gearDir).sort();
    assert.deepEqual(names, [
      "enchants.json",
      "manifest.json",
      "rogue-items.json",
      "suffixes.json",
    ]);
    const parts = names.map((name) => readFileSync(resolve(gearDir, name)));
    const raw = parts.reduce((sum, part) => sum + part.length, 0);
    const gzip = gzipSync(Buffer.concat(parts), { level: 9 }).length;
    assert.ok(raw <= k("items.budget.raw"), `raw ${raw}`);
    assert.ok(gzip <= k("items.budget.gzip"), `gzip ${gzip}`);
  });

  it("is not fetched by CI", () => {
    const ci = readFileSync(
      resolve(root, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    assert.equal(ci.includes("refresh-items"), false);
    assert.equal(ci.includes("items:refresh"), false);
  });
});

describe("base stat parsers (#297)", () => {
  it("reads the rogue block and the level row", () => {
    const stats = parseRogueBaseStats(`
      proto.Class_ClassRogue: {
        stats.Health:      1523,
        stats.Agility:     130,
        stats.Strength:    80,
        stats.Intellect:   35,
        stats.Spirit:      50,
        stats.Stamina:     75,
        stats.AttackPower: 100,
      },
    `);
    assert.equal(stats.strength, 80);
    assert.equal(stats.agility, 130);
    assert.equal(stats.stamina, 75);
    const ratings = parseLevelRatings(
      "Level\tHit - Melee\tCrit - Melee\tHaste - Melee\tExpertise\n60\t10\t14\t10\t10\n",
      60,
    );
    assert.deepEqual(ratings, { hit: 10, crit: 14, haste: 10, expertise: 10 });
  });
});
