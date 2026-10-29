import { k } from "../data/constants.js";

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
