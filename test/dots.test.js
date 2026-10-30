import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { DOT_REFRESH, DOT_TICK_KIND, DotTicks } from "../js/core/dots.js";
import { ORDER, Scheduler } from "../js/core/scheduler.js";
import { SWING_KIND } from "../js/core/swing.js";
import { TIMER_KINDS } from "../js/core/timers.js";
import { defineProc } from "../js/procs.js";
import { createRng } from "../js/rng.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { coreHost } from "./core-host.js";
import { setRoll, testRng } from "./rolls.js";
import { referenceBuild } from "./talentsforever.js";

// E5 (#196): DoT ticks, procs and poisons on the core's events. DotTicks
// (js/core/dots.js) on a bare scheduler first, then a legacy Simulation on
// events through the test host (test/core-host.js), then the same fights on
// both engines, seed for seed.

const EPS = k("sim.tickEpsilon");
const RUPTURE = { id: "rupture", name: "Rupture", icon: null };
// A white swing, a landed skill and a proc roll at no crit and full bonus hit:
// a plain hit, a landed attack, and a proc that fires at any chance above it.
const HIT = 0.99;

afterEach(() => {
  CONSTANTS["hackAndSlash.chain"].value = false;
  setRoll(HIT);
});

// A scheduler with DotTicks. Every tick is logged as [id, time, tick, last];
// `onTick(info, event, dots)` runs after ticked(), where the host runs the
// tick body; `onEvent` runs for every other event.
function setup({ endTime = 60, onTick = () => {}, onEvent = () => {} } = {}) {
  const ticks = [];
  const scheduler = new Scheduler({
    endTime,
    handle(event, s) {
      if (event.kind === DOT_TICK_KIND) {
        const info = dots.ticked(event);
        ticks.push([info.id, event.time, info.tick, info.last]);
        onTick(info, event, dots, s);
      } else {
        event.payload.fn(dots, s);
      }
      onEvent(event, s);
    },
  });
  const dots = new DotTicks({ scheduler });
  const at = (time, fn) =>
    scheduler.schedule({
      time,
      order: ORDER.decision,
      kind: "decision",
      payload: { fn },
    });
  return { scheduler, dots, ticks, at };
}

const timesOf = (ticks, id) =>
  ticks.filter(([what]) => what === id).map(([, time]) => time);

describe("DoT ticks on events (DotTicks)", () => {
  it("ticks a cast DoT at exactly anchor + n × interval, floor(duration / interval) times", () => {
    const interval = k("rupture.tickInterval");
    for (const start of [0, 0.3, 7.1]) {
      const { scheduler, dots, ticks, at } = setup();
      at(start, (d) =>
        d.apply("rupture", { interval, duration: 16, refresh: "restart" }),
      );
      scheduler.runToEnd();
      const expected = Array.from(
        { length: Math.floor(16 / interval) },
        (_, n) => start + (n + 1) * interval,
      );
      assert.deepEqual(timesOf(ticks, "rupture"), expected);
      assert.deepEqual(
        ticks.map(([, , tick, last]) => [tick, last]),
        expected.map((_, n) => [n + 1, n === expected.length - 1]),
      );
      assert.equal(dots.ticks("rupture"), expected.length);
      assert.equal(dots.nextTickAt("rupture"), null);
    }
  });

  it("splits a duration that is not a whole number of ticks the legacy way (floor), and a short one has none", () => {
    const { scheduler, dots, ticks, at } = setup();
    at(1, (d) => {
      assert.notEqual(d.apply("a", { interval: 3, duration: 11 }), null);
      assert.equal(d.apply("b", { interval: 3, duration: 2.9 }), null);
      assert.equal(d.apply("c", { interval: 3, duration: 0 }), null);
    });
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "a"), [4, 7, 10]);
    assert.deepEqual(timesOf(ticks, "b"), []);
    assert.equal(dots.running("b"), false);
    assert.equal(dots.running("c"), false);
  });

  it("leaves no stale tick when a cast DoT is refreshed: the old ticks are cancelled and the clock restarts", () => {
    const { scheduler, ticks, at } = setup();
    at(0, (d) => d.apply("rupture", { interval: 2, duration: 8 }));
    at(3, (d) => {
      const before = scheduler.pendingCount;
      assert.equal(d.nextTickAt("rupture"), 4);
      d.apply("rupture", { interval: 2, duration: 8 });
      assert.equal(d.nextTickAt("rupture"), 5);
      // The tick at 4 went: one pending tick, as before.
      assert.equal(scheduler.pendingCount, before);
    });
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "rupture"), [2, 5, 7, 9, 11]);
  });

  it("keeps the tick clock on a keep-clock refresh while running, and moves only the end", () => {
    const { scheduler, dots, ticks, at } = setup();
    at(0, (d) =>
      d.apply("deadly", { interval: 3, duration: 12, refresh: "keep-clock" }),
    );
    at(10, (d) => {
      d.apply("deadly", { interval: 3, duration: 12, refresh: "keep-clock" });
      assert.equal(d.endsAt("deadly"), 22);
      assert.equal(d.nextTickAt("deadly"), 12);
      assert.equal(d.remaining("deadly"), 12);
    });
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "deadly"), [3, 6, 9, 12, 15, 18, 21]);
    assert.equal(dots.ticks("deadly"), 7);
  });

  it("restarts the clock on a keep-clock application once the DoT has ended, as legacy does when the entry is gone", () => {
    const { scheduler, ticks, at } = setup();
    at(0, (d) =>
      d.apply("deadly", { interval: 3, duration: 6, refresh: "keep-clock" }),
    );
    // At 6 the DoT ends (no time left), after its own tick there.
    at(6, (d) => {
      assert.equal(d.running("deadly"), false);
      d.apply("deadly", { interval: 3, duration: 6, refresh: "keep-clock" });
    });
    at(13, (d) =>
      d.apply("deadly", { interval: 3, duration: 6, refresh: "keep-clock" }),
    );
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "deadly"), [3, 6, 9, 12, 16, 19]);
  });

  it("drops the pending tick when a keep-clock refresh ends the DoT before it, as legacy's entry runs out first", () => {
    const { scheduler, dots, ticks, at } = setup();
    at(0, (d) =>
      d.apply("p", { interval: 3, duration: 12, refresh: "keep-clock" }),
    );
    at(4, (d) => {
      assert.equal(
        d.apply("p", { interval: 3, duration: 1, refresh: "keep-clock" }),
        null,
      );
      assert.equal(d.nextTickAt("p"), null);
    });
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "p"), [3]);
    assert.equal(scheduler.pendingCount, 0);
    assert.equal(dots.running("p"), false);
  });

  it("schedules again on a keep-clock refresh after the last tick, while the DoT is still up", () => {
    const { scheduler, ticks, at } = setup();
    at(0, (d) =>
      d.apply("p", { interval: 3, duration: 11, refresh: "keep-clock" }),
    );
    at(10, (d) => {
      assert.equal(d.nextTickAt("p"), null);
      assert.equal(d.running("p"), true);
      d.apply("p", { interval: 3, duration: 11, refresh: "keep-clock" });
      assert.equal(d.nextTickAt("p"), 12);
    });
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "p"), [3, 6, 9, 12, 15, 18, 21]);
  });

  it("keeps the pending tick's time when a keep-clock refresh changes the interval, then counts the new one", () => {
    const { scheduler, ticks, at } = setup();
    at(0, (d) =>
      d.apply("p", { interval: 3, duration: 12, refresh: "keep-clock" }),
    );
    at(4, (d) =>
      d.apply("p", { interval: 2, duration: 8, refresh: "keep-clock" }),
    );
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "p"), [3, 6, 8, 10, 12]);
  });

  it('ticks a keep-clock DoT at its end, and up to k("sim.tickEpsilon") past it, not further', () => {
    for (const [past, expected] of [
      [0, [3, 6]],
      [EPS / 2, [3, 6]],
      [EPS * 2, [3]],
    ]) {
      const { scheduler, ticks, at } = setup();
      at(0, (d) =>
        d.apply("p", {
          interval: 3,
          duration: 6 - past,
          refresh: "keep-clock",
        }),
      );
      scheduler.runToEnd();
      assert.deepEqual(timesOf(ticks, "p"), expected, `past ${past}`);
    }
  });

  it('is running while more than k("sim.tickEpsilon") is left, as legacy keeps a DoT in activeDots', () => {
    const { scheduler, dots, at } = setup();
    at(0, (d) => d.apply("p", { interval: 1, duration: 4 }));
    at(4 - EPS * 2, (d) => assert.equal(d.running("p"), true));
    at(4 - EPS / 2, (d) => {
      assert.equal(d.running("p"), false);
      assert.equal(d.endsAt("p"), null);
      assert.equal(d.remaining("p"), 0);
    });
    scheduler.runToEnd();
    assert.equal(dots.running("never"), false);
    assert.equal(dots.ticks("never"), 0);
    assert.equal(dots.nextTickAt("never"), null);
    assert.deepEqual(dots.runningIds, []);
  });

  it("lets the tick's own procs refresh the DoT: the tick just scheduled is replaced, none is left stale", () => {
    let refreshed = false;
    const { scheduler, ticks, at } = setup({
      onTick(info, event, dots) {
        // A proc on the tick at 4 recasts it (restart from 4).
        if (event.time === 4 && !refreshed) {
          refreshed = true;
          dots.apply("r", { interval: 2, duration: 4 });
        }
      },
    });
    at(0, (d) => d.apply("r", { interval: 2, duration: 6 }));
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "r"), [2, 4, 6, 8]);
    assert.equal(scheduler.pendingCount, 0);
  });

  it("stops at clear(), with no tick left", () => {
    const { scheduler, dots, ticks, at } = setup();
    at(0, (d) => d.apply("r", { interval: 2, duration: 10 }));
    at(5, (d) => d.clear("r"));
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "r"), [2, 4]);
    assert.equal(dots.running("r"), false);
    dots.clear("never");
  });

  it("lists the running ids in the order they were first applied", () => {
    const { scheduler, at } = setup();
    at(0, (d) => {
      d.apply("b", { interval: 1, duration: 5 });
      d.apply("a", { interval: 1, duration: 2 });
      d.apply("c", { interval: 1, duration: 9 });
      assert.deepEqual(d.runningIds, ["b", "a", "c"]);
    });
    at(3, (d) => assert.deepEqual(d.runningIds, ["b", "c"]));
    scheduler.runToEnd();
  });

  it("runs a dot-tick after an expiry and before a swing and a decision at the same time", () => {
    const order = [];
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event) {
        order.push(event.kind);
        if (event.kind === DOT_TICK_KIND) {
          dots.ticked(event);
        }
      },
    });
    const dots = new DotTicks({ scheduler });
    scheduler.schedule({
      time: 2,
      order: ORDER.decision,
      kind: "decision",
    });
    scheduler.schedule({ time: 2, order: ORDER.swing, kind: SWING_KIND });
    dots.apply("r", { interval: 2, duration: 2 });
    scheduler.schedule({
      time: 2,
      order: ORDER.expiry,
      kind: TIMER_KINDS.aura,
    });
    scheduler.runToEnd();
    assert.deepEqual(order, [
      TIMER_KINDS.aura,
      DOT_TICK_KIND,
      SWING_KIND,
      "decision",
    ]);
  });

  it("refuses a bad interval with the legacy message, a bad duration and a bad refresh rule", () => {
    const { dots } = setup();
    for (const interval of [0, -1, Number.NaN, Infinity, "2", undefined]) {
      assert.throws(() => dots.apply("rupture", { interval, duration: 4 }), {
        name: "RangeError",
        message: `DoT "rupture" has tick interval ${typeof interval === "string" ? `"${interval}"` : String(interval)}; it must be a finite number of seconds above 0.`,
      });
    }
    for (const duration of [-1, Number.NaN, Infinity, "4", undefined]) {
      assert.throws(() => dots.apply("r", { interval: 2, duration }), {
        name: "RangeError",
        message: /DoT "r" needs a duration in seconds, finite and 0 or more/,
      });
    }
    assert.throws(
      () => dots.apply("r", { interval: 2, duration: 4, refresh: "extend" }),
      {
        name: "RangeError",
        message:
          'DoT "r": refresh must be one of restart, keep-clock. Got "extend".',
      },
    );
    assert.throws(() => dots.apply("r"), RangeError);
    assert.deepEqual(Object.values(DOT_REFRESH), ["restart", "keep-clock"]);
    assert.equal(Object.isFrozen(DOT_REFRESH), true);
  });

  it("refuses an id that is not a non-empty string on every method", () => {
    const { dots } = setup();
    for (const id of ["", 1, null, undefined, {}]) {
      for (const call of [
        () => dots.apply(id, { interval: 1, duration: 1 }),
        () => dots.clear(id),
        () => dots.running(id),
        () => dots.endsAt(id),
        () => dots.remaining(id),
        () => dots.nextTickAt(id),
        () => dots.ticks(id),
      ]) {
        assert.throws(call, {
          name: "TypeError",
          message: /A DoT's id must be a non-empty string/,
        });
      }
    }
    assert.throws(() => new DotTicks(), {
      name: "TypeError",
      message: "DotTicks needs the core's scheduler.",
    });
  });

  it("takes ticked() only for the DoT's own tick, from its handler, once", () => {
    let captured = null;
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event) {
        if (event.kind !== DOT_TICK_KIND) {
          return;
        }
        // Another DoT's event, then this one twice.
        assert.throws(() => dots.ticked(other), /own pending tick event/);
        dots.ticked(event);
        assert.throws(() => dots.ticked(event), /own pending tick event/);
        captured = event;
      },
    });
    const dots = new DotTicks({ scheduler });
    const pending = dots.apply("r", { interval: 2, duration: 2 });
    const other = dots.apply("s", { interval: 3, duration: 3 });
    assert.equal(pending.kind, DOT_TICK_KIND);
    assert.equal(pending.order, ORDER["dot-tick"]);
    assert.deepEqual(pending.payload, { id: "r" });
    assert.equal(Object.isFrozen(pending.payload), true);
    // Not run yet.
    assert.throws(() => dots.ticked(pending), /own pending tick event/);
    for (const bad of [undefined, null, {}, { payload: { id: "r" } }]) {
      assert.throws(() => dots.ticked(bad), /own pending tick event/);
    }
    scheduler.runUntil(2);
    assert.equal(captured, pending);
    // Another scheduler's event of the same id.
    const elsewhere = setup();
    let foreign = null;
    elsewhere.at(0, (d) => {
      foreign = d.apply("r", { interval: 1, duration: 1 });
    });
    elsewhere.scheduler.runToEnd();
    assert.equal(foreign.state, "ran");
    assert.throws(() => dots.ticked(foreign), /own pending tick event/);
  });

  it("refuses ticked() for its pending tick at the same time, before it runs, and for a tick that ran without it", () => {
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event) {
        if (event.kind === "probe") {
          // Due now, still pending: the expiry class runs before DoT ticks.
          assert.equal(dot.state, "pending");
          assert.equal(dot.time, scheduler.now);
          assert.throws(() => dots.ticked(dot), /own pending tick event/);
        }
        // A tick event the handler does not pass to ticked().
      },
    });
    const dots = new DotTicks({ scheduler });
    const dot = dots.apply("r", { interval: 2, duration: 4 });
    scheduler.schedule({ time: 2, order: ORDER.expiry, kind: "probe" });
    scheduler.runUntil(3);
    assert.equal(dot.state, "ran");
    // Ran, but at 2 and not now (3).
    assert.throws(() => dots.ticked(dot), /own pending tick event/);
  });

  it("schedules a tick again on a keep-clock refresh after its pending tick was cancelled from outside", () => {
    const { scheduler, ticks, at } = setup({ endTime: 20 });
    let first = null;
    at(0, (d) => {
      first = d.apply("p", {
        interval: 3,
        duration: 12,
        refresh: DOT_REFRESH.keepClock,
      });
    });
    at(1, (d) => {
      first.cancel();
      assert.equal(d.nextTickAt("p"), null);
      d.apply("p", {
        interval: 3,
        duration: 12,
        refresh: DOT_REFRESH.keepClock,
      });
      assert.equal(d.nextTickAt("p"), 3);
    });
    scheduler.runToEnd();
    assert.deepEqual(timesOf(ticks, "p"), [3, 6, 9, 12]);
  });

  it("matches a reference model over 200 random seeds of applications", () => {
    const intervals = [1, 1.5, 2, 3];
    const durations = [0, 0.25, 1, 2.5, 5, 6, 11, 12, 16];
    const ids = ["a", "b", "c"];
    const end = 60;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      const pick = (list) => list[Math.floor(rng() * list.length)];
      const applications = Array.from({ length: 12 }, () => ({
        time: Math.floor(rng() * 40 * 8) / 8,
        id: pick(ids),
        interval: pick(intervals),
        duration: pick(durations),
        refresh: pick(Object.values(DOT_REFRESH)),
      })).sort((a, b) => a.time - b.time);

      const { scheduler, ticks, at } = setup({ endTime: end });
      for (const application of applications) {
        at(application.time, (d) => d.apply(application.id, application));
      }
      scheduler.runToEnd();
      assert.deepEqual(
        ticks.map(([id, time]) => [id, time]),
        referenceTicks(applications, end),
        `seed ${seed}`,
      );
    }
  });
});

// The ticks the DoT rules give, without a scheduler: per id, the next tick
// is anchor + (n + 1) × interval; a restart counts floor(duration / interval)
// ticks, a keep-clock DoT ticks while within k("sim.tickEpsilon") of its end.
// Ticks at an application's time come before it (dot-tick before decision),
// and two ticks at one time go in the order they were scheduled: at the
// application or the tick before, a keep-clock refresh keeping the one
// already pending.
function referenceTicks(applications, end) {
  const state = new Map();
  const out = [];
  let seq = 0;
  const next = (dot) => dot.anchor + (dot.n + 1) * dot.interval;
  const fits = (dot) =>
    dot.limit === null ? next(dot) - dot.end <= EPS : dot.n < dot.limit;
  const earlier = (a, b) =>
    next(a) < next(b) || (next(a) === next(b) && a.seq < b.seq);
  const until = (time) => {
    for (;;) {
      let first = null;
      for (const dot of state.values()) {
        if (dot.pending && next(dot) <= time) {
          if (first === null || earlier(dot, first)) {
            first = dot;
          }
        }
      }
      if (first === null) {
        return;
      }
      out.push([first.id, next(first)]);
      first.n += 1;
      first.pending = fits(first);
      first.seq = seq++;
    }
  };
  for (const { time, id, interval, duration, refresh } of applications) {
    until(time);
    const dot = state.get(id);
    if (refresh === "keep-clock" && dot !== undefined && dot.end - time > EPS) {
      if (interval !== dot.interval) {
        dot.anchor = next(dot) - interval;
        dot.interval = interval;
        dot.n = 0;
      }
      dot.end = time + duration;
      dot.limit = null;
      if (!dot.pending) {
        dot.seq = seq++;
      }
      dot.pending = fits(dot);
    } else {
      const fresh = {
        id,
        anchor: time,
        interval,
        n: 0,
        end: time + duration,
        limit: refresh === "restart" ? Math.floor(duration / interval) : null,
        seq: seq++,
      };
      fresh.pending = fits(fresh);
      state.set(id, fresh);
    }
  }
  until(end);
  return out;
}

// A rogue on the test host: no rotation, full bonus hit and no crit (as the
// procs tests' harness), the procs given, every draw `roll` (testRng).
function eventFight({
  config,
  procs = [],
  endTime = 60,
  swings = false,
  roll = HIT,
} = {}) {
  const rogue = new Rogue(config, { procs });
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  rogue.rotation = () => {};
  setRoll(roll);
  const sim = new Simulation(rogue, { rng: testRng });
  const hits = [];
  sim.on("hit", (event) => hits.push(event));
  const host = coreHost(sim, { endTime, swings });
  return { rogue, sim, host, hits };
}

const white = (sim) => {
  const weapon = sim.rogue.weapons.mainHand;
  return sim.resolveAttack(weapon.attack, "weapon", 100);
};
const dotHits = (hits, name) =>
  hits.filter((event) => event.origin === "dot" && event.name === name);

describe("DoTs, procs and poisons on events (test host)", () => {
  it("ticks a cast Rupture on its own events at exact multiples of rupture.tickInterval, the damage split as legacy", () => {
    const interval = k("rupture.tickInterval");
    const { sim, host, hits } = eventFight();
    host.at(1.3, () => sim.resolveDotAttack(RUPTURE, "skill", 800, 16, true));
    host.run();
    const ticks = dotHits(hits, "Rupture");
    assert.deepEqual(
      ticks.map((event) => event.time),
      Array.from({ length: 8 }, (_, n) => 1.3 + (n + 1) * interval),
    );
    assert.deepEqual(
      ticks.map((event) => event.damage),
      Array(8).fill(100),
    );
    assert.equal(sim.abilityBreakdown().Rupture.ticks, 8);
    assert.equal(sim.damageDone, 800);
    assert.equal(Object.hasOwn(sim.activeDots, "rupture"), false);
  });

  it("restarts a refreshed Rupture's clock with no tick left on the old one", () => {
    const { sim, host, hits } = eventFight();
    host.at(1.3, () => sim.resolveDotAttack(RUPTURE, "skill", 800, 16, true));
    host.at(5.8, () => sim.resolveDotAttack(RUPTURE, "skill", 400, 8, true));
    host.run();
    assert.deepEqual(
      dotHits(hits, "Rupture").map((event) => [event.time, event.damage]),
      [
        [3.3, 100],
        [5.3, 100],
        [7.8, 100],
        [9.8, 100],
        [11.8, 100],
        [13.8, 100],
      ],
    );
  });

  it("raises the Rupture ticks inside a Hemorrhage window and not outside it; an expiry at a tick's time comes first", () => {
    const { bonus, duration } = k("hemorrhage.ruptureBonus");
    const { sim, host, hits } = eventFight();
    host.at(0, () => sim.resolveDotAttack(RUPTURE, "skill", 1000, 20, true));
    // Up from 3 to 3 + duration (18), a tick time.
    host.at(3, () => sim.applyAura(AURAS.hemorrhage));
    host.run();
    const window = (time) => time > 3 && time < 3 + duration;
    const ticks = dotHits(hits, "Rupture");
    assert.equal(ticks.length, 10);
    for (const event of ticks) {
      assert.equal(
        event.damage,
        window(event.time) ? 100 * (1 + bonus) : 100,
        `t = ${event.time}`,
      );
    }
    assert.deepEqual(
      ticks.filter((event) => !window(event.time)).map((event) => event.time),
      [2, 18, 20],
    );
    assert.equal(host.auras.running("hemorrhage"), false);
    assert.equal(Object.hasOwn(sim.activeDebuffs, "hemorrhage"), false);
  });

  it('holds a proc\'s internal cooldown on event time, with the k("sim.tickEpsilon") tolerance', () => {
    const icd = defineProc({
      id: "icd-proc",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      cooldown: 3,
      actions: [{ type: "gainResource", resource: "comboPoints", amount: 1 }],
    });
    const { sim, host } = eventFight({ procs: [icd] });
    const fired = [];
    sim.on("proc", () => fired.push(sim.currentTime));
    for (const time of [0, 1.5, 3 - EPS / 2, 4.5, 6 - EPS * 2, 6.5]) {
      host.at(time, () => white(sim));
    }
    host.run();
    assert.deepEqual(fired, [0, 3 - EPS / 2, 6.5]);
    assert.equal(sim.procs.stats["icd-proc"].fires, 3);
    assert.equal(sim.procs.stats["icd-proc"].blocked, 3);
  });

  it("keeps a poison's tick clock on a refresh, each tick the stacks × tickDamage", () => {
    const poison = defineProc({
      id: "test-deadly",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [
        {
          type: "applyDot",
          id: "deadly-poison",
          name: "Deadly Poison",
          tickDamage: 10,
          interval: 3,
          duration: 12,
          aura: "deadly-poison",
        },
      ],
    });
    const { sim, host, hits } = eventFight({ procs: [poison] });
    for (const time of [0, 2, 4]) {
      host.at(time, () => white(sim));
    }
    host.run();
    assert.deepEqual(
      dotHits(hits, "Deadly Poison").map((event) => [event.time, event.damage]),
      [
        // Two stacks (0 and 2), then three (4).
        [3, 20],
        [6, 30],
        [9, 30],
        [12, 30],
        [15, 30],
      ],
    );
    // The aura's own timer ends it at 16 (4 + 12), with the DoT.
    assert.equal(host.auras.running("deadly-poison"), false);
    assert.equal(host.dots.running("deadly-poison"), false);
  });

  it("resolves an extra attack at the same time, depth first, and leaves the swing timer alone", () => {
    const extra = defineProc({
      id: "test-extra",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "extraAttack" }],
    });
    const { rogue, host, hits } = eventFight({
      procs: [extra],
      swings: true,
      endTime: new Rogue().weapons.mainHand.speed * 2,
      config: { weapons: { offHand: { speed: 1000 } } },
    });
    host.run({ offStart: 999 });
    const speed = rogue.weapons.mainHand.speed;
    assert.deepEqual(
      hits.map((event) => [event.name, event.time]),
      [
        ["Main-hand", 0],
        ["Main-hand", 0],
        ["Main-hand", speed],
        ["Main-hand", speed],
        ["Main-hand", speed * 2],
        ["Main-hand", speed * 2],
      ],
    );
    assert.equal(host.swings.main.nextSwingTime, speed * 3);
  });

  it("chains extra attacks only with hackAndSlash.chain on, up to proc.maxChainDepth", () => {
    const extra = defineProc({
      id: "test-extra",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "extraAttack" }],
    });
    CONSTANTS["hackAndSlash.chain"].value = true;
    const { sim, host } = eventFight({ procs: [extra] });
    host.at(1, () => white(sim));
    assert.throws(() => host.run(), {
      name: "RangeError",
      message: new RegExp(
        `Extra attacks followed one another ${k("proc.maxChainDepth")} times`,
      ),
    });
  });

  it("keeps Cold Blood through a white swing and spends it on the Eviscerate", () => {
    const { sim, host } = eventFight();
    const seen = {};
    host.at(0, () => sim.applyAura(AURAS.coldBlood));
    host.at(1, () => {
      white(sim);
      seen.afterSwing = sim.hasAura("cold-blood");
    });
    host.at(2, () => {
      // A crit only with Cold Blood's +100%: the rogue's own chance is 0.
      setRoll(0.5);
      seen.eviscerate = sim.resolveAttack(
        { id: "eviscerate", name: "Eviscerate", icon: null },
        "skill",
        500,
      ).outcome;
      seen.afterEviscerate = sim.hasAura("cold-blood");
    });
    host.run();
    assert.deepEqual(seen, {
      afterSwing: true,
      eviscerate: "crit",
      afterEviscerate: false,
    });
    // Its last charge ended it, so no expiry is left on the queue.
    assert.equal(host.auras.running("cold-blood"), false);
  });
});

describe("the same fight on both engines", () => {
  // Weapon speeds and cast times on the 1/64 s step, so both engines see the
  // same times. The step loop's first frame is 1/64 s; the events' is 0.
  const config = {
    talents: referenceBuild(),
    poisons: { mainHand: "instant", offHand: "deadly" },
    weapons: { mainHand: { speed: 2.5 }, offHand: { speed: 1.75 } },
  };
  const casts = [
    [3.125, (sim) => sim.applyAura(AURAS.hemorrhage)],
    [5.125, (sim) => sim.resolveDotAttack(RUPTURE, "skill", 800, 16, true)],
    [11.125, (sim) => sim.resolveDotAttack(RUPTURE, "skill", 800, 16, true)],
    [40.125, (sim) => sim.resolveDotAttack(RUPTURE, "skill", 800, 11, true)],
  ];
  const row = (event) =>
    [event.time, event.name, event.origin, event.outcome, event.damage].join(
      " ",
    );

  function legacy(seed) {
    const rogue = new Rogue(config);
    const sim = new Simulation(rogue, { seed });
    rogue.rotation = (s, dt) => {
      for (const [time, cast] of casts) {
        if (s.currentTime === time) {
          cast(s);
        }
      }
      const haste = s.modifiers.resolve("haste", 1);
      for (const weapon of [rogue.weapons.mainHand, rogue.weapons.offHand]) {
        weapon.tick(dt, haste, (w) =>
          s.resolveAttack(w.attack, "weapon", w.rollDamage()),
        );
      }
    };
    const hits = [];
    sim.on("hit", (event) =>
      hits.push(
        row({
          ...event,
          time: event.time === k("sim.fixedStep") ? 0 : event.time,
        }),
      ),
    );
    sim.run(60);
    return { sim, hits };
  }

  function onEvents(seed) {
    const sim = new Simulation(new Rogue(config), { seed });
    const hits = [];
    sim.on("hit", (event) => hits.push(row(event)));
    const host = coreHost(sim, { endTime: 60 });
    for (const [time, cast] of casts) {
      host.at(time, () => cast(sim));
    }
    host.run();
    return { sim, hits };
  }

  it("gives the same hits, draw for draw, over 200 seeds: swings, procs, poisons, Rupture and Hemorrhage", () => {
    let ruptureTicks = 0;
    let poisonTicks = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const a = legacy(seed);
      const b = onEvents(seed);
      assert.deepEqual(b.hits, a.hits, `seed ${seed}`);
      assert.equal(b.sim.damageDone, a.sim.damageDone, `seed ${seed}`);
      assert.deepEqual(
        b.sim.abilityBreakdown(),
        a.sim.abilityBreakdown(),
        `seed ${seed}`,
      );
      ruptureTicks += a.sim.abilityBreakdown().Rupture?.ticks ?? 0;
      poisonTicks += a.sim.abilityBreakdown()["Deadly Poison"]?.ticks ?? 0;
    }
    // The cases are not empty.
    assert.ok(ruptureTicks > 0);
    assert.ok(poisonTicks > 0);
  });
});

describe("poison charges on events", () => {
  it("never uses up a charge (poison.charges is unlimited): every landed swing past the export's 180 still rolls the poison", () => {
    assert.equal(k("poison.charges"), "unlimited");
    // 0.19 lands the swing (a glance), is under Instant Poison's 20% chance
    // and above its spell miss, so every poison roll lands.
    const { sim, host, hits } = eventFight({
      config: { poisons: { mainHand: "instant" } },
      endTime: 300,
      roll: 0.19,
    });
    for (let n = 0; n < 250; n++) {
      host.at(n, () => white(sim));
    }
    host.run();
    const poison = hits.filter((event) => event.name === "Instant Poison");
    assert.equal(poison.length, 250);
    assert.ok(poison.every((event) => event.outcome === "hit"));
  });
});
