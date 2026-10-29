import { gcdClear } from "./ability.js";
import { rotationStateReader } from "./rotation-state.js";

// The Rogue's side of the rotation interpreter (R3, #140): the `host` that
// decide (js/rotation-interpreter.js) is given at a decision point. It answers
// the interpreter's five questions from a Rogue and its Simulation, and that
// is all it does. Nothing here is in the interpreter, so the Phase 3.5 engine
// writes its own host and calls decide unchanged.
//
//   state()    the view conditions read (js/rotation-state.js), built a part
//              at a time and not frozen: building and freezing all of it was
//              most of the cost of a decision point. It is valid until the
//              fight next changes.
//   canCast    the ability is not held back by the selected build
//              (Rogue.lockedByBuild: a talent ability the build lacks) and
//              would go ahead now (Ability.canCast: cooldown, cost, GCD).
//   onGcd      the ability starts the global cooldown (Ability.triggersGcd).
//   gcdClear   the global cooldown is not running (gcdClear in js/ability.js).
//   cast       cast it (Ability.cast).
//
// A locked ability is "cannot be cast" here, but a rule for an on-GCD ability
// that holds and cannot be cast ends the walk, so a rule for a talent ability
// still carries abilityUnlocked (docs/rotation.md, "Granted and unlocked").
//
// `options.duration` is the fight's length in seconds, when the host knows it
// (js/rotation-state.js). The engine as it is has no fight length at a
// decision point, so the Rogue passes none and fightTimeRemaining reads as
// Infinity.
export function rotationHost(rogue, simulation, options = {}) {
  const ability = (id) => rogue.abilitiesById.get(id);
  return {
    state: rotationStateReader(rogue, simulation, options),
    canCast: (id) => {
      const found = ability(id);
      return !rogue.lockedByBuild(found) && found.canCast(rogue, simulation);
    },
    onGcd: (id) => ability(id).triggersGcd,
    gcdClear: () => gcdClear(simulation),
    cast: (id) => {
      ability(id).cast(rogue, simulation);
    },
  };
}
