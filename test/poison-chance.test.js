import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { MODIFIER_KINDS } from "../js/modifiers.js";
import { poisonProcs } from "../js/poisons.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

// Issue #266 (P4.6-03), A9: the poisonChance modifier kind. Poison chance is
// additive percentage points, as in Classic, capped at poison.chanceCap (100%).

const BOTH = { mainHand: "instant", offHand: "deadly" };
const INSTANT = 0.2;
const DEADLY = 0.3;
const TEN = 0.1;
const NINETY = 0.9;

function bonus(...values) {
  return values.map((value) => ({ kind: "poisonChance", op: "add", value }));
}

function chances(rogue) {
  return rogue.procs.map((proc) => [proc.id, proc.chance.value]);
}

describe("poisonChance (#266, A9)", () => {
  it("is a flat modifier kind with no scope, and the cap is an assumption row", () => {
    assert.deepEqual(MODIFIER_KINDS.poisonChance.scope, []);
    assert.equal(k("modifiers.stacking").poisonChance, "flat");
    const cap = CONSTANTS["poison.chanceCap"];
    assert.equal(cap.value, 1);
    assert.equal(cap.source, "assumption");
    assert.match(cap.ref, /^James, 31 Oct 2026, issue #266: /);
  });

  it("leaves every poison chance as the export gives it at 0 (G1)", () => {
    assert.deepEqual(poisonProcs(BOTH), poisonProcs(BOTH, undefined, k, 0));
    assert.deepEqual(chances(new Rogue({ poisons: BOTH })), [
      ["instant-poison.mainHand", INSTANT],
      ["deadly-poison.offHand", DEADLY],
    ]);
  });

  it("adds percentage points, exact per combination", () => {
    const at = (...values) =>
      chances(new Rogue({ poisons: BOTH }, { modifiers: bonus(...values) }));
    // Instant 20% + 10 (Improved Poisons 5/5) = 30%; + 10 (Venom) = 40%.
    assert.deepEqual(at(TEN), [
      ["instant-poison.mainHand", INSTANT + TEN],
      ["deadly-poison.offHand", DEADLY + TEN],
    ]);
    assert.deepEqual(at(TEN, TEN), [
      ["instant-poison.mainHand", INSTANT + (TEN + TEN)],
      ["deadly-poison.offHand", DEADLY + (TEN + TEN)],
    ]);
    assert.ok(Math.abs(at(TEN, TEN)[0][1] - 0.4) < k("sim.tickEpsilon"));
  });

  it("is capped at 100%", () => {
    const rogue = new Rogue({ poisons: BOTH }, { modifiers: bonus(NINETY) });
    assert.deepEqual(chances(rogue), [
      ["instant-poison.mainHand", 1],
      ["deadly-poison.offHand", 1],
    ]);
  });

  it("registers no proc and draws nothing without a poison, or at 0 (G2)", () => {
    assert.deepEqual(new Rogue({}, { modifiers: bonus(TEN) }).procs, []);
    const draws = (modifiers) => {
      let count = 0;
      const sim = new Simulation(new Rogue({ poisons: BOTH }, { modifiers }), {
        rng: () => {
          count += 1;
          return 0.5;
        },
      });
      sim.run(30);
      return count;
    };
    assert.equal(draws(bonus(0)), draws([]));
  });
});
