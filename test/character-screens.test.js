// Character's screens (#244, UX6): the rows' summaries and chips, the
// routes' titles, and Fight's "Attacking from behind" box in the config.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configFromForm,
  createConfigForm,
  formFromConfig,
  nextRunConfig,
  pageDefaultConfig,
  validateValues,
} from "../js/config-form.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import {
  SCREENS,
  characterRows,
  fixText,
  screenOf,
} from "../js/views/character-screens.js";
import { parseRoute, titleFor } from "../js/views/router.js";

const config = () => normalizeConfig(pageDefaultConfig());

describe("Character's rows (#244)", () => {
  it("say what Gear and weapons and Stats hold, poisons by hand", () => {
    const rows = characterRows(formFromConfig(config()));
    assert.equal(
      rows.gear.summary,
      "Main hand Sword 100–187 · Instant Poison / Off hand Sword 90–168 · Deadly Poison",
    );
    assert.equal(rows.stats.summary, "767 attack power · 22.45% crit · 7% hit");
    assert.equal(rows.gear.fix, 0);
    assert.equal(rows.stats.fix, 0);
  });

  it("count each screen's fields to fix, and dash a value that isn't a number", () => {
    const form = formFromConfig(config());
    const values = {
      ...form.values,
      "weapons.mainHand.min": NaN,
      "weapons.offHand.max": -1,
      "character.attackPower": NaN,
      "poisons.offHand": null,
    };
    const rows = characterRows({
      ...form,
      values,
      errors: validateValues(values),
    });
    assert.match(rows.gear.summary, /^Main hand Sword —–187 · /);
    assert.match(rows.gear.summary, / \/ Off hand Sword 90–-1 · No poison$/);
    assert.match(rows.stats.summary, /^— attack power · /);
    assert.ok(rows.gear.fix >= 2, JSON.stringify(rows));
    assert.equal(rows.stats.fix, 1);
    assert.equal(fixText(rows.stats.fix), "1 to fix");
    assert.equal(fixText(3), "3 to fix");
    assert.equal(fixText(0), "");
  });

  it("follow the store's form as it changes", () => {
    const store = createStore({ config: config() });
    createConfigForm(store);
    assert.equal(
      characterRows(store.get().form).stats.summary,
      "767 attack power · 22.45% crit · 7% hit",
    );
  });
});

describe("Character's routes and titles (#244)", () => {
  it("name each screen, and send an unknown one to the list", () => {
    for (const [sub, title] of [
      ["gear", "Gear and weapons"],
      ["stats", "Stats"],
      ["talents", "Talents"],
    ]) {
      const route = parseRoute(`#character/${sub}`);
      assert.deepEqual(route, { area: "character", sub, param: null });
      assert.equal(screenOf(route), sub);
      assert.equal(SCREENS[sub].title, title);
      assert.equal(titleFor(route), `${title} · WoW Forever Rogue Simulator`);
    }
    const top = parseRoute("#character/armor");
    assert.equal(screenOf(top), "list");
    assert.equal(titleFor(top), "Character · WoW Forever Rogue Simulator");
    assert.equal(screenOf(parseRoute("#fight")), null);
  });
});

describe("Attacking from behind (#244)", () => {
  it("is on by default and goes from the form to the config and back", () => {
    const base = config();
    assert.equal(base.target.behind, true);
    const form = formFromConfig(base);
    assert.equal(form.values["target.behind"], true);
    for (const behind of [false, true]) {
      const next = configFromForm(
        { ...form, values: { ...form.values, "target.behind": behind } },
        base,
      );
      assert.equal(next.target.behind, behind);
      assert.equal(normalizeConfig(next).target.behind, behind);
      assert.equal(formFromConfig(next).values["target.behind"], behind);
    }
  });

  it("refuses a value that isn't true or false", () => {
    const { values } = formFromConfig(config());
    assert.equal(
      validateValues({ ...values, "target.behind": "yes" })["target.behind"],
      "Choose front or behind.",
    );
  });

  it("reaches the run's config when it changes", () => {
    const store = createStore({ config: config() });
    const form = createConfigForm(store);
    form.change("target.behind", false);
    assert.equal(store.get().config.target.behind, false);
    assert.equal(nextRunConfig(store.get()).target.behind, false);
  });
});
