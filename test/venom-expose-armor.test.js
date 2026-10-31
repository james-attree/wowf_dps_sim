import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
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
  "assassination.murder": 2,
  "assassination.improved-slice-and-dice": 3,
  [IEA]: 2,
  "assassination.vile-poisons": 5,
  "assassination.cold-blood": 1,
  "assassination.improved-poisons": 5,
  "assassination.vigor": 2,
  "assassination.mutilate": 1,
  "assassination.improved-kidney-shot": 2,
};
const TALENTED = { ...ROWS_ABOVE, [VENOM]: 1 };
const BOTH = { mainHand: "instant", offHand: "deadly" };
// The exact chances A9 names, as literals so a float drift shows.
const INSTANT_IP = 0.3;
const INSTANT_IP_VENOM = 0.4;
const DEADLY_IP = 0.4;
const DEADLY_IP_VENOM = 0.5;
const INSTANT_VENOM = 0.3;
const DURATIONS = [9, 12, 15, 18, 21];
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

describe("Venom and Expose Armor as data (#268)", () => {
  it("Venom: a finisher granted by its talent, 25 energy, 9-21 s by CP", () => {
    const entry = ABILITY_DEFINITIONS.find(({ id }) => id === "venom");
    assert.ok(entry);
    assert.equal(entry.spend.resource, "comboPoints");
    assert.equal(TALENT_EFFECTS[VENOM].ability, "venom");
    const row = k("venom");
    const spell = abilityCatalogue.get("venom");
    assert.equal(row.energy, spell.cost.amount);
    assert.equal(row.energy, 25);
    assert.deepEqual(row.durationByCp, DURATIONS);
    assert.equal(row.poisonDamage, 1.3);
    assert.equal(row.poisonChance, 0.1);
    assert.equal(new Rogue({ talents: TALENTED }).granted.has("venom"), true);
    assert.equal(new Rogue().lockedByBuild(new Rogue().abilities.venom), true);
  });

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

  it("both are in the builder palette, and rules for them validate", () => {
    assert.ok(castableAbilities().includes("venom"));
    assert.ok(castableAbilities().includes("expose-armor"));
    const rotation = {
      schemaVersion: 1,
      name: "Venom, then Expose Armor",
      rules: [
        {
          action: "venom",
          conditions: [{ type: "abilityGranted", ability: "venom" }],
        },
        { action: "expose-armor", conditions: [] },
      ],
    };
    assert.deepEqual(validateRotation(rotation), []);
  });

  it("Assassination is a full-coverage tree", () => {
    assert.ok(FULL_COVERAGE_TREES.includes("assassination"));
  });
});

describe("A9: Venom adds 10 points to every poison's chance", () => {
  it("Instant 20 + 10 Improved Poisons + 10 Venom = 40%, exactly", () => {
    const h = harness();
    assert.deepEqual(poisonChances(h), [
      ["instant-poison.mainHand", INSTANT_IP],
      ["deadly-poison.offHand", DEADLY_IP],
    ]);
    cast(h, "venom", 5);
    assert.equal(h.simulation.hasAura("venom"), true);
    assert.deepEqual(poisonChances(h), [
      ["instant-poison.mainHand", INSTANT_IP_VENOM],
      ["deadly-poison.offHand", DEADLY_IP_VENOM],
    ]);
  });

  it("without Improved Poisons Venom alone gives 20 + 10 = 30%", () => {
    const plain = harness({ talents: {} });
    plain.simulation.applyAura(AURAS.venom, { duration: 9 });
    assert.equal(poisonChances(plain)[0][1], INSTANT_VENOM);
  });

  it("is capped at poison.chanceCap", () => {
    const h = harness({
      talents: {},
      modifiers: [{ kind: "poisonChance", op: "add", value: 0.95 }],
    });
    h.simulation.applyAura(AURAS.venom, { duration: 9 });
    assert.deepEqual(
      poisonChances(h).map(([, chance]) => chance),
      [k("poison.chanceCap"), k("poison.chanceCap")],
    );
  });

  it("ends with the aura", () => {
    const h = harness();
    cast(h, "venom", 1);
    h.simulation.activeBuffs.venom.duration = 0;
    assert.equal(poisonChances(h)[0][1], INSTANT_IP);
  });
});

describe("A10: Venom's +30% poison damage multiplies with Vile Poisons", () => {
  it("×1.2 (Vile Poisons 5/5) × 1.3 (Venom), not +50%", () => {
    const h = harness();
    const poison = { tags: ["poison"] };
    assert.equal(h.simulation.modifiers.resolve("damage", 100, poison), 120);
    cast(h, "venom", 5);
    const venomed = h.simulation.modifiers.resolve("damage", 100, poison);
    assert.equal(venomed, 100 * 1.2 * 1.3);
    assert.notEqual(venomed, 150);
    // Not a weapon strike's damage.
    assert.equal(
      h.simulation.modifiers.resolve("damage", 100, { tags: ["white"] }),
      100,
    );
  });

  it("lasts 9/12/15/18/21 s by combo points spent", () => {
    for (const [index, seconds] of DURATIONS.entries()) {
      const h = harness();
      cast(h, "venom", index + 1);
      assert.equal(h.simulation.activeBuffs.venom.duration, seconds);
      assert.equal(h.rogue.comboPoints, 0);
    }
  });

  it("the multiplier and the stacking are assumption rows (TBC)", () => {
    assert.equal(CONSTANTS["venom.stacking"].source, "assumption");
    assert.match(
      CONSTANTS["venom.stacking"].ref,
      /^James, 31 Oct 2026, issue #268: /,
    );
    // N2: the 9-21 s is the export's; only the x1.3 stacking is assumed.
    assert.doesNotMatch(CONSTANTS["venom.stacking"].ref, /9\/12\/15/);
    assert.equal(CONSTANTS.venom.source, "wowf-export");
    // N1: the export's key for Venom's spell has no rank.
    assert.ok(CONSTANTS.venom.ref.includes("spell_desc[Rogue|Venom|]"));
  });
});

describe("A11: Expose Armor, Improved Expose Armor and the armor order", () => {
  it("takes 450 armor per CP for 30 s", () => {
    for (const [index, armor] of EA_ARMOR.entries()) {
      const h = harness({ talents: {} });
      cast(h, "exposeArmor", index + 1);
      const aura = h.simulation.activeDebuffs["expose-armor"];
      assert.equal(aura.duration, 30);
      assert.equal(aura.stacks * k("exposeArmor").armorPerComboPoint, armor);
    }
  });

  it("5 CP Expose Armor plus a 9% ignore: an exact multiplier on 3731 armor", () => {
    const h = harness({
      talents: {},
      modifiers: [{ kind: "armorIgnore", op: "add", value: SERRATED }],
    });
    assert.equal(k("target.armor"), 3731);
    cast(h, "exposeArmor", 5);
    assert.equal(h.simulation.armorMultiplier({}), EA5_SERRATED_MULTIPLIER);
  });

  it("floors the armor at 0", () => {
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

  it("Improved Expose Armor: -5/-10 energy, 1/2 CP back only at 5 CP", () => {
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

  it("Improved Expose Armor's numbers are its rank text's", () => {
    const [cost, refund] = TALENT_EFFECTS[IEA].modifiers;
    assert.deepEqual(cost.values, [-5, -10]);
    assert.deepEqual(cost.scope, { abilities: ["expose-armor"] });
    assert.deepEqual(refund.values, [1, 2]);
    assert.equal(refund.kind, "comboRefund");
  });
});

describe("A12: Expose Armor and Sunder: the highest reduction wins", () => {
  it("a weaker Expose Armor neither replaces nor refreshes a stronger one", () => {
    const h = harness({ talents: {} });
    cast(h, "exposeArmor", 5);
    h.simulation.activeDebuffs["expose-armor"].duration = 12;
    cast(h, "exposeArmor", 2);
    assert.equal(h.simulation.activeDebuffs["expose-armor"].stacks, 5);
    assert.equal(h.simulation.activeDebuffs["expose-armor"].duration, 12);
    assert.equal(AURAS.exposeArmor.stackRule, "highest");
  });

  it("no preset casts Expose Armor", async () => {
    const { ROTATION_PRESETS } = await import("../data/rotation-presets.js");
    const actions = JSON.stringify(ROTATION_PRESETS);
    assert.equal(actions.includes('"expose-armor"'), false);
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

  it("a landed cast takes one draw, the table roll, and logs a hit", () => {
    const h = harness({ talents: {} });
    const result = cast(h, "exposeArmor", 5);
    assert.equal(result.outcome, "hit");
    assert.equal(result.damage, 0);
    assert.equal(h.draws.length, 1);
    assert.equal(h.simulation.activeDebuffs["expose-armor"].stacks, 5);
  });

  for (const outcome of ["miss", "dodge"]) {
    it(`a ${outcome} keeps the CP, refunds 80%, and puts up nothing`, () => {
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

  it("5 CP then 2 CP: the 5 stacks still expire at their own time", () => {
    const { expiries, seen } = onEvents([
      [0, 5],
      [10, 2],
    ]);
    assert.deepEqual(expiries, [30]);
    // The 2 CP cast still costs its energy and spends its points.
    assert.deepEqual(seen[1], [0, new Rogue().maxEnergy - SPENT, 5]);
  });

  it("an equal cast refreshes, a stronger one replaces", () => {
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
  it("at 0 points: no Venom, no refund, and only the table roll", () => {
    const h = harness({ talents: {} });
    assert.equal(h.rogue.granted.has("venom"), false);
    cast(h, "exposeArmor", 5);
    assert.equal(h.rogue.comboPoints, 0);
    assert.equal(h.draws.length, 1);
  });

  it("Venom draws nothing; Expose Armor draws only its table roll", () => {
    const h = harness();
    cast(h, "venom", 5);
    assert.equal(h.draws.length, 0);
    cast(h, "exposeArmor", 5);
    assert.equal(h.draws.length, 1);
  });

  it("an old config without Venom or Improved Expose Armor reads as 0 points", () => {
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
  it("is checked when the data loads", async () => {
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
