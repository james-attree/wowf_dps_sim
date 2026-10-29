import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  FORM_ERROR,
  createConfigForm,
  nextRunConfig,
  pageDefaultConfig,
  poisonInfo,
  poisonOptions,
} from "../js/config-form.js";
import { runFight } from "../js/fight.js";
import { poisonCatalogue } from "../js/poisons.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";

// Issue #152 (U3), the poison selector's model: the page's default poisons,
// the choices and what is shown for each, and that a choice reaches the next
// run through the store and normalizeConfig, by config id.

const SEED = 20261029;
const DURATION = 60;

function mount(config = pageDefaultConfig()) {
  const store = createStore({ config: normalizeConfig(config) });
  const actions = createConfigForm(store);
  return {
    store,
    actions,
    form: () => store.get().form,
    config: () => store.get().config,
  };
}

const fight = (config) => runFight({ seed: SEED, duration: DURATION, config });

describe("page defaults (Scout: Instant main hand, Deadly off hand)", () => {
  it("pageDefaultConfig() has them; the engine's default still has none", () => {
    assert.deepEqual(pageDefaultConfig().poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
    assert.deepEqual(defaultConfig().poisons, {
      mainHand: null,
      offHand: null,
    });
    assert.deepEqual(k("ui.pageDefaultPoisons"), pageDefaultConfig().poisons);
    const { poisons, ...rest } = pageDefaultConfig();
    const { poisons: none, ...engine } = defaultConfig();
    assert.deepEqual(rest, engine, "only the poisons differ");
    assert.notEqual(poisons, none);
  });

  it("is a fresh copy each time, and normalizeConfig accepts it", () => {
    const first = pageDefaultConfig();
    first.poisons.mainHand = "wound";
    assert.equal(pageDefaultConfig().poisons.mainHand, "instant");
    assert.deepEqual(normalizeConfig(pageDefaultConfig()).poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
  });

  it("the form shows them and Reset restores them", () => {
    const { actions, form, config } = mount();
    assert.equal(form().values["poisons.mainHand"], "instant");
    assert.equal(form().values["poisons.offHand"], "deadly");
    actions.change("poisons.mainHand", "");
    actions.change("poisons.offHand", "wound");
    actions.reset();
    assert.deepEqual(config().poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
    actions.undo();
    assert.deepEqual(config().poisons, { mainHand: null, offHand: "wound" });
  });
});

describe("the choices", () => {
  it("are config ids, simulated first, in catalogue order, labelled from it", () => {
    const { simulated, notSimulated } = poisonOptions();
    assert.deepEqual(
      simulated,
      poisonCatalogue.dps.map(({ key, name }) => ({ id: key, label: name })),
    );
    assert.deepEqual(
      simulated.map(({ id }) => id),
      ["instant", "deadly"],
    );
    assert.deepEqual(
      notSimulated.map(({ id }) => id),
      poisonCatalogue.noOps.map(({ key }) => key),
    );
    assert.deepEqual(
      [...simulated, ...notSimulated].map(({ id }) => id).sort(),
      [...k("config.poisonIds")].sort(),
    );
    for (const { id } of [...simulated, ...notSimulated]) {
      assert.doesNotMatch(id, /-poison$/, "the key, not the catalogue id");
    }
  });

  it("the form slice carries the choices", () => {
    const { form } = mount();
    assert.deepEqual(form().poisonOptions, poisonOptions());
  });
});

describe("what is shown for a poison", () => {
  it("Instant: its top rank, read-only, with the numbers of its proc", () => {
    const info = poisonInfo("instant");
    const top = poisonCatalogue.byKey("instant").top;
    assert.equal(info.name, "Instant Poison");
    assert.equal(info.rank, top.rank);
    assert.equal(info.highest, true);
    assert.equal(info.chance, top.chance);
    assert.deepEqual(info.effect, top.effect);
    assert.equal(info.simulated, true);
    assert.equal(info.noDpsReason, null);
    assert.equal(info.text, top.text);
  });

  it("Deadly: a stacking dot", () => {
    const info = poisonInfo("deadly");
    assert.equal(info.effect.kind, "dot");
    assert.equal(info.simulated, true);
    assert.equal(info.highest, true);
  });

  it("a poison the sim does not simulate says why", () => {
    for (const key of ["wound", "crippling", "mind-numbing"]) {
      const info = poisonInfo(key);
      assert.equal(info.simulated, false, key);
      assert.equal(
        info.noDpsReason,
        poisonCatalogue.byKey(key).noDpsReason,
        key,
      );
      assert.ok(info.noDpsReason.length > 0, key);
    }
  });

  it("calls the rank highest only when it is the last one", () => {
    const top = { ...poisonCatalogue.byKey("instant").top, rank: 2 };
    const catalogue = {
      byKey: () => ({
        name: "Test",
        dps: true,
        noDpsReason: null,
        top,
        ranks: [{}, top, {}],
      }),
    };
    assert.equal(poisonInfo("instant", catalogue).highest, false);
    assert.equal(poisonInfo("instant", catalogue).rank, 2);
  });

  it("None, or an id that is not a poison, shows nothing", () => {
    assert.equal(poisonInfo(null), null);
    assert.equal(poisonInfo(undefined), null);
    assert.equal(poisonInfo("instant-poison"), null);
  });

  it("the form slice follows the choice", () => {
    const { actions, form } = mount();
    assert.equal(form().poisons.mainHand.name, "Instant Poison");
    assert.equal(form().poisons.offHand.name, "Deadly Poison");
    actions.change("poisons.offHand", "crippling");
    assert.equal(form().poisons.offHand.simulated, false);
    actions.change("poisons.mainHand", "");
    assert.equal(form().poisons.mainHand, null);
  });
});

describe("a choice reaches the next run", () => {
  it("writes config.poisons by id, None as null", () => {
    const { actions, config, store } = mount(defaultConfig());
    actions.change("poisons.mainHand", "deadly");
    actions.change("poisons.offHand", "instant");
    assert.deepEqual(config().poisons, {
      mainHand: "deadly",
      offHand: "instant",
    });
    assert.deepEqual(nextRunConfig(store.get()).poisons, config().poisons);
    actions.change("poisons.offHand", "");
    assert.equal(config().poisons.offHand, null);
    assert.equal(store.get().form.values["poisons.offHand"], null);
  });

  it("the same poison on both hands is allowed", () => {
    const { actions, config } = mount();
    actions.change("poisons.offHand", "instant");
    assert.deepEqual(config().poisons, {
      mainHand: "instant",
      offHand: "instant",
    });
  });

  it("Instant on one hand and Deadly on the other both show in the results", () => {
    const { store } = mount();
    const result = fight(nextRunConfig(store.get()));
    assert.deepEqual(result.config.poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
    assert.ok(result.abilities["Instant Poison"]?.damage > 0);
    assert.ok(result.abilities["Deadly Poison"]?.damage > 0);
    const bare = fight(defaultConfig());
    assert.ok(result.dps > bare.dps, "the page defaults add poison damage");
  });

  it("a poison the sim does not simulate is stored, and changes no DPS", () => {
    const { actions, store, config } = mount(defaultConfig());
    actions.change("poisons.mainHand", "wound");
    actions.change("poisons.offHand", "mind-numbing");
    assert.deepEqual(config().poisons, {
      mainHand: "wound",
      offHand: "mind-numbing",
    });
    const result = fight(nextRunConfig(store.get()));
    const bare = fight(defaultConfig());
    assert.equal(result.totalDamage, bare.totalDamage);
    assert.equal(result.abilities["Wound Poison"], undefined);
  });

  it("the engine never gets an id that is not a config id", () => {
    const { actions, config, form, store } = mount();
    for (const bad of ["instant-poison", "Instant Poison", "nope"]) {
      actions.change("poisons.mainHand", bad);
      assert.equal(config().poisons.mainHand, "instant", bad);
      assert.ok("poisons.mainHand" in form().errors, bad);
      assert.equal(nextRunConfig(store.get()), null);
    }
    actions.change("poisons.mainHand", "deadly");
    assert.deepEqual(form().errors, {});
    assert.equal(config().poisons.mainHand, "deadly");
    assert.ok(!(FORM_ERROR in form().errors));
  });
});
