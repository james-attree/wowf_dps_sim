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

// `options.duration` is the length of the fight in seconds, for
// fightTimeRemaining. Without it the view says the length is unknown (null).
// `options.freeze` is true unless a host says false. The view is built afresh
// for every read and freezing it is most of what building it costs, so the
// engine host (js/rotation-host.js) asks for an unfrozen one: the conditions
// only read it (test/rotation-conditions.test.js holds them to that), and each
// view is thrown away after the walk.
export function rotationState(rogue, simulation, options = {}) {
  const resources = {};
  for (const [id, pool] of Object.entries(rogue.resources)) {
    const { regen } = pool.definition;
    resources[id] = {
      value: pool.value,
      max: pool.max,
      regenPerSecond:
        regen === undefined
          ? 0
          : simulation.modifiers.resolve(regen.modifier, k(regen.perSecond)),
    };
  }
  const cooldowns = {};
  for (const [id, remaining] of Object.entries(simulation.cooldowns)) {
    if (remaining > 0) {
      cooldowns[id] = remaining;
    }
  }
  const view = {
    time: simulation.currentTime,
    duration: options.duration ?? null,
    resources,
    auras: auraView(simulation.activeBuffs),
    debuffs: auraView(simulation.activeDebuffs),
    cooldowns,
    build: { selected: rogue.build.selected },
    granted: [...rogue.granted],
    talentAbilities: [...talentGrantedAbilities],
  };
  return options.freeze === false ? view : freezeAll(view);
}
