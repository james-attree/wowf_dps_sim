// Expiry timers for the Phase 3.5 core (E4, #195): the GCD, cooldowns, aura
// expiries and Premeditation's point expiry. Not used by the legacy engine,
// which counts each of them down per step (Simulation.step, tickGcd,
// Resource.tick).
//
// A timer stores the absolute time it ends, start + duration, and keeps one
// event there (order class "expiry"). A restart replaces the event, so there
// is never more than one pending per timer. The event is at the exact time:
// a 20 s cooldown started at t has its event at t + 20, a 1 s GCD at t + 1.
// Reads compare with k("sim.tickEpsilon"), as legacy does: a timer is running
// while more than that is left, and ready (not running) from then on. See
// docs/mechanics.md "Planned: event-queue engine (Phase 3.5)".
//
// What happens at the event (an aura's onExpire hook, the points going) is
// the host's: it gets the event, of the timer's kind, with its payload.
// Stacks and charges stay with the host too.
//
// Pure: no DOM, no clock, no random numbers.

import { k } from "../../data/constants.js";
import { REFRESH_RULES } from "../auras.js";
import { ORDER } from "./scheduler.js";

export const TIMER_KINDS = Object.freeze({
  gcd: "gcd-end",
  cooldown: "cooldown-ready",
  aura: "aura-expire",
  points: "points-expire",
});

function checkScheduler(scheduler, who) {
  if (typeof scheduler?.schedule !== "function") {
    throw new TypeError(`${who} needs the core's scheduler.`);
  }
}

function checkKind(kind, who) {
  if (typeof kind !== "string" || kind === "") {
    throw new TypeError(`${who} needs a kind, a non-empty string.`);
  }
}

function checkDuration(duration, kind) {
  if (!(Number.isFinite(duration) && duration > 0)) {
    throw new RangeError(
      `A "${kind}" timer needs a duration in seconds, finite and above 0. Got ${typeof duration === "string" ? `"${duration}"` : String(duration)}.`,
    );
  }
}

// The new end of an aura that is already up and is applied again, from its
// definition's refresh rule (js/auras.js REFRESH_RULES), in absolute times:
//   refresh           now + duration
//   extend            endsAt + duration (what was left plus the new one)
//   replace-if-longer the later of endsAt and now + duration
export function refreshedEnd(rule, { endsAt, now, duration }) {
  if (!REFRESH_RULES.includes(rule)) {
    throw new RangeError(
      `refresh must be one of ${REFRESH_RULES.join(", ")}. Got ${String(rule)}.`,
    );
  }
  if (rule === "extend") {
    return endsAt + duration;
  }
  if (rule === "replace-if-longer") {
    return Math.max(endsAt, now + duration);
  }
  return now + duration;
}

// One timer: the GCD, or Premeditation's points.
export class Timer {
  #scheduler;
  #event = null;

  constructor({ scheduler, kind, payload = null } = {}) {
    checkScheduler(scheduler, "Timer");
    checkKind(kind, "Timer");
    this.#scheduler = scheduler;
    this.kind = kind;
    this.payload = payload;
  }

  // End `duration` seconds from now, replacing any end already set.
  start(duration) {
    checkDuration(duration, this.kind);
    return this.setEndsAt(this.#scheduler.now + duration);
  }

  // End at the absolute time `time` (a refresh), replacing any end already set.
  setEndsAt(time) {
    const event = this.#scheduler.schedule({
      time,
      order: ORDER.expiry,
      kind: this.kind,
      payload: this.payload,
    });
    this.#event?.cancel();
    this.#event = event;
    return event;
  }

  // Stop without an end event.
  clear() {
    this.#event?.cancel();
    this.#event = null;
  }

  // The time it ends, or null when it is not set or its event has run.
  get endsAt() {
    return this.#event?.state === "pending" ? this.#event.time : null;
  }

  get running() {
    const endsAt = this.endsAt;
    return (
      endsAt !== null && endsAt - this.#scheduler.now > k("sim.tickEpsilon")
    );
  }

  get ready() {
    return !this.running;
  }

  // Seconds left while running, else 0.
  get remaining() {
    return this.running ? this.endsAt - this.#scheduler.now : 0;
  }
}

// Timers by id: the cooldowns, or the auras. Each event's payload is { id }.
export class TimerSet {
  #scheduler;
  #timers = new Map();

  constructor({ scheduler, kind } = {}) {
    checkScheduler(scheduler, "TimerSet");
    checkKind(kind, "TimerSet");
    this.#scheduler = scheduler;
    this.kind = kind;
  }

  #timer(id) {
    let timer = this.#timers.get(id);
    if (timer === undefined) {
      if (typeof id !== "string" || id === "") {
        throw new TypeError(
          `A "${this.kind}" timer's id must be a non-empty string.`,
        );
      }
      timer = new Timer({
        scheduler: this.#scheduler,
        kind: this.kind,
        payload: Object.freeze({ id }),
      });
      this.#timers.set(id, timer);
    }
    return timer;
  }

  start(id, duration) {
    return this.#timer(id).start(duration);
  }

  setEndsAt(id, time) {
    return this.#timer(id).setEndsAt(time);
  }

  clear(id) {
    this.#timers.get(id)?.clear();
  }

  endsAt(id) {
    return this.#timers.get(id)?.endsAt ?? null;
  }

  running(id) {
    return this.#timers.get(id)?.running ?? false;
  }

  ready(id) {
    return !this.running(id);
  }

  remaining(id) {
    return this.#timers.get(id)?.remaining ?? 0;
  }

  // The ids running now, in the order they were first started.
  get runningIds() {
    return [...this.#timers.keys()].filter((id) => this.running(id));
  }
}

// The core's timers on one scheduler. Premeditation's timer carries the
// points it removes; the host starts it for k("premeditation.cpExpiry").
export function createTimers(scheduler) {
  return {
    gcd: new Timer({ scheduler, kind: TIMER_KINDS.gcd }),
    cooldowns: new TimerSet({ scheduler, kind: TIMER_KINDS.cooldown }),
    auras: new TimerSet({ scheduler, kind: TIMER_KINDS.aura }),
    premeditation: new Timer({
      scheduler,
      kind: TIMER_KINDS.points,
      payload: Object.freeze({
        resource: "comboPoints",
        amount: k("premeditation.cpRemovedOnExpiry"),
      }),
    }),
  };
}
