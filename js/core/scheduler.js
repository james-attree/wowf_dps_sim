// Event scheduler for the Phase 3.5 core (E3, #193). The one engine since
// #234 removed the fixed-step one. A binary min-heap of events ordered by
// time, then order class, then seq (the order they were scheduled in), with
// lazy cancellation: a cancelled event stays in the heap and is skipped when
// it comes out. Pure: no DOM, no clock, no random numbers.
//
// A cancelled event keeps its heap slot until it reaches the top, so a host
// that cancels and reschedules often (a refresh every few seconds) holds one
// dead slot per refresh until its time passes; nextTime and runUntil drop
// them as they come out (#223). pendingCount counts only live events, and
// the hard stops count events that ran, not slots.
//
// Times are plain doubles in seconds, used exactly as given. Callers compute
// them from an anchor (`applied_at + n * interval`, `start + duration`), as
// docs/mechanics.md "Event-queue engine (Phase 3.5)" says, so times
// that should coincide compare equal.

import { k } from "../../data/constants.js";

// The order classes at one timestamp, first to last (mechanics.md, "Order at
// one timestamp"). Decisions run last, after swings, so the rotation sees
// every change due at that instant.
export const ORDER_CLASSES = Object.freeze([
  "energy",
  "expiry",
  "dot-tick",
  "swing",
  "decision",
]);

// Class name -> the `order` value an event carries.
export const ORDER = Object.freeze(
  Object.fromEntries(ORDER_CLASSES.map((name, index) => [name, index])),
);

// Thrown when a run goes past one of the hard stops (#193): more than
// k("sim.maxEventsPerTimestamp") events at one time, or more than
// k("sim.maxEventsPerSecond") per second of the scheduler's end time in all.
export class SchedulerHardStopError extends Error {
  constructor({ scope, limit, event, endTime }) {
    const where =
      scope === "timestamp"
        ? `events ran at t = ${event.time} s`
        : `events ran in the run (end time ${endTime} s)`;
    super(
      `Scheduler hard stop: more than ${limit} ${where}; the last was "${event.kind}" at t = ${event.time} s (order ${ORDER_CLASSES[event.order]}, seq ${event.seq}). A handler is probably scheduling events in a loop.`,
    );
    this.name = "SchedulerHardStopError";
    this.scope = scope;
    this.limit = limit;
    this.time = event.time;
    this.order = event.order;
    this.kind = event.kind;
    this.seq = event.seq;
    this.endTime = endTime;
  }
}

// Hooks between an event and its scheduler, kept off the public surface.
const MARK_RAN = Symbol("markRan");
const BELONGS_TO = Symbol("belongsTo");
const CANCELLED_ONE = Symbol("cancelledOne");

const PENDING = "pending";
const RAN = "ran";
const CANCELLED = "cancelled";

// One scheduled event. It is also the token its timer holds: cancel() marks
// it, and the scheduler skips it when it comes out of the heap. Its fields are
// read-only getters and the object is frozen, so a handler cannot move an
// event that is already in the heap (not even with defineProperty).
export class ScheduledEvent {
  #scheduler;
  #time;
  #order;
  #seq;
  #kind;
  #payload;
  #state = PENDING;

  constructor(scheduler, { time, order, seq, kind, payload }) {
    this.#scheduler = scheduler;
    this.#time = time;
    this.#order = order;
    this.#seq = seq;
    this.#kind = kind;
    this.#payload = payload;
    Object.freeze(this);
  }

  get time() {
    return this.#time;
  }
  get order() {
    return this.#order;
  }
  get seq() {
    return this.#seq;
  }
  get kind() {
    return this.#kind;
  }
  get payload() {
    return this.#payload;
  }
  // "pending", "ran" or "cancelled".
  get state() {
    return this.#state;
  }
  get cancelled() {
    return this.#state === CANCELLED;
  }

  // Cancel the event if it has not run. Cancelling twice, or after it ran, does
  // nothing. Returns true if this call cancelled it.
  cancel() {
    if (this.#state !== PENDING) {
      return false;
    }
    this.#state = CANCELLED;
    this.#scheduler[CANCELLED_ONE]();
    return true;
  }

  [BELONGS_TO](scheduler) {
    return this.#scheduler === scheduler;
  }

  [MARK_RAN]() {
    this.#state = RAN;
  }
}

function before(a, b) {
  if (a.time !== b.time) {
    return a.time < b.time;
  }
  if (a.order !== b.order) {
    return a.order < b.order;
  }
  return a.seq < b.seq;
}

// A value as a refusal shows it: a string in quotes, so "4" does not read as 4.
function shown(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function checkTime(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(
      `${label} must be a finite number of seconds. Got ${shown(value)}.`,
    );
  }
}

export class Scheduler {
  #heap = [];
  #now = 0;
  #endTime;
  #handle;
  #nextSeq = 0;
  #pending = 0;
  #eventsRun = 0;
  #sameTime = Number.NaN;
  #sameTimeCount = 0;
  #running = false;
  #current = null;
  #stoppedBy = null;
  #maxPerTimestamp;
  #maxPerRun;

  // endTime: the fight's end in seconds (runToEnd runs to it).
  // handle(event, scheduler): called for each event, in order.
  // startTime: where now starts, 0 by default and at most endTime. A host
  // that takes a fight over part way through (the event core, #198) starts
  // its scheduler at the fight's time, so every run of one fight schedules on
  // the same clock.
  constructor({ endTime, handle, startTime = 0 } = {}) {
    checkTime(endTime, "Scheduler endTime");
    if (endTime < 0) {
      throw new RangeError(
        `Scheduler endTime must be 0 or more. Got ${endTime}.`,
      );
    }
    checkTime(startTime, "Scheduler startTime");
    if (startTime < 0 || startTime > endTime) {
      throw new RangeError(
        `Scheduler startTime must be from 0 to the end time (${endTime} s). Got ${startTime}.`,
      );
    }
    if (typeof handle !== "function") {
      throw new TypeError(
        "Scheduler needs a handle(event, scheduler) function.",
      );
    }
    this.#endTime = endTime;
    this.#now = startTime;
    this.#handle = handle;
    this.#maxPerTimestamp = k("sim.maxEventsPerTimestamp");
    // Scaled by the fight length, since a fight has no maximum duration. A
    // fight shorter than a second gets a second's worth.
    this.#maxPerRun = k("sim.maxEventsPerSecond") * Math.max(endTime, 1);
  }

  get now() {
    return this.#now;
  }
  get endTime() {
    return this.#endTime;
  }
  // Events handled so far, over the scheduler's whole life.
  get eventsRun() {
    return this.#eventsRun;
  }
  // Events scheduled that have neither run nor been cancelled.
  get pendingCount() {
    return this.#pending;
  }
  // The time of the next event that will run (the earliest pending one), or
  // null when none is pending. A host that has to stop between two times
  // (SimRunner pausing, #198) runs to it with runUntil(nextTime) and looks
  // again: the same events in the same order as one longer runUntil.
  get nextTime() {
    const heap = this.#heap;
    while (heap.length > 0 && heap[0].cancelled) {
      this.#pop();
    }
    return heap.length > 0 ? heap[0].time : null;
  }
  // The SchedulerHardStopError that stopped the scheduler, or null while it
  // runs. A component that must not change its state after a stop (the
  // EnergyPool, #225) checks it before it does.
  get stoppedBy() {
    return this.#stoppedBy;
  }
  // The event whose handler is running, or null outside a handler (#198:
  // SwingTimer.swung() checks it is called from its own swing).
  get current() {
    return this.#current;
  }

  // Schedule an event and return it (its token). `time` is absolute, in
  // seconds, and not before now; `order` is a value of ORDER.
  schedule({ time, order, kind, payload } = {}) {
    this.#checkNotStopped("schedule an event");
    checkTime(time, "An event's time");
    if (time < this.#now) {
      throw new RangeError(
        `Cannot schedule "${String(kind)}" at t = ${time} s: it is before now (${this.#now} s).`,
      );
    }
    if (
      !Number.isInteger(order) ||
      order < 0 ||
      order >= ORDER_CLASSES.length
    ) {
      throw new RangeError(
        `An event's order must be one of ORDER (${ORDER_CLASSES.join(", ")}). Got ${shown(order)}.`,
      );
    }
    if (typeof kind !== "string" || kind === "") {
      throw new TypeError("An event's kind must be a non-empty string.");
    }
    const event = new ScheduledEvent(this, {
      time,
      order,
      seq: this.#nextSeq,
      kind,
      payload,
    });
    this.#nextSeq += 1;
    this.#pending += 1;
    this.#push(event);
    return event;
  }

  // Cancel `event` if it is still pending and schedule the same kind, order and
  // payload at `time`, with a new seq. Returns the new event.
  reschedule(event, time) {
    this.#checkNotStopped("reschedule an event");
    if (!(event instanceof ScheduledEvent) || !event[BELONGS_TO](this)) {
      throw new TypeError("reschedule needs an event from this scheduler.");
    }
    checkTime(time, "An event's time");
    if (time < this.#now) {
      throw new RangeError(
        `Cannot reschedule "${event.kind}" to t = ${time} s: it is before now (${this.#now} s).`,
      );
    }
    event.cancel();
    return this.schedule({
      time,
      order: event.order,
      kind: event.kind,
      payload: event.payload,
    });
  }

  // Called by ScheduledEvent.cancel.
  [CANCELLED_ONE]() {
    this.#pending -= 1;
  }

  // Run every event due at or before t, in order, then set now to t. Events a
  // handler schedules at or before t run in this call too.
  runUntil(t) {
    this.#checkNotStopped("run again");
    if (this.#running) {
      throw new Error(
        "runUntil cannot be called from inside an event handler.",
      );
    }
    checkTime(t, "runUntil's time");
    if (t < this.#now) {
      throw new RangeError(
        `runUntil(${t}) is before now (${this.#now} s); time only moves forward.`,
      );
    }
    if (t > this.#endTime) {
      throw new RangeError(
        `runUntil(${t}) is after the end time (${this.#endTime} s).`,
      );
    }
    this.#running = true;
    try {
      const heap = this.#heap;
      while (heap.length > 0 && heap[0].time <= t) {
        const event = heap[0];
        if (event.cancelled) {
          this.#pop();
          continue;
        }
        // Checked before the event leaves the heap: the event that trips a
        // hard stop did not run, so it stays pending and in pendingCount.
        try {
          this.#count(event);
        } catch (error) {
          this.#stoppedBy = error;
          throw error;
        }
        this.#pop();
        this.#now = event.time;
        event[MARK_RAN]();
        this.#pending -= 1;
        this.#eventsRun += 1;
        this.#current = event;
        this.#handle(event, this);
        this.#current = null;
      }
      this.#now = t;
    } finally {
      this.#running = false;
      this.#current = null;
    }
  }

  runToEnd() {
    this.runUntil(this.#endTime);
  }

  // After a hard stop the scheduler takes no more work: a plain Error (a call
  // in the wrong state, not a bad argument), naming the stop.
  #checkNotStopped(what) {
    if (this.#stoppedBy !== null) {
      throw new Error(
        `The scheduler was stopped by a hard stop and cannot ${what}: ${this.#stoppedBy.message}`,
      );
    }
  }

  // The hard stops (#193), checked before the event runs.
  #count(event) {
    if (event.time === this.#sameTime) {
      this.#sameTimeCount += 1;
    } else {
      this.#sameTime = event.time;
      this.#sameTimeCount = 1;
    }
    if (this.#sameTimeCount > this.#maxPerTimestamp) {
      throw new SchedulerHardStopError({
        scope: "timestamp",
        limit: this.#maxPerTimestamp,
        event,
        endTime: this.#endTime,
      });
    }
    if (this.#eventsRun + 1 > this.#maxPerRun) {
      throw new SchedulerHardStopError({
        scope: "run",
        limit: this.#maxPerRun,
        event,
        endTime: this.#endTime,
      });
    }
  }

  #push(event) {
    const heap = this.#heap;
    heap.push(event);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!before(event, heap[parent])) {
        break;
      }
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = event;
  }

  #pop() {
    const heap = this.#heap;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      let index = 0;
      for (;;) {
        const left = (index << 1) + 1;
        if (left >= heap.length) {
          break;
        }
        const right = left + 1;
        const child =
          right < heap.length && before(heap[right], heap[left]) ? right : left;
        if (!before(heap[child], last)) {
          break;
        }
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return top;
  }
}
