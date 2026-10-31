import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORM_FIELDS,
  createConfigForm,
  formFromConfig,
  nextRunConfig,
  pageDefaultConfig,
  validateValues,
} from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { characterRows } from "../js/views/character-screens.js";
import { formatPercent } from "../js/views/config-form.js";
import { changedNames } from "../js/views/stale.js";

// #274 (P4.6-07): "Haste (attack speed)" on Character › Stats, mirroring crit
// and hit (Fran 5): a stored fraction entered as a percent, checked 0 to 100.

const SEED = 20261029;
const PATH = "character.haste";
const PERCENT_MESSAGE = "Enter a percentage from 0 to 100.";

function setup() {
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const actions = createConfigForm(store);
  return { store, actions, form: () => store.get().form };
}

describe("the haste field (#274)", () => {
  it("is a form field, defaulting to 0", () => {
    assert.ok(FORM_FIELDS.some(({ path }) => path === PATH));
    const { store, form } = setup();
    assert.equal(form().values[PATH], 0);
    assert.equal(nextRunConfig(store.get()).character.haste, 0);
  });

  it("reads 0 from a config without it", () => {
    const config = pageDefaultConfig();
    delete config.character.haste;
    assert.equal(formFromConfig(normalizeConfig(config)).values[PATH], 0);
  });

  it("is stored as a fraction: 12.5 % is 0.125, shown as 12.5", () => {
    const { store, actions } = setup();
    actions.change(PATH, 12.5 / 100);
    assert.equal(nextRunConfig(store.get()).character.haste, 0.125);
    assert.equal(formatPercent(0.125), "12.5");
  });

  it("takes 0 % to 100 % and nothing outside", () => {
    const values = setup().form().values;
    const message = (value) =>
      validateValues({ ...values, [PATH]: value })[PATH] ?? "";
    assert.equal(message(0), "");
    assert.equal(message(1), "");
    assert.equal(message(1.2), PERCENT_MESSAGE);
    assert.equal(message(-0.01), PERCENT_MESSAGE);
    assert.equal(message(Number.NaN), "Enter a number.");
  });

  it("keeps a bad entry out of the config", () => {
    const { store, actions, form } = setup();
    actions.change(PATH, 1.5);
    assert.equal(form().errors[PATH], PERCENT_MESSAGE);
    assert.equal(store.get().config.character.haste, 0);
  });

  it("changes the results", () => {
    const { store, actions } = setup();
    const before = runFight({
      seed: SEED,
      duration: 60,
      config: nextRunConfig(store.get()),
    });
    actions.change(PATH, 0.3);
    const after = runFight({
      seed: SEED,
      duration: 60,
      config: nextRunConfig(store.get()),
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
    const { form } = setup();
    assert.doesNotMatch(characterRows(form()).stats.summary, /haste/);
  });

  it("shows · 5% haste otherwise", () => {
    const { actions, form } = setup();
    actions.change(PATH, 0.05);
    assert.match(characterRows(form()).stats.summary, / · 5% haste$/);
  });
});
