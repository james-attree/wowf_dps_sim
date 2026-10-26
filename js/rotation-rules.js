import { k } from "../data/constants.js";

// Rotation rules for abilities a talent grants (roadmap D8a, #119). The
// placeholder rotation (Rogue.rotation) is the Combat priority; a rule here is
// one extra cast that applies only when the build was given the ability, so a
// fight without the talent is the same fight it always was. Each rule is its
// own small function, with its numbers in data/constants.js, so a different
// rule is a change to this file and one row, not to the rotation.
//
// The rule that exists:
//
//   Cold Blood (row rotation.coldBlood): when the rotation has chosen to cast
//   Eviscerate, cast Cold Blood first, if the build grants it and it is off
//   cooldown. At the finisher combo points that is a 5-point Eviscerate. Cold
//   Blood is off the GCD, so both go in the same step. It is cast before the
//   Eviscerate lands, and the aura waits for the next Sinister Strike,
//   Backstab, Ambush, Eviscerate or Mutilate that lands, whichever is first.
//   The rule is "the Scout's, to be adjusted": see docs/mechanics.md.

// Called by Rogue.rotation with the finisher it has chosen, before the cast.
export function beforeFinisher(rogue, simulation, finisher) {
  const rule = k("rotation.coldBlood");
  if (finisher !== rogue.abilities[rule.beforeFinisher]) {
    return;
  }
  const coldBlood = rogue.abilities[rule.ability];
  // Granted by a talent (Rogue option `abilities`). Without it, nothing.
  if (!coldBlood || !rogue.granted.has(coldBlood.id)) {
    return;
  }
  coldBlood.cast(rogue, simulation);
}
