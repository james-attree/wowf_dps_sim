import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

const FRAME_RATES = [30, 144];
const OMITTED = ["Ghostly Strike", "Premeditation", "Hemorrhage", "Rupture"];
const FIGHT_SECONDS = 60;

function pinned() {
  const rogue = new Rogue();
  const sim = new Simulation(rogue);
  sim.lastFrameTime = 0;
  assert.equal(sim.currentTime, 0);
  rogue.weapons.mainHand.swingTimer = rogue.weapons.mainHand.speed;
  rogue.weapons.offHand.swingTimer = rogue.weapons.offHand.speed;
  rogue.energy = k("energy.max");
  return { rogue, sim };
}

function hold(sim, rogue, ids) {
  const held = k("bladeFlurry").cooldown;
  for (const id of ids) {
    sim.cooldowns[rogue.abilities[id].name] = held;
  }
}

function atZero(sim) {
  sim.update(0);
  assert.equal(sim.currentTime, 0);
}

function names(sim) {
  return sim.combatLog.map((event) => event.name);
}

function armSliceAndDice(rogue, sim, duration) {
  const sliceAndDice = rogue.abilities.sliceAndDice;
  sim.activeBuffs[sliceAndDice.name] = {
    duration,
    icon: sliceAndDice.icon,
  };
}

describe("placeholder Combat rotation", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("casts Blade Flurry before Adrenaline Rush, a finisher, and Sinister Strike", () => {
    mock.method(Math, "random", () => 0.5);
    const { rogue, sim } = pinned();
    rogue.comboPoints = k("rotation.finisherComboPoints");
    atZero(sim);

    assert.deepEqual(names(sim), [rogue.abilities.bladeFlurry.name]);
    assert.equal(
      sim.activeBuffs[rogue.abilities.bladeFlurry.name].duration,
      k("bladeFlurry").duration,
    );
    assert.equal(
      sim.activeBuffs[rogue.abilities.adrenalineRush.name],
      undefined,
    );
    assert.equal(sim.activeBuffs[rogue.abilities.sliceAndDice.name], undefined);
    assert.equal(rogue.comboPoints, k("rotation.finisherComboPoints"));
    assert.equal(sim.gcd, k("gcd.duration"));
  });

  it("casts Adrenaline Rush on cooldown once Blade Flurry is down, at full energy", () => {
    mock.method(Math, "random", () => 0.5);
    const priority = k("rotation.priority");
    const resting = pinned();
    hold(resting.sim, resting.rogue, [priority.onCooldown[0]]);
    assert.equal(resting.rogue.energy, k("energy.max"));
    atZero(resting.sim);

    assert.deepEqual(names(resting.sim), [
      resting.rogue.abilities.adrenalineRush.name,
    ]);
    assert.equal(
      resting.sim.activeBuffs[resting.rogue.abilities.adrenalineRush.name]
        .duration,
      k("adrenalineRush").duration,
    );
    assert.equal(resting.rogue.comboPoints, k("character.startingComboPoints"));

    const finishing = pinned();
    hold(finishing.sim, finishing.rogue, [priority.onCooldown[0]]);
    finishing.rogue.comboPoints = k("rotation.finisherComboPoints");
    atZero(finishing.sim);

    assert.deepEqual(names(finishing.sim), [
      finishing.rogue.abilities.adrenalineRush.name,
    ]);
    assert.equal(
      finishing.sim.activeBuffs[finishing.rogue.abilities.sliceAndDice.name],
      undefined,
    );
    assert.equal(
      finishing.rogue.comboPoints,
      k("rotation.finisherComboPoints"),
    );
  });

  it("casts Slice and Dice at the finisher combo points when the buff is missing", () => {
    mock.method(Math, "random", () => 0.5);
    assert.equal(k("rotation.finisherComboPoints"), 5);
    const { rogue, sim } = pinned();
    hold(sim, rogue, k("rotation.priority").onCooldown);
    rogue.comboPoints = k("rotation.finisherComboPoints");
    atZero(sim);

    assert.deepEqual(names(sim), [rogue.abilities.sliceAndDice.name]);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(
      sim.activeBuffs[rogue.abilities.sliceAndDice.name].duration,
      k("sliceAndDice").durationByCp.at(-1),
    );
    assert.equal(sim.activeDots.Rupture, undefined);
    assert.equal(sim.gcd, k("gcd.duration"));
  });

  it("refreshes Slice and Dice at the 10s boundary and below it", () => {
    mock.method(Math, "random", () => 0.5);
    const refresh = k("rotation.sliceAndDiceRefreshSeconds");
    assert.equal(refresh, 10);
    const refreshed = k("sliceAndDice").durationByCp.at(-1);

    for (const duration of [refresh - k("sim.tickEpsilon"), refresh]) {
      const { rogue, sim } = pinned();
      hold(sim, rogue, k("rotation.priority").onCooldown);
      rogue.comboPoints = k("rotation.finisherComboPoints");
      armSliceAndDice(rogue, sim, duration);
      atZero(sim);

      assert.deepEqual(names(sim), [rogue.abilities.sliceAndDice.name]);
      assert.equal(rogue.comboPoints, 0);
      assert.equal(
        sim.activeBuffs[rogue.abilities.sliceAndDice.name].duration,
        refreshed,
      );
      assert.equal(sim.activeDots.Rupture, undefined);
    }
  });

  it("eviscerates when Slice and Dice has more than 10s left", () => {
    mock.method(Math, "random", () => 0.5);
    const refresh = k("rotation.sliceAndDiceRefreshSeconds");
    const above = [
      refresh + k("sim.tickEpsilon"),
      k("sliceAndDice").durationByCp.at(-1),
    ];

    for (const duration of above) {
      const { rogue, sim } = pinned();
      hold(sim, rogue, k("rotation.priority").onCooldown);
      rogue.comboPoints = k("rotation.finisherComboPoints");
      armSliceAndDice(rogue, sim, duration);
      atZero(sim);

      assert.deepEqual(names(sim), [rogue.abilities.eviscerate.name]);
      assert.equal(rogue.comboPoints, 0);
      assert.equal(
        sim.activeBuffs[rogue.abilities.sliceAndDice.name].duration,
        duration,
      );
      assert.equal(sim.activeDots.Rupture, undefined);
      assert.equal(
        names(sim).includes(rogue.abilities.sinisterStrike.name),
        false,
      );
    }
  });

  it("casts Sinister Strike below the finisher combo points", () => {
    mock.method(Math, "random", () => 0.5);
    const threshold = k("rotation.finisherComboPoints");
    assert.equal(threshold, 5);

    for (const comboPoints of [0, threshold - 1]) {
      const { rogue, sim } = pinned();
      hold(sim, rogue, k("rotation.priority").onCooldown);
      rogue.comboPoints = comboPoints;
      atZero(sim);

      assert.deepEqual(names(sim), [rogue.abilities.sinisterStrike.name]);
      assert.equal(
        rogue.comboPoints,
        comboPoints + k("sinisterStrike").comboPoints,
      );
      assert.equal(
        sim.activeBuffs[rogue.abilities.sliceAndDice.name],
        undefined,
      );
      assert.equal(sim.activeDots.Rupture, undefined);
    }
  });

  it("does not cast Ghostly Strike, Premeditation, Hemorrhage, or Rupture", () => {
    mock.method(Math, "random", () => 0.5);
    const fights = {};

    for (const fps of FRAME_RATES) {
      const rogue = new Rogue();
      const sim = new Simulation(rogue);
      sim.lastFrameTime = 0;
      assert.equal(sim.currentTime, 0);
      const counts = {};
      const addCombatEvent = sim.addCombatEvent.bind(sim);
      sim.addCombatEvent = (name, ...rest) => {
        counts[name] = (counts[name] ?? 0) + 1;
        return addCombatEvent(name, ...rest);
      };
      const frameMs = k("sim.msPerSecond") / fps;
      const frames = Math.round(FIGHT_SECONDS * fps);
      for (let frame = 1; frame <= frames; frame += 1) {
        sim.update(frame * frameMs);
      }

      for (const name of OMITTED) {
        assert.equal(counts[name], undefined, `${fps} fps ${name}`);
      }
      for (const id of [
        ...k("rotation.priority").onCooldown,
        k("rotation.priority").sliceAndDice,
        k("rotation.priority").builder,
      ]) {
        assert.ok(counts[rogue.abilities[id].name] > 0, `${fps} fps ${id}`);
      }
      fights[fps] = sim.damageDone;
    }

    assert.equal(fights[FRAME_RATES[0]], fights[FRAME_RATES[1]]);
    assert.ok(fights[FRAME_RATES[0]] > 0);
  });
});
