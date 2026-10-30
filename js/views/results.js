import { formatNumber } from "../charts.js";

// The fight totals (#149): elapsed time, damage and DPS. This view owns those
// three elements. It draws them from the
// results slice ({ time, damage }, in fight seconds and damage done) each time
// it changes.
//
// The live fight is kept beside the average (#242, UX4): running a batch
// leaves it as it was, so the tiles show it in both modes. (#155 hid them in
// batch mode, when #154 had them show the batch's mean fight; the average is
// only on Results and in the results column now.)
//
// The damage and DPS tiles have commas (#45, Scout): "25,180" and "1,234",
// as #run-announce says them.
export function createResultsView(doc, store) {
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
    write(dpsValue, formatNumber(time > 0 ? damage / time : 0, 0));
  }

  return store.subscribe(({ state, changed }) => {
    if (changed.includes("results")) {
      render(state.results);
    }
  });
}
