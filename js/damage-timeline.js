import { k } from "../data/constants.js";
import { CompensatedSum } from "./running-stats.js";

// The damage timeline (Phase 3, #148, roadmap task S5): how much damage each
// second of a fight dealt, and the same over a batch, for the damage-over-time
// chart (js/charts.js). It has no DOM, reads no clock and draws no randomness.
//
// It is built from the event stream (docs/events.md), like the breakdown and
// the aura uptimes: the `hit` events, each with its `time` (fight seconds) and
// `damage`. It reads no engine state and names no step or frame, so it works on
// a SimRunner, a Simulation, a recorded array of events or the Phase 3.5
// engine. Subscribing it changes no fight.
//
// Buckets. A fight of `duration` seconds has a fixed number of buckets,
// ceil(duration / timeline.bucketSeconds) (300 for a 300 s fight), and a hit at
// time t adds its damage to bucket floor(t / bucketSeconds): bucket i holds the
// hits with i * bucketSeconds <= t < (i + 1) * bucketSeconds. A hit at exactly
// the end of the fight goes in the last bucket. A fight of no length has no
// bucket. A fight's array is a Float64Array; a batch's summary is plain arrays
// of numbers (the batch result is plain data but for result.dps), a few
// kilobytes whatever the iteration count.
//
// One fight: a FightTimeline({ duration }). attach(source) subscribes it to
// source.on("hit"); summary() reads it at any time. timelineFromEvents(events,
// { duration }) is the same for events already in hand.
//
// A batch: a BatchTimeline({ duration }). add(fightSummary) takes one fight's
// summary(), in iteration order, and summary() gives the mean damage of each
// bucket and the mean, lowest and highest cumulative damage at the end of each
// bucket over the fights added. Every sum is taken in iteration order, so the
// result does not depend on how the batch was sliced.
//
// The definitions and the shapes are in docs/charts.md.

function readDuration(duration, owner) {
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0
  ) {
    throw new RangeError(
      `${owner} needs a finite fight duration in seconds, 0 or more. Got ${duration}.`,
    );
  }
  return duration;
}

function readOptions(options, owner) {
  if (options === null || typeof options !== "object") {
    throw new TypeError(`${owner} needs an options object: { duration }.`);
  }
  for (const key of Object.keys(options)) {
    if (key !== "duration") {
      throw new RangeError(
        `${owner} has no option ${JSON.stringify(key)}. Options: duration.`,
      );
    }
  }
  return readDuration(options.duration, owner);
}

// The number of buckets of a fight of `duration` seconds.
export function timelineLength(duration) {
  readDuration(duration, "timelineLength");
  return Math.ceil(duration / k("timeline.bucketSeconds"));
}

// One fight's damage by second, read from its hit events.
//
//   const timeline = new FightTimeline({ duration: 300 });
//   const off = timeline.attach(runner); // before run(), so no hit is missed
//   ... the fight runs ...
//   timeline.summary();
export class FightTimeline {
  #duration;
  #damage;
  #total = 0;

  constructor(options) {
    this.#duration = readOptions(options, "FightTimeline");
    this.#damage = new Float64Array(timelineLength(this.#duration));
  }

  // Subscribe to the "hit" events of `source`. Returns the unsubscribe
  // function.
  attach(source) {
    return source.on("hit", (event) => this.observe(event));
  }

  // Read one event. Events other than "hit" are ignored, so a wildcard
  // subscription works too. A hit needs a time from 0 to the duration and a
  // damage of 0 or more.
  observe(event) {
    if (event === null || typeof event !== "object") {
      throw new TypeError(
        `A FightTimeline reads event objects. Got ${event === null ? "null" : typeof event}.`,
      );
    }
    if (event.type !== "hit") {
      return;
    }
    const { time, damage } = event;
    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      time < 0 ||
      time > this.#duration
    ) {
      throw new RangeError(
        `A hit needs a time from 0 to the fight duration (${this.#duration} s). Got ${time}.`,
      );
    }
    if (typeof damage !== "number" || !Number.isFinite(damage) || damage < 0) {
      throw new RangeError(
        `A hit needs a finite damage, 0 or more. Got ${damage}.`,
      );
    }
    if (this.#damage.length === 0) {
      throw new RangeError("A fight of no length has no bucket for a hit.");
    }
    const last = this.#damage.length - 1;
    const index = Math.min(
      Math.floor(time / k("timeline.bucketSeconds")),
      last,
    );
    this.#damage[index] += damage;
    // In event order, as the engine adds it, so it is the fight's own total.
    this.#total += damage;
  }

  // Plain data, fresh on every call:
  //
  //   bucketSeconds  timeline.bucketSeconds
  //   duration       the fight duration in seconds
  //   totalDamage    every hit's damage, added in event order: the fight's
  //                  totalDamage
  //   damage         Float64Array, one slot per bucket: the damage dealt in it
  summary() {
    return {
      bucketSeconds: k("timeline.bucketSeconds"),
      duration: this.#duration,
      totalDamage: this.#total,
      damage: this.#damage.slice(),
    };
  }
}

// The timeline of events already in hand (a recorded array, or any iterable):
// the same summary a FightTimeline attached to the fight gives.
export function timelineFromEvents(events, options) {
  const timeline = new FightTimeline(options);
  for (const event of events) {
    timeline.observe(event);
  }
  return timeline.summary();
}

// The damage timeline over a batch of fights of one duration. Fights are added
// in order and every sum is taken in that order.
export class BatchTimeline {
  #duration;
  #length;
  #fights = 0;
  // Per bucket: the summed damage (Neumaier's compensated sum, kept in two
  // arrays so a batch allocates nothing per fight), the summed cumulative
  // damage at the end of the bucket, and its lowest and highest.
  #sum;
  #sumError;
  #cumulativeSum;
  #cumulativeError;
  #cumulativeMin;
  #cumulativeMax;
  #totalDamage = new CompensatedSum();

  constructor(options) {
    this.#duration = readOptions(options, "BatchTimeline");
    this.#length = timelineLength(this.#duration);
    this.#sum = new Float64Array(this.#length);
    this.#sumError = new Float64Array(this.#length);
    this.#cumulativeSum = new Float64Array(this.#length);
    this.#cumulativeError = new Float64Array(this.#length);
    this.#cumulativeMin = new Float64Array(this.#length);
    this.#cumulativeMax = new Float64Array(this.#length);
  }

  get fights() {
    return this.#fights;
  }

  // Add one fight: a FightTimeline#summary() (or timelineFromEvents) of a fight
  // of this batch's duration.
  add(fight) {
    if (
      fight === null ||
      typeof fight !== "object" ||
      !(fight.damage instanceof Float64Array) ||
      !Number.isFinite(fight.totalDamage)
    ) {
      throw new TypeError(
        "BatchTimeline.add needs a fight's timeline (FightTimeline#summary()).",
      );
    }
    if (
      fight.duration !== this.#duration ||
      fight.bucketSeconds !== k("timeline.bucketSeconds") ||
      fight.damage.length !== this.#length
    ) {
      throw new RangeError(
        `BatchTimeline.add needs a fight of ${this.#duration} s in buckets of ${k("timeline.bucketSeconds")} s. Got ${fight.duration} s in buckets of ${fight.bucketSeconds} s.`,
      );
    }
    const first = this.#fights === 0;
    let cumulative = 0;
    for (let index = 0; index < this.#length; index += 1) {
      const damage = fight.damage[index];
      addCompensated(this.#sum, this.#sumError, index, damage);
      cumulative += damage;
      addCompensated(
        this.#cumulativeSum,
        this.#cumulativeError,
        index,
        cumulative,
      );
      if (first || cumulative < this.#cumulativeMin[index]) {
        this.#cumulativeMin[index] = cumulative;
      }
      if (first || cumulative > this.#cumulativeMax[index]) {
        this.#cumulativeMax[index] = cumulative;
      }
    }
    this.#totalDamage.add(fight.totalDamage);
    this.#fights += 1;
  }

  // Plain data, fresh on every call:
  //
  //   fights           fights added
  //   bucketSeconds    timeline.bucketSeconds
  //   duration         seconds per fight
  //   length           buckets per fight: ceil(duration / bucketSeconds)
  //   meanTotalDamage  the mean of the fights' totalDamage, null with no fight
  //   damage           array of numbers per bucket: the mean damage dealt in it
  //   cumulative       { mean, min, max }, arrays of numbers per bucket: the
  //                    damage dealt from the start to the end of the bucket,
  //                    its mean over the fights, and the lowest and highest
  //                    fight. The last mean equals meanTotalDamage within
  //                    rounding.
  //
  // With no fight, damage and cumulative are null.
  summary() {
    const fights = this.#fights;
    const base = {
      fights,
      bucketSeconds: k("timeline.bucketSeconds"),
      duration: this.#duration,
      length: this.#length,
    };
    if (fights === 0) {
      return { ...base, meanTotalDamage: null, damage: null, cumulative: null };
    }
    const damage = new Array(this.#length);
    const mean = new Array(this.#length);
    for (let index = 0; index < this.#length; index += 1) {
      damage[index] = (this.#sum[index] + this.#sumError[index]) / fights;
      mean[index] =
        (this.#cumulativeSum[index] + this.#cumulativeError[index]) / fights;
    }
    return {
      ...base,
      meanTotalDamage: this.#totalDamage.value / fights,
      damage,
      cumulative: {
        mean,
        min: Array.from(this.#cumulativeMin),
        max: Array.from(this.#cumulativeMax),
      },
    };
  }
}

// Neumaier's step (as CompensatedSum in js/running-stats.js) on one slot of a
// pair of arrays: sums[index] the running sum, errors[index] its error.
function addCompensated(sums, errors, index, value) {
  const sum = sums[index];
  const next = sum + value;
  if (Math.abs(sum) >= Math.abs(value)) {
    errors[index] += sum - next + value;
  } else {
    errors[index] += value - next + sum;
  }
  sums[index] = next;
}
