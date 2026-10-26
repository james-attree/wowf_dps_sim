import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

const FINISHERS = ["eviscerate", "rupture", "sliceAndDice"];

function prepare(comboPoints, energy) {
  const rogue = new Rogue();
  rogue.comboPoints = comboPoints;
  rogue.energy = energy;
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  const sim = new Simulation(rogue, { rng: testRng });
  sim.gcd = 0;
  return { rogue, sim };
}

function snapshot(rogue, sim) {
  return {
    energy: rogue.energy,
    comboPoints: rogue.comboPoints,
    gcd: sim.gcd,
    damageDone: sim.damageDone,
    log: sim.combatLog.length,
    buffs: Object.keys(sim.activeBuffs),
    debuffs: Object.keys(sim.activeDebuffs),
    dots: Object.keys(sim.activeDots),
    cooldowns: { ...sim.cooldowns },
  };
}

describe("finishers at 0 combo points", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  for (const id of FINISHERS) {
    it(`rejects ${id} without spending energy or combo points`, () => {
      const cost = k(id).energy;
      const { rogue, sim } = prepare(0, cost);
      const skill = rogue.abilities[id];
      const keptDuration = k("sliceAndDice").durationByCp.at(-1);
      skill.duration = keptDuration;
      const before = snapshot(rogue, sim);

      const result = skill.cast(rogue, sim);

      assert.equal(result, null);
      assert.equal(skill.duration, keptDuration);
      assert.deepEqual(snapshot(rogue, sim), before);
    });
  }

  it("still casts Sinister Strike at 0 combo points", () => {
    setRoll(0.99);
    const cost = k("sinisterStrike").energy;
    const { rogue, sim } = prepare(0, cost);

    const result = rogue.abilities.sinisterStrike.cast(rogue, sim);

    assert.equal(result.landed, true);
    assert.equal(rogue.energy, 0);
    assert.equal(rogue.comboPoints, k("sinisterStrike").comboPoints);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(sim.combatLog[0].name, "Sinister Strike");
  });
});

describe("finishers at 1 combo point", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("spends Eviscerate and then rejects the follow-up at 0 combo points", () => {
    setRoll(0.99);
    const cost = k("eviscerate").energy;
    const { rogue, sim } = prepare(1, cost * 2);

    const landed = rogue.abilities.eviscerate.cast(rogue, sim);

    assert.equal(landed.landed, true);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(rogue.energy, cost);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(sim.combatLog[0].name, "Eviscerate");
    assert.ok(sim.damageDone > 0);

    sim.gcd = 0;
    const rejected = rogue.abilities.eviscerate.cast(rogue, sim);

    assert.equal(rejected, null);
    assert.equal(rogue.energy, cost);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(sim.combatLog.length, 1);
    assert.equal(sim.gcd, 0);
  });

  it("spends Rupture and applies the 1-point duration", () => {
    setRoll(0.99);
    const cost = k("rupture").energy;
    const { rogue, sim } = prepare(1, cost);
    const duration = k("rupture").durationByCp[0];

    const landed = rogue.abilities.rupture.cast(rogue, sim);

    assert.equal(landed.landed, true);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(rogue.energy, 0);
    assert.equal(rogue.abilities.rupture.duration, duration);
    assert.equal(sim.activeDots.rupture.duration, duration);
    assert.equal(sim.activeDebuffs.rupture.duration, duration);
    assert.equal(sim.activeBuffs.rupture, undefined);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(sim.damageDone, 0);

    sim.gcd = 0;
    const rejected = rogue.abilities.rupture.cast(rogue, sim);
    assert.equal(rejected, null);
    assert.equal(rogue.energy, 0);
    assert.equal(sim.activeDots.rupture.duration, duration);
    assert.equal(sim.activeDebuffs.rupture.duration, duration);
    assert.equal(sim.combatLog.length, 1);
  });

  it("spends Slice and Dice and applies the 1-point buff", () => {
    const cost = k("sliceAndDice").energy;
    const { rogue, sim } = prepare(1, cost * 2);
    const duration = k("sliceAndDice").durationByCp[0];

    const cast = rogue.abilities.sliceAndDice.cast(rogue, sim);

    assert.equal(cast, null);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(rogue.energy, cost);
    assert.equal(rogue.abilities.sliceAndDice.duration, duration);
    assert.equal(sim.activeBuffs["slice-and-dice"].duration, duration);
    assert.equal(sim.activeDebuffs["slice-and-dice"], undefined);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(sim.combatLog[0].name, "Slice and Dice");
    assert.equal(sim.combatLog[0].status, "Cast");

    sim.gcd = 0;
    const rejected = rogue.abilities.sliceAndDice.cast(rogue, sim);

    assert.equal(rejected, null);
    assert.equal(rogue.energy, cost);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(sim.activeBuffs["slice-and-dice"].duration, duration);
    assert.equal(sim.combatLog.length, 1);
    assert.equal(sim.gcd, 0);
  });
});
