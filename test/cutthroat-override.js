// The test-only override for the Ambush hook (#261, js/required-auras.js).
// Since #271 the Cutthroat talent grants the cutthroat aura ("Ambush
// allowed"): a build with it puts "cutthroat" in Rogue.grantedAuras, and its
// Backstab proc puts the aura up. This override lets a test do the same
// without the talent or a proc roll: it says the fight can grant the aura
// (Rogue.grantedAuras, so a rotation rule for Ambush is usable) and puts the
// aura up through the same Simulation.applyAura call Cutthroat's proc makes.
import { REQUIRED_AURAS } from "../js/required-auras.js";

// Long enough to outlast any test fight.
const TEST_DURATION = 3600;

// Say the fight can grant the aura (Rogue.grantedAuras), without putting it
// up.
export function allowCutthroat(rogue) {
  rogue.grantedAuras.add(REQUIRED_AURAS.cutthroat.id);
}

// Put the aura up now, as a Cutthroat proc does. Returns the aura record.
export function procCutthroat(simulation, duration = TEST_DURATION) {
  return simulation.applyAura(REQUIRED_AURAS.cutthroat, { duration });
}

// Grant the aura: reachable for the rotation host, and up now. Returns the
// aura record.
export function grantCutthroat(rogue, simulation, duration = TEST_DURATION) {
  allowCutthroat(rogue);
  return procCutthroat(simulation, duration);
}
