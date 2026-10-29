import { CompensatedSum, RunningStats } from "./running-stats.js";

// The per-ability breakdown (Phase 3, #145, roadmap task S2): what each ability,
// white swing, poison and DoT did in a fight, and the same summed over a batch.
// It has no DOM, reads no clock and draws no randomness.
//
// It is built from the event stream (docs/events.md) and nothing else: the
// `hit` events (every result on the target: a swing, an attack, a poison, a DoT
// tick, a miss included) and the `cast` events (an ability was used). It reads
// no engine internals, so it works on a Simulation, a SimRunner, a recorded
// array of events, or the Phase 3.5 engine, as long as the events are the same.
// Nothing here names a step or a frame. A row is keyed by the ability id, and the
// display name is only a label.
//
// One fight: a FightBreakdown collector. attach(source) subscribes it to
// source.on("hit") and source.on("cast") (a Simulation, a SimRunner, or any
// object with on(type, handler) that returns an unsubscribe function);
// summary() reads it at any time, so the live view can read it mid-fight.
// breakdownFromEvents(events) is the same for events already in hand.
//
// A batch: a BatchBreakdown. add(fightSummary) takes one fight's summary(), in
// iteration order, and summary() gives the totals over the fights added.
//
// The shape of both is documented in docs/breakdown.md, at FightBreakdown#summary
// and at BatchBreakdown#summary.

// The outcomes of a hit event (docs/events.md), always present in a row's
// `outcomes` table, in this order. An outcome that is not on this list (a later
// engine may add one) gets its own key rather than being dropped, so the table
// always adds up to `attempts`.
export const BREAKDOWN_OUTCOMES = Object.freeze([
  "hit",
  "crit",
  "glancing",
  "miss",
  "dodge",
  "parry",
  "block",
  "cast",
]);

// The origin of a hit event that is a DoT tick (docs/events.md).
const TICK_ORIGIN = "dot";

function newOutcomes() {
  const outcomes = {};
  for (const outcome of BREAKDOWN_OUTCOMES) {
    outcomes[outcome] = 0;
  }
  return outcomes;
}

// Rows are listed by id, in code-point order, so the order depends on what is
// in the rows and never on the order things happened in. A row with no id (a
// caller of addCombatEvent that gave none) sorts first.
function byId(first, second) {
  const a = first.id ?? "";
  const b = second.id ?? "";
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function average(total, count) {
  return count > 0 ? total / count : null;
}

function readEvent(event, type) {
  if (event === null || typeof event !== "object") {
    throw new TypeError(
      `A breakdown reads event objects. Got ${event === null ? "null" : typeof event}.`,
    );
  }
  if (type === "hit" && !Number.isFinite(event.damage)) {
    throw new RangeError(
      `A hit event needs a finite damage. Got ${event.damage}.`,
    );
  }
}

// One fight, read from its events.
//
//   const breakdown = new FightBreakdown();
//   const off = breakdown.attach(runner); // before run(), so no event is missed
//   ... the fight runs ...
//   breakdown.summary();
export class FightBreakdown {
  // Records by ability id, in the order they were first seen.
  #records = new Map();
  #total = 0;

  // Subscribe to the "hit" and "cast" events of `source`. Returns one function
  // that unsubscribes both.
  attach(source) {
    const offHit = source.on("hit", (event) => this.observe(event));
    const offCast = source.on("cast", (event) => this.observe(event));
    return () => {
      offHit();
      offCast();
    };
  }

  // Read one event. Events other than "hit" and "cast" are ignored, so a
  // wildcard subscription works too.
  observe(event) {
    readEvent(event, event?.type);
    if (event.type === "hit") {
      this.#addHit(event);
    } else if (event.type === "cast") {
      this.#record(event.ability, event.name, event.icon).casts += 1;
    }
  }

  #record(id, name, icon) {
    let record = this.#records.get(id);
    if (record === undefined) {
      record = {
        id,
        name,
        icon: icon ?? null,
        origin: null,
        casts: 0,
        attempts: 0,
        outcomes: newOutcomes(),
        hits: 0,
        directDamage: 0,
        tickCount: 0,
        tickCrits: 0,
        tickDamage: 0,
      };
      this.#records.set(id, record);
    }
    return record;
  }

  #addHit(event) {
    const record = this.#record(event.ability ?? null, event.name, event.icon);
    // The total is added in event order, as the engine adds it, so it equals the
    // fight's own total to the last bit.
    this.#total += event.damage;
    if (event.origin === TICK_ORIGIN) {
      record.tickCount += 1;
      record.tickDamage += event.damage;
      if (event.outcome === "crit") {
        record.tickCrits += 1;
      }
      return;
    }
    record.origin ??= event.origin;
    record.attempts += 1;
    record.outcomes[event.outcome] = (record.outcomes[event.outcome] ?? 0) + 1;
    if (event.damage > 0) {
      record.hits += 1;
      record.directDamage += event.damage;
    }
  }

  // Plain data, fresh on every call:
  //
  //   totalDamage  the damage of every hit event, added in event order. Equal to
  //                the fight's totalDamage.
  //   rows         one per ability id, sorted by id:
  //     id, name, icon   who. `name` and `icon` are labels from the first event.
  //     origin           "white", "yellow" or "poison": where its attack rolls
  //                      came from. "dot" for a row that only has ticks.
  //     casts            `cast` events (0 for a white swing or a poison proc,
  //                      which are not casts).
  //     attempts         attack rolls: hit events that are not DoT ticks (a DoT
  //                      application and a "cast" outcome count, a miss too).
  //     outcomes         attempts by outcome: hit, crit, glancing, miss, dodge,
  //                      parry, block, cast (plus any other outcome seen). Adds up
  //                      to `attempts`.
  //     hits             attempts that dealt damage (damage above 0).
  //     directDamage     their damage, DoT ticks not included.
  //     averageHit       directDamage / hits, null with no hit.
  //     ticks            { count, crits, damage, average }: DoT ticks, which are
  //                      not attempts. `average` is null with no tick.
  //     damage           directDamage + ticks.damage: the row's total.
  //     share            damage / totalDamage, 0 if the fight dealt none. The
  //                      rows' shares add up to 1 (100 percent) within rounding.
  summary() {
    const rows = [];
    for (const record of this.#records.values()) {
      const damage = record.directDamage + record.tickDamage;
      rows.push({
        id: record.id,
        name: record.name,
        icon: record.icon,
        origin: record.origin ?? TICK_ORIGIN,
        casts: record.casts,
        attempts: record.attempts,
        outcomes: { ...record.outcomes },
        hits: record.hits,
        directDamage: record.directDamage,
        averageHit: average(record.directDamage, record.hits),
        ticks: {
          count: record.tickCount,
          crits: record.tickCrits,
          damage: record.tickDamage,
          average: average(record.tickDamage, record.tickCount),
        },
        damage,
        share: this.#total > 0 ? damage / this.#total : 0,
      });
    }
    rows.sort(byId);
    return { totalDamage: this.#total, rows };
  }
}

// The breakdown of events already in hand (a recorded array, or any iterable):
// the same summary a FightBreakdown attached to the fight gives.
export function breakdownFromEvents(events) {
  const breakdown = new FightBreakdown();
  for (const event of events) {
    breakdown.observe(event);
  }
  return breakdown.summary();
}

// A running batch row: counts, compensated damage sums, and the per-fight
// statistics of the row's damage and casts.
class BatchRecord {
  constructor(row, fightsBefore) {
    this.id = row.id;
    this.name = row.name;
    this.icon = row.icon;
    this.origin = row.origin;
    this.casts = 0;
    this.attempts = 0;
    this.outcomes = newOutcomes();
    this.hits = 0;
    this.directDamage = new CompensatedSum();
    this.tickCount = 0;
    this.tickCrits = 0;
    this.tickDamage = new CompensatedSum();
    this.damage = new CompensatedSum();
    this.damageStats = new RunningStats();
    this.castStats = new RunningStats();
    // The fights before the one that first had this row had none of it: zeros,
    // added in fight order, so the statistics are those of every fight.
    for (let fight = 0; fight < fightsBefore; fight += 1) {
      this.#addPerFight(0, 0);
    }
  }

  add(row) {
    this.casts += row.casts;
    this.attempts += row.attempts;
    for (const [outcome, count] of Object.entries(row.outcomes)) {
      this.outcomes[outcome] = (this.outcomes[outcome] ?? 0) + count;
    }
    this.hits += row.hits;
    this.directDamage.add(row.directDamage);
    this.tickCount += row.ticks.count;
    this.tickCrits += row.ticks.crits;
    this.tickDamage.add(row.ticks.damage);
    this.damage.add(row.damage);
    this.#addPerFight(row.damage, row.casts);
  }

  #addPerFight(damage, casts) {
    this.damageStats.add(damage);
    this.castStats.add(casts);
  }

  absent() {
    this.#addPerFight(0, 0);
  }
}

// The breakdown summed over a batch of fights.
//
//   const batch = new BatchBreakdown();
//   batch.add(fightBreakdown.summary()); // one fight, in iteration order
//   batch.summary();
//
// Fights are added in order and every sum is taken in that order, so the result
// depends on the fights and their order only, never on how the work was sliced.
// The batch runner (js/batch-runner.js) adds the iterations in index order.
export class BatchBreakdown {
  #records = new Map();
  #fights = 0;
  #total = new CompensatedSum();

  // How many fights have been added.
  get fights() {
    return this.#fights;
  }

  // Add one fight: a FightBreakdown#summary() (or breakdownFromEvents) result.
  add(fight) {
    if (
      fight === null ||
      typeof fight !== "object" ||
      !Array.isArray(fight.rows) ||
      !Number.isFinite(fight.totalDamage)
    ) {
      throw new TypeError(
        "BatchBreakdown.add needs a fight summary { totalDamage, rows }.",
      );
    }
    const present = new Set();
    for (const row of fight.rows) {
      let record = this.#records.get(row.id);
      if (record === undefined) {
        record = new BatchRecord(row, this.#fights);
        this.#records.set(row.id, record);
      }
      present.add(row.id);
      record.add(row);
    }
    // A row this fight did not have is a fight of zero for it.
    for (const [id, record] of this.#records) {
      if (!present.has(id)) {
        record.absent();
      }
    }
    this.#total.add(fight.totalDamage);
    this.#fights += 1;
  }

  // Plain data, fresh on every call:
  //
  //   fights       fights added
  //   totalDamage  the damage of all of them, summed in fight order
  //   rows         one per ability id seen in any fight, sorted by id. Each is a
  //                row of FightBreakdown#summary with every number summed over the
  //                fights (casts, attempts, outcomes, hits, directDamage,
  //                ticks, damage), and:
  //     averageHit, ticks.average   pooled: the summed damage over the summed
  //                      count, not the mean of each fight's average.
  //     share            damage / totalDamage over the whole batch. Adds up to 1
  //                      within rounding.
  //     perFight         { damage, casts }: RunningStats summaries over all
  //                      fights (a fight without the row counts as 0), so
  //                      `perFight.damage.mean` is the damage the ability does in
  //                      an average fight.
  summary() {
    const total = this.#total.value;
    const rows = [];
    for (const record of this.#records.values()) {
      const directDamage = record.directDamage.value;
      const tickDamage = record.tickDamage.value;
      const damage = record.damage.value;
      rows.push({
        id: record.id,
        name: record.name,
        icon: record.icon,
        origin: record.origin,
        casts: record.casts,
        attempts: record.attempts,
        outcomes: { ...record.outcomes },
        hits: record.hits,
        directDamage,
        averageHit: average(directDamage, record.hits),
        ticks: {
          count: record.tickCount,
          crits: record.tickCrits,
          damage: tickDamage,
          average: average(tickDamage, record.tickCount),
        },
        damage,
        share: total > 0 ? damage / total : 0,
        perFight: {
          damage: record.damageStats.summary(),
          casts: record.castStats.summary(),
        },
      });
    }
    rows.sort(byId);
    return { fights: this.#fights, totalDamage: total, rows };
  }
}
