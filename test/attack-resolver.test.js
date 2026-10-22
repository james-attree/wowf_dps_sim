import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { resolveAttack, rollCrit } from "../js/attack-resolver.js";

const STATUS = {
  miss: "Miss",
  dodge: "Dodge",
  glancing: "Glance",
  crit: "Crit",
  hit: "Hit",
};

// Weapon table at 0% bonus hit and 10% crit: miss [0, 24), dodge [24, 30.5),
// parry [30.5, 30.5), glancing [30.5, 70.5), crit [70.5, 80.5), hit [80.5, 100].
// Skill table drops glancing: miss [0, 8), dodge [8, 14.5), parry empty,
// crit [14.5, 24.5), hit [24.5, 100]. Rolls are compared with `<`.
const WEAPON_BANDS = [
  { roll: 0, outcome: "miss", damage: 0 },
  { roll: 23.999, outcome: "miss", damage: 0 },
  { roll: 24, outcome: "dodge", damage: 0 },
  { roll: 30.499, outcome: "dodge", damage: 0 },
  { roll: 30.5, outcome: "glancing", damage: 65 },
  { roll: 70.499, outcome: "glancing", damage: 65 },
  { roll: 70.5, outcome: "crit", damage: 200 },
  { roll: 80.499, outcome: "crit", damage: 200 },
  { roll: 80.5, outcome: "hit", damage: 100 },
  { roll: 100, outcome: "hit", damage: 100 },
];

const SKILL_BANDS = [
  { roll: 0, outcome: "miss", damage: 0 },
  { roll: 7.999, outcome: "miss", damage: 0 },
  { roll: 8, outcome: "dodge", damage: 0 },
  { roll: 14.499, outcome: "dodge", damage: 0 },
  { roll: 14.5, outcome: "crit", damage: 200 },
  { roll: 24.499, outcome: "crit", damage: 200 },
  { roll: 24.5, outcome: "hit", damage: 100 },
  { roll: 100, outcome: "hit", damage: 100 },
];

function resolve(overrides = {}) {
  return resolveAttack({
    attackType: "weapon",
    baseDamage: 100,
    bonusHitChance: 0,
    critChance: 0.1,
    roll: 0,
    ...overrides,
  });
}

function expectBand(overrides, outcome, damage) {
  assert.deepEqual(resolve(overrides), {
    outcome,
    status: STATUS[outcome],
    roll: overrides.roll,
    damage,
    landed: outcome === "glancing" || outcome === "crit" || outcome === "hit",
  });
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

describe("resolveAttack outcome bands", () => {
  for (const band of WEAPON_BANDS) {
    it(`weapon roll ${band.roll} is ${band.outcome}`, () => {
      expectBand({ roll: band.roll }, band.outcome, band.damage);
    });
  }

  for (const band of SKILL_BANDS) {
    it(`skill roll ${band.roll} is ${band.outcome}`, () => {
      expectBand(
        { attackType: "skill", roll: band.roll },
        band.outcome,
        band.damage,
      );
    });
  }

  it("gives weapons a glancing band that skills do not have", () => {
    expectBand({ roll: 50 }, "glancing", 65);
    expectBand({ attackType: "skill", roll: 50 }, "hit", 100);
  });

  it("keeps parry on the table at zero width", () => {
    // The dodge threshold and the parry threshold are the same number, so
    // the roll that lands on that boundary is glancing (weapon) or crit (skill).
    expectBand({ roll: 30.5 }, "glancing", 65);
    expectBand({ attackType: "skill", roll: 14.5 }, "crit", 200);
  });

  it("drops the miss band once bonus hit covers the base miss", () => {
    expectBand({ bonusHitChance: 0.24, roll: 0 }, "dodge", 0);
    expectBand(
      { attackType: "skill", bonusHitChance: 0.08, roll: 0 },
      "dodge",
      0,
    );
  });

  it("shrinks weapon miss by bonus hit before the other bands", () => {
    // 24% base miss minus 4% hit leaves miss on [0, 20).
    expectBand({ bonusHitChance: 0.04, roll: 19.999 }, "miss", 0);
    expectBand({ bonusHitChance: 0.04, roll: 20 }, "dodge", 0);
  });

  it("treats a negative bonus hit as zero", () => {
    expectBand({ bonusHitChance: -1, roll: 0 }, "miss", 0);
    expectBand({ bonusHitChance: -1, roll: 24 }, "dodge", 0);
  });

  it("caps bonus hit at 100%", () => {
    expectBand({ bonusHitChance: 2, roll: 0 }, "dodge", 0);
    expectBand({ attackType: "skill", bonusHitChance: 2, roll: 0 }, "dodge", 0);
  });

  it("drops the crit band when crit chance is zero or negative", () => {
    expectBand({ critChance: 0, roll: 70.5 }, "hit", 100);
    expectBand({ critChance: -0.5, roll: 70.5 }, "hit", 100);
    expectBand({ attackType: "skill", critChance: 0, roll: 14.5 }, "hit", 100);
  });

  it("caps crit chance at 100% and consumes the rest of the table", () => {
    expectBand({ critChance: 1.5, roll: 70.5 }, "crit", 200);
    expectBand({ critChance: 1.5, roll: 100 }, "crit", 200);
    expectBand({ critChance: 1.5, roll: 70.499 }, "glancing", 65);
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
  afterEach(() => {
    mock.restoreAll();
  });

  it("draws Math.random() * 100 when roll is omitted", () => {
    mock.method(Math, "random", () => 0.5);

    const result = resolveAttack({
      attackType: "weapon",
      baseDamage: 100,
      bonusHitChance: 0,
      critChance: 0.1,
    });

    assert.deepEqual(result, {
      outcome: "glancing",
      status: "Glance",
      roll: 50,
      damage: 65,
      landed: true,
    });
  });

  it("treats an explicit undefined roll as omitted", () => {
    mock.method(Math, "random", () => 0);

    const result = resolveAttack({
      attackType: "weapon",
      baseDamage: 100,
      bonusHitChance: 0,
      critChance: 0.1,
      roll: undefined,
    });

    assert.equal(result.outcome, "miss");
    assert.equal(result.roll, 0);
  });

  it("does not roll when the caller injects a roll", () => {
    mock.method(Math, "random", () => {
      throw new Error("Math.random should not be called");
    });

    expectBand({ roll: 80.5 }, "hit", 100);
  });
});

describe("rollCrit", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  for (const [chance, random, expected] of [
    [0.1, 0, true],
    [0.1, 0.1, false],
    [0, 0, false],
    [1, 0.999, true],
    [2, 0.999, true],
    [-0.2, 0, false],
  ]) {
    it(`crit ${chance} against random ${random} is ${expected}`, () => {
      mock.method(Math, "random", () => random);

      assert.equal(rollCrit(chance), expected);
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
      assert.throws(() => rollCrit(critChance), {
        name: "RangeError",
        message: "Critical chance must be a finite number.",
      });
    });
  }
});
