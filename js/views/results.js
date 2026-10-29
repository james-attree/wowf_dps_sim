import { formatNumber } from "../charts.js";

// The fight totals (#149): elapsed time, damage and DPS. This view owns those
// three elements and the tiles' section. In live mode it draws them from the
// results slice ({ time, damage }, in fight seconds and damage done) each time
// it changes.
//
// In batch mode the tiles and the timer are hidden (#155, Fran's Phase 3 QA
// 3): they are one fight's numbers, and the results panel (#154) is the one
// place a batch's numbers show, with its own formatting. #154 had them show
// the batch's mean fight, rounded differently from the panel and with the
// timer at 00:00, which read as two answers.
//
// The damage tile has commas (#45, Scout): "25,180", as #run-announce says it.
export function createResultsView(doc, store) {
  const panel = doc.querySelector("#damage-panel");
  const timeValue = doc.querySelector("#time-value");
  const damageValue = doc.querySelector("#damage-value");
  const dpsValue = doc.querySelector("#dps-value");

  // Only on a change (#45): the tiles are aria-live="off", and a write that
  // says the same thing is a DOM change for nothing.
  function write(output, value) {
    if (output.textContent !== value) {
      output.textContent = value;
    }
  }

  function render({ time, damage }) {
    const elapsedSeconds = Math.floor(time);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    write(
      timeValue,
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    );
    write(damageValue, formatNumber(Math.floor(damage), 0));
    write(dpsValue, (time > 0 ? damage / time : 0).toFixed(0));
  }

  function show(mode) {
    const hidden = mode === "batch";
    panel.hidden = hidden;
    timeValue.hidden = hidden;
  }

  // The mode the tiles were last drawn for: a switch of mode shows or hides
  // them, and any other run change does not.
  const modeOf = (state) => (state.run?.mode === "batch" ? "batch" : "live");
  let drawnMode = modeOf(store.get());
  show(drawnMode);
  return store.subscribe(({ state, changed }) => {
    const mode = modeOf(state);
    const switched = changed.includes("run") && mode !== drawnMode;
    if (switched) {
      show(mode);
      drawnMode = mode;
    }
    if (mode === "live" && (changed.includes("results") || switched)) {
      render(state.results);
    }
  });
}
