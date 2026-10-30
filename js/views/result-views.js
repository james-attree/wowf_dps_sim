import { blocked, grouped, isLocked, secondsText } from "./run-model.js";
import { ranClock, ranOf, staleBanner } from "./stale.js";

// The Results area's two kept views (#242, UX4; Fran's approved UX proposal
// §5): the average (a batch) and the live fight. A switch (#results/average,
// #results/live) shows one; each has its own label, says when it is out of
// date (js/views/stale.js) and has its own Run buttons. Running one never
// clears the other: the store keeps the batch in `batch` and the live fight
// in `results`, and `ran` holds what each ran with (js/run-actions.js).
//
// The average's numbers are js/views/results-panel.js's panel, which this
// view shows under the Average view and hides under the Live one. The live
// fight's totals, meters, effects and combat log are under the Live view
// (#245, UX7; js/views/visualiser.js and js/views/results.js draw them),
// shown once a fight has started; before that it says there is none yet.

export const VIEWS = Object.freeze(["average", "live"]);

// The route's view: Average unless the route says Live.
export const viewOf = (route) => (route?.sub === "live" ? "live" : "average");

const STATE_WORDS = Object.freeze({
  running: "running",
  paused: "paused",
  finished: "finished",
});

const ONE = 1;
const MAIN_BUTTON = 0;
const fightsWord = (count) => (count === ONE ? "fight" : "fights");

// "Average · 1,000 × 300 s fights · seed 42 · ran at 09:12 · partial".
function averageLabel(state) {
  const { batch } = state;
  if (batch.status === "running") {
    return "Average · running";
  }
  const record = ranOf(state, "batch");
  if (record === null) {
    return "Average · none yet";
  }
  const parts = [
    "Average",
    `${grouped(batch.result.completed)} × ${secondsText(record.duration)} s ${fightsWord(batch.result.completed)}`,
    `seed ${record.seed}`,
  ];
  const at = ranClock(record.at);
  if (at !== null) {
    parts.push(`ran at ${at}`);
  }
  if (batch.status === "cancelled") {
    parts.push("partial");
  }
  return parts.join(" · ");
}

// How the kept fight stands. In Batch mode the run slice is the batch's, so
// a kept fight that was not stopped finished (as the card reads it).
function liveWord(run) {
  if ((run.stoppedAt ?? null) !== null) {
    return "stopped";
  }
  return run.mode === "live" ? STATE_WORDS[run.state] : STATE_WORDS.finished;
}

// "Live fight · 300 s · seed 42 · ran at 09:05 · finished".
function liveLabel(state) {
  const record = ranOf(state, "live");
  if (record === null) {
    return "Live fight · none yet";
  }
  const parts = [
    "Live fight",
    `${secondsText(record.duration)} s`,
    `seed ${record.seed}`,
  ];
  const at = ranClock(record.at);
  if (at !== null) {
    parts.push(`ran at ${at}`);
  }
  const word = liveWord(state.run);
  if (word !== undefined) {
    parts.push(word);
  }
  return parts.join(" · ");
}

// What the two views show, as plain data (the tests walk it).
export function resultViewsModel(state) {
  const locked = isLocked(state.run);
  const liveRecord = ranOf(state, "live");
  const averageStale = staleBanner(state, "batch");
  const liveStale = staleBanner(state, "live");
  return {
    view: viewOf(state.route),
    locked,
    blocked: blocked(state),
    average: {
      label: averageLabel(state),
      stale: averageStale,
      run: averageStale === null ? "Run average" : "Run average again",
      watch: "Watch fight",
    },
    live: {
      label: liveLabel(state),
      stale: liveStale,
      run:
        liveStale !== null ||
        (liveRecord !== null && liveWord(state.run) === STATE_WORDS.finished)
          ? "Watch again"
          : "Watch fight",
      average: "Run an average",
      empty: liveRecord === null,
    },
  };
}

export function createResultViewsView(doc, store, actions) {
  const area = doc.querySelector("#area-results");
  if (area === null || doc.querySelector("#results-average") === null) {
    return () => {};
  }
  const panel = doc.querySelector("#results-panel");
  const views = {
    average: doc.querySelector("#results-average"),
    live: doc.querySelector("#results-live"),
  };
  const byId = (id) => doc.querySelector(`#${id}`);
  const links = ["result-view-average", "result-view-live"]
    .map(byId)
    .filter(Boolean);
  const primary = {
    average: byId("results-average-run"),
    live: byId("results-live-run"),
  };
  const buttons = [
    primary.average,
    byId("results-average-watch"),
    primary.live,
    byId("results-live-average"),
  ].filter(Boolean);

  const write = (node, text) => {
    if (node !== null && node.textContent !== text) {
      node.textContent = text;
    }
  };

  function drawBanner(node, banner) {
    node.hidden = banner === null;
    if (banner === null) {
      node.replaceChildren();
      return;
    }
    const title = doc.createElement("strong");
    title.className = "stale-banner-title";
    title.textContent = banner.title;
    const detail = doc.createElement("span");
    detail.className = "stale-banner-detail";
    detail.textContent = ` ${banner.detail}`;
    node.replaceChildren(title, detail);
  }

  let shown = null;
  function render(state) {
    const model = resultViewsModel(state);
    // Swap the views; a focus left in the hidden one goes to the shown one's
    // Run button rather than to the page.
    if (shown !== model.view) {
      const was = shown === null ? null : views[shown];
      const focused = was?.contains(doc.activeElement) ?? false;
      shown = model.view;
      for (const name of VIEWS) {
        views[name].hidden = name !== shown;
      }
      if (panel !== null) {
        panel.hidden = shown !== "average";
      }
      for (const link of links) {
        if (link.getAttribute("data-result-view") === shown) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      }
      if (focused) {
        primary[shown]?.focus();
      }
    }
    write(doc.querySelector("#results-average-label"), model.average.label);
    write(doc.querySelector("#results-live-label"), model.live.label);
    drawBanner(
      doc.querySelector("#results-average-stale"),
      model.average.stale,
    );
    drawBanner(doc.querySelector("#results-live-stale"), model.live.stale);
    write(primary.average, model.average.run);
    write(doc.querySelector("#results-average-watch"), model.average.watch);
    write(primary.live, model.live.run);
    write(doc.querySelector("#results-live-average"), model.live.average);
    const empty = doc.querySelector("#results-live-empty");
    const fight = doc.querySelector("#results-live-fight");
    if (empty !== null && fight !== null && fight.hidden !== model.live.empty) {
      // Reset hides the fight: a focus in it (the combat log) goes to Watch.
      const focused = fight.contains(doc.activeElement);
      empty.hidden = !model.live.empty;
      fight.hidden = model.live.empty;
      if (focused && model.live.empty) {
        primary.live?.focus();
      }
    }
    // aria-disabled, not disabled, while a run is going: the pressed button
    // keeps the focus (#253, Fran: a disabled button drops it to the page).
    for (const button of buttons) {
      button.setAttribute("aria-disabled", String(model.locked));
    }
  }

  // A press: the typed-in fields first (#247), then the blocked settings'
  // first one, as the Run bar does, or the run in that button's mode.
  area.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-run-as]");
    if (!button || button.getAttribute("aria-disabled") === "true") {
      return;
    }
    actions.commitEdits?.();
    if (blocked(store.get())) {
      doc.querySelector("#run-errors-link")?.click();
      return;
    }
    actions.runAs(button.getAttribute("data-run-as"));
  });
  // Only the main button presses (#253, Fran): a right or middle press on
  // one of these leaves the focus where it was.
  area.addEventListener("mousedown", (event) => {
    if (
      event.button !== MAIN_BUTTON &&
      event.target.closest?.("button[data-run-as]")
    ) {
      event.preventDefault();
    }
  });

  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (
      ["route", "run", "batch", "results", "ran", "config", "form"].some(
        (slice) => changed.includes(slice),
      )
    ) {
      render(state);
    }
  });
}
