import { k } from "../data/constants.js";
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
// time and the runner decides how the engine uses them (today a whole number
// of k("sim.fixedStep") steps, with the rest carried to the next call). Pause
// is a state, not a frame count. A later engine core (Phase 3.5) can replace
// the stepping behind this class and leave the contract, and the tests of it,
// as they are.
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

const OPTIONS = ["seed", "duration", "config", "driver"];

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
  #state = "idle";
  #fight = null;
  #result = null;
  #time = 0;
  // Fight time handed over by advance() and not spent yet. It always stays
  // below one engine step, so splitting the same time differently gives the
  // same fight.
  #pending = 0;
  #stepsTaken = 0;
  #handlers = new Set();
  #driving = false;

  // Options:
  //   seed      required, an integer (wraps to unsigned 32 bits like runFight).
  //   duration  fight length in seconds. Default k("fight.duration").
  //   config    an optional SimConfig (js/sim-config.js), validated here.
  //   driver    optional { start(advance), stop() }. start is called when the
  //             runner enters "running" and gets advance to call whenever time
  //             passes (the page passes its frame loop, a test
  //             can run the whole fight inside start). stop is called when it
  //             leaves "running". Without a driver the host calls advance().
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
    this.#seed = normalizeSeed(options.seed);
    this.#duration = readDuration(
      options.duration === undefined ? k("fight.duration") : options.duration,
    );
    this.#driver = readDriver(options.driver);
    // Validate the config, and the talent build in it, now and not at the
    // first run(): a bad config is an error where it was written.
    this.#config = normalizeConfig(options.config);
    createFight(this.#seed, this.#config);
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

  // The SimConfig the runs use, in full form. A copy: changing it changes
  // nothing.
  get config() {
    return normalizeConfig(this.#config);
  }

  // Fight seconds simulated so far in the current run. 0 when idle, and the
  // result's duration when finished. It can trail the time given to advance()
  // by less than one engine step.
  get time() {
    return this.#time;
  }

  // The plain-data result when the state is "finished", the shape runFight
  // returns. null in every other state. Treat it as read-only. A later run()
  // makes a new one.
  get result() {
    return this.#result;
  }

  // Subscribe to state changes. handler({ from, to }) is called after each
  // change, in subscription order, once the new state is in place (so the
  // handler can read it, and can call the runner). Rejected actions and
  // reset() from "idle" are not changes. Returns the unsubscribe function.
  onStateChange(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("onStateChange needs a handler function.");
    }
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
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
    const stepSize = k("sim.fixedStep");
    // The same plan Simulation.run follows: whole steps, then one shorter
    // step for what is left, so the fight ends exactly at `duration`.
    const wholeSteps = Math.floor(this.#duration / stepSize);
    const leftover = this.#duration - wholeSteps * stepSize;
    const totalSteps = leftover > 0 ? wholeSteps + 1 : wholeSteps;
    const { simulation } = this.#fight;
    while (this.#stepsTaken < totalSteps) {
      const size = this.#stepsTaken < wholeSteps ? stepSize : leftover;
      if (this.#pending < size) {
        break;
      }
      this.#pending -= size;
      simulation.step(size);
      this.#stepsTaken += 1;
    }
    this.#time = simulation.currentTime;
    if (this.#stepsTaken === totalSteps) {
      this.#finish();
    }
    return this.#state;
  }

  #finish() {
    this.#result = fightResult(this.#fight);
    this.#fight = null;
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
      this.#fight = createFight(this.#seed, normalizeConfig(this.#config));
      this.#result = null;
      this.#time = 0;
      this.#pending = 0;
      this.#stepsTaken = 0;
    } else if (target === "idle") {
      this.#fight = null;
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
    for (const handler of [...this.#handlers]) {
      handler({ from, to: target });
    }
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
