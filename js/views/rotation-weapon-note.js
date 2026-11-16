// The weapon-type mismatch note next to the Rotation preset
// (js/rotation-weapon-mismatch.js). coordinator call 16 Nov
// (James delegated). It is a short accessible line and a Go to Gear
// link; it is not a live region (the preset hint is not either).

const NOTE_ID = "cfg-rotation-weapon-note";
const LINK_ID = "cfg-rotation-weapon-note-gear";
const NONE = 0;

export function createRotationWeaponNoteView(doc, store) {
  const $ = (id) => doc.querySelector(`#${id}`);
  const note = $(NOTE_ID);
  const text = $("cfg-rotation-weapon-note-text");
  const link = $(LINK_ID);
  const select = $("cfg-rotation");
  if (note === null || text === null || link === null || select === null) {
    return () => {};
  }

  function describe(shown) {
    const ids = (select.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((id) => id !== "" && id !== NOTE_ID);
    const next = shown ? [NOTE_ID, ...ids] : ids;
    if (next.length === NONE) {
      select.removeAttribute("aria-describedby");
    } else {
      select.setAttribute("aria-describedby", next.join(" "));
    }
  }

  function render(model) {
    const shown = model !== null && model !== undefined;
    text.textContent = shown ? model.text : "";
    if (shown) {
      link.setAttribute("href", model.href);
    }
    note.hidden = !shown;
    describe(shown);
  }

  render(store.get().weaponMismatch ?? null);
  return store.subscribe(({ state, changed }) => {
    if (changed.includes("weaponMismatch")) {
      render(state.weaponMismatch ?? null);
    }
  });
}
