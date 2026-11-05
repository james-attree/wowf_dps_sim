import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PENDING_SHANK_RULE,
  ROTATION_PRESETS,
} from "../data/rotation-presets.js";
import {
  indexPresets,
  listPresets,
  loadPreset,
  presetRotation,
} from "../js/rotation-presets.js";

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
