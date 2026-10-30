import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";
import { quiet } from "./quiet.js";

// Issue #41. The GCD readiness check uses sim.tickEpsilon. (The frame-by-frame
// remainders at 10, 30, 60 and 144 fps were the fixed-step engine's, which
// counted the GCD down a frame at a time; it went in #234, tag
// legacy-engine-final. The event core ends the GCD at its own time.)

function pinnedSim() {
  const rogue = new Rogue();
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  quiet(rogue);
  const sim = new Simulation(rogue, { rng: testRng });
  assert.equal(sim.currentTime, 0);
  return { rogue, sim };
}

function castHemorrhage(rogue, sim) {
  return rogue.abilities.hemorrhage.cast(rogue, sim);
}

describe("GCD tick epsilon", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("counts the GCD as ready at sim.tickEpsilon and waits above it", () => {
    setRoll(0.5);
    const ready = pinnedSim();
    ready.sim.gcd = k("sim.tickEpsilon");
    const cast = castHemorrhage(ready.rogue, ready.sim);
    assert.equal(cast.landed, true);
    assert.equal(ready.sim.gcd, k("gcd.duration"));

    const waiting = pinnedSim();
    const above = k("sim.tickEpsilon") + k("sim.tickEpsilon");
    waiting.sim.gcd = above;
    assert.equal(castHemorrhage(waiting.rogue, waiting.sim), null);
    assert.equal(waiting.sim.gcd, above);
    assert.equal(waiting.rogue.energy, k("start.state").energy);
  });
});
