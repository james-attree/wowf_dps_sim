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
  MAX_RUNS,
  TARGET_MS,
  benchmark,
  cli,
  formatReport,
  meetsTarget,
  median,
  parseArgs,
} from "../scripts/bench.mjs";

// Issue #75. The Phase 1 exit criterion is a seeded 5-minute fight in under
// 50 ms (TARGET_MS). npm run bench reports the real number; this test only
// guards against a large regression, with a bound that CI hardware will not
// trip. Timer reads live here and in scripts/bench.mjs, never in js/.
//
// Only one test below depends on real speed: the CI bound, 500 ms for the
// median of 5 fights. The GitHub runner (Node 22.23.3) took about 60 to 65 ms
// per fight, so the 50 ms target itself must never be asserted against a real
// run. Every other test uses a fake clock, a fake fight, a fake benchmark, or a
// target that any machine meets or misses (0 ms, or a million).

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/bench.mjs", import.meta.url));

// How much slower than the target a CI runner may be before this test fails.
const CI_SLACK = 10;
// The most a 5-minute fight may take in this test: 10 times the 50 ms target,
// 500 ms. Measured: about 22 ms warm and 40 ms cold on the development box
// (8 vCPU Xeon, Node 20), and about 60 to 65 ms per fight on the GitHub runner
// (Node 22.23.3; the five fights of this test took 308 to 328 ms in total in
// two CI runs). So the bound is about 8 times the runner's measured time, and
// about 20 times the development box's. A shared runner can stall one run
// (garbage collection, a noisy neighbour), so the test takes the median of
// several runs, not one, and does not bound the slowest run. The bound still
// catches the regressions that matter: a change that makes a 5-minute fight
// cost many times more (per-step work that grows with the length of the fight,
// say), not 20% more. A smaller slowdown shows up in npm run bench and in
// review, not as a flaky test.
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

  it("rejects a run count above MAX_RUNS before timing anything", () => {
    let fights = 0;
    const fight = () => (fights += 1);
    assert.throws(
      () => benchmark({ runs: MAX_RUNS + 1, fight }),
      /at most 1000/,
    );
    assert.equal(fights, 0);
    assert.equal(
      benchmark({ runs: MAX_RUNS, fight, duration: 0 }).runs,
      MAX_RUNS,
    );
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

describe("formatReport and meetsTarget", () => {
  const base = {
    seed: 1,
    duration: 300,
    runs: 3,
    coldMs: 30,
    warmMedianMs: 20,
    slowestMs: 30,
  };

  it("prints the median, the slowest run, and whether the target was met", () => {
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

  it("names the target it was given", () => {
    assert.match(
      formatReport({ ...base, medianMs: 21 }, 20),
      /NOT under the 20 ms target/,
    );
    assert.match(
      formatReport({ ...base, medianMs: 21 }, 21.5),
      /under the 21\.5 ms target/,
    );
  });

  it("meets the target only when the median is strictly under it", () => {
    assert.equal(meetsTarget({ medianMs: 49.9 }), true);
    assert.equal(meetsTarget({ medianMs: 50 }), false);
    assert.equal(meetsTarget({ medianMs: 65 }), false);
    assert.equal(meetsTarget({ medianMs: 0 }, 0), false);
    assert.equal(meetsTarget({ medianMs: 65 }, 100), true);
  });
});

describe("parseArgs", () => {
  it("defaults to DEFAULT_RUNS and TARGET_MS, and reads the flags", () => {
    assert.deepEqual(parseArgs([]), {
      runs: DEFAULT_RUNS,
      targetMs: TARGET_MS,
      help: false,
    });
    assert.equal(parseArgs(["--runs", "7"]).runs, 7);
    assert.equal(parseArgs(["--target-ms", "0"]).targetMs, 0);
    assert.equal(parseArgs(["--target-ms", "12.5"]).targetMs, 12.5);
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
      ["--runs", String(MAX_RUNS + 1)],
      ["--runs", "99999999999"],
    ]) {
      assert.throws(() => parseArgs(bad), /--runs needs a positive integer/);
    }
  });

  it("rejects a target that is not a plain non-negative number", () => {
    for (const bad of [
      ["--target-ms"],
      ["--target-ms", "-1"],
      ["--target-ms", "x"],
      ["--target-ms", "1e1"],
      ["--target-ms", ""],
      ["--target-ms", "Infinity"],
      ["--target-ms", "NaN"],
      ["--target-ms", "5."],
    ]) {
      assert.throws(() => parseArgs(bad), /--target-ms needs a number/);
    }
  });
});

describe("cli exit status", () => {
  // A benchmark that returns a median we choose and times nothing.
  function fakeBench(medianMs) {
    return () => ({
      seed: BENCH_SEED,
      duration: BENCH_DURATION,
      runs: 3,
      timesMs: [medianMs, medianMs, medianMs],
      coldMs: medianMs,
      medianMs,
      warmMedianMs: medianMs,
      slowestMs: medianMs,
    });
  }

  function runCli(argv, medianMs = 20) {
    const out = [];
    const err = [];
    const status = cli(argv, {
      bench: fakeBench(medianMs),
      log: (text) => out.push(text),
      logError: (text) => err.push(text),
    });
    return { status, out: out.join("\n"), err: err.join("\n") };
  }

  it("exits 0 when the median is under the default 50 ms target", () => {
    const { status, out } = runCli([], 49.9);
    assert.equal(status, 0);
    assert.match(out, /under the 50 ms target/);
  });

  it("exits 1 when the median is not under the default 50 ms target", () => {
    // 65 ms is what the GitHub runner measured; the script must fail there.
    for (const medianMs of [50, 65, 500]) {
      const { status, out } = runCli([], medianMs);
      assert.equal(status, 1, String(medianMs));
      assert.match(out, /NOT under the 50 ms target/);
    }
  });

  it("compares with --target-ms instead when it is given", () => {
    assert.equal(runCli(["--target-ms", "100"], 65).status, 0);
    assert.equal(runCli(["--target-ms", "10"], 20).status, 1);
    assert.equal(runCli(["--target-ms", "0"], 0.001).status, 1);
  });

  it("passes --runs on to the benchmark", () => {
    let seen;
    cli(["--runs", "4"], {
      bench: (options) => {
        seen = options;
        return fakeBench(1)();
      },
      log: () => {},
    });
    assert.deepEqual(seen, { runs: 4 });
  });

  it("exits 1 with a message and no report for a bad argument", () => {
    const { status, out, err } = runCli(["--runs", "0"]);
    assert.equal(status, 1);
    assert.equal(out, "");
    assert.match(err, /--runs needs a positive integer/);
    assert.equal(runCli(["--target-ms", "-1"]).status, 1);
  });

  it("prints the help text and exits 0 for --help, without running", () => {
    let ran = false;
    const out = [];
    const status = cli(["--help"], {
      bench: () => {
        ran = true;
      },
      log: (text) => out.push(text),
    });
    assert.equal(status, 0);
    assert.equal(ran, false);
    assert.match(out.join("\n"), /--target-ms N/);
  });
});

describe("npm run bench (the real script, in a child process)", () => {
  // These run real fights but only check the output and the exit status against
  // a target that every machine meets (a million ms) or misses (0 ms).
  const EASY_TARGET = "1000000";

  it("prints the median and the slowest time, and exits 0 for an easy target", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, "--runs", "3", "--target-ms", EASY_TARGET],
      { cwd: root },
    );
    assert.match(stdout, /3 runs, Node v/);
    assert.match(stdout, /median: +\d+\.\d ms \(under the 1000000 ms target\)/);
    assert.match(stdout, /slowest: +\d+\.\d ms/);
    assert.match(stdout, /cold \(first run in this process\)/);
    assert.match(stdout, /warm median/);
  });

  it("exits 1 for a target of 0 ms, and still prints the report", async () => {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [SCRIPT, "--runs", "2", "--target-ms", "0"],
        { cwd: root },
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /NOT under the 0 ms target/);
        assert.match(error.stdout, /slowest: +\d+\.\d ms/);
        return true;
      },
    );
  });

  it("exits with status 1 and a message for a bad argument", async () => {
    for (const args of [
      ["--runs", "0"],
      ["--target-ms", "-1"],
    ]) {
      await assert.rejects(
        execFileAsync(process.execPath, [SCRIPT, ...args], { cwd: root }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /needs a/);
          assert.equal(error.stdout, "");
          return true;
        },
      );
    }
  });
});
