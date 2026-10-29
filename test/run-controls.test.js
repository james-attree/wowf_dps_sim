import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { createLiveRun } from "../js/live-run.js";
import { createRunActions, emptyBatch } from "../js/run-actions.js";
import { createStore } from "../js/store.js";
import { editedSinceRun } from "../js/views/config-form.js";
import { createControlsView } from "../js/views/controls.js";
import {
  BATCH_HELP,
  LIVE_HELP,
  MAX_SEED,
  clock,
  controlsModel,
  grouped,
  parseRunField,
  spokenTime,
} from "../js/views/run-model.js";

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
  it("fight length: more than 0, at most 3,600 seconds", () => {
    for (const ok of ["300", "0.5", "3600", " 12 "]) {
      assert.equal(parseRunField("duration", ok).error, null, ok);
    }
    assert.equal(parseRunField("duration", "300").value, 300);
    for (const bad of ["0", "-1", "3600.01", "", "abc", "Infinity", "1e9"]) {
      assert.equal(
        parseRunField("duration", bad).error,
        "Fight length must be more than 0 and at most 3,600 seconds.",
        bad,
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
    assert.equal(model.pause.pressed, pause === "Resume");
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
    assert.equal(page.model().announce, "Paused at 2 seconds");
    page.actions.stop();
    assert.equal(
      page.model().status,
      `Stopped at 00:02 · fight discarded · Run replays seed ${SEED} from 0:00`,
    );
    assert.equal(page.model().announce, "Stopped");
    page.actions.run();
    page.toEnd();
    const result = reference(DURATION);
    assert.equal(
      page.model().status,
      `Finished · 3 s · ${result.dps.toFixed(1)} DPS`,
    );
    assert.equal(
      page.model().announce,
      `Finished, ${result.dps.toFixed(1)} DPS`,
    );
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
    assert.equal(batch.previous, before.result, "greyed until progress");
    assert.equal(batch.result, null);
    assert.equal(batch.mode, "main");
    assert.equal(page.model().status, "Running batch · 0 of 4 fights");
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
    assert.equal(page.store.get().batch.previous, null);
    assert.deepEqual(page.store.get().batch.progress, {
      completed: 2,
      total: 4,
      mean: 310,
    });
    assert.equal(page.model().status, "Running batch · 2 of 4 fights");

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
    assert.equal(page.model().status, "Done · 4 fights · 312.4 DPS mean");
    assert.equal(page.model().announce, "Batch done, 312.4 DPS");
    assert.equal(page.model().progress, null);
    assertControls(page.model(), ["Run batch", null, false, true], "done");
    page.client.job.onProgress({ completed: 3, total: 4, mean: 1 });
    assert.equal(
      page.store.get().batch.progress.completed,
      4,
      "late progress ignored",
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
      "Stopped · 2 of 4 fights kept · 300.0 DPS mean (partial)",
    );
    assert.equal(page.model().announce, "Batch stopped, 2 of 4 fights kept");
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
    assert.equal(page.model().status, "Stopped · 0 of 4 fights kept");
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
});

// The view on a small stand-in document.
function standIn() {
  const elements = new Map();
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
      fire(type) {
        listeners.get(type)?.();
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
  const doc = {
    activeElement: null,
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, make(selector.slice(1)));
      }
      return elements.get(selector);
    },
  };
  return { doc, el: (id) => doc.querySelector(`#${id}`) };
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
    assert.equal(el("run-announce").textContent, "Paused at 1 second");
    assert.equal(el("pause-button").getAttribute("aria-pressed"), "true");
    el("stop-button").fire("click");
    assert.equal(page.store.get().run.state, "idle");
    assert.equal(doc.activeElement, el("run-button"), "focus to Run");
    assert.equal(el("run-announce").textContent, "Stopped");
    el("reset-button").focus();
    el("reset-button").fire("click");
    assert.equal(el("reset-button").disabled, true);
    assert.equal(doc.activeElement, el("run-button"), "off a disabled Reset");
    assert.equal(el("run-status-text").textContent, `Ready · seed ${SEED}`);
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

    el("run-button").focus();
    el("run-button").fire("click");
    assert.equal(doc.activeElement, el("stop-button"), "focus to Stop");
    assert.equal(el("run-progress-row").hidden, false);
    assert.equal(el("run-progress").max, 4);
    assert.equal(el("run-progress").value, 0);
    assert.equal(el("run-progress-text").textContent, "0 of 4 fights");
    assert.equal(el("run-announce").textContent, "Batch running, 4 fights");
    el("stop-button").fire("click");
    assert.equal(page.client.cancelled, 1);
    page.client.job.resolve(
      batchResult({ completed: 1, iterations: 4, cancelled: true }),
    );
    await settled();
    assert.equal(el("run-progress-row").hidden, true);
    assert.equal(doc.activeElement, el("run-button"));
    assert.equal(
      el("run-announce").textContent,
      "Batch stopped, 1 of 4 fights kept",
    );

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
