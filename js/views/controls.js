import { NARROW_QUERY } from "./breakpoints.js";
import { fieldId } from "./config-form.js";
import {
  announceKey,
  blocked,
  controlsModel,
  errorsText,
  fieldErrors,
  firstFormError,
  focusTarget,
  formErrorCount,
  rotationErrorCount,
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

  // #run-announce: emptied now, `text` written on the next frame (the
  // rotation builder's pattern), so each message is a fresh change. A page
  // with no frames (the tests' stand-in documents) writes it at once.
  const view = doc.defaultView;
  let pendingAnnounce = null;
  const announce = (text) => {
    if (pendingAnnounce !== null) {
      view.cancelAnimationFrame(pendingAnnounce);
      pendingAnnounce = null;
    }
    announcer.textContent = "";
    if (text === "") {
      return;
    }
    if (typeof view?.requestAnimationFrame !== "function") {
      announcer.textContent = text;
      return;
    }
    pendingAnnounce = view.requestAnimationFrame(() => {
      pendingAnnounce = null;
      announcer.textContent = text;
    });
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
      formErrorCount(state.form) +
        talentErrorCount(state) +
        rotationErrorCount(state),
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
    // The label swap says it (#45, Scout): no aria-pressed.
    write(pauseIcon, model.pause.resume ? "▶" : "Ⅱ");
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
    // The narrow row draws this shorter text in place of the status (styles.css).
    if (model.statusShort === null) {
      statusText.removeAttribute("data-short");
    } else {
      statusText.setAttribute("data-short", model.statusShort);
    }
    statusLine.classList.toggle("is-paused", run.state !== "running");
    write(help, model.help);
    progressRow.hidden = model.progress === null;
    if (model.progress !== null) {
      progress.max = model.progress.max;
      progress.value = model.progress.value;
      write(progressText, model.progress.text);
    }

    // Transitions only: the first draw is silent. One message per change
    // (#45, Fran): the region is emptied, then written on the next frame, so
    // the same words twice are said twice. Resume says Running, as Run does
    // (#45, Scout).
    const key = announceKey(state);
    if (
      lastAnnounce !== null &&
      key !== lastAnnounce &&
      model.announce !== null
    ) {
      announce(model.announce);
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
  // The form field the footer lists first (#247, Fran's nit 4: for Min
  // above Max the link went to Min while the footer named the Max), else
  // the form's first invalid field.
  function firstFormField() {
    const path = firstFormError(store.get().form);
    const named = path === null ? null : doc.querySelector(`#${fieldId(path)}`);
    if (named?.getAttribute?.("aria-invalid") === "true") {
      return named;
    }
    return doc.querySelector('#config-form [aria-invalid="true"]');
  }

  // Focus the first setting to fix: what the "Fix" link and a blocked Run
  // (#247) do.
  function fixFirst() {
    const [first] = fieldErrors(store.get().run);
    if (first === undefined) {
      const field = firstFormField();
      if (field !== null) {
        field.focus?.();
        return;
      }
      // Else the rotation builder's draft with errors (#217, D17), when the
      // talents are fine: the builder opens and focuses its first error.
      if (
        talentErrorCount(store.get()) === 0 &&
        rotationErrorCount(store.get()) > 0
      ) {
        actions.fixRotation?.();
        return;
      }
      // Else the talent tree's over-cap build (#204, Fran's QA of #208):
      // open the tree and focus its Level input.
      const edit = doc.querySelector("#talents-edit");
      if (edit?.getAttribute?.("aria-expanded") === "false") {
        edit.click?.();
      }
      doc.querySelector("#talents-level")?.focus?.();
      return;
    }
    open = true;
    render(store.get());
    inputs[first].focus?.();
  }
  errorsLink.addEventListener("click", (event) => {
    event?.preventDefault?.();
    fixFirst();
  });

  // Run checks the fields typed in first (#247): a run never uses a config
  // the fields do not show. Pressing Run blurs the field, which checks it
  // too, and an error then disables Run before the click; so the press
  // checks, and when that blocks Run it keeps focus off the button, which
  // would drop it to the page, and sends it to the first setting to fix.
  buttons.run.addEventListener("mousedown", (event) => {
    if (buttons.run.disabled) {
      return;
    }
    call("commitEdits");
    if (blocked(store.get())) {
      event?.preventDefault?.();
      fixFirst();
    }
  });
  buttons.run.addEventListener("click", () => {
    call("commitEdits");
    if (blocked(store.get())) {
      fixFirst();
      return;
    }
    call("run");
  });
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
  narrow?.addEventListener?.("change", () => {
    place();
    sizeBar();
  });

  // #200 (Fran's #226 QA, 5): the sticky bar's height, as --run-bar-height on
  // the page, so a banner scrolled into view (its scroll-margin-top,
  // rotation-builder.css) lands below the bar, not under it. The sticky part
  // is the whole bar when wide and the compact row when narrow, and either
  // changes height as it wraps, so it is measured, not guessed.
  const root = doc.documentElement;
  function sizeBar() {
    const stuck = narrow?.matches ? row : bar;
    if (typeof stuck.offsetHeight === "number") {
      root?.style?.setProperty?.("--run-bar-height", `${stuck.offsetHeight}px`);
    }
  }
  sizeBar();
  if (typeof view?.ResizeObserver === "function") {
    const watch = new view.ResizeObserver(sizeBar);
    watch.observe(bar);
    watch.observe(row);
  }
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
