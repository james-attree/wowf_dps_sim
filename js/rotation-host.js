import { gcdClear } from "./ability.js";
import { rotationStateReader } from "./rotation-state.js";

// The Rogue's side of the rotation interpreter (R3, #140): the `host` that
// decide (js/rotation-interpreter.js) is given at a decision point. It answers
// the interpreter's six questions from a Rogue and its Simulation, and that
// is all it does. Nothing here is in the interpreter, so the Phase 3.5 engine
// writes its own host and calls decide unchanged.
//
//   state()    the view conditions read (js/rotation-state.js), built a part
//              at a time and not frozen: building and freezing all of it was
//              most of the cost of a decision point. It is valid until the
//              fight next changes.
//   canCast    the ability is not held back by the build
//              (Rogue.lockedByBuild: a talent ability the build lacks) and
//              would go ahead now (Ability.canCast: cooldown, cost, GCD).
//   onGcd      the ability starts the global cooldown (Ability.triggersGcd).
//   usable     the main hand is the weapon type the ability needs
//              (Ability.mainHandAllowed: Backstab needs a dagger), and the
//              ability is not a talent ability the build lacks
//              (Rogue.lockedByBuild, #199; with no talents picked every talent
//              ability is lacked). The weapon and the build's grants are fixed
//              for the fight, so the interpreter asks once and passes over a
//              rule that can never cast, instead of pooling for it forever
//              (#155).
//   gcdClear   the global cooldown is not running (gcdClear in js/ability.js).
//   cast       cast it (Ability.cast).
//
// A locked ability is "not usable" (#199, option D): its rule is passed over
// whatever its conditions say, so a rule for a talent ability needs no guard
// for the engine (docs/rotation.md, "Granted and unlocked"). canCast keeps the
// lock as well, so nothing that asks canCast alone casts a locked ability.
//
// `options.duration` is the fight's length in seconds, when the host knows it
// (js/rotation-state.js). The Rogue passes its Simulation's fightLength
// (#191): createFight's options.duration, which runFight and SimRunner set to
// the length they run. Without one it is null and fightTimeRemaining reads as
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
    usable: (id) => {
      const found = ability(id);
      return found.mainHandAllowed(rogue) && !rogue.lockedByBuild(found);
    },
    gcdClear: () => gcdClear(simulation),
    cast: (id) => {
      ability(id).cast(rogue, simulation);
    },
  };
}
