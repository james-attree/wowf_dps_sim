import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { AURAS } from "../js/auras.js";
import { auraName, poolingHint } from "../js/rotation-builder-copy.js";
import { createConfigForm, pageDefaultConfig } from "../js/config-form.js";
import { createRotationBuilder } from "../js/rotation-builder.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { abilityFacts, castableAbilities } from "../js/rotation-edit.js";

// The pooling hint on a rule's card and in its editor (D11). Backstab needs a
// dagger in the main hand and says so. Ambush needs a dagger and an aura
// nothing grants yet, and the builder says nothing special about it: no chip
// and no hint (James's ruling, relayed by the coordinator: Ambush is not
// spoonfed). The engine still passes its rule over while the aura is down.

const DAGGER = "It needs a dagger in the main hand";

function builderView() {
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const builder = createRotationBuilder(store, createConfigForm(store));
  builder.toggle();
  return { builder, view: () => store.get().rotationBuilder.view };
}

describe("the pooling hint names the requirements the engine has", () => {
  it("says a dagger is needed for Backstab, whose data requires daggers, and for no ability without it", () => {
    const needsDaggers = castableAbilities().filter((id) =>
      abilityCatalogue.get(id)?.requires?.includes("daggers"),
    );
    assert.deepEqual(needsDaggers.sort(), ["ambush", "backstab"]);
    for (const id of castableAbilities()) {
      const hint = poolingHint(id);
      if (id === "ambush") {
        continue;
      }
      assert.equal(hint.long.includes(DAGGER), id === "backstab", id);
    }
    // The engine agrees: the same two need a main-hand dagger.
    assert.deepEqual(
      ABILITY_DEFINITIONS.filter((d) => d.requiresMainHand === "dagger")
        .map((d) => d.id)
        .sort(),
      ["ambush", "backstab"],
    );
  });

  it("Ambush has no hint at all: no chip, no long text, no dagger sentence", () => {
    assert.equal(poolingHint("ambush"), null);
    assert.deepEqual(abilityFacts("ambush").auras, ["cutthroat"]);
  });

  it("keeps the waiting hint for an on-GCD ability with no aura to wait on", () => {
    for (const [id, row] of [
      ["backstab", "backstab"],
      ["sinister-strike", "sinisterStrike"],
    ]) {
      const { chip, long } = poolingHint(id);
      assert.equal(chip, `Waits for ${k(row).energy} energy`, id);
      assert.match(long, /stops here/, id);
      assert.deepEqual(abilityFacts(id).auras, [], id);
    }
  });

  it("in the builder, an Ambush rule's card has no hint chip and its editor no hint; Backstab's keep theirs", () => {
    const { builder, view } = builderView();
    const uid = view().rules[0].uid;
    builder.setAction(uid, "ambush");
    builder.showScreen("rule", "1");
    let rule = view().rules[0];
    assert.equal(rule.chips.filter((c) => c.kind === "hint").length, 0);
    assert.equal(rule.body.hint, null);
    builder.setAction(uid, "backstab");
    rule = view().rules[0];
    const hints = rule.chips.filter((c) => c.kind === "hint");
    assert.deepEqual(
      hints.map((c) => c.text),
      [`Waits for ${k("backstab").energy} energy`],
    );
    assert.match(rule.body.hint, new RegExp(DAGGER));
  });

  it("Ambush allowed is still among the auras a condition can name", () => {
    assert.equal(AURAS.cutthroat.name, "Ambush allowed");
    assert.equal(auraName("cutthroat"), "Ambush allowed");
  });
});
