import { k } from "../data/constants.js";
import { abilityCatalogue } from "./abilities.js";
import { defineAura } from "./auras.js";

// The auras an ability can require (issue #261): an ability-data entry's
// `requiresAura` names one of these by id. This is the stealth hook, the
// contract a later effect plugs into (Cutthroat, Phase 4.6):
//
//   check     Ability.auraMet: a cast needs the self aura up
//             (Simulation.hasAura(id)). Without it the cast is refused before
//             anything else: nothing is spent, no event is told, no rng draw.
//   consume   a cast that goes ahead (its cost is paid, whatever the attack's
//             outcome: hit, crit, miss, dodge) uses one charge of the aura
//             (Simulation.consumeCharge). The aura has one charge, so the cast
//             removes it, with an "expire" aura event, reason "charges".
//   grant     an effect that can put the aura up says so in
//             Rogue.grantedAuras (the ids, fixed for the fight). Only then is
//             a rotation rule for the ability usable (js/rotation-host.js);
//             otherwise it is passed over. It then applies the definition
//             below with its own duration (the definition has none):
//             simulation.applyAura(REQUIRED_AURAS.stealth, { duration }).
//
// Nothing grants an aura here today: the sim models no stealth (no stealth
// openers), so Ambush is never cast. Cutthroat ("your next Ambush within
// 10 sec to not require Stealth") will add "stealth" to Rogue.grantedAuras
// when the build has it, and on its proc apply the aura for 10 s.
//
// These definitions are not in the AURAS registry (js/auras.js), so no
// rotation condition can name them and the page lists none.

// Stealth (rogue.json → spell_desc[Rogue|Ambush|Rank 6]: "Requires
// Stealth"). The id is the ability catalogue's, as for every aura.
const STEALTH = abilityCatalogue.get("stealth");

export const REQUIRED_AURAS = Object.freeze({
  stealth: defineAura({
    id: STEALTH.id,
    name: STEALTH.name,
    target: "self",
    charges: k("stealth.aura").charges,
  }),
});

// Whether `id` is an aura an ability can require.
export function isRequiredAura(id) {
  return typeof id === "string" && Object.hasOwn(REQUIRED_AURAS, id);
}
