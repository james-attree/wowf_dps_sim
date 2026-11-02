import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import {
  attackChances,
  defaultWeaponSkill,
  deriveAttackTable,
  hitSuppression,
  resolveAttack,
  spellMissChance,
  suppressCrit,
  weaponSkillFor,
} from "../js/attack-resolver.js";
import { runFight } from "../js/fight.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";

// Weapon skill and a configurable attack table (#295, P5-10): every attack
// table number is an attackTable.* row of data/constants.js, the table is
// derived from config.character.weaponSkill against the target's defense, and
// the two open rulings (the crit model and the dodge per point) flip with a
// row, not code.

const ROWS = [
  "attackTable.weaponSkill",
  "attackTable.defense",
  "attackTable.miss",
  "attackTable.dualWieldPenalty",
  "attackTable.hitSuppression",
  "attackTable.dodge",
  "attackTable.parry",
  "attackTable.block",
  "attackTable.glancing",
  "attackTable.glancingDamage",
  "attackTable.critModel",
  "attackTable.critModels",
  "attackTable.spellMiss",
];

const OLD_IDS = [
  "weaponSkill.base",
  "target.defense",
  "miss.yellow",
  "hit.suppression",
  "hit.suppressionGap",
  "miss.dualWieldPenalty",
  "dodge.target",
  "parry.target",
  "block.target",
  "block.value",
  "glancing.chance",
  "glancing.damage",
  "crit.suppressionSkill",
  "crit.suppressionAura",
  "spell.missTarget",
];

const near = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message}: ${actual}, not ${expected}`,
  );

const copy = (value) => structuredClone(value);

// Runs `run` with the given rows changed, then puts them back.
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

const gapAura = (run) => withRows({ "attackTable.critModel": "gapAura" }, run);
const totalCrit = ({ crit }) => crit.skill + crit.flat + crit.levelAura;

// The white and yellow miss chances with no bonus hit, from the table.
const missesAt = (weaponSkill) => {
  const table = deriveAttackTable({ weaponSkill });
  const base = { bonusHitChance: 0, critChance: 0.5, table };
  return {
    yellow: attackChances({ ...base, attackType: "skill" }).miss,
    white: attackChances({ ...base, attackType: "weapon" }).miss,
  };
};

describe("the attack table is one table of assumptions (#295)", () => {
  it("has every attackTable row tagged assumption, on the retune list, citing issue #295", () => {
    for (const id of ROWS) {
      const row = CONSTANTS[id];
      assert.ok(row, `missing ${id}`);
      assert.equal(row.source, "assumption", id);
      assert.equal(row.retune, true, id);
      assert.match(row.ref, /^Developer, 2 Nov 2026, issue #295: /, id);
    }
    const ids = Object.keys(CONSTANTS);
    const first = ids.indexOf(ROWS[0]);
    assert.deepEqual(ids.slice(first, first + ROWS.length), ROWS);
  });

  it("has no other attack table row left", () => {
    for (const id of OLD_IDS) {
      assert.equal(CONSTANTS[id], undefined, id);
      assert.throws(() => k(id), /Unknown constant/);
    }
  });

  it("has no weapon-skill racial: WoW Forever has none", () => {
    assert.deepEqual(k("attackTable.weaponSkill").racialBonus, {});
  });

  it("defaults to the classic crit model, and both models are in the table", () => {
    assert.equal(k("attackTable.critModel"), "classic");
    assert.deepEqual(Object.keys(k("attackTable.critModels")), [
      "classic",
      "gapAura",
    ]);
    assert.equal(
      k("attackTable.critModels").classic.flatAboveSkillGap,
      null,
      "the 1.8% stays at any skill by default",
    );
    assert.equal(k("attackTable.critModels").gapAura.flatAboveSkillGap, 10);
  });
});

describe("the default table is today's table: 300 skill against 315 defense", () => {
  const table = deriveAttackTable();

  it("reads 300 skill and 315 defense", () => {
    assert.equal(defaultWeaponSkill(), 300);
    assert.equal(defaultWeaponSkill(k("character.level")), 300);
    assert.equal(table.weaponSkill, 300);
    assert.equal(table.defense, 315);
    assert.equal(table.gap, 15);
  });

  it("is exactly the old fixed rows", () => {
    assert.equal(table.miss, 0.08);
    assert.equal(table.miss + table.dualWieldPenalty, 0.27);
    assert.equal(table.hitSuppression, 0.01);
    assert.equal(table.dodge, 0.065);
    assert.deepEqual(table.parry, { front: 0.14, behind: 0 });
    assert.deepEqual(table.block, { front: 0.05, behind: 0 });
    assert.equal(table.blockValue, 0);
    assert.equal(table.glancing, 0.4);
    assert.deepEqual(table.glancingDamage, { low: 0.55, high: 0.75 });
    assert.deepEqual(table.crit, { skill: 0.03, flat: 0.018, levelAura: 0 });
    assert.deepEqual(table.spellMiss, { chance: 0.17, floor: 0.01 });
  });

  it("takes crit off in the same order as before, to the bit", () => {
    assert.equal(suppressCrit(0.1, table), 0.1 - 0.03 - 0.018);
    assert.equal(suppressCrit(0.1), 0.1 - 0.03 - 0.018);
  });

  it("is what the functions use when given no table", () => {
    assert.equal(hitSuppression(), hitSuppression(table));
    assert.equal(spellMissChance(), spellMissChance(0, table));
    const base = { attackType: "weapon", bonusHitChance: 0, critChance: 0.3 };
    assert.deepEqual(attackChances(base), attackChances({ ...base, table }));
  });
});

describe("weapon skill moves the table (#295)", () => {
  it("at 305: 6% miss, 25% dual-wield miss, no hit suppression, 6% dodge", () => {
    const table = deriveAttackTable({ weaponSkill: 305 });
    near(table.miss, 0.06, "miss");
    near(table.miss + table.dualWieldPenalty, 0.25, "white miss");
    assert.equal(table.hitSuppression, 0);
    near(table.dodge, 0.06, "dodge");
    assert.deepEqual(missesAt(305), { yellow: 0.06, white: 0.25 });
  });

  it("at 308: 5.7% miss, 24.7% dual-wield miss, 5.7% dodge", () => {
    const table = deriveAttackTable({ weaponSkill: 308 });
    near(table.miss, 0.057, "miss");
    near(table.miss + table.dualWieldPenalty, 0.247, "white miss");
    assert.equal(table.hitSuppression, 0);
    near(table.dodge, 0.057, "dodge");
  });

  it("puts the hit cap at 9% at 300 and 6% at 305", () => {
    const capAt = (weaponSkill) => {
      const table = deriveAttackTable({ weaponSkill });
      return table.miss + table.hitSuppression;
    };
    near(capAt(300), 0.09, "300");
    near(capAt(305), 0.06, "305");
    const at305 = deriveAttackTable({ weaponSkill: 305 });
    const yellow = (bonusHitChance) =>
      attackChances({
        attackType: "skill",
        bonusHitChance,
        critChance: 0,
        table: at305,
      }).miss;
    near(yellow(0.05), 0.01, "5% hit at 305");
    assert.equal(yellow(0.06), 0);
  });

  it("keeps a flat 1% hit suppression from 301 to 304 (Marrow), by default", () => {
    for (const weaponSkill of [301, 302, 303, 304]) {
      assert.equal(deriveAttackTable({ weaponSkill }).hitSuppression, 0.01);
    }
  });

  it("keeps 40% glancing above 300 (capped skill) but glances for more", () => {
    assert.equal(deriveAttackTable({ weaponSkill: 305 }).glancing, 0.4);
    assert.equal(deriveAttackTable({ weaponSkill: 308 }).glancing, 0.4);
    assert.deepEqual(deriveAttackTable({ weaponSkill: 305 }).glancingDamage, {
      low: 0.8,
      high: 0.9,
    });
    assert.deepEqual(deriveAttackTable({ weaponSkill: 308 }).glancingDamage, {
      low: 0.91,
      high: 0.99,
    });
    // Below 300 the capped skill is the skill: 295 glances 50% of the time.
    near(deriveAttackTable({ weaponSkill: 295 }).glancing, 0.5, "295");
  });

  it("draws a glancing blow between the table's factors", () => {
    const table = deriveAttackTable({ weaponSkill: 305 });
    const glance = (glanceRoll) =>
      resolveAttack({
        attackType: "weapon",
        baseDamage: 100,
        bonusHitChance: 0,
        critChance: 0,
        table,
        roll: 50,
        glanceRoll,
      }).glanceFactor;
    near(glance(0), 0.8, "low");
    near(glance(100), 0.9, "high");
  });

  it("keeps the classic crit suppression at 4.8% at 300, 305 and 308", () => {
    for (const weaponSkill of [300, 305, 308]) {
      near(totalCrit(deriveAttackTable({ weaponSkill })), 0.048, weaponSkill);
    }
  });

  it("does not move parry, block or the spell miss", () => {
    const at300 = deriveAttackTable();
    const at308 = deriveAttackTable({ weaponSkill: 308 });
    assert.deepEqual(at308.parry, at300.parry);
    assert.deepEqual(at308.block, at300.block);
    assert.deepEqual(at308.spellMiss, at300.spellMiss);
  });

  it("never gives a negative miss or dodge", () => {
    const table = deriveAttackTable({ weaponSkill: 400 });
    assert.equal(table.miss, 0);
    assert.equal(table.dodge, 0);
  });

  it("refuses a weapon skill that is not a number", () => {
    assert.throws(() => deriveAttackTable({ weaponSkill: Number.NaN }), {
      name: "RangeError",
    });
  });
});

describe("the crit model is a row: classic or gapAura (#295, open for James)", () => {
  it("gapAura: 4.8% at 300, 2.8% at 305, 2.68% at 308", () => {
    gapAura(() => {
      const at300 = deriveAttackTable();
      near(at300.crit.skill, 0.006, "skill term at 300");
      assert.equal(at300.crit.flat, 0.018);
      near(at300.crit.levelAura, 0.024, "level aura");
      near(totalCrit(at300), 0.048, "300");
      const at305 = deriveAttackTable({ weaponSkill: 305 });
      assert.equal(at305.crit.flat, 0, "+5 skill removes the 1.8%");
      near(totalCrit(at305), 0.028, "305");
      near(totalCrit(deriveAttackTable({ weaponSkill: 308 })), 0.0268, "308");
      near(suppressCrit(0.148, at305), 0.12, "a hit 14.8% to 12%");
    });
  });

  it("flatAboveSkillGap is the '+5 skill removes the 1.8%' switch", () => {
    const models = copy(k("attackTable.critModels"));
    models.classic.flatAboveSkillGap = 10;
    withRows({ "attackTable.critModels": models }, () => {
      near(totalCrit(deriveAttackTable()), 0.048, "300 keeps it");
      near(
        totalCrit(deriveAttackTable({ weaponSkill: 305 })),
        0.03,
        "305 drops it",
      );
    });
    const off = copy(k("attackTable.critModels"));
    off.gapAura.flatAboveSkillGap = null;
    withRows(
      { "attackTable.critModels": off, "attackTable.critModel": "gapAura" },
      () => {
        near(
          totalCrit(deriveAttackTable({ weaponSkill: 305 })),
          0.046,
          "gapAura with the 1.8% kept",
        );
      },
    );
  });

  it("refuses an unknown crit model, naming the known ones", () => {
    withRows({ "attackTable.critModel": "nope" }, () => {
      assert.throws(() => deriveAttackTable(), {
        name: "RangeError",
        message:
          /"nope" is not one of attackTable\.critModels: classic, gapAura/,
      });
    });
  });

  it("applies the classic 1.8% only at a level gap of 3 or more", () => {
    near(
      totalCrit(deriveAttackTable({ targetLevel: 62, weaponSkill: 300 })),
      0.02,
      "+2: 2% skill term only",
    );
    near(
      totalCrit(deriveAttackTable({ targetLevel: 60, weaponSkill: 300 })),
      0,
      "level 60 target",
    );
  });
});

describe("every value is a table entry that changes the result (#295)", () => {
  const at = (changes, read, weaponSkill = 300) =>
    withRows(changes, () => read(deriveAttackTable({ weaponSkill })));

  it("dodge per point 0.04% (the alternative): 5.6% at 300, 5.4% at 305", () => {
    const dodge = { ...k("attackTable.dodge"), perPoint: 0.0004 };
    near(
      at({ "attackTable.dodge": dodge }, (t) => t.dodge),
      0.056,
      "300",
    );
    near(
      at({ "attackTable.dodge": dodge }, (t) => t.dodge, 305),
      0.054,
      "305",
    );
  });

  it("linear hit suppression (wowsims): 1% at 300, 0.4% at 303, 0 at 305", () => {
    const hit = { gap: 10, flat: 0, perPointAboveGap: 0.002 };
    const rows = { "attackTable.hitSuppression": hit };
    near(
      at(rows, (t) => t.hitSuppression),
      0.01,
      "300",
    );
    near(
      at(rows, (t) => t.hitSuppression, 303),
      0.004,
      "303",
    );
    assert.equal(
      at(rows, (t) => t.hitSuppression, 305),
      0,
    );
  });

  it("reads each row", () => {
    const cases = [
      [
        "attackTable.weaponSkill",
        { perLevel: 6, racialBonus: {} },
        () => defaultWeaponSkill(),
      ],
      [
        "attackTable.defense",
        { perLevel: 6 },
        () => deriveAttackTable().defense,
      ],
      [
        "attackTable.miss",
        { ...k("attackTable.miss"), base: 0.06 },
        () => deriveAttackTable().miss,
      ],
      [
        "attackTable.dualWieldPenalty",
        0.2,
        () => deriveAttackTable().dualWieldPenalty,
      ],
      [
        "attackTable.hitSuppression",
        { ...k("attackTable.hitSuppression"), flat: 0.02 },
        () => deriveAttackTable().hitSuppression,
      ],
      [
        "attackTable.dodge",
        { ...k("attackTable.dodge"), base: 0.06 },
        () => deriveAttackTable().dodge,
      ],
      [
        "attackTable.parry",
        { front: 0.15, behind: 0 },
        () => deriveAttackTable().parry.front,
      ],
      [
        "attackTable.block",
        { front: 0.06, behind: 0, value: 0 },
        () => deriveAttackTable().block.front,
      ],
      [
        "attackTable.glancing",
        { ...k("attackTable.glancing"), base: 0.2 },
        () => deriveAttackTable().glancing,
      ],
      [
        "attackTable.glancingDamage",
        {
          ...k("attackTable.glancingDamage"),
          low: { ...k("attackTable.glancingDamage").low, at: 1.35 },
        },
        () => deriveAttackTable().glancingDamage.low,
      ],
      [
        "attackTable.critModel",
        "gapAura",
        () => deriveAttackTable().crit.skill,
      ],
      [
        "attackTable.spellMiss",
        { byLevelGap: [0.04, 0.05, 0.06, 0.16], floor: 0.01 },
        () => spellMissChance(),
      ],
    ];
    for (const [id, value, read] of cases) {
      const before = read();
      const after = withRows({ [id]: value }, read);
      assert.notDeepEqual(after, before, id);
    }
    const models = copy(k("attackTable.critModels"));
    models.classic.flat = 0.02;
    assert.notEqual(
      withRows(
        { "attackTable.critModels": models },
        () => deriveAttackTable().crit.flat,
      ),
      deriveAttackTable().crit.flat,
    );
  });

  it("gives the spell miss by level gap: 4%, 5%, 6%, then 17%", () => {
    const miss = (targetLevel) =>
      deriveAttackTable({ targetLevel }).spellMiss.chance;
    assert.equal(miss(60), 0.04);
    assert.equal(miss(61), 0.05);
    assert.equal(miss(62), 0.06);
    assert.equal(miss(63), 0.17);
    assert.equal(miss(65), 0.17);
  });
});

describe("config.character.weaponSkill (#295)", () => {
  it("defaults to 300 and an old config reads as the default (G4)", () => {
    assert.equal(defaultConfig().character.weaponSkill, 300);
    assert.equal(normalizeConfig({}).character.weaponSkill, 300);
    assert.equal(
      normalizeConfig({ character: { attackPower: 900 } }).character
        .weaponSkill,
      300,
    );
    assert.equal(
      normalizeConfig({ character: { weaponSkill: 305 } }).character
        .weaponSkill,
      305,
    );
  });

  it("takes a whole number of 1 or more", () => {
    for (const bad of [0, -5, 300.5, Number.NaN, Infinity]) {
      assert.throws(
        () => normalizeConfig({ character: { weaponSkill: bad } }),
        {
          name: "RangeError",
          message:
            /config\.character\.weaponSkill must be a whole number 1 or more/,
        },
      );
    }
    assert.throws(
      () => normalizeConfig({ character: { weaponSkill: "305" } }),
      { name: "TypeError" },
    );
  });

  it("weaponSkillFor reads the config and adds the race's table bonus", () => {
    assert.equal(weaponSkillFor(undefined), 300);
    assert.equal(weaponSkillFor({}), 300);
    assert.equal(weaponSkillFor(normalizeConfig({})), 300);
    assert.equal(weaponSkillFor({ character: { weaponSkill: 308 } }), 308);
    assert.equal(weaponSkillFor({ race: "human" }), 300);
    withRows(
      { "attackTable.weaponSkill": { perLevel: 5, racialBonus: { human: 5 } } },
      () => {
        assert.equal(weaponSkillFor({ race: "human" }), 305);
        assert.equal(weaponSkillFor({ race: "orc" }), 300);
        assert.equal(weaponSkillFor({ race: "toString" }), 300);
      },
    );
  });

  it("an explicit 300 fights exactly like the default; 305 changes the fight", () => {
    const fight = (character) =>
      runFight({
        seed: 11,
        duration: 60,
        config: { character: { ...defaultConfig().character, ...character } },
      });
    const plain = fight({});
    const at300 = fight({ weaponSkill: 300 });
    const at305 = fight({ weaponSkill: 305 });
    assert.equal(at300.totalDamage, plain.totalDamage);
    assert.deepEqual(at300.log, plain.log);
    assert.notEqual(at305.totalDamage, plain.totalDamage);
    assert.equal(at305.config.character.weaponSkill, 305);
  });
});
