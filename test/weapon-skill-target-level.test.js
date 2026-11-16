// #318 (Phase 5): the Weapon skill field on Character › Stats and the
// Target level field in Fight (Fran's qa-319 P1). Blank is null and follows
// the level (level x 5; your level + 3);
// the bounds are the engine's; a typed value round-trips through a share
// link and a blank one stays out of it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { k } from "../data/constants.js";
import { defaultWeaponSkill, maxWeaponSkill } from "../js/attack-resolver.js";
import {
  decodeSetup,
  encodeSetup,
  setupDefaults,
  setupFromState,
} from "../js/build-codec.js";
import {
  FORM_ERROR,
  MIN_WEAPON_SKILL,
  OPTIONAL_FIELDS,
  createConfigForm,
  formFromConfig,
  levelsInfo,
  nextRunConfig,
  validateValues,
} from "../js/config-form.js";
import { targetLevel } from "../js/levels.js";
import { legacyPageConfig } from "../js/legacy-page.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { createTalentTree } from "../js/talent-tree.js";
import {
  BOTH_HANDS,
  RAID_BOSS,
  TARGET_LEVEL_EFFECT,
  TYPED_STAYS,
  targetLevelHelpText,
  weaponSkillHelpText,
} from "../js/views/config-form.js";
import { characterRows } from "../js/views/character-screens.js";
import {
  NO_BREAK_SPACE,
  blockedCount,
  controlsModel,
  summaryText,
  targetPart,
} from "../js/views/run-model.js";
import { fightStatus, formStatus } from "../js/views/sections.js";

const SKILL = "character.weaponSkill";
const TARGET = "target.level";
const MAX_LEVEL = k("character.level");
const LOW_LEVEL = 40;
const { min: TARGET_MIN, max: TARGET_MAX } = k("target.levelRange");
const RUN = { mode: "batch", duration: 300, iterations: 1000, seed: null };

function setup(config = legacyPageConfig()) {
  const store = createStore({ config: normalizeConfig(config) });
  const actions = createConfigForm(store);
  return { store, actions, form: () => store.get().form };
}

const withConfig = (config) => ({ config, run: RUN });
const payloadOf = (text) =>
  JSON.parse(Buffer.from(text.slice(2), "base64url").toString());

describe("the bounds are the engine's (#318)", () => {
  it("a blank weapon skill is level x 5, capped at level x 5 + 50", () => {
    for (const level of [1, LOW_LEVEL, MAX_LEVEL]) {
      const { weaponSkill } = levelsInfo(level);
      assert.equal(weaponSkill.blank, defaultWeaponSkill(level));
      assert.equal(weaponSkill.max, maxWeaponSkill(level));
      assert.equal(weaponSkill.min, MIN_WEAPON_SKILL);
    }
    assert.deepEqual(
      { ...levelsInfo(MAX_LEVEL).weaponSkill },
      { blank: 300, perLevel: 5, min: 1, max: 350 },
    );
  });

  it("the engine takes the field's lowest and highest skill, and refuses one past them", () => {
    const at =
      (weaponSkill, talentLevel = MAX_LEVEL) =>
      () =>
        normalizeConfig({
          ...legacyPageConfig(),
          // Page defaults spend 51 points (#333); empty talents when the
          // level can't hold them so the weapon-skill bounds stay in view.
          talents: talentLevel < MAX_LEVEL ? {} : legacyPageConfig().talents,
          talentLevel,
          character: { ...legacyPageConfig().character, weaponSkill },
        });
    for (const level of [LOW_LEVEL, MAX_LEVEL]) {
      const { min, max } = levelsInfo(level).weaponSkill;
      assert.doesNotThrow(at(min, level));
      assert.doesNotThrow(at(max, level));
      assert.throws(at(min - 1, level), RangeError);
      assert.throws(at(max + 1, level), RangeError);
    }
  });

  it("a blank target level is your level + 3; the engine takes 1 to 63 and no more", () => {
    for (const level of [1, LOW_LEVEL, MAX_LEVEL]) {
      assert.equal(
        levelsInfo(level).targetLevel.blank,
        targetLevel({ talentLevel: level, target: { level: null } }),
      );
    }
    assert.equal(levelsInfo(MAX_LEVEL).targetLevel.blank, 63);
    const at = (level) => () =>
      normalizeConfig({
        ...legacyPageConfig(),
        target: { ...legacyPageConfig().target, level },
      });
    assert.doesNotThrow(at(TARGET_MIN));
    assert.doesNotThrow(at(TARGET_MAX));
    assert.throws(at(TARGET_MIN - 1), RangeError);
    assert.throws(at(TARGET_MAX + 1), RangeError);
    assert.deepEqual([TARGET_MIN, TARGET_MAX], [1, 63]);
  });

  it("the help says what blank gives and what it does, in plain words", () => {
    const nb = NO_BREAK_SPACE;
    assert.equal(
      weaponSkillHelpText(levelsInfo(MAX_LEVEL)),
      `Leave blank for 300 (your level${nb}×${nb}5). At most 350 at level 60. Applies to both hands. Typed values stay fixed when you change level.`,
    );
    assert.equal(
      targetLevelHelpText(levelsInfo(MAX_LEVEL)),
      `Leave blank for 63 (your level${nb}+${nb}3, a raid boss). From 1 to 63. Higher levels mean more misses and glancing blows. Typed values stay fixed when you change level.`,
    );
    assert.equal(
      weaponSkillHelpText(levelsInfo(LOW_LEVEL)),
      `Leave blank for 200 (your level${nb}×${nb}5). At most 250 at level 40. Applies to both hands. Typed values stay fixed when you change level.`,
    );
    assert.equal(BOTH_HANDS, "Applies to both hands.");
    assert.equal(
      TARGET_LEVEL_EFFECT,
      "Higher levels mean more misses and glancing blows.",
    );
    assert.equal(TYPED_STAYS, "Typed values stay fixed when you change level.");
  });

  it("names a raid boss only when blank gives the boss's level (qa-319 D-P1)", () => {
    const nb = NO_BREAK_SPACE;
    const at60 = targetLevelHelpText(levelsInfo(MAX_LEVEL));
    assert.equal(levelsInfo(MAX_LEVEL).targetLevel.boss, 63);
    assert.match(
      at60,
      new RegExp(
        `^Leave blank for 63 \\(your level${nb}\\+${nb}3${RAID_BOSS}\\)\\. `,
      ),
    );
    assert.equal(RAID_BOSS, ", a raid boss");
    const at40 = targetLevelHelpText(levelsInfo(LOW_LEVEL));
    assert.equal(
      at40,
      `Leave blank for 43 (your level${nb}+${nb}3). From 1 to 63. Higher levels mean more misses and glancing blows. Typed values stay fixed when you change level.`,
    );
    assert.doesNotMatch(at40, /raid boss/);
  });

  it("the formula's operator never starts or ends a line (Fran's qa-319 N2)", () => {
    for (const text of [
      weaponSkillHelpText(levelsInfo(MAX_LEVEL)),
      targetLevelHelpText(levelsInfo(MAX_LEVEL)),
    ]) {
      assert.doesNotMatch(text, / [×+]|[×+] /, text);
      assert.match(text, /level\u00A0[×+]\u00A0\d/, text);
    }
  });

  it('says "target", never "enemy" (Fran\'s qa-319 P1)', () => {
    for (const text of [
      targetLevelHelpText(levelsInfo(MAX_LEVEL)),
      weaponSkillHelpText(levelsInfo(MAX_LEVEL)),
    ]) {
      assert.doesNotMatch(text, /enemy/i);
    }
  });
});

describe("the form: blank is the default (#318)", () => {
  it("target level starts blank (null) and says what blank is; weapon skill is not a field", () => {
    const { form } = setup();
    assert.deepEqual(OPTIONAL_FIELDS, [TARGET]);
    assert.ok(!Object.hasOwn(form().values, SKILL));
    assert.equal(form().values[TARGET], null);
    assert.equal(form().levels.weaponSkill.blank, 300);
    assert.equal(form().levels.targetLevel.blank, 63);
    assert.deepEqual(form().errors, {});
  });

  it("a typed target level reaches the config; blank again is null", () => {
    const { store, actions } = setup();
    actions.change(TARGET, 61);
    assert.equal(store.get().config.target.level, 61);
    assert.deepEqual(store.get().form.errors, {});
    actions.change(TARGET, "");
    assert.equal(store.get().config.target.level, null);
    assert.equal(store.get().form.values[TARGET], null);
    assert.notEqual(nextRunConfig(store.get()), null);
  });

  it("a value out of bounds, not whole or not a number is a plain error, and Run is off", () => {
    const cases = [
      [TARGET, 64, "Target level must be a whole number from 1 to 63."],
      [TARGET, 0, "Target level must be a whole number from 1 to 63."],
      [TARGET, 62.5, "Target level must be a whole number from 1 to 63."],
      [TARGET, Number.NaN, "Enter a number, or leave it blank."],
    ];
    for (const [path, value, message] of cases) {
      const { store, actions } = setup();
      const before = store.get().config;
      actions.change(path, value);
      assert.equal(store.get().form.errors[path], message, `${path} ${value}`);
      assert.ok(!(FORM_ERROR in store.get().form.errors));
      assert.equal(store.get().config, before, `${path} ${value}`);
      assert.equal(nextRunConfig(store.get()), null);
    }
  });

  it("the lowest and highest values pass", () => {
    for (const [path, value] of [
      [TARGET, TARGET_MIN],
      [TARGET, TARGET_MAX],
    ]) {
      const { store, actions } = setup();
      actions.change(path, value);
      assert.deepEqual(store.get().form.errors, {}, `${path} ${value}`);
    }
  });

  it("validateValues no longer checks a weapon skill field; the engine still bounds the config", () => {
    const values = formFromConfig(normalizeConfig(legacyPageConfig())).values;
    assert.equal(
      validateValues(values, levelsInfo(MAX_LEVEL))[SKILL],
      undefined,
    );
    assert.equal(
      validateValues({ ...values, [SKILL]: 300 }, levelsInfo(LOW_LEVEL))[SKILL],
      undefined,
    );
    assert.throws(() =>
      normalizeConfig({
        ...legacyPageConfig(),
        talents: {},
        talentLevel: LOW_LEVEL,
        character: { ...legacyPageConfig().character, weaponSkill: 300 },
      }),
    );
  });

  it("the Stats summary names a config weapon skill, as haste, and never the target (#319, qa-319 P1)", () => {
    const { store, actions } = setup();
    const summary = (config = store.get().config) =>
      characterRows(store.get().form, config).stats.summary;
    assert.doesNotMatch(summary(), /weapon skill|target|enemy/);
    const withSkill = structuredClone(store.get().config);
    withSkill.character.weaponSkill = 315;
    assert.match(summary(withSkill), / · 7% hit · 315 weapon skill$/);
    actions.change(TARGET, 62);
    assert.match(summary(withSkill), / · 7% hit · 315 weapon skill$/);
    withSkill.character.haste = 0.05;
    assert.match(summary(withSkill), / · 5% haste · 315 weapon skill$/);
    withSkill.character.weaponSkill = null;
    assert.doesNotMatch(summary(withSkill), /weapon skill|target|enemy/);
  });

  // Its "·" follows a no-break space, so a wrapped line never starts with it
  // (qa-319 D-N2).
  it("the run summary and Ready line name a typed target level, last (qa-319 P1, D-N2)", () => {
    const { store, actions } = setup();
    const nb = NO_BREAK_SPACE;
    const state = () => ({ ...store.get(), run: { ...RUN, seed: 42 } });
    assert.equal(targetPart(store.get().form), null);
    assert.doesNotMatch(summaryText(state().run, state().form), /target/);
    actions.change(TARGET, 62);
    assert.equal(targetPart(store.get().form), `target level${nb}62`);
    assert.equal(
      summaryText(state().run, state().form),
      `Average · 1,000 × 300${nb}s · seed${nb}42${nb}· target level${nb}62`,
    );
    assert.equal(
      summaryText({ ...state().run, mode: "live" }, state().form),
      `Live fight · 300${nb}s · seed${nb}42${nb}· target level${nb}62`,
    );
    const batch = { status: "idle", result: null, progress: null, error: null };
    assert.match(
      controlsModel({ ...state(), batch, ran: {} }).status,
      new RegExp(`^Ready · .* · seed${nb}42${nb}· target level${nb}62$`),
    );
    actions.change(TARGET, 64);
    assert.equal(targetPart(store.get().form), `target level${nb}?`);
    actions.change(TARGET, null);
    assert.equal(targetPart(store.get().form), null);
    // The summary without a form is the run's alone, as before.
    assert.doesNotMatch(summaryText(state().run), /target/);
  });

  it("a target level error is Fight's (the weapon skill field is gone)", () => {
    const { store, actions } = setup();
    const at = () => ({ ...store.get(), run: { ...RUN, errors: {} } });
    actions.change(TARGET, 99);
    assert.equal(
      characterRows(store.get().form, store.get().config).stats.fix,
      0,
    );
    assert.equal(formStatus(at()).errors, 0);
    assert.equal(fightStatus(at()).errors, 1);
    assert.equal(
      formStatus(at()).errors + fightStatus(at()).errors,
      blockedCount(at()),
    );
    actions.change(TARGET, null);
    assert.equal(fightStatus(at()).errors, 0);
  });
});

describe("the level moves the weapon skill's cap (#318)", () => {
  // Page defaults spend 51 points (#333); clear them before dropping level.
  it("a lower level follows: the blank and the cap move with it", () => {
    const { store } = setup();
    const tree = createTalentTree(store);
    tree.resetAll();
    tree.setLevel(String(LOW_LEVEL));
    assert.equal(store.get().config.talentLevel, LOW_LEVEL);
    assert.equal(store.get().form.levels.weaponSkill.blank, 200);
    assert.equal(store.get().form.levels.weaponSkill.max, 250);
    assert.equal(store.get().form.levels.targetLevel.blank, 43);
    assert.deepEqual(store.get().form.errors, {});
  });

  it("dropping the level no longer puts a weapon skill error on the form", () => {
    const { store } = setup();
    const tree = createTalentTree(store);
    tree.resetAll();
    const next = structuredClone(store.get().config);
    next.character = { ...next.character, weaponSkill: 350 };
    store.set({ config: next });
    assert.doesNotThrow(() => tree.setLevel(String(LOW_LEVEL)));
    assert.equal(store.get().config.talentLevel, LOW_LEVEL);
    assert.ok(!Object.hasOwn(store.get().form.values, SKILL));
    assert.equal(store.get().form.errors[SKILL], undefined);
    // The engine still refuses a skill past the cap (the bounds describe).
    assert.throws(
      () =>
        normalizeConfig({
          ...legacyPageConfig(),
          talents: {},
          talentLevel: LOW_LEVEL,
          character: { ...legacyPageConfig().character, weaponSkill: 350 },
        }),
      RangeError,
    );
  });

  it("a typed target level stays fixed through a level change", () => {
    const { store, actions } = setup();
    const tree = createTalentTree(store);
    tree.resetAll();
    actions.change(TARGET, 62);
    for (const level of [LOW_LEVEL, MAX_LEVEL]) {
      assert.doesNotThrow(() => tree.setLevel(String(level)));
      assert.equal(store.get().config.target.level, 62, `level ${level}`);
      assert.equal(store.get().form.values[TARGET], 62, `level ${level}`);
    }
  });

  it("a config skill under the lower cap stays as set", () => {
    const { store } = setup();
    const tree = createTalentTree(store);
    tree.resetAll();
    const next = structuredClone(store.get().config);
    next.character = { ...next.character, weaponSkill: 240 };
    store.set({ config: normalizeConfig(next) });
    tree.setLevel(String(LOW_LEVEL));
    assert.equal(store.get().config.character.weaponSkill, 240);
    assert.deepEqual(store.get().form.errors, {});
  });
});

describe("share links (#318)", () => {
  it("a blank weapon skill and target level stay out of the link", () => {
    const { store } = setup();
    const text = encodeSetup(setupFromState({ ...store.get(), run: RUN }));
    assert.equal(text, encodeSetup(setupDefaults()));
    assert.equal(payloadOf(text).config, undefined);
  });

  it("a config weapon skill and a typed target level are in the link and round-trip", () => {
    const { store, actions } = setup();
    const next = structuredClone(store.get().config);
    next.character = { ...next.character, weaponSkill: 315 };
    store.set({ config: normalizeConfig(next) });
    actions.change(TARGET, 62);
    const text = encodeSetup(setupFromState({ ...store.get(), run: RUN }));
    assert.deepEqual(payloadOf(text).config, {
      character: { weaponSkill: 315 },
      target: { level: 62 },
    });
    const read = decodeSetup(text);
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.character.weaponSkill, 315);
    assert.equal(read.setup.config.target.level, 62);
    const back = setup(read.setup.config);
    assert.ok(!Object.hasOwn(back.form().values, SKILL));
    assert.equal(back.form().values[TARGET], 62);
    assert.equal(back.store.get().config.character.weaponSkill, 315);
    assert.deepEqual(back.form().errors, {});
  });

  it("blank again after a typed value is out of the link again", () => {
    const { store, actions } = setup();
    const next = structuredClone(store.get().config);
    next.character = { ...next.character, weaponSkill: 315 };
    store.set({ config: normalizeConfig(next) });
    next.character = { ...store.get().config.character, weaponSkill: null };
    store.set({
      config: normalizeConfig({
        ...store.get().config,
        character: next.character,
      }),
    });
    actions.change(TARGET, 50);
    actions.change(TARGET, null);
    assert.equal(
      encodeSetup(setupFromState({ ...store.get(), run: RUN })),
      encodeSetup(setupDefaults()),
    );
  });

  it("a link's out-of-bounds value is refused, as the engine refuses it", () => {
    const d = setupDefaults();
    for (const config of [
      { ...d.config, character: { ...d.config.character, weaponSkill: 351 } },
      { ...d.config, target: { ...d.config.target, level: 64 } },
    ]) {
      assert.equal(
        decodeSetup(encodeSetup(withConfig(config))).status,
        "corrupt",
      );
    }
  });
});
