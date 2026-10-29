import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { createFight } from "../js/fight.js";
import { createLiveFeed } from "../js/live-feed.js";
import { defaultConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { createControlsView } from "../js/views/controls.js";
import { createResultsView } from "../js/views/results.js";
import { createVisualiserView } from "../js/views/visualiser.js";

// Issue #149 (U1). The views js/main.js hands the store to: each owns its own
// part of the page and no other, draws only when its slices change, and talks
// to the rest of the page only through the store.

const SEED = 20261029;

function element(selector) {
  const attributes = new Map();
  const listeners = new Map();
  return {
    selector,
    writes: 0,
    style: {},
    classes: new Set(),
    classList: {
      toggle(name, on) {
        this.owner.classes[on ? "add" : "delete"](name);
      },
    },
    value: "",
    _text: "",
    get textContent() {
      return this._text;
    },
    set textContent(text) {
      this.writes += 1;
      this._text = text;
    },
    hidden: false,
    children: [],
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 0,
    firstChild: null,
    lastElementChild: { remove() {} },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get("click")();
    },
    append() {},
    remove() {},
    insertBefore() {},
    replaceChildren() {},
  };
}

// A document that remembers every selector asked of it.
function recordingDocument() {
  const elements = new Map();
  const queried = new Set();
  const get = (selector) => {
    queried.add(selector);
    if (!elements.has(selector)) {
      const made = element(selector);
      made.classList.owner = made;
      elements.set(selector, made);
    }
    return elements.get(selector);
  };
  return {
    queried,
    el: (selector) => elements.get(selector),
    querySelector: get,
    querySelectorAll: (selector) => [get(selector)],
    createElement: (tag) => {
      const made = element(tag);
      made.classList.owner = made;
      return made;
    },
  };
}

function pageStore() {
  const fight = createFight(SEED, defaultConfig());
  const feed = createLiveFeed(fight);
  const results = () => ({
    time: fight.simulation.currentTime,
    damage: fight.simulation.damageDone,
  });
  const store = createStore({
    config: fight.config,
    rotation: fight.config.rotation,
    run: { state: "running", seed: fight.seed },
    frame: 0,
    results: results(),
    ...feed.read(),
  });
  return { fight, feed, store, results };
}

const VIEWS = {
  controls: createControlsView,
  results: createResultsView,
  visualiser: createVisualiserView,
};

describe("page views", () => {
  it("each owns its own elements, and no two share one", () => {
    const owned = {};
    for (const [name, create] of Object.entries(VIEWS)) {
      const doc = recordingDocument();
      create(doc, pageStore().store);
      owned[name] = doc.queried;
      assert.ok(doc.queried.size > 0, name);
    }
    const names = Object.keys(owned);
    for (const [index, name] of names.entries()) {
      for (const other of names.slice(index + 1)) {
        const shared = [...owned[name]].filter((s) => owned[other].has(s));
        assert.deepEqual(shared, [], `${name} and ${other}`);
      }
    }
    assert.ok(owned.controls.has("#pause-button"));
    assert.ok(owned.results.has("#dps-value"));
    assert.ok(owned.visualiser.has("#combat-log"));
  });

  it("controls show the seed and toggle run.state through the store", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    const states = [];
    store.subscribe(({ state, changed }) => {
      if (changed.includes("run")) {
        states.push(state.run.state);
      }
    });
    createControlsView(doc, store);
    assert.equal(doc.el("#seed-value").textContent, String(SEED));

    doc.el("#pause-button").click();
    assert.equal(store.get().run.state, "paused");
    assert.equal(store.get().run.seed, SEED, "the seed is kept");
    assert.equal(doc.el("#pause-button").getAttribute("aria-pressed"), "true");
    assert.equal(doc.el("#pause-label").textContent, "Resume");
    assert.equal(doc.el("#pause-icon").textContent, "▶");
    assert.equal(doc.el("#simulation-status-label").textContent, "Paused");
    assert.ok(doc.el("#simulation-status").classes.has("is-paused"));

    doc.el("#pause-button").click();
    assert.equal(store.get().run.state, "running");
    assert.equal(doc.el("#pause-button").getAttribute("aria-pressed"), "false");
    assert.equal(doc.el("#pause-label").textContent, "Pause");
    assert.equal(doc.el("#pause-icon").textContent, "Ⅱ");
    assert.equal(doc.el("#simulation-status-label").textContent, "Live");
    assert.equal(doc.el("#simulation-status").classes.has("is-paused"), false);
    assert.deepEqual(states, ["paused", "running"]);
  });

  it("results draw time, damage and DPS when the results slice changes", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    createResultsView(doc, store);
    assert.equal(doc.el("#time-value").writes, 0, "nothing before a change");

    store.set({ results: { time: 125.9, damage: 25_180.7 } });
    assert.equal(doc.el("#time-value").textContent, "02:05");
    assert.equal(doc.el("#damage-value").textContent, "25180");
    assert.equal(doc.el("#dps-value").textContent, "200");
    assert.equal(doc.el("#dps-value").value, "200");

    store.set({ results: { time: 3000.5, damage: 0 } });
    assert.equal(doc.el("#time-value").textContent, "50:00");

    store.set({ results: { time: 0, damage: 0 } });
    assert.equal(doc.el("#time-value").textContent, "00:00");
    assert.equal(doc.el("#dps-value").textContent, "0");

    const writes = doc.el("#dps-value").writes;
    store.set({ frame: 1, run: { state: "paused", seed: SEED } });
    assert.equal(doc.el("#dps-value").writes, writes, "other slices: no draw");
  });

  it("the visualiser redraws on frame changes and on nothing else", () => {
    const doc = recordingDocument();
    const { fight, feed, store, results } = pageStore();
    createVisualiserView(doc, store);
    const energy = doc.el("#energy-value");
    const before = energy.writes;

    store.set({ results: results(), run: { state: "paused", seed: SEED } });
    store.set({ rotation: [] });
    assert.equal(energy.writes, before);

    for (
      let step = 0;
      step < k("sim.maxFrameTime") / k("sim.fixedStep");
      step++
    ) {
      fight.simulation.step(k("sim.fixedStep"));
    }
    store.update(({ frame }) => ({ frame: frame + 1, ...feed.read() }));
    assert.equal(energy.writes, before + 1);
    assert.equal(
      energy.textContent,
      `${Math.floor(fight.rogue.energy)} / ${fight.rogue.maxEnergy}`,
      "draws the engine's state",
    );
  });

  it("the visualiser draws plain slices, with no engine behind them (#150)", () => {
    const doc = recordingDocument();
    const reading = Object.freeze({
      resources: {
        comboPoints: { value: 3, max: 5 },
        energy: { value: 41.75, max: 100 },
      },
      gcd: { remaining: 0.75, duration: 1.5 },
      effects: {
        buffs: [
          { id: "snd", name: "Slice and Dice", icon: null, remaining: 7.4 },
        ],
        debuffs: [],
        cooldowns: [{ id: "x", name: "Sprint", icon: null, remaining: 12.6 }],
      },
      log: [
        {
          id: 0,
          time: 61.5,
          name: "Sinister Strike",
          type: "skill",
          damage: 99.9,
          status: "Hit",
          outcome: "hit",
          icon: null,
        },
      ],
    });
    const store = createStore({ frame: 0, ...reading });
    createVisualiserView(doc, store);
    assert.equal(doc.el("#gcd-meter").getAttribute("aria-valuemax"), "1.5");
    store.set({ frame: 1 });
    assert.equal(doc.el("#combo-value").textContent, "3 / 5");
    assert.equal(doc.el("#energy-value").textContent, "41 / 100");
    assert.equal(doc.el("#energy-fill").style.width, "41.75%");
    assert.equal(doc.el("#gcd-value").textContent, "0.8s");
    assert.equal(doc.el("#gcd-fill").style.width, "50%");
    assert.equal(doc.el("#gcd-status").textContent, "On cooldown");
    assert.equal(doc.el("#gcd-meter").getAttribute("aria-valuenow"), "0.8");
    assert.equal(doc.el("#active-buffs-empty").hidden, true);
    assert.equal(doc.el("#active-debuffs-empty").hidden, false);
    assert.equal(doc.el("#skill-cooldowns-empty").hidden, true);
  });

  it("each view returns its unsubscribe, after which it draws nothing", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    const stops = Object.values(VIEWS).map((create) => create(doc, store));
    stops.forEach((stop) => assert.equal(typeof stop, "function"));
    const writes = () =>
      [...doc.queried].reduce((sum, s) => sum + doc.el(s).writes, 0);
    stops.forEach((stop) => stop());
    const before = writes();
    store.set({ frame: 1, results: { time: 1, damage: 1 } });
    store.set({ run: { state: "paused", seed: SEED } });
    assert.equal(writes(), before);
  });
});
