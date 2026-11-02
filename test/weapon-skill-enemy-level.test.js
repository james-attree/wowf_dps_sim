// #318 (Phase 5): the Weapon skill and Enemy level fields on Character ›
// Stats. Blank is null and follows the level (level x 5; your level + 3);
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
  enemyLevelHelpText,
  weaponSkillHelpText,
} from "../js/views/config-form.js";
import { characterRows } from "../js/views/character-screens.js";

const SKILL = "character.weaponSkill";
const ENEMY = "target.level";
const MAX_LEVEL = k("character.level");
const LOW_LEVEL = 40;
const { min: ENEMY_MIN, max: ENEMY_MAX } = k("target.levelRange");
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

  it("a blank enemy level is your level + 3; the engine takes 1 to 63 and no more", () => {
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
    assert.doesNotThrow(at(ENEMY_MIN));
    assert.doesNotThrow(at(ENEMY_MAX));
    assert.throws(at(ENEMY_MIN - 1), RangeError);
    assert.throws(at(ENEMY_MAX + 1), RangeError);
    assert.deepEqual([ENEMY_MIN, ENEMY_MAX], [1, 63]);
  });

  it("the help says what blank gives, in plain words", () => {
    assert.equal(
      weaponSkillHelpText(levelsInfo(MAX_LEVEL)),
      "Leave blank for 300 (your level × 5). At most 350 at level 60. Typed values stay fixed when you change level.",
    );
    assert.equal(
      enemyLevelHelpText(levelsInfo(MAX_LEVEL)),
      "Leave blank for 63 (your level + 3). From 1 to 63. Typed values stay fixed when you change level.",
    );
    assert.equal(
      weaponSkillHelpText(levelsInfo(LOW_LEVEL)),
      "Leave blank for 200 (your level × 5). At most 250 at level 40. Typed values stay fixed when you change level.",
    );
  });
});

describe("the form: blank is the default (#318)", () => {
  it("both start blank (null) and say what blank is", () => {
    const { form } = setup();
    assert.deepEqual(OPTIONAL_FIELDS, [SKILL, ENEMY]);
    assert.equal(form().values[SKILL], null);
    assert.equal(form().values[ENEMY], null);
    assert.equal(form().levels.weaponSkill.blank, 300);
    assert.equal(form().levels.targetLevel.blank, 63);
    assert.deepEqual(form().errors, {});
  });

  it("a typed value reaches the config; blank again is null", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 310);
    actions.change(ENEMY, 61);
    assert.equal(store.get().config.character.weaponSkill, 310);
    assert.equal(store.get().config.target.level, 61);
    assert.deepEqual(store.get().form.errors, {});
    actions.change(SKILL, null);
    actions.change(ENEMY, "");
    assert.equal(store.get().config.character.weaponSkill, null);
    assert.equal(store.get().config.target.level, null);
    assert.equal(store.get().form.values[ENEMY], null);
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
      [ENEMY, 64, "Enemy level must be a whole number from 1 to 63."],
      [ENEMY, 0, "Enemy level must be a whole number from 1 to 63."],
      [ENEMY, 62.5, "Enemy level must be a whole number from 1 to 63."],
      [ENEMY, Number.NaN, "Enter a number, or leave it blank."],
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
      [ENEMY, ENEMY_MIN],
      [ENEMY, ENEMY_MAX],
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

  it("the Stats summary names them only when typed, as haste (#319)", () => {
    const { store, actions } = setup();
    const summary = () => characterRows(store.get().form).stats.summary;
    assert.doesNotMatch(summary(), /weapon skill|enemy level/);
    actions.change(SKILL, 315);
    assert.match(summary(), / · 7% hit · 315 weapon skill$/);
    actions.change(ENEMY, 62);
    assert.match(summary(), / · 315 weapon skill · enemy level 62$/);
    actions.change("character.haste", 0.05);
    assert.match(summary(), / · 5% haste · 315 weapon skill · enemy level 62$/);
    actions.change(SKILL, null);
    actions.change(ENEMY, null);
    assert.doesNotMatch(summary(), /weapon skill|enemy level/);
  });

  it("an error counts on the Stats row's chip", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 999);
    actions.change(ENEMY, 99);
    assert.equal(characterRows(store.get().form).stats.fix, 2);
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

  it("a typed enemy level stays fixed through a level change, and so does 350 once back at 60", () => {
    const { store, actions } = setup();
    const tree = createTalentTree(store);
    actions.change(SKILL, 350);
    actions.change(ENEMY, 62);
    for (const level of [LOW_LEVEL, MAX_LEVEL]) {
      assert.doesNotThrow(() => tree.setLevel(String(level)));
      assert.equal(store.get().config.target.level, 62, `level ${level}`);
      assert.equal(store.get().form.values[ENEMY], 62, `level ${level}`);
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
  it("a blank weapon skill and enemy level stay out of the link", () => {
    const { store } = setup();
    const text = encodeSetup(setupFromState({ ...store.get(), run: RUN }));
    assert.equal(text, encodeSetup(setupDefaults()));
    assert.equal(payloadOf(text).config, undefined);
  });

  it("typed values are in the link, alone, and round-trip into the form", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 315);
    actions.change(ENEMY, 62);
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
    assert.equal(back.form().values[ENEMY], 62);
    assert.deepEqual(back.form().errors, {});
  });

  it("blank again after a typed value is out of the link again", () => {
    const { store, actions } = setup();
    actions.change(SKILL, 315);
    actions.change(SKILL, null);
    actions.change(ENEMY, 50);
    actions.change(ENEMY, null);
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
