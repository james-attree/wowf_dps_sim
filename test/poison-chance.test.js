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
// The exact sums A9 names, written as literals so a float drift shows.
const INSTANT_PLUS_10 = 0.3;
const INSTANT_PLUS_20 = 0.4;
const DEADLY_PLUS_10 = 0.4;
const DEADLY_PLUS_20 = 0.5;
const IMPROVED_POISONS = [0.02, 0.04, 0.06, 0.08, 0.1];
const INSTANT_BY_RANK = [0.22, 0.24, 0.26, 0.28, 0.3];
const DEADLY_BY_RANK = [0.32, 0.34, 0.36, 0.38, 0.4];

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
    // Exactly: 0.2 + 0.1 in floats is 0.30000000000000004, and A9 says exact.
    assert.deepEqual(at(TEN), [
      ["instant-poison.mainHand", INSTANT_PLUS_10],
      ["deadly-poison.offHand", DEADLY_PLUS_10],
    ]);
    assert.deepEqual(at(TEN, TEN), [
      ["instant-poison.mainHand", INSTANT_PLUS_20],
      ["deadly-poison.offHand", DEADLY_PLUS_20],
    ]);
    assert.equal(at(TEN)[0][1], INSTANT_PLUS_10);
  });

  it("is exact at every Improved Poisons rank", () => {
    IMPROVED_POISONS.forEach((value, index) => {
      assert.deepEqual(
        chances(new Rogue({ poisons: BOTH }, { modifiers: bonus(value) })),
        [
          ["instant-poison.mainHand", INSTANT_BY_RANK[index]],
          ["deadly-poison.offHand", DEADLY_BY_RANK[index]],
        ],
        `rank ${index + 1}`,
      );
    });
  });

  it("is capped at 100%", () => {
    const rogue = new Rogue({ poisons: BOTH }, { modifiers: bonus(NINETY) });
    assert.deepEqual(chances(rogue), [
      ["instant-poison.mainHand", 1],
      ["deadly-poison.offHand", 1],
    ]);
  });

  it("caps exactly at the cap: 20 + 80 points reaches it, 30 + 180 passes it", () => {
    const cap = k("poison.chanceCap");
    const at = (...values) =>
      chances(new Rogue({ poisons: BOTH }, { modifiers: bonus(...values) }));
    // Instant 20 + 80 reaches the cap; Deadly 30 + 80 passes it.
    for (const [, chance] of at(NINETY - TEN)) {
      assert.ok(chance <= cap, `${chance}`);
    }
    assert.deepEqual(
      at(NINETY - TEN).map(([, chance]) => chance),
      [cap, cap],
    );
    assert.deepEqual(
      at(NINETY, NINETY).map(([, chance]) => chance),
      [cap, cap],
    );
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
