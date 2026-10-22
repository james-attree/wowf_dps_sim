import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

const TICK_DAMAGE = 100;
// 0.9 * attack.rollScale lands in the hit band for a white swing and a yellow
// attack, with or without the sample crit chance.
const HIT_ROLL = 0.9;

function withConstant(id, value, run) {
  const row = CONSTANTS[id];
  const saved = row.value;
  row.value = value;
  try {
    return run();
  } finally {
    row.value = saved;
  }
}

// armor / (armor + constant + perLevel × level), capped. Mirrors armor.mitigation.
function expectedMultiplier(
  armor = k("target.armor"),
  level = k("character.level"),
) {
  const safeArmor = Math.max(0, armor);
  const mitigation = k("armor.mitigation");
  const denominator =
    safeArmor + mitigation.constant + mitigation.perLevel * level;
  if (denominator <= 0) {
    return 1;
  }
  let reduction = safeArmor / denominator;
  if (reduction > mitigation.cap) {
    reduction = mitigation.cap;
  }
  if (reduction < 0) {
    reduction = 0;
  }
  return 1 - reduction;
}

function tickDot(name, { hemorrhage = false, bleed = false, critChance } = {}) {
  const rogue = new Rogue();
  rogue.rotation = () => {};
  if (critChance !== undefined) {
    rogue.critChance = critChance;
  }
  const sim = new Simulation(rogue);
  const tickInterval = k("rupture.tickInterval");
  const dot = {
    duration: tickInterval,
    tickInterval,
    timeUntilNextTick: tickInterval,
    tickDamage: TICK_DAMAGE,
    icon: null,
  };
  if (bleed) {
    dot.bleed = true;
  }
  sim.activeDots[name] = dot;
  if (hemorrhage) {
    sim.activeDebuffs.Hemorrhage = {
      duration: k("hemorrhage.ruptureBonus").duration,
      icon: null,
    };
  }
  sim.lastFrameTime = 0;
  sim.update(tickInterval * k("sim.msPerSecond"));
  return sim;
}

function directHit(name, attackType) {
  mock.method(Math, "random", () => HIT_ROLL);
  const rogue = new Rogue();
  rogue.rotation = () => {};
  rogue.critChance = 0;
  const sim = new Simulation(rogue);
  const result = sim.resolveAttack(name, attackType, TICK_DAMAGE);
  return { result, sim };
}

describe("DoT crit multiplier", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("crits Rupture, Garrote, and Deadly Poison ticks from dot.critMultiplier", () => {
    mock.method(Math, "random", () => 0);
    const multiplier = k("dot.critMultiplier");
    const factor = expectedMultiplier();
    assert.ok(factor < 1);

    for (const name of ["Rupture", "Garrote"]) {
      const sim = tickDot(name);
      assert.equal(sim.damageDone, TICK_DAMAGE * multiplier, name);
      assert.equal(sim.combatLog[0].status, "Crit", name);
      assert.equal(sim.combatLog[0].damage, sim.damageDone, name);
    }

    const poison = tickDot("Deadly Poison");
    assert.equal(poison.damageDone, TICK_DAMAGE * multiplier * factor);
    assert.equal(poison.combatLog[0].status, "Crit");
    assert.ok(poison.damageDone < TICK_DAMAGE * multiplier);

    const other = k("glancing.damage");
    assert.notEqual(other, multiplier);
    const changed = withConstant("dot.critMultiplier", other, () =>
      tickDot("Rupture"),
    );
    assert.equal(changed.damageDone, TICK_DAMAGE * other);
    assert.notEqual(changed.damageDone, TICK_DAMAGE * multiplier);

    const blocked = withConstant("dot.canCrit", false, () =>
      tickDot("Garrote"),
    );
    assert.equal(blocked.damageDone, TICK_DAMAGE);
    assert.equal(blocked.combatLog[0].status, "Hit");
  });
});

describe("bleed ticks and armor", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("does not reduce Rupture or Hemorrhage-type bleed ticks, and does reduce white hits and non-bleed damage", () => {
    mock.method(Math, "random", () => 0.5);
    const factor = expectedMultiplier();
    assert.ok(factor < 1);
    const bonus = 1 + k("hemorrhage.ruptureBonus").bonus;

    const rupture = tickDot("Rupture", { critChance: 0 });
    const garrote = tickDot("Garrote", { critChance: 0 });
    const hemorrhageTick = tickDot("Hemorrhage", {
      critChance: 0,
      bleed: true,
    });
    const boosted = tickDot("Rupture", { critChance: 0, hemorrhage: true });
    const poison = tickDot("Deadly Poison", { critChance: 0 });

    assert.equal(rupture.damageDone, TICK_DAMAGE);
    assert.equal(garrote.damageDone, TICK_DAMAGE);
    assert.equal(hemorrhageTick.damageDone, TICK_DAMAGE);
    assert.equal(boosted.damageDone, TICK_DAMAGE * bonus);
    assert.equal(poison.damageDone, TICK_DAMAGE * factor);
    assert.ok(poison.damageDone < TICK_DAMAGE);

    const unarmored = withConstant("target.armor", 0, () => ({
      rupture: tickDot("Rupture", { critChance: 0 }).damageDone,
      boosted: tickDot("Rupture", { critChance: 0, hemorrhage: true })
        .damageDone,
      poison: tickDot("Deadly Poison", { critChance: 0 }).damageDone,
      white: directHit("Main-hand", "weapon").result.damage,
      strike: directHit("Hemorrhage", "skill").result.damage,
    }));
    assert.equal(unarmored.rupture, TICK_DAMAGE);
    assert.equal(unarmored.boosted, TICK_DAMAGE * bonus);
    assert.equal(unarmored.poison, TICK_DAMAGE);
    assert.equal(unarmored.white, TICK_DAMAGE);
    assert.equal(unarmored.strike, TICK_DAMAGE);

    const white = directHit("Main-hand", "weapon");
    const strike = directHit("Hemorrhage", "skill");
    assert.equal(white.result.outcome, "hit");
    assert.equal(strike.result.outcome, "hit");
    assert.equal(white.result.damage, TICK_DAMAGE * factor);
    assert.equal(strike.result.damage, TICK_DAMAGE * factor);
    assert.equal(white.sim.damageDone, white.result.damage);
    assert.equal(white.sim.combatLog[0].damage, white.result.damage);
    assert.ok(white.result.damage < unarmored.white);
    assert.ok(strike.result.damage < unarmored.strike);
    assert.equal(rupture.damageDone, unarmored.rupture);
    assert.equal(boosted.damageDone, unarmored.boosted);
  });

  it("reads bleed.ignoresArmor, bleed.spells, target armor, and attacker level", () => {
    mock.method(Math, "random", () => 0.5);
    const factor = expectedMultiplier();

    const armoredBleed = withConstant("bleed.ignoresArmor", false, () =>
      tickDot("Rupture", { critChance: 0 }),
    );
    assert.equal(armoredBleed.damageDone, TICK_DAMAGE * factor);

    const dropped = withConstant("bleed.spells", ["Garrote"], () => ({
      rupture: tickDot("Rupture", { critChance: 0 }).damageDone,
      garrote: tickDot("Garrote", { critChance: 0 }).damageDone,
    }));
    assert.equal(dropped.rupture, TICK_DAMAGE * factor);
    assert.equal(dropped.garrote, TICK_DAMAGE);

    const level = k("target.level");
    assert.notEqual(level, k("character.level"));
    const shifted = withConstant("character.level", level, () =>
      directHit("Main-hand", "weapon"),
    );
    assert.equal(shifted.result.outcome, "hit");
    assert.equal(
      shifted.result.damage,
      TICK_DAMAGE * expectedMultiplier(k("target.armor"), level),
    );
    assert.notEqual(shifted.result.damage, TICK_DAMAGE * factor);

    const mitigation = k("armor.mitigation");
    const rest =
      mitigation.constant + mitigation.perLevel * k("character.level");
    const pastCap = (mitigation.cap * rest) / (1 - mitigation.cap) + rest;
    const uncapped = pastCap / (pastCap + rest);
    assert.ok(uncapped > mitigation.cap);
    const capped = withConstant("target.armor", pastCap, () =>
      directHit("Sinister Strike", "skill"),
    );
    assert.equal(capped.result.outcome, "hit");
    assert.equal(capped.result.damage, TICK_DAMAGE * (1 - mitigation.cap));

    const negative = withConstant("target.armor", -k("target.armor"), () =>
      directHit("Main-hand", "weapon"),
    );
    assert.equal(negative.result.damage, TICK_DAMAGE);
  });

  it("keeps a cast Rupture tick at its pre-armor snapshot", () => {
    mock.method(Math, "random", () => HIT_ROLL);
    const rogue = new Rogue();
    rogue.rotation = () => {};
    rogue.critChance = 0;
    rogue.comboPoints = k("combo.max");
    rogue.energy = k("energy.max");
    const raw = rogue.abilities.rupture.damage();
    const ticks = Math.floor(
      rogue.abilities.rupture.duration / k("rupture.tickInterval"),
    );
    const sim = new Simulation(rogue);
    sim.gcd = 0;
    sim.lastFrameTime = 0;
    const cast = rogue.abilities.rupture.cast(rogue, sim);
    assert.equal(cast.landed, true);
    assert.equal(sim.damageDone, 0);
    const dot = sim.activeDots.Rupture;
    assert.equal(dot.bleed, true);
    assert.equal(dot.tickDamage, Math.floor(raw) / ticks);
    sim.update(k("rupture.tickInterval") * k("sim.msPerSecond"));
    assert.equal(sim.damageDone, dot.tickDamage);
    assert.ok(sim.damageDone > 0);
    assert.ok(sim.damageDone > dot.tickDamage * expectedMultiplier());
  });
});
