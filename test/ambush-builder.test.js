import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConfigForm, pageDefaultConfig } from "../js/config-form.js";
import { createRotationBuilder } from "../js/rotation-builder.js";
import { skipOf, talentState } from "../js/rotation-skips.js";
import { validateRotation } from "../js/rotation-validator.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";

// #264 (P4.6-01b, Fran 4): on a dagger build an Ambush rule gets no lock,
// warning, note or hint in the builder (James, 31 Oct): no talentGuard, no
// "starves" or "never casts" entry, and no ⊘ skip chip, which only talent
// grants get (js/rotation-skips.js). The word "locked" is a talent lock's
// alone (Fran 3), so it is not used for Ambush either.

const AMBUSH = "ambush";
const NOTED = /[Ll]ocked|never casts|[Ss]tarve|Skipped:|[Ss]tealth|Cutthroat/;

function daggerBuilder() {
  const config = pageDefaultConfig();
  config.weapons.mainHand.type = "dagger";
  const store = createStore({ config: normalizeConfig(config) });
  const builder = createRotationBuilder(store, createConfigForm(store));
  builder.toggle();
  return {
    builder,
    store,
    view: () => store.get().rotationBuilder.view,
    rotation: () => store.get().config.rotation,
  };
}

function assertSilent(at, page) {
  const rotation = page.rotation();
  const view = page.view();
  const rule = view.rules[at];
  assert.equal(rotation.rules[at].action, AMBUSH);
  assert.deepEqual(rule.chips, [], "no hint, skip, error or warning chip");
  assert.deepEqual(rule.messages, [], "no note under its card");
  assert.equal(rule.skipped, false);
  assert.equal(view.errors, null);
  assert.equal(view.warnings, null);
  // No talentGuard, nor any other error.
  assert.deepEqual(validateRotation(rotation), []);
  assert.deepEqual(
    rotationWarnings(rotation).filter(
      (w) => w.code === "starves" || NOTED.test(w.message),
    ),
    [],
  );
  assert.equal(
    skipOf(rotation.rules[at], talentState(page.store.get().config)),
    null,
  );
  // The pickers list every condition type ("Talent not locked" among them),
  // so only the rule's own text is read.
  const own = JSON.stringify(rule, (key, value) =>
    key === "typeGroups" || key === "actionGroups" ? undefined : value,
  );
  assert.doesNotMatch(own, NOTED);
}

describe("an Ambush rule on a dagger build in the builder (#264, Fran 4)", () => {
  it("added at the bottom, under Sinister Strike with no conditions", () => {
    const page = daggerBuilder();
    page.builder.setAddAction(AMBUSH);
    page.builder.addRule();
    assertSilent(page.rotation().rules.length - 1, page);
  });

  it("set on the top rule, with its editor open", () => {
    const page = daggerBuilder();
    page.builder.setAction(page.view().rules[0].uid, AMBUSH);
    page.builder.showScreen("rule", "1");
    assertSilent(0, page);
    assert.equal(page.view().rules[0].body.hint, null);
  });
});
