// The event core's fight (E6, #197): a legacy Simulation run on the Phase 3.5
// scheduler (js/core/scheduler.js) instead of fixed steps. The Simulation stays
// the store of the fight's state (the auras, the cooldowns, the GCD, the DoTs,
// the totals) and does every hit, tick and proc as it does on legacy; this
// module only says when. Simulation.run comes here on the "events" engine
// (Simulation option `engine`), and step() is always legacy.
//
// What moves the fight:
//
//   energy          the continuous EnergyPool (js/core/energy.js) is put in
//                   place of the legacy energy pool for the run, and wakes
//                   the rotation when it reaches the cheapest cost it lacks.
//   expiry          a timer for the GCD, each cooldown, each aura and each
//                   pool's expiry (Premeditation's points), js/core/timers.js.
//   dot-tick        DotTicks (js/core/dots.js): Simulation.resolveDotAttack
//                   and resolveProcDot tell the core where a DoT starts
//                   (Simulation#core.dotApplied).
//   swing           a SwingTimer per hand (js/core/swing.js).
//   decision        the rotation (Rogue.castRotation), at decision points.
//
// Decision points. The rotation runs once at the time of any other event
// (after it, in the decision class), so a cast, a swing, a tick, a proc, an
// aura or cooldown running out, the GCD ending and an energy threshold are
// each looked at, and once more where a condition that moves with time
// (auraRemaining, fightTimeRemaining, energyToCap, a resource) would cross its
// value with no event in between (conditionWakeAt in js/rotation-conditions.js).
// Nothing else changes what a rule can see, so the rotation is never run where
// it could not do something new: no fixed polling (test/core-fight.test.js runs
// a 1/64 s poll on top and checks it never casts).
//
// The timers follow the Simulation's own fields. Before each event every
// running timer writes its time left back (aura.duration, cooldowns[id],
// gcd, a DoT's duration and timeUntilNextTick, a pool's expiryRemaining), so
// the legacy code reads the fight as it is now; after it, a field that the
// event changed (a cast, a refresh, a charge used up) moves its timer. The
// energy pool is told after every event that a modifier may have changed
// (EnergyPool.modifiersChanged: the host contract #194 set).
import { k } from "../../data/constants.js";
import { conditionWakeAt } from "../rotation-conditions.js";
import { rotationStateReader } from "../rotation-state.js";
import { DOT_REFRESH, DOT_TICK_KIND, DotTicks } from "./dots.js";
import { EnergyPool, WAKE_KIND } from "./energy.js";
import { ORDER, Scheduler } from "./scheduler.js";
import { SWING_KIND, SwingTimer } from "./swing.js";
import { TIMER_KINDS, Timer, TimerSet } from "./timers.js";

export const ENGINES = Object.freeze({ legacy: "legacy", events: "events" });

export const DECISION_KIND = "decision";
// A test's extra look at the rotation (runOnCore's pollEvery).
export const POLL_KIND = "poll";

const AURA_MAPS = Object.freeze(["activeBuffs", "activeDebuffs"]);
// The payload of a decision point set for a condition crossing (armWakes).
const CONDITION_WAKE = Object.freeze({ wake: "condition" });

function nudgeUp(time) {
  return time + Math.max(Math.abs(time) * Number.EPSILON, Number.MIN_VALUE);
}

// Counts for one run, kept on the Simulation (coreStats) across runs.
function emptyStats() {
  return {
    events: 0,
    decisions: 0,
    conditionWakes: 0,
    energyWakes: 0,
    casts: 0,
    polls: 0,
    pollCasts: [],
  };
}

// Run `sim` for `duration` seconds on the event core. The fight goes on from
// where it is (sim.currentTime, the auras and timers as they stand) and is
// left as legacy would leave it, so a second run, or step(), carries on.
// A second run goes on exactly as one run would (#198, from #197 QA M1):
// the core keeps the fight's clock, and close() leaves sim.coreCarry, the
// exact ends, clocks, swing grids and energy line, which the next run takes
// for every field still as it was written (see CoreFight.carry). Only the
// core's own counts differ: each run asks the rotation once at its start.
// Does not end the fight (Simulation.run does). Two options are for tests
// only: `pollEvery` adds a look at the rotation every so many seconds on top
// of the decision points (what it casts is recorded in
// sim.coreStats.pollCasts), and `afterEvent(event, fight)` is called after
// each event is handled.
export function runOnCore(sim, duration, options = {}) {
  const run = openCore(sim, duration, options);
  try {
    run.runUntil(run.endTime);
  } finally {
    run.close();
  }
  return run.stats;
}

// The event core held open over many calls, for a host that hands it time in
// pieces (SimRunner, #198: a live frame, a batch run, a paused fight). One
// scheduler for the whole `duration`, so the pieces are one run: runUntil(a)
// then runUntil(b) handles the same events in the same order as runUntil(b),
// with no carry and no step. Times are the fight's own seconds
// (sim.currentTime): the run starts at the fight's time when it was opened
// (0 for a new fight) and ends `duration` later, at endTime.
//
//   const run = openCore(sim, duration);
//   run.runUntil(t);   // every event at or before t, then the fight at t
//   run.nextTime;      // the next event's time, or null
//   run.close();       // the fight as legacy keeps it; then sim.end()
//
// Between two calls the Simulation's fields read the fight at `time` (the
// GCD, cooldowns, auras and DoTs left, sim.currentTime): what js/live-feed.js
// reads each frame. rogue.resources.energy is the core's continuous pool
// until close(), with the same value, max and waste reads. While it is open
// the fight is the core's: step() throws, and so does a second openCore
// or run() on the events engine. Same options as runOnCore.
export function openCore(
  sim,
  duration,
  { pollEvery = null, afterEvent = null } = {},
) {
  return new CoreRun(sim, duration, { pollEvery, afterEvent });
}

class CoreRun {
  #fight;
  #scheduler;
  #closed = false;

  constructor(sim, duration, { pollEvery, afterEvent }) {
    if (sim.core !== null && sim.core !== undefined) {
      throw new Error("The event core is already running this fight.");
    }
    const start = sim.currentTime;
    this.stats = sim.coreStats ??= emptyStats();
    let fight = null;
    // On the fight's clock, not from 0 at each open: two runs of one fight
    // then compute every time the same way, so events at one time stay at one
    // time (#197 QA M1).
    const scheduler = new Scheduler({
      startTime: start,
      endTime: start + duration,
      handle: (event) => {
        fight.handle(event);
        fight.afterEvent?.(event, fight);
      },
    });
    fight = new CoreFight(sim, scheduler, {
      stats: this.stats,
      epsilon: k("sim.tickEpsilon"),
      pollEvery,
    });
    fight.afterEvent = afterEvent;
    this.#fight = fight;
    this.#scheduler = scheduler;
    sim.core = fight;
    try {
      fight.begin();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  // The fight's time reached, in seconds.
  get time() {
    return this.#scheduler.now;
  }

  // The fight's time the run ends at: its time at the open plus `duration`.
  get endTime() {
    return this.#scheduler.endTime;
  }

  // The time of the next event, or null when none is pending.
  get nextTime() {
    return this.#scheduler.nextTime;
  }

  get closed() {
    return this.#closed;
  }

  // Handle every event at or before `t` (the fight's time, from time to
  // endTime), then write the fight's timers at `t` into the Simulation.
  runUntil(t) {
    if (this.#closed) {
      throw new Error("This event core run is closed.");
    }
    this.#scheduler.runUntil(t);
    this.#fight.advance();
  }

  // Put the fight back as legacy keeps it (the legacy energy pool, each
  // swing's time left). A second call does nothing.
  close() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const fight = this.#fight;
    try {
      fight.finish();
    } finally {
      fight.sim.core = null;
      fight.sim.currentTime = fight.now;
    }
  }
}

class CoreFight {
  constructor(sim, scheduler, { stats, epsilon, pollEvery }) {
    this.sim = sim;
    this.rogue = sim.rogue;
    this.scheduler = scheduler;
    this.stats = stats;
    this.epsilon = epsilon;
    this.pollEvery = pollEvery;
    this.gcd = new Timer({ scheduler, kind: TIMER_KINDS.gcd });
    this.cooldowns = new TimerSet({ scheduler, kind: TIMER_KINDS.cooldown });
    // One set per aura map: a buff and a debuff may share an id.
    this.auraTimers = Object.fromEntries(
      AURA_MAPS.map((map) => [
        map,
        new TimerSet({ scheduler, kind: TIMER_KINDS.aura }),
      ]),
    );
    this.points = new TimerSet({ scheduler, kind: TIMER_KINDS.points });
    this.dots = new DotTicks({ scheduler });
    // What each timer wrote into its field before the event, to tell a field
    // the event changed: gcd, cooldowns by id, auras by map and id (with the
    // aura object), pools by id.
    this.seen = {
      gcd: 0,
      cooldowns: new Map(),
      auras: Object.fromEntries(AURA_MAPS.map((map) => [map, new Map()])),
      points: new Map(),
    };
    this.decision = null;
    // The time of the last decision point and how many ran at it (decide).
    this.askedAt = null;
    this.legacyEnergy = null;
    this.energy = null;
    this.swings = null;
    this.readState = null;
    // The next poll's time (check mode), scheduled or past the end, for the
    // carry.
    this.nextPoll = null;
    // While begin() runs: what the last run on this fight left
    // (sim.coreCarry, see carry()), when it closed at this run's start.
    this.carried = null;
  }

  get now() {
    return this.scheduler.now;
  }

  begin() {
    const { sim, rogue, scheduler } = this;
    // A carry is for a run that starts where the last one closed. Read once:
    // any other run starts afresh from the fields.
    const carry = sim.coreCarry;
    sim.coreCarry = null;
    this.carried = carry?.time === scheduler.now ? carry : null;
    // The continuous pool in place of the legacy one, from its value.
    const legacy = rogue.resources.energy;
    if (legacy !== undefined) {
      const make = (line) =>
        new EnergyPool({
          definition: legacy.definition,
          modifiers: legacy.modifiers,
          scheduler,
          value: legacy.value,
          baseMax: legacy.baseMax,
          line,
        });
      // The last run's line while the pool, its value, rate and cap are as
      // it left them (carry()).
      const item = this.carried?.energy;
      let pool =
        item?.pool === legacy &&
        item.written === legacy.value &&
        item.baseMax === legacy.baseMax
          ? make(item.line)
          : make();
      if (
        item !== undefined &&
        (pool.line.rate !== item.line.rate || pool.line.cap !== item.line.cap)
      ) {
        pool = make();
      }
      pool.onChange = (change, before, source) =>
        sim.emitResource(pool, change, before, source);
      this.legacyEnergy = legacy;
      this.energy = pool;
      rogue.resources.energy = pool;
    }
    this.readState = rotationStateReader(rogue, sim, {
      duration: sim.fightLength,
    });
    // What is already running when the run starts.
    this.sync();
    const carried = this.carried;
    for (const [id, dot] of Object.entries(sim.activeDots)) {
      const item = carried?.dots.get(id);
      if (
        item !== undefined &&
        item.entry === dot &&
        item.timeUntilNextTick === dot.timeUntilNextTick &&
        item.tickInterval === dot.tickInterval &&
        item.duration === dot.duration &&
        item.state !== null
      ) {
        this.dots.resume(id, item.state);
      } else {
        this.dotApplied(id, null, dot);
      }
    }
    for (const [id, state] of carried?.idleDots ?? []) {
      if (!Object.hasOwn(sim.activeDots, id)) {
        this.dots.resume(id, state);
      }
    }
    this.swings = ["mainHand", "offHand"].map((hand) => {
      const weapon = rogue.weapons[hand];
      const timer = new SwingTimer({
        weapon,
        modifiers: sim.modifiers,
        scheduler,
      });
      const item = carried?.swings.get(hand);
      if (
        item !== undefined &&
        item.weapon === weapon &&
        item.written === weapon.swingTimer &&
        item.state !== null
      ) {
        timer.resume(item.state);
      } else {
        timer.start(scheduler.now + Math.max(0, weapon.swingTimer));
      }
      return timer;
    });
    if (this.pollEvery !== null) {
      this.schedulePoll(carried?.poll ?? scheduler.now + this.pollEvery);
    }
    this.carried = null;
    this.requestDecision(scheduler.now);
  }

  // What a run that starts where this one closes needs to go on as one run
  // would (#198, from #197 QA M1): the exact end of each timer, each DoT's
  // clock, each swing's grid and the pending poll, with what was written
  // into each field. The fields hold time left, now - end rounded, so a run
  // re-based from them alone moves later events by ulps, and a tick or a
  // swing can change places with another event. begin() takes an item only
  // while its field still holds what was written, so a change made between
  // the runs starts afresh from the field.
  carry() {
    const { sim, seen } = this;
    // seen holds what was written: a number for a cooldown, { written }
    // for a pool, { aura, written } for an aura.
    const timers = (written, set) =>
      new Map(
        [...written].map(([id, entry]) => [
          id,
          typeof entry === "number"
            ? { written: entry, endsAt: set.endsAt(id) }
            : { ...entry, endsAt: set.endsAt(id) },
        ]),
      );
    return {
      time: this.now,
      gcd: { written: seen.gcd, endsAt: this.gcd.endsAt },
      cooldowns: timers(seen.cooldowns, this.cooldowns),
      auras: Object.fromEntries(
        AURA_MAPS.map((map) => [
          map,
          timers(seen.auras[map], this.auraTimers[map]),
        ]),
      ),
      points: timers(seen.points, this.points),
      dots: new Map(
        Object.entries(sim.activeDots).map(([id, entry]) => [
          id,
          {
            entry,
            timeUntilNextTick: entry.timeUntilNextTick,
            tickInterval: entry.tickInterval,
            duration: entry.duration,
            state: this.dots.state(id),
          },
        ]),
      ),
      // A DoT whose last tick has run while it has time left: legacy has
      // dropped its entry, but a proc that applies it again before its end
      // goes on with its clock (keep-clock).
      idleDots: new Map(
        this.dots.runningIds
          .filter((id) => !Object.hasOwn(sim.activeDots, id))
          .map((id) => [id, this.dots.state(id)]),
      ),
      swings: new Map(
        (this.swings ?? []).map((timer) => [
          timer.hand,
          {
            weapon: timer.weapon,
            written: timer.weapon.swingTimer,
            state: timer.state,
          },
        ]),
      ),
      poll: this.nextPoll,
      energy:
        this.energy === null
          ? undefined
          : {
              pool: this.legacyEnergy,
              written: this.legacyEnergy.value,
              baseMax: this.legacyEnergy.baseMax,
              line: this.energy.line,
            },
    };
  }

  // A timer's end: at begin(), the end the last run left while the field
  // still holds what it wrote (carry()); else now + the field.
  endFor(item, value) {
    return item !== undefined && item.endsAt !== null && item.written === value
      ? item.endsAt
      : this.scheduler.now + value;
  }

  // Put the fight back as legacy keeps it: the legacy energy pool with the
  // value and the waste of the run, and each swing's time left.
  finish() {
    const { rogue } = this;
    if (this.energy !== null) {
      const { cappedTime, overflow } = this.energy.waste();
      this.legacyEnergy.value = this.energy.value;
      this.legacyEnergy.cappedTime += cappedTime;
      this.legacyEnergy.overflow += overflow;
      rogue.resources.energy = this.legacyEnergy;
    }
    if (this.swings !== null) {
      for (const timer of this.swings) {
        timer.weapon.swingTimer = timer.swingTimer ?? 0;
      }
    }
    this.sim.coreCarry = this.carry();
  }

  handle(event) {
    this.stats.events += 1;
    this.advance(event);
    switch (event.kind) {
      case DECISION_KIND:
        this.decide(event);
        return;
      case POLL_KIND:
        this.poll();
        return;
      case SWING_KIND:
        this.swing(event);
        break;
      case DOT_TICK_KIND:
        this.dotTick(event);
        break;
      case TIMER_KINDS.aura:
        this.expireAura(event.payload.id);
        break;
      case TIMER_KINDS.gcd:
        this.sim.gcd = 0;
        this.seen.gcd = 0;
        break;
      // An expiry the pool counts down itself: tick() it through what was
      // left, so it runs out as on legacy (Resource.tick).
      case TIMER_KINDS.cooldown:
        this.sim.cooldowns[event.payload.id] = 0;
        this.seen.cooldowns.delete(event.payload.id);
        break;
      case TIMER_KINDS.points: {
        const pool = this.rogue.resources[event.payload.id];
        this.seen.points.delete(event.payload.id);
        pool.tick(pool.expiryRemaining);
        break;
      }
      case WAKE_KIND:
        this.stats.energyWakes += 1;
        break;
      default:
        throw new Error(`The event core has no handler for "${event.kind}".`);
    }
    this.settle();
    this.requestDecision(this.scheduler.now);
  }

  // After an event: move the timers its changes started, and tell the pool.
  settle() {
    this.sync();
    this.energy?.modifiersChanged();
  }

  // Write each running timer's time left into its field, at now. `event`
  // is the one being handled (none for the write at the end of the run).
  advance(event) {
    const { sim, scheduler, seen } = this;
    sim.currentTime = this.now;
    // A timer whose end is this event (endsAt null: it has run) is left as
    // it was for its handler.
    const left = (endsAt) => Math.max(0, endsAt - scheduler.now);
    if (seen.gcd > 0 && this.gcd.endsAt !== null) {
      sim.gcd = left(this.gcd.endsAt);
      seen.gcd = sim.gcd;
    }
    for (const id of seen.cooldowns.keys()) {
      const endsAt = this.cooldowns.endsAt(id);
      if (endsAt !== null) {
        sim.cooldowns[id] = left(endsAt);
        seen.cooldowns.set(id, sim.cooldowns[id]);
      }
    }
    for (const map of AURA_MAPS) {
      for (const [id, entry] of seen.auras[map]) {
        const endsAt = this.auraTimers[map].endsAt(id);
        if (endsAt !== null) {
          entry.aura.duration = left(endsAt);
          entry.written = entry.aura.duration;
        }
      }
    }
    for (const [id, entry] of seen.points) {
      const endsAt = this.points.endsAt(id);
      if (endsAt !== null) {
        const pool = this.rogue.resources[id];
        pool.expiryRemaining = left(endsAt);
        entry.written = pool.expiryRemaining;
      }
    }
    // A DoT's own tick event has run, so it has no pending tick until its
    // handler calls ticked(): its entry stays for the tick.
    const ticking = event?.kind === DOT_TICK_KIND ? event.payload.id : null;
    for (const [id, dot] of Object.entries(sim.activeDots)) {
      if (id === ticking) {
        continue;
      }
      const next = this.dots.nextTickAt(id);
      if (next === null) {
        // Ran out between ticks: legacy drops the entry at its end.
        delete sim.activeDots[id];
        continue;
      }
      dot.timeUntilNextTick = next - scheduler.now;
      dot.duration = this.dots.remaining(id);
    }
  }

  // Start, move or clear the timer of every field that changed since
  // advance() wrote it.
  sync() {
    const { sim, rogue, seen } = this;
    if (sim.gcd !== seen.gcd) {
      if (sim.gcd > 0) {
        this.gcd.setEndsAt(this.endFor(this.carried?.gcd, sim.gcd));
      } else {
        this.gcd.clear();
      }
      seen.gcd = sim.gcd;
    }
    for (const [id, value] of Object.entries(sim.cooldowns)) {
      if (value === (seen.cooldowns.get(id) ?? 0)) {
        continue;
      }
      if (value > 0 && Number.isFinite(value)) {
        this.cooldowns.setEndsAt(
          id,
          this.endFor(this.carried?.cooldowns.get(id), value),
        );
        seen.cooldowns.set(id, value);
      } else {
        this.cooldowns.clear(id);
        seen.cooldowns.delete(id);
      }
    }
    for (const id of seen.cooldowns.keys()) {
      if (!Object.hasOwn(sim.cooldowns, id)) {
        this.cooldowns.clear(id);
        seen.cooldowns.delete(id);
      }
    }
    for (const map of AURA_MAPS) {
      this.syncAuras(map);
    }
    for (const [id, pool] of Object.entries(rogue.resources)) {
      if (pool === this.energy) {
        continue;
      }
      pool.clamp();
      const remaining = pool.expiryRemaining;
      const entry = seen.points.get(id);
      if (remaining === (entry?.written ?? 0)) {
        continue;
      }
      if (remaining > 0 && Number.isFinite(remaining)) {
        this.points.setEndsAt(
          id,
          this.endFor(this.carried?.points.get(id), remaining),
        );
        seen.points.set(id, { written: remaining });
      } else {
        this.points.clear(id);
        seen.points.delete(id);
      }
    }
  }

  syncAuras(map) {
    const auras = this.sim[map];
    const seen = this.seen.auras[map];
    const timers = this.auraTimers[map];
    const now = this.scheduler.now;
    for (const [id, entry] of seen) {
      if (auras[id] !== entry.aura) {
        timers.clear(id);
        seen.delete(id);
      }
    }
    for (const [id, aura] of Object.entries(auras)) {
      const entry = seen.get(id);
      if (entry !== undefined && aura.duration === entry.written) {
        continue;
      }
      if (Number.isFinite(aura.duration)) {
        const item = this.carried?.auras[map].get(id);
        timers.setEndsAt(
          id,
          item?.aura === aura && aura.duration >= 0
            ? this.endFor(item, aura.duration)
            : now + Math.max(0, aura.duration),
        );
        seen.set(id, { aura, written: aura.duration });
      } else {
        timers.clear(id);
        seen.delete(id);
      }
    }
  }

  // An aura's time ran out: remove it and run its expiry, as step() does.
  expireAura(id) {
    const { sim } = this;
    for (const map of AURA_MAPS) {
      const entry = this.seen.auras[map].get(id);
      if (
        entry === undefined ||
        this.auraTimers[map].endsAt(id) !== null ||
        sim[map][id] !== entry.aura
      ) {
        continue;
      }
      this.seen.auras[map].delete(id);
      const { aura } = entry;
      delete sim[map][id];
      aura.duration = 0;
      const definition = sim.auraDefinitions.get(id);
      if (definition !== undefined) {
        sim.emitAura(definition, aura, "expire", { reason: "time" });
      }
      definition?.onExpire?.(sim, aura);
    }
  }

  swing(event) {
    const timer = this.swings.find(({ payload }) => payload === event.payload);
    const { weapon } = timer;
    this.sim.resolveAttack(weapon.attack, "weapon", weapon.rollDamage());
    timer.swung();
  }

  dotTick(event) {
    const { sim } = this;
    const { id } = this.dots.ticked(event);
    const dot = sim.activeDots[id];
    const context = sim.abilityContext(id, dot);
    sim.resolveDotTick(id, dot, context);
    sim.procs.onDotTick(context);
    if (this.dots.nextTickAt(id) === null) {
      delete sim.activeDots[id];
    }
  }

  // Simulation tells the core where it wrote a DoT into activeDots: `refresh`
  // is the DotTicks rule (restart for a cast, keep-clock for a proc's). A DoT
  // that was running when the run started (refresh null) carries on from its
  // entry: the next tick after its timeUntilNextTick, up to its end.
  dotApplied(id, refresh, entry = this.sim.activeDots[id]) {
    this.dots.apply(id, {
      interval: entry.tickInterval,
      duration: entry.duration,
      refresh: refresh ?? DOT_REFRESH.keepClock,
      nextTickIn: refresh === null ? entry.timeUntilNextTick : undefined,
    });
  }

  // One decision point at `time` (scheduler time), `payload` CONDITION_WAKE
  // for a condition crossing: there is one pending at most, and the earliest
  // stays, since the decision re-arms the wakes.
  requestDecision(time, payload = null) {
    const pending = this.decision;
    if (pending !== null && pending.state === "pending") {
      if (pending.time <= time) {
        return;
      }
      pending.cancel();
    }
    this.decision = this.scheduler.schedule({
      time,
      order: ORDER.decision,
      kind: DECISION_KIND,
      payload,
    });
  }

  decide(event) {
    this.stats.decisions += 1;
    if (event.payload !== null) {
      this.stats.conditionWakes += 1;
    }
    const result = this.rogue.castRotation(this.sim);
    const casts = result?.casts.length ?? 0;
    this.stats.casts += casts;
    this.settle();
    // A cast changes what the rotation sees (combo points, energy, an aura),
    // so the rotation is asked again at the same time: an off-GCD rule (Cold
    // Blood) can follow the cast that made it true, as the next legacy step
    // would cast it. A real cast spends a GCD, a cooldown or a resource, so a
    // rule casts once per instant; the count stops a host whose casts change
    // nothing from asking forever: the first ask and as many re-asks as the
    // rotation has rules, so rules.length + 1 asks at one time.
    const now = this.scheduler.now;
    this.askedAt =
      this.askedAt?.time === now
        ? { time: now, count: this.askedAt.count + 1 }
        : { time: now, count: 1 };
    if (
      casts > 0 &&
      this.askedAt.count <= this.rogue.rotationProgram.rules.length
    ) {
      this.requestDecision(now);
    }
    this.armWakes();
  }

  poll() {
    // A decision point due now runs first: the poll looks after it.
    const pending = this.decision;
    if (pending?.state === "pending" && pending.time === this.scheduler.now) {
      this.schedulePoll(this.scheduler.now);
      return;
    }
    this.stats.polls += 1;
    const result = this.rogue.castRotation(this.sim);
    if (result !== undefined && result.casts.length > 0) {
      this.stats.pollCasts.push({ time: this.now, casts: result.casts });
    }
    this.settle();
    this.schedulePoll(this.scheduler.now + this.pollEvery);
  }

  schedulePoll(time) {
    this.nextPoll = time;
    if (time <= this.scheduler.endTime) {
      this.scheduler.schedule({
        time,
        order: ORDER.decision,
        kind: POLL_KIND,
        payload: null,
      });
    }
  }

  // After a decision: wake when energy reaches the cheapest cost the rotation
  // lacks, and at the first time a condition that moves with time crosses its
  // value.
  armWakes() {
    const { rogue, sim, energy } = this;
    const rules = rogue.rotationProgram.rules;
    if (energy !== null) {
      const value = energy.value;
      let amount = Number.POSITIVE_INFINITY;
      for (const { action } of rules) {
        const ability = rogue.abilitiesById.get(action);
        if (ability === undefined || ability.costResource !== energy.id) {
          continue;
        }
        const cost = ability.costNow(sim);
        if (cost > value && cost < amount) {
          amount = cost;
        }
      }
      if (amount <= energy.max) {
        energy.wakeAt(amount);
      } else {
        energy.cancelWake();
      }
    }
    const state = this.readState();
    let wake = Number.POSITIVE_INFINITY;
    for (const { conditions } of rules) {
      for (const condition of conditions) {
        const time = conditionWakeAt(condition, state);
        if (time !== null && time < wake) {
          wake = time;
        }
      }
    }
    const at = Math.max(wake, nudgeUp(this.scheduler.now));
    if (at <= this.scheduler.endTime) {
      this.requestDecision(at, CONDITION_WAKE);
    }
  }
}
