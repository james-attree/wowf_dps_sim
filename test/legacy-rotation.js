import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { ROTATION_SCHEMA_VERSION } from "../js/rotation-schema.js";

// The code rotation the rotation interpreter replaced (R3, #140), kept so the
// tests can hold the interpreter to it. It is what Rogue.rotation did before
// the rotation was a RotationRule list, with Cold Blood's rule
// (js/rotation-rules.js) folded in, line for line. It is a test helper, not
// part of the app. A test patches it over Rogue.prototype.castRotation with
// mock.method, and the haste and white-swing code, which was never part of the
// rotation, runs unchanged around it.
export function legacyCastRotation(rogue, simulation) {
  const priority = k("rotation.priority");
  for (const id of priority.onCooldown) {
    const ability = rogue.abilities[id];
    // With a build selected, an ability a talent grants (Blade Flurry,
    // Adrenaline Rush) is cast only when the build has the talent.
    if (!rogue.lockedByBuild(ability)) {
      ability.cast(rogue, simulation);
    }
  }

  if (rogue.comboPoints >= k("rotation.finisherComboPoints")) {
    const sliceAndDice = rogue.abilities[priority.sliceAndDice];
    const active = simulation.activeBuffs[sliceAndDice.id];
    const refresh =
      !active || active.duration <= k("rotation.sliceAndDiceRefreshSeconds");
    const finisher = refresh
      ? sliceAndDice
      : rogue.abilities[priority.eviscerate];
    // Cold Blood: when the rotation has chosen Eviscerate, cast it first if
    // the build granted it. Cold Blood is off the GCD, and the Eviscerate may
    // go in a later step, when the energy is there.
    const rule = k("rotation.coldBlood");
    if (finisher === rogue.abilities[rule.beforeFinisher]) {
      const coldBlood = rogue.abilities[rule.ability];
      if (coldBlood && rogue.granted.has(coldBlood.id)) {
        coldBlood.cast(rogue, simulation);
      }
    }
    finisher.cast(rogue, simulation);
  } else {
    rogue.abilities[priority.builder].cast(rogue, simulation);
  }
}

// The code rotation above as a RotationRule list: defaultRotation() as it was
// from #140 until issue #155 gave the default the combat-swords preset's Slice
// and Dice rules. test/rotation-equivalence.test.js runs it through the
// interpreter and holds it to legacyCastRotation, fight for fight.
export function legacyRotation() {
  const idOf = (key) =>
    ABILITY_DEFINITIONS.find((entry) => entry.key === key).id;
  const rule = (action, ...conditions) => ({ action, conditions });
  const priority = k("rotation.priority");
  const coldBlood = k("rotation.coldBlood");
  const enoughPoints = {
    type: "comboPoints",
    op: ">=",
    value: k("rotation.finisherComboPoints"),
  };
  const sliceAndDice = idOf(priority.sliceAndDice);
  const aura = (op) => ({
    type: "auraRemaining",
    aura: sliceAndDice,
    op,
    value: k("rotation.sliceAndDiceRefreshSeconds"),
  });
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
  const coldBloodId = idOf(coldBlood.ability);
  return {
    schemaVersion: ROTATION_SCHEMA_VERSION,
    name: "Combat (before #155)",
    rules: [
      ...priority.onCooldown.map((key) => onCooldown(key)),
      rule(sliceAndDice, enoughPoints, aura("<=")),
      rule(
        coldBloodId,
        { type: "abilityGranted", ability: coldBloodId },
        enoughPoints,
        aura(">"),
      ),
      rule(idOf(priority.eviscerate), enoughPoints),
      rule(idOf(priority.builder)),
    ],
  };
}
