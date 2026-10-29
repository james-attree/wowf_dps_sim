// The run controls (#149, #153): the seed in the header, the run status and
// the Pause button. This view owns those elements and no others. It shows
// run.seed once, draws the status and the button from run.state whenever the
// run slice changes, and calls the live run's actions (js/live-run.js) when
// the button is pressed. It never writes run.state: that comes from the
// runner.
//
// The status reads "Live" while running, "Paused" while paused and "Finished"
// once the fight has reached its length; Pause is disabled when there is
// nothing running to pause.
const STATUS_LABELS = Object.freeze({
  idle: "Stopped",
  running: "Live",
  paused: "Paused",
  finished: "Finished",
});

export function createControlsView(doc, store, actions) {
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
    pauseButton.disabled = state !== "running" && !isPaused;
    pauseIcon.textContent = isPaused ? "▶" : "Ⅱ";
    pauseLabel.textContent = isPaused ? "Resume" : "Pause";
    simulationStatusLabel.textContent = STATUS_LABELS[state];
    simulationStatus.classList.toggle("is-paused", state !== "running");
  }

  pauseButton.addEventListener("click", () => {
    const { state } = store.get().run;
    if (state === "running") {
      actions.pause();
    } else if (state === "paused") {
      actions.resume();
    }
  });

  render(store.get().run);
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("run")) {
      render(state.run);
    }
  });
}
