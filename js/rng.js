import { k } from "../data/constants.js";

// Seeded random numbers for the engine. Only js/main.js may use a platform
// source, and then only to pick a seed. createRng returns a function that
// yields the next number in [0, 1), like the built-in generator, but a given
// seed always gives the same sequence. The generator is mulberry32: 32-bit
// integer maths only, so every Node version and browser agrees. Its terms are
// in rng.mulberry32.

// A seed is any integer. It wraps to an unsigned 32-bit value, so -1 and
// 4294967295 are the same seed.
export function normalizeSeed(seed) {
  if (!Number.isInteger(seed)) {
    throw new RangeError("RNG seed must be an integer.");
  }
  return seed >>> 0;
}

export function createRng(seed = k("rng.defaultSeed")) {
  const terms = k("rng.mulberry32");
  let state = normalizeSeed(seed);
  return function rng() {
    state = (state + terms.increment) | 0;
    let mixed = Math.imul(state ^ (state >>> terms.shiftA), 1 | state);
    mixed =
      (mixed +
        Math.imul(mixed ^ (mixed >>> terms.shiftB), terms.mixOr | mixed)) ^
      mixed;
    return ((mixed ^ (mixed >>> terms.shiftC)) >>> 0) / terms.range;
  };
}
