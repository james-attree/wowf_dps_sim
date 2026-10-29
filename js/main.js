import { k } from "../data/constants.js";
import { createConfigForm, pageDefaultConfig } from "./config-form.js";
import { createLiveRun } from "./live-run.js";
import { createStore } from "./store.js";
import { createConfigFormView } from "./views/config-form.js";
import { createControlsView } from "./views/controls.js";
import { createResultsView } from "./views/results.js";
import { createVisualiserView } from "./views/visualiser.js";

// The page's bootstrap (#149, #150, #153). It puts the config in the page's
// store (js/store.js), starts the live run (js/live-run.js: a SimRunner driven
// by animation frames, which fills the store's run state, results and what the
// visualiser draws), and hands the store to the views (js/views/). Each view
// owns its own part of the page and draws only from the store; none reaches
// into another's or into the engine. The controls call the live run's actions
// and never write the run state themselves. This file holds no combat or
// timing rules and draws nothing itself.
//
// The stats form (#151) edits the store's `config`, the one source of the
// rotation too (config.rotation; there is no separate rotation slice). Its
// edits apply to the next run; the fight on the page keeps the config it
// started with.
//
// A fresh seed on every page load for now. The header shows it, so a fight
// can be repeated with runFight({ seed, duration, config }). The fight is
// k("batch.duration") long (300 s, #153) and then shows as finished.
const config = pageDefaultConfig();
const seed = crypto.getRandomValues(new Uint32Array(1))[0];
const duration = k("batch.duration");

const store = createStore({
  config,
  run: { state: "idle", seed, duration },
  frame: 0,
  results: { time: 0, damage: 0 },
});

const live = createLiveRun(store, {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
});
// The page starts fighting at load, as it always has. The first frame only
// starts the frame clock.
live.run({ seed, duration, config });

createConfigFormView(document, store, createConfigForm(store));
createControlsView(document, store, live);
createVisualiserView(document, store);
createResultsView(document, store);
