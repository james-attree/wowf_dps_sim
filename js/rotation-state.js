import { k } from "../data/constants.js";
import { talentGrantedAbilities } from "./talent-build.js";

// The state view a rotation condition reads (roadmap R2, issue #139): a
// read-only snapshot of a fight, built here so that js/rotation-conditions.js
// never touches a Rogue or a Simulation. rotationState(rogue, simulation,
// options) copies what the conditions need and freezes it. It changes nothing
// in the fight and reads no clock.
//
//   {
//     time,                     seconds of fight time so far
//     duration,                 the fight's length in seconds, or null if the
//                               host did not say (options.duration)
//     resources: {              by resource id
//       energy:      { value, max, regenPerSecond },
//       comboPoints: { value, max, regenPerSecond: 0 },
//     },
//     auras:     { [id]: { remaining, stacks } },   self buffs that are up
//     debuffs:   { [id]: { remaining, stacks } },   target debuffs that are up
//     cooldowns: { [abilityId]: seconds left },     only those above 0
//     build:     { selected },                      a talent build is selected
//     granted:   [abilityId],                       granted by build or host
//     talentAbilities: [abilityId],                 abilities some talent grants
//   }
//
// regenPerSecond is the rate now: the base rate through the energyRegen
// modifiers (Adrenaline Rush doubles it while it is up). The state view names
// no step or frame, so a different engine core can build the same view.
//
// This module is pure: no DOM, no clock, no random numbers.

function freezeAll(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeAll);
    Object.freeze(value);
  }
  return value;
}

function auraView(auras) {
  const view = {};
  for (const [id, aura] of Object.entries(auras)) {
    view[id] = { remaining: aura.duration, stacks: aura.stacks };
  }
  return view;
}

function regenPerSecond(pool, simulation) {
  const { regen } = pool.definition;
  return regen === undefined
    ? 0
    : simulation.modifiers.resolve(regen.modifier, k(regen.perSecond));
}

function resourcesView(rogue, simulation) {
  const resources = {};
  for (const [id, pool] of Object.entries(rogue.resources)) {
    resources[id] = {
      value: pool.value,
      max: pool.max,
      regenPerSecond: regenPerSecond(pool, simulation),
    };
  }
  return resources;
}

// One resource of the lazy view. It reads the pool when asked, so one of them
// serves every view of a fight: the value, the cap and the regeneration rate
// are worked out (through the modifiers, for the last two) when read. It looks
// the pool up on the rogue each time, so a host that swaps a pool in (the
// event core puts its continuous energy pool in place of the legacy one,
// #197) is read from then on.
class LazyResource {
  #resources;
  #id;
  #simulation;
  constructor(rogue, id, simulation) {
    this.#resources = rogue.resources;
    this.#id = id;
    this.#simulation = simulation;
  }
  get value() {
    return this.#resources[this.#id].value;
  }
  get max() {
    return this.#resources[this.#id].max;
  }
  get regenPerSecond() {
    return regenPerSecond(this.#resources[this.#id], this.#simulation);
  }
}

function cooldownsView(simulation) {
  const cooldowns = {};
  const { cooldowns: all } = simulation;
  for (const id in all) {
    if (all[id] > 0) {
      cooldowns[id] = all[id];
    }
  }
  return cooldowns;
}

// `options.duration` is the length of the fight in seconds, for
// fightTimeRemaining. Without it the view says the length is unknown (null).
// `options.freeze` is true unless a host says false. The view is built afresh
// for every read and freezing it is most of what building it costs, so a host
// that reads it once and throws it away can ask for an unfrozen one (the
// conditions only read it; test/rotation-conditions.test.js holds them to
// that). For a host that reads only part of it at most decision points, see
// lazyRotationState.
export function rotationState(rogue, simulation, options = {}) {
  const view = {
    time: simulation.currentTime,
    duration: options.duration ?? null,
    resources: resourcesView(rogue, simulation),
    auras: auraView(simulation.activeBuffs),
    debuffs: auraView(simulation.activeDebuffs),
    cooldowns: cooldownsView(simulation),
    build: { selected: rogue.build.selected },
    granted: [...rogue.granted],
    talentAbilities: [...talentGrantedAbilities],
  };
  return options.freeze === false ? view : freezeAll(view);
}

// What a fight does not change, made once per reader (rotationStateReader).
class LazyRotationState {
  #simulation;
  #auras;
  #debuffs;
  #cooldowns;

  constructor(shared) {
    this.#simulation = shared.simulation;
    this.time = shared.simulation.currentTime;
    this.duration = shared.duration;
    this.resources = shared.resources;
    this.build = shared.build;
    this.granted = shared.granted;
    this.talentAbilities = shared.talentAbilities;
  }

  get auras() {
    return (this.#auras ??= auraView(this.#simulation.activeBuffs));
  }

  get debuffs() {
    return (this.#debuffs ??= auraView(this.#simulation.activeDebuffs));
  }

  get cooldowns() {
    return (this.#cooldowns ??= cooldownsView(this.#simulation));
  }
}

// The same view as rotationState, built a part at a time and only for a
// reader that reads little of it (R3, #140). A decision point reads little: most
// rules fail on one condition and many are passed over without a read, so
// building all of it for every decision point (19,200 in a five-minute fight)
// was most of the interpreter's cost.
//
// rotationStateReader(rogue, simulation, options) returns a function that gives
// the view of the fight at the moment it is called. What a fight does not
// change (the build, what is granted, the talent abilities, the pools and the
// objects that read them) is made once, and the rest is worked out the first
// time a part is read, and kept for the rest of that view: auras, debuffs and
// cooldowns. A view reads the pools when asked, so it is valid until the fight
// next changes (a cast, a step): the interpreter asks for a new one after each
// cast. Every read gives what rotationState gives for the same moment
// (test/rotation-state.test.js holds them equal over a fight). Nothing in it is
// frozen.
export function rotationStateReader(rogue, simulation, options = {}) {
  const duration = options.duration ?? null;
  const resources = {};
  for (const id of Object.keys(rogue.resources)) {
    resources[id] = new LazyResource(rogue, id, simulation);
  }
  const build = Object.freeze({ selected: rogue.build.selected });
  const granted = Object.freeze([...rogue.granted]);
  const talentAbilities = Object.freeze([...talentGrantedAbilities]);

  const shared = {
    simulation,
    duration,
    resources,
    build,
    granted,
    talentAbilities,
  };
  return () => new LazyRotationState(shared);
}

// One view, for a caller that wants just one.
export function lazyRotationState(rogue, simulation, options = {}) {
  return rotationStateReader(rogue, simulation, options)();
}
