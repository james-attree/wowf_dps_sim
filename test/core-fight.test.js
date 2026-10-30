import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { runOnCore } from "../js/core/fight.js";
import { createFight, runFight } from "../js/fight.js";
import { SimRunner } from "../js/sim-runner.js";
import { Rogue } from "../js/rogue.js";
import { importRotation } from "../js/rotation-io.js";
import { loadPreset } from "../js/rotation-presets.js";
import { Simulation } from "../js/simulation.js";
import { GOLDEN_CASES } from "../scripts/golden-update.mjs";
import { runScriptedFight } from "../scripts/scripted-fight.mjs";
import { setRoll, testRng } from "./rolls.js";
import { referenceBuild } from "./talentsforever.js";
import { POLL_STEP } from "./poll-step.js";

// Issue #197 (E6): a whole fight on the Phase 3.5 event core
// (js/core/fight.js), with the rotation run at decision points only.

const POISONS = { mainHand: "instant", offHand: "deadly" };
// A rotation as a user would import it, with a condition of each kind that
// moves between events (fightTime, auraRemaining, debuffRemaining,
// fightTimeRemaining, energyToCap, resource) and Cold Blood behind its
// talent.
const IMPORTED = importRotation(
  JSON.stringify({
    schemaVersion: 1,
    name: "Imported",
    rules: [
      {
        action: "adrenaline-rush",
        conditions: [
          { type: "abilityUnlocked", ability: "adrenaline-rush" },
          { type: "cooldownReady", ability: "adrenaline-rush" },
          { type: "fightTime", op: ">=", value: 7.3 },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          { type: "comboPoints", op: ">=", value: 2 },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<=",
            value: 1.7,
          },
        ],
      },
      {
        action: "cold-blood",
        conditions: [
          { type: "abilityGranted", ability: "cold-blood" },
          { type: "comboPoints", op: ">=", value: 5 },
          { type: "debuffRemaining", debuff: "rupture", op: ">", value: 4 },
        ],
      },
      {
        action: "rupture",
        conditions: [
          { type: "comboPoints", op: ">=", value: 5 },
          { type: "debuffRemaining", debuff: "rupture", op: "<=", value: 0.6 },
          { type: "fightTimeRemaining", op: ">", value: 9 },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 5 },
          { type: "energyToCap", op: "<=", value: 1.25 },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 5 },
          { type: "fightTimeRemaining", op: "<", value: 6 },
        ],
      },
      {
        action: "sinister-strike",
        conditions: [
          { type: "comboPoints", op: "<", value: 5 },
          { type: "resource", resource: "energy", op: ">=", value: 52.5 },
        ],
      },
    ],
  }),
);
assert.ok(IMPORTED.ok, JSON.stringify(IMPORTED.errors));

const CONFIGS = {
  default: undefined,
  preset: loadPreset("combat-swords", { talents: referenceBuild() }),
  talented: { talents: referenceBuild() },
  poisons: { talents: referenceBuild(), poisons: POISONS },
  imported: {
    talents: referenceBuild(),
    poisons: POISONS,
    rotation: IMPORTED.rotation,
  },
  "imported, no talents": { rotation: IMPORTED.rotation },
};

// A fight on the core, run in one call, with every cast and its time.
function coreFight(seed, config, duration, options = {}) {
  const fight = createFight(seed, config, { duration });
  const { simulation: sim, rogue } = fight;
  const casts = [];
  const castRotation = rogue.castRotation.bind(rogue);
  rogue.castRotation = (simulation) => {
    const result = castRotation(simulation);
    for (const id of result.casts) {
      casts.push([sim.currentTime, id]);
    }
    return result;
  };
  const stats = runOnCore(sim, duration, options);
  return { sim, rogue, casts, stats };
}

describe("the event core: a whole fight at decision points (#197)", () => {
  // The brute-force check: the same fight with a look at the rotation every
  // 1/64 s on top casts the same abilities in the same order, at the same
  // times but for rounding. A decision point the core missed would show as a
  // cast the poll makes first, or a cast at a later time.
  it("casts what polling the rotation every 1/64 s casts, for the default, a preset, talents, poisons and an imported rotation", () => {
    const step = POLL_STEP;
    for (const [name, config] of Object.entries(CONFIGS)) {
      const tally = new Map();
      for (const seed of [1, 2, 3]) {
        const events = coreFight(seed, config, 90);
        const polled = coreFight(seed, config, 90, { pollEvery: step });
        const label = `${name}, seed ${seed}`;
        assert.ok(polled.stats.polls > 90 / step - 2, label);
        // A poll never finds a cast the decision points left, but for
        // rounding: a poll may get to a cast an ulp before the decision
        // point that makes it (#197 QA), so it counts only when the
        // decision points cast nothing of it within 1e-9 s.
        const missed = polled.stats.pollCasts.filter(
          ({ time, casts }) =>
            !casts.every((id) =>
              events.casts.some(
                ([at, cast]) => cast === id && Math.abs(at - time) <= 1e-9,
              ),
            ),
        );
        assert.deepEqual(missed, [], label);
        assert.deepEqual(
          polled.casts.map(([, id]) => id),
          events.casts.map(([, id]) => id),
          label,
        );
        events.casts.forEach(([time], index) => {
          assert.ok(
            Math.abs(time - polled.casts[index][0]) < 1e-9,
            `${label}: cast ${index} at ${time} and ${polled.casts[index][0]}`,
          );
        });
        for (const [, id] of events.casts) {
          tally.set(id, (tally.get(id) ?? 0) + 1);
        }
      }
      assert.ok(tally.get("sinister-strike") > 0, name);
      assert.ok(tally.get("slice-and-dice") > 0, name);
    }
  });

  it("evaluates the rotation only at events, far fewer times than the steps", () => {
    for (const [name, config] of Object.entries(CONFIGS)) {
      const duration = 120;
      const { stats } = coreFight(4, config, duration);
      const others = stats.events - stats.decisions;
      assert.equal(stats.polls, 0, name);
      // It does evaluate, and some of those wake-ups wait on energy alone.
      assert.ok(stats.decisions >= stats.casts && stats.casts > 0, name);
      assert.ok(stats.energyWakes > 0 && stats.energyWakes < others, name);
      // Every evaluation is an event of its own (a decision point)...
      assert.ok(stats.decisions <= stats.events, name);
      // ...set by another event at its time, by a cast at the same time (an
      // off-GCD follow-up), by a condition crossing, or by the start.
      assert.ok(
        stats.decisions <= others + stats.casts + stats.conditionWakes + 1,
        `${name}: ${JSON.stringify(stats)}`,
      );
      assert.ok(
        stats.decisions < (duration / POLL_STEP) * 0.1,
        `${name}: ${stats.decisions} decisions`,
      );
    }
  });

  it("casts Cold Blood with the talent, and never without it", () => {
    const count = (config) =>
      [1, 2, 3, 4, 5, 6]
        .map(
          (seed) =>
            coreFight(seed, config, 180).casts.filter(
              ([, id]) => id === "cold-blood",
            ).length,
        )
        .reduce((a, b) => a + b, 0);
    assert.ok(count(CONFIGS.talented) > 0);
    assert.equal(count(CONFIGS.default), 0);
    assert.equal(count(CONFIGS["imported, no talents"]), 0);
  });

  // The pool's host contract (js/core/energy.js): the host calls
  // modifiersChanged() after anything that may move the regen or the cap. The
  // core does after every event, so the line's rate and cap always equal a
  // fresh read, through Adrenaline Rush starting and running out.
  it("keeps the energy line's rate and cap equal to a fresh read after every event", () => {
    let checked = 0;
    let fast = 0;
    const { casts } = coreFight(2, CONFIGS.talented, 120, {
      afterEvent: (event, fight) => {
        const pool = fight.energy;
        const rate = pool.modifiers.resolve(
          pool.definition.regen.modifier,
          pool.baseRate,
        );
        const cap = pool.modifiers.resolve(
          "resourceMax",
          pool.baseMax,
          pool.maxContext,
        );
        assert.equal(pool.rate, rate, `${event.kind} at ${event.time}`);
        assert.equal(pool.max, cap, `${event.kind} at ${event.time}`);
        checked += 1;
        if (rate > pool.baseRate) {
          fast += 1;
        }
      },
    });
    assert.ok(casts.some(([, id]) => id === "adrenaline-rush"));
    assert.ok(fast > 0 && fast < checked, `${fast} of ${checked}`);
  });

  it("gives the legacy pool back after the run, with the value and the waste", () => {
    const { simulation: sim, rogue } = createFight(3, undefined, {
      duration: 60,
    });
    const legacy = rogue.resources.energy;
    // Nothing casts, so the pool sits at the cap.
    rogue.castRotation = () => ({ casts: [], outcome: "none" });
    runOnCore(sim, 60);
    assert.equal(rogue.resources.energy, legacy);
    assert.equal(legacy.value, legacy.max);
    assert.ok(legacy.cappedTime > 0 && legacy.cappedTime <= 60);
    assert.ok(
      Math.abs(
        legacy.overflow -
          legacy.cappedTime * k(legacy.definition.regen.perSecond),
      ) < 1e-9,
      `${legacy.overflow} over ${legacy.cappedTime} s`,
    );
  });

  it("carries a fight across two runs: a DoT ticks on its clock, and the swings go on", () => {
    const { simulation: sim, rogue } = createFight(5, undefined, {
      duration: 30,
    });
    rogue.castRotation = () => ({ casts: [], outcome: "none" });
    const ticks = [];
    const swings = [];
    sim.on("hit", (event) => {
      if (event.origin === "dot" && event.name === "Rupture") {
        ticks.push(event.time);
      } else if (event.origin === "white" && event.name === "Main-hand") {
        swings.push(event.time);
      }
    });
    runOnCore(sim, 1);
    rogue.resources.comboPoints.gain(k("combo.max"));
    sim.gcd = 0;
    rogue.abilities.rupture.cast(rogue, sim);
    assert.ok(sim.activeDots.rupture !== undefined);
    // Split between two ticks, and once more on a tick's own time.
    const interval = k("rupture.tickInterval");
    runOnCore(sim, interval * 1.5);
    runOnCore(sim, interval * 0.5);
    runOnCore(sim, 20);
    assert.ok(ticks.length >= 3, JSON.stringify(ticks));
    ticks.forEach((time, index) => {
      assert.ok(
        Math.abs(time - (1 + interval * (index + 1))) < 1e-9,
        `${JSON.stringify(ticks)}`,
      );
    });
    // The main hand keeps its speed across every split.
    const speed = rogue.weapons.mainHand.speed;
    for (let i = 1; i < swings.length; i += 1) {
      assert.ok(
        Math.abs(swings[i] - swings[i - 1] - speed) < 1e-9,
        JSON.stringify(swings),
      );
    }
  });

  it("wakes on a condition crossing in the second of two runs", () => {
    const rotation = importRotation(
      JSON.stringify({
        schemaVersion: 1,
        name: "Late",
        rules: [
          {
            action: "sinister-strike",
            conditions: [{ type: "fightTime", op: ">=", value: 12.3 }],
          },
        ],
      }),
    );
    assert.ok(rotation.ok, JSON.stringify(rotation.errors));
    const { simulation: sim, rogue } = createFight(
      1,
      { rotation: rotation.rotation },
      { duration: 30 },
    );
    // No swings: the only thing that can set off the cast is the wake.
    for (const weapon of Object.values(rogue.weapons)) {
      if (weapon) {
        weapon.swingTimer = 1e9;
      }
    }
    const casts = [];
    const castRotation = rogue.castRotation.bind(rogue);
    rogue.castRotation = (simulation) => {
      const result = castRotation(simulation);
      for (const id of result.casts) {
        casts.push([sim.currentTime, id]);
      }
      return result;
    };
    runOnCore(sim, 10);
    assert.deepEqual(casts, []);
    runOnCore(sim, 10);
    assert.ok(casts.length > 0);
    assert.equal(casts[0][1], "sinister-strike");
    assert.ok(Math.abs(casts[0][0] - 12.3) < 1e-6, JSON.stringify(casts));
  });

  it("is the only engine: no engine option or switch is left (#234)", () => {
    assert.equal(Simulation.useEngine, undefined);
    assert.equal(new Simulation(new Rogue()).engine, undefined);
    assert.throws(
      () => runFight({ seed: 1, duration: 1, engine: "legacy" }),
      /no option "engine"/,
    );
    assert.throws(
      () => new SimRunner({ seed: 1, duration: 1, engine: "legacy" }),
      /no option "engine"/,
    );
  });

  it("runs the scripted golden cases to Rupture ticks and a tick crit", () => {
    const scripted = GOLDEN_CASES.filter((goldenCase) => goldenCase.script);
    // #85's case and #234's.
    assert.equal(scripted.length, 2);
    for (const goldenCase of scripted) {
      const result = runScriptedFight(goldenCase);
      const rupture = result.abilities.Rupture;
      assert.ok(rupture.ticks > 0, JSON.stringify(rupture));
      assert.ok(rupture.tickCrits > 0, JSON.stringify(rupture));
    }
  });
});

// The three places the core and legacy differ (docs/mechanics.md, the #196
// edges), pinned on the core as it runs a whole fight.
describe("the event core at the #196 edges", () => {
  function quietFight({ swings = false } = {}) {
    const rogue = new Rogue();
    rogue.bonusHitChance = 1;
    rogue.critChance = 0;
    rogue.castRotation = () => ({ casts: [], outcome: "none" });
    if (!swings) {
      rogue.weapons.mainHand.swingTimer = 1e9;
      rogue.weapons.offHand.swingTimer = 1e9;
    }
    setRoll(0.99);
    const sim = new Simulation(rogue, { rng: testRng });
    const hits = [];
    sim.on("hit", (event) => hits.push(event));
    return { rogue, sim, hits };
  }

  const RUPTURE = { id: "rupture", name: "Rupture", icon: null };
  const OTHER = {
    id: "qa-dot",
    name: "QA Dot",
    tickDamage: 10,
    interval: 2,
    duration: 6,
  };

  // (d) Two DoTs that tick at the same time tick in the order they were put
  // on (the scheduler's seq), and that order changes no total.
  it("ticks two DoTs due at the same time in the order they were applied", () => {
    const run = (ruptureFirst) => {
      const { sim, hits } = quietFight();
      const apply = [
        () => sim.resolveDotAttack(RUPTURE, "skill", 300, 6, true),
        () => sim.resolveProcDot(OTHER),
      ];
      for (const put of ruptureFirst ? apply : apply.reverse()) {
        put();
      }
      runOnCore(sim, 7);
      return { hits: hits.filter((e) => e.origin === "dot"), sim };
    };
    const first = run(true);
    const second = run(false);
    const order = (hits) => hits.map((e) => `${e.time} ${e.name}`);
    assert.deepEqual(order(first.hits), [
      "2 Rupture",
      "2 QA Dot",
      "4 Rupture",
      "4 QA Dot",
      "6 Rupture",
      "6 QA Dot",
    ]);
    assert.deepEqual(order(second.hits), [
      "2 QA Dot",
      "2 Rupture",
      "4 QA Dot",
      "4 Rupture",
      "6 QA Dot",
      "6 Rupture",
    ]);
    assert.equal(first.sim.damageDone, second.sim.damageDone);
  });

  // Main and off hand at the same speed swing at the same times; the core
  // runs them in seq order, which is main hand first from the start, as on
  // legacy (which always swings the main hand first).
  it("swings the main hand first when both hands are due at the same time", () => {
    const { rogue, sim, hits } = quietFight({ swings: true });
    rogue.weapons.offHand.speed = rogue.weapons.mainHand.speed;
    rogue.weapons.offHand.swingTimer = 0;
    runOnCore(sim, 12);
    const white = hits.filter((e) => e.origin === "white");
    assert.ok(white.length >= 8);
    for (let i = 0; i < white.length; i += 2) {
      assert.equal(white[i].name, "Main-hand", `${i}`);
      assert.equal(white[i + 1].name, "Off-hand", `${i}`);
      assert.equal(white[i].time, white[i + 1].time);
    }
  });

  // (a) The core's first main-hand swing is at 0 and every later one at
  // exactly n x speed (the removed fixed-step engine rounded each swing up to
  // a 1/64 s step: 2.6 s came at 2.609375).
  it("swings at exact multiples of the speed, on no step grid", () => {
    const { rogue, sim, hits } = quietFight({ swings: true });
    const speed = rogue.weapons.mainHand.speed;
    runOnCore(sim, speed * 3.5);
    const main = hits.filter((e) => e.name === "Main-hand").map((e) => e.time);
    assert.equal(main.length, 4);
    main.forEach((time, n) => {
      assert.ok(Math.abs(time - n * speed) < 1e-9, JSON.stringify(main));
    });
  });
});
