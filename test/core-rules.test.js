import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { AURAS, defineAura } from "../js/auras.js";
import { runOnCore } from "../js/core/fight.js";
import { defineProc } from "../js/procs.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

// The rules the legacy step-based tests pin, run on the event core
// (js/core/fight.js, #197): the DoT ticks, Deadly Poison's clock, the charges a
// tick leaves alone, the armor a bleed skips, an onDotTick proc and the pool
// clamp. The originals (poison-procs, bleed-armor, target-debuffs and procs
// tests) step the fight with Simulation.step, which is always legacy; these
// move it with runOnCore instead. Each harness is quiet: no rotation and no
// auto attack, so the only events are the ones a test sets up.

const HIT = 0.99; // a plain landed swing (no crit, full bonus hit)
const NO_CRIT = 0.99; // a tick's crit roll at a crit chance of 0
const TICK_DAMAGE = 100;
const QUIET = 1e9;

function scripted(values) {
  let at = 0;
  const rng = () => {
    if (at >= values.length) {
      throw new Error(`draw ${at + 1} was not scripted`);
    }
    return values[at++];
  };
  return { rng, left: () => values.length - at };
}

function quiet(rogue) {
  rogue.castRotation = () => ({ casts: [], outcome: "none" });
  for (const weapon of Object.values(rogue.weapons)) {
    if (weapon) {
      weapon.swingTimer = QUIET;
    }
  }
}

// The poison and proc tests' harness: every swing lands, nothing crits, and
// `rolls` script the rng (a seed without them).
function harness({ poisons, rolls, seed = 1, procs, config } = {}) {
  const rogue = new Rogue({ ...config, poisons }, { procs });
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  quiet(rogue);
  const tape = rolls === undefined ? null : scripted(rolls);
  const sim = new Simulation(rogue, {
    ...(tape ? { rng: tape.rng } : { seed }),
    engine: "events",
  });
  return { rogue, sim, tape, step: (seconds) => runOnCore(sim, seconds) };
}

// The target-debuff tests' harness: testRng, and no crit.
function fresh() {
  const rogue = new Rogue();
  rogue.critChance = 0;
  quiet(rogue);
  const sim = new Simulation(rogue, { rng: testRng, engine: "events" });
  return { rogue, sim, step: (seconds) => runOnCore(sim, seconds) };
}

function swing(sim, hand = "mainHand") {
  const weapon = sim.rogue.weapons[hand];
  return sim.resolveAttack(weapon.attack, "weapon", 100);
}

function plainDot(extra = {}) {
  const interval = k("rupture.tickInterval");
  return {
    name: "Rupture",
    duration: interval,
    tickInterval: interval,
    timeUntilNextTick: interval,
    tickDamage: TICK_DAMAGE,
    icon: null,
    ...extra,
  };
}

const BOTH = { mainHand: "instant", offHand: "instant" };
const DEADLY_MAIN = { mainHand: "deadly", offHand: null };

describe("poisons on the event core (poison-procs.test.js)", () => {
  const rolls = (sim, hand) => sim.procs.stats[`instant-poison.${hand}`].rolls;

  it("DoT ticks and poison damage roll no poison", () => {
    const { rogue, sim, step } = harness({ poisons: BOTH, seed: 5 });
    rogue.resources.comboPoints.gain(5);
    rogue.abilities.rupture.cast(rogue, sim);
    step(20);
    assert.ok(sim.abilityStats.rupture.ticks > 0);
    assert.equal(rolls(sim, "mainHand"), 0);
    assert.equal(rolls(sim, "offHand"), 0);
  });

  it("applies Deadly Poison on a proc, then ticks 3 s apart, 4 times", () => {
    const { sim, step } = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, NO_CRIT, NO_CRIT, NO_CRIT, NO_CRIT],
    });
    swing(sim);
    const times = [];
    sim.on("hit", (event) => {
      if (event.origin === "dot") {
        times.push(event.time);
      }
    });
    step(14);
    assert.deepEqual(times, [3, 6, 9, 12]);
    const record = sim.abilityStats["deadly-poison"];
    assert.equal(record.ticks, 4);
    assert.equal(record.damage, 92, "one stack deals the export's 92");
    assert.equal(sim.activeDots["deadly-poison"], undefined);
    assert.equal(sim.activeDebuffs["deadly-poison"], undefined);
  });

  it("refreshes Deadly Poison's duration and keeps its tick clock", () => {
    const { sim, step } = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, HIT, 0.1, 0.5, NO_CRIT, NO_CRIT],
    });
    swing(sim);
    step(1);
    assert.equal(sim.activeDots["deadly-poison"].duration, 11);
    swing(sim);
    const dot = sim.activeDots["deadly-poison"];
    assert.equal(dot.duration, 12);
    assert.equal(sim.activeDebuffs["deadly-poison"].duration, 12);
    assert.equal(dot.timeUntilNextTick, 2, "the next tick is still at 3 s");
    assert.equal(dot.tickDamage, 46);
    step(2);
    assert.equal(sim.abilityStats["deadly-poison"].ticks, 1);
    assert.equal(sim.abilityStats["deadly-poison"].damage, 46);
    step(3);
    assert.equal(sim.abilityStats["deadly-poison"].ticks, 2);
    assert.equal(sim.activeDots["deadly-poison"].duration, 7);
  });

  it("ticks Deadly Poison through armor, and at a tick crit of 2x", () => {
    const hit = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, NO_CRIT],
    });
    swing(hit.sim);
    hit.step(3);
    assert.equal(hit.sim.abilityStats["deadly-poison"].damage, 23);
    const crit = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, 0],
    });
    crit.rogue.critChance = 0.5;
    swing(crit.sim);
    crit.step(3);
    assert.equal(crit.sim.abilityStats["deadly-poison"].damage, 23 * 2);
    assert.equal(crit.sim.abilityStats["deadly-poison"].tickCrits, 1);
  });

  it("crits a Deadly Poison tick only with a poison crit modifier", () => {
    const status = (tag) => {
      const rogue = new Rogue(
        { poisons: DEADLY_MAIN },
        {
          modifiers: [{ kind: "critChance", value: 1, scope: { tags: [tag] } }],
        },
      );
      rogue.bonusHitChance = 1;
      rogue.critChance = 0;
      quiet(rogue);
      const tape = scripted([HIT, 0.1, 0.5, 0.5]);
      const sim = new Simulation(rogue, { rng: tape.rng, engine: "events" });
      swing(sim);
      runOnCore(sim, 3);
      return sim.combatLog[0].status;
    };
    assert.equal(status("poison"), "Crit");
    assert.equal(status("yellow"), "Hit");
    assert.equal(status("white"), "Hit");
    assert.equal(status("bleed"), "Hit");
  });

  it("ticks an applyDot with no aura once, as a physical DoT", () => {
    const own = defineProc({
      id: "test-dot",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [
        {
          type: "applyDot",
          id: "test-dot",
          name: "Test Dot",
          tickDamage: 10,
          interval: 2,
          duration: 2,
        },
      ],
    });
    const { sim, tape, step } = harness({
      procs: [own],
      rolls: [HIT, 0.5, HIT, 0.5, NO_CRIT],
    });
    swing(sim);
    swing(sim);
    step(2);
    assert.equal(tape.left(), 0);
    const damage = sim.abilityStats["test-dot"].damage;
    assert.ok(damage > 0 && damage < 10, `${damage}`);
    assert.equal(sim.activeDots["test-dot"], undefined);
  });
});

describe("DoT ticks and the target on the event core", () => {
  // bleed-armor.test.js
  it("keeps a cast Rupture tick at its pre-armor snapshot", () => {
    setRoll(0.9);
    const { rogue, sim, step } = fresh();
    rogue.comboPoints = k("combo.max");
    rogue.energy = k("energy.max");
    const raw = rogue.abilities.rupture.damage();
    const ticks = Math.floor(
      rogue.abilities.rupture.resolve().duration / k("rupture.tickInterval"),
    );
    sim.gcd = 0;
    assert.equal(rogue.abilities.rupture.cast(rogue, sim).landed, true);
    assert.equal(sim.damageDone, 0);
    const dot = sim.activeDots.rupture;
    assert.equal(dot.tickDamage, Math.floor(raw) / ticks);
    step(k("rupture.tickInterval"));
    assert.equal(sim.damageDone, dot.tickDamage);
  });

  // target-debuffs.test.js: charges
  it("leaves an aura's charges to hits: a DoT tick uses none", () => {
    setRoll(0.5);
    const { sim, step } = fresh();
    sim.applyAura(
      defineAura({
        id: "test-aura",
        name: "Test Aura",
        target: "target",
        duration: 10,
        charges: 3,
        maxStacks: 2,
      }),
    );
    const interval = k("rupture.tickInterval");
    sim.activeDots.rupture = plainDot({ duration: interval * 3 });
    step(interval);
    assert.ok(sim.damageDone > 0);
    assert.equal(sim.activeDebuffs["test-aura"].charges, 3);
  });

  // target-debuffs.test.js: Expose Armor
  it("leaves a bleed tick alone under Expose Armor", () => {
    setRoll(0.5);
    const { sim, step } = fresh();
    sim.applyAura(AURAS.exposeArmor, { stacks: k("combo.max") });
    sim.activeDots.rupture = plainDot({ bleed: true });
    step(k("rupture.tickInterval"));
    assert.equal(sim.damageDone, TICK_DAMAGE);
  });
});

describe("procs and pools on the event core (procs.test.js)", () => {
  it("fires onDotTick per tick, through the core", () => {
    const tick = defineProc({
      id: "tick",
      trigger: "onDotTick",
      scope: { abilities: ["rupture"], tags: ["bleed"] },
      chance: { mode: "flat", value: 0.5 },
      actions: [{ type: "gainResource", resource: "energy", amount: 5 }],
    });
    const hit = defineProc({
      id: "hit",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "gainResource", resource: "comboPoints", amount: 1 }],
    });
    const { rogue, sim, tape, step } = harness({
      procs: [tick, hit],
      // Rupture: the attack roll and no crit draw. Then two ticks: a crit
      // roll and the tick proc each, firing once.
      rolls: [HIT, HIT, 0.1, HIT, 0.9],
    });
    rogue.comboPoints = 1;
    rogue.abilities.rupture.cast(rogue, sim);
    rogue.energy = 0;
    const interval = k("rupture.tickInterval");
    step(interval);
    assert.equal(sim.procs.stats.tick.rolls, 1);
    assert.equal(sim.procs.stats.tick.fires, 1);
    // The proc's energy reached the core's pool, and the pool went on from it.
    const regen = k("energy.regenPerSecond");
    assert.ok(
      Math.abs(rogue.energy - 5 - regen * interval) < 1e-9,
      `${rogue.energy}`,
    );
    step(interval);
    assert.equal(sim.procs.stats.tick.rolls, 2);
    assert.equal(sim.procs.stats.tick.fires, 1);
    assert.ok(
      Math.abs(rogue.energy - 5 - regen * interval * 2) < 1e-9,
      `${rogue.energy}`,
    );
    assert.equal(sim.procs.stats.hit.rolls, 0, "a tick is not a hit");
    assert.equal(tape.left(), 0);
  });

  it("clamps a pool above its cap at the next event, and never raises one", () => {
    const { rogue, sim, step } = harness();
    const points = rogue.resources.comboPoints;
    points.value = k("combo.max") + 3;
    rogue.abilities.adrenalineRush.cast(rogue, sim);
    assert.equal(points.value, k("combo.max") + 3);
    step(0.1);
    assert.equal(points.value, k("combo.max"));
    points.value = 1;
    step(0.1);
    assert.equal(points.value, 1);
  });
});

describe("timers on the event core (#197)", () => {
  it("drops a DoT after its last tick", () => {
    const { sim } = fresh();
    const interval = k("rupture.tickInterval");
    sim.activeDots.rupture = plainDot({ duration: interval * 2 });
    // Gone as soon as the last tick's event is done, not only at the next.
    const left = [];
    runOnCore(sim, interval * 2 + 0.5, {
      afterEvent: () => {
        if (sim.damageDone === TICK_DAMAGE * 2) {
          left.push(sim.activeDots.rupture);
        }
      },
    });
    assert.equal(sim.damageDone, TICK_DAMAGE * 2);
    assert.ok(left.length > 0);
    assert.deepEqual(
      left,
      left.map(() => undefined),
    );
    assert.equal(sim.activeDots.rupture, undefined);
  });

  it("runs an aura's onExpire when it runs out", () => {
    const { sim, step } = fresh();
    const expired = [];
    sim.applyAura(
      defineAura({
        id: "test-aura",
        name: "Test Aura",
        target: "target",
        duration: 4,
        onExpire: (simulation) => expired.push(simulation.currentTime),
      }),
    );
    step(5);
    assert.equal(sim.activeDebuffs["test-aura"], undefined);
    assert.equal(expired.length, 1);
    assert.ok(Math.abs(expired[0] - 4) < 1e-9, String(expired[0]));
  });

  it("holds the rotation for the simulation's GCD length", () => {
    const { rogue, sim, step } = fresh();
    sim.gcdDuration = 1.5;
    const times = [];
    rogue.castRotation = (simulation) => {
      if (simulation.gcd > 0) {
        return { casts: [], outcome: "none" };
      }
      times.push(simulation.currentTime);
      simulation.gcd = simulation.gcdDuration;
      return { casts: ["sinister-strike"], outcome: "cast" };
    };
    step(5);
    assert.equal(times.length, 4, JSON.stringify(times));
    times.forEach((time, index) => {
      assert.ok(Math.abs(time - index * 1.5) < 1e-9, JSON.stringify(times));
    });
  });
});
