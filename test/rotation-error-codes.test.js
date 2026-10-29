// Rotation error codes (#212): every error entry is a frozen
// { code, path, message, ...data }, validation carries on past shape errors,
// and import keeps the codes and adds its own. The message text is the one
// the validator always gave, so the thrown and string forms read as before.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { k } from "../data/constants.js";
import { conditionErrors, assertCondition } from "../js/rotation-conditions.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import {
  assertRotationShape,
  rotationShapeErrors,
  rotationShapeProblems,
} from "../js/rotation-schema.js";
import {
  assertValidRotation,
  rotationProblems,
  validateRotation,
} from "../js/rotation-validator.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { ERROR_DATA, WARNING_DATA } from "./rotation-error-codes.js";

const SS = { action: "sinister-strike", conditions: [] };
const rotation = (...rules) => ({ schemaVersion: 1, name: "t", rules });
const rule = (action, ...conditions) => ({ action, conditions });
const cond = (condition) => rotation(rule("sinister-strike", condition));
const five = { type: "comboPoints", op: ">=", value: 5 };
const MAX_NAME = k("rotation.maxNameLength");
const MAX_RULES = k("rotation.maxRules");
const MAX_CONDITIONS = k("rotation.maxConditionsPerRule");
const ENERGY_MAX = k("energy.max");

// Each code, from an input that gives it, with the entry it gives (without
// the message, which is checked as text elsewhere).
const CASES = [
  ["notAnObject", () => validateRotation(null), { path: "" }],
  [
    "badSchemaVersion",
    () => validateRotation({ ...rotation(SS), schemaVersion: 2 }),
    { path: "schemaVersion" },
  ],
  [
    "missingField",
    () => validateRotation({ schemaVersion: 1, rules: [SS] }),
    { path: "name", field: "name" },
  ],
  [
    "unknownField",
    () => validateRotation({ ...rotation(SS), extra: 1 }),
    { path: "extra", field: "extra" },
  ],
  [
    "nameEmpty",
    () => validateRotation({ ...rotation(SS), name: "" }),
    { path: "name" },
  ],
  [
    "nameTooLong",
    () => validateRotation({ ...rotation(SS), name: "n".repeat(MAX_NAME + 1) }),
    { path: "name", max: MAX_NAME },
  ],
  [
    "rulesNotArray",
    () => validateRotation({ ...rotation(), rules: "junk" }),
    { path: "rules" },
  ],
  [
    "tooManyRules",
    () => validateRotation(rotation(...Array(MAX_RULES + 1).fill(SS))),
    { path: "rules", max: MAX_RULES },
  ],
  ["ruleNotObject", () => validateRotation(rotation(5)), { path: "rules[0]" }],
  [
    "actionNotId",
    () => validateRotation(rotation(rule("Sinister Strike"))),
    { path: "rules[0].action" },
  ],
  [
    "conditionsNotArray",
    () =>
      validateRotation(rotation({ action: "sinister-strike", conditions: 5 })),
    { path: "rules[0].conditions" },
  ],
  [
    "tooManyConditions",
    () =>
      validateRotation(
        rotation(
          rule("sinister-strike", ...Array(MAX_CONDITIONS + 1).fill(five)),
        ),
      ),
    { path: "rules[0].conditions", max: MAX_CONDITIONS },
  ],
  [
    "conditionNotObject",
    () => validateRotation(cond(null)),
    { path: "rules[0].conditions[0]" },
  ],
  [
    "conditionNoType",
    () => validateRotation(cond({ op: ">=", value: 1 })),
    { path: "rules[0].conditions[0].type" },
  ],
  ["noRules", () => validateRotation(rotation()), { path: "rules" }],
  [
    "unknownAbility",
    () => validateRotation(rotation(rule("no-such-ability"))),
    { path: "rules[0].action" },
  ],
  [
    "notCastYet",
    () => validateRotation(rotation(rule("garrote"))),
    { path: "rules[0].action" },
  ],
  [
    "notSelfBuff",
    () => validateRotation(cond({ type: "auraActive", aura: "no-such-aura" })),
    { path: "rules[0].conditions[0].aura" },
  ],
  [
    "debuffAsBuff",
    () => validateRotation(cond({ type: "auraActive", aura: "rupture" })),
    { path: "rules[0].conditions[0].aura" },
  ],
  [
    "notDebuff",
    () => validateRotation(cond({ type: "debuffActive", debuff: "no-such" })),
    { path: "rules[0].conditions[0].debuff" },
  ],
  [
    "buffAsDebuff",
    () =>
      validateRotation(
        cond({ type: "debuffActive", debuff: "slice-and-dice" }),
      ),
    { path: "rules[0].conditions[0].debuff" },
  ],
  [
    "unknownConditionType",
    () => validateRotation(cond({ type: "no-such-type" })),
    { path: "rules[0].conditions[0].type" },
  ],
  [
    "missingParam",
    () => validateRotation(cond({ type: "comboPoints", op: ">=" })),
    { path: "rules[0].conditions[0].value", param: "value" },
  ],
  [
    "badParam",
    () => validateRotation(cond({ type: "comboPoints", op: "~", value: 1 })),
    { path: "rules[0].conditions[0].op", param: "op" },
  ],
  [
    "unknownParam",
    () => validateRotation(cond({ ...five, colour: "red" })),
    { path: "rules[0].conditions[0].colour", param: "colour" },
  ],
  [
    "notWhole",
    () => validateRotation(cond({ ...five, value: 2.5 })),
    { path: "rules[0].conditions[0].value", resource: "comboPoints" },
  ],
  [
    "outOfRange",
    () =>
      validateRotation(
        cond({ type: "resource", resource: "energy", op: ">=", value: 1000 }),
      ),
    {
      path: "rules[0].conditions[0].value",
      resource: "energy",
      max: ENERGY_MAX,
    },
  ],
  [
    "negativeSeconds",
    () => validateRotation(cond({ type: "fightTime", op: ">", value: -1 })),
    { path: "rules[0].conditions[0].value" },
  ],
  [
    "badStacks",
    () =>
      validateRotation(
        cond({
          type: "debuffStacks",
          debuff: "deadly-poison",
          op: ">=",
          value: 1.5,
        }),
      ),
    { path: "rules[0].conditions[0].value" },
  ],
  [
    "tooManyStacks",
    () =>
      validateRotation(
        cond({
          type: "debuffStacks",
          debuff: "deadly-poison",
          op: ">=",
          value: 6,
        }),
      ),
    { path: "rules[0].conditions[0].value", max: 5 },
  ],
  [
    "talentGuard",
    () => validateRotation(rotation(rule("cold-blood"))),
    { path: "rules[0].conditions", ability: "cold-blood" },
  ],
  ["notText", () => importRotation(3).errors, { path: "" }],
  [
    "tooLarge",
    () => importRotation(" ".repeat(k("rotation.maxImportChars") + 1)).errors,
    { path: "", max: k("rotation.maxImportChars") },
  ],
  ["notJson", () => importRotation("{").errors, { path: "" }],
];

const withoutMessage = ({ message, ...rest }) => {
  assert.equal(typeof message, "string");
  assert.ok(message.length > 0);
  return rest;
};

describe("rotation error codes (#212): every code", () => {
  it("the cases cover every code in the table, once", () => {
    assert.deepEqual(
      CASES.map(([code]) => code).sort(),
      Object.keys(ERROR_DATA).sort(),
    );
  });

  for (const [code, run, expected] of CASES) {
    it(`${code}: its path and data ${JSON.stringify(ERROR_DATA[code])}`, () => {
      const errors = run();
      const found = errors.filter((error) => error.code === code);
      assert.equal(found.length, 1, JSON.stringify(errors));
      const [entry] = found;
      assert.ok(Object.isFrozen(entry));
      assert.deepEqual(withoutMessage(entry), { code, ...expected });
      // Only the code's own data: no other key.
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["code", "message", "path", ...ERROR_DATA[code]].sort(),
      );
    });
  }

  it("an import gives the validator's entries, the same", () => {
    const bad = {
      schemaVersion: 1,
      name: "",
      rules: [
        rule("cold-blood"),
        5,
        rule("sinister-strike", { ...five, value: 9 }),
      ],
    };
    const imported = importRotation(JSON.stringify(bad));
    assert.equal(imported.ok, false);
    assert.deepEqual(imported.errors, validateRotation(bad));
    for (const error of imported.errors) {
      assert.ok(Object.isFrozen(error));
    }
  });
});

describe("rotation error codes (#212): carries on past shape errors", () => {
  it("several broken rules give several entries, and the valid rules are still checked", () => {
    const errors = validateRotation(
      rotation(
        5,
        rule("sinister-strike", { ...five, value: 9 }),
        { action: "Sinister Strike", conditions: [] },
        { action: "sinister-strike" },
        rule("no-such-ability"),
        SS,
        rule("cold-blood"),
      ),
    );
    assert.deepEqual(
      errors.map(({ code, path }) => [code, path]),
      [
        ["ruleNotObject", "rules[0]"],
        ["outOfRange", "rules[1].conditions[0].value"],
        ["actionNotId", "rules[2].action"],
        ["missingField", "rules[3].conditions"],
        ["unknownAbility", "rules[4].action"],
        ["talentGuard", "rules[6].conditions"],
      ],
    );
  });

  it("an empty name no longer hides the rules' errors", () => {
    const errors = validateRotation({
      ...rotation(rule("no-such-ability"), rule("cold-blood")),
      name: "",
    });
    assert.deepEqual(
      errors.map(({ code }) => code),
      ["nameEmpty", "unknownAbility", "talentGuard"],
    );
  });

  it("missing and unknown top-level fields come first, then the name, then the rules", () => {
    const errors = validateRotation({
      name: "n".repeat(MAX_NAME + 1),
      rules: [rule("no-such-ability")],
      extra: true,
    });
    assert.deepEqual(
      errors.map(({ code, path }) => [code, path]),
      [
        ["missingField", "schemaVersion"],
        ["unknownField", "extra"],
        ["nameTooLong", "name"],
        ["unknownAbility", "rules[0].action"],
      ],
    );
  });

  it("rules: [] gives noRules and still checks the name", () => {
    assert.deepEqual(
      validateRotation({ ...rotation(), name: "" }).map(({ code }) => code),
      ["nameEmpty", "noRules"],
    );
  });

  it("rules that cannot be read, or are over the limit, are not checked", () => {
    assert.deepEqual(
      validateRotation({ ...rotation(), name: "", rules: 5 }).map(
        ({ code }) => code,
      ),
      ["nameEmpty", "rulesNotArray"],
    );
    assert.deepEqual(
      validateRotation(
        rotation(...Array(MAX_RULES + 1).fill(rule("no-such-ability"))),
      ).map(({ code }) => code),
      ["tooManyRules"],
    );
  });

  it("a rule with an unknown field is still checked", () => {
    assert.deepEqual(
      validateRotation(
        rotation({ ...rule("no-such-ability"), priority: 1 }),
      ).map(({ code, path }) => [code, path]),
      [
        ["unknownField", "rules[0].priority"],
        ["unknownAbility", "rules[0].action"],
      ],
    );
  });

  it("a rule whose conditions cannot be read is skipped, past its own shape errors", () => {
    for (const conditions of [5, Array(MAX_CONDITIONS + 1).fill(five)]) {
      const errors = validateRotation(
        rotation({ action: "no-such-ability", conditions }, rule("cold-blood")),
      );
      assert.deepEqual(
        errors.map(({ path }) => path),
        ["rules[0].conditions", "rules[1].conditions"],
      );
      assert.equal(errors[1].code, "talentGuard");
    }
  });

  it("a condition of the wrong shape is skipped; the others in the rule are checked", () => {
    const errors = validateRotation(
      rotation(
        rule(
          "blade-flurry",
          null,
          { op: ">=" },
          { ...five, value: 9 },
          { type: "auraActive", aura: "rupture" },
        ),
      ),
    );
    assert.deepEqual(
      errors.map(({ code, path }) => [code, path]),
      [
        ["conditionNotObject", "rules[0].conditions[0]"],
        ["conditionNoType", "rules[0].conditions[1].type"],
        ["outOfRange", "rules[0].conditions[2].value"],
        ["debuffAsBuff", "rules[0].conditions[3].aura"],
        ["talentGuard", "rules[0].conditions"],
      ],
    );
  });

  it("the talent guard reads a rule with a condition that is not an object", () => {
    assert.deepEqual(
      validateRotation(
        rotation(
          rule("cold-blood", null, {
            type: "abilityGranted",
            ability: "cold-blood",
          }),
        ),
      ).map(({ code }) => code),
      ["conditionNotObject"],
    );
  });

  it("gives no two entries for one path and code", () => {
    const errors = validateRotation({
      name: "",
      rules: [
        5,
        { action: 3 },
        rule("cold-blood", null, { ...five, value: 9.5 }, { type: "x" }),
        rule("no-such-ability"),
      ],
      extra: 1,
    });
    const keys = errors.map(({ code, path }) => `${code} ${path}`);
    assert.equal(new Set(keys).size, keys.length, keys.join("\n"));
    assert.ok(errors.length >= 8, keys.join("\n"));
  });

  it("rotationShapeErrors stays the shape alone, with the same codes", () => {
    const bad = rotation(rule("no-such-ability"), 5, { action: "Bad Name" });
    assert.deepEqual(
      rotationShapeErrors(bad).map(({ code, path }) => [code, path]),
      [
        ["ruleNotObject", "rules[1]"],
        ["missingField", "rules[2].conditions"],
        ["actionNotId", "rules[2].action"],
      ],
    );
    // The same entries the validator gives for the shape.
    const all = validateRotation(bad).map((error) => JSON.stringify(error));
    for (const error of rotationShapeErrors(bad)) {
      assert.ok(all.includes(JSON.stringify(error)), error.path);
    }
  });
});

describe("rotation error codes (#212): where it stops", () => {
  it("a rotation that is not an object: that alone", () => {
    for (const bad of [null, undefined, 3, "text", [], [SS], true]) {
      const errors = validateRotation(bad);
      assert.equal(errors.length, 1, String(bad));
      assert.equal(errors[0].code, "notAnObject");
      assert.equal(errors[0].path, "");
    }
  });

  it("another schemaVersion: that alone, whatever else is wrong", () => {
    for (const version of [0, 2, "1", null, 1.5, [1]]) {
      const errors = validateRotation({
        schemaVersion: version,
        name: "",
        rules: [5, rule("no-such-ability")],
        extra: 1,
      });
      assert.deepEqual(
        errors.map(({ code, path }) => [code, path]),
        [["badSchemaVersion", "schemaVersion"]],
        JSON.stringify(version),
      );
    }
  });

  it("a missing schemaVersion is a missing field, and the check carries on", () => {
    assert.deepEqual(
      validateRotation({ name: "", rules: [rule("no-such-ability")] }).map(
        ({ code }) => code,
      ),
      ["missingField", "nameEmpty", "unknownAbility"],
    );
  });
});

describe("rotation error codes (#212): import", () => {
  it('notText, tooLarge and notJson, at the path "", with the messages as before', () => {
    const limit = k("rotation.maxImportChars");
    assert.deepEqual(importRotation(3).errors, [
      {
        code: "notText",
        path: "",
        message: "A rotation file is text; got number instead.",
      },
    ]);
    assert.deepEqual(importRotation(" ".repeat(limit + 1)).errors, [
      {
        code: "tooLarge",
        path: "",
        message: `The rotation file is too large: ${limit + 1} characters; the most allowed is ${limit}.`,
        max: limit,
      },
    ]);
    const json = importRotation("{").errors;
    assert.equal(json.length, 1);
    assert.equal(json[0].code, "notJson");
    assert.match(json[0].message, /^The rotation file is not valid JSON: ./);
    for (const errors of [importRotation(3).errors, json]) {
      assert.ok(Object.isFrozen(errors[0]));
    }
  });

  it("keeps the code and data when it clips a long entry", () => {
    const most = k("rotation.maxErrorChars");
    const key = "x".repeat(most * 2);
    const result = importRotation(
      JSON.stringify({ ...rotation(SS), [key]: 1 }),
    );
    const [error] = result.errors;
    assert.equal(error.code, "unknownField");
    assert.ok(error.path.length <= most);
    assert.ok(error.message.length <= most);
    assert.ok(error.field.length <= most);
    assert.ok(key.startsWith(error.field.replace(/…$/, "").slice(0, 10)));
    assert.ok(Object.isFrozen(error));
    const long = importRotation(
      JSON.stringify(
        cond({ type: "resource", resource: "energy", op: ">=", value: 1000 }),
      ),
    ).errors[0];
    assert.equal(long.code, "outOfRange");
    assert.equal(long.resource, "energy");
    assert.equal(long.max, ENERGY_MAX);
  });

  it("warnings have a code and its data, as errors do (#214)", () => {
    const trap = rotation(
      rule("ghostly-strike", { type: "abilityGranted", ability: "backstab" }),
      rule("eviscerate"),
      SS,
      SS,
      rule("backstab"),
    );
    const result = importRotation(exportRotation(trap));
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, rotationWarnings(trap));
    assert.deepEqual(
      [...new Set(result.warnings.map((warning) => warning.code))].sort(),
      Object.keys(WARNING_DATA).sort(),
    );
    for (const warning of result.warnings) {
      assert.deepEqual(
        Object.keys(warning),
        ["code", "path", "message", ...WARNING_DATA[warning.code]],
        warning.code,
      );
      assert.ok(Object.isFrozen(warning), warning.code);
    }
  });
});

describe("rotation error codes (#214): the thrown and string forms are each path, then its message", () => {
  const bad = {
    schemaVersion: 1,
    name: "t",
    rules: [rule("cold-blood"), rule("sinister-strike", { ...five, value: 9 })],
  };
  const MESSAGES = [
    'rules[0].conditions: Cold Blood (cold-blood) comes from a talent, so its rule needs an abilityGranted check. Add { "type": "abilityGranted", "ability": "cold-blood" } to its conditions.',
    "rules[1].conditions[0].value: The value must be between 0 and 5 for comboPoints, got 9.",
  ];

  it("no message carries a place", () => {
    for (const error of validateRotation(bad)) {
      assert.doesNotMatch(error.message, /rules\[/);
    }
  });

  it("rotationProblems is each path and message", () => {
    assert.deepEqual(rotationProblems(bad), MESSAGES);
  });

  it("assertValidRotation throws a RangeError reading Bad rotation: and the messages", () => {
    assert.throws(
      () => assertValidRotation(bad),
      (error) =>
        error instanceof RangeError &&
        error.message === `Bad rotation:\n${MESSAGES.join("\n")}`,
    );
  });

  it("exportRotation throws the same RangeError", () => {
    assert.throws(
      () => exportRotation(bad),
      (error) =>
        error instanceof RangeError &&
        error.message === `Bad rotation:\n${MESSAGES.join("\n")}`,
    );
  });

  it("rotationShapeProblems and assertRotationShape read the shape messages", () => {
    const shape = { schemaVersion: 1, name: "", rules: [5] };
    const messages = [
      "name: The name must be a non-empty string.",
      "rules[0]: The rule must be an object { action, conditions }.",
    ];
    assert.deepEqual(rotationShapeProblems(shape), messages);
    assert.throws(
      () => assertRotationShape(shape),
      (error) => error.message.endsWith(messages.join("\n")),
    );
  });

  it("conditionErrors gives the message with no place, and assertCondition writes the path first", () => {
    const condition = { type: "comboPoints", op: "~", value: 1 };
    const message =
      'The comboPoints condition has a bad "op": needs one of >= > <= < ==, got "~".';
    assert.deepEqual(conditionErrors(condition, "c"), [
      { code: "badParam", path: "c.op", message, param: "op" },
    ]);
    assert.throws(
      () => assertCondition(condition),
      (error) =>
        error instanceof RangeError &&
        error.message ===
          'Bad rotation condition:\nop: The comboPoints condition has a bad "op": needs one of >= > <= < ==, got "~".',
    );
  });
});

describe("rotation error codes (#212): the docs", () => {
  it("docs/rotation.md lists every code with its data, and no other", async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(
      new URL("../docs/rotation.md", import.meta.url),
      "utf8",
    );
    const section = text.slice(
      text.indexOf("### Error codes"),
      text.indexOf("## Warnings"),
    );
    const rows = [...section.matchAll(/^\| `(\w+)` +\| ([^|]*)\|/gm)].map(
      ([, code, data]) => [
        code,
        [...data.matchAll(/`(\w+)`/g)].map(([, name]) => name),
      ],
    );
    assert.deepEqual(
      Object.fromEntries(rows),
      Object.fromEntries(
        Object.entries(ERROR_DATA).map(([code, data]) => [code, [...data]]),
      ),
    );
  });

  it("docs/rotation.md lists every warning code with its data, and no other (#214)", async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(
      new URL("../docs/rotation.md", import.meta.url),
      "utf8",
    );
    const start = text.indexOf("### Warning codes");
    assert.ok(start > 0);
    const section = text.slice(start, text.indexOf("\n## ", start));
    const rows = [...section.matchAll(/^\| `(\w+)` +\| ([^|]*)\|/gm)].map(
      ([, code, data]) => [
        code,
        [...data.matchAll(/`(\w+)`/g)].map(([, name]) => name),
      ],
    );
    assert.deepEqual(
      Object.fromEntries(rows),
      Object.fromEntries(
        Object.entries(WARNING_DATA).map(([code, data]) => [code, [...data]]),
      ),
    );
  });
});
