import { ROTATION_PRESETS } from "../data/rotation-presets.js";

// #328: the Combat daggers preset. Its rotation, reference build, poisons
// and constants row are data (data/rotation-presets.js,
// data/preset-reference-builds.js, data/constants.js) and its summary is in
// docs/rotation.md, which wait on Scout's approval. Until they land, the
// tests that need the preset are skipped (WAITING) and the lists that name
// every preset leave it out (withDaggers), so the suite is green either
// way. Once they land, LANDED is true and every #328 test runs.
export const COMBAT_DAGGERS = "combat-daggers";
export const LANDED = ROTATION_PRESETS.some(({ id }) => id === COMBAT_DAGGERS);
export const WAITING = LANDED
  ? false
  : "#328: waits on the Combat daggers data/ entries (Scout's approval)";
// `list` with `extra` added once the preset has landed.
export const withDaggers = (list, ...extra) =>
  LANDED ? [...list, ...extra] : list;
