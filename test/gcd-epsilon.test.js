import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { k } from "../data/constants.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

// Issue #41. The GCD readiness check uses sim.tickEpsilon. A GCD armed on
// frame 0 of the 30 fps and 60 fps clocks overshoots and clamps to zero.
// Arming it on the third frame leaves a positive remainder within
// sim.tickEpsilon at 10, 30, 60, and 144 fps. 30 and 144 are the rates the
// swing-timer fight uses.
const FRAME_RATES = [10, 30, 60, 144];
const ARM_FRAME = 3;

function pinnedSim() {
  const rogue = new Rogue();
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  rogue.rotation = () => {};
  const sim = new Simulation(rogue, { rng: testRng });
  sim.lastFrameTime = 0;
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

  it("comes ready on the expected frame at 10, 30, 60, and 144 fps", () => {
    setRoll(0.5);

    for (const fps of FRAME_RATES) {
      const { rogue, sim } = pinnedSim();
      const frameMs = k("sim.msPerSecond") / fps;
      const countdownFrames = Math.round(k("gcd.duration") * fps);
      const readyFrame = ARM_FRAME + countdownFrames;

      for (let frame = 1; frame <= ARM_FRAME; frame += 1) {
        sim.update(frame * frameMs);
      }
      sim.setGcd();

      for (let frame = ARM_FRAME + 1; frame < readyFrame; frame += 1) {
        sim.update(frame * frameMs);
      }
      assert.ok(
        sim.gcd > k("sim.tickEpsilon"),
        `${fps} fps remainder ${sim.gcd} was already within tick epsilon`,
      );
      assert.equal(
        castHemorrhage(rogue, sim),
        null,
        `${fps} fps cast a frame early`,
      );

      sim.update(readyFrame * frameMs);
      assert.ok(
        sim.gcd > 0,
        `${fps} fps remainder was exact zero, so it did not exercise tick epsilon`,
      );
      assert.ok(
        sim.gcd <= k("sim.tickEpsilon"),
        `${fps} fps remainder ${sim.gcd} is outside tick epsilon`,
      );
      const cast = castHemorrhage(rogue, sim);
      assert.equal(cast?.landed, true, `${fps} fps was not ready`);
      assert.equal(sim.gcd, k("gcd.duration"), `${fps} fps`);
    }
  });
});
