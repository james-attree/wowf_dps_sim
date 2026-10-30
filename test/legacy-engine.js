// Pins the test file that imports it to the legacy fixed-step engine, the
// default before #199 made the event core the default. node --test runs each
// file in its own process, so this changes only the file that imports it.
// The files that import it test legacy itself (its fixed steps, its frames,
// its rogue.rotation and castRotation hooks) and go with it in #200.
import { Simulation } from "../js/simulation.js";

Simulation.useEngine("legacy");
