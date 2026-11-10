// James, 10 Nov 2026, #340: a non-dagger preset puts the sword sheet back.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  createConfigForm,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import { createPresetBuild } from "../js/preset-build.js";
import { createStore } from "../js/store.js";

const swords = () => ({
  attackPower: k("character.attackPower"),
  critChance: k("character.critChance"),
});

describe("a non-dagger preset resets the sheet (#340)", () => {
  it("Combat swords after a dagger preset is 767 attack power and 22.45% crit", () => {
    const store = createStore({ config: pageDefaultConfig() });
    const form = createConfigForm(store);
    const build = createPresetBuild(store, form);
    assert.equal(build.pick("combat-daggers", "Combat daggers"), true);
    assert.equal(
      build.pick("combat-swords-temp", "Combat swords (temporary)"),
      true,
    );
    const config = nextRunConfig(store.get());
    assert.equal(config.character.attackPower, swords().attackPower);
    assert.equal(config.character.critChance, swords().critChance);
    assert.equal(config.character.attackPower, 767);
    assert.equal(config.character.critChance, 0.2245);
  });

  it("Undo after that switch restores the dagger sheet", () => {
    const store = createStore({ config: pageDefaultConfig() });
    const form = createConfigForm(store);
    const build = createPresetBuild(store, form);
    assert.equal(
      build.pick("assassination-daggers", "Assassination daggers"),
      true,
    );
    const dagger = {
      attackPower: nextRunConfig(store.get()).character.attackPower,
      critChance: nextRunConfig(store.get()).character.critChance,
    };
    assert.equal(dagger.attackPower, k("character.dagger.attackPower"));
    assert.equal(
      build.pick("combat-swords-temp", "Combat swords (temporary)"),
      true,
    );
    assert.equal(nextRunConfig(store.get()).character.attackPower, 767);
    assert.equal(build.undo(), true);
    const restored = nextRunConfig(store.get());
    assert.equal(restored.character.attackPower, dagger.attackPower);
    assert.equal(restored.character.critChance, dagger.critChance);
  });
});
