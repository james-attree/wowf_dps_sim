import { k } from "../data/constants.js";
import { FrameClock } from "./frame-clock.js";
import { createLiveFeed } from "./live-feed.js";
import { normalizeConfig } from "./sim-config.js";
import { createFight } from "./fight.js";
import { SimRunner } from "./sim-runner.js";

// The live page's run (#153): one SimRunner per Run, driven by animation
// frames, mirrored into the page's store (js/store.js). It is the page's only
// writer of `run.state`; the views call its actions and never set the state
// themselves. It has no DOM and reads no clock: the host hands it
// `frames = { request(callback), cancel(id) }` (the browser's animation
// frames on the page, a stand-in in a test), and each frame
// callback gets the frame's timestamp in milliseconds.
//
//   const live = createLiveRun(store, frames);
//   live.run({ seed, duration, config });  // a new SimRunner, then run()
//   live.pause(); live.resume(); live.stop(); live.reset();
//   live.clear({ seed, config });          // an empty picture at 0:00
//
// Time. The runner's driver is a FrameClock (js/frame-clock.js): each frame
// becomes whole steps of k("sim.fixedStep"), at most k("sim.maxFrameTime")
// worth, given to the runner one step at a time with advance(). The first
// frame, and the first after a resume, take no steps, so a pause is never
// simulated. The runner ends the fight at `duration` and moves to "finished".
// A frame that was already queued when the run left "running" does nothing.
//
// The store. Every change of the runner's state is written to run.state
// (SimRunner's state names: idle, running, paused, finished), and a new
// fight's run.seed and run.duration with it, in one change. A new fight
// (every run(), from idle or finished) gets a new live feed (js/live-feed.js) and its
// slices; after every frame the page draws, `frame` counts up and `results`
// and the feed's slices are renewed. stop() and reset() keep the last frame's
// slices: the fight is discarded, the picture of it is not. clear() draws an
// empty one: a new fight at 0:00 that never runs, for the page's first
// picture and for the control bar's Reset. It is allowed only while idle.
//
// fight() is the runner's current fight ({ rogue, simulation }) or null, for
// tests and tools; the views never read it.
export function createLiveRun(store, frames) {
  const fixedStep = k("sim.fixedStep");
  const clock = new FrameClock();
  let runner = null;
  let feed = null;
  let shown = null;
  let advance = null;
  let frameId = null;

  const driver = {
    start(advanceRunner) {
      advance = advanceRunner;
      // The time spent paused, or before the run, is not fight time.
      clock.restart();
      frameId = frames.request(onFrame);
    },
    stop() {
      advance = null;
      if (frameId !== null) {
        frames.cancel(frameId);
        frameId = null;
      }
    },
  };

  function onFrame(timestamp) {
    frameId = null;
    if (advance === null) {
      return;
    }
    const steps = clock.steps(timestamp);
    // The runner may finish (and stop this driver) inside a step.
    for (let index = 0; index < steps && advance !== null; index += 1) {
      advance(fixedStep);
    }
    publish();
    if (advance !== null) {
      frameId = frames.request(onFrame);
    }
  }

  function publish() {
    store.update(({ frame }) => ({
      frame: frame + 1,
      results: {
        time: shown.simulation.currentTime,
        damage: shown.simulation.damageDone,
      },
      ...feed.read(),
    }));
  }

  function onStateChange({ from, to }) {
    store.batch(() => {
      // A new runner per run(), so a new fight always starts from idle.
      const fresh = from === "idle" && to === "running";
      if (fresh) {
        feed?.stop();
        shown = runner.fight;
        feed = createLiveFeed(shown);
      }
      // A fight that finishes inside a frame's steps is drawn at its end
      // before it reads "finished". Pause and stop keep the last frame.
      if (fresh || to === "finished") {
        publish();
      }
      store.update(({ run }) => ({
        run: fresh
          ? { ...run, state: to, seed: runner.seed, duration: runner.duration }
          : { ...run, state: to },
      }));
    });
  }

  function current() {
    if (runner === null) {
      throw new Error("The live run has not started: call run() first.");
    }
    return runner;
  }

  return {
    // A new fight from `seed`, `duration` and `config` (SimRunner's options),
    // started at once. Allowed while idle or finished, as SimRunner.run() is.
    run({ seed, duration, config }) {
      const state = runner?.state ?? "idle";
      if (state !== "idle" && state !== "finished") {
        throw new Error(
          `The live run cannot start while ${state}. Stop or reset it first.`,
        );
      }
      const next = new SimRunner({ seed, duration, config, driver });
      runner = next;
      next.onStateChange(onStateChange);
      next.run();
    },
    // The picture of a fight from `seed` and `config` at 0:00, with no runner
    // behind it. Allowed while idle (before the first run, or after stop or
    // reset), so a running fight is never hidden.
    clear({ seed, config }) {
      const state = runner?.state ?? "idle";
      if (state !== "idle") {
        throw new Error(
          `The live run cannot clear while ${state}. Reset it first.`,
        );
      }
      feed?.stop();
      shown = createFight(seed, normalizeConfig(config));
      feed = createLiveFeed(shown);
      publish();
    },
    pause: () => current().pause(),
    resume: () => current().resume(),
    stop: () => current().stop(),
    reset: () => current().reset(),
    // The runner's state, "idle" before the first run().
    get state() {
      return runner?.state ?? "idle";
    },
    // The finished fight's result (runFight's shape), else null.
    get result() {
      return runner?.result ?? null;
    },
    fight: () => runner?.fight ?? null,
  };
}
