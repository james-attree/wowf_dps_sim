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
// The warnings' messages. A rotation the validator refuses gets no warnings,
// so a test that expects none would pass for the wrong reason: each rotation
// read here must validate first (#207, when Premeditation and Ghostly Strike
// became talent-guarded).
const messages = (value, context) => {
  assert.deepEqual(validateRotation(value, context), [], "validates");
  return rotationWarnings(value, context).map((warning) => warning.message);
};

const finisherText = (
  path,
  label,
  lacks = "its rule has no comboPoints condition",
) =>
  `${path}: ${label} is a finisher, but ${lacks}. It is cast at one combo point, and with none it can't be cast, so it holds back every rule below it. ${
    lacks === "its rule has no comboPoints condition"
      ? `Add a comboPoints condition, such as { "type": "comboPoints", "op": ">=", "value": ${FINISHER} }.`
      : "Change its comboPoints condition to need at least 1 combo point."
  }`;
const cooldownText = (path, label, id) =>
  `${path}: ${label} has a cooldown and starts the global cooldown, but its rule has no cooldownReady check. While it is on cooldown it holds back every rule below it. Add { "type": "cooldownReady", "ability": "${id}" } to its conditions.`;
const starvesText = (
  path,
  label,
  below,
  lacks = "its rule has no conditions",
) =>
  `${path}: ${label} starts the global cooldown and ${lacks}, so it is cast or waited for whenever the global cooldown is clear. These rules below it are never cast: ${below}. ${
    lacks === "its rule has no conditions"
      ? "Give it conditions or move it below them."
      : "Change its conditions so they are sometimes false."
  }`;

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

// Each case's advice spelled out in full, not built by the helpers above, so
// a helper that drifted with the code would still be caught here.
describe("rotationWarnings: the advice fits the case", () => {
  const only = (value) => {
    const all = messages(value);
    assert.equal(all.length, 1, all.join("\n"));
    return all[0];
  };
  it("a finisher with no comboPoints condition: add one", () => {
    assert.ok(
      only(
        rotation(rule("eviscerate", energy(FINISHER)), rule("sinister-strike")),
      ).endsWith(
        ` Add a comboPoints condition, such as { "type": "comboPoints", "op": ">=", "value": ${FINISHER} }.`,
      ),
    );
  });
  it("a finisher whose comboPoints condition holds at 0: change it", () => {
    const message = only(
      rotation(
        rule(
          "eviscerate",
          { type: "comboPoints", op: ">=", value: 0 },
          energy(FINISHER),
        ),
        rule("sinister-strike"),
      ),
    );
    assert.ok(
      message.endsWith(
        " so it holds back every rule below it. Change its comboPoints condition to need at least 1 combo point.",
      ),
      message,
    );
    assert.ok(!message.includes("Add a comboPoints condition"), message);
  });
  it("an on-GCD rule with no conditions: give it some or move it", () => {
    assert.ok(
      only(
        rotation(rule("sinister-strike"), rule("backstab", energy(FINISHER))),
      ).endsWith(
        " These rules below it are never cast: Backstab (backstab). Give it conditions or move it below them.",
      ),
    );
  });
  it("an on-GCD rule whose conditions always hold: change them", () => {
    const message = only(
      rotation(
        rule("sinister-strike", { type: "fightTime", op: ">=", value: 0 }),
        rule("backstab", energy(FINISHER)),
      ),
    );
    assert.ok(
      message.endsWith(
        " These rules below it are never cast: Backstab (backstab). Change its conditions so they are sometimes false.",
      ),
      message,
    );
    assert.ok(!message.includes("Give it conditions"), message);
  });
  it("a cooldown with no cooldownReady keeps its advice", () => {
    assert.ok(
      only(
        rotation(
          rule("ghostly-strike", unlocked("ghostly-strike"), energy(FINISHER)),
          rule("sinister-strike"),
        ),
      ).endsWith(
        ' Add { "type": "cooldownReady", "ability": "ghostly-strike" } to its conditions.',
      ),
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
  it("warns, at the rule's conditions, naming the ability", () => {
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    assert.deepEqual(rotationWarnings(trap), [
      {
        path: "rules[0].conditions",
        message: finisherText("rules[0]", "Eviscerate (eviscerate)"),
      },
      {
        path: "rules[0]",
        message: starvesText(
          "rules[0]",
          "Eviscerate (eviscerate)",
          "Sinister Strike (sinister-strike)",
        ),
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
        finisherText("rules[0]", `${label} (${id})`),
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
          rotation(
            rule("eviscerate", condition),
            rule("premeditation", unlocked("premeditation")),
          ),
        ),
        [
          finisherText(
            "rules[0]",
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

  it("a comboPoints resource condition is not read as one (only the comboPoints type is)", () => {
    const resource = {
      type: "resource",
      resource: "comboPoints",
      op: ">=",
      value: FINISHER,
    };
    assert.equal(
      validateRotation(rotation(rule("eviscerate", resource))).length,
      0,
    );
    assert.deepEqual(messages(rotation(rule("eviscerate", resource))), [
      finisherText("rules[0]", "Eviscerate (eviscerate)"),
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
        path: "rules[0].conditions",
        message: cooldownText(
          "rules[0]",
          "Ghostly Strike (ghostly-strike)",
          "ghostly-strike",
        ),
      },
    ]);
  });

  it("warns for each on-GCD ability with a cooldown, guarded or not by talent", () => {
    for (const [id, label] of [
      ["adrenaline-rush", "Adrenaline Rush"],
      ["blade-flurry", "Blade Flurry"],
    ]) {
      const trap = rotation(rule(id, unlocked(id)), rule("sinister-strike"));
      assert.deepEqual(messages(trap), [
        cooldownText("rules[0]", `${label} (${id})`, id),
      ]);
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
      cooldownText("rules[0]", "Blade Flurry (blade-flurry)", "blade-flurry"),
    ]);
  });

  it("an off-GCD cooldown is never warned for: it is passed over, not pooled for", () => {
    const offGcd = rotation(
      rule("premeditation", unlocked("premeditation")),
      rule("sinister-strike"),
    );
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
  it("warns at the rule, listing each on-GCD ability below it once", () => {
    const trap = rotation(
      rule("sinister-strike"),
      rule("eviscerate", enoughPoints),
      rule("premeditation", unlocked("premeditation")),
      rule("backstab", energy(FINISHER)),
      rule("eviscerate", enoughPoints, energy(FINISHER)),
    );
    assert.deepEqual(rotationWarnings(trap), [
      {
        path: "rules[0]",
        message: starvesText(
          "rules[0]",
          "Sinister Strike (sinister-strike)",
          "Eviscerate (eviscerate), Backstab (backstab)",
        ),
      },
    ]);
  });

  it("the last on-GCD rule may have no conditions", () => {
    const builderLast = rotation(
      rule("eviscerate", enoughPoints),
      rule("sinister-strike"),
      rule("premeditation", unlocked("premeditation")),
    );
    assert.deepEqual(messages(builderLast), []);
  });

  it("an unconditional off-GCD rule starves nothing", () => {
    const offGcd = rotation(
      rule("premeditation", unlocked("premeditation")),
      rule("sinister-strike"),
    );
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
            "rules[0]",
            "Sinister Strike (sinister-strike)",
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
      finisherText("rules[0]", "fake-strike"),
      cooldownText("rules[0]", "fake-strike", "fake-strike"),
      starvesText(
        "rules[0]",
        "fake-strike",
        "Sinister Strike (sinister-strike)",
      ),
    ]);
  });

  it("an ability the context does not list as on-GCD never pools, so never warns", () => {
    const trap = rotation(rule("fake-strike"), rule("sinister-strike"));
    assert.deepEqual(
      messages(trap, { ...fakeContext, onGcd: ["sinister-strike"] }),
      [finisherText("rules[0]", "fake-strike")],
    );
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
    assert.equal(rotationWarnings(trap, asSets).length, 3);
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
        [null, "null"],
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
    const trap = rotation(rule("eviscerate"), rule("sinister-strike"));
    const result = importRotation(exportRotation(trap));
    assert.equal(result.ok, true);
    assert.deepEqual(result.rotation, trap);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, rotationWarnings(trap));
    assert.equal(result.warnings.length, 2);
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
