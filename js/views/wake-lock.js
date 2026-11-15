import {
  WEIGHTS_WAKE_FALLBACK,
  WEIGHTS_WAKE_HELD,
  weightsRunning,
} from "./run-model.js";

// Screen wake lock for a stat weights run (#283). When the API is missing
// or the request fails, the weights view (and the Run bar) show "Keep the
// screen on". The lock is released when the run ends. The user agent also
// drops it when the tab is hidden; a return to the tab asks again.
//
// coordinator call 15 Nov (James delegated): requested for every weights
// run. Precise is not offered yet; a phone run still benefits, and the
// fallback text has to be testable now.

export { WEIGHTS_WAKE_FALLBACK, WEIGHTS_WAKE_HELD };

export function createWakeLock(doc, store, { request } = {}) {
  if (
    typeof doc?.addEventListener !== "function" ||
    typeof store?.subscribe !== "function"
  ) {
    return () => {};
  }
  const nav = doc?.defaultView?.navigator;
  let sentinel = null;
  let lastRunning = false;

  function canRequest() {
    return typeof (request ?? nav?.wakeLock?.request) === "function";
  }

  async function acquire() {
    if (!canRequest()) {
      return false;
    }
    try {
      const fn = request ?? nav.wakeLock.request.bind(nav.wakeLock);
      sentinel = await fn("screen");
      sentinel?.addEventListener?.("release", () => {
        sentinel = null;
      });
      return true;
    } catch {
      sentinel = null;
      return false;
    }
  }

  async function release() {
    try {
      await sentinel?.release?.();
    } catch {
      // The user agent may already have dropped the lock.
    }
    sentinel = null;
  }

  function setFlag(value) {
    const weights = store.get().weights;
    if ((weights?.wakeLock ?? null) === (value ?? null)) {
      return;
    }
    store.update((state) => ({
      weights: { ...(state.weights ?? {}), wakeLock: value },
    }));
  }

  async function sync({ force = false } = {}) {
    const running = weightsRunning(store.get());
    if (!force && running === lastRunning) {
      return;
    }
    lastRunning = running;
    if (!running) {
      await release();
      setFlag(null);
      return;
    }
    const ok = await acquire();
    setFlag(ok ? WEIGHTS_WAKE_HELD : WEIGHTS_WAKE_FALLBACK);
  }

  function onVisibility() {
    if (doc.visibilityState === "visible" && weightsRunning(store.get())) {
      void sync({ force: true });
    }
  }

  doc.addEventListener("visibilitychange", onVisibility);
  const unsub = store.subscribe(({ changed }) => {
    if (changed.includes("weights")) {
      void sync();
    }
  });
  void sync({ force: true });

  return () => {
    unsub();
    doc.removeEventListener("visibilitychange", onVisibility);
    void release();
  };
}
