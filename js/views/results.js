// The fight totals (#149): elapsed time, damage and DPS. This view owns those
// three elements. In live mode it draws them from the results slice
// ({ time, damage }, in fight seconds and damage done) each time it changes.
//
// In batch mode (#154) the Total damage and DPS tiles show the batch's mean
// fight: damage per fight (breakdown.totalDamage over the fights) and the
// mean DPS, for a finished or a partial (stopped) result alike, and the
// running mean while a batch runs. With no fight finished they read 0. A
// batch never writes the results slice, so before #154 they stayed at 0
// after a batch, partial or not. The time tile stays with the live fight.
export function batchTotals(state) {
  const { batch, run } = state;
  const result = batch.result;
  if (result && result.completed > 0) {
    return {
      damage: result.breakdown.totalDamage / result.breakdown.fights,
      dps: result.summary.mean,
    };
  }
  const mean = batch.status === "running" ? batch.progress?.mean : null;
  if (Number.isFinite(mean)) {
    return { damage: mean * run.duration, dps: mean };
  }
  return { damage: 0, dps: 0 };
}

export function createResultsView(doc, store) {
  const timeValue = doc.querySelector("#time-value");
  const damageValue = doc.querySelector("#damage-value");
  const dpsValue = doc.querySelector("#dps-value");

  function write(output, value) {
    output.value = value;
    output.textContent = value;
  }

  function renderTotals(damage, dps) {
    write(damageValue, String(Math.floor(damage)));
    write(dpsValue, dps.toFixed(0));
  }

  function render({ time, damage, keepTotals = false }) {
    const elapsedSeconds = Math.floor(time);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    write(
      timeValue,
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    );
    if (!keepTotals) {
      renderTotals(damage, time > 0 ? damage / time : 0);
    }
  }

  // The mode the tiles were last drawn for: a switch of mode redraws them,
  // and any other run change does not.
  let drawnMode = null;
  return store.subscribe(({ state, changed }) => {
    const mode = state.run?.mode === "batch" ? "batch" : "live";
    const switched = changed.includes("run") && mode !== drawnMode;
    if (mode === "live" && (changed.includes("results") || switched)) {
      render(state.results);
      drawnMode = mode;
    } else if (mode === "batch" && (changed.includes("batch") || switched)) {
      const { damage, dps } = batchTotals(state);
      renderTotals(damage, dps);
      drawnMode = mode;
    } else if (mode === "batch" && changed.includes("results")) {
      // The live fight's clock still runs the time tile.
      render({ ...state.results, keepTotals: true });
    }
  });
}
