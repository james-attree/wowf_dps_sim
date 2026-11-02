import { BatchClient } from "./batch-client.js";
import {
  resolveInitialSetup,
  setupFromState,
  shareUrl,
  withoutLinkParam,
} from "./build-codec.js";
import { mountSavedSetup, readSavedSetup, storageOf } from "./saved-setup.js";
import { buildLabel, poisonName } from "./build-label.js";
import { createConfigForm } from "./config-form.js";
import { createLiveRun } from "./live-run.js";
import { createPresetBuild } from "./preset-build.js";
import { createRotationBuilder } from "./rotation-builder.js";
import { createRunActions, emptyBatch, emptyRan } from "./run-actions.js";
import { createStore } from "./store.js";
import { createTalentTree } from "./talent-tree.js";
import { trackChromeSize } from "./views/chrome-size.js";
import { createCharacterScreensView } from "./views/character-screens.js";
import { createConfigFormView } from "./views/config-form.js";
import { createControlsView } from "./views/controls.js";
import { keepFocusInView } from "./views/focus-in-view.js";
import { createPresetBuildView } from "./views/preset-build.js";
import { createResultsView } from "./views/results.js";
import { createResultsCardView } from "./views/results-card.js";
import { createResultsPanelView } from "./views/results-panel.js";
import { createResultViewsView } from "./views/result-views.js";
import { createShareLinkView } from "./views/share-link.js";
import { createRotationBuilderView } from "./views/rotation-builder.js";
import { mountRouter } from "./views/router.js";
import { PAGE_SECTIONS, createSections } from "./views/sections.js";
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
// and a fresh seed in the bar, set to run an average (#242, UX4: the quick
// answer is Run's first job; "Watch fight" is the second), so a fight can be repeated with
// runFight({ seed, duration, config }). Fights are k("batch.duration") long
// (300 s) in both modes; a batch is k("fight.iterations") fights (1,000).
//
// The first build (#284) is js/build-codec.js's resolveInitialSetup: a share
// link (?s=) in the address, else the saved setup (#296, js/saved-setup.js:
// localStorage, read leniently), else the page defaults. Both are read before
// the first render, so the defaults never flash. A link is then taken out of
// the address, so a reload does not load it again, and becomes the save.
// (A stand-in page in the tests may have no window, address or history.)
const win = typeof window === "undefined" ? undefined : window;
const { history, location } = win ?? {};
const storage = storageOf(win);
const initial = resolveInitialSetup({
  search: location?.search ?? "",
  saved: readSavedSetup(storage),
});
if (initial.hadLink) {
  history?.replaceState(history.state, "", withoutLinkParam(location.href));
}
const { config } = initial.setup;
const drawSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const seed = initial.setup.run.seed ?? drawSeed();
const { mode, duration, iterations } = initial.setup.run;
const client = new BatchClient();

const store = createStore({
  config,
  run: {
    mode,
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
  ran: emptyRan(),
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
  stamp: () => Date.now(),
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

const formActions = createConfigForm(store);
// The saved setup (#296): saved on change, a link opened on load saved at
// once, the inputs redrawn from the store on pageshow (back/forward), and the
// stats form's Reset to defaults (formActions.reset, wrapped here before
// anything else takes it) clearing the save too.
mountSavedSetup(win, store, { initial, storage, form: formActions });
// The rotation builder (U7, #217) edits a draft through the form's actions;
// the Run bar's "Fix" link opens it at the first rotation error.
const builder = createRotationBuilder(store, formActions);
// The preset's reference build under the Rotation select (#273).
const presetBuild = createPresetBuild(store, formActions);
// The page's four areas (#239): each section is one of today's views, drawn
// into its area's shell in index.html. js/views/sections.js holds their
// status (what each adds to Run's blocked count); js/views/router.js shows
// one area at a time and draws the nav. The router subscribes before the
// views, so an area is shown before a view moves the focus into it.
const renders = {
  setup: () => createConfigFormView(document, store, formActions),
  talents: () => {
    const tree = createTalentTree(store);
    createTalentTreeView(document, store, tree);
    createCharacterScreensView(document, store, { setOpen: tree.setOpen });
  },
  rotation: () => {
    createRotationBuilderView(document, store, builder);
    createPresetBuildView(document, store, presetBuild);
    // The Run bar is outside the areas: it stays on every screen. It is
    // mounted here to keep the views' order (their store subscriptions) as
    // it was before #239. Run checks the form's typed-in fields first (#247).
    createControlsView(document, store, {
      ...actions,
      fixRotation: builder.jumpToFirstError,
      commitEdits: formActions.commitEdits,
    });
  },
  fight: () => {
    createVisualiserView(document, store);
    createResultsView(document, store);
  },
  results: () => {
    // The Results area's two kept views, Average and Live fight (#242).
    createResultViewsView(document, store, {
      ...actions,
      commitEdits: formActions.commitEdits,
    });
    createResultsPanelView(document, store, { buildLabel, poisonName });
  },
};
const sections = createSections();
for (const section of PAGE_SECTIONS) {
  sections.registerSection({
    ...section,
    render: () => {
      renders[section.id]();
      return () => {};
    },
  });
}
const router = mountRouter(document, store, sections, {
  panels: {
    rotation: {
      isOpen: (state) => state.rotationBuilder?.view?.open === true,
      toggle: () => builder.toggle(),
    },
  },
});
router.start();
// "Copy link to this build" and the opened link's banner (#284).
createShareLinkView(document, store, {
  linkOf: () => shareUrl(location.href, setupFromState(store.get())),
  notice: initial.notice,
});
trackChromeSize(document);
keepFocusInView(document);
// The desktop results column's summary card (#241): outside the areas, like
// the Run panel above it, so it shows on every area but Results.
createResultsCardView(document, store, { buildLabel });
