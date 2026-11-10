// James 10 Nov: Hack and Slash extra attacks are main-hand swings, use
// main-hand damage with no off-hand penalty, and reset the main-hand swing
// timer. Axes behave as swords.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { openCore } from "../js/core/fight.js";
import { defineProc, procsFromTalents } from "../js/procs.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

const HIT = 0.99;
const OH_START = k("weapon.offHand").initialSwing;
const MH_SPEED = 2;
const OH_SPEED = 1.5;
const MH_DAMAGE = 200;
const OH_DAMAGE = 10;

function extraProc() {
  return defineProc({
    id: "hack-and-slash",
    trigger: "onHit",
    scope: { weaponTypes: ["sword", "axe"] },
    chance: { mode: "flat", value: 1 },
    actions: [{ type: "extraAttack" }],
  });
}

function setup({
  mainType = "sword",
  offType = "sword",
  procs = [extraProc()],
} = {}) {
  const rogue = new Rogue(
    {
      character: { attackPower: 0, critChance: 0, bonusHitChance: 1, haste: 0 },
      weapons: {
        mainHand: {
          min: MH_DAMAGE,
          max: MH_DAMAGE,
          speed: MH_SPEED,
          type: mainType,
        },
        offHand: {
          min: OH_DAMAGE,
          max: OH_DAMAGE,
          speed: OH_SPEED,
          type: offType,
        },
      },
      target: { armor: 0 },
    },
    { procs },
  );
  rogue.castRotation = () => ({ casts: [], outcome: "none" });
  rogue.critChance = 0;
  rogue.bonusHitChance = 1;
  // A 0.99 table roll is a hit; a chance of 1 still fires; min = max so the
  // damage draw is unused. A dagger or fist swing does not roll the proc.
  const sim = new Simulation(rogue, { rng: () => HIT });
  return sim;
}

function timers(sim) {
  return {
    main: sim.core.swings.find((item) => item.hand === "mainHand"),
    off: sim.core.swings.find((item) => item.hand === "offHand"),
  };
}

describe("Hack and Slash rulings (James 10 Nov)", () => {
  it("resets the main-hand timer after a main-hand proc; the off-hand timer is untouched", () => {
    const sim = setup({ offType: "dagger" });
    const run = openCore(sim, MH_SPEED + OH_START);
    try {
      run.runUntil(0);
      const { main, off } = timers(sim);
      assert.equal(main.nextSwingTime, MH_SPEED);
      assert.equal(off.nextSwingTime, OH_START);
      assert.equal(sim.abilityStats["main-hand"].casts, 2);
      assert.equal(sim.abilityStats["off-hand"], undefined);
      run.runUntil(OH_START);
      assert.equal(
        main.nextSwingTime,
        MH_SPEED,
        "an off-hand dagger does not proc",
      );
      assert.equal(off.nextSwingTime, OH_START + OH_SPEED);
    } finally {
      run.close();
    }
  });

  it("resets the main-hand timer after an off-hand proc, to one full main-hand speed later", () => {
    const sim = setup({ mainType: "dagger", offType: "sword" });
    const run = openCore(sim, MH_SPEED + OH_START);
    try {
      run.runUntil(0);
      const { main, off } = timers(sim);
      assert.equal(
        main.nextSwingTime,
        MH_SPEED,
        "a main-hand dagger does not proc",
      );
      assert.equal(off.nextSwingTime, OH_START);
      assert.equal(sim.abilityStats["main-hand"].casts, 1);
      run.runUntil(OH_START);
      assert.equal(main.nextSwingTime, OH_START + MH_SPEED);
      assert.equal(off.nextSwingTime, OH_START + OH_SPEED);
      assert.equal(sim.abilityStats["main-hand"].casts, 2);
      assert.equal(sim.abilityStats["off-hand"].casts, 1);
    } finally {
      run.close();
    }
  });

  it("uses the main-hand damage range with no off-hand penalty when the off hand procs", () => {
    const sim = setup({ mainType: "dagger", offType: "sword" });
    const run = openCore(sim, OH_START);
    try {
      run.runUntil(OH_START);
      const mh = sim.abilityStats["main-hand"];
      const oh = sim.abilityStats["off-hand"];
      assert.equal(mh.casts, 2);
      assert.equal(mh.damage, MH_DAMAGE * 2);
      assert.equal(oh.casts, 1);
      assert.equal(oh.damage, OH_DAMAGE * k("offHand.damageMult"));
    } finally {
      run.close();
    }
  });

  it("uses main-hand dagger damage when the off-hand sword procs (mixed weapons)", () => {
    const sim = setup({ mainType: "dagger", offType: "sword" });
    const run = openCore(sim, OH_START);
    try {
      run.runUntil(OH_START);
      assert.equal(sim.abilityStats["main-hand"].damage, MH_DAMAGE * 2);
      assert.notEqual(
        sim.abilityStats["main-hand"].damage / 2,
        OH_DAMAGE * k("offHand.damageMult"),
      );
    } finally {
      run.close();
    }
  });

  it("an off-hand axe procs the same extra main-hand attack a sword does", () => {
    const sim = setup({ mainType: "dagger", offType: "axe" });
    const run = openCore(sim, OH_START);
    try {
      run.runUntil(OH_START);
      assert.equal(sim.abilityStats["main-hand"].casts, 2);
      assert.equal(sim.abilityStats["main-hand"].damage, MH_DAMAGE * 2);
      assert.equal(sim.abilityStats["off-hand"].casts, 1);
      const { main, off } = timers(sim);
      assert.equal(main.nextSwingTime, OH_START + MH_SPEED);
      assert.equal(off.nextSwingTime, OH_START + OH_SPEED);
    } finally {
      run.close();
    }
  });

  it("the talent's proc is the extraAttack action, on swords and axes", () => {
    const proc = procsFromTalents({ "combat.hack-and-slash": 5 }).find(
      (item) => item?.id === "hack-and-slash",
    );
    assert.equal(proc.id, "hack-and-slash");
    assert.deepEqual(proc.scope.weaponTypes, ["sword", "axe"]);
    assert.deepEqual(proc.actions, [{ type: "extraAttack" }]);
    assert.equal(proc.chance.value, 0.05);
  });
});
