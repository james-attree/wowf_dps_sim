import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

const CONSOLE_METHODS = [
  "assert",
  "debug",
  "dir",
  "error",
  "info",
  "log",
  "table",
  "trace",
  "warn",
];

function recordConsole() {
  const calls = [];
  for (const method of CONSOLE_METHODS) {
    mock.method(console, method, (...args) => {
      calls.push({ method, args });
    });
  }
  return calls;
}

function primeDot(sim, name) {
  const tickInterval = k("rupture.tickInterval");
  sim.activeDots[name] = {
    duration: tickInterval,
    tickInterval,
    timeUntilNextTick: tickInterval,
    tickDamage: 100,
    icon: null,
  };
}

function tickDot({ hemorrhage }) {
  const rogue = new Rogue();
  rogue.rotation = () => {};
  const sim = new Simulation(rogue);
  primeDot(sim, "Rupture");
  if (hemorrhage) {
    sim.activeBuffs.Hemorrhage = {
      duration: k("hemorrhage.ruptureBonus").duration,
      icon: null,
    };
  }
  sim.lastFrameTime = 0;
  sim.update(k("rupture.tickInterval") * k("sim.msPerSecond"));
  return sim;
}

describe("simulation output", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("does not write to the console during a fight", () => {
    const calls = recordConsole();
    mock.method(Math, "random", () => 0.5);

    const sim = new Simulation(new Rogue());
    sim.lastFrameTime = 0;
    let time = 0;
    const step = k("sim.msPerSecond") / 10;
    for (let frame = 0; frame < 50; frame += 1) {
      time += step;
      sim.update(time);
    }

    assert.ok(sim.damageDone > 0);
    assert.deepEqual(calls, []);
  });

  it("does not log a DoT tick, including one boosted by Hemorrhage", () => {
    const calls = recordConsole();
    mock.method(Math, "random", () => 0);

    const plain = tickDot({});
    assert.equal(plain.damageDone, 100 * k("dot.critMultiplier"));
    assert.equal(plain.activeDots.Rupture, undefined);
    assert.equal(plain.combatLog[0].damage, plain.damageDone);
    assert.equal(plain.combatLog[0].status, "Crit");

    let boostedDamage = 100;
    boostedDamage *= 1 + k("hemorrhage.ruptureBonus").bonus;
    boostedDamage *= k("dot.critMultiplier");
    const boosted = tickDot({ hemorrhage: true });
    assert.equal(boosted.damageDone, boostedDamage);
    assert.ok(boosted.damageDone > plain.damageDone);
    assert.equal(boosted.activeDots.Rupture, undefined);
    assert.equal(boosted.combatLog[0].damage, boosted.damageDone);
    assert.equal(boosted.combatLog[0].status, "Crit");

    assert.deepEqual(calls, []);
  });
});
