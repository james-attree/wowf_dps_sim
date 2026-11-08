// The test-only override for the Ambush hook (#261, js/required-auras.js).
// TR-06 / #335: a landed Ghostly Strike opens the ambush window. This override
// lets a test do the same without the talent: it says the fight can grant the
// window (Rogue.grantedAuras) and puts it up. It also grants the old cutthroat
// id so the generic multi-aura cases can still name that aura.
import { AURAS } from "../js/auras.js";
import { REQUIRED_AURAS } from "../js/required-auras.js";

// Long enough to outlast any test fight.
const TEST_DURATION = 3600;

// Say the fight can grant the window, and the old cutthroat id.
export function allowCutthroat(rogue) {
  rogue.grantedAuras.add(REQUIRED_AURAS.ambushWindow.id);
  rogue.grantedAuras.add(REQUIRED_AURAS.cutthroat.id);
}

// Put the ambush window up now, as a landed Ghostly Strike does.
export function procAmbushWindow(simulation, duration = TEST_DURATION) {
  return simulation.applyAura(REQUIRED_AURAS.ambushWindow, { duration });
}

// The old Cutthroat aura, for tests that name it as a second required aura.
export function procCutthroat(simulation, duration = TEST_DURATION) {
  return simulation.applyAura(AURAS.cutthroat, { duration });
}

// Grant the window: reachable for the rotation host, and up now.
export function grantCutthroat(rogue, simulation, duration = TEST_DURATION) {
  allowCutthroat(rogue);
  return procAmbushWindow(simulation, duration);
}
