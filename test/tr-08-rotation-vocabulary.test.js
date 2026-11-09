// TR-08 / #338: shank and death-mark are rotation actions. Existing
// condition types name their cooldowns, the venom / poised / ambush-window
// auras, and the death-mark debuff. There is no deathMarkStored type.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { createFight } from "../js/fight.js";
import { rotationHost } from "../js/rotation-host.js";
import {
  CONDITION_TYPES,
  conditionErrors,
  evaluate,
} from "../js/rotation-conditions.js";
import { rotationState } from "../js/rotation-state.js";
import { rotationContext, validateRotation } from "../js/rotation-validator.js";
import { rotationWarnings } from "../js/rotation-warnings.js";

const rotation = (rules) => ({
  schemaVersion: 1,
  name: "TR-08",
  rules,
});

const rule = (action, ...conditions) => ({ action, conditions });

function fight(abilities, weapons) {
  return createFight(
    1,
    {
      character: { attackPower: 0, critChance: 0 },
      target: { armor: 0 },
      weapons,
    },
    { abilities },
  );
}

const daggers = {
  mainHand: { type: "dagger", min: 100, max: 100, speed: 1.8 },
  offHand: { type: "dagger", min: 40, max: 40, speed: 1.4 },
};

describe("TR-08 rotation vocabulary (#338)", () => {
  it("accepts shank and death-mark, and refuses deathMarkStored", () => {
    assert.equal(CONDITION_TYPES.includes("deathMarkStored"), false);
    assert.equal(
      conditionErrors({ type: "deathMarkStored" })[0].code,
      "unknownConditionType",
    );
    const context = rotationContext();
    assert.ok(context.castable.includes("shank"));
    assert.ok(context.castable.includes("death-mark"));
    for (const aura of ["venom", "poised", "ambush-window"]) {
      assert.ok(context.auras.includes(aura), aura);
    }
    assert.equal(context.debuffs["death-mark"], 1);

    const value = rotation([
      rule(
        "shank",
        { type: "cooldownReady", ability: "shank" },
        { type: "auraActive", aura: "venom" },
        { type: "auraActive", aura: "poised", active: false },
        { type: "auraRemaining", aura: "ambush-window", op: ">", value: 0 },
      ),
      rule(
        "death-mark",
        { type: "abilityGranted", ability: "death-mark" },
        { type: "cooldownReady", ability: "death-mark" },
        { type: "comboPoints", op: ">=", value: 1 },
        { type: "debuffActive", debuff: "death-mark", active: false },
        {
          type: "debuffRemaining",
          debuff: "death-mark",
          op: "<=",
          value: 1,
        },
        { type: "debuffStacks", debuff: "death-mark", op: "==", value: 0 },
      ),
    ]);
    assert.deepEqual(validateRotation(value), []);
    assert.deepEqual(rotationWarnings(value), []);
    assert.equal(
      validateRotation(
        rotation([
          rule("sinister-strike", {
            type: "deathMarkStored",
            op: ">",
            value: 0,
          }),
        ]),
      )[0].code,
      "unknownConditionType",
    );
  });

  it("warns when Shank's cooldown is not checked, and still says nothing about Ambush", () => {
    const shank = rotation([rule("shank"), rule("sinister-strike")]);
    assert.deepEqual(
      rotationWarnings(shank).map((warning) => warning.code),
      ["cooldownNotChecked", "starves"],
    );
    const ambush = rotation([rule("ambush"), rule("sinister-strike")]);
    assert.deepEqual(validateRotation(ambush), []);
    assert.deepEqual(rotationWarnings(ambush), []);
  });

  it("passes Ambush over unless Ghostly Strike is granted", () => {
    const bare = fight([], daggers);
    const bareHost = rotationHost(bare.rogue, bare.simulation);
    assert.equal(bareHost.usable("ambush"), false);

    const granted = fight(["ghostly-strike"], daggers);
    const host = rotationHost(granted.rogue, granted.simulation);
    assert.equal(host.usable("ambush"), true);
    assert.equal(host.gated("ambush"), true);
    assert.equal(host.ready("ambush"), false);
  });

  it("reads venom, poised, the ambush window and the death-mark debuff", () => {
    const built = fight(["death-mark"], daggers);
    const { simulation } = built;
    simulation.applyAura(simulation.auraDefinitions.get("venom"), {
      duration: k("venom").duration,
    });
    simulation.applyAura(simulation.auraDefinitions.get("poised"), {
      duration: k("poised").duration,
    });
    simulation.applyAura(simulation.auraDefinitions.get("ambush-window"), {
      duration: k("ghostlyStrike.ambushWindow"),
    });
    const before = rotationState(built.rogue, simulation, { duration: 60 });
    assert.equal(evaluate({ type: "auraActive", aura: "venom" }, before), true);
    assert.equal(
      evaluate({ type: "auraActive", aura: "poised" }, before),
      true,
    );
    assert.equal(
      evaluate(
        { type: "auraRemaining", aura: "ambush-window", op: ">", value: 0 },
        before,
      ),
      true,
    );
    built.rogue.comboPoints = 1;
    built.rogue.energy = built.rogue.maxEnergy;
    simulation.gcd = 0;
    simulation.rng = () => 0.99;
    built.rogue.abilities.deathMark.cast(built.rogue, simulation);
    const state = rotationState(built.rogue, simulation, { duration: 60 });
    assert.equal(
      evaluate({ type: "debuffActive", debuff: "death-mark" }, state),
      true,
    );
    assert.equal(
      evaluate({ type: "cooldownReady", ability: "shank" }, state),
      true,
    );
    assert.equal(
      evaluate({ type: "cooldownReady", ability: "death-mark" }, state),
      false,
    );
  });
});
