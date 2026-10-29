import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

// Issue #72. The engine advances only through Simulation.step(dt), with dt in
// seconds. It reads no clock, so two engines given the same seed and the same
// steps end in the same state.

function fight(seed, steps) {
  const sim = new Simulation(new Rogue(), { seed });
  for (const dt of steps) {
    sim.step(dt);
  }
  return sim;
}

function repeat(count, dt) {
  return Array.from({ length: count }, () => dt);
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

describe("Simulation.step", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("adds the time step, in seconds, to currentTime", () => {
    const sim = new Simulation(new Rogue(), { seed: 1 });
    assert.equal(sim.currentTime, 0);
    sim.step(0.25);
    assert.equal(sim.currentTime, 0.25);
    sim.step(1);
    assert.equal(sim.currentTime, 1.25);
    sim.step(0);
    assert.equal(sim.currentTime, 1.25);
  });

  it("takes no wall-clock timestamp: update and lastFrameTime are gone", () => {
    const sim = new Simulation(new Rogue(), { seed: 1 });
    assert.equal(typeof sim.step, "function");
    assert.equal(sim.update, undefined);
    assert.equal("lastFrameTime" in sim, false);
  });

  it("refuses a step that is negative, NaN, infinite, or not a number", () => {
    for (const bad of [-0.001, NaN, Infinity, -Infinity, undefined, "1"]) {
      const sim = new Simulation(new Rogue(), { seed: 1 });
      assert.throws(() => sim.step(bad), RangeError, String(bad));
      assert.equal(sim.currentTime, 0, String(bad));
    }
  });

  it("gives two engines the same final state for the same seed and steps", () => {
    const steps = repeat(60 * 90, 1 / 60);
    const first = fight(1234, steps);
    const second = fight(1234, steps);
    assert.ok(first.damageDone > 0);
    assert.ok(first.combatLog.length > 0);
    assert.deepEqual(state(second), state(first));
  });

  it("matches across irregular steps and across runs of the same schedule", () => {
    const deltas = [1 / 144, 1 / 30, 0.007, 0.023, 0.25, 0];
    const steps = Array.from(
      { length: 3000 },
      (_, index) => deltas[index % deltas.length],
    );
    assert.deepEqual(state(fight(99, steps)), state(fight(99, steps)));
  });

  it("differs when the seed differs", () => {
    const steps = repeat(60 * 90, 1 / 60);
    assert.notDeepEqual(
      state(fight(1, steps)).combatLog,
      state(fight(2, steps)).combatLog,
    );
  });

  it("does not read performance.now or Date.now while it runs", () => {
    const performanceNow = mock.method(performance, "now", () => {
      throw new Error("performance.now should not be called");
    });
    const dateNow = mock.method(Date, "now", () => {
      throw new Error("Date.now should not be called");
    });
    // Constructing the simulation counts as well as stepping it.
    const sim = fight(7, repeat(60 * 30, 1 / 60));
    assert.ok(sim.damageDone > 0);
    assert.equal(performanceNow.mock.callCount(), 0);
    assert.equal(dateNow.mock.callCount(), 0);
  });

  it("gives the same state however a stretch of time is split into steps", () => {
    // Lands on the same boundaries: 10 s as 100 steps of 0.1 and as 10 of 1.
    // The fight is quiet, so only the timers and energy are compared.
    const quiet = () => {
      const rogue = new Rogue();
      rogue.rotation = () => {};
      return new Simulation(rogue, { seed: 5 });
    };
    const fine = quiet();
    for (const dt of repeat(100, 0.1)) {
      fine.step(dt);
    }
    const coarse = quiet();
    for (const dt of repeat(10, 1)) {
      coarse.step(dt);
    }
    assert.ok(Math.abs(fine.currentTime - coarse.currentTime) < 1e-9);
    assert.ok(
      Math.abs(fine.rogue.energy - coarse.rogue.energy) < k("sim.tickEpsilon"),
    );
  });
});

describe("engine files", () => {
  it("never mention performance.now, Date, or requestAnimationFrame outside js/main.js", () => {
    // The batch worker and its client (#147) are hosts, like js/main.js: they
    // read performance.now for slices and the progress throttle, and hand it
    // to js/batch-host.js, which reads no clock. No frames there either.
    const hosts = ["batch-worker.js", "batch-client.js"];
    const files = readdirSync(new URL("../js/", import.meta.url)).filter(
      (name) => name.endsWith(".js") && name !== "main.js",
    );
    assert.ok(files.includes("simulation.js"));
    assert.ok(files.includes("batch-host.js"));
    for (const name of files) {
      const source = readFileSync(
        new URL(`../js/${name}`, import.meta.url),
        "utf8",
      );
      if (!hosts.includes(name)) {
        assert.doesNotMatch(source, /\bperformance\b/, name);
        assert.doesNotMatch(source, /\bDate\b/, name);
      }
      assert.doesNotMatch(source, /requestAnimationFrame/, name);
    }
    for (const name of hosts) {
      assert.ok(files.includes(name), name);
    }
  });
});
