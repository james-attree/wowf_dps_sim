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
    assert.equal(saved.name, "P1");
    assert.deepEqual(saved.slots, slots);
    assert.equal(typeof saved.id, "string");
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
    assert.deepEqual(loadGearBuild(saved.id, storage).slots, slots);
    assert.equal(loadGearBuild("missing", storage), null);
  });

  it("renames a build", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    const renamed = renameGearBuild(saved.id, "Raid", storage);
    assert.equal(renamed.name, "Raid");
    assert.equal(loadGearBuild(saved.id, storage).name, "Raid");
  });

  it("removes a build", () => {
    const storage = memory();
    const saved = saveGearBuild({ name: "P1", slots }, storage);
    assert.equal(removeGearBuild(saved.id, storage), true);
    assert.deepEqual(listGearBuilds(storage), []);
  });

  it("missing, throwing or full storage does not throw", () => {
    assert.deepEqual(listGearBuilds(null), []);
    assert.equal(saveGearBuild({ name: "P1", slots }, null).name, "P1");
    assert.deepEqual(listGearBuilds(null), []);
    assert.doesNotThrow(() => listGearBuilds(memory({ fail: "read" })));
    assert.doesNotThrow(() =>
      saveGearBuild({ name: "P1", slots }, memory({ fail: "write" })),
    );
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
