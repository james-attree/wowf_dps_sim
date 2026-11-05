// #296 (P5-11): "Remember my setup". The page's one saved setup in
// localStorage (js/saved-setup.js): what is saved and when, the codec text it
// is kept as (js/build-codec.js, the share link's format, read leniently), a
// save that is old, newer, broken or missing a field, storage that throws or
// is missing, Reset to defaults, and the inputs redrawn from the store on
// pageshow (Fran's N4 from #299: back/forward).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  LINK_VERSION,
  SETUP_VERSION,
  SETUP_ERA,
  decodeSetup,
  encodeSetup,
  resolveInitialSetup,
  setupDefaults,
  setupFromState,
} from "../js/build-codec.js";
import { createConfigForm } from "../js/config-form.js";
import { referenceBuild } from "../data/reference-build.js";
import {
  SAVED_SETUP_KEY,
  createSavedSetup,
  mountSavedSetup,
  readSavedSetup,
  redrawInputs,
  storageOf,
} from "../js/saved-setup.js";
import { createStore } from "../js/store.js";

const DELAY = k("ui.saveSetupMs");

// A Map-backed Storage. `fail` names the methods that throw (a quota error,
// private mode, storage turned off).
function memoryStorage(initial = {}, fail = []) {
  const items = new Map(Object.entries(initial));
  const thrower = (name) => () => {
    const error = new Error(`${name} refused`);
    error.name = "QuotaExceededError";
    throw error;
  };
  return {
    items,
    writes: 0,
    getItem: fail.includes("getItem")
      ? thrower("getItem")
      : (key) => (items.has(key) ? items.get(key) : null),
    setItem: fail.includes("setItem")
      ? thrower("setItem")
      : function (key, value) {
          this.writes += 1;
          items.set(key, String(value));
        },
    removeItem: fail.includes("removeItem")
      ? thrower("removeItem")
      : (key) => {
          items.delete(key);
        },
  };
}

// Timers run by hand: advance(ms) runs what is due.
function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map();
  return {
    setTimeout(fn, ms) {
      const id = next++;
      due.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      due.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, { fn, at }] of [...due]) {
        if (at <= now) {
          due.delete(id);
          fn();
        }
      }
    },
    get pending() {
      return due.size;
    },
  };
}

// The page's store slices the save reads (js/main.js), from a setup.
function pageStore(setup = setupDefaults()) {
  const { mode, duration, iterations } = setup.run;
  const seed = setup.run.seed ?? 7;
  return createStore({
    config: setup.config,
    run: {
      mode,
      state: "idle",
      seed,
      duration,
      iterations,
      fields: {
        duration: String(duration),
        iterations: String(iterations),
        seed: String(seed),
      },
      errors: {},
    },
    frame: 0,
    results: { time: 0, damage: 0 },
  });
}

const withHaste = (store, haste) => {
  const { config } = store.get();
  store.set({
    config: { ...config, character: { ...config.character, haste } },
  });
};

const savedOf = (storage) => storage.items.get(SAVED_SETUP_KEY) ?? null;
const readBack = (text) =>
  resolveInitialSetup({ search: "", saved: text }).setup;

describe("#296: where the setup is kept", () => {
  it("is one localStorage key holding the share link's codec text", () => {
    assert.equal(SAVED_SETUP_KEY, "wowf_dps_sim.setup");
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    withHaste(store, 0.05);
    timers.advance(DELAY);
    const text = savedOf(storage);
    assert.match(text, new RegExp(`^${SETUP_VERSION}\\.[\\w-]*$`));
    assert.equal(text, encodeSetup(setupFromState(store.get())));
    saved.stop();
  });

  it("storageOf gives null when localStorage is missing or its getter throws", () => {
    assert.equal(storageOf(undefined), null);
    assert.equal(storageOf({}), null);
    const blocked = {};
    Object.defineProperty(blocked, "localStorage", {
      get() {
        throw new Error("SecurityError: access is denied");
      },
    });
    assert.equal(storageOf(blocked), null);
    const storage = memoryStorage();
    assert.equal(storageOf({ localStorage: storage }), storage);
  });

  it("readSavedSetup gives the text, or null when there is none or reading throws", () => {
    assert.equal(readSavedSetup(null), null);
    assert.equal(readSavedSetup(memoryStorage()), null);
    assert.equal(
      readSavedSetup(memoryStorage({ [SAVED_SETUP_KEY]: "1.e30" })),
      "1.e30",
    );
    assert.equal(readSavedSetup(memoryStorage({}, ["getItem"])), null);
  });
});

describe("#296: saving on change, debounced", () => {
  it("saves a config change once the delay has passed, and only once for a burst", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    withHaste(store, 0.01);
    timers.advance(DELAY - 1);
    assert.equal(storage.writes, 0, "nothing before the delay");
    withHaste(store, 0.02);
    withHaste(store, 0.03);
    timers.advance(DELAY - 1);
    assert.equal(storage.writes, 0, "each change restarts the delay");
    timers.advance(1);
    assert.equal(storage.writes, 1);
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.03);
    saved.stop();
  });

  it("saves the run settings: mode, length, fights and the seed in the field", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    store.set({
      run: {
        ...store.get().run,
        mode: "live",
        duration: 120,
        iterations: 250,
        seed: 424242,
      },
    });
    timers.advance(DELAY);
    assert.deepEqual(readBack(savedOf(storage)).run, {
      mode: "live",
      duration: 120,
      iterations: 250,
      seed: 424242,
    });
    saved.stop();
  });

  it("does not save results, frames or a run's state, and does not write an unchanged setup", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    store.set({ frame: 1, results: { time: 3, damage: 900 } });
    timers.advance(DELAY);
    assert.equal(storage.writes, 0);
    withHaste(store, 0.04);
    timers.advance(DELAY);
    assert.equal(storage.writes, 1);
    store.set({ run: { ...store.get().run, state: "running" } });
    timers.advance(DELAY);
    assert.equal(storage.writes, 1, "the same setup is not written again");
    const text = savedOf(storage);
    assert.equal(decodeSetup(text).setup.config.character.haste, 0.04);
    assert.equal(text.includes("results"), false);
    saved.stop();
  });

  it("save() writes now (a share link opened on load), flush() writes what is pending", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    saved.save();
    assert.equal(savedOf(storage), encodeSetup(setupFromState(store.get())));
    withHaste(store, 0.02);
    saved.flush();
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.02);
    assert.equal(timers.pending, 0, "the pending write was the flushed one");
    saved.flush();
    assert.equal(storage.writes, 2, "nothing pending, nothing written");
    saved.stop();
  });

  it("stop() ends saving", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    withHaste(store, 0.02);
    saved.stop();
    timers.advance(DELAY);
    withHaste(store, 0.03);
    timers.advance(DELAY);
    assert.equal(storage.writes, 0);
  });
});

describe("#296 (G4): storage that throws or is missing changes nothing on the page", () => {
  it("a write that throws (quota, private mode) is swallowed and tried again on the next change", () => {
    const storage = memoryStorage({}, ["setItem", "removeItem"]);
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    withHaste(store, 0.02);
    assert.doesNotThrow(() => timers.advance(DELAY));
    assert.doesNotThrow(() => saved.save());
    assert.doesNotThrow(() => saved.flush());
    assert.doesNotThrow(() => saved.clear());
    assert.equal(store.get().config.character.haste, 0.02);
    saved.stop();
  });

  it("no storage at all: every call is a no-op", () => {
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage: null, timers });
    withHaste(store, 0.02);
    timers.advance(DELAY);
    assert.doesNotThrow(() => {
      saved.save();
      saved.flush();
      saved.clear();
    });
    assert.equal(timers.pending, 0, "nothing is even scheduled");
    saved.stop();
  });
});

describe("#296 (G4): what a saved setup reads as", () => {
  const busy = () => {
    const d = setupDefaults();
    return {
      config: {
        ...d.config,
        character: { ...d.config.character, haste: 0.05, attackPower: 900 },
        // Keep talentLevel 60: a 51-point build at 40 is illegal and the
        // codec reads the level back as its default (#326 / #333).
        talentLevel: 60,
      },
      run: { ...d.run, mode: "live", duration: 120, seed: 99 },
    };
  };

  it("a save reads back as the setup it was", () => {
    const setup = busy();
    assert.deepEqual(readBack(encodeSetup(setup)), setup);
  });

  it("no save (absent) is the defaults", () => {
    assert.deepEqual(
      resolveInitialSetup({ search: "", saved: null }).setup,
      setupDefaults(),
    );
  });

  it("a newer version, an older one, or a value that is not the codec's, is the defaults", () => {
    const body = encodeSetup(busy()).split(".")[1];
    for (const text of [
      `${LINK_VERSION + 1}.${body}`,
      `0.${body}`,
      "",
      "{}",
      '{"config":{}}',
      `${SETUP_VERSION}.`,
      `${SETUP_VERSION}.!!!`,
      `${SETUP_VERSION}.${Buffer.from("[1,2]").toString("base64url")}`,
      `${SETUP_VERSION}.${Buffer.from("not json").toString("base64url")}`,
    ]) {
      assert.deepEqual(readBack(text), setupDefaults(), text);
    }
  });

  it("a missing field is its default; the rest of the save is kept", () => {
    const setup = busy();
    const payload = JSON.parse(
      Buffer.from(encodeSetup(setup).split(".")[1], "base64url").toString(),
    );
    delete payload.config.character.attackPower;
    delete payload.run.duration;
    const text = `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const read = readBack(text);
    const d = setupDefaults();
    assert.equal(
      read.config.character.attackPower,
      d.config.character.attackPower,
    );
    assert.equal(read.config.character.haste, 0.05);
    assert.equal(read.config.talentLevel, 60);
    assert.equal(read.run.duration, d.run.duration);
    assert.equal(read.run.mode, "live");
    assert.equal(read.run.seed, 99);
  });

  it("an unknown field is ignored; a field that does not check out is its default (#326)", () => {
    const payload = {
      era: SETUP_ERA,
      future: { anything: true },
      config: {
        character: { haste: "fast", attackPower: 900 },
        // Empty talents so level 40 is legal under the 51-point page default (#333).
        talents: {},
        talentLevel: 40,
        later: 1,
      },
      run: { duration: -5, mode: "live", extra: true },
    };
    const text = `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const read = readBack(text);
    const d = setupDefaults();
    // #326 item 13: only the bad field resets, not its whole section.
    assert.deepEqual(read.config.character, {
      ...d.config.character,
      attackPower: 900,
    });
    assert.equal(read.config.talentLevel, 40);
    assert.equal(read.run.duration, d.run.duration);
    assert.equal(read.run.mode, "live");
  });

  it("over the cap: a 51-point build saved with level 40 keeps the build and reads the level as its default (60)", () => {
    const build = { talents: { ...referenceBuild() } };
    const d = setupDefaults();
    const payload = {
      era: SETUP_ERA,
      config: { talents: build.talents, talentLevel: 40 },
    };
    const text = `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const read = readBack(text);
    assert.deepEqual(read.config.talents, build.talents);
    assert.equal(read.config.talentLevel, d.config.talentLevel);
    // The same text as a share link is refused whole (strict): nothing loads.
    assert.equal(decodeSetup(text, { strict: true }).status, "invalid");
  });

  it("a share link in the address wins over the save for the visit", () => {
    const linked = busy();
    const saved = encodeSetup({
      ...setupDefaults(),
      config: { ...setupDefaults().config, talentLevel: 30 },
    });
    const first = resolveInitialSetup({
      search: `?s=${encodeSetup(linked)}`,
      saved,
    });
    assert.equal(first.source, "link");
    assert.deepEqual(first.setup, linked);
  });
});

describe("#296 (#318 prep): weapon skill, enemy level and pinned armour round-trip", () => {
  // Save the store's setup, reload it the way the page does (resolveInitialSetup
  // on the saved text), and check it is the same setup. null first (the
  // default: follow the level), then a number, then back to null.
  const roundTrip = (section, field, values) => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    const seen = [];
    for (const value of values) {
      const { config } = store.get();
      store.set({
        config: {
          ...config,
          [section]: { ...config[section], [field]: value },
        },
      });
      saved.flush();
      const text = savedOf(storage);
      const back = readBack(text);
      assert.deepEqual(back, setupFromState(store.get()), `${field} ${value}`);
      assert.equal(back.config[section][field], value);
      // The same text as a share link (strict) reads the same.
      const link = decodeSetup(text);
      assert.equal(link.status, "ok");
      assert.deepEqual(link.setup, back);
      seen.push(back.config[section][field]);
    }
    saved.stop();
    return seen;
  };

  it("config.character.weaponSkill: null, a number, and back to null", () => {
    assert.equal(setupDefaults().config.character.weaponSkill, null);
    assert.deepEqual(
      roundTrip("character", "weaponSkill", [null, 305, 1, null]),
      [null, 305, 1, null],
    );
  });

  it("config.target.level: null, a number, and back to null", () => {
    assert.equal(setupDefaults().config.target.level, null);
    assert.deepEqual(roundTrip("target", "level", [null, 62, 63, null]), [
      null,
      62,
      63,
      null,
    ]);
  });

  it("config.target.armor (#317's pin): the codec carries it; null, a number, 0 and back to null", () => {
    assert.equal(setupDefaults().config.target.armor, null);
    assert.deepEqual(roundTrip("target", "armor", [null, 3731, 0, null]), [
      null,
      3731,
      0,
      null,
    ]);
  });

  it("all three together, at a lower talent level, survive the save and reload", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    const { config } = store.get();
    store.set({
      config: {
        ...config,
        talentLevel: 40,
        talents: {},
        character: { ...config.character, weaponSkill: 210 },
        target: { ...config.target, level: 44, armor: 1500 },
      },
    });
    timers.advance(DELAY);
    const back = readBack(savedOf(storage));
    assert.deepEqual(back, setupFromState(store.get()));
    assert.equal(back.config.talentLevel, 40);
    assert.equal(back.config.character.weaponSkill, 210);
    assert.deepEqual(back.config.target, {
      behind: true,
      level: 44,
      armor: 1500,
    });
    saved.stop();
  });
});

describe("#296: Reset to defaults clears the save; an area's own reset saves", () => {
  it("clear() removes the key, drops the pending write, and the next change saves again", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    withHaste(store, 0.02);
    timers.advance(DELAY);
    assert.notEqual(savedOf(storage), null);
    withHaste(store, 0.03);
    saved.clear();
    timers.advance(DELAY);
    assert.equal(savedOf(storage), null, "cleared, and nothing written after");
    withHaste(store, 0.04);
    timers.advance(DELAY);
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.04);
    saved.stop();
  });

  it("the stats form's Reset to defaults leaves no save; Undo saves the setup it puts back", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const saved = mountSavedSetup(null, store, {
      initial: { source: "defaults" },
      storage,
      timers,
      form,
    });
    form.change("character.haste", 0.05);
    timers.advance(DELAY);
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.05);
    form.reset();
    timers.advance(DELAY);
    assert.equal(savedOf(storage), null);
    assert.deepEqual(
      resolveInitialSetup({ saved: readSavedSetup(storage) }).setup.config,
      setupDefaults().config,
    );
    form.undo();
    timers.advance(DELAY);
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.05);
    saved.stop();
  });
});

describe("#296 ruling A2: Reset to defaults resets the run settings too, and Undo puts them back", () => {
  // A stand-in for js/run-actions.js resetSettings and restoreSettings.
  const runSettings = (store) => {
    const calls = [];
    return {
      calls,
      resetSettings() {
        calls.push("reset");
        const { run } = store.get();
        const before = { mode: run.mode, duration: run.duration };
        store.set({ run: { ...run, mode: "batch", duration: 300 } });
        return before;
      },
      restoreSettings(before) {
        calls.push("restore");
        store.set({ run: { ...store.get().run, ...before } });
        return true;
      },
    };
  };
  const mount = (store, storage, timers, form, run) =>
    mountSavedSetup(null, store, {
      initial: { source: "defaults" },
      storage,
      timers,
      form,
      runSettings: run,
    });

  it("Reset to defaults resets the run settings, and leaves no save", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const run = runSettings(store);
    const saved = mount(store, storage, timers, form, run);
    store.set({ run: { ...store.get().run, mode: "live", duration: 60 } });
    form.change("character.haste", 0.05);
    timers.advance(DELAY);
    form.reset();
    timers.advance(DELAY);
    assert.deepEqual(run.calls, ["reset"]);
    assert.equal(store.get().run.mode, "batch");
    assert.equal(store.get().run.duration, 300);
    assert.equal(
      store.get().config.character.haste,
      setupDefaults().config.character.haste,
    );
    assert.equal(savedOf(storage), null);
    saved.stop();
  });

  it("Undo puts back the run settings with the config, and saves them", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const run = runSettings(store);
    const saved = mount(store, storage, timers, form, run);
    store.set({ run: { ...store.get().run, mode: "live", duration: 60 } });
    form.change("character.haste", 0.05);
    form.reset();
    assert.equal(form.undo(), true);
    timers.advance(DELAY);
    assert.deepEqual(run.calls, ["reset", "restore"]);
    assert.equal(store.get().run.mode, "live");
    assert.equal(store.get().run.duration, 60);
    const back = readBack(savedOf(storage));
    assert.equal(back.config.character.haste, 0.05);
    assert.equal(back.run.mode, "live");
    assert.equal(back.run.duration, 60);
    saved.stop();
  });

  it("Undo leaves run settings changed since the Reset alone, and an Undo with nothing to undo restores nothing", () => {
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const run = runSettings(store);
    const saved = mount(store, memoryStorage(), timers, form, run);
    store.set({ run: { ...store.get().run, mode: "live", duration: 60 } });
    form.reset();
    store.set({ run: { ...store.get().run, duration: 90 } });
    assert.equal(form.undo(), true);
    assert.deepEqual(
      run.calls,
      ["reset"],
      "the run settings were edited after the Reset",
    );
    assert.equal(store.get().run.duration, 90);
    assert.equal(form.undo(), false);
    assert.deepEqual(run.calls, ["reset"]);
    saved.stop();
  });

  it("a Reset while a run is on (resetSettings gives null) resets the config only, and Undo restores the config only", () => {
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const calls = [];
    const run = {
      resetSettings: () => (calls.push("reset"), null),
      restoreSettings: () => (calls.push("restore"), true),
    };
    const saved = mount(store, memoryStorage(), timers, form, run);
    form.change("character.haste", 0.05);
    form.reset();
    assert.equal(form.undo(), true);
    assert.deepEqual(calls, ["reset"]);
    assert.equal(store.get().config.character.haste, 0.05);
    saved.stop();
  });
});

describe("#296: on load, on leaving and on pageshow", () => {
  // A window stand-in: an event target with a document.
  function fakeWindow() {
    const target = new globalThis.EventTarget();
    target.document = new globalThis.EventTarget();
    target.document.visibilityState = "visible";
    return target;
  }

  it("a share link opened on load is saved at once as the new setup", () => {
    const storage = memoryStorage({ [SAVED_SETUP_KEY]: "1.e30" });
    const store = pageStore();
    withHaste(store, 0.05);
    const timers = fakeTimers();
    const saved = mountSavedSetup(fakeWindow(), store, {
      initial: { source: "link" },
      storage,
      timers,
    });
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.05);
    saved.stop();
  });

  it("a saved setup or the defaults on load write nothing until a change", () => {
    for (const source of ["saved", "defaults"]) {
      const storage = memoryStorage();
      const saved = mountSavedSetup(fakeWindow(), pageStore(), {
        initial: { source },
        storage,
        timers: fakeTimers(),
      });
      assert.equal(storage.writes, 0, source);
      saved.stop();
    }
  });

  it("pagehide and the page going hidden write a pending change at once", () => {
    for (const leave of ["pagehide", "hidden"]) {
      const storage = memoryStorage();
      const store = pageStore();
      const win = fakeWindow();
      const saved = mountSavedSetup(win, store, {
        initial: { source: "defaults" },
        storage,
        timers: fakeTimers(),
      });
      withHaste(store, 0.02);
      if (leave === "pagehide") {
        win.dispatchEvent(new globalThis.Event("pagehide"));
      } else {
        win.document.visibilityState = "hidden";
        win.document.dispatchEvent(new globalThis.Event("visibilitychange"));
      }
      assert.equal(readBack(savedOf(storage)).config.character.haste, 0.02);
      saved.stop();
    }
  });

  it("pageshow redraws the inputs from the store: a new form revision and new talents and run slices, with the same values", () => {
    const store = pageStore();
    const form = createConfigForm(store);
    store.set({ talents: { level: 60, levelText: "60" } });
    const before = store.get();
    const win = fakeWindow();
    const saved = mountSavedSetup(win, store, {
      initial: { source: "defaults" },
      storage: memoryStorage(),
      timers: fakeTimers(),
      form,
    });
    const heard = [];
    store.subscribe(({ changed }) => heard.push(...changed));
    win.dispatchEvent(new globalThis.Event("pageshow"));
    const after = store.get();
    assert.equal(after.form.revision, before.form.revision + 1);
    assert.deepEqual(after.form.values, before.form.values);
    assert.notEqual(after.talents, before.talents);
    assert.deepEqual(after.talents, before.talents);
    assert.notEqual(after.run, before.run);
    assert.deepEqual(after.run, before.run);
    assert.equal(after.config, before.config, "the build is not touched");
    assert.deepEqual([...new Set(heard)].sort(), ["form", "run", "talents"]);
    saved.stop();
  });

  it("redrawInputs leaves slices the page does not have alone", () => {
    const store = createStore({ config: setupDefaults().config });
    assert.doesNotThrow(() => redrawInputs(store));
    assert.deepEqual(Object.keys(store.get()), ["config"]);
  });

  it("works with no window (a stand-in page in the tests)", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = mountSavedSetup(undefined, store, {
      initial: { source: "defaults" },
      storage,
      timers,
    });
    withHaste(store, 0.02);
    timers.advance(DELAY);
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.02);
    saved.stop();
  });
});

describe("#320 B1: opening the page with no change writes nothing (Kira's QA)", () => {
  function fakeWindow() {
    const target = new globalThis.EventTarget();
    target.document = new globalThis.EventTarget();
    target.document.visibilityState = "visible";
    return target;
  }
  const show = (win, persisted = false) => {
    const event = new globalThis.Event("pageshow");
    event.persisted = persisted;
    win.dispatchEvent(event);
  };
  // A page load over `text` as js/main.js does it: the store from the save
  // (or the defaults), the stats form, the save mounted, then the browser's
  // pageshow (it fires on every load, persisted false).
  function load(storage, { seed = 7, timers = fakeTimers() } = {}) {
    const { setup, source } = resolveInitialSetup({
      search: "",
      saved: readSavedSetup(storage),
    });
    const store = pageStore({ ...setup, run: { ...setup.run, seed } });
    const form = createConfigForm(store);
    const win = fakeWindow();
    const saved = mountSavedSetup(win, store, {
      initial: { source },
      storage,
      timers,
      form,
    });
    show(win);
    return { store, form, win, saved, timers };
  }
  const body = encodeSetup(setupDefaults()).split(".")[1];
  const SAVES = {
    "a save": encodeSetup({
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        character: { ...setupDefaults().config.character, haste: 0.04 },
      },
    }),
    // #319's optional inputs typed (the levels redraw on pageshow, #318).
    "a save with a weapon skill and target level": encodeSetup({
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        character: { ...setupDefaults().config.character, weaponSkill: 310 },
        target: { ...setupDefaults().config.target, level: 62 },
      },
    }),
    "an unreadable save": "1.!!!not-base64",
    "a newer-version save": `${LINK_VERSION + 1}.${body}`,
    "an older-version save": `0.${body}`,
    "a value that is not the codec's": '{"haste":5}',
  };

  it("no save: a first visit's random seed is not saved without an edit", () => {
    const storage = memoryStorage();
    const page = load(storage, { seed: 98765 });
    page.timers.advance(DELAY * 4);
    show(page.win, true);
    page.timers.advance(DELAY * 4);
    page.win.dispatchEvent(new globalThis.Event("pagehide"));
    assert.equal(storage.writes, 0);
    assert.equal(savedOf(storage), null);
    page.saved.stop();
  });

  for (const [name, text] of Object.entries(SAVES)) {
    it(`${name} is left byte-unchanged by a visit, a back/forward visit and leaving`, () => {
      const storage = memoryStorage({ [SAVED_SETUP_KEY]: text });
      const page = load(storage);
      page.timers.advance(DELAY * 4);
      // Back/forward: a bfcache restore (persisted) and a reload.
      show(page.win, true);
      page.timers.advance(DELAY * 4);
      page.win.dispatchEvent(new globalThis.Event("pagehide"));
      page.win.document.visibilityState = "hidden";
      page.win.document.dispatchEvent(new globalThis.Event("visibilitychange"));
      page.saved.stop();
      const again = load(storage);
      again.timers.advance(DELAY * 4);
      again.saved.stop();
      assert.equal(storage.writes, 0, name);
      assert.equal(savedOf(storage), text, name);
    });
  }

  it("#319's weapon skill and target level round-trip through the save: typed, then blank (null)", () => {
    const storage = memoryStorage();
    const page = load(storage);
    page.form.change("character.weaponSkill", 310);
    page.form.change("target.level", 62);
    page.timers.advance(DELAY);
    page.saved.stop();
    const typed = readBack(savedOf(storage));
    assert.equal(typed.config.character.weaponSkill, 310);
    assert.equal(typed.config.target.level, 62);
    const again = load(storage);
    again.timers.advance(DELAY * 4);
    const { form, config } = again.store.get();
    assert.equal(form.values["character.weaponSkill"], 310);
    assert.equal(form.values["target.level"], 62);
    assert.equal(config.character.weaponSkill, 310);
    assert.equal(config.target.level, 62);
    // Blank: the field's text "" is null, which follows the level.
    again.form.change("character.weaponSkill", "");
    again.form.change("target.level", "");
    again.timers.advance(DELAY);
    again.saved.stop();
    const blank = readBack(savedOf(storage));
    assert.equal(blank.config.character.weaponSkill, null);
    assert.equal(blank.config.target.level, null);
    const third = load(storage);
    third.timers.advance(DELAY * 4);
    assert.equal(third.store.get().form.values["character.weaponSkill"], null);
    assert.equal(third.store.get().form.values["target.level"], null);
    assert.deepEqual(third.store.get().form.errors, {});
    third.saved.stop();
  });

  it("an edit after such a visit still saves", () => {
    for (const text of Object.values(SAVES)) {
      const storage = memoryStorage({ [SAVED_SETUP_KEY]: text });
      const page = load(storage);
      page.timers.advance(DELAY * 4);
      page.form.change("character.haste", 0.06);
      page.timers.advance(DELAY);
      assert.equal(storage.writes, 1, text);
      assert.equal(readBack(savedOf(storage)).config.character.haste, 0.06);
      page.saved.stop();
    }
  });

  it("a share link opened on load is still saved at once, and the pageshow after it writes nothing more", () => {
    const storage = memoryStorage({ [SAVED_SETUP_KEY]: SAVES["a save"] });
    const store = pageStore();
    withHaste(store, 0.07);
    const timers = fakeTimers();
    const win = fakeWindow();
    const saved = mountSavedSetup(win, store, {
      initial: { source: "link" },
      storage,
      timers,
      form: createConfigForm(store),
    });
    assert.equal(storage.writes, 1);
    assert.equal(readBack(savedOf(storage)).config.character.haste, 0.07);
    show(win);
    timers.advance(DELAY * 4);
    assert.equal(storage.writes, 1);
    saved.stop();
  });

  it("after Reset to defaults, a pageshow and then a refresh (a new seed) save nothing", () => {
    const storage = memoryStorage();
    const page = load(storage);
    page.form.change("character.haste", 0.05);
    page.timers.advance(DELAY);
    assert.notEqual(savedOf(storage), null);
    page.form.reset();
    page.timers.advance(DELAY);
    assert.equal(savedOf(storage), null);
    // The same page shown again (back/forward): the cleared setup stays unsaved.
    show(page.win, true);
    page.timers.advance(DELAY * 4);
    page.win.dispatchEvent(new globalThis.Event("pagehide"));
    assert.equal(savedOf(storage), null, "a pageshow after Reset");
    page.saved.stop();
    // A refresh: no save, so the defaults with another random seed.
    const writes = storage.writes;
    const again = load(storage, { seed: 4242 });
    again.timers.advance(DELAY * 4);
    again.win.dispatchEvent(new globalThis.Event("pagehide"));
    assert.equal(storage.writes, writes);
    assert.equal(savedOf(storage), null, "a refresh after Reset");
    again.saved.stop();
  });

  it("after clear(), the setup on screen counts as saved: a change and back again writes nothing", () => {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const saved = createSavedSetup({ store, storage, timers });
    withHaste(store, 0.02);
    timers.advance(DELAY);
    saved.clear();
    const writes = storage.writes;
    withHaste(store, 0.03);
    withHaste(store, 0.02);
    timers.advance(DELAY);
    assert.equal(storage.writes, writes);
    assert.equal(savedOf(storage), null);
    saved.stop();
  });
});

describe("#320 N4: pageshow puts a field in error back to the build's value", () => {
  it("the stats form: a field in error shows the build again, with no error; the build is not touched", () => {
    const store = pageStore();
    const form = createConfigForm(store);
    form.change("character.haste", 0.05);
    form.change("character.haste", -0.05);
    assert.notDeepEqual(store.get().form.errors, {});
    const config = store.get().config;
    redrawInputs(store);
    const after = store.get();
    assert.deepEqual(after.form.errors, {});
    assert.equal(after.form.values["character.haste"], 0.05);
    assert.equal(after.config, config);
  });

  it("the run settings: a field in error shows the setting again, with no error", () => {
    const store = pageStore();
    const { run } = store.get();
    store.set({
      run: {
        ...run,
        fields: { ...run.fields, duration: "-5" },
        errors: { duration: "Enter a length of at least 1 second." },
      },
    });
    redrawInputs(store);
    const after = store.get().run;
    assert.deepEqual(after.errors, {});
    assert.equal(after.fields.duration, String(run.duration));
    assert.equal(after.duration, run.duration);
  });

  it("#319's target level in error shows the build's (blank) again; a weapon skill in error its typed build value", () => {
    const store = pageStore();
    const form = createConfigForm(store);
    form.change("character.weaponSkill", 310);
    form.change("character.weaponSkill", 999);
    form.change("target.level", 99);
    assert.ok(store.get().form.errors["character.weaponSkill"]);
    assert.ok(store.get().form.errors["target.level"]);
    const config = store.get().config;
    redrawInputs(store);
    const after = store.get();
    assert.deepEqual(after.form.errors, {});
    assert.equal(after.form.values["character.weaponSkill"], 310);
    assert.equal(after.form.values["target.level"], null);
    assert.equal(after.config, config);
  });

  it("a form with no errors keeps its values as they are", () => {
    const store = pageStore();
    createConfigForm(store);
    const before = store.get().form.values;
    redrawInputs(store);
    assert.equal(store.get().form.values, before);
  });
});

describe("#320 N8 (assumption A8): an Undo during a run puts the run settings back when the run ends", () => {
  // run-actions' resetSettings and restoreSettings: neither does anything
  // while a run is on (state "running" or "paused").
  const runSettings = (store) => {
    const locked = () => ["running", "paused"].includes(store.get().run.state);
    return {
      resetSettings() {
        if (locked()) return null;
        const { run } = store.get();
        const before = { mode: run.mode, duration: run.duration };
        store.set({ run: { ...run, mode: "batch", duration: 300 } });
        return before;
      },
      restoreSettings(before) {
        if (locked()) return false;
        store.set({ run: { ...store.get().run, ...before } });
        return true;
      },
    };
  };
  const setState = (store, state) =>
    store.set({ run: { ...store.get().run, state } });
  function mounted() {
    const storage = memoryStorage();
    const store = pageStore();
    const timers = fakeTimers();
    const form = createConfigForm(store);
    const saved = mountSavedSetup(null, store, {
      initial: { source: "defaults" },
      storage,
      timers,
      form,
      runSettings: runSettings(store),
    });
    store.set({ run: { ...store.get().run, mode: "live", duration: 60 } });
    form.change("character.haste", 0.05);
    timers.advance(DELAY);
    return { storage, store, timers, form, saved };
  }

  it("Reset while idle, Undo mid-run: the config now, the run settings when the run ends, and both saved", () => {
    const { storage, store, timers, form, saved } = mounted();
    form.reset();
    setState(store, "running");
    assert.equal(form.undo(), true);
    assert.equal(store.get().config.character.haste, 0.05);
    assert.equal(store.get().run.duration, 300, "not while the run is on");
    setState(store, "paused");
    assert.equal(store.get().run.duration, 300);
    setState(store, "done");
    assert.equal(store.get().run.mode, "live");
    assert.equal(store.get().run.duration, 60);
    timers.advance(DELAY);
    const back = readBack(savedOf(storage));
    assert.equal(back.config.character.haste, 0.05);
    assert.equal(back.run.duration, 60);
    // Once: a later run leaves the settings alone.
    store.set({ run: { ...store.get().run, duration: 90 } });
    setState(store, "running");
    setState(store, "idle");
    assert.equal(store.get().run.duration, 90);
    saved.stop();
  });

  it("a Reset to defaults before the run ends drops the pending restore", () => {
    const { store, form, saved } = mounted();
    form.reset();
    setState(store, "running");
    form.undo();
    form.reset();
    setState(store, "idle");
    assert.equal(store.get().run.duration, 300);
    assert.equal(store.get().run.mode, "batch");
    saved.stop();
  });

  it("stop() drops the pending restore too", () => {
    const { store, form, saved } = mounted();
    form.reset();
    setState(store, "running");
    form.undo();
    saved.stop();
    setState(store, "idle");
    assert.equal(store.get().run.duration, 300);
  });
});
