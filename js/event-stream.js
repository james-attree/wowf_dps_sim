import { k } from "../data/constants.js";

// The event stream (Phase 3, #137, the thin form of roadmap task E7). A fight
// tells whoever listens what happens in it, as plain data: a cast, a hit, a
// resource change, an aura going up or down, a proc, the end. This module is
// the delivery: subscribe, unsubscribe, a wildcard, and the rules for what
// happens when a handler throws or calls back into the thing it listens to.
// The events and their fields are in docs/events.md.
//
// Nothing here knows a step or a frame. Events say what happened and when in
// fight seconds. A later engine core (Phase 3.5) can emit the same events from
// somewhere else and every handler, and every test of this contract, stays as
// it is.
//
// Delivery rules (each one has a test in test/event-stream.test.js):
//   Order     Events reach every handler in the order they were emitted. A
//             handler that makes the stream emit again (it calls run() or
//             pause() on a runner, say) does not start a nested delivery: the
//             new event waits until the one being delivered has reached all
//             its handlers, then goes out in turn. So no handler ever sees
//             events out of order, and a handler that triggers an event sees
//             it after the current one.
//   Handlers  One event goes to the handlers that subscribed for its type and
//             the wildcard ones, in the order they subscribed. A handler added
//             while an event is delivered first gets the next one. A handler
//             removed while an event is delivered gets nothing more, even
//             from the event in progress.
//   Errors    A handler that throws never stops the others, never stops the
//             emitter, and never reaches the code that caused the event. The
//             error goes to the error handlers (onError) as { error, type,
//             event }. With none subscribed it is rethrown from a microtask,
//             so it is never silent and still cannot change a fight. An error
//             handler that throws is rethrown the same way.
//   Data      An event is a frozen plain object. Handlers share it and cannot
//             change it.

// What a Simulation emits. Phase 3.5 may add to this list. It may not rename
// or remove an entry, or change a field.
export const SIM_EVENT_TYPES = Object.freeze([
  "cast",
  "hit",
  "resource",
  "aura",
  "proc",
  "end",
]);

// A wildcard subscription gets every type.
export const ANY_EVENT = "*";

function rethrowLater(error) {
  globalThis.queueMicrotask(() => {
    throw error;
  });
}

// Where handler errors go. One reporter can serve several streams, so a
// runner has one place to hear about all of them.
export function createErrorReporter() {
  const handlers = new Set();
  return {
    subscribe(handler) {
      if (typeof handler !== "function") {
        throw new TypeError("onError needs a handler function.");
      }
      const entry = { handler };
      handlers.add(entry);
      return () => {
        handlers.delete(entry);
      };
    },
    report(info) {
      if (handlers.size === 0) {
        rethrowLater(info.error);
        return;
      }
      for (const { handler } of [...handlers]) {
        try {
          handler(info);
        } catch (error) {
          rethrowLater(error);
        }
      }
    },
  };
}

export class EventStream {
  #types;
  #subscriptions = [];
  // How many subscriptions want each type, wildcards counted in #wildcards,
  // so a emitter can ask has(type) before it builds an event nobody reads.
  #wanted = new Map();
  #wildcards = 0;
  #queue = [];
  #delivering = false;
  #errors;

  // `types` is the list of event types this stream carries (null: any). An
  // unknown type in on() is a RangeError, so a typo fails where it is written
  // and not as a handler that never runs. `errors` is a reporter from
  // createErrorReporter(); without one the stream has its own.
  constructor({ types = null, errors = createErrorReporter() } = {}) {
    this.#types = types;
    this.#errors = errors;
  }

  // Subscribe handler(event, type) to one type, or to every type with "*".
  // Returns the unsubscribe function, which is safe to call twice.
  on(type, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("on needs a handler function.");
    }
    if (
      type !== ANY_EVENT &&
      this.#types !== null &&
      !this.#types.includes(type)
    ) {
      throw new RangeError(
        `Unknown event type ${JSON.stringify(type)}. Known: ${this.#types.join(", ")}, or "${ANY_EVENT}" for all.`,
      );
    }
    const subscription = { type, handler, active: true };
    this.#subscriptions.push(subscription);
    if (type === ANY_EVENT) {
      this.#wildcards += 1;
    } else {
      this.#wanted.set(type, (this.#wanted.get(type) ?? 0) + 1);
    }
    return () => {
      if (!subscription.active) {
        return;
      }
      subscription.active = false;
      this.#subscriptions = this.#subscriptions.filter(
        (other) => other !== subscription,
      );
      if (type === ANY_EVENT) {
        this.#wildcards -= 1;
      } else {
        this.#wanted.set(type, this.#wanted.get(type) - 1);
      }
    };
  }

  // Subscribe to the errors handlers throw. See createErrorReporter.
  onError(handler) {
    return this.#errors.subscribe(handler);
  }

  // Does anyone want this type? An emitter checks before it builds the event,
  // so a fight nobody listens to builds none.
  has(type) {
    return this.#wildcards > 0 || (this.#wanted.get(type) ?? 0) > 0;
  }

  // Deliver `event` (a frozen plain object, built by the emitter) of `type`.
  // From inside a handler the event is queued behind the one being delivered.
  emit(type, event) {
    this.#queue.push({ type, event });
    if (this.#delivering) {
      return;
    }
    this.#delivering = true;
    try {
      for (let index = 0; index < this.#queue.length; index += 1) {
        this.#deliver(this.#queue[index]);
      }
    } finally {
      this.#queue.length = 0;
      this.#delivering = false;
    }
  }

  #deliver({ type, event }) {
    for (const subscription of [...this.#subscriptions]) {
      if (
        !subscription.active ||
        (subscription.type !== type && subscription.type !== ANY_EVENT)
      ) {
        continue;
      }
      try {
        subscription.handler(event, type);
      } catch (error) {
        this.#errors.report({ error, type, event });
      }
    }
  }
}

// The combat log: the newest k("log.maxEvents") rows, in a ring, so a long
// fight neither grows it nor shifts an array on every row. toArray() gives
// them newest first.
export class RingLog {
  #rows;
  #next = 0;
  #size = 0;

  constructor(capacity = k("log.maxEvents")) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `A RingLog holds a whole number of rows, 1 or more. Got ${capacity}.`,
      );
    }
    this.#rows = new Array(capacity);
  }

  get capacity() {
    return this.#rows.length;
  }

  get length() {
    return this.#size;
  }

  // Add a row. At capacity it replaces the oldest.
  push(row) {
    this.#rows[this.#next] = row;
    this.#next = (this.#next + 1) % this.#rows.length;
    if (this.#size < this.#rows.length) {
      this.#size += 1;
    }
  }

  // The rows, newest first, as a new array.
  toArray() {
    const rows = [];
    const capacity = this.#rows.length;
    for (let back = 1; back <= this.#size; back += 1) {
      rows.push(this.#rows[(this.#next - back + capacity) % capacity]);
    }
    return rows;
  }
}
