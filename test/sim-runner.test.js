import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { runFight } from "../js/fight.js";
import { normalizeSeed } from "../js/rng.js";
import { Simulation } from "../js/simulation.js";
import { RUNNER_STATES, SimRunner } from "../js/sim-runner.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #136 (P3-1, E8-lite). The contract tests for SimRunner. They hold for
// any engine behind the runner: they read states, events, results and rng
// draws, and never a step, because Phase 3.5 replaces the fixed-step core
// behind this same interface and these tests have to pass on it unchanged.
// Nothing here may call Simulation.step or name a frame.

const SHORT = 12;
const LONG = 300;
const ODD = 7.77; // not a whole number of engine steps
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};
// Seeds and lengths for the "several seeds and durations" criteria. 0 is a
// fight with no length, and ODD ends inside a step.
const CASES = [
  { seed: 1, duration: SHORT },
  { seed: 2, duration: ODD },
  { seed: 12345, duration: LONG },
  { seed: -1, duration: 0.5 },
  { seed: 3, duration: 0 },
  { seed: 99, duration: 31.4159, config: TALENTED },
];

function runner(options) {
  return new SimRunner({ seed: 1, duration: SHORT, ...options });
}

// Give the runner `chunk` seconds at a time until it finishes.
function runToEnd(target, chunk = Infinity) {
  let calls = 0;
  while (target.state === "running") {
    target.advance(chunk);
    calls += 1;
    assert.ok(calls < 1e6, "the runner never finished");
  }
  return target.result;
}

// Every state change, as "from>to".
function record(target) {
  const changes = [];
  target.onStateChange(({ from, to }) => changes.push(`${from}>${to}`));
  return changes;
}

const ACTIONS = ["run", "pause", "resume", "stop", "reset"];
// The documented table: where each action leads from each state. A missing
// entry throws.
const TABLE = {
  run: { idle: "running", finished: "running" },
  pause: { running: "paused" },
  resume: { paused: "running" },
  stop: { running: "idle", paused: "idle" },
  reset: { idle: "idle", running: "idle", paused: "idle", finished: "idle" },
};

// Bring a runner to a state by the documented route.
function inState(state, options) {
  const target = runner(options);
  if (state === "idle") {
    return target;
  }
  target.run();
  if (state === "paused") {
    target.pause();
  } else if (state === "finished") {
    runToEnd(target);
  }
  assert.equal(target.state, state);
  return target;
}

// Count the draws each Simulation takes from its rng, by wrapping the rng on
// the first call that reaches the engine.
function countDraws() {
  const counts = [];
  const wrapped = new WeakSet();
  // The first of these a fight calls wraps its rng: step on legacy, run in
  // runFight, and on, which SimRunner calls before the event core (#198)
  // draws anything.
  for (const name of ["step", "run", "on"]) {
    const original = Simulation.prototype[name];
    mock.method(Simulation.prototype, name, function counted(...args) {
      wrap(this);
      return original.apply(this, args);
    });
  }
  function wrap(sim) {
    if (wrapped.has(sim)) {
      return;
    }
    wrapped.add(sim);
    const source = sim.rng;
    const count = { draws: 0, values: [] };
    counts.push(count);
    sim.rng = () => {
      const value = source();
      count.draws += 1;
      count.values.push(value);
      return value;
    };
    sim.rogue.rng = sim.rng;
  }
  return counts;
}

afterEach(() => {
  mock.restoreAll();
});

describe("SimRunner states and transitions", () => {
  it("starts idle with no result and no time", () => {
    const target = runner();
    assert.equal(target.state, "idle");
    assert.equal(target.result, null);
    assert.equal(target.time, 0);
    assert.deepEqual(RUNNER_STATES, ["idle", "running", "paused", "finished"]);
  });

  for (const state of RUNNER_STATES) {
    for (const action of ACTIONS) {
      const to = TABLE[action][state];
      if (to === undefined) {
        it(`${action}() while ${state} throws and changes nothing`, () => {
          const target = inState(state);
          const changes = record(target);
          const { time, result } = target;
          assert.throws(
            () => target[action](),
            (error) => {
              assert.ok(error instanceof Error);
              assert.match(error.message, new RegExp(`${action}\\(\\)`));
              assert.match(error.message, new RegExp(`while ${state}`));
              return true;
            },
          );
          assert.equal(target.state, state);
          assert.equal(target.time, time);
          assert.equal(target.result, result);
          assert.deepEqual(changes, []);
        });
      } else {
        it(`${action}() while ${state} goes to ${to}`, () => {
          const target = inState(state);
          const changes = record(target);
          target[action]();
          assert.equal(target.state, to);
          assert.deepEqual(changes, to === state ? [] : [`${state}>${to}`]);
        });
      }
    }
  }

  it("takes the whole life of a fight through the table", () => {
    const target = runner();
    const changes = record(target);
    target.run();
    target.pause();
    target.resume();
    runToEnd(target);
    target.run();
    target.stop();
    target.run();
    target.pause();
    target.reset();
    target.reset();
    assert.deepEqual(changes, [
      "idle>running",
      "running>paused",
      "paused>running",
      "running>finished",
      "finished>running",
      "running>idle",
      "idle>running",
      "running>paused",
      "paused>idle",
    ]);
  });

  it("names the states an invalid action is allowed in", () => {
    assert.throws(() => runner().pause(), /allowed while running\./);
    assert.throws(() => runner().stop(), /allowed while running or paused\./);
    assert.throws(
      () => inState("paused").run(),
      /allowed while idle or finished\./,
    );
  });
});

describe("SimRunner state subscriptions", () => {
  it("calls handlers in subscription order after the state is in place", () => {
    const target = runner();
    const seen = [];
    target.onStateChange(({ to }) => seen.push(["first", to, target.state]));
    target.onStateChange(({ to }) => seen.push(["second", to, target.state]));
    target.run();
    assert.deepEqual(seen, [
      ["first", "running", "running"],
      ["second", "running", "running"],
    ]);
  });

  it("gives plain { from, to } events and stops after unsubscribe", () => {
    const target = runner();
    const events = [];
    const off = target.onStateChange((event) => events.push(event));
    target.run();
    assert.deepEqual(events, [{ from: "idle", to: "running" }]);
    off();
    off(); // a second call is harmless
    target.pause();
    assert.equal(events.length, 1);
  });

  it("reports finishing, and a handler may call the runner", () => {
    const target = runner({ duration: 1 });
    const changes = record(target);
    target.onStateChange(({ to }) => {
      if (to === "finished") {
        target.reset();
      }
    });
    target.run();
    target.advance(Infinity);
    assert.equal(target.state, "idle");
    assert.deepEqual(changes, [
      "idle>running",
      "running>finished",
      "finished>idle",
    ]);
  });

  it("lets a handler unsubscribe during a change without skipping another", () => {
    const target = runner();
    const calls = [];
    const off = target.onStateChange(() => {
      calls.push("a");
      off();
    });
    target.onStateChange(() => calls.push("b"));
    target.run();
    target.pause();
    assert.deepEqual(calls, ["a", "b", "b"]);
  });

  it("does not call a handler added during a change until the next one", () => {
    const target = runner();
    const calls = [];
    target.onStateChange(() => {
      calls.push("a");
      target.onStateChange(() => calls.push("late"));
    });
    target.run();
    assert.deepEqual(calls, ["a"]);
  });

  it("rejects a handler that is not a function", () => {
    assert.throws(() => runner().onStateChange("nope"), TypeError);
  });
});

describe("SimRunner equals runFight", () => {
  for (const { seed, duration, config } of CASES) {
    const label = `seed ${seed}, ${duration} s${config ? ", with a build" : ""}`;
    const expected = runFight({ seed, duration, config });

    it(`gives runFight's result in one call (${label})`, () => {
      const target = new SimRunner({ seed, duration, config });
      target.run();
      assert.equal(target.advance(Infinity), "finished");
      assert.deepEqual(target.result, expected);
      assert.equal(target.time, expected.duration);
    });

    for (const chunk of [1 / 64, 0.1, 0.37, 2]) {
      it(`gives runFight's result in ${chunk} s pieces (${label})`, () => {
        const target = new SimRunner({ seed, duration, config });
        target.run();
        assert.deepEqual(runToEnd(target, chunk), expected);
      });
    }
  }

  it("uses the default fight length when none is given, and no config means the default config", () => {
    const target = new SimRunner({ seed: 4 });
    assert.equal(target.duration, k("batch.duration"));
    assert.equal(target.duration, 300);
    target.run();
    assert.deepEqual(
      runToEnd(target),
      runFight({ seed: 4, duration: k("batch.duration") }),
    );
  });

  it("wraps the seed the way runFight does", () => {
    const target = runner({ seed: -1 });
    assert.equal(target.seed, normalizeSeed(-1));
    target.run();
    assert.deepEqual(runToEnd(target), runFight({ seed: -1, duration: SHORT }));
  });

  it("returns plain data that shares nothing with the runner", () => {
    const target = runner();
    target.run();
    runToEnd(target);
    const { result } = target;
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.deepEqual(structuredClone(result), result);
    assert.equal(target.result, result);
  });

  it("drops time given past the end of the fight", () => {
    const target = runner({ duration: 1 });
    target.run();
    target.advance(1000);
    assert.equal(target.time, 1);
    assert.equal(target.advance(1000), "finished");
    assert.deepEqual(target.result, runFight({ seed: 1, duration: 1 }));
  });

  it("finishes a fight with no length as soon as it runs", () => {
    const target = runner({ duration: 0 });
    const changes = record(target);
    target.run();
    assert.equal(target.state, "finished");
    assert.deepEqual(changes, ["idle>running", "running>finished"]);
    assert.deepEqual(target.result, runFight({ seed: 1, duration: 0 }));
  });
});

describe("SimRunner pause and resume", () => {
  for (const { seed, duration, config } of CASES.filter(
    (c) => c.duration > 1,
  )) {
    it(`never change the outcome (seed ${seed}, ${duration} s)`, () => {
      const expected = runFight({ seed, duration, config });
      const target = new SimRunner({ seed, duration, config });
      target.run();
      let pauses = 0;
      let calls = 0;
      while (target.state === "running") {
        target.advance(0.43);
        calls += 1;
        // Pause on every third call, and give the paused runner time that
        // must be dropped.
        if (target.state === "running" && calls % 3 === 0) {
          target.pause();
          const frozen = target.time;
          target.advance(5);
          target.advance(Infinity);
          assert.equal(target.time, frozen);
          assert.equal(target.state, "paused");
          target.resume();
          pauses += 1;
        }
      }
      assert.ok(pauses > 0, "the test paused at least once");
      assert.deepEqual(target.result, expected);
    });
  }

  it("moves no time while paused or idle or finished", () => {
    const idle = runner();
    assert.equal(idle.advance(5), "idle");
    assert.equal(idle.time, 0);
    const done = inState("finished");
    const { result } = done;
    assert.equal(done.advance(5), "finished");
    assert.equal(done.result, result);
  });

  it("simulates all the time given, in whole pieces or in small ones", () => {
    const whole = runner({ duration: LONG });
    whole.run();
    whole.advance(1);
    assert.equal(whole.time, 1);
    const small = runner({ duration: LONG });
    small.run();
    const pieces = 200;
    for (let i = 0; i < pieces; i += 1) {
      small.advance(0.01);
    }
    assert.ok(small.time > 1.9 && small.time <= 2);
  });

  it("reports the time simulated, never more than was given", () => {
    const target = runner({ duration: LONG });
    target.run();
    target.advance(10);
    assert.ok(target.time <= 10 && target.time > 10 - 1);
    target.advance(0);
    const kept = target.time;
    target.advance(0);
    assert.equal(target.time, kept);
  });
});

describe("SimRunner stop, reset and run again", () => {
  for (const { seed, duration, config } of CASES.filter(
    (c) => c.duration > 1,
  )) {
    it(`reproduces the identical seeded fight after Stop (seed ${seed}, ${duration} s)`, () => {
      const counts = countDraws();
      const expected = runFight({ seed, duration, config });
      const target = new SimRunner({ seed, duration, config });
      target.run();
      target.advance(duration / 2);
      target.stop();
      assert.equal(target.state, "idle");
      assert.equal(target.result, null);
      assert.equal(target.time, 0);
      target.run();
      const first = runToEnd(target, 0.5);
      assert.deepEqual(first, expected);
      // The three engines this test built: runFight, the stopped half run,
      // and the run after Stop. The last draws what runFight drew, in order.
      const [reference, stopped, again] = counts;
      assert.equal(counts.length, 3);
      assert.ok(reference.draws > 0);
      assert.ok(stopped.draws > 0 && stopped.draws < reference.draws);
      assert.equal(again.draws, reference.draws);
      assert.deepEqual(again.values, reference.values);
    });
  }

  it("reproduces the same fight on every run of one runner", () => {
    const target = runner({ seed: 77, duration: 20, config: TALENTED });
    target.run();
    const first = runToEnd(target);
    for (let round = 0; round < 3; round += 1) {
      target.run();
      const next = runToEnd(target, 1.1);
      assert.deepEqual(next, first);
      assert.notEqual(next, first, "a new result object each run");
    }
  });

  it("stops from paused, and reset clears a finished result", () => {
    const paused = inState("paused");
    paused.stop();
    assert.equal(paused.state, "idle");
    paused.run();
    assert.deepEqual(runToEnd(paused), runFight({ seed: 1, duration: SHORT }));

    const done = inState("finished");
    done.reset();
    assert.equal(done.state, "idle");
    assert.equal(done.result, null);
    assert.equal(done.time, 0);
  });

  it("keeps a result it handed out when it runs again", () => {
    const target = runner();
    target.run();
    const first = runToEnd(target);
    const copy = structuredClone(first);
    target.run();
    runToEnd(target, 0.3);
    assert.deepEqual(first, copy);
  });
});

describe("SimRunner driver", () => {
  function manualDriver() {
    const driver = {
      calls: [],
      advance: null,
      start(advance) {
        driver.calls.push("start");
        driver.advance = advance;
      },
      stop() {
        driver.calls.push("stop");
      },
    };
    return driver;
  }

  it("is started on entering running and stopped on leaving it", () => {
    const driver = manualDriver();
    const target = runner({ driver });
    assert.deepEqual(driver.calls, []);
    target.run();
    target.pause();
    target.resume();
    target.stop();
    target.run();
    target.reset();
    assert.deepEqual(driver.calls, [
      "start",
      "stop",
      "start",
      "stop",
      "start",
      "stop",
    ]);
  });

  it("is stopped once when a paused fight is stopped", () => {
    const driver = manualDriver();
    const target = runner({ driver });
    target.run();
    target.pause();
    target.stop();
    assert.deepEqual(driver.calls, ["start", "stop"]);
  });

  it("feeds time through the advance it is given, and stops when the fight ends", () => {
    const driver = manualDriver();
    const target = runner({ driver });
    target.run();
    assert.equal(driver.advance(Infinity), "finished");
    assert.equal(target.state, "finished");
    assert.deepEqual(driver.calls, ["start", "stop"]);
    assert.deepEqual(target.result, runFight({ seed: 1, duration: SHORT }));
  });

  it("can run the whole fight inside start, the way a Node host does", () => {
    const changes = [];
    const driver = {
      start: (advance) => advance(Infinity),
      stop() {},
    };
    const target = runner({ driver });
    target.onStateChange(({ from, to }) => changes.push(`${from}>${to}`));
    target.run();
    assert.equal(target.state, "finished");
    assert.deepEqual(changes, ["idle>running", "running>finished"]);
    assert.deepEqual(target.result, runFight({ seed: 1, duration: SHORT }));
  });

  it("stops the driver of a fight with no length", () => {
    const driver = manualDriver();
    runner({ driver, duration: 0 }).run();
    assert.deepEqual(driver.calls, ["start", "stop"]);
  });

  it("must have start and stop", () => {
    for (const driver of [null, {}, { start() {} }, { stop() {} }, "x"]) {
      assert.throws(() => runner({ driver }), TypeError);
    }
  });
});

describe("SimRunner options", () => {
  it("needs an options object with a seed", () => {
    for (const options of [undefined, null, [], "seed", 1]) {
      assert.throws(() => new SimRunner(options), RangeError);
    }
    for (const seed of [undefined, 1.5, "1", NaN, null]) {
      assert.throws(() => new SimRunner({ seed }), {
        name: "RangeError",
        message: `A seed must be an integer; got ${typeof seed === "string" ? JSON.stringify(seed) : String(seed)}.`,
      });
    }
  });

  it("rejects an option it does not have, so a misspelling cannot run the default", () => {
    assert.throws(() => runner({ confg: {} }), /no option "confg"/);
    assert.throws(() => runner({ steps: 1 }), RangeError);
  });

  it("rejects a duration that is not a finite number of seconds, 0 or more", () => {
    for (const duration of [-1, NaN, Infinity, "10", null]) {
      assert.throws(() => runner({ duration }), RangeError);
    }
    assert.doesNotThrow(() => runner({ duration: 0 }));
  });

  it("validates the config and the build in it when the runner is made", () => {
    assert.throws(() => runner({ config: { nope: 1 } }), RangeError);
    assert.throws(
      () => runner({ config: { talents: { bogus: 1 } } }),
      RangeError,
    );
    // A partial build is legal since #190; Precision on row 2 with no point
    // above it breaks the row gating.
    const lone = Object.keys(referenceBuild())[0];
    assert.doesNotThrow(() => runner({ config: { talents: { [lone]: 1 } } }));
    assert.throws(
      () => runner({ config: { talents: { "combat.precision": 3 } } }),
      { name: "RangeError", message: /"combat\.precision" is on row 2/ },
    );
    assert.throws(
      () =>
        runner({
          config: { talents: { [lone]: 2 }, talentLevel: 10 },
        }),
      {
        name: "RangeError",
        message: /config\.talentLevel 10 allows at most 1/,
      },
    );
  });

  it("keeps its own copy of the config", () => {
    const config = { character: { attackPower: 1000 } };
    const target = runner({ config });
    const expected = runFight({ seed: 1, duration: SHORT, config });
    config.character.attackPower = 1;
    target.run();
    assert.deepEqual(runToEnd(target), expected);
    const copy = target.config;
    copy.character.attackPower = 2;
    assert.equal(target.config.character.attackPower, 1000);
  });

  it("rejects advance() seconds that are not a number of 0 or more", () => {
    const target = inState("running");
    for (const seconds of [-1, NaN, "1", undefined, null]) {
      assert.throws(() => target.advance(seconds), RangeError);
    }
    // Checked in every state, so a bug does not hide until the state is right.
    assert.throws(() => runner().advance(-1), RangeError);
  });
});

describe("SimRunner interface", () => {
  it("exposes states, controls, time and a result, and no steps or frames", () => {
    const names = Object.getOwnPropertyNames(SimRunner.prototype).sort();
    assert.deepEqual(names, [
      "advance",
      "config",
      "constructor",
      "duration",
      // The engine's name, "legacy" or "events" (#198): a string, not an
      // engine object.
      "engine",
      "fight",
      "on",
      "onError",
      "onStateChange",
      "pause",
      "reset",
      "result",
      "resume",
      "run",
      "seed",
      "state",
      "stop",
      "time",
    ]);
    const target = runner();
    assert.deepEqual(Object.keys(target), [], "no engine on the instance");
    // `fight` is the one engine handle (#153): the live page's feed reads the
    // rogue and simulation through it. It has no step or frame either.
    for (const name of [...names, ...Object.keys(target)]) {
      assert.doesNotMatch(name, /step|frame/i);
      if (name !== "fight") {
        assert.doesNotMatch(name, /simulation|fight|rogue/i);
      }
    }
  });

  it("emits only { from, to } and holds no engine object in the result", () => {
    const target = runner();
    const events = [];
    target.onStateChange((event) => events.push(event));
    target.run();
    runToEnd(target);
    for (const event of events) {
      assert.deepEqual(Object.keys(event).sort(), ["from", "to"]);
    }
    assert.deepEqual(
      Object.keys(target.result).sort(),
      Object.keys(runFight({ seed: 1, duration: SHORT })).sort(),
    );
  });
});

describe("SimRunner fight (#153)", () => {
  it("is the running fight's rogue and simulation, null when idle or finished", () => {
    const target = runner({ seed: 8 });
    assert.equal(target.fight, null, "idle before run");
    target.run();
    const fight = target.fight;
    assert.ok(Object.isFrozen(fight));
    assert.deepEqual(Object.keys(fight), ["rogue", "simulation"]);
    assert.ok(fight.simulation instanceof Simulation);
    assert.equal(fight.simulation.rogue, fight.rogue);
    target.advance(1);
    assert.equal(fight.simulation.currentTime, target.time, "the live one");
    target.pause();
    assert.equal(target.fight.simulation, fight.simulation, "paused keeps it");
    target.resume();
    runToEnd(target);
    assert.equal(target.fight, null, "finished");
    assert.equal(fight.simulation.currentTime, SHORT, "references outlive it");
    target.run();
    assert.notEqual(target.fight.simulation, fight.simulation, "new per run");
    target.stop();
    assert.equal(target.fight, null, "stopped");
    target.run();
    target.reset();
    assert.equal(target.fight, null, "reset");
  });
});

describe("SimRunner result and advance(duration) (#158)", () => {
  it("returns the same result object on every read, not a copy, until the next run", () => {
    const target = runner({ seed: 6 });
    target.run();
    target.advance(Infinity);
    const result = target.result;
    assert.equal(target.result, result, "the same object");
    assert.equal(
      Object.isFrozen(result),
      false,
      "not frozen: read-only by contract",
    );
    target.run();
    assert.equal(target.result, null);
    target.advance(Infinity);
    assert.notEqual(target.result, result, "a new one per finished run");
    assert.deepEqual(target.result, result);
  });

  for (const { seed, duration, config } of CASES) {
    it(`finishes in one advance(duration) call (seed ${seed}, ${duration} s)`, () => {
      const target = new SimRunner({ seed, duration, config });
      target.run();
      assert.equal(target.advance(duration), "finished");
      assert.deepEqual(target.result, runFight({ seed, duration, config }));
    });
  }

  // A legacy fixed-step artefact, so it names legacy: the default is the
  // event core since #199. Legacy until #200.
  it("can end a step short after many small calls, and the next call finishes the same fight", () => {
    const duration = 10;
    const target = runner({ seed: 2, duration, engine: "legacy" });
    target.run();
    let given = 0;
    for (let frame = 0; frame < duration * 60; frame += 1) {
      target.advance(1 / 60);
      given += 1 / 60;
    }
    assert.ok(given >= duration, "the host's own sum reached the length");
    // The carry's float sum fell just under the last step.
    assert.equal(target.state, "running");
    assert.equal(target.time, duration - k("sim.fixedStep"));
    assert.equal(target.advance(1 / 60), "finished");
    assert.deepEqual(
      target.result,
      runFight({ seed: 2, duration, engine: "legacy" }),
    );
  });
});
