import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import {
  ROTATION_KEYS,
  ROTATION_SCHEMA_VERSION,
  RULE_KEYS,
  assertRotationShape,
  isRotationShape,
  memberPath,
  rotationShapeErrors,
  rotationShapeProblems,
} from "../js/rotation-schema.js";

// The three examples are read out of docs/rotation.md, so the page cannot
// drift from the check.
const doc = await readFile(
  new URL("../docs/rotation.md", import.meta.url),
  "utf8",
);
const examplesSection = doc.slice(doc.indexOf("\n## Examples"));
const examples = [...examplesSection.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
  (match) => JSON.parse(match[1]),
);

const valid = () => ({
  schemaVersion: ROTATION_SCHEMA_VERSION,
  name: "Test",
  rules: [
    { action: "sinister-strike", conditions: [] },
    { action: "eviscerate", conditions: [{ type: "comboPoints", value: 5 }] },
  ],
});

function problems(mutate) {
  const rotation = valid();
  mutate(rotation);
  return rotationShapeProblems(rotation);
}

describe("RotationRule shape check: the documented examples", () => {
  it("finds the three examples in docs/rotation.md", () => {
    assert.equal(examples.length, 3);
  });

  for (const index of [0, 1, 2]) {
    it(`accepts example ${index + 1}`, () => {
      assert.deepEqual(rotationShapeProblems(examples[index]), []);
      assert.equal(isRotationShape(examples[index]), true);
      assert.equal(assertRotationShape(examples[index]), examples[index]);
    });
  }

  it("uses ability ids that exist in the ability data", () => {
    const ids = new Set(ABILITY_DEFINITIONS.map((ability) => ability.id));
    for (const example of examples) {
      for (const rule of example.rules) {
        assert.ok(ids.has(rule.action), `${rule.action} is an ability id`);
      }
    }
  });

  it("the Combat example is the rotation the constants describe", () => {
    const [combat] = examples;
    const priority = k("rotation.priority");
    const idOf = (key) =>
      ABILITY_DEFINITIONS.find((ability) => ability.key === key).id;
    const actions = combat.rules.map((rule) => rule.action);
    // onCooldown in order, then Slice and Dice twice (the combat-swords
    // preset's refresh rules, issue #155), Cold Blood (the rule in
    // js/rotation-default.js), Eviscerate and the builder.
    assert.deepEqual(actions, [
      ...priority.onCooldown.map(idOf),
      idOf(priority.sliceAndDice),
      idOf(priority.sliceAndDice),
      idOf(k("rotation.coldBlood").ability),
      idOf(priority.eviscerate),
      idOf(priority.builder),
    ]);
    // Cold Blood goes before the finisher it names.
    assert.equal(k("rotation.coldBlood").beforeFinisher, priority.eviscerate);
    const values = (rule, type) =>
      rule.conditions
        .filter((condition) => condition.type === type)
        .map((condition) => condition.value);
    const [, , recast, window, coldBlood, eviscerate] = combat.rules;
    for (const rule of [recast, window, coldBlood, eviscerate]) {
      assert.deepEqual(values(rule, "comboPoints"), [
        k("rotation.finisherComboPoints"),
      ]);
    }
    const pooling = k("rotation.pooling");
    assert.deepEqual(values(recast, "auraRemaining"), [pooling.recastSeconds]);
    assert.deepEqual(values(window, "auraRemaining"), [pooling.windowSeconds]);
    assert.deepEqual(values(window, "resource"), [k("energy.max")]);
    assert.deepEqual(values(coldBlood, "auraRemaining"), [
      k("rotation.sliceAndDiceRefreshSeconds"),
    ]);
    // Blade Flurry and Adrenaline Rush start the GCD, so each says when it can
    // be cast: the build has it, it is off cooldown, and for Blade Flurry the
    // energy it costs. The builder has no condition.
    const [flurry, rush] = combat.rules;
    const types = (rule) => rule.conditions.map((condition) => condition.type);
    assert.deepEqual(types(flurry), [
      "abilityUnlocked",
      "cooldownReady",
      "resource",
    ]);
    assert.deepEqual(types(rush), ["abilityUnlocked", "cooldownReady"]);
    assert.equal(flurry.conditions[2].value, k("bladeFlurry").energy);
    assert.deepEqual(combat.rules.at(-1).conditions, []);
  });

  it("every example is within the limits and round-trips as JSON", () => {
    for (const example of examples) {
      assert.deepEqual(JSON.parse(JSON.stringify(example)), example);
      assert.ok(example.rules.length <= k("rotation.maxRules"));
    }
  });
});

describe("RotationRule shape check: a wrong top-level shape", () => {
  for (const [label, value] of [
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["an array of rules", valid().rules],
    ["a string", "rotation"],
    ["a number", 1],
    ["a Map", new Map()],
    ["a class instance", new (class Rotation {})()],
  ]) {
    it(`rejects ${label}`, () => {
      const found = rotationShapeProblems(value);
      assert.equal(found.length, 1);
      assert.match(found[0], /must be an object/);
      assert.equal(isRotationShape(value), false);
      assert.throws(() => assertRotationShape(value), RangeError);
    });
  }

  it("accepts an object with a null prototype", () => {
    const rotation = Object.assign(Object.create(null), valid());
    assert.deepEqual(rotationShapeProblems(rotation), []);
  });

  it("names a missing top-level field", () => {
    for (const key of ROTATION_KEYS) {
      const found = problems((rotation) => delete rotation[key]);
      assert.ok(
        found.some((line) => line.includes(`missing "${key}"`)),
        `${key}: ${found}`,
      );
    }
  });

  it("rejects rules that is not an array", () => {
    for (const rules of [{}, null, "x", 1, undefined]) {
      const found = problems((rotation) => (rotation.rules = rules));
      assert.ok(
        found.some((line) => line.includes("rules must be an array")),
        String(rules),
      );
    }
  });

  it("rejects a name that is not a non-empty string", () => {
    for (const name of ["", "   ", 5, null, {}, []]) {
      const found = problems((rotation) => (rotation.name = name));
      assert.deepEqual(found, ["name must be a non-empty string."]);
    }
  });

  it("assertRotationShape lists every problem in one RangeError", () => {
    const bad = { schemaVersion: 1, name: "", rules: [{ action: "X" }] };
    assert.throws(
      () => assertRotationShape(bad),
      (error) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, /name must be/);
        assert.match(error.message, /rules\[0\]\.action/);
        assert.match(error.message, /rules\[0\] is missing "conditions"/);
        return true;
      },
    );
  });
});

describe("RotationRule shape check: schemaVersion is exact", () => {
  it("reads version 1 and says what it reads otherwise", () => {
    assert.equal(ROTATION_SCHEMA_VERSION, 1);
    for (const version of [0, 2, -1, 1.5, "1", null, true, [1], Number.NaN]) {
      const found = problems((rotation) => (rotation.schemaVersion = version));
      assert.equal(found.length, 1, String(version));
      assert.match(
        found[0],
        /is not supported; this build reads schemaVersion 1/,
      );
    }
  });

  it("does not read further past another version", () => {
    const found = rotationShapeProblems({
      schemaVersion: 2,
      name: "",
      rules: "nonsense",
      extra: true,
    });
    assert.equal(found.length, 1);
  });

  it("a missing version is a missing field", () => {
    const found = problems((rotation) => delete rotation.schemaVersion);
    assert.deepEqual(found, ['The rotation is missing "schemaVersion".']);
  });
});

describe("RotationRule shape check: unknown fields", () => {
  it("rejects an unknown top-level field and names the allowed ones", () => {
    const found = problems((rotation) => (rotation.author = "x"));
    assert.equal(found.length, 1);
    assert.match(found[0], /unknown field "author"/);
    assert.match(found[0], /schemaVersion, name, rules/);
  });

  it("rejects an unknown rule field", () => {
    const found = problems((rotation) => (rotation.rules[1].when = []));
    assert.equal(found.length, 1);
    assert.match(found[0], /^rules\[1\] has unknown field "when"/);
    assert.match(found[0], /action, conditions/);
  });

  it("catches a typo that leaves the real field missing", () => {
    const found = problems((rotation) => {
      rotation.rules[0] = { action: "backstab", condtions: [] };
    });
    assert.equal(found.length, 2);
  });

  it("lets a condition carry any params besides type", () => {
    const rotation = valid();
    rotation.rules[0].conditions = [
      { type: "anything", a: 1, b: { c: [] }, d: "x" },
    ];
    assert.deepEqual(rotationShapeProblems(rotation), []);
  });

  it("exports the allowed keys", () => {
    assert.deepEqual([...ROTATION_KEYS], ["schemaVersion", "name", "rules"]);
    assert.deepEqual([...RULE_KEYS], ["action", "conditions"]);
    assert.equal(Object.isFrozen(ROTATION_KEYS), true);
    assert.equal(Object.isFrozen(RULE_KEYS), true);
  });
});

describe("RotationRule shape check: rules", () => {
  it("rejects a rule that is not an object", () => {
    for (const rule of [null, "x", 1, [], undefined]) {
      const found = problems((rotation) => (rotation.rules[0] = rule));
      assert.deepEqual(found, [
        "rules[0] must be an object { action, conditions }.",
      ]);
    }
  });

  it("accepts an ability id and rejects a display name or anything else", () => {
    for (const action of ["sinister-strike", "eviscerate", "a1-b2"]) {
      assert.deepEqual(
        problems((rotation) => (rotation.rules[0].action = action)),
        [],
        action,
      );
    }
    for (const action of [
      "Sinister Strike",
      "sinisterStrike",
      "sinister_strike",
      "sinister-strike-",
      "-sinister",
      "sinister--strike",
      "",
      " eviscerate",
      "eviscerate\n",
      5,
      null,
      ["eviscerate"],
      { id: "eviscerate" },
    ]) {
      const found = problems((rotation) => (rotation.rules[0].action = action));
      assert.equal(found.length, 1, JSON.stringify(action));
      assert.match(found[0], /^rules\[0\]\.action must be an ability id/);
    }
  });

  it("does not check that the ability exists (R4 does)", () => {
    assert.deepEqual(
      problems((rotation) => (rotation.rules[0].action = "no-such-ability")),
      [],
    );
  });

  it("an empty rules list is a valid shape", () => {
    assert.deepEqual(
      problems((rotation) => (rotation.rules = [])),
      [],
    );
  });

  it("an empty conditions list is valid and a missing one is not", () => {
    assert.deepEqual(
      problems((rotation) => (rotation.rules[0].conditions = [])),
      [],
    );
    assert.deepEqual(
      problems((rotation) => delete rotation.rules[0].conditions),
      ['rules[0] is missing "conditions".'],
    );
  });

  it("rejects conditions that is not an array", () => {
    for (const conditions of [{}, null, "x", 1]) {
      const found = problems(
        (rotation) => (rotation.rules[0].conditions = conditions),
      );
      assert.deepEqual(found, [
        "rules[0].conditions must be an array ([] means always).",
      ]);
    }
  });

  it("rejects a condition without a string type", () => {
    for (const condition of [
      {},
      { type: "" },
      { type: " " },
      { type: 5 },
      { type: null },
    ]) {
      const found = problems(
        (rotation) => (rotation.rules[1].conditions = [condition]),
      );
      assert.deepEqual(found, [
        'rules[1].conditions[0] needs a non-empty string "type".',
      ]);
    }
  });

  it("rejects a condition that is not an object", () => {
    for (const condition of [null, "comboPoints", 5, [], undefined]) {
      const found = problems(
        (rotation) => (rotation.rules[0].conditions = [condition]),
      );
      assert.deepEqual(found, [
        "rules[0].conditions[0] must be an object { type, ...params }.",
      ]);
    }
  });

  it("reports the position of a problem in a later rule and condition", () => {
    const found = problems((rotation) => {
      rotation.rules[1].conditions = [{ type: "ok" }, {}];
    });
    assert.deepEqual(found, [
      'rules[1].conditions[1] needs a non-empty string "type".',
    ]);
  });
});

describe("RotationRule shape check: limits", () => {
  const rules = (count) =>
    Array.from({ length: count }, () => ({
      action: "sinister-strike",
      conditions: [],
    }));

  it("reads the limits from the constants", () => {
    assert.ok(k("rotation.maxRules") >= 6);
    assert.ok(k("rotation.maxConditionsPerRule") >= 3);
    assert.ok(k("rotation.maxNameLength") >= "Default (Combat)".length);
  });

  it("allows exactly maxRules rules and rejects one more", () => {
    const limit = k("rotation.maxRules");
    assert.deepEqual(
      problems((rotation) => (rotation.rules = rules(limit))),
      [],
    );
    const found = problems((rotation) => (rotation.rules = rules(limit + 1)));
    assert.equal(found.length, 1);
    assert.match(
      found[0],
      new RegExp(`rules has ${limit + 1} rules; the most allowed is ${limit}`),
    );
  });

  it("allows exactly maxConditionsPerRule conditions and rejects one more", () => {
    const limit = k("rotation.maxConditionsPerRule");
    const conditions = (count) =>
      Array.from({ length: count }, () => ({ type: "comboPoints" }));
    assert.deepEqual(
      problems(
        (rotation) => (rotation.rules[0].conditions = conditions(limit)),
      ),
      [],
    );
    const found = problems(
      (rotation) => (rotation.rules[0].conditions = conditions(limit + 1)),
    );
    assert.equal(found.length, 1);
    assert.match(
      found[0],
      new RegExp(`has ${limit + 1} conditions; the most allowed is ${limit}`),
    );
  });

  it("allows a name of exactly maxNameLength and rejects one more", () => {
    const limit = k("rotation.maxNameLength");
    assert.deepEqual(
      problems((rotation) => (rotation.name = "n".repeat(limit))),
      [],
    );
    const found = problems(
      (rotation) => (rotation.name = "n".repeat(limit + 1)),
    );
    assert.equal(found.length, 1);
    assert.match(
      found[0],
      new RegExp(
        `name has ${limit + 1} characters; the most allowed is ${limit}`,
      ),
    );
  });
});

describe("RotationRule shape check: purity", () => {
  it("does not change the rotation it checks", () => {
    const rotation = valid();
    const copy = structuredClone(rotation);
    rotationShapeProblems(rotation);
    assert.deepEqual(rotation, copy);
  });

  it("gives the same answer for the same input", () => {
    const rotation = valid();
    rotation.rules[0].action = "Bad";
    assert.deepEqual(
      rotationShapeProblems(rotation),
      rotationShapeProblems(structuredClone(rotation)),
    );
  });
});

describe("RotationRule shape check: errors with a path (R4)", () => {
  it("gives { path, message } and the same messages as the problem list", () => {
    const bad = {
      schemaVersion: 1,
      name: "",
      rules: [
        { action: "sinister-strike", conditions: [] },
        { action: "Eviscerate", conditions: [{}, 3], extra: 1 },
        { action: "rupture", conditions: "no" },
        3,
      ],
    };
    const errors = rotationShapeErrors(bad);
    assert.deepEqual(
      errors.map((error) => error.path),
      [
        "name",
        "rules[1].extra",
        "rules[1].action",
        "rules[1].conditions[0].type",
        "rules[1].conditions[1]",
        "rules[2].conditions",
        "rules[3]",
      ],
    );
    assert.deepEqual(
      rotationShapeProblems(bad),
      errors.map((error) => error.message),
    );
    for (const error of errors) {
      assert.ok(error.message.length > 0);
    }
  });

  it("puts the path of the rotation itself as an empty string", () => {
    assert.deepEqual(
      rotationShapeErrors(null).map((e) => e.path),
      [""],
    );
    assert.equal(memberPath("", "rules"), "rules");
    assert.equal(memberPath("rules[0]", "action"), "rules[0].action");
    assert.deepEqual(
      rotationShapeErrors({ schemaVersion: 1 }).map((e) => e.path),
      ["name", "rules"],
    );
  });

  it("writes a non-finite or missing value as what it is, never as null", () => {
    for (const [value, text] of [
      [NaN, "NaN"],
      [undefined, "undefined"],
      [Infinity, "Infinity"],
    ]) {
      const [error] = rotationShapeErrors({
        ...valid(),
        rules: [{ action: value, conditions: [] }],
      });
      assert.ok(error.message.endsWith(`(got ${text}).`), error.message);
    }
  });
});
