// A control that keyboard focus reaches shows whole (#245: Fran's #255 check,
// the share textarea under the phone dock, and the half-shown sort buttons
// at a phone table's faded edge). Chrome scrolls to a focused control only
// when none of it shows, so one that is partly under the dock or past the
// fade stays cut. After each keyboard focus this asks for the nearest scroll
// that shows all of it; html's and the table's scroll-padding (styles.css)
// leave out the dock and the fade. A control already in view does not move,
// and a pointer focus never scrolls.
const CONTROLS = "input, select, textarea, button, a[href], summary";

export function keepFocusInView(doc = globalThis.document) {
  const view = doc?.defaultView;
  if (!view || typeof view.requestAnimationFrame !== "function") {
    return () => {};
  }
  const onFocus = (event) => {
    const target = event.target;
    if (
      typeof target?.scrollIntoView !== "function" ||
      !target.matches(CONTROLS) ||
      !target.matches(":focus-visible")
    ) {
      return;
    }
    view.requestAnimationFrame(() => {
      if (doc.activeElement === target) {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  };
  doc.addEventListener("focusin", onFocus);
  return () => doc.removeEventListener("focusin", onFocus);
}

// Focus a field to fix and show its whole wrapper, label to error (#326,
// item 1): a "Fix" link or a blocked Run focused the input alone, so at a
// phone width its error could sit under the dock. The wrapper is the form's
// .field or the run's .run-field; html's scroll-padding leaves out the dock.
// The scroll waits a frame, after the area the field is in is shown.
const FIELD_WRAPPERS = ".field, .run-field";

export function focusField(field) {
  if (field === null || field === undefined) {
    return;
  }
  field.focus?.();
  const doc = field.ownerDocument;
  const view = doc?.defaultView;
  if (typeof view?.requestAnimationFrame !== "function") {
    return;
  }
  view.requestAnimationFrame(() => {
    if (doc.activeElement !== field) {
      return;
    }
    const wrapper = field.closest?.(FIELD_WRAPPERS) ?? field;
    wrapper.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });
}
