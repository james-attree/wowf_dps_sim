// A scripted rng for tests that need a fixed roll. Pass testRng to a
// Simulation and call setRoll(value) with a number in [0, 1) to choose what
// every draw returns. Nothing in js/ calls Math.random.
let current = 0.5;

export function setRoll(value) {
  current = value;
}

export function testRng() {
  return current;
}
