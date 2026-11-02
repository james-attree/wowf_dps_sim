import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import {
  attackChances,
  deriveAttackTable,
  suppressCrit,
  weaponSkillFor,
} from "../js/attack-resolver.js";
import { rankAt, rankedStats, spellRanks } from "../js/ranks.js";
import { normalizeConfig } from "../js/sim-config.js";

// Kira's #317 edge cases, with Scout's rulings (2 Nov 2026): crit suppression
// never goes below 0 (A9), glancing has a configurable maximum and one roll
// never totals more than 100% (A10), the level x 5 + 50 cap is on the typed
// base skill with any racial bonus on top (A11), the weapon skill reads the
// shared level helper, and the highest rank wins a tie at one level.

function withRows(changes, run) {
  const originals = Object.fromEntries(
    Object.keys(changes).map((id) => [id, CONSTANTS[id].value]),
  );
  for (const [id, value] of Object.entries(changes)) {
    CONSTANTS[id].value = value;
  }
  try {
    return run();
  } finally {
    for (const [id, value] of Object.entries(originals)) {
      CONSTANTS[id].value = value;
    }
  }
}

const tableAt = (characterLevel, targetLevel, weaponSkill) =>
  deriveAttackTable({
    weaponSkill: weaponSkill ?? characterLevel * 5,
    characterLevel,
    targetLevel,
  });

const PAIRS = [
  [60, 1],
  [10, 63],
  [40, 40],
  [60, 63],
];

describe("crit suppression never goes below 0 (#317, A9)", () => {
  it("every crit term is at least 0, on both crit models", () => {
    for (const model of ["classic", "gapAura"]) {
      withRows({ "attackTable.critModel": model }, () => {
        for (const [c, t] of PAIRS) {
          for (const skill of [c * 5, c * 5 + 50]) {
            const { crit } = tableAt(c, t, skill);
            for (const [term, value] of Object.entries(crit)) {
              assert.ok(
                value >= 0,
                `${model} ${c}v${t} ${skill}: ${term} ${value}`,
              );
            }
          }
        }
      });
    }
  });

  it("a lower-level target or a skill above the defense gives no crit bonus", () => {
    for (const model of ["classic", "gapAura"]) {
      withRows({ "attackTable.critModel": model }, () => {
        assert.equal(suppressCrit(0.2, tableAt(60, 1)), 0.2, `${model} 60v1`);
        assert.equal(
          suppressCrit(0.2, tableAt(60, 60, 350)),
          0.2,
          `${model} 60v60 at 350`,
        );
      });
    }
  });

  it("60 against 63 at 300 skill is unchanged: 3% + 1.8%", () => {
    const { crit } = tableAt(60, 63);
    assert.deepEqual(crit, { skill: 0.03, flat: 0.018, levelAura: 0 });
  });
});

describe("glancing has a maximum and one roll is at most 100% (#317, A10)", () => {
  const firstRoll = (chances, white) =>
    chances.miss +
    chances.dodge +
    chances.parry +
    chances.glancing +
    chances.block +
    (white ? chances.crit : 0);

  it("attackTable.glancing has max 0.4, and the table holds glancing to it", () => {
    assert.equal(k("attackTable.glancing").max, 0.4);
    assert.equal(tableAt(10, 63).glancing, 0.4);
    assert.equal(tableAt(60, 63).glancing, 0.4);
    assert.equal(tableAt(40, 40).glancing, 0.1);
    assert.equal(tableAt(60, 1).glancing, 0);
    withRows(
      { "attackTable.glancing": { ...k("attackTable.glancing"), max: 0.25 } },
      () => assert.equal(tableAt(60, 63).glancing, 0.25),
    );
  });

  it("no row is below 0 and no roll totals more than 100% at 60v1, 10v63 and 40v40", () => {
    for (const [c, t] of PAIRS) {
      const table = tableAt(c, t);
      for (const row of ["miss", "dodge", "glancing", "hitSuppression"]) {
        assert.ok(table[row] >= 0, `${c}v${t} ${row} ${table[row]}`);
      }
      for (const behind of [true, false]) {
        for (const attackType of ["weapon", "skill"]) {
          const chances = attackChances({
            attackType,
            bonusHitChance: 0,
            critChance: 0.3,
            behind,
            table,
          });
          for (const [band, value] of Object.entries(chances)) {
            assert.ok(value >= 0, `${c}v${t} ${attackType} ${band} ${value}`);
          }
          const total = firstRoll(chances, attackType === "weapon");
          assert.ok(
            total <= 1 + 1e-12,
            `${c}v${t} ${attackType} behind ${behind}: ${total}`,
          );
        }
      }
    }
  });

  it("10v63 fills the roll in order: miss and dodge first, then what is left", () => {
    const table = tableAt(10, 63);
    const white = attackChances({
      attackType: "weapon",
      bonusHitChance: 0,
      critChance: 0.3,
      table,
    });
    assert.ok(
      Math.abs(
        white.miss +
          white.dodge +
          white.glancing +
          white.crit +
          white.block +
          white.parry -
          1,
      ) < 1e-12,
    );
    assert.equal(white.miss, table.miss + table.dualWieldPenalty);
  });

  it("at 60v63 the bands are the table's, untouched", () => {
    const table = tableAt(60, 63);
    const white = attackChances({
      attackType: "weapon",
      bonusHitChance: 0,
      critChance: 0.3,
      table,
    });
    assert.equal(white.miss, 0.27);
    assert.equal(white.dodge, 0.065);
    assert.equal(white.glancing, 0.4);
    assert.ok(Math.abs(white.crit - 0.252) < 1e-12);
  });
});

describe("weapon skill: the cap is on the typed base, a racial goes on top (#317, A11)", () => {
  it("level 40 takes a typed 250 and refuses 251; a racial bonus is added after the cap", () => {
    withRows(
      {
        "attackTable.weaponSkill": {
          ...k("attackTable.weaponSkill"),
          racialBonus: { human: 5 },
        },
      },
      () => {
        const config = normalizeConfig({
          talentLevel: 40,
          race: "human",
          character: { weaponSkill: 250 },
        });
        assert.equal(weaponSkillFor(config), 255);
        assert.equal(
          weaponSkillFor(normalizeConfig({ talentLevel: 40, race: "human" })),
          205,
        );
        assert.throws(
          () =>
            normalizeConfig({
              talentLevel: 40,
              race: "human",
              character: { weaponSkill: 251 },
            }),
          { name: "RangeError" },
        );
      },
    );
  });

  it("weaponSkillFor reads the level through the shared helper (characterLevel)", () => {
    assert.equal(weaponSkillFor({ talentLevel: 40 }), 200);
    assert.equal(weaponSkillFor({}), 300);
    const source = readFileSync(
      new URL("../js/attack-resolver.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\.talentLevel\b/);
    assert.match(source, /characterLevel\(config\)/);
  });
});

describe("ranks: the highest rank wins a tie at one level (#317)", () => {
  it("Backstab ranks 8 and 9 are both learned at 60; 60 is rank 9", () => {
    const at60 = spellRanks("Backstab").filter((rank) => rank.level === 60);
    assert.deepEqual(
      at60.map((rank) => rank.rank),
      [8, 9],
    );
    assert.equal(rankAt("Backstab", 60), 9);
    assert.equal(rankAt("Backstab", 59), 7);
    assert.equal(rankedStats("backstab", 60), k("backstab"));
  });
});
