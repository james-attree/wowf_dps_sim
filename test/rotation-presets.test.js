import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PENDING_SHANK_RULE,
  ROTATION_PRESETS,
} from "../data/rotation-presets.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { runFight } from "../js/fight.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { castableAbilities } from "../js/rotation-edit.js";
import {
  indexPresets,
  listPresets,
  loadPreset,
  presetRotation,
} from "../js/rotation-presets.js";
import {
  assertValidRotation,
  validateRotation,
} from "../js/rotation-validator.js";
import { normalizeConfig } from "../js/sim-config.js";

describe("the preset registry (TR-03 / #333)", () => {
  it("lists only the temporary Combat swords preset", () => {
    assert.deepEqual(
      ROTATION_PRESETS.map((p) => p.id),
      ["combat-swords-temp"],
    );
    assert.deepEqual(
      listPresets().map((p) => p.id),
      ["combat-swords-temp"],
    );
  });

  it("is frozen all the way down (#155)", () => {
    assert.ok(Object.isFrozen(ROTATION_PRESETS));
    assert.throws(() => ROTATION_PRESETS.push({ id: "x" }), TypeError);
  });

  it("pins the pending Shank rule for TR-04 / #337 (not in the live rotation)", () => {
    assert.deepEqual(PENDING_SHANK_RULE, {
      action: "shank",
      conditions: [
        { type: "cooldownReady", ability: "shank" },
        { type: "resource", resource: "energy", op: "<", value: 50 },
      ],
    });
    assert.ok(
      !presetRotation("combat-swords-temp").rules.some(
        (r) => r.action === "shank",
      ),
    );
  });
});

describe("indexPresets", () => {
  it("indexes an empty list", () => {
    assert.deepEqual(indexPresets([]), new Map());
  });

  it("indexes a list by id", () => {
    const one = {
      id: "example",
      name: "Example",
      description: "One rule.",
      rotation: {
        schemaVersion: 1,
        name: "Example",
        rules: [{ action: "sinister-strike", conditions: [] }],
      },
    };
    const map = indexPresets([one]);
    assert.equal(map.get("example"), one);
  });

  it("refuses two presets with one id", () => {
    const one = {
      id: "example",
      name: "Example",
      description: "One rule.",
      rotation: {
        schemaVersion: 1,
        name: "Example",
        rules: [{ action: "sinister-strike", conditions: [] }],
      },
    };
    assert.throws(() => indexPresets([one, { ...one }]), /share an id/);
  });
});

describe("the preset API", () => {
  it("loads combat-swords-temp and rejects unknown ids", () => {
    const rotation = presetRotation("combat-swords-temp");
    assert.equal(rotation.name, "Combat swords (temporary)");
    assert.equal(loadPreset("combat-swords-temp").rotation.name, rotation.name);
    assert.throws(
      () => presetRotation("combat-swords"),
      (error) =>
        error instanceof RangeError &&
        /not a rotation preset/.test(error.message) &&
        /combat-swords-temp/.test(error.message),
    );
    assert.throws(() => loadPreset("nope"), RangeError);
  });
});

describe("Shank stays gated until TR-04 / #337 (Kira P1 / M14)", () => {
  it("is not in ABILITY_DEFINITIONS, so the builder cannot offer it", () => {
    assert.equal(
      ABILITY_DEFINITIONS.find((definition) => definition.id === "shank"),
      undefined,
    );
    assert.ok(!castableAbilities().includes("shank"));
    assert.ok(!castableAbilities("orc").includes("shank"));
  });

  it("the validator refuses a Shank rule (notCastYet)", () => {
    const rotation = {
      schemaVersion: 1,
      name: "Pending Shank",
      rules: [PENDING_SHANK_RULE],
    };
    const errors = validateRotation(rotation);
    assert.ok(errors.some((error) => error.code === "notCastYet"));
    assert.ok(
      errors.some(
        (error) =>
          error.path === "rules[0].action" && /shank/.test(error.message),
      ),
    );
    assert.throws(
      () => assertValidRotation(rotation),
      (error) =>
        error instanceof RangeError &&
        /Bad rotation/.test(error.message) &&
        /shank/.test(error.message),
    );
  });

  it("a page-default fight never casts Shank", () => {
    const result = runFight({
      config: normalizeConfig(pageDefaultConfig()),
      seed: 142,
      duration: 60,
    });
    assert.equal(result.abilities.Shank, undefined);
    assert.ok(
      !Object.keys(result.abilities).some((name) => /shank/i.test(name)),
    );
  });
});

describe("indexPresets runs assertValidRotation (Kira M10 / N1)", () => {
  it("refuses a preset whose rotation casts Shank", () => {
    assert.throws(
      () =>
        indexPresets([
          {
            id: "with-shank",
            name: "With Shank",
            description: "Injected pending rule.",
            rotation: {
              schemaVersion: 1,
              name: "With Shank",
              rules: [PENDING_SHANK_RULE],
            },
          },
        ]),
      (error) =>
        error instanceof RangeError &&
        /Bad rotation/.test(error.message) &&
        /shank/.test(error.message),
    );
  });
});
