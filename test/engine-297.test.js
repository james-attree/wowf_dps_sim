import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { attackChances, deriveAttackTable } from "../js/attack-resolver.js";
import { runOnCore } from "../js/core/fight.js";
import { Rogue } from "../js/rogue.js";
import { normalizeConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";

const DURATION = 30;

function fight(config) {
  const rogue = new Rogue(normalizeConfig(config));
  const simulation = new Simulation(rogue, { seed: 1 });
  runOnCore(simulation, DURATION);
  return simulation;
}

describe("empty off hand (#297 PR3)", () => {
  it("refuses an empty main hand", () => {
    assert.throws(
      () => normalizeConfig({ weapons: { mainHand: null } }),
      (error) =>
        error instanceof TypeError &&
        error.message === "Equip a main-hand weapon.",
    );
  });

  it("runs main hand only, with no off-hand swings, poison or dual-wield miss", () => {
    const both = fight({
      poisons: { mainHand: "instant", offHand: "instant" },
    });
    const one = fight({
      weapons: { offHand: null },
      poisons: { mainHand: "instant", offHand: "instant" },
    });
    assert.equal(one.rogue.weapons.offHand, null);
    assert.equal(one.abilityStats["off-hand"], undefined);
    assert.ok(one.abilityStats["main-hand"].casts > 0);
    assert.ok(one.abilityStats["main-hand"].damage > 0);
    assert.equal(
      one.combatLog.some((row) => row.name === "Off-hand"),
      false,
    );
    const offPoison = (sim) =>
      sim.rogue.procs.filter((proc) => String(proc.id).includes("offHand"));
    assert.ok(offPoison(both).length > 0);
    assert.equal(offPoison(one).length, 0);
    assert.equal(one.attackTable.dualWieldPenalty, 0);
    assert.equal(
      both.attackTable.dualWieldPenalty,
      k("attackTable.dualWieldPenalty"),
    );
    const dropped = attackChances({
      attackType: "weapon",
      bonusHitChance: 0,
      critChance: 0,
      table: both.attackTable,
    }).miss;
    const kept = attackChances({
      attackType: "weapon",
      bonusHitChance: 0,
      critChance: 0,
      table: one.attackTable,
    }).miss;
    assert.ok(
      Math.abs(dropped - kept - k("attackTable.dualWieldPenalty")) < 1e-12,
    );
  });
});

describe("weapon skill per hand (#297 PR3)", () => {
  it("changes glancing and miss for that hand only", () => {
    const low = deriveAttackTable({ weaponSkill: 300 });
    const high = deriveAttackTable({ weaponSkill: 305 });
    assert.notEqual(low.miss, high.miss);
    assert.notEqual(low.glancingDamage.low, high.glancingDamage.low);
    const simulation = fight({
      weapons: {
        mainHand: { weaponSkill: 300 },
        offHand: { weaponSkill: 305 },
      },
    });
    assert.equal(simulation.attackTables.mainHand.miss, low.miss);
    assert.equal(
      simulation.attackTables.mainHand.glancingDamage.low,
      low.glancingDamage.low,
    );
    assert.equal(simulation.attackTables.offHand.miss, high.miss);
    assert.equal(
      simulation.attackTables.offHand.glancingDamage.low,
      high.glancingDamage.low,
    );
    assert.notEqual(
      simulation.attackTables.mainHand.miss,
      simulation.attackTables.offHand.miss,
    );
  });
});

describe("expertise (#297 PR3)", () => {
  it("reduces dodge at 10 rating per 1% and is 0 when omitted", () => {
    const plain = fight({});
    const rated = fight({ character: { expertise: 10 } });
    assert.equal(plain.expertiseReduction, 0);
    assert.equal(rated.expertiseReduction, 0.01);
    const table = plain.attackTable;
    const before = attackChances({
      attackType: "weapon",
      bonusHitChance: 0,
      critChance: 0,
      table,
    }).dodge;
    const after = attackChances({
      attackType: "weapon",
      bonusHitChance: 0,
      critChance: 0,
      table,
      dodgeReduction: rated.expertiseReduction,
    }).dodge;
    assert.ok(Math.abs(before - after - 0.01) < 1e-12);
  });

  it("leaves a default fight unchanged when the new inputs are the old values", () => {
    const today = fight({});
    const spelled = fight({
      character: { expertise: 0 },
      weapons: {
        mainHand: { weaponSkill: 300 },
        offHand: { weaponSkill: 300 },
      },
    });
    assert.equal(spelled.damageDone, today.damageDone);
    assert.deepEqual(spelled.abilityStats, today.abilityStats);
    assert.equal(today.rogue.config.character.expertise, undefined);
    assert.equal(today.rogue.config.weapons.mainHand.weaponSkill, undefined);
  });
});

describe("config round trip (#297 PR3)", () => {
  it("keeps a null off hand and an omitted expertise", () => {
    const config = normalizeConfig({ weapons: { offHand: null } });
    assert.equal(config.weapons.offHand, null);
    assert.equal(config.character.expertise, undefined);
    assert.deepEqual(normalizeConfig(config).weapons.offHand, null);
  });
});

describe("Q7 not-modelled tag (#297 PR3)", () => {
  it("records the coordinator call next to the not-modelled list", () => {
    const source = readFileSync(
      new URL("../js/gear-derive.js", import.meta.url),
      "utf8",
    );
    const at = source.indexOf("const notModelled");
    assert.ok(at > 0);
    assert.match(
      source.slice(at - 200, at),
      /coordinator call 15 Nov \(James delegated\)/,
    );
  });
});
