// James, 10 Nov 2026, #340, option A: Combat daggers uses the existing
// character.dagger sheet (Core Hound Tooth's attack power and crit) with the
// unnamed 59-111 off hand. The rotation is unchanged.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  createConfigForm,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import { createPresetBuild } from "../js/preset-build.js";
import { referenceBuild } from "../js/rotation-presets.js";
import { createStore } from "../js/store.js";

const DAGGERS = "combat-daggers";

describe("Combat daggers character sheet (#340)", () => {
  it("uses character.dagger attack power and crit, and keeps the 59-111 off hand", () => {
    const build = referenceBuild(DAGGERS);
    assert.deepEqual(build.character, {
      attackPower: k("character.dagger.attackPower"),
      critChance: k("character.dagger.critChance"),
    });
    assert.equal(k("presetReferenceBuild.daggerCharacter"), "character.dagger");
    assert.deepEqual(build.weapons.offHand, {
      ...k("presetReferenceBuild.daggerOffHand"),
    });
    assert.deepEqual(build.weapons.mainHand, {
      min: k("weapon.dagger.mainHand").min,
      max: k("weapon.dagger.mainHand").max,
      speed: k("weapon.dagger.mainHand").speed,
      type: "dagger",
    });
  });

  it("poisons are Instant on the main hand and Deadly on the off hand", () => {
    assert.deepEqual(referenceBuild(DAGGERS).poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
  });

  it("leaves the Combat swords sheet unset", () => {
    assert.equal(referenceBuild("combat-swords-temp").character, undefined);
  });

  it("a pick writes the dagger sheet onto the config", () => {
    const store = createStore({ config: pageDefaultConfig() });
    const form = createConfigForm(store);
    const build = createPresetBuild(store, form);
    assert.equal(build.pick(DAGGERS, "Combat daggers"), true);
    const config = nextRunConfig(store.get());
    assert.equal(
      config.character.attackPower,
      k("character.dagger.attackPower"),
    );
    assert.equal(config.character.critChance, k("character.dagger.critChance"));
    assert.equal(
      config.character.bonusHitChance,
      k("character.bonusHitChance"),
    );
    assert.equal(
      config.rotation.rules.some((rule) => rule.action === "shank"),
      true,
    );
    assert.equal(
      config.rotation.rules.some((rule) => rule.action === "sinister-strike"),
      false,
    );
  });
});
