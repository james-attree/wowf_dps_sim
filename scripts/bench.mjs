import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runFight } from "../js/fight.js";

// Benchmark for the Phase 1 exit criterion (#75): a seeded 5-minute fight runs
// in Node in under 50 ms. It times runFight with wall-clock reads, which is why
// it lives here and in test/bench.test.js and never under js/ (lint rejects
// performance and Date in every engine file). Nothing in this file changes a
// fight: the same fixed seed and duration are run every time, so the timings
// differ between runs but the result does not.
//
//   npm run bench               20 runs
//   npm run bench -- --runs 50  50 runs
//
// The first run of a fresh process is the "cold" one: the engine is still being
// compiled and its caches are empty. The runs after it are "warm". The median
// is taken over every run, as the issue asks, and the cold run is printed
// separately because it is the slowest and closest to the target.

export const BENCH_SEED = 1;
export const BENCH_DURATION = 300; // 5 simulated minutes
export const DEFAULT_RUNS = 20;
// The roadmap's exit criterion. The median must stay under it. It is a target
// for a development machine, not a CI guarantee: the GitHub runner measured
// 60 to 65 ms per fight, so nothing in the test suite may depend on meeting it.
// `--target-ms` replaces it for one run of the script (the tests use that).
export const TARGET_MS = 50;

export function median(values) {
  if (values.length === 0) {
    throw new RangeError("median needs at least one value.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function checkRuns(runs) {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new RangeError(`runs must be a positive integer, got ${runs}.`);
  }
}

// Time `runs` fights, one after the other, in this process. `now` is the clock
// (milliseconds) and `fight` is what gets timed; both can be replaced in a test.
export function benchmark({
  runs = DEFAULT_RUNS,
  seed = BENCH_SEED,
  duration = BENCH_DURATION,
  now = () => performance.now(),
  fight = runFight,
} = {}) {
  checkRuns(runs);
  const timesMs = [];
  for (let run = 0; run < runs; run += 1) {
    const start = now();
    fight({ seed, duration });
    timesMs.push(now() - start);
  }
  return {
    seed,
    duration,
    runs,
    timesMs,
    coldMs: timesMs[0],
    medianMs: median(timesMs),
    // Undefined for a single run: there is no warm run to take a median of.
    warmMedianMs: runs > 1 ? median(timesMs.slice(1)) : undefined,
    slowestMs: Math.max(...timesMs),
  };
}

function ms(value) {
  return `${value.toFixed(1)} ms`;
}

// True when the median meets the target: strictly under it.
export function meetsTarget(result, targetMs = TARGET_MS) {
  return result.medianMs < targetMs;
}

export function formatReport(result, targetMs = TARGET_MS) {
  const verdict = meetsTarget(result, targetMs)
    ? `under the ${targetMs} ms target`
    : `NOT under the ${targetMs} ms target`;
  const lines = [
    `runFight({ seed: ${result.seed}, duration: ${result.duration} }), ${result.runs} run${result.runs === 1 ? "" : "s"}, Node ${process.version}`,
    `median:  ${ms(result.medianMs)} (${verdict})`,
    `slowest: ${ms(result.slowestMs)}`,
    `cold (first run in this process): ${ms(result.coldMs)}`,
  ];
  if (result.warmMedianMs !== undefined) {
    lines.push(
      `warm median (runs after the first): ${ms(result.warmMedianMs)}`,
    );
  }
  return lines.join("\n");
}

export const HELP_TEXT = `Time a seeded 5-minute fight (runFight) and print the median and slowest run.

Usage: npm run bench [-- --runs N] [-- --target-ms N]

  --runs N       How many fights to time (a positive integer, default ${DEFAULT_RUNS}).
  --target-ms N  The target the median is compared with (a number of
                 milliseconds, 0 or more, default ${TARGET_MS}). Use it to check the
                 output or the exit status without depending on how fast the
                 machine is.
  --help         Show this text.

Exits with status 1 when the median is not under the target (${TARGET_MS} ms unless
--target-ms is given). The ${TARGET_MS} ms target is for a development machine; a
shared CI runner is slower.`;

// Plain decimal digits only: Number("") is 0 and Number("1e1") is 10.
const DECIMAL = /^[0-9]+(?:\.[0-9]+)?$/;

export function parseArgs(argv) {
  const options = { runs: DEFAULT_RUNS, targetMs: TARGET_MS, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--runs") {
      index += 1;
      const text = argv[index];
      // Number("") is 0 and Number("1e1") is 10; accept plain digits only.
      if (text === undefined || !/^[0-9]+$/.test(text) || Number(text) < 1) {
        throw new Error(
          `--runs needs a positive integer, got ${text === undefined ? "nothing" : `"${text}"`}.\n\n${HELP_TEXT}`,
        );
      }
      options.runs = Number(text);
    } else if (arg === "--target-ms") {
      index += 1;
      const text = argv[index];
      if (text === undefined || !DECIMAL.test(text)) {
        throw new Error(
          `--target-ms needs a number of milliseconds, 0 or more, got ${text === undefined ? "nothing" : `"${text}"`}.\n\n${HELP_TEXT}`,
        );
      }
      options.targetMs = Number(text);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${HELP_TEXT}`);
    }
  }
  return options;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

// The whole command, with its output and the benchmark passed in so a test can
// check the exit status without timing anything. Returns the exit status.
export function cli(
  argv,
  {
    bench = benchmark,
    log = (text) => console.log(text),
    logError = (text) => console.error(text),
  } = {},
) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    logError(error.message);
    return 1;
  }
  if (options.help) {
    log(HELP_TEXT);
    return 0;
  }
  const result = bench({ runs: options.runs });
  log(formatReport(result, options.targetMs));
  return meetsTarget(result, options.targetMs) ? 0 : 1;
}

if (isDirectRun()) {
  process.exitCode = cli(process.argv.slice(2));
}
