import { auraRegistry } from "./auras.js";
import { CompensatedSum, RunningStats } from "./running-stats.js";

// Fight metrics (Phase 3, #146, roadmap task S3): how long each aura was up in
// a fight, and the same over a batch. It has no DOM, reads no clock and draws
// no randomness.
//
// It is built from the event stream (docs/events.md): the `aura` events (an
// aura was applied, refreshed, stacked or ran out, with the time) and the `end`
// event (the fight is over, at the fight duration). It reads no engine state,
// so it works on a Simulation, a SimRunner, a recorded array of events or the
// Phase 3.5 engine, as long as the events are the same. Time is the events'
// `time`, in fight seconds. Nothing here names a step or a frame. The only
// thing it reads besides events is each aura's maxStacks from the aura
// definitions (js/auras.js), which is data, for the full-stack uptime.
//
// One fight: a FightAuras collector. attach(source) subscribes it to
// source.on("aura") and source.on("end"); summary() reads it at any time.
// aurasFromEvents(events) is the same for events already in hand.
//
// A batch: a BatchAuras. add(fightSummary) takes one fight's summary(), in
// iteration order, and summary() gives the batch over the fights added.
//
// The metric definitions and the shapes are in docs/mechanics.md ("Aura
// uptime").
//
// Resource waste (FightResources, BatchResources) is read from the end event's
// `resources` field: what each pool lost to its cap over the fight, counted
// exactly by the resource model (js/resource.js). See docs/mechanics.md
// ("Resource waste").

// The aura change that ends an interval (docs/events.md). Every other change
// ("apply", "refresh", "stack") means the aura is up after the event.
const EXPIRE = "expire";
const APPLY = "apply";

// A row is one aura on one side: the same id on "self" and on "target" would be
// two rows. Rows are listed by id, then side, in code-point order, so the order
// depends on what is in the rows and never on the order things happened in.
function compareText(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function byIdAndTarget(first, second) {
  return (
    compareText(first.id, second.id) || compareText(first.target, second.target)
  );
}

function rowKey(id, target) {
  return `${target}:${id}`;
}

function fraction(part, whole) {
  return whole > 0 ? part / whole : 0;
}

function defaultMaxStacks() {
  const maxStacks = {};
  for (const [id, definition] of auraRegistry()) {
    maxStacks[id] = definition.maxStacks;
  }
  return maxStacks;
}

function readMaxStacks(option) {
  if (option === undefined) {
    return defaultMaxStacks();
  }
  if (option === null || typeof option !== "object") {
    throw new TypeError(
      "FightAuras maxStacks is an object of aura id to its stack limit.",
    );
  }
  for (const [id, value] of Object.entries(option)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(
        `The stack limit of aura "${id}" must be a whole number, 1 or more. Got ${value}.`,
      );
    }
  }
  return { ...option };
}

function readEvent(event) {
  if (event === null || typeof event !== "object") {
    throw new TypeError(
      `Fight metrics read event objects. Got ${event === null ? "null" : typeof event}.`,
    );
  }
  if (typeof event.time !== "number" || !Number.isFinite(event.time)) {
    throw new RangeError(
      `An event needs a finite time in fight seconds. Got ${event.time}.`,
    );
  }
}

// One fight's aura uptimes, read from its events.
//
//   const auras = new FightAuras();
//   const off = auras.attach(runner); // before run(), so no event is missed
//   ... the fight runs ...
//   auras.summary();
//
// Options: { maxStacks }, an object of aura id to its stack limit, for auras the
// definitions in js/auras.js do not have (a test, a later class). Default: the
// definitions' maxStacks.
export class FightAuras {
  #maxStacks;
  // Records by row key, in the order they were first seen.
  #records = new Map();
  // The latest event time read, and the end time once the end event came.
  #now = 0;
  #end = null;

  constructor(options = {}) {
    this.#maxStacks = readMaxStacks(options.maxStacks);
  }

  // Subscribe to the "aura" and "end" events of `source`. Returns one function
  // that unsubscribes both.
  attach(source) {
    const offAura = source.on("aura", (event) => this.observe(event));
    const offEnd = source.on("end", (event) => this.observe(event));
    return () => {
      offAura();
      offEnd();
    };
  }

  // Read one event. Types other than "aura" and "end" only move the clock (so
  // a wildcard subscription works too, and reads the fight up to its latest
  // event). An event earlier than one already read is a RangeError: the
  // stream delivers events in time order.
  observe(event) {
    readEvent(event);
    if (event.time < this.#now) {
      throw new RangeError(
        `Events come in time order. Got time ${event.time} after ${this.#now}.`,
      );
    }
    if (this.#end !== null) {
      throw new RangeError(
        "This fight has ended. A FightAuras reads one fight; use a new one for the next.",
      );
    }
    this.#now = event.time;
    if (event.type === "aura") {
      this.#addAura(event);
    } else if (event.type === "end") {
      this.#end = event.time;
    }
  }

  #record(event) {
    const key = rowKey(event.aura, event.target);
    let record = this.#records.get(key);
    if (record === undefined) {
      record = {
        id: event.aura,
        target: event.target,
        name: event.name,
        maxStacks: this.#maxStacks[event.aura] ?? null,
        applications: 0,
        refreshes: 0,
        // The open interval: when the stacks last changed, and how many.
        since: 0,
        stacks: 0,
        uptime: 0,
        stackSeconds: 0,
        fullStackUptime: 0,
      };
      this.#records.set(key, record);
    }
    return record;
  }

  // Close the segment from record.since to `time` at record.stacks.
  #close(record, time) {
    if (record.stacks > 0) {
      const length = time - record.since;
      record.uptime += length;
      record.stackSeconds += length * record.stacks;
      if (record.maxStacks !== null && record.stacks >= record.maxStacks) {
        record.fullStackUptime += length;
      }
    }
    record.since = time;
  }

  #addAura(event) {
    if (typeof event.aura !== "string") {
      throw new TypeError(`An aura event needs an aura id. Got ${event.aura}.`);
    }
    if (
      event.change !== EXPIRE &&
      !(Number.isInteger(event.stacks) && event.stacks >= 1)
    ) {
      throw new RangeError(
        `An aura that is up has 1 stack or more. Got ${event.stacks}.`,
      );
    }
    const record = this.#record(event);
    this.#close(record, event.time);
    if (event.change === EXPIRE) {
      record.stacks = 0;
      return;
    }
    if (event.change === APPLY) {
      record.applications += 1;
    } else {
      record.refreshes += 1;
    }
    record.stacks = event.stacks;
  }

  // Plain data, fresh on every call:
  //
  //   duration   the fight time read: the end event's time once the fight is
  //              over, before that the time of the latest event read. An aura
  //              still up is counted up to here, so a fight's uptimes are
  //              clipped to its duration.
  //   ended      true once the end event was read
  //   rows       one per aura id and side, sorted by id, then target:
  //     id, target, name   which aura on which side ("self" a buff, "target" a
  //                        debuff). `name` is a label from the first event.
  //     maxStacks          its stack limit, or null for an aura the definitions
  //                        do not have
  //     applications       "apply" events: times it went up from down
  //     refreshes          "refresh" and "stack" events: times it was applied
  //                        again while up
  //     uptime             seconds it was up
  //     uptimeFraction     uptime / duration, 0 for a fight of no length
  //     stacks             null for an aura of one stack (maxStacks 1 or null),
  //                        else { stackSeconds, meanStacks, fullStackUptime,
  //                        fullStackFraction }:
  //       stackSeconds       stacks times seconds, added over the fight
  //       meanStacks         stackSeconds / uptime: the stacks while up. null
  //                          if it was never up
  //       fullStackUptime    seconds at maxStacks
  //       fullStackFraction  fullStackUptime / duration
  summary() {
    const duration = this.#end ?? this.#now;
    const rows = [];
    for (const record of this.#records.values()) {
      const open = record.stacks > 0 ? duration - record.since : 0;
      const uptime = record.uptime + open;
      const row = {
        id: record.id,
        target: record.target,
        name: record.name,
        maxStacks: record.maxStacks,
        applications: record.applications,
        refreshes: record.refreshes,
        uptime,
        uptimeFraction: fraction(uptime, duration),
        stacks: null,
      };
      if (record.maxStacks !== null && record.maxStacks > 1) {
        const stackSeconds = record.stackSeconds + open * record.stacks;
        const fullStackUptime =
          record.fullStackUptime +
          (record.stacks >= record.maxStacks ? open : 0);
        row.stacks = {
          stackSeconds,
          meanStacks: uptime > 0 ? stackSeconds / uptime : null,
          fullStackUptime,
          fullStackFraction: fraction(fullStackUptime, duration),
        };
      }
      rows.push(row);
    }
    rows.sort(byIdAndTarget);
    return { duration, ended: this.#end !== null, rows };
  }
}

// The aura uptimes of events already in hand (a recorded array, or any
// iterable): the same summary a FightAuras attached to the fight gives.
export function aurasFromEvents(events, options) {
  const auras = new FightAuras(options);
  for (const event of events) {
    auras.observe(event);
  }
  return auras.summary();
}

// A running batch row: counts, compensated time sums, and the per-fight
// statistics of the uptime fractions.
class BatchAuraRecord {
  constructor(row, fightsBefore) {
    this.id = row.id;
    this.target = row.target;
    this.name = row.name;
    this.maxStacks = row.maxStacks;
    this.applications = 0;
    this.refreshes = 0;
    this.uptime = new CompensatedSum();
    this.uptimeStats = new RunningStats();
    this.stacked = row.stacks !== null;
    this.stackSeconds = new CompensatedSum();
    this.fullStackUptime = new CompensatedSum();
    this.fullStackStats = new RunningStats();
    // The fights before the one that first had this row had none of it: zeros,
    // added in fight order, so the statistics are those of every fight.
    for (let fight = 0; fight < fightsBefore; fight += 1) {
      this.absent();
    }
  }

  add(row) {
    this.applications += row.applications;
    this.refreshes += row.refreshes;
    this.uptime.add(row.uptime);
    this.uptimeStats.add(row.uptimeFraction);
    const stacks = row.stacks ?? {
      stackSeconds: row.uptime,
      fullStackUptime: 0,
      fullStackFraction: 0,
    };
    this.stackSeconds.add(stacks.stackSeconds);
    this.fullStackUptime.add(stacks.fullStackUptime);
    this.fullStackStats.add(stacks.fullStackFraction);
  }

  absent() {
    this.uptimeStats.add(0);
    this.fullStackStats.add(0);
  }
}

function readFight(fight) {
  if (
    fight === null ||
    typeof fight !== "object" ||
    !Array.isArray(fight.rows) ||
    typeof fight.duration !== "number" ||
    !Number.isFinite(fight.duration) ||
    fight.duration < 0
  ) {
    throw new TypeError(
      "BatchAuras.add needs a fight summary { duration, ended, rows }.",
    );
  }
}

// The aura uptimes over a batch of fights.
//
//   const batch = new BatchAuras();
//   batch.add(fightAuras.summary()); // one fight, in iteration order
//   batch.summary();
//
// Fights are added in order and every sum is taken in that order, so the result
// depends on the fights and their order only, never on how the work was sliced.
// The batch runner (js/batch-runner.js) adds the iterations in index order.
export class BatchAuras {
  #records = new Map();
  #fights = 0;
  #duration = new CompensatedSum();

  // How many fights have been added.
  get fights() {
    return this.#fights;
  }

  // Add one fight: a FightAuras#summary() (or aurasFromEvents) result.
  add(fight) {
    readFight(fight);
    const present = new Set();
    for (const row of fight.rows) {
      const key = rowKey(row.id, row.target);
      let record = this.#records.get(key);
      if (record === undefined) {
        record = new BatchAuraRecord(row, this.#fights);
        this.#records.set(key, record);
      }
      present.add(key);
      record.add(row);
    }
    // A row this fight did not have is a fight with the aura never up.
    for (const [key, record] of this.#records) {
      if (!present.has(key)) {
        record.absent();
      }
    }
    this.#duration.add(fight.duration);
    this.#fights += 1;
  }

  // Plain data, fresh on every call:
  //
  //   fights     fights added
  //   duration   their fight time, summed in fight order
  //   rows       one per aura id and side seen in any fight, sorted by id, then
  //              target. Each has the fields of a FightAuras#summary() row, with
  //              applications, refreshes and the seconds summed over the
  //              fights, and:
  //     uptimeFraction     pooled: summed uptime / summed duration
  //     stacks             as in a fight, pooled the same way: meanStacks is
  //                        summed stackSeconds / summed uptime,
  //                        fullStackFraction summed fullStackUptime / summed
  //                        duration
  //     perFight           { uptimeFraction }, and fullStackFraction for a
  //                        stacking aura: RunningStats summaries over all fights
  //                        (a fight without the row counts as 0), for the mean
  //                        and range of one fight
  summary() {
    const duration = this.#duration.value;
    const rows = [];
    for (const record of this.#records.values()) {
      const uptime = record.uptime.value;
      const row = {
        id: record.id,
        target: record.target,
        name: record.name,
        maxStacks: record.maxStacks,
        applications: record.applications,
        refreshes: record.refreshes,
        uptime,
        uptimeFraction: fraction(uptime, duration),
        stacks: null,
        perFight: { uptimeFraction: record.uptimeStats.summary() },
      };
      if (record.stacked) {
        const stackSeconds = record.stackSeconds.value;
        const fullStackUptime = record.fullStackUptime.value;
        row.stacks = {
          stackSeconds,
          meanStacks: uptime > 0 ? stackSeconds / uptime : null,
          fullStackUptime,
          fullStackFraction: fraction(fullStackUptime, duration),
        };
        row.perFight.fullStackFraction = record.fullStackStats.summary();
      }
      rows.push(row);
    }
    rows.sort(byIdAndTarget);
    return { fights: this.#fights, duration, rows };
  }
}

// The pools the resource summary reads from the end event's `resources`
// (js/resource-data.js ids).
const ENERGY = "energy";
const COMBO_POINTS = "comboPoints";

function readWaste(resources, id) {
  const waste = resources[id];
  if (waste === undefined) {
    return { cappedTime: 0, overflow: 0 };
  }
  for (const field of ["cappedTime", "overflow"]) {
    const value = waste?.[field];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(
        `The end event's resources.${id}.${field} must be a number, 0 or more. Got ${value}.`,
      );
    }
  }
  return waste;
}

// One fight's resource waste, read from its end event.
//
//   const resources = new FightResources();
//   const off = resources.attach(runner);
//   ... the fight runs ...
//   resources.summary();
//
// The counts are known once the fight is over: before the end event every
// value is null.
export class FightResources {
  #end = null;

  // Subscribe to the "end" event of `source`. Returns the unsubscribe function.
  attach(source) {
    return source.on("end", (event) => this.observe(event));
  }

  // Read one event. Only "end" counts; other types are ignored.
  observe(event) {
    readEvent(event);
    if (event.type !== "end") {
      return;
    }
    if (this.#end !== null) {
      throw new RangeError(
        "This fight has ended. A FightResources reads one fight; use a new one for the next.",
      );
    }
    const { resources } = event;
    if (resources === null || typeof resources !== "object") {
      throw new TypeError(
        "The end event needs `resources`, what each pool lost to its cap (docs/events.md).",
      );
    }
    const energy = readWaste(resources, ENERGY);
    const comboPoints = readWaste(resources, COMBO_POINTS);
    this.#end = {
      duration: event.time,
      energyCappedTime: energy.cappedTime,
      energyOverflow: energy.overflow,
      comboPointWaste: comboPoints.overflow,
    };
  }

  // Plain data, fresh on every call:
  //
  //   duration              the fight duration (the end event's time), or null
  //   ended                 true once the end event was read
  //   energyCappedTime      seconds energy sat at its cap while regenerating
  //   energyCappedFraction  energyCappedTime / duration, 0 for no length
  //   energyOverflow        energy a gain or regeneration lost to the cap
  //   comboPointWaste       combo points a gain lost to the cap. Points lost
  //                         when a timed gift ran out or a target change
  //                         cleared them are not waste here
  //
  // Before the end every value but `ended` is null.
  summary() {
    const end = this.#end;
    if (end === null) {
      return {
        duration: null,
        ended: false,
        energyCappedTime: null,
        energyCappedFraction: null,
        energyOverflow: null,
        comboPointWaste: null,
      };
    }
    return {
      duration: end.duration,
      ended: true,
      energyCappedTime: end.energyCappedTime,
      energyCappedFraction: fraction(end.energyCappedTime, end.duration),
      energyOverflow: end.energyOverflow,
      comboPointWaste: end.comboPointWaste,
    };
  }
}

function readEnded(fight) {
  if (
    fight === null ||
    typeof fight !== "object" ||
    fight.ended !== true ||
    !Number.isFinite(fight.duration) ||
    !Number.isFinite(fight.energyCappedTime) ||
    !Number.isFinite(fight.energyOverflow) ||
    !Number.isFinite(fight.comboPointWaste)
  ) {
    throw new TypeError(
      "BatchResources.add needs the summary of a fight that ended (FightResources#summary()).",
    );
  }
}

// The resource waste over a batch of fights. Fights are added in order and
// every sum is taken in that order, so the result does not depend on how the
// work was sliced.
export class BatchResources {
  #fights = 0;
  #duration = new CompensatedSum();
  #cappedTime = new CompensatedSum();
  #overflow = new CompensatedSum();
  #comboPointWaste = new CompensatedSum();
  #cappedStats = new RunningStats();
  #wasteStats = new RunningStats();

  get fights() {
    return this.#fights;
  }

  // Add one ended fight: a FightResources#summary().
  add(fight) {
    readEnded(fight);
    this.#duration.add(fight.duration);
    this.#cappedTime.add(fight.energyCappedTime);
    this.#overflow.add(fight.energyOverflow);
    this.#comboPointWaste.add(fight.comboPointWaste);
    this.#cappedStats.add(fight.energyCappedFraction);
    this.#wasteStats.add(fight.comboPointWaste);
    this.#fights += 1;
  }

  // Plain data, fresh on every call:
  //
  //   fights, duration      fights added and their summed duration
  //   energyCappedTime      summed seconds
  //   energyCappedFraction  pooled: summed capped time / summed duration
  //   energyOverflow        summed
  //   comboPointWaste       summed
  //   perFight              { energyCappedFraction, comboPointWaste }:
  //                         RunningStats summaries over the fights
  summary() {
    const duration = this.#duration.value;
    const cappedTime = this.#cappedTime.value;
    return {
      fights: this.#fights,
      duration,
      energyCappedTime: cappedTime,
      energyCappedFraction: fraction(cappedTime, duration),
      energyOverflow: this.#overflow.value,
      comboPointWaste: this.#comboPointWaste.value,
      perFight: {
        energyCappedFraction: this.#cappedStats.summary(),
        comboPointWaste: this.#wasteStats.summary(),
      },
    };
  }
}
