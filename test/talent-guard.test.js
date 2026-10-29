import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { abilityCatalogue } from "../js/abilities.js";
import { runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { importRotation } from "../js/rotation-io.js";
import { rotationContext, validateRotation } from "../js/rotation-validator.js";
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

// The exact error for rules[index] casting `id` with no guard.
function guardError(index, id, types) {
  const wanted = types.map((type) => guardText(type, id)).join(" or ");
  return {
    path: `rules[${index}].conditions`,
    message: `rules[${index}] casts ${id} without the condition ${wanted}: a talent grants ${id}, so its rule must hold only when the build has the talent.`,
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
    // Today: Cold Blood, Blade Flurry and Adrenaline Rush (the issue's list).
    assert.deepEqual(FROM_DATA, [
      "adrenaline-rush",
      "blade-flurry",
      "cold-blood",
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
