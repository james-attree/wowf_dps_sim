import { k } from "../data/constants.js";
import { BatchBreakdown, FightBreakdown } from "./ability-breakdown.js";
import { dataVersion } from "./data-version.js";
import { EventStream, createErrorReporter } from "./event-stream.js";
import {
  BatchAuras,
  BatchResources,
  FightAuras,
  FightResources,
} from "./fight-metrics.js";
import { normalizeSeed } from "./rng.js";
import { normalizeConfig } from "./sim-config.js";
import { RunningStats } from "./running-stats.js";
import { SimRunner } from "./sim-runner.js";

// The batch runner (Phase 3, #144, roadmap task S1): N seeded fights of one
// config, and the statistics of their DPS. It has no DOM, reads no clock and
// uses no randomness except through the fights' seeds, so a Node script, the
// page and a Web Worker (#147) can all run it.
//
// It runs every iteration through SimRunner (js/sim-runner.js) and reads the
// fight's result (the plain data runFight returns). It reaches into no engine
// internals, so the Phase 3.5 engine can replace what is under SimRunner and
// leave this module, its contract and its tests as they are. Nothing here
// names a step or a frame. A unit of work is one whole fight: an iteration.
//
// Seeds. Iteration `i` (0-based) of a batch with base seed `s` runs the fight
// of seed deriveSeed(s, i), so iteration `i` is runFight({ seed: deriveSeed(s,
// i), duration, config }), whatever else the batch did before it or in what
// pieces it ran. The scheme is documented at deriveSeed. A batch is its base
// seed: the same base seed, iterations, duration and config give the same
// result, and the iteration count does not change the iterations before it
// (a batch of 100 is the first 100 iterations of a batch of 1,000).
//
// Statistics (RunningStats). Welford's online algorithm: the mean, the sum of
// squared differences, the minimum and the maximum are kept as numbers, so
// memory does not grow with the iteration count. The per-iteration DPS values
// are kept as well, in a Float64Array of one slot per iteration, for the
// histogram (S5, #148). Iterations are added in index order, always, so the
// floating-point result does not depend on how the work was chunked.
//
// The per-ability breakdown (S2, #145, js/ability-breakdown.js). Each
// iteration's fight gets a FightBreakdown subscribed to its "hit" and "cast"
// events, like any other listener, and its summary is added to a
// BatchBreakdown in index order once the fight ends. It changes no fight: a
// subscriber draws no randomness.
//
// The aura uptimes (S3, #146, js/fight-metrics.js) are read the same way: a
// FightAuras on the fight's "aura" and "end" events, added to a BatchAuras in
// index order. The resource waste (#146) is a FightResources on the "end"
// event, which carries what each pool lost to its cap, added to a
// BatchResources in index order.
//
// Running without blocking. A fight takes tens of milliseconds, so a batch of
// 1,000 takes tens of seconds, and a page cannot run it inside one call. The
// work is a BatchRunner, and it follows SimRunner's driver pattern: the host
// hands over work, the runner does not decide when to run.
//
//   - advance(iterations) runs up to that many iterations, then returns. A
//     host calls it from a timer or a message and gives the page the time
//     between calls. advance(Infinity) runs the rest. The host picks the size
//     of a slice, because this module reads no clock. The count is a whole
//     number of 1 or more, or Infinity: anything else is a RangeError.
//   - An injected driver { start(advance), stop() } does that for it: start
//     is called when the runner enters "running" and gets advance, stop when
//     it leaves "running". Without a driver the host calls advance().
//   - runBatch(options) is the whole batch in one call, for Node, tests and
//     scripts. It is a BatchRunner that runs to the end.
//
// Cancelling. cancel() (or an aborted `signal`, an AbortSignal or any object
// with a boolean `aborted`) stops the batch before the next iteration starts.
// An iteration that has begun finishes, so a cancel takes effect within one
// fight (tens of milliseconds). The batch moves to "cancelled" and `result`
// holds the statistics of the iterations that completed, with `cancelled:
// true`. A cancelled batch is a prefix of the batch that was not cancelled.
//
// States and transitions. Every action not listed for a state is invalid.
//
//   state      run()      cancel()     reset()
//   idle       running    -            (stays idle)
//   running    -          cancelled    idle
//   finished   running    -            idle
//   cancelled  running    -            idle
//
// An invalid action throws an Error that names the action and the state and
// changes nothing, as SimRunner does. advance() is not a transition: in any
// state but "running" it does nothing. run() starts a fresh batch, from the
// beginning, from "idle", "finished" or "cancelled".
//
// Events, with the delivery rules of js/event-stream.js (a handler that throws
// cannot stop the batch; the error goes to onError, or is rethrown from a
// microtask):
//
//   onProgress(handler)     handler({ completed, total, mean }) after each
//                           iteration: how many are done, how many were asked
//                           for, and the mean DPS so far. Not throttled: the
//                           host throttles (it has the clock). The `onProgress`
//                           option subscribes one at construction.
//   onStateChange(handler)  handler({ from, to }) after each change, once the
//                           new state is in place.
//
// The result is plain data (see BatchRunner#result), except that `dps` is a
// Float64Array. structuredClone and postMessage carry it. JSON does not (use
// Array.from(result.dps) first).

export { RunningStats };

export const BATCH_STATES = Object.freeze([
  "idle",
  "running",
  "finished",
  "cancelled",
]);

const TRANSITIONS = Object.freeze({
  run: { idle: "running", finished: "running", cancelled: "running" },
  cancel: { running: "cancelled" },
  reset: { idle: "idle", running: "idle", finished: "idle", cancelled: "idle" },
});

const OPTIONS = [
  "seed",
  "iterations",
  "duration",
  "config",
  "signal",
  "driver",
  "onProgress",
];

// The MurmurHash3 32-bit finalizer: a bijection on unsigned 32-bit integers.
function mix(value) {
  const terms = k("batch.seedMix");
  let mixed = value ^ (value >>> terms.shiftA);
  mixed = Math.imul(mixed, terms.multiplyA);
  mixed ^= mixed >>> terms.shiftB;
  mixed = Math.imul(mixed, terms.multiplyB);
  mixed ^= mixed >>> terms.shiftC;
  return mixed >>> 0;
}

// The seed of iteration `index` (0-based) of a batch with base seed `seed`:
//
//   mix(base XOR mix(index + 1))        mix is the MurmurHash3 32-bit finalizer
//                                       (batch.seedMix), an unsigned 32-bit
//                                       result
//
// - Deterministic and independent of order: it depends on the base seed and
//   the index and nothing else, so iterations can run in any chunks, or later
//   on their own.
// - No repeats in a batch. For a fixed base seed, index -> mix(index + 1) is a
//   bijection, xor with the base seed is a bijection, and so is the last mix,
//   so different indexes always give different seeds (for any index below
//   batch.maxIterations, far below 2^32).
// - Different base seeds give unrelated batches. The seeds are not a run of
//   neighbours (the base seed 1 and the base seed 2 share almost no seeds), and
//   a fight's rng does not see a shifted copy of another iteration's draws.
//
// `seed` wraps to an unsigned 32-bit integer like every seed. `index` is a
// whole number from 0 to batch.maxIterations - 1.
export function deriveSeed(seed, index) {
  const base = normalizeSeed(seed);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= k("batch.maxIterations")
  ) {
    throw new RangeError(
      `deriveSeed needs an iteration index from 0 to ${k("batch.maxIterations") - 1}. Got ${index}.`,
    );
  }
  const increment = k("batch.seedMix").increment;
  return mix((base ^ mix(index + increment)) >>> 0);
}

function readIterations(iterations) {
  const max = k("batch.maxIterations");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > max) {
    throw new RangeError(
      `A batch needs a whole number of iterations from 1 to ${max}. Got ${iterations}.`,
    );
  }
  return iterations;
}

function readDuration(duration) {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError(
      `A batch needs a finite fight duration in seconds, 0 or more. Got ${duration}.`,
    );
  }
  return duration;
}

function readSignal(signal) {
  if (
    signal !== undefined &&
    (signal === null || typeof signal.aborted !== "boolean")
  ) {
    throw new TypeError(
      "A batch signal must be an AbortSignal, or an object with a boolean `aborted`.",
    );
  }
  return signal;
}

function readDriver(driver) {
  if (
    driver !== undefined &&
    (driver === null ||
      typeof driver.start !== "function" ||
      typeof driver.stop !== "function")
  ) {
    throw new TypeError(
      "A batch driver must be an object with start(advance) and stop() functions.",
    );
  }
  return driver;
}

export class BatchRunner {
  #seed;
  #iterations;
  #duration;
  #config;
  #signal;
  #driver;
  #state = "idle";
  #stats = new RunningStats();
  #dps = new Float64Array(0);
  #breakdown = new BatchBreakdown();
  #auras = new BatchAuras();
  #resources = new BatchResources();
  #completed = 0;
  #result = null;
  // Iterations handed over by advance() and not run yet.
  #budget = 0;
  #driving = false;
  #advancing = false;
  #errors = createErrorReporter();
  #states = new EventStream({ types: ["state"], errors: this.#errors });
  #progress = new EventStream({ types: ["progress"], errors: this.#errors });

  // Options:
  //   seed        required, an integer (wraps to unsigned 32 bits). The base
  //               seed of the batch.
  //   iterations  how many fights, 1 to k("batch.maxIterations"). Default
  //               k("fight.iterations") (1,000).
  //   duration    fight length in seconds, 0 or more. Default
  //               k("batch.duration") (300).
  //   config      an optional SimConfig (js/sim-config.js), validated here.
  //   signal      optional AbortSignal (or { aborted }), read before each
  //               iteration. Aborted: the batch is cancelled.
  //   driver      optional { start(advance), stop() }, see the header.
  //   onProgress  optional handler for the progress event.
  // An option with any other name is a RangeError, as in runFight.
  constructor(options) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw new RangeError("A batch needs an options object: { seed }.");
    }
    for (const key of Object.keys(options)) {
      if (!OPTIONS.includes(key)) {
        throw new RangeError(
          `A batch has no option ${JSON.stringify(key)}. Options: ${OPTIONS.join(", ")}.`,
        );
      }
    }
    this.#seed = normalizeSeed(options.seed);
    this.#iterations = readIterations(
      options.iterations === undefined
        ? k("fight.iterations")
        : options.iterations,
    );
    this.#duration = readDuration(
      options.duration === undefined ? k("batch.duration") : options.duration,
    );
    this.#signal = readSignal(options.signal);
    this.#driver = readDriver(options.driver);
    // normalizeConfig checks the whole config, the talent build included, so
    // a bad config is an error where it was written, not in the first
    // iteration.
    this.#config = normalizeConfig(options.config);
    if (options.onProgress !== undefined) {
      this.onProgress(options.onProgress);
    }
  }

  // One of BATCH_STATES.
  get state() {
    return this.#state;
  }

  // The base seed, an unsigned 32-bit integer.
  get seed() {
    return this.#seed;
  }

  // How many iterations the batch was asked for.
  get iterations() {
    return this.#iterations;
  }

  // Fight length in seconds.
  get duration() {
    return this.#duration;
  }

  // The SimConfig the fights use, in full form. A copy.
  get config() {
    return normalizeConfig(this.#config);
  }

  // Iterations completed in the current run. 0 when idle.
  get completed() {
    return this.#completed;
  }

  // The plain-data result once the state is "finished" or "cancelled", else
  // null. Treat it as read-only. A later run() makes a new one.
  //
  //   seed        the base seed
  //   iterations  how many were asked for
  //   completed   how many ran (iterations unless cancelled)
  //   cancelled   true if the batch was cancelled before the last iteration
  //   duration    fight length in seconds
  //   dataVersion which data produced it (js/data-version.js)
  //   config      the SimConfig, in full form
  //   summary     RunningStats.summary() of the completed iterations' DPS:
  //               { count, mean, stdDev, min, max, ci95 }
  //   breakdown   the per-ability breakdown of the completed iterations (#145):
  //               BatchBreakdown#summary() in js/ability-breakdown.js,
  //               { fights, totalDamage, rows }. See docs/breakdown.md.
  //   auras       the aura uptimes of the completed iterations (#146):
  //               BatchAuras#summary() in js/fight-metrics.js,
  //               { fights, duration, rows }. See docs/mechanics.md.
  //   resources   the resource waste of the completed iterations (#146):
  //               BatchResources#summary() in js/fight-metrics.js: energy
  //               capped time, energy overflow, combo point waste. See
  //               docs/mechanics.md.
  //   dps         Float64Array of the DPS of each completed iteration, in
  //               iteration order: dps[i] is the fight of
  //               deriveSeed(seed, i). Length is `completed`.
  get result() {
    return this.#result;
  }

  // Subscribe handler({ completed, total, mean }) to progress. Returns the
  // unsubscribe function.
  onProgress(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("onProgress needs a handler function.");
    }
    return this.#progress.on("progress", handler);
  }

  // Subscribe handler({ from, to }) to state changes. Returns the unsubscribe
  // function.
  onStateChange(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("onStateChange needs a handler function.");
    }
    return this.#states.on("state", handler);
  }

  // Subscribe to the errors handlers throw: handler({ error, type, event }).
  onError(handler) {
    return this.#errors.subscribe(handler);
  }

  run() {
    this.#transition("run");
  }

  cancel() {
    this.#transition("cancel");
  }

  reset() {
    this.#transition("reset");
  }

  // Run up to `iterations` more fights: a whole number of 1 or more, or
  // Infinity to run the rest. Anything else is a RangeError, whatever the state:
  // a fraction such as 0.5 could never start a fight, so a driver that passed
  // one would loop for ever, and 0 does no work. Does nothing unless the state is
  // "running". Returns the state afterwards: "finished" when this call completed
  // the last iteration, "cancelled" when the signal was aborted or cancel() was
  // called.
  advance(iterations) {
    if (
      iterations !== Infinity &&
      !(Number.isInteger(iterations) && iterations >= 1)
    ) {
      throw new RangeError(
        `BatchRunner.advance needs a whole number of iterations, 1 or more, or Infinity. Got ${iterations}.`,
      );
    }
    return this.#advance(iterations);
  }

  #advance(iterations) {
    if (this.#state !== "running") {
      return this.#state;
    }
    this.#budget += iterations;
    // Called from a handler, in the middle of the outer call: the work is
    // banked and the outer call does it.
    if (this.#advancing) {
      return this.#state;
    }
    this.#advancing = true;
    try {
      while (this.#state === "running") {
        if (this.#completed === this.#iterations) {
          this.#finish(false);
        } else if (this.#signal !== undefined && this.#signal.aborted) {
          this.#finish(true);
        } else if (this.#budget >= 1) {
          this.#budget -= 1;
          this.#runIteration();
        } else {
          break;
        }
      }
    } catch (error) {
      // An iteration failed (a bug, not bad input: the config was checked in
      // the constructor). Do not leave a driver running a batch that is stuck.
      this.#clear();
      this.#move("idle");
      throw error;
    } finally {
      this.#advancing = false;
      this.#budget = 0;
    }
    return this.#state;
  }

  #runIteration() {
    const fight = new SimRunner({
      seed: deriveSeed(this.#seed, this.#completed),
      duration: this.#duration,
      config: this.#config,
    });
    // The breakdown reads the fight's events, as any other subscriber would.
    const breakdown = new FightBreakdown();
    breakdown.attach(fight);
    const auras = new FightAuras();
    auras.attach(fight);
    const resources = new FightResources();
    resources.attach(fight);
    fight.run();
    fight.advance(Infinity);
    const { dps } = fight.result;
    this.#breakdown.add(breakdown.summary());
    this.#auras.add(auras.summary());
    this.#resources.add(resources.summary());
    this.#dps[this.#completed] = dps;
    this.#stats.add(dps);
    this.#completed += 1;
    if (this.#progress.has("progress")) {
      this.#progress.emit(
        "progress",
        Object.freeze({
          completed: this.#completed,
          total: this.#iterations,
          mean: this.#stats.mean,
        }),
      );
    }
  }

  // End the run: build the result from what completed, then change state.
  #finish(cancelled) {
    this.#result = {
      seed: this.#seed,
      iterations: this.#iterations,
      completed: this.#completed,
      cancelled,
      duration: this.#duration,
      dataVersion,
      config: normalizeConfig(this.#config),
      summary: this.#stats.summary(),
      breakdown: this.#breakdown.summary(),
      auras: this.#auras.summary(),
      resources: this.#resources.summary(),
      dps: this.#dps.slice(0, this.#completed),
    };
    this.#move(cancelled ? "cancelled" : "finished");
  }

  #clear() {
    this.#stats = new RunningStats();
    this.#dps = new Float64Array(0);
    this.#breakdown = new BatchBreakdown();
    this.#auras = new BatchAuras();
    this.#resources = new BatchResources();
    this.#completed = 0;
    this.#result = null;
    this.#budget = 0;
  }

  #transition(action) {
    const target = TRANSITIONS[action][this.#state];
    if (target === undefined) {
      const allowed = BATCH_STATES.filter(
        (state) => TRANSITIONS[action][state] !== undefined,
      );
      throw new Error(
        `BatchRunner.${action}() is not allowed while ${this.#state}. It is allowed while ${allowed.join(" or ")}.`,
      );
    }
    if (action === "run") {
      this.#clear();
      this.#dps = new Float64Array(this.#iterations);
    } else if (action === "cancel") {
      this.#finish(true);
      return;
    } else {
      this.#clear();
    }
    this.#move(target);
    // An aborted signal cancels a batch as it starts.
    if (this.#state === "running") {
      this.#advance(0);
    }
  }

  #move(target) {
    const from = this.#state;
    if (from === target) {
      return;
    }
    this.#state = target;
    this.#states.emit("state", { from, to: target });
    this.#syncDriver();
  }

  #syncDriver() {
    if (this.#driver === undefined) {
      return;
    }
    const wanted = this.#state === "running";
    if (wanted && !this.#driving) {
      this.#driving = true;
      this.#driver.start((iterations) => this.advance(iterations));
    } else if (!wanted && this.#driving) {
      this.#driving = false;
      this.#driver.stop();
    }
  }
}

// The whole batch in one call: a BatchRunner that runs to the end. Returns the
// result (BatchRunner#result), "finished" or, if `signal` was aborted (from
// onProgress, say), "cancelled" with the iterations that completed. It does
// not take a driver: use a BatchRunner for that.
//
//   runBatch({ seed, iterations, duration, config, signal, onProgress })
//
// `seed` is required. The other options are optional, with the defaults of
// BatchRunner.
export function runBatch(options) {
  if (
    options !== null &&
    typeof options === "object" &&
    Object.hasOwn(options, "driver")
  ) {
    throw new RangeError(
      "runBatch runs the whole batch itself and takes no driver. Use BatchRunner with a driver.",
    );
  }
  const runner = new BatchRunner(options);
  runner.run();
  runner.advance(Infinity);
  return runner.result;
}
