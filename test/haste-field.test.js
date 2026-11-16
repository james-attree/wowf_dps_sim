import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORM_FIELDS,
  createConfigForm,
  formFromConfig,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { characterRows } from "../js/views/character-screens.js";
import { formatPercent } from "../js/views/config-form.js";
import { changedNames } from "../js/views/stale.js";

// #274: haste is a derived gear stat in PR7, not a typed Character field.
// The stale-run name and the Stats summary still mention it when present.

const SEED = 20261029;
const PATH = "character.haste";

function setup() {
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const actions = createConfigForm(store);
  return { store, actions, form: () => store.get().form };
}

describe("the haste field (#274)", () => {
  it("is no longer a form field; the page default still has haste 0", () => {
    assert.ok(!FORM_FIELDS.some(({ path }) => path === PATH));
    const { store } = setup();
    assert.ok(!Object.hasOwn(store.get().form.values, PATH));
    assert.equal(nextRunConfig(store.get()).character.haste, 0);
  });

  it("reads 0 from a config without it", () => {
    const config = pageDefaultConfig();
    delete config.character.haste;
    assert.equal(normalizeConfig(config).character.haste, 0);
    assert.ok(
      !Object.hasOwn(formFromConfig(normalizeConfig(config)).values, PATH),
    );
  });

  it("is still shown as a percent when the derived sheet has some", () => {
    assert.equal(formatPercent(0.125), "12.5");
  });

  it("is not validated on the form, because it cannot be typed", () => {
    assert.ok(!FORM_FIELDS.some(({ path }) => path === PATH));
  });

  it("keeps a typed haste path from reaching the form values", () => {
    const { store, actions, form } = setup();
    actions.change(PATH, 1.5);
    assert.equal(form().errors[PATH], undefined);
    assert.equal(store.get().config.character.haste, 0);
  });

  it("changing haste on the config (legacy sheet) still changes the results", () => {
    const { store } = setup();
    const before = runFight({
      seed: SEED,
      duration: 60,
      config: nextRunConfig(store.get()),
    });
    const next = structuredClone(nextRunConfig(store.get()));
    next.character.haste = 0.3;
    // A typed haste field is gone; a frozen or derived value still fights.
    const after = runFight({
      seed: SEED,
      duration: 60,
      config: normalizeConfig(next),
    });
    assert.ok(after.totalDamage > before.totalDamage);
  });

  it("is named Haste when it makes a run out of date", () => {
    const before = normalizeConfig(pageDefaultConfig());
    const after = structuredClone(before);
    after.character.haste = 0.05;
    assert.deepEqual(changedNames(before, after), ["Haste"]);
  });
});

describe("the Stats summary with haste (#274, Fran 7)", () => {
  it("leaves haste out at 0", () => {
    const { store } = setup();
    assert.doesNotMatch(
      characterRows(store.get().form, store.get().config).stats.summary,
      /haste/,
    );
  });

  it("shows · 5% haste otherwise", () => {
    const { store } = setup();
    const config = structuredClone(store.get().config);
    config.character.haste = 0.05;
    assert.match(
      characterRows(store.get().form, config).stats.summary,
      / · 5% haste$/,
    );
  });
});
