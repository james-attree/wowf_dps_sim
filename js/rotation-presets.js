import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { assertValidRotation } from "./rotation-validator.js";
import { summarizeRotation } from "./rotation-summary.js";

// The preset rotations a page can offer (R5, issue #142). The presets are data
// (data/rotation-presets.js); this is the small API over them, with no DOM, so
// a page, a worker or a test calls it the same way.
//
//   listPresets()            [{ id, name, description, summary }], in the
//                            registry's order. `summary` is the rule list as
//                            text (js/rotation-summary.js), for the preset
//                            list's detail.
//   presetRotation(id)       a new copy of the preset's rotation. An id that is
//                            not a preset is a RangeError that lists the ids.
//   loadPreset(id, config)   a copy of `config` (a SimConfig, or nothing) with
//                            its `rotation` set to the preset's. The input is
//                            not changed. runFight, createFight and
//                            normalizeConfig take the result like any config.
//
// The default fight keeps the placeholder rotation (js/rotation-default.js)
// unless a preset is loaded.
//
// Every preset passes the validator (R4) when this module is imported, so a
// bad preset in the data never reaches a fight. test/rotation-presets.test.js
// checks them one by one.
// Index a preset list by id. A repeated id, or a rotation the validator
// refuses, is an error, so a bad preset in the data never reaches a fight.
export function indexPresets(presets) {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  if (byId.size !== presets.length) {
    throw new RangeError("Two presets share an id.");
  }
  for (const preset of presets) {
    assertValidRotation(preset.rotation);
  }
  return byId;
}

const BY_ID = indexPresets(ROTATION_PRESETS);

const copy = (value) => JSON.parse(JSON.stringify(value));

export function listPresets() {
  return ROTATION_PRESETS.map(({ id, name, description, rotation }) => ({
    id,
    name,
    description,
    summary: summarizeRotation(rotation),
  }));
}

export function presetRotation(id) {
  const preset = BY_ID.get(id);
  if (preset === undefined) {
    throw new RangeError(
      `${JSON.stringify(id)} is not a rotation preset. Presets: ${[...BY_ID.keys()].join(", ")}.`,
    );
  }
  return copy(preset.rotation);
}

export function loadPreset(id, config = {}) {
  return { ...config, rotation: presetRotation(id) };
}
