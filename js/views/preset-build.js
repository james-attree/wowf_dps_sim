// The preset's reference build under the Rotation select (#273): the hint,
// while the build differs from it, and the Starting point link (#323),
// which opens the Start from a preset cards on Character, where a press
// puts the build in (js/views/start-preset.js). js/preset-build.js is the
// model; this draws its `presetBuild` slice's hint.
//
// The hint's id goes first in the select's aria-describedby while it is
// shown, and comes out when it is hidden; it describes the link too.

const HINT_ID = "cfg-preset-build-hint";
const NONE = 0;

export function createPresetBuildView(doc, store) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const box = $("cfg-preset-build");
  const hintText = $(HINT_ID);
  const select = $("cfg-rotation");

  function describe(shown) {
    const ids = (select.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((id) => id !== "" && id !== HINT_ID);
    const next = shown ? [HINT_ID, ...ids] : ids;
    if (next.length === NONE) {
      select.removeAttribute("aria-describedby");
    } else {
      select.setAttribute("aria-describedby", next.join(" "));
    }
  }

  function render(model) {
    const hint = model?.hint ?? null;
    const text = hint?.text ?? "";
    if (hintText.textContent !== text) {
      hintText.textContent = text;
    }
    box.hidden = hint === null;
    describe(hint !== null);
  }

  render(store.get().presetBuild);
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("presetBuild")) {
      render(state.presetBuild);
    }
  });
}
