// The fight totals (#149): elapsed time, damage and DPS. This view owns those
// three elements and draws them from the results slice ({ time, damage }, in
// fight seconds and damage done) each time it changes.
export function createResultsView(doc, store) {
  const timeValue = doc.querySelector("#time-value");
  const damageValue = doc.querySelector("#damage-value");
  const dpsValue = doc.querySelector("#dps-value");

  function render({ time, damage }) {
    const elapsedSeconds = Math.floor(time);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    timeValue.value = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    timeValue.textContent = timeValue.value;
    damageValue.value = String(Math.floor(damage));
    damageValue.textContent = damageValue.value;
    const dps = time > 0 ? damage / time : 0;
    dpsValue.value = dps.toFixed(0);
    dpsValue.textContent = dpsValue.value;
  }

  return store.subscribe(({ state, changed }) => {
    if (changed.includes("results")) {
      render(state.results);
    }
  });
}
