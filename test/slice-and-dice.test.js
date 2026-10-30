import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";
import { COMBAT_GRANTS } from "./combat-grants.js";
import { runOnCore } from "../js/core/fight.js";

function near(actual, expected) {
  assert.ok(
    Number.isFinite(actual) &&
      Math.abs(actual - expected) <= k("sim.tickEpsilon"),
    `${actual} is not within tick epsilon of ${expected}`,
  );
}

function holdCooldowns(sim) {
  const held = k("bladeFlurry").cooldown;
  for (const id of [
    "adrenaline-rush",
    "blade-flurry",
    "premeditation",
    "ghostly-strike",
  ]) {
    sim.cooldowns[id] = held;
  }
}

function pinned() {
  // Granted, so the rotation casts Blade Flurry with no talents (#199).
  const rogue = new Rogue(undefined, COMBAT_GRANTS);
  const sim = new Simulation(rogue, { rng: testRng });
  assert.equal(sim.currentTime, 0);
  holdCooldowns(sim);
  rogue.weapons.mainHand.swingTimer = k("sliceAndDice").durationByCp.at(-1);
  rogue.weapons.offHand.swingTimer = k("sliceAndDice").durationByCp.at(-1);
  rogue.energy = k("sliceAndDice").energy;
  return { rogue, sim };
}

// One rotation decision at the current time, with no time passing (the
// removed step(0) did this; runOnCore(sim, 0) runs nothing, #234).
function decide(sim) {
  sim.rogue.castRotation(sim);
}

function advance(sim, seconds) {
  runOnCore(sim, seconds);
}

// Blade Flurry starts the GCD, so Slice and Dice lands once that GCD has ticked off.
function castBothBuffs(rogue, sim) {
  delete sim.cooldowns["blade-flurry"];
  // Exactly the two costs: at t = 0 a rule's threshold met exactly wakes
  // once its energy has moved (conditionWakeAt, #234).
  rogue.energy = k("bladeFlurry").energy + k("sliceAndDice").energy;
  rogue.comboPoints = k("rotation.finisherComboPoints");
  const mainHand = rogue.weapons.mainHand;
  const offHand = rogue.weapons.offHand;
  mainHand.swingTimer = mainHand.speed;
  offHand.swingTimer = offHand.speed;

  const half = k("gcd.duration") / 2;
  advance(sim, half);
  assert.equal(sim.activeBuffs["slice-and-dice"], undefined);
  assert.ok(sim.activeBuffs["blade-flurry"].duration > 0);
  near(sim.gcd, half);

  advance(sim, half);
  assert.ok(sim.activeBuffs["slice-and-dice"].duration > 0);
  assert.ok(sim.activeBuffs["blade-flurry"].duration > 0);
  near(mainHand.swingTimer, mainHand.speed - k("gcd.duration"));
  near(offHand.swingTimer, offHand.speed - k("gcd.duration"));
  return { mainHand, offHand };
}

describe("Slice and Dice export", () => {
  it("reads Rank 2 attack speed and the per-combo-point durations", async () => {
    const snapshot = JSON.parse(
      await readFile(
        new URL("../data/talentsforever/rogue.json", import.meta.url),
      ),
    );
    const spell = snapshot.spell_desc["Rogue|Slice and Dice|Rank 2"];
    const hastePct = Number(spell.d.match(/attack speed by (\d+)%/)[1]);
    const durationByCp = [];
    for (const match of spell.d.matchAll(
      /(\d+) points?\s*:\s*(\d+) seconds/g,
    )) {
      durationByCp[Number(match[1]) - 1] = Number(match[2]);
    }
    const energy = Number(
      spell.l
        .flat()
        .join(" ")
        .match(/(\d+) Energy/)[1],
    );
    const step = durationByCp[1] - durationByCp[0];
    const base = durationByCp[0] - step;

    assert.equal(durationByCp.length, k("combo.max"));
    for (let index = 0; index < durationByCp.length; index += 1) {
      assert.equal(durationByCp[index], base + step * (index + 1));
    }
    assert.equal(k("sliceAndDice").haste, hastePct / 100);
    assert.deepEqual(k("sliceAndDice").durationByCp, durationByCp);
    assert.equal(k("sliceAndDice").energy, energy);
    assert.equal(/cooldown/i.test(spell.l.flat().join(" ")), false);
    assert.equal(k("sliceAndDice").cooldown, 0);
    assert.equal(CONSTANTS.sliceAndDice.source, "wowf-export");
    assert.equal(
      CONSTANTS.sliceAndDice.ref,
      "rogue.json → spell_desc[Rogue|Slice and Dice|Rank 2]",
    );
  });
});

describe("Slice and Dice rotation", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("casts at the combo-point threshold and refreshes inside the window", () => {
    setRoll(0.5);
    const { rogue, sim } = pinned();
    const below = k("rotation.finisherComboPoints") - 1;
    rogue.comboPoints = below;
    decide(sim);

    assert.equal(sim.currentTime, 0);
    assert.equal(sim.activeBuffs["slice-and-dice"], undefined);
    assert.equal(rogue.comboPoints, below);
    assert.equal(rogue.energy, k("sliceAndDice").energy);

    rogue.comboPoints = k("rotation.finisherComboPoints");
    decide(sim);
    const refreshed =
      k("sliceAndDice").durationByCp[k("rotation.finisherComboPoints") - 1];

    assert.equal(sim.activeBuffs["slice-and-dice"].duration, refreshed);
    assert.equal(sim.activeDebuffs["slice-and-dice"], undefined);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(rogue.energy, 0);
    assert.equal(sim.gcd, k("gcd.duration"));

    // The refresh checks are about the buff timer. Clear the GCD this cast
    // started. Since issue #155 the default recasts Slice and Dice with the
    // combat-swords preset's rules: under rotation.pooling.recastSeconds left
    // at any energy, or inside the pooling window at full energy.
    const { recastSeconds } = k("rotation.pooling");
    sim.gcd = 0;
    rogue.comboPoints = k("rotation.finisherComboPoints");
    rogue.energy = k("sliceAndDice").energy;
    sim.activeBuffs["slice-and-dice"].duration = recastSeconds;
    decide(sim);

    // Not refreshed, and Eviscerate costs more than this energy: the walk pools.
    assert.equal(rogue.comboPoints, k("rotation.finisherComboPoints"));
    assert.equal(sim.activeBuffs["slice-and-dice"].duration, recastSeconds);

    rogue.comboPoints = k("combo.max");
    rogue.energy = k("sliceAndDice").energy;
    sim.activeBuffs["slice-and-dice"].duration =
      recastSeconds - k("sim.tickEpsilon");
    decide(sim);

    assert.equal(rogue.comboPoints, 0);
    assert.equal(sim.activeDots.rupture, undefined);
    assert.equal(
      sim.activeBuffs["slice-and-dice"].duration,
      k("sliceAndDice").durationByCp.at(-1),
    );
  });

  it("shortens the next swing of both weapons and leaves the current one", () => {
    setRoll(0.5);
    const { rogue, sim } = pinned();
    const mainHand = rogue.weapons.mainHand;
    const offHand = rogue.weapons.offHand;
    mainHand.swingTimer = mainHand.speed;
    offHand.swingTimer = offHand.speed;
    rogue.comboPoints = k("rotation.finisherComboPoints");
    const opened = k("weapon.offHand").initialSwing;
    const haste = 1 + k("sliceAndDice").haste;

    decide(sim);
    assert.equal(
      sim.activeBuffs["slice-and-dice"].duration,
      k("sliceAndDice").durationByCp[k("rotation.finisherComboPoints") - 1],
    );
    advance(sim, opened);
    near(mainHand.swingTimer, mainHand.speed - opened);
    near(offHand.swingTimer, offHand.speed - opened);

    const offLeft = offHand.swingTimer;
    advance(sim, offLeft);
    near(offHand.swingTimer, offHand.speed / haste);

    const mainLeft = mainHand.swingTimer;
    advance(sim, mainLeft);
    near(mainHand.swingTimer, mainHand.speed / haste);
    near(offHand.swingTimer, offHand.speed / haste - mainLeft);
  });

  it("returns both weapons to normal speed after Slice and Dice expires", () => {
    setRoll(0.5);
    const { rogue, sim } = pinned();
    rogue.comboPoints = k("rotation.finisherComboPoints");
    decide(sim);
    assert.equal(sim.currentTime, 0);
    const duration = sim.activeBuffs["slice-and-dice"].duration;
    const below = k("rotation.finisherComboPoints") - 1;

    rogue.maxEnergy = 0;
    rogue.energy = 0;
    rogue.comboPoints = below;
    // Longer than a Slice and Dice duration, so neither weapon swings while it is up.
    const parked = 1e6;
    rogue.weapons.mainHand.swingTimer = parked;
    rogue.weapons.offHand.swingTimer = parked;
    advance(sim, duration);

    assert.equal(sim.activeBuffs["slice-and-dice"], undefined);
    assert.equal(sim.activeBuffs["blade-flurry"], undefined);
    assert.equal(rogue.comboPoints, below);

    const step = k("weapon.offHand").initialSwing;
    rogue.weapons.mainHand.swingTimer = step;
    rogue.weapons.offHand.swingTimer = step;
    advance(sim, step);

    assert.equal(sim.activeBuffs["slice-and-dice"], undefined);
    assert.equal(rogue.comboPoints, below);
    near(rogue.weapons.mainHand.swingTimer, rogue.weapons.mainHand.speed);
    near(rogue.weapons.offHand.swingTimer, rogue.weapons.offHand.speed);
  });

  it("multiplies Slice and Dice and Blade Flurry on the next swing", () => {
    setRoll(0.5);
    const { rogue, sim } = pinned();
    const haste = (1 + k("sliceAndDice").haste) * (1 + k("bladeFlurry").haste);
    assert.equal(k("haste.stacking"), "multiplicative");
    const { mainHand, offHand } = castBothBuffs(rogue, sim);

    const offLeft = offHand.swingTimer;
    advance(sim, offLeft);
    near(offHand.swingTimer, offHand.speed / haste);

    const mainLeft = mainHand.swingTimer;
    advance(sim, mainLeft);
    near(mainHand.swingTimer, mainHand.speed / haste);
    near(offHand.swingTimer, offHand.speed / haste - mainLeft);
  });

  it("adds Slice and Dice and Blade Flurry when haste.stacking is additive", () => {
    const saved = CONSTANTS["haste.stacking"].value;
    CONSTANTS["haste.stacking"].value = "additive";
    try {
      setRoll(0.5);
      const { rogue, sim } = pinned();
      const haste = 1 + k("sliceAndDice").haste + k("bladeFlurry").haste;
      const { mainHand, offHand } = castBothBuffs(rogue, sim);

      const offLeft = offHand.swingTimer;
      advance(sim, offLeft);
      near(offHand.swingTimer, offHand.speed / haste);
      const mainLeft = mainHand.swingTimer;
      advance(sim, mainLeft);
      near(mainHand.swingTimer, mainHand.speed / haste);
      near(offHand.swingTimer, offHand.speed / haste - mainLeft);
    } finally {
      CONSTANTS["haste.stacking"].value = saved;
    }
  });

  it("throws when haste.stacking is neither multiplicative nor additive", () => {
    const saved = CONSTANTS["haste.stacking"].value;
    CONSTANTS["haste.stacking"].value = "neither";
    try {
      const { rogue, sim } = pinned();
      assert.equal(sim.currentTime, 0);
      sim.activeBuffs["slice-and-dice"] = {
        duration: k("sliceAndDice").durationByCp[0],
        icon: rogue.abilities.sliceAndDice.icon,
      };
      // Below every threshold: see castBothBuffs for the t = 0 wake edge.
      // The main hand swings at once, so its next interval reads the haste.
      rogue.energy = 0;
      rogue.weapons.mainHand.swingTimer = 0;
      assert.throws(() => runOnCore(sim, k("gcd.duration")), {
        name: "Error",
        message: "Unknown haste.stacking: neither",
      });
    } finally {
      CONSTANTS["haste.stacking"].value = saved;
    }
    assert.equal(k("haste.stacking"), "multiplicative");
  });
});
