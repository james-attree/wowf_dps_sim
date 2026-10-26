import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { AURAS } from "../js/auras.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

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

// The display name of each id the tests use. The engine takes the id.
const NAMES = {
  rupture: "Rupture",
  garrote: "Garrote",
  "deadly-poison": "Deadly Poison",
  hemorrhage: "Hemorrhage",
  "ghostly-strike": "Ghostly Strike",
  "sinister-strike": "Sinister Strike",
  "main-hand": "Main-hand",
  "off-hand": "Off-hand",
};

function tickDot(id, { hemorrhage = false, bleed = false, critChance } = {}) {
  const rogue = new Rogue();
  rogue.rotation = () => {};
  if (critChance !== undefined) {
    rogue.critChance = critChance;
  }
  const sim = new Simulation(rogue, { rng: testRng });
  const tickInterval = k("rupture.tickInterval");
  const dot = {
    name: NAMES[id],
    duration: tickInterval,
    tickInterval,
    timeUntilNextTick: tickInterval,
    tickDamage: TICK_DAMAGE,
    icon: null,
  };
  if (bleed) {
    dot.bleed = true;
  }
  sim.activeDots[id] = dot;
  if (hemorrhage) {
    sim.applyAura(AURAS.hemorrhage);
  }
  sim.step(tickInterval);
  return sim;
}

function directHit(id, attackType) {
  setRoll(HIT_ROLL);
  const rogue = new Rogue();
  rogue.rotation = () => {};
  rogue.critChance = 0;
  const sim = new Simulation(rogue, { rng: testRng });
  const result = sim.resolveAttack(
    { id, name: NAMES[id] },
    attackType,
    TICK_DAMAGE,
  );
  return { result, sim };
}

describe("DoT crit multiplier", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("crits Rupture, Garrote, and Deadly Poison ticks from dot.critMultiplier", () => {
    setRoll(0);
    const multiplier = k("dot.critMultiplier");
    const factor = expectedMultiplier();
    assert.ok(factor < 1);

    for (const name of ["rupture", "garrote"]) {
      const sim = tickDot(name);
      assert.equal(sim.damageDone, TICK_DAMAGE * multiplier, name);
      assert.equal(sim.combatLog[0].status, "Crit", name);
      assert.equal(sim.combatLog[0].damage, sim.damageDone, name);
    }

    const poison = tickDot("deadly-poison");
    assert.equal(poison.damageDone, TICK_DAMAGE * multiplier);
    assert.equal(poison.combatLog[0].status, "Crit");
    assert.equal(poison.combatLog[0].damage, poison.damageDone);
    assert.ok(poison.damageDone > TICK_DAMAGE * multiplier * factor);

    const other = k("glancing.damage");
    assert.notEqual(other, multiplier);
    const changed = withConstant("dot.critMultiplier", other, () => ({
      rupture: tickDot("rupture").damageDone,
      poison: tickDot("deadly-poison").damageDone,
    }));
    assert.equal(changed.rupture, TICK_DAMAGE * other);
    assert.equal(changed.poison, TICK_DAMAGE * other);
    assert.notEqual(changed.poison, TICK_DAMAGE * multiplier);

    const blocked = withConstant("dot.canCrit", false, () =>
      tickDot("garrote"),
    );
    assert.equal(blocked.damageDone, TICK_DAMAGE);
    assert.equal(blocked.combatLog[0].status, "Hit");
  });
});

describe("bleed ticks and armor", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("does not reduce bleed or Deadly Poison ticks, and does reduce physical hits", () => {
    setRoll(0.5);
    const factor = expectedMultiplier();
    assert.ok(factor < 1);
    const bonus = 1 + k("hemorrhage.ruptureBonus").bonus;

    const rupture = tickDot("rupture", { critChance: 0 });
    const garrote = tickDot("garrote", { critChance: 0 });
    const hemorrhageTick = tickDot("hemorrhage", {
      critChance: 0,
      bleed: true,
    });
    const boosted = tickDot("rupture", { critChance: 0, hemorrhage: true });
    const garroteBoosted = tickDot("garrote", {
      critChance: 0,
      hemorrhage: true,
    });
    const poison = tickDot("deadly-poison", { critChance: 0 });
    const poisonBoosted = tickDot("deadly-poison", {
      critChance: 0,
      hemorrhage: true,
    });

    assert.equal(rupture.damageDone, TICK_DAMAGE);
    assert.equal(garrote.damageDone, TICK_DAMAGE);
    assert.equal(hemorrhageTick.damageDone, TICK_DAMAGE);
    assert.equal(boosted.damageDone, TICK_DAMAGE * bonus);
    assert.equal(garroteBoosted.damageDone, TICK_DAMAGE);
    assert.equal(poison.damageDone, TICK_DAMAGE);
    assert.equal(poisonBoosted.damageDone, TICK_DAMAGE);
    assert.equal(poison.combatLog[0].damage, TICK_DAMAGE);

    const unarmored = withConstant("target.armor", 0, () => ({
      rupture: tickDot("rupture", { critChance: 0 }).damageDone,
      boosted: tickDot("rupture", { critChance: 0, hemorrhage: true })
        .damageDone,
      poison: tickDot("deadly-poison", { critChance: 0 }).damageDone,
      white: directHit("main-hand", "weapon").result.damage,
      strike: directHit("hemorrhage", "skill").result.damage,
      ghostly: directHit("ghostly-strike", "skill").result.damage,
    }));
    assert.equal(unarmored.rupture, TICK_DAMAGE);
    assert.equal(unarmored.boosted, TICK_DAMAGE * bonus);
    assert.equal(unarmored.poison, TICK_DAMAGE);
    assert.equal(unarmored.white, TICK_DAMAGE);
    assert.equal(unarmored.strike, TICK_DAMAGE);
    assert.equal(unarmored.ghostly, TICK_DAMAGE);

    const white = directHit("main-hand", "weapon");
    const strike = directHit("hemorrhage", "skill");
    const ghostly = directHit("ghostly-strike", "skill");
    assert.equal(white.result.outcome, "hit");
    assert.equal(strike.result.outcome, "hit");
    assert.equal(ghostly.result.outcome, "hit");
    assert.equal(white.result.damage, TICK_DAMAGE * factor);
    assert.equal(strike.result.damage, TICK_DAMAGE * factor);
    assert.equal(ghostly.result.damage, TICK_DAMAGE * factor);
    assert.equal(white.sim.damageDone, white.result.damage);
    assert.equal(white.sim.combatLog[0].damage, white.result.damage);
    assert.ok(white.result.damage < unarmored.white);
    assert.ok(strike.result.damage < unarmored.strike);
    assert.ok(ghostly.result.damage < unarmored.ghostly);
    assert.equal(rupture.damageDone, unarmored.rupture);
    assert.equal(boosted.damageDone, unarmored.boosted);
    assert.equal(poison.damageDone, unarmored.poison);
  });

  it("reads bleed.ignoresArmor, bleed.spells, target armor, and attacker level", () => {
    setRoll(0.5);
    const factor = expectedMultiplier();

    const armoredBleed = withConstant("bleed.ignoresArmor", false, () =>
      tickDot("rupture", { critChance: 0 }),
    );
    assert.equal(armoredBleed.damageDone, TICK_DAMAGE * factor);

    const dropped = withConstant("bleed.spells", ["garrote"], () => ({
      rupture: tickDot("rupture", { critChance: 0 }).damageDone,
      garrote: tickDot("garrote", { critChance: 0 }).damageDone,
    }));
    assert.equal(dropped.rupture, TICK_DAMAGE * factor);
    assert.equal(dropped.garrote, TICK_DAMAGE);

    const natureOff = withConstant("nature.ignoresArmor", false, () =>
      tickDot("deadly-poison", { critChance: 0 }),
    );
    assert.equal(natureOff.damageDone, TICK_DAMAGE * factor);
    const notNature = withConstant("nature.spells", [], () =>
      tickDot("deadly-poison", { critChance: 0 }),
    );
    assert.equal(notNature.damageDone, TICK_DAMAGE * factor);

    const level = k("target.level");
    assert.notEqual(level, k("character.level"));
    const shifted = withConstant("character.level", level, () =>
      directHit("main-hand", "weapon"),
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
      directHit("sinister-strike", "skill"),
    );
    assert.equal(capped.result.outcome, "hit");
    assert.equal(capped.result.damage, TICK_DAMAGE * (1 - mitigation.cap));

    const negative = withConstant("target.armor", -k("target.armor"), () =>
      directHit("main-hand", "weapon"),
    );
    assert.equal(negative.result.damage, TICK_DAMAGE);
  });

  it("keeps a cast Rupture tick at its pre-armor snapshot", () => {
    setRoll(HIT_ROLL);
    const rogue = new Rogue();
    rogue.rotation = () => {};
    rogue.critChance = 0;
    rogue.comboPoints = k("combo.max");
    rogue.energy = k("energy.max");
    const raw = rogue.abilities.rupture.damage();
    const ticks = Math.floor(
      rogue.abilities.rupture.duration / k("rupture.tickInterval"),
    );
    const sim = new Simulation(rogue, { rng: testRng });
    sim.gcd = 0;
    const cast = rogue.abilities.rupture.cast(rogue, sim);
    assert.equal(cast.landed, true);
    assert.equal(sim.damageDone, 0);
    const dot = sim.activeDots.rupture;
    assert.equal(dot.bleed, true);
    assert.equal(dot.tickDamage, Math.floor(raw) / ticks);
    sim.step(k("rupture.tickInterval"));
    assert.equal(sim.damageDone, dot.tickDamage);
    assert.ok(sim.damageDone > 0);
    assert.ok(sim.damageDone > dot.tickDamage * expectedMultiplier());
  });
});
