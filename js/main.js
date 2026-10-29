import { k } from "../data/constants.js";
import { createFight } from "./fight.js";
import { FrameClock } from "./frame-clock.js";
import { createLiveFeed } from "./live-feed.js";
import { defaultConfig } from "./sim-config.js";
import { createStore } from "./store.js";
import { createControlsView } from "./views/controls.js";
import { createResultsView } from "./views/results.js";
import { createVisualiserView } from "./views/visualiser.js";

// The page's bootstrap (#149, #150). It builds the fight, puts its config and
// what the live feed reads of it (js/live-feed.js: the event stream, and the
// continuous values at each frame) in the store (js/store.js), hands the store
// to the views (js/views/), and turns animation frames into engine steps
// (FrameClock). Each view owns its own part of the page and draws only from
// the store; none reaches into another's or into the engine. This file holds
// no combat or timing rules and draws nothing itself.
// A fresh seed on every page load for now. The header shows it, so a fight
// can be repeated with runFight({ seed, duration }).
const fight = createFight(
  crypto.getRandomValues(new Uint32Array(1))[0],
  defaultConfig(),
);
const { simulation } = fight;
const feed = createLiveFeed(fight);
const frameClock = new FrameClock();
const fixedStep = k("sim.fixedStep");
let animationFrameId;

const resultsOf = () => ({
  time: simulation.currentTime,
  damage: simulation.damageDone,
});

const store = createStore({
  config: fight.config,
  rotation: fight.config.rotation,
  run: { state: "running", seed: fight.seed },
  frame: 0,
  results: resultsOf(),
  ...feed.read(),
});

createControlsView(document, store);
createVisualiserView(document, store);
createResultsView(document, store);

function update(time) {
  if (store.get().run.state !== "running") {
    return;
  }

  // The frame timestamp becomes a whole number of fixed steps, at most
  // k("sim.maxFrameTime") worth. The engine only ever sees the fixed step.
  const steps = frameClock.steps(time);
  for (let index = 0; index < steps; index++) {
    simulation.step(fixedStep);
  }

  store.update(({ frame }) => ({
    frame: frame + 1,
    results: resultsOf(),
    ...feed.read(),
  }));

  animationFrameId = requestAnimationFrame(update);
}

// Pause and resume come from the controls view through the run slice.
store.subscribe(({ state, changed }) => {
  if (!changed.includes("run")) {
    return;
  }
  if (state.run.state !== "running") {
    cancelAnimationFrame(animationFrameId);
    return;
  }
  // The next frame takes no steps, so the time spent paused is not simulated.
  frameClock.restart();
  animationFrameId = requestAnimationFrame(update);
});

animationFrameId = requestAnimationFrame(update);
