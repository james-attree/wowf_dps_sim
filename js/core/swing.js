// Weapon swings for the Phase 3.5 core (E4, #195). Not used by the legacy
// engine, which keeps Weapon.tick (js/weapon.js) and Rogue.rotation.
//
// One SwingTimer per hand keeps one pending swing event (kind SWING_KIND,
// order class "swing", payload { hand }). The host's handler resolves the
// swing and then calls swung(), which reads the interval and schedules the
// next one. That is the legacy haste rule: the interval is the weapon speed
// divided by the haste multiplier read when a swing happens
// (modifiers.resolve("haste", 1), as Rogue.rotation does), and a haste change
// between two swings does not move the one already counting down. Changing
// that rule is a non-goal of Phase 3.5.
//
// Times are anchored: while the interval stays the same, the n-th swing after
// the anchor is at anchor + n * interval, not the last swing plus a delta, so
// a constant-haste fight has every swing at exactly start + n * speed. When
// the interval changes at a swing, that swing's time is the new anchor. See
// docs/mechanics.md "Planned: event-queue engine (Phase 3.5)".
//
// Pure: no DOM, no clock, no random numbers.

import { ORDER } from "./scheduler.js";

export const SWING_KIND = "swing";

export class SwingTimer {
  #scheduler;
  #event = null;
  #anchor = 0;
  #interval = null;
  #count = 0;

  // `weapon` has a speed in seconds and a hand ("main" or "off"), as a legacy
  // Weapon; `modifiers` the rogue's ModifierPipeline (or anything with
  // resolve(kind, base)); `scheduler` the core's Scheduler.
  constructor({ weapon, modifiers, scheduler } = {}) {
    if (!(Number.isFinite(weapon?.speed) && weapon.speed > 0)) {
      throw new RangeError(
        `SwingTimer needs a weapon with a finite speed above 0. Got ${String(weapon?.speed)}.`,
      );
    }
    if (typeof modifiers?.resolve !== "function") {
      throw new TypeError("SwingTimer needs the rogue's modifier pipeline.");
    }
    if (typeof scheduler?.schedule !== "function") {
      throw new TypeError("SwingTimer needs the core's scheduler.");
    }
    this.weapon = weapon;
    this.hand = weapon.hand;
    this.modifiers = modifiers;
    this.#scheduler = scheduler;
    this.payload = Object.freeze({ hand: weapon.hand });
  }

  // The interval a swing now would start: speed / haste.
  get interval() {
    const haste = this.modifiers.resolve("haste", 1);
    const interval = this.weapon.speed / haste;
    if (!(interval > 0 && interval < Number.POSITIVE_INFINITY)) {
      throw new RangeError(
        `The ${String(this.hand)} hand's swing interval is ${interval} s (speed ${this.weapon.speed} s, haste ${String(haste)}); it must be a finite number of seconds above 0.`,
      );
    }
    return interval;
  }

  // Schedule the first swing at the absolute time `at` (now by default): the
  // main hand starts due, the off hand k("weapon.offHand").initialSwing later,
  // as in legacy.
  start(at = this.#scheduler.now) {
    if (this.#event !== null && this.#event.state === "pending") {
      throw new Error(
        `The ${String(this.hand)} hand is already swinging; stop() it first.`,
      );
    }
    // No interval yet, so the first swing is the anchor (in swung()).
    this.#interval = null;
    this.#event = this.#schedule(at);
    return this.#event;
  }

  stop() {
    this.#event?.cancel();
    this.#event = null;
  }

  // Called by the host from this hand's swing event, after it has resolved
  // the swing. Schedules the next swing and returns it.
  swung() {
    const event = this.#event;
    if (
      event === null ||
      event.state !== "ran" ||
      event.time !== this.#scheduler.now
    ) {
      throw new Error(
        `swung() is for the ${String(this.hand)} hand's swing event, from its handler.`,
      );
    }
    const interval = this.interval;
    if (interval === this.#interval) {
      this.#count += 1;
    } else {
      this.#anchor = event.time;
      this.#interval = interval;
      this.#count = 1;
    }
    this.#event = this.#schedule(this.#anchor + this.#count * interval);
    return this.#event;
  }

  #schedule(time) {
    return this.#scheduler.schedule({
      time,
      order: ORDER.swing,
      kind: SWING_KIND,
      payload: this.payload,
    });
  }

  // The time of the pending swing, or null when there is none.
  get nextSwingTime() {
    return this.#event?.state === "pending" ? this.#event.time : null;
  }

  // Seconds until the pending swing, as the legacy Weapon's swingTimer; null
  // when there is none.
  get swingTimer() {
    const next = this.nextSwingTime;
    return next === null ? null : next - this.#scheduler.now;
  }
}
