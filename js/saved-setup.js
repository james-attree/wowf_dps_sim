// "Remember my setup" (#296, P5-11): the page's one saved setup, kept in
// localStorage so a refresh, or coming back later, shows the fields as they
// were left.
//
//   What     The setup a share link carries (js/build-codec.js): the config
//            (character, weapons, poisons, talents and their level, the
//            rotation, the fight) and the run settings (mode, fight length,
//            fights, the seed in the field). Not results, the combat log or
//            stat weights. The config slice only ever holds a legal config, so
//            a field in error, or a talent build over its level's cap, is not
//            saved: the last legal setup is (Assumption A1).
//   Format   The share link's codec text, "<version>.<base64url JSON>": its
//            version is the save's schema version. It is read leniently
//            (resolveInitialSetup in js/build-codec.js): a newer or broken
//            save is the defaults, a missing field or a section that does not
//            check out is that field's or section's default, and nothing
//            throws.
//   When     On a change to the config or run settings, debounced
//            (ui.saveSetupMs); at once on pagehide or when the tab goes
//            hidden, and at once when a share link was opened on load (the
//            link wins for the visit and becomes the save). It is read once,
//            before the first render (js/main.js).
//   Resets   The stats form's Reset to defaults removes the save as well; each
//            area's own reset (talents' Reset all, say) is an ordinary change
//            and is saved.
//   Storage  Missing, refused (private mode, turned off) or full: every read
//            is null and every write is dropped, silently. The page works as
//            it did before #296.
//   pageshow After back/forward the browser can put its own remembered values
//            back in the inputs after the scripts ran (Chrome does so between
//            load and pageshow), so the inputs would no longer show the build
//            the store holds (Fran's N4 on #299). On every pageshow the inputs
//            are redrawn from the store (redrawInputs), so they and the build
//            come from one source.
//
// No DOM here beyond the window's events, so it runs under node --test.
import { k } from "../data/constants.js";
import { encodeSetup, setupFromState } from "./build-codec.js";

export const SAVED_SETUP_KEY = "wowf_dps_sim.setup";

// The slices a saved setup is made from (setupFromState).
const SAVED_SLICES = ["config", "run"];

// win.localStorage, or null when there is none or reading it throws (some
// browsers throw a SecurityError from the getter when storage is turned off).
export function storageOf(win) {
  try {
    const storage = win?.localStorage;
    return storage !== null && typeof storage === "object" ? storage : null;
  } catch {
    return null;
  }
}

// The saved text, or null: none saved, no storage, or reading threw.
export function readSavedSetup(storage) {
  try {
    const text = storage?.getItem(SAVED_SETUP_KEY) ?? null;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

// Save the store's setup on change. Returns { save, flush, clear, stop }:
// save() writes now; flush() writes a pending change now; clear() removes the
// save, and the next change saves again; stop() ends saving. With no storage
// every call does nothing.
export function createSavedSetup({
  store,
  storage,
  delay = k("ui.saveSetupMs"),
  timers = globalThis,
}) {
  const textOf = () => encodeSetup(setupFromState(store.get()));
  // What storage holds as far as this page knows: nothing is written twice.
  let written = storage === null ? null : readSavedSetup(storage);
  let timer = null;

  const cancel = () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  function save() {
    cancel();
    if (storage === null) return;
    const text = textOf();
    if (text === written) return;
    try {
      storage.setItem(SAVED_SETUP_KEY, text);
      written = text;
    } catch {
      // Full, or refused: the page goes on as it was, and the next change
      // tries again.
    }
  }

  const unsubscribe = store.subscribe(({ changed }) => {
    if (storage === null || !changed.some((s) => SAVED_SLICES.includes(s))) {
      return;
    }
    cancel();
    timer = timers.setTimeout(save, delay);
  });

  return {
    save,
    flush() {
      if (timer !== null) save();
    },
    clear() {
      cancel();
      if (storage === null) return;
      try {
        storage.removeItem(SAVED_SETUP_KEY);
      } catch {
        // Refused: nothing more to do.
      }
      // The setup on screen is not saved until it changes again.
      written = textOf();
    },
    stop() {
      cancel();
      unsubscribe();
    },
  };
}

// Draw every input again from the store, values unchanged: the stats form
// (a new revision refills its fields and the rotation select), the talent
// level, and the run settings. The config is not touched.
export function redrawInputs(store) {
  const state = store.get();
  store.batch(() => {
    if (state.form !== undefined) {
      store.set({
        form: { ...state.form, revision: (state.form.revision ?? 0) + 1 },
      });
    }
    if (state.talents !== undefined) {
      store.set({ talents: { ...state.talents } });
    }
    if (state.run !== undefined) {
      store.set({ run: { ...state.run } });
    }
  });
}

// The page's wiring (js/main.js): save on change; a share link opened on load
// (initial.source "link") is saved at once; leaving the page writes what is
// pending; pageshow redraws the inputs; and the stats form's Reset to
// defaults (form.reset, wrapped in place) clears the save. `win` may be
// missing (a test's stand-in page).
export function mountSavedSetup(
  win,
  store,
  { initial, storage = storageOf(win), delay, timers, form = null } = {},
) {
  const saved = createSavedSetup({ store, storage, delay, timers });
  if (initial?.source === "link") {
    saved.save();
  }
  if (form !== null) {
    const reset = form.reset;
    form.reset = (...args) => {
      const result = reset(...args);
      saved.clear();
      return result;
    };
  }
  const onHide = () => saved.flush();
  const onVisibility = () => {
    if (win.document?.visibilityState === "hidden") saved.flush();
  };
  const onShow = () => redrawInputs(store);
  win?.addEventListener?.("pagehide", onHide);
  win?.document?.addEventListener?.("visibilitychange", onVisibility);
  win?.addEventListener?.("pageshow", onShow);
  return {
    ...saved,
    stop() {
      saved.stop();
      win?.removeEventListener?.("pagehide", onHide);
      win?.document?.removeEventListener?.("visibilitychange", onVisibility);
      win?.removeEventListener?.("pageshow", onShow);
    },
  };
}
