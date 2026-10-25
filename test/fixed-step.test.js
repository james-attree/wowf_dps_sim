import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

// Issue #73. Simulation.run(duration) repeats the fixed step
// k("sim.fixedStep") and ends with one shorter step, so the fight lasts
// exactly `duration`. The step size is an engineering constant.

const STEP = k("sim.fixedStep");
const FIVE_MINUTES = 300;

function newSim(seed = 1) {
  return new Simulation(new Rogue(), { seed });
}

// Everything the fight leaves behind that a later step could depend on.
function state(sim) {
  return {
    currentTime: sim.currentTime,
    damageDone: sim.damageDone,
    gcd: sim.gcd,
    combatLog: sim.combatLog,
    cooldowns: sim.cooldowns,
    activeBuffs: sim.activeBuffs,
    activeDebuffs: sim.activeDebuffs,
    activeDots: sim.activeDots,
    energy: sim.rogue.energy,
    comboPoints: sim.rogue.comboPoints,
    swingTimers: [
      sim.rogue.weapons.mainHand.swingTimer,
      sim.rogue.weapons.offHand.swingTimer,
    ],
  };
}

// Count the steps a simulation takes, and what size each one is.
function recordSteps(sim) {
  const sizes = [];
  const original = sim.step.bind(sim);
  sim.step = (dt) => {
    sizes.push(dt);
    original(dt);
  };
  return sizes;
}

describe("sim.fixedStep", () => {
  it("is an engineering constant with a signed ref and a note, retune off", () => {
    const row = CONSTANTS["sim.fixedStep"];
    assert.equal(row.source, "engineering");
    assert.equal(row.unit, "s");
    assert.equal(row.retune, false);
    assert.match(row.ref, /^James, \d+ Oct 2026, issue #73: /);
    assert.match(row.note, /sim\.tickEpsilon/);
    assert.match(row.note, /swing timers/);
    assert.match(row.note, /GCD/);
    assert.match(row.note, /frame/);
  });

  it("is a power of two, so repeated addition is exact", () => {
    assert.ok(STEP > 0);
    assert.ok(Number.isInteger(Math.log2(STEP)));
    let total = 0;
    for (let index = 0; index < FIVE_MINUTES / STEP; index++) {
      total += STEP;
    }
    assert.equal(total, FIVE_MINUTES);
  });

  it("is small beside the timers it must resolve", () => {
    // Well under a live 30 fps frame, and far under the GCD and a swing.
    assert.ok(STEP < 1 / 30);
    assert.ok(STEP * 10 < k("gcd.duration"));
    assert.ok(STEP > k("sim.tickEpsilon"));
  });
});

describe("Simulation.run", () => {
  it("takes fixed steps of sim.fixedStep and nothing else for a whole number of steps", () => {
    const sim = newSim();
    const sizes = recordSteps(sim);
    sim.run(STEP * 40);
    assert.equal(sizes.length, 40);
    assert.ok(sizes.every((size) => size === STEP));
    assert.equal(sim.currentTime, STEP * 40);
  });

  it("ends a final partial step so total time equals the duration exactly", () => {
    for (const duration of [
      FIVE_MINUTES,
      90,
      1,
      0.1,
      1 / 3,
      STEP / 2,
      STEP * 7 + STEP / 8,
      12.3456789,
      Math.PI,
    ]) {
      const sim = newSim();
      sim.run(duration);
      assert.equal(sim.currentTime, duration, String(duration));
    }
  });

  it("takes whole steps, then one short step for what is left", () => {
    const sim = newSim();
    const sizes = recordSteps(sim);
    sim.run(STEP * 5 + STEP / 4);
    assert.equal(sizes.length, 6);
    assert.deepEqual(sizes.slice(0, 5), [STEP, STEP, STEP, STEP, STEP]);
    assert.equal(sizes[5], STEP / 4);
    assert.equal(sim.currentTime, STEP * 5 + STEP / 4);
  });

  it("takes only a short step when the duration is under one step", () => {
    const sim = newSim();
    const sizes = recordSteps(sim);
    sim.run(STEP / 2);
    assert.deepEqual(sizes, [STEP / 2]);
  });

  it("takes no step, and changes nothing, for a duration of 0", () => {
    const sim = newSim();
    const before = state(sim);
    const sizes = recordSteps(sim);
    sim.run(0);
    assert.equal(sizes.length, 0);
    assert.deepEqual(state(sim), before);
  });

  it("refuses a duration that is negative, NaN, infinite, or not a number", () => {
    for (const bad of [-STEP, -1, NaN, Infinity, -Infinity, undefined, "1"]) {
      const sim = newSim();
      assert.throws(() => sim.run(bad), RangeError, String(bad));
      assert.equal(sim.currentTime, 0, String(bad));
    }
  });

  it("adds to the time already run, call after call", () => {
    const sim = newSim();
    sim.run(10);
    sim.run(20.5);
    assert.equal(sim.currentTime, 30.5);
  });

  it("completes a 5-minute fight", () => {
    const sim = newSim(1);
    sim.run(FIVE_MINUTES);
    assert.equal(sim.currentTime, FIVE_MINUTES);
    assert.ok(sim.damageDone > 0);
    assert.ok(sim.combatLog.length > 0);
    // Newest first, and none later than the end of the fight.
    assert.ok(sim.combatLog.every((event) => event.time <= FIVE_MINUTES));
    assert.ok(sim.combatLog[0].time > FIVE_MINUTES - 10);
    assert.ok(Number.isFinite(sim.rogue.energy));
  });

  it("gives the same fight for the same seed, and a different one for another seed", () => {
    const first = newSim(42);
    first.run(FIVE_MINUTES);
    const second = newSim(42);
    second.run(FIVE_MINUTES);
    assert.deepEqual(state(second), state(first));

    const other = newSim(43);
    other.run(FIVE_MINUTES);
    assert.notEqual(other.damageDone, first.damageDone);
  });

  it("deals about the same damage as the live frame rates it replaces", () => {
    // Per seed the fights differ (swings land on other step boundaries, so
    // the rng is drawn in another order). Averaged over seeds, damage per
    // second at the fixed step stays within 2% of 60 and 144 fps.
    const seeds = Array.from({ length: 30 }, (_, index) => index + 1);
    const duration = 120;
    function meanDps(stepSize) {
      let total = 0;
      for (const seed of seeds) {
        const sim = newSim(seed);
        for (let index = 0; index < Math.round(duration / stepSize); index++) {
          sim.step(stepSize);
        }
        total += sim.damageDone / duration;
      }
      return total / seeds.length;
    }
    const fixed = meanDps(STEP);
    for (const fps of [60, 144]) {
      const live = meanDps(1 / fps);
      assert.ok(
        Math.abs(fixed - live) / live < 0.02,
        `${fixed} vs ${live} at ${fps} fps`,
      );
    }
  });

  it("matches a hand-driven loop of the same steps", () => {
    const viaRun = newSim(9);
    viaRun.run(30);
    const byHand = newSim(9);
    for (let index = 0; index < 30 / STEP; index++) {
      byHand.step(STEP);
    }
    assert.deepEqual(state(viaRun), state(byHand));
  });
});

describe("Simulation.run split across calls", () => {
  function whole(seed, duration) {
    const sim = newSim(seed);
    sim.run(duration);
    return state(sim);
  }

  it("does not depend on how a 5-minute fight is split at step boundaries", () => {
    const expected = whole(1, FIVE_MINUTES);
    const splits = [
      [100, 200],
      [FIVE_MINUTES / 2, FIVE_MINUTES / 2],
      Array.from({ length: 5 }, () => 60),
      Array.from({ length: 300 }, () => 1),
      // Sub-second splits that are still whole steps.
      [STEP, 1, STEP * 3, 0.25, FIVE_MINUTES - 1.25 - STEP * 4],
      [0, 150, 0, 150],
    ];
    for (const parts of splits) {
      const sim = newSim(1);
      for (const part of parts) {
        sim.run(part);
      }
      assert.deepEqual(state(sim), expected, parts.slice(0, 6).join(", "));
    }
  });

  it("does not depend on the split for other seeds either", () => {
    for (const seed of [2, 77, 2026, 4294967295]) {
      const expected = whole(seed, 120);
      const sim = newSim(seed);
      sim.run(45);
      sim.run(30);
      sim.run(45);
      assert.deepEqual(state(sim), expected, `seed ${seed}`);
    }
  });

  it("gives the same fight for a split before a final partial step", () => {
    // 90 s is whole steps and the rest is half a step: the short step is
    // the last thing either way.
    const duration = 90 + STEP / 2;
    const expected = whole(3, duration);
    const sim = newSim(3);
    sim.run(90);
    sim.run(STEP / 2);
    assert.deepEqual(state(sim), expected);
  });

  it("lands on the total whatever the split, even inside a step", () => {
    // Inside a step the fight itself may differ (a short step is a step of
    // its own), but total simulated time still equals what was asked for.
    const sim = newSim(1);
    sim.run(0.3);
    sim.run(0.3);
    sim.run(89.4);
    assert.ok(Math.abs(sim.currentTime - 90) < k("sim.tickEpsilon"));
  });
});
