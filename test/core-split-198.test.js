import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { DOT_REFRESH, DOT_TICK_KIND, DotTicks } from "../js/core/dots.js";
import { EnergyPool } from "../js/core/energy.js";
import { ENGINES, openCore, runOnCore } from "../js/core/fight.js";
import { Scheduler } from "../js/core/scheduler.js";
import { SWING_KIND, SwingTimer } from "../js/core/swing.js";
import { createFight, fightResult, runFight } from "../js/fight.js";
import { RESOURCE_DEFINITIONS } from "../js/resource-data.js";
import { createRng } from "../js/rng.js";
import { SimRunner } from "../js/sim-runner.js";
import { PARITY_CASES, PARITY_ONLY_CASES } from "../scripts/parity.mjs";

// #198, from #197's QA (M1 and M2 on PR #230). M1: a fight cut into pieces on
// the event core is the fight run in one piece, event for event. The core's
// scheduler runs on the fight's own clock, and each run hands the next one
// the clocks it left (swing grids, DoT clocks, the energy line, the poll,
// and the end times it wrote), so nothing restarts at a cut. M2: the engine
// option really runs the core, the re-ask cap, and the DoT refresh rules
// across a run.

const EVENTS = ENGINES.events;
const HEMO = PARITY_ONLY_CASES.find(
  ({ name }) => name === "dot-hemorrhage-rupture-120s",
);
// The distinct configs the parity gate runs.
const CONFIGS = [
  ...new Map(PARITY_CASES.map((c) => [JSON.stringify(c.config), c])).values(),
];

// A fight on the event core with the events it reports logged in full.
function logged(seed, config, duration) {
  const fight = createFight(seed, structuredClone(config), {
    duration,
    engine: EVENTS,
  });
  const log = [];
  // sim.run reports an end at the end of every call, so the ends are left
  // out: the pieces' log has one per piece.
  fight.simulation.on("*", (event) => {
    if (event.type !== "end") {
      log.push(JSON.stringify(event));
    }
  });
  return { fight, log };
}

// The fight run to `duration` in one call of `run`, and in pieces at `cuts`.
function oneAndSplit(seed, config, duration, cuts, run) {
  const one = logged(seed, config, duration);
  run(one.fight.simulation, duration);
  const split = logged(seed, config, duration);
  // Each piece runs to the cut from the fight's time, so the pieces add up
  // to the cut itself (summed lengths would end an ulp off it).
  const { simulation } = split.fight;
  for (const cut of [...cuts, duration]) {
    run(simulation, cut - simulation.currentTime);
  }
  assert.equal(simulation.currentTime, duration);
  return { one, split };
}

function assertSame({ one, split }, label) {
  assert.ok(one.log.length > 100, `${label}: the fight did something`);
  assert.deepEqual(split.log, one.log, label);
  assert.deepEqual(fightResult(split.fight), fightResult(one.fight), label);
}

const byCore = (simulation, duration) => runOnCore(simulation, duration);
const bySim = (simulation, duration) => simulation.run(duration);

describe("a fight split on the event core is the fight in one run (#198, #197 QA M1)", () => {
  it("Kira's repro: hemorrhage seed 30 cut at 85.5022, through runOnCore and sim.run", () => {
    for (const run of [byCore, bySim]) {
      const pair = oneAndSplit(30, HEMO.config, 120, [85.5022], run);
      assertSame(pair, run === byCore ? "runOnCore" : "sim.run");
    }
  });

  it("every parity config, at random cuts and at cuts on event times", () => {
    const rng = createRng(198);
    for (const { name, config } of CONFIGS) {
      for (const seed of [3, 17, 44]) {
        const cuts = Array.from({ length: 4 }, () => rng() * 60).sort(
          (a, b) => a - b,
        );
        assertSame(
          oneAndSplit(seed, config, 60, cuts, bySim),
          `${name} seed ${seed} at ${cuts.join(", ")}`,
        );
        // Cuts at the times of events of the whole fight, where a run ends
        // with events of that time handled and the next starts there.
        const times = logged(seed, config, 60);
        times.fight.simulation.run(60);
        const at = [
          ...new Set(times.log.map((line) => JSON.parse(line).time)),
        ].filter((time) => time > 0 && time < 60);
        const onEvents = [0.1, 0.35, 0.6, 0.85].map(
          (f) => at[Math.floor(f * at.length)],
        );
        assertSame(
          oneAndSplit(seed, config, 60, onEvents, byCore),
          `${name} seed ${seed} at events ${onEvents.join(", ")}`,
        );
      }
    }
  });

  // Cuts where a part of the carry alone keeps the fight the same: the
  // energy line (finishers seed 14, hemorrhage seed 22) and a poison DoT
  // whose last tick has run with time left (poisons seed 28).
  it("the cuts that need the energy line and an idle DoT carried", () => {
    const named = (name) =>
      PARITY_CASES.find((c) => c.name === name) ??
      PARITY_ONLY_CASES.find((c) => c.name === name);
    for (const [name, seed, cuts] of [
      [
        "finishers-50s-without-script",
        14,
        [2.0646, 13.833, 25.3399, 27.1388, 51.5573, 52.6346],
      ],
      [
        "dot-hemorrhage-rupture-120s",
        22,
        [8.1906, 21.9246, 23.2259, 26.9174, 27.6171, 49.5448],
      ],
      [
        "poisons-instant-deadly-seed-107-60s",
        28,
        [6.1748, 24.3153, 34.59, 38.2979, 49.9762, 53.6699],
      ],
    ]) {
      assertSame(
        oneAndSplit(seed, named(name).config, 60, cuts, bySim),
        `${name} seed ${seed}`,
      );
    }
  });

  it("an end the next run takes exactly, not re-based from the time left", () => {
    // (7.3 - 0.371) + 0.371 is 7.300000000000001: from the field alone the
    // aura would end an ulp late.
    const ends = [];
    for (const cuts of [[], [0.371]]) {
      const { simulation, rogue } = createFight(4, undefined, {
        duration: 10,
        engine: EVENTS,
      });
      const definition = simulation.auraDefinitions.get("blade-flurry");
      rogue.castRotation = (sim) => {
        if (sim.currentTime === 0) {
          sim.applyAura(definition, { duration: 7.3 });
        }
        return { casts: [] };
      };
      simulation.on("aura", (event) => {
        if (event.change === "expire") {
          ends.push(event.time);
        }
      });
      for (const cut of [...cuts, 10]) {
        runOnCore(simulation, cut - simulation.currentTime);
      }
    }
    assert.deepEqual(ends, [7.3, 7.3]);
  });

  it("an aura replaced between runs is timed from its field, not carried", () => {
    const { simulation, rogue } = createFight(4, undefined, {
      duration: 10,
      engine: EVENTS,
    });
    const definition = simulation.auraDefinitions.get("blade-flurry");
    rogue.castRotation = (sim) => {
      if (sim.currentTime === 0) {
        sim.applyAura(definition, { duration: 7.3 });
      }
      return { casts: [] };
    };
    const ends = [];
    simulation.on("aura", (event) => {
      if (event.change === "expire") {
        ends.push(event.time);
      }
    });
    runOnCore(simulation, 0.371);
    // The same time left, on a new aura object.
    simulation.activeBuffs["blade-flurry"] = {
      ...simulation.activeBuffs["blade-flurry"],
    };
    runOnCore(simulation, 10 - simulation.currentTime);
    assert.deepEqual(ends, [0.371 + (7.3 - 0.371)]);
  });

  it("through createFight with the engine option and the runner's frames", () => {
    const fight = { seed: 30, duration: 120, config: HEMO.config };
    const expected = runFight({ ...fight, engine: EVENTS });
    const pieces = createFight(30, structuredClone(HEMO.config), {
      duration: 120,
      engine: EVENTS,
    });
    pieces.simulation.run(85.5022);
    pieces.simulation.run(120 - 85.5022);
    pieces.simulation.end();
    assert.deepEqual(fightResult(pieces), expected);
    const runner = new SimRunner({ ...fight, engine: EVENTS });
    runner.run();
    runner.advance(85.5022);
    runner.advance(Infinity);
    assert.deepEqual(runner.result, expected);
  });

  it("takes the carry once, and only at the time it was left", () => {
    const { simulation } = createFight(5, undefined, {
      duration: 30,
      engine: EVENTS,
    });
    runOnCore(simulation, 4);
    assert.equal(simulation.coreCarry.time, 4);
    // A legacy step in between moves the fight on: the next run starts
    // afresh from the fields, as #197 did.
    simulation.step(0.25);
    const { mainHand } = simulation.rogue.weapons;
    const left = mainHand.swingTimer;
    const swings = [];
    const run = openCore(simulation, 10, {
      afterEvent: (event) => {
        if (event.kind === SWING_KIND && event.payload.hand === "mainHand") {
          swings.push(event.time);
        }
      },
    });
    assert.equal(simulation.coreCarry, null);
    run.runUntil(10);
    run.close();
    assert.equal(swings[0], 4.25 + Math.max(0, left));
  });

  it("uses a field changed between runs in place of the clock it carried", () => {
    const { simulation } = createFight(6, undefined, {
      duration: 30,
      engine: EVENTS,
    });
    runOnCore(simulation, 3.1);
    const { mainHand } = simulation.rogue.weapons;
    mainHand.swingTimer = 0.5;
    simulation.gcd = 0.75;
    const swings = [];
    const run = openCore(simulation, 5, {
      afterEvent: (event) => {
        if (event.kind === SWING_KIND && event.payload.hand === "mainHand") {
          swings.push(event.time);
        }
      },
    });
    run.runUntil(3.1 + 0.6);
    // The GCD written at 3.1 counts down from what was written.
    assert.ok(Math.abs(simulation.gcd - 0.15) < 1e-9, String(simulation.gcd));
    run.runUntil(8.1);
    run.close();
    assert.equal(swings[0], 3.1 + 0.5);
  });
});

describe("what the carry leaves to the fields (#198)", () => {
  // The legacy energy value after a run that opens at the fight's time and
  // closes there: what the pool started from.
  function energyAtOpen(simulation) {
    const run = openCore(simulation, 1);
    run.runUntil(simulation.currentTime);
    run.close();
    return simulation.rogue.resources.energy.value;
  }

  it("energy set between runs is read from the field", () => {
    const { simulation } = createFight(6, undefined, {
      duration: 30,
      engine: EVENTS,
    });
    runOnCore(simulation, 3.1);
    simulation.rogue.resources.energy.value = 10;
    assert.equal(energyAtOpen(simulation), 10);
  });

  it("a regen rate changed between runs does not reach back over the carried line", () => {
    const { simulation } = createFight(6, undefined, {
      duration: 30,
      engine: EVENTS,
    });
    runOnCore(simulation, 3.1);
    const left = simulation.rogue.resources.energy.value;
    assert.ok(left < k("energy.max"));
    // Adrenaline Rush is up from the opener; taking it off halves the rate
    // the carried line (from its last re-base, before the cut) was drawn at.
    const { modifiers } = simulation.rogue.resources.energy;
    const rate = modifiers.resolve("energyRegen", 10);
    assert.ok(simulation.hasAura("adrenaline-rush"));
    delete simulation.activeBuffs["adrenaline-rush"];
    assert.equal(modifiers.resolve("energyRegen", 10), rate / 2);
    assert.equal(energyAtOpen(simulation), left);
  });

  it("a DoT's tick time set between runs is read from the field", () => {
    const { simulation } = createFight(30, structuredClone(HEMO.config), {
      duration: 120,
      engine: EVENTS,
    });
    runOnCore(simulation, 10);
    const dot = simulation.activeDots.rupture;
    assert.ok(dot !== undefined && dot.timeUntilNextTick > 0.5);
    dot.timeUntilNextTick = 0.3;
    const ticks = [];
    const run = openCore(simulation, 2, {
      afterEvent: (event) => {
        if (event.kind === DOT_TICK_KIND) {
          ticks.push(event.time);
        }
      },
    });
    run.runUntil(12);
    run.close();
    assert.equal(ticks[0], 10.3);
  });

  it("the check poll goes on with its grid, and a step in between drops it", () => {
    const pollEvery = k("sim.fixedStep");
    const asks = (cuts) => {
      const { simulation, rogue } = createFight(2, undefined, {
        duration: 10,
        engine: EVENTS,
      });
      const castRotation = rogue.castRotation.bind(rogue);
      const times = new Set();
      rogue.castRotation = (sim) => {
        times.add(sim.currentTime);
        return castRotation(sim);
      };
      for (const cut of [...cuts, 10]) {
        runOnCore(simulation, cut - simulation.currentTime, { pollEvery });
      }
      return { times, simulation };
    };
    const whole = asks([]).times;
    const split = asks([4.01]).times;
    split.delete(4.01);
    assert.deepEqual(
      [...split].filter((time) => !whole.has(time)),
      [],
    );
    const { simulation } = createFight(2, undefined, {
      duration: 10,
      engine: EVENTS,
    });
    runOnCore(simulation, 4.01, { pollEvery });
    simulation.step(0.25);
    assert.doesNotThrow(() => runOnCore(simulation, 1, { pollEvery }));
  });
});

describe("the clocks the core carries (#198)", () => {
  it("Scheduler starts at startTime, from 0 to the end time", () => {
    const handle = () => {};
    assert.equal(new Scheduler({ endTime: 10, handle }).now, 0);
    const late = new Scheduler({ endTime: 10, handle, startTime: 4.5 });
    assert.equal(late.now, 4.5);
    assert.throws(() => late.schedule({ time: 4, kind: "x", order: 0 }));
    assert.equal(new Scheduler({ endTime: 10, handle, startTime: 10 }).now, 10);
    for (const startTime of [-1, 10.5, Number.NaN, "1"]) {
      assert.throws(
        () => new Scheduler({ endTime: 10, handle, startTime }),
        /startTime/,
      );
    }
  });

  // One scheduler from 0 to `end`, or one to `cut` and a second from `cut`
  // that `carry` hands what the first left; `make(scheduler, log)` sets the
  // run up and `carry(before, after)` moves it over.
  function splitRun({ end, cut, make, carry }) {
    const run = (startTime, endTime, log) => {
      let made = null;
      const scheduler = new Scheduler({
        startTime,
        endTime,
        handle: (event) => made.handle(event, log),
      });
      made = make(scheduler);
      return { scheduler, made };
    };
    const one = [];
    const whole = run(0, end, one);
    whole.made.start();
    whole.scheduler.runToEnd();
    const split = [];
    const first = run(0, end, split);
    first.made.start();
    first.scheduler.runUntil(cut);
    const second = run(cut, end, split);
    carry(first.made, second.made);
    second.scheduler.runToEnd();
    return { one, split };
  }

  it("SwingTimer state() and resume() go on with the same grid", () => {
    const haste = { resolve: (kind, base) => base * 1.15 };
    const make = (scheduler) => {
      const timer = new SwingTimer({
        weapon: { speed: 2.6, hand: "main" },
        modifiers: haste,
        scheduler,
      });
      return {
        timer,
        start: () => timer.start(0.3),
        handle(event, log) {
          log.push(event.time);
          timer.swung();
        },
      };
    };
    const { one, split } = splitRun({
      end: 40,
      cut: 11.7,
      make,
      carry: (a, b) => b.timer.resume(a.timer.state),
    });
    assert.ok(one.length > 10);
    assert.deepEqual(split, one);
    const timer = make(new Scheduler({ endTime: 5, handle() {} })).timer;
    assert.equal(timer.state, null);
    timer.start(0);
    assert.throws(() => timer.resume(timer.state), /already swinging/);
  });

  it("DotTicks state() and resume() go on with the same clock", () => {
    const make = (scheduler) => {
      const dots = new DotTicks({ scheduler });
      return {
        dots,
        start: () =>
          dots.apply("poison", {
            interval: 3,
            duration: 12,
            refresh: DOT_REFRESH.keepClock,
          }),
        handle(event, log) {
          assert.equal(event.kind, DOT_TICK_KIND);
          const info = dots.ticked(event);
          log.push([event.time, info.tick, info.last]);
          if (event.time === 6) {
            dots.apply("poison", {
              interval: 3,
              duration: 12,
              refresh: DOT_REFRESH.keepClock,
            });
          }
        },
      };
    };
    const { one, split } = splitRun({
      end: 40,
      cut: 4.5,
      make,
      carry: (a, b) => b.dots.resume("poison", a.dots.state("poison")),
    });
    assert.deepEqual(one.at(-1), [18, 6, true]);
    assert.deepEqual(split, one);
    const dots = new DotTicks({
      scheduler: new Scheduler({ endTime: 5, handle() {} }),
    });
    assert.equal(dots.state("poison"), null);
    // resume() over a running DoT replaces its pending tick (3), and the
    // clock goes on from its anchor.
    const log = [];
    const scheduler = new Scheduler({
      endTime: 10,
      handle(event) {
        log.push([event.time, again.ticked(event).tick]);
      },
    });
    const again = new DotTicks({ scheduler });
    again.apply("poison", { interval: 3, duration: 9 });
    const state = again.state("poison");
    again.resume("poison", { ...state, next: 2 });
    scheduler.runToEnd();
    assert.deepEqual(
      log.map(([time]) => time),
      [2, 6, 9],
    );
  });

  const ENERGY = RESOURCE_DEFINITIONS.find(({ id }) => id === "energy");
  const RATE = k("energy.regenPerSecond");
  const CAP = k("energy.max");
  const flat = { resolve: (kind, base) => base };
  const pool = (startTime, options) =>
    new EnergyPool({
      definition: ENERGY,
      modifiers: flat,
      scheduler: new Scheduler({ endTime: 60, handle() {}, startTime }),
      ...options,
    });

  it("EnergyPool goes on with a carried line, and counts waste from now", () => {
    const carried = pool(3, { line: { value0: 20, t0: 1 } });
    assert.equal(carried.value, 20 + 2 * RATE);
    assert.deepEqual(carried.line.t0, 1);
    const full = pool(3, { line: { value0: CAP, t0: 1 } });
    assert.equal(full.value, CAP);
    assert.deepEqual(full.waste(), { cappedTime: 0, overflow: 0 });
    // Reaching the cap before now counts from now too.
    assert.deepEqual(pool(30, { line: { value0: 0, t0: 0 } }).waste(), {
      cappedTime: 0,
      overflow: 0,
    });
    // A cap lower than the carried value holds the line itself down.
    const held = pool(3, { line: { value0: CAP, t0: 1 }, baseMax: 50 });
    assert.equal(held.value, 50);
    assert.equal(held.line.value0, 50);
    assert.throws(() => pool(3, { line: { value0: 20, t0: 3.5 } }), /t0/);
    assert.throws(() => pool(3, { line: { value0: 20 } }), /t0/);
    assert.throws(() => pool(3, { line: { value0: -1, t0: 1 } }));
  });
});

describe("M2: what #197's mutants E2, F3, E6, E7 and F33 broke (#198)", () => {
  it("E2: engine 'events' runs the fight on the core, not on legacy steps", () => {
    const make = (engine) =>
      createFight(9, undefined, { duration: 30, engine });
    const events = make(EVENTS);
    events.simulation.run(30);
    const byHand = make(ENGINES.legacy);
    runOnCore(byHand.simulation, 30);
    byHand.simulation.end();
    const legacy = make(ENGINES.legacy);
    legacy.simulation.run(30);
    assert.deepEqual(fightResult(events), fightResult(byHand));
    assert.notDeepEqual(fightResult(events), fightResult(legacy));
  });

  it("F3: a rotation whose casts change nothing is asked rules + 1 times at a time", () => {
    const { simulation, rogue } = createFight(1, undefined, {
      duration: 5,
      engine: EVENTS,
    });
    const rules = rogue.rotationProgram.rules.length;
    assert.ok(rules > 0);
    const asked = new Map();
    rogue.castRotation = (sim) => {
      asked.set(sim.currentTime, (asked.get(sim.currentTime) ?? 0) + 1);
      return { casts: ["nothing"], outcome: "cast" };
    };
    runOnCore(simulation, 5);
    assert.equal(asked.get(0), rules + 1);
    assert.ok(asked.size > 1);
    assert.ok(Math.max(...asked.values()) <= rules + 2);
  });

  // A proc DoT (keep its clock) and Rupture (restart) applied at 0, run to
  // 4.5 on the core, and applied again there, with every tick logged.
  function refreshedAt(seed) {
    const { simulation } = createFight(seed, undefined, {
      duration: 30,
      engine: EVENTS,
    });
    const ticks = { proc: [], rupture: [] };
    const run = openCore(simulation, 30, {
      afterEvent: (event) => {
        if (event.kind === DOT_TICK_KIND) {
          const id = event.payload.id === "rupture" ? "rupture" : "proc";
          ticks[id].push(event.time);
        }
      },
    });
    const both = () => {
      simulation.resolveProcDot({
        id: "testPoison",
        name: "Test Poison",
        tickDamage: 10,
        interval: 3,
        duration: 12,
      });
      const before = simulation.activeDots.rupture;
      simulation.resolveDotAttack(RUPTURE, "skill", 600, 8, true);
      return simulation.activeDots.rupture !== before;
    };
    const landed = [both()];
    run.runUntil(4.5);
    landed.push(both());
    run.runUntil(10);
    run.close();
    return { landed, ticks };
  }
  const RUPTURE = { id: "rupture", name: "Rupture" };

  it("E6: a proc DoT applied again keeps its clock", () => {
    const { ticks } = refreshedAt(4);
    assert.deepEqual(ticks.proc, [3, 6, 9]);
  });

  it("E7: a cast DoT applied again restarts its clock", () => {
    const { landed, ticks } = refreshedAt(4);
    assert.deepEqual(landed, [true, true]);
    assert.deepEqual(ticks.rupture, [2, 4, 6.5, 8.5]);
  });

  it("F33: an aura refreshed on the core runs from the refresh", () => {
    const { simulation, rogue } = createFight(4, undefined, {
      duration: 30,
      engine: EVENTS,
    });
    const definition = simulation.auraDefinitions.get("blade-flurry");
    let refreshed = null;
    rogue.castRotation = (sim) => {
      if (
        sim.currentTime === 0 &&
        sim.activeBuffs["blade-flurry"] === undefined
      ) {
        sim.applyAura(definition, { duration: 5 });
      } else if (refreshed === null && sim.currentTime >= 2) {
        refreshed = sim.currentTime;
        sim.applyAura(definition, { duration: 5 });
      }
      return { casts: [] };
    };
    const changes = [];
    simulation.on("aura", (event) => changes.push([event.time, event.change]));
    runOnCore(simulation, 30);
    assert.ok(refreshed > 2 && refreshed < 5);
    assert.deepEqual(changes, [
      [0, "apply"],
      [refreshed, "refresh"],
      [refreshed + 5, "expire"],
    ]);
  });
});
