// #326: the launch polish pulled from #287, the parts with no page to draw.
// The page's parts are browser-tests/launch-polish-326.browser.mjs's.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  decodeSetup,
  encodeSetup,
  resolveInitialSetup,
  setupDefaults,
} from "../js/build-codec.js";
import { createConfigForm, pageDefaultConfig } from "../js/config-form.js";
import { createPresetBuild, pickedText } from "../js/preset-build.js";
import { referenceBuild } from "../js/preset-reference-builds.js";
import { createRotationBuilder } from "../js/rotation-builder.js";
import { presetRotation } from "../js/rotation-presets.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { createTalentTree } from "../js/talent-tree.js";
import { firstFormError } from "../js/views/run-model.js";
import { resetText } from "../js/views/share-link.js";
import {
  STALE_ANNOUNCEMENT,
  changedNames,
  namesText,
} from "../js/views/stale.js";

const ASSASSINATION = "assassination-daggers";
const COMBAT = "combat-swords";
const textOf = (payload) =>
  `1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
const fixture = JSON.parse(
  await readFile(new URL("./fixtures/setups-326.json", import.meta.url)),
);

describe.skip("#326: old links and saves still load, the same (#332)", () => {
  for (const [name, { text, setup, written }] of Object.entries(
    fixture.setups,
  )) {
    it(`${name}: as a link and as a save, written back as main wrote it`, () => {
      const link = decodeSetup(text);
      assert.equal(link.status, "ok");
      assert.deepEqual(link.setup, setup);
      assert.equal(encodeSetup(link.setup), written);
      const saved = decodeSetup(text, { strict: false });
      assert.deepEqual(saved, { status: "ok", setup });
      const first = resolveInitialSetup({ search: "", saved: text });
      assert.deepEqual(first.setup, setup);
      assert.equal(first.reset, undefined, "nothing reset, no banner");
      const opened = resolveInitialSetup({ search: `?s=${text}` });
      assert.equal(opened.notice, "loaded");
      assert.deepEqual(opened.setup, setup);
    });
  }
});

// TR-02 / #332: skipped until #333 restores presets.
describe.skip("#326 item 13: a save's bad field resets alone, and is named", () => {
  it("an armour of -1 keeps the target's level and names the armour", () => {
    const text = textOf({ config: { target: { level: 62, armor: -1 } } });
    const read = resolveInitialSetup({ saved: text });
    assert.equal(read.setup.config.target.level, 62);
    assert.equal(read.setup.config.target.armor, null);
    assert.deepEqual(read.reset, ["target.armor"]);
    assert.equal(
      resetText(read.reset),
      "Part of your saved setup couldn't be read, so the target's armour is back to its default.",
    );
    // A link is still refused whole: its format is strict.
    assert.equal(decodeSetup(text).status, "corrupt");
  });

  it("one bad stat keeps the others; a bad run field is named too", () => {
    const text = textOf({
      config: { character: { haste: "fast", attackPower: 900 } },
      run: { duration: -5, mode: "live" },
    });
    const read = resolveInitialSetup({ saved: text });
    const d = setupDefaults();
    assert.equal(read.setup.config.character.attackPower, 900);
    assert.equal(read.setup.config.character.haste, d.config.character.haste);
    assert.equal(read.setup.run.mode, "live");
    assert.equal(read.setup.run.duration, d.run.duration);
    assert.deepEqual(read.reset, ["character.haste", "run.duration"]);
    assert.equal(
      resetText(read.reset),
      "Part of your saved setup couldn't be read, so the haste and the fight length are back to their defaults.",
    );
  });

  // Fran's qa-327 P2: each stat by its name, and only those reset.
  it("an attack power of -5 alone is named alone, in the singular", () => {
    const read = resolveInitialSetup({
      saved: textOf({
        config: { character: { attackPower: -5, weaponSkill: 305 } },
      }),
    });
    assert.equal(read.setup.config.character.weaponSkill, 305);
    assert.deepEqual(read.reset, ["character.attackPower"]);
    assert.equal(
      resetText(read.reset),
      "Part of your saved setup couldn't be read, so the attack power is back to its default.",
    );
  });

  it("two bad stats fields and others: each named, the kept ones not", () => {
    const read = resolveInitialSetup({
      saved: textOf({
        config: {
          target: { level: 62, armor: -1 },
          character: { attackPower: 900, weaponSkill: "x" },
        },
        run: { duration: 0, iterations: 300 },
      }),
    });
    assert.equal(read.setup.config.character.attackPower, 900);
    assert.equal(read.setup.run.iterations, 300);
    assert.deepEqual(read.reset, [
      "character.weaponSkill",
      "target.armor",
      "run.duration",
    ]);
    assert.equal(
      resetText(read.reset),
      "Part of your saved setup couldn't be read, so the weapon skill, the target's armour and the fight length are back to their defaults.",
    );
    assert.equal(
      resetText(["character.attackPower", "character.weaponSkill"]),
      "Part of your saved setup couldn't be read, so the attack power and the weapon skill are back to their defaults.",
    );
  });

  it("every stat has its own name, and a whole section is plural", () => {
    for (const [field, name] of [
      ["attackPower", "the attack power"],
      ["critChance", "the crit chance"],
      ["bonusHitChance", "the hit chance"],
      ["haste", "the haste"],
      ["weaponSkill", "the weapon skill"],
    ]) {
      assert.equal(
        resetText([`character.${field}`]),
        `Part of your saved setup couldn't be read, so ${name} is back to its default.`,
      );
    }
    assert.deepEqual(
      Object.keys(setupDefaults().config.character).sort(),
      ["attackPower", "bonusHitChance", "critChance", "haste", "weaponSkill"],
      "a new stat needs a name here",
    );
    const read = resolveInitialSetup({
      saved: textOf({ config: { character: 5 } }),
    });
    assert.deepEqual(read.reset, ["character"]);
    assert.equal(
      resetText(read.reset),
      "Part of your saved setup couldn't be read, so the character's stats are back to their defaults.",
    );
  });

  it("a section that is not an object resets whole", () => {
    const read = resolveInitialSetup({
      saved: textOf({ config: { target: 5 } }),
    });
    assert.deepEqual(read.setup.config.target, setupDefaults().config.target);
    assert.deepEqual(read.reset, ["target"]);
    assert.equal(resetText([]), "");
  });
});

// TR-02 / #332: skipped until #333 restores presets.
describe.skip("#326 item 3: Target level is fixed after the other fields", () => {
  it("firstFormError takes a stats field before the target's", () => {
    const errors = {
      "target.level": "Target level must be a whole number from 1 to 63.",
      "character.weaponSkill": "Bad.",
    };
    assert.equal(firstFormError({ errors }), "character.weaponSkill");
    assert.equal(
      firstFormError({ errors: { "target.level": "Bad." } }),
      "target.level",
    );
  });
});

function presetPage() {
  const store = createStore({ config: pageDefaultConfig() });
  const form = createConfigForm(store);
  createTalentTree(store);
  const build = createPresetBuild(store, form);
  return { store, form, build };
}

const WHOLE =
  "Assassination set: talents 38/11/2, two daggers, Instant and Deadly poisons and its rotation. Your stats and race are unchanged.";
const said = (store) => {
  const { applied, announce } = store.get().presetBuild;
  return {
    line: applied.text,
    announce: announce.text,
    undo: applied.undoName,
  };
};

// TR-02 / #332: skipped until #333 restores presets.
describe.skip("#326 items 6 and 7: a pick and a re-pick, and what they say", () => {
  it("item 7: a first pick names the whole build, the same poisons too", () => {
    const { store, build } = presetPage();
    assert.equal(build.pick(ASSASSINATION, "Assassination"), true);
    // The defaults have Assassination's poisons already: Undo has none to
    // put back, but the line and the announcement name them.
    assert.deepEqual(said(store), {
      line: WHOLE,
      announce: WHOLE,
      undo: "Undo: put back your talents, weapons and rotation",
    });
  });

  it("item 7: a first pick of another card names the whole build", () => {
    const { store, build } = presetPage();
    build.pick(ASSASSINATION, "Assassination");
    build.pick(COMBAT, "Combat");
    const { line, announce } = said(store);
    assert.equal(
      line,
      "Combat set: talents 18/33/0, two swords, Deadly and Instant poisons and its rotation. Your stats and race are unchanged.",
    );
    assert.equal(announce, line);
  });

  it("items 6 and 7: a re-pick after a speed edit puts the weapons back, and says only that", () => {
    const { store, form, build } = presetPage();
    build.pick(ASSASSINATION, "Assassination");
    const speed = store.get().config.weapons.mainHand.speed;
    form.change("weapons.mainHand.speed", speed + 0.5);
    assert.equal(build.pick(ASSASSINATION, "Assassination"), true);
    assert.equal(store.get().config.weapons.mainHand.speed, speed);
    const line =
      "Assassination set: two daggers. Your stats and race are unchanged.";
    assert.deepEqual(said(store), {
      line,
      announce: line,
      undo: "Undo: put back your weapons",
    });
    form.change("weapons.offHand.max", 99);
    assert.equal(build.pick(ASSASSINATION, "Assassination"), true);
    assert.equal(said(store).line, line);
    // The same values again change nothing.
    assert.equal(build.pick(ASSASSINATION, "Assassination"), false);
  });

  it("item 7 (Fran's qa-327 N3): weapons and poisons re-picked take a comma, not a second 'and'", () => {
    const { store, form, build } = presetPage();
    build.pick(ASSASSINATION, "Assassination");
    form.change("weapons.mainHand.speed", 2.9);
    form.change("poisons.mainHand", "crippling");
    build.pick(ASSASSINATION, "Assassination");
    const line =
      "Assassination set: two daggers, Instant and Deadly poisons. Your stats and race are unchanged.";
    assert.deepEqual(said(store), {
      line,
      announce: line,
      undo: "Undo: put back your weapons and poisons",
    });
  });

  it("item 7: the list joins as Scout worded it", () => {
    const build = referenceBuild(ASSASSINATION);
    const text = (parts, level = false) =>
      pickedText("Assassination", build, ASSASSINATION, level, parts);
    assert.equal(
      text(["talents", "poisons"]),
      "Assassination set: talents 38/11/2, Instant and Deadly poisons. Your stats and race are unchanged.",
    );
    assert.equal(
      text(["weapons", "poisons", "rotation"]),
      "Assassination set: two daggers, Instant and Deadly poisons and its rotation. Your stats and race are unchanged.",
    );
    assert.equal(
      text(["talents", "weapons"]),
      "Assassination set: talents 38/11/2 and two daggers. Your stats and race are unchanged.",
    );
  });

  it("item 7: a re-pick after a poison edit names the poisons alone", () => {
    const { store, form, build } = presetPage();
    build.pick(ASSASSINATION, "Assassination");
    form.change("poisons.mainHand", "crippling");
    build.pick(ASSASSINATION, "Assassination");
    const line =
      "Assassination set: Instant and Deadly poisons. Your stats and race are unchanged.";
    assert.deepEqual(said(store), {
      line,
      announce: line,
      undo: "Undo: put back your poisons",
    });
  });
});

describe.skip("#326 item 14: a racial the race can't cast is still named (#332)", () => {
  for (const race of [null, "human"]) {
    it(`Combat's rule 1 (Blood Fury) with race ${race}`, () => {
      const config = pageDefaultConfig();
      config.rotation = presetRotation(COMBAT);
      config.race = race;
      const store = createStore({ config: normalizeConfig(config) });
      const builder = createRotationBuilder(store, createConfigForm(store));
      builder.toggle();
      builder.showScreen("rule", "1");
      const body = store.get().rotationBuilder.view.rules[0].body;
      assert.equal(body.action, "blood-fury");
      const option = body.actionGroups
        .flatMap((group) => group.options)
        .find((o) => o.value === "blood-fury");
      assert.deepEqual(option, {
        value: "blood-fury",
        text: "Blood Fury (Orc racial)",
        disabled: true,
      });
      assert.equal(
        body.actionGroups.at(-1).label,
        race === null ? "Needs a race" : "Not your race",
      );
    });
  }

  it("an orc's Blood Fury is a choice like any other", () => {
    const config = pageDefaultConfig();
    config.rotation = presetRotation(COMBAT);
    config.race = "orc";
    const store = createStore({ config: normalizeConfig(config) });
    const builder = createRotationBuilder(store, createConfigForm(store));
    builder.toggle();
    builder.showScreen("rule", "1");
    const options = store
      .get()
      .rotationBuilder.view.rules[0].body.actionGroups.flatMap(
        (g) => g.options,
      );
    assert.deepEqual(
      options.find((o) => o.value === "blood-fury"),
      { value: "blood-fury", text: "Blood Fury (racial)" },
    );
  });
});

// TR-02 / #332: skipped until #333 restores presets.
describe.skip("#326 item 16: the stale words", () => {
  it("the announcement is a sentence", () => {
    assert.equal(STALE_ANNOUNCEMENT, "Results out of date.");
  });

  it("the talents are named first, never in 'other settings'", () => {
    const before = pageDefaultConfig();
    const after = structuredClone(before);
    after.weapons.mainHand.speed += 0.1;
    after.weapons.offHand.speed += 0.1;
    after.talents = { "assassination.malice": 1 };
    const names = changedNames(before, after);
    assert.equal(names[0], "the talents");
    assert.equal(
      namesText(names),
      "the talents, the main-hand weapon and other settings",
    );
  });
});
