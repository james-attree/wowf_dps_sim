import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { ORDER, Scheduler } from "../js/core/scheduler.js";
import { SWING_KIND, SwingTimer } from "../js/core/swing.js";
import { createRng } from "../js/rng.js";
import { Weapon } from "../js/weapon.js";

// A haste source the test changes; resolve("haste", 1) as the pipeline is
// asked by Rogue.rotation.
function hasteSource(initial = 1) {
  const source = {
    haste: initial,
    asked: [],
    resolve(kind, base) {
      source.asked.push([kind, base]);
      return base * source.haste;
    },
  };
  return source;
}

// Two hands on one scheduler. Every swing is logged as [hand, time] and the
// handler calls swung(); `before` runs first (to change haste at a swing).
function setup({
  endTime = 60,
  main = 2.6,
  off = 2.5,
  offStart = k("weapon.offHand").initialSwing,
  haste = hasteSource(),
  onEvent = () => {},
} = {}) {
  const swings = [];
  const timers = {};
  const scheduler = new Scheduler({
    endTime,
    handle(event, s) {
      onEvent(event, s);
      if (event.kind === SWING_KIND) {
        swings.push([event.payload.hand, event.time]);
        timers[event.payload.hand].swung();
      }
    },
  });
  timers.main = new SwingTimer({
    weapon: { speed: main, hand: "main" },
    modifiers: haste,
    scheduler,
  });
  timers.off = new SwingTimer({
    weapon: { speed: off, hand: "off" },
    modifiers: haste,
    scheduler,
  });
  timers.main.start(0);
  timers.off.start(offStart);
  return { scheduler, timers, swings, haste };
}

const timesOf = (swings, hand) =>
  swings.filter(([h]) => h === hand).map(([, time]) => time);

// The swings start + n * speed at or before `end`, with the same float maths.
function exactTimes(start, speed, end) {
  const times = [];
  for (let n = 0; start + n * speed <= end; n++) {
    times.push(start + n * speed);
  }
  return times;
}

describe("SwingTimer (#195)", () => {
  const SPLITS = [
    ["one call", () => [60]],
    ["1 s", () => Array.from({ length: 60 }, (_, i) => i + 1)],
    ["1/64 s", () => Array.from({ length: 3840 }, (_, i) => (i + 1) / 64)],
    ["0.01 s", () => Array.from({ length: 6000 }, (_, i) => (i + 1) * 0.01)],
    [
      "0.37 s",
      () => [...Array.from({ length: 162 }, (_, i) => (i + 1) * 0.37), 60],
    ],
    [
      "random",
      () => {
        const rng = createRng(195);
        const points = Array.from({ length: 400 }, () => rng() * 60);
        return [...points.sort((a, b) => a - b), 60];
      },
    ],
  ];

  for (const [main, off, offStart] of [
    [2.6, 2.5, 0.5],
    [2.0, 1.5, 0.5],
    [1.8, 0.1, 0.25],
    [2.4, 3.0, 0],
  ]) {
    it(`counts the same swings over 60 s at any query granularity (main ${main} s, off ${off} s from ${offStart} s)`, () => {
      const expectedMain = exactTimes(0, main, 60);
      const expectedOff = exactTimes(offStart, off, 60);
      for (const [name, points] of SPLITS) {
        const { scheduler, swings } = setup({ main, off, offStart });
        for (const t of points()) {
          scheduler.runUntil(Math.min(t, 60));
        }
        assert.equal(scheduler.now, 60, name);
        // Each swing at exactly start + n * speed: no build-up over the fight.
        assert.deepEqual(timesOf(swings, "main"), expectedMain, name);
        assert.deepEqual(timesOf(swings, "off"), expectedOff, name);
      }
      // floor(60 / speed), or one more at a boundary (the swing at the start).
      const whole = Math.floor(60 / main);
      assert.ok([whole, whole + 1].includes(expectedMain.length));
    });
  }

  it("swings at exactly 60 s when the speed divides the fight", () => {
    const { scheduler, swings } = setup({ main: 2, off: 3, offStart: 0 });
    scheduler.runUntil(59.999);
    assert.equal(timesOf(swings, "main").length, 30);
    scheduler.runUntil(60);
    assert.equal(timesOf(swings, "main").length, 31);
    assert.equal(timesOf(swings, "main").at(-1), 60);
    assert.equal(timesOf(swings, "off").at(-1), 60);
  });

  it("schedules one pending swing per hand, in the swing class", () => {
    const { scheduler, timers } = setup();
    assert.equal(scheduler.pendingCount, 2);
    scheduler.runUntil(10);
    assert.equal(scheduler.pendingCount, 2);
    assert.equal(timers.main.nextSwingTime, 4 * 2.6);
    assert.equal(timers.main.swingTimer, 4 * 2.6 - 10);
    assert.equal(timers.off.nextSwingTime, 0.5 + 4 * 2.5);
    const seen = [];
    const { scheduler: s2 } = setup({
      onEvent: (event) => seen.push([event.kind, event.order, event.payload]),
    });
    s2.runUntil(0.5);
    assert.deepEqual(seen, [
      [SWING_KIND, ORDER.swing, { hand: "main" }],
      [SWING_KIND, ORDER.swing, { hand: "off" }],
    ]);
    assert.ok(Object.isFrozen(seen[0][2]));
  });

  it("reads haste at each swing as resolve('haste', 1)", () => {
    const { scheduler, haste } = setup();
    scheduler.runUntil(0);
    assert.deepEqual(haste.asked, [["haste", 1]]);
  });

  it("haste mid-swing: the pending swing keeps its time and the next interval is speed / haste from that swing", () => {
    const haste = hasteSource();
    const { scheduler, timers, swings } = setup({ haste, endTime: 30 });
    scheduler.runUntil(1);
    assert.equal(timers.main.nextSwingTime, 2.6);
    haste.haste = 1.3; // Slice and Dice goes up at 1 s, mid-swing
    scheduler.runUntil(2.6 - 1e-6);
    assert.equal(
      timers.main.nextSwingTime,
      2.6,
      "the pending swing does not move",
    );
    scheduler.runUntil(30);
    const main = timesOf(swings, "main");
    assert.equal(main[1], 2.6);
    // Anchored at 2.6 with the new interval.
    const interval = 2.6 / 1.3;
    for (let n = 1; n < main.length - 1; n++) {
      assert.equal(main[n + 1], 2.6 + n * interval);
    }
  });

  it("re-anchors when haste changes and keeps the anchor when it comes back between swings", () => {
    const haste = hasteSource();
    const { scheduler, timers } = setup({ haste, endTime: 30 });
    scheduler.runUntil(2.6); // swings at 0 and 2.6
    haste.haste = 2;
    scheduler.runUntil(2.7);
    haste.haste = 1; // back before the next swing reads it
    scheduler.runUntil(5.2); // the swing at 5.2 reads 1: same interval
    assert.equal(timers.main.nextSwingTime, 3 * 2.6);
    haste.haste = 2;
    scheduler.runUntil(3 * 2.6); // reads 2 at 7.8: new anchor
    assert.equal(timers.main.nextSwingTime, 3 * 2.6 + 1.3);
  });

  // Legacy's rule, from Weapon.tick: per step, haste as Rogue.rotation reads
  // it at the end of the step, a swing when the timer is within tickEpsilon,
  // and the interval added on. The core's haste source reads the same value
  // (the haste of the step that holds the swing), so the two must swing the
  // same number of times, each legacy swing landing in the step that holds
  // the core's. A core swing within tickEpsilon past a step boundary belongs
  // to the step that ends there, as legacy's timer comparison has it.
  it("matches legacy Weapon.tick at the fixed step with random haste changes (seeds 1 to 50, 300 s)", () => {
    const step = k("sim.fixedStep");
    const duration = 300;
    const steps = duration / step;
    for (let seed = 1; seed <= 50; seed++) {
      const rng = createRng(seed);
      // Haste for each step, changing at random step boundaries.
      const hasteOfStep = new Float64Array(steps + 1);
      let h = 1;
      for (let i = 1; i <= steps; i++) {
        if (rng() < 0.01) {
          h = [1, 1.3, 1.2, 1.3 * 1.2][Math.floor(rng() * 4)];
        }
        hasteOfStep[i] = h;
      }
      const legacy = { main: [], off: [] };
      const rogue = { random: () => 0, getAttackPower: () => 0 };
      const weapons = {
        main: new Weapon(rogue, 1, 2, 2.6, "main", "sword"),
        off: new Weapon(rogue, 1, 2, 2.5, "off", "sword"),
      };
      weapons.off.swingTimer = k("weapon.offHand").initialSwing;
      for (let i = 1; i <= steps; i++) {
        for (const hand of ["main", "off"]) {
          weapons[hand].tick(step, hasteOfStep[i], () =>
            legacy[hand].push(i * step),
          );
        }
      }
      const source = {
        resolve: (kind, base) =>
          base *
          hasteOfStep[
            Math.max(
              1,
              Math.ceil((scheduler.now - k("sim.tickEpsilon")) / step),
            )
          ],
      };
      let scheduler;
      const core = setup({ endTime: duration, haste: source });
      scheduler = core.scheduler;
      // setup() asked haste for nothing yet: the first read is at t = 0.
      core.scheduler.runToEnd();
      for (const hand of ["main", "off"]) {
        const ours = timesOf(core.swings, hand);
        assert.equal(ours.length, legacy[hand].length, `seed ${seed} ${hand}`);
        ours.forEach((time, n) => {
          const landed = legacy[hand][n];
          assert.ok(
            landed >= time - k("sim.tickEpsilon") &&
              landed - time < step + k("sim.tickEpsilon"),
            `seed ${seed} ${hand} swing ${n}: core ${time}, legacy ${landed}`,
          );
        });
      }
    }
  });

  it("stop() cancels the pending swing and start() needs it stopped", () => {
    const { scheduler, timers, swings } = setup();
    timers.off.stop();
    assert.equal(timers.off.nextSwingTime, null);
    assert.equal(timers.off.swingTimer, null);
    assert.throws(() => timers.main.start(1), {
      name: "Error",
      message: /main hand is already swinging/,
    });
    scheduler.runUntil(10);
    assert.equal(timesOf(swings, "off").length, 0);
    timers.off.start(12);
    scheduler.runUntil(12);
    assert.deepEqual(timesOf(swings, "off"), [12]);
  });

  it("refuses a swing interval that is not finite and above 0", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const haste = hasteSource();
      const { scheduler } = setup({ haste });
      haste.haste = bad;
      assert.throws(() => scheduler.runUntil(0), {
        name: "RangeError",
        message:
          /main hand's swing interval .* finite number of seconds above 0/,
      });
    }
    const haste = hasteSource();
    const { timers } = setup({ haste });
    haste.haste = 2;
    assert.equal(timers.main.interval, 1.3);
  });

  it("refuses swung() outside the hand's own swing event", () => {
    const { scheduler, timers } = setup();
    assert.throws(() => timers.main.swung(), {
      name: "Error",
      message: /swung\(\) is for the main hand's swing event/,
    });
    scheduler.runUntil(1);
    // The main swing at 0 ran and was followed; calling again schedules twice.
    assert.throws(() => timers.main.swung(), /swung\(\) is for/);
    timers.off.stop();
    assert.throws(() => timers.off.swung(), /off hand's swing event/);
  });

  it("refuses a bad weapon, pipeline or scheduler", () => {
    const scheduler = new Scheduler({ endTime: 1, handle() {} });
    const modifiers = hasteSource();
    for (const speed of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      "2",
    ]) {
      assert.throws(
        () =>
          new SwingTimer({
            weapon: { speed, hand: "main" },
            modifiers,
            scheduler,
          }),
        { name: "RangeError", message: /finite speed above 0/ },
      );
    }
    const weapon = { speed: 2, hand: "main" };
    assert.throws(() => new SwingTimer({ weapon, scheduler }), TypeError);
    assert.throws(() => new SwingTimer({ weapon, modifiers }), TypeError);
    assert.throws(() => new SwingTimer(), RangeError);
  });
});
