import { TALENT_EFFECTS } from "../data/talent-effects.js";

// The procs the snapshot's talents give (roadmap A4), as rank tables for
// defineRankedProc, keyed by talent id. They are not written here: the proc
// specs of a talent are the `procs` of its entry in data/talent-effects.js,
// next to the modifiers of the same talent, and this is the view of them the
// proc code reads. The chances are constants (data/constants.js), so the engine
// holds no number. Nothing here turns a talent on by itself: a host lists the
// procs it wants in Rogue's `procs` option, from procsFromTalents or from
// expandTalents (js/talent-build.js), which also gives the talents' modifiers.
//
//   combat.hack-and-slash         Axe and Sword melee attacks have a chance to
//                                 trigger an extra attack.
//   combat.puncturing-wounds      Backstab has a chance to add a combo point.
// The talents' other lines (Dagger and Fist crit, Mace armor, Backstab and
// Mutilate crit) are modifiers, in the same entries.
export const PROC_TABLES = Object.freeze(
  Object.fromEntries(
    Object.entries(TALENT_EFFECTS)
      .filter(([, effect]) => effect.procs !== undefined)
      .map(([id, effect]) => [id, effect.procs]),
  ),
);
