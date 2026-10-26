import { k } from "../data/constants.js";

// The procs the snapshot's talents give (roadmap A4), as rank tables for
// defineRankedProc. The chances are constants (data/constants.js), so the
// engine holds no number. Nothing here turns a talent on by itself: a host
// lists the procs it wants in Rogue's `procs` option, and D7 will list the
// ones a build's talent ranks name (procsFromTalents in js/procs.js).
//
//   combat.hack-and-slash         Axe and Sword melee attacks have a chance to
//                                 trigger an extra attack.
//   combat.puncturing-wounds      Backstab has a chance to add a combo point.
// The talents' other lines (Dagger and Fist crit, Mace armor, Backstab and
// Mutilate crit) are modifiers, and D7's.
export const PROC_TABLES = Object.freeze({
  "combat.hack-and-slash": Object.freeze({
    id: "hack-and-slash",
    trigger: "onHit",
    scope: { weaponTypes: k("hackAndSlash.extraAttack").weaponTypes },
    chance: { mode: "flat", values: k("hackAndSlash.extraAttack").chance },
    actions: [{ type: "extraAttack" }],
  }),
  "combat.puncturing-wounds": Object.freeze({
    id: "puncturing-wounds",
    trigger: "onAbility",
    scope: { abilities: ["backstab"] },
    chance: { mode: "flat", values: k("puncturingWounds.comboPoint").chance },
    actions: [
      {
        type: "gainResource",
        resource: "comboPoints",
        amount: k("puncturingWounds.comboPoint").comboPoints,
      },
    ],
  }),
});
