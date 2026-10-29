import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { REFRESH_RULES } from "../js/auras.js";
import { ORDER, Scheduler } from "../js/core/scheduler.js";
import { SWING_KIND, SwingTimer } from "../js/core/swing.js";
import {
  TIMER_KINDS,
  Timer,
  TimerSet,
  createTimers,
  refreshedEnd,
} from "../js/core/timers.js";
import { createRng } from "../js/rng.js";

const EPS = k("sim.tickEpsilon");

// The core's timers on a scheduler that logs every event as
// [kind, time, payload] and runs `at` callbacks scheduled as "call" events
// (in the decision class, so they see everything due at their time).
function setup(endTime = 300) {
  const log = [];
  const scheduler = new Scheduler({
    endTime,
    handle(event) {
      if (event.kind === "call") {
        event.payload();
        return;
      }
      log.push([event.kind, event.time, event.payload]);
    },
  });
  const at = (time, fn) =>
    scheduler.schedule({
      time,
      order: ORDER.decision,
      kind: "call",
      payload: fn,
    });
  return { scheduler, log, at, timers: createTimers(scheduler) };
}

// Random start times, not on any step grid.
function randomTimes(seed, count = 50) {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng() * 200);
}

describe("Timer and TimerSet (#195)", () => {
  it("a 1 s GCD started at t ends at exactly t + 1", () => {
    for (const t of randomTimes(1)) {
      const { scheduler, log, at, timers } = setup();
      at(t, () => timers.gcd.start(k("gcd.duration")));
      scheduler.runUntil(t);
      assert.equal(timers.gcd.endsAt, t + 1);
      assert.equal(timers.gcd.running, true);
      assert.equal(timers.gcd.remaining, t + 1 - t);
      scheduler.runUntil(t + 1);
      assert.deepEqual(log, [[TIMER_KINDS.gcd, t + 1, null]]);
      assert.equal(timers.gcd.ready, true);
      assert.equal(timers.gcd.endsAt, null);
      assert.equal(timers.gcd.remaining, 0);
    }
  });

  it("a 20 s cooldown started at t is ready at exactly t + 20, and not before", () => {
    for (const t of randomTimes(2)) {
      const { scheduler, log, at, timers } = setup();
      at(t, () => timers.cooldowns.start("bladeFlurry", 20));
      scheduler.runUntil(t);
      assert.equal(timers.cooldowns.endsAt("bladeFlurry"), t + 20);
      // 2e-9 before is still cooling down; the tolerance is tickEpsilon.
      scheduler.runUntil(t + 20 - 2 * EPS);
      assert.equal(timers.cooldowns.ready("bladeFlurry"), false);
      assert.ok(timers.cooldowns.remaining("bladeFlurry") > EPS);
      assert.deepEqual(log, []);
      scheduler.runUntil(t + 20);
      assert.deepEqual(log, [
        [TIMER_KINDS.cooldown, t + 20, { id: "bladeFlurry" }],
      ]);
      assert.equal(timers.cooldowns.ready("bladeFlurry"), true);
      assert.equal(timers.cooldowns.remaining("bladeFlurry"), 0);
    }
  });

  it("reads within tickEpsilon of the end as ended, as legacy does", () => {
    const { scheduler, timers } = setup();
    timers.gcd.start(1);
    timers.cooldowns.start("a", 1);
    scheduler.runUntil(1 - EPS / 2);
    assert.equal(timers.gcd.endsAt, 1, "the event is still pending");
    assert.equal(timers.gcd.running, false);
    assert.equal(timers.gcd.ready, true);
    assert.equal(timers.gcd.remaining, 0);
    assert.equal(timers.cooldowns.ready("a"), true);
    assert.deepEqual(timers.cooldowns.runningIds, []);
  });

  it("gives the same event times at any query granularity", () => {
    const run = (points) => {
      const { scheduler, log, at, timers } = setup(60);
      at(0.3, () => timers.gcd.start(1));
      at(0.3, () => timers.cooldowns.start("cd", 20));
      at(1.7, () => timers.auras.start("sliceAndDice", 9));
      at(2.05, () => timers.premeditation.start(k("premeditation.cpExpiry")));
      for (const t of points) {
        scheduler.runUntil(t);
      }
      return log;
    };
    const once = run([60]);
    assert.deepEqual(
      once.map(([kind, time]) => [kind, time]),
      [
        [TIMER_KINDS.gcd, 0.3 + 1],
        [TIMER_KINDS.aura, 1.7 + 9],
        [TIMER_KINDS.cooldown, 0.3 + 20],
        [TIMER_KINDS.points, 2.05 + k("premeditation.cpExpiry")],
      ],
    );
    for (const step of [1, 1 / 64, 0.01, 0.37]) {
      const points = [];
      for (let t = step; t < 60; t += step) {
        points.push(t);
      }
      points.push(60);
      assert.deepEqual(run(points), once, `step ${step}`);
    }
  });

  it("a restart replaces the end: one event, at the new time", () => {
    const { scheduler, log, at, timers } = setup();
    timers.gcd.start(1);
    timers.cooldowns.start("cd", 10);
    at(0.5, () => {
      timers.gcd.start(1);
      timers.cooldowns.start("cd", 10);
    });
    scheduler.runUntil(0.5);
    assert.equal(scheduler.pendingCount, 2);
    scheduler.runToEnd();
    assert.deepEqual(log, [
      [TIMER_KINDS.gcd, 1.5, null],
      [TIMER_KINDS.cooldown, 10.5, { id: "cd" }],
    ]);
  });

  it("clear() drops the end with no event", () => {
    const { scheduler, log, timers } = setup();
    timers.gcd.start(1);
    timers.auras.start("coldBlood", 5);
    timers.gcd.clear();
    timers.auras.clear("coldBlood");
    timers.auras.clear("never-started");
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(timers.auras.running("coldBlood"), false);
    assert.equal(timers.auras.endsAt("coldBlood"), null);
    scheduler.runToEnd();
    assert.deepEqual(log, []);
  });

  it("auras expire at their timestamps under each refresh rule", () => {
    const now = 3;
    assert.equal(refreshedEnd("refresh", { endsAt: 5, now, duration: 10 }), 13);
    assert.equal(refreshedEnd("extend", { endsAt: 5, now, duration: 10 }), 15);
    assert.equal(
      refreshedEnd("replace-if-longer", { endsAt: 20, now, duration: 10 }),
      20,
    );
    assert.equal(
      refreshedEnd("replace-if-longer", { endsAt: 5, now, duration: 10 }),
      13,
    );
    for (const rule of REFRESH_RULES) {
      for (const t of randomTimes(3, 20)) {
        const { scheduler, log, at, timers } = setup();
        const d = 9;
        at(t, () => timers.auras.start("aura", d));
        const again = t + 4.25;
        let wanted;
        at(again, () => {
          wanted = refreshedEnd(rule, {
            endsAt: timers.auras.endsAt("aura"),
            now: again,
            duration: d,
          });
          timers.auras.setEndsAt("aura", wanted);
        });
        scheduler.runToEnd();
        assert.deepEqual(
          log,
          [[TIMER_KINDS.aura, wanted, { id: "aura" }]],
          rule,
        );
        const legacy = {
          refresh: again + d,
          extend: t + d + d,
          "replace-if-longer": again + d,
        };
        assert.equal(wanted, legacy[rule], rule);
      }
    }
    assert.throws(
      () => refreshedEnd("renew", { endsAt: 1, now: 0, duration: 1 }),
      {
        name: "RangeError",
        message: /refresh must be one of refresh, extend, replace-if-longer/,
      },
    );
  });

  it("Premeditation's points expire at exactly t + cpExpiry, with the points they remove", () => {
    for (const t of randomTimes(4, 20)) {
      const { scheduler, log, at, timers } = setup();
      at(t, () => timers.premeditation.start(k("premeditation.cpExpiry")));
      scheduler.runToEnd();
      assert.deepEqual(log, [
        [
          TIMER_KINDS.points,
          t + k("premeditation.cpExpiry"),
          {
            resource: "comboPoints",
            amount: k("premeditation.cpRemovedOnExpiry"),
          },
        ],
      ]);
      assert.ok(Object.isFrozen(log[0][2]));
    }
    // A re-arm restarts; a gain or spend (clear) keeps the points.
    const { scheduler, log, at, timers } = setup();
    timers.premeditation.start(20);
    at(5, () => timers.premeditation.start(20));
    at(30, () => timers.premeditation.start(20));
    at(40, () => timers.premeditation.clear());
    scheduler.runToEnd();
    assert.deepEqual(
      log.map(([, time]) => time),
      [25],
    );
  });

  it("times that should coincide compare equal and run in the expiry class, before swings and decisions", () => {
    const order = [];
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event) {
        order.push([event.kind, event.time]);
        if (event.kind === SWING_KIND) {
          swing.swung();
        }
      },
    });
    const timers = createTimers(scheduler);
    const swing = new SwingTimer({
      weapon: { speed: 1.25, hand: "main" },
      modifiers: { resolve: (_kind, base) => base },
      scheduler,
    });
    swing.start(1.25);
    scheduler.schedule({ time: 2.5, order: ORDER.decision, kind: "decide" });
    scheduler.runUntil(1.5);
    timers.gcd.start(1);
    timers.auras.start("aura", 1);
    scheduler.runUntil(2.5);
    assert.deepEqual(order, [
      [SWING_KIND, 1.25],
      [TIMER_KINDS.gcd, 2.5],
      [TIMER_KINDS.aura, 2.5],
      [SWING_KIND, 2.5],
      ["decide", 2.5],
    ]);
  });

  it("lists the running ids in the order they were first started", () => {
    const { scheduler, timers } = setup();
    timers.auras.start("b", 5);
    timers.auras.start("a", 2);
    timers.auras.start("c", 9);
    assert.deepEqual(timers.auras.runningIds, ["b", "a", "c"]);
    scheduler.runUntil(3);
    assert.deepEqual(timers.auras.runningIds, ["b", "c"]);
    assert.equal(timers.auras.remaining("b"), 2);
    assert.equal(timers.auras.remaining("unknown"), 0);
    assert.equal(timers.auras.ready("unknown"), true);
  });

  it("refuses bad durations, ids, kinds and schedulers", () => {
    const { scheduler, timers } = setup();
    for (const bad of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
    ]) {
      assert.throws(() => timers.gcd.start(bad), {
        name: "RangeError",
        message:
          /"gcd-end" timer needs a duration in seconds, finite and above 0/,
      });
    }
    assert.throws(() => timers.cooldowns.start("cd", "4"), {
      name: "RangeError",
      message: /Got "4"\./,
    });
    for (const bad of ["", 4, null, undefined]) {
      assert.throws(() => timers.cooldowns.start(bad, 1), {
        name: "TypeError",
        message: /"cooldown-ready" timer's id must be a non-empty string/,
      });
    }
    scheduler.runUntil(5);
    // An end before now is the scheduler's refusal, and the old end stays.
    timers.gcd.start(1);
    assert.throws(() => timers.gcd.setEndsAt(4), RangeError);
    assert.equal(timers.gcd.endsAt, 6);
    assert.throws(() => new Timer({ kind: "x" }), TypeError);
    assert.throws(() => new Timer({ scheduler }), TypeError);
    assert.throws(() => new Timer({ scheduler, kind: "" }), TypeError);
    assert.throws(() => new TimerSet({ kind: "x" }), TypeError);
    assert.throws(() => new TimerSet({ scheduler, kind: 3 }), TypeError);
    assert.throws(() => new Timer(), TypeError);
  });

  it("exports the kinds, frozen", () => {
    assert.deepEqual(TIMER_KINDS, {
      gcd: "gcd-end",
      cooldown: "cooldown-ready",
      aura: "aura-expire",
      points: "points-expire",
    });
    assert.ok(Object.isFrozen(TIMER_KINDS));
  });
});
