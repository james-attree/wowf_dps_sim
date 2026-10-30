import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { rotationHost } from "../js/rotation-host.js";
import { skipOf, talentState } from "../js/rotation-skips.js";
import { defaultConfig } from "../js/sim-config.js";
import { talentGrantedAbilities } from "../js/talent-build.js";
import { buildWithout } from "./builds.js";
import { referenceBuild } from "./talentsforever.js";

// The builder's skips agree with the engine (#199, option D): a rule whose
// action is a talent ability the build does not grant is skipped, with no
// build too, whatever its conditions say.

const BUILDS = [
  ["no build", {}],
  ["the reference build", referenceBuild()],
  ["a build without Adrenaline Rush", buildWithout(["combat.adrenaline-rush"])],
  ["a build without Cold Blood", buildWithout(["assassination.cold-blood"])],
];

describe("skipOf, by the rule's action (#199)", () => {
  for (const [name, talents] of BUILDS) {
    it(`skips just what the engine passes over: ${name}`, () => {
      const state = talentState({ talents });
      const config = defaultConfig();
      config.talents = talents;
      const { rogue, simulation } = createFight(1, config);
      const host = rotationHost(rogue, simulation);
      for (const ability of talentGrantedAbilities) {
        const skip = skipOf({ action: ability, conditions: [] }, state);
        const locked = rogue.lockedByBuild(rogue.abilitiesById.get(ability));
        assert.equal(skip !== null, locked, ability);
        assert.equal(host.usable(ability), !locked, ability);
      }
      assert.equal(
        skipOf({ action: "sinister-strike", conditions: [] }, state),
        null,
      );
    });
  }

  it("names the talent with no build, before any condition", () => {
    const state = talentState({ talents: {} });
    const byAction = (action) =>
      defaultRotation().rules.find((rule) => rule.action === action);
    assert.deepEqual(skipOf(byAction("blade-flurry"), state), {
      ability: "blade-flurry",
      talent: "Blade Flurry",
      text: "no Blade Flurry talent",
    });
    assert.equal(
      skipOf(byAction("adrenaline-rush"), state)?.text,
      "no Adrenaline Rush talent",
    );
    assert.equal(
      skipOf(byAction("cold-blood"), state)?.text,
      "no Cold Blood talent",
    );
    // A guard on another talent ability, with the action granted.
    const full = talentState({ talents: referenceBuild() });
    assert.equal(skipOf(byAction("blade-flurry"), full), null);
  });

  it("still skips a rule by a failing talent check on another ability", () => {
    const state = talentState({
      talents: buildWithout(["combat.adrenaline-rush"]),
    });
    const rule = {
      action: "sinister-strike",
      conditions: [{ type: "abilityGranted", ability: "adrenaline-rush" }],
    };
    assert.equal(skipOf(rule, state)?.ability, "adrenaline-rush");
  });
});
