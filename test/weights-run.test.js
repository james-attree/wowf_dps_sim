import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { pageDefaultConfig } from "../js/config-form.js";
import {
  createRunActions,
  emptyBatch,
  emptyRan,
  emptyWeights,
} from "../js/run-actions.js";
import { createStore } from "../js/store.js";
import { blocked } from "../js/views/run-model.js";
import { isStale } from "../js/views/stale.js";

const SEED = 107;
const DURATION = 300;
const config = pageDefaultConfig();

const settled = () => new Promise((resolve) => setImmediate(resolve));

function fakeWeights() {
  return {
    calls: [],
    job: null,
    run(options) {
      this.calls.push(options);
      return new Promise((resolve, reject) => {
        this.job = {
          options,
          resolve,
          reject,
          progress: options.onProgress,
        };
      });
    },
  };
}

function setup() {
  const store = createStore({
    config,
    form: { errors: {} },
    run: {
      mode: "batch",
      state: "idle",
      seed: SEED,
      duration: DURATION,
      iterations: 5,
      fields: {
        duration: String(DURATION),
        iterations: "5",
        seed: String(SEED),
      },
      errors: {},
      stoppedAt: null,
      shown: false,
      snapshot: null,
    },
    batch: emptyBatch("main"),
    weights: emptyWeights(),
    ran: emptyRan(),
    results: { time: 0, damage: 0 },
  });
  const runner = fakeWeights();
  const client = {
    mode: "main",
    running: false,
    cancel() {
      this.running = false;
    },
  };
  let clockMs = 0;
  const actions = createRunActions({
    store,
    live: {
      state: "idle",
      run() {},
      pause() {},
      resume() {},
      stop() {},
      reset() {},
      clear() {},
    },
    client,
    drawSeed: () => SEED,
    now: () => (clockMs += 10),
    stamp: () => 1,
    statWeights: (options) => runner.run(options),
    statWeightVariants: () => [
      { id: "base", sign: 0 },
      { id: "attackPower", sign: 1 },
      { id: "haste", sign: 1 },
    ],
    weightsIterations: k("statWeights.iterations"),
  });
  return { store, runner, actions, client };
}

const sample = {
  seed: SEED,
  iterations: k("statWeights.iterations"),
  variants: 3,
  rows: {
    attackPower: { dpsPerPoint: 1, ci: 0.1, apEquivalent: 1 },
  },
};

describe("stat weights host (#282)", () => {
  it("runs with the constant fight count, not Average's Fights field", async () => {
    const { store, runner, actions } = setup();
    actions.runWeights();
    assert.equal(store.get().weights.status, "running");
    assert.equal(store.get().run.iterations, 5);
    assert.equal(runner.calls[0].iterations, k("statWeights.iterations"));
    assert.equal(runner.calls[0].duration, DURATION);
    assert.equal(runner.calls[0].seed, SEED);
    runner.job.resolve({ ...sample });
    await settled();
    assert.equal(store.get().weights.status, "done");
    assert.equal(
      store.get().ran.weights.iterations,
      k("statWeights.iterations"),
    );
    assert.equal(store.get().ran.weights.duration, DURATION);
    assert.equal(store.get().ran.weights.seed, SEED);
    assert.equal(isStale(store.get(), "weights"), false);
  });

  it("Decision 2: cancel discards the in-progress result and keeps the last table", async () => {
    const { store, runner, actions } = setup();
    actions.runWeights();
    runner.job.resolve({ ...sample });
    await settled();
    const first = store.get().weights.result;
    actions.runWeights();
    assert.equal(store.get().weights.status, "running");
    assert.equal(store.get().weights.result, first);
    actions.cancelWeights();
    runner.job.resolve(null);
    await settled();
    assert.equal(store.get().weights.status, "cancelled");
    assert.equal(store.get().weights.result, first);
    assert.equal(isStale(store.get(), "weights"), false);
  });

  it("a cancel with no previous table keeps no figures", async () => {
    const { store, runner, actions } = setup();
    actions.runWeights();
    actions.cancelWeights();
    runner.job.resolve(null);
    await settled();
    assert.equal(store.get().weights.status, "cancelled");
    assert.equal(store.get().weights.result, null);
    assert.equal(store.get().ran.weights, null);
  });

  it("an error leaves the last finished table unchanged", async () => {
    const { store, runner, actions } = setup();
    actions.runWeights();
    runner.job.resolve({ ...sample });
    await settled();
    const first = store.get().weights.result;
    actions.runWeights();
    runner.job.reject(new Error("worker failed"));
    await settled();
    assert.equal(store.get().weights.status, "error");
    assert.equal(store.get().weights.result, first);
    assert.equal(store.get().weights.error.message, "worker failed");
  });

  it("does not start Average or a second weights run while one is running", async () => {
    const { store, runner, actions } = setup();
    actions.runWeights();
    actions.runWeights();
    assert.equal(runner.calls.length, 1);
    actions.runAs("batch");
    assert.equal(store.get().weights.status, "running");
    runner.job.resolve({ ...sample });
    await settled();
  });

  it("an invalid Fights field does not block runWeights, but still blocks Average", async () => {
    const { store, runner, actions } = setup();
    store.set({
      run: {
        ...store.get().run,
        errors: {
          iterations: "Enter a whole number of fights from 1 to 100,000.",
        },
      },
    });
    assert.equal(blocked(store.get()), true);
    actions.runAs("batch");
    assert.equal(store.get().batch.status, "idle");
    assert.equal(runner.calls.length, 0);
    actions.runWeights();
    assert.equal(store.get().weights.status, "running");
    assert.equal(runner.calls.length, 1);
    runner.job.resolve({ ...sample });
    await settled();
  });

  it("a real build error still blocks runWeights", async () => {
    const { store, runner, actions } = setup();
    store.set({
      run: {
        ...store.get().run,
        errors: {
          duration: "Fight length must be a number of seconds from 1 to 3,600.",
        },
      },
    });
    actions.runWeights();
    assert.equal(store.get().weights.status, "idle");
    assert.equal(runner.calls.length, 0);
    store.set({
      run: { ...store.get().run, errors: {} },
      form: {
        errors: {
          "character.attackPower": "Attack power must be a whole number.",
        },
      },
    });
    actions.runWeights();
    assert.equal(store.get().weights.status, "idle");
    assert.equal(runner.calls.length, 0);
  });
});
