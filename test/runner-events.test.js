import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { createFight, runFight } from "../js/fight.js";
import { FrameClock } from "../js/frame-clock.js";
import { createLiveFeed } from "../js/live-feed.js";
import { createLiveRun } from "../js/live-run.js";
import { createRng } from "../js/rng.js";
import { normalizeConfig } from "../js/sim-config.js";
import { SimRunner } from "../js/sim-runner.js";
import { Simulation } from "../js/simulation.js";
import { createStore } from "../js/store.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #198: the engine choice through runFight, SimRunner and the live
// adapter, and what the event core gives behind them: any split of the time
// is the same fight, there is no step and no carry, Stop then Run is the
// same fight, live equals headless, and procs and poisons run through the
// runner. The runner's contract tests also run on the event core
// (test/runner-engine-files.test.js).

const EVENTS = "events";
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};
const CASES = [
  { seed: 1, duration: 12 },
  { seed: 2, duration: 7.77 },
  { seed: 12345, duration: 300, config: TALENTED },
  { seed: 99, duration: 31.4159, config: TALENTED },
  { seed: 3, duration: 0 },
];

const headless = ({ seed, duration, config }) =>
  runFight({ seed, duration, config, engine: EVENTS });

function events(options) {
  const runner = new SimRunner({ engine: EVENTS, ...options });
  runner.run();
  return runner;
}

describe("runFight engine option (#198)", () => {
  it("runs the event core, with the result's shape and no engine in it", () => {
    const legacy = runFight({ seed: 4, duration: 20, engine: "legacy" });
    const core = runFight({ seed: 4, duration: 20, engine: EVENTS });
    assert.deepEqual(Object.keys(core), Object.keys(legacy));
    assert.equal(core.duration, 20);
    assert.ok(core.totalDamage > 0);
    // The event core is the default since #199.
    assert.deepEqual(runFight({ seed: 4, duration: 20 }), core);
  });

  it("gives what the default engine gives when useEngine set it", () => {
    // Legacy, now that the default is the event core (#199).
    const legacy = runFight({
      seed: 8,
      duration: 15,
      config: TALENTED,
      engine: "legacy",
    });
    const previous = Simulation.useEngine("legacy");
    try {
      assert.deepEqual(
        runFight({ seed: 8, duration: 15, config: TALENTED }),
        legacy,
      );
    } finally {
      Simulation.useEngine(previous);
    }
  });

  it("refuses an unknown engine", () => {
    for (const bad of ["Events", "", null, 1]) {
      assert.throws(() => runFight({ seed: 1, duration: 1, engine: bad }), {
        name: "RangeError",
        message: /Unknown engine/,
      });
    }
  });
});

describe("SimRunner engine option (#198)", () => {
  it("is events by default (#199), the one named, or the default useEngine set", () => {
    assert.equal(new SimRunner({ seed: 1, duration: 1 }).engine, EVENTS);
    assert.equal(
      new SimRunner({ seed: 1, duration: 1, engine: "legacy" }).engine,
      "legacy",
    );
    const previous = Simulation.useEngine("legacy");
    let made;
    try {
      made = new SimRunner({ seed: 1, duration: 1 });
    } finally {
      Simulation.useEngine(previous);
    }
    // Fixed when the runner is made.
    assert.equal(made.engine, "legacy");
    made.run();
    made.advance(Infinity);
    assert.deepEqual(
      made.result,
      runFight({ seed: 1, duration: 1, engine: "legacy" }),
    );
  });

  it("refuses an unknown engine when it is made", () => {
    assert.throws(
      () => new SimRunner({ seed: 1, duration: 1, engine: "fast" }),
      {
        name: "RangeError",
        message: /Unknown engine "fast"/,
      },
    );
  });

  for (const fight of CASES) {
    it(`equals runFight in one call, in frames and in random pieces (seed ${fight.seed}, ${fight.duration} s)`, () => {
      const expected = headless(fight);
      const one = events(fight);
      assert.equal(one.advance(fight.duration), "finished");
      assert.deepEqual(one.result, expected);
      const frames = events(fight);
      while (frames.state === "running") {
        frames.advance(1 / 60);
      }
      assert.deepEqual(frames.result, expected);
      const rng = createRng(fight.seed >>> 0);
      const pieces = events(fight);
      while (pieces.state === "running") {
        pieces.advance(rng() < 0.2 ? 0 : rng() * 3);
      }
      assert.deepEqual(pieces.result, expected);
    });
  }

  it("has no step artefact: 600 calls of 1/60 finish a 10 s fight on the 600th", () => {
    const runner = events({ seed: 2, duration: 10 });
    for (let frame = 1; frame < 600; frame += 1) {
      assert.equal(runner.advance(1 / 60), "running", `frame ${frame}`);
    }
    assert.equal(runner.advance(1 / 60), "finished");
    assert.deepEqual(runner.result, headless({ seed: 2, duration: 10 }));
  });

  it("reaches exactly the time given, by a correctly rounded sum", () => {
    const runner = events({ seed: 5, duration: 60 });
    for (let i = 0; i < 200; i += 1) {
      runner.advance(0.01);
    }
    assert.equal(runner.time, 2);
    runner.advance(0.5);
    assert.equal(runner.time, 2.5);
  });

  it("reproduces the identical fight after Stop, and on every run", () => {
    const fight = { seed: 77, duration: 20, config: TALENTED };
    const expected = headless(fight);
    const runner = events(fight);
    runner.advance(9.3);
    runner.stop();
    assert.equal(runner.time, 0);
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(runner.result, expected);
    runner.run();
    while (runner.state === "running") {
      runner.advance(0.7);
    }
    assert.deepEqual(runner.result, expected);
  });

  it("pauses from a handler after the events of that time, and keeps the rest of the time", () => {
    const fight = { seed: 31, duration: 30, config: TALENTED };
    const runner = events(fight);
    let pausedAt = null;
    runner.on("hit", (event) => {
      if (pausedAt === null && event.time > 5) {
        pausedAt = event.time;
        runner.pause();
      }
    });
    assert.equal(runner.advance(20), "paused");
    assert.equal(runner.time, pausedAt);
    runner.resume();
    // The rest of the 20 s, then no more.
    assert.equal(runner.time, 20);
    runner.advance(Infinity);
    assert.deepEqual(runner.result, headless(fight));
  });

  it("runs procs and poisons through the runner as runFight does", () => {
    const fight = { seed: 5, duration: 60, config: TALENTED };
    const runner = events(fight);
    const procs = [];
    runner.on("proc", (event) => procs.push(event));
    while (runner.state === "running") {
      runner.advance(0.25);
    }
    assert.deepEqual(runner.result, headless(fight));
    for (const name of ["Instant Poison", "Deadly Poison", "Blade Flurry"]) {
      assert.ok(runner.result.abilities[name], name);
    }
    assert.ok(procs.length > 0, "proc events on the stream");
  });
});

describe("SimRunner's end of a fight on the event core (#198)", () => {
  it("closes the core before the end event, as a headless run does", () => {
    const seen = (simulation) => ({
      core: simulation.core,
      time: simulation.currentTime,
      cappedTime: simulation.rogue.resources.energy.cappedTime,
      overflow: simulation.rogue.resources.energy.overflow,
    });
    const runner = new SimRunner({ seed: 4, duration: 40, engine: EVENTS });
    let atEnd = null;
    runner.on("end", () => {
      atEnd = seen(runner.fight.simulation);
    });
    runner.run();
    runner.advance(Infinity);
    const fight = createFight(4, normalizeConfig(undefined), {
      duration: 40,
      engine: EVENTS,
    });
    let expected = null;
    fight.simulation.on("end", () => {
      expected = seen(fight.simulation);
    });
    fight.simulation.run(40);
    assert.equal(atEnd.core, null);
    assert.deepEqual(atEnd, expected);
  });

  it("runs a fight that a handler started again at the last time in full", () => {
    const runner = new SimRunner({ seed: 3, duration: 0, engine: EVENTS });
    let again = true;
    runner.on("*", () => {
      if (again) {
        again = false;
        runner.stop();
        runner.run();
      }
    });
    runner.run();
    runner.advance(0);
    assert.equal(again, false);
    assert.equal(runner.state, "finished");
    assert.deepEqual(runner.result, headless({ seed: 3, duration: 0 }));
  });
});

describe("SimRunner.fight between calls on the event core (#198)", () => {
  it("gives the feed energy, the GCD, auras and cooldowns at the time reached", () => {
    const runner = events({
      seed: 5,
      duration: 60,
      config: { talents: referenceBuild() },
    });
    const feed = createLiveFeed(runner.fight);
    runner.advance(10);
    const before = feed.read();
    // No event between 10 and 10.001 in this fight: everything moves by the
    // time alone.
    runner.advance(0.001);
    const after = feed.read();
    const close = (a, b, label) =>
      assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);
    close(before.gcd.remaining - after.gcd.remaining, 0.001, "gcd");
    assert.ok(after.resources.energy.value > before.resources.energy.value);
    for (const group of ["buffs", "cooldowns"]) {
      assert.ok(before.effects[group].length > 0, group);
      before.effects[group].forEach((effect, index) => {
        const later = after.effects[group][index];
        assert.equal(later.id, effect.id);
        close(effect.remaining - later.remaining, 0.001, effect.id);
      });
    }
    feed.stop();
  });
});

describe("FrameClock.seconds (#198)", () => {
  it("gives each frame's seconds, capped, 0 on the first and after restart", () => {
    const clock = new FrameClock();
    assert.equal(clock.seconds(1000), 0);
    assert.equal(clock.seconds(1016), 0.016);
    assert.equal(clock.seconds(1016), 0);
    assert.equal(clock.seconds(900), 0, "a timestamp going back");
    assert.equal(clock.seconds(60_000), k("sim.maxFrameTime"));
    clock.restart();
    assert.equal(clock.seconds(70_000), 0);
    assert.equal(clock.carry, 0, "no carry");
    assert.throws(() => clock.seconds(Number.NaN), /FrameClock.seconds needs/);
  });
});

describe("the live adapter on the event core (#198)", () => {
  const config = pageDefaultConfig();

  function live(engine) {
    const store = createStore({
      config,
      run: { state: "idle", seed: null, duration: null },
      frame: 0,
      results: { time: 0, damage: 0 },
    });
    const frames = {
      pending: null,
      request(callback) {
        this.pending = callback;
        return 1;
      },
      cancel() {
        this.pending = null;
      },
    };
    const target = createLiveRun(store, frames);
    let now = 5000;
    const tick = (ms) => {
      const callback = frames.pending;
      frames.pending = null;
      now += ms;
      callback(now);
    };
    return { store, frames, live: target, tick, engine };
  }

  // 1x is real-time frames, 4x frames four times as long, and max the
  // longest frame the clock takes (k("sim.maxFrameTime")); the app has no
  // speed setting, so these are the frame lengths a host can give.
  const SPEEDS = {
    "1x": 1000 / 60,
    "4x": 4000 / 60,
    max: k("sim.maxFrameTime") * k("sim.msPerSecond"),
  };

  for (const [speed, ms] of Object.entries(SPEEDS)) {
    it(`equals headless at ${speed}`, () => {
      const seed = 4242;
      const duration = 12;
      const { live: target, tick, frames, store } = live(EVENTS);
      target.run({ seed, duration, config, engine: EVENTS });
      let guard = 0;
      while (frames.pending) {
        tick(ms);
        guard += 1;
        assert.ok(guard < 10_000, "the fight ends");
      }
      assert.equal(target.state, "finished");
      assert.deepEqual(target.result, headless({ seed, duration, config }));
      assert.equal(store.get().results.time, duration);
    });
  }

  it("Stop then Run reproduces the same fight, and a pause is never simulated", () => {
    const seed = 17;
    const duration = 8;
    const { live: target, tick, frames } = live(EVENTS);
    target.run({ seed, duration, config, engine: EVENTS });
    tick(16);
    tick(16);
    target.pause();
    target.resume();
    tick(1e6);
    assert.equal(target.fight().simulation.currentTime, 0.016);
    target.stop();
    target.run({ seed, duration, config, engine: EVENTS });
    while (frames.pending) {
      tick(23);
    }
    assert.deepEqual(target.result, headless({ seed, duration, config }));
  });

  it("clears to an event-core fight at 0:00", () => {
    const { live: target, store } = live(EVENTS);
    target.clear({ seed: 3, config, engine: EVENTS });
    assert.deepEqual(store.get().results, { time: 0, damage: 0 });
    assert.throws(
      () => target.clear({ seed: 3, config, engine: "steps" }),
      RangeError,
    );
  });
});
