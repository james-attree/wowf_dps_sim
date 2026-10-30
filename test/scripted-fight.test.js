import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { FINISHER_SCRIPT_IN_BUDGET } from "../scripts/golden-update.mjs";
import { scriptedRotation } from "../scripts/scripted-fight.mjs";

// Issue #234 (Kira's #248 QA, polish 3). The scripted castRotation returns the
// script's casts, as the event core counts them (scripts/scripted-fight.mjs):
// every cast the script made, in order, and "none" when it made none.
function recordedFight(script, seed = 68, duration = 50) {
  const original = Rogue.prototype.castRotation;
  const scripted = scriptedRotation(script, original);
  const returns = [];
  Rogue.prototype.castRotation = function (simulation) {
    const result = scripted.castRotation.call(this, simulation);
    returns.push({ result });
    return result;
  };
  try {
    const fight = runFight({ seed, duration });
    return { fight, returns, scripted };
  } finally {
    Rogue.prototype.castRotation = original;
  }
}

describe("the scripted castRotation's cast list", () => {
  it("reports every scripted cast once, in order, as the skills' ids", () => {
    const { fight, returns, scripted } = recordedFight(
      FINISHER_SCRIPT_IN_BUDGET,
    );
    assert.equal(scripted.remaining, 0);
    const reported = returns.flatMap(({ result }) => result.casts);
    const rogue = new Rogue();
    assert.deepEqual(
      reported,
      FINISHER_SCRIPT_IN_BUDGET.map((key) => rogue.abilities[key].id),
    );
    // As many as the fight's ability records count.
    const counted = Object.values(fight.abilities)
      .filter((record) => record.casts > 0)
      .reduce((total, record) => total + record.casts, 0);
    const swings = ["Main-hand", "Off-hand"]
      .map((hand) => fight.abilities[hand]?.casts ?? 0)
      .reduce((a, b) => a + b, 0);
    assert.equal(reported.length, counted - swings);
  });

  it('says "cast" when it cast and "none" when it did not', () => {
    const { returns } = recordedFight(FINISHER_SCRIPT_IN_BUDGET);
    for (const { result } of returns) {
      assert.equal(result.outcome, result.casts.length > 0 ? "cast" : "none");
    }
    assert.ok(returns.some(({ result }) => result.outcome === "cast"));
    assert.ok(returns.some(({ result }) => result.outcome === "none"));
  });

  it("reports nothing once the script is done", () => {
    const { returns } = recordedFight(["sinisterStrike"]);
    const firstCast = returns.findIndex(
      ({ result }) => result.casts.length > 0,
    );
    assert.notEqual(firstCast, -1);
    assert.deepEqual(returns[firstCast].result.casts, [
      new Rogue().abilities.sinisterStrike.id,
    ]);
    for (const { result } of returns.slice(firstCast + 1)) {
      assert.deepEqual(result, { casts: [], outcome: "none" });
    }
  });
});
