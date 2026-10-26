import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import {
  attackChances,
  hitSuppression,
  resolveAttack,
  resolveSpellHit,
  rollCrit,
  spellMissChance,
  suppressCrit,
} from "../js/attack-resolver.js";

const STATUS = {
  miss: "Miss",
  dodge: "Dodge",
  parry: "Parry",
  glancing: "Glance",
  block: "Block",
  crit: "Crit",
  hit: "Hit",
};

const LANDED = ["glancing", "block", "crit", "hit"];

// Magey's Attack-table page (data/constants.js MAGEY), as formulas. The
// constants are the answers at 300 skill against a level 63 target (defense
// 315), so these functions are what the rows are checked against.
const MAGEY = {
  gap: (skill, defense) => defense - skill,
  yellowMiss: (skill, defense) =>
    defense - skill > 10
      ? 0.05 + (defense - skill) * 0.002
      : 0.05 + (defense - skill) * 0.001,
  hitSuppression: (skill, defense) =>
    defense - skill > 10 ? (defense - skill - 10) * 0.002 : 0,
  dodge: (skill, defense) => 0.05 + (defense - skill) * 0.001,
  glancing: (skill, defense, level = 60) =>
    0.1 + (defense - Math.min(level * 5, skill)) * 0.02,
  glanceLow: (skill, defense) => Math.min(0.91, 1.3 - 0.05 * (defense - skill)),
  glanceHigh: (skill, defense) =>
    Math.min(0.99, Math.max(0.2, 1.2 - 0.03 * (defense - skill))),
  skillCritSuppression: (skill, defense, level = 60) =>
    (defense - Math.min(level * 5, skill)) * 0.002,
};

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual}`);

// A crit chance that is 10% once the 4.8% suppression is off.
const CRIT_10 = 0.148;

// Behind the target, 0% bonus hit, 10% crit after suppression. White: miss
// [0, 27), dodge [27, 33.5), glancing [33.5, 73.5), crit [73.5, 83.5), hit
// [83.5, 100]. Yellow roll 1: miss [0, 8), dodge [8, 14.5), hit [14.5, 100];
// a hit then rolls the crit: crit when below 10. Rolls use `<`.
const WEAPON_BANDS = [
  { roll: 0, outcome: "miss", damage: 0 },
  { roll: 26.999, outcome: "miss", damage: 0 },
  { roll: 27, outcome: "dodge", damage: 0 },
  { roll: 33.499, outcome: "dodge", damage: 0 },
  { roll: 33.5, outcome: "glancing", damage: 65 },
  { roll: 73.499, outcome: "glancing", damage: 65 },
  { roll: 73.501, outcome: "crit", damage: 200 },
  { roll: 83.499, outcome: "crit", damage: 200 },
  { roll: 83.501, outcome: "hit", damage: 100 },
  { roll: 100, outcome: "hit", damage: 100 },
];

const SKILL_BANDS = [
  { roll: 0, outcome: "miss", damage: 0 },
  { roll: 7.999, outcome: "miss", damage: 0 },
  { roll: 8, outcome: "dodge", damage: 0 },
  { roll: 14.499, outcome: "dodge", damage: 0 },
  { roll: 14.5, outcome: "hit", damage: 100 },
  { roll: 100, outcome: "hit", damage: 100 },
  { roll: 50, critRoll: 9.999, outcome: "crit", damage: 200 },
  { roll: 50, critRoll: 10.001, outcome: "hit", damage: 100 },
];

function resolve(overrides = {}) {
  return resolveAttack({
    attackType: "weapon",
    baseDamage: 100,
    bonusHitChance: 0,
    critChance: CRIT_10,
    roll: 0,
    // 50 is the middle of the glancing range: 0.65.
    glanceRoll: 50,
    critRoll: 100,
    ...overrides,
  });
}

function expectBand(overrides, outcome, damage) {
  const result = resolve(overrides);
  assert.equal(result.outcome, outcome, JSON.stringify(overrides));
  assert.equal(result.status, STATUS[outcome]);
  assert.equal(result.roll, overrides.roll);
  assert.equal(result.damage, damage, JSON.stringify(overrides));
  assert.equal(result.landed, LANDED.includes(outcome));
}

function expectRangeError(overrides, message) {
  assert.throws(() => resolve(overrides), {
    name: "RangeError",
    message,
  });
}

function shown(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function withConstant(id, value, run) {
  const original = CONSTANTS[id].value;
  CONSTANTS[id].value = value;
  try {
    return run();
  } finally {
    CONSTANTS[id].value = original;
  }
}

// An rng that returns the given values in turn and counts every draw.
function scriptedRng(...values) {
  const rng = () => {
    if (rng.draws >= values.length) {
      throw new Error(`draw ${rng.draws + 1} was not scripted`);
    }
    return values[rng.draws++];
  };
  rng.draws = 0;
  return rng;
}

describe("the attack table matches Magey's Classic table at 300 skill against level 63 (A7)", () => {
  const skill = k("weaponSkill.base");
  const defense = k("target.defense");
  const base = { bonusHitChance: 0, critChance: 0.5 };

  it("reads a level 63 target's defense and a level 60 rogue's skill", () => {
    assert.equal(skill, 300);
    assert.equal(defense, k("target.level") * 5);
    assert.equal(MAGEY.gap(skill, defense), 15);
  });

  it("gives an 8% yellow miss", () => {
    near(k("miss.yellow"), MAGEY.yellowMiss(skill, defense), "formula");
    near(attackChances({ ...base, attackType: "skill" }).miss, 0.08, "table");
  });

  it("gives no crit band to an attack that cannot crit", () => {
    for (const attackType of ["weapon", "skill"]) {
      assert.equal(
        attackChances({ ...base, attackType, canCrit: false }).crit,
        0,
      );
      assert.ok(attackChances({ ...base, attackType }).crit > 0);
    }
  });

  it("gives a 9% hit cap: the first 1% of bonus hit is ignored", () => {
    near(hitSuppression(), MAGEY.hitSuppression(skill, defense), "formula");
    near(hitSuppression(), 0.01, "suppression");
    for (const [bonus, miss] of [
      [0, 0.08],
      [0.01, 0.08],
      [0.05, 0.04],
      [0.09, 0],
      [0.12, 0],
    ]) {
      near(
        attackChances({ ...base, attackType: "skill", bonusHitChance: bonus })
          .miss,
        miss,
        `bonus hit ${bonus}`,
      );
    }
  });

  it("does not suppress hit within 10 points of defense", () => {
    // 305 skill (a racial) is a gap of 10, so the whole bonus counts.
    withConstant("weaponSkill.base", 305, () => {
      assert.equal(hitSuppression(), 0);
      near(MAGEY.hitSuppression(305, defense), 0, "formula");
    });
  });

  it("gives a 27% white miss: 8% plus the 19% dual-wield penalty", () => {
    near(attackChances({ ...base, attackType: "weapon" }).miss, 0.27, "table");
    near(
      attackChances({ ...base, attackType: "weapon", bonusHitChance: 0.09 })
        .miss,
      0.19,
      "at the 9% cap",
    );
  });

  it("gives a 6.5% dodge", () => {
    near(k("dodge.target"), MAGEY.dodge(skill, defense), "formula");
    for (const attackType of ["weapon", "skill"]) {
      near(attackChances({ ...base, attackType }).dodge, 0.065, attackType);
    }
  });

  it("gives 40% glancing on white swings only, at 0.55 to 0.75 of the damage", () => {
    near(k("glancing.chance"), MAGEY.glancing(skill, defense), "chance");
    near(k("glancing.damage").low, MAGEY.glanceLow(skill, defense), "low");
    near(k("glancing.damage").high, MAGEY.glanceHigh(skill, defense), "high");
    assert.equal(
      attackChances({ ...base, attackType: "weapon" }).glancing,
      0.4,
    );
    assert.equal(attackChances({ ...base, attackType: "skill" }).glancing, 0);
    for (const [glanceRoll, factor] of [
      [0, 0.55],
      [50, 0.65],
      [100, 0.75],
    ]) {
      near(
        resolve({ roll: 40, glanceRoll, baseDamage: 1 }).glanceFactor,
        factor,
        `glance roll ${glanceRoll}`,
      );
    }
  });

  it("takes 4.8% off the crit chance: 3% for skill and 1.8% for auras", () => {
    near(
      k("crit.suppressionSkill"),
      MAGEY.skillCritSuppression(skill, defense),
      "formula",
    );
    near(k("crit.suppressionSkill") + k("crit.suppressionAura"), 0.048, "sum");
    near(suppressCrit(0.148), 0.1, "148 to 10");
    assert.equal(suppressCrit(0.04), 0);
    assert.equal(suppressCrit(0), 0);
    assert.equal(suppressCrit(-1), 0);
    near(suppressCrit(1), 0.952, "100% raw is 95.2%");
    near(suppressCrit(1.048), 1, "104.8% raw is a sure crit");
    assert.equal(suppressCrit(1.5), 1);
    assert.throws(() => suppressCrit(Infinity), RangeError);
    for (const attackType of ["weapon", "skill"]) {
      near(
        attackChances({ ...base, attackType, critChance: 0.148 }).crit,
        0.1,
        attackType,
      );
    }
  });

  it("gives no parry or block from behind, and 14% and 5% from the front", () => {
    for (const attackType of ["weapon", "skill"]) {
      const behind = attackChances({ ...base, attackType, behind: true });
      assert.equal(behind.parry, 0);
      assert.equal(behind.block, 0);
      const front = attackChances({ ...base, attackType, behind: false });
      assert.equal(front.parry, 0.14);
      assert.equal(front.block, 0.05);
    }
  });

  it("reads the position from target.behind when none is passed", () => {
    assert.equal(k("target.behind"), true);
    assert.equal(attackChances({ ...base, attackType: "skill" }).parry, 0);
    withConstant("target.behind", false, () => {
      assert.equal(attackChances({ ...base, attackType: "skill" }).parry, 0.14);
    });
  });
});

describe("resolveAttack outcome bands", () => {
  for (const band of WEAPON_BANDS) {
    it(`weapon roll ${band.roll} is ${band.outcome}`, () => {
      expectBand({ roll: band.roll }, band.outcome, band.damage);
    });
  }

  for (const band of SKILL_BANDS) {
    const crit =
      band.critRoll === undefined ? "" : `, crit roll ${band.critRoll}`;
    it(`skill roll ${band.roll}${crit} is ${band.outcome}`, () => {
      expectBand(
        {
          attackType: "skill",
          roll: band.roll,
          ...(band.critRoll === undefined ? {} : { critRoll: band.critRoll }),
        },
        band.outcome,
        band.damage,
      );
    });
  }

  it("gives weapons a glancing band that skills do not have", () => {
    expectBand({ roll: 50 }, "glancing", 65);
    expectBand({ attackType: "skill", roll: 50, critRoll: 50 }, "hit", 100);
  });

  it("has no parry or block band from behind, so the dodge edge goes to glancing", () => {
    expectBand({ roll: 33.5 }, "glancing", 65);
    expectBand({ attackType: "skill", roll: 14.5 }, "hit", 100);
  });

  it("puts parry and block from the front into both tables", () => {
    // White front: miss [0, 27), dodge [27, 33.5), parry [33.5, 47.5),
    // glancing [47.5, 87.5), block [87.5, 92.5), crit [92.5, 102.5).
    const front = { behind: false };
    expectBand({ ...front, roll: 33.499 }, "dodge", 0);
    expectBand({ ...front, roll: 33.5 }, "parry", 0);
    expectBand({ ...front, roll: 47.499 }, "parry", 0);
    expectBand({ ...front, roll: 47.5 }, "glancing", 65);
    expectBand({ ...front, roll: 87.499 }, "glancing", 65);
    expectBand({ ...front, roll: 87.5 }, "block", 100);
    expectBand({ ...front, roll: 92.499 }, "block", 100);
    expectBand({ ...front, roll: 92.501 }, "crit", 200);
    // Yellow front: miss [0, 8), dodge [8, 14.5), parry [14.5, 28.5),
    // block [28.5, 33.5), hit from 33.5.
    const yellow = { ...front, attackType: "skill" };
    expectBand({ ...yellow, roll: 14.499 }, "dodge", 0);
    expectBand({ ...yellow, roll: 14.5 }, "parry", 0);
    expectBand({ ...yellow, roll: 28.499 }, "parry", 0);
    expectBand({ ...yellow, roll: 28.5 }, "block", 100);
    expectBand({ ...yellow, roll: 33.499 }, "block", 100);
    expectBand({ ...yellow, roll: 33.5, critRoll: 100 }, "hit", 100);
  });

  it("makes a blocked swing a landed outcome that loses block.value damage and cannot crit", () => {
    const front = { behind: false, roll: 90 };
    expectBand({ ...front }, "block", 100);
    withConstant("block.value", 30, () => {
      expectBand({ ...front }, "block", 70);
      expectBand({ ...front, baseDamage: 20 }, "block", 0);
      expectBand(
        { ...front, attackType: "skill", roll: 30, critRoll: 0 },
        "block",
        70,
      );
    });
  });

  it("takes dodge and parry reductions off their own bands only", () => {
    expectBand({ dodgeReduction: 0.065, roll: 27 }, "glancing", 65);
    expectBand({ dodgeReduction: 0.03, roll: 30.5 }, "glancing", 65);
    expectBand({ dodgeReduction: 0.03, roll: 30.499 }, "dodge", 0);
    // Front, parry 14% less 4%: parry [33.5, 43.5).
    const front = { behind: false, parryReduction: 0.04 };
    expectBand({ ...front, roll: 43.499 }, "parry", 0);
    expectBand({ ...front, roll: 43.5 }, "glancing", 65);
    // A reduction cannot turn a zero parry into a negative band.
    expectBand({ parryReduction: 0.5, roll: 33.5 }, "glancing", 65);
    expectBand({ dodgeReduction: 0.5, roll: 27 }, "glancing", 65);
  });

  it("drops the miss band once bonus hit covers the base miss", () => {
    // The first 1% of bonus hit does not count: 27% needs 28%, 8% needs 9%.
    expectBand({ bonusHitChance: 0.28, roll: 0 }, "dodge", 0);
    expectBand({ bonusHitChance: 0.27, roll: 0 }, "miss", 0);
    expectBand(
      { attackType: "skill", bonusHitChance: 0.09, roll: 0 },
      "dodge",
      0,
    );
    expectBand(
      { attackType: "skill", bonusHitChance: 0.08, roll: 0 },
      "miss",
      0,
    );
  });

  it("shrinks weapon miss by bonus hit, less the suppressed 1%, before the other bands", () => {
    // 27% base miss minus 4% - 1% hit leaves miss on [0, 24).
    expectBand({ bonusHitChance: 0.04, roll: 23.999 }, "miss", 0);
    expectBand({ bonusHitChance: 0.04, roll: 24.001 }, "dodge", 0);
  });

  it("treats a negative bonus hit as zero", () => {
    expectBand({ bonusHitChance: -1, roll: 0 }, "miss", 0);
    expectBand({ bonusHitChance: -1, roll: 27 }, "dodge", 0);
  });

  it("caps bonus hit at 100%", () => {
    expectBand({ bonusHitChance: 2, roll: 0 }, "dodge", 0);
    expectBand({ attackType: "skill", bonusHitChance: 2, roll: 0 }, "dodge", 0);
  });

  it("drops the crit band when crit chance is zero, negative or fully suppressed", () => {
    for (const critChance of [0, -0.5, 0.04]) {
      expectBand({ critChance, roll: 73.5 }, "hit", 100);
      expectBand(
        { attackType: "skill", critChance, roll: 50, critRoll: 0 },
        "hit",
        100,
      );
    }
  });

  it("takes the suppression off the crit chance before it caps at 100%, so a raw 100% or more is a sure crit", () => {
    // White: crit takes [73.5, 100) at 100% raw, so no hit band is left.
    expectBand({ critChance: 1.5, roll: 73.5 }, "crit", 200);
    expectBand({ critChance: 1.5, roll: 99.999 }, "crit", 200);
    expectBand({ critChance: 1.5, roll: 73.499 }, "glancing", 65);
    // Yellow: 104.8% raw is 100% after the suppression, and more stays 100%.
    for (const critChance of [1.048, 1.5]) {
      for (const critRoll of [0, 95.1, 95.3, 99.999]) {
        expectBand(
          { attackType: "skill", critChance, roll: 50, critRoll },
          "crit",
          200,
        );
      }
    }
  });

  it("can not crit on a yellow attack that missed, dodged, parried or blocked", () => {
    const yellow = { attackType: "skill", critRoll: 0 };
    expectBand({ ...yellow, roll: 0 }, "miss", 0);
    expectBand({ ...yellow, roll: 10 }, "dodge", 0);
    expectBand({ ...yellow, behind: false, roll: 20 }, "parry", 0);
    expectBand({ ...yellow, behind: false, roll: 30 }, "block", 100);
  });
});

describe("resolveAttack draws", () => {
  const args = { baseDamage: 100, bonusHitChance: 0, critChance: CRIT_10 };

  it("draws once for a white swing that misses, dodges or hits", () => {
    for (const [value, outcome] of [
      [0.1, "miss"],
      [0.3, "dodge"],
      [0.9, "hit"],
    ]) {
      const rng = scriptedRng(value);
      assert.equal(
        resolveAttack({ ...args, attackType: "weapon", rng }).outcome,
        outcome,
      );
      assert.equal(rng.draws, 1, outcome);
    }
  });

  it("draws a second value for a glancing blow, and uses it as the damage factor", () => {
    const rng = scriptedRng(0.5, 0);
    const result = resolveAttack({ ...args, attackType: "weapon", rng });
    assert.equal(result.outcome, "glancing");
    assert.equal(rng.draws, 2);
    assert.equal(result.roll, 50);
    assert.equal(result.glanceFactor, 0.55);
    assert.equal(result.damage, 55);
  });

  it("draws once for a yellow miss, dodge, parry or block", () => {
    for (const [value, behind, outcome] of [
      [0.05, true, "miss"],
      [0.1, true, "dodge"],
      [0.2, false, "parry"],
      [0.3, false, "block"],
    ]) {
      const rng = scriptedRng(value);
      const result = resolveAttack({
        ...args,
        attackType: "skill",
        behind,
        rng,
      });
      assert.equal(result.outcome, outcome);
      assert.equal(rng.draws, 1, outcome);
      assert.equal(result.critRoll, null);
    }
  });

  it("draws a crit roll after a yellow hit: crit or hit", () => {
    for (const [second, outcome] of [
      [0.05, "crit"],
      [0.5, "hit"],
    ]) {
      const rng = scriptedRng(0.5, second);
      const result = resolveAttack({ ...args, attackType: "skill", rng });
      assert.equal(result.outcome, outcome);
      assert.equal(rng.draws, 2);
      assert.equal(result.roll, 50);
      assert.equal(result.critRoll, second * 100);
    }
  });

  it("draws the crit roll even when the crit chance is zero, so the draw count does not depend on gear", () => {
    const rng = scriptedRng(0.5, 0.5);
    resolveAttack({ ...args, critChance: 0, attackType: "skill", rng });
    assert.equal(rng.draws, 2);
  });

  it("draws once for a yellow hit that cannot crit (a DoT application)", () => {
    const rng = scriptedRng(0.5);
    const result = resolveAttack({
      ...args,
      attackType: "skill",
      canCrit: false,
      rng,
    });
    assert.equal(result.outcome, "hit");
    assert.equal(rng.draws, 1);
  });

  it("draws the white crit from the one roll", () => {
    const rng = scriptedRng(0.8);
    const result = resolveAttack({ ...args, attackType: "weapon", rng });
    assert.equal(result.outcome, "crit");
    assert.equal(rng.draws, 1);
  });

  it("makes no draw for any value the caller injects", () => {
    const rng = () => {
      throw new Error("rng should not be called");
    };
    resolveAttack({
      ...args,
      attackType: "weapon",
      roll: 40,
      glanceRoll: 0,
      rng,
    });
    resolveAttack({ ...args, attackType: "skill", roll: 50, critRoll: 0, rng });
  });

  it("needs an rng for a second draw the caller did not inject", () => {
    assert.throws(
      () => resolveAttack({ ...args, attackType: "weapon", roll: 40 }),
      { name: "TypeError", message: /rng function or a roll/ },
    );
    assert.throws(
      () => resolveAttack({ ...args, attackType: "skill", roll: 50 }),
      { name: "TypeError", message: /rng function or a roll/ },
    );
  });

  it("rejects an injected crit or glancing roll off the scale", () => {
    expectRangeError(
      { attackType: "skill", roll: 50, critRoll: 100.1 },
      "Crit roll must be between 0 and 100.",
    );
    expectRangeError(
      { roll: 40, glanceRoll: -1 },
      "Glancing roll must be between 0 and 100.",
    );
  });
});

describe("resolveAttack damage", () => {
  it("floors glancing, crit, and hit damage", () => {
    expectBand({ baseDamage: 10, roll: 50 }, "glancing", 6);
    expectBand({ baseDamage: 10.9, roll: 75 }, "crit", 21);
    expectBand({ baseDamage: 10.9, critChance: 0, roll: 100 }, "hit", 10);
  });

  it("can land a glancing blow that floors to zero damage", () => {
    expectBand({ baseDamage: 1, roll: 50 }, "glancing", 0);
  });

  it("accepts zero base damage", () => {
    expectBand({ baseDamage: 0, critChance: 0, roll: 100 }, "hit", 0);
  });

  it("uses the crit multiplier it is given", () => {
    expectBand({ critMultiplier: 2.5, roll: 75 }, "crit", 250);
  });
});

describe("spell hit table for poisons (A5)", () => {
  it("misses 17% of the time and never below the 1% floor", () => {
    assert.equal(spellMissChance(), 0.17);
    near(spellMissChance(0.05), 0.12, "5% spell hit");
    near(spellMissChance(0.16), 0.01, "floor");
    near(spellMissChance(1), 0.01, "floor");
    assert.equal(spellMissChance(-1), 0.17);
  });

  it("rolls the miss band first and uses the one roll", () => {
    assert.deepEqual(resolveSpellHit({ roll: 16.999 }), {
      outcome: "miss",
      status: "Resist",
      roll: 16.999,
      landed: false,
    });
    assert.equal(resolveSpellHit({ roll: 17 }).outcome, "hit");
    assert.equal(
      resolveSpellHit({ roll: 1, bonusSpellHit: 0.16 }).outcome,
      "miss",
    );
    assert.equal(
      resolveSpellHit({ roll: 1.01, bonusSpellHit: 0.16 }).landed,
      true,
    );
    const rng = scriptedRng(0.5);
    resolveSpellHit({ rng });
    assert.equal(rng.draws, 1);
  });

  it("does not read the melee bonus hit", () => {
    assert.equal(resolveSpellHit({ roll: 10 }).outcome, "miss");
  });

  it("rejects a bad roll or hit chance", () => {
    assert.throws(() => resolveSpellHit({ roll: 101 }), RangeError);
    assert.throws(
      () => resolveSpellHit({ roll: 1, bonusSpellHit: Number.NaN }),
      RangeError,
    );
    assert.throws(() => resolveSpellHit({}), TypeError);
  });
});

describe("resolveAttack input validation", () => {
  it("rejects a missing argument", () => {
    assert.throws(() => resolveAttack(), TypeError);
  });

  for (const attackType of ["spell", "toString", "Weapon", undefined]) {
    it(`rejects attack type ${shown(attackType)}`, () => {
      expectRangeError(
        { attackType },
        `Unsupported attack type: ${attackType}`,
      );
    });
  }

  for (const baseDamage of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
    "100",
  ]) {
    it(`rejects base damage ${shown(baseDamage)}`, () => {
      expectRangeError(
        { baseDamage, roll: 50 },
        "Base damage must be a non-negative number.",
      );
    });
  }

  for (const roll of [
    -0.001,
    100.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    null,
  ]) {
    it(`rejects roll ${shown(roll)}`, () => {
      expectRangeError({ roll }, "Attack roll must be between 0 and 100.");
    });
  }

  for (const bonusHitChance of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
    "0.1",
  ]) {
    it(`rejects bonus hit chance ${shown(bonusHitChance)}`, () => {
      expectRangeError(
        { bonusHitChance, roll: 50 },
        "Bonus hit chance must be a finite number.",
      );
    });
  }

  for (const critChance of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
    "0.1",
  ]) {
    it(`rejects crit chance ${shown(critChance)}`, () => {
      expectRangeError(
        { critChance, roll: 50 },
        "Critical chance must be a finite number.",
      );
    });
  }

  it("checks attack type before damage, roll, and chances", () => {
    expectRangeError(
      {
        attackType: "spell",
        baseDamage: -1,
        bonusHitChance: Number.NaN,
        critChance: Number.NaN,
        roll: 101,
      },
      "Unsupported attack type: spell",
    );
  });

  it("checks base damage before roll and chances", () => {
    expectRangeError(
      {
        baseDamage: -1,
        bonusHitChance: Number.NaN,
        critChance: Number.NaN,
        roll: 101,
      },
      "Base damage must be a non-negative number.",
    );
  });

  it("checks the roll before chances", () => {
    expectRangeError(
      {
        bonusHitChance: Number.NaN,
        critChance: Number.NaN,
        roll: 101,
      },
      "Attack roll must be between 0 and 100.",
    );
  });

  it("checks bonus hit chance before crit chance", () => {
    expectRangeError(
      { bonusHitChance: Number.NaN, critChance: Number.NaN, roll: 50 },
      "Bonus hit chance must be a finite number.",
    );
  });
});

describe("resolveAttack default roll", () => {
  it("draws rng() * 100 when roll is omitted", () => {
    const result = resolveAttack({
      attackType: "weapon",
      baseDamage: 100,
      bonusHitChance: 0,
      critChance: CRIT_10,
      rng: () => 0.5,
    });

    assert.deepEqual(result, {
      outcome: "glancing",
      status: "Glance",
      roll: 50,
      critRoll: null,
      glanceFactor: 0.65,
      damage: 65,
      landed: true,
    });
  });

  it("treats an explicit undefined roll as omitted", () => {
    const result = resolveAttack({
      attackType: "weapon",
      baseDamage: 100,
      bonusHitChance: 0,
      critChance: CRIT_10,
      rng: () => 0,
      roll: undefined,
    });

    assert.equal(result.outcome, "miss");
    assert.equal(result.roll, 0);
  });

  it("does not draw from the rng when the caller injects a roll", () => {
    expectBand(
      {
        roll: 83.501,
        rng: () => {
          throw new Error("rng should not be called");
        },
      },
      "hit",
      100,
    );
  });

  it("needs an rng or a roll", () => {
    assert.throws(
      () =>
        resolveAttack({
          attackType: "weapon",
          baseDamage: 100,
          bonusHitChance: 0,
          critChance: CRIT_10,
        }),
      { name: "TypeError", message: /rng function or a roll/ },
    );
  });
});

describe("rollCrit", () => {
  for (const [chance, random, expected] of [
    [0.1, 0, true],
    [0.1, 0.1, false],
    [0, 0, false],
    [1, 0.999, true],
    [2, 0.999, true],
    [-0.2, 0, false],
  ]) {
    it(`crit ${chance} against random ${random} is ${expected}`, () => {
      assert.equal(
        rollCrit(chance, () => random),
        expected,
      );
    });
  }

  it("needs an rng", () => {
    assert.throws(() => rollCrit(0.1), {
      name: "TypeError",
      message: "rollCrit needs an rng function.",
    });
  });

  for (const critChance of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
    "0.1",
  ]) {
    it(`rejects crit chance ${shown(critChance)}`, () => {
      assert.throws(() => rollCrit(critChance, () => 0), {
        name: "RangeError",
        message: "Critical chance must be a finite number.",
      });
    });
  }
});
