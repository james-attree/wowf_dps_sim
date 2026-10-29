import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFight, fightResult, runFight } from "../js/fight.js";
import { evaluate } from "../js/rotation-conditions.js";
import { rotationHost } from "../js/rotation-host.js";
import { defaultConfig } from "../js/sim-config.js";
import { SimRunner } from "../js/sim-runner.js";
import { Simulation } from "../js/simulation.js";
import { Rogue } from "../js/rogue.js";

// #191 (E10): the fight's length reaches the rotation. createFight's
// options.duration is the Simulation's fightLength, the Rogue hands it to its
// rotation host, and runFight and SimRunner give it the length they run.
// It is the rotation's only: run(duration) still decides how long a fight is.

const LENGTH = 60;
const LAST = 10;

// Eviscerate only in the last LAST seconds (and only with a combo point to
// spend), Sinister Strike otherwise. No golden rotation reads the fight length.
const LAST_SECONDS = {
  schemaVersion: 1,
  name: "Last seconds",
  rules: [
    {
      action: "eviscerate",
      conditions: [
        { type: "fightTimeRemaining", op: "<", value: LAST },
        { type: "comboPoints", op: ">=", value: 1 },
      ],
    },
    { action: "sinister-strike", conditions: [] },
  ],
};

function config() {
  return { ...defaultConfig(), rotation: LAST_SECONDS };
}

// The time of every Eviscerate cast, from the event stream (the log is capped).
function eviscerateTimes(simulation) {
  const times = [];
  simulation.on("cast", (event) => {
    if (event.ability === "eviscerate") {
      times.push(event.time);
    }
  });
  return times;
}

describe("fightTimeRemaining with a fight length (#191)", () => {
  it("a rule with fightTimeRemaining < 10 fires in the last 10 s, and only then", () => {
    for (const seed of [1, 2, 3]) {
      const fight = createFight(seed, config(), { duration: LENGTH });
      const times = eviscerateTimes(fight.simulation);
      fight.simulation.run(LENGTH);
      assert.ok(times.length > 0, `seed ${seed}: no Eviscerate at the end`);
      for (const time of times) {
        assert.ok(
          time > LENGTH - LAST && time <= LENGTH,
          `seed ${seed}: Eviscerate at ${time}`,
        );
      }
    }
  });

  it("runFight tells the rotation the length it runs", () => {
    const result = runFight({ seed: 1, duration: LENGTH, config: config() });
    const fight = createFight(1, config(), { duration: LENGTH });
    fight.simulation.run(LENGTH);
    assert.deepEqual(result, fightResult(fight));
    const eviscerate = result.abilities.Eviscerate;
    assert.ok(eviscerate !== undefined && eviscerate.casts > 0);
    // Without the length the rule never fires (fightTimeRemaining is Infinity).
    const untold = createFight(1, config());
    untold.simulation.run(LENGTH);
    assert.equal(fightResult(untold).abilities.Eviscerate, undefined);
  });

  it("SimRunner tells the rotation the length it runs, the fight runFight gives", () => {
    for (const chunk of [Infinity, 0.37]) {
      const runner = new SimRunner({
        seed: 2,
        duration: LENGTH,
        config: config(),
      });
      const times = [];
      runner.on("cast", (event) => {
        if (event.ability === "eviscerate") {
          times.push(event.time);
        }
      });
      runner.run();
      let calls = 0;
      while (runner.state === "running") {
        runner.advance(chunk);
        calls += 1;
        assert.ok(calls < 1e6);
      }
      assert.ok(times.length > 0);
      assert.ok(times.every((time) => time > LENGTH - LAST));
      assert.deepEqual(
        runner.result,
        runFight({ seed: 2, duration: LENGTH, config: config() }),
      );
    }
  });

  it("the length is the rotation's only: run(duration) still ends the fight", () => {
    // Told 1000 s, run for 60: the last 10 s never come, so no Eviscerate.
    const told = createFight(1, config(), { duration: 1000 });
    const times = eviscerateTimes(told.simulation);
    told.simulation.run(LENGTH);
    assert.equal(told.simulation.currentTime, LENGTH);
    assert.deepEqual(times, []);
    // Told 60 s, run for 30: the rotation reads 30 s left at the end.
    const short = createFight(1, config(), { duration: LENGTH });
    short.simulation.run(LENGTH / 2);
    assert.equal(short.simulation.currentTime, LENGTH / 2);
    const host = rotationHost(short.rogue, short.simulation, {
      duration: short.simulation.fightLength,
    });
    assert.equal(
      evaluate(
        { type: "fightTimeRemaining", op: "==", value: LENGTH / 2 },
        host.state(),
      ),
      true,
    );
  });
});

describe("fightTimeRemaining with no fight length", () => {
  it("is Infinity, as documented: the rule never fires", () => {
    const fight = createFight(1, config());
    assert.equal(fight.simulation.fightLength, null);
    const times = eviscerateTimes(fight.simulation);
    fight.simulation.run(LENGTH);
    assert.deepEqual(times, []);
    const host = rotationHost(fight.rogue, fight.simulation, {
      duration: fight.simulation.fightLength,
    });
    const state = host.state();
    assert.equal(state.duration, null);
    assert.equal(
      evaluate({ type: "fightTimeRemaining", op: ">", value: 1e300 }, state),
      true,
    );
  });

  it("a Simulation built by hand has none, and null is none", () => {
    assert.equal(new Simulation(new Rogue(), { seed: 1 }).fightLength, null);
    assert.equal(
      createFight(1, undefined, { duration: null }).simulation.fightLength,
      null,
    );
    assert.equal(
      createFight(1, undefined, { duration: 0 }).simulation.fightLength,
      0,
    );
  });

  it("refuses a fight length that is not a finite number of seconds, 0 or more", () => {
    for (const bad of [-1, -0.5, NaN, Infinity, -Infinity, "60", true, {}]) {
      assert.throws(
        () => createFight(1, undefined, { duration: bad }),
        (error) =>
          error instanceof RangeError &&
          /fight length \(createFight's options\.duration\) must be a finite number of seconds, 0 or more, or none\. Got /.test(
            error.message,
          ),
        String(bad),
      );
    }
  });

  it("is createFight's own option: the Rogue still refuses the others it does not know", () => {
    assert.throws(
      () => createFight(1, undefined, { duration: 5, nope: 1 }),
      /Unknown Rogue option "nope"/,
    );
    for (const options of [[], 5, "x", null]) {
      assert.throws(
        () => createFight(1, undefined, options),
        (error) =>
          error instanceof TypeError &&
          error.message === "Rogue options must be an object.",
        String(options),
      );
    }
  });
});

describe("the end-of-fight summary at the duration (#191)", () => {
  it("runFight's fight sends one end event, last, at the duration", () => {
    for (const duration of [LENGTH, 31.4159, 0]) {
      const fight = createFight(3, config(), { duration });
      const types = [];
      const ends = [];
      fight.simulation.on("*", (_event, type) => types.push(type));
      fight.simulation.on("end", (event) => ends.push(event));
      fight.simulation.run(duration);
      assert.equal(ends.length, 1, String(duration));
      assert.equal(ends[0].time, duration);
      assert.equal(types.at(-1), "end");
      assert.equal(ends[0].totalDamage, fight.simulation.damageDone);
    }
  });

  it("SimRunner sends it at the duration, also when run in small pieces", () => {
    for (const chunk of [Infinity, 0.3]) {
      const runner = new SimRunner({
        seed: 3,
        duration: 31.4159,
        config: config(),
      });
      const ends = [];
      runner.on("end", (event) => ends.push(event));
      runner.run();
      let calls = 0;
      while (runner.state === "running") {
        runner.advance(chunk);
        calls += 1;
        assert.ok(calls < 1e6);
      }
      assert.equal(ends.length, 1);
      assert.equal(ends[0].time, 31.4159);
      assert.equal(runner.result.duration, 31.4159);
    }
  });
});
