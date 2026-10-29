import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runFight } from "../js/fight.js";
import { GOLDEN_CASES } from "./golden-update.mjs";

// Parity harness (E11, #192). It runs two named engines over seeds 1 to N for
// the golden configs and reports, per case, the mean and standard deviation of
// DPS for each, the per-ability mean damage and casts, and the 95% confidence
// interval of the DPS difference. Phase 3.5 builds a new engine next to the
// legacy one (docs/phase-3.5-engine-rewrite.md); #199 uses this harness as its
// gate. Until the new engine exists, the only engine is "legacy", and legacy
// against legacy must give a difference of exactly 0 (test/parity.test.js),
// which proves the harness. See "Parity harness" in docs/mechanics.md.
//
//   npm run parity                                   legacy vs legacy, 200 seeds
//   npm run parity -- --seeds 20 --cases short-seed-1-10s
//   npm run parity -- --engine legacy --against legacy --json
//
// Nothing here changes a fight or writes a file.

// An engine runs one fight and returns a runFight-shaped result (dps and
// abilities are what the harness reads). A new engine is added here by name.
export const ENGINES = Object.freeze({
  legacy: ({ seed, duration, config }) => runFight({ seed, duration, config }),
});

export const DEFAULT_ENGINE = "legacy";
export const DEFAULT_SEEDS = 200;
// More seeds than this in one invocation is a typo: 1,000 seeds of every case
// take a few minutes per engine.
export const MAX_SEEDS = 10000;
export const CONFIDENCE = 0.95;

// The golden cases' configs and durations (scripts/golden-update.mjs). The
// default fight is five-minute-seed-1-300s: the default config at 300 s.
// The scripted case runs its config (the default) at its duration, without its
// script: the script replaces Rogue.prototype.rotation, which only the legacy
// engine has, and over most seed ranges it does not finish (it was written for
// seed 68), so it cannot run on seeds 1 to N.
export const PARITY_CASES = Object.freeze(
  GOLDEN_CASES.map(({ name, duration, config, script }) =>
    Object.freeze({
      name,
      duration,
      config,
      scriptDropped: script !== undefined,
    }),
  ),
);

export function mean(values) {
  if (values.length === 0) {
    throw new RangeError("mean needs at least one value.");
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

// Sample standard deviation (n - 1). One value has none: null.
export function standardDeviation(values) {
  if (values.length < 2) {
    return null;
  }
  const centre = mean(values);
  let squares = 0;
  for (const value of values) {
    squares += (value - centre) ** 2;
  }
  return Math.sqrt(squares / (values.length - 1));
}

// ln Γ(x) for x > 0 (Lanczos, g = 7, nine terms).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function logGamma(x) {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = LANCZOS[0];
  for (let index = 1; index < LANCZOS.length; index += 1) {
    sum += LANCZOS[index] / (z + index);
  }
  const t = z + 7.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum)
  );
}

// Continued fraction for the regularized incomplete beta (modified Lentz).
function betaFraction(a, b, x) {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = 1 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) {
      break;
    }
  }
  return h;
}

function regularizedBeta(a, b, x) {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaFraction(a, b, x)) / a
    : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

// P(T <= t) for Student's t with `df` degrees of freedom.
export function studentTCdf(t, df) {
  const tail = 0.5 * regularizedBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - tail : tail;
}

// The t with P(T <= t) = p, for 0.5 <= p < 1, by bisection on the CDF.
export function studentTQuantile(p, df) {
  if (!(Number.isInteger(df) && df >= 1)) {
    throw new RangeError(`df must be a positive integer, got ${df}.`);
  }
  if (!(p >= 0.5 && p < 1)) {
    throw new RangeError(`p must be at least 0.5 and under 1, got ${p}.`);
  }
  if (p === 0.5) {
    return 0;
  }
  let low = 0;
  let high = 1;
  // 2^64 is far past any t this script asks for; reaching it means the CDF
  // never got to p.
  for (let doublings = 0; studentTCdf(high, df) < p; doublings += 1) {
    if (doublings >= 64) {
      throw new RangeError(`No t found with P(T <= t) = ${p} for df ${df}.`);
    }
    high *= 2;
  }
  for (let step = 0; step < 200 && high - low > 1e-12; step += 1) {
    const middle = (low + high) / 2;
    if (studentTCdf(middle, df) < p) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

// The difference a - b, paired by seed (both engines run the same seeds): its
// mean, its SD, and the confidence interval mean ± t(1 - α/2, n - 1) · sd / √n.
// Identical inputs give exactly 0 and [0, 0]. Fewer than two pairs give no
// interval (null).
export function pairedDifference(a, b, confidence = CONFIDENCE) {
  if (a.length !== b.length || a.length === 0) {
    throw new RangeError(
      `pairedDifference needs two non-empty lists of the same length, got ${a.length} and ${b.length}.`,
    );
  }
  const differences = a.map((value, index) => value - b[index]);
  const centre = mean(differences);
  const sd = standardDeviation(differences);
  if (sd === null) {
    return { mean: centre, sd: null, low: null, high: null };
  }
  const half =
    (studentTQuantile((1 + confidence) / 2, differences.length - 1) * sd) /
    Math.sqrt(differences.length);
  return { mean: centre, sd, low: centre - half, high: centre + half };
}

// Per-ability means over the fights: every ability any fight used, an ability
// a fight did not use counting as 0 damage and 0 casts for it.
export function abilityMeans(results) {
  const names = [];
  for (const result of results) {
    for (const name of Object.keys(result.abilities)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        damage: mean(results.map((r) => r.abilities[name]?.damage ?? 0)),
        casts: mean(results.map((r) => r.abilities[name]?.casts ?? 0)),
      },
    ]),
  );
}

function engineSummary(results) {
  const dps = results.map(({ dps }) => dps);
  return {
    dpsMean: mean(dps),
    dpsSd: standardDeviation(dps),
    abilities: abilityMeans(results),
  };
}

// One case: run both engines on seeds 1..seeds, A then B for each seed, so that
// state left behind by one fight shows up as a difference.
export function compareCase(
  parityCase,
  { engine, against, seeds, engines = ENGINES },
) {
  const runA = engines[engine];
  const runB = engines[against];
  const a = [];
  const b = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const options = {
      seed,
      duration: parityCase.duration,
      config: parityCase.config,
    };
    a.push(runA(options));
    b.push(runB(options));
  }
  const summaryA = engineSummary(a);
  const summaryB = engineSummary(b);
  const names = [
    ...new Set([
      ...Object.keys(summaryA.abilities),
      ...Object.keys(summaryB.abilities),
    ]),
  ];
  const zero = { damage: 0, casts: 0 };
  return {
    name: parityCase.name,
    duration: parityCase.duration,
    scriptDropped: parityCase.scriptDropped,
    seeds,
    engine: summaryA,
    against: summaryB,
    difference: pairedDifference(
      a.map(({ dps }) => dps),
      b.map(({ dps }) => dps),
    ),
    seedsDiffering: a.filter(({ dps }, index) => dps !== b[index].dps).length,
    abilityDifference: Object.fromEntries(
      names.map((name) => {
        const x = summaryA.abilities[name] ?? zero;
        const y = summaryB.abilities[name] ?? zero;
        return [
          name,
          { damage: x.damage - y.damage, casts: x.casts - y.casts },
        ];
      }),
    ),
  };
}

export function runParity({
  engine = DEFAULT_ENGINE,
  against = DEFAULT_ENGINE,
  seeds = DEFAULT_SEEDS,
  cases = PARITY_CASES.map(({ name }) => name),
  engines = ENGINES,
} = {}) {
  for (const name of [engine, against]) {
    if (!Object.hasOwn(engines, name)) {
      throw new RangeError(
        `Unknown engine "${name}". Engines: ${Object.keys(engines).join(", ")}.`,
      );
    }
  }
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > MAX_SEEDS) {
    throw new RangeError(
      `seeds must be a positive integer, at most ${MAX_SEEDS}, got ${seeds}.`,
    );
  }
  const chosen = cases.map((name) => {
    const found = PARITY_CASES.find((parityCase) => parityCase.name === name);
    if (found === undefined) {
      throw new RangeError(
        `Unknown case "${name}". Cases: ${PARITY_CASES.map((c) => c.name).join(", ")}.`,
      );
    }
    return found;
  });
  return {
    engine,
    against,
    seeds,
    confidence: CONFIDENCE,
    cases: chosen.map((parityCase) =>
      compareCase(parityCase, { engine, against, seeds, engines }),
    ),
  };
}

function fixed(value, digits = 2) {
  return value === null ? "n/a" : value.toFixed(digits);
}

export function formatReport(report) {
  const { engine, against, seeds } = report;
  const percent = Math.round(report.confidence * 100);
  const lines = [
    `Parity: A ${engine} vs B ${against}, seeds 1 to ${seeds}, Node ${process.version}`,
  ];
  for (const c of report.cases) {
    lines.push(
      "",
      `${c.name} (${c.duration} s${c.scriptDropped ? ", config only: the script is not run" : ""})`,
      `  DPS A (${engine}): mean ${fixed(c.engine.dpsMean)}, SD ${fixed(c.engine.dpsSd)}`,
      `  DPS B (${against}): mean ${fixed(c.against.dpsMean)}, SD ${fixed(c.against.dpsSd)}`,
      `  difference (A - B): mean ${fixed(c.difference.mean, 4)}, ${percent}% CI [${fixed(c.difference.low, 4)}, ${fixed(c.difference.high, 4)}], ${c.seedsDiffering} of ${c.seeds} seeds differ`,
      "  per ability (mean damage / mean casts, A | B | A - B):",
    );
    for (const [name, diff] of Object.entries(c.abilityDifference)) {
      const x = c.engine.abilities[name];
      const y = c.against.abilities[name];
      lines.push(
        `    ${name}: ${x ? `${fixed(x.damage)} / ${fixed(x.casts)}` : "none"} | ${y ? `${fixed(y.damage)} / ${fixed(y.casts)}` : "none"} | ${fixed(diff.damage)} / ${fixed(diff.casts)}`,
      );
    }
  }
  return lines.join("\n");
}

export const HELP_TEXT = `Compare two engines over seeds 1 to N on the golden configs.

Usage: npm run parity [-- --engine NAME] [-- --against NAME] [-- --seeds N]
                      [-- --cases A,B] [-- --json]

  --engine NAME   The engine to measure (default ${DEFAULT_ENGINE}). Engines: ${Object.keys(ENGINES).join(", ")}.
  --against NAME  The engine to compare it with (default ${DEFAULT_ENGINE}).
  --seeds N       Seeds 1 to N (a positive integer, at most ${MAX_SEEDS}, default ${DEFAULT_SEEDS}).
  --cases A,B     Only these cases, by golden case name (default: all ${PARITY_CASES.length}).
  --json          Print the report as JSON instead of text.
  --help          Show this text.

The difference is paired by seed, with a ${Math.round(CONFIDENCE * 100)}% Student t interval. The same
engine on both sides gives exactly 0.`;

function needValue(argv, index, flag, what) {
  const text = argv[index];
  if (text === undefined || text.startsWith("--")) {
    throw new Error(`${flag} needs ${what}, got nothing.\n\n${HELP_TEXT}`);
  }
  return text;
}

export function parseArgs(argv) {
  const options = { json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--engine" || arg === "--against") {
      index += 1;
      options[arg.slice(2)] = needValue(argv, index, arg, "an engine name");
    } else if (arg === "--seeds") {
      index += 1;
      const text = needValue(argv, index, arg, "a positive integer");
      // Number("") is 0 and Number("1e1") is 10; accept plain digits only.
      if (
        !/^[0-9]+$/.test(text) ||
        Number(text) < 1 ||
        Number(text) > MAX_SEEDS
      ) {
        throw new Error(
          `--seeds needs a positive integer, at most ${MAX_SEEDS}, got "${text}".\n\n${HELP_TEXT}`,
        );
      }
      options.seeds = Number(text);
    } else if (arg === "--cases") {
      index += 1;
      options.cases = needValue(argv, index, arg, "case names").split(",");
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

// The whole command, with its output passed in so a test can read it. Returns
// the exit status: 1 for a bad argument, engine or case, otherwise 0. The
// harness reports; the pass mark is #199's.
export function cli(
  argv,
  {
    run = runParity,
    log = (text) => console.log(text),
    logError = (text) => console.error(text),
  } = {},
) {
  let options;
  let report;
  try {
    options = parseArgs(argv);
    if (options.help) {
      log(HELP_TEXT);
      return 0;
    }
    const runOptions = {};
    for (const key of ["engine", "against", "seeds", "cases"]) {
      if (options[key] !== undefined) {
        runOptions[key] = options[key];
      }
    }
    report = run(runOptions);
  } catch (error) {
    if (!(error instanceof RangeError) && !error.message.includes(HELP_TEXT)) {
      throw error;
    }
    logError(error.message);
    return 1;
  }
  log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return 0;
}

if (isDirectRun()) {
  process.exitCode = cli(process.argv.slice(2));
}
