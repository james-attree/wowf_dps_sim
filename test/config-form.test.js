import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import * as dataBuild from "../data/reference-build.js";
import {
  FORM_ERROR,
  FORM_FIELDS,
  configFromForm,
  createConfigForm,
  formFromConfig,
  errorLine,
  importedText,
  listedLines,
  MAX_LISTED,
  nextRunConfig,
  pageDefaultConfig,
  validateValues,
} from "../js/config-form.js";
import { createFight, runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import { formatError } from "../js/rotation-schema.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { listPresets, presetRotation } from "../js/rotation-presets.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import {
  blocked,
  blockedCount,
  formErrorCount,
} from "../js/views/run-model.js";
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
        "character.haste",
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
    assert.equal(formErrorCount({ errors }), 1);
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
    assert.equal(formErrorCount({ errors: form().errors }), 1);
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

describe("a null Min never stands alone (#237)", () => {
  const MIN = "weapons.mainHand.min";
  const MAX = "weapons.mainHand.max";
  // Max under Min: the pair's error, on the Max, with the Min marked.
  const PAIR_MIN = 50;
  const PAIR_MAX = 40;
  // Invalid on its own (not whole), so the Max is fine again.
  const NOT_WHOLE = 1.5;
  const FIXED_MIN = 30;
  const run = { mode: "live", errors: {} };
  const check = (store, count, step) => {
    const state = { ...store.get(), run };
    assert.equal(formErrorCount(state.form), count, step);
    assert.equal(blockedCount(state), count, step);
    assert.equal(blocked(state), count > 0, step);
    const values = Object.values(state.form.errors);
    assert.ok(
      values.length === 0 || values.some((message) => message !== null),
      `${step}: never only null entries`,
    );
  };

  it("typing a Min invalid on its own in a pair in error gives its own message at once (#240 N1)", () => {
    const { store, actions, form } = setup();
    actions.change(MIN, PAIR_MIN);
    actions.change(MAX, PAIR_MAX);
    assert.equal(form().errors[MIN], null);
    assert.match(form().errors[MAX], /at least the min damage/);
    check(store, 1, "the pair");
    actions.input(MIN, NOT_WHOLE);
    assert.equal(typeof form().errors[MIN], "string", "checked as typed");
    assert.ok(!(MAX in form().errors), "the pair's error goes");
    check(store, 1, "typing");
    actions.change(MIN, NOT_WHOLE);
    assert.equal(typeof form().errors[MIN], "string");
    check(store, 1, "committed");
  });

  it("every typed Min after the pair's error keeps the count and blocked as one", () => {
    for (const typed of [
      NOT_WHOLE,
      Number.NaN,
      -1,
      PAIR_MAX,
      FIXED_MIN,
      PAIR_MIN,
    ]) {
      const { store, actions } = setup();
      actions.change(MIN, PAIR_MIN);
      actions.change(MAX, PAIR_MAX);
      actions.input(MIN, typed);
      // A pair in error is checked as typed (#240 N1, N2): only a Min that
      // passes on its own and with the Max (40 or 30) clears it.
      const passes = typed === PAIR_MAX || typed === FIXED_MIN;
      check(store, passes ? 0 : 1, `typed ${typed}`);
      actions.input(MAX, typed);
      check(store, formErrorCount(store.get().form), `then Max ${typed}`);
    }
  });

  it("the backstop's FORM_ERROR is one setting to fix, and stands alone", () => {
    const { store, actions, form } = setup();
    store.set({ config: { ...store.get().config, target: { level: "high" } } });
    actions.change("character.attackPower", 900);
    assert.deepEqual(Object.keys(form().errors), [FORM_ERROR]);
    check(store, 1, "the backstop");
    actions.change("character.attackPower", -1);
    assert.ok(!(FORM_ERROR in form().errors), "a field error replaces it");
    check(store, 1, "a field instead");
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
        // Two warnings since #207: the finisher one for rules[0] (alone, as
        // a finisher is not also warned for starving), and rules[1]
        // starving Backstab.
        { action: "eviscerate", conditions: [] },
        { action: "sinister-strike", conditions: [] },
        { action: "backstab", conditions: [] },
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
      'Imported "Trap" with 2 warnings. It still runs; see What to check above.',
    );
    assert.equal(status.detail, "");
    assert.equal(
      status.warnings,
      rotationWarnings(trap).map(errorLine).join("\n"),
    );
    assert.match(
      status.warnings,
      /^Rule 1: Eviscerate \(eviscerate\) is a finisher/m,
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
      'Imported "A" with 1 warning. It still runs; see What to check above.',
    );
    assert.equal(
      importedText("A", 3),
      'Imported "A" with 3 warnings. It still runs; see What to check above.',
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
      /^File: The rotation is missing "schemaVersion"\.$/m,
    );
    // The message names no place; the readable place is written once, in
    // front (#214; U7 spec D4, #217), and no raw path is shown.
    assert.match(
      form().importStatus.detail,
      /^Rule 1: The rule is missing "action"\.$/m,
    );
    assert.match(
      form().importStatus.detail,
      /^Rule 1: The rule has unknown field "ability"\./m,
    );
    assert.doesNotMatch(form().importStatus.detail, /rules\[/);
  });

  it("a refused talent-granted rule shows its place once, in front (#189 review, #214, #217)", () => {
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
      /^Rule 1: Blade Flurry \(blade-flurry\) comes from a talent/,
    );
    assert.equal(detail.split("Rule 1").length, 2, detail);
    assert.doesNotMatch(detail, /rules\[/);
  });

  it("errorLine is the readable place from the path, then the message, or File: for the file as a whole (#214, #217)", () => {
    const line = (path, message) => errorLine({ path, message });
    // A problem with the file as a whole reads "File:" (Fran's P4 on #219).
    assert.equal(line("", "Not JSON."), "File: Not JSON.");
    assert.equal(
      line("rules[0].conditions", "Blade Flurry"),
      "Rule 1: Blade Flurry",
    );
    assert.equal(line("rules[0].action", "x"), "Rule 1: x");
    assert.equal(line("rules[0].ability", "x"), "Rule 1: x");
    assert.equal(line("rules[2].conditions[1]", "x"), "Rule 3, condition 2: x");
    assert.equal(
      line("rules[2].conditions[1].value", "x"),
      "Rule 3, condition 2: x",
    );
    assert.equal(line("name", "x"), "Rotation name: x");
    // The thrown and string forms keep the raw path.
    assert.equal(
      formatError({ path: "rules[0].action", message: "x" }),
      "rules[0].action: x",
    );
    assert.equal(
      line("schemaVersion", 'The rotation is missing "schemaVersion".'),
      'File: The rotation is missing "schemaVersion".',
    );
    assert.equal(
      line("unknownKey", 'The rotation has an unknown key "x".'),
      'File: The rotation has an unknown key "x".',
    );
    // No guessing from the text: a message is never read for a place.
    assert.equal(line("rules[1]", "rules[0]: x"), "Rule 2: rules[0]: x");
    assert.equal(line("rules", "rules is x"), "Rules: rules is x");
  });

  it("a huge refusal lists the first MAX_LISTED errors, then '…and N more'; the counts are of all (#214)", () => {
    // Kira's QA of #215: 50 rules of 10 conditions, each with an unknown
    // param, gives thousands of errors. The validator returns them all.
    const condition = { type: "fightTime", op: ">=", value: 1, x: 1, y: 2 };
    const text = JSON.stringify({
      schemaVersion: 1,
      name: "Huge",
      rules: Array.from({ length: k("rotation.maxRules") }, () => ({
        action: "sinister-strike",
        conditions: Array(k("rotation.maxConditionsPerRule")).fill(condition),
      })),
    });
    const { errors } = importRotation(text);
    assert.ok(errors.length > MAX_LISTED * 2, String(errors.length));
    const { store, actions, form } = setup();
    assert.equal(actions.importText(text), false);
    const lines = form().importStatus.detail.split("\n");
    assert.equal(lines.length, MAX_LISTED + 1);
    assert.deepEqual(
      lines.slice(0, MAX_LISTED),
      errors.slice(0, MAX_LISTED).map(errorLine),
    );
    assert.equal(lines.at(-1), `…and ${errors.length - MAX_LISTED} more`);
    // The Run bar counts what blocks Run, all of it: a refused file blocks
    // nothing, and a bad field still counts once, however long the list.
    assert.equal(blockedCount({ ...store.get(), run: {} }), 0);
    actions.change("character.critChance", 1.5);
    assert.equal(blockedCount({ ...store.get(), run: {} }), 1);
  });

  it("a huge warning list is cut the same way, and the status line counts all of it (#214)", () => {
    const unlocked = (ability) => ({ type: "abilityUnlocked", ability });
    const others = ["backstab", "eviscerate", "rupture", "slice-and-dice"];
    const rotation = {
      schemaVersion: 1,
      name: "Loud",
      rules: Array.from({ length: k("rotation.maxRules") }, (_, at) => ({
        action: "sinister-strike",
        conditions: [
          { type: "resource", resource: "energy", op: ">=", value: at + 1 },
          ...others.map(unlocked),
        ],
      })),
    };
    const warnings = rotationWarnings(rotation);
    assert.ok(warnings.length > MAX_LISTED, String(warnings.length));
    const { actions, form } = setup();
    assert.equal(actions.importText(exportRotation(rotation)), true);
    const status = form().importStatus;
    assert.equal(status.message, importedText("Loud", warnings.length));
    const lines = status.warnings.split("\n");
    assert.equal(lines.length, MAX_LISTED + 1);
    assert.equal(lines.at(-1), `…and ${warnings.length - MAX_LISTED} more`);
  });

  it("listedLines lists all of a short list, with no 'more' line", () => {
    const entries = [
      { path: "rules[0]", message: "A." },
      { path: "", message: "B." },
    ];
    assert.equal(listedLines(entries), "Rule 1: A.\nFile: B.");
    assert.equal(listedLines(entries, 1), "Rule 1: A.\n…and 1 more");
    assert.equal(MAX_LISTED, 50);
  });

  it("listedLines lists exactly MAX_LISTED entries in full, with no 'more' line; one over gives '…and 1 more' (Kira's QA on #216)", () => {
    const entries = (count) =>
      Array.from({ length: count }, (_, at) => ({
        path: `rules[${at}]`,
        message: "A.",
      }));
    const all = entries(MAX_LISTED).map(errorLine);
    assert.equal(listedLines(entries(MAX_LISTED)), all.join("\n"));
    assert.equal(listedLines(entries(MAX_LISTED)).split("\n").length, 50);
    assert.doesNotMatch(listedLines(entries(MAX_LISTED)), /more/);
    assert.equal(
      listedLines(entries(MAX_LISTED + 1)),
      [...all, "…and 1 more"].join("\n"),
    );
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

describe("a field typed in is checked again before it is used (#247)", () => {
  const MIN = "weapons.mainHand.min";
  const MAX = "weapons.mainHand.max";
  const PAIR_MIN = 50;
  const PAIR_MAX = 40;
  // Backspace on 50: a Min the pair passes with.
  const BACKSPACED = 5;
  const NOT_WHOLE = 4.5;
  const FIXED_MAX = 60;
  const run = { mode: "live", errors: {} };
  // Fran's repro, in the model: Min 50 and Max 40 committed, then Backspace
  // and 0 in Min, which gives back 50 with no change.
  const repro = () => {
    const page = setup();
    page.actions.change(MIN, PAIR_MIN);
    page.actions.change(MAX, PAIR_MAX);
    page.actions.input(MIN, BACKSPACED);
    page.actions.input(MIN, PAIR_MIN);
    return page;
  };

  it("a field typed invalid that was not in error: no config to run until it is checked", () => {
    const { store, actions, form, config } = setup();
    actions.change(MAX, FIXED_MAX);
    actions.change(MIN, PAIR_MIN);
    const stale = config();
    actions.input(MAX, PAIR_MAX);
    assert.deepEqual(form().errors, {}, "typing never adds one");
    assert.equal(
      nextRunConfig({ ...store.get(), run }),
      null,
      "never the config the fields don't show",
    );
    actions.commitEdits();
    assert.match(form().errors[MAX], /at least the min damage/);
    assert.equal(config(), stale, "the config is not written");
  });

  it("typing marks the field edited; a commit clears it", () => {
    const { actions, form } = setup();
    assert.deepEqual(form().edited, []);
    actions.input(MIN, BACKSPACED);
    actions.input(MIN, BACKSPACED);
    assert.deepEqual(form().edited, [MIN], "once per field");
    actions.change(MIN, BACKSPACED);
    assert.deepEqual(form().edited, []);
  });

  it("Fran's repro: the pair's error is back as Min reads 50 again (#240 N2), and commitEdits keeps it", () => {
    const { store, actions, form, config } = repro();
    const stale = config();
    assert.match(form().errors[MAX], /at least the min damage/);
    assert.equal(form().errors[MIN], null);
    assert.equal(blocked({ ...store.get(), run }), true, "never Ready");
    assert.equal(form().values[MIN], PAIR_MIN);
    assert.equal(form().values[MAX], PAIR_MAX);
    assert.notEqual(stale.weapons.mainHand.max, PAIR_MAX, "the old Max");
    assert.equal(
      nextRunConfig({ ...store.get(), run }),
      null,
      "never the config the fields don't show",
    );
    actions.commitEdits();
    assert.match(form().errors[MAX], /at least the min damage/);
    assert.equal(form().errors[MIN], null);
    assert.deepEqual(form().edited, []);
    assert.equal(blocked({ ...store.get(), run }), true);
    assert.equal(nextRunConfig({ ...store.get(), run }), null);
    assert.equal(config(), stale, "the config is not written");
  });

  it("checking a passing edit writes the config the fields show", () => {
    const { store, actions, form, config } = repro();
    actions.input(MAX, FIXED_MAX);
    assert.deepEqual(form().edited, [MIN, MAX]);
    actions.commitEdits();
    assert.deepEqual(form().errors, {});
    const next = nextRunConfig({ ...store.get(), run });
    assert.equal(next.weapons.mainHand.min, PAIR_MIN);
    assert.equal(next.weapons.mainHand.max, FIXED_MAX);
    assert.equal(config().weapons.mainHand.max, FIXED_MAX);
  });

  it("commitEdits with nothing typed writes nothing", () => {
    const { store, actions } = setup();
    const before = store.get().form;
    actions.commitEdits();
    assert.equal(store.get().form, before);
  });

  it("any commit checks the typed fields too, not only the one changed", () => {
    const { actions, form, config } = repro();
    const stale = config();
    const other = form().rotationOptions.find(
      ({ id }) => id !== form().rotationChoice,
    );
    actions.chooseRotation(other.id);
    assert.match(form().errors[MAX], /at least the min damage/);
    assert.equal(config().weapons, stale.weapons, "no stale pair written");
  });

  it("nextRunConfig counts as Run does: formErrorCount (nit 3)", () => {
    const { store } = setup();
    const state = (errors) => ({
      ...store.get(),
      form: { ...store.get().form, errors },
      run,
    });
    assert.equal(nextRunConfig(state({ [MAX]: "Pair." })), null);
    // A lone null (never written now, #237) is no setting to fix: Run is
    // enabled, so the run starts.
    const lone = state({ [MIN]: null });
    assert.equal(blocked(lone), false);
    assert.notEqual(nextRunConfig(lone), null);
  });

  it("Max typed invalid on its own swaps the pair's error for its own (nit 5; #240 N1)", () => {
    const { store, actions, form } = setup();
    actions.change(MIN, PAIR_MIN);
    actions.change(MAX, PAIR_MAX);
    actions.input(MAX, NOT_WHOLE);
    assert.doesNotMatch(
      form().errors[MAX],
      /at least the min/,
      "no stale pair message",
    );
    assert.ok(!(MIN in form().errors));
    assert.equal(formErrorCount(form()), 1);
    assert.equal(blocked({ ...store.get(), run }), true);
    actions.change(MAX, NOT_WHOLE);
    assert.equal(typeof form().errors[MAX], "string");
    assert.doesNotMatch(form().errors[MAX], /at least the min/);
    assert.ok(!(MIN in form().errors));
  });

  it("a field in error is checked as typed: its message follows the value (#240 N1)", () => {
    const TYPED_MAX = 45;
    const { store, actions, form } = setup();
    actions.change(MIN, PAIR_MIN);
    actions.change(MAX, NOT_WHOLE);
    assert.match(form().errors[MAX], /whole number/);
    actions.input(MAX, TYPED_MAX);
    assert.match(form().errors[MAX], /at least the min damage/, "no blur");
    assert.equal(form().errors[MIN], null);
    actions.input(MAX, FIXED_MAX);
    assert.deepEqual(form().errors, {});
    assert.equal(blocked({ ...store.get(), run }), false);
    actions.input(MAX, PAIR_MAX);
    assert.match(form().errors[MAX], /at least the min damage/, "back again");
  });

  it("a field not in error when typing began is still never marked by typing", () => {
    const { actions, form } = setup();
    actions.change(MIN, PAIR_MIN);
    actions.input("character.attackPower", -1);
    assert.deepEqual(form().errors, {});
    actions.commitEdits();
    assert.equal(typeof form().errors["character.attackPower"], "string");
  });

  it("a typed Max still under the Min keeps the pair's error", () => {
    const { actions, form } = setup();
    actions.change(MIN, PAIR_MIN);
    actions.change(MAX, PAIR_MAX);
    actions.input(MAX, BACKSPACED);
    assert.match(form().errors[MAX], /at least the min damage/);
    assert.equal(form().errors[MIN], null);
    actions.input(MAX, FIXED_MAX);
    assert.deepEqual(form().errors, {});
  });
});
