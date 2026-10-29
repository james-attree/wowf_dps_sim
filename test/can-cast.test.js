import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { k } from "../data/constants.js";
import { gcdClear } from "../js/ability.js";
import { createFight } from "../js/fight.js";

// R3 (#140): Ability.canCast says what cast() will do, without doing it. The
// rotation interpreter asks it, so the two must agree on every state a fight
// can be in: cast() acts exactly when canCast is true.

const EPSILON = k("sim.tickEpsilon");
const ENERGY = [0, 24, 25, 34, 35, 44, 45, 100];
const POINTS = [0, 1, 5];
const GCD = [0, EPSILON / 2, EPSILON, EPSILON * 2, 1.5];
const COOLDOWN = [0, 0.01, 30];

// A fight with the state set by hand. `modifiers` is the Rogue option.
function setUp(id, { energy, points, gcd, cooldown }, modifiers, config) {
  const fight = createFight(3, config, { modifiers });
  const { rogue, simulation } = fight;
  rogue.energy = energy;
  rogue.comboPoints = points;
  simulation.gcd = gcd;
  if (cooldown > 0) {
    simulation.cooldowns[id] = cooldown;
  }
  return fight;
}

// Whether a cast went ahead: it is told in the log, and the rng is untouched
// for a failed one.
function acted(fight, id) {
  const { rogue, simulation } = fight;
  const before = simulation.combatLog.length;
  rogue.abilitiesById.get(id).cast(rogue, simulation);
  return simulation.combatLog.length > before;
}

function snapshot({ rogue, simulation }) {
  return JSON.stringify({
    energy: rogue.energy,
    points: rogue.comboPoints,
    gcd: simulation.gcd,
    cooldowns: simulation.cooldowns,
    log: simulation.combatLog.length,
    damage: simulation.damageDone,
    buffs: Object.keys(simulation.activeBuffs),
    draw: simulation.rng(),
  });
}

describe("Ability.canCast", () => {
  const ids = [...createFight(3).rogue.abilitiesById.keys()];

  it("knows every ability of the rogue", () => {
    assert.ok(ids.length >= 10);
    assert.ok(ids.includes("sinister-strike"));
    assert.ok(ids.includes("cold-blood"));
  });

  for (const [label, modifiers] of [
    ["with no cost modifier", undefined],
    ["with a cost modifier", [{ kind: "energyCost", value: -5 }]],
  ]) {
    it(`agrees with cast() in every state, ${label}`, () => {
      let checked = 0;
      let allowed = 0;
      for (const id of ids) {
        for (const energy of ENERGY) {
          for (const points of POINTS) {
            for (const gcd of GCD) {
              for (const cooldown of COOLDOWN) {
                const state = { energy, points, gcd, cooldown };
                const asked = setUp(id, state, modifiers);
                const can = asked.rogue.abilitiesById
                  .get(id)
                  .canCast(asked.rogue, asked.simulation);
                const cast = acted(setUp(id, state, modifiers), id);
                assert.equal(
                  can,
                  cast,
                  `${id} at ${JSON.stringify(state)}: canCast ${can}, cast acted ${cast}`,
                );
                checked += 1;
                allowed += can ? 1 : 0;
              }
            }
          }
        }
      }
      // Both answers are well covered, so the equality is not two falses.
      assert.ok(checked > 2000);
      assert.ok(allowed > 100 && allowed < checked - 100);
    });
  }

  it("agrees with cast() for Backstab on a dagger, and holds it on any other main hand", () => {
    let allowed = 0;
    for (const type of ["dagger", "sword", "mace", "fist"]) {
      const config = { weapons: { mainHand: { type } } };
      for (const energy of ENERGY) {
        for (const gcd of GCD) {
          for (const cooldown of COOLDOWN) {
            const state = { energy, points: 0, gcd, cooldown };
            const asked = setUp("backstab", state, undefined, config);
            const can = asked.rogue.abilitiesById
              .get("backstab")
              .canCast(asked.rogue, asked.simulation);
            const cast = acted(
              setUp("backstab", state, undefined, config),
              "backstab",
            );
            assert.equal(can, cast, `${type} ${JSON.stringify(state)}`);
            if (type !== "dagger") {
              assert.equal(can, false, `${type} ${JSON.stringify(state)}`);
            }
            allowed += can ? 1 : 0;
          }
        }
      }
    }
    assert.ok(allowed > 0, "a dagger casts it in some state");
  });

  it("changes nothing: no draw, no spend, no log", () => {
    for (const id of ids) {
      for (const state of [
        { energy: 100, points: 5, gcd: 0, cooldown: 0 },
        { energy: 0, points: 0, gcd: 1.5, cooldown: 30 },
      ]) {
        const asked = setUp(id, state);
        const control = setUp(id, state);
        const ability = asked.rogue.abilitiesById.get(id);
        ability.canCast(asked.rogue, asked.simulation);
        ability.canCast(asked.rogue, asked.simulation);
        assert.equal(snapshot(asked), snapshot(control), id);
      }
    }
  });

  it("holds an on-GCD ability for the GCD, and not an off-GCD one", () => {
    const busy = { energy: 100, points: 5, gcd: 1.5, cooldown: 0 };
    const fight = setUp("cold-blood", busy);
    const { rogue, simulation } = fight;
    assert.equal(rogue.abilitiesById.get("cold-blood").triggersGcd, false);
    assert.equal(
      rogue.abilitiesById.get("cold-blood").canCast(rogue, simulation),
      true,
    );
    assert.equal(
      rogue.abilitiesById.get("sinister-strike").canCast(rogue, simulation),
      false,
    );
  });

  it("holds a spender with no points to spend, even when it costs nothing", () => {
    const fight = setUp("slice-and-dice", {
      energy: 100,
      points: 0,
      gcd: 0,
      cooldown: 0,
    });
    const { rogue, simulation } = fight;
    const spender = rogue.abilitiesById.get("slice-and-dice");
    assert.equal(spender.spender, true);
    assert.equal(spender.canCast(rogue, simulation), false);
    rogue.comboPoints = 1;
    assert.equal(spender.canCast(rogue, simulation), true);
  });

  it("reads the cost after the cost modifiers", () => {
    const state = { energy: 40, points: 0, gcd: 0, cooldown: 0 };
    const plain = setUp("sinister-strike", state);
    const cheaper = setUp("sinister-strike", state, [
      { kind: "energyCost", value: -5 },
    ]);
    const cost = plain.rogue.abilitiesById.get("sinister-strike").cost;
    assert.equal(cost - 5, state.energy);
    assert.equal(
      plain.rogue.abilitiesById
        .get("sinister-strike")
        .canCast(plain.rogue, plain.simulation),
      false,
    );
    assert.equal(
      cheaper.rogue.abilitiesById
        .get("sinister-strike")
        .canCast(cheaper.rogue, cheaper.simulation),
      true,
    );
  });
});

describe("gcdClear", () => {
  it("is the GCD within sim.tickEpsilon of done", () => {
    assert.equal(gcdClear({ gcd: 0 }), true);
    assert.equal(gcdClear({ gcd: EPSILON }), true);
    assert.equal(gcdClear({ gcd: EPSILON * 1.01 }), false);
    assert.equal(gcdClear({ gcd: 1.5 }), false);
  });
});

describe("Ability.costNow", () => {
  it("is the cost after the cost modifiers, and 0 for an ability that pays nothing", () => {
    const { rogue, simulation } = createFight(3);
    for (const ability of rogue.abilitiesById.values()) {
      const now = ability.costNow(simulation);
      assert.ok(Number.isFinite(now) && now >= 0, ability.id);
      if (ability.costResource === null) {
        assert.equal(now, 0, ability.id);
      }
    }
    assert.ok(
      [...rogue.abilitiesById.values()].some(
        (ability) => ability.costResource === null,
      ),
      "an ability that pays nothing exists",
    );
    assert.equal(
      rogue.abilitiesById.get("sinister-strike").costNow(simulation),
      rogue.abilitiesById.get("sinister-strike").cost,
    );
  });
});
