import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runFight } from "../js/fight.js";
import {
  BENCH_DURATION,
  BENCH_SEED,
  DEFAULT_RUNS,
  TARGET_MS,
  benchmark,
  formatReport,
  median,
  parseArgs,
} from "../scripts/bench.mjs";

// Issue #75. The Phase 1 exit criterion is a seeded 5-minute fight in under
// 50 ms (TARGET_MS). npm run bench reports the real number; this test only
// guards against a large regression, with a bound that CI hardware will not
// trip. Timer reads live here and in scripts/bench.mjs, never in js/.

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/bench.mjs", import.meta.url));

// How much slower than the target a CI runner may be before this test fails.
const CI_SLACK = 10;
// The most a 5-minute fight may take in this test: 10 times the 50 ms target,
// 500 ms. On the development machine the median is about 22 ms (a cold first
// run is about 40 ms), so the bound has more than 20 times headroom over the
// measured median. A shared CI runner can be several times slower than a
// laptop and can stall one run (garbage collection, a noisy neighbour), so the
// test takes the median of several runs, not one, and does not bound the
// slowest run. The bound still catches the regressions that matter: a change
// that makes a 5-minute fight cost many times more (per-step work that grows
// with the length of the fight, say), not 20% more. A smaller slowdown shows
// up in npm run bench and in review, not as a flaky test.
const CI_BOUND_MS = TARGET_MS * CI_SLACK;
const TEST_RUNS = 5;

describe("benchmark timing", () => {
  it("runs a seeded 5-minute fight within the CI bound", () => {
    const result = benchmark({ runs: TEST_RUNS });
    assert.equal(result.seed, BENCH_SEED);
    assert.equal(result.duration, BENCH_DURATION);
    assert.equal(result.timesMs.length, TEST_RUNS);
    assert.ok(
      result.medianMs < CI_BOUND_MS,
      `median ${result.medianMs.toFixed(1)} ms is not under the ${CI_BOUND_MS} ms CI bound (target ${TARGET_MS} ms); times: ${result.timesMs.map((time) => time.toFixed(1)).join(", ")}`,
    );
  });

  it("keeps the CI bound looser than the target", () => {
    assert.ok(CI_BOUND_MS > TARGET_MS);
    assert.equal(TARGET_MS, 50);
  });

  it("times a 5 minute fight, 300 simulated seconds", () => {
    assert.equal(BENCH_DURATION, 300);
    assert.equal(
      runFight({ seed: BENCH_SEED, duration: BENCH_DURATION }).duration,
      300,
    );
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    assert.equal(median([5]), 5);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([10, 1, 1000, 2, 3]), 3);
  });

  it("does not reorder its input", () => {
    const values = [3, 1, 2];
    median(values);
    assert.deepEqual(values, [3, 1, 2]);
  });

  it("throws a RangeError for no values", () => {
    assert.throws(() => median([]), RangeError);
  });
});

describe("benchmark", () => {
  // A clock that moves by the next number in `steps` every time it is read, so
  // each timed run is one of those numbers.
  function fakeClock(durations) {
    let time = 0;
    let reads = 0;
    return () => {
      const read = reads;
      reads += 1;
      if (read % 2 === 1) {
        time += durations[(read - 1) / 2];
      }
      return time;
    };
  }

  it("reports the median, slowest, cold and warm times", () => {
    const calls = [];
    const result = benchmark({
      runs: 5,
      seed: 7,
      duration: 12,
      now: fakeClock([40, 20, 22, 21, 90]),
      fight: (options) => calls.push(options),
    });
    assert.deepEqual(result.timesMs, [40, 20, 22, 21, 90]);
    assert.equal(result.medianMs, 22);
    assert.equal(result.slowestMs, 90);
    assert.equal(result.coldMs, 40);
    assert.equal(result.warmMedianMs, 21.5);
    // One fight per run, always the same seed and duration.
    assert.deepEqual(calls, Array(5).fill({ seed: 7, duration: 12 }));
  });

  it("has no warm median for a single run", () => {
    const result = benchmark({
      runs: 1,
      now: fakeClock([30]),
      fight: () => {},
    });
    assert.equal(result.medianMs, 30);
    assert.equal(result.warmMedianMs, undefined);
    assert.doesNotMatch(formatReport(result), /warm/);
  });

  it("defaults to the fixed seed, 5 minutes, and DEFAULT_RUNS runs", () => {
    const seen = [];
    const result = benchmark({
      now: fakeClock(Array(DEFAULT_RUNS).fill(1)),
      fight: (options) => seen.push(options),
    });
    assert.equal(result.runs, DEFAULT_RUNS);
    assert.deepEqual(seen[0], { seed: BENCH_SEED, duration: BENCH_DURATION });
    assert.equal(seen.length, DEFAULT_RUNS);
  });

  it("rejects a run count that is not a positive integer", () => {
    for (const runs of [0, -1, 1.5, Number.NaN, "3", null]) {
      assert.throws(() => benchmark({ runs }), RangeError, String(runs));
    }
  });

  it("gives the same fight on every run, whatever the timings", () => {
    const results = [];
    benchmark({
      runs: 3,
      duration: 20,
      fight: (options) => results.push(runFight(options)),
    });
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
  });
});

describe("formatReport", () => {
  it("prints the median, the slowest run, and whether the target was met", () => {
    const base = {
      seed: 1,
      duration: 300,
      runs: 3,
      coldMs: 30,
      warmMedianMs: 20,
      slowestMs: 30,
    };
    const fast = formatReport({ ...base, medianMs: 21.26 });
    assert.match(fast, /median: +21\.3 ms \(under the 50 ms target\)/);
    assert.match(fast, /slowest: +30\.0 ms/);
    assert.match(fast, /cold .*30\.0 ms/);
    assert.match(fast, /warm median .*20\.0 ms/);
    assert.match(fast, new RegExp(`Node ${process.version}`));
    assert.match(
      formatReport({ ...base, medianMs: 50 }),
      /NOT under the 50 ms target/,
    );
  });
});

describe("parseArgs", () => {
  it("defaults to DEFAULT_RUNS and reads --runs and --help", () => {
    assert.deepEqual(parseArgs([]), { runs: DEFAULT_RUNS, help: false });
    assert.equal(parseArgs(["--runs", "7"]).runs, 7);
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });

  it("rejects an unknown flag and a bad run count", () => {
    assert.throws(() => parseArgs(["--write"]), /Unknown argument: --write/);
    for (const bad of [
      ["--runs"],
      ["--runs", "0"],
      ["--runs", "x"],
      ["--runs", "1.5"],
      ["--runs", "-2"],
      ["--runs", "1e1"],
      ["--runs", ""],
    ]) {
      assert.throws(() => parseArgs(bad), /--runs needs a positive integer/);
    }
  });
});

describe("npm run bench", () => {
  it("prints the median and the slowest time", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, "--runs", "3"],
      { cwd: root },
    );
    assert.match(stdout, /3 runs, Node v/);
    assert.match(stdout, /median: +\d+\.\d ms/);
    assert.match(stdout, /slowest: +\d+\.\d ms/);
    assert.match(stdout, /cold \(first run in this process\)/);
  });

  it("exits with status 1 and a message for a bad argument", async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [SCRIPT, "--runs", "0"], { cwd: root }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /--runs needs a positive integer/);
        assert.equal(error.stdout, "");
        return true;
      },
    );
  });
});
