// The test-only override for the stealth hook (#261, js/required-auras.js).
// Nothing in the engine grants Stealth, and no Rogue or fight option can: the
// override sits here, in the tests, and plays the part a granting effect
// (Cutthroat, Phase 4.6) will play. It says the fight can grant the aura
// (Rogue.grantedAuras, so a rotation rule for Ambush is usable) and puts the
// aura up through the same Simulation.applyAura call such an effect makes.
import { REQUIRED_AURAS } from "../js/required-auras.js";

// Long enough to outlast any test fight.
const TEST_DURATION = 3600;

// Grant Stealth: reachable for the rotation host, and up now. Returns the aura
// record.
export function grantStealth(rogue, simulation, duration = TEST_DURATION) {
  rogue.grantedAuras.add(REQUIRED_AURAS.stealth.id);
  return simulation.applyAura(REQUIRED_AURAS.stealth, { duration });
}
