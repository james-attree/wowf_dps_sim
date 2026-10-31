import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { AURAS } from "../js/auras.js";
import { poolingHint } from "../js/rotation-builder-copy.js";
import { abilityFacts, castableAbilities } from "../js/rotation-edit.js";

// The pooling hint on a rule's card and in its editor (D11), for the two
// abilities #261 gave requirements: Backstab and Ambush need a dagger in the
// main hand, and Ambush needs an aura nothing grants yet, so its rule is
// passed over and never holds the walk (Kira's QA on #262; the coordinator's
// ruling that such a rule is passed over, not pooled for).

const DAGGER = "It needs a dagger in the main hand";

describe("the pooling hint names the requirements the engine has", () => {
  it("says a dagger is needed for every ability whose data requires daggers, and for no other", () => {
    const needsDaggers = castableAbilities().filter((id) =>
      abilityCatalogue.get(id)?.requires?.includes("daggers"),
    );
    assert.deepEqual(needsDaggers.sort(), ["ambush", "backstab"]);
    for (const id of castableAbilities()) {
      const { long } = poolingHint(id);
      assert.equal(long.includes(DAGGER), needsDaggers.includes(id), id);
    }
    // The engine agrees: the same two need a main-hand dagger.
    assert.deepEqual(
      ABILITY_DEFINITIONS.filter((d) => d.requiresMainHand === "dagger")
        .map((d) => d.id)
        .sort(),
      ["ambush", "backstab"],
    );
  });

  it("does not say the walk stops at Ambush: it is passed over while its aura is down", () => {
    const { chip, long } = poolingHint("ambush");
    assert.doesNotMatch(long, /stops here/);
    assert.doesNotMatch(chip, /Waits for/);
    assert.match(chip, new RegExp(`unless ${AURAS.cutthroat.name} is up`));
    assert.match(long, /passed over/);
    assert.match(long, new RegExp(AURAS.cutthroat.name));
    assert.match(long, new RegExp(`${k("ambush").energy} energy`));
    assert.match(long, new RegExp(DAGGER));
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
});
