import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStore } from "../js/store.js";
import { emptyWeights } from "../js/run-actions.js";
import {
  WEIGHTS_WAKE_FALLBACK,
  WEIGHTS_WAKE_HELD,
  createWakeLock,
} from "../js/views/wake-lock.js";

function documentOf({ hidden = false } = {}) {
  const listeners = new Map();
  return {
    visibilityState: hidden ? "hidden" : "visible",
    defaultView: { navigator: {} },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    listeners,
  };
}

async function waitFor(store, pred) {
  return new Promise((resolve) => {
    const check = () => {
      if (pred(store.get())) {
        resolve(store.get());
        return true;
      }
      return false;
    };
    const stop = store.subscribe(() => {
      if (check()) {
        stop();
      }
    });
    if (check()) {
      stop();
    }
  });
}

const waitForLock = (store) =>
  waitFor(store, (state) => state.weights?.wakeLock != null).then(
    (state) => state.weights.wakeLock,
  );

const waitForClear = (store) =>
  waitFor(store, (state) => state.weights?.wakeLock == null);

function runningStore(wakeLock = null) {
  return createStore({
    weights: {
      ...emptyWeights(),
      status: "running",
      progress: { completed: 1, total: 9 },
      wakeLock,
    },
  });
}

describe("the stat weights wake lock (#283)", () => {
  it("marks the lock held when the request succeeds", async () => {
    const store = runningStore();
    const released = [];
    const request = async () => ({
      release: async () => released.push(true),
      addEventListener() {},
    });
    const stop = createWakeLock(documentOf(), store, { request });
    assert.equal(await waitForLock(store), WEIGHTS_WAKE_HELD);
    store.set({
      weights: { ...store.get().weights, status: "done", progress: null },
    });
    await waitForClear(store);
    assert.equal(store.get().weights.wakeLock, null);
    assert.equal(released.length, 1);
    stop();
  });

  it("shows the fallback when the API is missing or the request fails", async () => {
    const missing = runningStore();
    const stopMissing = createWakeLock(documentOf(), missing, {});
    assert.equal(await waitForLock(missing), WEIGHTS_WAKE_FALLBACK);
    stopMissing();

    const failing = runningStore();
    const request = async () => {
      throw new Error("not allowed");
    };
    const stopFail = createWakeLock(documentOf(), failing, { request });
    assert.equal(await waitForLock(failing), WEIGHTS_WAKE_FALLBACK);
    stopFail();
  });

  it("does not re-request on a progress tick", async () => {
    const store = runningStore();
    let calls = 0;
    const request = async () => {
      calls += 1;
      return { release: async () => {}, addEventListener() {} };
    };
    const stop = createWakeLock(documentOf(), store, { request });
    assert.equal(await waitForLock(store), WEIGHTS_WAKE_HELD);
    assert.equal(calls, 1);
    store.set({
      weights: {
        ...store.get().weights,
        progress: { completed: 2, total: 9 },
      },
    });
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(store.get().weights.wakeLock, WEIGHTS_WAKE_HELD);
    stop();
  });

  it("asks again when the tab comes back to the foreground", async () => {
    const doc = documentOf({ hidden: true });
    doc.visibilityState = "hidden";
    const store = runningStore();
    let calls = 0;
    const request = async () => {
      calls += 1;
      return { release: async () => {}, addEventListener() {} };
    };
    const stop = createWakeLock(doc, store, { request });
    assert.equal(await waitForLock(store), WEIGHTS_WAKE_HELD);
    assert.equal(calls, 1);
    doc.visibilityState = "visible";
    doc.listeners.get("visibilitychange")();
    await Promise.resolve();
    assert.equal(calls, 2);
    stop();
  });
});
