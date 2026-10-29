import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import { listPresets, presetRotation } from "../js/rotation-presets.js";
import { validateRotation } from "../js/rotation-validator.js";
import { rotationWarnings, warningContext } from "../js/rotation-warnings.js";

// Issue #189: warnings for pooling traps in a valid rotation. They are advice:
// validateRotation is unchanged, and a rotation with warnings imports and runs.

const rotation = (...rules) => ({
  schemaVersion: 1,
  name: "Trap test",
  rules,
});
const rule = (action, ...conditions) => ({ action, conditions });
const FINISHER = k("rotation.finisherComboPoints");
const enoughPoints = { type: "comboPoints", op: ">=", value: FINISHER };
const ready = (ability) => ({ type: "cooldownReady", ability });
const unlocked = (ability) => ({ type: "abilityUnlocked", ability });
const energy = (value) => ({
  type: "resource",
  resource: "energy",
  op: ">=",
  value,
});
const messages = (value, context) =>
  rotationWarnings(value, context).map((warning) => warning.message);

// The messages say what, never where (the message contract, #214). A rule
// with rules below it holds them back; the last rule has none (#210's QA).
const HELD = "it holds back every rule below it";
const LAST = "the rotation waits at it";
const finisherText = (
  label,
  lacks = "its rule has no comboPoints condition",
  held = HELD,
) =>
  `${label} is a finisher, but ${lacks}. It is cast at one combo point, and with none it can't be cast, so ${held}. Add a comboPoints condition, such as { "type": "comboPoints", "op": ">=", "value": ${FINISHER} }.`;
const cooldownText = (label, id, held = HELD) =>
  `${label} has a cooldown and starts the global cooldown, but its rule has no cooldownReady check. While it is on cooldown ${held}. Add { "type": "cooldownReady", "ability": "${id}" } to its conditions.`;
// `count` rules below it, casting `names` ("A and B"), never cast.
const starvesText = (
  label,
  count,
  names,
  lacks = "its rule has no conditions",
) =>
  `${label} starts the global cooldown and ${lacks}, so it is cast or waited for whenever the global cooldown is clear. ${
    count === 1
      ? `The rule below it for ${names} never casts. Give it conditions or move it below that rule.`
      : `The ${count} rules below it for ${names} never cast. Give it conditions or move it below them.`
  }`;
// Which rule above is in the data (`same`), not the message: no place.
const duplicateText = (label) =>
  `${label} is never reached: a rule above it casts it under the same conditions. Delete this one.`;
const grantedText = (label) =>
  `No talent grants ${label}, so this abilityGranted check always holds and does nothing. Remove it.`;
const codes = (value, context) =>
  rotationWarnings(value, context).map((warning) => warning.code);

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

describe("rotationWarnings: the shipped rotations", () => {
  it("the default rotation gives no warnings", () => {
    assert.deepEqual(rotationWarnings(defaultRotation()), []);
  });

  it("every preset gives no warnings", () => {
    assert.ok(listPresets().length > 0);
    for (const { id } of listPresets()) {
      assert.deepEqual(rotationWarnings(presetRotation(id)), [], id);
    }
  });

  it("every whole-rotation example in docs/rotation.md gives no warnings", async () => {
    const examples = await docExamples();
    assert.ok(examples.length > 0);
    for (const example of examples) {
      assert.deepEqual(rotationWarnings(example), [], example.name);
    }
  });
});

describe("rotationWarnings: a finisher with no comboPoints condition", () => {
  it("warns, at the rule's conditions, naming the ability, and not also that it starves (#214)", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "finisherNoComboPoints",
        path: "rules[0].conditions",
        message: finisherText("Eviscerate (eviscerate)"),
        ability: "eviscerate",
        condition: null,
      },
    ]);
  });

  it("warns for every finisher in the ability data, and only for them", () => {
    assert.deepEqual(warningContext().finishers, [
      "eviscerate",
      "slice-and-dice",
      "rupture",
    ]);
    for (const [id, label] of [
      ["eviscerate", "Eviscerate"],
      ["slice-and-dice", "Slice and Dice"],
      ["rupture", "Rupture"],
    ]) {
      const trap = rotation(rule(id, energy(FINISHER)));
      assert.deepEqual(messages(trap), [
        finisherText(
          `${label} (${id})`,
          "its rule has no comboPoints condition",
          LAST,
        ),
      ]);
    }
    assert.deepEqual(
      messages(rotation(rule("sinister-strike", energy(FINISHER)))),
      [],
    );
  });

  it("a comboPoints condition that needs a combo point is enough", () => {
    for (const [op, value] of [
      [">=", FINISHER],
      [">=", 1],
      [">", 0],
      ["==", FINISHER],
      ["==", 1],
    ]) {
      const condition = { type: "comboPoints", op, value };
      assert.deepEqual(
        messages(rotation(rule("eviscerate", condition), rule("backstab"))),
        [],
        `${op} ${value}`,
      );
    }
  });

  it("one that holds at 0 combo points still warns (Kira's #206 review)", () => {
    for (const [op, value] of [
      [">=", 0],
      ["<=", FINISHER],
      ["<", FINISHER],
      ["<=", 0],
      ["==", 0],
    ]) {
      const condition = { type: "comboPoints", op, value };
      assert.deepEqual(
        messages(
          rotation(rule("eviscerate", condition), rule("premeditation")),
        ),
        [
          finisherText(
            "Eviscerate (eviscerate)",
            "its comboPoints condition does not need a combo point",
          ),
        ],
        `${op} ${value}`,
      );
    }
    // One condition that needs a point is enough, beside one that does not.
    const both = rule(
      "eviscerate",
      { type: "comboPoints", op: ">=", value: 0 },
      enoughPoints,
    );
    assert.deepEqual(messages(rotation(both, rule("backstab"))), []);
  });

  it("a resource condition on comboPoints is read as a comboPoints one (#210's QA, #214)", () => {
    const resource = (op, value) => ({
      type: "resource",
      resource: "comboPoints",
      op,
      value,
    });
    const guarded = rotation(
      rule("eviscerate", resource(">=", FINISHER)),
      rule("backstab"),
    );
    assert.deepEqual(validateRotation(guarded), []);
    assert.deepEqual(rotationWarnings(guarded), []);
    // One that holds at 0 combo points does not guard, as for the type.
    const loose = rotation(
      rule("eviscerate", energy(FINISHER), resource(">=", 0)),
      rule("backstab"),
    );
    assert.deepEqual(rotationWarnings(loose), [
      {
        code: "finisherNoComboPoints",
        path: "rules[0].conditions",
        message: finisherText(
          "Eviscerate (eviscerate)",
          "its comboPoints condition does not need a combo point",
        ),
        ability: "eviscerate",
        condition: 1,
      },
    ]);
  });

  it("is a real trap: the fight casts nothing below it", () => {
    const fight = (rules) =>
      runFight({
        seed: 1,
        duration: 30,
        config: { rotation: rotation(...rules) },
      });
    const trapped = fight([rule("eviscerate"), rule("sinister-strike")]);
    assert.equal(trapped.abilities["Sinister Strike"], undefined);
    const guarded = fight([
      rule("eviscerate", enoughPoints),
      rule("sinister-strike"),
    ]);
    assert.ok(guarded.abilities["Sinister Strike"].casts > 0);
  });
});

describe("rotationWarnings: an on-GCD cooldown with no cooldownReady", () => {
  it("warns, at the rule's conditions, naming the condition to add", () => {
    const trap = rotation(
      rule("ghostly-strike", energy(FINISHER)),
      rule("sinister-strike"),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "cooldownNotChecked",
        path: "rules[0].conditions",
        message: cooldownText(
          "Ghostly Strike (ghostly-strike)",
          "ghostly-strike",
        ),
        ability: "ghostly-strike",
      },
    ]);
  });

  it("warns for each on-GCD ability with a cooldown, guarded or not by talent", () => {
    for (const [id, label] of [
      ["adrenaline-rush", "Adrenaline Rush"],
      ["blade-flurry", "Blade Flurry"],
    ]) {
      const trap = rotation(rule(id, unlocked(id)), rule("sinister-strike"));
      assert.deepEqual(messages(trap), [cooldownText(`${label} (${id})`, id)]);
    }
  });

  it("a cooldownReady for that ability silences it; one for another does not", () => {
    const silenced = rotation(
      rule("blade-flurry", unlocked("blade-flurry"), ready("blade-flurry")),
      rule("sinister-strike"),
    );
    assert.deepEqual(messages(silenced), []);
    const other = rotation(
      rule("blade-flurry", unlocked("blade-flurry"), ready("adrenaline-rush")),
      rule("sinister-strike"),
    );
    assert.deepEqual(messages(other), [
      cooldownText("Blade Flurry (blade-flurry)", "blade-flurry"),
    ]);
  });

  it("an off-GCD cooldown is never warned for: it is passed over, not pooled for", () => {
    const offGcd = rotation(rule("premeditation"), rule("sinister-strike"));
    assert.deepEqual(messages(offGcd), []);
  });

  it("an on-GCD ability with no cooldown is not warned for", () => {
    assert.deepEqual(
      messages(rotation(rule("sinister-strike", energy(FINISHER)))),
      [],
    );
  });
});

describe("rotationWarnings: an unconditional on-GCD rule above others", () => {
  it("warns at the rule, with the index of each on-GCD rule below it, naming each ability once", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("eviscerate", enoughPoints),
      rule("premeditation"),
      rule("backstab", energy(FINISHER)),
      rule("eviscerate", enoughPoints, energy(FINISHER)),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "starves",
        path: "rules[0]",
        message: starvesText(
          "Sinister Strike (sinister-strike)",
          3,
          "Eviscerate (eviscerate) and Backstab (backstab)",
        ),
        ability: "sinister-strike",
        below: [1, 3, 4],
        reason: "noConditions",
      },
    ]);
  });

  it("the last on-GCD rule may have no conditions", () => {
    const builderLast = rotation(
      rule("eviscerate", enoughPoints),
      rule("sinister-strike"),
      rule("premeditation"),
    );
    assert.deepEqual(messages(builderLast), []);
  });

  it("an unconditional off-GCD rule starves nothing", () => {
    const offGcd = rotation(rule("premeditation"), rule("sinister-strike"));
    assert.deepEqual(messages(offGcd), []);
  });

  it("conditions that always hold are no conditions: it still warns", () => {
    for (const condition of [
      { type: "comboPoints", op: ">=", value: 0 },
      { type: "fightTime", op: ">=", value: 0 },
      { type: "fightTimeRemaining", op: ">=", value: 0 },
      energy(0),
    ]) {
      const trap = rotation(
        rule("sinister-strike", condition),
        rule("backstab"),
      );
      assert.deepEqual(
        messages(trap),
        [
          starvesText(
            "Sinister Strike (sinister-strike)",
            1,
            "Backstab (backstab)",
            "its rule's conditions always hold",
          ),
        ],
        JSON.stringify(condition),
      );
    }
  });

  it("a condition that can fail is a real one: no warning", () => {
    for (const condition of [
      { type: "comboPoints", op: ">=", value: 1 },
      { type: "fightTime", op: ">", value: 0 },
      { type: "fightTime", op: "<=", value: 1e9 },
      { type: "fightTimeRemaining", op: "<", value: 10 },
      energy(0.5),
    ]) {
      const guarded = rotation(
        rule("sinister-strike", condition),
        rule("backstab"),
      );
      assert.deepEqual(
        validateRotation(guarded),
        [],
        JSON.stringify(condition),
      );
      assert.deepEqual(messages(guarded), [], JSON.stringify(condition));
    }
    // Only the cheap cases: energy to cap is never below 0 either, but that
    // type is not read as always holding. (The rotation is valid, so the
    // empty list is the warnings', not a refusal.)
    const notCaught = rotation(
      rule("sinister-strike", { type: "energyToCap", op: ">=", value: 0 }),
      rule("backstab"),
    );
    assert.deepEqual(validateRotation(notCaught), []);
    assert.deepEqual(messages(notCaught), []);
    // One that can fail beside one that cannot.
    const mixed = rotation(
      rule("sinister-strike", energy(0), energy(FINISHER)),
      rule("backstab"),
    );
    assert.deepEqual(messages(mixed), []);
  });

  it("a rule with any condition is not warned for", () => {
    const guarded = rotation(
      rule("sinister-strike", energy(FINISHER)),
      rule("backstab"),
    );
    assert.deepEqual(messages(guarded), []);
  });
});

describe("rotationWarnings: data, not names", () => {
  // A fake ability, given as data, that the spell data does not name.
  const fakeContext = {
    abilities: ["fake-strike", "sinister-strike"],
    castable: ["fake-strike", "sinister-strike"],
    talentGrantedAbilities: [],
    finishers: ["fake-strike"],
    cooldowns: ["fake-strike"],
    onGcd: ["fake-strike", "sinister-strike"],
  };

  it("reads finishers, cooldowns and on-GCD abilities from the context", () => {
    const trap = rotation(rule("fake-strike"), rule("sinister-strike"));
    assert.deepEqual(validateRotation(trap, fakeContext), []);
    assert.deepEqual(messages(trap, fakeContext), [
      finisherText("fake-strike"),
      cooldownText("fake-strike", "fake-strike"),
    ]);
    // Not a finisher, it is said to starve the rule below.
    assert.deepEqual(messages(trap, { ...fakeContext, finishers: [] }), [
      cooldownText("fake-strike", "fake-strike"),
      starvesText("fake-strike", 1, "Sinister Strike (sinister-strike)"),
    ]);
  });

  it("an ability the context does not list as on-GCD never pools, so never warns", () => {
    const trap = rotation(rule("fake-strike"), rule("sinister-strike"));
    assert.deepEqual(
      messages(trap, { ...fakeContext, onGcd: ["sinister-strike"] }),
      [finisherText("fake-strike")],
    );
  });

  it("the engine's lists come from the ability data", () => {
    const context = warningContext();
    assert.deepEqual(context.cooldowns, [
      "premeditation",
      "adrenaline-rush",
      "ghostly-strike",
      "blade-flurry",
      "cold-blood",
    ]);
    assert.ok(!context.onGcd.includes("premeditation"));
    assert.ok(!context.onGcd.includes("cold-blood"));
    assert.ok(context.onGcd.includes("blade-flurry"));
  });
});

describe("rotationWarnings: what it does not do", () => {
  it("gives nothing for a rotation the validator refuses", () => {
    assert.deepEqual(rotationWarnings({}), []);
    assert.deepEqual(rotationWarnings(null), []);
    assert.deepEqual(
      rotationWarnings(rotation(rule("cold-blood"), rule("eviscerate"))),
      [],
    );
  });

  it("leaves validateRotation's result as it was: a trap is not an error", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    assert.deepEqual(validateRotation(trap), []);
  });

  it("does not change the rotation", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    const before = JSON.stringify(trap);
    rotationWarnings(trap);
    assert.equal(JSON.stringify(trap), before);
  });
});

describe("importRotation: warnings", () => {
  it("a file with a trap still imports, and returns its warnings", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    const result = importRotation(exportRotation(trap));
    assert.equal(result.ok, true);
    assert.deepEqual(result.rotation, trap);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, rotationWarnings(trap));
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ["finisherNoComboPoints"],
    );
  });

  it("a refused file has no warnings", () => {
    assert.deepEqual(importRotation("{ nope").warnings, []);
    assert.deepEqual(importRotation("{}").warnings, []);
    assert.deepEqual(
      importRotation(JSON.stringify(rotation(rule("cold-blood")))).warnings,
      [],
    );
  });

  it("the longest warning the data allows is under rotation.maxErrorChars, so nothing is cut", () => {
    // importRotation cuts warnings as it cuts errors, but a warning echoes no
    // value from the file, so with the engine's data none is that long: the
    // longest lists every other on-GCD ability once.
    const below = warningContext()
      .onGcd.filter((id) => id !== "sinister-strike")
      .map((id) => rule(id, unlocked(id), ready(id), enoughPoints));
    // Conditions that always hold make the longer wording.
    const trap = rotation(
      rule("sinister-strike", { type: "fightTime", op: ">=", value: 0 }),
      ...below,
    );
    const result = importRotation(exportRotation(trap));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(result.warnings, rotationWarnings(trap));
    assert.ok(result.warnings[0].message.length < k("rotation.maxErrorChars"));
  });
});

describe("rotationWarnings: codes and data (#214)", () => {
  it("every warning is frozen and has a code, a path, a message and its data", () => {
    const trap = rotation(
      rule("ghostly-strike", { type: "abilityGranted", ability: "backstab" }),
      rule("eviscerate"),
      rule("sinister-strike"),
      rule("sinister-strike"),
      rule("backstab"),
    );
    const warnings = rotationWarnings(trap);
    assert.deepEqual(
      warnings.map(({ code, path }) => [code, path]),
      [
        ["cooldownNotChecked", "rules[0].conditions"],
        ["grantedNotTalent", "rules[0].conditions[0]"],
        ["finisherNoComboPoints", "rules[1].conditions"],
        ["starves", "rules[2]"],
        ["duplicateRule", "rules[3]"],
      ],
    );
    for (const warning of warnings) {
      assert.ok(Object.isFrozen(warning), warning.code);
      assert.equal(typeof warning.message, "string");
    }
    assert.ok(Object.isFrozen(warnings[3].below));
  });

  it("no message carries a place: the path says where (the message contract)", () => {
    const trap = rotation(
      rule("ghostly-strike", { type: "abilityGranted", ability: "backstab" }),
      rule("eviscerate"),
      rule("sinister-strike"),
      rule("sinister-strike"),
      rule("backstab"),
    );
    for (const warning of rotationWarnings(trap)) {
      assert.doesNotMatch(warning.message, /rules\[|conditions\[/);
      assert.doesNotMatch(warning.message, /^rule /i);
    }
  });
});

describe("rotationWarnings: starves (#214)", () => {
  it("below is the index of each on-GCD rule below it, and reason says why", () => {
    const trap = rotation(
      rule("sinister-strike", { type: "fightTime", op: ">=", value: 0 }),
      rule("premeditation"),
      rule("backstab", energy(FINISHER)),
    );
    const [warning] = rotationWarnings(trap);
    assert.equal(warning.code, "starves");
    assert.deepEqual(warning.below, [2]);
    assert.equal(warning.reason, "alwaysHolds");
    assert.equal(warning.ability, "sinister-strike");
  });

  it("one rule below is said once, in the singular (#210's QA)", () => {
    assert.deepEqual(
      messages(rotation(rule("sinister-strike"), rule("backstab"))),
      [
        starvesText(
          "Sinister Strike (sinister-strike)",
          1,
          "Backstab (backstab)",
        ),
      ],
    );
    assert.match(
      messages(rotation(rule("sinister-strike"), rule("backstab")))[0],
      /The rule below it for Backstab \(backstab\) never casts\. .* below that rule\.$/,
    );
  });

  it("two rules for one ability are two rules, naming the ability once", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("backstab", energy(FINISHER)),
      rule("backstab", energy(1)),
    );
    const [warning] = rotationWarnings(trap);
    assert.deepEqual(warning.below, [1, 2]);
    assert.equal(
      warning.message,
      starvesText(
        "Sinister Strike (sinister-strike)",
        2,
        "Backstab (backstab)",
      ),
    );
  });

  it("three abilities are joined with commas and 'and'", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("backstab", energy(FINISHER)),
      rule("eviscerate", enoughPoints),
      rule("hemorrhage", energy(FINISHER)),
    );
    assert.match(
      messages(trap)[0],
      /The 3 rules below it for Backstab \(backstab\), Eviscerate \(eviscerate\) and Hemorrhage \(hemorrhage\) never cast\./,
    );
  });

  it("a finisher's own warning stands for it: no starves on the same rule", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    assert.deepEqual(codes(trap), ["finisherNoComboPoints"]);
    // A cooldown with no check still starves, and says both.
    const cooldown = rotation(rule("ghostly-strike"), rule("sinister-strike"));
    assert.deepEqual(codes(cooldown), ["cooldownNotChecked", "starves"]);
  });
});

describe("rotationWarnings: the last rule (#210's QA)", () => {
  it("a last finisher or cooldown waits; it holds nothing back", () => {
    assert.deepEqual(messages(rotation(rule("eviscerate"))), [
      finisherText(
        "Eviscerate (eviscerate)",
        "its rule has no comboPoints condition",
        LAST,
      ),
    ]);
    assert.deepEqual(
      messages(
        rotation(rule("sinister-strike", energy(1)), rule("ghostly-strike")),
      ),
      [cooldownText("Ghostly Strike (ghostly-strike)", "ghostly-strike", LAST)],
    );
    for (const message of messages(
      rotation(rule("sinister-strike", energy(1)), rule("ghostly-strike")),
    )) {
      assert.doesNotMatch(message, /below/);
    }
  });
});

describe("rotationWarnings: duplicateRule (#214)", () => {
  const dup = (rules) =>
    rotationWarnings(rotation(...rules)).filter(
      (warning) => warning.code === "duplicateRule",
    );

  it("warns at a rule the same as one above it, with that rule's index", () => {
    const trap = rotation(
      rule("eviscerate", enoughPoints),
      rule("sinister-strike", energy(FINISHER)),
      rule("eviscerate", enoughPoints),
      rule("sinister-strike"),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "duplicateRule",
        path: "rules[2]",
        message: duplicateText("Eviscerate (eviscerate)"),
        ability: "eviscerate",
        same: 0,
      },
    ]);
  });

  it("names the first of several copies", () => {
    const found = dup([
      rule("backstab", energy(1)),
      rule("backstab", energy(1)),
      rule("backstab", energy(1)),
    ]);
    assert.deepEqual(
      found.map(({ path, same }) => [path, same]),
      [
        ["rules[1]", 0],
        ["rules[2]", 0],
      ],
    );
  });

  it("conditions in any order and keys in any order are the same rule", () => {
    const sdc = {
      type: "auraRemaining",
      aura: "slice-and-dice",
      op: "<",
      value: 1,
    };
    const reordered = {
      value: 1,
      op: "<",
      aura: "slice-and-dice",
      type: "auraRemaining",
    };
    assert.equal(
      dup([
        rule("slice-and-dice", enoughPoints, sdc),
        rule("slice-and-dice", reordered, {
          value: FINISHER,
          op: ">=",
          type: "comboPoints",
        }),
      ]).length,
      1,
    );
  });

  it("a param written out at its default is the same as one left out", () => {
    assert.equal(
      dup([
        rule("backstab", { type: "auraActive", aura: "slice-and-dice" }),
        rule("backstab", {
          type: "auraActive",
          aura: "slice-and-dice",
          active: true,
        }),
      ]).length,
      1,
    );
    assert.equal(
      dup([
        rule("ghostly-strike", ready("ghostly-strike"), energy(1)),
        rule("ghostly-strike", energy(1), {
          type: "cooldownReady",
          ability: "ghostly-strike",
          ready: true,
        }),
      ]).length,
      1,
    );
  });

  it("a different value, param, action or count of conditions is not the same", () => {
    for (const [first, second] of [
      [rule("backstab", energy(1)), rule("backstab", energy(2))],
      [rule("backstab", energy(1)), rule("sinister-strike", energy(1))],
      [rule("backstab", energy(1)), rule("backstab", energy(1), energy(1))],
      [
        rule("backstab", { type: "auraActive", aura: "slice-and-dice" }),
        rule("backstab", {
          type: "auraActive",
          aura: "slice-and-dice",
          active: false,
        }),
      ],
    ]) {
      assert.deepEqual(dup([first, second]), [], JSON.stringify(second));
    }
  });

  it("is the only warning for the copy, and is not counted as starved (#210's QA)", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("backstab"),
      rule("backstab"),
    );
    const warnings = rotationWarnings(trap);
    assert.deepEqual(
      warnings.map(({ code, path }) => [code, path]),
      [
        ["starves", "rules[0]"],
        ["duplicateRule", "rules[2]"],
      ],
    );
    // The copy is in no `below`, so the first Backstab, whose only on-GCD
    // rule below is its copy, is not said to starve it (or itself).
    assert.deepEqual(warnings[0].below, [1]);
  });

  it("a copy of a trapped rule gets only duplicateRule", () => {
    assert.deepEqual(
      codes(
        rotation(rule("eviscerate", energy(1)), rule("eviscerate", energy(1))),
      ),
      ["finisherNoComboPoints", "duplicateRule"],
    );
  });
});

describe("rotationWarnings: grantedNotTalent (#214)", () => {
  const granted = (ability) => ({ type: "abilityGranted", ability });

  it("warns at an abilityGranted check on an ability no talent grants", () => {
    const trap = rotation(
      rule("eviscerate", enoughPoints, granted("sinister-strike")),
      rule("sinister-strike"),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "grantedNotTalent",
        path: "rules[0].conditions[1]",
        message: grantedText("Sinister Strike (sinister-strike)"),
        ability: "sinister-strike",
        condition: 1,
      },
    ]);
  });

  it("gives one per such condition", () => {
    const trap = rotation(
      rule("sinister-strike", granted("backstab"), granted("eviscerate")),
    );
    assert.deepEqual(
      rotationWarnings(trap).map(({ path, condition }) => [path, condition]),
      [
        ["rules[0].conditions[0]", 0],
        ["rules[0].conditions[1]", 1],
      ],
    );
  });

  it("an ability a talent grants is not warned for", () => {
    for (const id of ["cold-blood", "blade-flurry", "adrenaline-rush"]) {
      const guarded = rotation(
        rule(id, granted(id), ready(id)),
        rule("sinister-strike"),
      );
      assert.deepEqual(codes(guarded), [], id);
    }
  });

  it("reads talentGrantedAbilities from the context", () => {
    const trap = rotation(rule("sinister-strike", granted("backstab")));
    assert.deepEqual(codes(trap), ["grantedNotTalent"]);
    assert.deepEqual(codes(trap, { talentGrantedAbilities: ["backstab"] }), []);
  });
});
