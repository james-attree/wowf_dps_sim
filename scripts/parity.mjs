import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { runFight } from "../js/fight.js";
import { GOLDEN_CASES } from "./golden-update.mjs";

// Parity harness (E11, #192). It runs two named engines over seeds 1 to N for
// the golden configs and reports, per case, the mean and standard deviation of
// DPS for each, the per-ability mean damage and casts, and the 95% confidence
// interval of the DPS difference. Phase 3.5 builds a new engine next to the
// legacy one (docs/phase-3.5-engine-rewrite.md); #199 uses this harness as its
// gate. The engines are "legacy" (the step loop) and "events" (the event core,
// js/core/, #197 and #198). The same engine on both sides must give a
// difference of exactly 0 (test/parity.test.js), which proves the harness. See
// "Parity harness" in docs/mechanics.md.
//
//   npm run parity                                   legacy vs legacy, 200 seeds
//   npm run parity -- --seeds 20 --cases five-minute-seed-1-300s --duration 10
//   npm run parity -- --engine events --against legacy --duration 300 --gate 2
//   npm run parity -- --engine legacy --against legacy --json
//
// Nothing here changes a fight or writes a file.

// An engine runs one fight and returns a runFight-shaped result (dps and
// abilities are what the harness reads). A new engine is added here by name.
// "events" is runFight's engine option (#198): the same fight on the event
// core. The default engine of runFight is still legacy until #199's flip.
export const ENGINES = Object.freeze({
  legacy: ({ seed, duration, config }) =>
    runFight({ seed, duration, config, engine: "legacy" }),
  events: ({ seed, duration, config }) =>
    runFight({ seed, duration, config, engine: "events" }),
});

export const DEFAULT_ENGINE = "legacy";
export const DEFAULT_SEEDS = 200;
// More seeds than this in one invocation is a typo: 1,000 seeds of every case
// take a few minutes per engine.
export const MAX_SEEDS = 10000;
export const CONFIDENCE = 0.95;
// --duration overrides every chosen case's own duration (#199 gates at 300 s;
// a 3,600 s run is its drift check, so that is the longest).
export const MAX_DURATION = 3600;
// The gate compares |A - B| / B with the limit allowing this many percentage
// points of floating-point error, so a difference of exactly the limit passes
// whichever side of B it is on: 0.98 x 144.52 against 144.52 computes as
// 2.000000000000007%, and 1.02 x B as 1.9999999999999962% (#213 QA). No real
// difference is this close to the limit without being at it.
export const GATE_TOLERANCE = 1e-9;

// Whether a case's |A - B| / B percentage passes a gate of `gate` percent.
export function withinGate(relativePercent, gate) {
  return relativePercent <= gate + GATE_TOLERANCE;
}

// Frozen all the way down: an engine gets its own copy of a case's config
// (compareCase), and the cases themselves are never changed in place.
export function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Scripted golden cases whose script the harness leaves off, by golden case
// name: the name the parity case runs under, which says it has no script, and
// the reason the report prints. Such a case runs its config at its duration,
// with the engine's own rotation.
//
// scripted-finishers-seed-68-50s: its script (scripts/scripted-fight.mjs)
// hooks Rogue.prototype.castRotation, which both engines call since #197, so
// either engine can run it on its own seed. But it was written for seed 68: on
// seeds 1 to 200 it runs to its 50 s end with casts still waiting on 79 of
// them on legacy and 70 on events (#199), and runScriptedFight throws for
// those. So it cannot be averaged over seeds 1 to 200. Before the legacy engine is
// deleted (#200), this case needs a script that finishes on every seed from 1
// to 200, or James agrees to retire it from parity. Its golden fixture (seed
// 68) is unaffected.
//
// Every scripted golden case must be listed here and every listed case must be
// scripted: parityCases throws otherwise, and test/parity.test.js pins this list.
export const SCRIPT_LEFT_OFF = deepFreeze({
  "scripted-finishers-seed-68-50s": {
    as: "finishers-50s-without-script",
    reason:
      "its script was written for seed 68 and does not finish on 79 of seeds 1 to 200 on legacy (70 on events)",
  },
});

// Parity-only cases: not golden cases, so they have no fixture and nothing
// else runs them. dot-hemorrhage-rupture-120s puts DoT tick timing under the
// gate (#213): a 49-point Subtlety/Assassination/Combat build with Hemorrhage,
// and a rotation that keeps Rupture up at five combo points, builds with
// Hemorrhage, and spends any other five-point finisher on Eviscerate.
// test/parity.test.js checks that legacy casts both and that Rupture deals
// damage.
//
// partial-build-8-points-300s is #199's partial-build config: the 8-point
// build of test/partial-builds.test.js (#190), with the default rotation. A
// selected build without Blade Flurry or Adrenaline Rush locks them, so the
// rotation falls through to Sinister Strike and Slice and Dice; #199's
// abilityGranted change must keep that.
export const PARITY_ONLY_CASES = deepFreeze([
  {
    name: "dot-hemorrhage-rupture-120s",
    duration: 120,
    config: {
      talents: {
        "assassination.malice": 5,
        "assassination.ruthlessness": 3,
        "assassination.improved-slice-and-dice": 3,
        "assassination.relentless-strikes": 1,
        "assassination.lethality": 5,
        "combat.improved-eviscerate": 3,
        "combat.improved-sinister-strike": 2,
        "combat.puncturing-wounds": 3,
        "combat.precision": 3,
        "subtlety.opportunity": 2,
        "subtlety.camouflage": 3,
        "subtlety.dirty-tricks": 2,
        "subtlety.improved-ambush": 3,
        "subtlety.initiative": 3,
        "subtlety.ghostly-strike": 1,
        "subtlety.improved-distract": 1,
        "subtlety.serrated-blades": 3,
        "subtlety.heightened-senses": 2,
        "subtlety.hemorrhage": 1,
      },
      rotation: {
        schemaVersion: 1,
        name: "Hemorrhage and Rupture",
        rules: [
          {
            action: "rupture",
            conditions: [
              { type: "comboPoints", op: ">=", value: 5 },
              { type: "debuffRemaining", debuff: "rupture", op: "<", value: 1 },
            ],
          },
          {
            action: "eviscerate",
            conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
          },
          {
            action: "hemorrhage",
            conditions: [
              { type: "abilityUnlocked", ability: "hemorrhage" },
              { type: "comboPoints", op: "<", value: 5 },
            ],
          },
        ],
      },
    },
  },
  {
    name: "partial-build-8-points-300s",
    duration: 300,
    config: {
      talents: {
        "combat.improved-eviscerate": 3,
        "combat.improved-sinister-strike": 2,
        "combat.precision": 3,
      },
    },
  },
]);

// Golden cases the gate does not run, by golden case name, with the golden
// case that has the same config and is run instead (#199). The gate runs one
// case per distinct config: with --duration every case runs for the same
// length, so two cases with one config differ only by the seeds' draws, and
// over seeds 1 to N those are the same fights. Without --duration a trimmed
// case would only have run for less time. short-seed-1-10s,
// other-seed-12345-90s and scripted-finishers-seed-68-50s (its script left
// off, so the default config) all run the default config, as
// five-minute-seed-1-300s does. Their golden fixtures are unaffected.
//
// A trimmed case must name a run case with a deep-equal config, and two run
// cases must not share a config: parityCases throws otherwise, and
// test/parity.test.js pins this list.
export const SAME_CONFIG_AS = deepFreeze({
  "short-seed-1-10s": "five-minute-seed-1-300s",
  "other-seed-12345-90s": "five-minute-seed-1-300s",
  "scripted-finishers-seed-68-50s": "five-minute-seed-1-300s",
});

// The parity cases: each golden case (scripts/golden-update.mjs) by name, with
// its config and duration (a scripted one under its SCRIPT_LEFT_OFF name, with
// the reason), less those SAME_CONFIG_AS trims, then the parity-only cases.
export function parityCases(
  goldenCases,
  leftOff = SCRIPT_LEFT_OFF,
  parityOnly = PARITY_ONLY_CASES,
  sameConfigAs = SAME_CONFIG_AS,
) {
  for (const name of Object.keys(leftOff)) {
    const found = goldenCases.find((c) => c.name === name);
    if (found === undefined || found.script === undefined) {
      throw new RangeError(
        `SCRIPT_LEFT_OFF lists "${name}", which is not a scripted golden case. Remove it from the list.`,
      );
    }
  }
  for (const [name, kept] of Object.entries(sameConfigAs)) {
    const trimmed = goldenCases.find((c) => c.name === name);
    const run = goldenCases.find((c) => c.name === kept);
    if (
      trimmed === undefined ||
      run === undefined ||
      Object.hasOwn(sameConfigAs, kept) ||
      !isDeepStrictEqual(trimmed.config, run.config)
    ) {
      throw new RangeError(
        `SAME_CONFIG_AS trims "${name}" for "${kept}", which is not a golden case that is run with the same config.`,
      );
    }
  }
  const cases = [
    ...goldenCases
      .filter(({ name }) => !Object.hasOwn(sameConfigAs, name))
      .map(({ name, duration, config, script }) => {
        if (script === undefined) {
          return { name, golden: name, duration, config, scriptLeftOff: null };
        }
        if (!Object.hasOwn(leftOff, name)) {
          throw new RangeError(
            `Golden case "${name}" is scripted, and the parity harness cannot run a script. Add it to SCRIPT_LEFT_OFF with the reason, or give the harness a way to run it.`,
          );
        }
        const { as, reason } = leftOff[name];
        return {
          name: as,
          golden: name,
          duration,
          config,
          scriptLeftOff: reason,
        };
      }),
    ...parityOnly.map(({ name, duration, config }) => ({
      name,
      golden: null,
      duration,
      config,
      scriptLeftOff: null,
    })),
  ];
  const names = cases.map(({ name }) => name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    throw new RangeError(`Two parity cases are named "${repeated}".`);
  }
  cases.forEach((a, index) => {
    const b = cases
      .slice(index + 1)
      .find((other) => isDeepStrictEqual(a.config, other.config));
    if (b !== undefined) {
      throw new RangeError(
        `Parity cases "${a.name}" and "${b.name}" have the same config. Trim one in SAME_CONFIG_AS.`,
      );
    }
  });
  return deepFreeze(cases);
}

// The default fight is five-minute-seed-1-300s: the default config at 300 s.
export const PARITY_CASES = parityCases(GOLDEN_CASES);

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

// An engine result the harness can read: a finite dps, and abilities as an
// object of { damage, casts } with finite numbers. Anything else would give a
// NaN mean or a silent 0, so it stops the run.
export class EngineResultError extends Error {
  constructor(message) {
    super(message);
    this.name = "EngineResultError";
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function checkResult(result, { engine, name, seed }) {
  const where = `Engine "${engine}" on ${name}, seed ${seed}`;
  if (result === null || typeof result !== "object") {
    throw new EngineResultError(
      `${where} returned ${String(result)}, not a result object.`,
    );
  }
  if (!isFiniteNumber(result.dps)) {
    throw new EngineResultError(
      `${where} returned dps ${String(result.dps)}; it must be a finite number.`,
    );
  }
  const { abilities } = result;
  if (
    abilities === null ||
    typeof abilities !== "object" ||
    Array.isArray(abilities)
  ) {
    throw new EngineResultError(
      `${where} returned abilities ${String(abilities)}; it must be an object of { damage, casts }.`,
    );
  }
  for (const [ability, entry] of Object.entries(abilities)) {
    for (const field of ["damage", "casts"]) {
      if (!isFiniteNumber(entry?.[field])) {
        throw new EngineResultError(
          `${where} returned abilities["${ability}"].${field} ${String(entry?.[field])}; it must be a finite number.`,
        );
      }
    }
  }
  return result;
}

// Whether two results of one seed differ: the DPS, or any ability's casts (an
// ability one result lacks counting as 0 casts).
export function resultsDiffer(x, y) {
  if (x.dps !== y.dps) {
    return true;
  }
  const names = new Set([
    ...Object.keys(x.abilities),
    ...Object.keys(y.abilities),
  ]);
  for (const name of names) {
    if ((x.abilities[name]?.casts ?? 0) !== (y.abilities[name]?.casts ?? 0)) {
      return true;
    }
  }
  return false;
}

// A value as a percentage of B's mean, B being the reference (--against,
// legacy by default). A 0 reference mean gives 0 for a 0 value, Infinity (of
// the value's sign) otherwise.
function percentOf(value, reference) {
  if (value === 0) {
    return 0;
  }
  return reference === 0
    ? Math.sign(value) * Infinity
    : (100 * value) / reference;
}

// What the harness keeps of a checked result: a copy of its dps and
// abilities, taken as the call returns, so an engine that reuses or changes a
// result object after returning it (on a later call) cannot change a seed
// already counted (#213 QA, for #199).
export function copyResult(result) {
  return { dps: result.dps, abilities: structuredClone(result.abilities) };
}

// One case: run both engines on seeds 1..seeds, A then B for each seed, so that
// state left behind by one fight shows up as a difference. Each call gets its
// own options and its own copy of the config, so an engine that changes its
// input cannot change what the other one runs. `duration` (--duration)
// replaces the case's own duration when it is given.
export function compareCase(
  parityCase,
  { engine, against, seeds, engines = ENGINES, gate = null, duration = null },
) {
  const runA = engines[engine];
  const runB = engines[against];
  const a = [];
  const b = [];
  const seconds = duration ?? parityCase.duration;
  const optionsFor = (seed) => ({
    seed,
    duration: seconds,
    config: structuredClone(parityCase.config),
  });
  const run = (fn, seed, name) =>
    copyResult(
      checkResult(fn(optionsFor(seed)), {
        name: parityCase.name,
        seed,
        engine: name,
      }),
    );
  for (let seed = 1; seed <= seeds; seed += 1) {
    a.push(run(runA, seed, engine));
    b.push(run(runB, seed, against));
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
  const difference = pairedDifference(
    a.map(({ dps }) => dps),
    b.map(({ dps }) => dps),
  );
  const reference = summaryB.dpsMean;
  const signedPercent = percentOf(difference.mean, reference);
  const relativePercent = Math.abs(signedPercent);
  return {
    name: parityCase.name,
    duration: seconds,
    scriptLeftOff: parityCase.scriptLeftOff,
    seeds,
    engine: summaryA,
    against: summaryB,
    difference,
    // (mean A - mean B) / mean B, its absolute value (what the gate reads),
    // and the interval, all as percentages of mean B.
    signedDifferencePercent: signedPercent,
    relativeDifferencePercent: relativePercent,
    differenceCiPercent:
      difference.low === null
        ? { low: null, high: null }
        : {
            low: percentOf(difference.low, reference),
            high: percentOf(difference.high, reference),
          },
    gatePassed: gate === null ? null : withinGate(relativePercent, gate),
    seedsDiffering: a.filter((x, index) => resultsDiffer(x, b[index])).length,
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
  gate = null,
  duration = null,
} = {}) {
  if (gate !== null && !(isFiniteNumber(gate) && gate >= 0)) {
    throw new RangeError(
      `gate must be a percentage of at least 0, got ${gate}.`,
    );
  }
  if (
    duration !== null &&
    !(isFiniteNumber(duration) && duration > 0 && duration <= MAX_DURATION)
  ) {
    throw new RangeError(
      `duration must be a number of seconds over 0, at most ${MAX_DURATION}, got ${duration}.`,
    );
  }
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
  const results = chosen.map((parityCase) =>
    compareCase(parityCase, {
      engine,
      against,
      seeds,
      engines,
      gate,
      duration,
    }),
  );
  return {
    engine,
    against,
    seeds,
    duration,
    confidence: CONFIDENCE,
    gate:
      gate === null
        ? null
        : {
            percent: gate,
            failed: results.filter((c) => !c.gatePassed).map((c) => c.name),
          },
    cases: results,
  };
}

function fixed(value, digits = 2) {
  return value === null ? "n/a" : value.toFixed(digits);
}

// A percentage with its sign, so a negative and a positive difference read
// apart at a glance: +0.0330, -0.2170, 0.0000.
function signed(value, digits = 4) {
  if (value === null) {
    return "n/a";
  }
  const text = value.toFixed(digits);
  return value > 0 && !/^0\.0*$/.test(text) ? `+${text}` : text;
}

export function formatReport(report) {
  const { engine, against, seeds } = report;
  const percent = Math.round(report.confidence * 100);
  const lines = [
    `Parity: A ${engine} vs B ${against}, seeds 1 to ${seeds}${report.duration === null || report.duration === undefined ? "" : `, every case at ${report.duration} s`}, Node ${process.version}`,
  ];
  for (const c of report.cases) {
    lines.push(
      "",
      `${c.name} (${c.duration} s${c.scriptLeftOff === null ? "" : ", config only"})`,
      ...(c.scriptLeftOff === null
        ? []
        : [`  script left off: ${c.scriptLeftOff}`]),
      `  DPS A (${engine}): mean ${fixed(c.engine.dpsMean)}, SD ${fixed(c.engine.dpsSd)}`,
      `  DPS B (${against}): mean ${fixed(c.against.dpsMean)}, SD ${fixed(c.against.dpsSd)}`,
      `  difference (A - B): mean ${fixed(c.difference.mean, 4)}, ${percent}% CI [${fixed(c.difference.low, 4)}, ${fixed(c.difference.high, 4)}], ${c.seedsDiffering} of ${c.seeds} seeds differ`,
      `  relative to B: (A - B) / B ${signed(c.signedDifferencePercent)}%, ${percent}% CI [${signed(c.differenceCiPercent.low)}%, ${signed(c.differenceCiPercent.high)}%]; |A - B| / B ${fixed(c.relativeDifferencePercent, 4)}%${c.gatePassed === null ? "" : `, gate ${report.gate.percent}%: ${c.gatePassed ? "pass" : "FAIL"}`}`,
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
  if (report.gate !== null) {
    lines.push(
      "",
      report.gate.failed.length === 0
        ? `Gate ${report.gate.percent}%: every case passes.`
        : `Gate ${report.gate.percent}%: FAIL on ${report.gate.failed.join(", ")}.`,
    );
  }
  return lines.join("\n");
}

export const HELP_TEXT = `Compare two engines over seeds 1 to N on the golden configs.

Usage: npm run parity [-- --engine NAME] [-- --against NAME] [-- --seeds N]
                      [-- --cases A,B] [-- --duration S] [-- --gate PCT]
                      [-- --json]

  --engine NAME   The engine to measure (default ${DEFAULT_ENGINE}). Engines: ${Object.keys(ENGINES).join(", ")}.
  --against NAME  The engine to compare it with (default ${DEFAULT_ENGINE}).
  --seeds N       Seeds 1 to N (a positive integer, at most ${MAX_SEEDS}, default ${DEFAULT_SEEDS}).
  --cases A,B     Only these cases, by name (default: all ${PARITY_CASES.length}).
  --duration S    Run every chosen case for S seconds instead of its own
                  duration (over 0, at most ${MAX_DURATION}; #199 gates at 300).
  --gate PCT      Fail (exit 2) if any case's |mean A - mean B| / mean B is over
                  PCT percent (to within ${GATE_TOLERANCE} of a point, so exactly PCT passes on
                  either side). B is the reference (#199: --against legacy, 2).
  --json          Print the report as JSON instead of text.
  --help          Show this text.

The difference is paired by seed, with a ${Math.round(CONFIDENCE * 100)}% Student t interval, also given,
signed, as a percentage of mean B. The gate is on the point estimate. The same engine on
both sides gives exactly 0. A result without a finite dps, or with abilities
that are not { damage, casts } numbers, stops the run (exit 1).`;

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
    } else if (arg === "--duration") {
      index += 1;
      const text = needValue(argv, index, arg, "a number of seconds");
      if (
        !/^[0-9]+(\.[0-9]+)?$/.test(text) ||
        Number(text) <= 0 ||
        Number(text) > MAX_DURATION
      ) {
        throw new Error(
          `--duration needs a number of seconds over 0, at most ${MAX_DURATION}, such as 300, got "${text}".\n\n${HELP_TEXT}`,
        );
      }
      options.duration = Number(text);
    } else if (arg === "--gate") {
      index += 1;
      const text = needValue(argv, index, arg, "a percentage");
      if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) {
        throw new Error(
          `--gate needs a percentage such as 2 or 0.5, got "${text}".\n\n${HELP_TEXT}`,
        );
      }
      options.gate = Number(text);
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
// the exit status: 1 for a bad argument, engine, case or engine result, 2 when
// --gate is given and a case fails it, otherwise 0.
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
    for (const key of [
      "engine",
      "against",
      "seeds",
      "cases",
      "duration",
      "gate",
    ]) {
      if (options[key] !== undefined) {
        runOptions[key] = options[key];
      }
    }
    report = run(runOptions);
  } catch (error) {
    if (
      !(error instanceof RangeError) &&
      !(error instanceof EngineResultError) &&
      !error.message.includes(HELP_TEXT)
    ) {
      throw error;
    }
    logError(error.message);
    return 1;
  }
  log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.gate !== null && report.gate.failed.length > 0 ? 2 : 0;
}

if (isDirectRun()) {
  process.exitCode = cli(process.argv.slice(2));
}
