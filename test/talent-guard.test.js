import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { abilityCatalogue } from "../js/abilities.js";
import { runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { importRotation } from "../js/rotation-io.js";
import {
  abilityLabel,
  rotationContext,
  validateRotation,
} from "../js/rotation-validator.js";
import { talentGrantedAbilities } from "../js/talent-build.js";
import { GOLDEN_CASES } from "../scripts/golden-update.mjs";

// Issue #188: validator rule 5, generalised. A rule that casts an ability a
// talent grants needs a guard on that ability, and which abilities need one is
// read from the data (context.talentGrantedAbilities), not from a list in the
// validator. Cold Blood takes only abilityGranted; until #199 the others take
// abilityGranted or abilityUnlocked.

const rule = (action, ...conditions) => ({ action, conditions });
const rotation = (...rules) => ({ schemaVersion: 1, name: "Test", rules });
const granted = (ability) => ({ type: "abilityGranted", ability });
const unlocked = (ability) => ({ type: "abilityUnlocked", ability });
const five = { type: "comboPoints", op: ">=", value: 5 };
const guardText = (type, id) => `{ "type": "${type}", "ability": "${id}" }`;

// How the message writes each ability: the display name, then the id; an id
// with no display name (the fake ability below) is written alone. Spelled out
// here, not read from the catalogue, so a change to the label shows.
const LABELS = {
  "cold-blood": "Cold Blood (cold-blood)",
  "blade-flurry": "Blade Flurry (blade-flurry)",
  "adrenaline-rush": "Adrenaline Rush (adrenaline-rush)",
  "ghostly-strike": "Ghostly Strike (ghostly-strike)",
  hemorrhage: "Hemorrhage (hemorrhage)",
  premeditation: "Premeditation (premeditation)",
};
const labelOf = (id) => LABELS[id] ?? id;

// The exact error for rules[index] casting `id` with no guard.
function guardError(index, id, types) {
  const wanted = types.map((type) => guardText(type, id)).join(" or ");
  return {
    path: `rules[${index}].conditions`,
    message: `rules[${index}]: ${labelOf(id)} comes from a talent, so its rule needs a talent check. Add ${wanted} to its conditions.`,
  };
}
const STRICT = ["abilityGranted"];
const EITHER = ["abilityGranted", "abilityUnlocked"];
const typesFor = (id) => (id === "cold-blood" ? STRICT : EITHER);

// The engine's ids from the talent effects data, independently of
// js/talent-build.js.
const FROM_DATA = Object.values(TALENT_EFFECTS)
  .map((entry) => entry.ability)
  .filter((id) => id !== undefined)
  .sort();

describe("talent guard (#188): which abilities it covers", () => {
  it("is every ability the talent effects data grants, by default", () => {
    assert.deepEqual([...talentGrantedAbilities].sort(), FROM_DATA);
    assert.deepEqual(
      [...rotationContext().talentGrantedAbilities].sort(),
      FROM_DATA,
    );
    // Today: Cold Blood, Blade Flurry and Adrenaline Rush (#188's list), and
    // Ghostly Strike, Hemorrhage and Premeditation (#207).
    assert.deepEqual(FROM_DATA, [
      "adrenaline-rush",
      "blade-flurry",
      "cold-blood",
      "ghostly-strike",
      "hemorrhage",
      "premeditation",
    ]);
    assert.ok(Object.isFrozen(rotationContext().talentGrantedAbilities));
  });

  it("refuses an unguarded rule for every one of them, naming the rule path and the condition to add", () => {
    for (const id of FROM_DATA) {
      assert.deepEqual(
        validateRotation(rotation(rule("sinister-strike"), rule(id, five))),
        [guardError(1, id, typesFor(id))],
        id,
      );
    }
  });

  it("leaves every other castable ability alone", () => {
    for (const { id } of ABILITY_DEFINITIONS) {
      if (FROM_DATA.includes(id)) {
        continue;
      }
      assert.deepEqual(validateRotation(rotation(rule(id))), [], id);
    }
  });
});

describe("talent guard (#188): the message (#203)", () => {
  it("is the shared template, with the display name and the id", () => {
    assert.equal(
      validateRotation(rotation(rule("cold-blood")))[0].message,
      'rules[0]: Cold Blood (cold-blood) comes from a talent, so its rule needs a talent check. Add { "type": "abilityGranted", "ability": "cold-blood" } to its conditions.',
    );
    assert.equal(
      validateRotation(rotation(rule("blade-flurry")))[0].message,
      'rules[0]: Blade Flurry (blade-flurry) comes from a talent, so its rule needs a talent check. Add { "type": "abilityGranted", "ability": "blade-flurry" } or { "type": "abilityUnlocked", "ability": "blade-flurry" } to its conditions.',
    );
  });

  it("abilityLabel writes the catalogue's name and the id, or the id alone", () => {
    for (const { id } of ABILITY_DEFINITIONS) {
      const { name } = abilityCatalogue.get(id);
      assert.equal(abilityLabel(id), `${name} (${id})`, id);
    }
    assert.equal(abilityLabel("fake-strike"), "fake-strike");
    assert.equal(abilityLabel("no-such"), "no-such");
  });
});

describe("talent guard (#188): which conditions count", () => {
  it("Cold Blood stays strict: only abilityGranted", () => {
    assert.deepEqual(
      validateRotation(rotation(rule("cold-blood", granted("cold-blood")))),
      [],
    );
    assert.deepEqual(
      validateRotation(rotation(rule("cold-blood", unlocked("cold-blood")))),
      [guardError(0, "cold-blood", STRICT)],
    );
  });

  it("Blade Flurry and Adrenaline Rush take abilityGranted or abilityUnlocked until #199", () => {
    for (const id of ["blade-flurry", "adrenaline-rush"]) {
      for (const guard of [granted(id), unlocked(id)]) {
        assert.deepEqual(
          validateRotation(rotation(rule(id, five, guard))),
          [],
          `${id} ${guard.type}`,
        );
      }
    }
  });

  it("needs the guard on the ability the rule casts, and no other condition counts", () => {
    for (const conditions of [
      [],
      [five],
      [{ type: "cooldownReady", ability: "blade-flurry" }],
      [unlocked("adrenaline-rush")],
      [granted("cold-blood")],
      [{ type: "auraActive", aura: "slice-and-dice" }],
    ]) {
      assert.deepEqual(
        validateRotation(rotation(rule("blade-flurry", ...conditions))),
        [guardError(0, "blade-flurry", EITHER)],
        JSON.stringify(conditions),
      );
    }
  });

  it("reports one error per unguarded rule, in rule order, after that rule's own condition errors", () => {
    const errors = validateRotation(
      rotation(
        rule("adrenaline-rush", { type: "comboPoints", op: ">=", value: 9 }),
        rule("blade-flurry", unlocked("blade-flurry")),
        rule("blade-flurry"),
      ),
    );
    assert.deepEqual(
      errors.map((error) => error.path),
      [
        "rules[0].conditions[0].value",
        "rules[0].conditions",
        "rules[2].conditions",
      ],
    );
  });
});

describe("talent guard (#188): read from the data, not a list in the validator", () => {
  // A fake ability, made castable through the context and granted by a fake
  // talent: the validator has never heard of it.
  const FAKE = "fake-strike";
  const fakeContext = (talentGrantedAbilities) => ({
    abilities: [...abilityCatalogue.abilities.map((a) => a.id), FAKE],
    castable: [...ABILITY_DEFINITIONS.map((d) => d.id), FAKE],
    talentGrantedAbilities,
  });

  it("guards a fake talent-granted ability given in the context", () => {
    for (const given of [[FAKE], new Set([FAKE])]) {
      const context = fakeContext(given);
      assert.deepEqual(validateRotation(rotation(rule(FAKE, five)), context), [
        guardError(0, FAKE, EITHER),
      ]);
      assert.deepEqual(
        validateRotation(rotation(rule(FAKE, unlocked(FAKE))), context),
        [],
      );
      assert.deepEqual(
        validateRotation(rotation(rule(FAKE, granted(FAKE))), context),
        [],
      );
    }
  });

  it("writes the fake ability, which has no display name, as its id alone", () => {
    assert.equal(
      validateRotation(rotation(rule(FAKE)), fakeContext([FAKE]))[0].message,
      'rules[0]: fake-strike comes from a talent, so its rule needs a talent check. Add { "type": "abilityGranted", "ability": "fake-strike" } or { "type": "abilityUnlocked", "ability": "fake-strike" } to its conditions.',
    );
  });

  it("does not guard the fake ability when no talent grants it", () => {
    assert.deepEqual(
      validateRotation(rotation(rule(FAKE, five)), fakeContext(undefined)),
      [],
    );
    assert.deepEqual(
      validateRotation(rotation(rule(FAKE, five)), fakeContext([])),
      [],
    );
  });

  it("guards only what the context lists: an empty list guards nothing", () => {
    for (const id of FROM_DATA) {
      assert.deepEqual(
        validateRotation(rotation(rule(id)), { talentGrantedAbilities: [] }),
        [],
        id,
      );
    }
  });

  it("refuses a talentGrantedAbilities that is not an array or a Set, saying what it was (#207)", () => {
    const message = (shown) =>
      `rotationContext: talentGrantedAbilities must be an array or a Set of ability ids, not ${shown}.`;
    const cases = [
      ["cold-blood", 'the string "cold-blood"'],
      [null, "null"],
      [{}, "an object"],
      [{ 0: "cold-blood", length: 1 }, "an object"],
      [new Map([["cold-blood", true]]), "an object"],
      [7, "a number"],
      [true, "a boolean"],
    ];
    for (const [given, shown] of cases) {
      for (const call of [
        () => rotationContext({ talentGrantedAbilities: given }),
        () =>
          validateRotation(rotation(rule("cold-blood")), {
            talentGrantedAbilities: given,
          }),
      ]) {
        assert.throws(
          call,
          (error) =>
            error instanceof TypeError && error.message === message(shown),
          String(shown),
        );
      }
    }
  });

  it("refuses a list or Set holding something that is not an id string (#207)", () => {
    const message = (shown) =>
      `rotationContext: talentGrantedAbilities must hold ability id strings, not ${shown}.`;
    for (const [given, shown] of [
      [["cold-blood", null], "null"],
      [new Set([1]), "a number"],
      [[["cold-blood"]], "an object"],
      [["cold-blood", undefined], "undefined"],
    ]) {
      assert.throws(
        () => rotationContext({ talentGrantedAbilities: given }),
        (error) =>
          error instanceof TypeError && error.message === message(shown),
        shown,
      );
    }
  });

  it("takes an array or a Set, an empty one too, as a frozen array (#207)", () => {
    for (const given of [["cold-blood", FAKE], new Set(["cold-blood", FAKE])]) {
      const { talentGrantedAbilities: list } = rotationContext({
        talentGrantedAbilities: given,
      });
      assert.ok(Array.isArray(list));
      assert.ok(Object.isFrozen(list));
      assert.deepEqual(list, ["cold-blood", FAKE]);
    }
    for (const given of [[], new Set()]) {
      assert.deepEqual(
        rotationContext({ talentGrantedAbilities: given })
          .talentGrantedAbilities,
        [],
      );
    }
    // Left out, it is the engine's own.
    assert.deepEqual(
      [...rotationContext({}).talentGrantedAbilities].sort(),
      FROM_DATA,
    );
  });

  it("copies a given list, so changing it later changes nothing", () => {
    const given = [FAKE];
    const context = rotationContext(fakeContext(given));
    given.length = 0;
    assert.deepEqual(context.talentGrantedAbilities, [FAKE]);
    assert.ok(Object.isFrozen(context.talentGrantedAbilities));
  });
});

describe("talent guard (#188): nothing that ships moves", () => {
  it("the default rotation, every preset and every golden rotation validate unchanged", () => {
    assert.deepEqual(validateRotation(defaultRotation()), []);
    assert.ok(ROTATION_PRESETS.length > 0);
    for (const preset of ROTATION_PRESETS) {
      assert.deepEqual(validateRotation(preset.rotation), [], preset.id);
    }
    let checked = 0;
    for (const golden of GOLDEN_CASES) {
      if (golden.script !== undefined) {
        continue;
      }
      const used = golden.config?.rotation ?? defaultRotation();
      assert.deepEqual(validateRotation(used), [], golden.name);
      checked += 1;
    }
    assert.equal(checked, GOLDEN_CASES.length - 1);
  });

  it("an unguarded talent rule is refused by a fight and by an import, with the same message", () => {
    const bad = rotation(rule("blade-flurry"), rule("sinister-strike"));
    const { message } = guardError(0, "blade-flurry", EITHER);
    assert.throws(
      () => runFight({ seed: 1, duration: 5, config: { rotation: bad } }),
      (error) => error instanceof RangeError && error.message.includes(message),
    );
    const imported = importRotation(JSON.stringify(bad));
    assert.equal(imported.ok, false);
    assert.deepEqual(imported.errors, [guardError(0, "blade-flurry", EITHER)]);
  });
});
