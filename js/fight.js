import { dataVersion } from "./data-version.js";
import { Rogue } from "./rogue.js";
import { normalizeSeed } from "./rng.js";
import { normalizeConfig } from "./sim-config.js";
import { Simulation } from "./simulation.js";

// A talent build is expanded by hand only in a test or a tool that wants one
// talent on its own: expandTalents(ranks) gives `modifiers`, `procs` and
// `abilities` for the options below. A selected build in config.talents needs
// none of that (see createFight). applyBuild is the validated form.
export { applyBuild, expandTalents, validateBuild } from "./talent-build.js";

// Build the engine for one fight: a rogue and a simulation that draws from the
// seed. runFight and the live page (js/main.js) both start here, so they run
// the same engine. The seed is an integer and wraps to an unsigned 32-bit
// value; the returned seed is the wrapped one. `dataVersion` names the data
// snapshot the fight runs on (js/data-version.js).
//
// `config` is an optional SimConfig (js/sim-config.js): character stats,
// weapons, talent ranks and poisons. Leave it out and the fight is the default
// one, exactly as before the config existed. The returned `config` is the full
// form the rogue holds; treat it as read-only.
//
// `config.talents` is applied here (D7, #106): a selected build is validated
// (0 to 51 points, capped by config.talentLevel since #190, ranks within the
// maximum, prerequisites, row gating; an illegal one is a RangeError that
// names the talent ids) and its modifiers,
// procs and granted abilities are the rogue's, so runFight and the live page
// run a talented fight from the SimConfig alone. The rotation casts Blade
// Flurry and Adrenaline Rush only when the build has the talent. No ranks is no
// build, and no build is untalented (#199): the rotation casts no talent
// ability unless the host grants it (options.abilities). The returned `build` is what was applied
// (js/talent-build.js applyBuild), including `unmapped`, the talents of the
// build the simulator does not model yet.
//
// `options.modifiers`, `options.procs` and `options.abilities` are extras for a
// host or a test, added to the build's (js/rogue.js). They are not part of the
// SimConfig, so the result of a fight does not record them.
//
// `options.duration` is the fight's length in seconds as the rotation is told
// it (fightTimeRemaining, #191): the Simulation's fightLength. It is the
// rotation's only and does not end the fight; simulation.run(duration) does,
// so give both the same number (runFight and SimRunner do). Without it
// fightTimeRemaining reads as Infinity. A bad one is a RangeError.
//
// `options.engine` is the engine simulation.run uses (Simulation's `engine`:
// "legacy", the default, or "events", the event core of #197). Like
// duration it is createFight's own, not the Rogue's.
export function createFight(seed, config, options) {
  const fightSeed = normalizeSeed(seed);
  // duration and engine are createFight's own; the rest are the Rogue's, which checks
  // them. Options that are not an object go to the Rogue as they are, and it
  // refuses them.
  const plain =
    options !== null && typeof options === "object" && !Array.isArray(options);
  const { duration, engine, ...rogueOptions } = plain ? options : {};
  const rogue = new Rogue(config, plain ? rogueOptions : options);
  const simulation = new Simulation(rogue, {
    seed: fightSeed,
    fightLength: duration,
    engine,
  });
  return {
    seed: fightSeed,
    dataVersion,
    config: rogue.config,
    build: rogue.build,
    rogue,
    simulation,
  };
}

// The plain-data result of a fight that has been run: the shape runFight
// returns, documented there. `fight` is what createFight returned. runFight and
// SimRunner (js/sim-runner.js) both build their result here, so a fight run
// through the runner is the fight runFight gives, field for field.
export function fightResult(fight) {
  const { seed, config, simulation } = fight;
  const simulated = simulation.currentTime;
  return {
    seed,
    duration: simulated,
    totalDamage: simulation.damageDone,
    dps: simulated > 0 ? simulation.damageDone / simulated : 0,
    abilities: simulation.abilityBreakdown(),
    log: simulation.combatLog.map((event) => ({ ...event })),
    dataVersion,
    // A copy, so changing the result cannot change the rogue's config.
    config: normalizeConfig(config),
  };
}

const RUN_FIGHT_OPTIONS = ["seed", "duration", "config", "engine"];

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
//   abilities  per-ability totals keyed by display name (Simulation.abilityBreakdown;
//              the engine keys them by id)
//   log        the combat log, newest first, at most k("log.maxEvents") rows
//   dataVersion  which data produced the result: the snapshot's generated date
//              and client build, "<generated>+<build>" (js/data-version.js)
//   config     the SimConfig the fight used, in full form (js/sim-config.js).
//              Pass it back as `config` to repeat the fight exactly.
//
// Options: { seed, duration, config, engine }. `config` is optional.
// `engine` is optional too (#198): the engine the fight runs on, "legacy" or
// "events" (createFight's option, Simulation's `engine`); without it the
// Simulation's default, legacy until #199. The result does not record it. An
// option with any other name is a RangeError, so a misspelt "confg" cannot
// quietly run the default fight.
export function runFight(options) {
  // null, undefined, an array, and anything that is not an object have no seed
  // or duration to read, so they get the same RangeError as a bad seed.
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new RangeError(
      "runFight needs an options object: { seed, duration }.",
    );
  }
  for (const key of Object.keys(options)) {
    if (!RUN_FIGHT_OPTIONS.includes(key)) {
      throw new RangeError(
        `runFight has no option ${JSON.stringify(key)}. Options: ${RUN_FIGHT_OPTIONS.join(", ")}.`,
      );
    }
  }
  const { seed, duration, config, engine } = options;
  // A seed is required so no fight is repeatable by accident or random by
  // accident. createFight rejects anything that is not an integer.
  // The rotation is told the length the fight runs (#191).
  const fight = createFight(seed, config, { duration, engine });
  // One run call for the whole fight. A bad duration is already refused,
  // by createFight, as a RangeError.
  fight.simulation.run(duration);
  return fightResult(fight);
}
