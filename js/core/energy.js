// Continuous energy for the Phase 3.5 core (E4, #194). Not used by the legacy
// engine, which keeps js/resource.js and Simulation.regenerateResource.
//
// The pool stores (value0, t0, rate, cap) and reads as
//   min(cap, value0 + rate * (now - t0))
// with `now` the scheduler's. Nothing is added per step. A gain, a spend, or a
// change of rate or cap first re-bases (value0 = the value now, t0 = now), so
// each piece of the line starts where the last one ended. The rate is the
// definition's base through the regen modifiers and the cap the base cap
// through the resourceMax modifiers, both read from the same ModifierPipeline
// as legacy. They change only at events (an aura applying or expiring), and
// the host says so by calling modifiersChanged() from that event. When neither
// moved there is no re-base, so a fight with no modifier reads exactly
// min(cap, e0 + rate * t). See docs/mechanics.md "Planned: event-queue engine
// (Phase 3.5)".
//
// The pool also keeps one threshold wake-up: wakeAt(amount) schedules a
// one-shot event (kind WAKE_KIND, order class "energy") at the time the value
// first reaches the amount, and every re-base moves it. The rotation (E6)
// says which amount: the cheapest cost it can use.
//
// Pure: no DOM, no clock, no random numbers.

import { k } from "../../data/constants.js";
import { checkAmount, startValue } from "../resource.js";
import { ORDER } from "./scheduler.js";

// The kind of the threshold event. Its payload is { resource, amount }.
export const WAKE_KIND = "resource-threshold";

const TICK_MODES = Object.freeze(["continuous"]);

function checkRate(id, rate) {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError(
      `Resource "${id}" has a regen rate of ${String(rate)}; it must be a finite number, 0 or more.`,
    );
  }
  return rate;
}

// The next double up from a time of 0 or more, or a little past it: never the
// same time, at most about two units in the last place more.
function nudgeUp(time) {
  return time + Math.max(time * Number.EPSILON, Number.MIN_VALUE);
}

export class EnergyPool {
  #scheduler;
  #value0;
  #t0;
  #rate;
  #cap;
  #wakeAmount = null;
  #wake = null;

  // `definition` is a row of js/resource-data.js with a regen rule;
  // `modifiers` the rogue's ModifierPipeline (or anything with resolve(kind,
  // base, context)); `scheduler` the core's Scheduler, whose now is the
  // pool's clock and which runs the threshold event.
  constructor({ definition, modifiers, scheduler } = {}) {
    if (definition?.regen === undefined) {
      throw new RangeError(
        `EnergyPool needs a resource definition with a regen rule. "${String(definition?.id)}" has none.`,
      );
    }
    if (!TICK_MODES.includes(k(definition.regen.tick))) {
      throw new RangeError(
        `Resource "${definition.id}" has an unsupported regen tick mode. Known: ${TICK_MODES.join(", ")}.`,
      );
    }
    if (typeof scheduler?.schedule !== "function") {
      throw new TypeError("EnergyPool needs the core's scheduler.");
    }
    this.definition = definition;
    this.id = definition.id;
    this.modifiers = modifiers;
    this.maxContext = Object.freeze({ resource: definition.id });
    // The cap and the rate before modifiers.
    this.baseMax = k(definition.max);
    this.baseRate = k(definition.regen.perSecond);
    this.#scheduler = scheduler;
    this.#rate = this.#readRate();
    this.#cap = this.#readCap();
    this.#value0 = Math.min(startValue(definition.start), this.#cap);
    this.#t0 = scheduler.now;
    // As on the legacy Resource: onChange(change, before, source) after a
    // gain or a spend that moved the value. Regeneration is not reported.
    this.onChange = null;
  }

  #readRate() {
    return checkRate(
      this.id,
      this.modifiers.resolve(this.definition.regen.modifier, this.baseRate),
    );
  }

  #readCap() {
    return this.modifiers.resolve("resourceMax", this.baseMax, this.maxContext);
  }

  #valueAt(time) {
    return Math.min(this.#cap, this.#value0 + this.#rate * (time - this.#t0));
  }

  // The stored line, for tests: { value0, t0, rate, cap }.
  get line() {
    return {
      value0: this.#value0,
      t0: this.#t0,
      rate: this.#rate,
      cap: this.#cap,
    };
  }

  get value() {
    return this.#valueAt(this.#scheduler.now);
  }

  get max() {
    return this.#cap;
  }

  get rate() {
    return this.#rate;
  }

  has(amount) {
    return this.value >= amount;
  }

  // Start a new piece of the line at now from `value0`, and move the wake-up.
  #rebase(value0) {
    this.#value0 = value0;
    this.#t0 = this.#scheduler.now;
    this.#placeWake();
  }

  #report(change, before, source) {
    if (this.onChange !== null && this.value !== before) {
      this.onChange(change, before, source);
    }
  }

  // Add up to the cap and return how much was added.
  gain(amount, source = null) {
    checkAmount(this.definition, "gain", amount);
    const before = this.value;
    const after = Math.min(before + amount, this.#cap);
    this.#rebase(after);
    this.#report("gain", before, source);
    return after - before;
  }

  // Take `amount` away. The caller has checked has(amount).
  spend(amount, source = null) {
    checkAmount(this.definition, "spend", amount);
    const before = this.value;
    this.#rebase(before - amount);
    this.#report("spend", before, source);
    return amount;
  }

  // Spend everything and return how much that was.
  spendAll(source = null) {
    const spent = this.value;
    this.#rebase(0);
    this.#report("spend", spent, source);
    return spent;
  }

  // The host calls this from the event where a modifier of the rate or the cap
  // applied or ran out. The pool re-reads both and re-bases at now if either
  // moved: the value so far is on the old line, the rest on the new one, and a
  // value above a cap that fell is brought down to it. Returns whether
  // anything moved.
  modifiersChanged() {
    const rate = this.#readRate();
    const cap = this.#readCap();
    if (rate === this.#rate && cap === this.#cap) {
      return false;
    }
    const value = this.value;
    this.#rate = rate;
    this.#cap = cap;
    this.#rebase(Math.min(value, cap));
    return true;
  }

  // Wake the host when the value reaches `amount`: one event of kind
  // WAKE_KIND at the first time value >= amount (at now if it already is).
  // One threshold at a time; a second call replaces the first. While the
  // amount cannot be reached (rate 0, or above the cap) no event is
  // scheduled, and a re-base that makes it reachable schedules it. The event
  // is one-shot. Returns the event, or null when none is scheduled.
  wakeAt(amount) {
    checkAmount(this.definition, "wake at", amount);
    // Drop a wake that has run first: #placeWake drops a ran wake with its
    // amount, so without this a re-arm right after one would be lost (#225).
    this.#dropRanWake();
    this.#wakeAmount = amount;
    this.#placeWake();
    return this.#wake;
  }

  cancelWake() {
    this.#wakeAmount = null;
    this.#placeWake();
  }

  // The threshold waited for and the time of its event, for the host and
  // tests: null when there is none (never set, cancelled, or already run).
  get wakeAmount() {
    this.#dropRanWake();
    return this.#wakeAmount;
  }

  get wakeTime() {
    this.#dropRanWake();
    return this.#wake === null ? null : this.#wake.time;
  }

  #dropRanWake() {
    if (this.#wake !== null && this.#wake.state === "ran") {
      this.#wake = null;
      this.#wakeAmount = null;
    }
  }

  #placeWake() {
    this.#dropRanWake();
    if (this.#wake !== null) {
      this.#wake.cancel();
      this.#wake = null;
    }
    if (this.#wakeAmount === null) {
      return;
    }
    const time = this.#reachTime(this.#wakeAmount);
    if (time === null) {
      return;
    }
    this.#wake = this.#scheduler.schedule({
      time,
      order: ORDER.energy,
      kind: WAKE_KIND,
      payload: Object.freeze({ resource: this.id, amount: this.#wakeAmount }),
    });
  }

  // The first time the line reaches `amount`, or null if it never does. The
  // division can land a hair early, so the time is nudged up until the value
  // there is at least the amount: the handler always finds it.
  #reachTime(amount) {
    const now = this.#scheduler.now;
    if (this.#valueAt(now) >= amount) {
      return now;
    }
    if (this.#rate === 0 || amount > this.#cap) {
      return null;
    }
    let time = Math.max(now, this.#t0 + (amount - this.#value0) / this.#rate);
    while (this.#valueAt(time) < amount) {
      time = nudgeUp(time);
    }
    return time;
  }
}
