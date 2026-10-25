import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

const FRAME_RATES = [30, 144];

function prepare() {
  const rogue = new Rogue();
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  rogue.energy = k("start.state").energy;
  const sim = new Simulation(rogue);
  sim.gcd = 0;
  sim.lastFrameTime = 0;
  assert.equal(sim.currentTime, 0);
  return { rogue, sim };
}

describe("gcd.flags", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("records Slice and Dice, Blade Flurry, and Adrenaline Rush on the GCD", () => {
    assert.equal(k("gcd.flags"), "SnD, BF, AR on GCD; Premeditation off");
    assert.equal(CONSTANTS["gcd.flags"].source, "classic-1.12");
    assert.equal(k("gcd.duration"), 1);
    assert.match(CONSTANTS["gcd.flags"].ref, /rogue\/talents\.go/);
    assert.match(CONSTANTS["gcd.flags"].ref, /rogue\/slice_and_dice\.go/);
    assert.match(CONSTANTS["gcd.flags"].ref, /rogue\/premeditation\.go/);
    assert.match(CONSTANTS["gcd.flags"].note, /Applied/);
    assert.doesNotMatch(CONSTANTS["gcd.flags"].note, /Not applied/);

    assert.equal(new Rogue().abilities.bladeFlurry.triggersGcd, true);
    assert.equal(new Rogue().abilities.adrenalineRush.triggersGcd, true);
    assert.equal(new Rogue().abilities.sliceAndDice.triggersGcd, true);
    assert.equal(new Rogue().abilities.premeditation.triggersGcd, false);
  });

  it("starts the GCD for Blade Flurry, Adrenaline Rush, and Slice and Dice", () => {
    mock.method(Math, "random", () => 0.99);
    const { rogue, sim } = prepare();
    const energy = rogue.energy;

    assert.equal(rogue.abilities.bladeFlurry.cast(rogue, sim), null);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(
      sim.activeBuffs["Blade Flurry"].duration,
      k("bladeFlurry").duration,
    );
    assert.equal(rogue.energy, energy - k("bladeFlurry").energy);

    const duringBladeFlurry = rogue.abilities.hemorrhage.cast(rogue, sim);
    assert.equal(duringBladeFlurry, null);
    assert.equal(sim.activeDebuffs.Hemorrhage, undefined);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(rogue.energy, energy - k("bladeFlurry").energy);

    sim.gcd = 0;
    const hemorrhage = rogue.abilities.hemorrhage.cast(rogue, sim);
    assert.equal(hemorrhage.landed, true);
    assert.equal(sim.gcd, k("gcd.duration"));
    assert.equal(
      sim.activeDebuffs.Hemorrhage.duration,
      k("hemorrhage.ruptureBonus").duration,
    );

    const fresh = prepare();
    assert.equal(
      fresh.rogue.abilities.adrenalineRush.cast(fresh.rogue, fresh.sim),
      null,
    );
    assert.equal(fresh.sim.gcd, k("gcd.duration"));
    assert.equal(
      fresh.sim.activeBuffs["Adrenaline Rush"].duration,
      k("adrenalineRush").duration,
    );
    assert.equal(
      fresh.rogue.abilities.bladeFlurry.cast(fresh.rogue, fresh.sim),
      null,
    );
    assert.equal(fresh.sim.activeBuffs["Blade Flurry"], undefined);
    assert.equal(fresh.sim.gcd, k("gcd.duration"));

    const dice = prepare();
    dice.rogue.comboPoints = 1;
    const duration = k("sliceAndDice").durationByCp[0];
    assert.equal(
      dice.rogue.abilities.sliceAndDice.cast(dice.rogue, dice.sim),
      null,
    );
    assert.equal(dice.sim.gcd, k("gcd.duration"));
    assert.equal(dice.rogue.comboPoints, 0);
    assert.equal(dice.sim.activeBuffs["Slice and Dice"].duration, duration);

    dice.rogue.comboPoints = 1;
    dice.rogue.energy = k("start.state").energy;
    assert.equal(
      dice.rogue.abilities.sliceAndDice.cast(dice.rogue, dice.sim),
      null,
    );
    assert.equal(dice.rogue.comboPoints, 1);
    assert.equal(dice.sim.gcd, k("gcd.duration"));
    assert.equal(dice.sim.activeBuffs["Slice and Dice"].duration, duration);
  });

  it("lets Premeditation cast during a GCD without starting or clearing one", () => {
    const { rogue, sim } = prepare();
    rogue.abilities.bladeFlurry.cast(rogue, sim);
    const energy = rogue.energy;
    const gcd = sim.gcd;
    assert.equal(gcd, k("gcd.duration"));

    assert.equal(rogue.abilities.premeditation.cast(rogue, sim), null);
    assert.equal(rogue.comboPoints, k("premeditation").comboPoints);
    assert.equal(rogue.energy, energy);
    assert.equal(sim.gcd, gcd);
    assert.equal(sim.combatLog[0].name, "Premeditation");
    assert.equal(sim.cooldowns.Premeditation, k("premeditation").cooldown);

    const alone = prepare();
    alone.rogue.abilities.premeditation.cast(alone.rogue, alone.sim);
    assert.equal(alone.sim.gcd, 0);
    assert.equal(alone.rogue.comboPoints, k("premeditation").comboPoints);
  });

  it("casts Blade Flurry on the opening frame and holds the next on-GCD cast", () => {
    mock.method(Math, "random", () => 0.5);
    for (const fps of FRAME_RATES) {
      const rogue = new Rogue();
      const sim = new Simulation(rogue);
      sim.lastFrameTime = 0;
      assert.equal(sim.currentTime, 0);
      sim.update(k("sim.msPerSecond") / fps);

      assert.equal(sim.gcd, k("gcd.duration"), `${fps} fps`);
      assert.equal(
        rogue.comboPoints,
        k("character.startingComboPoints"),
        `${fps} fps`,
      );
      assert.equal(
        sim.activeBuffs["Blade Flurry"].duration,
        k("bladeFlurry").duration,
        `${fps} fps`,
      );
      assert.equal(sim.cooldowns.Premeditation, undefined, `${fps} fps`);
      assert.equal(sim.activeBuffs["Adrenaline Rush"], undefined, `${fps} fps`);
      assert.equal(sim.activeDebuffs.Hemorrhage, undefined, `${fps} fps`);
      assert.equal(sim.cooldowns["Ghostly Strike"], undefined, `${fps} fps`);
      const names = sim.combatLog.map((event) => event.name);
      assert.equal(names.includes("Blade Flurry"), true, `${fps} fps`);
      assert.equal(names.includes("Premeditation"), false, `${fps} fps`);
      assert.equal(names.includes("Adrenaline Rush"), false, `${fps} fps`);
      assert.equal(names.includes("Hemorrhage"), false, `${fps} fps`);
      assert.equal(names.includes("Ghostly Strike"), false, `${fps} fps`);
      assert.equal(names.includes("Slice and Dice"), false, `${fps} fps`);
      assert.equal(names.includes("Sinister Strike"), false, `${fps} fps`);
      assert.equal(names.includes("Eviscerate"), false, `${fps} fps`);
      assert.equal(names.includes("Rupture"), false, `${fps} fps`);
    }
  });
});
