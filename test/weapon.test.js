import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { Weapon } from "../js/weapon.js";

function rawHit(weapon, attackPower, weaponRoll) {
  return weaponRoll + (attackPower / k("ap.perDps")) * weapon.speed;
}

describe("Weapon", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("throws when min damage is greater than max damage", () => {
    assert.throws(() => new Weapon(null, 110, 59, 1.8, "main"), {
      name: "RangeError",
      message: "Weapon min damage 110 is greater than max damage 59.",
    });
  });

  it("allows a weapon whose min and max damage are equal", () => {
    const weapon = new Weapon(null, 80, 80, 1.8, "main");
    mock.method(Math, "random", () => 0.5);
    assert.equal(weapon.rollWeaponDamage(), 80);
  });

  it("gives the sample main hand an inclusive 59–110 die", () => {
    const mainHand = new Rogue().weapons.mainHand;
    assert.equal(mainHand.minDamage, 59);
    assert.equal(mainHand.maxDamage, 110);
    assert.equal(mainHand.speed, 1.8);

    mock.method(Math, "random", () => 0);
    assert.equal(mainHand.rollWeaponDamage(), 59);

    mock.restoreAll();
    mock.method(Math, "random", () => 1 - Number.EPSILON);
    assert.equal(mainHand.rollWeaponDamage(), 110);
  });

  it("halves an off-hand swing after the AP bonus is added", () => {
    mock.method(Math, "random", () => 0);
    const rogue = new Rogue();
    const attackPower = rogue.getAttackPower();
    const swings = {};

    for (const [hand, weapon] of [
      ["main", rogue.weapons.mainHand],
      ["off", rogue.weapons.offHand],
    ]) {
      weapon.swingTimer = 0;
      weapon.tick(0, 1, (swung) => {
        swings[hand] = swung.rollDamage();
      });
    }

    const mainHand = rogue.weapons.mainHand;
    const offHand = rogue.weapons.offHand;
    const mainRaw = rawHit(mainHand, attackPower, mainHand.minDamage);
    const offRaw = rawHit(offHand, attackPower, offHand.minDamage);
    const offPenalty = k("offHand.damageMult");
    const weaponDieOnly =
      offHand.minDamage * offPenalty +
      (attackPower / k("ap.perDps")) * offHand.speed;

    assert.equal(offPenalty, 0.5);
    assert.equal(swings.main, mainRaw);
    assert.equal(swings.off, offRaw * offPenalty);
    assert.notEqual(swings.off, weaponDieOnly);
  });

  it("halves a mid-range off-hand roll and leaves the same main-hand roll whole", () => {
    mock.method(Math, "random", () => 0.75);
    const attackPower = 280;
    const rogue = { getAttackPower: () => attackPower };
    const mainHand = new Weapon(rogue, 10, 13, 2, "main");
    const offHand = new Weapon(rogue, 10, 13, 2, "off");
    // floor(0.75 * 4) + 10 = 13, the top of this die.
    const weaponRoll = 13;
    const raw = rawHit(offHand, attackPower, weaponRoll);
    const offHandDamage = offHand.rollDamage();

    assert.equal(mainHand.rollDamage(), raw);
    assert.equal(offHandDamage, raw * k("offHand.damageMult"));
    assert.notEqual(
      offHandDamage,
      weaponRoll * k("offHand.damageMult") +
        (attackPower / k("ap.perDps")) * offHand.speed,
    );
  });
});

// Issue #13 measured 60s. 30 fps and 144 fps are the two rates it names.
const SWING_WINDOW_SECONDS = 60;
const SWING_FRAME_RATES = [30, 144];
// Short enough that resetting the timer used to drop several swings in that
// window at 30 fps. Not a sample weapon.
const FAST_WEAPON_SPEED = 0.5;

function near(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) <= k("sim.tickEpsilon"),
    `${actual} is not within tick epsilon of ${expected}`,
  );
}

function runClock(rogue, fps, seconds) {
  const sim = new Simulation(rogue);
  sim.lastFrameTime = 0;
  const frameMs = k("sim.msPerSecond") / fps;
  const frames = Math.round(seconds * fps);
  for (let frame = 1; frame <= frames; frame += 1) {
    sim.update(frame * frameMs);
  }
  return sim;
}

function countAutoAttacks(fps, haste) {
  const rogue = new Rogue();
  const started = {
    main: rogue.weapons.mainHand.swingTimer,
    off: rogue.weapons.offHand.swingTimer,
  };
  const swings = { main: 0, off: 0 };
  rogue.rotation = (_simulation, dt) => {
    rogue.weapons.mainHand.tick(dt, haste, () => {
      swings.main += 1;
    });
    rogue.weapons.offHand.tick(dt, haste, () => {
      swings.off += 1;
    });
  };
  const sim = runClock(rogue, fps, SWING_WINDOW_SECONDS);
  return { swings, started, sim, rogue };
}

describe("swing timer overshoot", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("leaves the remaining time when a step does not reach the next swing", () => {
    const mainHand = k("weapon.mainHand");
    const weapon = new Weapon(
      new Rogue(),
      mainHand.min,
      mainHand.max,
      mainHand.speed,
      "main",
    );
    const dt = k("weapon.offHand").initialSwing;
    weapon.swingTimer = mainHand.speed;
    let swings = 0;
    weapon.tick(dt, 1, () => {
      swings += 1;
    });

    assert.equal(swings, 0);
    near(weapon.swingTimer, mainHand.speed - dt);
  });

  it("carries the overshoot instead of starting a full interval", () => {
    const mainHand = k("weapon.mainHand");
    const weapon = new Weapon(
      new Rogue(),
      mainHand.min,
      mainHand.max,
      mainHand.speed,
      "main",
    );
    const remaining = 0.2;
    const dt = 0.5;
    weapon.swingTimer = remaining;
    let swings = 0;
    weapon.tick(dt, 1, () => {
      swings += 1;
    });

    assert.equal(swings, 1);
    near(weapon.swingTimer, mainHand.speed - (dt - remaining));
  });

  it("keeps the overshoot when haste shortens the following interval", () => {
    const mainHand = k("weapon.mainHand");
    const weapon = new Weapon(
      new Rogue(),
      mainHand.min,
      mainHand.max,
      mainHand.speed,
      "main",
    );
    const haste = 1 + k("bladeFlurry").haste;
    const remaining = 0.25;
    const dt = 0.4;
    weapon.swingTimer = remaining;
    let swings = 0;
    weapon.tick(dt, haste, () => {
      swings += 1;
    });

    assert.equal(swings, 1);
    near(weapon.swingTimer, mainHand.speed / haste - (dt - remaining));
  });

  it("fires every swing a single step covers", () => {
    const rogue = new Rogue();
    const weapon = rogue.weapons.mainHand;
    const speed = weapon.speed;
    let swings = 0;
    rogue.rotation = (_simulation, dt) => {
      weapon.tick(dt, 1, () => {
        swings += 1;
      });
    };
    const step = speed * 2 + speed / 2;
    const sim = new Simulation(rogue);
    sim.lastFrameTime = 0;
    sim.update(step * k("sim.msPerSecond"));

    assert.equal(swings, 3);
    near(weapon.swingTimer, speed / 2);
    near(sim.currentTime, step);
  });

  it("stays within 1 of 60 / speed for 60s at 30 fps and 144 fps", () => {
    const hands = [
      ["main", k("weapon.mainHand").speed],
      ["off", k("weapon.offHand").speed],
    ];
    const haste = 1 + k("bladeFlurry").haste;
    const fights = {};

    for (const fps of SWING_FRAME_RATES) {
      fights[fps] = {
        plain: countAutoAttacks(fps, 1),
        hasted: countAutoAttacks(fps, haste),
      };
      for (const [name, fight, rate] of [
        ["plain", fights[fps].plain, 1],
        ["Blade Flurry", fights[fps].hasted, haste],
      ]) {
        for (const [hand, speed] of hands) {
          const interval = speed / rate;
          const swings = fight.swings[hand];
          const expected = SWING_WINDOW_SECONDS / interval;
          assert.ok(
            Math.abs(swings - expected) <= 1,
            `${fps} fps ${hand} ${name}: ${swings} swings, expected ${expected}`,
          );
          const weapon =
            fight.rogue.weapons[hand === "main" ? "mainHand" : "offHand"];
          near(
            weapon.swingTimer,
            fight.started[hand] - fight.sim.currentTime + swings * interval,
          );
        }
      }
    }

    assert.deepEqual(fights[30].plain.swings, fights[144].plain.swings);
    assert.deepEqual(fights[30].hasted.swings, fights[144].hasted.swings);
  });

  it("does not drop swings of a fast weapon over 60s at 30 fps or 144 fps", () => {
    const counts = [];
    for (const fps of SWING_FRAME_RATES) {
      const rogue = new Rogue();
      const weapon = new Weapon(rogue, 1, 1, FAST_WEAPON_SPEED, "main");
      weapon.swingTimer = 0;
      let swings = 0;
      rogue.rotation = (_simulation, dt) => {
        weapon.tick(dt, 1, () => {
          swings += 1;
        });
      };
      const sim = runClock(rogue, fps, SWING_WINDOW_SECONDS);
      const expected = SWING_WINDOW_SECONDS / FAST_WEAPON_SPEED;
      assert.ok(
        Math.abs(swings - expected) <= 1,
        `${fps} fps: ${swings} swings, expected ${expected}`,
      );
      near(weapon.swingTimer, 0 - sim.currentTime + swings * FAST_WEAPON_SPEED);
      counts.push(swings);
    }
    assert.equal(counts[0], counts[1]);
  });
});

function sampleFight(fps) {
  mock.method(Math, "random", () => 0.5);
  const rogue = new Rogue();
  const sim = new Simulation(rogue);
  const counts = {};
  const add = (name) => {
    counts[name] = (counts[name] ?? 0) + 1;
  };
  const resolveAttack = sim.resolveAttack.bind(sim);
  const resolveDotAttack = sim.resolveDotAttack.bind(sim);
  const addCombatEvent = sim.addCombatEvent.bind(sim);
  sim.resolveAttack = (name, ...args) => {
    add(name);
    return resolveAttack(name, ...args);
  };
  sim.resolveDotAttack = (name, ...args) => {
    add(name);
    return resolveDotAttack(name, ...args);
  };
  sim.addCombatEvent = (name, type, damage, status, ...rest) => {
    if (status === "Cast") {
      add(name);
    } else if (name === "Rupture" && damage > 0) {
      add("Rupture tick");
    }
    return addCombatEvent(name, type, damage, status, ...rest);
  };
  sim.lastFrameTime = 0;
  const frameMs = k("sim.msPerSecond") / fps;
  const frames = Math.round(SWING_WINDOW_SECONDS * fps);
  let sliceAndDiceUptime = 0;
  for (let frame = 1; frame <= frames; frame += 1) {
    const before = sim.currentTime;
    sim.update(frame * frameMs);
    if (sim.activeBuffs["Slice and Dice"]) {
      sliceAndDiceUptime += sim.currentTime - before;
    }
  }
  return {
    counts,
    damage: sim.damageDone,
    comboPoints: rogue.comboPoints,
    sliceAndDiceUptime,
  };
}

describe("swing timer fight regression", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("keeps a normal 60s fight's casts and deals the same damage at 30 and 144 fps", () => {
    const slow = sampleFight(SWING_FRAME_RATES[0]);
    const fast = sampleFight(SWING_FRAME_RATES[1]);
    // Fixed roll (Math.random is 0.5). Issue #18 starts the fight at 0 combo
    // points. Issue #20 refreshes Slice and Dice at 4 combo points. This roll
    // spends every Slice and Dice there, casts no Eviscerate, and ends at 0.
    // Issue #23 scales physical direct hits by armor. Rupture ticks and
    // Deadly Poison skip it. Deadly Poison is not cast in this fight. Issue
    // #24 puts Blade Flurry, Adrenaline Rush, and Slice and Dice on the GCD.
    // This roll still lands the same finishers and swings. It does not crit a
    // DoT tick, so both frame rates deal the same total.
    const casts = {
      "Adrenaline Rush": 1,
      "Blade Flurry": 1,
      Premeditation: 1,
      "Ghostly Strike": 1,
      Hemorrhage: 18,
      "Slice and Dice": 4,
      Rupture: 1,
      "Rupture tick": 8,
      "Main-hand": 45,
      "Off-hand": 47,
    };
    const spent =
      casts["Slice and Dice"] * k("rotation.sliceAndDiceComboPoints") +
      casts.Rupture * k("combo.max");
    const generated =
      casts.Premeditation * k("premeditation").comboPoints +
      casts["Ghostly Strike"] * k("ghostlyStrike").comboPoints +
      casts.Hemorrhage * k("hemorrhage").comboPoints;
    const comboPoints = k("character.startingComboPoints") + generated - spent;

    assert.deepEqual(slow.counts, casts);
    assert.deepEqual(fast.counts, casts);
    assert.equal(slow.counts.Eviscerate, undefined);
    assert.equal(slow.damage, fast.damage);
    assert.equal(comboPoints, 0);
    assert.equal(slow.comboPoints, comboPoints);
    assert.equal(fast.comboPoints, comboPoints);
    assert.ok(slow.damage > 0);
    assert.ok(slow.sliceAndDiceUptime > SWING_WINDOW_SECONDS / 2);
    assert.ok(fast.sliceAndDiceUptime > SWING_WINDOW_SECONDS / 2);
    assert.ok(
      Math.abs(slow.sliceAndDiceUptime - fast.sliceAndDiceUptime) <
        1 / SWING_FRAME_RATES[0],
    );
  });
});
