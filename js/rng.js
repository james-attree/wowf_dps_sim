import { k } from "../data/constants.js";

// Seeded random numbers for the engine. Only js/main.js may use a platform
// source, and then only to pick a seed. createRng returns a function that
// yields the next number in [0, 1), like the built-in generator, but a given
// seed always gives the same sequence. The generator is mulberry32: 32-bit
// integer maths only, so every Node version and browser agrees. Its terms are
// in rng.mulberry32.

// A seed is any integer. It wraps to an unsigned 32-bit value, so -1 and
// 4294967295 are the same seed. This is the one seed check: SimRunner,
// runFight, createFight, runBatch, BatchRunner, deriveSeed and Simulation all
// call it, so they all throw the same RangeError for a bad seed (#187):
//   A seed must be an integer; got <value>.
// where <value> is describeSeed(seed).
export function normalizeSeed(seed) {
  if (!Number.isInteger(seed)) {
    throw new RangeError(
      `A seed must be an integer; got ${describeSeed(seed)}.`,
    );
  }
  return seed >>> 0;
}

// The bad value as the seed error shows it. A string is quoted, so the seed
// "7" reads differently from the number 7. A bigint keeps its n suffix.
// Numbers, booleans, undefined and null read as they print ("NaN", "1.5",
// "null"). An object or a function is named by its kind, not dumped. A string
// longer than k("rng.seedTextLimit") characters is cut and ends in "...".
export function describeSeed(value) {
  if (typeof value === "string") {
    const limit = k("rng.seedTextLimit");
    const text = value.length > limit ? `${value.slice(0, limit)}...` : value;
    return JSON.stringify(text);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "function") {
    return "a function";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (value !== null && typeof value === "object") {
    return "an object";
  }
  return String(value);
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
