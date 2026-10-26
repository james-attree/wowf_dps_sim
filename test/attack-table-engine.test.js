import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { createFight, runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

// The Classic attack table (A7, #100) through the engine: the draws a swing and
// a skill take, the position of the rogue (config.target.behind), and the crit
// chance a tick reads. The table itself is in attack-resolver.test.js.

function source(id) {
  return { id, name: `Display name of ${id}` };
}

// A simulation whose rng returns the given values in turn and counts draws.
function scripted(values, config) {
  const rogue = new Rogue(config);
  rogue.rotation = () => {};
  rogue.critChance = 0.148; // 10% once the 4.8% suppression comes off
  rogue.bonusHitChance = 0;
  let draws = 0;
  const rng = () => {
    if (draws >= values.length) {
      throw new Error(`draw ${draws + 1} was not scripted`);
    }
    return values[draws++];
  };
  const sim = new Simulation(rogue, { rng });
  return { sim, rogue, draws: () => draws };
}

describe("the draws of a swing and a skill through the engine", () => {
  it("takes one draw for a white swing, and a second for a glancing blow", () => {
    const miss = scripted([0.1]);
    assert.equal(
      miss.sim.resolveAttack(source("main-hand"), "weapon", 100).outcome,
      "miss",
    );
    assert.equal(miss.draws(), 1);

    const glance = scripted([0.5, 1]);
    const result = glance.sim.resolveAttack(
      source("main-hand"),
      "weapon",
      1000,
    );
    assert.equal(result.outcome, "glancing");
    assert.equal(glance.draws(), 2);
    // A draw of 1 would be the top of the range; 0.999... is 0.75 of the base.
    assert.ok(Math.abs(result.glanceFactor - 0.75) < 0.01);
  });

  it("takes two draws for a yellow hit, and the second is the crit", () => {
    const crit = scripted([0.5, 0.05]);
    assert.equal(
      crit.sim.resolveAttack(source("backstab"), "skill", 100).outcome,
      "crit",
    );
    assert.equal(crit.draws(), 2);

    const hit = scripted([0.5, 0.5]);
    assert.equal(
      hit.sim.resolveAttack(source("backstab"), "skill", 100).outcome,
      "hit",
    );
    assert.equal(hit.draws(), 2);
  });

  it("takes one draw for a yellow miss or dodge", () => {
    for (const [value, outcome] of [
      [0.05, "miss"],
      [0.1, "dodge"],
    ]) {
      const attack = scripted([value]);
      assert.equal(
        attack.sim.resolveAttack(source("backstab"), "skill", 100).outcome,
        outcome,
      );
      assert.equal(attack.draws(), 1);
    }
  });

  it("takes one draw for a DoT application, which never crits", () => {
    const attack = scripted([0.5]);
    const result = attack.sim.resolveDotAttack(
      source("rupture"),
      "skill",
      1000,
      12,
      true,
    );
    assert.equal(result.outcome, "hit");
    assert.equal(attack.draws(), 1);
  });

  it("gives a tick the crit chance less the 4.8% suppression", () => {
    const tick = (critChance, draw) => {
      const { sim, rogue } = scripted([draw]);
      rogue.critChance = critChance;
      const interval = k("rupture.tickInterval");
      sim.activeDots.rupture = {
        name: "Rupture",
        duration: interval,
        tickInterval: interval,
        timeUntilNextTick: interval,
        tickDamage: 100,
        icon: null,
        attackType: "skill",
        bleed: true,
      };
      sim.step(interval);
      return sim.combatLog[0].status;
    };
    assert.equal(tick(0.148, 0.099), "Crit");
    assert.equal(tick(0.148, 0.101), "Hit");
    // Under 4.8% there is no crit left, whatever the draw.
    assert.equal(tick(0.04, 0), "Hit");

    // dot.critSuppression is the assumption behind that: false leaves a tick
    // at the full chance.
    const original = CONSTANTS["dot.critSuppression"].value;
    CONSTANTS["dot.critSuppression"].value = false;
    try {
      assert.equal(tick(0.148, 0.101), "Crit");
      assert.equal(tick(0.04, 0.039), "Crit");
      assert.equal(tick(0.04, 0.041), "Hit");
    } finally {
      CONSTANTS["dot.critSuppression"].value = original;
    }
    assert.equal(k("dot.critSuppression"), true);
  });
});

describe("the position of the rogue", () => {
  const SEEDS = [1, 2, 3, 4, 5, 6];
  const total = (fight, field) =>
    Object.values(fight.simulation.abilityStats).reduce(
      (sum, record) => sum + record[field],
      0,
    );

  it("has no parry and no block from behind, the default", () => {
    for (const seed of SEEDS) {
      const fight = createFight(seed);
      assert.equal(fight.config.target.behind, true);
      fight.simulation.run(120);
      assert.equal(total(fight, "parries"), 0);
      assert.equal(total(fight, "blocks"), 0);
    }
  });

  it("has parries and blocks from the front, and a swing's outcomes still add up to its casts", () => {
    let parries = 0;
    let blocks = 0;
    for (const seed of SEEDS) {
      const fight = createFight(seed, { target: { behind: false } });
      fight.simulation.run(120);
      parries += total(fight, "parries");
      blocks += total(fight, "blocks");
      for (const [id, record] of Object.entries(
        fight.simulation.abilityStats,
      )) {
        const outcomes =
          record.hits +
          record.crits +
          record.glances +
          record.misses +
          record.dodges +
          record.parries +
          record.blocks;
        // A non-attack cast (Slice and Dice) counts as a cast with no outcome.
        assert.ok(outcomes <= record.casts, id);
        if (id === "main-hand" || id === "off-hand") {
          assert.equal(outcomes, record.casts, id);
        }
      }
    }
    assert.ok(parries > 0, "some parries");
    assert.ok(blocks > 0, "some blocks");
  });

  it("reads the position for a DoT application too (resolveDotAttack)", () => {
    // 0.25 is in the parry band of the yellow table from the front, and a hit
    // from behind, where the band has no width. Only the position differs.
    const apply = (config) => {
      const fight = scripted([0.25, 0.5], config);
      const result = fight.sim.resolveDotAttack(
        source("rupture"),
        "skill",
        1600,
        16,
        true,
      );
      return { result, sim: fight.sim };
    };
    const front = apply({ target: { behind: false } });
    assert.equal(front.result.outcome, "parry");
    assert.equal(front.result.landed, false);
    assert.equal(front.sim.activeDots.rupture, undefined);
    assert.equal(front.sim.abilityStats.rupture.parries, 1);

    const behind = apply({ target: { behind: true } });
    assert.equal(behind.result.landed, true);
    assert.ok(behind.sim.activeDots.rupture);
    assert.equal(behind.sim.abilityStats.rupture.parries, 0);
  });

  it("counts a block as a landed hit that deals damage and a parry as one that does not", () => {
    // 0.9 clears dodge and parry at the front and is in the block band
    // [0.875, 0.925) of the white table, so the hit is blocked.
    const blocked = scripted([0.9], { target: { behind: false } });
    const swing = blocked.sim.resolveAttack(source("main-hand"), "weapon", 100);
    assert.equal(swing.outcome, "block");
    assert.equal(swing.landed, true);
    assert.ok(blocked.sim.damageDone > 0);
    assert.equal(blocked.sim.abilityStats["main-hand"].blocks, 1);
    assert.equal(blocked.sim.combatLog[0].status, "Block");

    const parried = scripted([0.4], { target: { behind: false } });
    const parry = parried.sim.resolveAttack(source("main-hand"), "weapon", 100);
    assert.equal(parry.outcome, "parry");
    assert.equal(parried.sim.damageDone, 0);
    assert.equal(parried.sim.abilityStats["main-hand"].parries, 1);
  });

  it("changes nothing for a fight from behind compared with no target section", () => {
    assert.deepEqual(
      runFight({ seed: 3, duration: 60, config: { target: { behind: true } } }),
      runFight({ seed: 3, duration: 60 }),
    );
  });

  it("carries the position into the result, and a front fight is not the same fight", () => {
    const front = runFight({
      seed: 3,
      duration: 60,
      config: { target: { behind: false } },
    });
    const behind = runFight({ seed: 3, duration: 60 });
    assert.equal(front.config.target.behind, false);
    assert.equal(behind.config.target.behind, true);
    assert.notEqual(front.totalDamage, behind.totalDamage);
  });
});
