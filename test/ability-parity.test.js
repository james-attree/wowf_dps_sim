import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRng } from "../js/rng.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { Ability, createAbilities } from "../js/ability.js";
import { abilityCatalogue } from "../js/abilities.js";
import { k } from "../data/constants.js";
import { runOnCore } from "../js/core/fight.js";
import { legacyAbilities } from "./legacy-skills.js";

// Issue #98. The generic executor (js/ability.js) must do what the skill
// classes did: the same totals, the same log, and the same random numbers in
// the same order. test/legacy-skills.js is the old code, kept as the
// reference. Each case runs one fight with the old abilities and one with the
// new, on the same seed, and compares everything a fight produces.

const DURATION = 120;
const SEEDS = [1, 7, 42, 2024];
const DAGGERS = {
  weapons: { mainHand: { type: "dagger" }, offHand: { type: "dagger" } },
};

// Every ability, in a changing order, so each one is cast at many combo point
// counts, energy levels, cooldown states and GCD states. The order comes from
// a small generator of its own, so it never touches the fight's rng. Energy is
// topped up every few steps, so the expensive finishers get their turn.
const TOP_UP_EVERY = 6;
const ORDER_MULTIPLIER = 1103515245;
const ORDER_INCREMENT = 12345;
const ORDER_MODULUS = 2 ** 31;

// The every-ability fights' rotation: at each POLL-grid time (the event
// core's decision at 0 and a poll every POLL after), once per time, top up
// the energy every few grid steps and cast every ability in the order's next
// shuffle. The swings are the core's own events, as in any fight.
const POLL = 1 / 64;

function castEverything(rogue, simulation, order) {
  const time = simulation.currentTime;
  const step = Math.round(time / POLL);
  if (Math.abs(time - step * POLL) > 1e-9 || order.last === step) {
    return { casts: [], outcome: "none" };
  }
  order.last = step;
  const missing = rogue.maxEnergy - rogue.energy;
  if (step % TOP_UP_EVERY === 0 && missing > 0) {
    // The core's pool takes a gain, not a write.
    rogue.resources.energy.gain(missing);
  }
  const queue = Object.values(rogue.abilities);
  while (queue.length > 0) {
    order.state =
      (order.state * ORDER_MULTIPLIER + ORDER_INCREMENT) % ORDER_MODULUS;
    const [skill] = queue.splice(order.state % queue.length, 1);
    skill.cast(rogue, simulation);
  }
  return { casts: [], outcome: "none" };
}

function fight({ seed, config, options, everything }) {
  const rogue = new Rogue(config, options);
  const draws = [];
  const source = createRng(seed);
  const rng = () => {
    const value = source();
    draws.push(value);
    return value;
  };
  const simulation = new Simulation(rogue, { rng });
  if (everything) {
    const order = { state: seed, last: null };
    rogue.castRotation = (sim) => castEverything(rogue, sim, order);
    runOnCore(simulation, DURATION, { pollEvery: POLL });
    simulation.end();
  } else {
    simulation.run(DURATION);
  }
  return {
    draws,
    damage: simulation.damageDone,
    breakdown: simulation.abilityBreakdown(),
    stats: simulation.abilityStats,
    log: simulation.combatLog,
    buffs: simulation.activeBuffs,
    debuffs: simulation.activeDebuffs,
    dots: simulation.activeDots,
    cooldowns: simulation.cooldowns,
    energy: rogue.energy,
    comboPoints: rogue.comboPoints,
    premeditation: [rogue.premeditationCp, rogue.premeditationCpRemaining],
  };
}

const CASES = [
  { name: "the placeholder rotation", config: undefined },
  { name: "the placeholder rotation with daggers", config: DAGGERS },
  {
    name: "the placeholder rotation with stats",
    config: {
      character: { attackPower: 1200, critChance: 0.3, bonusHitChance: 0.05 },
    },
  },
  { name: "every ability, every step", config: undefined, everything: true },
  {
    name: "every ability, every step, with daggers",
    config: DAGGERS,
    everything: true,
  },
  {
    name: "every ability, every step, with modifiers",
    config: undefined,
    everything: true,
    options: {
      modifiers: [
        { kind: "energyCost", value: -5 },
        { kind: "attackPower", value: 300 },
        { kind: "damage", value: 0.1 },
      ],
    },
  },
  {
    name: "every ability, every step, with hand and weapon scoped modifiers",
    config: { weapons: { mainHand: { type: "dagger" } } },
    everything: true,
    options: {
      modifiers: [
        {
          kind: "damage",
          value: 0.2,
          scope: { hands: ["mainHand"], weaponTypes: ["dagger"] },
        },
        { kind: "damage", value: 0.5, scope: { hands: ["offHand"] } },
        { kind: "damage", value: 0.3, scope: { abilities: ["rupture"] } },
        { kind: "damage", value: 0.4, scope: { tags: ["bleed"] } },
      ],
    },
  },
];

// The whole-fight comparison with the skill classes ran on the fixed-step
// engine: the classes write rogue.energy, which the event core's pool refuses
// (it takes a spend or a gain), and the rotation casts through
// rogue.abilitiesById, not the swapped rogue.abilities. It went with that
// engine (#234; tag legacy-engine-final). The resolve comparison below still
// checks the damage and durations against the classes, and the goldens pin
// whole fights.
describe("generic executor parity with the skill classes", () => {
  for (const testCase of CASES) {
    it(`gives the same fight twice on a seed: ${testCase.name}`, () => {
      for (const seed of SEEDS) {
        const first = fight({ seed, ...testCase });
        assert.ok(first.draws.length > 0, "the fight drew numbers");
        assert.ok(first.damage > 0, `damage, seed ${seed}`);
        assert.deepEqual(fight({ seed, ...testCase }), first, `seed ${seed}`);
      }
    });
  }

  it("casts every ability in the every-ability fights", () => {
    // Daggers: Backstab is refused with any other main hand.
    const { stats } = fight({ seed: 1, config: DAGGERS, everything: true });
    for (const definition of ABILITY_DEFINITIONS.filter(
      (definition) => definition.id !== "cold-blood",
    )) {
      assert.ok(
        stats[definition.id]?.casts > 0,
        `${definition.id} was never cast`,
      );
    }
  });

  it("deals the same damage and duration for every combo point count", () => {
    for (const config of [undefined, DAGGERS]) {
      for (let comboPoints = 0; comboPoints <= 6; comboPoints += 1) {
        const oldRogue = new Rogue(config);
        const newRogue = new Rogue(config);
        oldRogue.abilities = legacyAbilities(oldRogue);
        for (const rogue of [oldRogue, newRogue]) {
          rogue.comboPoints = comboPoints;
          new Simulation(rogue, { seed: 5 });
        }
        for (const key of Object.keys(oldRogue.abilities)) {
          const before = oldRogue.abilities[key];
          const after = newRogue.abilities[key];
          // One resolve per ability, so both rngs stay in step.
          const resolved = after.resolve();
          assert.equal(
            resolved.damage,
            before.damage(),
            `${key} ${comboPoints}`,
          );
          // The old classes keep the length of the last damage() as a field.
          // Slice and Dice's old length is only set by a cast, so a fight
          // covers it instead.
          if (key !== "sliceAndDice") {
            assert.equal(
              resolved.duration,
              before.duration,
              `${key} duration ${comboPoints}`,
            );
          }
        }
      }
    }
  });
});

describe("generic executor", () => {
  it("has no aura and no damage for combo points a table does not cover", () => {
    // combo.max is 5 and every table has 5 entries, so a fight never gets
    // here. A rogue with more combo points shows what the executor does.
    const rogue = new Rogue();
    rogue.maxComboPoints = 6;
    const simulation = new Simulation(rogue, { seed: 3 });
    for (const comboPoints of [0, 6]) {
      rogue.comboPoints = comboPoints;
      assert.deepEqual(rogue.abilities.sliceAndDice.resolve(), {
        damage: 0,
        duration: 0,
      });
      assert.deepEqual(rogue.abilities.rupture.resolve(), {
        damage: 0,
        duration: 0,
      });
    }
    rogue.comboPoints = 6;
    rogue.energy = 100;
    rogue.abilities.sliceAndDice.cast(rogue, simulation);
    assert.equal(simulation.activeBuffs["slice-and-dice"], undefined);
    assert.equal(rogue.comboPoints, 0, "the points are still spent");
    rogue.comboPoints = 5;
    assert.equal(rogue.abilities.sliceAndDice.resolve().duration, 21);
  });

  it("marks Rupture's ticks as bleeds, and nothing else", () => {
    const rogue = new Rogue();
    for (const [key, ability] of Object.entries(rogue.abilities)) {
      assert.equal(ability.bleed, key === "rupture", key);
      assert.equal(ability.dot, key === "rupture", key);
    }
    const simulation = new Simulation(rogue, { seed: 3 });
    const calls = [];
    const original = simulation.resolveDotAttack.bind(simulation);
    simulation.resolveDotAttack = (...args) => {
      calls.push(args);
      return original(...args);
    };
    rogue.comboPoints = 5;
    rogue.energy = 100;
    rogue.abilities.rupture.cast(rogue, simulation);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][4], true, "the bleed flag reaches the DoT");
  });

  it("attacks with the main hand", () => {
    for (const ability of Object.values(new Rogue().abilities)) {
      assert.equal(ability.hand, "mainHand", ability.id);
    }
  });

  it("builds one ability per definition, in order, from one class", () => {
    const rogue = new Rogue();
    const keys = Object.keys(rogue.abilities);
    assert.deepEqual(
      keys,
      ABILITY_DEFINITIONS.map((definition) => definition.key),
    );
    for (const ability of Object.values(rogue.abilities)) {
      assert.equal(Object.getPrototypeOf(ability), Ability.prototype);
    }
  });

  it("has a catalogue entry for every definition and takes its name from it", () => {
    const abilities = createAbilities(new Rogue());
    for (const definition of ABILITY_DEFINITIONS) {
      const catalogued = abilityCatalogue.get(definition.id);
      assert.ok(catalogued, definition.id);
      assert.equal(abilities[definition.key].name, catalogued.name);
      assert.equal(abilities[definition.key].triggersGcd, catalogued.startsGcd);
      assert.equal(
        abilities[definition.key].cost,
        catalogued.cost?.amount ?? 0,
      );
      assert.equal(abilities[definition.key].cooldown, catalogued.cooldown);
    }
  });

  it("has unique keys and ids, and only constants rows that exist", () => {
    const keys = new Set(
      ABILITY_DEFINITIONS.map((definition) => definition.key),
    );
    const ids = new Set(ABILITY_DEFINITIONS.map((definition) => definition.id));
    assert.equal(keys.size, ABILITY_DEFINITIONS.length);
    assert.equal(ids.size, ABILITY_DEFINITIONS.length);
    for (const definition of ABILITY_DEFINITIONS) {
      assert.ok(k(definition.row), definition.row);
    }
  });

  it("refuses a definition the catalogue does not know", () => {
    assert.throws(
      () =>
        new Ability(
          { key: "x", id: "no-such-ability", row: "backstab", icon: "x.jpg" },
          new Rogue(),
        ),
      /no-such-ability.*catalogue/,
    );
  });

  it("keeps every definition frozen all the way down", () => {
    const frozen = (value, path) => {
      if (value === null || typeof value !== "object") {
        return;
      }
      assert.ok(Object.isFrozen(value), `${path} is not frozen`);
      for (const [key, inner] of Object.entries(value)) {
        frozen(inner, `${path}.${key}`);
      }
    };
    frozen(ABILITY_DEFINITIONS, "ABILITY_DEFINITIONS");
    const [first] = ABILITY_DEFINITIONS;
    assert.throws(() => {
      first.cost.resource = "rage";
    }, TypeError);
  });
});
