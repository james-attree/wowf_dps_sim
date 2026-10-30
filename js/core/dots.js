// DoT ticks for the Phase 3.5 core (E5, #196). Not used by the legacy engine,
// which counts each DoT down per step (Simulation.step, timeUntilNextTick).
//
// One DoT per id keeps one pending tick event (kind DOT_TICK_KIND, order class
// "dot-tick", payload { id }). The host's handler calls ticked(event), which
// schedules the next tick, and then runs the tick body
// (Simulation.resolveDotTick, then procs.onDotTick), as legacy does. A refresh
// from the tick's own procs therefore replaces the tick just scheduled.
//
// Times are anchored: the n-th tick is at anchor + n * interval, never the
// last tick plus a delta, so a DoT applied at t ticks at exactly t + i,
// t + 2i, and so on. Two refresh rules, by what applied the DoT:
//   restart     a cast DoT (Rupture, Simulation.resolveDotAttack). The anchor
//               is now and the ticks are n = 1 to floor(duration / interval),
//               the count legacy splits the damage over. Any tick of the old
//               application is cancelled, so none is left stale.
//   keep-clock  a DoT a proc applies (Simulation.resolveProcDot, wowsims
//               ApplyOrRefresh). While it is running, the tick clock goes on
//               and only the end moves, to now + duration. Ticks go on while
//               anchor + n * interval is no more than
//               k("sim.tickEpsilon") past the end. When it is not running, it
//               starts fresh, as legacy does when the DoT has gone.
// A DoT is running while more than k("sim.tickEpsilon") is left before its
// end, as legacy keeps it in activeDots. See docs/mechanics.md "Planned:
// event-queue engine (Phase 3.5)".
//
// Damage, snapshots and stacks stay with the host (the activeDots entry).
//
// Pure: no DOM, no clock, no random numbers.

import { k } from "../../data/constants.js";
import { ORDER } from "./scheduler.js";

export const DOT_TICK_KIND = "dot-tick";

export const DOT_REFRESH = Object.freeze({
  restart: "restart",
  keepClock: "keep-clock",
});
const REFRESH_RULES = Object.freeze(Object.values(DOT_REFRESH));

function shown(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function checkId(id) {
  if (typeof id !== "string" || id === "") {
    throw new TypeError(
      `A DoT's id must be a non-empty string. Got ${shown(id)}.`,
    );
  }
}

export class DotTicks {
  #scheduler;
  #dots = new Map();

  constructor({ scheduler } = {}) {
    if (typeof scheduler?.schedule !== "function") {
      throw new TypeError("DotTicks needs the core's scheduler.");
    }
    this.#scheduler = scheduler;
  }

  // Apply the DoT `id` now: `interval` seconds between ticks, for `duration`
  // seconds, by the refresh rule `refresh` (DOT_REFRESH). Returns the pending
  // tick event, or null when no tick fits in the duration.
  apply(id, { interval, duration, refresh = DOT_REFRESH.restart } = {}) {
    checkId(id);
    // The legacy rule (#193): 0 or less would tick forever at one time, and
    // NaN or Infinity would never tick, silently. A string is refused too.
    if (!(
      typeof interval === "number" &&
      interval > 0 &&
      interval < Number.POSITIVE_INFINITY
    )) {
      throw new RangeError(
        `DoT "${id}" has tick interval ${shown(interval)}; it must be a finite number of seconds above 0.`,
      );
    }
    if (!(Number.isFinite(duration) && duration >= 0)) {
      throw new RangeError(
        `DoT "${id}" needs a duration in seconds, finite and 0 or more. Got ${shown(duration)}.`,
      );
    }
    if (!REFRESH_RULES.includes(refresh)) {
      throw new RangeError(
        `DoT "${id}": refresh must be one of ${REFRESH_RULES.join(", ")}. Got ${shown(refresh)}.`,
      );
    }
    const now = this.#scheduler.now;
    const running = this.#dots.get(id);
    if (refresh === DOT_REFRESH.keepClock && this.#isRunning(running)) {
      if (interval !== running.interval) {
        // The tick already counting down keeps its time; the new interval
        // counts from there.
        const next = this.#tickTime(running);
        running.anchor = next - interval;
        running.interval = interval;
        running.sinceAnchor = 0;
      }
      running.endsAt = now + duration;
      running.lastTick = null;
      // The pending tick stays (its place among ticks at one time too),
      // unless the new end comes before it, as legacy's entry would run out
      // first.
      if (running.event?.state !== "pending") {
        this.#scheduleNext(running);
      } else if (!this.#fits(running, running.event.time)) {
        running.event.cancel();
        running.event = null;
      }
      return running.event;
    }
    running?.event?.cancel();
    const dot = {
      payload: Object.freeze({ id }),
      anchor: now,
      interval,
      sinceAnchor: 0,
      ticks: 0,
      endsAt: now + duration,
      lastTick:
        refresh === DOT_REFRESH.restart
          ? Math.floor(duration / interval)
          : null,
      event: null,
    };
    this.#dots.set(id, dot);
    this.#scheduleNext(dot);
    return dot.event;
  }

  // Called by the host from a DoT's tick event, before it runs the tick body.
  // Schedules the next tick and returns { id, tick, last }: tick counts from 1
  // since the DoT was last applied fresh, and last is true when no tick
  // follows.
  ticked(event) {
    const id = event?.payload?.id;
    const dot = typeof id === "string" ? this.#dots.get(id) : undefined;
    if (
      dot === undefined ||
      dot.event !== event ||
      event.state !== "ran" ||
      event.time !== this.#scheduler.now
    ) {
      throw new Error(
        "ticked() is for a DoT's own pending tick event, from its handler.",
      );
    }
    dot.sinceAnchor += 1;
    dot.ticks += 1;
    this.#scheduleNext(dot);
    return Object.freeze({ id, tick: dot.ticks, last: dot.event === null });
  }

  // Stop the DoT now, with no more ticks.
  clear(id) {
    checkId(id);
    this.#dots.get(id)?.event?.cancel();
    this.#dots.delete(id);
  }

  running(id) {
    checkId(id);
    return this.#isRunning(this.#dots.get(id));
  }

  // The time it ends while running, else null.
  endsAt(id) {
    return this.running(id) ? this.#dots.get(id).endsAt : null;
  }

  // Seconds left while running, else 0.
  remaining(id) {
    return this.running(id)
      ? this.#dots.get(id).endsAt - this.#scheduler.now
      : 0;
  }

  // The time of the pending tick, or null when there is none.
  nextTickAt(id) {
    checkId(id);
    const event = this.#dots.get(id)?.event;
    return event?.state === "pending" ? event.time : null;
  }

  // Ticks since the DoT was last applied fresh (0 for one never applied).
  ticks(id) {
    checkId(id);
    return this.#dots.get(id)?.ticks ?? 0;
  }

  // The ids running now, in the order they were first applied fresh.
  get runningIds() {
    return [...this.#dots.keys()].filter((id) => this.running(id));
  }

  #isRunning(dot) {
    return (
      dot !== undefined &&
      dot.endsAt - this.#scheduler.now > k("sim.tickEpsilon")
    );
  }

  #tickTime(dot) {
    return dot.anchor + (dot.sinceAnchor + 1) * dot.interval;
  }

  // Whether the next tick, at `time`, is inside the DoT: by count for a
  // restart, by its end for a keep-clock DoT.
  #fits(dot, time) {
    return dot.lastTick === null
      ? time - dot.endsAt <= k("sim.tickEpsilon")
      : dot.sinceAnchor < dot.lastTick;
  }

  #scheduleNext(dot) {
    const time = this.#tickTime(dot);
    dot.event = this.#fits(dot, time)
      ? this.#scheduler.schedule({
          time,
          order: ORDER["dot-tick"],
          kind: DOT_TICK_KIND,
          payload: dot.payload,
        })
      : null;
  }
}
