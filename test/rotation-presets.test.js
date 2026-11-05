import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import {
  indexPresets,
  listPresets,
  loadPreset,
  presetRotation,
} from "../js/rotation-presets.js";

// TR-02 / #332: ROTATION_PRESETS is empty until TR-03 / #333 adds the
// temporary Combat swords. These tests pin the empty interim and the API
// refusals; the Combat swords behaviour returns with #333.

describe("the preset registry (#332 empty interim)", () => {
  it("has no selectable presets until #333", () => {
    assert.deepEqual(ROTATION_PRESETS, []);
    assert.deepEqual(listPresets(), []);
  });

  it("is frozen all the way down (#155)", () => {
    assert.ok(Object.isFrozen(ROTATION_PRESETS));
    assert.throws(() => ROTATION_PRESETS.push({ id: "x" }), TypeError);
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

describe("the preset API with no presets", () => {
  it("rejects every id, naming that none are listed", () => {
    assert.throws(
      () => presetRotation("combat-swords"),
      (error) =>
        error instanceof RangeError &&
        /not a rotation preset/.test(error.message) &&
        /Presets: \./.test(error.message),
    );
    assert.throws(() => loadPreset("combat-swords"), RangeError);
  });
});
