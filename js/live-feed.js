import { RingLog } from "./event-stream.js";

// The live page's feed (#150): it turns a running fight into the plain store
// slices the visualiser draws (js/store.js, js/views/visualiser.js), so no view
// reads the engine's Rogue or Simulation. The page (js/main.js) creates it with
// the fight and calls read() once per animation frame.
//
// What comes from where. Discrete changes come from the event stream
// (docs/events.md): the combat log rows from `hit` events and the combo points
// from `resource` events, collected between frames. Continuous change is not
// an event (docs/events.md: "a reader that wants the energy now reads it"), so
// read() takes it from the fight at the frame: the energy, the time left on
// the GCD, on each aura and on each cooldown. None of it is changed and nothing
// here holds a combat or timing rule.
//
// read() returns frozen slices:
//
//   resources  { comboPoints: { value, max }, energy: { value, max } }
//   gcd        { remaining, duration } in seconds
//   effects    { buffs, debuffs, cooldowns }: arrays of { id, name, icon,
//              remaining } in the engine's order, remaining in seconds. An
//              aura names itself; a cooldown takes the name and icon of the
//              skill with its id.
//   log        The newest k("log.maxEvents") combat log rows, newest first,
//              each { id, time, name, type, damage, status, outcome, icon }:
//              the same rows as simulation.combatLog, built from the events.
//
// stop() unsubscribes from the fight.
export function createLiveFeed({ rogue, simulation }) {
  const skillsById = new Map(
    Object.values(rogue.abilities).map((skill) => [skill.id, skill]),
  );
  const log = new RingLog();
  let comboPoints = rogue.comboPoints;

  const unsubscribers = [
    simulation.on("hit", (event) => {
      log.push(
        Object.freeze({
          id: event.id,
          time: event.time,
          name: event.name,
          type: event.attack,
          damage: event.damage,
          status: event.status,
          // The log has always shown a DoT tick's outcome as its status.
          outcome: event.origin === "dot" ? event.status : event.outcome,
          icon: event.icon,
        }),
      );
    }),
    simulation.on("resource", (event) => {
      if (event.resource === "comboPoints") {
        comboPoints = event.after;
      }
    }),
  ];

  // An aura is a record with its own name and icon. A cooldown is the seconds
  // left, and the skill with that id has the name and icon.
  function timedEffects(effects) {
    return Object.freeze(
      Object.entries(effects).map(([id, effect]) => {
        const isAura = typeof effect === "object";
        const skill = skillsById.get(id);
        return Object.freeze({
          id,
          name: isAura ? effect.name : skill?.name,
          icon: isAura ? effect.icon : skill?.icon,
          remaining: isAura ? effect.duration : effect,
        });
      }),
    );
  }

  function read() {
    return Object.freeze({
      resources: Object.freeze({
        comboPoints: Object.freeze({
          value: comboPoints,
          max: rogue.maxComboPoints,
        }),
        energy: Object.freeze({ value: rogue.energy, max: rogue.maxEnergy }),
      }),
      gcd: Object.freeze({
        remaining: simulation.gcd,
        duration: simulation.gcdDuration,
      }),
      effects: Object.freeze({
        buffs: timedEffects(simulation.activeBuffs),
        debuffs: timedEffects(simulation.activeDebuffs),
        cooldowns: timedEffects(simulation.cooldowns),
      }),
      log: Object.freeze(log.toArray()),
    });
  }

  function stop() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  return { read, stop };
}
