import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { snapshot } from "../js/snapshot.js";
import { spellMissChance } from "../js/attack-resolver.js";
import { createFight } from "../js/fight.js";
import { ModifierPipeline } from "../js/modifiers.js";
import { raceCatalogue } from "../js/racials.js";
import { RESOURCE_DEFINITIONS } from "../js/resource-data.js";
import { Resource, resolveCap } from "../js/resource.js";
import { Rogue } from "../js/rogue.js";
import { normalizeConfig } from "../js/sim-config.js";

// #277 QA follow-ups (Kira's notes on #313, rulings relayed by Scout,
// 2 Nov 2026): N1 Artisan's Precision on poison (spell) hit, N2 a Gnome starts
// at 100 energy, N4 the cap rounding tolerance, N5 the race allow-list.

const ENERGY = RESOURCE_DEFINITIONS.find(({ id }) => id === "energy");
const SPELL_HIT = k("racial.artisansPrecision.spellHitChance");
const { chance: SPELL_MISS } = k("spell.missTarget");
// A roll between the Dwarf's spell miss chance and everyone else's: a resist
// without the racial, a hit with it.
const BETWEEN = SPELL_MISS - SPELL_HIT / 2;
const BELOW = SPELL_MISS - SPELL_HIT * 2;

function procFight(race) {
  const fight = createFight(1, race === null ? {} : { race });
  let draws = 0;
  return {
    fight,
    use(value) {
      fight.simulation.rng = () => {
        draws += 1;
        return value;
      };
    },
    get draws() {
      return draws;
    },
  };
}

const PROC = Object.freeze({
  id: "qa-poison",
  name: "QA Poison",
  min: 10,
  max: 10,
  spellHit: true,
  canCrit: false,
});
const DOT = Object.freeze({
  id: "qa-dot",
  name: "QA DoT",
  tickDamage: 1,
  interval: 3,
  duration: 12,
  spellHit: true,
});

describe("N1: Artisan's Precision also adds to poison (spell) hit (#277, assumption)", () => {
  it("is the export's 1%, an assumption row, and a no-scope modifier kind", () => {
    assert.equal(SPELL_HIT, k("racial.artisansPrecision.hitChance"));
    assert.equal(k("modifiers.stacking").spellHitChance, "flat");
    const dwarf = new Rogue({ race: "dwarf" });
    assert.equal(dwarf.getBonusSpellHitChance(), SPELL_HIT);
    assert.equal(new Rogue({}).getBonusSpellHitChance(), 0);
    for (const race of raceCatalogue.ids.filter((id) => id !== "dwarf")) {
      assert.equal(new Rogue({ race }).getBonusSpellHitChance(), 0, race);
    }
  });

  it("melee hit (talents, entered hit) still does not reduce poison misses", () => {
    const rogue = new Rogue({ character: { bonusHitChance: 0.05 } });
    assert.equal(rogue.getBonusSpellHitChance(), 0);
    assert.ok(rogue.getBonusHitChance({}) > 0);
    assert.equal(spellMissChance(SPELL_HIT), SPELL_MISS - SPELL_HIT);
  });

  it("a Dwarf's poison hit lands on a roll that resists for anyone else, with one draw", () => {
    for (const [race, landed] of [
      [null, false],
      ["human", false],
      ["dwarf", true],
    ]) {
      const h = procFight(race);
      h.use(BETWEEN);
      const hit = h.fight.simulation.resolveProcDamage(PROC);
      assert.equal(hit.landed, landed, String(race));
      // Spell roll, then the damage roll is skipped (min = max).
      assert.equal(h.draws, 1, String(race));
    }
  });

  it("a poison DoT application uses the same bonus", () => {
    for (const [race, landed] of [
      [null, false],
      ["dwarf", true],
    ]) {
      const h = procFight(race);
      h.use(BETWEEN);
      h.fight.simulation.resolveProcDot(DOT);
      assert.equal(
        Object.hasOwn(h.fight.simulation.activeDots, DOT.id),
        landed,
        String(race),
      );
      assert.equal(h.draws, 1);
    }
  });

  it("a roll under both chances is a resist for a Dwarf too", () => {
    const h = procFight("dwarf");
    h.use(BELOW);
    assert.equal(h.fight.simulation.resolveProcDamage(PROC).landed, false);
  });
});

describe("N2: a Gnome starts at 100 energy, not at its cap (#277)", () => {
  it("starts at start.state's energy below the 105 cap", () => {
    const gnome = new Rogue({ race: "gnome" });
    assert.equal(gnome.resources.energy.value, k("start.state").energy);
    assert.ok(gnome.resources.energy.max > k("start.state").energy);
  });
});

describe("N4: the cap rounding tolerance (#277)", () => {
  const none = new ModifierPipeline([]);
  it("rounds a cap a hair under a whole number up to it", () => {
    const hair = 104.99999999999999;
    assert.ok(hair < 105);
    assert.equal(resolveCap(ENERGY, none, hair), 105);
    const energy = new Resource(ENERGY, none);
    energy.baseMax = hair;
    assert.equal(energy.max, 105);
  });

  it("still rounds down anything further below than the tolerance", () => {
    const tolerance = k("resource.maxRoundingTolerance");
    assert.equal(resolveCap(ENERGY, none, 105 - tolerance * 10), 104);
    assert.equal(resolveCap(ENERGY, none, 115.5), 115);
  });
});

describe("N5: config.race accepts exactly the race catalogue (#277)", () => {
  const ids = raceCatalogue.ids;
  it("lists the catalogue in its message", () => {
    assert.throws(
      () => normalizeConfig({ race: "pandaren" }),
      (error) =>
        error instanceof RangeError &&
        error.message.includes(`Use one of: ${ids.join(", ")}, or null`),
    );
  });

  it("refuses every near miss: parts, names, case, and other classes' races", () => {
    const near = new Set();
    for (const id of ids) {
      for (const part of id.split("-")) near.add(part);
      near.add(id.toUpperCase());
      near.add(`${id} `);
      near.add(id.replace(/-/g, " "));
      near.add(id.replace(/-/g, ""));
    }
    for (const faction of Object.values(snapshot.races ?? {})) {
      for (const race of Array.isArray(faction) ? faction : []) {
        const name = Array.isArray(race) ? race[0] : race?.name;
        if (typeof name === "string") near.add(name);
      }
    }
    for (const value of near) {
      if (ids.includes(value)) continue;
      assert.throws(() => normalizeConfig({ race: value }), RangeError, value);
    }
    for (const id of ids) {
      assert.equal(normalizeConfig({ race: id }).race, id);
    }
  });
});
