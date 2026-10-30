import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AT_EVENTS,
  CONDITION_DRIFT,
  CONDITION_TYPES,
  OPERATORS,
  conditionWakeAt,
  evaluate,
} from "../js/rotation-conditions.js";

// Issue #197 (E6): the event core runs the rotation only at fight events, so
// every condition type says how its answer can change between them (its
// drift), and conditionWakeAt gives the time a moving one next can.

// Every type and its drift, written out: a new type fails here until it is
// added with the drift it really has.
const EXPECTED = {
  resource: "continuous",
  comboPoints: AT_EVENTS,
  auraActive: AT_EVENTS,
  auraRemaining: "continuous",
  debuffActive: AT_EVENTS,
  debuffRemaining: "continuous",
  debuffStacks: AT_EVENTS,
  cooldownReady: AT_EVENTS,
  fightTime: "continuous",
  fightTimeRemaining: "continuous",
  energyToCap: "continuous",
  abilityGranted: AT_EVENTS,
  abilityUnlocked: AT_EVENTS,
};

// 30 s into a 60 s fight, 40 energy of 100 at 10 a second, 3 combo points,
// Slice and Dice with 8 s left, Rupture with 6 s, Blade Flurry 12 s from
// ready.
function state(changes = {}) {
  return {
    time: 30,
    duration: 60,
    resources: {
      energy: { value: 40, max: 100, regenPerSecond: 10 },
      comboPoints: { value: 3, max: 5, regenPerSecond: 0 },
    },
    auras: { "slice-and-dice": { remaining: 8, stacks: 1 } },
    debuffs: {
      rupture: { remaining: 6, stacks: 1 },
      "deadly-poison": { remaining: 10, stacks: 3 },
    },
    cooldowns: { "blade-flurry": 12 },
    build: { selected: true },
    granted: ["blade-flurry"],
    talentAbilities: ["blade-flurry", "cold-blood"],
    ...changes,
  };
}

// The state `dt` seconds later with no event in between: the clock, the
// energy line up to its cap, and the time left on each aura and debuff (one
// that would run out is an event, so dt stays inside them here).
function later(base, dt) {
  const { energy } = base.resources;
  const tick = (map) =>
    Object.fromEntries(
      Object.entries(map).map(([id, entry]) => [
        id,
        { ...entry, remaining: entry.remaining - dt },
      ]),
    );
  return {
    ...base,
    time: base.time + dt,
    resources: {
      ...base.resources,
      energy: {
        ...energy,
        value: Math.min(energy.max, energy.value + energy.regenPerSecond * dt),
      },
    },
    auras: tick(base.auras),
    debuffs: tick(base.debuffs),
  };
}

// One condition of each type at a few values, with every operator for the
// numeric ones.
const numeric = (base, values) =>
  OPERATORS.flatMap((op) => values.map((value) => ({ ...base, op, value })));
const CONDITIONS = [
  ...numeric({ type: "resource", resource: "energy" }, [40, 45.5, 70, 100]),
  ...numeric({ type: "resource", resource: "comboPoints" }, [3, 4]),
  ...numeric({ type: "comboPoints" }, [3, 5]),
  { type: "auraActive", aura: "slice-and-dice" },
  { type: "auraActive", aura: "blade-flurry", active: false },
  ...numeric({ type: "auraRemaining", aura: "slice-and-dice" }, [8, 4, 2.25]),
  ...numeric({ type: "auraRemaining", aura: "blade-flurry" }, [0, 1]),
  { type: "debuffActive", debuff: "rupture" },
  ...numeric({ type: "debuffRemaining", debuff: "rupture" }, [6, 3, 0.5]),
  ...numeric({ type: "debuffStacks", debuff: "deadly-poison" }, [3, 4]),
  { type: "cooldownReady", ability: "blade-flurry" },
  { type: "cooldownReady", ability: "adrenaline-rush", ready: false },
  ...numeric({ type: "fightTime" }, [30, 31.5, 5]),
  ...numeric({ type: "fightTimeRemaining" }, [30, 27, 45]),
  ...numeric({ type: "energyToCap" }, [6, 2.5, 0, 9]),
  { type: "abilityGranted", ability: "blade-flurry" },
  { type: "abilityUnlocked", ability: "cold-blood" },
];
// How far ahead to look: inside Rupture's 6 s, so no event is skipped over.
const HORIZON = 5.5;
const STEPS = 220;

describe("condition drift (#197)", () => {
  it("is declared for every type, and is the one each type has", () => {
    assert.deepEqual(Object.keys(CONDITION_DRIFT), [...CONDITION_TYPES]);
    assert.deepEqual({ ...CONDITION_DRIFT }, EXPECTED);
    assert.ok(Object.isFrozen(CONDITION_DRIFT));
  });

  it("covers every type in the cases below", () => {
    assert.deepEqual(
      [...new Set(CONDITIONS.map(({ type }) => type))].sort(),
      [...CONDITION_TYPES].sort(),
    );
  });

  // The answer is the same at every time before the wake-up (none: never),
  // and an answer that changes does so at it: a wake-up is never late. A
  // type that changes only at events gives none, and its answer holds.
  it("wakes the rotation no later than any answer changes between events", () => {
    for (const base of [
      state(),
      state({
        resources: {
          ...state().resources,
          energy: { value: 100, max: 100, regenPerSecond: 10 },
        },
      }),
      state({
        resources: {
          ...state().resources,
          energy: { value: 20, max: 100, regenPerSecond: 0 },
        },
      }),
      state({ duration: null }),
    ]) {
      for (const condition of CONDITIONS) {
        const wake = conditionWakeAt(condition, base);
        const label = `${JSON.stringify(condition)} at energy ${base.resources.energy.value}, duration ${base.duration}`;
        if (CONDITION_DRIFT[condition.type] === AT_EVENTS) {
          assert.equal(wake, null, label);
        }
        if (wake !== null) {
          assert.ok(wake > base.time, label);
        }
        const now = evaluate(condition, base);
        for (let step = 1; step <= STEPS; step += 1) {
          const dt = (HORIZON * step) / STEPS;
          if (wake !== null && base.time + dt >= wake) {
            break;
          }
          assert.equal(
            evaluate(condition, later(base, dt)),
            now,
            `${label}: changed at +${dt} before its wake-up ${wake}`,
          );
        }
      }
    }
  });

  it("gives the crossing time of a moving number", () => {
    const at = (condition, changes) =>
      conditionWakeAt(condition, state(changes));
    // Energy 40 at 10 a second reaches 70 in 3 s.
    assert.equal(
      at({ type: "resource", resource: "energy", op: ">=", value: 70 }),
      33,
    );
    // At the value now: just after now, when it moves past.
    const next = at({
      type: "resource",
      resource: "energy",
      op: "<=",
      value: 40,
    });
    assert.ok(next > 30 && next - 30 < 1e-9, String(next));
    // Moving away from the value, or not moving: never.
    assert.equal(
      at({ type: "resource", resource: "energy", op: "<", value: 20 }),
      null,
    );
    assert.equal(
      at({ type: "resource", resource: "comboPoints", op: ">=", value: 5 }),
      null,
    );
    // Time left counts down; an aura that is not up stands at 0.
    assert.equal(
      at({ type: "auraRemaining", aura: "slice-and-dice", op: "<=", value: 3 }),
      35,
    );
    assert.equal(
      at({ type: "auraRemaining", aura: "blade-flurry", op: ">", value: 0 }),
      null,
    );
    assert.equal(
      at({ type: "debuffRemaining", debuff: "rupture", op: "<", value: 2 }),
      34,
    );
    // The clock, and the time left in a fight with and without a length.
    assert.equal(at({ type: "fightTime", op: ">=", value: 45 }), 45);
    assert.equal(at({ type: "fightTime", op: "<", value: 10 }), null);
    assert.equal(at({ type: "fightTimeRemaining", op: "<", value: 20 }), 40);
    assert.equal(
      at(
        { type: "fightTimeRemaining", op: "<", value: 20 },
        { duration: null },
      ),
      null,
    );
    // Six seconds to the cap, counting down while it regenerates.
    assert.equal(at({ type: "energyToCap", op: "<=", value: 1 }), 35);
    assert.equal(
      at(
        { type: "energyToCap", op: "<=", value: 1 },
        {
          resources: {
            ...state().resources,
            energy: { value: 100, max: 100, regenPerSecond: 10 },
          },
        },
      ),
      null,
    );
  });

  it("never wakes at or before now, and never once the fight is over", () => {
    const at = (condition, changes) =>
      conditionWakeAt(condition, state(changes));
    // A crossing too close to resolve on the clock (energy 40 against the
    // next number above it, at 10 a second) still wakes after now.
    const close = at({
      type: "resource",
      resource: "energy",
      op: ">=",
      value: 40 + 40 * Number.EPSILON,
    });
    assert.ok(close > 30, String(close));
    // At the end of the fight the time left stays 0: nothing moves.
    assert.equal(
      at({ type: "fightTimeRemaining", op: "<=", value: 0 }, { time: 60 }),
      null,
    );
  });

  // #234: at t = 0 the next double up is the smallest one, which moves no
  // number off a threshold it sits on; the wake is where it has moved.
  it("wakes at t = 0 on a threshold where the number has left it", () => {
    const zero = (changes = {}) => state({ time: 0, duration: 60, ...changes });
    const energy = (value) => ({
      resources: {
        ...state().resources,
        energy: { value, max: 120, regenPerSecond: 10 },
      },
    });
    const cases = [
      [
        { type: "resource", resource: "energy", op: ">", value: 100 },
        energy(100),
      ],
      [{ type: "resource", resource: "energy", op: ">", value: 0 }, energy(0)],
      [{ type: "fightTime", op: ">", value: 0 }, {}],
      [{ type: "fightTimeRemaining", op: "<", value: 60 }, {}],
    ];
    for (const [condition, changes] of cases) {
      const base = zero(changes);
      const wake = conditionWakeAt(condition, base);
      assert.ok(wake > 0 && wake < 1e-12, `${condition.type}: ${wake}`);
      assert.notEqual(
        evaluate(condition, later(base, wake)),
        evaluate(condition, base),
        `${condition.type} at ${wake}`,
      );
    }
    // Later than 0 the wake is still the next double up.
    const at30 = conditionWakeAt(cases[0][0], state(energy(100)));
    assert.equal(at30, 30 + 30 * Number.EPSILON);
  });
});
