import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { ROTATION_SCHEMA_VERSION } from "./rotation-schema.js";

// The rotation a fight casts when its config names none (R3, #140): today's
// placeholder Combat rotation as a RotationRule list (docs/rotation.md,
// example 1). It is built from the constants (rotation.priority,
// rotation.finisherComboPoints, rotation.pooling, energy.max,
// rotation.sliceAndDiceRefreshSeconds and rotation.coldBlood), so those rows
// stay where the numbers are tuned and their provenance stays with them, and
// the rotation is a plain JSON value. test/rotation-default.test.js holds it
// equal to the example in docs/rotation.md.
//
// Slice and Dice is kept up with the combat-swords preset's two refresh rules
// (data/rotation-presets.js, issue #122; taken into the default in issue
// #155): at the finisher's combo points it is recast when it has less than
// rotation.pooling.recastSeconds left, or when it has at most
// rotation.pooling.windowSeconds left and energy is full. They replace the
// single rule the default had before #155 (recast at
// rotation.sliceAndDiceRefreshSeconds left), which test/legacy-rotation.js
// keeps as the code rotation. Only those rules changed: Eviscerate and the
// builder are as before, and Cold Blood still waits while Slice and Dice has
// rotation.sliceAndDiceRefreshSeconds or less left.
//
// Blade Flurry and Adrenaline Rush start the GCD (gcd.flags), so an on-GCD rule
// that holds but cannot be cast holds the walk (docs/rotation.md). The code
// rotation tried each of them and went on, so each rule says when it can be
// cast: `abilityUnlocked` (the selected build has the talent), `cooldownReady`,
// and for Blade Flurry the energy it costs, so that one it cannot afford does
// not hold back Adrenaline Rush, which costs none. Cold Blood is cast only when
// granted (the validator requires that, #155): with no build and no host grant
// it is never cast. It goes before the finisher rotation.coldBlood names; for
// any other finisher the rule is left out, as the code rotation left the cast
// out.
const idOf = (key) => {
  const definition = ABILITY_DEFINITIONS.find((entry) => entry.key === key);
  if (definition === undefined) {
    throw new RangeError(`rotation.* names "${key}", which is not an ability.`);
  }
  return definition.id;
};

// A rule for an ability cast when ready: the build has it, it is off cooldown,
// and its energy cost is there.
const onCooldown = (key) => {
  const id = idOf(key);
  const { energy } = k(key);
  return rule(
    id,
    { type: "abilityUnlocked", ability: id },
    { type: "cooldownReady", ability: id },
    ...(energy > 0
      ? [{ type: "resource", resource: "energy", op: ">=", value: energy }]
      : []),
  );
};

const rule = (action, ...conditions) => ({ action, conditions });

// A new object on every call, so nobody can change another fight's default.
export function defaultRotation() {
  const priority = k("rotation.priority");
  const coldBlood = k("rotation.coldBlood");
  const finisher = k("rotation.finisherComboPoints");
  const refresh = k("rotation.sliceAndDiceRefreshSeconds");
  const sliceAndDice = idOf(priority.sliceAndDice);
  const enoughPoints = { type: "comboPoints", op: ">=", value: finisher };
  const { windowSeconds, recastSeconds } = k("rotation.pooling");
  const remaining = (op, value) => ({
    type: "auraRemaining",
    aura: sliceAndDice,
    op,
    value,
  });
  return {
    schemaVersion: ROTATION_SCHEMA_VERSION,
    name: "Combat (placeholder)",
    rules: [
      ...priority.onCooldown.map((key) => onCooldown(key)),
      rule(sliceAndDice, enoughPoints, remaining("<", recastSeconds)),
      rule(sliceAndDice, enoughPoints, remaining("<=", windowSeconds), {
        type: "resource",
        resource: "energy",
        op: ">=",
        value: k("energy.max"),
      }),
      ...(coldBlood.beforeFinisher === priority.eviscerate
        ? [
            rule(
              idOf(coldBlood.ability),
              { type: "abilityGranted", ability: idOf(coldBlood.ability) },
              enoughPoints,
              remaining(">", refresh),
            ),
          ]
        : []),
      rule(idOf(priority.eviscerate), enoughPoints),
      rule(idOf(priority.builder)),
    ],
  };
}
