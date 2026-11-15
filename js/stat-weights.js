// Stat weights (issue #281). A pure driver: it builds configs and runs them
// through the existing batch path. It draws no random numbers of its own.
// Fight i of every variant uses the batch seed, so the fights share random
// numbers (deriveSeed inside the batch runner).
//
// coordinator call 15 Nov (James delegated):
// - hit stays a central ±2% even when the reference build straddles the 9%
//   yellow cap
// - one-sided rows (a side that would leave the stat's limits) compare that
//   one side with base, and progress counts only the variants that run
// - the attack-power equivalent is a point estimate with no interval
// - weapon DPS +2 is applied to the weapons as configured, daggers included
// - "1 batch vs N worker chunks" is read as runner slice size and the worker
//   path versus the main-thread path, not as several workers at once

import { k } from "../data/constants.js";
import { normalizeConfig } from "./sim-config.js";
import { BatchRunner, runBatch } from "./batch-runner.js";

const percentPoints = (step) => step / k("statWeights.onePercent");

// Config step, and how many "points" that step is. Crit, hit and haste are
// per 1 percentage point. Attack power is per 1 AP. Weapon DPS is per 1
// weapon-DPS point.
const ROWS = [
  {
    id: "attackPower",
    kind: "character",
    field: "attackPower",
    step: () => k("statWeights.attackPower"),
    points: () => k("statWeights.attackPower"),
    signs: [1],
  },
  {
    id: "mainHand",
    kind: "weapon",
    hand: "mainHand",
    step: () => k("statWeights.weaponDps"),
    points: () => k("statWeights.weaponDps"),
    signs: [1],
  },
  {
    id: "offHand",
    kind: "weapon",
    hand: "offHand",
    step: () => k("statWeights.weaponDps"),
    points: () => k("statWeights.weaponDps"),
    signs: [1],
  },
  {
    id: "crit",
    kind: "character",
    field: "critChance",
    step: () => k("statWeights.crit"),
    points: () => percentPoints(k("statWeights.crit")),
    signs: [1, -1],
  },
  {
    id: "hit",
    kind: "character",
    field: "bonusHitChance",
    step: () => k("statWeights.hit"),
    points: () => percentPoints(k("statWeights.hit")),
    signs: [1, -1],
  },
  {
    id: "haste",
    kind: "character",
    field: "haste",
    step: () => k("statWeights.haste"),
    points: () => percentPoints(k("statWeights.haste")),
    signs: [1, -1],
  },
];

function limitsFor(row) {
  if (row.kind === "weapon") {
    return { min: 0 };
  }
  if (row.field === "attackPower") {
    return { min: 0 };
  }
  return { min: 0, max: 1 };
}

function inRange(value, limits) {
  if (value < limits.min) {
    return false;
  }
  if (limits.max !== undefined && value > limits.max) {
    return false;
  }
  return true;
}

function applySide(base, row, sign) {
  const next = globalThis.structuredClone(base);
  const step = row.step();
  if (row.kind === "weapon") {
    const weapon = next.weapons[row.hand];
    const add = sign * step * weapon.speed;
    weapon.min += add;
    weapon.max += add;
    return next;
  }
  next.character[row.field] += sign * step;
  return next;
}

function currentValue(base, row) {
  if (row.kind === "weapon") {
    return base.weapons[row.hand].min;
  }
  return base.character[row.field];
}

// coordinator call 15 Nov (James delegated): a fight with no off hand does
// not run an off-hand weapon-DPS variant. The row is reported, not measured.
export const OFF_HAND_NOT_MEASURED = "Not measured: no off hand";

function weaponMissing(base, row) {
  return row.kind === "weapon" && base.weapons[row.hand] == null;
}

// The variants that will actually run, in order, including base. Does not
// mutate `config`. A config that omits a field is read as that field's default
// (normalizeConfig). A side that would pass a limit is left out.
export function statWeightVariants(config) {
  const base = normalizeConfig(config);
  const jobs = [{ id: "base", row: null, sign: 0, config: base }];
  for (const row of ROWS) {
    if (weaponMissing(base, row)) {
      continue;
    }
    const limits = limitsFor(row);
    const value = currentValue(base, row);
    for (const sign of row.signs) {
      const step = row.step();
      const moved =
        row.kind === "weapon"
          ? value + sign * step * base.weapons[row.hand].speed
          : value + sign * step;
      if (!inRange(moved, limits)) {
        continue;
      }
      if (row.kind === "character" && row.field !== "attackPower") {
        // The other end of a chance or of haste (max) is checked on the
        // moved value. Weapon max damage has no upper limit; min and max
        // both move by the same amount, so the range stays valid.
      }
      jobs.push({
        id: row.id,
        sign,
        points: row.points(),
        config: normalizeConfig(applySide(base, row, sign)),
      });
    }
  }
  return jobs;
}

// 95% interval of the paired per-fight difference, in DPS per point.
// diff = high[i] - low[i]. Half-width = z × sd / √n / delta, sample sd (n − 1).
export function pairedDpsPerPoint(low, high, delta) {
  if (
    low === null ||
    high === null ||
    typeof low.length !== "number" ||
    typeof high.length !== "number"
  ) {
    throw new TypeError("pairedDpsPerPoint takes two lists of per-fight DPS.");
  }
  const n = low.length;
  if (high.length !== n || n <= 1) {
    throw new RangeError(
      `pairedDpsPerPoint needs two samples of the same length, at least 2. Got ${n} and ${high.length}.`,
    );
  }
  if (!(typeof delta === "number" && delta > 0 && Number.isFinite(delta))) {
    throw new RangeError(
      `pairedDpsPerPoint delta must be a finite number above 0. Got ${delta}.`,
    );
  }
  let sum = 0;
  const diffs = new Array(n);
  for (let i = 0; i < n; i++) {
    diffs[i] = high[i] - low[i];
    sum += diffs[i];
  }
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i += 1) {
    const d = diffs[i] - mean;
    ss += d * d;
  }
  const sd = Math.sqrt(ss / (n - 1));
  const z = k("statWeights.z");
  return {
    dpsPerPoint: mean / delta,
    ci: (z * sd) / Math.sqrt(n) / delta,
  };
}

function runSliced(options, slice) {
  const runner = new BatchRunner(options);
  runner.run();
  let state = runner.state;
  while (state === "running") {
    state = runner.advance(slice);
  }
  return runner.result;
}

async function runOne({ client, slice, signal, batch }) {
  if (client) {
    if (signal !== undefined) {
      const abort = () => client.cancel();
      if (signal.aborted) {
        return { cancelled: true };
      }
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await client.run(batch);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    }
    return client.run(batch);
  }
  if (slice !== undefined && slice !== Infinity) {
    return runSliced({ ...batch, signal }, slice);
  }
  return runBatch({ ...batch, signal });
}

function assemble(baseDps, jobs, samples) {
  const byRow = new Map();
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    if (job.id === "base") {
      continue;
    }
    const bucket = byRow.get(job.id) ?? {
      sides: new Map(),
      points: job.points,
    };
    bucket.sides.set(job.sign, samples[i]);
    byRow.set(job.id, bucket);
  }
  const rows = {};
  let apPerPoint = null;
  const bareOffHand = jobs[0]?.config?.weapons?.offHand == null;
  for (const row of ROWS) {
    if (row.id === "offHand" && bareOffHand) {
      rows.offHand = { reason: OFF_HAND_NOT_MEASURED };
      continue;
    }
    const bucket = byRow.get(row.id);
    if (bucket === undefined) {
      continue;
    }
    const plus = bucket.sides.get(1);
    const minus = bucket.sides.get(-1);
    let weight;
    if (plus !== undefined && minus !== undefined) {
      weight = pairedDpsPerPoint(
        minus,
        plus,
        bucket.points * bucket.sides.size,
      );
    } else if (plus !== undefined) {
      weight = pairedDpsPerPoint(baseDps, plus, bucket.points);
    } else {
      weight = pairedDpsPerPoint(minus, baseDps, bucket.points);
    }
    rows[row.id] = weight;
    if (row.id === "attackPower") {
      apPerPoint = weight.dpsPerPoint;
    }
  }
  for (const row of Object.values(rows)) {
    if (typeof row.reason === "string") {
      continue;
    }
    row.apEquivalent =
      apPerPoint === null || apPerPoint === 0
        ? null
        : row.dpsPerPoint / apPerPoint;
  }
  return rows;
}

// Run the variants one after another. `client` is a BatchClient (browser or
// a test). With no client, Node uses runBatch, or BatchRunner slices when
// `slice` is a finite count. Cancel (aborted signal, or a batch that returns
// cancelled) drops whatever finished and resolves to null.
//
// onProgress({ completed, total }) counts variants, not fights. total is the
// number that will run (9 at the default haste of 0: base, AP, both weapons,
// crit ±, hit ±, haste +).
export function statWeightFightCount(options = {}) {
  if (options.iterations !== undefined) {
    return options.iterations;
  }
  return options.precise
    ? k("statWeights.preciseIterations")
    : k("statWeights.iterations");
}

export async function statWeights(options = {}) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("statWeights takes an options object.");
  }
  const {
    config,
    seed,
    iterations,
    precise = false,
    duration,
    client,
    slice,
    signal,
    onProgress,
  } = options;
  const count = statWeightFightCount({ iterations, precise });
  const jobs = statWeightVariants(config);
  const total = jobs.length;
  const samples = [];
  for (let i = 0; i < jobs.length; i += 1) {
    if (signal !== undefined && signal.aborted) {
      return null;
    }
    const result = await runOne({
      client,
      slice,
      signal,
      batch: {
        seed,
        iterations: count,
        duration,
        config: jobs[i].config,
      },
    });
    if (result === undefined || result.cancelled) {
      return null;
    }
    samples.push(result.dps);
    if (onProgress !== undefined) {
      onProgress({ completed: i + 1, total });
    }
  }
  const base = samples[0];
  return {
    seed,
    iterations: count,
    variants: total,
    rows: assemble(base, jobs, samples),
  };
}
