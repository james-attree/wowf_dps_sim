import { k } from "../../data/constants.js";
import { NARROW_QUERY } from "./breakpoints.js";
import { fieldErrors } from "./run-model.js";

// The "Fight setup" form (#151, U2). This view owns the form#config-form and
// everything in it, and no other element. It draws the store's `form` slice
// and calls the model's actions (js/config-form.js, which js/main.js hands
// in); it never writes the store itself and imports nothing from the engine
// (#150). Edits apply to the next run: the form writes `config`, and the fight
// on the page keeps the config it started with.
//
// Fields are found from the slice: each key of form.values names one control,
// id "cfg-" plus the path with dots as dashes. A control with data-percent
// shows a chance (0 to 1 in the store) as a percentage: the view writes
// value / 100 and shows formatPercent(value), and converts nowhere else.
//
// Run, Pause, Stop and Reset of the fight are #153's control bar, never this
// form; while the form has errors the footer lists them and says Run is off.
// The footer counts the run bar's field errors too (#155, Fran's Phase 3 QA
// 1), so it never says "Changes apply to the next run" while Run is blocked;
// their links go to the bar's own "Fix" link.

// True when the form's config differs from the one the fight or batch on the
// page started with (run.snapshot, #153): the footer then shows "Edited —
// applies to the next run". Both are in normalizeConfig's full form.
export function editedSinceRun(state) {
  const snapshot = state.run?.snapshot ?? null;
  return (
    snapshot !== null &&
    JSON.stringify(state.config) !== JSON.stringify(snapshot)
  );
}

export const fieldId = (path) => `cfg-${path.replaceAll(".", "-")}`;

// 0.07 * 100 is 7.000000000000001 in JS, so round before showing it.
export function formatPercent(value) {
  return String(+(value * 100).toFixed(4));
}

// The text of a number input as the store value: NaN when it is empty or not
// a number.
export function parseField(text, percent) {
  const trimmed = String(text).trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  return percent ? value / 100 : value;
}

export function formatField(value, percent) {
  if (typeof value !== "number") {
    return value ?? "";
  }
  if (Number.isNaN(value)) {
    return "";
  }
  return percent ? formatPercent(value) : String(value);
}

const plural = (count, one, many) => (count === 1 ? one : many);

// What the footer says while `count` fields need fixing.
export function runGateText(count) {
  return `${count} ${plural(count, "field needs", "fields need")} fixing. Run is disabled.`;
}

export function fixHeadingText(count) {
  return `Fix ${count} ${plural(count, "field", "fields")} to run:`;
}

// The run bar's fields, as the footer names them.
const BAR_FIELD_NAMES = {
  duration: "Run bar, Fight length",
  iterations: "Run bar, Fights",
  seed: "Run bar, Seed",
};

const HANDS = ["mainHand", "offHand"];
const poisonPath = (hand) => `poisons.${hand}`;
const isPoison = (path) => path.startsWith("poisons.");
const capitalised = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// The lines under a poison select (#152, Fran's notes section 2), from the
// model's poisonInfo(): the numbers of the rank the engine simulates.
export function poisonRankText({ rank, highest }) {
  return `Rank ${rank}${highest ? " (highest)" : ""}`;
}

export function poisonEffectText({ chance, effect }) {
  const onHit = `${formatPercent(chance)}% on hit`;
  const school = capitalised(effect.school ?? "");
  const stacks = effect.maxStacks > 1 ? `, stacks ×${effect.maxStacks}` : "";
  switch (effect.kind) {
    case "damage":
      return `${onHit} · ${effect.min}–${effect.max} ${school}`;
    case "dot":
      return `${onHit} · ${effect.damage} ${school} over ${effect.duration} s${stacks}`;
    case "slow":
      return `${onHit} · movement ${formatPercent(effect.fraction)}% slower for ${effect.duration} s`;
    case "castSlow":
      return `${onHit} · casting ${formatPercent(effect.fraction)}% slower for ${effect.duration} s`;
    case "healingReduction":
      return `${onHit} · healing taken −${effect.amount} for ${effect.duration} s${stacks}`;
    default:
      return onHit;
  }
}

// "Not simulated yet: it slows …": the reason from its colon on. Only a
// poison the sim does not simulate has a reason.
export function poisonNoteText({ noDpsReason }) {
  if (noDpsReason === null) {
    return "";
  }
  const colon = noDpsReason.indexOf(":");
  const reason = (colon < 0 ? noDpsReason : noDpsReason.slice(colon + 1))
    .trim()
    .replace(/\.?$/, ".");
  return `Not simulated yet: ${reason}`;
}

export function createConfigFormView(doc, store, actions) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const form = $("config-form");
  const rotation = $("cfg-rotation");
  const summaryDetails = $("cfg-summary");
  const summaryName = $("cfg-summary-name");
  const summaryStale = $("cfg-summary-stale");
  const summaryRules = $("cfg-summary-rules");
  const importFile = $("cfg-import-file");
  const importText = $("cfg-import-text");
  const importStatus = $("cfg-import-status");
  const importDetail = $("cfg-import-detail");
  const importDetailText = $("cfg-import-detail-text");
  const importWarnings = $("cfg-import-warnings");
  const importWarningsText = $("cfg-import-warnings-text");
  const statusOk = $("cfg-status-ok");
  const fix = $("cfg-fix");
  const fixHeading = $("cfg-fix-heading");
  const fixList = $("cfg-fix-list");
  // The fields the fix list links to now, as "path path".
  let shownFixKey = "";
  const formError = $("cfg-form-error");
  const runGate = $("cfg-run-gate");
  // The run bar's fields with an error that blocks Run, in the bar's order.
  // A page without a run bar (the form's own tests) has none.
  const barErrorsOf = (state) =>
    state.run === undefined ? [] : fieldErrors(state.run);
  let barErrors = barErrorsOf(store.get());
  const toast = $("cfg-toast");
  const toastText = $("cfg-toast-text");
  const undo = $("cfg-undo");
  const win = doc.defaultView ?? globalThis;

  const paths = Object.keys(store.get().form.values);
  const controls = new Map(paths.map((path) => [path, $(fieldId(path))]));
  const isPercent = (control) => control.getAttribute("data-percent") !== null;
  const readControl = (path) => {
    const control = controls.get(path);
    return control.tagName === "SELECT"
      ? control.value
      : parseField(control.value, isPercent(control));
  };

  // The summary is closed on a narrow screen (Fran's notes, section 5): below
  // 520 px, the same breakpoint as the run bar (js/views/breakpoints.js).
  if (win.matchMedia?.(NARROW_QUERY).matches) {
    summaryDetails.open = false;
  }

  function options(select, list, selected) {
    select.replaceChildren(
      ...list.map(({ id, label }) => {
        const option = doc.createElement("option");
        option.value = id;
        option.textContent = label;
        return option;
      }),
    );
    select.value = selected;
  }

  // The poison selects' options, once: None, then an optgroup each for the
  // simulated poisons and the rest. A value is the config id ("instant").
  function poisonSelects({ simulated, notSimulated }) {
    const option = ({ id, label }) => {
      const element = doc.createElement("option");
      element.value = id;
      element.textContent = label;
      return element;
    };
    const group = (label, list) => {
      const element = doc.createElement("optgroup");
      element.setAttribute("label", label);
      element.replaceChildren(...list.map(option));
      return element;
    };
    for (const hand of HANDS) {
      controls
        .get(poisonPath(hand))
        ?.replaceChildren(
          option({ id: "", label: "None" }),
          group("Simulated", simulated),
          group("Not simulated yet", notSimulated),
        );
    }
  }

  // A poison select's description ids: rank and effect while a poison is on,
  // charges for a simulated one, the note while it shows.
  function poisonDescription(path, info) {
    if (info === null) {
      return "";
    }
    const id = fieldId(path);
    return [
      `${id}-rank`,
      `${id}-effect`,
      info.simulated ? `${id}-charges` : "",
      poisonNoteText(info) === "" ? "" : `${id}-note`,
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  function drawPoisons(poisons) {
    for (const hand of HANDS) {
      const path = poisonPath(hand);
      if (!controls.has(path)) {
        continue;
      }
      const id = fieldId(path);
      const info = poisons?.[hand] ?? null;
      const on = info !== null;
      const note = on ? poisonNoteText(info) : "";
      $(`${id}-rank`).textContent = on ? poisonRankText(info) : "";
      $(`${id}-rank`).hidden = !on;
      $(`${id}-effect`).textContent = on ? poisonEffectText(info) : "";
      $(`${id}-line`).hidden = !on;
      $(`${id}-charges`).hidden = !on || !info.simulated;
      $(`${id}-note-text`).textContent = note;
      $(`${id}-note`).hidden = note === "";
      $(`${id}-tooltip-text`).textContent = on ? info.text : "";
      $(`${id}-tooltip`).hidden = !on;
    }
  }

  function fillValues(values) {
    for (const [path, control] of controls) {
      control.value = formatField(values[path], isPercent(control));
    }
  }

  function drawErrors(errors) {
    for (const [path, control] of controls) {
      const id = fieldId(path);
      const help = isPoison(path)
        ? poisonDescription(
            path,
            drawn?.poisons?.[path.slice("poisons.".length)] ?? null,
          )
        : (control.getAttribute("data-help") ?? "");
      const message = errors[path];
      const error = $(`${id}-error`);
      if (path in errors) {
        control.setAttribute("aria-invalid", "true");
      } else {
        control.removeAttribute("aria-invalid");
      }
      if (typeof message === "string") {
        const mark = doc.createElement("span");
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "⚠ ";
        error.replaceChildren(mark, message);
        error.hidden = false;
      } else {
        error.replaceChildren();
        error.hidden = true;
      }
      const describedBy = [
        help,
        typeof message === "string" ? `${id}-error` : "",
      ]
        .filter((part) => part !== "")
        .join(" ");
      if (describedBy === "") {
        control.removeAttribute("aria-describedby");
      } else {
        control.setAttribute("aria-describedby", describedBy);
      }
    }

    const fields = Object.entries(errors).filter(
      ([path, message]) => controls.has(path) && message !== null,
    );
    const backstop = Object.entries(errors).find(
      ([path]) => !controls.has(path),
    );
    const count =
      fields.length + (backstop === undefined ? 0 : 1) + barErrors.length;
    const listed = fields.length + barErrors.length;
    statusOk.hidden = count > 0;
    fix.hidden = listed === 0;
    fixHeading.textContent = listed > 0 ? fixHeadingText(count) : "";
    // Rebuilt only when the list of fields changes: a blur that commits a
    // field must not swap out the link the pointer is pressing.
    const fixKey = [...fields.map(([path]) => path), ...barErrors].join(" ");
    if (fixKey !== shownFixKey) {
      shownFixKey = fixKey;
      fixList.replaceChildren(...fixLinks(fields), ...barLinks(barErrors));
    }
    formError.hidden = backstop === undefined;
    formError.textContent = backstop === undefined ? "" : backstop[1];
    const gate = count > 0 ? runGateText(count) : "";
    if (runGate.textContent !== gate) {
      runGate.textContent = gate;
    }
  }

  // One link per field to fix; following it focuses the field.
  function fixLinks(fields) {
    return fields.map(([path]) => {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      const control = controls.get(path);
      link.href = `#${fieldId(path)}`;
      link.textContent = fieldName(path);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        control.focus();
      });
      item.append(link);
      return item;
    });
  }

  // One link per run bar field to fix. The bar is not this view's (#150), so
  // the link only goes to the bar's own "Fix" link, which opens the bar's
  // settings and focuses the field.
  function barLinks(names) {
    return names.map((name) => {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      link.href = "#run-errors-link";
      link.textContent = BAR_FIELD_NAMES[name];
      item.append(link);
      return item;
    });
  }

  // "Main hand, Max damage": the field's legend and label, as a link's text.
  function fieldName(path) {
    const label = doc.querySelector(`label[for="${fieldId(path)}"]`);
    const own = label?.firstChild?.textContent ?? path;
    const hand = path.startsWith("weapons.mainHand")
      ? "Main hand, "
      : path.startsWith("weapons.offHand")
        ? "Off hand, "
        : "";
    return `${hand}${String(own).trim()}`;
  }

  // D19 (U7): while the rotation draft has errors the summary is of its last
  // valid version, the one a run would use, and the note above it says so.
  function drawStale(stale) {
    if (summaryStale === null) {
      return;
    }
    summaryStale.hidden = stale === null || stale === undefined;
    if (summaryStale.hidden) {
      summaryStale.replaceChildren();
      return;
    }
    const lead = doc.createElement("strong");
    lead.textContent = "Last valid version. ";
    summaryStale.replaceChildren(lead, stale);
  }

  function drawSummary({ name, rules, stale }) {
    drawStale(stale);
    summaryName.textContent = name;
    summaryRules.replaceChildren(
      ...rules.map((rule) => {
        const item = doc.createElement("li");
        item.textContent = rule;
        return item;
      }),
    );
  }

  function drawImport(status) {
    importStatus.textContent = status?.message ?? "";
    importStatus.classList.toggle("is-error", status?.ok === false);
    const failed = status?.ok === false && status.detail !== "";
    importDetail.hidden = !failed;
    importDetailText.textContent = failed ? status.detail : "";
    // Warnings (issue #189) are shown the way errors are, but never block:
    // the rotation was imported.
    const warned = status?.ok === true && (status.warnings ?? "") !== "";
    importStatus.classList.toggle("is-warning", warned);
    importWarnings.hidden = !warned;
    importWarningsText.textContent = warned ? status.warnings : "";
  }

  let toastTimer = null;
  function hideToast() {
    win.clearTimeout?.(toastTimer);
    toastTimer = null;
    toastText.textContent = "";
    undo.hidden = true;
    toast.classList.toggle("is-shown", false);
  }
  function showToast() {
    hideToast();
    toastText.textContent = "Defaults restored";
    undo.hidden = false;
    toast.classList.toggle("is-shown", true);
    toastTimer = win.setTimeout?.(hideToast, k("ui.undoToastSeconds") * 1000);
  }

  let drawn = null;
  function render(state) {
    const previous = drawn;
    drawn = state;
    if (previous === null) {
      poisonSelects(state.poisonOptions);
    }
    if (previous === null || state.revision !== previous.revision) {
      fillValues(state.values);
    }
    if (previous === null || state.poisons !== previous.poisons) {
      drawPoisons(state.poisons);
    }
    if (
      previous === null ||
      state.rotationOptions !== previous.rotationOptions ||
      state.rotationChoice !== previous.rotationChoice
    ) {
      options(rotation, state.rotationOptions, state.rotationChoice);
    }
    if (previous === null || state.summary !== previous.summary) {
      drawSummary(state.summary);
    }
    // A commit always gives new errors, so a new poison redraws the
    // descriptions here too.
    if (previous === null || state.errors !== previous.errors) {
      drawErrors(state.errors);
    }
    if (previous === null || state.importStatus !== previous.importStatus) {
      drawImport(state.importStatus);
    }
    if (state.canUndo && !previous?.canUndo) {
      showToast();
    } else if (!state.canUndo && previous?.canUndo) {
      hideToast();
    }
  }

  for (const [path, control] of controls) {
    if (control.tagName !== "SELECT") {
      control.addEventListener("input", () =>
        actions.input(path, readControl(path)),
      );
    }
    control.addEventListener("change", () =>
      actions.change(path, readControl(path)),
    );
  }

  // No submit: Run is #153's. Enter commits the field it was pressed in.
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.target?.tagName !== "INPUT") {
      return;
    }
    event.preventDefault();
    const path = event.target.getAttribute("data-field");
    if (controls.has(path)) {
      actions.change(path, readControl(path));
    }
  });

  rotation.addEventListener("change", () =>
    actions.chooseRotation(rotation.value),
  );

  $("cfg-export").addEventListener("click", () => {
    const { fileName, text } = actions.exportRotation();
    const url = win.URL.createObjectURL(
      new win.Blob([text], { type: "application/json" }),
    );
    const link = doc.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 0);
  });

  importFile.addEventListener("change", async () => {
    const [file] = importFile.files ?? [];
    if (file === undefined) {
      return;
    }
    const text = await file.text();
    importFile.value = "";
    actions.importText(text);
  });
  $("cfg-import-paste").addEventListener("click", () => {
    if (actions.importText(importText.value)) {
      importText.value = "";
    }
  });

  $("cfg-reset").addEventListener("click", () => actions.reset());
  undo.addEventListener("click", () => {
    actions.undo();
    hideToast();
  });

  render(store.get().form);
  const edited = $("cfg-edited");
  const drawEdited = (state) => {
    edited.hidden = !editedSinceRun(state);
  };
  drawEdited(store.get());
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("form")) {
      render(state.form);
    }
    if (changed.includes("config") || changed.includes("run")) {
      drawEdited(state);
    }
    const nowBar = barErrorsOf(state);
    if (nowBar.join(" ") !== barErrors.join(" ")) {
      barErrors = nowBar;
      drawErrors(state.form.errors);
    }
  });
}
