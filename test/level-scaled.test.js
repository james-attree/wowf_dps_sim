import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { decodeSetup, encodeSetup, runDefaults } from "../js/build-codec.js";
import { createFight, runFight } from "../js/fight.js";
import { characterLevel, targetArmor, targetLevel } from "../js/levels.js";
import { poisonCatalogue, poisonProcs } from "../js/poisons.js";
import { RANKED_ROWS, learnedAt, rankAt, rankedStats } from "../js/ranks.js";
import { weaponSkillFor } from "../js/attack-resolver.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";

// Level-scaled sims (#290): ranks by level, the enemy level, the attack table
// from the level gap, and the target armour from a benchmark table. Level 60
// against 63 is the fight the engine had before, number for number.

const rotationOf = (ids) => ({
  schemaVersion: 1,
  name: "Level test",
  rules: ids.map((action) => ({
    action,
    conditions:
      action === "rupture" ? [{ type: "comboPoints", op: ">=", value: 5 }] : [],
  })),
});

describe("ranks by level (#290)", () => {
  it("reads each rank's learn level from the export", () => {
    assert.equal(learnedAt("Sinister Strike"), 1);
    assert.equal(learnedAt("Backstab"), 4);
    assert.equal(learnedAt("Rupture"), 20);
    assert.equal(learnedAt("Expose Armor"), 14);
    assert.equal(learnedAt("Slice and Dice"), 10);
    assert.equal(learnedAt("Mutilate"), 40);
    assert.equal(learnedAt("Cold Blood"), 25);
    assert.equal(learnedAt("Instant Poison"), 20);
    assert.equal(learnedAt("Deadly Poison"), 30);
    // A racial has no spell_desc entry: it is there from level 1.
    assert.equal(learnedAt("Blood Fury"), 1);
  });

  it("picks the highest rank learned at or below the level", () => {
    assert.equal(rankAt("Sinister Strike", 40), 6);
    assert.equal(rankAt("Sinister Strike", 37), 5);
    assert.equal(rankAt("Sinister Strike", 60), 8);
    assert.equal(rankAt("Eviscerate", 40), 6);
    assert.equal(rankAt("Backstab", 40), 5);
    assert.equal(rankAt("Instant Poison", 40), 3);
    assert.equal(rankAt("Deadly Poison", 40), 2);
    assert.equal(rankAt("Rupture", 19), null);
  });

  it("gives the level 40 numbers of Sinister Strike, Eviscerate and Backstab", () => {
    assert.equal(rankedStats("sinisterStrike", 40).bonusDamage, 33);
    assert.deepEqual(rankedStats("eviscerate", 40).damageByCp[4], {
      min: 377,
      max: 421,
    });
    assert.deepEqual(rankedStats("eviscerate", 40).damageByCp[0], {
      min: 93,
      max: 137,
    });
    assert.equal(rankedStats("backstab", 40).bonusDamage, 90);
    assert.equal(rankedStats("backstab", 40).weaponMultiplier, 1.5);
    assert.deepEqual(
      rankedStats("rupture", 40).damageByCp,
      [53, 79, 109, 143, 183],
    );
    assert.equal(rankedStats("mutilate", 40).bonusDamage, 36);
    assert.equal(rankedStats("ambush", 40).bonusDamage, 125);
    assert.equal(rankedStats("exposeArmor", 40).armorPerComboPoint, 270);
    assert.equal(rankedStats("sliceAndDice", 41).haste, 0.2);
    assert.equal(rankedStats("sliceAndDice", 42).haste, 0.3);
  });

  it("is the constants row itself at the top rank, so level 60 is unchanged", () => {
    for (const row of RANKED_ROWS) {
      assert.equal(rankedStats(row, 60), k(row), row);
      assert.equal(rankedStats(row, undefined), k(row), row);
    }
  });

  it("agrees with the constants rows at the top rank, field for field", () => {
    // The overlay of the top rank, read from the export, is what the rows
    // hold: a row that drifts from the export fails here.
    for (const row of RANKED_ROWS) {
      const top = rankedStats(row, 60, { force: true });
      for (const [field, value] of Object.entries(top)) {
        assert.deepEqual(value, k(row)[field], `${row}.${field}`);
      }
    }
  });

  it("uses the ranked numbers in a fight at level 40", () => {
    const fight = createFight(1, { talentLevel: 40 });
    const strike = fight.rogue.abilitiesById.get("sinister-strike");
    assert.equal(strike.stats.bonusDamage, 33);
    const top = createFight(1, { talentLevel: 60 });
    assert.equal(
      top.rogue.abilitiesById.get("sinister-strike").stats,
      k("sinisterStrike"),
    );
  });

  it("gives Slice and Dice rank 1 haste below level 42", () => {
    const low = createFight(1, { talentLevel: 40 });
    const aura = low.rogue.abilitiesById.get("slice-and-dice").aura;
    assert.equal(aura.id, "slice-and-dice");
    assert.equal(aura.effects.haste, 0.2);
    assert.equal(low.simulation.auraDefinitions.get("slice-and-dice"), aura);
    const top = createFight(1, { talentLevel: 60 });
    assert.equal(
      top.rogue.abilitiesById.get("slice-and-dice").aura.effects.haste,
      0.3,
    );
  });

  it("gives Expose Armor its rank's armour per combo point", () => {
    const low = createFight(1, { talentLevel: 40 });
    assert.equal(
      low.rogue.abilitiesById.get("expose-armor").aura.effects.armorReduction,
      270,
    );
  });
});

describe("abilities not learned yet (#290)", () => {
  it("locks an ability whose first rank is above the level", () => {
    const fight = createFight(1, { talentLevel: 18 });
    const { rogue } = fight;
    assert.equal(rogue.level, 18);
    assert.equal(rogue.lockedByLevel(rogue.abilitiesById.get("rupture")), true);
    assert.equal(
      rogue.lockedByLevel(rogue.abilitiesById.get("expose-armor")),
      false,
    );
    assert.equal(
      rogue.lockedByLevel(rogue.abilitiesById.get("sinister-strike")),
      false,
    );
  });

  it("passes over an unlearned ability's rule silently", () => {
    const result = runFight({
      seed: 7,
      duration: 60,
      config: {
        talentLevel: 18,
        rotation: rotationOf(["rupture", "sinister-strike"]),
      },
    });
    assert.equal(result.abilities.Rupture, undefined);
    assert.ok(result.abilities["Sinister Strike"].casts > 0);
    // At 20 it is learned (rank 1) and cast.
    const learned = runFight({
      seed: 7,
      duration: 60,
      config: {
        talentLevel: 20,
        rotation: rotationOf(["rupture", "sinister-strike"]),
      },
    });
    assert.ok(learned.abilities.Rupture.casts > 0);
  });
});

describe("poisons by rank (#290)", () => {
  const poisons = { mainHand: "instant", offHand: "deadly" };

  it("uses the highest rank learned", () => {
    const [instant, deadly] = poisonProcs(poisons, poisonCatalogue, k, 0, 40);
    const hit = instant.actions[0];
    assert.deepEqual([hit.min, hit.max], [29, 37]);
    assert.equal(instant.chance.value, 0.2);
    // Rank 2: 36 over 12 s, four ticks of 9.
    assert.equal(deadly.actions[0].tickDamage, 9);
    assert.equal(deadly.chance.value, 0.3);
  });

  it("gives no proc for a poison not learned yet", () => {
    assert.deepEqual(poisonProcs(poisons, poisonCatalogue, k, 0, 19), []);
    assert.equal(poisonProcs(poisons, poisonCatalogue, k, 0, 29).length, 1);
  });

  it("is the top rank at 60 and with no level", () => {
    assert.deepEqual(
      poisonProcs(poisons, poisonCatalogue, k, 0, 60),
      poisonProcs(poisons),
    );
    assert.deepEqual(
      [
        poisonProcs(poisons)[0].actions[0].min,
        poisonProcs(poisons)[0].actions[0].max,
      ],
      [76, 100],
    );
  });
});

describe("the enemy level (#290)", () => {
  it("defaults to null, which follows the character level + 3", () => {
    assert.equal(defaultConfig().target.level, null);
    assert.equal(normalizeConfig({}).target.level, null);
    assert.equal(k("target.levelAboveCharacter"), 3);
    assert.equal(targetLevel(normalizeConfig({})), 63);
    assert.equal(targetLevel(normalizeConfig({ talentLevel: 40 })), 43);
    assert.equal(characterLevel(normalizeConfig({ talentLevel: 40 })), 40);
  });

  it("keeps an edited level whatever the character level", () => {
    const config = normalizeConfig({ talentLevel: 40, target: { level: 40 } });
    assert.equal(targetLevel(config), 40);
    assert.equal(targetLevel({ ...config, talentLevel: 60 }), 40);
  });

  it("refuses a level that is not a whole number from 1 to 63", () => {
    for (const level of [0, 64, 40.5, "40", Number.NaN]) {
      assert.throws(
        () => normalizeConfig({ target: { level } }),
        /config\.target\.level/,
        String(level),
      );
    }
  });

  it("reads an old config with no level as the default (G4)", () => {
    const old = normalizeConfig({ target: { behind: true } });
    assert.equal(old.target.level, null);
    assert.equal(targetLevel(old), 63);
    const link = encodeSetup({
      config: normalizeConfig({}),
      run: runDefaults(),
    });
    assert.equal(decodeSetup(link).setup.config.target.level, null);
  });

  it("carries an edited level through a share link", () => {
    const config = normalizeConfig({ target: { level: 61 } });
    const decoded = decodeSetup(encodeSetup({ config, run: runDefaults() }))
      .setup.config;
    assert.equal(decoded.target.level, 61);
  });
});

describe("weapon skill follows the level (#290)", () => {
  it("defaults to null: level x 5", () => {
    assert.equal(normalizeConfig({}).character.weaponSkill, null);
    assert.equal(weaponSkillFor(normalizeConfig({})), 300);
    assert.equal(weaponSkillFor(normalizeConfig({ talentLevel: 40 })), 200);
  });

  it("caps a typed skill at that level's maximum", () => {
    assert.equal(
      normalizeConfig({ talentLevel: 40, character: { weaponSkill: 250 } })
        .character.weaponSkill,
      250,
    );
    assert.throws(
      () =>
        normalizeConfig({ talentLevel: 40, character: { weaponSkill: 251 } }),
      /config\.character\.weaponSkill/,
    );
  });
});

// The attack table of wowsims classic's NewAttackTable
// (sim/core/attack_table.go), for a level L attacker at level x 5 skill.
function wowsims(attacker, defender) {
  const base = attacker * 5;
  const def = defender * 5;
  const gap = def - base;
  const levelGap = defender - attacker;
  const miss = gap > 10 ? 0.05 + gap * 0.002 : 0.05 + gap * 0.001;
  return {
    miss,
    hitSuppression: gap > 10 ? (gap - 10) * 0.002 : 0,
    dodge: 0.05 + gap * 0.001,
    glancing: 0.1 + gap * 0.02,
    glancingLow: Math.max(0.01, Math.min(0.91, 1.3 - 0.05 * gap)),
    glancingHigh: Math.max(0.2, Math.min(0.99, 1.2 - 0.03 * gap)),
    critSuppression:
      (gap > 0 ? gap * 0.002 : gap * 0.0004) + (levelGap >= 3 ? 0.018 : 0),
    spellMiss: [0.04, 0.05, 0.06, 0.17][Math.max(0, Math.min(3, levelGap))],
  };
}

function engineTable(config) {
  const table = createFight(1, config).simulation.attackTable;
  return {
    miss: table.miss,
    hitSuppression: table.hitSuppression,
    dodge: table.dodge,
    glancing: table.glancing,
    glancingLow: table.glancingDamage.low,
    glancingHigh: table.glancingDamage.high,
    critSuppression: table.crit.skill + table.crit.flat + table.crit.levelAura,
    spellMiss: table.spellMiss.chance,
  };
}

function assertClose(actual, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    assert.ok(
      Math.abs(actual[field] - value) < 1e-9,
      `${label} ${field}: ${actual[field]} vs ${value}`,
    );
  }
}

describe("the attack table from the level gap (#290)", () => {
  for (const level of [10, 20, 30, 40, 50, 60]) {
    it(`level ${level} against ${level + 3}`, () => {
      const actual = engineTable({ talentLevel: level });
      assertClose(actual, wowsims(level, level + 3), `${level}v${level + 3}`);
      // A +3 target is the same gap at every level: 8% miss, 6.5% dodge, 40%
      // glancing, 3% + 1.8% crit off.
      assertClose(
        actual,
        { miss: 0.08, dodge: 0.065, glancing: 0.4, critSuppression: 0.048 },
        `${level}v${level + 3}`,
      );
    });
  }

  it("level 40 against 40 is the even table", () => {
    const actual = engineTable({ talentLevel: 40, target: { level: 40 } });
    assertClose(actual, wowsims(40, 40), "40v40");
    assertClose(
      actual,
      {
        miss: 0.05,
        hitSuppression: 0,
        dodge: 0.05,
        glancing: 0.1,
        critSuppression: 0,
        spellMiss: 0.04,
      },
      "40v40",
    );
  });

  it("level 40 against 41 and 42", () => {
    assertClose(
      engineTable({ talentLevel: 40, target: { level: 41 } }),
      wowsims(40, 41),
      "40v41",
    );
    assertClose(
      engineTable({ talentLevel: 40, target: { level: 42 } }),
      wowsims(40, 42),
      "40v42",
    );
  });

  it("60 against 63 is the table it was", () => {
    assert.deepEqual(
      createFight(1, {}).simulation.attackTable,
      createFight(1, { talentLevel: 60, target: { level: 63 } }).simulation
        .attackTable,
    );
  });
});

describe("target armour by level (#290)", () => {
  it("is the benchmark table at its points", () => {
    assert.equal(targetArmor(63), 3731);
    assert.equal(targetArmor(63), k("target.armor"));
    assert.equal(targetArmor(52), 3137);
    assert.equal(targetArmor(42), 2053);
    assert.equal(targetArmor(27), 1104);
  });

  it("interpolates between the points, rounded", () => {
    assert.equal(targetArmor(13), 532);
    assert.equal(targetArmor(23), 940);
    assert.equal(targetArmor(33), 1484);
    assert.equal(targetArmor(43), 2161);
    assert.equal(targetArmor(53), 3191);
    let last = -1;
    for (let level = 1; level <= 63; level += 1) {
      assert.ok(targetArmor(level) > last, String(level));
      last = targetArmor(level);
    }
  });

  it("sets the armour divisor from the fight's levels", () => {
    const { simulation } = createFight(1, { talentLevel: 40 });
    const { constant, perLevel } = k("armor.mitigation");
    const armor = 2161;
    assert.ok(
      Math.abs(
        simulation.armorMultiplier({}) -
          (1 - armor / (armor + constant + perLevel * 40)),
      ) < 1e-12,
    );
    const top = createFight(1, {}).simulation;
    assert.ok(
      Math.abs(
        top.armorMultiplier({}) -
          (1 - 3731 / (3731 + constant + perLevel * 60)),
      ) < 1e-12,
    );
  });
});

describe("level 60 is unchanged (#290)", () => {
  it("gives the same fight for no level, 60 and an explicit 63", () => {
    const base = runFight({ seed: 11, duration: 120 });
    const explicit = runFight({
      seed: 11,
      duration: 120,
      config: { talentLevel: 60, target: { level: 63 } },
    });
    assert.equal(explicit.totalDamage, base.totalDamage);
    assert.deepEqual(explicit.abilities, base.abilities);
  });
});
