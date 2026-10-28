import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import {
  ANY_EVENT,
  EventStream,
  RingLog,
  SIM_EVENT_TYPES,
  createErrorReporter,
} from "../js/event-stream.js";

// Issue #137 (P3-2, E7-lite). The delivery rules of the event stream, apart
// from any fight: order, re-entrancy, errors, wildcard, unsubscribe, and the
// ring-buffer log. Nothing here knows an engine, so these tests hold for the
// Phase 3.5 core too.

const TYPES = ["a", "b"];

function stream(options) {
  return new EventStream({ types: TYPES, ...options });
}

// Replace the microtask queue, so a rethrown error can be seen and run on the
// test's terms.
function captureRethrows() {
  const queued = [];
  mock.method(globalThis, "queueMicrotask", (task) => queued.push(task));
  return queued;
}

afterEach(() => {
  mock.restoreAll();
});

describe("the event types", () => {
  it("name no step and no frame, and are the documented six", () => {
    assert.deepEqual(
      [...SIM_EVENT_TYPES],
      ["cast", "hit", "resource", "aura", "proc", "end"],
    );
    assert.ok(Object.isFrozen(SIM_EVENT_TYPES));
    for (const type of SIM_EVENT_TYPES) {
      assert.doesNotMatch(type, /step|frame|tick/i);
    }
    assert.equal(ANY_EVENT, "*");
  });
});

describe("EventStream subscriptions", () => {
  it("delivers an event to the handlers of its type, in subscription order", () => {
    const events = stream();
    const seen = [];
    events.on("a", (event) => seen.push(["first", event.n]));
    events.on("b", (event) => seen.push(["other type", event.n]));
    events.on("a", (event) => seen.push(["second", event.n]));
    events.emit("a", { n: 1 });
    assert.deepEqual(seen, [
      ["first", 1],
      ["second", 1],
    ]);
  });

  it("passes the type as the second argument", () => {
    const events = stream();
    const seen = [];
    events.on("a", (event, type) => seen.push(type));
    events.on(ANY_EVENT, (event, type) => seen.push(type));
    events.emit("a", {});
    events.emit("b", {});
    assert.deepEqual(seen, ["a", "a", "b"]);
  });

  it("gives a wildcard handler every type, interleaved by subscription order", () => {
    const events = stream();
    const seen = [];
    events.on("a", () => seen.push("a-handler"));
    events.on(ANY_EVENT, (event) => seen.push(`any ${event.n}`));
    events.on("b", () => seen.push("b-handler"));
    events.emit("a", { n: 1 });
    events.emit("b", { n: 2 });
    assert.deepEqual(seen, ["a-handler", "any 1", "any 2", "b-handler"]);
  });

  it("unsubscribes, twice safely, and only the one handler", () => {
    const events = stream();
    const seen = [];
    const off = events.on("a", () => seen.push("gone"));
    events.on("a", () => seen.push("kept"));
    off();
    off();
    events.emit("a", {});
    assert.deepEqual(seen, ["kept"]);
    assert.equal(events.has("a"), true);
  });

  it("does not let an unsubscribe of one handler remove a second subscription of the same function", () => {
    const events = stream();
    const seen = [];
    const handler = () => seen.push("x");
    const off = events.on("a", handler);
    events.on("a", handler);
    off();
    events.emit("a", {});
    assert.deepEqual(seen, ["x"]);
  });

  it("reports who wants a type, so an emitter can skip building events", () => {
    const events = stream();
    assert.equal(events.has("a"), false);
    const offA = events.on("a", () => {});
    assert.equal(events.has("a"), true);
    assert.equal(events.has("b"), false);
    offA();
    assert.equal(events.has("a"), false);
    const offAny = events.on(ANY_EVENT, () => {});
    assert.equal(events.has("a") && events.has("b"), true);
    offAny();
    offAny();
    assert.equal(events.has("a") || events.has("b"), false);
  });

  it("rejects an unknown type and a handler that is not a function", () => {
    const events = stream();
    assert.throws(() => events.on("c", () => {}), {
      name: "RangeError",
      message: /Unknown event type "c"\. Known: a, b/,
    });
    assert.throws(() => events.on("a", "nope"), TypeError);
    assert.throws(() => events.on("a"), TypeError);
    assert.throws(() => events.onError(1), TypeError);
    // Without a list of types any name is allowed.
    assert.doesNotThrow(() => new EventStream().on("anything", () => {}));
  });

  it("gives a handler added during delivery the next event, not this one", () => {
    const events = stream();
    const seen = [];
    events.on("a", () => {
      events.on("a", (event) => seen.push(`late ${event.n}`));
    });
    events.emit("a", { n: 1 });
    events.emit("a", { n: 2 });
    assert.deepEqual(seen, ["late 2"]);
  });

  it("gives a handler removed during delivery nothing more, not even this event", () => {
    const events = stream();
    const seen = [];
    let offSecond = null;
    events.on("a", () => offSecond());
    offSecond = events.on("a", () => seen.push("second"));
    events.on("a", () => seen.push("third"));
    events.emit("a", {});
    assert.deepEqual(seen, ["third"]);
  });
});

describe("EventStream order under re-entrancy", () => {
  it("queues an event emitted by a handler behind the one being delivered", () => {
    const events = stream();
    const log = [];
    events.on("a", (event) => {
      log.push(`h1 a${event.n}`);
      if (event.n === 1) {
        events.emit("b", { n: 2 });
      }
    });
    events.on(ANY_EVENT, (event, type) => log.push(`h2 ${type}${event.n}`));
    events.emit("a", { n: 1 });
    // h2 sees a1 before the b2 that h1 caused, as h1 did.
    assert.deepEqual(log, ["h1 a1", "h2 a1", "h2 b2"]);
  });

  it("delivers the events of several handlers' emits in the order emitted, to every handler", () => {
    const events = stream();
    const seenBy = { one: [], two: [], three: [] };
    events.on("a", (event) => {
      seenBy.one.push(event.n);
      if (event.n === 1) {
        events.emit("a", { n: 2 });
        events.emit("a", { n: 3 });
      }
    });
    events.on("a", (event) => {
      seenBy.two.push(event.n);
      if (event.n === 2) {
        events.emit("a", { n: 4 });
      }
    });
    events.on("a", (event) => seenBy.three.push(event.n));
    events.emit("a", { n: 1 });
    const order = [1, 2, 3, 4];
    assert.deepEqual(seenBy.one, order);
    assert.deepEqual(seenBy.two, order);
    assert.deepEqual(seenBy.three, order);
  });

  it("returns from the outer emit only after everything queued has gone out", () => {
    const events = stream();
    const seen = [];
    events.on("a", (event) => {
      seen.push(event.n);
      if (event.n < 3) {
        events.emit("a", { n: event.n + 1 });
      }
    });
    events.emit("a", { n: 1 });
    assert.deepEqual(seen, [1, 2, 3]);
  });

  it("is ready for the next emit after one that was re-entered", () => {
    const events = stream();
    const seen = [];
    events.on("a", (event) => {
      seen.push(event.n);
      if (event.n === 1) {
        events.emit("a", { n: 2 });
      }
    });
    events.emit("a", { n: 1 });
    events.emit("a", { n: 3 });
    assert.deepEqual(seen, [1, 2, 3]);
  });
});

describe("EventStream errors", () => {
  it("lets a throwing handler cost no other handler its event", () => {
    const events = stream();
    const seen = [];
    events.onError(() => {});
    events.on("a", () => seen.push("before"));
    events.on("a", () => {
      throw new Error("boom");
    });
    events.on("a", () => seen.push("after"));
    events.emit("a", {});
    assert.deepEqual(seen, ["before", "after"]);
  });

  it("does not let a throwing handler reach the emitter or stop later events", () => {
    const events = stream();
    const seen = [];
    events.onError(() => {});
    events.on("a", (event) => {
      seen.push(event.n);
      if (event.n === 1) {
        events.emit("a", { n: 2 });
        throw new Error("boom");
      }
    });
    assert.doesNotThrow(() => events.emit("a", { n: 1 }));
    assert.deepEqual(seen, [1, 2]);
    events.emit("a", { n: 3 });
    assert.deepEqual(seen, [1, 2, 3]);
  });

  it("tells the error handlers { error, type, event }, in subscription order", () => {
    const events = stream();
    const boom = new Error("boom");
    const told = [];
    events.onError((info) => told.push(["first", info]));
    events.onError((info) => told.push(["second", info]));
    events.on("b", () => {
      throw boom;
    });
    const event = { n: 9 };
    events.emit("b", event);
    assert.equal(told.length, 2);
    assert.deepEqual(
      told.map(([who]) => who),
      ["first", "second"],
    );
    assert.deepEqual(Object.keys(told[0][1]), ["error", "type", "event"]);
    assert.equal(told[0][1].error, boom);
    assert.equal(told[0][1].type, "b");
    assert.equal(told[0][1].event, event);
  });

  it("stops telling an error handler that unsubscribed", () => {
    const events = stream();
    const told = [];
    const off = events.onError((info) => told.push(info.error.message));
    events.on("a", () => {
      throw new Error("one");
    });
    events.emit("a", {});
    off();
    const queued = captureRethrows();
    events.emit("a", {});
    assert.deepEqual(told, ["one"]);
    assert.equal(queued.length, 1, "with none left it is rethrown");
  });

  it("rethrows an error nobody subscribed for from a microtask, never silently", () => {
    const queued = captureRethrows();
    const events = stream();
    const boom = new Error("nobody listens");
    events.on("a", () => {
      throw boom;
    });
    assert.doesNotThrow(() => events.emit("a", {}));
    assert.equal(queued.length, 1);
    assert.throws(queued[0], (error) => error === boom);
  });

  it("rethrows an error handler's own error the same way, and tells the rest", () => {
    const queued = captureRethrows();
    const events = stream();
    const told = [];
    const bad = new Error("bad error handler");
    events.onError(() => {
      throw bad;
    });
    events.onError((info) => told.push(info.error.message));
    events.on("a", () => {
      throw new Error("first");
    });
    assert.doesNotThrow(() => events.emit("a", {}));
    assert.deepEqual(told, ["first"]);
    assert.equal(queued.length, 1);
    assert.throws(queued[0], (error) => error === bad);
  });

  it("shares one reporter between streams", () => {
    const errors = createErrorReporter();
    const one = stream({ errors });
    const two = stream({ errors });
    const told = [];
    errors.subscribe((info) => told.push(info.type));
    one.on("a", () => {
      throw new Error("x");
    });
    two.on("b", () => {
      throw new Error("y");
    });
    one.emit("a", {});
    two.emit("b", {});
    assert.deepEqual(told, ["a", "b"]);
  });
});

describe("RingLog", () => {
  it("is as big as k(log.maxEvents) unless told otherwise", () => {
    assert.equal(new RingLog().capacity, k("log.maxEvents"));
    assert.equal(new RingLog(3).capacity, 3);
  });

  it("keeps rows newest first and never more than its capacity", () => {
    const log = new RingLog(3);
    assert.deepEqual(log.toArray(), []);
    assert.equal(log.length, 0);
    log.push(1);
    log.push(2);
    assert.deepEqual(log.toArray(), [2, 1]);
    log.push(3);
    assert.deepEqual(log.toArray(), [3, 2, 1]);
    log.push(4);
    assert.deepEqual(log.toArray(), [4, 3, 2]);
    for (let row = 5; row <= 11; row += 1) {
      log.push(row);
    }
    assert.deepEqual(log.toArray(), [11, 10, 9]);
    assert.equal(log.length, 3);
  });

  it("returns a new array each time", () => {
    const log = new RingLog(2);
    log.push("a");
    const first = log.toArray();
    first.push("x");
    assert.deepEqual(log.toArray(), ["a"]);
  });

  it("works at the size of one", () => {
    const log = new RingLog(1);
    log.push("a");
    log.push("b");
    assert.deepEqual(log.toArray(), ["b"]);
  });

  it("rejects a capacity that is not a whole number of rows, 1 or more", () => {
    for (const bad of [0, -1, 1.5, NaN, "3", null]) {
      assert.throws(() => new RingLog(bad), RangeError, String(bad));
    }
  });
});
