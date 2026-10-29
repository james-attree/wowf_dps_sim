import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import * as dataBuild from "../data/reference-build.js";
import {
  FORM_ERROR,
  FORM_FIELDS,
  configFromForm,
  createConfigForm,
  errorCount,
  formFromConfig,
  errorLine,
  importedText,
  nextRunConfig,
  pageDefaultConfig,
  validateValues,
} from "../js/config-form.js";
import { createFight, runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation } from "../js/rotation-io.js";
import { formatError } from "../js/rotation-schema.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { listPresets, presetRotation } from "../js/rotation-presets.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import * as testBuild from "./talentsforever.js";

// Issue #151 (U2), the stats form's model. Fran's notes
// (design/151-stats-form-notes.md) and the "Resolved (Scout, 29 Oct)" list:
// one source of truth for the rotation (config.rotation), an invalid value
// never reaches the config, changes apply to the next run, the reference build
// lives in data/reference-build.js, and the form never touches the fight
// length or adds a cap of its own.

const SEED = 20261029;

function setup() {
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const actions = createConfigForm(store);
  const form = () => store.get().form;
  const config = () => store.get().config;
  return { store, actions, form, config };
}

describe("the reference build moved to data/ (Scout, 29 Oct)", () => {
  it("is one build: test/talentsforever.js re-exports data/reference-build.js", () => {
    assert.equal(testBuild.referenceBuild, dataBuild.referenceBuild);
    assert.equal(testBuild.decodeBuildLink, dataBuild.decodeBuildLink);
    assert.equal(testBuild.REFERENCE_LINK, dataBuild.REFERENCE_LINK);
    assert.ok(Object.keys(dataBuild.referenceBuild()).length > 0);
  });
});

describe("the form fills from the store's config", () => {
  it("shows the page defaults with no errors and the default rotation", () => {
    const { form, config } = setup();
    assert.deepEqual(form().errors, {});
    assert.equal(
      form().values["character.attackPower"],
      config().character.attackPower,
    );
    assert.equal(
      form().values["character.critChance"],
      config().character.critChance,
    );
    assert.equal(
      form().values["weapons.mainHand.type"],
      config().weapons.mainHand.type,
    );
    assert.equal(form().rotationChoice, "default");
    assert.equal(form().summary.name, defaultRotation().name);
    assert.equal(form().summary.rules.length, defaultRotation().rules.length);
    assert.equal(form().canUndo, false);
  });

  it("edits every config field Fran lists, and no fight length", () => {
    assert.deepEqual(
      FORM_FIELDS.map(({ path }) => path),
      [
        "character.attackPower",
        "character.critChance",
        "character.bonusHitChance",
        "weapons.mainHand.type",
        "weapons.mainHand.min",
        "weapons.mainHand.max",
        "weapons.mainHand.speed",
        "weapons.offHand.type",
        "weapons.offHand.min",
        "weapons.offHand.max",
        "weapons.offHand.speed",
        "poisons.mainHand",
        "poisons.offHand",
      ],
    );
    assert.ok(!FORM_FIELDS.some(({ path }) => /duration|length/i.test(path)));
  });

  it("round-trips: the config the defaults describe is the config", () => {
    const config = normalizeConfig(pageDefaultConfig());
    assert.deepEqual(configFromForm(formFromConfig(config), config), config);
  });

  it("has no store slice for the rotation beside config.rotation", () => {
    const { store } = setup();
    assert.deepEqual(Object.keys(store.get()).sort(), ["config", "form"]);
  });
});

describe("field checks (Fran's notes, section 3)", () => {
  const valid = () => formFromConfig(normalizeConfig(defaultConfig())).values;
  const cases = [
    ["character.attackPower", Number.NaN, "Enter a number."],
    ["character.attackPower", -1, "Attack power can't be negative."],
    ["character.critChance", 1.2, "Enter a percentage from 0 to 100."],
    ["character.bonusHitChance", -0.01, "Enter a percentage from 0 to 100."],
    ["weapons.mainHand.min", 1.5, "Use a whole number, 0 or more."],
    ["weapons.offHand.max", -3, "Use a whole number, 0 or more."],
    [
      "weapons.mainHand.speed",
      0.05,
      `Speed must be at least ${k("config.minWeaponSpeed")} s.`,
    ],
    ["weapons.offHand.speed", Number.NaN, "Enter a number."],
    ["weapons.mainHand.type", "bow", "Choose a weapon type."],
  ];
  for (const [path, value, message] of cases) {
    it(`${path} = ${value}: "${message}"`, () => {
      const errors = validateValues({ ...valid(), [path]: value });
      assert.deepEqual(errors, { [path]: message });
    });
  }

  it("refuses an infinite value (1e999 typed)", () => {
    const errors = validateValues({
      ...valid(),
      "character.attackPower": Number.POSITIVE_INFINITY,
    });
    assert.deepEqual(Object.keys(errors), ["character.attackPower"]);
  });

  it("accepts the edges: 0 and 100 percent, the minimum speed, min equal to max", () => {
    const values = {
      ...valid(),
      "character.critChance": 0,
      "character.bonusHitChance": 1,
      "weapons.mainHand.speed": k("config.minWeaponSpeed"),
      "weapons.mainHand.min": 120,
      "weapons.mainHand.max": 120,
    };
    assert.deepEqual(validateValues(values), {});
  });

  it("puts min > max on the Max, with the Min marked but unmessaged", () => {
    const errors = validateValues({
      ...valid(),
      "weapons.offHand.min": 90,
      "weapons.offHand.max": 50,
    });
    assert.deepEqual(errors, {
      "weapons.offHand.max": "Max damage must be at least the min damage (90).",
      "weapons.offHand.min": null,
    });
    assert.equal(errorCount(errors), 1);
  });

  it("offers every weapon type the engine knows, and only those", () => {
    for (const type of k("config.weaponTypes")) {
      assert.deepEqual(
        validateValues({ ...valid(), "weapons.mainHand.type": type }),
        {},
      );
    }
  });
});

describe("an invalid value never reaches the config", () => {
  it("change with a bad value sets the error and leaves config alone", () => {
    const { actions, form, config } = setup();
    const before = config();
    actions.change("character.critChance", 1.5);
    assert.equal(
      form().errors["character.critChance"],
      "Enter a percentage from 0 to 100.",
    );
    assert.equal(form().values["character.critChance"], 1.5);
    assert.equal(config(), before);
  });

  it("a good edit elsewhere waits while any field is invalid, then lands with the fix", () => {
    const { actions, config } = setup();
    const before = config();
    actions.change("character.attackPower", Number.NaN);
    actions.change("character.critChance", 0.3);
    assert.equal(config(), before);
    actions.change("character.attackPower", 900);
    assert.equal(config().character.attackPower, 900);
    assert.equal(config().character.critChance, 0.3);
  });

  it("input clears a field's error once valid, and never adds one", () => {
    const { actions, form, config } = setup();
    const before = config();
    actions.input("character.attackPower", Number.NaN);
    assert.deepEqual(form().errors, {});
    assert.equal(config(), before, "typing writes no config");
    actions.change("character.attackPower", -5);
    actions.input("character.attackPower", -6);
    assert.equal(
      form().errors["character.attackPower"],
      "Attack power can't be negative.",
    );
    actions.input("character.attackPower", 6);
    assert.deepEqual(form().errors, {});
  });

  it("fixing the Min clears the pair's error", () => {
    const { actions, form } = setup();
    actions.change("weapons.mainHand.max", 50);
    assert.equal(errorCount(form().errors), 1);
    actions.input("weapons.mainHand.min", 40);
    assert.deepEqual(form().errors, {});
  });

  it("the normalizeConfig backstop refuses what the checks miss, as a form error", () => {
    const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
    const actions = createConfigForm(store);
    // A target the form does not edit, made invalid behind its back.
    store.set({ config: { ...store.get().config, target: { level: "high" } } });
    const before = store.get().config;
    actions.change("character.attackPower", 900);
    assert.match(
      store.get().form.errors[FORM_ERROR],
      /^This setup can't run: /,
    );
    assert.equal(store.get().config, before);
    assert.equal(nextRunConfig(store.get()), null);
  });
});

describe("changes apply to the next run", () => {
  it("nextRunConfig is null while the form has errors", () => {
    const { store, actions } = setup();
    assert.notEqual(nextRunConfig(store.get()), null);
    actions.change("weapons.mainHand.speed", 0);
    assert.equal(nextRunConfig(store.get()), null);
  });

  it("an edit changes what the next fight does, by the same config", () => {
    const { store, actions } = setup();
    const first = runFight({
      seed: SEED,
      duration: 60,
      config: nextRunConfig(store.get()),
    });
    actions.change("character.attackPower", 1500);
    const next = nextRunConfig(store.get());
    const second = runFight({ seed: SEED, duration: 60, config: next });
    assert.equal(second.config.character.attackPower, 1500);
    assert.ok(second.totalDamage > first.totalDamage);
  });

  it("a chance is stored 0 to 1: 22.45 % is 0.2245", () => {
    const { store, actions } = setup();
    actions.change("character.critChance", 22.45 / 100);
    assert.equal(nextRunConfig(store.get()).character.critChance, 0.2245);
  });

  it("a main-hand dagger gives 1.7 normalized speed; the off hand does not change it", () => {
    const { store, actions } = setup();
    const speed = () =>
      createFight(SEED, nextRunConfig(store.get())).rogue.normalizedWeaponSpeed;
    assert.equal(speed(), 2.4);
    actions.change("weapons.offHand.type", "dagger");
    assert.equal(speed(), 2.4);
    actions.change("weapons.mainHand.type", "dagger");
    assert.equal(speed(), 1.7);
  });
});

describe("talents: the talent tree owns the build (#204)", () => {
  // A build the old select did not offer: a partial Combat build at level 40.
  const custom = () => ({
    "combat.improved-sinister-strike": 2,
    "combat.precision": 3,
  });

  it("a field edit keeps a custom build and its level (the old select wiped it)", () => {
    const store = createStore({
      config: normalizeConfig({
        ...pageDefaultConfig(),
        talents: custom(),
        talentLevel: 40,
      }),
    });
    const actions = createConfigForm(store);
    actions.change("character.attackPower", 1000);
    assert.equal(store.get().config.character.attackPower, 1000);
    assert.deepEqual(store.get().config.talents, custom());
    assert.equal(store.get().config.talentLevel, 40);
    actions.input("character.critChance", 0.25);
    actions.change("character.critChance", 0.25);
    assert.deepEqual(store.get().config.talents, custom());
  });

  it("configFromForm takes the build from its base, never from the form", () => {
    const base = normalizeConfig({ talents: custom(), talentLevel: 40 });
    const config = configFromForm(formFromConfig(base), base);
    assert.deepEqual(config.talents, custom());
    assert.equal(config.talentLevel, 40);
  });

  it("the form has no talents choice and no chooseTalents action", () => {
    const { form, actions } = setup();
    assert.equal("talentsChoice" in form(), false);
    assert.equal("talentOptions" in form(), false);
    assert.equal("chooseTalents" in actions, false);
  });

  it("the reference build in the config reaches the fight", () => {
    const { store } = setup();
    store.set({
      config: normalizeConfig({
        ...store.get().config,
        talents: dataBuild.referenceBuild(),
      }),
    });
    const expected = normalizeConfig({
      talents: dataBuild.referenceBuild(),
    }).talents;
    const result = runFight({
      seed: SEED,
      duration: 10,
      config: nextRunConfig(store.get()),
    });
    assert.deepEqual(result.config.talents, expected);
  });

  it("nextRunConfig is null while the talent tree's build is over its cap", () => {
    const { store } = setup();
    assert.notEqual(nextRunConfig(store.get()), null);
    store.set({
      talents: { error: "51 points spent, but level 40 gives 31." },
    });
    assert.equal(nextRunConfig(store.get()), null);
    store.set({ talents: { error: null } });
    assert.notEqual(nextRunConfig(store.get()), null);
  });
});

describe("rotation: one source of truth, config.rotation", () => {
  it("offers the default, then each preset", () => {
    const { form } = setup();
    assert.deepEqual(
      form().rotationOptions.map(({ id }) => id),
      ["default", ...listPresets().map(({ id }) => id)],
    );
    assert.equal(form().rotationOptions[0].label, defaultRotation().name);
  });

  it("choosing a preset writes config.rotation and the summary", () => {
    const { store, actions, form } = setup();
    const [preset] = listPresets();
    actions.chooseRotation(preset.id);
    assert.deepEqual(
      store.get().config.rotation,
      normalizeConfig({ rotation: presetRotation(preset.id) }).rotation,
    );
    assert.equal(form().summary.name, preset.name);
    actions.chooseRotation("default");
    assert.equal(form().summary.name, defaultRotation().name);
  });

  it("export gives exportRotation of the selected rotation, with a file name", () => {
    const { actions } = setup();
    const [preset] = listPresets();
    actions.chooseRotation(preset.id);
    const file = actions.exportRotation();
    assert.equal(file.text, exportRotation(presetRotation(preset.id)));
    assert.equal(file.fileName, `${preset.id}.json`);
  });

  it("a good import becomes the selected 'Imported: <name>' choice", () => {
    const { store, actions, form } = setup();
    const rotation = {
      ...presetRotation(listPresets()[0].id),
      name: "My rotation",
    };
    assert.equal(actions.importText(exportRotation(rotation)), true);
    assert.equal(form().rotationChoice, "imported");
    assert.equal(form().rotationOptions.at(-1).label, "Imported: My rotation");
    assert.deepEqual(form().importStatus, {
      ok: true,
      message: 'Imported "My rotation".',
      detail: "",
      warnings: "",
    });
    assert.equal(store.get().config.rotation.name, "My rotation");
    assert.equal(actions.exportRotation().text, exportRotation(rotation));
  });

  it("an import with warnings is still imported and selected, with the warnings (#189)", () => {
    const { store, actions, form } = setup();
    const trap = {
      schemaVersion: 1,
      name: "Trap",
      rules: [
        { action: "eviscerate", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    };
    assert.equal(actions.importText(exportRotation(trap)), true);
    assert.equal(form().rotationChoice, "imported");
    assert.equal(store.get().config.rotation.name, "Trap");
    assert.deepEqual(form().errors, {});
    const status = form().importStatus;
    assert.equal(status.ok, true);
    assert.equal(
      status.message,
      'Imported "Trap" with 1 warning. It still runs; see the warnings below.',
    );
    assert.equal(status.detail, "");
    assert.equal(
      status.warnings,
      rotationWarnings(trap).map(errorLine).join("\n"),
    );
    assert.match(
      status.warnings,
      /^rules\[0\]\.conditions: Eviscerate \(eviscerate\) is a finisher/m,
    );
    actions.importText("{ nope");
    assert.equal(form().importStatus.warnings, "");
  });

  it("choosing another rotation clears the import status; choosing the same keeps it (Kira's #206 review)", () => {
    const { actions, form } = setup();
    const trap = {
      schemaVersion: 1,
      name: "Trap",
      rules: [
        { action: "eviscerate", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    };
    actions.importText(exportRotation(trap));
    const status = form().importStatus;
    assert.notEqual(status, null);
    actions.chooseRotation("imported");
    assert.equal(form().importStatus, status, "the same choice keeps it");
    actions.chooseRotation("default");
    assert.equal(form().importStatus, null);
    assert.equal(form().rotationChoice, "default");
    actions.importText("{ nope");
    assert.equal(form().importStatus.ok, false);
    actions.chooseRotation("imported");
    assert.equal(form().importStatus, null, "a refusal goes too");
    assert.equal(form().rotationChoice, "imported");
  });

  it("the import status line counts the warnings", () => {
    assert.equal(importedText("A", 0), 'Imported "A".');
    assert.equal(
      importedText("A", 1),
      'Imported "A" with 1 warning. It still runs; see the warnings below.',
    );
    assert.equal(
      importedText("A", 3),
      'Imported "A" with 3 warnings. It still runs; see the warnings below.',
    );
  });

  it("a bad import changes nothing but the status, with the details", () => {
    const { store, actions, form } = setup();
    const before = store.get().config;
    assert.equal(actions.importText("{ nope"), false);
    assert.equal(store.get().config, before);
    assert.equal(form().rotationChoice, "default");
    assert.equal(form().importStatus.ok, false);
    assert.equal(
      form().importStatus.message,
      "This file isn't a valid rotation.",
    );
    assert.match(form().importStatus.detail, /not valid JSON/);
    actions.importText(
      JSON.stringify({ name: "x", rules: [{ ability: "Nope" }] }),
    );
    assert.match(
      form().importStatus.detail,
      /^schemaVersion: The rotation is missing "schemaVersion"\.$/m,
    );
    // The message names no place; the path is written once, in front (#214).
    assert.match(
      form().importStatus.detail,
      /^rules\[0\]\.action: The rule is missing "action"\.$/m,
    );
    assert.doesNotMatch(
      form().importStatus.detail,
      /rules\[0\][^\n]*: rules\[0\]/,
    );
  });

  it("a refused talent-granted rule shows its path once, in front (#189 review, #214)", () => {
    const { actions, form } = setup();
    actions.importText(
      JSON.stringify({
        schemaVersion: 1,
        name: "BF",
        rules: [{ action: "blade-flurry", conditions: [] }],
      }),
    );
    const { detail } = form().importStatus;
    assert.match(
      detail,
      /^rules\[0\]\.conditions: Blade Flurry \(blade-flurry\) comes from a talent/,
    );
    assert.equal(detail.split("rules[0]").length, 2, detail);
  });

  it("errorLine is formatError: the path, then the message, or the message alone at the root (#214)", () => {
    const line = (path, message) => errorLine({ path, message });
    assert.equal(errorLine, formatError);
    assert.equal(line("", "Not JSON."), "Not JSON.");
    assert.equal(
      line("rules[0].conditions", "Blade Flurry"),
      "rules[0].conditions: Blade Flurry",
    );
    assert.equal(
      line("schemaVersion", 'The rotation is missing "schemaVersion".'),
      'schemaVersion: The rotation is missing "schemaVersion".',
    );
    // No guessing from the text: a message is never read for a place.
    assert.equal(line("rules[1]", "rules[0]: x"), "rules[1]: rules[0]: x");
    assert.equal(line("rules", "rules is x"), "rules: rules is x");
  });

  it("a file over the import limit is refused by rotation-io's own limit", () => {
    const { actions, form } = setup();
    assert.equal(
      actions.importText(" ".repeat(k("rotation.maxImportChars") + 1)),
      false,
    );
    assert.match(form().importStatus.detail, /too large/);
  });

  it("a config with an unknown rotation shows it as imported", () => {
    const rotation = { ...defaultRotation(), name: "Custom" };
    const form = formFromConfig(normalizeConfig({ rotation }));
    assert.equal(form.rotationChoice, "imported");
    assert.equal(form.imported.name, "Custom");
  });
});

describe("Reset to defaults and Undo", () => {
  it("Reset restores the defaults and clears errors; Undo puts everything back", () => {
    const { store, actions, form } = setup();
    actions.change("character.attackPower", 1000);
    store.set({
      config: normalizeConfig({
        ...store.get().config,
        talents: dataBuild.referenceBuild(),
      }),
    });
    actions.change("weapons.mainHand.max", 1);
    const editedForm = form();
    const editedConfig = store.get().config;
    actions.reset();
    assert.deepEqual(form().errors, {});
    assert.equal(form().canUndo, true);
    assert.deepEqual(store.get().config, normalizeConfig(pageDefaultConfig()));
    assert.ok(form().revision > editedForm.revision);
    assert.equal(actions.undo(), true);
    assert.equal(store.get().config, editedConfig);
    assert.deepEqual(form().values, editedForm.values);
    assert.deepEqual(form().errors, editedForm.errors);
    assert.equal(form().canUndo, false);
    assert.equal(actions.undo(), false);
  });

  it("any other action ends the Undo offer", () => {
    const { actions, form } = setup();
    actions.reset();
    actions.input("character.attackPower", 5);
    assert.equal(form().canUndo, false);
    assert.equal(actions.undo(), false);
  });

  it("the toast time is a ui constant, not a game rule", () => {
    assert.equal(k("ui.undoToastSeconds"), 5);
  });
});
