import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFight, runFight } from "../js/fight.js";
import { defaultRotation } from "../js/rotation-default.js";
import { SimRunner } from "../js/sim-runner.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";

// R3 (#140): SimConfig.rotation. The default is the placeholder Combat
// rotation; a rotation in the config is what the fight casts, and the result
// records it.

const SMALL = {
  schemaVersion: 1,
  name: "Builder only",
  rules: [{ action: "sinister-strike", conditions: [] }],
};

const casts = (result) =>
  Object.fromEntries(
    Object.entries(result.abilities).map(([id, stats]) => [id, stats.casts]),
  );

describe("SimConfig.rotation", () => {
  it("defaults to the placeholder Combat rotation", () => {
    assert.deepEqual(normalizeConfig().rotation, defaultRotation());
    assert.deepEqual(normalizeConfig({}).rotation, defaultRotation());
    assert.deepEqual(defaultConfig().rotation, defaultRotation());
    assert.equal(normalizeConfig().rotation.name, "Default (Combat)");
  });

  it("is recorded in the result's config, and the fight repeats from it", () => {
    const first = runFight({
      seed: 4,
      duration: 40,
      config: { rotation: SMALL },
    });
    assert.deepEqual(first.config.rotation, SMALL);
    const again = runFight({ seed: 4, duration: 40, config: first.config });
    assert.deepEqual(again, first);
    const plain = runFight({ seed: 4, duration: 40 });
    assert.deepEqual(plain.config.rotation, defaultRotation());
  });

  it("is idempotent: normalizing a normalized config changes nothing", () => {
    const once = normalizeConfig({ rotation: SMALL });
    assert.deepEqual(normalizeConfig(once), once);
    const plain = normalizeConfig();
    assert.deepEqual(normalizeConfig(plain), plain);
  });

  it("is a copy: changing the input after changes nothing", () => {
    const input = structuredClone(SMALL);
    const config = normalizeConfig({ rotation: input });
    input.rules[0].action = "eviscerate";
    input.name = "changed";
    assert.deepEqual(config.rotation, SMALL);
    const fight = createFight(1, { rotation: input });
    input.rules.length = 0;
    assert.equal(fight.config.rotation.rules.length, 1);
  });

  it("changes the casts of a fight", () => {
    const duration = 60;
    const plain = runFight({ seed: 6, duration });
    const small = runFight({ seed: 6, duration, config: { rotation: SMALL } });
    assert.ok(casts(plain)["Slice and Dice"] > 0);
    assert.ok(casts(plain)["Blade Flurry"] > 0);
    const used = Object.entries(casts(small))
      .filter(([, n]) => n > 0)
      .map(([name]) => name);
    assert.ok(used.includes("Sinister Strike"));
    assert.ok(
      !used.includes("Blade Flurry") && !used.includes("Slice and Dice"),
    );
    assert.notEqual(small.totalDamage, plain.totalDamage);
  });

  it("is what a rotation says: a finisher first pools for the energy", () => {
    const result = runFight({
      seed: 6,
      duration: 30,
      config: {
        rotation: {
          schemaVersion: 1,
          name: "Finisher or wait",
          rules: [
            {
              action: "eviscerate",
              conditions: [{ type: "comboPoints", op: ">=", value: 1 }],
            },
            { action: "sinister-strike", conditions: [] },
          ],
        },
      },
    });
    const counts = casts(result);
    assert.ok(counts.Eviscerate > 3);
    assert.ok(counts["Sinister Strike"] > counts.Eviscerate);
    assert.equal(counts["Blade Flurry"], undefined);
  });

  it("is the same on the SimRunner as on runFight", () => {
    const config = { rotation: SMALL };
    const direct = runFight({ seed: 8, duration: 25, config });
    const runner = new SimRunner({ seed: 8, duration: 25, config });
    assert.deepEqual(runner.config.rotation, SMALL);
    runner.run();
    runner.advance(Infinity);
    assert.equal(runner.state, "finished");
    assert.deepEqual(runner.result, direct);
  });

  it("rejects a bad rotation before the fight, naming each problem", () => {
    const rejects = (rotation, pattern) =>
      assert.throws(
        () => normalizeConfig({ rotation }),
        (error) => {
          assert.equal(error.name, "RangeError");
          assert.match(
            error.message,
            /^config\.rotation is not a valid rotation:\n/,
          );
          assert.match(error.message, pattern);
          return true;
        },
      );
    rejects(null, /rotation/);
    rejects({}, /schemaVersion/);
    rejects({ ...SMALL, schemaVersion: 2 }, /schemaVersion/);
    rejects(
      { ...SMALL, rules: [{ action: "Sinister Strike", conditions: [] }] },
      /rules\[0\]\.action must be an ability id.*not a display name/,
    );
    rejects(
      {
        ...SMALL,
        rules: [{ action: "eviscerate", conditions: [{ type: "bogus" }] }],
      },
      /rules\[0\]\.conditions\[0\]/,
    );
    rejects({ ...SMALL, extra: 1 }, /extra/);
    assert.throws(
      () => createFight(1, { rotation: { ...SMALL, rules: 3 } }),
      RangeError,
    );
    assert.throws(
      () => runFight({ seed: 1, duration: 5, config: { rotation: [] } }),
      RangeError,
    );
  });

  it("does not depend on the fixed step: no step in a recorded rotation", () => {
    const text = JSON.stringify(defaultRotation());
    assert.doesNotMatch(text, /step|frame|tick/i);
  });
});
