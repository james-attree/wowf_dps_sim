import { AURAS } from "./auras.js";

// The auras an ability can require (issue #261): an ability-data entry's
// `requiresAura` is a list of self aura ids from AURAS (js/auras.js). This is
// the hook Cutthroat plugs into (#271):
//
//   check     Ability.auraMet: a cast needs at least one aura of the list up
//             (Simulation.hasAura). With none up the cast is refused before
//             anything else: nothing is spent, no event is told, no rng draw.
//   consume   a cast that goes ahead (its cost is paid, whatever the attack's
//             outcome: hit, crit, miss, dodge) uses one charge of the first
//             aura of the list that is up, and of no other
//             (Simulation.consumeCharge), after the cast event. The list's
//             order matters: the first aura up pays. If it has no charges
//             (a duration-only aura) the cast uses nothing, it stays up, and
//             the cast does not skip ahead to a later charged aura. The
//             cutthroat aura has one charge, so the cast removes it, with an
//             "expire" aura event, reason "charges".
//   grant     an effect that can put an aura of the list up says so in
//             Rogue.grantedAuras (the ids, fixed for the fight: each of these
//             auras that a proc of the fight applies). Only then is
//             a rotation rule for the ability usable (js/rotation-host.js);
//             otherwise it is passed over for the whole fight. It then applies
//             the definition with its own duration (the definition has none):
//             simulation.applyAura(REQUIRED_AURAS.cutthroat, { duration }).
//   walk      while none of the list is up, the rule is passed over at that
//             decision point and never pooled for (host.gated and host.ready,
//             js/rotation-interpreter.js; B1 of Kira's QA on #262).
//
// Ambush requires ["cutthroat"], the "Ambush allowed" aura. The sim models no
// Stealth and no stealth openers, so only the Cutthroat talent grants it
// (#271): its Backstab proc (an applyAura action) puts "cutthroat" in
// Rogue.grantedAuras and applies the aura for 10 s. Without Cutthroat, Ambush
// is never cast. The aura is not Stealth: nothing reads it as being
// stealthed.

// The auras that exist only to allow an ability, by key.
export const REQUIRED_AURAS = Object.freeze({ cutthroat: AURAS.cutthroat });

const SELF_AURA_IDS = new Set(
  Object.values(AURAS)
    .filter((aura) => aura.target === "self")
    .map((aura) => aura.id),
);

// Whether `id` is an aura an ability can require: a self aura of AURAS.
export function isRequiredAura(id) {
  return typeof id === "string" && SELF_AURA_IDS.has(id);
}
