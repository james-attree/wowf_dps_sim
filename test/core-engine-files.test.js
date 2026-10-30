import { Simulation } from "../js/simulation.js";

// Issue #197 (carried from #196, PR #229): the existing proc and poison test
// files pass on the new core. node --test runs each file in its own process,
// so this one sets the default engine to the event core and then loads the
// four files, whose fights (createFight, runFight, Simulation.run) all run on
// it. A test there that steps the fight by hand (Simulation.step) is a fixed
// step on either engine.
Simulation.useEngine("events");

await import("./procs.test.js");
await import("./poisons.test.js");
await import("./poison-procs.test.js");
await import("./assassination-procs-as-data.test.js");
