import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import { listPresets, presetRotation } from "../js/rotation-presets.js";
import { rotationContext, validateRotation } from "../js/rotation-validator.js";
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
const granted = (ability) => ({ type: "abilityGranted", ability });
// A context in which no ability is talent-granted, so a Premeditation rule
// validates with no conditions at all and stays unconditional: the off-GCD
// check in the starves warning is what keeps it from warning.
const noTalentGuard = { talentGrantedAbilities: [] };
const energy = (value) => ({
  type: "resource",
  resource: "energy",
  op: ">=",
  value,
});
// The warnings' messages. A rotation the validator refuses gets no warnings,
// so a test that expects none would pass for the wrong reason: each rotation
// read here must validate first (#207, when Premeditation and Ghostly Strike
// became talent-guarded).
const messages = (value, context) => {
  assert.deepEqual(validateRotation(value, context), [], "validates");
  return rotationWarnings(value, context).map((warning) => warning.message);
};

// The messages say what, never where (the message contract, #214). A rule
// with rules below it holds them back; the last rule has none (#210's QA).
const HELD = "it holds back every rule below it";
const LAST = "the rotation waits at it";
const finisherText = (
  label,
  lacks = "its rule has no combo points condition",
  held = HELD,
) =>
  `${label} is a finisher, but ${lacks}. It is cast at one combo point, and with none it can't be cast, so ${held}. ${
    lacks === "its rule has no combo points condition"
      ? "Add one"
      : "Change it to need at least one"
  }, such as { "type": "comboPoints", "op": ">=", "value": ${FINISHER} }.`;
const cooldownText = (label, id, held = HELD) =>
  `${label} has a cooldown and starts the global cooldown, but its rule doesn't check that it's ready. While it is on cooldown ${held}. Add { "type": "cooldownReady", "ability": "${id}" } to its conditions.`;
// `count` rules below it, casting `names` ("A and B"), never cast.
const starvesText = (
  label,
  count,
  names,
  lacks = "its rule has no conditions",
) =>
  `${label} starts the global cooldown and ${lacks}, so it is cast or waited for whenever the global cooldown is clear. ${
    count === 1
      ? `The rule below it for ${names} never casts.`
      : `The ${count} rules below it for ${names} never cast.`
  } ${
    lacks === "its rule has no conditions"
      ? `Give it conditions or move it below ${count === 1 ? "that rule" : "them"}.`
      : "Change its conditions so they are sometimes false."
  }`;
// Which rule above is in the data (`same`), not the message: no place.
const duplicateText = (label) =>
  `${label} is never reached: a rule above it casts it under the same conditions. Delete this one.`;
const grantedText = (label) =>
  `${label} isn't granted by a talent, so 'is granted' is never true here and this rule never casts.`;
const unlockedText = (label) =>
  `${label} doesn't need a talent, so 'is not locked' is always true and does nothing.`;
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

// Each case's whole message spelled out, in Fran's wording (#207) with the
// message contract (#214: no place in the message), not built by the helpers above, so a helper that drifted with the
// code would still be caught here.
describe("rotationWarnings: each message, in full", () => {
  const only = (value) => {
    const all = messages(value);
    assert.equal(all.length, 1, all.join("\n"));
    return all[0];
  };
  const example = `{ "type": "comboPoints", "op": ">=", "value": ${FINISHER} }`;
  it("a finisher with no combo points condition: add one", () => {
    assert.equal(
      only(
        rotation(rule("eviscerate", energy(FINISHER)), rule("sinister-strike")),
      ),
      `Eviscerate (eviscerate) is a finisher, but its rule has no combo points condition. It is cast at one combo point, and with none it can't be cast, so it holds back every rule below it. Add one, such as ${example}.`,
    );
  });
  it("a finisher whose combo points condition holds at 0: change it", () => {
    assert.equal(
      only(
        rotation(
          rule(
            "eviscerate",
            { type: "comboPoints", op: ">=", value: 0 },
            energy(FINISHER),
          ),
          rule("sinister-strike"),
        ),
      ),
      `Eviscerate (eviscerate) is a finisher, but its combo points condition still holds at 0 combo points. It is cast at one combo point, and with none it can't be cast, so it holds back every rule below it. Change it to need at least one, such as ${example}.`,
    );
  });
  it("an on-GCD rule with no conditions: give it some or move it", () => {
    assert.equal(
      only(
        rotation(rule("sinister-strike"), rule("backstab", energy(FINISHER))),
      ),
      "Sinister Strike (sinister-strike) starts the global cooldown and its rule has no conditions, so it is cast or waited for whenever the global cooldown is clear. The rule below it for Backstab (backstab) never casts. Give it conditions or move it below that rule.",
    );
  });
  it("an on-GCD rule none of whose conditions can fail: change them", () => {
    assert.equal(
      only(
        rotation(
          rule("sinister-strike", { type: "fightTime", op: ">=", value: 0 }),
          rule("backstab", energy(FINISHER)),
        ),
      ),
      "Sinister Strike (sinister-strike) starts the global cooldown and none of its rule's conditions can fail, so it is cast or waited for whenever the global cooldown is clear. The rule below it for Backstab (backstab) never casts. Change its conditions so they are sometimes false.",
    );
  });
  it("an on-GCD cooldown that is not checked for being ready", () => {
    assert.equal(
      only(
        rotation(
          rule("ghostly-strike", unlocked("ghostly-strike"), energy(FINISHER)),
          rule("sinister-strike"),
        ),
      ),
      `Ghostly Strike (ghostly-strike) has a cooldown and starts the global cooldown, but its rule doesn't check that it's ready. While it is on cooldown it holds back every rule below it. Add { "type": "cooldownReady", "ability": "ghostly-strike" } to its conditions.`,
    );
  });
});

// A finisher that would also starve the rules below (no conditions, or only
// ones that cannot fail) gets the finisher warning alone (#207).
describe("rotationWarnings: one warning for a finisher", () => {
  for (const [name, conditions, lacks] of [
    ["no conditions", [], undefined],
    [
      "a combo points condition that holds at 0",
      [{ type: "comboPoints", op: ">=", value: 0 }],
      "its combo points condition still holds at 0 combo points",
    ],
    ["a condition that cannot fail", [energy(0)], undefined],
  ]) {
    it(`${name}: the finisher warning only`, () => {
      const trap = rotation(
        rule("eviscerate", ...conditions),
        rule("sinister-strike"),
      );
      assert.deepEqual(messages(trap), [
        finisherText("Eviscerate (eviscerate)", lacks),
      ]);
    });
  }

  it("the rule below a finisher still starves what is under it", () => {
    const trap = rotation(
      rule("eviscerate"),
      rule("sinister-strike"),
      rule("backstab"),
    );
    assert.deepEqual(messages(trap), [
      finisherText("Eviscerate (eviscerate)"),
      starvesText(
        "Sinister Strike (sinister-strike)",
        1,
        "Backstab (backstab)",
      ),
    ]);
  });

  it("a guarded finisher above an unconditional builder warns for nothing", () => {
    assert.deepEqual(
      messages(
        rotation(rule("eviscerate", enoughPoints), rule("sinister-strike")),
      ),
      [],
    );
  });
});

describe("rotationWarnings: the shipped rotations", () => {
  it("the default rotation gives no warnings", () => {
    assert.deepEqual(validateRotation(defaultRotation()), []);
    assert.deepEqual(rotationWarnings(defaultRotation()), []);
  });

  it("every preset gives no warnings", () => {
    assert.ok(listPresets().length > 0);
    for (const { id } of listPresets()) {
      assert.deepEqual(validateRotation(presetRotation(id)), [], id);
      assert.deepEqual(rotationWarnings(presetRotation(id)), [], id);
    }
  });

  it("every whole-rotation example in docs/rotation.md gives no warnings", async () => {
    const examples = await docExamples();
    assert.ok(examples.length > 0);
    for (const example of examples) {
      assert.deepEqual(validateRotation(example), [], example.name);
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
          "its rule has no combo points condition",
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
        messages(rotation(rule("eviscerate", condition), rule("backstab"))),
        [
          finisherText(
            "Eviscerate (eviscerate)",
            "its combo points condition still holds at 0 combo points",
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
          "its combo points condition still holds at 0 combo points",
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
      rule("ghostly-strike", unlocked("ghostly-strike"), energy(FINISHER)),
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
    assert.deepEqual(messages(offGcd, noTalentGuard), []);
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
    assert.deepEqual(validateRotation(trap, noTalentGuard), []);
    assert.deepEqual(rotationWarnings(trap, noTalentGuard), [
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
    assert.deepEqual(messages(builderLast, noTalentGuard), []);
  });

  it("an unconditional off-GCD rule starves nothing", () => {
    const offGcd = rotation(rule("premeditation"), rule("sinister-strike"));
    assert.deepEqual(messages(offGcd, noTalentGuard), []);
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
            "none of its rule's conditions can fail",
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
    // fake-strike is on the GCD here, so this covers only the cooldown check
    // (with the finisher and starves ones) reading the lists, not the
    // off-GCD path: the next test covers that.
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
    // fake-jab is not a finisher (the finisher warning would stand in for the
    // starves one) but has a cooldown, so both on-GCD checks are what keep
    // this rule from warning.
    const offGcd = {
      ...fakeContext,
      abilities: [...fakeContext.abilities, "fake-jab"],
      castable: [...fakeContext.castable, "fake-jab"],
      cooldowns: [...fakeContext.cooldowns, "fake-jab"],
      onGcd: ["sinister-strike"],
    };
    const trap = rotation(rule("fake-jab"), rule("sinister-strike"));
    assert.deepEqual(messages(trap, offGcd), []);
  });

  it("takes the lists as Sets too, with the same warnings (#207)", () => {
    const trap = rotation(rule("fake-strike"), rule("sinister-strike"));
    const asSets = {
      ...fakeContext,
      talentGrantedAbilities: new Set(),
      finishers: new Set(fakeContext.finishers),
      cooldowns: new Set(fakeContext.cooldowns),
      onGcd: new Set(fakeContext.onGcd),
    };
    assert.deepEqual(validateRotation(trap, asSets), []);
    assert.deepEqual(
      rotationWarnings(trap, asSets),
      rotationWarnings(trap, fakeContext),
    );
    assert.equal(rotationWarnings(trap, asSets).length, 2);
    const context = warningContext(asSets);
    for (const field of ["finishers", "cooldowns", "onGcd"]) {
      assert.ok(Array.isArray(context[field]), field);
      assert.ok(Object.isFrozen(context[field]), field);
      assert.deepEqual(context[field], fakeContext[field], field);
    }
  });

  it("refuses a list that is not an array or a Set, saying which and what it was (#207)", () => {
    for (const field of ["finishers", "cooldowns", "onGcd"]) {
      for (const [given, shown] of [
        ["fake-strike", 'the string "fake-strike"'],
        [{}, "an object"],
      ]) {
        const message = `warningContext: ${field} must be an array or a Set of ability ids, not ${shown}.`;
        const isIt = (error) =>
          error instanceof TypeError && error.message === message;
        assert.throws(
          () => warningContext({ ...fakeContext, [field]: given }),
          isIt,
          `${field} ${shown}`,
        );
        assert.throws(
          () =>
            rotationWarnings(rotation(rule("sinister-strike")), {
              ...fakeContext,
              [field]: given,
            }),
          isIt,
          `${field} ${shown}`,
        );
      }
      // null is taken as absent, as for talentGrantedAbilities (#215 QA).
      assert.deepEqual(
        warningContext({ [field]: null })[field],
        warningContext()[field],
      );
      assert.throws(
        () => warningContext({ [field]: [7] }),
        (error) =>
          error instanceof TypeError &&
          error.message ===
            `warningContext: ${field} must hold ability id strings, not a number.`,
        field,
      );
    }
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
    const trap = rotation(
      rule("eviscerate"),
      rule("sinister-strike"),
      rule("backstab"),
    );
    const result = importRotation(exportRotation(trap));
    assert.equal(result.ok, true);
    assert.deepEqual(result.rotation, trap);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, rotationWarnings(trap));
    assert.deepEqual(
      result.warnings.map((warning) => warning.code),
      ["finisherNoComboPoints", "starves"],
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
      .map((id) =>
        rule(
          id,
          ...(rotationContext().talentGrantedAbilities.includes(id)
            ? [unlocked(id)]
            : []),
          ready(id),
          enoughPoints,
        ),
      );
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
      rule("ghostly-strike", unlocked("backstab"), unlocked("ghostly-strike")),
      rule("backstab", { type: "abilityGranted", ability: "backstab" }),
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
        ["unlockedNotTalent", "rules[0].conditions[0]"],
        ["grantedNotTalent", "rules[1].conditions[0]"],
        ["finisherNoComboPoints", "rules[2].conditions"],
        // Ghostly Strike above can cast, so the finisher does too (Kira's
        // QA on #216): it starves the rules below as well.
        ["starves", "rules[2]"],
        ["starves", "rules[3]"],
        ["duplicateRule", "rules[4]"],
      ],
    );
    for (const warning of warnings) {
      assert.ok(Object.isFrozen(warning), warning.code);
      assert.equal(typeof warning.message, "string");
    }
    assert.ok(Object.isFrozen(warnings[4].below));
  });

  it("no message carries a place: the path says where (the message contract)", () => {
    const trap = rotation(
      rule("ghostly-strike", unlocked("backstab"), unlocked("ghostly-strike")),
      rule("backstab", { type: "abilityGranted", ability: "backstab" }),
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
      rule("premeditation", unlocked("premeditation")),
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
      rule("hemorrhage", unlocked("hemorrhage"), energy(FINISHER)),
    );
    assert.match(
      messages(trap)[0],
      /The 3 rules below it for Backstab \(backstab\), Eviscerate \(eviscerate\) and Hemorrhage \(hemorrhage\) never cast\./,
    );
  });

  it("a finisher's own warning stands for it: no starves on the same rule", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    assert.deepEqual(codes(trap), ["finisherNoComboPoints"]);
    // A cooldown with no check still starves, and says both. Ghostly Strike
    // is talent-guarded since #207, so it is not talent-granted here, to
    // need no guard (a guard is a condition, so nothing would starve).
    const cooldown = rotation(rule("ghostly-strike"), rule("sinister-strike"));
    assert.deepEqual(codes(cooldown, { talentGrantedAbilities: [] }), [
      "cooldownNotChecked",
      "starves",
    ]);
  });
});

describe("rotationWarnings: the last rule (#210's QA)", () => {
  it("a last finisher or cooldown waits; it holds nothing back", () => {
    assert.deepEqual(messages(rotation(rule("eviscerate"))), [
      finisherText(
        "Eviscerate (eviscerate)",
        "its rule has no combo points condition",
        LAST,
      ),
    ]);
    assert.deepEqual(
      messages(
        rotation(
          rule("sinister-strike", energy(1)),
          rule("ghostly-strike", unlocked("ghostly-strike")),
        ),
      ),
      [cooldownText("Ghostly Strike (ghostly-strike)", "ghostly-strike", LAST)],
    );
    for (const message of messages(
      rotation(
        rule("sinister-strike", energy(1)),
        rule("ghostly-strike", unlocked("ghostly-strike")),
      ),
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
        rule(
          "ghostly-strike",
          unlocked("ghostly-strike"),
          ready("ghostly-strike"),
          energy(1),
        ),
        rule("ghostly-strike", energy(1), unlocked("ghostly-strike"), {
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
// What the two talent warnings rest on, read from real fights rather than the
// condition code (Kira's QA on #216): the fight grants only talent and host
// abilities (Rogue), so abilityGranted on any other ability is never true,
// and only a talent ability can be locked, so abilityUnlocked on any other is
// always true. With no build and with one selected.
describe("abilityGranted and abilityUnlocked on an ability no talent grants, in a fight", () => {
  const BUILDS = [{}, { "combat.lightning-reflexes": 3 }];
  const casts = (talents, ...conditions) =>
    runFight({
      seed: 1,
      duration: 60,
      config: {
        talents,
        rotation: rotation(rule("sinister-strike", ...conditions)),
      },
    }).abilities["Sinister Strike"]?.casts ?? 0;

  it("abilityUnlocked is always true: the fight is the same as with no condition", () => {
    for (const talents of BUILDS) {
      const plain = casts(talents);
      assert.ok(plain > 0, JSON.stringify(talents));
      assert.equal(
        casts(talents, unlocked("sinister-strike")),
        plain,
        JSON.stringify(talents),
      );
    }
  });

  it("abilityGranted is never true: the rule never casts", () => {
    for (const talents of BUILDS) {
      assert.equal(
        casts(talents, { type: "abilityGranted", ability: "sinister-strike" }),
        0,
        JSON.stringify(talents),
      );
    }
  });
});

describe("rotationWarnings: a rule with grantedNotTalent never casts (#214)", () => {
  const granted = (ability) => ({ type: "abilityGranted", ability });

  it("it starves nothing below it", () => {
    const trap = rotation(
      rule("sinister-strike", granted("sinister-strike")),
      rule("backstab", energy(FINISHER)),
      rule("eviscerate", enoughPoints),
    );
    assert.deepEqual(codes(trap), ["grantedNotTalent"]);
  });

  it("it gets no other warning: it never waits at its ability", () => {
    const trap = rotation(
      rule("eviscerate", granted("eviscerate")),
      rule("sinister-strike"),
    );
    assert.deepEqual(codes(trap), ["grantedNotTalent"]);
  });

  it("it is not counted as starved by a rule above it", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("backstab", granted("backstab")),
      rule("eviscerate", enoughPoints),
    );
    const warnings = rotationWarnings(trap);
    assert.deepEqual(
      warnings.map(({ code, path }) => [code, path]),
      [
        ["starves", "rules[0]"],
        ["grantedNotTalent", "rules[1].conditions[0]"],
      ],
    );
    assert.deepEqual(warnings[0].below, [2]);
    assert.equal(
      warnings[0].message,
      starvesText(
        "Sinister Strike (sinister-strike)",
        1,
        "Eviscerate (eviscerate)",
      ),
    );
  });

  it("a rule above only rules that never cast starves none", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("backstab", granted("backstab")),
    );
    assert.deepEqual(codes(trap), ["grantedNotTalent"]);
  });
});

describe("rotationWarnings: unlockedNotTalent (#214)", () => {
  it("warns at an abilityUnlocked check on an ability no talent grants", () => {
    const trap = rotation(
      rule("eviscerate", enoughPoints, unlocked("sinister-strike")),
      rule("sinister-strike"),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "unlockedNotTalent",
        path: "rules[0].conditions[1]",
        message: unlockedText("Sinister Strike (sinister-strike)"),
        ability: "sinister-strike",
        condition: 1,
      },
    ]);
  });

  it("gives one per such condition; the rule still casts, and starves what is below", () => {
    const trap = rotation(
      rule("sinister-strike", unlocked("backstab"), unlocked("eviscerate")),
      rule("backstab"),
    );
    assert.deepEqual(
      rotationWarnings(trap).map(({ code, path }) => [code, path]),
      [
        ["unlockedNotTalent", "rules[0].conditions[0]"],
        ["unlockedNotTalent", "rules[0].conditions[1]"],
        ["starves", "rules[0]"],
      ],
    );
  });

  it("counts as always holding for starves (Kira's case; Scout's call on #216)", () => {
    // Sinister Strike's only check is always true, so it is cast or waited
    // for whenever the GCD is clear and Eviscerate is never reached.
    const trap = rotation(
      rule("sinister-strike", unlocked("sinister-strike")),
      rule("eviscerate", { type: "comboPoints", op: ">=", value: 5 }),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        code: "unlockedNotTalent",
        path: "rules[0].conditions[0]",
        message: unlockedText("Sinister Strike (sinister-strike)"),
        ability: "sinister-strike",
        condition: 0,
      },
      {
        code: "starves",
        path: "rules[0]",
        message: starvesText(
          "Sinister Strike (sinister-strike)",
          1,
          "Eviscerate (eviscerate)",
          "none of its rule's conditions can fail",
        ),
        ability: "sinister-strike",
        below: [1],
        reason: "alwaysHolds",
      },
    ]);
  });

  it("with a cheap always-true number too it still starves; one real check stops it", () => {
    const loose = { type: "fightTime", op: ">=", value: 0 };
    const starves = (...conditions) =>
      codes(
        rotation(
          rule("sinister-strike", ...conditions),
          rule("eviscerate", enoughPoints),
        ),
      ).includes("starves");
    assert.equal(starves(unlocked("sinister-strike"), loose), true);
    assert.equal(starves(unlocked("sinister-strike"), energy(FINISHER)), false);
  });

  it("an abilityUnlocked check on a talent ability does not count as always holding", () => {
    // Hemorrhage can be locked, so the check can fail: nothing is starved.
    assert.deepEqual(
      codes(
        rotation(
          rule("hemorrhage", unlocked("hemorrhage")),
          rule("sinister-strike"),
        ),
      ),
      [],
    );
  });

  it("an ability a talent grants is not warned for", () => {
    assert.deepEqual(
      messages(
        rotation(
          rule("hemorrhage", unlocked("hemorrhage"), energy(FINISHER)),
          rule("sinister-strike"),
        ),
      ),
      [],
    );
  });

  it("reads talentGrantedAbilities from the context", () => {
    const trap = rotation(
      rule("eviscerate", enoughPoints, unlocked("cold-blood")),
      rule("sinister-strike"),
    );
    assert.deepEqual(codes(trap, noTalentGuard), ["unlockedNotTalent"]);
    assert.deepEqual(codes(trap), []);
  });
});

describe("rotationWarnings: a finisher's starves (Kira's QA on #216)", () => {
  it("with a rule above that can cast, it starves the rules below and says so", () => {
    // Sinister Strike builds the point; Eviscerate then casts at one and
    // Hemorrhage is never reached.
    const trap = rotation(
      rule("sinister-strike", { type: "comboPoints", op: "<", value: 1 }),
      rule("eviscerate"),
      rule("hemorrhage", unlocked("hemorrhage")),
    );
    const warnings = rotationWarnings(trap);
    assert.deepEqual(
      warnings.map(({ code, path }) => [code, path]),
      [
        ["finisherNoComboPoints", "rules[1].conditions"],
        ["starves", "rules[1]"],
      ],
    );
    assert.deepEqual(warnings[1].below, [2]);
    assert.equal(warnings[1].ability, "eviscerate");
    assert.equal(
      warnings[1].message,
      starvesText("Eviscerate (eviscerate)", 1, "Hemorrhage (hemorrhage)"),
    );
  });

  it("with no rule above that can cast, it waits at 0 points: one warning", () => {
    assert.deepEqual(
      codes(rotation(rule("eviscerate"), rule("sinister-strike"))),
      ["finisherNoComboPoints"],
    );
    assert.deepEqual(
      codes(
        rotation(
          rule("premeditation", unlocked("premeditation")),
          rule("sinister-strike", granted("sinister-strike")),
          rule("eviscerate"),
          rule("sinister-strike"),
        ),
      ),
      ["grantedNotTalent", "finisherNoComboPoints"],
    );
  });
});

describe("rotationWarnings: 'holds back' counts only on-GCD rules (Kira's QA on #216)", () => {
  it("a finisher with only off-GCD rules below holds nothing back", () => {
    assert.deepEqual(
      messages(
        rotation(
          rule("eviscerate"),
          rule("premeditation", unlocked("premeditation")),
          rule("cold-blood", granted("cold-blood")),
        ),
      ),
      [finisherText("Eviscerate (eviscerate)", undefined, LAST)],
    );
  });

  it("nor does an unchecked cooldown, nor with only rules below that never cast", () => {
    assert.deepEqual(
      messages(
        rotation(
          rule("ghostly-strike", unlocked("ghostly-strike")),
          rule("premeditation", unlocked("premeditation")),
        ),
      ),
      [cooldownText("Ghostly Strike (ghostly-strike)", "ghostly-strike", LAST)],
    );
    assert.deepEqual(
      messages(
        rotation(
          rule("eviscerate"),
          rule("sinister-strike", granted("sinister-strike")),
        ),
      )[0],
      finisherText("Eviscerate (eviscerate)", undefined, LAST),
    );
  });

  it("with an on-GCD rule below among off-GCD ones, it still says so", () => {
    assert.deepEqual(
      messages(
        rotation(
          rule("eviscerate"),
          rule("premeditation", unlocked("premeditation")),
          rule("sinister-strike"),
        ),
      ),
      [finisherText("Eviscerate (eviscerate)", undefined, HELD)],
    );
  });
});
