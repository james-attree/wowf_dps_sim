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
    const aura = {
      duration: k("hemorrhage.ruptureBonus").duration,
      icon: null,
    };
    if (hemorrhage === "buff") {
      sim.activeBuffs.Hemorrhage = aura;
    } else {
      sim.activeDebuffs.Hemorrhage = aura;
    }
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

    const misplaced = tickDot({ hemorrhage: "buff" });
    assert.equal(misplaced.damageDone, plain.damageDone);

    assert.deepEqual(calls, []);
  });
});

// Issue #14. 30 fps and 144 fps are the two rates the swing-timer fight uses.
const FRAME_RATES = [30, 144];

function near(actual, expected) {
  assert.ok(
    Number.isFinite(actual) &&
      Math.abs(actual - expected) <= k("sim.tickEpsilon"),
    `${actual} is not within tick epsilon of ${expected}`,
  );
}

function runGhostlyStrike(fps) {
  const rogue = new Rogue();
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  const sim = new Simulation(rogue);
  const skill = rogue.abilities.ghostlyStrike;
  const cooldown = skill.cooldown;
  const buffDuration = skill.duration;
  const lead = fps;
  let frame = 0;
  let castTime = null;
  rogue.rotation = () => {
    frame += 1;
    if (frame !== lead) {
      return;
    }
    const result = skill.cast(rogue, sim);
    assert.ok(result?.landed);
    castTime = sim.currentTime;
  };
  sim.lastFrameTime = 0;
  const frameMs = k("sim.msPerSecond") / fps;
  const lastFrame = lead + Math.round(cooldown * fps);
  let buffGoneAt = null;
  let readyAt = null;
  let lastBuffDuration = 0;
  let lastCooldown = 0;
  for (let f = 1; f <= lastFrame; f += 1) {
    sim.update(f * frameMs);
    if (f === lead) {
      assert.equal(sim.cooldowns[skill.name], cooldown);
      assert.equal(sim.activeBuffs[skill.name].duration, buffDuration);
      assert.equal(sim.activeDebuffs[skill.name], undefined);
      assert.equal(castTime, sim.currentTime);
    }
    if (f <= lead) {
      continue;
    }
    const buff = sim.activeBuffs[skill.name];
    if (buff) {
      lastBuffDuration = buff.duration;
    } else if (buffGoneAt === null) {
      buffGoneAt = sim.currentTime;
    }
    if (skill.onCooldown(rogue, sim)) {
      lastCooldown = sim.cooldowns[skill.name];
    } else if (readyAt === null) {
      readyAt = sim.currentTime;
    }
  }
  return {
    castTime,
    buffGoneAt,
    readyAt,
    lastBuffDuration,
    lastCooldown,
    cooldown,
    buffDuration,
  };
}

function runDot(fps, duration) {
  const rogue = new Rogue();
  rogue.critChance = 0;
  rogue.rotation = () => {};
  const sim = new Simulation(rogue);
  const tickInterval = k("rupture.tickInterval");
  const tickDamage = 100;
  sim.activeDots.Rupture = {
    duration,
    tickInterval,
    timeUntilNextTick: tickInterval,
    tickDamage,
    icon: null,
  };
  sim.lastFrameTime = 0;
  const frameMs = k("sim.msPerSecond") / fps;
  const frames = Math.round(duration * fps) + 2;
  let ticks = 0;
  const addCombatEvent = sim.addCombatEvent.bind(sim);
  sim.addCombatEvent = (name, ...args) => {
    if (name === "Rupture") {
      ticks += 1;
    }
    return addCombatEvent(name, ...args);
  };
  let expiredAt = null;
  let previousRemaining = null;
  for (let frame = 1; frame <= frames; frame += 1) {
    sim.update(frame * frameMs);
    const dot = sim.activeDots.Rupture;
    if (dot) {
      previousRemaining = dot.duration;
    } else if (expiredAt === null) {
      expiredAt = sim.currentTime;
      break;
    }
  }
  return {
    ticks,
    expiredAt,
    previousRemaining,
    damage: sim.damageDone,
    tickDamage,
  };
}

describe("buff and cooldown duration", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("is ready at exactly t + 20 and the buff lasts its full duration at 30 and 144 fps", () => {
    mock.method(Math, "random", () => 0.5);
    assert.equal(k("ghostlyStrike").cooldown, 20);

    const fights = {};
    for (const fps of FRAME_RATES) {
      const fight = runGhostlyStrike(fps);
      near(fight.readyAt - fight.castTime, fight.cooldown);
      near(fight.buffGoneAt - fight.castTime, fight.buffDuration);
      assert.ok(fight.lastCooldown > k("sim.tickEpsilon"));
      assert.ok(fight.lastBuffDuration > k("sim.tickEpsilon"));
      fights[fps] = fight;
    }

    near(
      fights[30].readyAt - fights[30].castTime,
      fights[144].readyAt - fights[144].castTime,
    );
    near(
      fights[30].buffGoneAt - fights[30].castTime,
      fights[144].buffGoneAt - fights[144].castTime,
    );
  });

  it("ticks a cooldown that was already running and leaves a new one whole", () => {
    const running = k("premeditation").cooldown;
    const applied = k("ghostlyStrike").cooldown;
    const buffDuration = k("bladeFlurry").duration;

    for (const fps of FRAME_RATES) {
      const rogue = new Rogue();
      const debuffDuration = k("hemorrhage.ruptureBonus").duration;
      const runningDebuff = k("rupture").durationByCp[0];
      rogue.rotation = (sim) => {
        sim.cooldowns["Ghostly Strike"] = applied;
        sim.activeBuffs["Blade Flurry"] = {
          duration: buffDuration,
          icon: null,
        };
        sim.activeDebuffs.Hemorrhage = {
          duration: debuffDuration,
          icon: null,
        };
      };
      const sim = new Simulation(rogue);
      sim.cooldowns.Premeditation = running;
      sim.activeDebuffs.Rupture = {
        duration: runningDebuff,
        icon: null,
      };
      sim.lastFrameTime = 0;
      const frameMs = k("sim.msPerSecond") / fps;
      sim.update(frameMs);

      near(
        sim.cooldowns.Premeditation,
        running - frameMs / k("sim.msPerSecond"),
      );
      assert.equal(sim.cooldowns["Ghostly Strike"], applied);
      assert.equal(sim.activeBuffs["Blade Flurry"].duration, buffDuration);
      assert.equal(sim.activeDebuffs.Hemorrhage.duration, debuffDuration);
      near(
        sim.activeDebuffs.Rupture.duration,
        runningDebuff - frameMs / k("sim.msPerSecond"),
      );
    }
  });
});

function clockUntil(seconds, deltasMs) {
  const limit = seconds * k("sim.msPerSecond");
  const times = [];
  let t = 0;
  let i = 0;
  while (t < limit) {
    t += deltasMs[i % deltasMs.length];
    times.push(t);
    i += 1;
  }
  return times;
}

function fpsClock(fps, seconds) {
  const frameMs = k("sim.msPerSecond") / fps;
  const frames = Math.ceil(seconds * fps);
  const times = [];
  for (let frame = 1; frame <= frames; frame += 1) {
    times.push(frame * frameMs);
  }
  return times;
}

function adrenalineBonus(times) {
  const bonusPerSecond =
    k("energy.regenPerSecond") * (k("adrenalineRush").regenMultiplier - 1);

  function energyAfter(apply) {
    const rogue = new Rogue();
    rogue.energy = 0;
    rogue.maxEnergy = k("energy.max") * k("adrenalineRush").duration;
    let applied = false;
    rogue.rotation = (sim) => {
      if (!apply || applied) {
        return;
      }
      rogue.abilities.adrenalineRush.cast(rogue, sim);
      applied = true;
      assert.ok(sim.activeBuffs["Adrenaline Rush"]);
    };
    const sim = new Simulation(rogue);
    sim.lastFrameTime = 0;
    for (const time of times) {
      sim.update(time);
    }
    assert.equal(applied, apply);
    assert.ok(rogue.energy < rogue.maxEnergy);
    return rogue.energy;
  }

  const bonus = energyAfter(true) - energyAfter(false);
  near(bonus / bonusPerSecond, k("adrenalineRush").duration);
  return bonus;
}

describe("Adrenaline Rush bonus energy", () => {
  it("is exactly the full duration at 10, 30 and 144 fps and on irregular steps", () => {
    assert.equal(k("adrenalineRush").duration, 15);
    const seconds = k("adrenalineRush").duration + k("gcd.duration");
    const schedules = {
      "10 fps": fpsClock(10, seconds),
      "30 fps": fpsClock(30, seconds),
      "144 fps": fpsClock(144, seconds),
      "7 ms then 23 ms": clockUntil(seconds, [7, 23]),
      "250 ms": clockUntil(seconds, [250]),
      "mixed steps": clockUntil(seconds, [1, 17, 80, 250, 3]),
    };
    const bonuses = {};
    for (const [name, times] of Object.entries(schedules)) {
      bonuses[name] = adrenalineBonus(times);
    }
    for (const bonus of Object.values(bonuses)) {
      near(bonus, bonuses["10 fps"]);
    }
  });
});

describe("player buffs and target debuffs", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("keeps self buffs off the debuff list and target effects off the player", () => {
    mock.method(Math, "random", () => 0.99);
    const rogue = new Rogue();
    rogue.bonusHitChance = 1;
    rogue.critChance = 0;
    rogue.energy = rogue.maxEnergy;
    const sim = new Simulation(rogue);

    rogue.abilities.adrenalineRush.cast(rogue, sim);
    sim.gcd = 0;
    rogue.abilities.bladeFlurry.cast(rogue, sim);
    rogue.comboPoints = k("combo.max");
    sim.gcd = 0;
    rogue.abilities.sliceAndDice.cast(rogue, sim);

    rogue.energy = rogue.maxEnergy;
    sim.gcd = 0;
    const ghostly = rogue.abilities.ghostlyStrike.cast(rogue, sim);
    assert.equal(ghostly.landed, true);

    rogue.energy = rogue.maxEnergy;
    sim.gcd = 0;
    const hemorrhage = rogue.abilities.hemorrhage.cast(rogue, sim);
    assert.equal(hemorrhage.landed, true);

    rogue.comboPoints = 1;
    rogue.energy = rogue.maxEnergy;
    sim.gcd = 0;
    const rupture = rogue.abilities.rupture.cast(rogue, sim);
    assert.equal(rupture.landed, true);

    assert.deepEqual(Object.keys(sim.activeBuffs).sort(), [
      "Adrenaline Rush",
      "Blade Flurry",
      "Ghostly Strike",
      "Slice and Dice",
    ]);
    assert.deepEqual(Object.keys(sim.activeDebuffs).sort(), [
      "Hemorrhage",
      "Rupture",
    ]);
    assert.equal(
      sim.activeBuffs["Slice and Dice"].duration,
      k("sliceAndDice").durationByCp.at(-1),
    );
    assert.equal(
      sim.activeBuffs["Ghostly Strike"].duration,
      k("ghostlyStrike").duration,
    );
    assert.equal(sim.activeDebuffs["Ghostly Strike"], undefined);
    assert.equal(
      sim.activeDebuffs.Hemorrhage.duration,
      k("hemorrhage.ruptureBonus").duration,
    );
    assert.equal(
      sim.activeDebuffs.Rupture.duration,
      k("rupture").durationByCp[0],
    );
    assert.equal(
      sim.activeDots.Rupture.duration,
      sim.activeDebuffs.Rupture.duration,
    );
  });
});

describe("DoT expiry", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("expires a DoT inside tick epsilon and still lands a due tick", () => {
    const rogue = new Rogue();
    rogue.critChance = 0;
    rogue.rotation = () => {};
    const sim = new Simulation(rogue);
    const tickDamage = 100;
    sim.activeDots.Rupture = {
      duration: k("sim.tickEpsilon"),
      tickInterval: k("rupture.tickInterval"),
      timeUntilNextTick: k("sim.tickEpsilon"),
      tickDamage,
      icon: null,
    };
    sim.lastFrameTime = 0;
    sim.update(0);

    assert.equal(sim.activeDots.Rupture, undefined);
    assert.equal(sim.damageDone, tickDamage);
    assert.equal(sim.currentTime, 0);
  });

  it("expires inside tick epsilon without a tick that is not due", () => {
    const rogue = new Rogue();
    rogue.critChance = 0;
    rogue.rotation = () => {};
    const sim = new Simulation(rogue);
    sim.activeDots.Rupture = {
      duration: k("sim.tickEpsilon"),
      tickInterval: k("rupture.tickInterval"),
      timeUntilNextTick: k("rupture.tickInterval"),
      tickDamage: 100,
      icon: null,
    };
    sim.lastFrameTime = 0;
    sim.update(0);

    assert.equal(sim.activeDots.Rupture, undefined);
    assert.equal(sim.damageDone, 0);
  });

  it("keeps a DoT whose remaining duration is above tick epsilon", () => {
    const rogue = new Rogue();
    rogue.critChance = 0;
    rogue.rotation = () => {};
    const sim = new Simulation(rogue);
    const duration = k("sim.tickEpsilon") + k("sim.tickEpsilon");
    sim.activeDots.Rupture = {
      duration,
      tickInterval: k("rupture.tickInterval"),
      timeUntilNextTick: k("rupture.tickInterval"),
      tickDamage: 100,
      icon: null,
    };
    sim.lastFrameTime = 0;
    sim.update(0);

    assert.equal(sim.activeDots.Rupture.duration, duration);
    assert.equal(sim.damageDone, 0);
  });

  it("expires on the duration boundary at 30 and 144 fps, with the same ticks", () => {
    const durations = [
      ...k("rupture").durationByCp,
      k("adrenalineRush").duration,
      k("rupture.tickInterval"),
    ];
    const fights = {};
    for (const fps of FRAME_RATES) {
      fights[fps] = durations.map((duration) => runDot(fps, duration));
    }

    for (let i = 0; i < durations.length; i += 1) {
      const duration = durations[i];
      const ticks = Math.floor(duration / k("rupture.tickInterval"));
      for (const fps of FRAME_RATES) {
        const result = fights[fps][i];
        assert.equal(result.ticks, ticks, `${fps} fps, ${duration}s`);
        assert.equal(result.damage, ticks * result.tickDamage);
        near(result.expiredAt, duration);
        assert.ok(result.previousRemaining > k("sim.tickEpsilon"));
      }
      assert.equal(fights[30][i].ticks, fights[144][i].ticks);
      near(fights[30][i].expiredAt, fights[144][i].expiredAt);
    }
  });
});
