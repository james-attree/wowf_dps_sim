import assert from "node:assert/strict";
import { describe, it } from "node:test";
import enchants from "../data/items/enchants.json" with { type: "json" };
import items from "../data/items/rogue-items.json" with { type: "json" };
import suffixes from "../data/items/suffixes.json" with { type: "json" };
import {
  FORM_ERROR,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import { createGearActions } from "../js/gear-actions.js";
import { runFight } from "../js/fight.js";
import { normalizeConfig } from "../js/sim-config.js";
import { GEAR_SLOTS } from "../js/gear-build.js";
import {
  CREDIT_HREF,
  CREDIT_LABEL,
  EMPTY_MH,
  LEVEL_BLOCK,
  NOT_MODELLED_HELP,
  configWithGear,
  formatSheetPercent,
  gearLead,
  gearViewModel,
  setSlot,
} from "../js/gear-model.js";
import { CONFLICT_COPY, indexTables } from "../js/gear-search.js";

const tables = indexTables({ items, enchants, suffixes });

function storeOf(config) {
  let state = { config, form: { revision: 0, errors: {} } };
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
    },
  };
}

function handCasts(result, pattern) {
  return Object.entries(result.abilities).reduce((sum, [name, row]) => {
    return pattern.test(name) ? sum + (row.casts ?? 0) : sum;
  }, 0);
}

function named(name) {
  for (const item of tables.items.values()) {
    if (item.name === name) {
      return item;
    }
  }
  throw new Error(`missing ${name}`);
}

describe("gear view model (#384)", () => {
  it("binds the P1 page default to real deriveSheet numbers (M11)", () => {
    // Mutant M11: the panel uses the mockup's illustrative 18.0% / 8.7%
    // wording as a literal, or AP is shown with a fraction.
    const config = pageDefaultConfig();
    const view = gearViewModel(config, tables);
    assert.equal(view.showDoll, true);
    assert.equal(view.legacy, false);
    const byId = Object.fromEntries(view.stats.map((row) => [row.id, row]));
    assert.equal(byId.attackPower.value, "608");
    assert.equal(byId.crit.value, "18.0%");
    assert.equal(byId.hit.value, "8.7%");
    assert.equal(byId.haste.value, "0.0%");
    assert.equal(byId.strength.value, "121");
    assert.equal(byId.agility.value, "289");
    assert.equal(byId.mainSkill.value, "300");
    assert.equal(byId.offSkill.value, "300");
    assert.match(byId.mainHand.value, /54−102, 1\.8 s, dagger/);
    assert.match(byId.offHand.value, /71−134, 2\.4 s, axe/);
    assert.equal(formatSheetPercent(0.179705), "18.0%");
    assert.match(view.lead, /Level 60 Human rogue/);
    assert.equal(view.rows.mainHand.name, "The Lobotomizer");
    assert.equal(view.rows.mainHand.qualityName, "Epic");
    assert.equal(view.rows.offHand.name, "Dark Iron Destroyer");
    assert.equal(view.rows.ranged.name, "Fahrad's Reloading Repeater");
  });

  it("lists the unmodelled P1 effects and the credit wording (M12)", () => {
    // Mutant M12: the chip count ignores enchants, or the credit href
    // changes.
    const view = gearViewModel(pageDefaultConfig(), tables);
    assert.equal(view.notModelledCount, 4);
    assert.equal(view.notModelledLabel, "4 effects not modelled");
    const names = view.notModelled.map((row) => row.name);
    assert.ok(names.includes("Enchant Weapon - Crusader"));
    assert.ok(names.includes("Enchant Boots - Minor Speed"));
    assert.equal(NOT_MODELLED_HELP.includes("static stats still count"), true);
    assert.equal(CREDIT_LABEL, "wowsims/forever");
    assert.equal(CREDIT_HREF, "https://github.com/wowsims/forever");
  });

  it("warns when the main hand is emptied and clears it from config (M13)", () => {
    // Mutant M13: clearing the main hand keeps the previous dagger, so the
    // doll and the sim disagree, or the warning is omitted.
    // coordinator call 16 Nov (James delegated).
    const config = pageDefaultConfig();
    const slots = setSlot(config.gear.slots, "mainHand", null);
    assert.equal(slots.mainHand, undefined);
    const next = configWithGear(config, slots);
    assert.equal(next.gear.slots.mainHand, undefined);
    assert.equal(next.weapons.mainHand, null);
    const view = gearViewModel(next, tables);
    assert.equal(view.emptyMainHand, true);
    assert.equal(view.emptyMainHandText, EMPTY_MH);
    assert.equal(view.rows.mainHand.empty, true);
    assert.equal(view.rows.mainHand.name, "Empty");
    assert.equal(view.rows.mainHand.glyph, "MH");
  });

  it("lets the off hand go empty once PR3 has landed (M14)", () => {
    // Mutant M14: emptying the off hand is refused, or the previous axe
    // stays in config, or the row still shows Dark Iron Destroyer.
    const config = pageDefaultConfig();
    const next = configWithGear(
      config,
      setSlot(config.gear.slots, "offHand", null),
    );
    assert.equal(next.weapons.offHand, null);
    assert.ok(next.weapons.mainHand);
    const view = gearViewModel(next, tables);
    assert.equal(view.rows.offHand.empty, true);
    assert.equal(view.emptyMainHand, false);
  });

  it("an empty main hand disables Run with a clear reason", () => {
    // coordinator call 16 Nov (James delegated), per the Q10 ruling of
    // 15 Nov: an empty MH blocks Run; the doll and the sim never disagree.
    const store = storeOf(pageDefaultConfig());
    const actions = createGearActions(store, {
      searchStart: 2,
      resultCap: 20,
    });
    actions.applySlots(
      setSlot(store.get().config.gear.slots, "mainHand", null),
    );
    const { config, form } = store.get();
    assert.equal(config.weapons.mainHand, null);
    assert.equal(config.gear.slots.mainHand, undefined);
    assert.match(form.errors[FORM_ERROR], /Equip a main-hand weapon/);
    assert.equal(nextRunConfig(store.get()), null);
  });

  it("an empty off hand runs main-hand only, not the P1 DPS", () => {
    // coordinator call 16 Nov (James delegated): clear the OH from config;
    // don't block Run; 0 OH swings; DPS differs from P1 (331.62).
    const p1Config = pageDefaultConfig();
    const store = storeOf(p1Config);
    const actions = createGearActions(store, {
      searchStart: 2,
      resultCap: 20,
    });
    actions.applySlots(setSlot(p1Config.gear.slots, "offHand", null));
    const { config, form } = store.get();
    assert.equal(config.weapons.offHand, null);
    assert.equal(form.errors[FORM_ERROR], undefined);
    const runnable = nextRunConfig(store.get());
    assert.ok(runnable);
    assert.equal(runnable.weapons.offHand, null);
    assert.equal(normalizeConfig(config).weapons.offHand, null);
    const p1 = runFight({ seed: 1, duration: 30, config: p1Config });
    const one = runFight({ seed: 1, duration: 30, config: runnable });
    assert.equal(Number(p1.dps.toFixed(2)), 331.62);
    assert.notEqual(Number(one.dps.toFixed(2)), 331.62);
    assert.ok(handCasts(p1, /off-hand/i) > 0);
    assert.equal(handCasts(one, /off-hand/i), 0);
    assert.ok(handCasts(one, /main-hand/i) > 0);
  });

  it("equipping a different legal item updates the derived sheet (M15)", () => {
    // Mutant M15: a pick writes the slot but leaves the previous AP, so
    // the panel and the form disagree.
    const config = pageDefaultConfig();
    const viskag = [...tables.items.values()].find(
      (item) => item.name.includes("Vis") && item.slot === "weapon",
    );
    const dagger = viskag ?? named("Alcor's Sunrazor");
    const next = configWithGear(
      config,
      setSlot(config.gear.slots, "mainHand", { item: dagger.id }),
    );
    assert.equal(next.gear.slots.mainHand.item, dagger.id);
    assert.equal(next.weapons.mainHand.min, dagger.weapon.min);
    assert.equal(next.weapons.mainHand.max, dagger.weapon.max);
    assert.notEqual(next.character.attackPower, undefined);
  });

  it("shows a conflict row instead of dropping an illegal saved item (M16)", () => {
    // Mutant M16: an illegal slot is deleted from the model, so a stale
    // link loses the item instead of “Can't be worn here”.
    const config = pageDefaultConfig();
    const lobo = named("The Lobotomizer");
    const next = configWithGear(config, {
      ...config.gear.slots,
      head: { item: lobo.id, enchant: null, suffix: null },
    });
    assert.equal(next.gear.slots.head.item, lobo.id);
    const view = gearViewModel(next, tables);
    assert.equal(view.rows.head.conflict, true);
    assert.equal(view.rows.head.conflictReason, CONFLICT_COPY);
    assert.equal(view.rows.head.name, "The Lobotomizer");
  });

  it("hides the doll on a legacy sheet and still has the lead (M17)", () => {
    // Mutant M17: a typed sheet (no config.gear) is drawn as an editable
    // doll, which is PR7's read-only screen.
    const config = pageDefaultConfig();
    delete config.gear;
    const view = gearViewModel(config, tables);
    assert.equal(view.legacy, true);
    assert.equal(view.showDoll, false);
    assert.match(gearLead(config), /wowsims Forever P1 gear build/);
  });

  it("names the level-60 block without inventing a lower-level curve (M18)", () => {
    // Mutant M18: a below-60 gear build is allowed to derive, or the
    // copy changes.
    const config = pageDefaultConfig();
    config.talentLevel = 40;
    const view = gearViewModel(config, tables);
    assert.equal(view.levelBlocked, true);
    assert.equal(view.levelBlockText, LEVEL_BLOCK);
    assert.equal(view.level, 40);
  });

  it("keeps every GEAR_SLOTS id on the doll (M19)", () => {
    // Mutant M19: shirt or tabard sneak in, or a finger is dropped.
    const view = gearViewModel(pageDefaultConfig(), tables);
    assert.deepEqual(
      [...view.left, ...view.right, ...view.weapons]
        .map((row) => row.slot)
        .sort(),
      [...GEAR_SLOTS].sort(),
    );
    assert.equal(
      [...view.left, ...view.right, ...view.weapons].some(
        (row) => row.slot === "shirt" || row.slot === "tabard",
      ),
      false,
    );
  });
});
