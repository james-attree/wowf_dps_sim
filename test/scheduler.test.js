import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import {
  ORDER,
  ORDER_CLASSES,
  ScheduledEvent,
  Scheduler,
  SchedulerHardStopError,
} from "../js/core/scheduler.js";
import { createRng } from "../js/rng.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { testRng } from "./rolls.js";

function recorder(endTime, onEvent = () => {}) {
  const ran = [];
  const scheduler = new Scheduler({
    endTime,
    handle(event, self) {
      ran.push({
        time: event.time,
        order: event.order,
        seq: event.seq,
        kind: event.kind,
        now: self.now,
      });
      onEvent(event, self);
    },
  });
  return { scheduler, ran };
}

const at = (scheduler, time, order, kind = "e", payload) =>
  scheduler.schedule({ time, order: ORDER[order], kind, payload });

describe("scheduler: order at one timestamp", () => {
  it("names the five order classes, decisions last", () => {
    assert.deepEqual(ORDER_CLASSES, [
      "energy",
      "expiry",
      "dot-tick",
      "swing",
      "decision",
    ]);
    assert.deepEqual(
      ORDER_CLASSES.map((name) => ORDER[name]),
      [0, 1, 2, 3, 4],
    );
    assert.ok(Object.isFrozen(ORDER) && Object.isFrozen(ORDER_CLASSES));
  });

  it("runs by time, then class, then the order scheduled", () => {
    const { scheduler, ran } = recorder(10);
    at(scheduler, 2, "decision", "d2");
    at(scheduler, 1, "swing", "s1");
    at(scheduler, 1, "energy", "e1");
    at(scheduler, 1, "swing", "s1b");
    at(scheduler, 1, "decision", "d1");
    at(scheduler, 1, "expiry", "x1");
    at(scheduler, 1, "dot-tick", "t1");
    at(scheduler, 0, "decision", "d0");
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["d0", "e1", "x1", "t1", "s1", "s1b", "d1", "d2"],
    );
    assert.deepEqual(
      ran.map((event) => event.now),
      ran.map((event) => event.time),
    );
  });

  it("keeps 1,000 events at one time in class order, then schedule order", () => {
    const { scheduler, ran } = recorder(5);
    const rng = createRng(193);
    for (let index = 0; index < 1000; index += 1) {
      const order = Math.floor(rng() * ORDER_CLASSES.length);
      scheduler.schedule({ time: 2.5, order, kind: `n${index}` });
    }
    scheduler.runToEnd();
    assert.equal(ran.length, 1000);
    const expected = [...ran].sort(
      (a, b) => a.order - b.order || a.seq - b.seq,
    );
    assert.deepEqual(ran, expected);
    assert.ok(ran.every((event) => event.time === 2.5 && event.now === 2.5));
  });

  it("runs an event a handler schedules at now, after the ones already due", () => {
    const { scheduler, ran } = recorder(5, (event, self) => {
      if (event.kind === "first") {
        at(self, self.now, "energy", "child");
      }
    });
    at(scheduler, 1, "energy", "first");
    at(scheduler, 1, "decision", "last");
    scheduler.runToEnd();
    // The child is in an earlier class than "last" but at the same time, so
    // it still goes first: order is (time, class, seq), not arrival.
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["first", "child", "last"],
    );
  });
});

describe("scheduler: cancel and reschedule", () => {
  it("skips a cancelled event, and cancel is idempotent", () => {
    const { scheduler, ran } = recorder(5);
    const keep = at(scheduler, 1, "swing", "keep");
    const drop = at(scheduler, 1, "swing", "drop");
    assert.equal(scheduler.pendingCount, 2);
    assert.equal(drop.cancel(), true);
    assert.equal(drop.cancel(), false);
    assert.equal(drop.cancelled, true);
    assert.equal(drop.state, "cancelled");
    assert.equal(scheduler.pendingCount, 1);
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["keep"],
    );
    assert.equal(keep.state, "ran");
    assert.equal(keep.cancel(), false);
    assert.equal(keep.cancelled, false);
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(scheduler.eventsRun, 1);
  });

  it("lets a handler cancel a later event due at the same time", () => {
    let victim;
    const { scheduler, ran } = recorder(5, (event) => {
      if (event.kind === "killer") {
        victim.cancel();
      }
    });
    at(scheduler, 1, "energy", "killer");
    victim = at(scheduler, 1, "decision", "victim");
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["killer"],
    );
  });

  it("reschedules: the old event is dropped and a new one runs at the new time", () => {
    const { scheduler, ran } = recorder(10);
    const payload = { id: "slice" };
    const old = at(scheduler, 3, "expiry", "buff-expiry", payload);
    const moved = scheduler.reschedule(old, 7);
    assert.ok(moved instanceof ScheduledEvent);
    assert.notEqual(moved, old);
    assert.equal(old.cancelled, true);
    assert.equal(moved.time, 7);
    assert.equal(moved.order, ORDER.expiry);
    assert.equal(moved.kind, "buff-expiry");
    assert.equal(moved.payload, payload);
    assert.ok(moved.seq > old.seq);
    assert.equal(scheduler.pendingCount, 1);
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => [event.kind, event.time]),
      [["buff-expiry", 7]],
    );
  });

  it("reschedules an event that already ran as a fresh one", () => {
    const { scheduler, ran } = recorder(10);
    const payload = { id: "main-hand" };
    const first = at(scheduler, 1, "swing", "swing", payload);
    scheduler.runUntil(2);
    assert.equal(first.state, "ran");
    assert.equal(scheduler.pendingCount, 0);
    const again = scheduler.reschedule(first, 4);
    // The old event stays "ran", not "cancelled"; the new one is pending.
    assert.equal(first.state, "ran");
    assert.equal(first.cancelled, false);
    assert.notEqual(again, first);
    assert.equal(again.state, "pending");
    assert.equal(again.time, 4);
    assert.equal(again.order, ORDER.swing);
    assert.equal(again.kind, "swing");
    assert.equal(again.payload, payload);
    assert.ok(again.seq > first.seq);
    assert.equal(scheduler.pendingCount, 1);
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => [event.kind, event.time, event.seq]),
      [
        ["swing", 1, first.seq],
        ["swing", 4, again.seq],
      ],
    );
    assert.equal(again.state, "ran");
    assert.equal(scheduler.eventsRun, 2);
  });

  it("keeps an event's fields read-only", () => {
    const { scheduler } = recorder(10);
    const event = at(scheduler, 3, "swing", "swing");
    assert.throws(() => {
      event.time = 1;
    }, TypeError);
    // Frozen too, so an own property cannot shadow the getter.
    assert.ok(Object.isFrozen(event));
    assert.throws(
      () => Object.defineProperty(event, "time", { value: 1 }),
      TypeError,
    );
    assert.equal(event.time, 3);
  });

  it("refuses to reschedule an event from another scheduler, or into the past", () => {
    const one = recorder(10).scheduler;
    const two = recorder(10).scheduler;
    const event = at(one, 3, "swing");
    assert.throws(() => two.reschedule(event, 4), {
      name: "TypeError",
      message: "reschedule needs an event from this scheduler.",
    });
    assert.throws(() => two.reschedule({ time: 3 }, 4), TypeError);
    one.runUntil(2);
    assert.throws(() => one.reschedule(event, 1), {
      name: "RangeError",
      message: /before now \(2 s\)/,
    });
    assert.equal(event.state, "pending");
  });
});

describe("scheduler: runUntil", () => {
  it("leaves now at t, and runs nothing after t", () => {
    const { scheduler, ran } = recorder(10);
    at(scheduler, 2, "swing", "a");
    at(scheduler, 4, "swing", "b");
    scheduler.runUntil(3);
    assert.equal(scheduler.now, 3);
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["a"],
    );
    scheduler.runUntil(3);
    assert.equal(scheduler.now, 3);
    scheduler.runToEnd();
    assert.equal(scheduler.now, 10);
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["a", "b"],
    );
  });

  it("runs an event due exactly at t, and one at the end time", () => {
    const { scheduler, ran } = recorder(10);
    at(scheduler, 3, "decision", "at-t");
    at(scheduler, 10, "decision", "at-end");
    scheduler.runUntil(3);
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["at-t"],
    );
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["at-t", "at-end"],
    );
  });

  it("gives the same run whether it is split or done in one call", () => {
    const build = () => {
      let spawned = 0;
      const made = recorder(20, (event, self) => {
        if (spawned < 40) {
          spawned += 1;
          at(self, Math.min(self.now + 0.75, 20), "swing", `c${spawned}`);
          at(self, self.now, "decision", `n${spawned}`);
        }
      });
      at(made.scheduler, 0, "energy", "start");
      at(made.scheduler, 5, "expiry", "x");
      return made;
    };
    const whole = build();
    whole.scheduler.runToEnd();
    const split = build();
    for (const t of [0, 0, 0.75, 3, 5, 5, 11.25, 19.999, 20]) {
      split.scheduler.runUntil(t);
      assert.equal(split.scheduler.now, t);
    }
    assert.deepEqual(split.ran, whole.ran);
    assert.equal(split.scheduler.eventsRun, whole.scheduler.eventsRun);
  });

  it("lets a handler error through, with now at that event's time", () => {
    const { scheduler, ran } = recorder(10, (event) => {
      if (event.kind === "boom") {
        throw new Error("handler failed");
      }
    });
    at(scheduler, 1, "swing", "ok");
    at(scheduler, 4, "swing", "boom");
    at(scheduler, 6, "swing", "later");
    assert.throws(() => scheduler.runUntil(8), { message: "handler failed" });
    assert.equal(scheduler.now, 4);
    // Not stuck "running": the next call works and goes on from the event after.
    scheduler.runToEnd();
    assert.deepEqual(
      ran.map((event) => event.kind),
      ["ok", "boom", "later"],
    );
  });

  it("cannot be called from inside a handler", () => {
    let caught;
    const { scheduler } = recorder(10, (event, self) => {
      try {
        self.runUntil(5);
      } catch (error) {
        caught = error;
      }
    });
    at(scheduler, 1, "swing");
    scheduler.runToEnd();
    assert.equal(
      caught?.message,
      "runUntil cannot be called from inside an event handler.",
    );
  });

  it("refuses a time before now, after the end, or not finite", () => {
    const { scheduler } = recorder(10);
    scheduler.runUntil(4);
    assert.throws(() => scheduler.runUntil(3), {
      name: "RangeError",
      message: "runUntil(3) is before now (4 s); time only moves forward.",
    });
    assert.throws(() => scheduler.runUntil(10.5), {
      name: "RangeError",
      message: "runUntil(10.5) is after the end time (10 s).",
    });
    for (const bad of [Number.NaN, Infinity, "5", undefined]) {
      assert.throws(() => scheduler.runUntil(bad), RangeError);
    }
    assert.equal(scheduler.now, 4);
  });
});

describe("scheduler: one handle function", () => {
  it("sends every event, of every class, to the one handle with the scheduler", () => {
    const calls = [];
    const scheduler = new Scheduler({
      endTime: 5,
      handle(...args) {
        calls.push(args);
      },
    });
    for (const name of ORDER_CLASSES) {
      at(scheduler, 1, name, name);
    }
    scheduler.runToEnd();
    assert.equal(calls.length, ORDER_CLASSES.length);
    for (const [index, args] of calls.entries()) {
      assert.equal(args.length, 2);
      assert.ok(args[0] instanceof ScheduledEvent);
      assert.equal(args[0].kind, ORDER_CLASSES[index]);
      assert.equal(args[1], scheduler);
    }
  });

  it("takes no per-kind handlers", () => {
    for (const handle of [undefined, null, {}, { swing() {} }, "handle"]) {
      assert.throws(() => new Scheduler({ endTime: 5, handle }), {
        name: "TypeError",
        message: "Scheduler needs a handle(event, scheduler) function.",
      });
    }
  });
});

describe("scheduler: input checks", () => {
  it("needs a finite end time of 0 or more and a handler", () => {
    assert.throws(
      () => new Scheduler({ endTime: -1, handle() {} }),
      RangeError,
    );
    assert.throws(
      () => new Scheduler({ endTime: Number.NaN, handle() {} }),
      RangeError,
    );
    assert.throws(
      () => new Scheduler({ endTime: Infinity, handle() {} }),
      RangeError,
    );
    assert.throws(() => new Scheduler({ endTime: 5 }), TypeError);
    assert.throws(() => new Scheduler(), RangeError);
    const zero = new Scheduler({ endTime: 0, handle() {} });
    zero.runToEnd();
    assert.equal(zero.now, 0);
  });

  it("refuses an event in the past, at a bad time, order or kind", () => {
    const { scheduler } = recorder(10);
    scheduler.runUntil(2);
    assert.throws(() => at(scheduler, 1.5, "swing", "late"), {
      name: "RangeError",
      message: 'Cannot schedule "late" at t = 1.5 s: it is before now (2 s).',
    });
    assert.throws(
      () => scheduler.schedule({ time: "4", order: ORDER.swing, kind: "e" }),
      {
        name: "RangeError",
        message:
          'An event\'s time must be a finite number of seconds. Got "4".',
      },
    );
    assert.throws(
      () => scheduler.schedule({ time: 3, order: "1", kind: "e" }),
      {
        message: /Got "1"\.$/,
      },
    );
    assert.throws(() => scheduler.runUntil(Number.NaN), {
      message: /Got NaN\.$/,
    });
    for (const time of [Number.NaN, Infinity, -Infinity, "3", undefined]) {
      assert.throws(
        () => scheduler.schedule({ time, order: ORDER.swing, kind: "e" }),
        RangeError,
      );
    }
    for (const order of [-1, 5, 1.5, "swing", undefined, Number.NaN]) {
      assert.throws(() => scheduler.schedule({ time: 3, order, kind: "e" }), {
        name: "RangeError",
        message: /order must be one of ORDER/,
      });
    }
    for (const kind of ["", undefined, 7]) {
      assert.throws(
        () => scheduler.schedule({ time: 3, order: ORDER.swing, kind }),
        TypeError,
      );
    }
    assert.equal(scheduler.pendingCount, 0);
    // An event later than the end time is allowed; it never runs.
    at(scheduler, 11, "swing", "after-end");
    scheduler.runToEnd();
    assert.equal(scheduler.eventsRun, 0);
  });
});

describe("scheduler: hard-stop constants", () => {
  it("are engineering rows of 10,000, not game rules", () => {
    const perTimestamp = CONSTANTS["sim.maxEventsPerTimestamp"];
    const perSecond = CONSTANTS["sim.maxEventsPerSecond"];
    assert.equal(perTimestamp.value, 10000);
    assert.equal(perTimestamp.unit, "events");
    assert.equal(perSecond.value, 10000);
    assert.equal(perSecond.unit, "events per simulated second");
    for (const row of [perTimestamp, perSecond]) {
      assert.equal(row.source, "engineering");
      assert.equal(row.retune, false);
      assert.match(row.ref, /^Developer, 29 Oct 2026, issue #193: /);
      assert.match(row.ref, /not a decision by James/);
      assert.match(row.note, /^Not a game rule\./);
    }
  });
});

describe("scheduler: hard stop", () => {
  const perTimestamp = k("sim.maxEventsPerTimestamp");
  const perSecond = k("sim.maxEventsPerSecond");

  it("stops a handler that keeps scheduling at now, naming the event and time", () => {
    const { scheduler } = recorder(10, (event, self) => {
      at(self, self.now, "decision", "decision");
    });
    at(scheduler, 2.5, "decision", "decision");
    let error;
    assert.throws(
      () => scheduler.runToEnd(),
      (thrown) => {
        error = thrown;
        return thrown instanceof SchedulerHardStopError;
      },
    );
    assert.equal(error.name, "SchedulerHardStopError");
    assert.equal(error.scope, "timestamp");
    assert.equal(error.limit, perTimestamp);
    assert.equal(error.time, 2.5);
    assert.equal(error.order, ORDER.decision);
    assert.equal(error.kind, "decision");
    assert.equal(error.seq, perTimestamp);
    assert.equal(error.endTime, 10);
    assert.equal(
      error.message,
      `Scheduler hard stop: more than ${perTimestamp} events ran at t = 2.5 s; the last was "decision" at t = 2.5 s (order decision, seq ${perTimestamp}). A handler is probably scheduling events in a loop.`,
    );
    assert.equal(scheduler.eventsRun, perTimestamp);
    assert.equal(scheduler.now, 2.5);
  });

  it("allows exactly the limit at one time", () => {
    const { scheduler } = recorder(1);
    for (let index = 0; index < perTimestamp; index += 1) {
      at(scheduler, 1, "swing");
    }
    scheduler.runToEnd();
    assert.equal(scheduler.eventsRun, perTimestamp);
  });

  it("counts one timestamp across split runUntil calls", () => {
    const { scheduler } = recorder(2);
    for (let index = 0; index < perTimestamp - 1; index += 1) {
      at(scheduler, 1, "swing");
    }
    scheduler.runUntil(1);
    at(scheduler, 1, "swing", "one-more");
    scheduler.runUntil(1);
    at(scheduler, 1, "swing", "too-many");
    assert.throws(() => scheduler.runUntil(1), {
      name: "SchedulerHardStopError",
      message: /"too-many" at t = 1 s/,
    });
  });

  it("stops a loop that creeps forward and never reaches the end", () => {
    const endTime = 2;
    const { scheduler } = recorder(endTime, (event, self) => {
      at(self, self.now + Number.EPSILON * 4, "energy", "creep");
    });
    at(scheduler, 0, "energy", "creep");
    assert.throws(
      () => scheduler.runToEnd(),
      (error) => {
        assert.ok(error instanceof SchedulerHardStopError);
        assert.equal(error.scope, "run");
        assert.equal(error.limit, perSecond * endTime);
        assert.equal(error.kind, "creep");
        assert.equal(error.order, ORDER.energy);
        assert.equal(error.endTime, endTime);
        assert.match(
          error.message,
          new RegExp(
            `more than ${perSecond * endTime} events ran in the run \\(end time 2 s\\)`,
          ),
        );
        return true;
      },
    );
    assert.equal(scheduler.eventsRun, perSecond * endTime);
  });

  it("counts the whole run across split calls, and gives a short fight a second's worth", () => {
    const { scheduler } = recorder(0.5);
    const step = 0.5 / (perSecond + 2);
    for (let index = 0; index <= perSecond; index += 1) {
      at(scheduler, index * step, "swing", "tick");
    }
    scheduler.runUntil(0.25);
    assert.ok(scheduler.eventsRun > 0 && scheduler.eventsRun < perSecond);
    assert.throws(() => scheduler.runToEnd(), {
      name: "SchedulerHardStopError",
      message: new RegExp(`more than ${perSecond} events ran in the run`),
    });
    assert.equal(scheduler.eventsRun, perSecond);
  });

  it("will not run again after a hard stop", () => {
    const { scheduler } = recorder(10, (event, self) => {
      at(self, self.now, "swing", "loop");
    });
    at(scheduler, 1, "swing", "loop");
    assert.throws(() => scheduler.runUntil(5), SchedulerHardStopError);
    // Not a RangeError for a time before now: the stop comes first.
    for (const t of [5, 0.5]) {
      assert.throws(() => scheduler.runUntil(t), {
        name: "Error",
        message:
          /^The scheduler was stopped by a hard stop and cannot run again: Scheduler hard stop:/,
      });
    }
  });

  it("takes no new or moved events after a hard stop", () => {
    const { scheduler } = recorder(10, (event, self) => {
      at(self, self.now, "swing", "loop");
    });
    at(scheduler, 1, "swing", "loop");
    const later = at(scheduler, 6, "expiry", "later");
    assert.throws(() => scheduler.runUntil(5), SchedulerHardStopError);
    const pending = scheduler.pendingCount;
    assert.throws(() => at(scheduler, 7, "swing", "new"), {
      name: "Error",
      message:
        /^The scheduler was stopped by a hard stop and cannot schedule an event: Scheduler hard stop:/,
    });
    assert.throws(() => scheduler.reschedule(later, 8), {
      name: "Error",
      message:
        /^The scheduler was stopped by a hard stop and cannot reschedule an event: Scheduler hard stop:/,
    });
    // The refused reschedule left the old event as it was.
    assert.equal(later.state, "pending");
    assert.equal(scheduler.pendingCount, pending);
    // Cancelling is still allowed: it only drops work.
    assert.equal(later.cancel(), true);
    assert.equal(scheduler.pendingCount, pending - 1);
  });

  it("leaves the event that trips the stop pending: it did not run", () => {
    let tripping = null;
    let last = null;
    const { scheduler } = recorder(10, (event, self) => {
      last = at(self, self.now, "swing", "loop");
    });
    at(scheduler, 1, "swing", "loop");
    assert.throws(
      () => scheduler.runUntil(5),
      (error) => {
        tripping = error;
        return error instanceof SchedulerHardStopError;
      },
    );
    // The handler's last event is the one that tripped the stop.
    assert.equal(tripping.seq, last.seq);
    assert.equal(last.state, "pending");
    assert.equal(scheduler.pendingCount, 1);
    assert.equal(scheduler.eventsRun, perTimestamp);
    assert.equal(last.cancel(), true);
    assert.equal(scheduler.pendingCount, 0);
  });
});

// A sorted-array reference: every step it sorts what is due and takes the first.
class ReferenceScheduler {
  constructor({ endTime, handle }) {
    this.endTime = endTime;
    this.handle = handle;
    this.now = 0;
    this.events = [];
    this.nextSeq = 0;
  }
  schedule({ time, order, kind }) {
    const event = { time, order, kind, seq: this.nextSeq, state: "pending" };
    this.nextSeq += 1;
    this.events.push(event);
    return event;
  }
  cancel(event) {
    if (event.state === "pending") {
      event.state = "cancelled";
    }
  }
  reschedule(event, time) {
    this.cancel(event);
    return this.schedule({ time, order: event.order, kind: event.kind });
  }
  get pendingCount() {
    return this.events.filter((event) => event.state === "pending").length;
  }
  runUntil(t) {
    for (;;) {
      const due = this.events
        .filter((event) => event.state === "pending" && event.time <= t)
        .sort((a, b) => a.time - b.time || a.order - b.order || a.seq - b.seq);
      if (due.length === 0) {
        break;
      }
      const [event] = due;
      event.state = "ran";
      this.now = event.time;
      this.handle(event, this);
    }
    this.now = t;
  }
}

// One randomised round, driven the same way against either scheduler. What
// a handler does depends only on the round seed and the event's seq, so the
// two runs match exactly when the order matches.
function randomRound(seed, make, cancel) {
  const setup = createRng(seed);
  const endTime = 1 + Math.floor(setup() * 8);
  const grid = 0.25;
  const log = [];
  const bySeq = [];
  const scheduler = make({
    endTime,
    handle(event, self) {
      log.push([
        event.time,
        event.order,
        event.seq,
        event.kind,
        self.now,
        self.pendingCount,
      ]);
      const roll = createRng(seed * 7919 + event.seq);
      if (roll() < 0.35) {
        const ahead = Math.floor(roll() * 3) * grid;
        const time = Math.min(self.now + ahead, endTime);
        bySeq.push(
          self.schedule({
            time,
            order: Math.floor(roll() * ORDER_CLASSES.length),
            kind: `child-of-${event.seq}`,
          }),
        );
      }
      if (roll() < 0.2 && bySeq.length > 0) {
        cancel(self, bySeq[Math.floor(roll() * bySeq.length)]);
      }
      // Move a random event (pending, ran or cancelled) to now or later.
      if (roll() < 0.2 && bySeq.length > 0) {
        const ahead = Math.floor(roll() * 3) * grid;
        const time = Math.min(self.now + ahead, endTime);
        const old = bySeq[Math.floor(roll() * bySeq.length)];
        const moved = self.reschedule(old, time);
        log.push(["move", old.seq, old.state, moved.seq, time]);
        bySeq.push(moved);
      }
    },
  });
  const count = 1 + Math.floor(setup() * 60);
  for (let index = 0; index < count; index += 1) {
    // Times on a coarse grid, so many events share a timestamp.
    const time = Math.floor(setup() * (endTime / grid + 1)) * grid;
    bySeq.push(
      scheduler.schedule({
        time,
        order: Math.floor(setup() * ORDER_CLASSES.length),
        kind: `root-${index}`,
      }),
    );
  }
  for (let index = 0; index < count; index += 1) {
    if (setup() < 0.15) {
      cancel(scheduler, bySeq[index]);
    }
  }
  const stops = [];
  for (let index = Math.floor(setup() * 4); index > 0; index -= 1) {
    stops.push(Math.floor(setup() * (endTime / grid + 1)) * grid);
  }
  stops.sort((a, b) => a - b);
  for (const t of [...stops, endTime]) {
    scheduler.runUntil(t);
    log.push(["stop", t, scheduler.now, scheduler.pendingCount]);
  }
  return log;
}

describe("scheduler: randomised against a sorted-array reference", () => {
  it("matches the reference over 200 seeded rounds, with reschedules and pendingCount", () => {
    let events = 0;
    let moved = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const real = randomRound(
        seed,
        (options) => new Scheduler(options),
        (self, event) => event.cancel(),
      );
      const reference = randomRound(
        seed,
        (options) => new ReferenceScheduler(options),
        (self, event) => self.cancel(event),
      );
      assert.deepEqual(real, reference, `round ${seed}`);
      events += real.filter((entry) => entry[0] !== "stop").length;
      moved += real.filter((entry) => entry[0] === "move").length;
    }
    // The rounds are not trivially small.
    assert.ok(events > 2000, `only ${events} events ran`);
    assert.ok(moved > 200, `only ${moved} reschedules`);
  });
});

describe("DoT tick interval check (#193)", () => {
  function simWithDot(tickInterval) {
    const rogue = new Rogue();
    rogue.rotation = () => {};
    const sim = new Simulation(rogue, { rng: testRng });
    sim.activeDots.rupture = {
      name: "Rupture",
      duration: 6,
      tickInterval,
      timeUntilNextTick: 2,
      tickDamage: 100,
      icon: null,
    };
    return sim;
  }

  for (const bad of [0, -2, Number.NaN, Infinity]) {
    it(`refuses a tick interval of ${bad}`, () => {
      const sim = simWithDot(bad);
      assert.throws(() => sim.step(0.1), {
        name: "RangeError",
        message: `DoT "rupture" has tick interval ${bad}; it must be a finite number of seconds above 0.`,
      });
    });
  }

  it("still ticks a DoT with a normal interval", () => {
    const sim = simWithDot(k("rupture.tickInterval"));
    sim.step(2);
    assert.equal(sim.combatLog.length, 1);
    assert.ok(sim.damageDone > 0);
  });
});
