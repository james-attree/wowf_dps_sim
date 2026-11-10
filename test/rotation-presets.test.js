import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMBAT_SWORDS_SHANK_RULE,
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
  it("lists the temporary Combat swords preset, then Combat daggers (#340)", () => {
    assert.deepEqual(
      ROTATION_PRESETS.map((p) => p.id),
      [
        "combat-swords-temp",
        "combat-daggers",
        "assassination-daggers",
        "subtlety-daggers",
      ],
    );
    assert.deepEqual(
      listPresets().map((p) => p.id),
      [
        "combat-swords-temp",
        "combat-daggers",
        "assassination-daggers",
        "subtlety-daggers",
      ],
    );
  });

  it("is frozen all the way down (#155)", () => {
    assert.ok(Object.isFrozen(ROTATION_PRESETS));
    assert.throws(() => ROTATION_PRESETS.push({ id: "x" }), TypeError);
  });

  it("includes the live Shank rule (energy < 50) from TR-04 / #337", () => {
    assert.deepEqual(COMBAT_SWORDS_SHANK_RULE, {
      action: "shank",
      conditions: [
        { type: "cooldownReady", ability: "shank" },
        { type: "resource", resource: "energy", op: "<", value: 50 },
      ],
    });
    assert.ok(
      presetRotation("combat-swords-temp").rules.some(
        (r) => r.action === "shank",
      ),
    );
  });

  it("Combat daggers is the swords rotation with Backstab in place of Sinister Strike (#340)", () => {
    const swords = presetRotation("combat-swords-temp").rules;
    const daggers = presetRotation("combat-daggers").rules;
    assert.equal(daggers.length, swords.length);
    daggers.forEach((rule, index) => {
      const expected =
        swords[index].action === "sinister-strike"
          ? { ...swords[index], action: "backstab" }
          : swords[index];
      assert.deepEqual(rule, expected);
    });
    assert.equal(
      daggers.filter((rule) => rule.action === "sinister-strike").length,
      0,
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

describe("Shank is live in the Combat swords preset (TR-04 / #337)", () => {
  it("is in ABILITY_DEFINITIONS and the castable list", () => {
    assert.ok(
      ABILITY_DEFINITIONS.find((definition) => definition.id === "shank"),
    );
    assert.ok(castableAbilities().includes("shank"));
    assert.ok(castableAbilities("orc").includes("shank"));
  });

  it("the validator accepts the Shank rule", () => {
    const rotation = {
      schemaVersion: 1,
      name: "Live Shank",
      rules: [COMBAT_SWORDS_SHANK_RULE],
    };
    assert.deepEqual(validateRotation(rotation), []);
    assert.doesNotThrow(() => assertValidRotation(rotation));
  });

  it("a page-default fight casts Shank", () => {
    const result = runFight({
      config: normalizeConfig(pageDefaultConfig()),
      seed: 142,
      duration: 60,
    });
    assert.ok(
      Object.keys(result.abilities).some((name) => /shank/i.test(name)),
      `abilities: ${Object.keys(result.abilities).join(",")}`,
    );
  });
});

describe("indexPresets runs assertValidRotation (Kira M10 / N1)", () => {
  it("accepts a preset whose rotation casts Shank now that it is live", () => {
    const map = indexPresets([
      {
        id: "with-shank",
        name: "With Shank",
        description: "Live Shank rule.",
        rotation: {
          schemaVersion: 1,
          name: "With Shank",
          rules: [COMBAT_SWORDS_SHANK_RULE],
        },
      },
    ]);
    assert.equal(map.get("with-shank").rotation.rules[0].action, "shank");
  });
});
