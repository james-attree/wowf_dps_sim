// #243 (Fran's #235 nit, #234): a guard on an ability no talent grants says
// so, not "no Sinister Strike talent"; a talent ability's skip still names
// its talent. The builder's chip, the stats summary and the talent tree all
// read this text.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { skipOf, talentState } from "../js/rotation-skips.js";

describe("the skip text for a guard on a non-talent ability (#243)", () => {
  const state = talentState({ talents: {} });

  it("abilityGranted on Sinister Strike: no talent named, its check never true (#244)", () => {
    const rule = {
      action: "sinister-strike",
      conditions: [{ type: "abilityGranted", ability: "sinister-strike" }],
    };
    assert.deepEqual(skipOf(rule, state), {
      ability: "sinister-strike",
      talent: null,
      text: "Sinister Strike is baseline, so its talent check is never true",
    });
    assert.doesNotMatch(skipOf(rule, state).text, /talent$/);
  });

  it("a talent ability's guard still names the talent", () => {
    const rule = {
      action: "sinister-strike",
      conditions: [{ type: "abilityGranted", ability: "cold-blood" }],
    };
    assert.equal(skipOf(rule, state)?.text, "no Cold Blood talent");
  });
});
