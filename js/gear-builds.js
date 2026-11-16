// Named gear-build helpers for PR7. The store does not throw and does not
// guard empty names, duplicates or rename collisions (Kira's #401 N3);
// this layer does, and it turns { ok: false, reason: "storage" } into a
// message the UI can read aloud.
// coordinator call 16 Nov (James delegated) for the empty-hand and
// level-60 run rules this module does not itself enforce.

import {
  listGearBuilds,
  loadGearBuild,
  removeGearBuild,
  renameGearBuild,
  saveGearBuild,
} from "./gear-store.js";

export const PAGE_DEFAULT_ID = "page-default";
export const PAGE_DEFAULT_NAME = "wowsims Forever P1";
export const CURRENT_DEFAULT = "Current · page default";
export const EMPTY_NAME = "Enter a name.";
export const STORAGE_REASON = "storage";

const STORAGE_SAVE =
  "The gear build could not be saved. Storage is off or full.";
const STORAGE_RENAME =
  "The gear build could not be renamed. Storage is off or full.";
const STORAGE_REMOVE =
  "The gear build could not be deleted. Storage is off or full.";

export function trimmedName(name) {
  return typeof name === "string" ? name.trim() : "";
}

export function duplicateNameMessage(name) {
  return `A gear build called “${name}” already exists.`;
}

export function nameConflict(name, builds, exceptId = null) {
  const trimmed = trimmedName(name);
  if (trimmed === "") {
    return EMPTY_NAME;
  }
  const taken = (builds ?? []).some(
    (build) => build.name === trimmed && build.id !== exceptId,
  );
  return taken ? duplicateNameMessage(trimmed) : "";
}

export function slotsEqual(left, right) {
  const a = left ?? {};
  const b = right ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const one = a[key];
    const two = b[key];
    if (one == null && two == null) {
      continue;
    }
    if (one == null || two == null) {
      return false;
    }
    if (
      one.item !== two.item ||
      one.enchant !== two.enchant ||
      one.suffix !== two.suffix
    ) {
      return false;
    }
  }
  return true;
}

function withStorageMessage(result, message) {
  if (result?.ok === false && result.reason === STORAGE_REASON) {
    return { ...result, message };
  }
  return result;
}

export function guardedSave(build, storage, now = 0) {
  const builds = listGearBuilds(storage);
  const error = nameConflict(build?.name, builds, build?.id ?? null);
  if (error) {
    return { ok: false, reason: "name", message: error };
  }
  return withStorageMessage(
    saveGearBuild({ ...build, name: trimmedName(build.name) }, storage, now),
    STORAGE_SAVE,
  );
}

export function guardedRename(id, name, storage, now = 0) {
  const builds = listGearBuilds(storage);
  const error = nameConflict(name, builds, id);
  if (error) {
    return { ok: false, reason: "name", message: error };
  }
  return withStorageMessage(
    renameGearBuild(id, trimmedName(name), storage, now),
    STORAGE_RENAME,
  );
}

export function guardedRemove(id, storage) {
  return withStorageMessage(removeGearBuild(id, storage), STORAGE_REMOVE);
}

export { listGearBuilds, loadGearBuild };
