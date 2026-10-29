import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { abilityCatalogue } from "../js/abilities.js";
import { CONSTANTS } from "../data/constants.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { defaultRotation } from "../js/rotation-default.js";
import { compileRotation } from "../js/rotation-interpreter.js";
import { rotationShapeProblems } from "../js/rotation-schema.js";

// R3 (#140): the default rotation is today's placeholder Combat rotation as
// data. docs/rotation.md example 1 is that rotation, so it is held equal to
// defaultRotation(). Since issue #155 its Slice and Dice rules are the
// combat-swords preset's; that the interpreter casts what the code rotation
// cast, for the rotation as it was before that, is
// test/rotation-equivalence.test.js.

const doc = await readFile(
  new URL("../docs/rotation.md", import.meta.url),
  "utf8",
);
const [example] = [
  ...doc
    .slice(doc.indexOf("\n## Examples"))
    .matchAll(/```json\n([\s\S]*?)\n```/g),
].map((match) => JSON.parse(match[1]));

describe("defaultRotation", () => {
  it("is example 1 of docs/rotation.md, exactly", () => {
    assert.deepEqual(defaultRotation(), example);
  });

  it("leaves the Cold Blood rule out when the finisher it waits for is not Eviscerate", () => {
    const row = CONSTANTS["rotation.coldBlood"];
    const original = row.value;
    try {
      row.value = { ...original, beforeFinisher: "sinisterStrike" };
      const ids = defaultRotation().rules.map((entry) => entry.action);
      assert.ok(!ids.includes("cold-blood"));
      assert.equal(ids.length, example.rules.length - 1);
    } finally {
      row.value = original;
    }
    assert.deepEqual(defaultRotation(), example);
  });

  it("passes the shape check and compiles", () => {
    assert.deepEqual(rotationShapeProblems(defaultRotation()), []);
    assert.deepEqual(compileRotation(defaultRotation()).rules.length, 7);
  });

  it("is a new object each call, plain JSON", () => {
    const first = defaultRotation();
    first.rules[0].conditions.length = 0;
    first.name = "changed";
    assert.deepEqual(defaultRotation(), example);
    assert.deepEqual(JSON.parse(JSON.stringify(defaultRotation())), example);
    assert.notEqual(defaultRotation().rules, defaultRotation().rules);
  });

  it("names abilities by id, never by display name", () => {
    const ids = new Set(ABILITY_DEFINITIONS.map((definition) => definition.id));
    const names = new Set(
      ABILITY_DEFINITIONS.map(
        (definition) => abilityCatalogue.get(definition.id).name,
      ),
    );
    for (const rule of defaultRotation().rules) {
      assert.ok(ids.has(rule.action), rule.action);
      assert.ok(!names.has(rule.action), rule.action);
      for (const condition of rule.conditions) {
        for (const key of ["ability", "aura"]) {
          if (key in condition) {
            assert.doesNotMatch(condition[key], /[A-Z ]/, condition[key]);
          }
        }
      }
    }
  });

  it("puts Blade Flurry and Adrenaline Rush first, each with its own guards", () => {
    const [flurry, rush, ...rest] = defaultRotation().rules;
    assert.equal(flurry.action, "blade-flurry");
    assert.equal(rush.action, "adrenaline-rush");
    assert.deepEqual(
      rest.map((rule) => rule.action),
      [
        "slice-and-dice",
        "slice-and-dice",
        "cold-blood",
        "eviscerate",
        "sinister-strike",
      ],
    );
  });

  it("refreshes Slice and Dice with the combat-swords preset's rules (#155)", () => {
    const preset = ROTATION_PRESETS.find(
      (entry) => entry.id === "combat-swords",
    );
    const ofSliceAndDice = (rotation) =>
      rotation.rules.filter((rule) => rule.action === "slice-and-dice");
    const rules = ofSliceAndDice(defaultRotation());
    assert.equal(rules.length, 2);
    assert.deepEqual(rules, ofSliceAndDice(preset.rotation));
    // Only those rules changed: the rest is the rotation before #155.
    const rest = defaultRotation().rules.filter(
      (rule) => rule.action !== "slice-and-dice",
    );
    assert.deepEqual(rest.at(-1), {
      action: "sinister-strike",
      conditions: [],
    });
    assert.deepEqual(rest.at(-2), {
      action: "eviscerate",
      conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
    });
  });
});
