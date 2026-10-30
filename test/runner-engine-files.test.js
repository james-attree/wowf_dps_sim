import { Simulation } from "../js/simulation.js";

// Issue #198: the runner, stream and live adapter's contract tests pass on
// the event core. node --test runs each file in its own process, so this one
// sets the default engine to the event core and then loads the files, whose
// fights (createFight, runFight, SimRunner, createLiveRun) all run on it, as
// test/core-engine-files.test.js does for the proc and poison files (#197).
// A test that holds only for legacy fixed steps is skipped on events, with a
// counterpart in test/runner-events.test.js.
Simulation.useEngine("events");

await import("./sim-runner.test.js");
await import("./event-stream.test.js");
await import("./live-run.test.js");
await import("./live-feed.test.js");
await import("./run-controls.test.js");
await import("./ability-breakdown.test.js");
