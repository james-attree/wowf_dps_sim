import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { BatchRunner, deriveSeed, runBatch } from "../js/batch-runner.js";
import { createFight, runFight } from "../js/fight.js";
import { createRng, describeSeed, normalizeSeed } from "../js/rng.js";
import { SimRunner } from "../js/sim-runner.js";
import { Simulation } from "../js/simulation.js";

// Issue #187 (P3.5-01): js/rng.js normalizeSeed is the one seed check. Every
// entry point that takes a seed throws the same RangeError text for a bad
// one, and the text names the bad value. These are contract tests: they read
// only the thrown error and the reported seed.

// The bad seeds the issue names, and the text each one shows.
const BAD = [
  [undefined, "undefined"],
  [null, "null"],
  [1.5, "1.5"],
  [Number.NaN, "NaN"],
  ["7", '"7"'],
];

const message = (shown) => `A seed must be an integer; got ${shown}.`;

// Every public way to hand the engine a seed.
const ENTRY_POINTS = {
  SimRunner: (seed) => new SimRunner({ seed }),
  runFight: (seed) => runFight({ seed, duration: 1 }),
  runBatch: (seed) => runBatch({ seed, iterations: 1, duration: 1 }),
  BatchRunner: (seed) => new BatchRunner({ seed, iterations: 1, duration: 1 }),
  createFight: (seed) => createFight(seed),
  deriveSeed: (seed) => deriveSeed(seed, 0),
  normalizeSeed: (seed) => normalizeSeed(seed),
};

describe("seed check (#187)", () => {
  for (const [name, enter] of Object.entries(ENTRY_POINTS)) {
    it(`${name} throws the one RangeError text, naming the bad value`, () => {
      for (const [bad, shown] of BAD) {
        assert.throws(() => enter(bad), {
          name: "RangeError",
          message: message(shown),
        });
      }
    });
  }

  it("createRng and Simulation use the same text (undefined means the default seed there)", () => {
    for (const [bad, shown] of BAD.filter(([seed]) => seed !== undefined)) {
      assert.throws(() => createRng(bad), {
        name: "RangeError",
        message: message(shown),
      });
      assert.throws(() => new Simulation(null, { seed: bad }), {
        name: "RangeError",
        message: message(shown),
      });
    }
  });

  it("2^32 and -1 still wrap as documented, at every entry point", () => {
    for (const [seed, wrapped] of [
      [2 ** 32, 0],
      [-1, 4294967295],
      [2 ** 32 + 5, 5],
    ]) {
      assert.equal(normalizeSeed(seed), wrapped);
      assert.equal(new SimRunner({ seed }).seed, wrapped);
      assert.equal(runFight({ seed, duration: 1 }).seed, wrapped);
      assert.equal(createFight(seed).seed, wrapped);
      assert.equal(
        runBatch({ seed, iterations: 1, duration: 1 }).seed,
        wrapped,
      );
      assert.equal(deriveSeed(seed, 0), deriveSeed(wrapped, 0));
    }
  });

  it("describes other values by kind, quotes strings and cuts long ones", () => {
    assert.equal(describeSeed(Infinity), "Infinity");
    assert.equal(describeSeed(-Infinity), "-Infinity");
    assert.equal(describeSeed(true), "true");
    assert.equal(describeSeed(""), '""');
    assert.equal(describeSeed(7n), "7n");
    assert.equal(describeSeed(Symbol("s")), "Symbol(s)");
    assert.equal(describeSeed({ seed: 1 }), "an object");
    assert.equal(describeSeed([1]), "an array");
    assert.equal(
      describeSeed(() => 1),
      "a function",
    );
    const limit = k("rng.seedTextLimit");
    assert.equal(limit, 40);
    assert.equal(
      describeSeed("x".repeat(limit)),
      JSON.stringify("x".repeat(limit)),
    );
    assert.equal(
      describeSeed("x".repeat(limit + 1)),
      JSON.stringify(`${"x".repeat(limit)}...`),
    );
    assert.equal(describeSeed('a"b'), '"a\\"b"');
  });
});
