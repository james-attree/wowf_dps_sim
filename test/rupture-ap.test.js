import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

// Issue #25. The Cataclysm tooltip prints these per tick. 4 CP is
// 0.03428571, and 7 × that is within 1e-7 of the stored total 0.24.
const WOWHEAD_PER_TICK = [0.015, 0.024, 0.03, 0.03428571, 0.0375];
// Classic 1.12 totals. Combo point 3 matches Cataclysm; the others do not.
const CLASSIC_TOTALS = [0.04, 0.1, 0.18, 0.21, 0.24];
const CATA_TOTALS = [0.06, 0.12, 0.18, 0.24, 0.3];
const ISSUE_NOTE =
  "WoW Forever tooltip says AP scaling; Cata coefficients used as reference.";
// 0.9 × attack.rollScale is a yellow hit when crit is 0.
const HIT_ROLL = 0.9;

function withAp(value, run) {
  const row = CONSTANTS["rupture.apByCP"];
  const saved = row.value;
  row.value = value;
  try {
    return run();
  } finally {
    row.value = saved;
  }
}

function near(actual, expected) {
  assert.ok(
    Number.isFinite(actual) &&
      Math.abs(actual - expected) <= k("sim.tickEpsilon"),
    `${actual} is not within tick epsilon of ${expected}`,
  );
}

function harness(comboPoints) {
  const rogue = new Rogue();
  rogue.rotation = () => {};
  rogue.critChance = 0;
  rogue.comboPoints = comboPoints;
  rogue.energy = k("energy.max");
  const sim = new Simulation(rogue, { rng: testRng });
  sim.gcd = 0;
  assert.equal(sim.currentTime, 0);
  return { rogue, sim };
}

describe("Rupture AP coefficients", () => {
  afterEach(() => {
    mock.restoreAll();
    assert.deepEqual(k("rupture.apByCP"), CATA_TOTALS);
  });

  it("keeps the Cataclysm totals in rupture.apByCP", () => {
    const row = CONSTANTS["rupture.apByCP"];
    assert.equal(row.source, "cataclysm");
    assert.equal(row.unit, "AP total");
    assert.equal(row.ref, "https://www.wowhead.com/cata/spell=1943/rupture");
    assert.equal(row.retune, true);
    assert.equal(row.note.startsWith(ISSUE_NOTE), true);
    assert.equal(row.note.includes("Owner decision"), false);
    assert.deepEqual(k("rupture.apByCP"), CATA_TOTALS);

    const stats = k("rupture");
    const ticks = stats.durationByCp.map(
      (duration) => duration / k("rupture.tickInterval"),
    );
    assert.deepEqual(ticks, [4, 5, 6, 7, 8]);
    assert.equal(k("rupture.apByCP").length, stats.damageByCp.length);
    assert.equal(k("rupture.apByCP").length, ticks.length);
    for (let index = 0; index < CATA_TOTALS.length; index += 1) {
      const fromTotal = k("rupture.apByCP")[index] / ticks[index];
      assert.ok(
        Math.abs(fromTotal - WOWHEAD_PER_TICK[index]) < 1e-7,
        `CP ${index + 1} per tick ${fromTotal}`,
      );
    }
  });

  it("adds the same attack-power bonus at every combo point", () => {
    const stats = k("rupture");
    const ap = k("character.attackPower");
    for (
      let comboPoints = 1;
      comboPoints <= CATA_TOTALS.length;
      comboPoints += 1
    ) {
      const { rogue } = harness(comboPoints);
      const index = comboPoints - 1;
      const rupture = rogue.abilities.rupture;
      const bonus = ap * k("rupture.apByCP")[index];
      assert.equal(rupture.damage(), stats.damageByCp[index] + bonus);
      assert.equal(rupture.duration, stats.durationByCp[index]);
      assert.equal(bonus, ap * CATA_TOTALS[index]);
      if (CATA_TOTALS[index] === CLASSIC_TOTALS[index]) {
        assert.equal(bonus, ap * CLASSIC_TOTALS[index]);
      } else {
        assert.notEqual(
          rupture.damage(),
          stats.damageByCp[index] + ap * CLASSIC_TOTALS[index],
        );
      }
    }
  });

  it("splits that total across the ticks, at 30 and 144 fps", () => {
    setRoll(HIT_ROLL);
    const stats = k("rupture");
    for (const fps of [30, 144]) {
      for (
        let comboPoints = 1;
        comboPoints <= CATA_TOTALS.length;
        comboPoints += 1
      ) {
        const { rogue, sim } = harness(comboPoints);
        const rupture = rogue.abilities.rupture;
        const raw = rupture.damage();
        const ticks = Math.floor(rupture.duration / k("rupture.tickInterval"));
        const cast = rupture.cast(rogue, sim);
        assert.equal(cast.landed, true, `${fps} fps CP ${comboPoints}`);
        assert.equal(sim.damageDone, 0);
        assert.equal(rogue.comboPoints, 0);
        const dot = sim.activeDots.rupture;
        assert.equal(dot.tickDamage, Math.floor(raw) / ticks);
        const dt = 1 / fps;
        const frames = Math.round(rupture.duration * fps);
        for (let frame = 1; frame <= frames; frame += 1) {
          sim.step(dt);
        }
        near(sim.currentTime, stats.durationByCp[comboPoints - 1]);
        const landed = sim.combatLog.filter(
          (event) => event.name === "Rupture" && event.damage > 0,
        );
        assert.equal(landed.length, ticks, `${fps} fps CP ${comboPoints}`);
        for (const event of landed) {
          assert.equal(event.damage, dot.tickDamage);
        }
        const dealt = landed.reduce((sum, event) => sum + event.damage, 0);
        assert.equal(sim.damageDone, dealt);
        near(dealt, Math.floor(raw));
        assert.equal(sim.activeDots.rupture, undefined);
      }
    }
  });

  it("follows rupture.apByCP when the totals change", () => {
    const stats = k("rupture");
    const ap = k("character.attackPower");
    const replaced = [0.01, 0.02, 0.03, 0.04, 0.05];
    withAp(replaced, () => {
      for (
        let comboPoints = 1;
        comboPoints <= replaced.length;
        comboPoints += 1
      ) {
        const { rogue } = harness(comboPoints);
        const index = comboPoints - 1;
        assert.equal(
          rogue.abilities.rupture.damage(),
          stats.damageByCp[index] + ap * replaced[index],
        );
      }
      withAp(replaced.slice(0, 2), () => {
        const { rogue } = harness(3);
        rogue.abilities.rupture.duration = stats.durationByCp[2];
        assert.equal(rogue.abilities.rupture.damage(), 0);
        assert.equal(rogue.abilities.rupture.duration, 0);
        rogue.comboPoints = 2;
        assert.equal(
          rogue.abilities.rupture.damage(),
          stats.damageByCp[1] + ap * replaced[1],
        );
      });
    });
  });
});
