import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { runScriptedFight } from "../scripts/scripted-fight.mjs";

// Issue #85. runScriptedFight is test tooling for the golden cases: it runs
// runFight with a fixed cast order in place of the placeholder rotation.

const BUILDER = "sinisterStrike";

describe("runScriptedFight", () => {
  it("returns a runFight-shaped result and casts the script in order", () => {
    const result = runScriptedFight({
      seed: 3,
      duration: 20,
      script: [BUILDER, BUILDER, "hemorrhage", "eviscerate"],
    });
    assert.deepEqual(
      Object.keys(result),
      Object.keys(runFight({ seed: 3, duration: 0 })),
    );
    assert.equal(result.seed, 3);
    assert.equal(result.duration, 20);
    const casts = result.log
      .filter((event) => event.type === "skill")
      .map((event) => event.name)
      .reverse();
    assert.deepEqual(casts, [
      "Sinister Strike",
      "Sinister Strike",
      "Hemorrhage",
      "Eviscerate",
    ]);
  });

  it("is repeatable for a seed and differs for another seed", () => {
    const script = [BUILDER, BUILDER, BUILDER, "rupture"];
    const a = runScriptedFight({ seed: 5, duration: 25, script });
    assert.deepEqual(runScriptedFight({ seed: 5, duration: 25, script }), a);
    assert.notDeepEqual(runScriptedFight({ seed: 6, duration: 25, script }), a);
  });

  it("waits for energy and the GCD instead of skipping a cast", () => {
    // Two builders cost more energy than the rogue starts with, so the second
    // cast comes later than the first, and a finisher never jumps the queue.
    const result = runScriptedFight({
      seed: 1,
      duration: 20,
      script: [BUILDER, BUILDER, BUILDER],
    });
    const times = result.log
      .filter((event) => event.name === "Sinister Strike")
      .map((event) => event.time)
      .reverse();
    assert.equal(times.length, 3);
    assert.ok(times[1] > times[0]);
    assert.ok(times[2] > times[1]);
  });

  it("counts a cast that is not an attack, such as Slice and Dice", () => {
    const result = runScriptedFight({
      seed: 2,
      duration: 20,
      script: [BUILDER, BUILDER, "sliceAndDice"],
    });
    assert.equal(result.abilities["Slice and Dice"].casts, 1);
    assert.equal(result.abilities["Sinister Strike"].casts, 2);
  });

  it("never lets the placeholder rotation cast", () => {
    const result = runScriptedFight({
      seed: 1,
      duration: 20,
      script: ["hemorrhage"],
    });
    assert.deepEqual(Object.keys(result.abilities).sort(), [
      "Hemorrhage",
      "Main-hand",
      "Off-hand",
    ]);
  });

  it("throws when the script does not finish, and says what to do", () => {
    assert.throws(
      () =>
        runScriptedFight({
          seed: 1,
          duration: 2,
          script: [BUILDER, BUILDER, BUILDER, BUILDER],
        }),
      /did not finish: \d+ casts? still waiting after 2s, next "sinisterStrike".*Lengthen/,
    );
  });

  it("throws for an unknown ability and an empty or missing script", () => {
    assert.throws(
      () => runScriptedFight({ seed: 1, duration: 5, script: ["fireball"] }),
      /"fireball", which is not a Rogue ability/,
    );
    assert.throws(
      () => runScriptedFight({ seed: 1, duration: 5, script: [] }),
      RangeError,
    );
    assert.throws(() => runScriptedFight({ seed: 1, duration: 5 }), RangeError);
  });

  it("throws a RangeError when called with no options or a non-object", () => {
    const original = Rogue.prototype.rotation;
    for (const options of [
      undefined,
      null,
      "sinisterStrike",
      42,
      true,
      Symbol("options"),
    ]) {
      assert.throws(() => runScriptedFight(options), {
        name: "RangeError",
        message: /needs an options object/,
      });
    }
    assert.throws(() => runScriptedFight(), RangeError);
    assert.throws(() => runScriptedFight(null), RangeError);
    assert.equal(Rogue.prototype.rotation, original);
  });

  it("rejects inherited property names as ability names", () => {
    const original = Rogue.prototype.rotation;
    const inherited = [
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "__proto__",
    ];
    for (const name of inherited) {
      assert.throws(
        () => runScriptedFight({ seed: 1, duration: 5, script: [name] }),
        {
          name: "RangeError",
          message: new RegExp(`"${name}", which is not a Rogue ability`),
        },
        name,
      );
      // Also when it comes after a real cast, not only as the first entry.
      assert.throws(
        () =>
          runScriptedFight({ seed: 1, duration: 5, script: [BUILDER, name] }),
        RangeError,
        name,
      );
    }
    assert.equal(Rogue.prototype.rotation, original);
  });

  it("rejects an entry that is not a string", () => {
    for (const entry of [0, null, undefined, {}, Symbol("cast")]) {
      assert.throws(
        () => runScriptedFight({ seed: 1, duration: 5, script: [entry] }),
        { name: "RangeError", message: /not a Rogue ability/ },
      );
    }
  });

  it("says an array entry is an array, not the names inside it", () => {
    const original = Rogue.prototype.rotation;
    for (const entry of [[BUILDER], [BUILDER, BUILDER], []]) {
      assert.throws(
        () => runScriptedFight({ seed: 1, duration: 5, script: [entry] }),
        {
          name: "RangeError",
          message: /names an array \(each entry must be one ability key/,
        },
      );
    }
    // The message does not print the array's items as if they were a name.
    assert.throws(
      () => runScriptedFight({ seed: 1, duration: 5, script: [[BUILDER]] }),
      (error) => !error.message.includes(`"${BUILDER}"`),
    );
    assert.equal(Rogue.prototype.rotation, original);
  });

  it("puts the rotation back, even after a failure", () => {
    const original = Rogue.prototype.rotation;
    runScriptedFight({ seed: 1, duration: 5, script: [BUILDER] });
    assert.equal(Rogue.prototype.rotation, original);
    assert.throws(() =>
      runScriptedFight({ seed: 1, duration: 5, script: ["nope"] }),
    );
    assert.equal(Rogue.prototype.rotation, original);
    assert.throws(() =>
      runScriptedFight({ seed: 1, duration: -1, script: [BUILDER] }),
    );
    assert.equal(Rogue.prototype.rotation, original);
    // Skills have no cast override left over on the instance.
    const rogue = new Rogue();
    new Simulation(rogue, { seed: 1 });
    assert.ok(
      Object.values(rogue.abilities).every(
        (skill) => !Object.hasOwn(skill, "cast"),
      ),
    );
  });
});
