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
// The roadmap's exit criterion. The median must stay under it.
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

export function formatReport(result) {
  const verdict =
    result.medianMs < TARGET_MS
      ? `under the ${TARGET_MS} ms target`
      : `NOT under the ${TARGET_MS} ms target`;
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

Usage: npm run bench [-- --runs N]

  --runs N   How many fights to time (a positive integer, default ${DEFAULT_RUNS}).
  --help     Show this text.

Exits with status 1 when the median is not under ${TARGET_MS} ms.`;

export function parseArgs(argv) {
  const options = { runs: DEFAULT_RUNS, help: false };
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

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  const result = benchmark({ runs: options.runs });
  console.log(formatReport(result));
  if (result.medianMs >= TARGET_MS) {
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  main();
}
