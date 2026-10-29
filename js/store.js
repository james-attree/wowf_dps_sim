import { EventStream } from "./event-stream.js";

// The page's store (Phase 3, #149, roadmap task U1): one plain object of named
// slices that the views read and subscribe to, and a way to change them. No
// framework, no DOM, no clock, so it runs and is tested in Node like the
// engine. The live page (js/main.js) keeps these slices:
//
//   config    The SimConfig of the fight on the page (js/sim-config.js).
//   rotation  The selected rotation (RotationRule JSON, docs/rotation.md).
//   run       { state, seed }: the run state, in SimRunner's state names
//             (js/sim-runner.js), and the fight's seed.
//   frame     A count of animation frames drawn; it moves on every frame the
//             page draws, so the visualiser redraws on it.
//   results   The latest results: { time, damage } in fight seconds and
//             damage done so far.
//   resources, gcd, effects, procs, spend, moment, log
//             What the visualiser draws, as plain frozen data from the live
//             feed (js/live-feed.js), renewed each frame. No slice holds an
//             engine object (#150).
//
// The store knows nothing of these names: any slice is allowed.
//
// The contract (each part has a test in test/store.test.js):
//
//   get()            The current state. A new object after every change, so
//                    one taken earlier keeps what it had. Slices are not
//                    copied: a view must not change what it reads.
//   set(patch)       Replaces the slices `patch` names. A slice whose value is
//                    the same (Object.is) is not a change. If anything
//                    changed, subscribers hear one change event.
//   update(fn)       set(fn(get())).
//   batch(fn)        Runs fn; every set() inside it (nested batches too) is
//                    held, and subscribers hear one change event at the end
//                    with every slice that changed, if any did. A slice set
//                    back to its value from before the batch is no change.
//                    If fn throws, the changes stay made, subscribers still
//                    hear them, and the error is rethrown.
//   subscribe(fn)    fn({ state, changed }) after each change, where changed
//                    lists the slices that changed, in the order they were
//                    first set. Returns the unsubscribe function (safe to call
//                    twice). Subscribing does not call fn.
//
// Delivery follows js/event-stream.js: subscribers are called in the order they
// subscribed; a set() from inside a subscriber is delivered after the current
// change has reached everyone (never nested); a subscriber that throws does
// not stop the others or the set() that caused it, and its error goes to
// onError handlers, or is rethrown from a microtask when there are none.
export function createStore(initial = {}) {
  if (
    initial === null ||
    typeof initial !== "object" ||
    Array.isArray(initial)
  ) {
    throw new TypeError("createStore needs an object of slices.");
  }
  let state = Object.freeze({ ...initial });
  let depth = 0;
  // While batching: the state before the batch, and the slices set in it.
  let before = null;
  const pending = new Set();
  const changes = new EventStream({ types: ["change"] });

  function readPatch(patch) {
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("The store's set() needs an object of slices.");
    }
    return patch;
  }

  function announce(changed) {
    if (changed.length > 0) {
      changes.emit(
        "change",
        Object.freeze({ state, changed: Object.freeze(changed) }),
      );
    }
  }

  function batch(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("The store's batch() needs a function.");
    }
    if (depth === 0) {
      before = state;
    }
    depth += 1;
    try {
      return fn();
    } finally {
      depth -= 1;
      if (depth === 0) {
        const changed = [...pending].filter(
          (key) => !(key in before) || !Object.is(state[key], before[key]),
        );
        pending.clear();
        before = null;
        announce(changed);
      }
    }
  }

  function set(patch) {
    const entries = Object.entries(readPatch(patch)).filter(
      ([key, value]) => !(key in state) || !Object.is(state[key], value),
    );
    if (entries.length === 0) {
      return;
    }
    state = Object.freeze({ ...state, ...Object.fromEntries(entries) });
    const keys = entries.map(([key]) => key);
    if (depth > 0) {
      keys.forEach((key) => pending.add(key));
      return;
    }
    announce(keys);
  }

  return {
    get: () => state,
    set,
    update(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("The store's update() needs a function.");
      }
      set(fn(state));
    },
    batch,
    subscribe(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("The store's subscribe() needs a function.");
      }
      return changes.on("change", (event) => fn(event));
    },
    onError: (handler) => changes.onError(handler),
  };
}
