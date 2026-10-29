import {
  announceKey,
  controlsModel,
  focusTarget,
  isLocked,
  parseRunField,
} from "./run-model.js";

// The run control bar (#153): the one home of Run, Pause, Stop and Reset, the
// live/batch mode toggle, the fight length, fights and seed fields, the run
// status, the batch progress and the help line. This view owns those elements
// and no others. It draws them from the store's run, batch, results and form
// slices through js/views/run-model.js, and calls the run's actions
// (js/run-actions.js) when a control is used. It never writes the store.
//
// Accessibility (Fran's notes): disabled buttons use the native `disabled`,
// except Pause in batch mode, which stays focusable with aria-disabled and the
// help line as its reason. The visible status (with its ticking time) is
// aria-hidden; a visually hidden role="status" line is written only on a
// transition. Focus moves to Pause (live) or Stop (batch) after Run, and to
// Run after Stop, a finish or Reset, when it was in the bar.
const FIELDS = ["duration", "iterations", "seed"];

export function createControlsView(doc, store, actions = {}) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const bar = $("run-controls");
  const modeLive = $("run-mode-live");
  const modeBatch = $("run-mode-batch");
  const iterationsField = $("run-iterations-field");
  const inputs = Object.fromEntries(
    FIELDS.map((name) => [name, $(`run-${name}`)]),
  );
  const errors = Object.fromEntries(
    FIELDS.map((name) => [name, $(`run-${name}-error`)]),
  );
  const newSeed = $("run-seed-new");
  const buttons = {
    run: $("run-button"),
    pause: $("pause-button"),
    stop: $("stop-button"),
    reset: $("reset-button"),
  };
  const pauseIcon = $("pause-icon");
  const pauseLabel = $("pause-label");
  const statusText = $("run-status-text");
  const statusLine = $("run-status");
  const announcer = $("run-announce");
  const progressRow = $("run-progress-row");
  const progress = $("run-progress");
  const progressText = $("run-progress-text");
  const help = $("run-help");

  const write = (node, text) => {
    if (node.textContent !== text) {
      node.textContent = text;
    }
  };

  let lastAnnounce = null;
  let lastFocus = null;
  function render(state) {
    const model = controlsModel(state);
    const { run } = state;
    const locked = isLocked(run);

    modeLive.checked = run.mode === "live";
    modeBatch.checked = run.mode === "batch";
    modeLive.disabled = locked;
    modeBatch.disabled = locked;
    iterationsField.hidden = run.mode !== "batch";
    newSeed.disabled = locked;
    for (const name of FIELDS) {
      const input = inputs[name];
      const text = run.fields[name];
      if (input.value !== text) {
        input.value = text;
      }
      input.disabled = locked;
      const error = run.errors[name] ?? null;
      write(errors[name], error ?? "");
      errors[name].hidden = error === null;
      if (error === null) {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      } else {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", `run-${name}-error`);
      }
    }

    write(buttons.run, model.run.label);
    buttons.run.disabled = model.run.disabled;
    write(pauseLabel, model.pause.label);
    write(pauseIcon, model.pause.pressed ? "▶" : "Ⅱ");
    buttons.pause.setAttribute("aria-pressed", String(model.pause.pressed));
    buttons.pause.disabled = model.pause.disabled;
    if (model.pause.inert) {
      buttons.pause.setAttribute("aria-disabled", "true");
      buttons.pause.setAttribute("aria-describedby", "run-help");
    } else {
      buttons.pause.removeAttribute("aria-disabled");
      buttons.pause.removeAttribute("aria-describedby");
    }
    write(buttons.stop, model.stop.label);
    buttons.stop.disabled = model.stop.disabled;
    buttons.reset.disabled = model.reset.disabled;

    write(statusText, model.status);
    statusLine.classList.toggle("is-paused", run.state !== "running");
    write(help, model.help);
    progressRow.hidden = model.progress === null;
    if (model.progress !== null) {
      progress.max = model.progress.max;
      progress.value = model.progress.value;
      write(progressText, model.progress.text);
    }

    // Transitions only: the first draw is silent.
    const key = announceKey(state);
    if (lastAnnounce !== null && key !== lastAnnounce) {
      write(announcer, model.announce);
    }
    lastAnnounce = key;

    // Focus follows the state's main control, and leaves a control that was
    // just disabled under it (Reset after a finished fight), but only from
    // inside the bar or nowhere.
    const target = focusTarget(state);
    const active = doc.activeElement ?? null;
    const stranded = Boolean(active?.disabled);
    if (lastFocus !== null && (target !== lastFocus || stranded)) {
      const inBar =
        active === null ||
        active === doc.body ||
        Boolean(bar.contains?.(active));
      const button = buttons[target];
      if (inBar && !button.disabled && button !== active) {
        button.focus?.();
      }
    }
    lastFocus = target;
  }

  const call = (name, ...args) => actions[name]?.(...args);
  buttons.run.addEventListener("click", () => call("run"));
  buttons.pause.addEventListener("click", () => {
    const { run } = store.get();
    if (run.mode !== "live") {
      return;
    }
    if (run.state === "running") {
      call("pause");
    } else if (run.state === "paused") {
      call("resume");
    }
  });
  buttons.stop.addEventListener("click", () => call("stop"));
  buttons.reset.addEventListener("click", () => call("reset"));
  newSeed.addEventListener("click", () => call("newSeed"));
  for (const radio of [modeLive, modeBatch]) {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        call("setMode", radio.value);
      }
    });
  }
  for (const name of FIELDS) {
    inputs[name].addEventListener("input", () => {
      const text = inputs[name].value;
      call("edit", name, { text, ...parseRunField(name, text) });
    });
  }

  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (["run", "batch", "results", "form"].some((s) => changed.includes(s))) {
      render(state);
    }
  });
}
