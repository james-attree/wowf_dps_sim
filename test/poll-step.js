// 1/64 s: the time step tests poll a fight at, or cut one into, when they
// want a fine, exact grid (a power of two, so adding it up is exact). It was
// the constant sim.fixedStep, the fixed-step engine's step, until #234 removed
// that engine; nothing in js/ uses a step now.
export const POLL_STEP = 1 / 64;
