import { abilityCatalogue } from "./abilities.js";
import { RingLog } from "./event-stream.js";
import { poisonCatalogue } from "./poisons.js";
import { PROC_TABLES } from "./proc-data.js";
import { talentCatalogue } from "./talents.js";

// The live page's feed (#150): it turns a running fight into the plain store
// slices the visualiser draws (js/store.js, js/views/visualiser.js), so no view
// reads the engine's Rogue or Simulation. The page (js/main.js) creates it with
// the fight and calls read() once per animation frame.
//
// What comes from where. Discrete changes come from the event stream
// (docs/events.md): the combat log rows from `hit` events and the combo points
// from `resource` events, collected between frames; the full length and stacks
// of each aura from `aura` events; the procs from `proc` events. Continuous change is not
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
//              remaining, duration, stacks } in the engine's order, in
//              seconds. An aura names itself; its duration is the seconds it
//              had at its last apply, refresh or stack (aura events), and its
//              stacks come from the same event. A cooldown takes the name and
//              icon of the skill with its id, and its duration from the ability
//              data (cooldownOf), never less than what is left; its stacks
//              are 1.
//   procs      [{ id, name, count }], one per proc that has fired, in the order
//              each first fired. The name is the poison's or the talent's,
//              looked up by the proc id in the data files (procName).
//   spend      The last combo point spend, { source, name, before, after,
//              time }, or null: what a finisher spent and when (a `resource`
//              event with change "spend").
//   moment     The last buff that came up or went, { seq, change, name } with
//              change "apply" or "expire", or null. seq counts up from 1.
//   log        The newest k("log.maxEvents") combat log rows, newest first,
//              each { id, time, name, type, damage, status, outcome, icon,
//              fromProc }: the rows of simulation.combatLog, built from the
//              events, and fromProc, true for a row a proc made (a poison's
//              hit, or the hit that is the first event after a `proc` event,
//              as Hack and Slash's extra swing is).
//
// stop() unsubscribes from the fight.
export function createLiveFeed({ rogue, simulation }) {
  const skillsById = new Map(
    Object.values(rogue.abilities).map((skill) => [skill.id, skill]),
  );
  const log = new RingLog();
  let comboPoints = rogue.comboPoints;
  const auraLengths = new Map();
  const procCounts = new Map();
  let spend = null;
  let moment = null;
  let momentSeq = 0;
  let afterProc = false;

  const unsubscribers = [
    simulation.on("hit", (event) => {
      const fromProc = event.origin === "poison" || afterProc;
      afterProc = false;
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
          fromProc,
        }),
      );
    }),
    simulation.on("resource", (event) => {
      afterProc = false;
      if (event.resource !== "comboPoints") {
        return;
      }
      comboPoints = event.after;
      if (event.change === "spend") {
        spend = Object.freeze({
          source: event.source,
          name: abilityCatalogue.get(event.source)?.name ?? event.source,
          before: event.before,
          after: event.after,
          time: event.time,
        });
      }
    }),
    simulation.on("aura", (event) => {
      afterProc = false;
      if (event.change === "expire") {
        auraLengths.delete(event.aura);
      } else {
        auraLengths.set(event.aura, {
          duration: event.duration,
          stacks: event.stacks,
        });
      }
      if (
        event.target === "self" &&
        (event.change === "apply" || event.change === "expire")
      ) {
        momentSeq += 1;
        moment = Object.freeze({
          seq: momentSeq,
          change: event.change,
          name: event.name,
        });
      }
    }),
    simulation.on("proc", (event) => {
      afterProc = true;
      const counted = procCounts.get(event.proc);
      procCounts.set(event.proc, {
        id: event.proc,
        name: counted?.name ?? procName(event.proc),
        count: (counted?.count ?? 0) + 1,
      });
    }),
  ];

  // An aura is a record with its own name and icon. A cooldown is the seconds
  // left, and the skill with that id has the name and icon.
  function timedEffects(effects) {
    return Object.freeze(
      Object.entries(effects).map(([id, effect]) => {
        const isAura = typeof effect === "object";
        const skill = skillsById.get(id);
        const remaining = isAura ? effect.duration : effect;
        const length = isAura ? auraLengths.get(id) : undefined;
        const duration = isAura
          ? (length?.duration ?? remaining)
          : (cooldownOf(id) ?? remaining);
        return Object.freeze({
          id,
          name: isAura ? effect.name : skill?.name,
          icon: isAura ? effect.icon : skill?.icon,
          remaining,
          duration: Math.max(duration, remaining),
          stacks: length?.stacks ?? 1,
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
      procs: Object.freeze(
        [...procCounts.values()].map((proc) => Object.freeze({ ...proc })),
      ),
      spend,
      moment,
      log: Object.freeze(log.toArray()),
    });
  }

  function stop() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  return { read, stop };
}

// A cooldown's full length in seconds, from the ability data by id, or
// undefined for an id the data does not have.
export function cooldownOf(abilityId) {
  return abilityCatalogue.get(abilityId)?.cooldown;
}

// A proc's display name, from the data files by its id: a poison's proc is
// "<poison id>.<hand>" and takes the poison's name; a talent's proc takes the
// name of the talent whose procs list it (js/proc-data.js). Else the id.
export function procName(procId) {
  const poison = poisonCatalogue.get(procId.split(".")[0]);
  if (poison !== undefined) {
    return poison.name;
  }
  const talentId = Object.keys(PROC_TABLES).find((id) =>
    PROC_TABLES[id].some((spec) => spec.id === procId),
  );
  const talent = talentCatalogue.talents.find(({ id }) => id === talentId);
  return talent?.name ?? procId;
}
