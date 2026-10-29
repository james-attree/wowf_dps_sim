import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStore } from "../js/store.js";

// Issue #149 (U1). The contract of the page's store (js/store.js): reads,
// changes, subscribe and unsubscribe, batched changes, delivery order, and
// errors. Nothing here knows the page, so the views can rely on all of it.

function recorder(store) {
  const events = [];
  const unsubscribe = store.subscribe((event) => events.push(event));
  return { events, unsubscribe };
}

describe("store", () => {
  it("starts from a frozen copy of the initial slices", () => {
    const initial = { a: 1, b: { x: 2 } };
    const store = createStore(initial);
    const state = store.get();
    assert.deepEqual(state, initial);
    assert.notEqual(state, initial);
    assert.ok(Object.isFrozen(state));
    assert.equal(state.b, initial.b, "slices are not copied");
    assert.deepEqual(createStore().get(), {});
  });

  it("makes a new state on set, and an old one keeps what it had", () => {
    const store = createStore({ a: 1, b: 2 });
    const first = store.get();
    store.set({ a: 3 });
    assert.deepEqual(store.get(), { a: 3, b: 2 });
    assert.deepEqual(first, { a: 1, b: 2 });
    assert.notEqual(store.get(), first);
    assert.ok(Object.isFrozen(store.get()));
  });

  it("tells subscribers once per set, with the slices that changed", () => {
    const store = createStore({ a: 1, b: 2, c: 3 });
    const { events } = recorder(store);
    store.set({ b: 20, a: 10 });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].changed, ["b", "a"]);
    assert.equal(events[0].state, store.get());
    assert.ok(Object.isFrozen(events[0]));
    assert.ok(Object.isFrozen(events[0].changed));
  });

  it("treats a slice set to the same value (Object.is) as no change", () => {
    const slice = { x: 1 };
    const store = createStore({ a: 1, n: Number.NaN, s: slice });
    const before = store.get();
    const { events } = recorder(store);
    store.set({ a: 1, n: Number.NaN, s: slice });
    store.set({});
    assert.equal(events.length, 0);
    assert.equal(store.get(), before);
    store.set({ a: 1, s: { x: 1 } });
    assert.deepEqual(
      events.map((event) => event.changed),
      [["s"]],
    );
  });

  it("adds a slice it did not have, even one set to undefined", () => {
    const store = createStore({ a: 1 });
    const { events } = recorder(store);
    store.set({ b: undefined });
    assert.ok("b" in store.get());
    assert.deepEqual(events[0].changed, ["b"]);
  });

  it("does not call a subscriber when it subscribes", () => {
    const store = createStore({ a: 1 });
    const { events } = recorder(store);
    assert.equal(events.length, 0);
  });

  it("stops telling a subscriber after unsubscribe, which is safe twice", () => {
    const store = createStore({ a: 1 });
    const kept = recorder(store);
    const dropped = recorder(store);
    store.set({ a: 2 });
    dropped.unsubscribe();
    dropped.unsubscribe();
    store.set({ a: 3 });
    assert.equal(kept.events.length, 2);
    assert.equal(dropped.events.length, 1);
  });

  it("calls subscribers in the order they subscribed", () => {
    const store = createStore({ a: 1 });
    const order = [];
    store.subscribe(() => order.push("first"));
    store.subscribe(() => order.push("second"));
    store.subscribe(() => order.push("third"));
    store.set({ a: 2 });
    assert.deepEqual(order, ["first", "second", "third"]);
  });

  it("update(fn) sets what fn returns from the current state", () => {
    const store = createStore({ count: 1, other: "x" });
    const { events } = recorder(store);
    store.update((state) => {
      assert.equal(state, store.get(), "fn gets the current state itself");
      return {};
    });
    store.update(({ count }) => ({ count: count + 1 }));
    store.update((state) => state);
    assert.deepEqual(store.get(), { count: 2, other: "x" });
    assert.deepEqual(
      events.map((event) => event.changed),
      [["count"]],
    );
  });

  it("batch holds every set and announces once, nested batches too", () => {
    const store = createStore({ a: 1, b: 2, c: 3 });
    const { events } = recorder(store);
    const result = store.batch(() => {
      store.set({ b: 20 });
      store.batch(() => {
        store.set({ a: 10 });
        store.set({ b: 21 });
      });
      assert.equal(events.length, 0, "nothing is heard inside a batch");
      assert.equal(store.get().a, 10, "get() sees the changes at once");
      return "done";
    });
    assert.equal(result, "done");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].changed, ["b", "a"]);
    assert.deepEqual(store.get(), { a: 10, b: 21, c: 3 });
  });

  it("starts each batch afresh", () => {
    const store = createStore({ a: 1, b: 2 });
    const { events } = recorder(store);
    store.batch(() => store.set({ a: 3 }));
    store.batch(() => {
      store.set({ b: 4 });
      store.set({ a: 5 });
    });
    assert.deepEqual(
      events.map((event) => event.changed),
      [["a"], ["b", "a"]],
    );
  });

  it("batch does not report a slice set back to its value from before", () => {
    const store = createStore({ a: 1, b: 2 });
    const { events } = recorder(store);
    store.batch(() => {
      store.set({ a: 5 });
      store.set({ a: 1 });
    });
    assert.equal(events.length, 0);
    store.batch(() => {
      store.set({ a: 5, b: 6 });
      store.set({ a: 1 });
    });
    assert.deepEqual(
      events.map((event) => event.changed),
      [["b"]],
    );
    // "Before" is from the outermost batch, not a nested one.
    store.batch(() => {
      store.set({ a: 7 });
      store.batch(() => store.set({ a: 1 }));
    });
    assert.equal(events.length, 1);
  });

  it("batch keeps the changes, announces them, and rethrows when fn throws", () => {
    const store = createStore({ a: 1 });
    const { events } = recorder(store);
    assert.throws(
      () =>
        store.batch(() => {
          store.set({ a: 2 });
          throw new Error("boom");
        }),
      /boom/,
    );
    assert.equal(store.get().a, 2);
    assert.deepEqual(
      events.map((event) => event.changed),
      [["a"]],
    );
    store.set({ a: 3 });
    assert.equal(events.length, 2, "the store is not left batching");
  });

  it("queues a set made by a subscriber behind the change being delivered", () => {
    const store = createStore({ a: 1, b: 0 });
    const log = [];
    store.subscribe(({ state, changed }) => {
      log.push(`first:${changed}:${state.a}:${state.b}`);
      if (changed.includes("a")) {
        store.set({ b: state.a });
      }
    });
    store.subscribe(({ state, changed }) => {
      log.push(`second:${changed}:${state.a}:${state.b}`);
    });
    store.set({ a: 2 });
    assert.deepEqual(log, [
      "first:a:2:0",
      "second:a:2:0",
      "first:b:2:2",
      "second:b:2:2",
    ]);
  });

  it("keeps telling the others when a subscriber throws, and reports it", () => {
    const store = createStore({ a: 1 });
    const errors = [];
    store.onError((error) => errors.push(error));
    store.subscribe(() => {
      throw new Error("bad view");
    });
    const { events } = recorder(store);
    store.set({ a: 2 });
    assert.equal(store.get().a, 2);
    assert.equal(events.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error.message, /bad view/);
    assert.equal(errors[0].type, "change");
  });

  it("rejects what is not an object of slices or a function", () => {
    for (const bad of [null, 1, "a", [1]]) {
      assert.throws(() => createStore(bad), TypeError);
    }
    const store = createStore({ a: 1 });
    for (const bad of [null, undefined, 1, "a", [1]]) {
      assert.throws(() => store.set(bad), TypeError);
    }
    assert.throws(() => store.update(() => null), TypeError);
    for (const method of ["update", "batch", "subscribe"]) {
      assert.throws(() => store[method]("nope"), TypeError, method);
    }
    assert.deepEqual(store.get(), { a: 1 });
  });
});
