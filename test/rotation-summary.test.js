import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { abilityCatalogue } from "../js/abilities.js";
import { AURAS } from "../js/auras.js";
import { CONDITION_TYPES } from "../js/rotation-conditions.js";
import { defaultRotation } from "../js/rotation-default.js";
import {
  summarizeCondition,
  summarizeRotation,
  summarizeRule,
} from "../js/rotation-summary.js";
import { validateRotation } from "../js/rotation-validator.js";

// R4 (#141): the readable form of a rule and a rotation.

const rule = (action, ...conditions) => ({ action, conditions });

// Each condition type, with the text it must give. Every type of the
// vocabulary has at least one entry, and the test below says so.
const CASES = [
  [
    { type: "resource", resource: "energy", op: ">=", value: 40 },
    "Energy >= 40",
  ],
  [
    { type: "resource", resource: "comboPoints", op: "==", value: 5 },
    "CP == 5",
  ],
  [{ type: "comboPoints", op: ">=", value: 5 }, "CP >= 5"],
  [{ type: "auraActive", aura: "slice-and-dice" }, "Slice and Dice is up"],
  [
    { type: "auraActive", aura: "slice-and-dice", active: true },
    "Slice and Dice is up",
  ],
  [
    { type: "auraActive", aura: "cold-blood", active: false },
    "Cold Blood is not up",
  ],
  [
    { type: "auraRemaining", aura: "slice-and-dice", op: "<=", value: 3 },
    "Slice and Dice missing or <= 3s left",
  ],
  [
    { type: "auraRemaining", aura: "slice-and-dice", op: "<", value: 3 },
    "Slice and Dice missing or < 3s left",
  ],
  [
    { type: "auraRemaining", aura: "slice-and-dice", op: "<", value: 1 },
    "Slice and Dice missing or < 1s left",
  ],
  [
    { type: "auraRemaining", aura: "slice-and-dice", op: "<=", value: 0 },
    "Slice and Dice missing or <= 0s left",
  ],
  [
    { type: "auraRemaining", aura: "slice-and-dice", op: ">=", value: 1 },
    "Slice and Dice has >= 1s left",
  ],
  [
    { type: "auraRemaining", aura: "slice-and-dice", op: ">", value: 10 },
    "Slice and Dice has > 10s left",
  ],
  [
    { type: "auraRemaining", aura: "blade-flurry", op: ">=", value: 0 },
    "Blade Flurry missing or >= 0s left",
  ],
  [
    { type: "auraRemaining", aura: "blade-flurry", op: "==", value: 5 },
    "Blade Flurry has == 5s left",
  ],
  [{ type: "debuffActive", debuff: "rupture" }, "Rupture is up on the target"],
  [
    { type: "debuffActive", debuff: "rupture", active: false },
    "Rupture is not up on the target",
  ],
  [
    { type: "debuffRemaining", debuff: "rupture", op: "<=", value: 2 },
    "Rupture on the target missing or <= 2s left",
  ],
  [
    { type: "debuffRemaining", debuff: "hemorrhage", op: ">", value: 2 },
    "Hemorrhage on the target has > 2s left",
  ],
  [
    { type: "debuffStacks", debuff: "expose-armor", op: ">=", value: 5 },
    "Expose Armor on the target has >= 5 stacks",
  ],
  [{ type: "cooldownReady", ability: "blade-flurry" }, "Blade Flurry is ready"],
  [
    { type: "cooldownReady", ability: "blade-flurry", ready: false },
    "Blade Flurry is on cooldown",
  ],
  [{ type: "fightTime", op: ">=", value: 10 }, "fight time >= 10s"],
  [{ type: "fightTimeRemaining", op: "<", value: 20 }, "fight time left < 20s"],
  [{ type: "energyToCap", op: ">", value: 1.5 }, "time to energy cap > 1.5s"],
  [{ type: "abilityGranted", ability: "cold-blood" }, "Cold Blood is granted"],
  [
    { type: "abilityUnlocked", ability: "adrenaline-rush" },
    "Adrenaline Rush is not locked by the build",
  ],
];

describe("summarizeCondition", () => {
  it("writes a line for every condition type", () => {
    const covered = new Set(CASES.map(([condition]) => condition.type));
    assert.deepEqual([...covered].sort(), [...CONDITION_TYPES].sort());
    for (const [condition, text] of CASES) {
      assert.equal(summarizeCondition(condition), text);
    }
  });

  it("is a valid rotation's condition, each of them", () => {
    for (const [condition] of CASES) {
      assert.deepEqual(
        validateRotation({
          schemaVersion: 1,
          name: "T",
          rules: [rule("sinister-strike", condition)],
        }),
        [],
        JSON.stringify(condition),
      );
    }
  });

  it("writes an id with no display name as the id", () => {
    assert.equal(
      summarizeCondition({ type: "abilityGranted", ability: "no-such" }),
      "no-such is granted",
    );
    assert.equal(
      summarizeCondition({ type: "auraActive", aura: "no-such" }),
      "no-such is up",
    );
    assert.equal(
      summarizeCondition({
        type: "resource",
        resource: "rage",
        op: ">",
        value: 1,
      }),
      "rage > 1",
    );
  });

  it("writes an unknown type as unknown, and refuses a non-object", () => {
    assert.equal(
      summarizeCondition({ type: "moonPhase" }),
      'unknown condition "moonPhase"',
    );
    assert.equal(
      summarizeCondition({ type: "toString" }),
      'unknown condition "toString"',
    );
    for (const value of [null, undefined, [], "x", 1]) {
      assert.throws(() => summarizeCondition(value), TypeError);
    }
  });
});

describe("summarizeRule", () => {
  it("is the ability, then if and the conditions joined by and", () => {
    assert.equal(
      summarizeRule(
        rule("rupture", { type: "comboPoints", op: ">=", value: 5 }),
      ),
      "Rupture if CP >= 5",
    );
    assert.equal(
      summarizeRule(
        rule(
          "slice-and-dice",
          { type: "comboPoints", op: ">=", value: 5 },
          { type: "auraRemaining", aura: "slice-and-dice", op: "<=", value: 3 },
        ),
      ),
      "Slice and Dice if CP >= 5 and Slice and Dice missing or <= 3s left",
    );
  });

  it("says a rule with no conditions is always", () => {
    assert.equal(
      summarizeRule(rule("sinister-strike")),
      "Sinister Strike (always)",
    );
  });

  it("reads each display name from the data, for every ability and aura", () => {
    for (const definition of ABILITY_DEFINITIONS) {
      assert.equal(
        summarizeRule(rule(definition.id)),
        `${abilityCatalogue.get(definition.id).name} (always)`,
      );
    }
    for (const aura of Object.values(AURAS)) {
      const condition =
        aura.target === "self"
          ? { type: "auraActive", aura: aura.id }
          : { type: "debuffActive", debuff: aura.id };
      assert.ok(summarizeCondition(condition).startsWith(aura.name), aura.id);
    }
  });

  it("refuses what is not a rule", () => {
    for (const value of [null, {}, { action: "x" }, "x", []]) {
      assert.throws(() => summarizeRule(value), /needs a rule/);
    }
  });
});

describe("summarizeRotation", () => {
  it("is the name and a numbered line for each rule, in priority order", () => {
    const text = summarizeRotation(defaultRotation());
    assert.deepEqual(text.split("\n"), [
      "Default (Combat)",
      "1. Blade Flurry if Blade Flurry is not locked by the build and Blade Flurry is ready and Energy >= 25",
      "2. Adrenaline Rush if Adrenaline Rush is not locked by the build and Adrenaline Rush is ready",
      "3. Slice and Dice if CP >= 5 and Slice and Dice missing or < 1s left",
      "4. Slice and Dice if CP >= 5 and Slice and Dice missing or <= 5s left and Energy >= 100",
      "5. Cold Blood if Cold Blood is granted and CP >= 5 and Slice and Dice has > 10s left",
      "6. Eviscerate if CP >= 5",
      "7. Sinister Strike (always)",
    ]);
  });

  it("writes a line for every rule", () => {
    const many = {
      schemaVersion: 1,
      name: "Many",
      rules: CASES.map(([condition]) => rule("rupture", condition)),
    };
    const lines = summarizeRotation(many).split("\n");
    assert.equal(lines.length, CASES.length + 1);
    lines.slice(1).forEach((line, index) => {
      assert.ok(line.startsWith(`${index + 1}. Rupture if `), line);
    });
  });

  it("keeps the rules out of the rotation it reads", () => {
    const rotation = defaultRotation();
    const before = JSON.stringify(rotation);
    summarizeRotation(rotation);
    assert.equal(JSON.stringify(rotation), before);
  });

  it("refuses what is not a rotation", () => {
    for (const value of [null, {}, { rules: 3 }, "x", []]) {
      assert.throws(() => summarizeRotation(value), /needs a rotation/);
    }
  });

  it("is the summary of the default rotation that docs/rotation.md shows", async () => {
    const doc = await readFile(
      new URL("../docs/rotation.md", import.meta.url),
      "utf8",
    );
    const shown = doc
      .slice(doc.indexOf("## The readable summary"))
      .match(/```text\n([\s\S]*?)\n```/)[1];
    assert.equal(shown, summarizeRotation(defaultRotation()));
  });

  it("reads the same for every example in docs/rotation.md", async () => {
    const doc = await readFile(
      new URL("../docs/rotation.md", import.meta.url),
      "utf8",
    );
    const rotations = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((match) => JSON.parse(match[1]))
      .filter((example) => Object.hasOwn(example, "rules"));
    for (const example of rotations) {
      const lines = summarizeRotation(example).split("\n");
      assert.equal(lines.length, example.rules.length + 1, example.name);
      assert.doesNotMatch(
        lines.join("\n"),
        /unknown condition|undefined|\[object/,
      );
    }
  });
});

describe("the summary is a display edge", () => {
  it("is imported by no module of the engine (the preset list, the stats form's model and the rotation builder's model, display edges too, may)", async () => {
    const dir = new URL("../js/", import.meta.url);
    for (const file of await readdir(dir)) {
      if (
        file.endsWith(".js") &&
        file !== "rotation-summary.js" &&
        file !== "rotation-presets.js" &&
        file !== "config-form.js" &&
        file !== "rotation-builder.js"
      ) {
        const source = await readFile(new URL(file, dir), "utf8");
        assert.doesNotMatch(source, /from\s+"[^"]*rotation-summary/, file);
      }
    }
  });
});
