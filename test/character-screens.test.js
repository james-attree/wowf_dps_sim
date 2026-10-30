// Character's screens (#244, UX6): the rows' summaries and chips, the
// routes' titles, and the config always from behind (Fight's Target).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configFromForm,
  createConfigForm,
  formFromConfig,
  fromBehind,
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
import { formatRoute, parseRoute, titleFor } from "../js/views/router.js";

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

// The sim is built for attacking from behind (James's ruling on Fran's
// qa-256): the page has no control for it, and every config it builds or
// runs has target.behind true, a stored or imported false too, with no
// message.
describe("Always from behind (#244)", () => {
  const front = () => ({ ...config(), target: { behind: false } });

  it("the page's default, the form and the config it builds are from behind", () => {
    assert.equal(config().target.behind, true);
    assert.equal(pageDefaultConfig().target.behind, true);
    const form = formFromConfig(config());
    assert.equal(Object.hasOwn(form.values, "target.behind"), false);
    assert.equal(configFromForm(form, front()).target.behind, true);
    assert.deepEqual(validateValues(form.values), {});
  });

  it("an imported or stored behind: false comes out true, with no error", () => {
    const given = normalizeConfig(front());
    assert.equal(given.target.behind, false, "the engine's config allows it");
    const store = createStore({ config: given });
    const form = createConfigForm(store);
    assert.equal(store.get().config.target.behind, true);
    assert.deepEqual(store.get().form.errors ?? {}, {});
    assert.equal(nextRunConfig(store.get()).target.behind, true);
    assert.equal(
      nextRunConfig({ ...store.get(), config: given }).target.behind,
      true,
    );
    form.change("character.attackPower", "800");
    assert.equal(store.get().config.target.behind, true);
    assert.equal(fromBehind(given).target.behind, true);
    const kept = config();
    assert.equal(fromBehind(kept), kept, "a config from behind is kept");
  });

  it("stays from behind after Reset and a rotation import", () => {
    const store = createStore({ config: normalizeConfig(front()) });
    const form = createConfigForm(store, { defaults: front });
    form.reset();
    assert.equal(store.get().config.target.behind, true);
    assert.equal(
      form.importText(JSON.stringify(store.get().config.rotation)),
      true,
    );
    assert.equal(store.get().config.target.behind, true);
    assert.equal(nextRunConfig(store.get()).target.behind, true);
  });
});

describe("Fran's qa-256 polish (#244)", () => {
  it("an extra part after a sub is dropped, but a rule keeps its number (P-b)", () => {
    for (const sub of ["gear", "stats", "talents"]) {
      const route = parseRoute(`#character/${sub}/x`);
      assert.deepEqual(route, { area: "character", sub, param: null });
      assert.equal(formatRoute(route), `#character/${sub}`);
    }
    assert.equal(
      formatRoute(parseRoute("#rotation/share/x")),
      "#rotation/share",
    );
    assert.equal(formatRoute(parseRoute("#results/live/2")), "#results/live");
    assert.deepEqual(parseRoute("#rotation/rule/2"), {
      area: "rotation",
      sub: "rule",
      param: "2",
    });
  });
});
