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
  pageDefaultConfig,
  validateValues,
} from "../js/config-form.js";
import { targetLevel } from "../js/levels.js";
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

function setup(config = pageDefaultConfig()) {
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
          ...pageDefaultConfig(),
          talentLevel,
          character: { ...pageDefaultConfig().character, weaponSkill },
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
        ...pageDefaultConfig(),
        target: { ...pageDefaultConfig().target, level },
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
  it("both start blank (null) and say what blank is", () => {
    const { form } = setup();
    assert.deepEqual(OPTIONAL_FIELDS, [SKILL, TARGET]);
    assert.equal(form().values[SKILL], null);
    assert.equal(form().values[TARGET], null);
    assert.equal(form().levels.weaponSkill.blank, 300);
    assert.equal(form().levels.targetLevel.blank, 63);
    assert.deepEqual(form().errors, {});
  });

  it("a typed value reaches the config; blank again is null", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 310);
    actions.change(TARGET, 61);
    assert.equal(store.get().config.character.weaponSkill, 310);
    assert.equal(store.get().config.target.level, 61);
    assert.deepEqual(store.get().form.errors, {});
    actions.change(SKILL, null);
    actions.change(TARGET, "");
    assert.equal(store.get().config.character.weaponSkill, null);
    assert.equal(store.get().config.target.level, null);
    assert.equal(store.get().form.values[TARGET], null);
    assert.notEqual(nextRunConfig(store.get()), null);
  });

  it("a value out of bounds, not whole or not a number is a plain error, and Run is off", () => {
    const cases = [
      [
        SKILL,
        351,
        "Weapon skill must be a whole number from 1 to 350 at level 60.",
      ],
      [
        SKILL,
        0,
        "Weapon skill must be a whole number from 1 to 350 at level 60.",
      ],
      [
        SKILL,
        305.5,
        "Weapon skill must be a whole number from 1 to 350 at level 60.",
      ],
      [SKILL, Number.NaN, "Enter a number, or leave it blank."],
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
      [SKILL, 1],
      [SKILL, 350],
      [TARGET, TARGET_MIN],
      [TARGET, TARGET_MAX],
    ]) {
      const { store, actions } = setup();
      actions.change(path, value);
      assert.deepEqual(store.get().form.errors, {}, `${path} ${value}`);
    }
  });

  it("validateValues checks the weapon skill at the level it is given", () => {
    const values = {
      ...formFromConfig(normalizeConfig(pageDefaultConfig())).values,
      [SKILL]: 300,
    };
    assert.equal(
      validateValues(values, levelsInfo(MAX_LEVEL))[SKILL],
      undefined,
    );
    assert.equal(
      validateValues(values, levelsInfo(LOW_LEVEL))[SKILL],
      "Weapon skill must be a whole number from 1 to 250 at level 40.",
    );
  });

  it("the Stats summary names a typed weapon skill, as haste, and never the target (#319, qa-319 P1)", () => {
    const { store, actions } = setup();
    const summary = () => characterRows(store.get().form).stats.summary;
    assert.doesNotMatch(summary(), /weapon skill|target|enemy/);
    actions.change(SKILL, 315);
    assert.match(summary(), / · 7% hit · 315 weapon skill$/);
    actions.change(TARGET, 62);
    assert.match(summary(), / · 7% hit · 315 weapon skill$/);
    actions.change("character.haste", 0.05);
    assert.match(summary(), / · 5% haste · 315 weapon skill$/);
    actions.change(SKILL, null);
    assert.doesNotMatch(summary(), /weapon skill|target|enemy/);
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

  it("a weapon skill error is Character's (the Stats chip); a target level one is Fight's", () => {
    const { store, actions } = setup();
    const at = () => ({ ...store.get(), run: { ...RUN, errors: {} } });
    actions.change(SKILL, 999);
    assert.equal(characterRows(store.get().form).stats.fix, 1);
    assert.equal(formStatus(at()).errors, 1);
    assert.equal(fightStatus(at()).errors, 0);
    actions.change(TARGET, 99);
    assert.equal(characterRows(store.get().form).stats.fix, 1);
    assert.equal(formStatus(at()).errors, 1);
    assert.equal(fightStatus(at()).errors, 1);
    // Every error is in exactly one area: they add up to Run's count.
    assert.equal(
      formStatus(at()).errors + fightStatus(at()).errors,
      blockedCount(at()),
    );
    actions.change(SKILL, null);
    assert.equal(characterRows(store.get().form).stats.fix, 0);
    assert.equal(formStatus(at()).errors, 0);
    assert.equal(fightStatus(at()).errors, 1);
  });
});

describe("the level moves the weapon skill's cap (#318)", () => {
  it("a lower level follows: the blank and the cap move with it", () => {
    const { store } = setup();
    const tree = createTalentTree(store);
    tree.setLevel(String(LOW_LEVEL));
    assert.equal(store.get().config.talentLevel, LOW_LEVEL);
    assert.equal(store.get().form.levels.weaponSkill.blank, 200);
    assert.equal(store.get().form.levels.weaponSkill.max, 250);
    assert.equal(store.get().form.levels.targetLevel.blank, 43);
    assert.deepEqual(store.get().form.errors, {});
  });

  it("a typed skill over the lower level's cap is an error and blocks Run, and is fine again back at 60", () => {
    const { store, actions } = setup();
    const tree = createTalentTree(store);
    actions.change(SKILL, 350);
    assert.doesNotThrow(() => tree.setLevel(String(LOW_LEVEL)));
    assert.equal(store.get().config.talentLevel, LOW_LEVEL);
    // The config stays one the engine runs; the form keeps what was typed.
    assert.equal(store.get().config.character.weaponSkill, null);
    assert.doesNotThrow(() => normalizeConfig(store.get().config));
    assert.equal(store.get().form.values[SKILL], 350);
    assert.equal(
      store.get().form.errors[SKILL],
      "Weapon skill must be a whole number from 1 to 250 at level 40.",
    );
    assert.equal(nextRunConfig(store.get()), null);
    tree.setLevel(String(MAX_LEVEL));
    assert.equal(store.get().config.talentLevel, MAX_LEVEL);
    assert.deepEqual(store.get().form.errors, {});
    assert.equal(store.get().form.values[SKILL], 350);
    assert.equal(store.get().form.levels.weaponSkill.max, 350);
    assert.equal(store.get().config.character.weaponSkill, 350);
    assert.notEqual(nextRunConfig(store.get()), null);
  });

  it("a typed target level stays fixed through a level change, and so does 350 once back at 60", () => {
    const { store, actions } = setup();
    const tree = createTalentTree(store);
    actions.change(SKILL, 350);
    actions.change(TARGET, 62);
    for (const level of [LOW_LEVEL, MAX_LEVEL]) {
      assert.doesNotThrow(() => tree.setLevel(String(level)));
      assert.equal(store.get().config.target.level, 62, `level ${level}`);
      assert.equal(store.get().form.values[TARGET], 62, `level ${level}`);
    }
    assert.equal(store.get().config.character.weaponSkill, 350);
  });

  it("a typed skill under the lower cap stays as typed", () => {
    const { store, actions } = setup();
    const tree = createTalentTree(store);
    actions.change(SKILL, 240);
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

  it("typed values are in the link, alone, and round-trip into the form", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 315);
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
    assert.equal(back.form().values[SKILL], 315);
    assert.equal(back.form().values[TARGET], 62);
    assert.deepEqual(back.form().errors, {});
  });

  it("blank again after a typed value is out of the link again", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 315);
    actions.change(SKILL, null);
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
