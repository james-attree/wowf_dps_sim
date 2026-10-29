// The run controls (#149): the seed in the header, the Live/Paused status and
// the Pause button. This view owns those elements and no others. It shows
// run.seed once, draws the status and the button from run.state whenever the
// run slice changes, and asks the store for the other state when the button is
// pressed. Starting and stopping the frame loop is js/main.js's job.
export function createControlsView(doc, store) {
  const pauseButton = doc.querySelector("#pause-button");
  const pauseIcon = doc.querySelector("#pause-icon");
  const pauseLabel = doc.querySelector("#pause-label");
  const seedValue = doc.querySelector("#seed-value");
  const simulationStatus = doc.querySelector("#simulation-status");
  const simulationStatusLabel = doc.querySelector("#simulation-status-label");

  seedValue.textContent = String(store.get().run.seed);

  function render({ state }) {
    const isPaused = state === "paused";
    pauseButton.setAttribute("aria-pressed", String(isPaused));
    pauseIcon.textContent = isPaused ? "▶" : "Ⅱ";
    pauseLabel.textContent = isPaused ? "Resume" : "Pause";
    simulationStatusLabel.textContent = isPaused ? "Paused" : "Live";
    simulationStatus.classList.toggle("is-paused", isPaused);
  }

  pauseButton.addEventListener("click", () => {
    store.update(({ run }) => ({
      run: { ...run, state: run.state === "paused" ? "running" : "paused" },
    }));
  });

  return store.subscribe(({ state, changed }) => {
    if (changed.includes("run")) {
      render(state.run);
    }
  });
}
