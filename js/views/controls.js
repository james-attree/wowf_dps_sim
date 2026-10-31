import { NARROW_QUERY } from "./breakpoints.js";
import { fieldId } from "./config-form.js";
import {
  announceKey,
  blocked,
  controlsModel,
  dockDps,
  dockText,
  errorsText,
  fieldErrors,
  firstFormError,
  focusTarget,
  formErrorCount,
  rotationErrorCount,
  warningsText,
  talentErrorCount,
  isLocked,
  parseRunField,
  summaryText,
} from "./run-model.js";
import { areaLabel, reveal } from "./sections.js";
import { STALE_ANNOUNCEMENT, staleKinds } from "./stale.js";

// "Running" and "Showing Results" as "Running. Showing Results."
const joinMessages = (first, second) => {
  if (first === "" || second === "") {
    return first + second;
  }
  return /[.!?]$/.test(first) ? `${first} ${second}` : `${first}. ${second}`;
};

// The run control bar (#153): the one home of Run, Pause, Stop and Reset, the
// run status, the batch progress and the help line, and of the fight's
// settings: the run type (live or batch), the fight length, fights and seed
// fields, which are Fight's since #245 (index.html, the Fight area). This
// view owns those elements and no others. It draws them from the store's run, batch, results and form
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
// The settings are in the Fight area at every width (#245; proposal
// section 3), not in the bar: the wide Run panel links there ("Change fight
// settings"), and the phone dock keeps Run, its status and a one-line summary
// of the next run's settings. An error in one is reached through the bar's
// "Fix 1 setting" link, which shows Fight and focuses the field.
//
// While Run is blocked (#155, Fran's Phase 3 QA 1) the status says "Can't run
// · N settings to fix", never Ready, and the "Fix N settings" link shows at
// every width. Both count the run fields' errors and the stats form's; the
// link goes to the first run field with an error, else the form's first
// invalid field. Run's aria-describedby names the reason (#run-reason).
//
// Below the wide breakpoint (#240, UX2) the row is the phone dock's strip,
// fixed above the area nav (styles.css): its two lines are the shorter
// data-dock texts, beside a DPS readout, and Run's slot shows Pause once a
// run starts, so a second tap of a double-tap is not taken as Pause.
const FIELDS = ["duration", "iterations", "seed"];
// The main (left) mouse button: only it presses Run (#240, Fran's #249 N4).
const MAIN_BUTTON = 0;
// The middle button, whose release pastes on Linux (#245).
const MIDDLE_BUTTON = 1;
// A Pause press this soon after Run started the run is the same tap twice
// (#240, Fran's #249 N3), so it is ignored. In milliseconds.
export const RUN_TAP_GUARD_MS = 500;
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
  const summary = $("run-summary");
  const errorsLink = $("run-errors-link");
  const warningsLink = $("run-warnings-link");
  const reason = $("run-reason");
  const dpsValue = $("run-dps-value");
  const dpsLabel = $("run-dps-label");

  const write = (node, text) => {
    if (node.textContent !== text) {
      node.textContent = text;
    }
  };

  // #run-announce: emptied now, `text` written on the next frame (the
  // rotation builder's pattern), so each message is a fresh change. A page
  // with no frames (the tests' stand-in documents) writes it at once.
  const view = doc.defaultView;
  // Two messages in one frame are said as one (#242): Run's "Running" and
  // the area it moved to, "Showing Results", are "Running. Showing Results."
  let pendingAnnounce = null;
  let pendingText = "";
  // With no frames, a follow-up joins the message of the run it follows
  // when only the route has changed between them (the router's `route`
  // and `moved` come right after the run's change).
  let joinable = false;
  const announceAlso = (text) => {
    if (typeof view?.requestAnimationFrame !== "function" && joinable) {
      announcer.textContent = joinMessages(announcer.textContent, text);
      return;
    }
    announce(text, true);
  };
  // A change before the frame replaces the waiting message; a follow-up
  // (`join`) is said with it.
  const announce = (text, join = false) => {
    if (pendingAnnounce !== null) {
      view.cancelAnimationFrame(pendingAnnounce);
      pendingAnnounce = null;
      if (join) {
        text = joinMessages(pendingText, text);
      }
    }
    pendingText = "";
    announcer.textContent = "";
    if (text === "") {
      return;
    }
    if (typeof view?.requestAnimationFrame !== "function") {
      announcer.textContent = text;
      joinable = true;
      return;
    }
    pendingText = text;
    pendingAnnounce = view.requestAnimationFrame(() => {
      pendingAnnounce = null;
      pendingText = "";
      announcer.textContent = text;
    });
  };

  let lastAnnounce = null;
  let lastStale = null;
  let lastFocus = null;
  function render(state) {
    const model = controlsModel(state);
    const { run } = state;
    const locked = isLocked(run);

    // The narrow row shows Pause while a fight or batch runs, Run otherwise.
    bar.setAttribute("data-slot", locked ? "pause" : "run");
    write(summary, summaryText(run));
    const dock = dockText(state);
    summary.setAttribute("data-dock", dock.summary);
    statusText.setAttribute("data-dock", dock.status);
    const dps = dockDps(state);
    write(dpsValue, dps.value);
    write(dpsLabel, dps.label);
    const fix = errorsText(
      run,
      formErrorCount(state.form) +
        talentErrorCount(state) +
        rotationErrorCount(state),
    );
    errorsLink.hidden = fix === null;
    write(errorsLink, fix ?? "");
    row.classList.toggle("has-errors", fix !== null);
    if (warningsLink !== null) {
      const warned = warningsText(state, fix !== null);
      warningsLink.hidden = warned === null;
      write(warningsLink, warned ?? "");
      // The mark is not read: "2 rotation warnings".
      if (warned === null) {
        warningsLink.removeAttribute("aria-label");
      } else {
        warningsLink.setAttribute("aria-label", warned.replace(/^⚠ /, ""));
      }
      row.classList.toggle("has-warnings", warned !== null);
    }

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
    // A kept result going out of date is said once per change (#242): when
    // an edit makes one stale, not on each edit after it.
    const stale = staleKinds(state);
    if (lastStale !== null && stale.some((kind) => !lastStale.includes(kind))) {
      announce(STALE_ANNOUNCEMENT);
    }
    lastStale = stale;

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
    // A Run disabled under focus by the check of a typed edit (focus moved
    // to it by a script or a screen reader, #240, Fran's #249 N5) would drop
    // focus to the page: it goes to the first setting to fix instead.
    if (active === buttons.run && buttons.run.disabled && blocked(state)) {
      later(refocus);
    }
  }

  const call = (name, ...args) => actions[name]?.(...args);
  // After the event (and the store change) in hand: focus moved from inside
  // a store update or a press is otherwise undone by the browser.
  const later = (task) => {
    if (typeof view?.setTimeout === "function") {
      view.setTimeout(task);
    } else {
      task();
    }
  };
  // Focus with nowhere to be: the page, or a disabled Run.
  const lost = () => {
    const active = doc.activeElement ?? null;
    return (
      active === null ||
      active === doc.body ||
      (active === buttons.run && buttons.run.disabled)
    );
  };
  const refocus = () => {
    if (buttons.run.disabled && blocked(store.get()) && lost()) {
      fixFirst();
    }
  };
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
  // (#247) do. A setting in an area not shown has its area shown first
  // (#239).
  function fixFirst() {
    const [first] = fieldErrors(store.get().run);
    if (first === undefined) {
      const field = firstFormField();
      if (field !== null) {
        reveal(field);
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
      // show the Talents screen (#244, revealing its Level input does) and
      // focus the input.
      const level = doc.querySelector("#talents-level");
      reveal(level);
      level?.focus?.();
      return;
    }
    // The field is in Fight (#245): Fight is shown first.
    reveal(inputs[first]);
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
  // Another button (right, middle) does not press Run, and does not focus it
  // either (#242, Fran's #252 note): the browser's own focus on mousedown
  // would blur the field being typed in, commit it and, with an error, send
  // the focus on to the setting to fix.
  const otherButton = (event) =>
    event?.button !== undefined && event.button !== MAIN_BUTTON;
  buttons.run.addEventListener("mousedown", (event) => {
    if (otherButton(event)) {
      event.preventDefault?.();
      return;
    }
    if (buttons.run.disabled) {
      return;
    }
    call("commitEdits");
    if (blocked(store.get())) {
      event?.preventDefault?.();
      fixFirst();
    }
  });
  // A press on a disabled Run gives no click, and the browser drops focus
  // to the page (#240, Fran's #249 N5, after arrow-key stepping): it goes to
  // the first setting to fix. Focus moved to Run while a typed edit makes it
  // blocked (a script, a screen reader) ends the same way.
  // Another button's press on a disabled Run drops the focus to the page
  // too: it goes back where it was. So does any press on a Run disabled by
  // a run in progress, not by an error (#245, Fran's #251 check): back to
  // where it was, or from the page to the state's main control (Stop in a
  // batch).
  row.addEventListener("pointerdown", (event) => {
    if (event?.target !== buttons.run || !buttons.run.disabled) {
      return;
    }
    if (!otherButton(event) && blocked(store.get())) {
      later(refocus);
      return;
    }
    const had = doc.activeElement ?? null;
    const back = () => {
      if (!lost()) {
        return;
      }
      if (had !== null && had !== doc.body && !had.disabled) {
        had.focus?.();
        return;
      }
      const main = buttons[focusTarget(store.get())];
      if (main !== undefined && !main.disabled && !otherButton(event)) {
        main.focus?.();
      }
    };
    back();
    later(back);
  });
  row.addEventListener("mousedown", (event) => {
    if (event?.target === buttons.run && otherButton(event)) {
      event.preventDefault?.();
    }
  });
  // On Linux a middle-button release pastes the primary selection into the
  // field that kept the focus ('99' became '99100'; #245, Fran's #254
  // check): a release on Run, enabled or not, pastes nothing.
  row.addEventListener("mouseup", (event) => {
    if (event?.target === buttons.run && event.button === MIDDLE_BUTTON) {
      event.preventDefault?.();
    }
  });
  doc.addEventListener?.("focusout", (event) => {
    if (event?.relatedTarget === buttons.run) {
      later(refocus);
    }
  });
  let runPressedAt = null;
  buttons.run.addEventListener("click", (event) => {
    call("commitEdits");
    if (blocked(store.get())) {
      fixFirst();
      return;
    }
    runPressedAt = event?.timeStamp ?? null;
    call("run");
  });
  buttons.pause.addEventListener("click", (event) => {
    const { run } = store.get();
    if (run.mode !== "live") {
      return;
    }
    const since =
      (event?.timeStamp ?? Number.NaN) - (runPressedAt ?? Number.NaN);
    runPressedAt = null;
    if (since < RUN_TAP_GUARD_MS) {
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

  // Nothing sticks to the top at any width any more (#241, UX3): on wide
  // screens the bar is the Run panel in the results column, below them the
  // phone dock (#240). So it is not measured for --chrome-top (#200 did,
  // when it stuck to the top on wide screens).
  render(store.get());
  return store.subscribe(({ state, changed }) => {
    if (changed.some((slice) => slice !== "route" && slice !== "moved")) {
      joinable = false;
    }
    if (
      ["run", "batch", "results", "form", "talents", "config", "ran"].some(
        (s) => changed.includes(s),
      )
    ) {
      render(state);
    }
    // Run moved the page to its area (js/views/router.js, #242): said here,
    // with the run's own message when they come together.
    if (changed.includes("moved") && (state.moved ?? null) !== null) {
      announceAlso(`Showing ${areaLabel(state.moved.area)}.`);
    }
  });
}
