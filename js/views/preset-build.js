// The preset's reference build under the Rotation select (#273): the hint,
// its button and, after a press, the line that says what was set, with
// Undo. js/preset-build.js is the model; this draws its `presetBuild`
// slice and hands the presses back. The announcement is the Run bar's
// (#run-announce, js/views/controls.js): neither line is a live region.
//
// The hint's id goes first in the select's aria-describedby while it is
// shown, and comes out when it is hidden. Focus goes to Undo after the
// button, and back to the button after Undo (to the select when there is
// no hint left).

const HINT_ID = "cfg-preset-build-hint";

export function createPresetBuildView(doc, store, actions) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const box = $("cfg-preset-build");
  const offer = $("cfg-preset-build-offer");
  const hintText = $(HINT_ID);
  const button = $("cfg-preset-build-apply");
  const applied = $("cfg-preset-build-applied");
  const appliedText = $("cfg-preset-build-done");
  const undo = $("cfg-preset-build-undo");
  const select = $("cfg-rotation");

  const write = (node, text) => {
    if (node.textContent !== text) {
      node.textContent = text;
    }
  };

  function describe(shown) {
    const ids = (select.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((id) => id !== "" && id !== HINT_ID);
    const next = shown ? [HINT_ID, ...ids] : ids;
    if (next.length === 0) {
      select.removeAttribute("aria-describedby");
    } else {
      select.setAttribute("aria-describedby", next.join(" "));
    }
  }

  let lastFocus = null;
  function render(model) {
    const hint = model?.hint ?? null;
    const done = model?.applied ?? null;
    offer.hidden = hint === null;
    write(hintText, hint?.text ?? "");
    write(button, hint?.label ?? "");
    applied.hidden = done === null;
    write(appliedText, done?.text ?? "");
    if (done === null) {
      undo.removeAttribute("aria-label");
    } else {
      undo.setAttribute("aria-label", done.undoName);
    }
    box.hidden = hint === null && done === null;
    describe(hint !== null);

    const focus = model?.focus ?? null;
    if (focus !== null && focus.seq !== lastFocus) {
      const target = { undo, button, select }[focus.target] ?? select;
      if (!target.closest?.("[hidden]")) {
        target.focus?.();
      }
    }
    lastFocus = focus?.seq ?? lastFocus;
  }

  button.addEventListener("click", () => actions.apply());
  undo.addEventListener("click", () => actions.undo());

  render(store.get().presetBuild);
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("presetBuild")) {
      render(state.presetBuild);
    }
  });
}
