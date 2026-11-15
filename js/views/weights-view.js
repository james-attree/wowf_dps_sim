// The Stat weights Results view (issue #282). Draws js/views/weights-model.js
// into #results-weights. The host (js/run-actions.js) runs statWeights and
// stores the slice; this file does not import the engine. capNoteOf is
// handed in from js/main.js (js/weights-support.js) so the cap note can
// use the attack table without a view import. The note is computed from
// ran.weights.config (the run that produced the table), not today's
// build. coordinator call 15 Nov (James delegated).

import { weightsCapConfig, weightsModel } from "./weights-model.js";

const ZERO = 0;
const MAIN_BUTTON = 0;

function write(node, text) {
  if (node !== null && node.textContent !== text) {
    node.textContent = text;
  }
}

function drawBanner(doc, node, banner) {
  if (node === null) {
    return;
  }
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

function flag(doc, text, className) {
  const line = doc.createElement("span");
  line.className = className;
  line.textContent = text;
  return line;
}

function drawRows(doc, tbody, rows) {
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = doc.createElement("tr");
    tr.dataset.stat = row.id;
    const th = doc.createElement("th");
    th.scope = "row";
    const name = doc.createElement("span");
    name.className = "weights-stat-name";
    name.textContent = row.label;
    th.append(name);
    if (row.oneSided !== null) {
      th.append(flag(doc, row.oneSided, "weights-row-note"));
    }
    if (row.capFlag) {
      th.append(flag(doc, "Cap note", "weights-row-flag"));
    }
    const dps = doc.createElement("td");
    dps.className = "weights-dps num";
    const point = doc.createElement("span");
    point.className = "weights-dps-point";
    point.textContent = row.dps;
    const folded = doc.createElement("span");
    folded.className = "weights-ci-folded";
    folded.textContent = row.folded;
    dps.append(point, folded);
    const ci = doc.createElement("td");
    ci.className = "weights-ci-col num";
    const ciText = doc.createElement("span");
    ciText.className = "weights-ci-text";
    ciText.textContent = row.measured ? `\u00b1 ${row.ci}` : row.ci;
    ci.append(ciText);
    if (row.bar !== null) {
      const bar = doc.createElement("span");
      bar.className = "weights-ci-bar";
      bar.setAttribute("aria-hidden", "true");
      const fill = doc.createElement("span");
      fill.className = "weights-ci-bar-fill";
      fill.style.width = `${row.bar}%`;
      bar.append(fill);
      ci.append(bar);
    }
    const ap = doc.createElement("td");
    ap.className = "weights-ap num";
    ap.textContent = row.ap;
    tr.append(th, dps, ci, ap);
    tbody.append(tr);
  }
}

function drawTable(doc, table, model) {
  if (typeof table?.querySelector !== "function") {
    return;
  }
  const caption = table.querySelector("caption");
  const tbody = table.querySelector("tbody");
  write(caption, model.caption ?? "");
  if (tbody !== null) {
    drawRows(doc, tbody, model.rows);
  }
}

export function createWeightsView(doc, store, actions, { capNoteOf } = {}) {
  const root = doc.querySelector("#results-weights");
  if (root === null) {
    return () => {};
  }
  const byId = (id) => doc.querySelector(`#${id}`);
  const label = byId("results-weights-label");
  const estimate = byId("results-weights-estimate");
  const intro = byId("results-weights-intro");
  const stale = byId("results-weights-stale");
  const status = byId("results-weights-status");
  const error = byId("results-weights-error");
  const progress = byId("results-weights-progress");
  const bar = byId("results-weights-progress-bar");
  const progressLine = byId("results-weights-progress-line");
  const estimateLine = byId("results-weights-progress-estimate");
  const table = byId("results-weights-table");
  const cap = byId("results-weights-cap");
  const run = byId("results-weights-run");
  const help = byId("results-weights-help");
  const keepAwake = byId("results-weights-keep-awake");

  let lastStatus = null;
  const shown = () =>
    store.get().route?.area === "results" &&
    store.get().route?.sub === "weights";

  function render(state) {
    const capSource = weightsCapConfig(state);
    const note =
      typeof capNoteOf === "function" && capSource !== null
        ? capNoteOf(capSource)
        : null;
    const model = weightsModel(state, { capNote: note });
    write(label, model.label);
    if (estimate !== null) {
      estimate.hidden = model.estimate === null;
      write(estimate, model.estimate ?? "");
    }
    if (intro !== null) {
      intro.hidden = model.intro === null;
      write(intro, model.intro ?? "");
    }
    drawBanner(doc, stale, model.stale);
    if (status !== null) {
      const text = model.statusText;
      status.hidden = text === null;
      write(status, text ?? "");
    }
    if (error !== null) {
      error.hidden = model.errorDetail === null;
      write(error, model.errorDetail ?? "");
    }
    if (progress !== null) {
      progress.hidden = model.progress === null;
      if (model.progress !== null && bar !== null) {
        bar.setAttribute("max", String(model.progress.total));
        bar.setAttribute("value", String(model.progress.completed));
        bar.setAttribute("aria-valuemin", String(ZERO));
        bar.setAttribute("aria-valuemax", String(model.progress.total));
        bar.setAttribute("aria-valuenow", String(model.progress.completed));
        bar.setAttribute("aria-valuetext", model.progress.valueText);
        write(progressLine, model.progress.line);
        write(estimateLine, model.progress.estimate);
      }
    }
    if (keepAwake !== null) {
      keepAwake.hidden = model.keepAwake === null;
      write(keepAwake, model.keepAwake ?? "");
    }
    if (table !== null) {
      table.hidden = !model.showTable;
      if (model.showTable) {
        drawTable(doc, table, model);
      }
    }
    if (cap !== null) {
      cap.hidden = model.capNote === null;
      write(cap, model.capNote ?? "");
    }
    if (run !== null) {
      write(run, model.button);
      run.setAttribute(
        "data-weights-action",
        model.cancelling ? "cancel" : "run",
      );
      if (model.cancelling) {
        run.removeAttribute("aria-disabled");
      } else {
        run.setAttribute("aria-disabled", String(model.blocked));
      }
    }
    write(help, model.help);

    if (lastStatus !== null && lastStatus !== model.status && shown()) {
      if (model.status === "running") {
        run?.focus();
      } else if (model.status === "done" || model.status === "error") {
        status?.focus();
      } else if (model.status === "cancelled") {
        if (model.showTable) {
          status?.focus();
        } else {
          run?.focus();
        }
      }
    }
    lastStatus = model.status;
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("#results-weights-run");
    if (!button) {
      return;
    }
    if (button.getAttribute("data-weights-action") === "cancel") {
      actions.cancelWeights();
      return;
    }
    if (button.getAttribute("aria-disabled") === "true") {
      doc.querySelector("#run-errors-link")?.click();
      return;
    }
    actions.commitEdits?.();
    if (weightsModel(store.get()).blocked) {
      doc.querySelector("#run-errors-link")?.click();
      return;
    }
    actions.runWeights();
  });
  root.addEventListener("mousedown", (event) => {
    if (
      event.button !== MAIN_BUTTON &&
      event.target.closest?.("#results-weights-run")
    ) {
      event.preventDefault();
    }
  });

  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (
      ["route", "run", "weights", "ran", "config", "form", "talents"].some(
        (slice) => changed.includes(slice),
      )
    ) {
      render(state);
    }
  });
}
