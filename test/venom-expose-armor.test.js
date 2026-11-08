// removed talent / pending Venom ability (see talent-effects pending tags).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { attackChances } from "../js/attack-resolver.js";
import { AURAS, defineAura } from "../js/auras.js";
import { Rogue } from "../js/rogue.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { validateRotation } from "../js/rotation-validator.js";
import { normalizeConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { FULL_COVERAGE_TREES } from "../scripts/talent-coverage.mjs";
import { coreHost } from "./core-host.js";
import { quiet } from "./quiet.js";

// Issue #268 (P4.6-04b): Venom, Expose Armor and Improved Expose Armor, one
// test per row A9-A12 of the issue, and gates G2 and G4.

const VENOM = "assassination.venom";
const IEA = "assassination.improved-expose-armor";
// 33 points in rows 1-5, so Venom's row 7 (30 above) is open. None of them
// draws a number or changes a poison's chance or damage, except Vile Poisons
// (+20%) and Improved Poisons (+10 points), the two A9 and A10 combine with.
// No Ruthlessness or Relentless Strikes: their finisher procs would draw.
const ROWS_ABOVE = {
  "assassination.improved-gouge": 3,
  "assassination.remorseless-attacks": 2,
  "assassination.malice": 5,
  "assassination.improved-slice-and-dice": 3,
  [IEA]: 2,
  "assassination.vile-poisons": 5,
  "assassination.cold-blood": 1,
  "assassination.improved-poisons": 5,
  "assassination.vigor": 2,
  "assassination.improved-kidney-shot": 2,
};
const TALENTED = { ...ROWS_ABOVE, [VENOM]: 1 };
const BOTH = { mainHand: "instant", offHand: "deadly" };
const EA_ARMOR = [450, 900, 1350, 1800, 2250];
const SERRATED = 0.09;
// 3731 armor, less 2250, then 9% of the rest ignored: 1481 × 0.91 = 1347.71.
// 1 - 1347.71 / (1347.71 + 400 + 85 × 60), in the engine's order.
const EA5_ARMOR = 1481 * 0.91;
const EA5_SERRATED_MULTIPLIER = 1 - EA5_ARMOR / (EA5_ARMOR + 5500);

// Expose Armor rolls the yellow table (#268, B1): a draw this high lands it.
const HIT = 0.99;
const MISS = 0;

function harness({
  talents = TALENTED,
  poisons = BOTH,
  modifiers,
  roll = HIT,
} = {}) {
  const draws = [];
  const rogue = new Rogue(
    { talents, poisons },
    modifiers === undefined ? {} : { modifiers },
  );
  quiet(rogue);
  rogue.energy = rogue.maxEnergy;
  const simulation = new Simulation(rogue, {
    rng() {
      draws.push(true);
      return roll;
    },
  });
  return { rogue, simulation, draws };
}

function poisonChances({ rogue, simulation }) {
  return rogue.procs
    .filter((proc) => proc.id.includes("poison"))
    .map((proc) => [proc.id, simulation.procs.chanceOf(proc, {})]);
}

function cast(h, key, points) {
  h.rogue.comboPoints = points;
  h.rogue.energy = h.rogue.maxEnergy;
  h.simulation.gcd = 0;
  return h.rogue.abilities[key].cast(h.rogue, h.simulation);
}

// The 25-energy Venom finisher is retired (#334). These tests cover Expose
// Armor, which stayed. Venom's aura is in test/tr-05-venom-poised.test.js.
describe("Expose Armor as data (#268)", () => {
  it("Expose Armor: a baseline finisher, 25 energy, 450 per CP for 30 s", () => {
    const entry = ABILITY_DEFINITIONS.find(({ id }) => id === "expose-armor");
    assert.ok(entry);
    assert.equal(entry.spend.resource, "comboPoints");
    const row = k("exposeArmor");
    const spell = abilityCatalogue.get("expose-armor");
    assert.equal(row.energy, spell.cost.amount);
    assert.equal(row.energy, 25);
    assert.equal(row.armorPerComboPoint, 450);
    assert.equal(row.duration, 30);
    // B1: an attack on the yellow table with no damage, like a DoT's
    // application: no crit roll.
    assert.equal(entry.damage.kind, "attackOnly");
    assert.equal(entry.cost.refund, "skill.missEnergyRefund");
    assert.equal(
      new Rogue().lockedByBuild(new Rogue().abilities.exposeArmor),
      false,
    );
  });

  it("is in the builder palette, and a rule for it validates", () => {
    assert.equal(castableAbilities().includes("venom"), false);
    assert.ok(castableAbilities().includes("expose-armor"));
    const rotation = {
      schemaVersion: 1,
      name: "Expose Armor",
      rules: [{ action: "expose-armor", conditions: [] }],
    };
    assert.deepEqual(validateRotation(rotation), []);
    assert.ok(
      validateRotation({
        schemaVersion: 1,
        name: "retired Venom finisher",
        rules: [{ action: "venom", conditions: [] }],
      }).length > 0,
    );
  });

  it("Assassination is a full-coverage tree", () => {
    assert.ok(FULL_COVERAGE_TREES.includes("assassination"));
  });
});

describe("poison chance still caps, with no Venom finisher", () => {
  it("is capped at poison.chanceCap", () => {
    const h = harness({
      talents: {},
      modifiers: [{ kind: "poisonChance", op: "add", value: 0.95 }],
    });
    assert.deepEqual(
      poisonChances(h).map(([, chance]) => chance),
      [k("poison.chanceCap"), k("poison.chanceCap")],
    );
  });
});

describe("A11: Expose Armor, Improved Expose Armor and the armor order", () => {
  it("takes 450 armor per CP for 30 s ", () => {
    for (const [index, armor] of EA_ARMOR.entries()) {
      const h = harness({ talents: {} });
      cast(h, "exposeArmor", index + 1);
      const aura = h.simulation.activeDebuffs["expose-armor"];
      assert.equal(aura.duration, 30);
      assert.equal(aura.stacks * k("exposeArmor").armorPerComboPoint, armor);
    }
  });

  it("5 CP Expose Armor plus a 9% ignore: an exact multiplier on 3731 armor ", () => {
    const h = harness({
      talents: {},
      modifiers: [{ kind: "armorIgnore", op: "add", value: SERRATED }],
    });
    assert.equal(k("target.armor"), 3731);
    cast(h, "exposeArmor", 5);
    assert.equal(h.simulation.armorMultiplier({}), EA5_SERRATED_MULTIPLIER);
  });

  it("floors the armor at 0 ", () => {
    const h = harness({ talents: {} });
    const sunder = defineAura({
      id: "test-armor-reduction",
      name: "Test armor reduction",
      target: "target",
      effects: { armorReduction: k("target.armor") },
    });
    cast(h, "exposeArmor", 5);
    h.simulation.applyAura(sunder, { duration: 30 });
    assert.equal(h.simulation.armorMultiplier({}), 1);
  });

  it("Improved Expose Armor: -5/-10 energy, 1/2 CP back only at 5 CP ", () => {
    const base = k("exposeArmor").energy;
    for (const [rank, saved, refund] of [
      [0, 0, 0],
      [1, 5, 1],
      [2, 10, 2],
    ]) {
      const talents = rank === 0 ? {} : { ...ROWS_ABOVE, [IEA]: rank };
      for (const points of [1, 2, 3, 4, 5]) {
        const h = harness({ talents });
        cast(h, "exposeArmor", points);
        assert.equal(h.rogue.energy, h.rogue.maxEnergy - (base - saved));
        assert.equal(h.rogue.comboPoints, points === 5 ? refund : 0);
      }
    }
  });

  it("Improved Expose Armor's numbers are its rank text's ", () => {
    const [cost, refund] = TALENT_EFFECTS[IEA].modifiers;
    assert.deepEqual(cost.values, [-5, -10]);
    assert.deepEqual(cost.scope, { abilities: ["expose-armor"] });
    assert.deepEqual(refund.values, [1, 2]);
    assert.equal(refund.kind, "comboRefund");
  });
});

describe("A12: Expose Armor and Sunder: the highest reduction wins", () => {
  it("a weaker Expose Armor neither replaces nor refreshes a stronger one ", () => {
    const h = harness({ talents: {} });
    cast(h, "exposeArmor", 5);
    h.simulation.activeDebuffs["expose-armor"].duration = 12;
    cast(h, "exposeArmor", 2);
    assert.equal(h.simulation.activeDebuffs["expose-armor"].stacks, 5);
    assert.equal(h.simulation.activeDebuffs["expose-armor"].duration, 12);
    assert.equal(AURAS.exposeArmor.stackRule, "highest");
  });

  it("no preset casts Expose Armor ", async () => {
    const { ROTATION_PRESETS } = await import("../data/rotation-presets.js");
    const actions = JSON.stringify(ROTATION_PRESETS);
    assert.equal(actions.includes('"expose-armor"'), false);
    // The Venom finisher is gone from the live presets (#334).
    assert.equal(actions.includes('"venom"'), false);
  });
});

describe("B1: Expose Armor rolls the yellow attack table", () => {
  const PROCS = {
    ...ROWS_ABOVE,
    "assassination.ruthlessness": 3,
    "assassination.relentless-strikes": 1,
  };
  function chances(h) {
    const ability = h.rogue.abilities.exposeArmor;
    const context = h.simulation.attackContext(ability, "skill");
    return attackChances({
      attackType: "skill",
      bonusHitChance: h.rogue.getBonusHitChance(context),
      critChance: 0,
      canCrit: false,
      behind: h.rogue.config.target.behind,
    });
  }

  it("a landed cast takes one draw, the table roll, and logs a hit ", () => {
    const h = harness({ talents: {} });
    const result = cast(h, "exposeArmor", 5);
    assert.equal(result.outcome, "hit");
    assert.equal(result.damage, 0);
    assert.equal(h.draws.length, 1);
    assert.equal(h.simulation.activeDebuffs["expose-armor"].stacks, 5);
  });

  for (const outcome of ["miss", "dodge"]) {
    it(`a ${outcome} keeps the CP, refunds 80%, and puts up nothing `, () => {
      const probe = harness({ talents: PROCS });
      const { miss, dodge } = chances(probe);
      assert.ok(miss > 0 && dodge > 0);
      const roll = outcome === "miss" ? MISS : miss + dodge / (1 + 1);
      const h = harness({ talents: PROCS, roll });
      const result = cast(h, "exposeArmor", 5);
      assert.equal(result.outcome, outcome);
      // Improved Expose Armor 2/2: 15 energy, 80% of it back.
      const cost = h.rogue.abilities.exposeArmor.costNow(h.simulation);
      assert.equal(cost, k("exposeArmor").energy - 10);
      assert.equal(
        h.rogue.energy,
        h.rogue.maxEnergy - cost + cost * k("skill.missEnergyRefund"),
      );
      // No CP spent, no IEA refund, no Ruthlessness or Relentless Strikes.
      assert.equal(h.rogue.comboPoints, 5);
      assert.equal(h.simulation.hasAura("expose-armor"), false);
      assert.equal(h.simulation.activeDebuffs["expose-armor"], undefined);
      assert.equal(h.draws.length, 1);
    });
  }
});

describe("B2: a weaker Expose Armor leaves a stronger one alone", () => {
  // Casts at the given times on the event core; returns when the debuff
  // expired and the stacks it held.
  function onEvents(casts) {
    const rogue = new Rogue({ talents: {} });
    quiet(rogue);
    const sim = new Simulation(rogue, { rng: () => HIT });
    const expiries = [];
    sim.on("aura", (event) => {
      if (event.aura === "expose-armor" && event.change === "expire") {
        expiries.push(sim.currentTime);
      }
    });
    const host = coreHost(sim, { endTime: 60, swings: false });
    const seen = [];
    for (const [time, points] of casts) {
      host.at(time, () => {
        rogue.comboPoints = points;
        rogue.energy = rogue.maxEnergy;
        sim.gcd = 0;
        rogue.abilities.exposeArmor.cast(rogue, sim);
        const aura = sim.activeDebuffs["expose-armor"];
        seen.push([rogue.comboPoints, rogue.energy, aura.stacks]);
      });
    }
    host.run();
    return { expiries, seen };
  }
  const SPENT = k("exposeArmor").energy;

  it("5 CP then 2 CP: the 5 stacks still expire at their own time ", () => {
    const { expiries, seen } = onEvents([
      [0, 5],
      [10, 2],
    ]);
    assert.deepEqual(expiries, [30]);
    // The 2 CP cast still costs its energy and spends its points.
    assert.deepEqual(seen[1], [0, new Rogue().maxEnergy - SPENT, 5]);
  });

  it("an equal cast refreshes, a stronger one replaces ", () => {
    assert.deepEqual(
      onEvents([
        [0, 5],
        [10, 5],
      ]).expiries,
      [40],
    );
    const { expiries, seen } = onEvents([
      [0, 2],
      [10, 5],
    ]);
    assert.deepEqual(expiries, [40]);
    assert.equal(seen[1][2], 5);
  });
});

describe("G2 and G4 (#268)", () => {
  it("at 0 points: no Venom, no refund, and only the table roll ", () => {
    const h = harness({ talents: {} });
    assert.equal(h.rogue.granted.has("venom"), false);
    cast(h, "exposeArmor", 5);
    assert.equal(h.rogue.comboPoints, 0);
    assert.equal(h.draws.length, 1);
  });

  it("Expose Armor draws only its table roll ", () => {
    const h = harness({ talents: {} });
    assert.equal(h.rogue.abilities.venom, undefined);
    cast(h, "exposeArmor", 5);
    assert.equal(h.draws.length, 1);
  });

  it("an old config without Venom or Improved Expose Armor reads as 0 points ", () => {
    const config = normalizeConfig({ talents: { "assassination.malice": 5 } });
    assert.equal(config.talents[VENOM] ?? 0, 0);
    assert.equal(config.talents[IEA] ?? 0, 0);
    const rogue = new Rogue(config);
    assert.equal(rogue.granted.has("venom"), false);
    assert.equal(
      rogue.abilities.exposeArmor.costNow(new Simulation(rogue)),
      k("exposeArmor").energy,
    );
  });
});

describe("chanceBonus on a proc (#268)", () => {
  const base = {
    id: "test-bonus",
    trigger: "onHit",
    chance: { mode: "flat", value: 0.2 },
    actions: [{ type: "gainResource", resource: "energy", amount: 1 }],
  };
  it("is checked when the data loads ", async () => {
    const { defineProc } = await import("../js/procs.js");
    const bonus = { kind: "poisonChance", cap: 1, points: 100 };
    assert.deepEqual(
      defineProc({ ...base, chanceBonus: bonus }).chanceBonus,
      bonus,
    );
    assert.equal(Object.hasOwn(defineProc(base), "chanceBonus"), false);
    assert.throws(
      () => defineProc({ ...base, chanceBonus: { ...bonus, kind: "nope" } }),
      /unknown modifier kind/,
    );
    assert.throws(
      () =>
        defineProc({
          ...base,
          chance: { mode: "ppm", value: 1 },
          chanceBonus: bonus,
        }),
      /needs a flat chance/,
    );
  });
});
