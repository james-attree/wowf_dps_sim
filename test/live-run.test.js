import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { createLiveRun } from "../js/live-run.js";
import { createStore } from "../js/store.js";

// Issue #153 (PR 1). The contract tests for the live page's run: a SimRunner
// driven by animation frames and mirrored into the store. They drive the
// frames by hand and read the store and the runner's result, never a step.

const CAP_MS = k("sim.maxFrameTime") * k("sim.msPerSecond");
const SEED = 4242;
const DURATION = 3; // seconds: a short fight keeps these quick
const config = pageDefaultConfig();

function setup() {
  const store = createStore({
    config,
    run: { state: "idle", seed: null, duration: null },
    frame: 0,
    results: { time: 0, damage: 0 },
  });
  const frames = {
    pending: null,
    requested: 0,
    cancelled: 0,
    nextId: 1,
    request(callback) {
      this.requested += 1;
      this.pending = { id: this.nextId, callback };
      this.nextId += 1;
      return this.pending.id;
    },
    cancel(id) {
      this.cancelled += 1;
      if (this.pending?.id === id) {
        this.pending = null;
      }
    },
  };
  const states = [];
  store.subscribe(({ state, changed }) => {
    if (changed.includes("run")) {
      states.push(state.run.state);
    }
  });
  const live = createLiveRun(store, frames);
  let now = 1000;
  // Run the queued frame `ms` after the last one; returns the callback run.
  function tick(ms = CAP_MS) {
    assert.ok(frames.pending, "a frame is queued");
    const { callback } = frames.pending;
    frames.pending = null;
    now += ms;
    callback(now);
    return callback;
  }
  function toEnd() {
    let guard = 0;
    while (frames.pending) {
      tick();
      if (live.state === "finished") {
        assert.equal(frames.pending, null, "no frame after the finish");
      }
      guard += 1;
      assert.ok(guard < 1000, "the fight ends");
    }
  }
  return { store, frames, states, live, tick, toEnd };
}

const reference = (seed = SEED, duration = DURATION) =>
  runFight({ seed, duration, config });

describe("createLiveRun (#153)", () => {
  it("is idle until run(), and its actions need a run", () => {
    const { live, frames } = setup();
    assert.equal(live.state, "idle");
    assert.equal(live.result, null);
    assert.equal(live.fight(), null);
    for (const action of ["pause", "resume", "stop", "reset"]) {
      assert.throws(() => live[action](), /run\(\) first/, action);
    }
    assert.equal(frames.requested, 0);
  });

  it("run() mirrors the runner into the store and asks for a frame", () => {
    const { live, store, states, frames, tick } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    const { run, frame, results } = store.get();
    assert.deepEqual(run, { state: "running", seed: SEED, duration: DURATION });
    assert.deepEqual(states, ["running"], "one change for the new run");
    assert.equal(frame, 1, "the new fight's first picture");
    assert.deepEqual(results, { time: 0, damage: 0 });
    assert.ok(Array.isArray(store.get().log), "the feed's slices");
    assert.equal(frames.requested, 1);
    tick(1e6);
    assert.equal(store.get().results.time, 0, "the first frame takes no step");
    assert.equal(store.get().frame, 2);
    tick(1000 / 60);
    // The frame's own time on the event core (#198), as the clock reads it
    // from the millisecond timestamps.
    const time = store.get().results.time;
    assert.ok(Math.abs(time - 1 / 60) < 1e-9, `${time}`);
    assert.equal(live.fight().simulation.currentTime, time);
  });

  it("finishes at the duration with runFight's result, and stops asking for frames", () => {
    const { live, store, states, frames, toEnd } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    toEnd();
    assert.equal(live.state, "finished");
    assert.deepEqual(states, ["running", "finished"]);
    assert.equal(store.get().run.state, "finished");
    assert.deepEqual(live.result, reference());
    assert.equal(store.get().results.time, DURATION);
    assert.equal(store.get().results.damage, reference().totalDamage);
    assert.equal(frames.pending, null);
    assert.equal(live.fight(), null);
  });

  it("caps a late frame at sim.maxFrameTime", () => {
    const { live, store, tick } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    tick();
    tick(60_000);
    assert.equal(store.get().results.time, k("sim.maxFrameTime"));
  });

  it("pause cancels the frame, a stale frame does nothing, resume takes no catch-up", () => {
    const { live, store, states, frames, tick, toEnd } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    tick();
    tick();
    const stale = frames.pending.callback;
    const time = store.get().results.time;
    const frame = store.get().frame;
    live.pause();
    assert.equal(store.get().run.state, "paused");
    assert.equal(frames.pending, null);
    assert.equal(frames.cancelled, 1);
    stale(1e12);
    assert.equal(store.get().results.time, time);
    assert.equal(store.get().frame, frame, "nothing drawn");
    const log = store.get().log;
    assert.ok(log.length > 0);
    live.resume();
    tick(3.6e6);
    assert.equal(store.get().results.time, time, "the pause is not simulated");
    assert.deepEqual(store.get().log, log, "the same fight's feed goes on");
    toEnd();
    assert.deepEqual(states, ["running", "paused", "running", "finished"]);
    assert.deepEqual(live.result, reference(), "pauses do not change it");
  });

  it("stop discards the fight; run with the same seed reproduces it", () => {
    const { live, store, states, frames, tick, toEnd } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    tick();
    tick();
    tick();
    const picture = store.get().frame;
    live.stop();
    assert.equal(live.state, "idle");
    assert.equal(frames.pending, null);
    assert.equal(live.result, null);
    assert.equal(store.get().frame, picture, "the last picture stays");
    live.run({ seed: SEED, duration: DURATION, config });
    assert.deepEqual(store.get().results, { time: 0, damage: 0 }, "from 0:00");
    toEnd();
    assert.deepEqual(live.result, reference());
    assert.deepEqual(states, ["running", "idle", "running", "finished"]);
  });

  it("reset goes to idle from paused and from finished", () => {
    const { live, store, frames, tick, toEnd } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    tick();
    live.pause();
    live.reset();
    assert.equal(store.get().run.state, "idle");
    assert.equal(frames.pending, null);
    live.run({ seed: SEED, duration: DURATION, config });
    toEnd();
    live.reset();
    assert.equal(store.get().run.state, "idle");
    assert.equal(live.result, null);
  });

  it("runs again after finishing, with new options, from 0:00", () => {
    const { live, store, toEnd } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    toEnd();
    live.run({ seed: 7, duration: 1.5, config });
    assert.deepEqual(store.get().run, {
      state: "running",
      seed: 7,
      duration: 1.5,
    });
    assert.deepEqual(store.get().results, { time: 0, damage: 0 });
    toEnd();
    assert.deepEqual(live.result, reference(7, 1.5));
  });

  it("refuses run() while running or paused", () => {
    const { live, tick } = setup();
    live.run({ seed: SEED, duration: DURATION, config });
    assert.throws(() => live.run({ seed: 1, config }), /while running/);
    tick();
    live.pause();
    assert.throws(() => live.run({ seed: 1, config }), /while paused/);
  });

  it("refuses an option it does not know, an engine too, and starts nothing (#236 QA)", () => {
    const { live, store, frames } = setup();
    for (const key of ["engine", "driver", "confg"]) {
      assert.throws(
        () =>
          live.run({ seed: SEED, duration: DURATION, config, [key]: "legacy" }),
        (error) =>
          error instanceof RangeError &&
          error.message ===
            `live.run has no option "${key}". Options: seed, duration, config.`,
        key,
      );
    }
    assert.equal(store.get().run.state, "idle");
    assert.equal(frames.pending, null);
    assert.equal(live.state, "idle");
  });

  it("reads only its own options: an inherited one is not given (#238 QA)", () => {
    const { live, store } = setup();
    // A duration on the prototype is not this run's: the length is the
    // default, 300 s, not 1.5 s.
    live.run(
      Object.assign(Object.create({ duration: 1.5, engine: "legacy" }), {
        seed: SEED,
        config,
      }),
    );
    assert.equal(store.get().run.seed, SEED);
    assert.equal(store.get().run.duration, 300);
    live.stop();
    // A seed on the prototype is no seed: the seed check refuses it.
    assert.throws(
      () => live.run(Object.assign(Object.create({ seed: SEED }), { config })),
      /seed must be an integer; got undefined/,
    );
  });

  it("defaults the length to batch.duration (300 s)", () => {
    const { live, store } = setup();
    live.run({ seed: SEED, config });
    assert.equal(store.get().run.duration, 300);
    live.stop();
  });
});

describe("clear(): an empty picture at 0:00 (#153)", () => {
  it("refuses an option it does not know, an engine or a duration too (#236 QA)", () => {
    const { live, store } = setup();
    const before = store.get();
    for (const key of ["engine", "duration"]) {
      assert.throws(
        () => live.clear({ seed: SEED, config, [key]: 3 }),
        (error) =>
          error instanceof RangeError &&
          error.message ===
            `live.clear has no option "${key}". Options: seed, config.`,
        key,
      );
    }
    assert.equal(store.get(), before, "nothing drawn");
  });

  it("reads only its own options: an inherited seed is no seed (#238 QA)", () => {
    const { live, store } = setup();
    const before = store.get();
    assert.throws(
      () =>
        live.clear(
          Object.assign(Object.create({ seed: SEED, engine: "legacy" }), {
            config,
          }),
        ),
      /seed must be an integer; got undefined/,
    );
    assert.equal(store.get(), before, "nothing drawn");
    live.clear(
      Object.assign(Object.create({ engine: "legacy" }), {
        seed: SEED,
        config,
      }),
    );
    assert.ok(store.get() !== before, "own options draw");
  });

  it("draws a fresh fight without running it, only while idle", () => {
    const { live, store, frames, tick } = setup();
    live.clear({ seed: SEED, config });
    assert.equal(store.get().run.state, "idle");
    assert.equal(frames.pending, null, "nothing runs");
    assert.deepEqual(store.get().results, { time: 0, damage: 0 });
    assert.deepEqual(store.get().log, []);
    live.run({ seed: SEED, duration: DURATION, config });
    tick();
    tick();
    assert.throws(() => live.clear({ seed: SEED, config }), /while running/);
    live.pause();
    assert.throws(() => live.clear({ seed: SEED, config }), /while paused/);
    live.reset();
    const frame = store.get().frame;
    live.clear({ seed: SEED, config });
    assert.ok(store.get().frame > frame, "drawn");
    assert.equal(store.get().results.time, 0);
    assert.deepEqual(store.get().log, []);
  });
});

describe("the run state's writers (#153)", () => {
  // js/live-run.js writes it in live mode, js/run-actions.js in batch mode
  // (from batch.status); no view or the bootstrap writes it.
  it("are js/live-run.js and js/run-actions.js: no view or the bootstrap", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const files = [
      "js/main.js",
      ...(await readdir(new URL("../js/views/", import.meta.url)))
        .filter((name) => name.endsWith(".js"))
        .map((name) => `js/views/${name}`),
    ];
    for (const file of files) {
      const source = await readFile(
        new URL(`../${file}`, import.meta.url),
        "utf8",
      );
      assert.doesNotMatch(source, /run:\s*\{\s*\.\.\.run/, file);
      assert.doesNotMatch(source, /\bstate:\s*"(running|paused)"/, file);
    }
  });
});
