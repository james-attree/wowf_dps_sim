import { k } from "../data/constants.js";

// Running statistics for the batch (Phase 3, #144 and #145). No DOM, no clock,
// no randomness. They live in their own module so the batch runner and the
// per-ability breakdown (js/ability-breakdown.js) both use them without
// importing each other. js/batch-runner.js re-exports RunningStats.

// Welford's online mean and variance, with minimum and maximum. add(value)
// takes a finite number. summary() is plain data:
//
//   count    values added
//   mean     the mean, null with no values
//   stdDev   the sample standard deviation (n - 1), null with fewer than two
//   min, max the extremes, null with no values
//   ci95     { low, high, halfWidth }: the 95% confidence interval of the
//            mean, mean +- batch.confidenceZ * stdDev / sqrt(count). null with
//            fewer than two values, where it is not defined.
export class RunningStats {
  #count = 0;
  #mean = 0;
  #sumSquares = 0;
  #min = 0;
  #max = 0;

  get count() {
    return this.#count;
  }

  // The mean so far, or null with no values.
  get mean() {
    return this.#count === 0 ? null : this.#mean;
  }

  add(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(
        `RunningStats.add needs a finite number. Got ${value}.`,
      );
    }
    this.#count += 1;
    const delta = value - this.#mean;
    this.#mean += delta / this.#count;
    this.#sumSquares += delta * (value - this.#mean);
    if (this.#count === 1 || value < this.#min) {
      this.#min = value;
    }
    if (this.#count === 1 || value > this.#max) {
      this.#max = value;
    }
  }

  summary() {
    const count = this.#count;
    if (count === 0) {
      return {
        count,
        mean: null,
        stdDev: null,
        min: null,
        max: null,
        ci95: null,
      };
    }
    if (count === 1) {
      return {
        count,
        mean: this.#mean,
        stdDev: null,
        min: this.#min,
        max: this.#max,
        ci95: null,
      };
    }
    const stdDev = Math.sqrt(this.#sumSquares / (count - 1));
    const halfWidth = (k("batch.confidenceZ") * stdDev) / Math.sqrt(count);
    return {
      count,
      mean: this.#mean,
      stdDev,
      min: this.#min,
      max: this.#max,
      ci95: {
        low: this.#mean - halfWidth,
        high: this.#mean + halfWidth,
        halfWidth,
      },
    };
  }
}

// A running sum that keeps its accuracy (Neumaier's compensated summation): the
// rounding error of each addition is carried along and put back at the end, so
// summing thousands of damage numbers does not drift. add(value) takes a
// finite number; `value` is the sum so far. Values are added in the order given,
// so the same values in the same order always give the same sum.
export class CompensatedSum {
  #sum = 0;
  #error = 0;

  add(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(
        `CompensatedSum.add needs a finite number. Got ${value}.`,
      );
    }
    const next = this.#sum + value;
    if (Math.abs(this.#sum) >= Math.abs(value)) {
      this.#error += this.#sum - next + value;
    } else {
      this.#error += value - next + this.#sum;
    }
    this.#sum = next;
  }

  get value() {
    return this.#sum + this.#error;
  }
}
