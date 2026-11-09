// TR-07 / #336: Death Mark stores a fraction of damage dealt, doubles
// Rupture and Garrote, and releases the stored amount after 6 s, capped.
// Coup de Grace scales the storage rate and the damage dealt.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "../js/abilities.js";
import { createFight, runFight } from "../js/fight.js";
import { CONDITION_TYPES } from "../js/rotation-conditions.js";
import { rankedStats } from "../js/ranks.js";
import { expandTalents } from "../js/talent-build.js";
import { runOnCore } from "../js/core/fight.js";

const swords = {
  character: { attackPower: 0, critChance: 0 },
  target: { armor: 0 },
  weapons: {
    mainHand: { type: "sword", min: 100, max: 100, speed: 100 },
    offHand: { type: "sword", min: 40, max: 40, speed: 100 },
  },
  rotation: {
    schemaVersion: 1,
    name: "idle",
    rules: [
      {
        action: "sinister-strike",
        conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
      },
    ],
  },
};

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

function fight(talents = {}, config = swords) {
  const build = expandTalents(talents);
  const built = createFight(1, config, {
    modifiers: build.modifiers,
    procs: build.procs,
    abilities: build.abilities,
  });
  if (built.simulation.hasAura("poised")) {
    built.simulation.consumeCharge("poised");
  }
  built.rogue.energy = built.rogue.maxEnergy;
  built.simulation.gcd = 0;
  built.simulation.rng = () => 0.99;
  return built;
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

function holdSwings(h) {
  h.rogue.weapons.mainHand.swingTimer = 999;
  h.rogue.weapons.offHand.swingTimer = 999;
}

function cast(h, key) {
  const { rogue, simulation } = h;
  rogue.energy = rogue.maxEnergy;
  simulation.gcd = 0;
  simulation.cooldowns[rogue.abilities[key].id] = 0;
  return rogue.abilities[key].cast(rogue, simulation);
}

describe("TR-07 Death Mark data (#336)", () => {
  it("tags the AP and crit cap terms as configurable assumptions", () => {
    for (const id of ["deathMark.apPerCp", "deathMark.cap"]) {
      assert.equal(CONSTANTS[id].source, "assumption");
      assert.equal(CONSTANTS[id].retune, true);
      assert.match(CONSTANTS[id].ref, /Developer, 9 Nov 2026, issue #336/);
      assert.match(
        CONSTANTS[id].ref,
        /does not quote 0\.04|does not quote that tooltip/,
      );
      assert.doesNotMatch(CONSTANTS[id].ref, /James, 5 Nov 2026/);
    }
    assert.equal(k("deathMark.apPerCp"), 0.04);
    assert.equal(k("deathMark.cap"), "ap and crit");
    assert.equal(CONSTANTS.deathMark.source, "wowf-export");
    assert.equal(k("deathMark.doubleRate"), 2);
    assert.deepEqual(k("deathMark.double"), ["rupture", "garrote"]);
  });

  it("reads rank 4 storage and caps from the export, and lower ranks from the same text", () => {
    const spell = abilityCatalogue.get("death-mark");
    assert.equal(spell.cost.amount, k("deathMark").energy);
    assert.equal(spell.cooldown, k("deathMark").cooldown);
    assert.match(spell.text, /After 6 sec/);
    assert.deepEqual(
      spell.perComboPoint.map((row) => row.storedPercent),
      k("deathMark").storedByCp,
    );
    assert.deepEqual(
      spell.perComboPoint.map((row) => row.damageCap),
      k("deathMark").capByCp,
    );
    assert.equal(rankedStats("deathMark", 60), k("deathMark"));
    assert.deepEqual(
      rankedStats("deathMark", 40).capByCp,
      [165, 267, 369, 471, 573],
    );
    assert.deepEqual(
      rankedStats("deathMark", 40).storedByCp,
      [0.12, 0.24, 0.36, 0.48, 0.6],
    );
  });

  it("clears the pending mark and grants the ability", () => {
    assert.equal(TALENT_EFFECTS["subtlety.death-mark"].pending, undefined);
    assert.equal(TALENT_EFFECTS["subtlety.death-mark"].ability, "death-mark");
    assert.deepEqual(expandTalents({ "subtlety.death-mark": 1 }).abilities, [
      "death-mark",
    ]);
  });

  it("has no deathMarkStored rotation condition", () => {
    assert.equal(CONDITION_TYPES.includes("deathMarkStored"), false);
  });
});

describe("TR-07 Death Mark in a fight (#336)", () => {
  it("a landed cast marks for 6 s and spends combo points; a miss does not", () => {
    const h = fight({ "subtlety.death-mark": 1 });
    h.rogue.comboPoints = 5;
    h.simulation.rng = () => 0;
    assert.equal(cast(h, "deathMark").landed, false);
    assert.equal(h.simulation.hasAura("death-mark"), false);
    assert.equal(h.rogue.comboPoints, 5);
    h.simulation.rng = () => 0.99;
    const landed = cast(h, "deathMark");
    assert.equal(landed.landed, true);
    assert.equal(h.rogue.comboPoints, 0);
    assert.equal(
      h.simulation.activeDebuffs["death-mark"].duration,
      k("deathMark").duration,
    );
    assert.equal(h.simulation.activeDebuffs["death-mark"].stored, 0);
    assert.equal(h.simulation.activeDebuffs["death-mark"].rate, 0.6);
  });

  it("stores the fraction of a hit, and twice that for a Rupture tick", () => {
    const h = fight({ "subtlety.death-mark": 1 });
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    const strike = cast(h, "sinisterStrike");
    const mark = h.simulation.activeDebuffs["death-mark"];
    close(mark.stored, strike.damage * 0.12);
    h.rogue.comboPoints = 1;
    cast(h, "rupture");
    holdSwings(h);
    runOnCore(h.simulation, 2);
    const tick = h.simulation.abilityStats.rupture.damage;
    assert.ok(tick > 0);
    close(mark.stored, strike.damage * 0.12 + tick * 0.12 * 2);
  });

  it("releases min(stored, cap) after 6 s onto the Death Mark breakdown row", () => {
    const h = fight({ "subtlety.death-mark": 1 });
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    const strike = cast(h, "sinisterStrike");
    const before = h.simulation.damageDone;
    holdSwings(h);
    runOnCore(h.simulation, k("deathMark").duration);
    const expected = strike.damage * 0.12;
    assert.ok(expected < k("deathMark").capByCp[0]);
    assert.equal(h.simulation.hasAura("death-mark"), false);
    close(h.simulation.damageDone - before, expected);
    const row = h.simulation.abilityBreakdown()["Death Mark"];
    assert.equal(row.casts, 1);
    assert.equal(row.damage, expected);
  });

  it("raises the cap by Attack Power and crit, and a flat mode uses the export cap", () => {
    const config = {
      ...swords,
      character: { attackPower: 1000, critChance: 0.25 },
    };
    const h = fight({ "subtlety.death-mark": 1 }, config);
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    h.simulation.activeDebuffs["death-mark"].stored = 100000;
    holdSwings(h);
    runOnCore(h.simulation, k("deathMark").duration);
    const cap = (401 + 1 * 0.04 * 1000) * 1.25;
    assert.equal(h.simulation.abilityStats["death-mark"].damage, cap);

    withConstant("deathMark.cap", "export", () => {
      const flat = fight({ "subtlety.death-mark": 1 }, config);
      flat.rogue.comboPoints = 1;
      cast(flat, "deathMark");
      flat.simulation.activeDebuffs["death-mark"].stored = 100000;
      holdSwings(flat);
      runOnCore(flat.simulation, k("deathMark").duration);
      assert.equal(flat.simulation.abilityStats["death-mark"].damage, 401);
    });
  });

  it("stores the post-armor hit, not the pre-armor roll", () => {
    const h = fight(
      { "subtlety.death-mark": 1 },
      { ...swords, target: { armor: 20000 } },
    );
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    const strike = cast(h, "sinisterStrike");
    const context = h.simulation.attackContext(
      h.rogue.abilities.sinisterStrike,
      "skill",
    );
    const kept = h.simulation.armorMultiplier(context);
    assert.ok(kept < 0.5, `armor should matter, kept ${kept}`);
    assert.ok(strike.damage > 0);
    close(
      h.simulation.activeDebuffs["death-mark"].stored,
      strike.damage * 0.12,
    );
    const preArmor = strike.damage / kept;
    assert.ok(preArmor > strike.damage * 1.5);
    assert.ok(
      Math.abs(
        h.simulation.activeDebuffs["death-mark"].stored - preArmor * 0.12,
      ) > 1,
    );
  });

  it("the release draws no random number", () => {
    const h = fight({ "subtlety.death-mark": 1 });
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    cast(h, "sinisterStrike");
    holdSwings(h);
    let draws = 0;
    const rng = h.simulation.rng;
    const wrap = () => {
      draws += 1;
      return rng();
    };
    h.simulation.rng = wrap;
    h.rogue.rng = wrap;
    runOnCore(h.simulation, k("deathMark").duration);
    assert.equal(draws, 0);
    assert.ok(h.simulation.abilityStats["death-mark"].damage > 0);
  });

  it("the cap follows combo points in the export base and the AP term", () => {
    const config = {
      ...swords,
      character: { attackPower: 1000, critChance: 0.25 },
    };
    const dealt = (points) => {
      const h = fight({ "subtlety.death-mark": 1 }, config);
      h.rogue.comboPoints = points;
      cast(h, "deathMark");
      h.simulation.activeDebuffs["death-mark"].stored = 100000;
      holdSwings(h);
      runOnCore(h.simulation, k("deathMark").duration);
      return h.simulation.abilityStats["death-mark"].damage;
    };
    const cap = (points) =>
      (k("deathMark").capByCp[points - 1] + points * 0.04 * 1000) * 1.25;
    assert.equal(dealt(2), cap(2));
    assert.equal(dealt(5), cap(5));
    assert.notEqual(cap(1), cap(2));
    assert.notEqual(cap(2), cap(5));
    assert.equal(cap(5), (1381 + 5 * 40) * 1.25);
  });

  it("Coup de Grace scales storage and the damage dealt, not the cap", () => {
    const talents = {
      "subtlety.death-mark": 1,
      "combat.coup-de-grace": 3,
    };
    const h = fight(talents);
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    assert.equal(h.simulation.activeDebuffs["death-mark"].rate, 0.12 * 1.2);
    const strike = cast(h, "sinisterStrike");
    const stored = strike.damage * 0.12 * 1.2;
    close(h.simulation.activeDebuffs["death-mark"].stored, stored);
    holdSwings(h);
    runOnCore(h.simulation, k("deathMark").duration);
    close(h.simulation.abilityStats["death-mark"].damage, stored * 1.2);

    const capped = fight(talents, {
      ...swords,
      character: { attackPower: 0, critChance: 0 },
    });
    capped.rogue.comboPoints = 1;
    cast(capped, "deathMark");
    capped.simulation.activeDebuffs["death-mark"].stored = 100000;
    holdSwings(capped);
    runOnCore(capped.simulation, k("deathMark").duration);
    assert.equal(
      capped.simulation.abilityStats["death-mark"].damage,
      401 * 1.2,
    );
  });

  it("a second landed cast replaces the stored total", () => {
    const h = fight({ "subtlety.death-mark": 1 });
    h.rogue.comboPoints = 5;
    cast(h, "deathMark");
    cast(h, "sinisterStrike");
    assert.ok(h.simulation.activeDebuffs["death-mark"].stored > 0);
    h.rogue.comboPoints = 1;
    cast(h, "deathMark");
    assert.equal(h.simulation.activeDebuffs["death-mark"].stored, 0);
    assert.equal(h.simulation.activeDebuffs["death-mark"].rate, 0.12);
  });

  it("granting Death Mark without a rule adds no cast and no draw", () => {
    function counted(abilities) {
      const built = createFight(1, undefined, {
        duration: 30,
        ...(abilities ? { abilities } : {}),
      });
      let draws = 0;
      const rng = built.simulation.rng;
      const wrap = () => {
        draws += 1;
        return rng();
      };
      built.simulation.rng = wrap;
      built.rogue.rng = wrap;
      built.simulation.run(30);
      return {
        draws,
        damage: built.simulation.damageDone,
        casts: built.simulation.abilityStats["death-mark"]?.casts ?? 0,
      };
    }
    const plain = counted();
    const granted = counted(["death-mark"]);
    assert.equal(granted.casts, 0);
    assert.equal(granted.draws, plain.draws);
    assert.equal(granted.damage, plain.damage);
    const reported = runFight({ seed: 1, duration: 30 });
    assert.equal(reported.abilities["Death Mark"], undefined);
  });
});
