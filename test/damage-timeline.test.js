import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { BatchRunner, deriveSeed, runBatch } from "../js/batch-runner.js";
import {
  BatchTimeline,
  FightTimeline,
  timelineFromEvents,
  timelineLength,
} from "../js/damage-timeline.js";
import { SimRunner } from "../js/sim-runner.js";

// Issue #148 (S5): the damage timeline behind the damage-over-time chart.
// Contract tests: they read events and batch results, never an engine step,
// so they have to pass unchanged on the Phase 3.5 engine.

const FIGHT = 30; // seconds per fight in these tests

function hit(time, damage) {
  return { type: "hit", time, damage };
}

function fightEvents(seed, duration = FIGHT) {
  const runner = new SimRunner({ seed, duration });
  const events = [];
  runner.on("*", (event) => events.push(event));
  runner.run();
  runner.advance(Infinity);
  return { events, result: runner.result };
}

// A batch run by a driver that hands over `slice` iterations at a time.
function sliced(options, slice) {
  let advance = null;
  const runner = new BatchRunner({
    ...options,
    driver: {
      start(next) {
        advance = next;
      },
      stop() {},
    },
  });
  runner.run();
  while (runner.state === "running") {
    advance(slice);
  }
  return runner;
}

function near(actual, expected, message) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= scale * 1e-12,
    `${message}: ${actual} vs ${expected}`,
  );
}

describe("timelineLength", () => {
  it("is ceil(duration / bucketSeconds)", () => {
    assert.equal(k("timeline.bucketSeconds"), 1);
    assert.equal(timelineLength(300), 300);
    assert.equal(timelineLength(10.3), 11);
    assert.equal(timelineLength(0.5), 1);
    assert.equal(timelineLength(0), 0);
  });

  it("rejects a duration that is not a finite number, 0 or more", () => {
    for (const duration of [-1, NaN, Infinity, "300", undefined]) {
      assert.throws(() => timelineLength(duration), RangeError);
    }
  });
});

describe("FightTimeline", () => {
  it("puts each hit in the bucket its time falls in", () => {
    const summary = timelineFromEvents(
      [
        hit(0, 1),
        hit(0.999, 2),
        hit(1, 4),
        hit(2.5, 8),
        hit(3, 16), // exactly the end: the last bucket
        { type: "cast", time: 1, ability: "x" },
        { type: "end", time: 3 },
      ],
      { duration: 3 },
    );
    assert.deepEqual(Object.keys(summary), [
      "bucketSeconds",
      "duration",
      "totalDamage",
      "damage",
    ]);
    assert.equal(summary.bucketSeconds, 1);
    assert.equal(summary.duration, 3);
    assert.ok(summary.damage instanceof Float64Array);
    assert.deepEqual(Array.from(summary.damage), [3, 4, 24]);
    assert.equal(summary.totalDamage, 31);
  });

  it("has a part bucket at the end when the duration is not whole", () => {
    const summary = timelineFromEvents([hit(2.2, 5), hit(2.5, 1)], {
      duration: 2.5,
    });
    assert.deepEqual(Array.from(summary.damage), [0, 0, 6]);
  });

  it("has no bucket for a fight of no length, and refuses a hit in it", () => {
    const timeline = new FightTimeline({ duration: 0 });
    assert.deepEqual(Array.from(timeline.summary().damage), []);
    assert.throws(() => timeline.observe(hit(0, 1)), RangeError);
  });

  it("refuses a hit outside the fight or with a bad damage", () => {
    const timeline = new FightTimeline({ duration: 2 });
    for (const time of [-0.001, 2.001, NaN, Infinity, "1", undefined]) {
      assert.throws(
        () => timeline.observe(hit(time, 1)),
        RangeError,
        `${time}`,
      );
    }
    for (const damage of [-1, NaN, Infinity, "1", undefined]) {
      assert.throws(() => timeline.observe(hit(1, damage)), RangeError);
    }
    assert.throws(() => timeline.observe(null), TypeError);
    assert.throws(() => timeline.observe(3), TypeError);
    assert.equal(timeline.summary().totalDamage, 0);
  });

  it("takes only a duration option", () => {
    assert.throws(() => new FightTimeline(), TypeError);
    assert.throws(() => new FightTimeline(null), TypeError);
    assert.throws(() => new FightTimeline({ duration: 1, step: 1 }), {
      name: "RangeError",
      message: 'FightTimeline has no option "step". Options: duration.',
    });
    assert.throws(() => new FightTimeline({}), RangeError);
  });

  it("gives a fresh copy on every summary", () => {
    const timeline = new FightTimeline({ duration: 1 });
    timeline.observe(hit(0, 1));
    const first = timeline.summary();
    first.damage[0] = 99;
    assert.equal(timeline.summary().damage[0], 1);
  });

  it("adds up to the fight's total damage, attached live or from events", () => {
    const runner = new SimRunner({ seed: 11, duration: FIGHT });
    const live = new FightTimeline({ duration: FIGHT });
    const off = live.attach(runner);
    assert.equal(typeof off, "function");
    runner.run();
    runner.advance(Infinity);
    const summary = live.summary();
    assert.equal(summary.damage.length, FIGHT);
    // Added in event order, as the engine adds it: the same number.
    assert.equal(summary.totalDamage, runner.result.totalDamage);
    near(
      summary.damage.reduce((sum, value) => sum + value, 0),
      runner.result.totalDamage,
      "buckets",
    );
    const { events } = fightEvents(11);
    assert.deepEqual(timelineFromEvents(events, { duration: FIGHT }), summary);
  });
});

describe("BatchTimeline", () => {
  const a = timelineFromEvents([hit(0, 10), hit(1, 20), hit(2, 30)], {
    duration: 3,
  });
  const b = timelineFromEvents([hit(0.5, 40), hit(2.9, 2)], { duration: 3 });

  it("gives null series with no fight", () => {
    const batch = new BatchTimeline({ duration: 3 });
    assert.equal(batch.fights, 0);
    assert.deepEqual(batch.summary(), {
      fights: 0,
      bucketSeconds: 1,
      duration: 3,
      length: 3,
      meanTotalDamage: null,
      damage: null,
      cumulative: null,
    });
  });

  it("is the fight itself with one fight", () => {
    const batch = new BatchTimeline({ duration: 3 });
    batch.add(a);
    const summary = batch.summary();
    assert.deepEqual(Array.from(summary.damage), [10, 20, 30]);
    assert.deepEqual(Array.from(summary.cumulative.mean), [10, 30, 60]);
    assert.deepEqual(Array.from(summary.cumulative.min), [10, 30, 60]);
    assert.deepEqual(Array.from(summary.cumulative.max), [10, 30, 60]);
    assert.equal(summary.meanTotalDamage, 60);
  });

  it("means each bucket and keeps the lowest and highest cumulative fight", () => {
    const batch = new BatchTimeline({ duration: 3 });
    batch.add(a);
    batch.add(b);
    const summary = batch.summary();
    assert.deepEqual(Object.keys(summary), [
      "fights",
      "bucketSeconds",
      "duration",
      "length",
      "meanTotalDamage",
      "damage",
      "cumulative",
    ]);
    assert.deepEqual(Object.keys(summary.cumulative), ["mean", "min", "max"]);
    assert.equal(summary.fights, 2);
    assert.deepEqual(Array.from(summary.damage), [25, 10, 16]);
    // a: 10, 30, 60. b: 40, 40, 42.
    assert.deepEqual(Array.from(summary.cumulative.mean), [25, 35, 51]);
    assert.deepEqual(Array.from(summary.cumulative.min), [10, 30, 42]);
    assert.deepEqual(Array.from(summary.cumulative.max), [40, 40, 60]);
    assert.equal(summary.meanTotalDamage, 51);
    // Fresh arrays on every call.
    summary.cumulative.min[0] = -1;
    assert.equal(batch.summary().cumulative.min[0], 10);
  });

  it("refuses a fight of another length or shape", () => {
    const batch = new BatchTimeline({ duration: 3 });
    const other = timelineFromEvents([], { duration: 4 });
    assert.throws(() => batch.add(other), RangeError);
    assert.throws(() => batch.add({ ...a, duration: 2.5 }), RangeError);
    assert.throws(() => batch.add({ ...a, bucketSeconds: 2 }), RangeError);
    assert.throws(
      () => batch.add({ ...a, damage: new Float64Array(2) }),
      RangeError,
    );
    assert.throws(() => batch.add({ ...a, damage: [10, 20, 30] }), TypeError);
    assert.throws(() => batch.add({ ...a, totalDamage: NaN }), TypeError);
    assert.throws(() => batch.add(null), TypeError);
    assert.equal(batch.fights, 0);
    assert.throws(() => new BatchTimeline({ duration: -1 }), RangeError);
  });

  it("sums without losing small values next to big ones", () => {
    const big = timelineFromEvents([hit(0, 1e16)], { duration: 1 });
    const small = timelineFromEvents([hit(0, 1)], { duration: 1 });
    const negativeBig = {
      ...big,
      damage: Float64Array.of(-1e16),
      totalDamage: -1e16,
    };
    const batch = new BatchTimeline({ duration: 1 });
    batch.add(big);
    batch.add(small);
    batch.add(negativeBig);
    // Plain addition would give 0: 1e16 + 1 rounds back to 1e16.
    assert.equal(batch.summary().damage[0], 1 / 3);
    assert.equal(batch.summary().cumulative.mean[0], 1 / 3);
  });

  it("keeps a small value added before a big one (both Neumaier branches)", () => {
    const big = timelineFromEvents([hit(0, 1e16)], { duration: 1 });
    const small = timelineFromEvents([hit(0, 1)], { duration: 1 });
    const negativeBig = {
      ...big,
      damage: Float64Array.of(-1e16),
      totalDamage: -1e16,
    };
    const batch = new BatchTimeline({ duration: 1 });
    // Small first: the big value is the larger, so the other branch keeps
    // the 1.
    batch.add(small);
    batch.add(big);
    batch.add(negativeBig);
    assert.equal(batch.summary().damage[0], 1 / 3);
    assert.equal(batch.summary().cumulative.mean[0], 1 / 3);
  });
});

describe("the batch result's timeline (contract)", () => {
  it("has the fixed length and ends at the mean total damage", async () => {
    const result = await runBatch({ seed: 5, iterations: 12, duration: FIGHT });
    const { timeline } = result;
    assert.equal(timeline.fights, 12);
    assert.equal(timeline.duration, FIGHT);
    assert.equal(timeline.bucketSeconds, k("timeline.bucketSeconds"));
    assert.equal(timeline.length, FIGHT);
    for (const series of [
      timeline.damage,
      timeline.cumulative.mean,
      timeline.cumulative.min,
      timeline.cumulative.max,
    ]) {
      // Plain arrays: the batch result is plain data but for result.dps.
      assert.ok(Array.isArray(series));
      assert.equal(series.length, FIGHT);
    }
    // The last cumulative mean is the mean total damage: the mean DPS times
    // the duration.
    const last = timeline.cumulative.mean[FIGHT - 1];
    near(last, timeline.meanTotalDamage, "mean total");
    near(last, result.summary.mean * FIGHT, "mean DPS x duration");
    const perBucket = timeline.damage.reduce((sum, value) => sum + value, 0);
    near(perBucket, last, "sum of the per-bucket means");
    // Cumulative series never fall, and min <= mean <= max.
    for (let index = 0; index < FIGHT; index += 1) {
      assert.ok(
        timeline.cumulative.min[index] <= timeline.cumulative.mean[index],
      );
      assert.ok(
        timeline.cumulative.mean[index] <= timeline.cumulative.max[index],
      );
      if (index > 0) {
        assert.ok(
          timeline.cumulative.min[index] >= timeline.cumulative.min[index - 1],
        );
      }
    }
    // The lowest and highest final cumulative damage are the slowest and
    // fastest fights.
    near(timeline.cumulative.min[FIGHT - 1], result.summary.min * FIGHT, "min");
    near(timeline.cumulative.max[FIGHT - 1], result.summary.max * FIGHT, "max");
  });

  it("is each fight's own timeline, added in iteration order", async () => {
    const result = await runBatch({ seed: 9, iterations: 4, duration: FIGHT });
    const expected = new BatchTimeline({ duration: FIGHT });
    for (let index = 0; index < 4; index += 1) {
      const { events } = fightEvents(deriveSeed(9, index));
      expected.add(timelineFromEvents(events, { duration: FIGHT }));
    }
    assert.deepEqual(result.timeline, expected.summary());
  });

  it("does not depend on how the batch was sliced", async () => {
    const options = { seed: 21, iterations: 7, duration: FIGHT };
    const whole = await runBatch(options);
    for (const slice of [1, 3]) {
      assert.deepEqual(sliced(options, slice).result.timeline, whole.timeline);
    }
  });

  it("covers the completed fights of a cancelled batch, and none before any", async () => {
    const options = { seed: 3, iterations: 5, duration: FIGHT };
    let advance = null;
    const driver = {
      start(next) {
        advance = next;
      },
      stop() {},
    };
    const runner = new BatchRunner({ ...options, driver });
    runner.run();
    advance(2);
    runner.cancel();
    assert.equal(runner.result.completed, 2);
    assert.equal(runner.result.timeline.fights, 2);
    const two = await runBatch({ ...options, iterations: 2 });
    assert.deepEqual(runner.result.timeline, two.timeline);
    const none = new BatchRunner({ ...options, driver });
    none.run();
    none.cancel();
    assert.equal(none.result.timeline.fights, 0);
    assert.equal(none.result.timeline.cumulative, null);
    assert.equal(none.result.timeline.length, FIGHT);
  });

  it("reads only events: no engine import, no clock, no randomness", async () => {
    const source = await readFile(
      new URL("../js/damage-timeline.js", import.meta.url),
      "utf8",
    );
    const imports = [
      ...source.matchAll(/^import\b[^;]*? from "([^"]+)";$/gm),
    ].map((match) => match[1]);
    assert.deepEqual(imports.sort(), [
      "../data/constants.js",
      "./running-stats.js",
    ]);
    assert.doesNotMatch(source, /\bDate\b|performance\.|Math\.random/);
  });
});
