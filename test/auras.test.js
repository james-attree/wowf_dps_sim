import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { abilityCatalogue } from "../js/abilities.js";
import {
  AURAS,
  EFFECT_KINDS,
  REFRESH_RULES,
  auraRegistry,
  defineAura,
} from "../js/auras.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

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

function primeDot(sim, id, name) {
  const tickInterval = k("rupture.tickInterval");
  sim.activeDots[id] = {
    name,
    duration: tickInterval,
    tickInterval,
    timeUntilNextTick: tickInterval,
    tickDamage: 100,
    icon: null,
  };
  return tickInterval;
}

describe("aura definitions", () => {
  it("validates and freezes a definition", () => {
    const aura = define({ effects: { haste: 0.2 }, duration: 5 });
    assert.equal(aura.id, "test-aura");
    assert.equal(aura.target, "self");
    assert.equal(aura.refresh, "refresh");
    assert.equal(aura.maxStacks, 1);
    assert.ok(Object.isFrozen(aura));
    assert.ok(Object.isFrozen(aura.effects));
  });

  it("rejects a definition with a typo, at load", () => {
    const bad = [
      [{ id: "", name: "x" }, /non-empty string id/],
      [{ id: "x", name: "" }, /display name/],
      [{ target: "enemy" }, /target must be/],
      [{ refresh: "stack" }, /refresh must be/],
      [{ maxStacks: 0 }, /maxStacks/],
      [{ maxStacks: 1.5 }, /maxStacks/],
      [{ duration: 0 }, /duration must be above 0/],
      [{ duration: Number.NaN }, /duration must be above 0/],
      [{ onApply: "yes" }, /onApply must be a function/],
      [{ onExpire: 1 }, /onExpire must be a function/],
      [{ effects: { hast: 0.2 } }, /unknown effect "hast"/],
      [{ effects: { haste: "fast" } }, /finite number/],
      [{ effects: { energyRegenMultiplier: 0 } }, /above 0/],
      [{ effects: { dotDamageTaken: 0.2 } }, /dotDamageTaken needs/],
      [
        { effects: { dotDamageTaken: { ids: [], bonus: 0.2 } } },
        /dotDamageTaken needs/,
      ],
      [
        { effects: { dotDamageTaken: { ids: ["rupture"] } } },
        /dotDamageTaken needs/,
      ],
    ];
    for (const [spec, pattern] of bad) {
      assert.throws(() => define(spec), pattern, JSON.stringify(spec));
    }
    assert.throws(() => defineAura(), TypeError);
  });

  it("lists the effect kinds and refresh rules the engine knows", () => {
    assert.deepEqual(
      [...EFFECT_KINDS],
      ["haste", "energyRegenMultiplier", "dotDamageTaken"],
    );
    assert.deepEqual(
      [...REFRESH_RULES],
      ["refresh", "extend", "replace-if-longer"],
    );
  });

  it("gives the catalogue's id and name to every aura an ability applies", () => {
    for (const [key, aura] of Object.entries(AURAS)) {
      const ability = abilityCatalogue.get(aura.id);
      assert.ok(ability, `${key} is not in the ability catalogue`);
      assert.equal(ability.name, aura.name, key);
    }
    assert.deepEqual(
      [...auraRegistry().keys()],
      Object.values(AURAS).map((a) => a.id),
    );
  });

  it("reads each number from the constants", () => {
    assert.equal(AURAS.sliceAndDice.effects.haste, k("sliceAndDice").haste);
    assert.equal(AURAS.bladeFlurry.effects.haste, k("bladeFlurry").haste);
    assert.equal(
      AURAS.adrenalineRush.effects.energyRegenMultiplier,
      k("adrenalineRush").regenMultiplier,
    );
    assert.equal(
      AURAS.hemorrhage.effects.dotDamageTaken.bonus,
      k("hemorrhage.ruptureBonus").bonus,
    );
    assert.deepEqual(
      [...AURAS.hemorrhage.effects.dotDamageTaken.ids],
      ["rupture"],
    );
    assert.equal(AURAS.hemorrhage.target, "target");
    assert.equal(AURAS.rupture.target, "target");
    assert.equal(AURAS.sliceAndDice.target, "self");
  });

  it("matches every skill's id and name to its aura and the catalogue", () => {
    const { rogue } = fresh();
    for (const skill of Object.values(rogue.abilities)) {
      const ability = abilityCatalogue.get(skill.id);
      assert.ok(ability, skill.id);
      assert.equal(ability.name, skill.name, skill.id);
      if (skill.aura) {
        assert.equal(skill.aura.id, skill.id);
      }
    }
  });
});

describe("applying an aura", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("puts a self aura in activeBuffs and a target aura in activeDebuffs, by id", () => {
    const { sim } = fresh();
    const buff = sim.applyAura(AURAS.sliceAndDice, { duration: 9 });
    const debuff = sim.applyAura(AURAS.hemorrhage);
    assert.equal(sim.activeBuffs["slice-and-dice"], buff);
    assert.equal(sim.activeDebuffs.hemorrhage, debuff);
    assert.equal(sim.activeBuffs.hemorrhage, undefined);
    assert.deepEqual(buff, {
      id: "slice-and-dice",
      name: "Slice and Dice",
      icon: null,
      duration: 9,
      stacks: 1,
    });
    assert.equal(debuff.duration, k("hemorrhage.ruptureBonus").duration);
    assert.equal(sim.hasAura("slice-and-dice"), true);
    assert.equal(sim.hasAura("hemorrhage"), true);
    assert.equal(sim.hasAura("blade-flurry"), false);
    assert.equal(sim.hasAura("no-such-aura"), false);
  });

  it("needs a duration above 0", () => {
    const { sim } = fresh();
    assert.throws(() => sim.applyAura(AURAS.sliceAndDice), RangeError);
    assert.throws(
      () => sim.applyAura(AURAS.sliceAndDice, { duration: 0 }),
      RangeError,
    );
    assert.deepEqual(sim.activeBuffs, {});
  });

  it("follows the refresh rule on a second application", () => {
    const { sim } = fresh();
    // The duration after 4 s, then 10 s, then 2 s are applied in turn.
    const rules = {
      refresh: [10, 2],
      extend: [14, 16],
      "replace-if-longer": [10, 10],
    };
    for (const [refresh, [afterLonger, afterShorter]] of Object.entries(
      rules,
    )) {
      const aura = define({ id: `${refresh}-aura`, refresh });
      sim.applyAura(aura, { duration: 4 });
      sim.applyAura(aura, { duration: 10 });
      assert.equal(sim.activeBuffs[aura.id].duration, afterLonger, refresh);
      sim.applyAura(aura, { duration: 2 });
      assert.equal(sim.activeBuffs[aura.id].duration, afterShorter, refresh);
    }
  });

  it("stacks up to maxStacks", () => {
    const { sim } = fresh();
    const aura = define({ maxStacks: 3, effects: { haste: 0.1 } });
    for (let n = 1; n <= 5; n += 1) {
      sim.applyAura(aura, { duration: 5 });
      assert.equal(sim.activeBuffs["test-aura"].stacks, Math.min(n, 3));
    }
    assert.equal(sim.auraEffects("haste")[0].stacks, 3);
  });

  it("calls onApply on a new aura and on a refresh, onExpire once it runs out", () => {
    const { sim } = fresh();
    const calls = [];
    const aura = define({
      onApply: (_sim, record, info) =>
        calls.push(["apply", record.duration, info.refreshed]),
      onExpire: (_sim, record) => calls.push(["expire", record.id]),
    });
    sim.applyAura(aura, { duration: 1 });
    sim.applyAura(aura, { duration: 1 });
    assert.deepEqual(calls, [
      ["apply", 1, false],
      ["apply", 1, true],
    ]);
    sim.step(1);
    assert.deepEqual(calls.at(-1), ["expire", "test-aura"]);
    assert.equal(calls.length, 3);
    assert.equal(sim.activeBuffs["test-aura"], undefined);
    sim.step(1);
    assert.equal(calls.length, 3);
  });

  it("lets a hook apply another aura without losing either", () => {
    const { sim } = fresh();
    const second = define({ id: "second", name: "Second" });
    const first = define({
      id: "first",
      name: "First",
      onExpire: (s) => s.applyAura(second, { duration: 5 }),
    });
    sim.applyAura(first, { duration: 1 });
    sim.step(1);
    assert.equal(sim.activeBuffs.first, undefined);
    assert.equal(sim.activeBuffs.second.duration, 5);
  });
});

describe("aura effects", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("returns only the effects of auras that are up, in registry order", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.bladeFlurry);
    sim.applyAura(AURAS.sliceAndDice, { duration: 8 });
    const haste = sim.auraEffects("haste");
    assert.deepEqual(
      haste.map((e) => e.id),
      ["slice-and-dice", "blade-flurry"],
    );
    assert.deepEqual(
      haste.map((e) => e.value),
      [k("sliceAndDice").haste, k("bladeFlurry").haste],
    );
    assert.deepEqual(sim.auraEffects("energyRegenMultiplier"), []);
    assert.deepEqual(sim.auraEffects("dotDamageTaken"), []);
  });

  it("ignores an aura with no time left", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.sliceAndDice, { duration: 8 });
    sim.activeBuffs["slice-and-dice"].duration = 0;
    assert.deepEqual(sim.auraEffects("haste"), []);
    assert.equal(sim.hasAura("slice-and-dice"), false);
  });

  it("speeds up swings from a new haste aura with no engine change", () => {
    setRoll(0.5);
    const swings = (aura) => {
      const rogue = new Rogue();
      const sim = new Simulation(rogue, { rng: testRng });
      if (aura) {
        sim.applyAura(aura, { duration: 1000 });
      }
      sim.run(10);
      return sim.abilityStats["main-hand"].casts;
    };
    const plain = swings(null);
    const hasted = swings(define({ effects: { haste: 1 } }));
    assert.ok(hasted > plain * 1.5, `${hasted} swings against ${plain}`);
  });

  it("multiplies energy regeneration for the part of a step an aura covers", () => {
    setRoll(0.5);
    const rate = k("energy.regenPerSecond");
    const plain = fresh();
    plain.rogue.energy = 0;
    plain.sim.step(1);
    const gained = plain.rogue.energy;
    assert.ok(gained > 0);

    const boosted = fresh();
    boosted.rogue.energy = 0;
    boosted.sim.applyAura(define({ effects: { energyRegenMultiplier: 2 } }), {
      duration: 0.5,
    });
    boosted.sim.step(1);
    // Half a second at the base rate, then half at double.
    const expected = (rate * 0.5 + rate * 2 * 0.5) * (gained / rate);
    assert.ok(Math.abs(boosted.rogue.energy - expected) < 1e-9);
    assert.ok(boosted.rogue.energy > gained);
  });

  it("raises a named DoT's ticks with dotDamageTaken, and no other", () => {
    setRoll(0.5);
    const tick = (id, name, aura) => {
      const { sim } = fresh();
      const interval = primeDot(sim, id, name);
      if (aura) {
        sim.applyAura(aura, { duration: 30 });
      }
      sim.step(interval);
      return sim.damageDone;
    };
    const bonus = define({
      target: "target",
      effects: { dotDamageTaken: { ids: ["garrote"], bonus: 0.5 } },
    });
    const plain = tick("garrote", "Garrote");
    assert.ok(plain > 0);
    assert.equal(tick("garrote", "Garrote", bonus), plain * 1.5);
    assert.equal(tick("rupture", "Rupture", bonus), tick("rupture", "Rupture"));
  });

  it("fails on a second definition under the same id", () => {
    const { sim } = fresh();
    sim.applyAura(AURAS.hemorrhage);
    const decoy = define({ id: "hemorrhage", name: "Hemorrhage" });
    assert.throws(
      () => sim.applyAura(decoy, { duration: 5 }),
      /second definition for the aura "hemorrhage"/,
    );
    assert.equal(sim.activeDebuffs.hemorrhage.stacks, 1);
  });
});

describe("the per-ability breakdown", () => {
  it("keys by id inside and by display name in the result", () => {
    const { rogue, sim } = fresh();
    rogue.energy = rogue.maxEnergy;
    sim.gcd = 0;
    rogue.abilities.bladeFlurry.cast(rogue, sim);
    assert.ok(sim.abilityStats["blade-flurry"]);
    assert.equal(sim.abilityNames["blade-flurry"], "Blade Flurry");
    const breakdown = sim.abilityBreakdown();
    assert.ok(breakdown["Blade Flurry"]);
    assert.equal(breakdown["blade-flurry"], undefined);
    assert.notEqual(
      breakdown["Blade Flurry"],
      sim.abilityStats["blade-flurry"],
    );
  });

  it("throws when two ids share a display name", () => {
    const { sim } = fresh();
    sim.abilityStats.one = { casts: 1 };
    sim.abilityStats.two = { casts: 1 };
    sim.abilityNames.one = "Same";
    sim.abilityNames.two = "Same";
    assert.throws(
      () => sim.abilityBreakdown(),
      /share the display name "Same"/,
    );
  });
});
