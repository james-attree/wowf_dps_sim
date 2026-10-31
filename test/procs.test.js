import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Ability } from "../js/ability.js";
import { createFight } from "../js/fight.js";
import { expandRank } from "../js/modifiers.js";
import { PROC_TABLES } from "../js/proc-data.js";
import {
  ACTION_TYPES,
  CHANCE_MODES,
  PROC_TRIGGERS,
  checkProcs,
  defineProc,
  defineRankedProc,
  procsFromTalents,
} from "../js/procs.js";
import { createResources } from "../js/resource.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { runOnCore } from "../js/core/fight.js";
import { quiet } from "./quiet.js";

// A scripted rng: each draw takes the next value, and a draw past the end
// throws, so a test sees exactly how many draws a path takes.
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

// A rogue and a simulation with no rotation, every swing hitting (roll 0.99 is
// a plain hit for a white swing at no crit and full bonus hit), and the procs
// given. `rolls` script the rng; without them a seed does.
function harness({ procs = [], rolls, config, seed = 1 } = {}) {
  const rogue = new Rogue(config, { procs });
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  quiet(rogue);
  const tape = rolls === undefined ? null : scripted(rolls);
  const sim = new Simulation(rogue, tape ? { rng: tape.rng } : { seed });
  return { rogue, sim, tape };
}

const SWORD = { weapons: { mainHand: { type: "sword" } } };
// Backstab needs a dagger in the main hand.
const DAGGER = { weapons: { mainHand: { type: "dagger" } } };
const HIT = 0.99;

function swing(sim, hand = "mainHand") {
  const weapon = sim.rogue.weapons[hand];
  return sim.resolveAttack(weapon.attack, "weapon", 100);
}

function proc(overrides = {}) {
  return defineProc({
    id: "test-proc",
    trigger: "onHit",
    chance: { mode: "flat", value: 0.5 },
    actions: [{ type: "gainResource", resource: "comboPoints", amount: 1 }],
    ...overrides,
  });
}

afterEach(() => {
  CONSTANTS["hackAndSlash.chain"].value = false;
});

describe("defining a proc", () => {
  it("checks and freezes the data when it loads", () => {
    const defined = proc({ scope: { weaponTypes: ["sword"] }, cooldown: 2 });
    assert.equal(Object.isFrozen(defined), true);
    assert.equal(Object.isFrozen(defined.actions), true);
    assert.equal(Object.isFrozen(defined.chance), true);
    assert.equal(defined.cooldown, 2);
    assert.deepEqual(defined.scope.weaponTypes, ["sword"]);
    assert.equal(defined.extraAttack, false);
    assert.equal(proc().cooldown, 0);
    assert.equal(proc().scope, null);
    assert.deepEqual(PROC_TRIGGERS, [
      "onHit",
      "onCrit",
      "onWhiteHit",
      "onAbility",
      "onDotTick",
    ]);
    assert.deepEqual(CHANCE_MODES, ["flat", "ppm", "perSpent"]);
    assert.deepEqual(ACTION_TYPES, [
      "gainResource",
      "applyAura",
      "dealDamage",
      "applyDot",
      "extraAttack",
    ]);
  });

  it("refuses a typo where the data loads", () => {
    const bad = (overrides, pattern) =>
      assert.throws(() => proc(overrides), {
        name: "RangeError",
        message: pattern,
      });
    bad({ id: "" }, /id must be a non-empty string/);
    bad({ id: "__proto__" }, /other than __proto__/);
    bad({ colour: 1 }, /unknown key "colour"/);
    bad({ trigger: "onSneeze" }, /unknown trigger "onSneeze"/);
    bad({ cooldown: -1 }, /cooldown must be a finite number/);
    bad({ cooldown: Number.NaN }, /cooldown must be a finite number/);
    bad({ actions: [] }, /actions must be a non-empty array/);
    bad({ scope: { abilities: ["no-such"] } }, /unknown ability id/);
    bad({ scope: { tags: ["fire"] } }, /scope\.tags/);
    bad({ scope: { resources: ["energy"] } }, /cannot be scoped by resources/);
    bad({ chance: { mode: "often", value: 0.5 } }, /unknown chance mode/);
    bad({ chance: { mode: "flat", value: 1.5 } }, /0 to 1/);
    bad({ chance: { mode: "flat", value: -0.1 } }, /chance.value/);
    bad({ chance: { mode: "flat", value: 0.5, extra: 1 } }, /unknown key/);
    bad({ chance: 0.5 }, /chance must be an object/);
    bad(
      { chance: { mode: "perSpent", value: 0.1 } },
      /perSpent chance needs the onAbility trigger/,
    );
    bad(
      { trigger: "onDotTick", chance: { mode: "ppm", value: 1 } },
      /ppm chance does not fit/,
    );
    bad(
      { actions: [{ type: "gainResource", resource: "rage", amount: 1 }] },
      /unknown resource id "rage"/,
    );
    bad(
      { actions: [{ type: "gainResource", resource: "energy", amount: -1 }] },
      /amount must be a finite number/,
    );
    bad({ actions: [{ type: "heal" }] }, /unknown action type "heal"/);
    bad(
      { actions: [{ type: "applyAura", aura: "no-such-aura" }] },
      /unknown aura id/,
    );
    bad(
      { actions: [{ type: "applyAura", aura: "slice-and-dice" }] },
      /duration must be above 0/,
    );
    bad(
      {
        actions: [{ type: "applyAura", aura: "blade-flurry", stacks: 0 }],
      },
      /stacks must be a whole number/,
    );
    bad(
      { actions: [{ type: "dealDamage", id: "x-strike", min: 1 }] },
      /needs a name/,
    );
    bad(
      {
        actions: [{ type: "dealDamage", id: "x", name: "X", min: 5, max: 1 }],
      },
      /max must be a finite number, 5 or more/,
    );
    bad({ actions: [{ type: "extraAttack", hand: "off" }] }, /unknown key/);
    assert.throws(() => defineProc(null), RangeError);
    assert.throws(() => defineProc([]), RangeError);
  });

  it("takes the aura or ability duration for an applyAura", () => {
    const defined = proc({
      actions: [{ type: "applyAura", aura: "blade-flurry" }],
    });
    assert.equal(defined.actions[0].aura, "blade-flurry");
  });

  it("makes a ranked proc by rank, and none at rank 0", () => {
    const spec = {
      id: "ranked",
      trigger: "onHit",
      chance: { mode: "flat", values: [0.1, 0.2, 0.3] },
      actions: [{ type: "extraAttack" }],
    };
    assert.equal(defineRankedProc(spec, 0), null);
    assert.equal(defineRankedProc(spec, 1).chance.value, 0.1);
    assert.equal(defineRankedProc(spec, 3).chance.value, 0.3);
    assert.equal(defineRankedProc(spec, 3).extraAttack, true);
    assert.throws(() => defineRankedProc(spec, 4), /rank 4 is above/);
    assert.throws(() => defineRankedProc(spec, -1), RangeError);
    assert.throws(() => defineRankedProc(spec, 1.5), RangeError);
    // A bad value at a rank nobody spends points in fails at rank 0 too.
    const typo = {
      ...spec,
      chance: { mode: "flat", values: [0.1, 0.2, 3] },
    };
    assert.throws(() => defineRankedProc(typo, 0), /0 to 1/);
    assert.throws(
      () => defineRankedProc({ ...spec, chance: { mode: "flat" } }, 1),
      /values array/,
    );
  });

  it("lists procs for a Rogue, leaves out the nulls, refuses the rest", () => {
    const one = proc();
    assert.deepEqual(checkProcs([null, one, null]), [one]);
    assert.equal(Object.isFrozen(checkProcs([one])), true);
    assert.throws(() => checkProcs([one, one]), /share the id "test-proc"/);
    assert.throws(() => checkProcs([{ ...one }]), /did not make/);
    assert.throws(() => checkProcs("hack"), TypeError);
    assert.throws(() => new Rogue(undefined, { procs: [{}] }), RangeError);
    assert.throws(
      () => new Rogue(undefined, { proks: [] }),
      /Unknown Rogue option "proks". Known: modifiers, procs./,
    );
    assert.deepEqual(new Rogue().procs, []);
  });

  it("names a resource the rogue lacks when the fight is built", () => {
    const rogue = new Rogue(undefined, { procs: [proc()] });
    delete rogue.resources.comboPoints;
    assert.throws(
      () => new Simulation(rogue),
      /"test-proc" gains the resource "comboPoints"/,
    );
  });
});

describe("a fight with no procs", () => {
  it("draws nothing for them: a null-only list is the same fight", () => {
    const base = createFight(7, undefined, undefined);
    const nulls = createFight(7, undefined, { procs: [null, null] });
    base.simulation.run(60);
    nulls.simulation.run(60);
    assert.equal(nulls.simulation.procs.active, false);
    assert.equal(nulls.simulation.damageDone, base.simulation.damageDone);
    assert.deepEqual(nulls.simulation.combatLog, base.simulation.combatLog);
    assert.equal(nulls.simulation.rng(), base.simulation.rng());
  });

  it("holds the runFight result shape: no proc field", async () => {
    const { runFight } = await import("../js/fight.js");
    const result = runFight({ seed: 1, duration: 5 });
    assert.deepEqual(Object.keys(result), [
      "seed",
      "duration",
      "totalDamage",
      "dps",
      "abilities",
      "log",
      "dataVersion",
      "config",
    ]);
    assert.throws(
      () => runFight({ seed: 1, duration: 5, procs: [] }),
      RangeError,
    );
  });
});

describe("triggers", () => {
  it("fires onHit on a landed white swing, with one draw", () => {
    const { rogue, sim, tape } = harness({
      procs: [proc()],
      rolls: [HIT, 0.1],
    });
    rogue.comboPoints = 0;
    assert.equal(swing(sim).landed, true);
    assert.equal(rogue.comboPoints, 1);
    assert.equal(tape.left(), 0);
    assert.deepEqual(sim.procs.stats["test-proc"], {
      rolls: 1,
      fires: 1,
      blocked: 0,
      gained: 1,
    });
  });

  it("does not fire on a swing that did not land, and draws nothing", () => {
    const { rogue, sim, tape } = harness({ procs: [proc()], rolls: [0] });
    rogue.comboPoints = 0;
    assert.equal(swing(sim).landed, false);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(tape.left(), 0);
    assert.equal(sim.procs.stats["test-proc"].rolls, 0);
  });

  it("does not fire when the roll is at or above the chance", () => {
    const { rogue, sim } = harness({
      procs: [proc()],
      rolls: [HIT, 0.5],
    });
    rogue.comboPoints = 0;
    swing(sim);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(sim.procs.stats["test-proc"].rolls, 1);
    assert.equal(sim.procs.stats["test-proc"].fires, 0);
  });

  it("fires onCrit only on a crit, and onWhiteHit only on a white swing", () => {
    const procs = [
      proc({ id: "hit", trigger: "onHit" }),
      proc({ id: "crit", trigger: "onCrit" }),
      proc({ id: "white", trigger: "onWhiteHit" }),
    ];
    // A white swing that hits: onHit then onWhiteHit, in that order.
    let h = harness({ procs, rolls: [HIT, 0, 0] });
    swing(h.sim);
    assert.equal(h.sim.procs.stats.hit.fires, 1);
    assert.equal(h.sim.procs.stats.white.fires, 1);
    assert.equal(h.sim.procs.stats.crit.rolls, 0);
    // A white crit fires all three, onHit, onCrit, onWhiteHit.
    h = harness({ procs, rolls: [HIT, 0, 0, 0] });
    h.rogue.critChance = 1;
    h.sim.modifiers.resolve = (kind, value) => value;
    h.rogue.getCritChance = () => 1;
    const crit = swing(h.sim);
    assert.equal(crit.outcome, "crit");
    assert.equal(h.sim.procs.stats.crit.fires, 1);
    assert.equal(h.sim.procs.stats.white.fires, 1);
    assert.equal(h.tape.left(), 0);
    // A yellow hit fires onHit and not onWhiteHit.
    h = harness({ procs, rolls: [0.5, HIT, HIT, 0] });
    h.rogue.comboPoints = 0;
    h.rogue.abilities.sinisterStrike.cast(h.rogue, h.sim);
    assert.equal(h.sim.procs.stats.hit.fires, 1);
    assert.equal(h.sim.procs.stats.white.rolls, 0);
    assert.equal(h.tape.left(), 0);
  });

  it("orders the draws: the trigger order first, then the list order", () => {
    const procs = [
      proc({ id: "b-white", trigger: "onWhiteHit" }),
      proc({ id: "a-hit-2", trigger: "onHit" }),
      proc({ id: "a-hit-1", trigger: "onHit" }),
    ];
    const { sim } = harness({ procs, rolls: [HIT, 0.9, 0.9, 0.9] });
    const draw = sim.rng;
    const seen = [];
    const rolled = { "b-white": 0, "a-hit-2": 0, "a-hit-1": 0 };
    sim.rng = () => {
      // Which proc is rolling: the one whose roll count just went up.
      const who = Object.keys(rolled).find(
        (id) => sim.procs.stats[id].rolls > rolled[id],
      );
      if (who !== undefined) {
        rolled[who] += 1;
      }
      seen.push(who ?? "attack");
      return draw();
    };
    swing(sim);
    assert.deepEqual(seen, ["attack", "a-hit-2", "a-hit-1", "b-white"]);
  });

  it("filters by ability id and rolls nothing for another ability", () => {
    const only = proc({
      trigger: "onAbility",
      scope: { abilities: ["backstab"] },
      chance: { mode: "flat", value: 1 },
    });
    const { rogue, sim } = harness({
      procs: [only],
      // Backstab: weapon damage, attack, crit, proc. Sinister Strike: weapon
      // damage, attack, crit, no proc.
      rolls: [0.5, HIT, HIT, 0, 0.5, HIT, HIT],
      config: DAGGER,
    });
    rogue.comboPoints = 0;
    rogue.abilities.backstab.cast(rogue, sim);
    const afterBackstab = rogue.comboPoints;
    sim.gcd = 0;
    rogue.energy = k("energy.max");
    rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(sim.procs.stats["test-proc"].rolls, 1);
    assert.equal(
      rogue.comboPoints,
      afterBackstab + k("sinisterStrike").comboPoints,
      "Sinister Strike gained its own point and no proc's",
    );
  });

  it("filters by tag: a finisher, whichever finisher it is", () => {
    const finisher = proc({
      id: "finisher-proc",
      trigger: "onAbility",
      scope: { tags: ["finisher"] },
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "gainResource", resource: "energy", amount: 10 }],
    });
    const { rogue, sim, tape } = harness({
      procs: [finisher],
      // Eviscerate: finisher roll, attack, crit, proc.
      rolls: [0.5, HIT, HIT, 0],
    });
    rogue.comboPoints = 3;
    rogue.energy = 50;
    const before = rogue.energy;
    rogue.abilities.eviscerate.cast(rogue, sim);
    assert.equal(tape.left(), 0);
    assert.equal(
      rogue.energy,
      before - k("eviscerate").energy + 10,
      "the energy was paid, then restored",
    );
    assert.equal(sim.procs.stats["finisher-proc"].gained, 10);
  });

  it("fires onAbility for a cast that does not attack, with no attack tags", () => {
    const bleedOrYellow = proc({
      id: "yellow",
      trigger: "onAbility",
      scope: { tags: ["yellow", "white"] },
      chance: { mode: "flat", value: 1 },
    });
    const any = proc({
      id: "any",
      trigger: "onAbility",
      scope: { abilities: ["adrenaline-rush"] },
      chance: { mode: "flat", value: 1 },
    });
    const { rogue, sim, tape } = harness({
      procs: [bleedOrYellow, any],
      rolls: [0],
    });
    rogue.abilities.adrenalineRush.cast(rogue, sim);
    assert.equal(sim.procs.stats.yellow.rolls, 0);
    assert.equal(sim.procs.stats.any.fires, 1);
    assert.equal(tape.left(), 0);
  });

  it("does not fire onAbility for a cast that missed", () => {
    const any = proc({
      trigger: "onAbility",
      chance: { mode: "flat", value: 1 },
    });
    const { rogue, sim } = harness({
      procs: [any],
      rolls: [0.5, 0],
      config: DAGGER,
    });
    rogue.abilities.backstab.cast(rogue, sim);
    assert.equal(sim.procs.stats["test-proc"].rolls, 0);
  });

  it("fires onAbility for a DoT application, as a bleed, and onDotTick per tick", () => {
    const applied = proc({
      id: "applied",
      trigger: "onAbility",
      scope: { abilities: ["rupture"], tags: ["bleed"] },
      chance: { mode: "flat", value: 1 },
    });
    const tick = proc({
      id: "tick",
      trigger: "onDotTick",
      scope: { abilities: ["rupture"], tags: ["bleed"] },
      chance: { mode: "flat", value: 0.5 },
      actions: [{ type: "gainResource", resource: "energy", amount: 5 }],
    });
    const hit = proc({
      id: "hit",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
    });
    const { rogue, sim, tape } = harness({
      procs: [applied, tick, hit],
      // Rupture: attack roll and no crit draw (the application cannot crit),
      // then the applied proc. Then two ticks: crit roll, tick proc each.
      rolls: [HIT, 0, HIT, 0.1, HIT, 0.9],
    });
    rogue.comboPoints = 1;
    rogue.abilities.rupture.cast(rogue, sim);
    assert.equal(sim.procs.stats.applied.fires, 1);
    assert.equal(
      sim.procs.stats.hit.rolls,
      0,
      "a DoT application is not a hit",
    );
    const interval = k("rupture.tickInterval");
    quiet(sim.rogue);
    rogue.energy = 0;
    runOnCore(sim, interval);
    assert.equal(sim.procs.stats.tick.rolls, 1);
    assert.equal(sim.procs.stats.tick.fires, 1);
    runOnCore(sim, interval);
    assert.equal(sim.procs.stats.tick.rolls, 2);
    assert.equal(sim.procs.stats.tick.fires, 1);
    assert.equal(sim.procs.stats.hit.rolls, 0, "a tick is not a hit");
    assert.equal(tape.left(), 0);
  });
});

describe("chance", () => {
  it("never draws for a chance of 0, a filter miss, or a zero-rank talent", () => {
    const zero = proc({ chance: { mode: "flat", value: 0 } });
    const wrongHand = proc({
      id: "wrong-hand",
      scope: { hands: ["offHand"] },
      chance: { mode: "flat", value: 1 },
    });
    const wrongType = proc({
      id: "wrong-type",
      scope: { weaponTypes: ["axe"] },
      chance: { mode: "flat", value: 1 },
    });
    const { sim, tape } = harness({
      procs: [zero, wrongHand, wrongType],
      config: SWORD,
      rolls: [HIT],
    });
    swing(sim);
    assert.equal(tape.left(), 0, "only the swing drew");
    assert.equal(
      procsFromTalents({ "combat.hack-and-slash": 0 }).every((p) => p === null),
      true,
    );
  });

  it("scales with the points spent when the mode is perSpent", () => {
    const perCp = proc({
      trigger: "onAbility",
      scope: { abilities: ["eviscerate"] },
      chance: { mode: "perSpent", value: 0.2 },
      actions: [{ type: "gainResource", resource: "energy", amount: 20 }],
    });
    const cast = (points, procRoll) => {
      const { rogue, sim, tape } = harness({
        procs: [perCp],
        rolls: [0.5, HIT, HIT, ...(procRoll === null ? [] : [procRoll])],
      });
      rogue.comboPoints = points;
      rogue.abilities.eviscerate.cast(rogue, sim);
      assert.equal(tape.left(), 0);
      return { rogue, stats: sim.procs.stats["test-proc"] };
    };
    // 3 points spent: chance 0.6. 0.59 fires, 0.61 does not.
    assert.equal(cast(3, 0.59).stats.fires, 1);
    assert.equal(cast(3, 0.61).stats.fires, 0);
    assert.equal(cast(1, 0.19).stats.fires, 1);
    assert.equal(cast(1, 0.21).stats.fires, 0);
    // 5 points: 1.0 (capped at 1; 0.999 fires).
    assert.equal(cast(5, 0.999).stats.fires, 1);
    // The points are read before the pool resets, and are gone afterwards.
    assert.equal(cast(3, 0.1).rogue.comboPoints, 0);
  });

  it("draws nothing for a perSpent proc on a cast that spent none", () => {
    const perCp = proc({
      trigger: "onAbility",
      chance: { mode: "perSpent", value: 0.2 },
    });
    const { rogue, sim, tape } = harness({
      procs: [perCp],
      rolls: [0.5, HIT, HIT],
    });
    rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(tape.left(), 0);
    assert.equal(sim.procs.stats["test-proc"].rolls, 0);
  });

  it("works out procs per minute from the hand's base weapon speed", () => {
    const rogue = harness().rogue;
    const per = (hand) =>
      (2 * rogue.weapons[hand].speed) / k("proc.secondsPerMinute");
    assert.notEqual(per("mainHand"), per("offHand"));
    const ppmProc = proc({ chance: { mode: "ppm", value: 2 } });
    const fires = (hand, roll) => {
      const h = harness({ procs: [ppmProc], rolls: [HIT, roll] });
      swing(h.sim, hand);
      return h.sim.procs.stats["test-proc"].fires;
    };
    for (const hand of ["mainHand", "offHand"]) {
      const other = hand === "mainHand" ? "offHand" : "mainHand";
      const own = per(hand);
      // Just under this hand's chance fires and at it does not, whichever
      // hand is the quicker.
      assert.equal(fires(hand, own - 1e-9), 1, `${hand} below`);
      assert.equal(fires(hand, own), 0, `${hand} at`);
      // A roll between the two chances tells the hands apart.
      const between = (own + per(other)) / 2;
      assert.equal(fires(hand, between), own > per(other) ? 1 : 0, hand);
    }
  });

  it("rolls on an extra swing for a proc that has no extra attack", () => {
    const gain = proc({ id: "gain", chance: { mode: "flat", value: 1 } });
    const extra = defineProc({
      id: "extra",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "extraAttack" }],
    });
    const { rogue, sim, tape } = harness({
      procs: [gain, extra],
      // swing, gain, extra, weapon damage, swing, gain (rolls), extra (not).
      rolls: [HIT, 0, 0, 0.5, HIT, 0],
    });
    rogue.comboPoints = 0;
    swing(sim);
    assert.equal(tape.left(), 0);
    assert.equal(sim.procs.stats.gain.rolls, 2);
    assert.equal(sim.procs.stats.extra.rolls, 1);
    assert.equal(rogue.comboPoints, 2);
  });

  it("counts a time within the tick epsilon of the end as ready", () => {
    const icd = proc({ chance: { mode: "flat", value: 1 }, cooldown: 3 });
    const { sim } = harness({
      procs: [icd],
      rolls: [HIT, 0, HIT, 0, HIT],
    });
    swing(sim);
    sim.currentTime = 3 - k("sim.tickEpsilon") / 2;
    swing(sim);
    assert.equal(sim.procs.stats["test-proc"].fires, 2);
    // The second fired at 3 - eps/2, so it is held back until 6 - eps/2.
    sim.currentTime = 6 - 10 * k("sim.tickEpsilon");
    swing(sim);
    assert.equal(sim.procs.stats["test-proc"].blocked, 1);
  });

  it("holds a proc back during its internal cooldown, without a draw", () => {
    const icd = proc({ chance: { mode: "flat", value: 1 }, cooldown: 3 });
    const { rogue, sim, tape } = harness({
      procs: [icd],
      rolls: [HIT, 0, HIT, HIT, 0],
    });
    rogue.comboPoints = 0;
    swing(sim);
    assert.equal(rogue.comboPoints, 1);
    // One second on: still held back. The swing draws, the proc does not.
    sim.currentTime += 1;
    swing(sim);
    assert.equal(rogue.comboPoints, 1);
    assert.equal(sim.procs.stats["test-proc"].blocked, 1);
    assert.equal(sim.procs.stats["test-proc"].rolls, 1);
    // Three seconds after it fired, it is ready again.
    sim.currentTime += 2;
    swing(sim);
    assert.equal(rogue.comboPoints, 2);
    assert.equal(tape.left(), 0);
  });
});

describe("actions", () => {
  it("adds combo points up to the cap, and an energy restore up to the cap", () => {
    const procs = [
      proc({ id: "cp", chance: { mode: "flat", value: 1 } }),
      proc({
        id: "energy",
        chance: { mode: "flat", value: 1 },
        actions: [{ type: "gainResource", resource: "energy", amount: 30 }],
      }),
    ];
    const { rogue, sim } = harness({ procs, rolls: [HIT, 0, 0] });
    rogue.comboPoints = k("combo.max");
    rogue.energy = k("energy.max") - 10;
    swing(sim);
    assert.equal(rogue.comboPoints, k("combo.max"));
    assert.equal(rogue.energy, k("energy.max"));
    assert.equal(sim.procs.stats.cp.gained, 0);
    assert.equal(sim.procs.stats.energy.gained, 10);
  });

  it("clears a pending combo point expiry, as a builder's points do", () => {
    const { rogue, sim } = harness({
      procs: [proc({ chance: { mode: "flat", value: 1 } })],
      rolls: [HIT, 0],
    });
    rogue.resources.comboPoints.armExpiry(1, 5);
    swing(sim);
    assert.equal(rogue.resources.comboPoints.expiryRemaining, 0);
  });

  it("applies an aura by id, for the duration it is given", () => {
    const aura = proc({
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "applyAura", aura: "blade-flurry", duration: 4 }],
    });
    const { sim } = harness({ procs: [aura], rolls: [HIT, 0] });
    swing(sim);
    assert.equal(sim.hasAura("blade-flurry"), true);
    assert.equal(sim.activeBuffs["blade-flurry"].duration, 4);
  });

  it("deals damage from a source of its own, recorded and counted", () => {
    const damage = proc({
      chance: { mode: "flat", value: 1 },
      actions: [
        {
          type: "dealDamage",
          id: "proc-strike",
          name: "Proc strike",
          min: 10,
          max: 20,
        },
      ],
    });
    const { sim, tape } = harness({ procs: [damage], rolls: [HIT, 0, 0.5] });
    const before = sim.damageDone;
    const result = swing(sim);
    assert.equal(
      tape.left(),
      0,
      "one draw for the damage, none for a spell hit",
    );
    const dealt = sim.abilityStats["proc-strike"].damage;
    assert.ok(dealt > 0);
    assert.ok(dealt <= 20);
    assert.equal(sim.abilityStats["proc-strike"].hits, 1);
    assert.equal(sim.damageDone, before + result.damage + dealt);
    assert.equal(sim.combatLog[0].name, "Proc strike");
    assert.equal(sim.abilityBreakdown()["Proc strike"].damage, dealt);
    // It fired no proc of its own.
    assert.equal(sim.procs.stats["test-proc"].rolls, 1);
  });

  it("applies armor to a physical source and the damage modifiers to any", () => {
    const dealt = (id, options = {}) => {
      const strike = proc({
        chance: { mode: "flat", value: 1 },
        actions: [{ type: "dealDamage", id, name: "Source", min: 1000 }],
      });
      const rogue = new Rogue(undefined, { procs: [strike], ...options });
      rogue.bonusHitChance = 1;
      rogue.critChance = 0;
      quiet(rogue);
      const sim = new Simulation(rogue, { rng: scripted([HIT, 0]).rng });
      swing(sim);
      return sim.abilityStats[id].damage;
    };
    // A physical source pays armor; a nature one (a poison id) does not.
    assert.ok(dealt("proc-strike") < 1000);
    assert.ok(dealt("proc-strike") > 0);
    assert.equal(dealt("deadly-poison"), 1000);
    const modifiers = [
      { kind: "damage", value: 0.5, scope: { tags: ["poison"] } },
      { kind: "damage", value: 9, scope: { tags: ["bleed"] } },
    ];
    assert.equal(dealt("deadly-poison", { modifiers }), 1500);
  });

  it("rolls a spell hit before the damage, and a resist deals none", () => {
    const spell = proc({
      chance: { mode: "flat", value: 1 },
      actions: [
        {
          type: "dealDamage",
          id: "proc-spell",
          name: "Proc spell",
          min: 10,
          max: 20,
          spellHit: true,
        },
      ],
    });
    const resist = harness({ procs: [spell], rolls: [HIT, 0, 0] });
    swing(resist.sim);
    assert.equal(resist.tape.left(), 0, "the resist took no damage draw");
    assert.equal(resist.sim.abilityStats["proc-spell"].damage, 0);
    assert.equal(resist.sim.abilityStats["proc-spell"].misses, 1);
    assert.equal(resist.sim.combatLog[0].status, "Resist");
    const hits = harness({ procs: [spell], rolls: [HIT, 0, 0.99, 0] });
    swing(hits.sim);
    assert.equal(hits.tape.left(), 0);
    assert.ok(hits.sim.abilityStats["proc-spell"].damage > 0);
  });

  it("takes no damage draw when min and max are the same", () => {
    const flat = proc({
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "dealDamage", id: "p", name: "P", min: 7 }],
    });
    const { sim, tape } = harness({ procs: [flat], rolls: [HIT, 0] });
    swing(sim);
    assert.equal(tape.left(), 0);
    assert.ok(sim.abilityStats.p.damage > 0);
  });

  it("makes an extra attack in the hand that triggered it, draws in order", () => {
    const extra = defineProc({
      id: "extra",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "extraAttack" }],
    });
    // Swing: attack roll. Proc roll. Extra swing: weapon damage, attack roll.
    // The extra swing's own onHit does not roll (hackAndSlash.chain is off).
    const { sim, tape } = harness({
      procs: [extra],
      rolls: [HIT, 0, 0.5, HIT],
    });
    swing(sim, "offHand");
    assert.equal(tape.left(), 0);
    assert.equal(sim.abilityStats["off-hand"].casts, 2);
    assert.equal(sim.abilityStats["main-hand"], undefined);
    assert.equal(sim.procs.stats.extra.rolls, 1);
  });

  it("lets an extra attack trigger another when hackAndSlash.chain is on", () => {
    const extra = defineProc({
      id: "extra",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [{ type: "extraAttack" }],
    });
    CONSTANTS["hackAndSlash.chain"].value = true;
    // A chance of 1 never fails its roll, so the chain never ends by itself:
    // swing, then (proc, weapon damage, swing) over and over.
    const link = [0, 0.5, HIT];
    const { sim } = harness({
      procs: [extra],
      rolls: [
        HIT,
        ...Array(k("proc.maxChainDepth") + 1)
          .fill(link)
          .flat(),
      ],
    });
    assert.throws(() => swing(sim), {
      name: "RangeError",
      message: /followed one another/,
    });
    assert.equal(sim.procs.depth, 0, "the depth unwinds");
    assert.equal(
      sim.abilityStats["main-hand"].casts,
      k("proc.maxChainDepth") + 1,
    );
  });

  it("ends a chain by the roll when the chance is below 1", () => {
    const extra = defineProc({
      id: "extra",
      trigger: "onHit",
      chance: { mode: "flat", value: 0.5 },
      actions: [{ type: "extraAttack" }],
    });
    CONSTANTS["hackAndSlash.chain"].value = true;
    const { sim, tape } = harness({
      procs: [extra],
      // swing, proc fires, weapon, swing, proc fires, weapon, swing, proc misses
      rolls: [HIT, 0.1, 0.5, HIT, 0.1, 0.5, HIT, 0.9],
    });
    swing(sim);
    assert.equal(tape.left(), 0);
    assert.equal(sim.abilityStats["main-hand"].casts, 3);
    assert.equal(sim.procs.stats.extra.fires, 2);
  });
});

describe("Hack and Slash and Puncturing Wounds", () => {
  const SWINGS = 20000;

  function rate(type, rank, hand = "mainHand") {
    const procs = procsFromTalents({ "combat.hack-and-slash": rank });
    const config = {
      weapons: { mainHand: { type }, offHand: { type } },
    };
    const { sim } = harness({ procs, config, seed: 99 });
    for (let i = 0; i < SWINGS; i += 1) {
      swing(sim, hand);
    }
    return sim.procs.stats["hack-and-slash"] ?? { rolls: 0, fires: 0 };
  }

  it("procs at 1% to 5% a rank on a sword or an axe swing, in either hand", () => {
    const chances = k("hackAndSlash.extraAttack").chance;
    assert.deepEqual(chances, [0.01, 0.02, 0.03, 0.04, 0.05]);
    for (const type of ["sword", "axe"]) {
      for (const hand of ["mainHand", "offHand"]) {
        for (let rank = 1; rank <= chances.length; rank += 1) {
          const { rolls, fires } = rate(type, rank, hand);
          const p = chances[rank - 1];
          // Four standard errors of a rate over `rolls` swings.
          const tolerance = 4 * Math.sqrt((p * (1 - p)) / rolls);
          assert.ok(rolls > SWINGS / 2, `${type} ${hand} rank ${rank} swings`);
          assert.ok(
            Math.abs(fires / rolls - p) < tolerance,
            `${type} ${hand} rank ${rank}: ${fires / rolls} against ${p}`,
          );
        }
      }
    }
  });

  it("never procs on a dagger, a fist or a mace, and never draws", () => {
    for (const type of ["dagger", "fist", "mace", "other"]) {
      assert.equal(rate(type, 5).rolls, 0, type);
    }
  });

  it("adds a combo point to Backstab at 15%, 30% or 45% a rank", () => {
    const chances = k("puncturingWounds.comboPoint").chance;
    assert.deepEqual(chances, [0.15, 0.3, 0.45]);
    for (let rank = 1; rank <= chances.length; rank += 1) {
      const procs = procsFromTalents({ "combat.puncturing-wounds": rank });
      for (const [roll, fires] of [
        [chances[rank - 1] - 1e-9, true],
        [chances[rank - 1], false],
      ]) {
        const { rogue, sim, tape } = harness({
          procs,
          rolls: [0.5, HIT, HIT, roll],
          config: DAGGER,
        });
        rogue.comboPoints = 0;
        rogue.abilities.backstab.cast(rogue, sim);
        assert.equal(tape.left(), 0);
        assert.equal(
          rogue.comboPoints,
          k("backstab").comboPoints + (fires ? 1 : 0),
          `rank ${rank} roll ${roll}`,
        );
      }
    }
  });

  it("gives the talents' procs from a rank table and ignores other talents", () => {
    // The tables are the `procs` of the talent effects data (D5), so they
    // come in the catalogue's order.
    assert.deepEqual(Object.keys(PROC_TABLES), [
      "assassination.ruthlessness",
      "assassination.relentless-strikes",
      "assassination.seal-fate",
      "combat.puncturing-wounds",
      "combat.hack-and-slash",
    ]);
    const procs = procsFromTalents({
      "combat.hack-and-slash": 3,
      "assassination.malice": 5,
    });
    const hackAndSlash =
      procs[Object.keys(PROC_TABLES).indexOf("combat.hack-and-slash")];
    assert.equal(procs.filter((one) => one !== null).length, 1);
    assert.equal(hackAndSlash.chance.value, 0.03);
    assert.equal(
      procsFromTalents().every((one) => one === null),
      true,
    );
  });

  it("changes a full fight only when the procs are listed", () => {
    const procs = procsFromTalents({ "combat.hack-and-slash": 5 });
    const config = { weapons: { mainHand: { type: "sword" } } };
    const none = createFight(11, config);
    const some = createFight(11, config, { procs });
    none.simulation.run(120);
    some.simulation.run(120);
    assert.ok(some.simulation.procs.stats["hack-and-slash"].fires > 0);
    assert.notEqual(some.simulation.damageDone, none.simulation.damageDone);
    // Same seed, same procs: the same fight.
    const again = createFight(11, config, { procs });
    again.simulation.run(120);
    assert.equal(again.simulation.damageDone, some.simulation.damageDone);
  });
});

describe("the #120 follow-ups", () => {
  it("rejects a negative, NaN or non-number amount on a gain or a spend", () => {
    const { rogue } = harness();
    const pool = rogue.resources.energy;
    for (const bad of [-1, Number.NaN, Infinity, "5", null, undefined]) {
      assert.throws(() => pool.gain(bad), {
        name: "RangeError",
        message: /cannot gain/,
      });
      assert.throws(() => pool.spend(bad), {
        name: "RangeError",
        message: /cannot spend/,
      });
    }
    const before = pool.value;
    assert.equal(pool.gain(0), 0);
    pool.spend(0);
    assert.equal(pool.value, before);
  });

  it("names a resource the ability lacks as an own pool, not an inherited one", () => {
    const { rogue } = harness();
    const ability = rogue.abilities.sinisterStrike;
    for (const name of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ]) {
      assert.throws(() => ability.pool(name), {
        name: "RangeError",
        message: /does not have/,
      });
    }
    assert.equal(ability.pool("energy"), rogue.resources.energy);
  });

  it("refuses a definition that names a missing resource when it loads", () => {
    const { rogue } = harness();
    const base = {
      key: "x",
      id: "sinister-strike",
      row: "sinisterStrike",
      icon: "x.jpg",
      damage: { kind: "weapon" },
    };
    for (const field of ["cost", "gain"]) {
      assert.throws(
        () =>
          new Ability(
            { ...base, [field]: { resource: "toString", field: "energy" } },
            rogue,
          ),
        { name: "RangeError", message: /"toString"/ },
      );
    }
    assert.throws(
      () => new Ability({ ...base, spend: { resource: "focus" } }, rogue),
      { name: "RangeError", message: /"focus"/ },
    );
  });

  it("refuses __proto__ and a non-string id as a resource", () => {
    const { rogue } = harness();
    for (const id of ["__proto__", 7, undefined]) {
      assert.throws(
        () => createResources(rogue.modifiers, [{ id, max: "energy.max" }]),
        RangeError,
      );
    }
  });

  it("clamps a pool above its cap on the next step, and never raises one", () => {
    const { rogue, sim } = harness();
    const points = rogue.resources.comboPoints;
    points.value = k("combo.max") + 3;
    // A cast that neither gains nor spends leaves the excess in place...
    rogue.abilities.adrenalineRush.cast(rogue, sim);
    assert.equal(points.value, k("combo.max") + 3);
    // ...and the step after it brings the pool down to the cap.
    runOnCore(sim, 0.1);
    assert.equal(points.value, k("combo.max"));
    points.value = 1;
    runOnCore(sim, 0.1);
    assert.equal(points.value, 1);
    rogue.resources.energy.value = 0;
    rogue.resources.energy.clamp();
    assert.equal(rogue.resources.energy.value, 0);
  });
});

describe("the #123 follow-ups", () => {
  it("takes the catalogue's name for a dealDamage on a catalogue id, and its own otherwise", () => {
    const damage = (action) =>
      proc({
        actions: [{ type: "dealDamage", min: 1, ...action }],
      }).actions[0];
    // The catalogue wins, whether or not a name is given.
    assert.equal(damage({ id: "eviscerate" }).name, "Eviscerate");
    assert.equal(
      damage({ id: "eviscerate", name: "Something else" }).name,
      "Eviscerate",
    );
    // An id outside it keeps the name it was given, and needs one.
    assert.equal(
      damage({ id: "proc-strike", name: "Proc strike" }).name,
      "Proc strike",
    );
    assert.throws(() => damage({ id: "proc-strike" }), /needs a name/);
  });

  it("copies a gainResource action and freezes the copy, not the caller's object", () => {
    const given = { type: "gainResource", resource: "energy", amount: 25 };
    const defined = proc({ actions: [given] });
    const action = defined.actions[0];
    assert.notEqual(action, given);
    assert.equal(Object.isFrozen(action), true);
    assert.equal(Object.isFrozen(given), false);
    given.amount = 99;
    assert.equal(action.amount, 25);
    assert.deepEqual(action, {
      type: "gainResource",
      resource: "energy",
      amount: 25,
    });
  });

  it("copies and freezes an applyAura action the same way", () => {
    const given = { type: "applyAura", aura: "blade-flurry", duration: 4 };
    const action = proc({ actions: [given] }).actions[0];
    assert.notEqual(action, given);
    assert.equal(Object.isFrozen(action), true);
    assert.equal(Object.isFrozen(given), false);
    given.duration = 99;
    assert.equal(action.duration, 4);
  });

  it("refuses an empty rank table, in a ranked proc and in expandRank", () => {
    const spec = {
      id: "ranked",
      trigger: "onHit",
      chance: { mode: "flat", values: [] },
      actions: [{ type: "extraAttack" }],
    };
    for (const rank of [0, 1]) {
      assert.throws(() => defineRankedProc(spec, rank), {
        name: "RangeError",
        message: /needs a values array/,
      });
      assert.throws(
        () =>
          expandRank([{ kind: "damage", op: "add", values: [] }], rank, "x"),
        { name: "RangeError", message: /needs a values array/ },
      );
    }
  });

  it("runs the actions in the order they are listed", () => {
    const longer = (first, second) =>
      proc({
        chance: { mode: "flat", value: 1 },
        actions: [
          { type: "applyAura", aura: "blade-flurry", duration: first },
          { type: "applyAura", aura: "blade-flurry", duration: second },
        ],
      });
    assert.deepEqual(
      longer(3, 7).actions.map(({ duration }) => duration),
      [3, 7],
    );
    // The aura refreshes to the later action's duration, so the order shows.
    for (const [first, second] of [
      [3, 7],
      [7, 3],
    ]) {
      const { sim } = harness({
        procs: [longer(first, second)],
        rolls: [HIT, 0],
      });
      swing(sim);
      assert.equal(sim.activeBuffs["blade-flurry"].duration, second);
    }
  });

  it("applies an aura at the stacks the action gives, up to the aura's cap", () => {
    const stacked = (stacks) =>
      proc({
        chance: { mode: "flat", value: 1 },
        actions: [{ type: "applyAura", aura: "expose-armor", stacks }],
      });
    const stacksAfter = (procs) => {
      const { sim } = harness({ procs, rolls: [HIT, 0] });
      swing(sim);
      return sim.activeDebuffs["expose-armor"].stacks;
    };
    assert.equal(stacksAfter([stacked(3)]), 3);
    assert.equal(stacksAfter([stacked(undefined)]), 1);
    assert.equal(stacksAfter([stacked(k("combo.max") + 4)]), k("combo.max"));
  });

  it("refuses procsFromTalents an unknown key, null, an array or a non-object", () => {
    for (const bad of [null, [], "combat.hack-and-slash", 5, true]) {
      assert.throws(() => procsFromTalents(bad), {
        name: "RangeError",
        message: /needs an object/,
      });
    }
    for (const id of [
      "combat.hack-and-slsh",
      "hack-and-slash",
      "",
      "toString",
      "__proto__",
    ]) {
      assert.throws(() => procsFromTalents({ [id]: 1 }), {
        name: "RangeError",
        message: /unknown talent id/,
      });
    }
    // One bad key among good ones still fails, whatever its position.
    assert.throws(
      () => procsFromTalents({ "combat.hack-and-slash": 1, "combat.nope": 1 }),
      /"combat.nope"/,
    );
    // A real talent that is not a proc talent is ignored, and rank 0 is none.
    assert.equal(
      procsFromTalents({ "combat.precision": 3 }).every((one) => one === null),
      true,
    );
    assert.equal(procsFromTalents({}).length, Object.keys(PROC_TABLES).length);
  });

  it("refuses a ppm chance on a cast that does not attack, and only then", () => {
    const ppm = (scope) =>
      proc({
        trigger: "onAbility",
        scope,
        chance: { mode: "ppm", value: 2 },
      });
    const nonAttack = harness({
      procs: [ppm({ abilities: ["adrenaline-rush"] })],
      rolls: [],
    });
    assert.throws(
      () =>
        nonAttack.rogue.abilities.adrenalineRush.cast(
          nonAttack.rogue,
          nonAttack.sim,
        ),
      {
        name: "RangeError",
        message: /ppm chance and met a cast that does not attack/,
      },
    );
    // A proc the cast does not match never gets as far as the chance.
    const other = harness({
      procs: [ppm({ abilities: ["sinister-strike"] })],
      rolls: [],
    });
    other.rogue.abilities.adrenalineRush.cast(other.rogue, other.sim);
    // An attacking cast has a hand, so the chance is worked out. A cast that
    // missed fires no onAbility, so the seeds that land are the ones counted.
    let rolled = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const attack = harness({
        procs: [ppm({ abilities: ["sinister-strike"] })],
        seed,
      });
      attack.rogue.abilities.sinisterStrike.cast(attack.rogue, attack.sim);
      rolled += attack.sim.procs.stats["test-proc"].rolls;
    }
    assert.ok(rolled > 0);
  });

  it("holds combo points to whole numbers, and leaves energy fractional", () => {
    const { rogue } = harness();
    const combo = rogue.resources.comboPoints;
    for (const bad of [0.5, 1.5, 1e-9]) {
      assert.throws(() => combo.gain(bad), {
        name: "RangeError",
        message: /whole units/,
      });
      assert.throws(() => combo.spend(bad), /whole units/);
    }
    combo.gain(2);
    assert.equal(combo.value, 2);
    combo.spend(1);
    assert.equal(combo.value, 1);
    rogue.energy = 10;
    assert.equal(rogue.resources.energy.gain(0.5), 0.5);
    // A proc cannot be defined to add half a combo point.
    assert.throws(
      () =>
        proc({
          actions: [
            { type: "gainResource", resource: "comboPoints", amount: 0.5 },
          ],
        }),
      /holds whole units/,
    );
    assert.equal(
      proc({
        actions: [{ type: "gainResource", resource: "energy", amount: 12.5 }],
      }).actions[0].amount,
      12.5,
    );
  });
});

describe("guards a quick run of the suite has to see (#123 review)", () => {
  const bad = (overrides, pattern) =>
    assert.throws(() => proc(overrides), {
      name: "RangeError",
      message: pattern,
    });

  it("refuses an aura that lasts 0 seconds, or less, or no time at all", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
      bad(
        { actions: [{ type: "applyAura", aura: "blade-flurry", duration }] },
        /duration must be above 0/,
      );
    }
    // The aura's own length is used when the action gives none.
    assert.doesNotThrow(() =>
      proc({ actions: [{ type: "applyAura", aura: "blade-flurry" }] }),
    );
  });

  it("refuses a canCrit that is not true or false, and defaults it to false", () => {
    for (const canCrit of [1, 0, "yes", null, {}]) {
      bad(
        { actions: [{ type: "dealDamage", id: "gouge", min: 1, canCrit }] },
        /canCrit must be true or false/,
      );
    }
    for (const canCrit of [true, false, undefined]) {
      const defined = proc({
        actions: [{ type: "dealDamage", id: "gouge", min: 1, canCrit }],
      });
      assert.equal(defined.actions[0].canCrit, canCrit === true);
    }
  });

  it("refuses a spellHit that is not true or false", () => {
    for (const spellHit of [1, 0, "yes", null, {}]) {
      bad(
        { actions: [{ type: "dealDamage", id: "gouge", min: 1, spellHit }] },
        /spellHit must be true or false/,
      );
    }
    for (const spellHit of [true, false, undefined]) {
      const defined = proc({
        actions: [{ type: "dealDamage", id: "gouge", min: 1, spellHit }],
      });
      assert.equal(defined.actions[0].spellHit, spellHit === true);
    }
  });

  it("checks an applyDot action (#105)", () => {
    const dot = {
      type: "applyDot",
      id: "deadly-poison",
      tickDamage: 23,
      interval: 3,
      duration: 12,
    };
    const withDot = (changes) => ({ actions: [{ ...dot, ...changes }] });
    for (const field of ["tickDamage", "interval", "duration"]) {
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "3"]) {
        assert.throws(() => proc(withDot({ name: "P", [field]: value })), {
          name: "RangeError",
        });
      }
    }
    bad(withDot({ name: "P", duration: 2 }), /at least one interval/);
    assert.doesNotThrow(() => proc(withDot({ name: "P", duration: 3 })));
    bad(withDot({ name: "P", id: "" }), /id must be a non-empty string/);
    bad(withDot({}), /needs a name/);
    bad(withDot({ name: "P", aura: "no-such-aura" }), /target aura/);
    bad(withDot({ name: "P", aura: "blade-flurry" }), /target aura/);
    bad(withDot({ name: "P", spellHit: 1 }), /spellHit must be true or false/);
    bad(withDot({ name: "P", extra: 1 }), /extra/);
    bad(withDot({ name: "P", icon: 3 }), /icon must be a URL string/);
    bad(
      {
        actions: [{ type: "dealDamage", id: "x", name: "X", min: 1, icon: 3 }],
      },
      /icon must be a URL string/,
    );
    assert.doesNotThrow(() =>
      proc(withDot({ name: "P", icon: "https://x/y" })),
    );
    const defined = proc(withDot({ name: "P", aura: "deadly-poison" }))
      .actions[0];
    assert.equal(defined.spellHit, false);
    assert.equal(defined.name, "P");
    assert.ok(Object.isFrozen(defined));
  });

  it("refuses a proc spec that is an instance of a class", () => {
    class Spec {
      constructor() {
        this.id = "from-a-class";
        this.trigger = "onHit";
        this.chance = { mode: "flat", value: 0.5 };
        this.actions = [
          { type: "gainResource", resource: "comboPoints", amount: 1 },
        ];
      }
    }
    assert.throws(() => defineProc(new Spec()), {
      name: "RangeError",
      message: /must be an object/,
    });
    assert.throws(() => defineProc([]), RangeError);
    assert.throws(() => defineProc(null), RangeError);
    // An object with no prototype is plain data, and is accepted.
    const bare = Object.assign(Object.create(null), {
      id: "bare",
      trigger: "onHit",
      chance: { mode: "flat", value: 0.5 },
      actions: [{ type: "gainResource", resource: "comboPoints", amount: 1 }],
    });
    assert.equal(defineProc(bare).id, "bare");
  });

  it("starts the internal cooldown on a roll that fires, not on one that fails", () => {
    const icd = proc({ chance: { mode: "flat", value: 0.5 }, cooldown: 3 });
    // Swing, failed roll; a second later: swing, roll fires.
    const { rogue, sim, tape } = harness({
      procs: [icd],
      rolls: [HIT, 0.9, HIT, 0, HIT],
    });
    rogue.comboPoints = 0;
    swing(sim);
    assert.deepEqual(sim.procs.stats["test-proc"], {
      rolls: 1,
      fires: 0,
      blocked: 0,
      gained: 0,
    });
    sim.currentTime += 1;
    swing(sim);
    assert.equal(sim.procs.stats["test-proc"].fires, 1);
    assert.equal(sim.procs.stats["test-proc"].blocked, 0);
    assert.equal(rogue.comboPoints, 1);
    // That one fired, so now the cooldown holds.
    sim.currentTime += 1;
    swing(sim);
    assert.equal(sim.procs.stats["test-proc"].blocked, 1);
    assert.equal(tape.left(), 0);
  });
});
