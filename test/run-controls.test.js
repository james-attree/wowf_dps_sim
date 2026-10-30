import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  FORM_ERROR,
  createConfigForm,
  pageDefaultConfig,
} from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { createLiveRun } from "../js/live-run.js";
import { createRunActions, emptyBatch } from "../js/run-actions.js";
import { createStore } from "../js/store.js";
import { NOT_WIDE_QUERY } from "../js/views/breakpoints.js";
import { editedSinceRun } from "../js/views/config-form.js";
import { REVEAL_EVENT } from "../js/views/sections.js";
import {
  NARROW_QUERY,
  RUN_TAP_GUARD_MS,
  createControlsView,
} from "../js/views/controls.js";
import {
  BATCH_HELP,
  LIVE_HELP,
  MAX_SEED,
  NO_DPS,
  dockDps,
  dockText,
  MIN_FIGHT_SECONDS,
  blocked,
  blockedCount,
  clock,
  compact,
  controlsModel,
  errorsText,
  fieldErrors,
  firstFormError,
  grouped,
  parseRunField,
  spokenTenths,
  spokenTime,
  summaryText,
} from "../js/views/run-model.js";
import { formatNumber } from "../js/charts.js";

// Issue #153 (U4). The run control bar: one home for Run, Pause, Stop and
// Reset, a live and a batch mode, and the fight length, fights and seed
// fields. The model (js/views/run-model.js) says what each control shows in
// every state; the actions (js/run-actions.js) are what the controls do; the
// view (js/views/controls.js) draws the one and calls the other.

const SEED = 20261029;
const DURATION = 3;
const config = pageDefaultConfig();

function fakeFrames() {
  return {
    pending: null,
    nextId: 1,
    request(callback) {
      this.pending = { id: this.nextId, callback };
      this.nextId += 1;
      return this.pending.id;
    },
    cancel(id) {
      if (this.pending?.id === id) {
        this.pending = null;
      }
    },
  };
}

// A BatchClient stand-in: run() returns a promise the test settles.
function fakeClient() {
  return {
    mode: "main",
    running: false,
    cancelled: 0,
    calls: [],
    job: null,
    run(options, { onProgress }) {
      this.running = true;
      this.calls.push(options);
      return new Promise((resolve, reject) => {
        this.job = {
          options,
          onProgress,
          resolve: (result) => {
            this.running = false;
            resolve(result);
          },
          reject: (error) => {
            this.running = false;
            reject(error);
          },
        };
      });
    },
    cancel() {
      this.cancelled += 1;
    },
  };
}

function batchResult({ completed, iterations, cancelled, mean = 300 }) {
  return { completed, iterations, cancelled, summary: { mean }, config };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

function setup({ seed = SEED, duration = DURATION } = {}) {
  const store = createStore({
    config,
    run: {
      mode: "live",
      state: "idle",
      seed,
      duration,
      iterations: 4,
      fields: {
        duration: String(duration),
        iterations: "4",
        seed: seed === null ? "" : String(seed),
      },
      errors: {},
      stoppedAt: null,
      shown: false,
      snapshot: null,
    },
    batch: emptyBatch("main"),
    frame: 0,
    results: { time: 0, damage: 0 },
  });
  const frames = fakeFrames();
  const live = createLiveRun(store, frames);
  live.clear({ seed: seed ?? 0, config });
  const client = fakeClient();
  let drawn = 0;
  let clockMs = 0;
  const actions = createRunActions({
    store,
    live,
    client,
    drawSeed: () => {
      drawn += 1;
      return 7 + drawn;
    },
    now: () => (clockMs += 10),
  });
  let time = 1000;
  const tick = (ms = 250) => {
    const { callback } = frames.pending;
    frames.pending = null;
    time += ms;
    callback(time);
  };
  // Play `seconds` of fight: one frame to start the clock, then capped frames.
  const play = (seconds) => {
    tick();
    for (let i = 0; i < seconds / k("sim.maxFrameTime"); i += 1) {
      tick();
    }
  };
  const toEnd = () => {
    while (frames.pending) {
      tick();
    }
  };
  const model = () => controlsModel(store.get());
  return { store, frames, live, client, actions, tick, play, toEnd, model };
}

const reference = (duration, seed = SEED) =>
  runFight({ seed, duration, config });

describe("run bar fields (#153)", () => {
  it("fight length: a plain decimal from 1 to 3,600 seconds (#155)", () => {
    assert.equal(MIN_FIGHT_SECONDS, 1);
    for (const ok of ["300", "1", "2.5", "3600", " 12 ", "7.", "0001.50"]) {
      assert.equal(parseRunField("duration", ok).error, null, ok);
    }
    assert.equal(parseRunField("duration", "300").value, 300);
    assert.equal(parseRunField("duration", "1").value, 1);
    assert.equal(parseRunField("duration", "3600").value, 3600);
    const bad = [
      ["0", "-1", "0.99", ".5", "3600.01", "", "abc", "Infinity", "+5"],
      ["0x10", "0b101", "0o17", "1e2", "5e1", "1E3", "1_000", "1,000", "."],
    ].flat();
    for (const text of bad) {
      assert.deepEqual(
        parseRunField("duration", text),
        {
          value: null,
          error: "Fight length must be a number of seconds from 1 to 3,600.",
        },
        text,
      );
    }
  });

  it("fights: a whole number from 1 to batch.maxIterations", () => {
    const max = k("batch.maxIterations");
    assert.equal(max, 100_000);
    for (const ok of ["1", "1000", String(max)]) {
      assert.equal(parseRunField("iterations", ok).value, Number(ok), ok);
    }
    for (const bad of ["0", String(max + 1), "1.5", "", "-3", "1e3"]) {
      assert.equal(
        parseRunField("iterations", bad).error,
        "Enter a whole number of fights from 1 to 100,000.",
        bad,
      );
    }
  });

  it("seed: a whole number from 0 to 4,294,967,295, or empty", () => {
    assert.equal(MAX_SEED, 2 ** 32 - 1);
    assert.deepEqual(parseRunField("seed", ""), { value: null, error: null });
    for (const ok of ["0", "42", String(MAX_SEED)]) {
      assert.equal(parseRunField("seed", ok).value, Number(ok), ok);
    }
    for (const bad of [String(MAX_SEED + 1), "-1", "1.5", "x"]) {
      assert.equal(
        parseRunField("seed", bad).error,
        "Seed must be a whole number from 0 to 4,294,967,295.",
        bad,
      );
    }
    assert.throws(() => parseRunField("speed", "1"), RangeError);
  });

  it("formats times and counts the same everywhere", () => {
    assert.equal(clock(72.4), "01:12");
    assert.equal(clock(300), "05:00");
    assert.equal(spokenTime(72.4), "1 minute 12");
    assert.equal(spokenTime(12), "12 seconds");
    assert.equal(spokenTime(1), "1 second");
    assert.equal(spokenTime(150), "2 minutes 30");
    // On the minute (#45, Fran): "5 minutes", not "5 minutes 0".
    assert.equal(spokenTime(300), "5 minutes");
    assert.equal(spokenTime(60.9), "1 minute");
    assert.equal(spokenTime(0), "0 seconds");
    // The arrow-step readout's time, to the tenth the log shows (#45).
    assert.equal(spokenTenths(41.25), "41.2 seconds");
    assert.equal(spokenTenths(41), "41 seconds");
    assert.equal(spokenTenths(1.04), "1 second");
    assert.equal(spokenTenths(0.5), "0.5 seconds");
    assert.equal(spokenTenths(72.46), "1 minute 12.4");
    assert.equal(spokenTenths(300.02), "5 minutes");
    assert.equal(spokenTenths(60.3), "1 minute 0.3");
    assert.equal(grouped(100000), "100,000");
    assert.equal(grouped(4294967295), "4,294,967,295");
  });
});

// What each control is in each state: [run label or null when disabled,
// pause label or null, stop enabled, reset enabled].
const LIVE_TABLE = {
  ready: ["Run", null, false, false],
  running: [null, "Pause", true, true],
  paused: [null, "Resume", true, true],
  finished: ["Run again", null, false, true],
  stopped: ["Run", null, false, true],
};

function liveName(state) {
  const { run } = state;
  if (run.state === "idle") {
    return run.stoppedAt === null ? "ready" : "stopped";
  }
  return run.state;
}

function assertControls(model, [run, pause, stop, reset], where) {
  assert.equal(model.run.disabled, run === null, `${where} run`);
  if (run !== null) {
    assert.equal(model.run.label, run, `${where} run label`);
  }
  const pauseOff = model.pause.disabled || model.pause.inert;
  assert.equal(pauseOff, pause === null, `${where} pause`);
  if (pause !== null) {
    assert.equal(model.pause.label, pause, `${where} pause label`);
    assert.equal(model.pause.resume, pause === "Resume");
  }
  assert.equal(model.stop.disabled, !stop, `${where} stop`);
  assert.equal(model.reset.disabled, !reset, `${where} reset`);
}

// How to reach each live state from a fresh page.
const LIVE_PATHS = {
  ready: [],
  running: ["run"],
  paused: ["run", "pause"],
  finished: ["run", "end"],
  stopped: ["run", "stop"],
};

// Where each control goes from each state; a control that is disabled
// changes nothing even if its action is called.
const LIVE_MOVES = {
  ready: { run: "running", pause: "ready", stop: "ready", reset: "ready" },
  running: {
    run: "running",
    pause: "paused",
    stop: "stopped",
    reset: "ready",
  },
  paused: {
    run: "paused",
    pause: "running",
    stop: "stopped",
    reset: "ready",
  },
  finished: {
    run: "running",
    pause: "finished",
    stop: "finished",
    reset: "ready",
  },
  stopped: {
    run: "running",
    pause: "stopped",
    stop: "stopped",
    reset: "ready",
  },
};

function press(page, control) {
  const { actions, store, toEnd, tick } = page;
  if (control === "end") {
    tick();
    toEnd();
  } else if (control === "pause") {
    if (store.get().run.state === "paused") {
      actions.resume();
    } else {
      actions.pause();
    }
  } else {
    actions[control]();
  }
}

describe("live mode walks every state and transition (#153)", () => {
  for (const [from, path] of Object.entries(LIVE_PATHS)) {
    for (const [control, to] of Object.entries(LIVE_MOVES[from])) {
      it(`${from} + ${control} -> ${to}`, () => {
        const page = setup();
        for (const step of path) {
          press(page, step);
        }
        assert.equal(liveName(page.store.get()), from);
        assertControls(page.model(), LIVE_TABLE[from], from);
        assert.equal(page.model().help, LIVE_HELP);
        assert.equal(page.model().stop.label, "Stop and discard");
        assert.equal(
          page.model().locked,
          from === "running" || from === "paused",
        );
        press(page, control);
        assert.equal(liveName(page.store.get()), to);
        assertControls(page.model(), LIVE_TABLE[to], to);
        const running = page.store.get().run.state === "running";
        assert.equal(
          page.frames.pending !== null,
          running,
          "frames only while running",
        );
      });
    }
  }

  it("the status line and announcement in each state", () => {
    const page = setup();
    assert.equal(page.model().status, `Ready · seed ${SEED}`);
    page.actions.run();
    page.play(2);
    assert.equal(page.model().status, "Running · 00:02 / 00:03");
    assert.equal(page.model().announce, "Running");
    page.actions.pause();
    assert.equal(page.model().status, "Paused at 00:02");
    // #45 (Fran's copy): one sentence with the totals and the resources.
    const at = page.store.get();
    assert.equal(
      page.model().announce,
      `Paused at 2 seconds. Total damage ${formatNumber(Math.floor(at.results.damage), 0)}. ${formatNumber(at.results.damage / at.results.time, 0)} DPS. Energy ${Math.floor(at.resources.energy.value)} of ${at.resources.energy.max}. Combo points ${at.resources.comboPoints.value} of ${at.resources.comboPoints.max}.`,
    );
    page.actions.stop();
    assert.equal(
      page.model().status,
      `Stopped at 00:02 · fight discarded · Run replays seed ${SEED} from 0:00`,
    );
    assert.equal(
      page.model().announce,
      "Stopped at 2 seconds. Fight discarded.",
    );
    page.actions.run();
    page.toEnd();
    const result = reference(DURATION);
    assert.equal(
      page.model().status,
      `Finished · 3 s · ${formatNumber(result.dps, 1)} DPS`,
    );
    const done = page.store.get().results;
    assert.equal(
      page.model().announce,
      `Finished at 3 seconds. Total damage ${formatNumber(Math.floor(done.damage), 0)}. ${formatNumber(result.dps, 1)} DPS.`,
    );
  });

  it("U9 polish: the finished line's DPS has commas, as speech says it", () => {
    const page = setup();
    const { run } = page.store.get();
    page.store.set({
      run: { ...run, state: "finished", duration: 300 },
      results: { time: 300, damage: 762330 },
    });
    assert.equal(page.model().status, "Finished · 300 s · 2,541.1 DPS");
    assert.match(page.model().announce, / 2,541\.1 DPS\.$/);
  });

  it("Stop then Run reproduces the same fight for the same seed", () => {
    const page = setup();
    page.actions.run();
    page.tick();
    page.tick(1000);
    const first = page.live.fight();
    const at = page.store.get().results;
    page.actions.stop();
    assert.equal(page.store.get().run.stoppedAt, at.time);
    assert.deepEqual(page.store.get().results, at, "the last picture stays");
    page.actions.run();
    assert.notEqual(page.live.fight(), first, "a new fight");
    assert.equal(page.store.get().results.time, 0, "from 0:00");
    assert.equal(page.store.get().run.stoppedAt, null);
    page.toEnd();
    assert.deepEqual(page.live.result, reference(DURATION));
  });

  it("Reset clears the picture to an empty fight at 0:00", () => {
    const page = setup();
    page.actions.run();
    page.tick();
    page.tick(1000);
    assert.ok(page.store.get().log.length > 0);
    page.actions.reset();
    const state = page.store.get();
    assert.equal(state.run.state, "idle");
    assert.deepEqual(state.results, { time: 0, damage: 0 });
    assert.deepEqual(state.log, []);
    assert.equal(state.run.shown, false);
    assert.equal(state.run.snapshot, null);
  });

  it("an empty seed is drawn at Run and filled in", () => {
    const page = setup({ seed: null });
    assert.equal(page.model().status, "Ready · seed new at Run");
    page.actions.run();
    const { run } = page.store.get();
    assert.equal(run.seed, 8);
    assert.equal(run.fields.seed, "8");
    page.actions.stop();
    page.actions.run();
    assert.equal(page.store.get().run.seed, 8, "kept for the replay");
    page.toEnd();
    assert.deepEqual(page.live.result, reference(DURATION, 8));
  });

  it("New seed draws one, only while unlocked", () => {
    const page = setup();
    page.actions.newSeed();
    assert.equal(page.store.get().run.seed, 8);
    assert.equal(page.store.get().run.fields.seed, "8");
    page.actions.run();
    page.actions.newSeed();
    assert.equal(page.store.get().run.seed, 8, "locked while running");
  });

  it("an invalid field or form field blocks Run; fields lock while running", () => {
    const page = setup();
    const bad = { text: "0", ...parseRunField("duration", "0") };
    page.actions.edit("duration", bad);
    assert.equal(page.store.get().run.duration, DURATION, "last valid kept");
    assert.equal(page.store.get().run.fields.duration, "0");
    assert.ok(page.model().run.disabled);
    page.actions.run();
    assert.equal(page.store.get().run.state, "idle", "Run does nothing");
    page.actions.edit("duration", {
      text: "2",
      ...parseRunField("duration", "2"),
    });
    assert.equal(page.model().run.disabled, false);
    assert.equal(page.store.get().run.duration, 2);

    page.store.set({ form: { errors: { "rogue.agility": "Bad." } } });
    assert.ok(page.model().run.disabled, "a stats form error blocks Run");
    page.actions.run();
    assert.equal(page.store.get().run.state, "idle");
    page.store.set({ form: { errors: {} } });

    page.actions.run();
    page.actions.edit("duration", {
      text: "9",
      ...parseRunField("duration", "9"),
    });
    page.actions.setMode("batch");
    assert.equal(page.store.get().run.duration, 2, "locked while running");
    assert.equal(page.store.get().run.mode, "live");
    page.toEnd();
    assert.equal(page.live.result.duration, 2);
  });

  it("config applies to the next run: Run snapshots it", () => {
    const page = setup();
    page.actions.run();
    const { snapshot } = page.store.get().run;
    assert.ok(snapshot, "Run snapshots the config");
    assert.equal(editedSinceRun(page.store.get()), false);
    const edited = structuredClone(config);
    edited.character = {
      ...edited.character,
      attackPower: edited.character.attackPower + 1,
    };
    page.store.set({ config: edited });
    assert.equal(editedSinceRun(page.store.get()), true);
    page.toEnd();
    assert.deepEqual(page.live.result.config, snapshot, "the fight kept it");
    page.actions.reset();
    assert.equal(
      editedSinceRun(page.store.get()),
      false,
      "nothing on the page",
    );
  });
});

describe("batch mode (#153, #154 §10)", () => {
  function batchPage() {
    const page = setup();
    page.actions.setMode("batch");
    return page;
  }

  it("idle: Run batch, Pause shown but not pressable, Reset only with a result", () => {
    const page = batchPage();
    const model = page.model();
    assert.equal(page.store.get().run.state, "idle");
    assert.equal(model.run.label, "Run batch");
    assert.equal(model.run.disabled, false);
    assert.equal(model.pause.inert, true, "aria-disabled");
    assert.equal(model.pause.disabled, false, "focusable");
    assert.equal(model.stop.label, "Stop and keep partial");
    assert.equal(model.stop.disabled, true);
    assert.equal(model.reset.disabled, true);
    assert.equal(model.help, BATCH_HELP);
    assert.equal(model.status, `Ready · 4 fights · seed ${SEED}`);
    page.actions.pause();
    page.actions.resume();
    assert.equal(page.store.get().run.state, "idle");
  });

  it("Run shows 0 of N at once, then progress, then the result", async () => {
    const page = batchPage();
    const before = {
      status: "done",
      result: batchResult({ completed: 4, iterations: 4, cancelled: false }),
    };
    page.store.set({ batch: { ...page.store.get().batch, ...before } });
    page.actions.run();
    const { batch, run } = page.store.get();
    assert.equal(batch.status, "running");
    assert.equal(run.state, "running");
    assert.deepEqual(batch.progress, { completed: 0, total: 4, mean: null });
    assert.equal(batch.previous, before.result, "greyed till the result");
    assert.equal(batch.result, null);
    assert.equal(batch.mode, "main");
    assert.equal(page.model().status, "0/4 fights · Running batch");
    assert.deepEqual(page.model().progress, {
      value: 0,
      max: 4,
      text: "0 of 4 fights",
    });
    assert.deepEqual(page.client.calls[0], {
      seed: SEED,
      iterations: 4,
      duration: DURATION,
      config: run.snapshot,
    });
    assertControls(page.model(), [null, null, true, false], "running");
    assert.equal(page.model().locked, true);
    page.actions.run();
    assert.equal(page.client.calls.length, 1, "Run is off while running");

    page.client.job.onProgress({ completed: 2, total: 4, mean: 310 });
    // Kept on the card as the previous average while this one runs (#242).
    assert.equal(page.store.get().batch.previous, before.result);
    assert.deepEqual(page.store.get().batch.progress, {
      completed: 2,
      total: 4,
      mean: 310,
    });
    assert.equal(page.model().status, "2/4 fights · Running batch");

    const result = batchResult({
      completed: 4,
      iterations: 4,
      cancelled: false,
      mean: 312.44,
    });
    page.client.job.resolve(result);
    await settled();
    const done = page.store.get();
    assert.equal(done.batch.status, "done");
    assert.equal(done.run.state, "done");
    assert.equal(done.batch.result, result);
    assert.ok(done.batch.elapsedMs > 0);
    assert.equal(page.model().status, "4 fights · 312.4 DPS mean · Done");
    assert.equal(page.model().announce, null, "the results panel says it");
    assert.equal(page.model().progress, null);
    assertControls(page.model(), ["Run batch", null, false, true], "done");
    page.client.job.onProgress({ completed: 3, total: 4, mean: 1 });
    assert.equal(
      page.store.get().batch.progress.completed,
      4,
      "late progress ignored",
    );
  });

  it("U9 polish: the batch lines' mean DPS has commas", async () => {
    const page = batchPage();
    page.actions.run();
    page.client.job.resolve(
      batchResult({
        completed: 4,
        iterations: 4,
        cancelled: false,
        mean: 2541.08,
      }),
    );
    await settled();
    assert.equal(page.model().status, "4 fights · 2,541.1 DPS mean · Done");

    page.actions.run();
    page.actions.stop();
    page.client.job.resolve(
      batchResult({
        completed: 2,
        iterations: 4,
        cancelled: true,
        mean: 12345.66,
      }),
    );
    await settled();
    assert.equal(
      page.model().status,
      "2/4 fights kept · 12,345.7 DPS mean (partial) · Stopped",
    );
  });

  it("Stop cancels and keeps the partial result, marked as cancelled", async () => {
    const page = batchPage();
    page.actions.run();
    page.client.job.onProgress({ completed: 2, total: 4, mean: 300 });
    page.actions.stop();
    assert.equal(page.client.cancelled, 1);
    page.client.job.resolve(
      batchResult({
        completed: 2,
        iterations: 4,
        cancelled: true,
        mean: 299.96,
      }),
    );
    await settled();
    const { batch } = page.store.get();
    assert.equal(batch.status, "cancelled");
    assert.equal(batch.result.cancelled, true);
    assert.equal(batch.result.completed, 2);
    assert.equal(
      page.model().status,
      "2/4 fights kept · 300.0 DPS mean (partial) · Stopped",
    );
    assert.equal(page.model().announce, null, "the results panel says it");
    assertControls(page.model(), ["Run batch", null, false, true], "cancelled");
    page.actions.reset();
    assert.deepEqual(page.store.get().batch, emptyBatch("main"));
    assert.equal(page.store.get().run.state, "idle");
  });

  it("a stop before the first fight keeps 0 fights", async () => {
    const page = batchPage();
    page.actions.run();
    page.actions.stop();
    page.client.job.resolve(
      batchResult({ completed: 0, iterations: 4, cancelled: true }),
    );
    await settled();
    assert.equal(page.model().status, "0/4 fights kept · Stopped");
    assert.equal(page.store.get().batch.previous, null);
  });

  it("an error settles as error, with its name and message", async () => {
    const page = batchPage();
    page.actions.run();
    page.client.job.reject(new RangeError("Bad batch."));
    await settled();
    const { batch } = page.store.get();
    assert.equal(batch.status, "error");
    assert.deepEqual(batch.error, {
      name: "RangeError",
      message: "Bad batch.",
    });
    assert.equal(page.model().status, "Batch failed: Bad batch.");
    assertControls(page.model(), ["Run batch", null, false, true], "error");
  });

  it("the mode switches only while nothing runs, and keeps each mode's state", async () => {
    const page = setup();
    page.actions.run();
    page.actions.setMode("batch");
    assert.equal(page.store.get().run.mode, "live", "locked while live runs");
    page.toEnd();
    page.actions.setMode("batch");
    assert.equal(page.store.get().run.state, "idle", "batch.status");
    page.actions.run();
    page.actions.setMode("live");
    assert.equal(
      page.store.get().run.mode,
      "batch",
      "locked while a batch runs",
    );
    page.client.job.resolve(
      batchResult({ completed: 4, iterations: 4, cancelled: false }),
    );
    await settled();
    page.actions.setMode("live");
    assert.equal(page.store.get().run.state, "finished", "the runner's state");
    assert.throws(() => page.actions.setMode("turbo"), RangeError);
  });

  it("Reset while a batch runs does nothing; after it settles, clears (#155)", async () => {
    const page = batchPage();
    page.actions.run();
    const running = page.store.get();
    page.actions.reset();
    assert.equal(page.store.get(), running, "no change at all");
    assert.equal(page.client.cancelled, 0, "and no cancel");
    assert.equal(page.model().reset.disabled, true);
    page.client.job.resolve(
      batchResult({ completed: 4, iterations: 4, cancelled: false }),
    );
    await settled();
    assert.equal(page.store.get().batch.status, "done");
    page.actions.reset();
    assert.equal(page.store.get().batch.status, "idle");
    assert.equal(page.store.get().batch.result, null);
    assert.equal(page.store.get().run.state, "idle");
  });

  it("tick moves a running batch's elapsed time, and nothing else (#155)", async () => {
    const page = batchPage();
    const idle = page.store.get();
    page.actions.tick();
    assert.equal(page.store.get(), idle, "no batch: no change");
    page.actions.run();
    const { startedAt } = page.store.get().batch;
    assert.notEqual(startedAt, null);
    page.actions.tick();
    const first = page.store.get().batch.elapsedMs;
    assert.ok(first > 0);
    page.actions.tick();
    assert.ok(page.store.get().batch.elapsedMs > first, "with no progress");
    assert.equal(page.store.get().batch.progress.completed, 0);
    page.client.job.resolve(
      batchResult({ completed: 4, iterations: 4, cancelled: false }),
    );
    await settled();
    const done = page.store.get();
    page.actions.tick();
    assert.equal(page.store.get(), done, "settled: no change");
  });
});

describe("one fight is a fight (#155, Fran's Phase 3 QA 5)", () => {
  it("the bar's batch statuses and progress say fight, not fights, for 1", async () => {
    const page = setup();
    page.store.set({
      run: {
        ...page.store.get().run,
        iterations: 1,
        fields: { ...page.store.get().run.fields, iterations: "1" },
      },
    });
    page.actions.setMode("batch");
    assert.equal(page.model().status, `Ready · 1 fight · seed ${SEED}`);
    page.actions.run();
    assert.equal(page.model().status, "0/1 fight · Running batch");
    assert.equal(page.model().progress.text, "0 of 1 fight");
    page.client.job.resolve(
      batchResult({ completed: 1, iterations: 1, cancelled: false }),
    );
    await settled();
    assert.equal(page.model().status, "1 fight · 300.0 DPS mean · Done");
  });
});

describe("the running total is short (#155)", () => {
  it("keeps numbers under a thousand whole and shortens the rest to k", () => {
    assert.equal(compact(999), "999");
    assert.equal(compact(1000), "1k");
    assert.equal(compact(1500), "1.5k");
    assert.equal(compact(100000), "100k");
  });
});

describe("Run blocked (#155, Fran's Phase 3 QA 1)", () => {
  it("the status says why and how many, never Ready, in both modes", () => {
    const page = setup();
    page.actions.edit("duration", {
      text: "0",
      ...parseRunField("duration", "0"),
    });
    assert.equal(page.model().status, "Can't run · 1 setting to fix");
    assert.equal(page.model().reason, "Can't run · 1 setting to fix");
    assert.equal(page.model().run.disabled, true);
    page.store.set({ form: { errors: { a: "Bad.", b: null, c: "Bad." } } });
    assert.equal(page.model().status, "Can't run · 3 settings to fix");
    assert.equal(errorsText(page.store.get().run, 2), "Fix 3 settings");
    page.actions.setMode("batch");
    assert.equal(page.model().status, "Can't run · 3 settings to fix");
    assert.notEqual(page.model().announce, null, "the switch still says Ready");
    page.store.set({ form: { errors: {} } });
    page.actions.edit("duration", {
      text: "5",
      ...parseRunField("duration", "5"),
    });
    assert.equal(page.model().reason, null);
    assert.match(page.model().status, /^Ready · 4 fights/);
    assert.equal(page.model().run.disabled, false);
  });

  it("a finished fight's status gives way to the reason while blocked", () => {
    const page = setup();
    page.actions.run();
    page.toEnd();
    assert.match(page.model().status, /^Finished/);
    page.store.set({ form: { errors: { a: "Bad." } } });
    assert.equal(page.model().status, "Can't run · 1 setting to fix");
    page.store.set({ form: { errors: {} } });
    assert.match(page.model().status, /^Finished/);
  });

  it("the view: Run is described by the reason, and Fix reaches the form", () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    assert.equal(el("run-button").getAttribute("aria-describedby"), null);
    assert.equal(el("run-reason").textContent, "");
    assert.equal(el("run-errors-link").hidden, true);

    page.store.set({ form: { errors: { "rogue.agility": "Bad." } } });
    assert.equal(el("run-button").disabled, true);
    assert.equal(
      el("run-button").getAttribute("aria-describedby"),
      "run-reason",
    );
    assert.equal(el("run-reason").textContent, "Can't run · 1 setting to fix");
    assert.equal(
      el("run-status-text").textContent,
      "Can't run · 1 setting to fix",
    );
    const link = el("run-errors-link");
    assert.equal(link.hidden, false, "shown at every width");
    assert.equal(link.textContent, "Fix 1 setting");
    assert.equal(el("run-bar").classes.has("has-errors"), true);
    const event = link.fire("click");
    assert.equal(event.prevented, 1);
    const invalid = el('config-form [aria-invalid="true"]');
    assert.equal(invalid.focused, 1, "the form's first invalid field");

    page.store.set({ form: { errors: {} } });
    assert.equal(el("run-button").disabled, false);
    assert.equal(el("run-button").getAttribute("aria-describedby"), null);
    assert.equal(el("run-reason").textContent, "");
    assert.equal(link.hidden, true);
    assert.match(el("run-status-text").textContent, /^Ready/);
  });
});

describe("Run's blocked check is its count (#237)", () => {
  const MIN = "weapons.mainHand.min";
  const MAX = "weapons.mainHand.max";
  // Each blocker on its own, by the slice it lives in.
  const FORM = {
    none: {},
    nullOnly: { [MIN]: null },
    pair: { [MIN]: null, [MAX]: "Max damage must be at least the min damage." },
    backstop: { [FORM_ERROR]: "This setup can't run: no." },
    two: { "character.attackPower": "Bad.", [MIN]: null, [MAX]: "Bad." },
  };
  const RUN = {
    none: {},
    duration: { duration: "Bad." },
    fights: { iterations: "Batch only." },
  };
  const TALENTS = { none: null, overCap: "Over the cap." };
  const ROTATION = { none: [], bad: [{ path: "name", code: "nameEmpty" }] };

  it("blocked(state) is blockedCount(state) > 0 for every mix, in both modes", () => {
    const page = setup();
    const base = page.store.get();
    let seen = 0;
    for (const mode of ["live", "batch"]) {
      for (const [formName, errors] of Object.entries(FORM)) {
        for (const [runName, runErrors] of Object.entries(RUN)) {
          for (const [talentName, error] of Object.entries(TALENTS)) {
            for (const [rotationName, rotationErrors] of Object.entries(
              ROTATION,
            )) {
              const state = {
                ...base,
                run: { ...base.run, mode, errors: runErrors },
                form: { ...base.form, errors, rotationErrors },
                talents: { ...base.talents, error },
              };
              const mix = [
                mode,
                formName,
                runName,
                talentName,
                rotationName,
              ].join(" ");
              const count = blockedCount(state);
              assert.equal(blocked(state), count > 0, mix);
              const model = controlsModel(state);
              assert.equal(model.run.disabled, count > 0, mix);
              assert.equal(model.reason === null, count === 0, mix);
              assert.doesNotMatch(model.reason ?? "", /\b0 settings/, mix);
              seen += 1;
            }
          }
        }
      }
    }
    assert.equal(
      seen,
      2 * Object.keys(FORM).length * Object.keys(RUN).length * 2 * 2,
    );
  });

  it("null entries never count, and FORM_ERROR is one setting to fix", () => {
    const page = setup();
    const withForm = (errors) =>
      page.store.set({ form: { ...page.store.get().form, errors } });
    withForm(FORM.nullOnly);
    assert.equal(blocked(page.store.get()), false, "a Min that marks nothing");
    assert.equal(page.model().run.disabled, false);
    withForm(FORM.pair);
    assert.equal(page.model().reason, "Can't run · 1 setting to fix");
    withForm(FORM.backstop);
    assert.equal(page.model().reason, "Can't run · 1 setting to fix");
    assert.equal(errorsText(page.store.get().run, 1), "Fix 1 setting");
    withForm(FORM.two);
    assert.equal(page.model().reason, "Can't run · 2 settings to fix");
    page.store.set({
      talents: { ...page.store.get().talents, error: TALENTS.overCap },
      form: { ...page.store.get().form, rotationErrors: ROTATION.bad },
    });
    assert.equal(page.model().reason, "Can't run · 4 settings to fix");
  });
});

describe("Run blocked by a rotation with errors (#217, D17; Scout, 29 Oct)", () => {
  const withErrors = (page, n) =>
    page.store.set({
      form: {
        ...page.store.get().form,
        errors: {},
        rotationErrors: Array.from({ length: n }, (_, at) => ({
          path: `rules[${at}].action`,
          code: "unknownAction",
        })),
      },
    });

  it("counts the rotation as one setting, named with its error count", () => {
    const page = setup();
    withErrors(page, 4);
    assert.equal(page.model().run.disabled, true);
    assert.equal(page.model().reason, "Can't run · Rotation has 4 errors");
    assert.equal(page.model().statusShort, "Rotation errors");
    withErrors(page, 1);
    assert.equal(page.model().reason, "Can't run · Rotation has 1 error");
  });

  it("with another blocker too, the rotation is one of the settings", () => {
    const page = setup();
    withErrors(page, 3);
    page.store.set({
      form: { ...page.store.get().form, errors: { "rogue.agility": "Bad." } },
    });
    assert.equal(page.model().reason, "Can't run · 2 settings to fix");
    assert.equal(page.model().statusShort, null);
  });

  it("the Fix link opens the builder at the first error", () => {
    const page = setup();
    withErrors(page, 2);
    let fixed = 0;
    const { doc, el } = standIn({
      absent: ['#config-form [aria-invalid="true"]'],
    });
    createControlsView(doc, page.store, {
      ...page.actions,
      fixRotation: () => {
        fixed += 1;
      },
    });
    const link = el("run-errors-link");
    assert.equal(link.hidden, false);
    assert.equal(link.textContent, "Fix 1 setting");
    link.fire("click");
    assert.equal(fixed, 1);
  });
});

describe("Run blocked by talents over the cap (#204, Fran's QA of #208)", () => {
  const overCap = (page) =>
    page.store.set({
      talents: { ...page.store.get().talents, error: "Over the cap." },
    });

  it("the reason names the talents when they are the only blocker", () => {
    const page = setup();
    overCap(page);
    assert.equal(page.model().reason, "Can't run · Talents over the level cap");
    assert.equal(page.model().status, "Can't run · Talents over the level cap");
    assert.equal(page.model().run.disabled, true);
    page.actions.setMode("batch");
    assert.equal(page.model().reason, "Can't run · Talents over the level cap");
  });

  it("with another blocker too, the reason counts the settings", () => {
    const page = setup();
    overCap(page);
    page.store.set({ form: { errors: { "rogue.agility": "Bad." } } });
    assert.equal(page.model().reason, "Can't run · 2 settings to fix");
    assert.equal(page.model().statusShort, null, "that one fits the row");
  });

  it("the narrow row gets a shorter status; the reason keeps the full text", () => {
    const page = setup();
    assert.equal(page.model().statusShort, null);
    overCap(page);
    assert.equal(page.model().statusShort, "Talents over cap");
    page.actions.setMode("batch");
    assert.equal(page.model().statusShort, "Talents over cap");

    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    const status = el("run-status-text");
    assert.equal(status.textContent, "Can't run · Talents over the level cap");
    assert.equal(status.getAttribute("data-short"), "Talents over cap");
    assert.equal(
      el("run-reason").textContent,
      "Can't run · Talents over the level cap",
    );
    page.store.set({
      talents: { ...page.store.get().talents, error: null },
    });
    assert.equal(status.getAttribute("data-short"), null);
  });

  it("styles.css draws the dock's short lines only in the dock (#240)", async () => {
    const css = await readFile(
      new URL("../styles.css", import.meta.url),
      "utf8",
    );
    const dock = css.indexOf(`@media ${NOT_WIDE_QUERY} {`);
    const short = css.indexOf("#run-status-text[data-dock]::before {");
    assert.ok(dock >= 0 && short > dock, "inside the dock query");
    assert.ok(short < css.indexOf("@media", dock + 1), "the first dock block");
    assert.match(
      css.slice(short, css.indexOf("}", short)),
      /content: attr\(data-dock\) \/ "";/,
    );
    assert.match(css, /#run-summary\[data-dock\]::before,/);
  });

  // The tree is Character's Talents screen (#244, UX6): revealing its Level
  // input shows the screen (the router's, browser-tests/character-screens),
  // so the Talents row is never clicked.
  it("Fix 1 setting focuses the talent tree's Level input", () => {
    const page = setup();
    const { doc, el } = standIn({
      absent: ['#config-form [aria-invalid="true"]'],
    });
    const edit = el("talents-edit");
    let opened = 0;
    edit.click = () => {
      opened += 1;
    };
    createControlsView(doc, page.store, page.actions);
    overCap(page);
    const link = el("run-errors-link");
    assert.equal(link.hidden, false);
    assert.equal(link.textContent, "Fix 1 setting");
    assert.equal(
      el("run-reason").textContent,
      "Can't run · Talents over the level cap",
    );
    assert.equal(link.fire("click").prevented, 1);
    assert.equal(opened, 0, "the row is not clicked");
    assert.equal(el("talents-level").focused, 1, "Level has the focus");
    link.fire("click");
    assert.equal(opened, 0, "the row is not clicked");
    assert.equal(el("talents-level").focused, 2);
  });
});

// The view on a small stand-in document. `order` is three parts in document
// order (Fight's settings, the row, the help line); after() and before()
// would move them, and since #245 nothing does. `media` is a matchMedia query result, or none.
function standIn({ media = null, absent = [] } = {}) {
  const elements = new Map();
  const order = ["run-settings", "run-bar", "run-help"];
  const move = (id, next, offset) => {
    order.splice(order.indexOf(id), 1);
    order.splice(order.indexOf(next) + offset, 0, id);
  };
  const make = (id) => {
    const attributes = new Map();
    const listeners = new Map();
    const node = {
      id,
      value: "",
      textContent: "",
      hidden: false,
      disabled: false,
      checked: false,
      classes: new Set(),
      listeners,
      focused: 0,
      classList: {
        toggle: (name, on) => node.classes[on ? "add" : "delete"](name),
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
      getAttribute: (name) =>
        attributes.has(name) ? attributes.get(name) : null,
      addEventListener: (type, listener) => listeners.set(type, listener),
      fire(
        type,
        event = {
          prevented: 0,
          preventDefault() {
            this.prevented += 1;
          },
        },
      ) {
        listeners.get(type)?.(event);
        return event;
      },
      get nextElementSibling() {
        const at = order.indexOf(id);
        return at < 0 || at === order.length - 1
          ? null
          : doc.querySelector(`#${order[at + 1]}`);
      },
      after(other) {
        move(other.id, id, 1);
      },
      before(other) {
        move(other.id, id, 0);
      },
      contains: (other) =>
        other?.id?.startsWith("run-") ||
        other?.id?.endsWith("-button") ||
        false,
      focus() {
        node.focused += 1;
        doc.activeElement = node;
      },
    };
    return node;
  };
  const docListeners = new Map();
  const doc = {
    activeElement: null,
    body: { id: "body" },
    defaultView: media === null ? {} : { matchMedia: () => media },
    addEventListener: (type, listener) => docListeners.set(type, listener),
    fire: (type, event) => docListeners.get(type)?.(event),
    querySelector(selector) {
      if (absent.includes(selector)) {
        return null;
      }
      if (!elements.has(selector)) {
        elements.set(selector, make(selector.slice(1)));
      }
      return elements.get(selector);
    },
  };
  return { doc, el: (id) => doc.querySelector(`#${id}`), order };
}

// A matchMedia result the test flips.
function fakeMedia(matches) {
  return {
    matches,
    listener: null,
    queries: [],
    addEventListener(type, listener) {
      this.listener = listener;
    },
    flip(next) {
      this.matches = next;
      this.listener?.();
    },
  };
}

describe("the control bar view (#153)", () => {
  it("draws the model, calls the actions and never writes the store", () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    assert.equal(el("run-button").textContent, "Run");
    assert.equal(el("run-mode-live").checked, true);
    assert.equal(el("run-iterations-field").hidden, true, "Fights: batch only");
    assert.equal(el("run-help").textContent, LIVE_HELP);
    assert.equal(
      el("run-announce").textContent,
      "",
      "the first draw is silent",
    );

    el("run-button").focus();
    el("run-button").fire("click");
    assert.equal(page.store.get().run.state, "running");
    assert.equal(el("run-announce").textContent, "Running");
    assert.equal(doc.activeElement, el("pause-button"), "focus to Pause");
    assert.equal(el("run-duration").disabled, true);
    assert.equal(el("run-mode-batch").disabled, true);
    assert.equal(el("run-seed-new").disabled, true);

    page.play(1);
    const announced = el("run-announce").textContent;
    page.tick();
    assert.equal(el("run-announce").textContent, announced, "ticks are silent");
    assert.equal(el("run-status-text").textContent, "Running · 00:01 / 00:03");

    el("pause-button").fire("click");
    assert.match(
      el("run-announce").textContent,
      /^Paused at 1 second\. Total damage [\d,]+\. [\d,]+ DPS\. Energy \d+ of 100\. Combo points \d of 5\.$/,
    );
    // The label swap says it (#45, Scout): no aria-pressed.
    assert.equal(el("pause-button").getAttribute("aria-pressed"), null);
    assert.equal(el("pause-label").textContent, "Resume");
    // Resume says Running, as Run does (#45, Scout).
    el("pause-button").fire("click");
    assert.equal(page.store.get().run.state, "running");
    assert.equal(el("run-announce").textContent, "Running");
    el("pause-button").fire("click");
    assert.match(el("run-announce").textContent, /^Paused at 1 second\./);
    el("stop-button").fire("click");
    assert.equal(page.store.get().run.state, "idle");
    assert.equal(doc.activeElement, el("run-button"), "focus to Run");
    assert.equal(
      el("run-announce").textContent,
      "Stopped at 1 second. Fight discarded.",
    );
    el("reset-button").focus();
    el("reset-button").fire("click");
    assert.equal(el("reset-button").disabled, true);
    assert.equal(doc.activeElement, el("run-button"), "off a disabled Reset");
    assert.equal(el("run-status-text").textContent, `Ready · seed ${SEED}`);
    assert.equal(el("run-announce").textContent, "Ready");
  });

  it("#run-announce: emptied, then written on the next frame, once per change (#45)", () => {
    const page = setup();
    const { doc, el } = standIn();
    const queued = [];
    doc.defaultView.requestAnimationFrame = (run) => queued.push(run);
    doc.defaultView.cancelAnimationFrame = (id) => (queued[id - 1] = null);
    const next = () => {
      const runs = queued.splice(0).filter(Boolean);
      runs.forEach((run) => run());
      return runs.length;
    };
    createControlsView(doc, page.store, page.actions);
    el("run-button").fire("click");
    assert.equal(el("run-announce").textContent, "", "emptied first");
    assert.equal(next(), 1);
    assert.equal(el("run-announce").textContent, "Running");
    page.play(1);
    assert.equal(queued.length, 0, "ticks queue nothing");

    el("pause-button").fire("click");
    assert.equal(el("run-announce").textContent, "");
    next();
    const paused = el("run-announce").textContent;
    assert.match(paused, /^Paused at 1 second\./);
    el("pause-button").fire("click");
    assert.equal(el("run-announce").textContent, "", "Resume empties it");
    assert.equal(next(), 1, "then writes on the next frame");
    assert.equal(el("run-announce").textContent, "Running", "as Run does");
    // The same words again are a fresh change.
    el("pause-button").fire("click");
    assert.equal(el("run-announce").textContent, "");
    next();
    assert.equal(el("run-announce").textContent, paused);

    // A change before the frame replaces the waiting message.
    el("stop-button").fire("click");
    el("reset-button").fire("click");
    assert.equal(next(), 1);
    assert.equal(el("run-announce").textContent, "Ready");
  });

  it("fields: invalid text is marked and described, and blocks Run", () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    el("run-seed").value = "4294967296";
    el("run-seed").fire("input");
    assert.equal(el("run-seed").getAttribute("aria-invalid"), "true");
    assert.equal(
      el("run-seed").getAttribute("aria-describedby"),
      "run-seed-error",
    );
    assert.equal(el("run-seed-error").hidden, false);
    assert.match(el("run-seed-error").textContent, /^Seed must be/);
    assert.equal(el("run-button").disabled, true);
    el("run-seed-new").fire("click");
    assert.equal(el("run-seed").value, "8");
    assert.equal(el("run-seed").getAttribute("aria-invalid"), null);
    assert.equal(el("run-seed-error").hidden, true);
    assert.equal(el("run-button").disabled, false);
  });

  it("batch mode: Fights shown, Pause aria-disabled with the help as reason", async () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    el("run-mode-batch").value = "batch";
    el("run-mode-batch").checked = true;
    el("run-mode-batch").fire("change");
    assert.equal(page.store.get().run.mode, "batch");
    assert.equal(el("run-iterations-field").hidden, false);
    assert.equal(el("run-iterations").value, "4");
    assert.equal(el("pause-button").getAttribute("aria-disabled"), "true");
    assert.equal(
      el("pause-button").getAttribute("aria-describedby"),
      "run-help",
    );
    assert.equal(el("run-help").textContent, BATCH_HELP);
    el("pause-button").fire("click");
    assert.equal(page.store.get().run.state, "idle", "the click is guarded");

    const ready = el("run-announce").textContent;
    el("run-button").focus();
    el("run-button").fire("click");
    assert.equal(doc.activeElement, el("stop-button"), "focus to Stop");
    assert.equal(el("run-progress-row").hidden, false);
    assert.equal(el("run-progress").max, 4);
    assert.equal(el("run-progress").value, 0);
    assert.equal(el("run-progress-text").textContent, "0 of 4 fights");
    assert.equal(
      el("run-announce").textContent,
      ready,
      "the results panel announces a batch (#155: not twice)",
    );
    el("stop-button").fire("click");
    assert.equal(page.client.cancelled, 1);
    page.client.job.resolve(
      batchResult({ completed: 1, iterations: 4, cancelled: true }),
    );
    await settled();
    assert.equal(el("run-progress-row").hidden, true);
    assert.equal(doc.activeElement, el("run-button"));
    assert.equal(el("run-announce").textContent, ready);

    el("pause-button").removeAttribute("aria-disabled");
    el("run-mode-live").value = "live";
    el("run-mode-live").checked = true;
    el("run-mode-live").fire("change");
    assert.equal(el("pause-button").getAttribute("aria-disabled"), null);
  });

  it("never writes the store: no store.set or update in the view", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../js/views/controls.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /store\.(set|update|batch)\(/);
  });
});

// Scout's narrow spec (#153): below 520 px one compact sticky row holds Run
// or Pause, Stop, Reset and a one-line summary with the mode; the settings
// collapse under it, closed by default; an error in a closed field is reached
// through the row's link. Wide screens are unchanged.
describe("the narrow control bar (#153, Scout)", () => {
  const runOf = (overrides) => ({
    mode: "live",
    state: "idle",
    seed: 1234,
    duration: 300,
    iterations: 1000,
    errors: {},
    ...overrides,
  });

  it("the summary names the mode and the next run's settings", () => {
    assert.equal(summaryText(runOf()), "Live · 300 s · seed 1234");
    assert.equal(
      summaryText(runOf({ mode: "batch" })),
      "Batch · 1,000 × 300 s · seed 1234",
    );
    assert.equal(
      summaryText(runOf({ mode: "batch", iterations: 100000, duration: 2.5 })),
      "Batch · 100,000 × 2.5 s · seed 1234",
    );
    assert.equal(
      summaryText(runOf({ seed: null })),
      "Live · 300 s · seed new at Run",
    );
    assert.equal(summaryText(runOf({ seed: 0 })), "Live · 300 s · seed 0");
    assert.equal(
      summaryText(runOf({ errors: { duration: "x", seed: "y" } })),
      "Live · ? s · seed ?",
      "a field with an error shows ?",
    );
    assert.equal(
      summaryText(runOf({ mode: "batch", errors: { iterations: "x" } })),
      "Batch · ? × 300 s · seed 1234",
    );
  });

  it("errors count by mode: Fights only in batch, where the field shows", () => {
    assert.deepEqual(fieldErrors(runOf()), []);
    assert.equal(errorsText(runOf()), null);
    const all = { seed: "s", iterations: "i", duration: "d" };
    assert.deepEqual(fieldErrors(runOf({ errors: all })), ["duration", "seed"]);
    assert.deepEqual(fieldErrors(runOf({ mode: "batch", errors: all })), [
      "duration",
      "iterations",
      "seed",
    ]);
    assert.equal(errorsText(runOf({ errors: { seed: "s" } })), "Fix 1 setting");
    assert.equal(errorsText(runOf({ errors: all })), "Fix 2 settings");
    assert.equal(
      errorsText(runOf({ mode: "batch", errors: all })),
      "Fix 3 settings",
    );
    assert.equal(errorsText(runOf({ errors: { iterations: "i" } })), null);
  });

  it("a Fights error left in batch mode does not block a live Run", () => {
    const page = setup();
    page.actions.setMode("batch");
    page.actions.edit("iterations", {
      text: "0",
      ...parseRunField("iterations", "0"),
    });
    assert.equal(controlsModel(page.store.get()).run.disabled, true);
    page.actions.run();
    assert.equal(page.store.get().batch.status, "idle", "batch blocked");
    page.actions.setMode("live");
    assert.equal(controlsModel(page.store.get()).run.disabled, false);
    page.actions.run();
    assert.equal(page.store.get().run.state, "running", "live runs");
    page.actions.stop();
    page.actions.setMode("batch");
    assert.equal(controlsModel(page.store.get()).run.disabled, true);
  });

  it("the row shows Run or Pause by state and a summary that follows typing", async () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    const slot = () => el("run-controls").getAttribute("data-slot");
    assert.equal(slot(), "run");
    assert.equal(el("run-summary").textContent, `Live · 3 s · seed ${SEED}`);
    el("run-duration").value = "120";
    el("run-duration").fire("input");
    assert.equal(el("run-summary").textContent, `Live · 120 s · seed ${SEED}`);
    el("run-button").fire("click");
    assert.equal(slot(), "pause");
    el("pause-button").fire("click");
    assert.equal(slot(), "pause", "paused: Resume in the slot");
    el("stop-button").fire("click");
    assert.equal(slot(), "run");

    page.actions.setMode("batch");
    assert.equal(
      el("run-summary").textContent,
      `Batch · 4 × 120 s · seed ${SEED}`,
    );
    el("run-button").fire("click");
    assert.equal(slot(), "pause", "Pause, aria-disabled, while a batch runs");
    el("stop-button").fire("click");
    page.client.job.resolve(
      batchResult({ completed: 1, iterations: 4, cancelled: true }),
    );
    await settled();
    assert.equal(slot(), "run");
  });

  it("an error in a field is reached through the row's link, which shows Fight (#245)", () => {
    const page = setup();
    const { doc, el } = standIn();
    // reveal() (js/views/sections.js) dispatches its event on the field;
    // the router shows Fight for it. Each field records it, in order.
    const steps = [];
    class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.bubbles = init?.bubbles;
      }
    }
    for (const id of ["run-duration", "run-seed"]) {
      const field = el(id);
      field.ownerDocument = { defaultView: { CustomEvent } };
      field.dispatchEvent = (event) => steps.push([id, event.type]);
      const focus = field.focus;
      field.focus = () => {
        steps.push([id, "focus"]);
        focus();
      };
    }
    createControlsView(doc, page.store, page.actions);
    const link = el("run-errors-link");
    assert.equal(link.hidden, true);
    assert.equal(el("run-bar").classes.has("has-errors"), false);
    el("run-seed").value = "12x";
    el("run-seed").fire("input");
    el("run-duration").value = "0";
    el("run-duration").fire("input");
    assert.equal(link.hidden, false);
    assert.equal(link.textContent, "Fix 2 settings");
    assert.equal(el("run-bar").classes.has("has-errors"), true);

    const event = link.fire("click");
    assert.equal(event.prevented, 1, "no jump to the anchor");
    assert.equal(doc.activeElement, el("run-duration"), "the first error");
    assert.deepEqual(steps, [
      ["run-duration", REVEAL_EVENT],
      ["run-duration", "focus"],
    ]);

    el("run-duration").value = "300";
    el("run-duration").fire("input");
    assert.equal(link.textContent, "Fix 1 setting");
    link.fire("click");
    assert.equal(doc.activeElement, el("run-seed"));
    assert.deepEqual(steps.slice(2), [
      ["run-seed", REVEAL_EVENT],
      ["run-seed", "focus"],
    ]);
    el("run-seed-new").fire("click");
    assert.equal(link.hidden, true);
    assert.equal(link.textContent, "");
    assert.equal(el("run-bar").classes.has("has-errors"), false);
  });

  it("the view moves nothing: the settings stay in Fight at every width (#245)", () => {
    const page = setup();
    const queries = [];
    const { doc, order } = standIn({ media: fakeMedia(true) });
    doc.defaultView.matchMedia = (query) => {
      queries.push(query);
      return fakeMedia(true);
    };
    createControlsView(doc, page.store, page.actions);
    assert.deepEqual(queries, [], "no width query");
    assert.deepEqual(order, ["run-settings", "run-bar", "run-help"]);
    assert.equal(NARROW_QUERY, "(width < 32.5em)");
  });

  it("the page: the fields are Fight's, and the row is the phone dock (#240, #245)", async () => {
    const { readFile } = await import("node:fs/promises");
    const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
    const html = await read("../index.html");
    const css = await read("../styles.css");
    const at = (id) => html.indexOf(`id="${id}"`);
    for (const id of [
      "run-settings",
      "run-bar",
      "run-summary",
      "run-errors-link",
      "run-fight-link",
      "area-fight",
    ]) {
      assert.ok(at(id) > 0, id);
    }
    assert.doesNotMatch(html, /run-settings-(toggle|body)/);
    // The fields are in Fight, before the target note; the buttons are in
    // the row, and the Run panel links to Fight.
    const fight = html.slice(at("area-fight"), at("area-results"));
    for (const id of [
      "run-settings",
      "run-mode-batch",
      "run-mode-live",
      "run-duration",
      "run-iterations",
      "run-seed",
      "run-seed-new",
    ]) {
      assert.ok(fight.indexOf(`id="${id}"`) > 0, id);
      assert.ok(at(id) < at("fight-target"), `${id} before the target`);
    }
    assert.match(
      html,
      /<a id="run-fight-link" class="run-fight-link" href="#fight"\s*>Change fight settings<\/a/,
    );
    assert.ok(at("run-fight-link") > at("run-bar"));
    for (const id of [
      "run-button",
      "pause-button",
      "stop-button",
      "reset-button",
    ]) {
      assert.ok(at(id) > at("run-bar"), id);
    }

    const start = css.indexOf(`@media ${NARROW_QUERY}`);
    assert.ok(start > 0, "the narrow block");
    const outside = css.slice(0, start);
    let depth = 0;
    let end = css.indexOf("{", start);
    for (let i = end; i < css.length; i += 1) {
      depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    const narrow = css.slice(start, end);
    const rule = (text, selector) => {
      const from = text.indexOf(`${selector} {`);
      assert.ok(from >= 0, selector);
      return text.slice(from, text.indexOf("}", from));
    };
    // Wide: the narrow-only parts are not shown.
    assert.match(
      outside,
      /\.run-summary,\n\.run-dps,\n\.run-errors-link \{\n {2}display: none;/,
    );
    // Narrow: the bar adds no box; nothing in it sticks.
    assert.match(rule(narrow, "  .run-controls"), /display: contents;/);
    assert.doesNotMatch(narrow, /position: sticky/);
    // Fight's fields have the bigger touch targets.
    assert.match(
      narrow,
      /\.fight-settings \.run-mode-pill span,\n {2}\.fight-settings \.run-field input,\n {2}\.fight-settings \.pill-button \{\n {4}min-height: 44px;/,
    );
    // Below the wide breakpoint the row is the dock's strip (#240): fixed
    // above the area nav and its safe-area inset, 48 px (two 18 px lines
    // beside 44 px buttons), in the page's flow on Results.
    const from = css.indexOf(`@media ${NOT_WIDE_QUERY} {`, start);
    assert.ok(from > start, "the dock block follows the narrow block");
    const dock = css.slice(from, css.indexOf("\n}\n", from));
    const strip = rule(dock, "  .run-row-actions");
    assert.match(strip, /position: fixed;/);
    assert.match(
      strip,
      /bottom: calc\(var\(--area-nav-height\) \+ env\(safe-area-inset-bottom\)\);/,
    );
    assert.match(strip, /height: var\(--strip-height\);/);
    assert.match(strip, /grid-template-rows: 18px 18px;/);
    assert.match(css, /--strip-height: 48px;/);
    assert.match(
      rule(dock, "  :root:has(#area-results:not([hidden])) .run-row-actions"),
      /position: relative;/,
    );
    assert.match(rule(dock, "  .run-buttons button"), /min-height: 44px;/);
    assert.match(rule(dock, "  .run-buttons button"), /width: 44px;/);
    // The errors link's box is the 18 px status line; a pseudo-element
    // reaches over the line above and below, so its touch target is 44 px.
    assert.match(
      rule(dock, "  .run-errors-link:not([hidden])"),
      /min-height: 18px;/,
    );
    assert.match(
      rule(dock, "  .run-errors-link:not([hidden])::after"),
      /inset: -20px -8px -6px;/,
    );
    assert.match(
      dock,
      /\.run-controls\[data-slot="pause"\] :is\(#run-button, #reset-button\)/,
    );
    assert.match(
      dock,
      /\.run-controls\[data-slot="run"\] :is\(#pause-button, #stop-button\)/,
    );
  });
});

describe("Run never starts with stale settings (#247)", () => {
  const MIN = "weapons.mainHand.min";
  const MAX = "weapons.mainHand.max";
  const PAIR_MIN = 50;
  const PAIR_MAX = 40;
  const FIXED_MAX = 60;
  const MAX_ID = "cfg-weapons-mainHand-max";
  const MIN_ID = "cfg-weapons-mainHand-min";
  // The bar, with the form's model on the same store, as js/main.js wires
  // them; the stand-in form fields are marked as the form view marks them.
  const wired = () => {
    const page = setup();
    const form = createConfigForm(page.store);
    const { doc, el } = standIn();
    createControlsView(doc, page.store, {
      ...page.actions,
      commitEdits: form.commitEdits,
    });
    const mark = () => {
      const { errors } = page.store.get().form;
      for (const [path, id] of [
        [MIN, MIN_ID],
        [MAX, MAX_ID],
      ]) {
        el(id).setAttribute("aria-invalid", path in errors ? "true" : null);
      }
    };
    page.store.subscribe(mark);
    return { page, form, el, doc };
  };
  // A typed edit Run has not seen: Min 50 and Max 60 committed, then 40
  // typed in Max. Fran's #247 repro (Min 50, Max 40, then 5 and 50 in Min)
  // no longer leaves one: a pair in error is checked as typed (#240 N2).
  const repro = ({ form }) => {
    form.change(MAX, FIXED_MAX);
    form.change(MIN, PAIR_MIN);
    form.input(MAX, PAIR_MAX);
  };

  it("pressing Run checks the typed field; blocked, it keeps focus off Run and sends it to the field to fix", () => {
    const wiring = wired();
    const { page, el } = wiring;
    repro(wiring);
    assert.equal(el("run-button").disabled, false, "typing adds no error");
    const press = el("run-button").fire("mousedown");
    assert.equal(blocked(page.store.get()), true, "checked again");
    assert.equal(press.prevented, 1, "focus stays off the button");
    assert.equal(el(MAX_ID).focused, 1, "the field the footer names");
    assert.equal(el(MIN_ID).focused, 0);
    el("run-button").fire("click");
    assert.equal(page.store.get().run.state, "idle", "no run");
    assert.equal(page.store.get().run.snapshot, null);
  });

  it("a click on Run checks the typed field first, and runs what the fields show", () => {
    const wiring = wired();
    const { page, form, el } = wiring;
    repro(wiring);
    el("run-button").fire("click");
    assert.equal(page.store.get().run.state, "idle", "blocked, so no run");
    assert.equal(el(MAX_ID).focused, 1);
    form.input(MAX, FIXED_MAX);
    el("run-button").fire("mousedown");
    el("run-button").fire("click");
    assert.equal(page.store.get().run.state, "running");
    const { snapshot } = page.store.get().run;
    assert.equal(snapshot.weapons.mainHand.min, PAIR_MIN);
    assert.equal(snapshot.weapons.mainHand.max, FIXED_MAX);
  });

  it("the Fix link goes to the field the footer lists first (nit 4)", () => {
    const wiring = wired();
    const { page, form, el } = wiring;
    form.change(MIN, PAIR_MIN);
    form.change(MAX, PAIR_MAX);
    assert.equal(firstFormError(page.store.get().form), MAX);
    const event = el("run-errors-link").fire("click");
    assert.equal(event.prevented, 1);
    assert.equal(el(MAX_ID).focused, 1, "the Max, which holds the message");
    assert.equal(el(MIN_ID).focused, 0, "not the marked Min");
  });

  it("firstFormError is the first error with a message, in the footer's order", () => {
    assert.equal(firstFormError({ errors: {} }), null);
    assert.equal(firstFormError(undefined), null);
    assert.equal(firstFormError({ errors: { [MIN]: null } }), null);
    assert.equal(
      firstFormError({ errors: { [MAX]: "Pair.", [MIN]: null } }),
      MAX,
    );
    assert.equal(
      firstFormError({ errors: { [MIN]: null, [MAX]: "Pair.", a: "A." } }),
      MAX,
    );
  });

  it("a press on a disabled Run sends focus to the field to fix, not the page (#240 N5)", () => {
    const wiring = wired();
    const { page, form, el } = wiring;
    form.change(MIN, PAIR_MIN);
    form.change(MAX, PAIR_MAX);
    assert.equal(el("run-button").disabled, true);
    el("run-bar").fire("pointerdown", {
      target: el("run-button"),
      button: 2,
    });
    assert.equal(el(MAX_ID).focused, 0, "not the right button");
    el("run-bar").fire("pointerdown", { target: el("run-button"), button: 0 });
    assert.equal(el(MAX_ID).focused, 1, "the field the footer names");
    assert.equal(page.store.get().run.state, "idle");
  });

  it("focus moved to Run as a typed edit blocks it goes to the field to fix (#240 N5)", () => {
    const wiring = wired();
    const { form, el, doc } = wiring;
    // The view defers the move past the event in hand, as on the page.
    const queue = [];
    doc.defaultView.setTimeout = (task) => queue.push(task);
    const flush = () => queue.splice(0).forEach((task) => task());
    repro(wiring);
    el("run-button").focus();
    doc.fire("focusout", { relatedTarget: el("run-button") });
    flush();
    assert.equal(el(MAX_ID).focused, 0, "Run is not blocked yet");
    form.commitEdits();
    assert.equal(el("run-button").disabled, true, "the check blocks Run");
    flush();
    assert.equal(el(MAX_ID).focused, 1, "a stranded Run hands focus on");
    doc.activeElement = doc.body;
    doc.fire("focusout", { relatedTarget: el("run-button") });
    flush();
    assert.equal(el(MAX_ID).focused, 2, "focus dropped to the page");
    doc.activeElement = doc.body;
    doc.fire("focusout", { relatedTarget: el(MIN_ID) });
    flush();
    assert.equal(el(MAX_ID).focused, 2, "only focus bound for Run");
  });

  it("only the main button presses Run (#240 N4)", () => {
    const wiring = wired();
    const { page, el } = wiring;
    repro(wiring);
    // Another button's press is kept from focusing Run (#242, Fran's #253
    // check in real Chrome), so the field keeps the focus and its edit.
    for (const button of [1, 2]) {
      const press = el("run-button").fire("mousedown", {
        button,
        prevented: 0,
        preventDefault() {
          this.prevented += 1;
        },
      });
      assert.equal(press.prevented, 1, `button ${button}`);
      assert.equal(blocked(page.store.get()), false, "the edit is not checked");
    }
    const press = el("run-button").fire("mousedown", {
      button: 0,
      prevented: 0,
      preventDefault() {
        this.prevented += 1;
      },
    });
    assert.equal(press.prevented, 1);
    assert.equal(blocked(page.store.get()), true);
  });
});

describe("the phone dock (#240, UX2)", () => {
  const DOCK_MAX_CHARS = 24;
  const fits = (dock, label) => {
    assert.ok(
      dock.summary.length <= DOCK_MAX_CHARS,
      `${label}: ${dock.summary}`,
    );
    assert.ok(dock.status.length <= DOCK_MAX_CHARS, `${label}: ${dock.status}`);
  };

  it("live: the summary without the seed, a short status, and the fight's DPS", () => {
    const page = setup();
    let dock = dockText(page.store.get());
    assert.deepEqual(dock, {
      summary: `Live · ${DURATION} s`,
      status: `Ready · seed ${SEED}`,
    });
    assert.deepEqual(dockDps(page.store.get()), {
      value: NO_DPS,
      label: "DPS",
    });
    page.actions.run();
    page.play(1);
    dock = dockText(page.store.get());
    fits(dock, "running");
    const { results } = page.store.get();
    // The fight's length is the summary's; the status has the time.
    assert.equal(dock.status, `Running · ${clock(results.time)}`);
    assert.equal(
      dockDps(page.store.get()).value,
      formatNumber(results.damage / results.time, 1),
    );
    page.actions.pause();
    assert.equal(
      dockText(page.store.get()).status,
      `Paused at ${clock(page.store.get().results.time)}`,
    );
    assert.notEqual(dockDps(page.store.get()).value, NO_DPS, "paused keeps it");
    page.actions.resume();
    page.toEnd();
    assert.equal(dockText(page.store.get()).status, `Finished · ${DURATION} s`);
    assert.notEqual(dockDps(page.store.get()).value, NO_DPS);
    page.actions.reset();
    assert.equal(dockDps(page.store.get()).value, NO_DPS, "reset clears it");
  });

  it("batch: counts in the status, the mean as DPS avg once fights are done", async () => {
    const page = setup();
    page.actions.setMode("batch");
    assert.deepEqual(dockText(page.store.get()), {
      summary: `Batch · 4 × ${DURATION} s`,
      status: `Ready · seed ${SEED}`,
    });
    page.actions.run();
    page.client.job.onProgress({ completed: 2, total: 4, mean: 310 });
    assert.equal(dockText(page.store.get()).status, "Running · 2/4");
    // No mean yet: a dash, labelled as the live one is (#242).
    assert.deepEqual(dockDps(page.store.get()), {
      value: NO_DPS,
      label: "DPS",
    });
    page.client.job.resolve(
      batchResult({
        completed: 4,
        iterations: 4,
        cancelled: false,
        mean: 312.44,
      }),
    );
    await settled();
    assert.equal(dockText(page.store.get()).status, "Done · 4 fights");
    assert.deepEqual(dockDps(page.store.get()), {
      value: "312.4",
      label: "DPS avg",
    });
  });

  it("every line fits the dock at the fields' widest values", () => {
    const max = k("batch.maxIterations");
    const page = setup({ seed: MAX_SEED, duration: 3600 });
    page.actions.setMode("batch");
    page.actions.edit("iterations", {
      text: String(max),
      value: max,
      error: null,
    });
    fits(dockText(page.store.get()), "batch ready");
    page.actions.run();
    page.client.job.onProgress({ completed: max - 1, total: max, mean: 310 });
    fits(dockText(page.store.get()), "batch running");
    page.actions.setMode?.("live");
    const live = setup({ seed: null, duration: 3600 });
    fits(dockText(live.store.get()), "live ready, new seed");
  });

  it("a setting in error: a ? in the summary and Can't run", () => {
    const page = setup();
    page.actions.edit("duration", {
      text: "0",
      value: null,
      error: "Fight length must be a number of seconds from 1 to 3,600.",
    });
    assert.deepEqual(dockText(page.store.get()), {
      summary: "Live · ? s",
      status: "Can't run",
    });
  });

  it("blocked, the DPS is a dash: the strip's room goes to why", () => {
    const page = setup();
    page.actions.run();
    page.toEnd();
    assert.notEqual(dockDps(page.store.get()).value, NO_DPS);
    page.actions.edit("duration", {
      text: "0",
      value: null,
      error: "Fight length must be a number of seconds from 1 to 3,600.",
    });
    assert.equal(dockDps(page.store.get()).value, NO_DPS);
  });

  it("the view writes the dock's lines and the DPS readout", () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    assert.equal(
      el("run-summary").getAttribute("data-dock"),
      `Live · ${DURATION} s`,
    );
    assert.equal(
      el("run-status-text").getAttribute("data-dock"),
      `Ready · seed ${SEED}`,
    );
    assert.equal(el("run-dps-value").textContent, NO_DPS);
    assert.equal(el("run-dps-label").textContent, "DPS");
  });

  it("the second tap of a double-tap on Run is not taken as Pause (#240 N3)", () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    const TAP_GAP_MS = 120;
    const at = 5000;
    el("run-button").fire("click", { timeStamp: at });
    assert.equal(page.store.get().run.state, "running");
    el("pause-button").fire("click", { timeStamp: at + TAP_GAP_MS });
    assert.equal(page.store.get().run.state, "running", "not paused");
    el("pause-button").fire("click", { timeStamp: at + TAP_GAP_MS * 2 });
    assert.equal(page.store.get().run.state, "paused", "a later press pauses");
    el("pause-button").fire("click", { timeStamp: at + RUN_TAP_GUARD_MS });
    assert.equal(page.store.get().run.state, "running", "and resumes");
  });

  it("a Pause press after the guard pauses at once", () => {
    const page = setup();
    const { doc, el } = standIn();
    createControlsView(doc, page.store, page.actions);
    const at = 5000;
    el("run-button").fire("click", { timeStamp: at });
    el("pause-button").fire("click", { timeStamp: at + RUN_TAP_GUARD_MS });
    assert.equal(page.store.get().run.state, "paused");
  });
});
