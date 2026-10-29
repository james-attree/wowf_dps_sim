import { NARROW_QUERY } from "./breakpoints.js";
import {
  announceKey,
  controlsModel,
  errorsText,
  fieldErrors,
  focusTarget,
  formErrorCount,
  talentErrorCount,
  isLocked,
  parseRunField,
  summaryText,
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
//
// Below 520 px (Scout, #153) only one compact row is sticky: Run or Pause
// (whichever applies), Stop, Reset, and a one-line summary of the next run's
// settings with its mode. The settings (mode, fight length, fights, seed) sit
// in a section under that row, closed by default and not sticky. The view
// keeps the DOM in reading order for each width: settings before the buttons
// when wide (as before), after the sticky row when narrow, so the focus order
// follows what is seen. An error in a closed section is reached through the
// row's "Fix 1 setting" link, which opens the section and focuses the field.
// Wide screens show neither the toggle nor the summary.
//
// While Run is blocked (#155, Fran's Phase 3 QA 1) the status says "Can't run
// · N settings to fix", never Ready, and the "Fix N settings" link shows at
// every width. Both count the run fields' errors and the stats form's; the
// link goes to the first run field with an error, else the form's first
// invalid field. Run's aria-describedby names the reason (#run-reason).
const FIELDS = ["duration", "iterations", "seed"];
// Re-exported for the tests and older imports; the value lives in
// js/views/breakpoints.js.
export { NARROW_QUERY };

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
  const row = $("run-bar");
  const settings = $("run-settings");
  const settingsToggle = $("run-settings-toggle");
  const summary = $("run-summary");
  const errorsLink = $("run-errors-link");
  const reason = $("run-reason");

  const write = (node, text) => {
    if (node.textContent !== text) {
      node.textContent = text;
    }
  };

  // The settings section's open state is the view's own: closed at first.
  let open = false;

  // Reading order for the width: the settings before the row when wide, after
  // it when narrow. A focused field keeps its focus through the move.
  const narrow = (doc.defaultView ?? globalThis).matchMedia?.(NARROW_QUERY);
  function place() {
    const after = Boolean(narrow?.matches);
    const placed = after
      ? row.nextElementSibling === settings
      : settings.nextElementSibling === row;
    if (placed || !row.after) {
      return;
    }
    const active = doc.activeElement ?? null;
    const keep = settings.contains?.(active) ? active : null;
    if (after) {
      row.after(settings);
    } else {
      row.before(settings);
    }
    keep?.focus?.();
  }

  let lastAnnounce = null;
  let lastFocus = null;
  function render(state) {
    const model = controlsModel(state);
    const { run } = state;
    const locked = isLocked(run);

    settings.classList.toggle("is-open", open);
    settingsToggle.setAttribute("aria-expanded", String(open));
    // The narrow row shows Pause while a fight or batch runs, Run otherwise.
    bar.setAttribute("data-slot", locked ? "pause" : "run");
    write(summary, summaryText(run));
    const fix = errorsText(
      run,
      formErrorCount(state.form) + talentErrorCount(state),
    );
    errorsLink.hidden = fix === null;
    write(errorsLink, fix ?? "");
    row.classList.toggle("has-errors", fix !== null);

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
    write(reason, model.reason ?? "");
    if (model.reason === null) {
      buttons.run.removeAttribute("aria-describedby");
    } else {
      buttons.run.setAttribute("aria-describedby", "run-reason");
    }
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
    if (
      lastAnnounce !== null &&
      key !== lastAnnounce &&
      model.announce !== null
    ) {
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
  settingsToggle.addEventListener("click", () => {
    open = !open;
    render(store.get());
  });
  errorsLink.addEventListener("click", (event) => {
    event?.preventDefault?.();
    const [first] = fieldErrors(store.get().run);
    if (first === undefined) {
      // A form field, else the talent tree's over-cap build (#204).
      (
        doc.querySelector('#config-form [aria-invalid="true"]') ??
        doc.querySelector("#talents-edit")
      )?.focus?.();
      return;
    }
    open = true;
    render(store.get());
    inputs[first].focus?.();
  });
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

  place();
  narrow?.addEventListener?.("change", place);
  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (
      ["run", "batch", "results", "form", "talents"].some((s) =>
        changed.includes(s),
      )
    ) {
      render(state);
    }
  });
}
