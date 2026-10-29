import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { AURAS } from "../js/auras.js";
import { createFight, runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { CONDITION_TYPES } from "../js/rotation-conditions.js";
import { defaultRotation } from "../js/rotation-default.js";
import { compileRotation } from "../js/rotation-interpreter.js";
import { describeValue, rotationShapeErrors } from "../js/rotation-schema.js";
import {
  assertValidRotation,
  rotationContext,
  rotationProblems,
  validateRotation,
} from "../js/rotation-validator.js";
import { SimRunner } from "../js/sim-runner.js";
import { talentGrantedAbilities } from "../js/talent-build.js";

// R4 (#141): the validator. Each invalid case in the issue is rejected with a
// message that names the rule index and the problem; the path says where.

const rule = (action, ...conditions) => ({ action, conditions });
const rotation = (...rules) => ({ schemaVersion: 1, name: "Test", rules });
const valid = rotation(rule("sinister-strike"));
const GRANTED_COLD_BLOOD = { type: "abilityGranted", ability: "cold-blood" };
// The least rule that casts an ability: none needs a condition, except one a
// talent grants (issue #188): Cold Blood needs its abilityGranted condition
// (issue #155), and until #199 the others take abilityUnlocked.
const onlyRule = (id) => {
  if (id === "cold-blood") {
    return rule(id, GRANTED_COLD_BLOOD);
  }
  return talentGrantedAbilities.has(id)
    ? rule(id, { type: "abilityUnlocked", ability: id })
    : rule(id);
};

// The one error a rotation with a single rule and condition gives.
function only(errors) {
  assert.equal(errors.length, 1, JSON.stringify(errors));
  return errors[0];
}
const withCondition = (condition) =>
  validateRotation(
    rotation(rule("sinister-strike"), rule("eviscerate", condition)),
  );

// One valid condition of each type.
const ONE_OF_EACH = {
  resource: { type: "resource", resource: "energy", op: ">=", value: 40 },
  comboPoints: { type: "comboPoints", op: ">=", value: 5 },
  auraActive: { type: "auraActive", aura: "slice-and-dice" },
  auraRemaining: {
    type: "auraRemaining",
    aura: "slice-and-dice",
    op: "<=",
    value: 3,
  },
  debuffActive: { type: "debuffActive", debuff: "rupture", active: false },
  debuffRemaining: {
    type: "debuffRemaining",
    debuff: "rupture",
    op: "<",
    value: 2,
  },
  debuffStacks: {
    type: "debuffStacks",
    debuff: "deadly-poison",
    op: ">=",
    value: 1,
  },
  cooldownReady: { type: "cooldownReady", ability: "blade-flurry" },
  fightTime: { type: "fightTime", op: ">=", value: 10 },
  fightTimeRemaining: { type: "fightTimeRemaining", op: "<=", value: 20 },
  energyToCap: { type: "energyToCap", op: ">", value: 1 },
  abilityGranted: { type: "abilityGranted", ability: "cold-blood" },
  abilityUnlocked: { type: "abilityUnlocked", ability: "adrenaline-rush" },
};

const doc = await readFile(
  new URL("../docs/rotation.md", import.meta.url),
  "utf8",
);
const examples = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) =>
  JSON.parse(match[1]),
);

describe("validateRotation: valid rotations", () => {
  it("returns no errors for the default rotation and for each ability", () => {
    assert.deepEqual(validateRotation(defaultRotation()), []);
    for (const definition of ABILITY_DEFINITIONS) {
      assert.deepEqual(
        validateRotation(rotation(onlyRule(definition.id))),
        [],
        definition.id,
      );
    }
  });

  it("accepts every rotation in docs/rotation.md", () => {
    const rotations = examples.filter((example) =>
      Object.hasOwn(example, "rules"),
    );
    assert.ok(rotations.length >= 3);
    for (const example of rotations) {
      assert.deepEqual(validateRotation(example), [], example.name);
    }
  });

  it("accepts the limits and rejects past them", () => {
    const most = k("rotation.maxRules");
    const many = Array.from({ length: most }, () => rule("sinister-strike"));
    assert.deepEqual(validateRotation(rotation(...many)), []);
    const error = only(
      validateRotation(rotation(...many, rule("sinister-strike"))),
    );
    assert.equal(error.path, "rules");
    assert.match(error.message, new RegExp(`${most + 1} rules.*${most}`));
  });
});

describe("validateRotation: the rotation as a whole", () => {
  it("rejects an empty rule list, naming rules", () => {
    const error = only(validateRotation(rotation()));
    assert.equal(error.path, "rules");
    assert.match(
      error.message,
      /^rules is empty: a rotation needs at least one rule/,
    );
    assert.throws(() => assertValidRotation(rotation()), /rules is empty/);
  });

  it("rejects the wrong schemaVersion, and reads nothing else", () => {
    const error = only(
      validateRotation({ ...rotation(rule("nonsense")), schemaVersion: 2 }),
    );
    assert.equal(error.path, "schemaVersion");
    assert.match(
      error.message,
      /schemaVersion 2 is not supported.*reads schemaVersion 1/,
    );
    assert.match(
      only(validateRotation({ ...valid, schemaVersion: "1" })).message,
      /schemaVersion "1" is not supported/,
    );
  });

  it("rejects what is not a rotation, with every shape error", () => {
    for (const value of [null, undefined, [], "x", 3]) {
      assert.equal(only(validateRotation(value)).path, "");
    }
    const errors = validateRotation({ schemaVersion: 1, extra: true });
    assert.deepEqual(
      errors.map((error) => error.path),
      ["name", "rules", "extra"],
    );
    assert.deepEqual(
      errors,
      rotationShapeErrors({ schemaVersion: 1, extra: true }),
    );
  });

  it("names the rule index of a shape error", () => {
    const error = only(
      validateRotation({
        ...valid,
        rules: [rule("sinister-strike"), { action: "eviscerate" }],
      }),
    );
    assert.equal(error.path, "rules[1].conditions");
    assert.match(error.message, /^rules\[1\] is missing "conditions"/);
  });
});

describe("validateRotation: actions", () => {
  it("rejects an id that is not in the spell data", () => {
    const error = only(
      validateRotation(rotation(rule("sinister-strike"), rule("nonsense"))),
    );
    assert.equal(error.path, "rules[1].action");
    assert.match(
      error.message,
      /^rules\[1\]\.action "nonsense" is not an ability in the spell data\. The rogue casts: .*sinister-strike/,
    );
  });

  it("rejects a rogue spell the engine does not cast", () => {
    const error = only(validateRotation(rotation(rule("mutilate"))));
    assert.equal(error.path, "rules[0].action");
    assert.match(
      error.message,
      /"mutilate" is a rogue spell the engine does not cast yet/,
    );
  });

  it("rejects a display name, as the shape check does", () => {
    const error = only(validateRotation(rotation(rule("Sinister Strike"))));
    assert.match(error.message, /must be an ability id.*not a display name/);
  });
});

describe("validateRotation: conditions", () => {
  it("rejects an unknown condition type, naming the types", () => {
    const error = only(withCondition({ type: "moonPhase" }));
    assert.equal(error.path, "rules[1].conditions[0].type");
    assert.match(
      error.message,
      /^rules\[1\]\.conditions\[0\] has unknown type "moonPhase"\. Known: resource, comboPoints/,
    );
  });

  it("rejects bad params: missing, wrong type, unknown, bad operator", () => {
    const missing = only(withCondition({ type: "comboPoints", op: ">=" }));
    assert.equal(missing.path, "rules[1].conditions[0].value");
    assert.match(missing.message, /\(comboPoints\) is missing "value"/);

    const text = only(
      withCondition({ type: "comboPoints", op: ">=", value: "5" }),
    );
    assert.match(text.message, /bad "value": needs a finite number, got "5"/);

    const extra = only(
      withCondition({ type: "comboPoints", op: ">=", value: 5, x: 1 }),
    );
    assert.equal(extra.path, "rules[1].conditions[0].x");
    assert.match(extra.message, /unknown param "x"/);

    const operator = only(
      withCondition({ type: "comboPoints", op: "=>", value: 5 }),
    );
    assert.equal(operator.path, "rules[1].conditions[0].op");
    assert.match(
      operator.message,
      /bad "op": needs one of >= > <= < ==, got "=>"/,
    );

    const resource = only(
      withCondition({ type: "resource", resource: "rage", op: ">=", value: 5 }),
    );
    assert.match(
      resource.message,
      /bad "resource": needs one of energy, comboPoints/,
    );

    const flag = only(
      withCondition({
        type: "auraActive",
        aura: "slice-and-dice",
        active: "yes",
      }),
    );
    assert.match(flag.message, /bad "active": needs true or false/);
  });

  it("writes NaN and Infinity as themselves, not as null", () => {
    for (const [value, text] of [
      [NaN, "NaN"],
      [Infinity, "Infinity"],
      [-Infinity, "-Infinity"],
    ]) {
      const error = only(
        withCondition({ type: "comboPoints", op: ">=", value }),
      );
      assert.match(error.message, new RegExp(`got ${text}$|got ${text}\\.`));
      assert.doesNotMatch(error.message, /null/);
    }
    assert.match(
      only(validateRotation({ ...valid, schemaVersion: NaN })).message,
      /schemaVersion NaN is not supported/,
    );
    assert.match(
      only(validateRotation(rotation(rule(undefined)))).message,
      /got undefined\)/,
    );
  });

  it("describeValue writes every kind of value", () => {
    assert.equal(describeValue(3), "3");
    assert.equal(describeValue(NaN), "NaN");
    assert.equal(describeValue(-Infinity), "-Infinity");
    assert.equal(describeValue("a"), '"a"');
    assert.equal(describeValue(null), "null");
    assert.equal(describeValue(undefined), "undefined");
    assert.equal(
      describeValue(() => 1),
      "function",
    );
    assert.equal(describeValue({ a: [1] }), '{"a":[1]}');
    assert.equal(describeValue(Symbol("s")), "symbol");
    assert.match(describeValue(1n), /bigint.*JSON/);
    const loop = {};
    loop.self = loop;
    assert.match(describeValue(loop), /object.*JSON/);
  });

  it("rejects an aura id that is not a self buff", () => {
    for (const type of ["auraActive", "auraRemaining"]) {
      const condition = { type, aura: "no-such-buff", op: ">=", value: 1 };
      const error = only(
        withCondition(
          type === "auraActive" ? { type, aura: "no-such-buff" } : condition,
        ),
      );
      assert.equal(error.path, "rules[1].conditions[0].aura");
      assert.match(
        error.message,
        /"no-such-buff" is not a self buff\. Self buffs: slice-and-dice/,
      );
    }
    const debuff = only(withCondition({ type: "auraActive", aura: "rupture" }));
    assert.match(
      debuff.message,
      /"rupture" is a debuff on the target; use debuffActive/,
    );
  });

  it("rejects a debuff id that is not a target debuff", () => {
    for (const condition of [
      { type: "debuffActive", debuff: "nonsense" },
      { type: "debuffRemaining", debuff: "nonsense", op: "<=", value: 3 },
      { type: "debuffStacks", debuff: "nonsense", op: ">=", value: 1 },
    ]) {
      const error = only(withCondition(condition));
      assert.equal(error.path, "rules[1].conditions[0].debuff");
      assert.match(
        error.message,
        /"nonsense" is not a debuff on the target\. Target debuffs: .*rupture/,
      );
    }
    const buff = only(
      withCondition({ type: "debuffActive", debuff: "slice-and-dice" }),
    );
    assert.match(
      buff.message,
      /"slice-and-dice" is a self buff; use auraActive/,
    );
  });

  it("rejects an unknown or uncast ability id in a condition", () => {
    for (const type of ["cooldownReady", "abilityGranted", "abilityUnlocked"]) {
      const unknown = only(withCondition({ type, ability: "nonsense" }));
      assert.equal(unknown.path, "rules[1].conditions[0].ability");
      assert.match(
        unknown.message,
        /"nonsense" is not an ability in the spell data/,
      );
      const uncast = only(withCondition({ type, ability: "mutilate" }));
      assert.match(
        uncast.message,
        /"mutilate" is a rogue spell the engine does not cast yet/,
      );
    }
  });

  it("accepts every known aura, debuff and ability id", () => {
    for (const aura of Object.values(AURAS)) {
      const condition =
        aura.target === "self"
          ? { type: "auraActive", aura: aura.id }
          : { type: "debuffActive", debuff: aura.id };
      assert.deepEqual(withCondition(condition), [], aura.id);
    }
    for (const definition of ABILITY_DEFINITIONS) {
      assert.deepEqual(
        withCondition({ type: "cooldownReady", ability: definition.id }),
        [],
        definition.id,
      );
    }
  });

  it("rejects a number out of range", () => {
    const at = (condition) => only(withCondition(condition));
    const cp = (op, value) => ({ type: "comboPoints", op, value });
    assert.equal(
      at(cp(">=", k("combo.max") + 1)).path,
      "rules[1].conditions[0].value",
    );
    assert.match(
      at(cp(">=", k("combo.max") + 1)).message,
      new RegExp(
        `between 0 and ${k("combo.max")} for comboPoints, got ${k("combo.max") + 1}`,
      ),
    );
    assert.match(
      at(cp(">", -1)).message,
      /between 0 and \d+ for comboPoints, got -1/,
    );
    assert.match(
      at(cp(">=", 2.5)).message,
      /must be a whole number for comboPoints, got 2.5/,
    );
    assert.match(
      at({
        type: "resource",
        resource: "energy",
        op: ">=",
        value: k("energy.max") + 1,
      }).message,
      new RegExp(`between 0 and ${k("energy.max")} for energy`),
    );
    for (const type of ["auraRemaining", "debuffRemaining"]) {
      const named =
        type === "auraRemaining"
          ? { aura: "slice-and-dice" }
          : { debuff: "rupture" };
      assert.match(
        at({ type, ...named, op: ">=", value: -2 }).message,
        /is seconds and must be 0 or more, got -2/,
      );
    }
    for (const type of ["fightTime", "fightTimeRemaining", "energyToCap"]) {
      assert.match(
        at({ type, op: "<", value: -0.5 }).message,
        /is seconds and must be 0 or more, got -0.5/,
      );
    }
  });

  it("accepts the ends of each range", () => {
    for (const condition of [
      { type: "comboPoints", op: ">=", value: 0 },
      { type: "comboPoints", op: "==", value: k("combo.max") },
      {
        type: "resource",
        resource: "energy",
        op: "<=",
        value: k("energy.max"),
      },
      { type: "resource", resource: "comboPoints", op: ">=", value: 1 },
      { type: "fightTime", op: ">=", value: 0 },
      { type: "energyToCap", op: "<", value: 0 },
      { type: "auraRemaining", aura: "slice-and-dice", op: "<=", value: 0 },
      {
        type: "debuffStacks",
        debuff: "expose-armor",
        op: "==",
        value: k("combo.max"),
      },
    ]) {
      assert.deepEqual(withCondition(condition), [], JSON.stringify(condition));
    }
  });

  it("rejects stacks that are not whole, negative, or above the maximum", () => {
    const stacks = (value, debuff = "expose-armor") =>
      only(withCondition({ type: "debuffStacks", debuff, op: ">=", value }));
    assert.match(
      stacks(1.5).message,
      /stack count and must be a whole number, 0 or more, got 1.5/,
    );
    assert.match(
      stacks(-1).message,
      /stack count and must be a whole number, 0 or more, got -1/,
    );
    assert.match(
      stacks(k("combo.max") + 1).message,
      new RegExp(
        `${k("combo.max") + 1} stacks but "expose-armor" stacks to at most ${k("combo.max")}`,
      ),
    );
    assert.match(
      stacks(k("poison.deadly").stacks + 1, "deadly-poison").message,
      /"deadly-poison" stacks to at most/,
    );
  });

  it("names the rule and condition index of each of several errors, in order", () => {
    const errors = validateRotation(
      rotation(
        rule("nonsense", { type: "comboPoints", op: ">=", value: 99 }),
        rule("sinister-strike"),
        rule(
          "eviscerate",
          { type: "bogus" },
          { type: "cooldownReady", ability: "zzz" },
        ),
      ),
    );
    assert.deepEqual(
      errors.map((error) => error.path),
      [
        "rules[0].action",
        "rules[0].conditions[0].value",
        "rules[2].conditions[0].type",
        "rules[2].conditions[1].ability",
      ],
    );
    for (const error of errors) {
      assert.ok(
        error.message.startsWith(
          error.path.replace(/\.(type|value|ability)$/, ""),
        ),
        error.message,
      );
    }
  });
});

describe("validateRotation: the context", () => {
  it("defaults to the engine's ids and any part can be replaced", () => {
    const context = rotationContext();
    assert.ok(context.abilities.includes("mutilate"));
    assert.ok(!context.castable.includes("mutilate"));
    assert.ok(context.auras.includes("slice-and-dice"));
    assert.ok(Object.hasOwn(context.debuffs, "rupture"));
    assert.deepEqual(
      rotationContext({ castable: ["rupture"] }).auras,
      context.auras,
    );

    const only = { castable: ["rupture"] };
    assert.deepEqual(validateRotation(rotation(rule("rupture")), only), []);
    assert.match(
      validateRotation(rotation(rule("eviscerate")), only)[0].message,
      /"eviscerate" is a rogue spell the engine does not cast yet\. The rogue casts: rupture\./,
    );
    assert.match(
      validateRotation(
        rotation(
          rule("rupture", { type: "auraActive", aura: "slice-and-dice" }),
        ),
        { auras: [] },
      )[0].message,
      /is not a self buff\. Self buffs: \./,
    );
  });

  it("takes the spell data and the debuffs from the context", () => {
    const narrow = { abilities: ["rupture"], castable: ["rupture"] };
    assert.match(
      validateRotation(rotation(rule("eviscerate")), narrow)[0].message,
      /"eviscerate" is not an ability in the spell data\. The rogue casts: rupture\./,
    );
    const stacks = (value) =>
      validateRotation(
        rotation(
          rule("rupture", {
            type: "debuffStacks",
            debuff: "poison-x",
            op: ">=",
            value,
          }),
        ),
        { debuffs: { "poison-x": 3 } },
      );
    assert.deepEqual(stacks(3), []);
    assert.match(stacks(4)[0].message, /"poison-x" stacks to at most 3/);
    assert.match(
      validateRotation(
        rotation(rule("rupture", { type: "debuffActive", debuff: "rupture" })),
        { debuffs: {} },
      )[0].message,
      /is not a debuff on the target\. Target debuffs: \./,
    );
  });

  it("accepts zero stacks", () => {
    assert.deepEqual(
      withCondition({
        type: "debuffStacks",
        debuff: "expose-armor",
        op: "==",
        value: 0,
      }),
      [],
    );
  });
});

describe("assertValidRotation and rotationProblems", () => {
  it("returns the rotation when valid, and the same errors either way", () => {
    assert.equal(assertValidRotation(valid), valid);
    const bad = rotation(
      rule("nonsense"),
      rule("eviscerate", { type: "bogus" }),
    );
    const errors = validateRotation(bad);
    assert.deepEqual(
      rotationProblems(bad),
      errors.map((error) => error.message),
    );
    assert.throws(
      () => assertValidRotation(bad),
      (error) => {
        assert.equal(error.name, "RangeError");
        assert.equal(
          error.message,
          `Bad rotation:\n${errors.map((e) => e.message).join("\n")}`,
        );
        return true;
      },
    );
  });
});

describe("validateRotation: Cold Blood needs abilityGranted (#155)", () => {
  const MESSAGE =
    ': Cold Blood (cold-blood) comes from a talent, so its rule needs an abilityGranted check. Add { "type": "abilityGranted", "ability": "cold-blood" } to its conditions.';
  const five = { type: "comboPoints", op: ">=", value: 5 };

  it("rejects a Cold Blood rule with no conditions, as an error on its conditions", () => {
    assert.deepEqual(
      validateRotation(rotation(rule("sinister-strike"), rule("cold-blood"))),
      [
        {
          code: "talentGuard",
          path: "rules[1].conditions",
          message: `rules[1]${MESSAGE}`,
          ability: "cold-blood",
        },
      ],
    );
  });

  it("rejects one whose conditions do not include the grant of Cold Blood", () => {
    for (const conditions of [
      [five],
      [{ type: "abilityUnlocked", ability: "cold-blood" }],
      [{ type: "abilityGranted", ability: "blade-flurry" }, five],
      [{ type: "cooldownReady", ability: "cold-blood" }, five],
    ]) {
      const error = only(
        validateRotation(rotation(rule("cold-blood", ...conditions))),
      );
      assert.equal(
        error.path,
        "rules[0].conditions",
        JSON.stringify(conditions),
      );
      assert.equal(error.message, `rules[0]${MESSAGE}`);
    }
  });

  it("accepts the grant anywhere among the rule's conditions", () => {
    for (const conditions of [
      [GRANTED_COLD_BLOOD],
      [GRANTED_COLD_BLOOD, five],
      [
        five,
        { type: "cooldownReady", ability: "cold-blood" },
        GRANTED_COLD_BLOOD,
      ],
    ]) {
      assert.deepEqual(
        validateRotation(rotation(rule("cold-blood", ...conditions))),
        [],
      );
    }
  });

  it("checks only rules that cast Cold Blood", () => {
    assert.deepEqual(
      validateRotation(
        rotation(
          rule("eviscerate", {
            type: "abilityUnlocked",
            ability: "cold-blood",
          }),
        ),
      ),
      [],
    );
  });

  it("reports it after the rule's condition errors, in rule order, with the others", () => {
    const errors = validateRotation(
      rotation(
        rule("cold-blood", { type: "comboPoints", op: ">=", value: 9 }),
        rule("nonsense"),
        rule("cold-blood"),
      ),
    );
    assert.deepEqual(
      errors.map((error) => error.path),
      [
        "rules[0].conditions[0].value",
        "rules[0].conditions",
        "rules[1].action",
        "rules[2].conditions",
      ],
    );
  });

  it("is an error, so a fight refuses it", () => {
    const config = {
      rotation: rotation(rule("cold-blood"), rule("sinister-strike")),
    };
    assert.throws(
      () => compileRotation(config.rotation),
      /^RangeError: Bad rotation:\n/,
    );
    assert.throws(
      () => runFight({ seed: 1, duration: 5, config }),
      /rules\[0\]: Cold Blood \(cold-blood\) comes from a talent/,
    );
  });

  it("passes the default rotation, every preset and every documented example", () => {
    assert.deepEqual(validateRotation(defaultRotation()), []);
    assert.ok(ROTATION_PRESETS.length > 0);
    for (const preset of ROTATION_PRESETS) {
      assert.deepEqual(validateRotation(preset.rotation), [], preset.id);
    }
    for (const example of examples.filter((entry) =>
      Object.hasOwn(entry, "rules"),
    )) {
      assert.deepEqual(validateRotation(example), [], example.name);
    }
  });
});

describe("an invalid rotation never starts a fight", () => {
  const bad = { rotation: rotation(rule("nonsense")) };
  const empty = { rotation: rotation() };
  const buff = {
    rotation: rotation(
      rule("rupture", { type: "auraActive", aura: "rupture" }),
    ),
  };

  it("is rejected by compileRotation", () => {
    for (const { rotation: candidate } of [bad, empty, buff]) {
      assert.throws(
        () => compileRotation(candidate),
        /^RangeError: Bad rotation:\n/,
      );
    }
  });

  it("is rejected by createFight, runFight and SimRunner before a Simulation exists", () => {
    // The config is read first, so no Simulation is built and no rng is made.
    for (const config of [bad, empty, buff]) {
      assert.throws(
        () => createFight(1, config),
        /^RangeError: config\.rotation is not a valid rotation:\n/,
      );
      assert.throws(
        () => runFight({ seed: 1, duration: 5, config }),
        /not a valid rotation/,
      );
      assert.throws(
        () => new SimRunner({ seed: 1, duration: 5, config }),
        /not a valid rotation/,
      );
      assert.throws(() => new Rogue(config), /not a valid rotation/);
    }
    assert.throws(() => createFight(1, empty), /rules is empty/);
    assert.throws(() => createFight(1, bad), /rules\[0\]\.action "nonsense"/);
  });
});

describe("every condition type", () => {
  it("has a valid case here, so a new type needs a validator case", () => {
    assert.deepEqual(
      Object.keys(ONE_OF_EACH).sort(),
      [...CONDITION_TYPES].sort(),
    );
    for (const [type, condition] of Object.entries(ONE_OF_EACH)) {
      assert.equal(condition.type, type);
      assert.deepEqual(withCondition(condition), [], type);
    }
  });
});
