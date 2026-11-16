import { k } from "../data/constants.js";

// Named gear builds, separate from the one saved setup (#296) and from
// presets. Items only: race and level stay on the character. Reset to
// defaults clears wowf_dps_sim.setup and leaves this key. Missing, refused
// or full storage fails silently. PR6 and PR7 (Bonnie) consume this API.

function storageOf(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function blank() {
  return { schema: k("gear.schema"), builds: [] };
}

function readDoc(storage) {
  const store = storageOf(storage);
  if (store === null) return blank();
  try {
    const text = store.getItem(k("gear.storageKey"));
    if (text == null) return blank();
    const parsed = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schema !== k("gear.schema") ||
      !Array.isArray(parsed.builds)
    ) {
      return blank();
    }
    return parsed;
  } catch {
    return blank();
  }
}

function writeDoc(storage, doc) {
  const store = storageOf(storage);
  if (store === null) return false;
  try {
    store.setItem(k("gear.storageKey"), JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

function copyBuild(build) {
  return {
    id: build.id,
    name: build.name,
    slots: build.slots,
    updated: build.updated,
  };
}

export function listGearBuilds(storage) {
  return readDoc(storage).builds.map(copyBuild);
}

export function loadGearBuild(id, storage) {
  const found = readDoc(storage).builds.find((build) => build.id === id);
  return found === undefined ? null : copyBuild(found);
}

export function saveGearBuild(build, storage, now = 0) {
  if (!build || typeof build.name !== "string" || build.slots == null) {
    return null;
  }
  const doc = readDoc(storage);
  const id =
    typeof build.id === "string" && build.id !== "" ? build.id : newId(doc);
  const next = {
    id,
    name: build.name,
    slots: build.slots,
    updated: build.updated ?? now,
  };
  const index = doc.builds.findIndex((item) => item.id === id);
  if (index >= 0) doc.builds[index] = next;
  else doc.builds.push(next);
  writeDoc(storage, doc);
  return copyBuild(next);
}

export function renameGearBuild(id, name, storage, now = 0) {
  const doc = readDoc(storage);
  const found = doc.builds.find((build) => build.id === id);
  if (!found || typeof name !== "string") return null;
  found.name = name;
  found.updated = now;
  writeDoc(storage, doc);
  return copyBuild(found);
}

export function removeGearBuild(id, storage) {
  const doc = readDoc(storage);
  const next = doc.builds.filter((build) => build.id !== id);
  if (next.length === doc.builds.length) return false;
  doc.builds = next;
  writeDoc(storage, doc);
  return true;
}

function newId(doc) {
  const taken = new Set(doc.builds.map((build) => build.id));
  let n = doc.builds.length + 1;
  while (taken.has(`gear-${n}`)) n += 1;
  return `gear-${n}`;
}
