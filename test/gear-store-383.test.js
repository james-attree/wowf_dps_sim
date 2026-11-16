import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSavedSetup } from "../js/saved-setup.js";
import {
  listGearBuilds,
  loadGearBuild,
  removeGearBuild,
  renameGearBuild,
  saveGearBuild,
} from "../js/gear-store.js";
import { k } from "../data/constants.js";

const slots = { mainHand: { item: 19324, enchant: 1900, suffix: null } };

function memory({ fail } = {}) {
  const map = new Map();
  return {
    getItem(key) {
      if (fail === "read") throw new Error("refused");
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (fail === "write") throw new Error("full");
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

describe("named gear builds (#383)", () => {
  it("saves a build", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    assert.equal(saved.ok, true);
    assert.equal(saved.build.name, "P1");
    assert.deepEqual(saved.build.slots, slots);
    assert.equal(typeof saved.build.id, "string");
  });

  it("lists builds", () => {
    const storage = memory();
    saveGearBuild({ name: "P1", slots }, storage);
    assert.deepEqual(
      listGearBuilds(storage).map((build) => build.name),
      ["P1"],
    );
  });

  it("loads a build", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    assert.deepEqual(loadGearBuild(saved.build.id, storage).slots, slots);
    assert.equal(loadGearBuild("missing", storage), null);
  });

  it("renames a build", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    const renamed = renameGearBuild(saved.build.id, "Raid", storage);
    assert.equal(renamed.ok, true);
    assert.equal(renamed.build.name, "Raid");
    assert.equal(loadGearBuild(saved.build.id, storage).name, "Raid");
  });

  it("removes a build", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    assert.deepEqual(removeGearBuild(saved.build.id, storage), { ok: true });
    assert.deepEqual(listGearBuilds(storage), []);
  });

  it("a missing store does not throw and does not report a save", () => {
    assert.deepEqual(listGearBuilds(null), []);
    assert.deepEqual(saveGearBuild({ name: "P1", slots }, null), {
      ok: false,
      reason: "storage",
    });
    assert.deepEqual(renameGearBuild("gear-1", "Raid", null), {
      ok: false,
      reason: "storage",
    });
    assert.deepEqual(removeGearBuild("gear-1", null), {
      ok: false,
      reason: "storage",
    });
  });

  it("a throwing store does not throw and does not report a save", () => {
    const storage = memory({ fail: "write" });
    assert.doesNotThrow(() => listGearBuilds(memory({ fail: "read" })));
    assert.deepEqual(saveGearBuild({ name: "P1", slots }, storage), {
      ok: false,
      reason: "storage",
    });
    assert.deepEqual(listGearBuilds(storage), []);
  });

  it("a full store does not report a save, rename or remove", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    storage.setItem = () => {
      throw new Error("full");
    };
    assert.deepEqual(saveGearBuild({ name: "Next", slots }, storage), {
      ok: false,
      reason: "storage",
    });
    assert.deepEqual(renameGearBuild(saved.build.id, "Raid", storage), {
      ok: false,
      reason: "storage",
    });
    assert.deepEqual(removeGearBuild(saved.build.id, storage), {
      ok: false,
      reason: "storage",
    });
    assert.equal(loadGearBuild(saved.build.id, storage).name, "P1");
  });

  it("reset to defaults leaves the gear key", () => {
    const storage = memory();
    saveGearBuild({ name: "P1", slots }, storage);
    const saving = createSavedSetup({
      store: {
        get: () => ({ config: {}, run: {} }),
        subscribe: () => () => {},
      },
      storage,
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    saving.clear();
    saving.stop();
    assert.equal(listGearBuilds(storage).length, 1);
    assert.equal(storage.getItem(k("gear.storageKey")) !== null, true);
  });
});
