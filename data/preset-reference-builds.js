// The reference build each preset rotation is written for (issue #272), as
// data: the talent ranks and the two weapons. Nothing here, and nothing in
// js/preset-reference-builds.js, puts a build into a config. Loading a preset
// (js/rotation-presets.js loadPreset) sets the rotation only; a page that
// offers "use this preset's build" (#273) reads a build from here and decides
// what to change.
//
// TR-02 / #332: empty until TR-03 / #333 adds the temporary Combat swords.

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const PRESET_REFERENCE_BUILDS = deepFreeze({
  // Empty until TR-03 / #333.
});
