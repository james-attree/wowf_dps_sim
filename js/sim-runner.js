import { k } from "../data/constants.js";
import {
  EventStream,
  SIM_EVENT_TYPES,
  createErrorReporter,
} from "./event-stream.js";
import { ENGINES, openCore } from "./core/fight.js";
import { createFight, fightResult } from "./fight.js";
import { normalizeSeed } from "./rng.js";
import { normalizeConfig } from "./sim-config.js";

// SimRunner (Phase 3, #136, the thin form of roadmap task E8): one controller
// for a seeded fight, shared by live mode, batch mode and the run controls. It
// has no DOM and reads no clock. The host feeds it fight time: the page calls
// advance() with the seconds an animation frame is worth, a Node test calls it
// with whatever it likes, and a batch runner gives it all the time at once.
//
// The interface says nothing about steps. A host hands over seconds of fight
// time and the runner decides how the engine uses them. Pause is a state, not
// a frame count. The `engine` option (#198) picks what is behind the class,
// and the contract, and the tests of it, are the same for both:
//
//   legacy   a whole number of k("sim.fixedStep") steps, with the rest
//            carried to the next call (the default until #199).
//   events   the Phase 3.5 event core (js/core/fight.js openCore), held open
//            for the whole fight: advance(seconds) runs it to
//            min(time + seconds, duration) with no step and no carry, so the
//            fight reaches exactly the time it was given, and any split of
//            the time gives the same fight as one call.
//
// States and transitions. Every action not listed for a state is invalid.
//
//   state      run()      pause()   resume()   stop()   reset()
//   idle       running    -         -          -        (stays idle)
//   running    -          paused    -          idle     idle
//   paused     -          -         running    idle     idle
//   finished   running    -         -          -        idle
//
// An invalid action throws an Error that names the action and the state, and
// changes nothing: no state change, no event, no fight touched. One rule for
// every action, so a host that gets it wrong finds out at once. advance() is
// not a transition: it is how time arrives, and in any state but "running" it
// does nothing (a frame that was already queued when the user paused is
// normal, not a mistake).
//
//   run()     Builds a fresh fight from the stored seed, config and duration
//             (createFight, js/fight.js), so a run from "idle" (also after
//             stop() or reset()) or from "finished" starts at time 0 and draws
//             the same rng sequence as every other run of this runner.
//   pause()   Freezes the fight where it is. Time given to advance() while
//             paused is dropped.
//   resume()  Continues the same fight. Pausing and resuming never change the
//             outcome: the result equals the one an uninterrupted run gives,
//             whatever sizes the time came in.
//   stop()    Discards the fight and returns to "idle". The next run() is the
//             identical seeded fight again.
//   reset()   Like stop(), but allowed from any state, and it also clears a
//             finished result.
//
// Events. on(type, handler) hands the host what happens in the fight (cast, hit,
// resource, aura, proc, end: docs/events.md), whichever run() made it, so a
// subscription made once stays for every run. State changes (onStateChange) and
// events share the delivery rules of js/event-stream.js:
//
//   - Order. Delivery never nests. A handler that calls run(), pause() or
//     stop() while it is being called has the resulting events queued behind
//     the one in hand, and every handler sees them in the order they happened.
//     The runner's `state` is always the live one: a handler told about
//     running -> paused may already find it "running" again.
//   - Errors. A handler that throws cannot stop the others, the fight, or the
//     driver start or stop of the change it was told about. The error goes to
//     onError handlers as { error, type, event }; with none, it is rethrown
//     from a microtask.
//   - Time. pause() or stop() from inside an event handler takes effect once
//     the engine has finished the move it is in the middle of (events of that
//     move are still delivered after pause(), none after stop()). advance()
//     called from a handler only adds its time to what the outer advance() is
//     spending, so the engine is never entered twice.
//   - The "end" event comes before the move to "finished".
//
// The fight ends when it has been given `duration` seconds. The runner moves to
// "finished" and `result` holds the plain data runFight returns for the same
// seed, duration and config (js/fight.js).

// What each action does from each state: the state it moves to. A missing
// entry is an invalid transition.
const TRANSITIONS = Object.freeze({
  run: { idle: "running", finished: "running" },
  pause: { running: "paused" },
  resume: { paused: "running" },
  stop: { running: "idle", paused: "idle" },
  reset: { idle: "idle", running: "idle", paused: "idle", finished: "idle" },
});

// The states, in the order a fight goes through them.
export const RUNNER_STATES = Object.freeze([
  "idle",
  "running",
  "paused",
  "finished",
]);

const OPTIONS = ["seed", "duration", "config", "driver", "engine"];

function readDuration(duration) {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError(
      `SimRunner needs a finite duration in seconds, 0 or more. Got ${duration}.`,
    );
  }
  return duration;
}

function readDriver(driver) {
  if (
    driver !== undefined &&
    (driver === null ||
      typeof driver.start !== "function" ||
      typeof driver.stop !== "function")
  ) {
    throw new TypeError(
      "SimRunner driver must be an object with start(advance) and stop() functions.",
    );
  }
  return driver;
}

export class SimRunner {
  #seed;
  #config;
  #duration;
  #driver;
  #engine;
  #state = "idle";
  #fight = null;
  // The open event core of the current fight (engine "events"), else null.
  #core = null;
  // Whether the core has run the events at `duration` (a fight of no length
  // runs those at 0 before it finishes, as Simulation.run(0) does).
  #coreAtEnd = false;
  #result = null;
  #time = 0;
  // Fight time handed over by advance() and not spent yet. On legacy it
  // stays below one engine step between calls, so splitting the same time
  // differently gives the same fight; on events it is 0 between calls unless
  // a pause stopped the spending part-way.
  #pending = 0;
  #stepsTaken = 0;
  // Events engine: the fight time given by advance() since run(), as a
  // compensated (Neumaier) sum, so the time reached is the given seconds'
  // sum correctly rounded: 600 calls of 1/60 reach exactly 10, where a plain
  // float sum would overshoot to 10.000000000000076.
  #given = 0;
  #givenError = 0;
  #driving = false;
  #advancing = false;
  #errors = createErrorReporter();
  #states = new EventStream({ types: ["state"], errors: this.#errors });
  #events = new EventStream({ types: SIM_EVENT_TYPES, errors: this.#errors });

  // Options:
  //   seed      required, an integer (wraps to unsigned 32 bits like runFight).
  //   duration  fight length in seconds. Default k("batch.duration"), the one
  //             default fight length of live and batch mode (#153).
  //   config    an optional SimConfig (js/sim-config.js), validated here.
  //   driver    optional { start(advance), stop() }. start is called when the
  //             runner enters "running" and gets advance to call whenever time
  //             passes (the page passes its frame loop, a test
  //             can run the whole fight inside start). stop is called when it
  //             leaves "running". Without a driver the host calls advance().
  //   engine    optional, "legacy" or "events" (createFight's option,
  //             Simulation's `engine`, #198). Without it, the Simulation's
  //             default when the runner is made (legacy until #199). An
  //             unknown engine is a RangeError.
  // An option with any other name is a RangeError, as in runFight.
  constructor(options) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      throw new RangeError("SimRunner needs an options object: { seed }.");
    }
    for (const key of Object.keys(options)) {
      if (!OPTIONS.includes(key)) {
        throw new RangeError(
          `SimRunner has no option ${JSON.stringify(key)}. Options: ${OPTIONS.join(", ")}.`,
        );
      }
    }
    // normalizeSeed is the one seed check, so a bad seed has the same
    // RangeError text here as in runFight and runBatch (#187).
    this.#seed = normalizeSeed(options.seed);
    this.#duration = readDuration(
      options.duration === undefined ? k("batch.duration") : options.duration,
    );
    this.#driver = readDriver(options.driver);
    // Validate the config, and the talent build in it, now and not at the
    // first run(): a bad config is an error where it was written.
    this.#config = normalizeConfig(options.config);
    const probe = createFight(this.#seed, this.#config, {
      engine: options.engine,
    });
    this.#engine = probe.simulation.engine;
  }

  // One of RUNNER_STATES.
  get state() {
    return this.#state;
  }

  // The seed every run uses, as an unsigned 32-bit integer.
  get seed() {
    return this.#seed;
  }

  // Fight length in seconds.
  get duration() {
    return this.#duration;
  }

  // The engine every run uses: "legacy" or "events" (#198).
  get engine() {
    return this.#engine;
  }

  // The SimConfig the runs use, in full form. A copy: changing it changes
  // nothing.
  get config() {
    return normalizeConfig(this.#config);
  }

  // Fight seconds simulated so far in the current run. 0 when idle, and the
  // result's duration when finished. On legacy it can trail the time given to
  // advance() by less than one engine step; on events it is the time given
  // (up to the end), unless a pause from a handler stopped it short.
  get time() {
    return this.#time;
  }

  // The fight the runner is spending time on, { rogue, simulation }, while it
  // is "running" or "paused"; null when "idle" or "finished". A new one on
  // every run(). The live page (#153) reads it each frame for what is not an
  // event (energy, the GCD, time left on auras and cooldowns:
  // js/live-feed.js) and subscribes its feed to the simulation. Read it, do not
  // step it: time goes through advance(). Read-only by contract: only this
  // wrapper is frozen (a new one per read); the rogue and simulation are the
  // live engine objects.
  get fight() {
    const fight = this.#fight;
    return fight === null
      ? null
      : Object.freeze({ rogue: fight.rogue, simulation: fight.simulation });
  }

  // The plain-data result when the state is "finished", the shape runFight
  // returns. null in every other state. The same object on every read, not a
  // copy, and not frozen: like the rogue and simulation in `fight`, it is live
  // and read-only by contract, so a caller that writes to it changes what
  // later reads return. A later run() makes a
  // new one.
  get result() {
    return this.#result;
  }

  // Subscribe to state changes. handler({ from, to }) is called after each
  // change, in subscription order, once the new state is in place (so the
  // handler can read it, and can call the runner). Rejected actions and
  // reset() from "idle" are not changes. Returns the unsubscribe function.
  // A throwing handler goes to onError (see the header).
  onStateChange(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("onStateChange needs a handler function.");
    }
    return this.#states.on("state", handler);
  }

  // Subscribe handler(event, type) to one event type of the fight (cast, hit,
  // resource, aura, proc, end), or to all with "*". Events of a run begin once
  // the run() has built the fight; the subscription outlives runs. Returns the
  // unsubscribe function. Events are frozen plain data (docs/events.md).
  on(type, handler) {
    return this.#events.on(type, handler);
  }

  // Subscribe to the errors event and state handlers throw:
  // handler({ error, type, event }). Returns the unsubscribe function.
  onError(handler) {
    return this.#errors.subscribe(handler);
  }

  run() {
    this.#transition("run");
  }

  pause() {
    this.#transition("pause");
  }

  resume() {
    this.#transition("resume");
  }

  stop() {
    this.#transition("stop");
  }

  reset() {
    this.#transition("reset");
  }

  // Give the running fight up to `seconds` of fight time, 0 or more.
  // Infinity runs it to the end. Time past the end of the fight is dropped.
  // Does nothing unless the state is "running". Returns the state afterwards,
  // which is "finished" when this call reached the end of the fight.
  // advance(duration) as a run's first call finishes it. On legacy many small
  // calls can leave it one step short: the carry is a float sum that can fall
  // just under the last step, and the next call finishes the same fight
  // (docs/mechanics.md, Run controller). On events there is no carry: the
  // call that brings the time to `duration` finishes it.
  advance(seconds) {
    if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds < 0) {
      throw new RangeError(
        `SimRunner.advance needs seconds of fight time, 0 or more. Got ${seconds}.`,
      );
    }
    if (this.#state !== "running") {
      return this.#state;
    }
    this.#pending += seconds;
    this.#give(seconds);
    // Called from an event handler, in the middle of the outer call's engine
    // move: the time is banked and the outer call spends it.
    if (this.#advancing) {
      return this.#state;
    }
    if (this.#core !== null) {
      return this.#advanceCore();
    }
    const stepSize = k("sim.fixedStep");
    // The same plan Simulation.run follows: whole steps, then one shorter
    // step for what is left, so the fight ends exactly at `duration`.
    const wholeSteps = Math.floor(this.#duration / stepSize);
    const leftover = this.#duration - wholeSteps * stepSize;
    const totalSteps = leftover > 0 ? wholeSteps + 1 : wholeSteps;
    const fight = this.#fight;
    const { simulation } = fight;
    this.#advancing = true;
    try {
      // A handler may pause, stop, or stop and run again: then this fight is
      // not the runner's to spend time on.
      while (
        this.#state === "running" &&
        this.#fight === fight &&
        this.#stepsTaken < totalSteps
      ) {
        const size = this.#stepsTaken < wholeSteps ? stepSize : leftover;
        if (this.#pending < size) {
          break;
        }
        this.#pending -= size;
        // Counted before the move: a handler that stops and runs again in it
        // starts the count of a new fight.
        this.#stepsTaken += 1;
        simulation.step(size);
      }
    } finally {
      this.#advancing = false;
    }
    if (this.#fight !== fight) {
      return this.#state;
    }
    this.#time = simulation.currentTime;
    // A fight that was paused as its last move ends when it is resumed.
    if (this.#state === "running" && this.#stepsTaken === totalSteps) {
      this.#finish();
    }
    return this.#state;
  }

  // Add `seconds` to #given (Neumaier's compensated sum).
  #give(seconds) {
    const sum = this.#given;
    if (sum === Infinity || seconds === Infinity) {
      this.#given = Infinity;
      this.#givenError = 0;
      return;
    }
    const total = sum + seconds;
    this.#givenError +=
      Math.abs(sum) >= seconds ? sum - total + seconds : seconds - total + sum;
    this.#given = total;
  }

  // The events engine's advance: run the open core to the time given, one
  // event time at a time, so a pause or stop from a handler takes effect
  // after the events of that time (the "move" on this engine) and the rest of
  // the time stays given, as a legacy step's does. A handler's advance() adds
  // to the time given, and this loop runs it.
  #advanceCore() {
    const fight = this.#fight;
    const core = this.#core;
    const duration = this.#duration;
    this.#advancing = true;
    try {
      for (;;) {
        if (this.#state !== "running" || this.#fight !== fight) {
          break;
        }
        const given = this.#given + this.#givenError;
        const target = given < duration ? given : duration;
        // A fight of no length still runs its events at 0, as
        // Simulation.run(0) does.
        if (!(
          core.time < target ||
          (target === duration && !this.#coreAtEnd)
        )) {
          break;
        }
        const next = core.nextTime;
        const to = next !== null && next < target ? next : target;
        core.runUntil(to);
        if (to === duration && this.#fight === fight) {
          this.#coreAtEnd = true;
        }
      }
    } finally {
      this.#advancing = false;
    }
    if (this.#fight !== fight) {
      return this.#state;
    }
    this.#time = fight.simulation.currentTime;
    // A fight that was paused as its last move ends when it is resumed.
    if (this.#state === "running" && this.#coreAtEnd) {
      this.#finish();
    }
    return this.#state;
  }

  #finish() {
    const fight = this.#fight;
    // The fight as legacy leaves it (the legacy energy pool and its waste)
    // before the "end" event reads it. A second call does nothing.
    this.#core?.close();
    fight.simulation.end();
    // A handler of the "end" event may have paused or stopped the runner. A
    // paused one finishes when it is resumed.
    if (this.#fight !== fight || this.#state !== "running") {
      return;
    }
    this.#result = fightResult(this.#fight);
    this.#fight = null;
    this.#core = null;
    this.#move("finished");
  }

  #transition(action) {
    const target = TRANSITIONS[action][this.#state];
    if (target === undefined) {
      const allowed = RUNNER_STATES.filter(
        (state) => TRANSITIONS[action][state] !== undefined,
      );
      throw new Error(
        `SimRunner.${action}() is not allowed while ${this.#state}. It is allowed while ${allowed.join(" or ")}.`,
      );
    }
    if (action === "run") {
      // The rotation is told the length the runner runs (#191).
      const fight = createFight(this.#seed, normalizeConfig(this.#config), {
        duration: this.#duration,
        engine: this.#engine,
      });
      this.#fight = fight;
      // Events of a fight the runner has let go of (stopped, or run again) are
      // not passed on.
      fight.simulation.on("*", (event, type) => {
        if (this.#fight === fight) {
          this.#events.emit(type, event);
        }
      });
      // A fight that is let go of (stop, reset, run again) keeps its core
      // open: it may be inside one of its events, and nothing reads it again.
      this.#core =
        this.#engine === ENGINES.events
          ? openCore(fight.simulation, this.#duration)
          : null;
      this.#coreAtEnd = false;
      this.#given = 0;
      this.#givenError = 0;
      this.#result = null;
      this.#time = 0;
      this.#pending = 0;
      this.#stepsTaken = 0;
    } else if (target === "idle") {
      this.#fight = null;
      this.#core = null;
      this.#given = 0;
      this.#givenError = 0;
      this.#result = null;
      this.#time = 0;
      this.#pending = 0;
      this.#stepsTaken = 0;
    }
    this.#move(target);
    // A fight with no length is over as it starts.
    if (this.#state === "running") {
      this.advance(0);
    }
  }

  // Put the new state in place, then tell the subscribers, then start or stop
  // the driver to match. A driver that runs the fight inside start() reaches
  // "finished" (and its own notifications) after this one has gone out.
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
      this.#driver.start((seconds) => this.advance(seconds));
    } else if (!wanted && this.#driving) {
      this.#driving = false;
      this.#driver.stop();
    }
  }
}
