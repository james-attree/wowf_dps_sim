import { toDom } from "../svg.js";
import {
  announcement,
  breakdownModel,
  breakdownTable,
  DEFAULT_SORT,
  nextSort,
  panelModel,
  RESULT_ID,
  sortMessage,
  timelineFigure,
} from "./results-render.js";

// The batch results panel (#154). It draws the store's batch slice (and the
// run slice's seed, fight length and config while a batch runs) with
// js/views/results-render.js, and owns four bits of view state:
//
// - the breakdown's sort, back to Damage, high to low, for each new result;
// - the timeline chart's mode (cumulative or per second), kept across
//   results like the form's own choices;
// - the live region (spec section 9): start, the 25/50/75% crossings, the
//   outcome;
// - aria-busy on the panel while a batch runs.
//
// The panel has no buttons of its own besides the sort buttons, the
// charts' Chart / Table switches (#242) and the timeline mode radios
// (decision 8)
// and never takes focus. `labels` = { buildLabel, poisonName } from
// js/build-label.js, handed in by js/main.js.
export function createResultsPanelView(doc, store, labels) {
  const panel = doc.querySelector("#results-panel");
  const title = doc.querySelector("#results-heading");
  const meta = doc.querySelector("#results-meta");
  const body = doc.querySelector("#results-body");
  const live = doc.querySelector("#results-announce");
  let sort = DEFAULT_SORT;
  let timelineMode = "cumulative";
  // Each chart's Chart / Table choice (#242), kept across results.
  const chartViews = { histogram: "chart", timeline: "chart" };
  let shownResult = null;
  let lastBatch = null;

  function render(state) {
    const result = state.batch.result;
    if (result !== shownResult) {
      shownResult = result;
      sort = DEFAULT_SORT;
    }
    const model = panelModel(state, {
      ...labels,
      sort,
      timelineMode,
      histogramView: chartViews.histogram,
      timelineView: chartViews.timeline,
    });
    title.textContent = model.title;
    meta.textContent = model.meta;
    meta.hidden = model.meta === "";
    if (model.busy) {
      panel.setAttribute("aria-busy", "true");
    } else {
      panel.removeAttribute("aria-busy");
    }
    body.replaceChildren(...model.body.map((node) => toDom(node, doc)));
    measureHints();
  }

  // The breakdown's scroll hint (#242): shown while the table is wider than
  // its box and not scrolled to its end.
  const SCROLL_SLACK = 1;
  function measureHint(wrap) {
    const region = wrap.querySelector(".table-scroll");
    if (!region || typeof region.scrollWidth !== "number") {
      return;
    }
    const more =
      region.scrollLeft + region.clientWidth <
      region.scrollWidth - SCROLL_SLACK;
    const overflow = region.scrollWidth > region.clientWidth + SCROLL_SLACK;
    wrap.setAttribute(
      "data-overflow",
      overflow ? (more ? "more" : "end") : "none",
    );
  }
  function measureHints() {
    for (const wrap of body.querySelectorAll?.("[data-scroll-hint]") ?? []) {
      measureHint(wrap);
    }
  }
  body.addEventListener(
    "scroll",
    (event) => {
      const wrap = event.target?.closest?.("[data-scroll-hint]");
      if (wrap) {
        measureHint(wrap);
      }
    },
    true,
  );
  const win = doc.defaultView;
  win?.addEventListener?.("resize", measureHints);
  if (typeof win?.ResizeObserver === "function") {
    new win.ResizeObserver(measureHints).observe(body);
  }

  // A chart's Chart / Table switch (#242) shows one and hides the other in
  // place, so the pressed button keeps focus.
  function chooseView(button) {
    const name = button.getAttribute("data-chart-view");
    const block = button.closest("[data-chart-block]");
    chartViews[name] = button.value;
    for (const other of block.querySelectorAll("button[data-chart-view]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    for (const part of block.querySelectorAll("[data-chart-part]")) {
      part.hidden = part.getAttribute("data-chart-part") !== button.value;
    }
  }

  // A sort swaps the breakdown table only, then puts focus back on the
  // pressed column's button and says the new order.
  body.addEventListener("click", (event) => {
    const view = event.target.closest?.("button[data-chart-view]");
    if (view && body.contains(view) && !view.closest("[inert]")) {
      chooseView(view);
      return;
    }
    const button = event.target.closest?.("button[data-sort]");
    const result = store.get().batch.result;
    if (!button || !result || !body.contains(button)) {
      return;
    }
    const region = button.closest("[data-breakdown]");
    if (region === null || region.closest("[inert]")) {
      return;
    }
    sort = nextSort(sort, button.getAttribute("data-sort"));
    region.replaceChildren(
      toDom(breakdownTable(breakdownModel(result), { sort }), doc),
    );
    region
      .querySelector(`button[data-sort="${sort.key}"]`)
      ?.focus({ preventScroll: true });
    const status = region
      .closest("[data-breakdown-section]")
      ?.querySelector("[data-sort-status]");
    if (status) {
      status.textContent = sortMessage(sort);
    }
  });

  // A timeline mode radio swaps that chart only, so the radio keeps focus.
  body.addEventListener("change", (event) => {
    const input = event.target;
    const result = store.get().batch.result;
    if (
      !result ||
      !input?.matches?.("input[data-timeline-mode]") ||
      input.closest("[inert]")
    ) {
      return;
    }
    const region = input
      .closest("[data-timeline-block]")
      ?.querySelector("[data-timeline]");
    if (!region) {
      return;
    }
    timelineMode = input.value;
    region.replaceChildren(
      toDom(timelineFigure(result, RESULT_ID, timelineMode), doc),
    );
  });

  function onChange({ state, changed }) {
    if (!changed.includes("batch") && !changed.includes("run")) {
      return;
    }
    // While a batch runs the run slice only matters for the meta line; a
    // field typed in the idle form must not redraw a finished result.
    if (changed.includes("batch") || state.batch.status === "running") {
      render(state);
    }
    if (changed.includes("batch")) {
      const message = announcement(lastBatch, state.batch);
      if (message !== null) {
        live.textContent = message;
      } else if (state.batch.status === "idle" && state.batch.result === null) {
        // Reset (#155, Fran's QA 10): nothing on the panel, so nothing stale
        // left in its live region either.
        live.textContent = "";
      }
      lastBatch = state.batch;
    }
  }

  lastBatch = store.get().batch;
  render(store.get());
  return store.subscribe(onChange);
}
