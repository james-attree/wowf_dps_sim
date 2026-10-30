// #244 P1 (Fran's #255 check): a talent check on a baseline ability
// (abilityGranted on Sinister Strike) never holds, whatever the talents. Its
// copy says the check isn't available to this spec or build, not "never
// granted" (Sinister Strike is baseline), and the summary and the builder's
// Talents line say so with no talents too, not "skipped with no talents".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import {
  createConfigForm,
  pageDefaultConfig,
  summaryOf,
} from "../js/config-form.js";
import { createRotationBuilder } from "../js/rotation-builder.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation } from "../js/rotation-io.js";
import { skipOf, talentState } from "../js/rotation-skips.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";

const UNAVAILABLE =
  "Sinister Strike's talent check isn't available to this spec or build (Sinister Strike is baseline)";

const ROTATION = {
  schemaVersion: defaultRotation().schemaVersion,
  name: "Baseline check",
  rules: [
    {
      action: "sinister-strike",
      conditions: [{ type: "abilityGranted", ability: "sinister-strike" }],
    },
    {
      action: "cold-blood",
      conditions: [{ type: "abilityGranted", ability: "cold-blood" }],
    },
    { action: "sinister-strike", conditions: [] },
  ],
};

function setup(talents) {
  const config = normalizeConfig({ ...pageDefaultConfig(), talents });
  const store = createStore({ config });
  const form = createConfigForm(store);
  const builder = createRotationBuilder(store, form);
  builder.toggle();
  assert.equal(form.importText(exportRotation(ROTATION)), true);
  return { store, view: () => store.get().rotationBuilder.view };
}

describe("a check no talent lifts (#244, P1)", () => {
  it("says the check isn't available to this spec or build", () => {
    for (const talents of [{}, referenceBuild()]) {
      const skip = skipOf(ROTATION.rules[0], talentState({ talents }));
      assert.deepEqual(skip, {
        ability: "sinister-strike",
        talent: null,
        text: UNAVAILABLE,
      });
      assert.doesNotMatch(skip.text, /never granted/);
    }
  });

  it("the summary says why with any talents, not 'skipped with no talents'", () => {
    const none = summaryOf(ROTATION, { talents: talentState({ talents: {} }) });
    assert.deepEqual(none.rules, [
      `Sinister Strike if Sinister Strike is granted — skipped: ${UNAVAILABLE}`,
      "Cold Blood if Cold Blood is granted — skipped with no talents",
      "Sinister Strike (always)",
    ]);
    const built = summaryOf(ROTATION, {
      talents: talentState({ talents: referenceBuild() }),
    });
    assert.equal(built.rules[0], none.rules[0]);
  });

  it("the Talents line names it apart from the build's skips", () => {
    assert.equal(
      setup({}).view().context.text,
      "1 rule is skipped with no talents (rule 2). 1 rule is skipped with any talents: its check isn't available to this spec or build (rule 1). ",
    );
    assert.equal(
      setup(referenceBuild()).view().context.text,
      "1 rule is skipped with any talents: its check isn't available to this spec or build (rule 1). ",
    );
  });
});
