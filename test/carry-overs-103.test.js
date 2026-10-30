import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFight, expandTalents } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { defaultConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { quiet } from "./quiet.js";

// Carry-overs from QA of #126 and #130, taken with D6 (#103): a block from the
// front does not use up Cold Blood's charge, and `modifiers: null` is "none"
// as `procs: null` and `abilities: null` are.

const COLD_BLOOD = "assassination.cold-blood";
const DAMAGE = 0.5;
// Yellow attack from the front with a 100% hit chance: miss and dodge bands
// are 0 and 6.5% wide, parry 14%, block 5%. 0.22 is in the block band
// [20.5, 25.5), 0.9 clears every avoidance band.
const BLOCK = 0.22;
const HIT = 0.9;
const CRIT_ROLL = 0.999;

function abilityOf(rogue, id) {
  return Object.values(rogue.abilities).find((ability) => ability.id === id);
}

function coldBloodFromFront(rolls) {
  const config = defaultConfig();
  config.target.behind = false;
  const { modifiers, procs, abilities } = expandTalents({ [COLD_BLOOD]: 1 });
  const rogue = new Rogue(config, { modifiers, procs, abilities });
  rogue.bonusHitChance = 1;
  rogue.critChance = 0.3;
  quiet(rogue);
  rogue.energy = 100;
  let at = 0;
  const simulation = new Simulation(rogue, {
    rng: () => {
      if (at >= rolls.length) {
        throw new Error(`draw ${at + 1} was not scripted`);
      }
      return rolls[at++];
    },
  });
  abilityOf(rogue, "cold-blood").cast(rogue, simulation);
  return { rogue, simulation, left: () => rolls.length - at };
}

describe("a block from the front and Cold Blood's charge", () => {
  for (const id of ["sinister-strike", "eviscerate"]) {
    it(`keeps the charge when ${id} is blocked, and the next landed one spends it`, () => {
      const run = coldBloodFromFront([DAMAGE, BLOCK, DAMAGE, HIT, CRIT_ROLL]);
      run.rogue.comboPoints = 5;
      const cast = () =>
        abilityOf(run.rogue, id).cast(run.rogue, run.simulation);
      cast();
      const [blocked] = run.simulation.combatLog;
      assert.equal(blocked.outcome, "block", "the roll was in the block band");
      assert.equal(run.left(), 3, "a block draws no crit roll");
      assert.equal(run.simulation.activeBuffs["cold-blood"].charges, 1);
      run.simulation.gcd = 0;
      run.rogue.comboPoints = 5;
      cast();
      assert.equal(run.left(), 0);
      assert.equal(run.simulation.activeBuffs["cold-blood"], undefined);
    });
  }

  it("still spends it on a hit, so the blocked case is the only difference", () => {
    const run = coldBloodFromFront([DAMAGE, HIT, CRIT_ROLL]);
    abilityOf(run.rogue, "sinister-strike").cast(run.rogue, run.simulation);
    assert.equal(run.simulation.combatLog[0].outcome, "crit");
    assert.equal(run.simulation.activeBuffs["cold-blood"], undefined);
  });
});

describe("createFight with modifiers: null", () => {
  it("is the same fight as no modifiers, as procs and abilities null are", () => {
    const run = (options) => {
      const fight = createFight(7, undefined, options);
      fight.simulation.run(30);
      return fight.simulation.damageDone;
    };
    const none = run(undefined);
    assert.equal(run({ modifiers: null }), none);
    assert.equal(run({ modifiers: null, procs: null, abilities: null }), none);
  });

  it("still refuses a modifiers option that is not a list, with a clear message", () => {
    for (const bad of ["x", {}, 5]) {
      assert.throws(() => createFight(7, undefined, { modifiers: bad }), {
        name: "TypeError",
        message: "modifiers must be an array of modifiers.",
      });
    }
  });
});
