import { k } from "../../data/constants.js";

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

const NARROW = "(max-width: 520px)";

export function createConfigFormView(doc, store, actions) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const form = $("config-form");
  const talents = $("cfg-talents");
  const rotation = $("cfg-rotation");
  const summaryDetails = $("cfg-summary");
  const summaryName = $("cfg-summary-name");
  const summaryRules = $("cfg-summary-rules");
  const importFile = $("cfg-import-file");
  const importText = $("cfg-import-text");
  const importStatus = $("cfg-import-status");
  const importDetail = $("cfg-import-detail");
  const importDetailText = $("cfg-import-detail-text");
  const statusOk = $("cfg-status-ok");
  const fix = $("cfg-fix");
  const fixHeading = $("cfg-fix-heading");
  const fixList = $("cfg-fix-list");
  // The fields the fix list links to now, as "path path".
  let shownFixKey = "";
  const formError = $("cfg-form-error");
  const runGate = $("cfg-run-gate");
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

  // The summary is closed on a narrow screen (Fran's notes, section 5).
  if (win.matchMedia?.(NARROW).matches) {
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

  function fillValues(values) {
    for (const [path, control] of controls) {
      control.value = formatField(values[path], isPercent(control));
    }
  }

  function drawErrors(errors) {
    for (const [path, control] of controls) {
      const id = fieldId(path);
      const help = control.getAttribute("data-help") ?? "";
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
    const count = fields.length + (backstop === undefined ? 0 : 1);
    statusOk.hidden = count > 0;
    fix.hidden = fields.length === 0;
    fixHeading.textContent = fields.length > 0 ? fixHeadingText(count) : "";
    // Rebuilt only when the list of fields changes: a blur that commits a
    // field must not swap out the link the pointer is pressing.
    const fixKey = fields.map(([path]) => path).join(" ");
    if (fixKey !== shownFixKey) {
      shownFixKey = fixKey;
      fixList.replaceChildren(...fixLinks(fields));
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

  function drawSummary({ name, rules }) {
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
    if (previous === null || state.revision !== previous.revision) {
      fillValues(state.values);
    }
    if (previous === null || state.talentsChoice !== previous.talentsChoice) {
      options(talents, state.talentOptions, state.talentsChoice);
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

  talents.addEventListener("change", () =>
    actions.chooseTalents(talents.value),
  );
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
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("form")) {
      render(state.form);
    }
  });
}
