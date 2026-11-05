// The preset rotations (R5, issue #142), as data: a list of
// { id, name, description, rotation }, where `rotation` is a RotationRule
// rotation (js/rotation-schema.js, docs/rotation.md). Nothing here runs
// anything. js/rotation-presets.js lists them for a page and loads one into a
// config, and checks every one against the validator when it is imported.
//
// TR-02 / #332: old presets scrapped for the 70755 rework. The temporary
// Combat swords preset lands in TR-03 / #333. Until then the start screen is
// Custom only (pageDefaultConfig).

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const ROTATION_PRESETS = deepFreeze([
  // Empty until TR-03 / #333.
]);
