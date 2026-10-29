import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { createFight, runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import {
  listPresets,
  loadPreset,
  presetRotation,
} from "../js/rotation-presets.js";
import { validateRotation } from "../js/rotation-validator.js";
import { ERROR_DATA } from "./rotation-error-codes.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { referenceBuild } from "./talentsforever.js";

// R6 (#143): rotation import and export. Export is canonical and stable;
// import reads text as data, checks it with the validator, and says what is
// wrong with a path and a message.

const SMALL = {
  schemaVersion: 1,
  name: "Builder only",
  rules: [{ action: "sinister-strike", conditions: [] }],
};

// Every json block in the docs' Examples section that is a whole rotation.
async function docExamples() {
  const text = await readFile(
    new URL("../docs/rotation.md", import.meta.url),
    "utf8",
  );
  const examples = text.slice(text.indexOf("\n## Examples\n"));
  return [...examples.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((match) => JSON.parse(match[1]))
    .filter((value) => value.rules !== undefined);
}

// The same rotation with the keys of every object in the opposite order.
function reversedKeys(value) {
  if (Array.isArray(value)) {
    return value.map(reversedKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, reversedKeys(value[key])]),
    );
  }
  return value;
}

const customRotation = () => ({
  schemaVersion: 1,
  name: 'Custom: ünïcode \u2603 "quoted" \\ back',
  rules: [
    {
      action: "slice-and-dice",
      conditions: [
        { type: "comboPoints", op: ">=", value: 1 },
        { type: "auraRemaining", aura: "slice-and-dice", op: "<=", value: 2.5 },
      ],
    },
    {
      action: "rupture",
      conditions: [
        { type: "comboPoints", op: ">=", value: 5 },
        { type: "debuffActive", debuff: "rupture", active: false },
        { type: "fightTimeRemaining", op: ">", value: 8 },
      ],
    },
    {
      action: "eviscerate",
      conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
    },
    {
      action: "sinister-strike",
      conditions: [
        { type: "resource", resource: "energy", op: ">=", value: 40 },
      ],
    },
  ],
});

// Everything a fight shows, and where the rng stands after it.
function fightSignature(seed, config) {
  const fight = createFight(seed, config);
  fight.simulation.run(90);
  const result = runFight({ seed, duration: 90, config });
  return { result, nextDraw: fight.simulation.rng() };
}

const sorted = (keys) => [...keys].sort();

function assertKeysSorted(value) {
  if (Array.isArray(value)) {
    value.forEach(assertKeysSorted);
  } else if (value !== null && typeof value === "object") {
    assert.deepEqual(Object.keys(value), sorted(Object.keys(value)));
    Object.values(value).forEach(assertKeysSorted);
  }
}

describe("exportRotation", () => {
  it("writes the smallest rotation as the documented text", () => {
    assert.equal(
      exportRotation(SMALL),
      [
        "{",
        '  "name": "Builder only",',
        '  "rules": [',
        "    {",
        '      "action": "sinister-strike",',
        '      "conditions": []',
        "    }",
        "  ],",
        '  "schemaVersion": 1',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("is the text in docs/rotation.md", async () => {
    const docs = await readFile(
      new URL("../docs/rotation.md", import.meta.url),
      "utf8",
    );
    assert.ok(docs.includes("```text\n" + exportRotation(SMALL) + "```"));
  });

  it("sorts the keys at every level, keeps array order, ends in one newline", async () => {
    const rotations = [
      defaultRotation(),
      customRotation(),
      ...listPresets().map((preset) => presetRotation(preset.id)),
      ...(await docExamples()),
    ];
    for (const rotation of rotations) {
      const text = exportRotation(rotation);
      assert.ok(text.endsWith("}\n") && !text.endsWith("\n\n"));
      assert.ok(!text.includes("\r") && !text.includes("\t"));
      const parsed = JSON.parse(text);
      assertKeysSorted(parsed);
      assert.deepEqual(
        parsed.rules.map((rule) => rule.action),
        rotation.rules.map((rule) => rule.action),
      );
      assert.deepEqual(parsed, rotation);
    }
  });

  it("gives the same text whatever order the keys were made in", () => {
    for (const rotation of [SMALL, customRotation(), defaultRotation()]) {
      const text = exportRotation(rotation);
      assert.equal(exportRotation(reversedKeys(rotation)), text);
      assert.equal(exportRotation(structuredClone(rotation)), text);
      assert.equal(exportRotation(rotation), text);
    }
  });

  it("does not change the rotation it is given", () => {
    const rotation = reversedKeys(customRotation());
    const before = JSON.stringify(rotation);
    exportRotation(rotation);
    assert.equal(JSON.stringify(rotation), before);
  });

  it("refuses an invalid rotation, with the validator's messages", () => {
    // One line for each problem.
    assert.throws(
      () =>
        exportRotation({
          ...SMALL,
          rules: [
            { action: "no-such-ability", conditions: [] },
            { action: "nor-this", conditions: [] },
          ],
        }),
      (error) => error.message.split("\n").length === 3,
    );
    assert.throws(
      () =>
        exportRotation({
          ...SMALL,
          rules: [{ action: "no-such-ability", conditions: [] }],
        }),
      (error) =>
        error instanceof RangeError &&
        error.message.startsWith("Bad rotation:\n") &&
        error.message.includes("no-such-ability"),
    );
    for (const bad of [null, undefined, [], "text", 3, { schemaVersion: 1 }]) {
      assert.throws(() => exportRotation(bad), RangeError);
    }
    assert.throws(
      () => exportRotation({ ...SMALL, extra: 1 }),
      /unknown field "extra"/,
    );
  });
});

describe("importRotation: a good file", () => {
  it("returns the rotation, with no errors and no warnings", () => {
    const result = importRotation(exportRotation(customRotation()));
    assert.deepEqual(result, {
      ok: true,
      rotation: customRotation(),
      errors: [],
      warnings: [],
    });
  });

  it("accepts any JSON layout, a byte-order mark and CRLF, and exports the canonical text", () => {
    const rotation = customRotation();
    const canonical = exportRotation(rotation);
    const layouts = [
      JSON.stringify(reversedKeys(rotation)),
      JSON.stringify(rotation, null, "\t"),
      `\uFEFF${canonical}`,
      canonical.replaceAll("\n", "\r\n"),
      `  \n${canonical}  \n`,
    ];
    for (const layout of layouts) {
      const result = importRotation(layout);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.equal(exportRotation(result.rotation), canonical);
    }
  });

  it("reads a key written twice as JSON does: the last one counts", () => {
    const text =
      '{"schemaVersion":1,"name":"first","name":"second","rules":[{"action":"sinister-strike","conditions":[]}]}';
    assert.equal(importRotation(text).rotation.name, "second");
  });

  it("is a rotation SimConfig takes as it is", () => {
    const { rotation } = importRotation(exportRotation(customRotation()));
    assert.deepEqual(normalizeConfig({ rotation }).rotation, rotation);
    assert.deepEqual(validateRotation(rotation), []);
  });

  it("holds no reference to the text or to a previous import", () => {
    const text = exportRotation(SMALL);
    const first = importRotation(text).rotation;
    first.rules.length = 0;
    assert.equal(importRotation(text).rotation.rules.length, 1);
  });
});

describe("round trip", () => {
  it("export, import, export is the same text for every preset, the default and a custom rotation", async () => {
    const rotations = [
      defaultRotation(),
      customRotation(),
      SMALL,
      ...listPresets().map((preset) => presetRotation(preset.id)),
      ...(await docExamples()),
    ];
    assert.ok(rotations.length >= 6);
    for (const rotation of rotations) {
      const text = exportRotation(rotation);
      const imported = importRotation(text);
      assert.equal(imported.ok, true, JSON.stringify(imported.errors));
      assert.deepEqual(imported.rotation, rotation);
      assert.equal(exportRotation(imported.rotation), text);
      assert.equal(
        exportRotation(
          importRotation(exportRotation(imported.rotation)).rotation,
        ),
        text,
      );
    }
  });

  it("runs the same fight: totals, log and rng draws, over several seeds", () => {
    const configs = [
      { label: "default rotation", config: {} },
      { label: "custom", config: { rotation: customRotation() } },
      ...listPresets().flatMap((preset) => [
        { label: `${preset.id}`, config: loadPreset(preset.id) },
        {
          label: `${preset.id} with build`,
          config: loadPreset(preset.id, { talents: referenceBuild() }),
        },
      ]),
    ];
    for (const { label, config } of configs) {
      const rotation = normalizeConfig(config).rotation;
      const imported = importRotation(exportRotation(rotation)).rotation;
      for (const seed of [1, 2, 3, 7, 42, 1234]) {
        const original = fightSignature(seed, { ...config, rotation });
        const again = fightSignature(seed, { ...config, rotation: imported });
        assert.deepEqual(
          again.result.log,
          original.result.log,
          `${label} ${seed}`,
        );
        assert.equal(again.result.totalDamage, original.result.totalDamage);
        assert.equal(
          again.nextDraw,
          original.nextDraw,
          `${label} ${seed} draws`,
        );
        assert.deepEqual(again.result, original.result, `${label} ${seed}`);
        assert.ok(original.result.totalDamage > 0, label);
      }
    }
  });

  it("the default config's rotation round-trips as part of a recorded fight", () => {
    const first = runFight({ seed: 5, duration: 60, config: defaultConfig() });
    const imported = importRotation(exportRotation(first.config.rotation));
    const again = runFight({
      seed: 5,
      duration: 60,
      config: { ...first.config, rotation: imported.rotation },
    });
    assert.deepEqual(again, first);
  });
});

describe("importRotation: what it refuses", () => {
  const first = (result) => {
    assert.equal(result.ok, false);
    assert.equal(result.rotation, null);
    assert.ok(result.errors.length > 0);
    for (const error of result.errors) {
      // Each error has a code, and only that code's data (#212).
      const { code, path, message, ...data } = error;
      assert.ok(Object.hasOwn(ERROR_DATA, code), code);
      assert.deepEqual(
        Object.keys(data).sort(),
        [...ERROR_DATA[code]].sort(),
        code,
      );
      assert.equal(typeof path, "string");
      assert.equal(typeof message, "string");
      assert.equal(typeof error.path, "string");
      assert.ok(error.message.length > 0);
    }
    return result.errors[0];
  };

  it("something that is not text", () => {
    for (const bad of [undefined, null, 3, {}, [], SMALL, new String("{}")]) {
      const error = first(importRotation(bad));
      assert.equal(error.path, "");
      assert.match(error.message, /is text/);
    }
    assert.match(first(importRotation(undefined)).message, /got undefined/);
    assert.match(first(importRotation(3)).message, /got number/);
  });

  it("text over the limit, before it is parsed", () => {
    const limit = k("rotation.maxImportChars");
    const exact = exportRotation(SMALL).trimEnd();
    const padded = (length) => exact + " ".repeat(length - exact.length);
    assert.equal(importRotation(padded(limit)).ok, true);
    const over = first(importRotation(padded(limit + 1)));
    assert.equal(over.path, "");
    assert.match(
      over.message,
      new RegExp(`too large: ${limit + 1} characters`),
    );
    assert.match(over.message, new RegExp(`most allowed is ${limit}`));
    // Not valid JSON and over the limit: it is the size that is reported.
    const garbage = first(importRotation("x".repeat(limit + 1)));
    assert.match(garbage.message, /too large/);
    assert.equal(
      importRotation(`{"a":"${"x".repeat(limit)}"`).errors.length,
      1,
    );
  });

  it("keeps the limit above the largest rotation the shape limits allow", () => {
    const condition = {
      type: "debuffRemaining",
      debuff: "deadly-poison",
      op: "<=",
      value: 10.5,
    };
    const rotation = {
      schemaVersion: 1,
      name: "n".repeat(k("rotation.maxNameLength")),
      rules: Array.from({ length: k("rotation.maxRules") }, () => ({
        action: "sinister-strike",
        conditions: Array.from(
          { length: k("rotation.maxConditionsPerRule") },
          () => ({ ...condition }),
        ),
      })),
    };
    const text = exportRotation(rotation);
    assert.ok(text.length < k("rotation.maxImportChars"), text.length);
    assert.equal(importRotation(text).ok, true);
    assert.throws(
      () =>
        exportRotation({
          ...rotation,
          rules: [...rotation.rules, rotation.rules[0]],
        }),
      /rules/,
    );
  });

  it("text that is not JSON, or nested too deeply to parse", () => {
    const texts = [
      "",
      "   ",
      "[",
      "{",
      "not json",
      "{'a':1}",
      '{"a":1,}',
      "undefined",
      "NaN",
    ];
    for (const text of texts) {
      const error = first(importRotation(text));
      assert.equal(error.path, "");
      // The code only: the parse error's text differs between Node versions.
      assert.equal(error.code, "notJson");
    }
    // The most the limit lets through, nested as deep as it goes: as the whole
    // file, and as the value of a condition's param.
    const depth = k("rotation.maxImportChars") / 2 - 1;
    const brackets = "[".repeat(depth) + "]".repeat(depth);
    assert.equal(first(importRotation(brackets)).path, "");
    const nested = `{"schemaVersion":1,"name":"a","rules":[{"action":"sinister-strike","conditions":[{"type":"fightTime","op":">","value":${brackets.slice(depth / 2, -depth / 2)}}]}]}`;
    assert.ok(nested.length < k("rotation.maxImportChars"));
    const result = importRotation(nested);
    assert.equal(first(result).path, "rules[0].conditions[0].value");
    assert.ok(first(result).message.length <= k("rotation.maxErrorChars"));
  });

  it("JSON that is not a rotation", () => {
    for (const text of ["null", "[]", "3", '"text"', "true"]) {
      assert.equal(first(importRotation(text)).path, "");
    }
    // An object with fields missing is told which.
    assert.deepEqual(
      importRotation("{}").errors.map((e) => e.path),
      ["schemaVersion", "name", "rules"],
    );
    assert.match(first(importRotation("null")).message, /must be an object/);
  });

  it("another schemaVersion, and only that is reported", () => {
    for (const version of [0, 2, "1", null, 1.5, [1]]) {
      const result = importRotation(
        JSON.stringify({ ...SMALL, schemaVersion: version, rules: "junk" }),
      );
      const error = first(result);
      assert.equal(error.path, "schemaVersion");
      assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
    }
    const missing = importRotation(
      JSON.stringify({ name: "x", rules: SMALL.rules }),
    );
    assert.ok(missing.errors.some((e) => e.path === "schemaVersion"));
    assert.match(
      first(importRotation(JSON.stringify({ ...SMALL, schemaVersion: 2 })))
        .message,
      /schemaVersion 2 is not supported/,
    );
  });

  it("an unknown field at any level, named, with its path", () => {
    const at = (mutate) => {
      const rotation = structuredClone(SMALL);
      rotation.rules[0].conditions.push({
        type: "fightTime",
        op: ">",
        value: 1,
      });
      mutate(rotation);
      return first(importRotation(JSON.stringify(rotation)));
    };
    const top = at((r) => (r.extra = 1));
    assert.equal(top.path, "extra");
    assert.match(top.message, /unknown field "extra"/);
    const rule = at((r) => (r.rules[0].priority = 1));
    assert.equal(rule.path, "rules[0].priority");
    assert.match(rule.message, /"priority"/);
    const cond = at((r) => (r.rules[0].conditions[0].colour = "red"));
    assert.equal(cond.path, "rules[0].conditions[0].colour");
    assert.match(cond.message, /unknown param "colour"/);
  });

  it("an invalid rule, with its path and a message that names it", () => {
    const bad = (rules) =>
      first(importRotation(JSON.stringify({ ...SMALL, rules })));
    const action = bad([
      { action: "sinister-strike", conditions: [] },
      { action: "no-such-ability", conditions: [] },
    ]);
    assert.equal(action.path, "rules[1].action");
    assert.match(action.message, /no-such-ability/);
    const condition = bad([
      {
        action: "sinister-strike",
        conditions: [{ type: "comboPoints", op: "~", value: 3 }],
      },
    ]);
    assert.equal(condition.path, "rules[0].conditions[0].op");
    const kind = bad([
      { action: "sinister-strike", conditions: [{ type: "no-such-type" }] },
    ]);
    assert.equal(kind.path, "rules[0].conditions[0].type");
    const several = importRotation(
      JSON.stringify({
        ...SMALL,
        rules: [
          { action: "nope", conditions: [] },
          { action: "also-nope", conditions: [] },
        ],
      }),
    );
    assert.deepEqual(
      several.errors.map((e) => e.path),
      ["rules[0].action", "rules[1].action"],
    );
  });

  it("matches the validator: the same errors it gives for the parsed value", () => {
    const texts = [
      JSON.stringify({ ...SMALL, name: "" }),
      JSON.stringify({ ...SMALL, rules: [] }),
      JSON.stringify({
        ...SMALL,
        name: "x".repeat(k("rotation.maxNameLength") + 1),
      }),
      JSON.stringify({ ...SMALL, rules: [{ action: 3, conditions: "no" }] }),
    ];
    for (const text of texts) {
      const result = importRotation(text);
      assert.equal(result.ok, validateRotation(JSON.parse(text)).length === 0);
      assert.deepEqual(result.errors, validateRotation(JSON.parse(text)));
    }
  });

  it("cuts a path or message to the limit, ending in an ellipsis", () => {
    const limit = k("rotation.maxErrorChars");
    const big = "x".repeat(limit * 10);
    const condition = { type: "auraActive", aura: big };
    for (const text of [
      JSON.stringify({ ...SMALL, rules: [{ action: big, conditions: [] }] }),
      JSON.stringify({
        ...SMALL,
        rules: [{ action: "sinister-strike", conditions: [condition] }],
      }),
      JSON.stringify({ ...SMALL, [big]: 1 }),
    ]) {
      const result = importRotation(text);
      assert.equal(result.errors.length, 1);
      const { path, message } = result.errors[0];
      assert.ok(path.length <= limit && message.length <= limit);
      assert.ok(message.endsWith("\u2026"));
      assert.equal(
        message.length,
        limit,
        "a long message is cut to exactly the limit",
      );
    }
    // Short ones are untouched, and the longest ordinary message is far under.
    const ordinary = importRotation(
      JSON.stringify({ ...SMALL, rules: [{ action: "zz", conditions: [] }] }),
    );
    assert.ok(ordinary.errors[0].message.length < limit / 2);
    assert.ok(!ordinary.errors[0].message.endsWith("\u2026"));
  });

  it("leaves a message of exactly the limit alone, and cuts one more", () => {
    const limit = k("rotation.maxErrorChars");
    const message = (length) =>
      importRotation(
        JSON.stringify({
          ...SMALL,
          rules: [{ action: "x".repeat(length), conditions: [] }],
        }),
      ).errors[0].message;
    const fixed = message(1).length - 1;
    const exact = message(limit - fixed);
    assert.equal(exact.length, limit);
    assert.ok(!exact.endsWith("\u2026"));
    assert.ok(exact.includes("x".repeat(limit - fixed)));
    const over = message(limit - fixed + 1);
    assert.equal(over.length, limit);
    assert.ok(over.endsWith("\u2026"));
  });

  it("an error list is plain data", () => {
    const result = importRotation('{"schemaVersion":3}');
    assert.deepEqual(structuredClone(result), result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
});

describe("importRotation: untrusted input", () => {
  it("refuses __proto__, constructor and prototype keys, and pollutes nothing", () => {
    const rule = '{"action":"sinister-strike","conditions":[]}';
    const cases = {
      "__proto__ at the top": `{"__proto__":{"polluted":"yes"},"schemaVersion":1,"name":"a","rules":[${rule}]}`,
      "constructor at the top": `{"constructor":{"prototype":{"polluted":"yes"}},"schemaVersion":1,"name":"a","rules":[${rule}]}`,
      "__proto__ in a rule": `{"schemaVersion":1,"name":"a","rules":[{"__proto__":{"polluted":"yes"},"action":"sinister-strike","conditions":[]}]}`,
      "__proto__ in a condition": `{"schemaVersion":1,"name":"a","rules":[{"action":"sinister-strike","conditions":[{"type":"fightTime","op":">","value":1,"__proto__":{"polluted":"yes"}}]}]}`,
      "prototype in a condition": `{"schemaVersion":1,"name":"a","rules":[{"action":"sinister-strike","conditions":[{"type":"fightTime","op":">","value":1,"prototype":{"polluted":"yes"}}]}]}`,
      "__proto__ as the value of a param": `{"schemaVersion":1,"name":"a","rules":[{"action":"sinister-strike","conditions":[{"type":"fightTime","op":">","value":{"__proto__":{"polluted":"yes"}}}]}]}`,
    };
    for (const [label, text] of Object.entries(cases)) {
      const result = importRotation(text);
      assert.equal(result.ok, false, label);
      assert.equal(result.rotation, null, label);
      assert.equal({}.polluted, undefined, label);
      assert.equal(Object.prototype.polluted, undefined, label);
    }
    assert.match(
      importRotation(cases["__proto__ at the top"]).errors[0].message,
      /unknown field "__proto__"/,
    );
    assert.equal(
      importRotation(cases["__proto__ in a condition"]).errors[0].path,
      "rules[0].conditions[0].__proto__",
    );
  });

  it("never runs what the text holds", () => {
    globalThis.__rotationIoRan = false;
    const code = "globalThis.__rotationIoRan = true";
    const texts = [
      JSON.stringify({ ...SMALL, name: code }),
      JSON.stringify({ ...SMALL, name: `\u0027;${code};//` }),
      `{"schemaVersion":1,"name":${code},"rules":[]}`,
      `(${code})()`,
      `${code}\n${exportRotation(SMALL)}`,
      JSON.stringify({
        ...SMALL,
        rules: [{ action: code, conditions: [{ type: code }] }],
      }),
    ];
    try {
      for (const text of texts) {
        importRotation(text);
      }
      assert.equal(globalThis.__rotationIoRan, false);
    } finally {
      delete globalThis.__rotationIoRan;
    }
  });

  it("is a module with no eval, Function, clock, random or DOM", async () => {
    const source = await readFile(
      new URL("../js/rotation-io.js", import.meta.url),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(
      code,
      /\beval\b|\bFunction\b|\bDate\b|Math\.random|\bdocument\b|\bwindow\b|\bfetch\b|\brequire\b|\bimport\(/,
    );
    assert.doesNotMatch(code, /\bstep\b|\bframe\b/i);
  });

  it("the interpreter and the rotation modules do not import it", async () => {
    for (const file of [
      "rotation-interpreter",
      "rotation-host",
      "rotation-conditions",
      "rotation-validator",
      "rotation-schema",
      "sim-config",
      "fight",
    ]) {
      const source = await readFile(
        new URL(`../js/${file}.js`, import.meta.url),
        "utf8",
      );
      assert.ok(!source.includes("rotation-io"), file);
    }
  });
});

describe("the limits", () => {
  it("are whole numbers, and the import limit is above every valid export", () => {
    assert.equal(k("rotation.maxImportChars"), 131072);
    assert.equal(k("rotation.maxErrorChars"), 1000);
  });
});
