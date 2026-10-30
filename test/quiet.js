// A rogue that does nothing on its own: the rotation casts nothing and
// neither weapon swings within any test's fight, so the only events are the
// ones a test sets up. On the event core the rotation is castRotation and a
// swing is due when the weapon's swingTimer runs out (js/core/fight.js); a
// test that wants a swing sets swingTimer itself. (The fixed-step engine's
// tests silenced both with rogue.rotation = () => {}, which #234 removed.)
export const QUIET_SWING = 1e9;

export function quiet(rogue) {
  rogue.castRotation = () => ({ casts: [], outcome: "none" });
  for (const weapon of Object.values(rogue.weapons)) {
    if (weapon) {
      weapon.swingTimer = QUIET_SWING;
    }
  }
  return rogue;
}
