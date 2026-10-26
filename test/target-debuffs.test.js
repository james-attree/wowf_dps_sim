import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { abilityCatalogue } from "../js/abilities.js";
import {
  AURAS,
  EFFECT_KINDS,
  STACK_RULES,
  auraRegistry,
  defineAura,
} from "../js/auras.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { Weapon } from "../js/weapon.js";
import { setRoll, testRng } from "./rolls.js";

const TICK_DAMAGE = 100;
const HIT_ROLL = 0.9;
const STEP = 1 / 64;
// Names that exist on every object. None may count as an aura or a hand.
const INHERITED = ["__proto__", "constructor", "toString", "hasOwnProperty"];

function fresh() {
  const rogue = new Rogue();
  rogue.rotation = () => {};
  rogue.critChance = 0;
  const sim = new Simulation(rogue, { rng: testRng });
  return { rogue, sim };
}

function define(spec) {
  return defineAura({ id: "test-aura", name: "Test Aura", ...spec });
}

// Run one DoT tick at the tick interval and return the damage it dealt.
function tickDamage(id, { hemorrhage = false, bleed = false } = {}) {
  setRoll(0.5);
  const { sim } = fresh();
  const tickInterval = k("rupture.tickInterval");
  sim.activeDots[id] = {
    name: id,
    duration: tickInterval,
    tickInterval,
    timeUntilNextTick: tickInterval,
    tickDamage: TICK_DAMAGE,
    icon: null,
    bleed,
  };
  if (hemorrhage) {
    sim.applyAura(AURAS.hemorrhage);
  }
  sim.step(tickInterval);
  return sim.damageDone;
}

function stepFor(sim, seconds) {
  for (let t = 0; t < seconds - STEP / 2; t += STEP) {
    sim.step(STEP);
  }
}

function hit(sim, id = "sinister-strike", attackType = "skill") {
  setRoll(HIT_ROLL);
  return sim.resolveAttack({ id, name: id }, attackType, TICK_DAMAGE);
}

function withConstant(id, value, run) {
  const row = CONSTANTS[id];
  const saved = row.value;
  row.value = value;
  try {
    return run();
  } finally {
    row.value = saved;
  }
}

describe("Hemorrhage and Rupture", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("raises Rupture ticks by 15% and nothing else", () => {
    const bonus = 1 + k("hemorrhage.ruptureBonus").bonus;
    assert.equal(k("hemorrhage.ruptureBonus").bonus, 0.15);
    const plain = tickDamage("rupture", { bleed: true });
    const boosted = tickDamage("rupture", { bleed: true, hemorrhage: true });
    assert.equal(plain, TICK_DAMAGE);
    assert.equal(boosted, TICK_DAMAGE * bonus);
    for (const id of ["garrote", "deadly-poison", "hemorrhage"]) {
      assert.equal(
        tickDamage(id, { hemorrhage: true }),
        tickDamage(id),
        `${id} is unchanged`,
      );
    }
  });

  it("leaves direct hits alone", () => {
    const { sim: without } = fresh();
    const { sim: with15 } = fresh();
    with15.applyAura(AURAS.hemorrhage);
    assert.equal(hit(with15).damage, hit(without).damage);
  });

  it("lasts 15 s and then Rupture ticks go back to normal", () => {
    const length = k("hemorrhage.ruptureBonus").duration;
    assert.equal(length, 15);
    const { sim } = fresh();
    sim.applyAura(AURAS.hemorrhage);
    stepFor(sim, length - 1);
    assert.equal(sim.hasAura("hemorrhage"), true);
    assert.equal(sim.auraEffects("dotDamageTaken").length, 1);
    stepFor(sim, 1 - STEP);
    assert.equal(sim.hasAura("hemorrhage"), true, "one step before 15 s");
    stepFor(sim, STEP);
    assert.equal(sim.hasAura("hemorrhage"), false, "gone at 15 s");
    assert.deepEqual(sim.auraEffects("dotDamageTaken"), []);
    assert.equal(sim.activeDebuffs.hemorrhage, undefined);
  });

  it("is refreshed to a full 15 s by a Hemorrhage hit", () => {
    setRoll(HIT_ROLL);
    const { rogue, sim } = fresh();
    rogue.energy = k("energy.max");
    sim.gcd = 0;
    const first = rogue.abilities.hemorrhage.cast(rogue, sim);
    assert.equal(first.landed, true);
    stepFor(sim, 10);
    assert.ok(sim.activeDebuffs.hemorrhage.duration < 6);
    rogue.energy = k("energy.max");
    sim.gcd = 0;
    sim.cooldowns = {};
    setRoll(HIT_ROLL);
    const second = rogue.abilities.hemorrhage.cast(rogue, sim);
    assert.equal(second.landed, true);
    assert.equal(
      sim.activeDebuffs.hemorrhage.duration,
      k("hemorrhage.ruptureBonus").duration,
    );
  });

  it("is not applied by a Hemorrhage that misses", () => {
    const { rogue, sim } = fresh();
    rogue.energy = k("energy.max");
    sim.gcd = 0;
    setRoll(0);
    const result = rogue.abilities.hemorrhage.cast(rogue, sim);
    assert.equal(result.landed, false);
    assert.equal(sim.hasAura("hemorrhage"), false);
  });
});

describe("stacks", () => {
  it("add by default and stop at maxStacks", () => {
    const { sim } = fresh();
    const stacker = define({ target: "target", duration: 10, maxStacks: 3 });
    assert.equal(stacker.stackRule, "add");
    assert.equal(sim.applyAura(stacker).stacks, 1);
    assert.equal(sim.applyAura(stacker).stacks, 2);
    assert.equal(sim.applyAura(stacker, { stacks: 5 }).stacks, 3);
    assert.equal(sim.applyAura(stacker).stacks, 3);
    assert.equal(sim.activeDebuffs["test-aura"].stacks, 3);
  });

  it("caps a first application above maxStacks", () => {
    const { sim } = fresh();
    const stacker = define({ target: "target", duration: 10, maxStacks: 3 });
    assert.equal(sim.applyAura(stacker, { stacks: 9 }).stacks, 3);
  });

  it("refresh the duration and keep the stacks", () => {
    const { sim } = fresh();
    const stacker = define({ target: "target", duration: 10, maxStacks: 3 });
    sim.applyAura(stacker);
    stepFor(sim, 4);
    const second = sim.applyAura(stacker);
    assert.equal(second.stacks, 2);
    assert.equal(second.duration, 10);
  });

  it("keep the higher count under the highest rule", () => {
    const { sim } = fresh();
    const strongest = define({
      target: "target",
      duration: 10,
      maxStacks: 5,
      stackRule: "highest",
    });
    assert.equal(sim.applyAura(strongest, { stacks: 3 }).stacks, 3);
    assert.equal(sim.applyAura(strongest, { stacks: 1 }).stacks, 3);
    assert.equal(sim.applyAura(strongest, { stacks: 5 }).stacks, 5);
    assert.equal(sim.applyAura(strongest, { stacks: 9 }).stacks, 5);
  });

  it("track separately for each debuff id", () => {
    const { sim } = fresh();
    const a = define({ id: "debuff-a", target: "target", maxStacks: 5 });
    const b = define({ id: "debuff-b", target: "target", maxStacks: 5 });
    sim.applyAura(a, { duration: 10, stacks: 2 });
    sim.applyAura(b, { duration: 4 });
    sim.applyAura(a, { duration: 10 });
    assert.equal(sim.activeDebuffs["debuff-a"].stacks, 3);
    assert.equal(sim.activeDebuffs["debuff-b"].stacks, 1);
    stepFor(sim, 5);
    assert.equal(sim.hasAura("debuff-a"), true);
    assert.equal(sim.hasAura("debuff-b"), false);
    assert.equal(sim.activeDebuffs["debuff-a"].stacks, 3);
  });

  it("are checked in the definition", () => {
    assert.deepEqual([...STACK_RULES], ["add", "highest"]);
    assert.throws(() => define({ stackRule: "most" }), /stackRule must be/);
  });
});

describe("charges", () => {
  const charged = () =>
    define({ target: "target", duration: 10, charges: 3, maxStacks: 2 });

  it("start at the definition's count and are null when there are none", () => {
    const { sim } = fresh();
    assert.equal(sim.applyAura(charged()).charges, 3);
    assert.equal(sim.applyAura(AURAS.hemorrhage).charges, null);
    assert.equal(AURAS.hemorrhage.charges, null);
  });

  it("are checked in the definition", () => {
    for (const bad of [0, -1, 1.5, "3", NaN]) {
      assert.throws(
        () => define({ charges: bad }),
        /charges must be a whole number/,
        String(bad),
      );
    }
    assert.equal(define({ charges: 1 }).charges, 1);
    assert.equal(define({}).charges, null);
  });

  it("use one charge for each landed hit and end the aura at 0", () => {
    const { sim } = fresh();
    sim.applyAura(charged());
    hit(sim);
    assert.equal(sim.activeDebuffs["test-aura"].charges, 2);
    hit(sim);
    hit(sim);
    assert.equal(sim.hasAura("test-aura"), false);
    assert.equal(sim.activeDebuffs["test-aura"], undefined);
  });

  it("are not used by a miss, a dodge or a parry", () => {
    const { sim } = fresh();
    sim.applyAura(charged());
    setRoll(0);
    const result = sim.resolveAttack(
      { id: "sinister-strike", name: "x" },
      "skill",
      TICK_DAMAGE,
    );
    assert.equal(result.landed, false);
    assert.equal(sim.activeDebuffs["test-aura"].charges, 3);
  });

  it("are used by white swings and crits too", () => {
    const { sim } = fresh();
    sim.applyAura(charged());
    hit(sim, "main-hand", "weapon");
    assert.equal(sim.activeDebuffs["test-aura"].charges, 2);
    sim.rogue.critChance = 1;
    hit(sim);
    assert.ok(sim.activeDebuffs["test-aura"].charges <= 2);
  });

  it("are not used by DoT ticks", () => {
    const { sim } = fresh();
    sim.applyAura(charged());
    const interval = k("rupture.tickInterval");
    sim.activeDots.rupture = {
      name: "Rupture",
      duration: interval * 3,
      tickInterval: interval,
      timeUntilNextTick: interval,
      tickDamage: TICK_DAMAGE,
      icon: null,
    };
    sim.step(interval);
    assert.ok(sim.damageDone > 0);
    assert.equal(sim.activeDebuffs["test-aura"].charges, 3);
  });

  it("are restored by a new application, which refreshes the duration", () => {
    const { sim } = fresh();
    const aura = charged();
    sim.applyAura(aura);
    hit(sim);
    hit(sim);
    assert.equal(sim.activeDebuffs["test-aura"].charges, 1);
    const again = sim.applyAura(aura);
    assert.equal(again.charges, 3);
    assert.equal(again.stacks, 2);
  });

  it("do not change what a hit does", () => {
    const { sim: plain } = fresh();
    const { sim: withCharges } = fresh();
    withCharges.applyAura(charged());
    assert.equal(hit(withCharges).damage, hit(plain).damage);
  });

  it("are used with consumeCharge, which leaves the stacks alone", () => {
    const { sim } = fresh();
    sim.applyAura(charged(), { stacks: 2 });
    assert.equal(sim.consumeCharge("test-aura"), 2);
    assert.equal(sim.consumeCharge("test-aura", 1), 1);
    assert.equal(sim.activeDebuffs["test-aura"].stacks, 2);
    assert.equal(sim.consumeCharge("test-aura", 5), 0);
    assert.equal(sim.hasAura("test-aura"), false);
    assert.equal(sim.consumeCharge("test-aura"), null);
  });

  it("run onExpire when the last one goes", () => {
    const { sim } = fresh();
    const onExpire = mock.fn();
    const aura = define({
      target: "target",
      duration: 10,
      charges: 1,
      onExpire,
    });
    sim.applyAura(aura);
    hit(sim);
    assert.equal(onExpire.mock.callCount(), 1);
  });

  it("are null for an aura without them, and an unknown id", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.hemorrhage);
    assert.equal(sim.consumeCharge("hemorrhage"), null);
    assert.equal(sim.consumeCharge("no-such-aura"), null);
    assert.equal(sim.hasAura("hemorrhage"), true);
    for (const bad of [0, -1, 1.5, NaN, "1"]) {
      assert.throws(() => sim.consumeCharge("hemorrhage", bad), RangeError);
    }
  });

  it("draw no random numbers", () => {
    const { sim } = fresh();
    sim.applyAura(charged());
    const draws = mock.fn(testRng);
    sim.rng = draws;
    sim.consumeCharge("test-aura");
    sim.consumeHitCharges();
    assert.equal(draws.mock.callCount(), 0);
  });

  it("end with their duration when unused", () => {
    const { sim } = fresh();
    sim.applyAura(charged());
    stepFor(sim, 10);
    assert.equal(sim.hasAura("test-aura"), false);
  });
});

describe("Expose Armor", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("exists as a target debuff in the data, read from the constants", () => {
    const aura = AURAS.exposeArmor;
    assert.equal(aura.id, "expose-armor");
    assert.equal(aura.name, "Expose Armor");
    assert.equal(aura.target, "target");
    assert.equal(aura.duration, k("exposeArmor").duration);
    assert.equal(aura.duration, 30);
    assert.equal(aura.maxStacks, k("combo.max"));
    assert.equal(aura.stackRule, "highest");
    assert.equal(
      aura.effects.armorReduction,
      k("exposeArmor").armorPerComboPoint,
    );
    assert.equal(aura.effects.armorReduction, 450);
    assert.equal(auraRegistry().get("expose-armor"), aura);
    assert.equal(abilityCatalogue.get("expose-armor").name, aura.name);
    assert.ok(EFFECT_KINDS.includes("armorReduction"));
  });

  it("matches the snapshot's rank 5 numbers", () => {
    const ability = abilityCatalogue.get("expose-armor");
    assert.equal(ability.perComboPoint.length, AURAS.exposeArmor.maxStacks);
    for (const row of ability.perComboPoint) {
      assert.equal(
        row.armorReduction,
        AURAS.exposeArmor.effects.armorReduction * row.comboPoints,
      );
    }
    assert.match(ability.text, /for 30 sec/);
  });

  it("takes 450 armor off for each combo point and lets more through", () => {
    const { sim: plain } = fresh();
    const base = hit(plain).damage;
    let last = base;
    for (let points = 1; points <= k("combo.max"); points += 1) {
      const { sim } = fresh();
      sim.applyAura(AURAS.exposeArmor, { stacks: points });
      const damage = hit(sim).damage;
      assert.ok(damage > last, `${points} point(s) beats ${points - 1}`);
      last = damage;
      const armor = k("target.armor") - 450 * points;
      assert.equal(
        sim.armorMultiplier(),
        withConstant("target.armor", armor, () => plain.armorMultiplier()),
      );
    }
  });

  it("never takes armor below 0", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.exposeArmor, { stacks: k("combo.max") });
    withConstant("target.armor", 100, () => {
      const open = withConstant("target.armor", 0, () => sim.armorMultiplier());
      assert.equal(sim.armorMultiplier(), open);
    });
  });

  it("does not touch bleed or nature ticks, which ignore armor", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.exposeArmor, { stacks: k("combo.max") });
    const interval = k("rupture.tickInterval");
    sim.activeDots.rupture = {
      name: "Rupture",
      duration: interval,
      tickInterval: interval,
      timeUntilNextTick: interval,
      tickDamage: TICK_DAMAGE,
      icon: null,
      bleed: true,
    };
    sim.step(interval);
    assert.equal(sim.damageDone, TICK_DAMAGE);
  });

  it("keeps the stronger cast and lasts 30 s from the last one", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.exposeArmor, { stacks: 5 });
    stepFor(sim, 20);
    const weaker = sim.applyAura(AURAS.exposeArmor, { stacks: 2 });
    assert.equal(weaker.stacks, 5);
    assert.equal(weaker.duration, 30);
    stepFor(sim, 30 - STEP);
    assert.equal(sim.hasAura("expose-armor"), true);
    stepFor(sim, STEP);
    assert.equal(sim.hasAura("expose-armor"), false);
    assert.equal(sim.armorMultiplier(), fresh().sim.armorMultiplier());
  });

  it("changes nothing when it is not up", () => {
    const { sim } = fresh();
    const open = withConstant("target.armor", k("target.armor"), () =>
      sim.armorMultiplier(),
    );
    assert.equal(sim.armorMultiplier(), open);
    assert.deepEqual(sim.auraEffects("armorReduction"), []);
  });
});

describe("Deadly Poison debuff", () => {
  it("exists as a target debuff in the data, read from the constants", () => {
    const aura = AURAS.deadlyPoison;
    assert.equal(aura.id, "deadly-poison");
    assert.equal(aura.name, "Deadly Poison");
    assert.equal(aura.target, "target");
    assert.equal(aura.duration, k("poison.deadly").duration);
    assert.equal(aura.duration, 12);
    assert.equal(aura.maxStacks, k("poison.deadly").stacks);
    assert.equal(aura.maxStacks, 5);
    assert.equal(aura.stackRule, "add");
    assert.equal(auraRegistry().get("deadly-poison"), aura);
    assert.deepEqual({ ...aura.effects }, {});
  });

  it("gains a stack and a fresh 12 s for each proc, up to 5", () => {
    const { sim } = fresh();
    for (let proc = 1; proc <= 7; proc += 1) {
      const applied = sim.applyAura(AURAS.deadlyPoison);
      assert.equal(applied.stacks, Math.min(proc, 5));
      assert.equal(applied.duration, 12);
      stepFor(sim, 1);
    }
    stepFor(sim, 12 - 1 - STEP);
    assert.equal(sim.hasAura("deadly-poison"), true);
    stepFor(sim, STEP);
    assert.equal(sim.hasAura("deadly-poison"), false);
  });

  it("changes no damage by itself", () => {
    const { sim: plain } = fresh();
    const { sim } = fresh();
    sim.applyAura(AURAS.deadlyPoison, { stacks: 5 });
    assert.equal(hit(sim).damage, hit(plain).damage);
    assert.equal(
      tickDamage("deadly-poison", { hemorrhage: true }),
      tickDamage("deadly-poison"),
    );
  });
});

describe("inherited names", () => {
  it("are not auras", () => {
    const { sim } = fresh();
    for (const name of INHERITED) {
      assert.equal(sim.hasAura(name), false, name);
      assert.equal(sim.consumeCharge(name), null, name);
    }
  });

  it("cannot be auraEffects kinds", () => {
    const { sim } = fresh();
    for (const name of INHERITED) {
      assert.throws(() => sim.auraEffects(name), /unknown effect kind/, name);
    }
    assert.throws(() => sim.auraEffects("no-such-kind"), RangeError);
    assert.throws(() => sim.auraEffects(), RangeError);
  });

  it("cannot be effects of a definition", () => {
    for (const name of INHERITED) {
      const effects = JSON.parse(`{ "${name}": 1 }`);
      assert.throws(() => define({ effects }), /unknown effect/, name);
    }
    const inheriting = Object.create({ haste: 0.5 });
    assert.throws(() => define({ effects: inheriting }), /plain object/);
    assert.throws(() => define({ effects: [] }), /plain object/);
    assert.throws(() => define({ effects: null }), /plain object/);
  });

  it("are not skipped by auraEffects when a definition inherits them", () => {
    const { sim } = fresh();
    for (const aura of auraRegistry().values()) {
      assert.equal(Object.hasOwn(aura.effects, "toString"), false);
    }
    assert.deepEqual(sim.auraEffects("haste"), []);
  });

  it("are not weapon hands", () => {
    for (const name of INHERITED) {
      assert.throws(
        () => new Weapon(null, 1, 2, 1.8, name),
        { name: "RangeError", message: /Weapon hand must be/ },
        name,
      );
    }
    assert.equal(new Weapon(null, 1, 2, 1.8, "main").attack.id, "main-hand");
  });

  it("do not stop an aura with that id from being applied", () => {
    const { sim } = fresh();
    const odd = define({
      id: "constructor",
      target: "target",
      duration: 5,
      maxStacks: 3,
    });
    assert.equal(sim.applyAura(odd).stacks, 1);
    assert.equal(sim.applyAura(odd).stacks, 2);
    assert.equal(sim.hasAura("constructor"), true);
  });
});

describe("unknown effect kinds", () => {
  it("throw when an aura is defined, naming the aura and the kinds", () => {
    assert.throws(
      () => define({ effects: { hasste: 0.2 } }),
      /test-aura.*unknown effect "hasste".*Known: haste/,
    );
    assert.throws(
      () => define({ effects: { haste: 0.2, nope: 1 } }),
      /unknown effect "nope"/,
    );
  });

  it("are checked for armorReduction values too", () => {
    for (const value of [0, -450, NaN, "450", Infinity]) {
      assert.throws(
        () => define({ effects: { armorReduction: value } }),
        /armorReduction|finite/,
        String(value),
      );
    }
    assert.equal(
      define({ effects: { armorReduction: 450 } }).effects.armorReduction,
      450,
    );
  });
});
