import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { runOnCore } from "../js/core/fight.js";
import { quiet } from "./quiet.js";

// Issue #72. A fight advances only by seconds given to it (runOnCore here, the
// event core's run; Simulation.step went with the fixed-step engine in #234).
// It reads no clock, so two fights given the same seed and the same cuts end in
// the same state.

function fight(seed, steps) {
  const sim = new Simulation(new Rogue(), { seed });
  for (const dt of steps) {
    runOnCore(sim, dt);
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

describe("runOnCore, cut into steps", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("adds the time step, in seconds, to currentTime", () => {
    const sim = new Simulation(new Rogue(), { seed: 1 });
    assert.equal(sim.currentTime, 0);
    runOnCore(sim, 0.25);
    assert.equal(sim.currentTime, 0.25);
    runOnCore(sim, 1);
    assert.equal(sim.currentTime, 1.25);
    runOnCore(sim, 0);
    assert.equal(sim.currentTime, 1.25);
  });

  it("takes no wall-clock timestamp: step, update and lastFrameTime are gone", () => {
    const sim = new Simulation(new Rogue(), { seed: 1 });
    assert.equal(sim.step, undefined);
    assert.equal(sim.update, undefined);
    assert.equal("lastFrameTime" in sim, false);
  });

  it("refuses a step that is negative, NaN, infinite, or not a number", () => {
    for (const bad of [-0.001, NaN, Infinity, -Infinity, undefined, "1"]) {
      const sim = new Simulation(new Rogue(), { seed: 1 });
      assert.throws(() => runOnCore(sim, bad), RangeError, String(bad));
      assert.equal(sim.currentTime, 0, String(bad));
    }
  });

  it("refuses an option it does not know, an engine too, before it touches the rogue (#236 QA)", () => {
    for (const key of ["engine", "duration", "sed"]) {
      const rogue = new Rogue();
      assert.throws(
        () => new Simulation(rogue, { seed: 1, [key]: "legacy" }),
        (error) =>
          error instanceof RangeError &&
          error.message ===
            `Simulation has no option "${key}". Options: seed, rng, fightLength.`,
        key,
      );
      // The rogue's pipeline is not taken: a fight on it still starts.
      assert.equal(new Simulation(rogue, { seed: 1 }).seed, 1, key);
    }
  });

  it("refuses null, an array or a non-object as options with a RangeError, and takes none as the defaults (#238 QA)", () => {
    for (const [bad, got] of [
      [null, "null"],
      [[], "an array"],
      [7, "number"],
      ["seed", "string"],
      [true, "boolean"],
      // #248 QA: only an ordinary object is read as options. A Map's entries
      // are not options; it was quietly the defaults.
      [new Map([["seed", 5]]), "a Map"],
      [new WeakMap(), "a WeakMap"],
      [new Date(0), "a Date"],
      [new Set(), "a Set"],
      [() => ({ seed: 1 }), "function"],
    ]) {
      const rogue = new Rogue();
      assert.throws(
        () => new Simulation(rogue, bad),
        (error) =>
          error instanceof RangeError &&
          error.message ===
            `Simulation needs an options object: { seed, rng, fightLength }, or none. Got ${got}.`,
        got,
      );
      // The rogue's pipeline is not taken: a fight on it still starts.
      assert.equal(new Simulation(rogue, { seed: 1 }).seed, 1, got);
    }
    // No options, or undefined, is the defaults, as it always was.
    for (const sim of [
      new Simulation(new Rogue()),
      new Simulation(new Rogue(), undefined),
    ]) {
      assert.equal(sim.seed, new Simulation(new Rogue(), {}).seed);
      assert.equal(sim.fightLength, null);
    }
  });

  it("reads only its own options: an inherited one is not given (#238 QA)", () => {
    // fightLength 7 and seed 99 on the prototype are not this fight's.
    const inherited = new Simulation(
      new Rogue(),
      Object.assign(Object.create({ fightLength: 7, seed: 99 }), { seed: 1 }),
    );
    assert.equal(inherited.fightLength, null);
    assert.equal(inherited.seed, 1);
    const defaults = new Simulation(
      new Rogue(),
      Object.create({ seed: 99, fightLength: 7 }),
    );
    assert.equal(defaults.seed, new Simulation(new Rogue()).seed);
    assert.equal(defaults.fightLength, null);
    // An inherited name the check does not see is not read either.
    const engine = new Simulation(
      new Rogue(),
      Object.assign(Object.create({ engine: "legacy" }), { seed: 1 }),
    );
    assert.equal(engine.seed, 1);
    // Own options still count.
    assert.equal(
      new Simulation(new Rogue(), { seed: 1, fightLength: 7 }).fightLength,
      7,
    );
  });

  it("refuses a run whose duration is not finite and 0 or more, with its own message", () => {
    for (const bad of [
      -0.001,
      NaN,
      Infinity,
      -Infinity,
      undefined,
      null,
      "1",
    ]) {
      const sim = new Simulation(new Rogue(), { seed: 1 });
      assert.throws(
        () => sim.run(bad),
        (error) =>
          error instanceof RangeError &&
          error.message ===
            `Simulation.run needs a finite duration in seconds, 0 or more. Got ${bad}.`,
        String(bad),
      );
      assert.equal(sim.currentTime, 0, String(bad));
      assert.equal(sim.core, null, String(bad));
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
    const quietFight = () => new Simulation(quiet(new Rogue()), { seed: 5 });
    const fine = quietFight();
    for (const dt of repeat(100, 0.1)) {
      runOnCore(fine, dt);
    }
    const coarse = quietFight();
    for (const dt of repeat(10, 1)) {
      runOnCore(coarse, dt);
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
