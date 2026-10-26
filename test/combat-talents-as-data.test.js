import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { createFight } from "../js/fight.js";
import { ModifierPipeline, expandRank } from "../js/modifiers.js";
import { talentCatalogue } from "../js/talents.js";

// A rank-table entry without the snapshot text and scale used to check it.
function withoutText(entry) {
  const rest = { ...entry };
  delete rest.text;
  delete rest.scale;
  return rest;
}

// A2's done-when: every DPS-relevant Combat talent is expressible as data, with
// no engine code. These tables are that proof. They live in the test, not in
// data/talent-effects.js: that file is D5 (#102), which also decides how talent
// ranks reach a fight. Here a table is a list of rank-table entries
// ({ kind, op, values, scope? }) that expandRank turns into modifiers, and each
// number is checked against the percentage or amount in the snapshot's own
// rank text, so a refreshed snapshot that changes a talent fails here.
//
// `text` reads the number out of a rank's text and `scale` turns it into the
// modifier's unit (a percentage into a fraction). The engine knows none of
// these ids: it asks the pipeline for a stat.

const PERCENT = 100;
const AMOUNT = 1;

const MODIFIER_TALENTS = {
  "combat.improved-eviscerate": [
    {
      kind: "damage",
      op: "add",
      values: [0.07, 0.13, 0.2],
      scope: { abilities: ["eviscerate"] },
      text: /Eviscerate ability by (\d+)%/,
      scale: PERCENT,
    },
  ],
  "combat.improved-sinister-strike": [
    {
      kind: "energyCost",
      op: "add",
      values: [-3, -5],
      scope: { abilities: ["sinister-strike"] },
      text: /Energy cost of your Sinister Strike ability by (\d+)/,
      scale: -AMOUNT,
    },
  ],
  "combat.puncturing-wounds": [
    {
      kind: "critChance",
      op: "add",
      values: [0.1, 0.2, 0.3],
      scope: { abilities: ["backstab"] },
      text: /of your Backstab by (\d+)%/,
      scale: PERCENT,
    },
    {
      kind: "critChance",
      op: "add",
      values: [0.05, 0.1, 0.15],
      scope: { abilities: ["mutilate"] },
      text: /your Mutilate by (\d+)%/,
      scale: PERCENT,
    },
    // The 15/30/45% chance of an extra combo point is a proc: A4 and D7.
  ],
  "combat.precision": [
    {
      kind: "hitChance",
      op: "add",
      values: [0.01, 0.02, 0.03],
      text: /chance to hit by (\d+)%/,
      scale: PERCENT,
    },
  ],
  "combat.flawless-execution": [
    {
      kind: "energyCost",
      op: "add",
      values: [-10],
      scope: { abilities: ["eviscerate"] },
      text: /Eviscerate ability by (\d+)/,
      scale: -AMOUNT,
    },
  ],
  "combat.dual-wield-specialization": [
    {
      kind: "damage",
      op: "add",
      values: [0.05, 0.1, 0.15, 0.2, 0.25],
      scope: { hands: ["offHand"] },
      text: /off-hand weapon by (\d+)%/,
      scale: PERCENT,
    },
  ],
  "combat.hack-and-slash": [
    {
      kind: "critChance",
      op: "add",
      values: [0.01, 0.02, 0.03, 0.04, 0.05],
      scope: { weaponTypes: ["dagger", "fist"] },
      text: /Dagger\/Fist:[\s\S]*?chance by (\d+)%/,
      scale: PERCENT,
    },
    {
      kind: "armorIgnore",
      op: "add",
      values: [0.03, 0.06, 0.09, 0.12, 0.15],
      scope: { weaponTypes: ["mace"] },
      text: /Mace:[\s\S]*?ignore (\d+)%/,
      scale: PERCENT,
    },
    // The axe and sword extra attack (1 to 5%) is a proc: A4 and D7.
  ],
  "combat.weapon-expertise": [
    {
      kind: "dodgeReduction",
      op: "add",
      values: [0.01, 0.02],
      text: /Dodged or Parried by (\d+)%/,
      scale: PERCENT,
    },
    {
      kind: "parryReduction",
      op: "add",
      values: [0.01, 0.02],
      text: /Dodged or Parried by (\d+)%/,
      scale: PERCENT,
    },
  ],
  "combat.aggression": [
    {
      kind: "damage",
      op: "add",
      values: [0.02, 0.04, 0.06],
      scope: { abilities: ["sinister-strike", "backstab", "eviscerate"] },
      text: /Eviscerate abilities by (\d+)%/,
      scale: PERCENT,
    },
  ],
};

// Active talents: the cast puts an aura up, and the aura holds the modifier.
const AURA_TALENTS = {
  "combat.blade-flurry": {
    aura: AURAS.bladeFlurry,
    kind: "haste",
    text: /attack speed by (\d+)%/,
    expected: (percent) => percent / PERCENT,
  },
  "combat.adrenaline-rush": {
    aura: AURAS.adrenalineRush,
    kind: "energyRegen",
    text: /regeneration rate by (\d+)%/,
    expected: (percent) => 1 + percent / PERCENT,
  },
};

// Not DPS: defence, utility, or a strike the simulator does not cast.
const NOT_DPS = {
  "combat.lightning-reflexes": "dodge chance: nothing attacks the rogue",
  "combat.deflection": "parry chance: nothing attacks the rogue",
  "combat.endurance": "Sprint and Evasion cooldowns: not simulated",
  "combat.riposte": "needs a parry; there is no incoming attack",
  "combat.improved-sprint": "movement: not simulated",
  "combat.improved-kick": "interrupts: not simulated",
};

const COMBAT = talentCatalogue.byTree("combat");

function readNumber(entry, text) {
  const found = entry.text.exec(text);
  assert.ok(found, `${entry.text} finds nothing in ${JSON.stringify(text)}`);
  return Number(found[1]) / entry.scale;
}

function buildModifiers(ranks) {
  return Object.entries(MODIFIER_TALENTS).flatMap(([id, entries]) =>
    expandRank(
      entries.map((entry) => withoutText(entry)),
      ranks(talentCatalogue.get(id)),
      id,
    ),
  );
}

describe("every Combat talent has a place", () => {
  it("is a modifier table, an aura, or not DPS, and only one of them", () => {
    const groups = [MODIFIER_TALENTS, AURA_TALENTS, NOT_DPS];
    const named = groups.flatMap((group) => Object.keys(group));
    assert.equal(
      new Set(named).size,
      named.length,
      "a talent is in two groups",
    );
    assert.deepEqual(named.sort(), COMBAT.map((talent) => talent.id).sort());
    assert.equal(COMBAT.length, 17);
    assert.equal(
      Object.keys(MODIFIER_TALENTS).length + Object.keys(AURA_TALENTS).length,
      11,
      "11 of 17 are DPS-relevant",
    );
  });
});

describe("the Combat modifier tables match the snapshot's rank text", () => {
  for (const [id, entries] of Object.entries(MODIFIER_TALENTS)) {
    it(`${id}`, () => {
      const talent = talentCatalogue.get(id);
      for (const entry of entries) {
        assert.equal(entry.values.length, talent.max, "one value per rank");
        entry.values.forEach((value, index) => {
          assert.equal(
            value,
            readNumber(entry, talent.ranks[index]),
            `${id} rank ${index + 1}`,
          );
        });
      }
    });
  }

  for (const [id, entry] of Object.entries(AURA_TALENTS)) {
    it(`${id} is held by its aura`, () => {
      const [rank] = talentCatalogue.get(id).ranks;
      const found = entry.text.exec(rank);
      assert.ok(found, rank);
      const modifier = entry.aura.modifiers.find((m) => m.kind === entry.kind);
      assert.ok(modifier, `${entry.aura.id} has no ${entry.kind} modifier`);
      assert.equal(modifier.value, entry.expected(Number(found[1])));
    });
  }
});

describe("a Combat build, as data, in the engine", () => {
  const maxRanks = (talent) => talent.max;
  const noRanks = () => 0;

  it("expands every table at every rank, and rank 0 to nothing", () => {
    for (const [id, entries] of Object.entries(MODIFIER_TALENTS)) {
      const { max } = talentCatalogue.get(id);
      const table = entries.map((entry) => withoutText(entry));
      assert.deepEqual(expandRank(table, 0, id), []);
      for (let rank = 1; rank <= max; rank += 1) {
        assert.equal(expandRank(table, rank, id).length, entries.length);
      }
    }
    assert.deepEqual(buildModifiers(noRanks), []);
  });

  it("gives each stat its talent bonus for the attack that earns it", () => {
    const stats = new ModifierPipeline(buildModifiers(maxRanks));
    const at = (ability, hand = "mainHand", weaponType = "dagger") => ({
      ability,
      hand,
      weaponType,
    });
    // Precision 3: an unscoped hit bonus.
    assert.equal(stats.resolve("hitChance", 0, at("backstab")), 0.03);
    // Puncturing Wounds 3 and Hack and Slash 5 (dagger) on a Backstab.
    assert.equal(stats.resolve("critChance", 0, at("backstab")), 0.3 + 0.05);
    assert.equal(stats.resolve("critChance", 0, at("sinister-strike")), 0.05);
    assert.equal(
      stats.resolve(
        "critChance",
        0,
        at("sinister-strike", "mainHand", "sword"),
      ),
      0,
    );
    assert.equal(
      stats.resolve(
        "armorIgnore",
        0,
        at("sinister-strike", "mainHand", "mace"),
      ),
      0.15,
    );
    assert.equal(stats.resolve("armorIgnore", 0, at("backstab")), 0);
    // Improved Eviscerate 3 and Aggression 3 add inside one factor.
    assert.equal(
      stats.resolve("damage", 100, at("eviscerate")),
      100 * (1 + (0.2 + 0.06)),
    );
    assert.equal(stats.resolve("damage", 100, at("rupture")), 100);
    // Dual Wield Specialization 5 on the off-hand's swing only.
    assert.equal(stats.resolve("damage", 100, at("off-hand", "offHand")), 125);
    assert.equal(stats.resolve("damage", 100, at("main-hand")), 100);
    assert.equal(
      stats.resolve("energyCost", 40, { ability: "sinister-strike" }),
      35,
    );
    assert.equal(
      stats.resolve("energyCost", 35, { ability: "eviscerate" }),
      25,
    );
    assert.equal(stats.resolve("dodgeReduction", 0, at("backstab")), 0.02);
    assert.equal(stats.resolve("parryReduction", 0, at("backstab")), 0.02);
  });

  it("runs a whole fight with the full build and no extra random draws", () => {
    const draws = (modifiers) => {
      const fight = createFight(5, undefined, { modifiers });
      let count = 0;
      const rng = fight.simulation.rng;
      fight.simulation.rng = () => {
        count += 1;
        return rng();
      };
      fight.simulation.run(30);
      return { count, damage: fight.simulation.damageDone };
    };
    const plain = draws(undefined);
    const full = draws(buildModifiers(maxRanks));
    assert.ok(full.damage > plain.damage);
    // Every roll in this fight is a swing or a skill's own roll. A talent only
    // moves the thresholds, so the number of rolls follows from the timeline.
    // (It can differ if a faster rotation fits in more casts, so compare a
    // build that changes numbers and not the timeline.)
    const numbersOnly = draws(
      buildModifiers(maxRanks).filter(
        (m) => m.kind !== "energyCost" && m.kind !== "hitChance",
      ),
    );
    assert.equal(numbersOnly.count, plain.count);
  });

  it("is a rank-0 build that draws nothing and changes nothing", () => {
    const run = (modifiers) => {
      const fight = createFight(5, undefined, { modifiers });
      let count = 0;
      const rng = fight.simulation.rng;
      fight.simulation.rng = () => {
        count += 1;
        return rng();
      };
      fight.simulation.run(30);
      return {
        count,
        damage: fight.simulation.damageDone,
        log: fight.simulation.combatLog.map((event) => ({ ...event })),
      };
    };
    assert.deepEqual(run(buildModifiers(noRanks)), run(undefined));
  });
});

describe("Blade Flurry and Adrenaline Rush are the same data a talent would be", () => {
  it("reads the constants, as the aura definitions did before the pipeline", () => {
    assert.equal(
      AURAS.bladeFlurry.modifiers.find((m) => m.kind === "haste").value,
      k("bladeFlurry").haste,
    );
    assert.equal(
      AURAS.adrenalineRush.modifiers.find((m) => m.kind === "energyRegen")
        .value,
      k("adrenalineRush").regenMultiplier,
    );
  });
});
