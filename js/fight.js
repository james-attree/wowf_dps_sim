import { Rogue } from "./rogue.js";
import { normalizeSeed } from "./rng.js";
import { Simulation } from "./simulation.js";

// Build the engine for one fight: a rogue and a simulation that draws from the
// seed. runFight and the live page (js/main.js) both start here, so they run
// the same engine. The seed is an integer and wraps to an unsigned 32-bit
// value; the returned seed is the wrapped one.
export function createFight(seed) {
  const fightSeed = normalizeSeed(seed);
  const rogue = new Rogue();
  const simulation = new Simulation(rogue, { seed: fightSeed });
  return { seed: fightSeed, rogue, simulation };
}

// Headless entry point: build a rogue and a simulation, run one fight, and
// hand back the result as plain data. It touches no DOM, reads no clock, and
// draws no randomness except through the seeded rng, so the same seed and
// duration always give the same result. Node, a browser, and a Web Worker can
// all import it.
//
// The result holds no reference to the Rogue or the Simulation. It is numbers,
// strings, and plain objects and arrays, so structuredClone, JSON, and
// postMessage all carry it.
//
//   seed       the seed the fight used, as an unsigned 32-bit integer
//   duration   simulated seconds (sim.currentTime after the run)
//   totalDamage, dps
//   abilities  per-ability totals keyed by name (see Simulation.recordAbility)
//   log        the combat log, newest first, at most k("log.maxEvents") rows
export function runFight(options) {
  // null, undefined, and anything that is not an object have no seed or
  // duration to read, so they get the same RangeError as a bad seed.
  if (options === null || typeof options !== "object") {
    throw new RangeError(
      "runFight needs an options object: { seed, duration }.",
    );
  }
  const { seed, duration } = options;
  // A seed is required so no fight is repeatable by accident or random by
  // accident. createFight rejects anything that is not an integer.
  const { seed: fightSeed, simulation } = createFight(seed);
  // One run call for the whole fight. It validates the duration.
  simulation.run(duration);

  const simulated = simulation.currentTime;
  return {
    seed: fightSeed,
    duration: simulated,
    totalDamage: simulation.damageDone,
    dps: simulated > 0 ? simulation.damageDone / simulated : 0,
    abilities: Object.fromEntries(
      Object.entries(simulation.abilityStats).map(([name, record]) => [
        name,
        { ...record },
      ]),
    ),
    log: simulation.combatLog.map((event) => ({ ...event })),
  };
}
