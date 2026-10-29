import { k } from "../data/constants.js";
import { BatchClient } from "./batch-client.js";
import { buildLabel, poisonName } from "./build-label.js";
import { createConfigForm, pageDefaultConfig } from "./config-form.js";
import { createLiveRun } from "./live-run.js";
import { createRunActions, emptyBatch } from "./run-actions.js";
import { createStore } from "./store.js";
import { createTalentTree } from "./talent-tree.js";
import { createConfigFormView } from "./views/config-form.js";
import { createControlsView } from "./views/controls.js";
import { createResultsView } from "./views/results.js";
import { createResultsPanelView } from "./views/results-panel.js";
import { createTalentTreeView } from "./views/talent-tree.js";
import { createVisualiserView } from "./views/visualiser.js";

// The page's bootstrap (#149, #150, #153). It puts the config in the page's
// store (js/store.js), makes the live run (js/live-run.js: a SimRunner driven
// by animation frames, which fills the store's run state, results and what the
// visualiser draws) and the batch client (js/batch-client.js: a Web Worker, or
// the page's own thread when it has none), and hands the store to the views
// (js/views/). Each view owns its own part of the page and draws only from the
// store; none reaches into another's or into the engine. The control bar calls
// the run actions (js/run-actions.js) and never writes the store itself. This
// file holds no combat or timing rules and draws nothing itself.
//
// The stats form (#151) edits the store's `config`, the one source of the
// rotation too (config.rotation; there is no separate rotation slice). Its
// edits apply to the next run: Run snapshots the config, and the fight or
// batch on the page keeps it.
//
// The page starts idle (#153), with an empty fight at 0:00 on the visualiser
// and a fresh seed in the bar, so a fight can be repeated with
// runFight({ seed, duration, config }). Fights are k("batch.duration") long
// (300 s) in both modes; a batch is k("fight.iterations") fights (1,000).
const config = pageDefaultConfig();
const drawSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const seed = drawSeed();
const duration = k("batch.duration");
const iterations = k("fight.iterations");
const client = new BatchClient();

const store = createStore({
  config,
  run: {
    mode: "live",
    state: "idle",
    seed,
    duration,
    iterations,
    fields: {
      duration: String(duration),
      iterations: String(iterations),
      seed: String(seed),
    },
    errors: {},
    stoppedAt: null,
    shown: false,
    snapshot: null,
  },
  batch: emptyBatch(client.mode),
  frame: 0,
  results: { time: 0, damage: 0 },
});

const live = createLiveRun(store, {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
});
live.clear({ seed, config });

const actions = createRunActions({
  store,
  live,
  client,
  drawSeed,
  now: () => performance.now(),
});
// The running batch's elapsed time between progress messages (#155): a
// once-a-second tick, only while a batch runs.
let ticking = null;
store.subscribe(({ state }) => {
  const running = state.batch.status === "running";
  if (running && ticking === null) {
    ticking = window.setInterval(() => actions.tick(), 1000);
  } else if (!running && ticking !== null) {
    window.clearInterval(ticking);
    ticking = null;
  }
});

createConfigFormView(document, store, createConfigForm(store));
createTalentTreeView(document, store, createTalentTree(store));
createControlsView(document, store, actions);
createVisualiserView(document, store);
createResultsView(document, store);
createResultsPanelView(document, store, { buildLabel, poisonName });
