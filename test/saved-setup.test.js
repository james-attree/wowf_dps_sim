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
  SETUP_VERSION,
  decodeSetup,
  encodeSetup,
  resolveInitialSetup,
  setupDefaults,
  setupFromState,
} from "../js/build-codec.js";
import { createConfigForm } from "../js/config-form.js";
import { referenceBuild } from "../js/preset-reference-builds.js";
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
        talentLevel: 40,
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
      `${SETUP_VERSION + 1}.${body}`,
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
    assert.equal(read.config.talentLevel, 40);
    assert.equal(read.run.duration, d.run.duration);
    assert.equal(read.run.mode, "live");
    assert.equal(read.run.seed, 99);
  });

  it("an unknown field is ignored; a section that does not check out is its default", () => {
    const payload = {
      future: { anything: true },
      config: {
        character: { haste: "fast", attackPower: 900 },
        talentLevel: 40,
        later: 1,
      },
      run: { duration: -5, mode: "live", extra: true },
    };
    const text = `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const read = readBack(text);
    const d = setupDefaults();
    assert.deepEqual(read.config.character, d.config.character);
    assert.equal(read.config.talentLevel, 40);
    assert.equal(read.run.duration, d.run.duration);
    assert.equal(read.run.mode, "live");
  });

  it("over the cap: a 51-point build saved with level 40 keeps the build and reads the level as its default (60)", () => {
    const build = referenceBuild("combat-swords");
    const d = setupDefaults();
    const payload = { config: { talents: build.talents, talentLevel: 40 } };
    const text = `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const read = readBack(text);
    assert.deepEqual(read.config.talents, build.talents);
    assert.equal(read.config.talentLevel, d.config.talentLevel);
    // The same text as a share link is refused whole (strict): nothing loads.
    assert.equal(decodeSetup(text, { strict: true }).status, "corrupt");
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
