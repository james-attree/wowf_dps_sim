import { el, toDom, toMarkup } from "../svg.js";
import { breakdownModel, num, pct } from "./results-render.js";
import { clock, staleFixTitle } from "./run-model.js";
import { formatNumber } from "../charts.js";
import { isStale, staleBanner } from "./stale.js";

// The desktop results column's summary card (#241, UX3; proposal sections 3
// and 5). From 1024px up the page has a column beside the areas: the Run
// panel, then this card. It always shows the batch's average (or why there is
// none yet) and a line for the live fight, each with a link to where the full
// figures are (index.html's own links: js/svg.js draws no links). Below 1024px it is not shown (styles.css): the phone dock
// carries the DPS there. The card never takes focus and has no live region of
// its own; the Run panel and the results panel already speak.
//
// `cardModel` is pure and returns js/svg.js nodes; `labels` =
// { buildLabel } from js/build-label.js, handed in by js/main.js.

const count = (value) => formatNumber(value, 0);
const fights = (n) => `${count(n)} ${n === 1 ? "fight" : "fights"}`;

// No fight finished yet.
const NO_FIGHTS = 0;

// The previous average's heading: one card, so one id.
const PREVIOUS_TITLE = "results-card-previous-title";

const line = (cls, children) => el("p", { class: cls }, children);

// The average: a finished or stopped batch's mean with its 95% interval, the
// fights, the build, the damage per fight and the ability that did most.

function average(result, buildLabel) {
  const summary = result.summary;
  const ci = summary.ci95;
  const model = breakdownModel(result);
  const top = model.damageRows[0] ?? null;
  const partial = result.cancelled;
  // Stopped early: how many of the fights asked for ran, "486 of 4,000
  // fights" (Fran's #253 check, N2), as the Results panel says it.
  const ran = partial
    ? `${count(result.completed)} of ${fights(result.iterations)}`
    : fights(result.completed);
  return [
    line("results-card-dps", [
      num(summary.mean),
      el("span", { class: "results-card-unit" }, ["DPS"]),
      partial && el("span", { class: "badge badge-partial" }, ["PARTIAL"]),
    ]),
    line("results-card-ci", [
      ci
        ? `± ${num(ci.halfWidth)} (95% CI)`
        : "One fight: no confidence interval",
    ]),
    line("results-card-meta", [
      `${ran} × ${count(result.duration)} s · seed ${result.seed}`,
    ]),
    line("results-card-meta", [buildLabel(result.config)]),
    el("dl", { class: "results-card-facts" }, [
      el("dt", {}, ["Damage per fight"]),
      el("dd", {}, [count(model.totalPerFight)]),
      top && el("dt", {}, ["Top ability"]),
      top && el("dd", {}, [`${top.name} · ${pct(top.share)}`]),
    ]),
  ];
}

// Mid-run (#242, UX4; Fran's #253 N7): the progress and the running
// average, then the average kept from before, marked as the previous one
// and greyed until the new one replaces it. A first batch has none.
function runningPart(batch, run, buildLabel) {
  const total = batch.progress?.total ?? run.iterations;
  const completed = batch.progress?.completed ?? NO_FIGHTS;
  const mean = batch.progress?.mean ?? null;
  const previous = batch.previous ?? null;
  const kept = previous !== null && previous.completed > NO_FIGHTS;
  return [
    line("results-card-status", [
      `Running batch · ${count(completed)} of ${fights(total)}`,
    ]),
    completed > NO_FIGHTS &&
      mean !== null &&
      line("results-card-running", [`Running average ${num(mean)} DPS`]),
    // A group named by its heading, so its figures are not read as the
    // running batch's (#245, Fran's #254 check).
    kept &&
      el(
        "div",
        {
          class: "results-card-previous",
          role: "group",
          "aria-labelledby": PREVIOUS_TITLE,
        },
        [
          el(
            "h3",
            { id: PREVIOUS_TITLE, class: "results-card-previous-title" },
            ["Previous average"],
          ),
          ...average(previous, buildLabel),
        ],
      ),
  ];
}

// The average's out-of-date line (#242): the card's version of the Results
// banner, over the average it is about.
function staleLine(state) {
  const banner = staleBanner(state, "batch", staleFixTitle(state));
  return (
    banner !== null &&
    el("div", { class: "results-card-stale" }, [
      el("strong", {}, [banner.title]),
      " ",
      banner.short,
    ])
  );
}

function batchPart(batch, run, buildLabel) {
  const result = batch.result;
  if (batch.status === "running") {
    return runningPart(batch, run, buildLabel);
  }
  if ((batch.status === "done" || batch.status === "cancelled") && result) {
    if (result.completed === 0) {
      return [
        line("results-card-status", [
          "Stopped before the first fight finished: no average.",
        ]),
      ];
    }
    return average(result, buildLabel);
  }
  if (batch.status === "error") {
    return [line("results-card-status", ["The batch failed."])];
  }
  return [
    line("results-card-status", [
      "No average yet. Choose Batch above, then Run batch.",
    ]),
  ];
}

// The live fight's line: its DPS while it runs, is paused or has finished;
// where it stopped; or that none has run. In Batch mode the run slice's
// state is the batch's, so a live fight kept from before (one with time on
// it that was not stopped) is a finished one: nothing runs while paused.
export function liveText({ run, results }) {
  const time = results?.time ?? 0;
  const damage = results?.damage ?? 0;
  const dps = time > 0 ? `${num(damage / time)} DPS` : null;
  const stoppedAt = run.stoppedAt ?? null;
  if (run.mode === "live") {
    const shown = {
      running: () => `${dps} so far`,
      paused: () => `${dps}, paused at ${clock(time)}`,
      finished: () => dps,
    };
    if (dps !== null && shown[run.state]) {
      return shown[run.state]();
    }
  } else if (stoppedAt === null && dps !== null) {
    return dps;
  }
  return stoppedAt === null ? "none yet" : `stopped at ${clock(stoppedAt)}`;
}

// The card's model: its body (the average, or why there is none), whether
// the "Open full results" link shows (there is something on Results to
// open), and the live fight's line. The two links are index.html's own.
export function cardModel(state, { buildLabel }) {
  const { batch, run } = state;
  const status = batch.status;
  const running = status === "running";
  const liveStale = isStale(state, "live") ? " · out of date" : "";
  return {
    busy: running,
    body: [
      ...(running ? [] : [staleLine(state)]),
      ...batchPart(batch, run, buildLabel),
    ].filter(Boolean),
    open: ["running", "done", "cancelled", "error"].includes(status),
    live: `Live fight: ${liveText(state)}${liveStale}`,
  };
}

export function createResultsCardView(doc, store, labels) {
  const card = doc.querySelector("#results-card");
  const body = doc.querySelector("#results-card-body");
  const open = doc.querySelector("#results-card-open");
  const live = doc.querySelector("#results-card-live");
  if (!card || !body || !open || !live) {
    return () => {};
  }
  let last = null;
  function render(state) {
    const model = cardModel(state, labels);
    const markup = model.body.map(toMarkup).join("");
    if (model.busy) {
      card.setAttribute("aria-busy", "true");
    } else {
      card.removeAttribute("aria-busy");
    }
    open.hidden = !model.open;
    if (live.textContent !== model.live) {
      live.textContent = model.live;
    }
    if (markup !== last) {
      last = markup;
      body.replaceChildren(...model.body.map((node) => toDom(node, doc)));
    }
  }
  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (
      ["run", "batch", "results", "config", "ran"].some((s) =>
        changed.includes(s),
      )
    ) {
      render(state);
    }
  });
}
