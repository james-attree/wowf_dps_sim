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
import { createPresetBuild } from "../js/preset-build.js";
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

describe("#326: old links and saves still load, the same", () => {
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

describe("#326 item 13: a save's bad field resets alone, and is named", () => {
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
      "Part of your saved setup couldn't be read, so the character's stats and the fight length are back to their defaults.",
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

describe("#326 item 3: Target level is fixed after the other fields", () => {
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

describe("#326 items 6 and 7: a re-pick, and the line it leaves", () => {
  it("re-picking after a speed or damage edit puts the weapons back", () => {
    const { store, form, build } = presetPage();
    assert.equal(build.pick(ASSASSINATION, "Assassination"), true);
    const speed = store.get().config.weapons.mainHand.speed;
    form.change("weapons.mainHand.speed", speed + 0.5);
    assert.equal(build.pick(ASSASSINATION, "Assassination"), true);
    assert.equal(store.get().config.weapons.mainHand.speed, speed);
    const { applied, announce } = store.get().presetBuild;
    assert.equal(
      applied.text,
      "Assassination set: two daggers. Your stats and race are unchanged.",
    );
    assert.match(announce.text, /^Weapons replaced\.$/);
    form.change("weapons.offHand.max", 99);
    assert.equal(build.pick(ASSASSINATION, "Assassination"), true);
    // The same values again change nothing.
    assert.equal(build.pick(ASSASSINATION, "Assassination"), false);
  });

  it("a first pick's line names only what it put in, as it says", () => {
    const { store, build } = presetPage();
    build.pick(ASSASSINATION, "Assassination");
    const { applied, announce } = store.get().presetBuild;
    const parts = announce.text.replace(/ replaced\.$/, "");
    for (const [part, words] of [
      ["Talents", /talents \d+\/\d+\/\d+/],
      ["weapons", /two daggers/],
      ["poisons", /poison/],
      ["rotation", /its rotation/],
    ]) {
      assert.equal(
        words.test(applied.text),
        parts.includes(part),
        `${part}: "${applied.text}" / "${announce.text}"`,
      );
    }
  });
});

describe("#326 item 14: a racial the race can't cast is still named", () => {
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

describe("#326 item 16: the stale words", () => {
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
