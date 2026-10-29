import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import {
  BATCH_STATES,
  BatchRunner,
  RunningStats,
  deriveSeed,
  runBatch,
} from "../js/batch-runner.js";
import { dataVersion } from "../js/data-version.js";
import { runFight } from "../js/fight.js";
import { normalizeSeed } from "../js/rng.js";
import { normalizeConfig } from "../js/sim-config.js";
import { SimRunner } from "../js/sim-runner.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #144 (S1): the batch runner. These are contract tests: they read
// results, states, events and seeds, never an engine step, so they have to pass
// unchanged on the Phase 3.5 engine. Fights here are short (a few seconds of
// fight each) so the file runs in seconds. The 1,000 x 300 s run is timed by
// hand (see the PR), not by CI.

const FIGHT = 20; // seconds per iteration in these tests
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};

// Counts advance() refuses: not a whole number of 1 or more, and not Infinity.
const BAD_COUNTS = [
  0,
  -1,
  0.5,
  1.5,
  -Infinity,
  NaN,
  "2",
  null,
  undefined,
  2 + Number.EPSILON * 4,
];

afterEach(() => {
  mock.restoreAll();
});

// An independent statement of the documented scheme, with the MurmurHash3
// finalizer's published constants written out, so a change to data/constants.js
// or to the module shows up here.
function fmix32(value) {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
function referenceSeed(base, index) {
  return fmix32(((base >>> 0) ^ fmix32(index + 1)) >>> 0);
}

// Two-pass mean, sample standard deviation and 95% interval: the textbook
// computation, for checking the online one.
function reference(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const stdDev = Math.sqrt(squares / (n - 1));
  const half = (1.959964 * stdDev) / Math.sqrt(n);
  return {
    mean,
    stdDev,
    min: Math.min(...values),
    max: Math.max(...values),
    low: mean - half,
    high: mean + half,
    half,
  };
}

function near(actual, expected, message) {
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} is not ${expected}`,
  );
}

function batch(extra = {}) {
  return runBatch({ seed: 7, iterations: 6, duration: FIGHT, ...extra });
}

// The DPS runFight gives for each iteration of a batch, computed on its own.
function expectedDps(seed, count, duration, config) {
  return Array.from(
    { length: count },
    (_, index) =>
      runFight({ seed: deriveSeed(seed, index), duration, config }).dps,
  );
}

describe("deriveSeed (the documented scheme)", () => {
  it("is mix(base xor mix(index + 1)) with the MurmurHash3 finalizer", () => {
    for (const base of [0, 1, 2, 42, 1234, 4294967295]) {
      for (const index of [0, 1, 2, 3, 10, 999, 99999]) {
        assert.equal(deriveSeed(base, index), referenceSeed(base, index));
      }
    }
  });

  it("gives these seeds (pinned: changing the scheme changes every batch)", () => {
    assert.deepEqual(
      [0, 1, 2, 999].map((index) => deriveSeed(1, index)),
      [1032769583, 924828731, 3791906312, 1992711927],
    );
    assert.deepEqual(
      [0, 1].map((index) => deriveSeed(0, index)),
      [804215951, 3050591713],
    );
  });

  it("wraps the base seed like every seed, and returns an unsigned 32-bit integer", () => {
    assert.equal(deriveSeed(-1, 0), deriveSeed(4294967295, 0));
    assert.equal(deriveSeed(2 ** 32 + 5, 3), deriveSeed(5, 3));
    for (let index = 0; index < 1000; index += 1) {
      const seed = deriveSeed(3, index);
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
      assert.equal(normalizeSeed(seed), seed);
    }
  });

  it("depends on the base seed and the index only", () => {
    assert.equal(deriveSeed(9, 500), deriveSeed(9, 500));
    assert.notEqual(deriveSeed(9, 500), deriveSeed(9, 501));
    assert.notEqual(deriveSeed(9, 500), deriveSeed(10, 500));
  });

  it("never repeats inside a batch, for the largest batch allowed", () => {
    const max = k("batch.maxIterations");
    for (const base of [0, 1, 7, 4294967295, 123456789]) {
      const seen = new Set();
      for (let index = 0; index < max; index += 1) {
        seen.add(deriveSeed(base, index));
      }
      assert.equal(seen.size, max, `base seed ${base} repeated a seed`);
    }
  });

  it("gives different base seeds unrelated batches", () => {
    const count = 20000;
    const first = new Set();
    for (let index = 0; index < count; index += 1) {
      first.add(deriveSeed(1, index));
    }
    for (const other of [2, 3, 1 + 2 ** 16, 4294967295]) {
      let shared = 0;
      for (let index = 0; index < count; index += 1) {
        if (first.has(deriveSeed(other, index))) {
          shared += 1;
        }
      }
      // Two random sets of 20,000 of 2^32 share about 0.1 seeds.
      assert.ok(shared <= 2, `base 1 and ${other} share ${shared} seeds`);
    }
  });

  it("spreads the seeds: about half the bits are set, neighbours are not neighbours", () => {
    const count = 20000;
    let bits = 0;
    let near = 0;
    let previous = deriveSeed(5, 0);
    for (let index = 1; index <= count; index += 1) {
      const seed = deriveSeed(5, index);
      for (let bit = seed; bit > 0; bit >>>= 1) {
        bits += bit & 1;
      }
      if (Math.abs(seed - previous) < 2 ** 16) {
        near += 1;
      }
      previous = seed;
    }
    const mean = bits / count;
    assert.ok(mean > 15.8 && mean < 16.2, `mean set bits ${mean}`);
    // About 1 pair in 2^15 is within 2^16 of its neighbour.
    assert.ok(near < 10, `${near} neighbouring seeds are close`);
  });

  it("refuses an index outside the batch size limit", () => {
    for (const bad of [-1, 1.5, NaN, Infinity, "0", null, undefined]) {
      assert.throws(() => deriveSeed(1, bad), RangeError, String(bad));
    }
    assert.throws(() => deriveSeed(1, k("batch.maxIterations")), RangeError);
    assert.doesNotThrow(() => deriveSeed(1, k("batch.maxIterations") - 1));
    assert.throws(() => deriveSeed(1.5, 0), RangeError);
    assert.throws(() => deriveSeed(undefined, 0), RangeError);
  });
});

describe("RunningStats (Welford) against a reference computation", () => {
  const FIXED = [2, 4, 4, 4, 5, 5, 7, 9];

  it("matches the textbook values on a small fixed set", () => {
    const stats = new RunningStats();
    FIXED.forEach((value) => stats.add(value));
    const summary = stats.summary();
    // Worked by hand: mean 5, squared differences sum to 32, so the sample
    // variance is 32 / 7 and the standard deviation 2.13809...
    assert.equal(summary.count, 8);
    assert.equal(summary.mean, 5);
    near(summary.stdDev, Math.sqrt(32 / 7), "stdDev");
    near(summary.stdDev, 2.138089935299395, "stdDev (digits)");
    assert.equal(summary.min, 2);
    assert.equal(summary.max, 9);
    const half = (1.959964 * Math.sqrt(32 / 7)) / Math.sqrt(8);
    near(summary.ci95.halfWidth, half, "half width");
    near(summary.ci95.low, 5 - half, "low");
    near(summary.ci95.high, 5 + half, "high");
    near(summary.ci95.halfWidth, 1.4815935207541, "half width (digits)");
  });

  it("matches the two-pass computation on awkward sets", () => {
    const sets = [
      [3.25, -1.5, 8, 8, 0.125],
      [0, 0, 0, 1],
      Array.from({ length: 500 }, (_, index) => Math.sin(index) * 40 + 100),
      // A huge offset is where the naive sum-of-squares formula loses digits.
      Array.from({ length: 200 }, (_, index) => 1e9 + (index % 7) * 0.25),
      [-5, -4, -3],
    ];
    for (const values of sets) {
      const stats = new RunningStats();
      values.forEach((value) => stats.add(value));
      const expected = reference(values);
      const summary = stats.summary();
      near(summary.mean, expected.mean, "mean");
      near(summary.stdDev, expected.stdDev, "stdDev");
      assert.equal(summary.min, expected.min);
      assert.equal(summary.max, expected.max);
      near(summary.ci95.low, expected.low, "low");
      near(summary.ci95.high, expected.high, "high");
      near(summary.ci95.halfWidth, expected.half, "half");
      assert.equal(summary.count, values.length);
    }
  });

  it("uses k('batch.confidenceZ') for the interval", () => {
    assert.equal(k("batch.confidenceZ"), 1.959964);
    const stats = new RunningStats();
    [10, 20].forEach((value) => stats.add(value));
    const { ci95, stdDev } = stats.summary();
    near(ci95.halfWidth, (1.959964 * stdDev) / Math.SQRT2, "half width");
  });

  it("says null where a statistic is not defined, never NaN", () => {
    const empty = new RunningStats().summary();
    assert.deepEqual(empty, {
      count: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      ci95: null,
    });
    const one = new RunningStats();
    one.add(-3);
    assert.deepEqual(one.summary(), {
      count: 1,
      mean: -3,
      stdDev: null,
      min: -3,
      max: -3,
      ci95: null,
    });
    const same = new RunningStats();
    [4, 4, 4].forEach((value) => same.add(value));
    assert.deepEqual(same.summary(), {
      count: 3,
      mean: 4,
      stdDev: 0,
      min: 4,
      max: 4,
      ci95: { low: 4, high: 4, halfWidth: 0 },
    });
    assert.equal(new RunningStats().mean, null);
  });

  it("tracks the extremes whichever way the values come", () => {
    for (const values of [
      [1, 2, 3],
      [3, 2, 1],
      [2, 3, 1],
      [-1, -2, -3],
    ]) {
      const stats = new RunningStats();
      values.forEach((value) => stats.add(value));
      assert.equal(stats.summary().min, Math.min(...values));
      assert.equal(stats.summary().max, Math.max(...values));
    }
  });

  it("refuses anything but a finite number, and keeps its state", () => {
    const stats = new RunningStats();
    stats.add(1);
    for (const bad of [NaN, Infinity, -Infinity, "2", null, undefined, {}]) {
      assert.throws(() => stats.add(bad), RangeError, String(bad));
    }
    assert.equal(stats.count, 1);
  });
});

describe("runBatch", () => {
  it("runs each iteration as runFight with the derived seed", () => {
    for (const config of [undefined, TALENTED]) {
      const result = batch({ config });
      const expected = expectedDps(7, 6, FIGHT, config);
      assert.deepEqual(Array.from(result.dps), expected);
      assert.equal(result.dps.length, 6);
    }
  });

  it("summarises those values like the reference computation", () => {
    const result = batch({ iterations: 12 });
    const values = expectedDps(7, 12, FIGHT);
    const expected = reference(values);
    const { summary } = result;
    assert.equal(summary.count, 12);
    near(summary.mean, expected.mean, "mean");
    near(summary.stdDev, expected.stdDev, "stdDev");
    assert.equal(summary.min, expected.min);
    assert.equal(summary.max, expected.max);
    near(summary.ci95.low, expected.low, "low");
    near(summary.ci95.high, expected.high, "high");
    assert.ok(summary.stdDev > 0, "the fights differ");
    assert.ok(summary.min < summary.mean && summary.mean < summary.max);
  });

  it("has the documented shape", () => {
    const config = TALENTED;
    const result = batch({ config });
    assert.deepEqual(Object.keys(result), [
      "seed",
      "iterations",
      "completed",
      "cancelled",
      "duration",
      "dataVersion",
      "config",
      "summary",
      "breakdown",
      "auras",
      "resources",
      "timeline",
      "dps",
    ]);
    assert.equal(result.seed, 7);
    assert.equal(result.iterations, 6);
    assert.equal(result.completed, 6);
    assert.equal(result.cancelled, false);
    assert.equal(result.duration, FIGHT);
    assert.equal(result.dataVersion, dataVersion);
    assert.deepEqual(result.config, normalizeConfig(config));
    assert.deepEqual(Object.keys(result.summary), [
      "count",
      "mean",
      "stdDev",
      "min",
      "max",
      "ci95",
    ]);
    assert.deepEqual(Object.keys(result.summary.ci95), [
      "low",
      "high",
      "halfWidth",
    ]);
    assert.ok(result.dps instanceof Float64Array);
    // Everything but the typed array is plain data.
    const { dps, ...plain } = result;
    assert.deepEqual(JSON.parse(JSON.stringify(plain)), plain);
    assert.equal(dps.length, result.completed);
  });

  it("carries the base seed as an unsigned 32-bit integer", () => {
    assert.equal(batch({ seed: -1 }).seed, 4294967295);
    assert.deepEqual(
      Array.from(batch({ seed: -1 }).dps),
      Array.from(batch({ seed: 4294967295 }).dps),
    );
  });

  it("survives structuredClone and postMessage-style copying", () => {
    const result = batch();
    const copy = structuredClone(result);
    assert.deepEqual(copy, result);
    assert.ok(copy.dps instanceof Float64Array);
  });

  it("holds a copy of the config, not the caller's object", () => {
    const config = { poisons: { mainHand: "instant", offHand: "deadly" } };
    const result = batch({ config });
    config.poisons.mainHand = "deadly";
    assert.equal(result.config.poisons.mainHand, "instant");
    result.config.poisons.mainHand = "wound";
    assert.equal(
      batch({ config: result.config }).config.poisons.mainHand,
      "wound",
    );
  });

  it("does not let a caller change the runner's config through a result", () => {
    const runner = new BatchRunner({
      seed: 3,
      iterations: 2,
      duration: FIGHT,
      config: TALENTED,
    });
    runner.run();
    runner.advance(Infinity);
    const first = runner.result;
    first.config.poisons.mainHand = "wound";
    first.config.talents = {};
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(runner.result.config, normalizeConfig(TALENTED));
    assert.deepEqual(
      Array.from(runner.result.dps),
      Array.from(batch({ seed: 3, iterations: 2, config: TALENTED }).dps),
    );
  });

  it("gives the same result for the same base seed", () => {
    const first = batch({ config: TALENTED });
    const second = batch({ config: TALENTED });
    assert.deepEqual(second, first);
  });

  it("gives different base seeds different results", () => {
    const one = batch({ seed: 1 });
    const two = batch({ seed: 2 });
    assert.notDeepEqual(Array.from(one.dps), Array.from(two.dps));
    assert.notEqual(one.summary.mean, two.summary.mean);
  });

  it("does not repeat an iteration seed: the iterations differ", () => {
    const { dps } = batch({ iterations: 12 });
    assert.equal(new Set(dps).size, 12);
  });

  it("makes a smaller batch the first iterations of a larger one", () => {
    const small = batch({ iterations: 4 });
    const large = batch({ iterations: 9 });
    assert.deepEqual(Array.from(small.dps), Array.from(large.dps.slice(0, 4)));
  });

  it("changes nothing a plain runFight returns afterwards", () => {
    const before = runFight({ seed: 3, duration: FIGHT });
    batch({ config: TALENTED });
    assert.deepEqual(runFight({ seed: 3, duration: FIGHT }), before);
  });

  it("runs one iteration, and a fight with no length", () => {
    const one = batch({ iterations: 1 });
    assert.equal(one.summary.count, 1);
    assert.equal(one.summary.stdDev, null);
    assert.equal(one.summary.ci95, null);
    assert.equal(one.summary.mean, one.dps[0]);
    const zero = batch({ duration: 0 });
    assert.deepEqual(Array.from(zero.dps), [0, 0, 0, 0, 0, 0]);
    assert.equal(zero.summary.stdDev, 0);
  });

  it("takes its defaults from data/constants.js: 1,000 iterations of 300 s", () => {
    const runner = new BatchRunner({ seed: 1 });
    assert.equal(runner.iterations, k("fight.iterations"));
    assert.equal(runner.duration, k("batch.duration"));
    assert.equal(runner.iterations, 1000);
    assert.equal(runner.duration, 300);
    // One default fight length for live and batch mode (#153): the older
    // 180 s fight.duration is gone.
    assert.equal(new SimRunner({ seed: 1 }).duration, 300);
    assert.throws(() => k("fight.duration"));
  });
});

describe("chunking and scheduling do not change the result", () => {
  function chunked(sizes, extra = {}) {
    const runner = new BatchRunner({
      seed: 21,
      iterations: 9,
      duration: FIGHT,
      config: TALENTED,
      ...extra,
    });
    runner.run();
    let turn = 0;
    while (runner.state === "running") {
      runner.advance(sizes[turn % sizes.length]);
      turn += 1;
      assert.ok(turn < 1000, "the batch never finished");
    }
    return runner.result;
  }

  it("gives one result for any way of slicing the iterations", () => {
    const whole = chunked([Infinity]);
    for (const sizes of [[1], [2], [3, 1], [1, 1, 4], [5, Infinity], [100]]) {
      assert.deepEqual(chunked(sizes), whole, JSON.stringify(sizes));
    }
    assert.deepEqual(
      runBatch({ seed: 21, iterations: 9, duration: FIGHT, config: TALENTED }),
      whole,
    );
  });

  it("gives the same result with a progress handler, a state handler and a throwing one", () => {
    const whole = chunked([Infinity]);
    const runner = new BatchRunner({
      seed: 21,
      iterations: 9,
      duration: FIGHT,
      config: TALENTED,
    });
    runner.onProgress(() => {
      throw new Error("a bad handler");
    });
    runner.onError(() => {});
    runner.onProgress(() => {});
    runner.onStateChange(() => {});
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(runner.result, whole);
  });

  it("gives the same result when a driver runs it in slices", () => {
    const whole = chunked([Infinity]);
    const queue = [];
    const driver = {
      start(advance) {
        queue.push(() => advance(2));
      },
      stop() {},
    };
    const runner = new BatchRunner({
      seed: 21,
      iterations: 9,
      duration: FIGHT,
      config: TALENTED,
      driver,
    });
    runner.run();
    let ticks = 0;
    while (runner.state === "running") {
      // The host's timer: one slice per tick, and the page is free between.
      const tick = queue[0];
      assert.ok(tick, "no tick queued");
      assert.equal(runner.completed, 2 * ticks);
      tick();
      ticks += 1;
    }
    assert.equal(ticks, 5);
    assert.deepEqual(runner.result, whole);
  });

  it("a batch asked for fewer iterations repeats the start of a longer one however it is sliced", () => {
    const long = chunked([Infinity]);
    const short = chunked([1], { iterations: 5 });
    assert.deepEqual(Array.from(short.dps), Array.from(long.dps.slice(0, 5)));
  });
});

describe("progress", () => {
  it("reports each iteration in order, with the running mean", () => {
    const seen = [];
    const result = batch({
      iterations: 5,
      onProgress: (progress) => seen.push(progress),
    });
    assert.deepEqual(
      seen.map((progress) => progress.completed),
      [1, 2, 3, 4, 5],
    );
    assert.ok(seen.every((progress) => progress.total === 5));
    const values = Array.from(result.dps);
    seen.forEach((progress, index) => {
      near(
        progress.mean,
        values.slice(0, index + 1).reduce((a, b) => a + b, 0) / (index + 1),
        `mean after ${index + 1}`,
      );
    });
    assert.deepEqual(Object.keys(seen[0]), ["completed", "total", "mean"]);
    assert.ok(Object.isFrozen(seen[0]));
    near(seen[4].mean, result.summary.mean, "last mean");
  });

  it("lets several handlers subscribe, and unsubscribe", () => {
    const runner = new BatchRunner({ seed: 1, iterations: 4, duration: FIGHT });
    const a = [];
    const b = [];
    runner.onProgress(({ completed }) => a.push(completed));
    const off = runner.onProgress(({ completed }) => b.push(completed));
    runner.run();
    runner.advance(2);
    off();
    runner.advance(2);
    assert.deepEqual(a, [1, 2, 3, 4]);
    assert.deepEqual(b, [1, 2]);
  });

  it("sends a handler error to onError and carries on", () => {
    const runner = new BatchRunner({ seed: 1, iterations: 3, duration: FIGHT });
    const errors = [];
    runner.onError(({ error, type }) => errors.push([error.message, type]));
    runner.onProgress(() => {
      throw new Error("boom");
    });
    runner.run();
    runner.advance(Infinity);
    assert.equal(runner.state, "finished");
    assert.equal(runner.result.completed, 3);
    assert.deepEqual(errors, [
      ["boom", "progress"],
      ["boom", "progress"],
      ["boom", "progress"],
    ]);
  });
});

describe("cancellation", () => {
  it("stops between iterations from a progress handler and returns the partial summary", () => {
    const runner = new BatchRunner({
      seed: 5,
      iterations: 10,
      duration: FIGHT,
    });
    runner.onProgress(({ completed }) => {
      if (completed === 4) {
        runner.cancel();
      }
    });
    runner.run();
    runner.advance(Infinity);
    assert.equal(runner.state, "cancelled");
    const { result } = runner;
    assert.equal(result.cancelled, true);
    assert.equal(result.completed, 4);
    assert.equal(result.iterations, 10);
    assert.equal(result.dps.length, 4);
    assert.equal(result.summary.count, 4);
    // It is exactly the first four iterations of the whole batch.
    const prefix = runBatch({ seed: 5, iterations: 4, duration: FIGHT });
    assert.deepEqual(Array.from(result.dps), Array.from(prefix.dps));
    assert.deepEqual(result.summary, prefix.summary);
  });

  it("stops on an aborted signal, read before each iteration", () => {
    const controller = new globalThis.AbortController();
    let runs = 0;
    const result = runBatch({
      seed: 5,
      iterations: 10,
      duration: FIGHT,
      signal: controller.signal,
      onProgress: ({ completed }) => {
        runs = completed;
        if (completed === 3) {
          controller.abort();
        }
      },
    });
    assert.equal(runs, 3, "no iteration began after the abort");
    assert.equal(result.cancelled, true);
    assert.equal(result.completed, 3);
    assert.equal(result.summary.count, 3);
    assert.equal(result.dps.length, 3);
  });

  it("accepts any object with an `aborted` flag as the signal", () => {
    const signal = { aborted: false };
    const result = runBatch({
      seed: 5,
      iterations: 8,
      duration: FIGHT,
      signal,
      onProgress: ({ completed }) => {
        signal.aborted = completed >= 2;
      },
    });
    assert.equal(result.completed, 2);
    assert.equal(result.cancelled, true);
  });

  it("is cancelled with nothing done when the signal was already aborted", () => {
    const result = runBatch({
      seed: 5,
      iterations: 8,
      duration: FIGHT,
      signal: { aborted: true },
    });
    assert.equal(result.cancelled, true);
    assert.equal(result.completed, 0);
    assert.equal(result.dps.length, 0);
    assert.deepEqual(result.summary, {
      count: 0,
      mean: null,
      stdDev: null,
      min: null,
      max: null,
      ci95: null,
    });
    assert.equal(result.dataVersion, dataVersion);
  });

  it("is cancelled by run() itself when the signal is already aborted, and stops the driver", () => {
    const calls = [];
    const runner = new BatchRunner({
      seed: 5,
      iterations: 8,
      duration: FIGHT,
      signal: { aborted: true },
      driver: {
        start() {
          calls.push("start");
        },
        stop() {
          calls.push("stop");
        },
      },
    });
    runner.run();
    assert.equal(runner.state, "cancelled");
    assert.equal(runner.result.completed, 0);
    assert.deepEqual(calls, ["start", "stop"]);
  });

  it("cancels at once from outside, between two slices", () => {
    const runner = new BatchRunner({
      seed: 5,
      iterations: 10,
      duration: FIGHT,
    });
    runner.run();
    runner.advance(3);
    assert.equal(runner.state, "running");
    runner.cancel();
    assert.equal(runner.state, "cancelled");
    assert.equal(runner.result.completed, 3);
    // More time to a cancelled batch does nothing.
    assert.equal(runner.advance(Infinity), "cancelled");
    assert.equal(runner.result.completed, 3);
    assert.equal(runner.completed, 3);
  });

  it("does not call a batch cancelled whose last iteration finished first", () => {
    const signal = { aborted: false };
    const result = runBatch({
      seed: 5,
      iterations: 3,
      duration: FIGHT,
      signal,
      onProgress: ({ completed }) => {
        signal.aborted = completed === 3;
      },
    });
    assert.equal(result.cancelled, false);
    assert.equal(result.completed, 3);
  });

  it("runs a fresh, whole batch after a cancel", () => {
    const runner = new BatchRunner({ seed: 5, iterations: 5, duration: FIGHT });
    runner.run();
    runner.advance(2);
    runner.cancel();
    runner.run();
    assert.equal(runner.completed, 0);
    assert.equal(runner.result, null);
    runner.advance(Infinity);
    assert.deepEqual(
      runner.result,
      runBatch({ seed: 5, iterations: 5, duration: FIGHT }),
    );
  });

  it("stops the driver on cancel and ignores its later calls", () => {
    let advance;
    const calls = [];
    const runner = new BatchRunner({
      seed: 5,
      iterations: 6,
      duration: FIGHT,
      driver: {
        start(fn) {
          advance = fn;
          calls.push("start");
        },
        stop() {
          calls.push("stop");
        },
      },
    });
    runner.run();
    advance(2);
    runner.cancel();
    assert.deepEqual(calls, ["start", "stop"]);
    advance(100);
    assert.equal(runner.result.completed, 2);
  });
});

describe("states", () => {
  const ACTIONS = ["run", "cancel", "reset"];
  const TABLE = {
    run: { idle: "running", finished: "running", cancelled: "running" },
    cancel: { running: "cancelled" },
    reset: {
      idle: "idle",
      running: "idle",
      finished: "idle",
      cancelled: "idle",
    },
  };

  function inState(state) {
    const runner = new BatchRunner({ seed: 2, iterations: 3, duration: FIGHT });
    if (state === "idle") {
      return runner;
    }
    runner.run();
    if (state === "finished") {
      runner.advance(Infinity);
    } else if (state === "cancelled") {
      runner.cancel();
    }
    assert.equal(runner.state, state);
    return runner;
  }

  it("lists the states in the order a batch goes through them", () => {
    assert.deepEqual(BATCH_STATES, [
      "idle",
      "running",
      "finished",
      "cancelled",
    ]);
  });

  for (const state of BATCH_STATES) {
    for (const action of ACTIONS) {
      const target = TABLE[action][state];
      it(`${action}() while ${state} ${target ? `goes to ${target}` : "throws and changes nothing"}`, () => {
        const runner = inState(state);
        const changes = [];
        runner.onStateChange(({ from, to }) => changes.push(`${from}>${to}`));
        const result = runner.result;
        const completed = runner.completed;
        if (target === undefined) {
          assert.throws(
            () => runner[action](),
            new RegExp(
              `BatchRunner.${action}\\(\\) is not allowed while ${state}\\.`,
            ),
          );
          assert.equal(runner.state, state);
          assert.deepEqual(changes, []);
          assert.equal(runner.result, result);
          assert.equal(runner.completed, completed);
          return;
        }
        runner[action]();
        assert.equal(runner.state, target);
        assert.deepEqual(
          changes,
          state === target ? [] : [`${state}>${target}`],
        );
      });
    }
  }

  it("names where an action is allowed in its error", () => {
    assert.throws(
      () => inState("idle").cancel(),
      /It is allowed while running\./,
    );
    assert.throws(
      () => inState("running").run(),
      /It is allowed while idle or finished or cancelled\./,
    );
  });

  it("reports state changes in order, and the new state is in place", () => {
    const runner = new BatchRunner({ seed: 2, iterations: 3, duration: FIGHT });
    const seen = [];
    runner.onStateChange(({ from, to }) => seen.push([from, to, runner.state]));
    runner.run();
    runner.advance(Infinity);
    runner.run();
    runner.cancel();
    runner.reset();
    assert.deepEqual(seen, [
      ["idle", "running", "running"],
      ["running", "finished", "finished"],
      ["finished", "running", "running"],
      ["running", "cancelled", "cancelled"],
      ["cancelled", "idle", "idle"],
    ]);
  });

  it("clears the result on run and reset", () => {
    const runner = inState("finished");
    assert.ok(runner.result);
    runner.reset();
    assert.equal(runner.result, null);
    assert.equal(runner.completed, 0);
    runner.run();
    runner.advance(Infinity);
    assert.ok(runner.result);
    runner.run();
    assert.equal(runner.result, null);
  });

  it("does nothing on advance() unless running, and rejects a bad count", () => {
    const runner = inState("idle");
    assert.equal(runner.advance(5), "idle");
    assert.equal(runner.completed, 0);
    runner.run();
    for (const bad of BAD_COUNTS) {
      assert.throws(() => runner.advance(bad), RangeError, String(bad));
    }
    assert.equal(runner.state, "running");
    assert.equal(runner.completed, 0);
    assert.equal(runner.advance(1), "running");
    assert.equal(runner.completed, 1);
  });

  // Kira's #166 QA item (2): advance(0.5) never started a fight, so a loop
  // that called it spun for ever. A count is a whole number of 1 or more, or
  // Infinity, in every state, with an error that says so.
  it("rejects a count that is not a whole number of 1 or more, or Infinity, in every state", () => {
    for (const state of BATCH_STATES) {
      const runner = inState(state);
      for (const bad of BAD_COUNTS) {
        assert.throws(
          () => runner.advance(bad),
          {
            name: "RangeError",
            message: `BatchRunner.advance needs a whole number of iterations, 1 or more, or Infinity. Got ${String(bad)}.`,
          },
          `${state} ${String(bad)}`,
        );
      }
      assert.equal(runner.state, state);
    }
  });

  it("throws at once for a driver that hands over a fraction, instead of spinning", () => {
    let calls = 0;
    const runner = new BatchRunner({
      seed: 3,
      iterations: 2,
      duration: FIGHT,
      driver: {
        start(advance) {
          calls += 1;
          assert.throws(() => advance(0.5), RangeError);
        },
        stop() {},
      },
    });
    runner.run();
    assert.equal(calls, 1);
    assert.equal(runner.state, "running");
    assert.equal(runner.completed, 0);
  });

  it("banks time given from a handler for the call that is running", () => {
    const runner = new BatchRunner({ seed: 2, iterations: 8, duration: FIGHT });
    const seen = [];
    runner.onProgress(({ completed }) => {
      if (completed === 1) {
        runner.advance(2);
        // Banked, not run inside the handler.
        seen.push(runner.completed);
      }
    });
    runner.run();
    runner.advance(2);
    assert.deepEqual(seen, [1]);
    // 2 given, 1 used, and 2 more banked: 1 + 3 iterations in all.
    assert.equal(runner.completed, 4);
    assert.equal(runner.state, "running");
  });

  it("can be run again from finished and gives the same result", () => {
    const runner = inState("finished");
    const first = runner.result;
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(runner.result, first);
    assert.notEqual(runner.result, first);
  });
});

describe("the driver", () => {
  it("is started on entering running and stopped on leaving it, once each", () => {
    const calls = [];
    const runner = new BatchRunner({
      seed: 2,
      iterations: 4,
      duration: FIGHT,
      driver: {
        start(advance) {
          assert.equal(typeof advance, "function");
          calls.push("start");
        },
        stop() {
          calls.push("stop");
        },
      },
    });
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(calls, ["start", "stop"]);
    runner.run();
    runner.reset();
    assert.deepEqual(calls, ["start", "stop", "start", "stop"]);
  });

  it("is not stopped twice: a batch that finished and is reset", () => {
    const calls = [];
    const runner = new BatchRunner({
      seed: 2,
      iterations: 2,
      duration: FIGHT,
      driver: {
        start() {
          calls.push("start");
        },
        stop() {
          calls.push("stop");
        },
      },
    });
    runner.run();
    runner.advance(Infinity);
    runner.reset();
    runner.reset();
    assert.deepEqual(calls, ["start", "stop"]);
  });

  it("can run the whole batch inside start()", () => {
    const states = [];
    const runner = new BatchRunner({
      seed: 2,
      iterations: 4,
      duration: FIGHT,
      driver: {
        start(advance) {
          advance(Infinity);
        },
        stop() {},
      },
    });
    runner.onStateChange(({ to }) => states.push(to));
    runner.run();
    assert.equal(runner.state, "finished");
    assert.deepEqual(states, ["running", "finished"]);
    assert.deepEqual(
      runner.result,
      runBatch({ seed: 2, iterations: 4, duration: FIGHT }),
    );
  });

  it("is stopped, and the batch left idle, when an iteration throws", () => {
    const calls = [];
    const runner = new BatchRunner({
      seed: 2,
      iterations: 5,
      duration: FIGHT,
      driver: {
        start() {
          calls.push("start");
        },
        stop() {
          calls.push("stop");
        },
      },
    });
    const original = SimRunner.prototype.advance;
    let count = 0;
    mock.method(SimRunner.prototype, "advance", function (seconds) {
      count += 1;
      if (count === 6) {
        throw new Error("engine failed");
      }
      return original.call(this, seconds);
    });
    runner.run();
    assert.throws(() => runner.advance(Infinity), /engine failed/);
    assert.equal(runner.state, "idle");
    assert.equal(runner.result, null);
    assert.equal(runner.completed, 0);
    assert.deepEqual(calls, ["start", "stop"]);
    mock.restoreAll();
    runner.run();
    runner.advance(Infinity);
    assert.equal(runner.state, "finished");
  });
});

describe("options", () => {
  it("refuses what is not an options object", () => {
    for (const bad of [undefined, null, 5, "seed", [], [1]]) {
      assert.throws(() => new BatchRunner(bad), RangeError, String(bad));
      assert.throws(() => runBatch(bad), RangeError, String(bad));
    }
  });

  it("refuses an option it does not know, naming it", () => {
    assert.throws(
      () => runBatch({ seed: 1, iteratons: 4 }),
      /no option "iteratons"\. Options: seed, iterations, duration, config, signal, driver, onProgress\./,
    );
    assert.throws(() => runBatch({ seed: 1, confg: {} }), RangeError);
  });

  it("needs an integer seed", () => {
    for (const bad of [undefined, 1.5, NaN, "1", null]) {
      assert.throws(
        () => new BatchRunner({ seed: bad, iterations: 2, duration: 1 }),
        RangeError,
        String(bad),
      );
    }
  });

  it("needs a whole number of iterations from 1 to the limit", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, "5", null]) {
      assert.throws(
        () => new BatchRunner({ seed: 1, iterations: bad }),
        /whole number of iterations from 1 to 100000/,
        String(bad),
      );
    }
    assert.throws(
      () =>
        new BatchRunner({ seed: 1, iterations: k("batch.maxIterations") + 1 }),
      RangeError,
    );
    assert.doesNotThrow(
      () => new BatchRunner({ seed: 1, iterations: k("batch.maxIterations") }),
    );
  });

  it("needs a finite duration of 0 or more", () => {
    for (const bad of [-1, NaN, Infinity, "5", null]) {
      assert.throws(
        () => new BatchRunner({ seed: 1, iterations: 2, duration: bad }),
        /finite fight duration/,
        String(bad),
      );
    }
  });

  it("checks the config, and the talent build in it, where it is written", () => {
    assert.throws(
      () => new BatchRunner({ seed: 1, iterations: 2, config: { nope: 1 } }),
      RangeError,
    );
    assert.throws(
      () =>
        new BatchRunner({
          seed: 1,
          iterations: 2,
          config: { talents: { ranks: { "not-a-talent": 5 } } },
        }),
    );
  });

  it("checks the signal, driver and handler", () => {
    for (const bad of [null, 5, {}, { aborted: "no" }]) {
      assert.throws(
        () => new BatchRunner({ seed: 1, iterations: 2, signal: bad }),
        /signal must be an AbortSignal/,
        JSON.stringify(bad),
      );
    }
    for (const bad of [null, {}, { start() {} }, { stop() {} }, 5]) {
      assert.throws(
        () => new BatchRunner({ seed: 1, iterations: 2, driver: bad }),
        /driver must be an object with start\(advance\) and stop\(\)/,
        JSON.stringify(bad),
      );
    }
    assert.throws(
      () => new BatchRunner({ seed: 1, iterations: 2, onProgress: 5 }),
      TypeError,
    );
    const runner = new BatchRunner({ seed: 1, iterations: 2 });
    assert.throws(() => runner.onProgress("x"), TypeError);
    assert.throws(() => runner.onStateChange(null), TypeError);
  });

  it("takes no driver in runBatch", () => {
    assert.throws(
      () =>
        runBatch({
          seed: 1,
          iterations: 2,
          driver: { start() {}, stop() {} },
        }),
      /takes no driver/,
    );
  });

  it("exposes the settings it was given", () => {
    const runner = new BatchRunner({
      seed: -1,
      iterations: 3,
      duration: 12.5,
      config: TALENTED,
    });
    assert.equal(runner.seed, 4294967295);
    assert.equal(runner.iterations, 3);
    assert.equal(runner.duration, 12.5);
    assert.deepEqual(runner.config, normalizeConfig(TALENTED));
    runner.config.poisons.mainHand = "wound";
    assert.deepEqual(runner.config, normalizeConfig(TALENTED));
  });
});

describe("the interface", () => {
  it("names no step and no frame, and the result has none", () => {
    const names = [
      ...Object.getOwnPropertyNames(BatchRunner.prototype),
      ...Object.getOwnPropertyNames(RunningStats.prototype),
    ];
    assert.deepEqual(
      names.filter((name) => /step|frame|tick/i.test(name)),
      [],
    );
    const result = batch();
    const keys = JSON.stringify([
      Object.keys(result),
      Object.keys(result.summary),
    ]);
    assert.doesNotMatch(keys, /step|frame|tick/i);
  });

  it("reaches the engine only through SimRunner, and reads no clock or platform source", async () => {
    const source = await readFile(
      new URL("../js/batch-runner.js", import.meta.url),
      "utf8",
    );
    const imports = [
      ...source.matchAll(/^import\b[^;]*? from "([^"]+)";$/gm),
    ].map((match) => match[1]);
    assert.deepEqual(imports.sort(), [
      "../data/constants.js",
      "./ability-breakdown.js",
      "./damage-timeline.js",
      "./data-version.js",
      "./event-stream.js",
      "./fight-metrics.js",
      "./rng.js",
      "./running-stats.js",
      "./sim-config.js",
      "./sim-runner.js",
    ]);
    for (const banned of [
      /\bDate\b/,
      /performance\./,
      /Math\.random/,
      /setTimeout/,
      /queueMicrotask/,
      /\bPromise\b/,
      /\bawait\b/,
      /\.simulation\b/,
      /createFight|runFight|fightResult/,
    ]) {
      assert.doesNotMatch(
        source.replace(/\/\/.*$/gm, ""),
        banned,
        String(banned),
      );
    }
  });

  it("does not touch the fight of a SimRunner in the page's hands", () => {
    // Two runners share nothing: a batch in between changes neither's result.
    const mine = new SimRunner({ seed: 4, duration: FIGHT });
    mine.run();
    mine.advance(7);
    batch({ seed: 4 });
    mine.advance(Infinity);
    assert.deepEqual(mine.result, runFight({ seed: 4, duration: FIGHT }));
  });
});
