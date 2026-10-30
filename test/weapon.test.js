import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";
import { Weapon } from "../js/weapon.js";
import { COMBAT_GRANTS } from "./combat-grants.js";
import { runOnCore } from "../js/core/fight.js";

function rawHit(weapon, attackPower, weaponRoll) {
  return weaponRoll + (attackPower / k("ap.perDps")) * weapon.speed;
}

function shown(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function weaponWith(overrides) {
  return new Weapon(
    null,
    Object.hasOwn(overrides, "minDamage") ? overrides.minDamage : 59,
    Object.hasOwn(overrides, "maxDamage") ? overrides.maxDamage : 110,
    Object.hasOwn(overrides, "speed") ? overrides.speed : 1.8,
    "main",
  );
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

  // Partners stay finite, so the thrown message names this field.
  const fields = [
    ["min damage", "minDamage", "Weapon min damage must be a finite number."],
    ["max damage", "maxDamage", "Weapon max damage must be a finite number."],
    ["speed", "speed", "Weapon speed must be a finite number."],
  ];
  const nonFinite = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "110",
    undefined,
  ];

  for (const [label, key, message] of fields) {
    for (const value of nonFinite) {
      it(`rejects ${label} ${shown(value)}`, () => {
        assert.throws(() => weaponWith({ [key]: value }), {
          name: "RangeError",
          message,
        });
      });
    }
  }

  for (const speed of [0, -1]) {
    it(`rejects speed ${speed}`, () => {
      assert.throws(() => weaponWith({ speed }), {
        name: "RangeError",
        message: "Weapon speed must be greater than 0.",
      });
    });
  }

  it("rejects swapped numeric strings before comparing min and max", () => {
    assert.throws(() => new Weapon(null, "110", "59", 1.8, "main"), {
      name: "RangeError",
      message: "Weapon min damage must be a finite number.",
    });
  });

  it("allows a weapon whose min and max damage are equal", () => {
    const weapon = new Weapon({ random: testRng }, 80, 80, 1.8, "main");
    setRoll(0.5);
    assert.equal(weapon.rollWeaponDamage(), 80);
  });

  it("gives the default main hand an inclusive 100–187 die", () => {
    const rogue = new Rogue();
    rogue.rng = testRng;
    const mainHand = rogue.weapons.mainHand;
    assert.equal(mainHand.minDamage, 100);
    assert.equal(mainHand.maxDamage, 187);
    assert.equal(mainHand.speed, 2.6);
    assert.equal(mainHand.type, k("weapon.mainHand").type);

    setRoll(0);
    assert.equal(mainHand.rollWeaponDamage(), 100);

    mock.restoreAll();
    setRoll(1 - Number.EPSILON);
    assert.equal(mainHand.rollWeaponDamage(), 187);
  });

  it("halves an off-hand swing after the AP bonus is added", () => {
    setRoll(0);
    const rogue = new Rogue();
    rogue.rng = testRng;
    const attackPower = rogue.getAttackPower();
    const swings = {};

    for (const [hand, weapon] of [
      ["main", rogue.weapons.mainHand],
      ["off", rogue.weapons.offHand],
    ]) {
      swings[hand] = weapon.rollDamage();
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
    setRoll(0.75);
    const attackPower = 280;
    const rogue = { getAttackPower: () => attackPower, random: testRng };
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

// White swings of a rogue that casts nothing, run in frames of 1 / fps,
// counted from the hit events (every swing has one, a miss included; the
// combat log keeps only the last log.maxEvents).
function countAutoAttacks(fps, rogue = new Rogue()) {
  rogue.castRotation = () => ({ casts: [], outcome: "none" });
  const sim = new Simulation(rogue, { rng: testRng });
  const swings = { main: 0, off: 0 };
  sim.on("hit", (event) => {
    if (event.ability === "main-hand") {
      swings.main += 1;
    } else if (event.ability === "off-hand") {
      swings.off += 1;
    }
  });
  const dt = 1 / fps;
  const frames = Math.round(SWING_WINDOW_SECONDS * fps);
  for (let frame = 1; frame <= frames; frame += 1) {
    runOnCore(sim, dt);
  }
  return { swings, sim, rogue };
}

// Weapon.tick and its overshoot carry were the fixed-step engine's swing
// timer, removed in #234; the event core's (js/core/swing.js) swings at the
// due time itself, with haste read there (test/swing.test.js).
describe("swing timer over a fight in frames", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("stays within 1 of 60 / speed for 60s at 30 fps and 144 fps", () => {
    const hands = [
      ["main", k("weapon.mainHand").speed],
      ["off", k("weapon.offHand").speed],
    ];
    const fights = {};
    for (const fps of SWING_FRAME_RATES) {
      fights[fps] = countAutoAttacks(fps);
      for (const [hand, speed] of hands) {
        const swings = fights[fps].swings[hand];
        const expected = SWING_WINDOW_SECONDS / speed;
        assert.ok(
          Math.abs(swings - expected) <= 1,
          `${fps} fps ${hand}: ${swings} swings, expected ${expected}`,
        );
      }
    }
    assert.deepEqual(fights[30].swings, fights[144].swings);
  });

  it("does not drop swings of a fast weapon over 60s at 30 fps or 144 fps", () => {
    const counts = [];
    for (const fps of SWING_FRAME_RATES) {
      const rogue = new Rogue();
      rogue.weapons.mainHand = new Weapon(
        rogue,
        1,
        1,
        FAST_WEAPON_SPEED,
        "main",
      );
      rogue.weapons.mainHand.swingTimer = 0;
      const { swings } = countAutoAttacks(fps, rogue);
      const expected = SWING_WINDOW_SECONDS / FAST_WEAPON_SPEED;
      assert.ok(
        Math.abs(swings.main - expected) <= 1,
        `${fps} fps: ${swings.main} swings, expected ${expected}`,
      );
      counts.push(swings.main);
    }
    assert.equal(counts[0], counts[1]);
  });
});

function sampleFight(fps) {
  setRoll(0.5);
  // Granted: the rotation's Blade Flurry and Adrenaline Rush are in this
  // fight, and no talents is untalented (#199).
  const rogue = new Rogue(undefined, COMBAT_GRANTS);
  const sim = new Simulation(rogue, { rng: testRng });
  const counts = {};
  const add = (name) => {
    counts[name] = (counts[name] ?? 0) + 1;
  };
  const resolveAttack = sim.resolveAttack.bind(sim);
  const resolveDotAttack = sim.resolveDotAttack.bind(sim);
  const addCombatEvent = sim.addCombatEvent.bind(sim);
  sim.resolveAttack = (source, ...args) => {
    add(source.name);
    return resolveAttack(source, ...args);
  };
  sim.resolveDotAttack = (source, ...args) => {
    add(source.name);
    return resolveDotAttack(source, ...args);
  };
  sim.addCombatEvent = (name, type, damage, status, ...rest) => {
    if (status === "Cast") {
      add(name);
    } else if (name === "Rupture" && damage > 0) {
      add("Rupture tick");
    }
    return addCombatEvent(name, type, damage, status, ...rest);
  };
  const dt = 1 / fps;
  const frames = Math.round(SWING_WINDOW_SECONDS * fps);
  let sliceAndDiceUptime = 0;
  for (let frame = 1; frame <= frames; frame += 1) {
    const before = sim.currentTime;
    runOnCore(sim, dt);
    if (sim.activeBuffs["slice-and-dice"]) {
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
    // points. The placeholder Combat rotation (issue #68) builds with
    // Sinister Strike and spends rotation.finisherComboPoints. Since issue
    // #155 it keeps Slice and Dice up with the combat-swords preset's refresh
    // rules (under rotation.pooling.recastSeconds left, or inside the pooling
    // window at full energy), so with this roll one finisher is an Eviscerate
    // and Slice and Dice is cast twice. Ghostly Strike, Premeditation,
    // Hemorrhage, and Rupture are not cast. Issue #23 scales physical direct
    // hits by armor. Issue #24 puts Blade Flurry, Adrenaline Rush, and Slice
    // and Dice on the GCD. This roll does not crit a DoT tick, so both frame
    // rates deal the same total.
    const casts = {
      "Adrenaline Rush": 1,
      "Blade Flurry": 1,
      Eviscerate: 1,
      "Sinister Strike": 16,
      "Slice and Dice": 2,
      "Main-hand": 28,
      "Off-hand": 29,
    };
    const spent =
      (casts["Slice and Dice"] + casts.Eviscerate) *
      k("rotation.finisherComboPoints");
    const generated =
      casts["Sinister Strike"] * k("sinisterStrike").comboPoints;
    const comboPoints = k("character.startingComboPoints") + generated - spent;

    assert.deepEqual(slow.counts, casts);
    assert.deepEqual(fast.counts, casts);
    assert.equal(slow.counts.Premeditation, undefined);
    assert.equal(slow.counts["Ghostly Strike"], undefined);
    assert.equal(slow.counts.Hemorrhage, undefined);
    assert.equal(slow.counts.Rupture, undefined);
    assert.equal(slow.damage, fast.damage);
    assert.equal(slow.comboPoints, comboPoints);
    assert.equal(fast.comboPoints, comboPoints);
    assert.ok(slow.damage > 0);
    // 27 s of the 60 (26.99 at 144 fps): the second Slice and Dice is recast
    // only once the first is under rotation.pooling.recastSeconds (or in the
    // window at full energy), and with this roll it lapses for a while before
    // the next recast (it was over half the fight with the 10 s refresh before
    // #155). Pinned to 26.5-27.5 s so a drift in the SnD timing fails here
    // (#173, Kira).
    for (const uptime of [slow.sliceAndDiceUptime, fast.sliceAndDiceUptime]) {
      assert.ok(uptime > 26.5 && uptime < 27.5, `SnD uptime ${uptime}`);
    }
    // Sampled per frame, while the core puts each cast and expiry at its own
    // time (#234): a frame of 1 / 30 s at most at each of the two casts and
    // two ends.
    assert.ok(
      Math.abs(slow.sliceAndDiceUptime - fast.sliceAndDiceUptime) <=
        4 / SWING_FRAME_RATES[0],
    );
  });
});
