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
const BY_ID = new Map(ROTATION_PRESETS.map((preset) => [preset.id, preset]));
if (BY_ID.size !== ROTATION_PRESETS.length) {
  throw new RangeError("Two presets share an id.");
}
for (const preset of ROTATION_PRESETS) {
  assertValidRotation(preset.rotation);
}

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
