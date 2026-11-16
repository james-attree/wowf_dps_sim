// James 15 Nov 2026, to the coordinator: 'Remove the link between weapons and talent/rotation choices.' (supersedes the 10 Nov #340 preset-sets-weapons rulings)
// A preset does not set the character sheet.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createConfigForm,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import { createPresetBuild } from "../js/preset-build.js";
import { createStore } from "../js/store.js";

describe("a preset leaves the character sheet (#297)", () => {
  it("keeps the page sheet when Combat swords is picked after Combat daggers", () => {
    const store = createStore({ config: pageDefaultConfig() });
    const form = createConfigForm(store);
    const build = createPresetBuild(store, form);
    const before = nextRunConfig(store.get()).character;
    const beforeWeapons = nextRunConfig(store.get()).weapons;
    assert.equal(
      build.pick("combat-swords-temp", "Combat swords (temporary)"),
      true,
    );
    const after = nextRunConfig(store.get()).character;
    assert.equal(after.attackPower, before.attackPower);
    assert.equal(after.critChance, before.critChance);
    assert.equal(after.attackPower, 608);
    assert.deepEqual(nextRunConfig(store.get()).weapons, beforeWeapons);
  });
});
