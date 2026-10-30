import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openCore, runOnCore } from "../js/core/fight.js";
import { ORDER, Scheduler } from "../js/core/scheduler.js";
import { SWING_HANDS, SWING_KIND, SwingTimer } from "../js/core/swing.js";
import {
  TIMER_KINDS,
  Timer,
  TimerSet,
  refreshedEnd,
} from "../js/core/timers.js";
import { createFight } from "../js/fight.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #198: the core's input checks carried from #195's QA (refreshedEnd,
// TimerSet ids, a Timer's payload, swung() from its own event only), the
// engine's hand names, the scheduler's nextTime and current, and openCore,
// the event core held open over many calls.

const flat = { resolve: (_kind, base) => base };
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};

describe("refreshedEnd input checks (#198, #195 QA 3)", () => {
  it("refuses a bad rule first, then options that are not an object", () => {
    assert.throws(() => refreshedEnd("nope", null), {
      name: "RangeError",
      message: /refresh must be one of/,
    });
    for (const bad of [null, undefined, 5, "x"]) {
      assert.throws(() => refreshedEnd("refresh", bad), {
        name: "TypeError",
        message: /refreshedEnd needs \{ endsAt, now, duration \}/,
      });
    }
  });

  it("refuses an endsAt or now that is not a finite number", () => {
    for (const name of ["endsAt", "now"]) {
      for (const bad of [null, undefined, Number.NaN, Infinity, "5"]) {
        const options = { endsAt: 5, now: 1, duration: 2, [name]: bad };
        assert.throws(() => refreshedEnd("extend", options), {
          name: "RangeError",
          message: new RegExp(`refreshedEnd needs a finite ${name} in seconds`),
        });
      }
    }
  });

  it("refuses a duration that is negative or not a finite number, and takes 0", () => {
    for (const bad of [-1, -Number.MIN_VALUE, Number.NaN, Infinity, null]) {
      assert.throws(
        () => refreshedEnd("refresh", { endsAt: 5, now: 1, duration: bad }),
        {
          name: "RangeError",
          message: /refreshedEnd needs a duration in seconds, finite and 0/,
        },
      );
    }
    assert.equal(
      refreshedEnd("refresh", { endsAt: 5, now: 1, duration: 0 }),
      1,
    );
    assert.equal(refreshedEnd("extend", { endsAt: 5, now: 1, duration: 0 }), 5);
  });
});

describe("TimerSet ids and Timer payloads (#198, #195 QA 4 and 5)", () => {
  const scheduler = () => new Scheduler({ endTime: 10, handle() {} });

  it("refuses a bad id on every method, reads included", () => {
    const set = new TimerSet({ scheduler: scheduler(), kind: "aura-expire" });
    for (const bad of ["", 4, null, undefined, {}]) {
      for (const call of [
        () => set.start(bad, 1),
        () => set.setEndsAt(bad, 1),
        () => set.clear(bad),
        () => set.endsAt(bad),
        () => set.running(bad),
        () => set.ready(bad),
        () => set.remaining(bad),
      ]) {
        assert.throws(call, {
          name: "TypeError",
          message: /"aura-expire" timer's id must be a non-empty string/,
        });
      }
    }
    // An id never started is still a plain read.
    assert.equal(set.endsAt("unknown"), null);
    assert.equal(set.remaining("unknown"), 0);
  });

  it("freezes an object payload given to a Timer, in place", () => {
    const payload = { id: "premeditation" };
    const timer = new Timer({
      scheduler: scheduler(),
      kind: TIMER_KINDS.points,
      payload,
    });
    assert.ok(Object.isFrozen(payload));
    assert.equal(timer.start(1).payload, payload);
  });
});

describe("SwingTimer hands (#198)", () => {
  it("maps the weapon's main and off to mainHand and offHand", () => {
    assert.deepEqual(SWING_HANDS, { main: "mainHand", off: "offHand" });
    assert.ok(Object.isFrozen(SWING_HANDS));
    const scheduler = new Scheduler({ endTime: 10, handle() {} });
    for (const [hand, name] of Object.entries(SWING_HANDS)) {
      const swing = new SwingTimer({
        weapon: { speed: 2, hand },
        modifiers: flat,
        scheduler,
      });
      assert.equal(swing.hand, name);
      assert.deepEqual(swing.start(0).payload, { hand: name });
    }
  });

  it("refuses any other hand, the engine's names and inherited keys included", () => {
    const scheduler = new Scheduler({ endTime: 10, handle() {} });
    for (const hand of [
      "mainHand",
      "offHand",
      "toString",
      "__proto__",
      "",
      undefined,
      null,
      1,
    ]) {
      assert.throws(
        () =>
          new SwingTimer({
            weapon: { speed: 2, hand },
            modifiers: flat,
            scheduler,
          }),
        { name: "RangeError", message: /weapon hand of "main" or "off"/ },
        String(hand),
      );
    }
  });

  it("refuses swung() from another event at the swing's own time", () => {
    let swing = null;
    const errors = [];
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event) {
        if (event.kind === "other") {
          try {
            swing.swung();
          } catch (error) {
            errors.push(error.message);
          }
        } else if (event.kind === SWING_KIND) {
          swing.swung();
        }
      },
    });
    swing = new SwingTimer({
      weapon: { speed: 2, hand: "main" },
      modifiers: flat,
      scheduler,
    });
    swing.start(2);
    // After the swing, in the same timestamp.
    scheduler.schedule({ time: 2, order: ORDER.decision, kind: "other" });
    scheduler.runUntil(2);
    assert.deepEqual(errors, [
      "swung() is for the main hand's swing event, from its handler.",
    ]);
    assert.throws(() => swing.swung(), /from its handler/);
  });
});

describe("Scheduler nextTime and current (#198)", () => {
  it("gives the next pending time, skipping cancelled events, or null", () => {
    const scheduler = new Scheduler({ endTime: 10, handle() {} });
    assert.equal(scheduler.nextTime, null);
    const early = scheduler.schedule({
      time: 1,
      order: ORDER.decision,
      kind: "a",
    });
    scheduler.schedule({ time: 3, order: ORDER.decision, kind: "b" });
    assert.equal(scheduler.nextTime, 1);
    early.cancel();
    assert.equal(scheduler.nextTime, 3);
    scheduler.runUntil(3);
    assert.equal(scheduler.nextTime, null);
  });

  it("names the event whose handler is running, and null outside one", () => {
    const seen = [];
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event, self) {
        seen.push(self.current === event);
      },
    });
    scheduler.schedule({ time: 1, order: ORDER.decision, kind: "a" });
    scheduler.schedule({ time: 1, order: ORDER.decision, kind: "b" });
    assert.equal(scheduler.current, null);
    scheduler.runUntil(2);
    assert.deepEqual(seen, [true, true]);
    assert.equal(scheduler.current, null);
  });

  it("clears current when a handler throws", () => {
    const scheduler = new Scheduler({
      endTime: 10,
      handle() {
        throw new Error("boom");
      },
    });
    scheduler.schedule({ time: 1, order: ORDER.decision, kind: "a" });
    assert.throws(() => scheduler.runUntil(2), /boom/);
    assert.equal(scheduler.current, null);
  });
});

describe("openCore: the event core held open (#198)", () => {
  const fight = (seed = 9, duration = 30) =>
    createFight(seed, TALENTED, { duration });
  const picture = ({ simulation }) => ({
    time: simulation.currentTime,
    damage: simulation.damageDone,
    log: simulation.combatLog.map((row) => ({ ...row })),
    abilities: simulation.abilityBreakdown(),
  });

  it("gives the fight of one run however the time is split", () => {
    const whole = fight();
    runOnCore(whole.simulation, 30);
    const pieces = fight();
    const run = openCore(pieces.simulation, 30);
    for (const t of [0, 0, 1e-3, 2.5, 2.5, 7.123, 19, 29.99, 30]) {
      run.runUntil(t);
      assert.equal(run.time, t);
      assert.equal(pieces.simulation.currentTime, t);
    }
    run.close();
    assert.deepEqual(picture(pieces), picture(whole));
    assert.deepEqual(
      pieces.rogue.resources.energy.value,
      whole.rogue.resources.energy.value,
    );
  });

  it("writes the fight's fields between calls", () => {
    const { simulation, rogue } = fight();
    const run = openCore(simulation, 30);
    run.runUntil(5);
    assert.equal(simulation.currentTime, 5);
    assert.ok(simulation.damageDone > 0);
    assert.ok(rogue.energy >= 0 && rogue.energy <= rogue.maxEnergy);
    assert.equal(run.endTime, 30);
    assert.ok(run.nextTime === null || run.nextTime >= 5);
    run.close();
  });

  it("refuses a second open, and closes once", () => {
    const { simulation } = fight();
    const run = openCore(simulation, 10);
    assert.throws(() => openCore(simulation, 10), /already running/);
    assert.equal(run.closed, false);
    run.runUntil(4);
    run.close();
    run.close();
    assert.equal(run.closed, true);
    assert.equal(simulation.core, null);
    assert.equal(simulation.currentTime, 4);
    assert.throws(() => run.runUntil(5), /closed/);
  });

  it("hands the energy pool's waste back once, however often it is closed", () => {
    const { simulation, rogue } = fight();
    const run = openCore(simulation, 30);
    run.runUntil(30);
    run.close();
    const { cappedTime, overflow } = rogue.resources.energy;
    assert.ok(cappedTime > 0 || overflow > 0, "the fight wastes energy");
    run.close();
    assert.equal(rogue.resources.energy.cappedTime, cappedTime);
    assert.equal(rogue.resources.energy.overflow, overflow);
  });
});
