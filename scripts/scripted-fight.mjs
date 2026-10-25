import { runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";

// A scripted-cast fight for the golden cases (#85). The placeholder rotation
// (rotation.priority) never casts Eviscerate or Rupture, so a fixture made with
// runFight alone cannot pin their maths. runScriptedFight runs the real
// runFight with the rogue's rotation replaced for that one call:
//
//   1. Each step, the script's casts run first, in order, on the real skills.
//      A cast waits (and so does everything after it) until the skill can be
//      cast: the energy is there, the GCD is clear, and it is off cooldown.
//   2. Then the rogue's own rotation runs with every skill's cast disabled, so
//      the placeholder rotation casts nothing, but the weapon swings and the
//      Slice and Dice / Blade Flurry haste work as they do in a real fight.
//
// Nothing under js/ changes. The result is exactly what runFight returns: the
// same fields, the same seeded rng, the same fixed step. Rogue.prototype is
// put back in a finally block, so a scripted run never leaks into another.

// The script is a list of keys of Rogue.abilities, such as "sinisterStrike",
// "hemorrhage", "rupture" and "eviscerate".
export function scriptedRotation(script, original = Rogue.prototype.rotation) {
  const queue = [...script];
  const state = {
    queue,
    // Casts still waiting. A finished fight should have none left.
    get remaining() {
      return queue.length;
    },
    rotation(simulation, dt) {
      while (queue.length > 0) {
        // Own keys only: "constructor" and "toString" are on every object but
        // are not abilities.
        const name = queue[0];
        if (typeof name !== "string" || !Object.hasOwn(this.abilities, name)) {
          throw new RangeError(
            `Golden script names "${String(name)}", which is not a Rogue ability. Use one of: ${Object.keys(this.abilities).join(", ")}.`,
          );
        }
        const skill = this.abilities[name];
        // A cast that is not an attack returns null even when it happened, so
        // count casts in the ability record instead of reading the return.
        const before = simulation.abilityStats[skill.name]?.casts ?? 0;
        skill.cast(this, simulation);
        if ((simulation.abilityStats[skill.name]?.casts ?? 0) === before) {
          break; // not castable yet: try again next step
        }
        queue.shift();
      }
      // Weapon swings and haste, with the placeholder casts switched off.
      const skills = Object.values(this.abilities);
      for (const skill of skills) {
        skill.cast = () => null;
      }
      try {
        return original.call(this, simulation, dt);
      } finally {
        for (const skill of skills) {
          delete skill.cast;
        }
      }
    },
  };
  return state;
}

export function runScriptedFight(options) {
  // null, undefined, and anything that is not an object have no seed, duration,
  // or script to read, so they get a RangeError like a missing script.
  if (options === null || typeof options !== "object") {
    throw new RangeError(
      "runScriptedFight needs an options object: { seed, duration, script }.",
    );
  }
  const { seed, duration, script } = options;
  if (!Array.isArray(script) || script.length === 0) {
    throw new RangeError("runScriptedFight needs a non-empty script array.");
  }
  const original = Rogue.prototype.rotation;
  const scripted = scriptedRotation(script, original);
  Rogue.prototype.rotation = scripted.rotation;
  try {
    const result = runFight({ seed, duration });
    if (scripted.remaining > 0) {
      throw new Error(
        `The golden script did not finish: ${scripted.remaining} cast${scripted.remaining === 1 ? "" : "s"} still waiting after ${duration}s, next "${scripted.queue[0]}". A constant that changed an energy cost, a cooldown, or the GCD can cause this. Lengthen the case's duration, or shorten its script.`,
      );
    }
    return result;
  } finally {
    Rogue.prototype.rotation = original;
  }
}
