import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { EnergyPool, WAKE_KIND } from "../js/core/energy.js";
import { ORDER, Scheduler } from "../js/core/scheduler.js";
import { ModifierPipeline, defineModifier } from "../js/modifiers.js";
import { RESOURCE_DEFINITIONS } from "../js/resource-data.js";
import { createRng } from "../js/rng.js";

const ENERGY = RESOURCE_DEFINITIONS.find(({ id }) => id === "energy");
const COMBO = RESOURCE_DEFINITIONS.find(({ id }) => id === "comboPoints");
const RATE = k("energy.regenPerSecond");
const CAP = k("energy.max");
const AR = AURAS.adrenalineRush;
const AR_MULT = k("adrenalineRush").regenMultiplier;
const AR_LENGTH = k("adrenalineRush").duration;

// A timed modifier as the Simulation's auraModifiers gives it.
const timed = (modifier) => ({
  modifier: defineModifier(modifier),
  stacks: 1,
  duration: Number.POSITIVE_INFINITY,
  source: modifier.source ?? null,
});
const AR_ENTRY = {
  modifier: AR.modifiers.find(({ kind }) => kind === "energyRegen"),
  stacks: 1,
  duration: AR_LENGTH,
  source: AR.id,
};

// A pool on a scheduler, with a set of timed modifiers the test puts up and
// takes down (the part of a Simulation the pool reads). Events of kind "up"
// and "down" change the set and tell the pool; a wake-up is recorded with
// the value the handler finds.
function setup({ endTime = 300, statics = [], onWake = () => {} } = {}) {
  const up = new Set();
  const pipeline = new ModifierPipeline(statics);
  pipeline.attach({
    auraModifiers: (kind) => [...up].filter((e) => e.modifier.kind === kind),
  });
  const woke = [];
  let pool = null;
  const scheduler = new Scheduler({
    endTime,
    handle(event, self) {
      if (event.kind === "up") {
        up.add(event.payload);
        pool.modifiersChanged();
      } else if (event.kind === "down") {
        up.delete(event.payload);
        pool.modifiersChanged();
      } else if (event.kind === WAKE_KIND) {
        woke.push({
          time: event.time,
          now: self.now,
          value: pool.value,
          has: pool.has(event.payload.amount),
          payload: event.payload,
          order: event.order,
        });
        onWake(event, pool, self);
      }
    },
  });
  pool = new EnergyPool({ definition: ENERGY, modifiers: pipeline, scheduler });
  const change = (kind, time, entry) =>
    scheduler.schedule({ time, order: ORDER.expiry, kind, payload: entry });
  return { pool, scheduler, up, woke, change };
}

// Kira's #183 regen model (qa183/h/model.mjs), restated for a timeline: walk
// the changes in order of time, each piece adding rate * length up to the
// cap. `changes` are { time, rate } (a new rate from then) or { time, spend }.
function oracle(e0, cap, rate0, changes, t) {
  let e = e0;
  let rate = rate0;
  let from = 0;
  for (const change of changes) {
    if (change.time > t) {
      break;
    }
    e = Math.min(cap, e + rate * (change.time - from));
    from = change.time;
    if (change.rate !== undefined) {
      rate = change.rate;
    } else {
      e -= change.spend;
    }
  }
  return Math.min(cap, e + rate * (t - from));
}

describe("energy pool: the line with no modifier", () => {
  it("starts at the definition's start value at the scheduler's now", () => {
    const { pool } = setup();
    assert.equal(pool.value, k("start.state").energy);
    assert.deepEqual(pool.line, { value0: CAP, t0: 0, rate: RATE, cap: CAP });
    assert.equal(pool.max, CAP);
    assert.equal(pool.rate, RATE);
  });

  it("starts its line at the scheduler's now when built later", () => {
    const scheduler = new Scheduler({ endTime: 10, handle: () => {} });
    scheduler.runUntil(4);
    const pool = new EnergyPool({
      definition: ENERGY,
      modifiers: new ModifierPipeline(),
      scheduler,
    });
    assert.equal(pool.line.t0, 4);
    pool.spend(CAP);
    scheduler.runUntil(6);
    assert.equal(pool.value, RATE * 2);
  });

  it("reads exactly min(cap, e0 + rate * t) at any time and any split", () => {
    const rng = createRng(194);
    for (let round = 0; round < 50; round += 1) {
      const { pool, scheduler } = setup();
      pool.spend(rng() * CAP);
      const e0 = pool.value;
      assert.deepEqual(pool.line, { value0: e0, t0: 0, rate: RATE, cap: CAP });
      let t = 0;
      while (t < 20) {
        t += rng() * 0.7;
        scheduler.runUntil(t);
        assert.equal(pool.value, Math.min(CAP, e0 + RATE * t));
        // A read does not re-base.
        assert.equal(pool.line.t0, 0);
      }
    }
  });

  it("does not re-base when a modifier event changes neither rate nor cap", () => {
    const { pool, scheduler, change } = setup();
    pool.spend(90);
    const other = timed({
      kind: "resourceMax",
      op: "add",
      value: 3,
      scope: { resources: ["comboPoints"] },
    });
    change("up", 2, other);
    scheduler.runUntil(4);
    assert.equal(pool.line.t0, 0);
    assert.equal(pool.modifiersChanged(), false);
    assert.equal(pool.value, Math.min(CAP, 10 + RATE * 4));
  });

  it("says when a modifier event moved the rate or the cap", () => {
    const { pool, scheduler, up } = setup();
    scheduler.runUntil(1);
    up.add(AR_ENTRY);
    assert.equal(pool.modifiersChanged(), true);
    assert.equal(pool.line.t0, 1);
    assert.equal(pool.modifiersChanged(), false);
  });
});

describe("energy pool: piecewise across Adrenaline Rush", () => {
  it("matches Kira's #183 chronological model across an apply and expiry, 200 seeds", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = createRng(seed);
      const { pool, scheduler, change } = setup();
      const spend0 = Math.floor(rng() * (CAP + 1));
      pool.spend(spend0);
      const e0 = CAP - spend0;
      const applied = rng() * 30;
      const expired = applied + AR_LENGTH;
      change("up", applied, AR_ENTRY);
      change("down", expired, AR_ENTRY);
      const changes = [
        { time: applied, rate: RATE * AR_MULT },
        { time: expired, rate: RATE },
      ];
      // Spends at random times, some inside the aura, as a cast would.
      const spends = [];
      for (let i = 0; i < 4; i += 1) {
        spends.push({ time: rng() * 60, spend: 35 });
      }
      spends.sort((a, b) => a.time - b.time);
      const all = [...changes, ...spends].sort((a, b) => a.time - b.time);
      const times = [applied, expired, ...spends.map(({ time }) => time)];
      for (let i = 0; i < 40; i += 1) {
        times.push(rng() * 70);
      }
      times.sort((a, b) => a - b);
      let next = 0;
      for (const t of times) {
        while (next < spends.length && spends[next].time <= t) {
          scheduler.runUntil(spends[next].time);
          pool.spend(spends[next].spend);
          next += 1;
        }
        scheduler.runUntil(t);
        const want = oracle(e0, CAP, RATE, all, t);
        assert.equal(pool.value, want, `seed ${seed}, t = ${t}`);
        assert.ok(pool.value <= CAP);
      }
    }
  });

  it("re-bases at the apply and at the expiry, at their own timestamps", () => {
    const { pool, scheduler, change } = setup();
    pool.spend(CAP);
    change("up", 1.25, AR_ENTRY);
    change("down", 1.25 + AR_LENGTH, AR_ENTRY);
    scheduler.runUntil(2);
    assert.deepEqual(pool.line, {
      value0: RATE * 1.25,
      t0: 1.25,
      rate: RATE * AR_MULT,
      cap: CAP,
    });
    assert.equal(pool.value, RATE * 1.25 + RATE * AR_MULT * 0.75);
    pool.spend(pool.value);
    scheduler.runUntil(1.25 + AR_LENGTH);
    assert.deepEqual(pool.line, {
      value0: CAP,
      t0: 1.25 + AR_LENGTH,
      rate: RATE,
      cap: CAP,
    });
  });
});

describe("energy pool: the cap", () => {
  it("never reads above the cap, and a gain stops there", () => {
    const { pool, scheduler } = setup();
    pool.spend(30);
    assert.equal(pool.gain(10), 10);
    assert.equal(pool.gain(25), 20);
    assert.equal(pool.value, CAP);
    assert.equal(pool.gain(5), 0);
    pool.spend(50);
    scheduler.runUntil(100);
    assert.equal(pool.value, CAP);
  });

  it("applies static and timed resourceMax modifiers", () => {
    const vigor = { kind: "resourceMax", op: "add", value: 10 };
    const { pool, scheduler, change } = setup({ statics: [vigor] });
    assert.equal(pool.max, CAP + 10);
    // The start is not raised: it is the start value, under the cap.
    assert.equal(pool.value, CAP);
    scheduler.runUntil(1);
    assert.equal(pool.value, CAP + 10);
    const boost = timed({ kind: "resourceMax", op: "add", value: 20 });
    change("up", 2, boost);
    change("down", 5, boost);
    scheduler.runUntil(3);
    assert.equal(pool.max, CAP + 30);
    assert.equal(pool.value, CAP + 10 + RATE * 1);
    scheduler.runUntil(4);
    assert.equal(pool.value, CAP + 30);
    // The cap falls below the value at the expiry: it is brought down there.
    scheduler.runUntil(5);
    assert.equal(pool.max, CAP + 10);
    assert.deepEqual(pool.line, {
      value0: CAP + 10,
      t0: 5,
      rate: RATE,
      cap: CAP + 10,
    });
    assert.equal(pool.value, CAP + 10);
  });

  it("starts at a cap below the start value", () => {
    const low = { kind: "resourceMax", op: "add", value: -30 };
    const { pool } = setup({ statics: [low] });
    assert.equal(pool.line.value0, CAP - 30);
    assert.equal(pool.value, CAP - 30);
  });
});

describe("energy pool: gain and spend", () => {
  it("re-bases on each, from the value now", () => {
    const { pool, scheduler } = setup();
    pool.spend(80);
    scheduler.runUntil(1.5);
    assert.equal(pool.spend(20), 20);
    assert.deepEqual(pool.line, { value0: 15, t0: 1.5, rate: RATE, cap: CAP });
    scheduler.runUntil(2);
    pool.gain(25);
    assert.deepEqual(pool.line, { value0: 45, t0: 2, rate: RATE, cap: CAP });
    scheduler.runUntil(3);
    assert.equal(pool.spendAll(), 55);
    assert.deepEqual(pool.line, { value0: 0, t0: 3, rate: RATE, cap: CAP });
  });

  it("reports a gain or a spend that moved the value, with its source", () => {
    const { pool } = setup();
    const seen = [];
    pool.onChange = (change, before, source) =>
      seen.push([change, before, source]);
    pool.gain(5, "at-cap");
    pool.spend(40, "sinister-strike");
    pool.gain(10, "relentless");
    pool.spend(0);
    pool.spendAll("eviscerate");
    assert.deepEqual(seen, [
      ["spend", 100, "sinister-strike"],
      ["gain", 60, "relentless"],
      ["spend", 70, "eviscerate"],
    ]);
  });

  it("refuses an amount that is not a number of 0 or more", () => {
    const { pool } = setup();
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "5"]) {
      assert.throws(() => pool.gain(bad), RangeError);
      assert.throws(() => pool.spend(bad), RangeError);
      assert.throws(() => pool.wakeAt(bad), RangeError);
    }
  });
});

describe("energy pool: the threshold wake-up", () => {
  it("fires once, in the energy class, at the time the amount is reached", () => {
    const { pool, scheduler, woke } = setup();
    pool.spend(CAP);
    const event = pool.wakeAt(35);
    assert.equal(event.kind, WAKE_KIND);
    assert.equal(event.order, ORDER.energy);
    assert.deepEqual(event.payload, { resource: "energy", amount: 35 });
    assert.equal(pool.wakeTime, 3.5);
    assert.equal(pool.wakeAmount, 35);
    scheduler.runUntil(10);
    assert.deepEqual(
      woke.map(({ time, value }) => [time, value]),
      [[3.5, 35]],
    );
    assert.equal(pool.wakeTime, null);
    assert.equal(pool.wakeAmount, null);
    // One-shot: a later re-base schedules nothing.
    pool.spend(80);
    assert.equal(scheduler.pendingCount, 0);
  });

  it("lands where the handler always finds the amount, within an ulp or two, 200 seeds", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = createRng(seed);
      const bonus = { kind: "energyRegen", op: "add", value: rng() * 7 };
      const { pool, scheduler, woke } = setup({ statics: [bonus] });
      scheduler.runUntil(rng() * 50);
      pool.spend(rng() * CAP);
      const amount = rng() * CAP;
      const { value0, t0, rate } = pool.line;
      pool.wakeAt(amount);
      const exact = Math.max(t0, t0 + (amount - value0) / rate);
      const ulp = Math.max(exact * Number.EPSILON, Number.MIN_VALUE);
      assert.ok(pool.wakeTime >= exact - 4 * ulp, `seed ${seed}`);
      // A nudge is one step of about an ulp, never a jump past the line.
      assert.ok(pool.wakeTime <= exact + 2 * ulp, `seed ${seed}`);
      scheduler.runToEnd();
      assert.equal(woke.length, 1);
      assert.ok(woke[0].has, `seed ${seed}: ${woke[0].value} < ${amount}`);
    }
  });

  it("moves with a spend, a gain and a rate change", () => {
    const { pool, scheduler, change, woke } = setup();
    pool.spend(CAP);
    pool.wakeAt(60);
    assert.equal(pool.wakeTime, 6);
    scheduler.runUntil(2);
    pool.spend(10);
    assert.equal(pool.wakeTime, 7);
    pool.gain(5);
    assert.equal(pool.wakeTime, 6.5);
    change("up", 3, AR_ENTRY);
    scheduler.runUntil(3);
    // 25 at t = 3, then 20 a second.
    assert.equal(pool.wakeTime, 3 + 35 / (RATE * AR_MULT));
    assert.equal(scheduler.pendingCount, 1);
    scheduler.runUntil(10);
    assert.equal(woke.length, 1);
    assert.equal(woke[0].time, 3 + 35 / (RATE * AR_MULT));
  });

  it("fires at now when the amount is already there, or a gain reaches it", () => {
    const { pool, scheduler, woke } = setup();
    scheduler.runUntil(1);
    pool.wakeAt(CAP);
    assert.equal(pool.wakeTime, 1);
    scheduler.runUntil(1);
    assert.deepEqual(
      woke.map(({ time }) => time),
      [1],
    );
    pool.spend(50);
    pool.wakeAt(70);
    assert.equal(pool.wakeTime, 3);
    pool.gain(30);
    assert.equal(pool.wakeTime, 1);
  });

  it("reaches an amount equal to the cap", () => {
    const { pool, scheduler, woke } = setup();
    pool.spend(CAP);
    pool.wakeAt(CAP);
    assert.equal(pool.wakeTime, CAP / RATE);
    scheduler.runToEnd();
    assert.deepEqual(
      woke.map(({ time, value }) => [time, value]),
      [[CAP / RATE, CAP]],
    );
  });

  it("waits with no event while the amount cannot be reached", () => {
    const stall = timed({ kind: "energyRegen", op: "add", value: -RATE });
    const boost = timed({ kind: "resourceMax", op: "add", value: 50 });
    const { pool, scheduler, change, woke } = setup();
    pool.spend(CAP);
    assert.equal(pool.wakeAt(CAP + 20), null);
    assert.equal(pool.wakeTime, null);
    assert.equal(pool.wakeAmount, CAP + 20);
    change("up", 1, boost);
    scheduler.runUntil(1);
    assert.equal(pool.wakeTime, 1 + (CAP + 20 - 10) / RATE);
    change("up", 2, stall);
    scheduler.runUntil(2);
    assert.equal(pool.rate, 0);
    assert.equal(pool.wakeTime, null);
    assert.equal(scheduler.pendingCount, 0);
    // At rate 0 an amount the pool already holds still fires now.
    assert.equal(pool.wakeAt(pool.value).time, 2);
    pool.wakeAt(CAP + 20);
    change("down", 4, stall);
    scheduler.runUntil(4);
    assert.equal(pool.wakeTime, 4 + (CAP + 20 - 20) / RATE);
    scheduler.runUntil(20);
    assert.equal(woke.length, 1);
  });

  it("keeps one threshold: a second call replaces the first, cancelWake drops it", () => {
    const { pool, scheduler, woke } = setup();
    pool.spend(CAP);
    const first = pool.wakeAt(50);
    const second = pool.wakeAt(20);
    assert.equal(first.cancelled, true);
    assert.equal(second.time, 2);
    assert.equal(scheduler.pendingCount, 1);
    pool.cancelWake();
    assert.equal(second.cancelled, true);
    assert.equal(pool.wakeAmount, null);
    pool.spend(0);
    assert.equal(scheduler.pendingCount, 0);
    scheduler.runUntil(10);
    assert.equal(woke.length, 0);
  });

  it("is not moved by its own firing: the handler reads the same line", () => {
    const { pool, scheduler, woke } = setup();
    pool.spend(CAP);
    pool.wakeAt(30);
    scheduler.runUntil(3);
    assert.equal(woke.length, 1);
    assert.equal(pool.line.t0, 0);
    scheduler.runUntil(7);
    assert.equal(pool.value, RATE * 7);
  });
});

describe("energy pool: refusals", () => {
  const scheduler = new Scheduler({ endTime: 10, handle: () => {} });
  const modifiers = new ModifierPipeline();

  it("needs a definition with a regen rule", () => {
    assert.throws(
      () => new EnergyPool({ definition: COMBO, modifiers, scheduler }),
      /EnergyPool needs a resource definition with a regen rule\. "comboPoints" has none\./,
    );
    assert.throws(() => new EnergyPool(), /"undefined" has none/);
  });

  it("needs the core's scheduler", () => {
    assert.throws(
      () => new EnergyPool({ definition: ENERGY, modifiers }),
      /EnergyPool needs the core's scheduler\./,
    );
  });

  it("refuses a regen rate that is negative or not finite", () => {
    for (const rate of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fake = {
        resolve: (kind, base) => (kind === "energyRegen" ? rate : base),
      };
      assert.throws(
        () =>
          new EnergyPool({ definition: ENERGY, modifiers: fake, scheduler }),
        /Resource "energy" has a regen rate of .*; it must be a finite number, 0 or more\./,
      );
    }
  });
});
