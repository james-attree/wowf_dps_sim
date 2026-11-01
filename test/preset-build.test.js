import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConfigForm, pageDefaultConfig } from "../js/config-form.js";
import {
  BUILD_PARTS,
  appliedText,
  announceText,
  buildDifferences,
  buttonLabel,
  createPresetBuild,
  currentBuild,
  hintOf,
  hintText,
  listText,
  presetOfChoice,
  shortName,
  treeText,
  undoName,
  weaponsText,
} from "../js/preset-build.js";
import { exportRotation } from "../js/rotation-io.js";
import {
  listPresets,
  presetRotation,
  referenceBuild,
} from "../js/rotation-presets.js";
import { createStore } from "../js/store.js";
import { createTalentTree } from "../js/talent-tree.js";

// #273: the preset's reference build under the Rotation select.

const NBSP = "\u00a0";
const PRESETS = listPresets().map(({ id }) => id);
const LOW_LEVEL = "40";

function page() {
  const store = createStore({ config: pageDefaultConfig() });
  const form = createConfigForm(store);
  const tree = createTalentTree(store);
  const build = createPresetBuild(store, form);
  const said = () => store.get().presetBuild;
  return { store, form, tree, build, said };
}

// The current build set to `id`'s reference build part by part.
function useParts(env, id, parts) {
  const reference = referenceBuild(id);
  if (parts.includes("weapons")) {
    for (const hand of ["mainHand", "offHand"]) {
      env.form.change(`weapons.${hand}.type`, reference.weapons[hand].type);
    }
  }
  if (parts.includes("poisons")) {
    for (const hand of ["mainHand", "offHand"]) {
      env.form.change(`poisons.${hand}`, reference.poisons[hand]);
    }
  }
}

describe("text (#273)", () => {
  it("lists parts with commas and and", () => {
    assert.equal(listText(["talents"]), "talents");
    assert.equal(listText(["talents", "poisons"]), "talents and poisons");
    assert.equal(listText(BUILD_PARTS), "talents, weapons and poisons");
  });

  it("labels name only the parts that differ", () => {
    assert.equal(buttonLabel(["talents"]), "Use its talents too");
    assert.equal(buttonLabel(["weapons"]), "Use its weapons too");
    assert.equal(buttonLabel(["poisons"]), "Use its poisons too");
    assert.equal(
      buttonLabel(BUILD_PARTS),
      "Use its talents, weapons and poisons too",
    );
  });

  it("names the trees and weapons, kept on one line", () => {
    const build = referenceBuild("assassination-daggers");
    assert.equal(treeText(build.talents), `Assassination${NBSP}41/10/0`);
    assert.equal(
      treeText(referenceBuild("combat-swords").talents),
      `Combat${NBSP}18/33/0`,
    );
    assert.equal(weaponsText(build.weapons), "two daggers");
    assert.equal(
      weaponsText({ mainHand: { type: "sword" }, offHand: { type: "axe" } }),
      "a sword and an axe",
    );
    assert.equal(
      weaponsText({ mainHand: { type: "fist" }, offHand: { type: "fist" } }),
      "two fist weapons",
    );
  });

  it("the hint says the level below 60 and the poisons when they differ", () => {
    const build = referenceBuild("subtlety-daggers");
    const none = { talents: true, weapons: true, poisons: false, level: false };
    assert.equal(
      hintText(build, none),
      `Built for Subtlety${NBSP}15/0/36 with two daggers.`,
    );
    assert.equal(
      hintText(build, { ...none, level: true, poisons: true }),
      `Built for Subtlety${NBSP}15/0/36 at level${NBSP}60 with two daggers, Instant Poison on the main hand and Deadly Poison on the off hand.`,
    );
  });

  it("the applied line, announcement and Undo name", () => {
    const build = referenceBuild("assassination-daggers");
    assert.equal(shortName(build), "Assassination daggers");
    assert.equal(shortName(referenceBuild("combat-swords")), "Combat swords");
    assert.equal(
      appliedText(build, ["talents", "weapons"], false),
      "Talents and weapons set to the Assassination daggers build.",
    );
    assert.equal(
      appliedText(build, BUILD_PARTS, true),
      `Talents, weapons and poisons set to the Assassination daggers build. Level set to${NBSP}60.`,
    );
    assert.equal(
      announceText(build, BUILD_PARTS, false),
      "Talents, weapons and poisons replaced.",
    );
    assert.equal(
      announceText(build, ["talents"], true),
      `Talents replaced. Level set to${NBSP}60.`,
    );
    assert.equal(
      announceText(build, ["talents"], true, true),
      "Talents and level put back.",
    );
    assert.equal(
      undoName(["talents", "weapons"]),
      "Undo: put back your talents and weapons",
    );
    assert.ok(undoName(["poisons"]).startsWith("Undo"));
  });
});

describe("matching (#273)", () => {
  it("every preset has a reference build, Combat swords too", () => {
    for (const id of PRESETS) {
      assert.notEqual(referenceBuild(id), null, id);
    }
  });

  it("the default rotation and other imports have no hint", () => {
    const env = page();
    assert.equal(env.store.get().form.rotationChoice, "default");
    assert.equal(env.said().hint, null);
    const rotation = { ...presetRotation("subtlety-daggers"), name: "Mine" };
    assert.equal(env.form.importText(exportRotation(rotation)), true);
    assert.equal(env.store.get().form.rotationChoice, "imported");
    assert.equal(env.said().hint, null);
  });

  it("an import identical to a preset is that preset", () => {
    const env = page();
    env.form.importText(exportRotation(presetRotation("subtlety-daggers")));
    assert.equal(presetOfChoice(env.store.get().form), "subtlety-daggers");
    assert.equal(env.said().hint.presetId, "subtlety-daggers");
    assert.equal(env.said().hint.label, "Use its talents and weapons too");
  });

  it("talents only, weapons only, poisons only and all differing", () => {
    const env = page();
    env.form.chooseRotation("assassination-daggers");
    assert.equal(env.said().hint.label, "Use its talents and weapons too");
    // Talents only: the reference weapons.
    useParts(env, "assassination-daggers", ["weapons"]);
    assert.equal(env.said().hint.label, "Use its talents too");
    // Talents and poisons: other poisons as well.
    env.form.change("poisons.mainHand", "deadly");
    assert.equal(env.said().hint.label, "Use its talents and poisons too");
    // All three.
    env.form.change("weapons.mainHand.type", "sword");
    assert.equal(
      env.said().hint.label,
      "Use its talents, weapons and poisons too",
    );
    // Apply, then put back the old weapons and poisons by hand: talents
    // match, so weapons and poisons only.
    env.build.apply();
    assert.equal(env.said().hint, null);
    env.form.change("weapons.offHand.type", "mace");
    assert.equal(env.said().hint.label, "Use its weapons too");
    env.form.change("weapons.offHand.type", "dagger");
    env.form.change("poisons.offHand", "instant");
    assert.equal(env.said().hint.label, "Use its poisons too");
  });

  it("weapon numbers, level and stats are not compared", () => {
    const env = page();
    env.form.chooseRotation("combat-swords");
    env.build.apply();
    assert.equal(env.said().hint, null);
    env.form.change("weapons.mainHand.min", 50);
    env.form.change("character.attackPower", 1500);
    assert.equal(env.said().hint, null);
    const differences = buildDifferences(
      referenceBuild("combat-swords"),
      currentBuild(env.store.get()),
    );
    assert.deepEqual(differences, {
      talents: false,
      weapons: false,
      poisons: false,
      level: false,
    });
  });

  it("an edited preset keeps its hint", () => {
    const env = page();
    env.form.chooseRotation("subtlety-daggers");
    const draft = { ...presetRotation("subtlety-daggers") };
    env.form.setDraft("subtlety-daggers", {
      ...draft,
      name: "Subtlety (edited)",
      rules: draft.rules.slice(1),
    });
    assert.equal(env.store.get().form.rotationChoice, "subtlety-daggers");
    assert.equal(env.said().hint.presetId, "subtlety-daggers");
  });

  it("is computed from the current build after a share link loads", () => {
    const config = {
      ...pageDefaultConfig(),
      rotation: presetRotation("combat-swords"),
      talents: referenceBuild("combat-swords").talents,
    };
    const store = createStore({ config });
    const form = createConfigForm(store);
    createTalentTree(store);
    createPresetBuild(store, form);
    assert.equal(store.get().form.rotationChoice, "combat-swords");
    assert.equal(store.get().presetBuild.hint, null);
    form.change("poisons.offHand", "instant");
    assert.equal(store.get().presetBuild.hint.label, "Use its poisons too");
  });
});

describe("apply and Undo (#273)", () => {
  it("replaces talents, weapons and poisons, leaves the stats", () => {
    const env = page();
    env.form.change("character.attackPower", 1234);
    env.form.change("poisons.offHand", "instant");
    env.form.chooseRotation("assassination-daggers");
    const before = env.store.get().config;
    assert.equal(env.build.apply(), true);
    const { config, form, talents } = env.store.get();
    const reference = referenceBuild("assassination-daggers");
    assert.deepEqual(config.talents, reference.talents);
    assert.deepEqual(config.weapons, reference.weapons);
    assert.deepEqual(config.poisons, reference.poisons);
    assert.equal(config.character.attackPower, 1234);
    assert.deepEqual(config.character, before.character);
    assert.equal(form.values["weapons.mainHand.type"], "dagger");
    assert.equal(form.values["poisons.offHand"], "deadly");
    // The tree follows, silently: its announcement is not moved.
    assert.deepEqual(talents.announce, { text: "", count: 0 });
    assert.deepEqual(talents.ranks, reference.talents);
    const said = env.said();
    assert.equal(said.hint, null);
    assert.equal(
      said.applied.text,
      "Talents, weapons and poisons set to the Assassination daggers build.",
    );
    assert.equal(said.announce.text, "Talents, weapons and poisons replaced.");
    assert.equal(said.focus.target, "undo");
  });

  it("Undo puts all three back, and the focus on the button", () => {
    const env = page();
    env.form.change("poisons.offHand", "instant");
    env.form.chooseRotation("subtlety-daggers");
    const before = env.store.get().config;
    env.build.apply();
    assert.equal(env.build.undo(), true);
    const { config } = env.store.get();
    assert.deepEqual(config.talents, before.talents);
    assert.deepEqual(config.weapons, before.weapons);
    assert.deepEqual(config.poisons, before.poisons);
    assert.equal(config.talentLevel, before.talentLevel);
    const said = env.said();
    assert.equal(said.applied, null);
    assert.equal(said.hint.label, "Use its talents, weapons and poisons too");
    assert.equal(said.announce.text, "Talents, weapons and poisons put back.");
    assert.equal(said.focus.target, "button");
    // One step: a second Undo does nothing.
    assert.equal(env.build.undo(), false);
  });

  it("below level 60 sets level 60, and Undo puts the level back", () => {
    const env = page();
    env.tree.setLevel(LOW_LEVEL);
    assert.equal(env.store.get().config.talentLevel, Number(LOW_LEVEL));
    env.form.chooseRotation("combat-swords");
    assert.equal(
      env.said().hint.text,
      `Built for Combat${NBSP}18/33/0 at level${NBSP}60 with two swords.`,
    );
    env.build.apply();
    assert.equal(env.store.get().config.talentLevel, 60);
    assert.equal(env.store.get().talents.level, 60);
    assert.equal(
      env.said().applied.text,
      `Talents set to the Combat swords build. Level set to${NBSP}60.`,
    );
    assert.equal(
      env.said().announce.text,
      `Talents replaced. Level set to${NBSP}60.`,
    );
    env.build.undo();
    assert.equal(env.store.get().config.talentLevel, Number(LOW_LEVEL));
    assert.equal(env.store.get().talents.level, Number(LOW_LEVEL));
    assert.equal(env.said().announce.text, "Talents and level put back.");
  });

  it("Undo closes on the next build edit", () => {
    const env = page();
    env.form.chooseRotation("assassination-daggers");
    env.build.apply();
    assert.notEqual(env.said().applied, null);
    env.form.change("character.attackPower", 1000);
    assert.equal(env.said().applied, null);
    assert.equal(env.build.undo(), false);
  });

  it("Undo closes on a talent edit, even one the tree holds back", () => {
    const env = page();
    env.form.chooseRotation("assassination-daggers");
    env.build.apply();
    const id = Object.keys(referenceBuild("assassination-daggers").talents)[0];
    env.tree.remove(id);
    assert.equal(env.said().applied, null);
  });

  it("Undo closes on a rotation change or leaving the page", () => {
    const env = page();
    env.form.chooseRotation("assassination-daggers");
    env.build.apply();
    env.form.chooseRotation("subtlety-daggers");
    assert.equal(env.said().applied, null);
    assert.equal(env.said().hint.label, "Use its talents too");

    env.store.set({ route: { area: "rotation", sub: null, param: null } });
    env.build.apply();
    assert.notEqual(env.said().applied, null);
    env.store.set({ route: { area: "character", sub: null, param: null } });
    assert.equal(env.said().applied, null);
  });

  it("Undo stays through a run and puts the build back after it", () => {
    const env = page();
    env.form.chooseRotation("combat-swords");
    env.build.apply();
    const ran = env.store.get().config;
    env.store.set({
      run: { state: "finished" },
      ran: { average: { config: ran } },
    });
    assert.notEqual(env.said().applied, null);
    env.build.undo();
    assert.equal(Object.keys(env.store.get().config.talents).length, 0);
  });

  it("applies with another field in error, which stays as typed", () => {
    const env = page();
    env.form.chooseRotation("assassination-daggers");
    env.form.change("character.attackPower", -5);
    assert.ok("character.attackPower" in env.store.get().form.errors);
    env.build.apply();
    const { config, form } = env.store.get();
    assert.equal(config.weapons.mainHand.type, "dagger");
    assert.deepEqual(
      config.talents,
      referenceBuild("assassination-daggers").talents,
    );
    assert.equal(form.values["character.attackPower"], -5);
    assert.ok("character.attackPower" in form.errors);
  });

  it("does nothing without a hint", () => {
    const env = page();
    assert.equal(env.build.apply(), false);
    assert.equal(hintOf(env.store.get()), null);
  });

  it("Undo brings the hint back, so the focus goes to its button", () => {
    const env = page();
    env.form.chooseRotation("combat-swords");
    env.build.apply();
    // Undo puts back a build that differed (the button was there), so the
    // hint is back and the focus goes to it, not to the select.
    env.build.undo();
    assert.equal(env.said().focus.target, "button");
  });
});
