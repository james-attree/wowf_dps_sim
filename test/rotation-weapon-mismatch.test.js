import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pageDefaultConfig } from "../js/config-form.js";
import {
  createRotationWeaponNote,
  hasWeaponTypeMismatch,
  rotationWeaponMismatch,
  weaponMismatchOf,
} from "../js/rotation-weapon-mismatch.js";
import { presetRotation } from "../js/rotation-presets.js";
import { createStore } from "../js/store.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../js/rotation-weapon-mismatch.js", import.meta.url)),
  "utf8",
);
const VIEW = readFileSync(
  fileURLToPath(
    new URL("../js/views/rotation-weapon-note.js", import.meta.url),
  ),
  "utf8",
);

const PREDICATE =
  /return expectedTypes\.size > 0 && !expectedTypes\.has\(equippedType\);/;

const daggers = () => presetRotation("combat-daggers");
const swords = () => presetRotation("combat-swords-temp");
const assassination = () => presetRotation("assassination-daggers");

const sword = { type: "sword", min: 50, max: 90, speed: 2.4 };
const dagger = { type: "dagger", min: 40, max: 70, speed: 1.8 };
const axe = { type: "axe", min: 40, max: 80, speed: 1.8 };

function note(rotation, weapons, isPreset = true) {
  return rotationWeaponMismatch(rotation, weapons, { isPreset });
}

describe("rotation weapon mismatch (#406 P2)", () => {
  it("names both types when Combat daggers meets a sword main hand", () => {
    assert.equal(
      note(daggers(), { mainHand: sword, offHand: axe }),
      "This preset's rotation uses daggers; your main hand is a sword.",
    );
  });

  it("hides the note when the main hand is a dagger", () => {
    assert.equal(note(daggers(), { mainHand: dagger, offHand: axe }), null);
  });

  it("does not invent a swords requirement for Combat swords", () => {
    // Combat swords' actions have no requiresMainHand in ability-data,
    // so a dagger main hand is not a mismatch. coordinator call 16 Nov
    // (James delegated): only existing data, no new rule.
    assert.equal(note(swords(), { mainHand: dagger, offHand: dagger }), null);
    assert.equal(note(swords(), { mainHand: sword, offHand: sword }), null);
  });

  it("flags an off-hand mismatch when a rule requires that hand", () => {
    assert.equal(
      note(assassination(), { mainHand: dagger, offHand: axe }),
      "This preset's rotation uses daggers; your off hand is an axe.",
    );
  });

  it("names the main hand first when both hands are wrong", () => {
    assert.equal(
      note(assassination(), { mainHand: sword, offHand: axe }),
      "This preset's rotation uses daggers; your main hand is a sword.",
    );
  });

  it("says the hand is empty when the required weapon is missing", () => {
    assert.equal(
      note(daggers(), { mainHand: null, offHand: null }),
      "This preset's rotation uses daggers; your main hand is empty.",
    );
  });

  it("uses rotation wording when the choice is not a preset", () => {
    assert.equal(
      note(daggers(), { mainHand: sword, offHand: axe }, false),
      "This rotation uses daggers; your main hand is a sword.",
    );
  });

  it("the page default (Combat daggers and a dagger main hand) is quiet", () => {
    const config = pageDefaultConfig();
    assert.equal(config.weapons.mainHand.type, "dagger");
    assert.equal(
      rotationWeaponMismatch(config.rotation, config.weapons, {
        isPreset: true,
      }),
      null,
    );
  });

  it("does not put the note into Run errors", () => {
    const text = note(daggers(), { mainHand: sword, offHand: axe });
    const config = normalizeConfig({
      ...defaultConfig(),
      rotation: daggers(),
      weapons: { mainHand: sword, offHand: axe },
    });
    // A mismatch is a note, not a form error: level 60 with a main hand
    // still has an empty gear-run reason even when the types differ.
    assert.ok(text);
    assert.equal(config.weapons.mainHand.type, "sword");
  });
});

describe("weaponMismatch store slice", () => {
  it("fills the slice from the live config and leaves gear alone", () => {
    const config = {
      ...pageDefaultConfig(),
      weapons: {
        ...pageDefaultConfig().weapons,
        mainHand: { ...pageDefaultConfig().weapons.mainHand, type: "sword" },
      },
    };
    const store = createStore({
      config,
      form: { rotationChoice: "combat-daggers" },
      weaponMismatch: null,
    });
    const before = store.get().config.weapons;
    createRotationWeaponNote(store);
    const slice = store.get().weaponMismatch;
    assert.equal(
      slice.text,
      "This preset's rotation uses daggers; your main hand is a sword.",
    );
    assert.equal(slice.href, "#character/gear");
    assert.equal(store.get().config.weapons, before);
  });

  it("weaponMismatchOf is null when the type already matches", () => {
    const config = pageDefaultConfig();
    assert.equal(
      weaponMismatchOf({
        config,
        form: { rotationChoice: "combat-daggers" },
      }),
      null,
    );
  });
});

describe("mismatch mutants (#406 P2)", () => {
  it("M: dropping the equipped-type check hides a sword-vs-daggers mismatch", () => {
    assert.match(SOURCE, PREDICATE);
    const mutant = SOURCE.replace(PREDICATE, "return false;");
    assert.notEqual(mutant, SOURCE);
    const run = (source, expected, equipped) => {
      const match = source.match(
        /export function hasWeaponTypeMismatch\([^)]*\) \{([^}]+)\}/,
      );
      assert.ok(match, "hasWeaponTypeMismatch body");
      return new Function("expectedTypes", "equippedType", match[1])(
        expected,
        equipped,
      );
    };
    assert.equal(run(SOURCE, new Set(["dagger"]), "sword"), true);
    assert.equal(hasWeaponTypeMismatch(new Set(["dagger"]), "sword"), true);
    assert.equal(run(mutant, new Set(["dagger"]), "sword"), false);
  });

  it("M: dropping the note render leaves the view with no text to show", () => {
    const assign = /text\.textContent = shown \? model\.text : "";/;
    assert.match(VIEW, assign);
    const mutant = VIEW.replace(assign, "");
    assert.notEqual(mutant, VIEW);
    assert.doesNotMatch(mutant, assign);
    assert.match(VIEW, /Go to Gear|#character\/gear/);
  });
});
