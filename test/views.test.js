import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { createFight } from "../js/fight.js";
import { createLiveFeed } from "../js/live-feed.js";
import { defaultConfig } from "../js/sim-config.js";
import { emptyBatch } from "../js/run-actions.js";
import { createStore } from "../js/store.js";
import { buildLabel, poisonName } from "../js/build-label.js";
import { createControlsView } from "../js/views/controls.js";
import { createResultsPanelView } from "../js/views/results-panel.js";
import { createResultsView } from "../js/views/results.js";
import {
  createAnnouncer,
  createVisualiserView,
  logRowReading,
  LOG_HINT,
  logRowSpoken,
  timedEffectReading,
} from "../js/views/visualiser.js";
import { runOnCore } from "../js/core/fight.js";
import { POLL_STEP } from "./poll-step.js";

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
    removeAttribute(name) {
      attributes.delete(name);
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
    fire(type, event) {
      listeners.get(type)(event);
    },
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {},
    insertBefore(child) {
      this.children.unshift(child);
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
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
    // The results panel (#154) builds its body with js/svg.js toDom.
    createElementNS: (namespace, tag) => element(tag),
    createTextNode: (text) => ({ text }),
  };
}

// A recording document with a window: a matchMedia for reduced motion, a
// clock-free setTimeout and a root element.
function windowedDocument(reduce) {
  const doc = recordingDocument();
  const root = element("html");
  root.classList.owner = root;
  const query = {
    matches: reduce,
    change: null,
    addEventListener(type, listener) {
      this.change = listener;
    },
  };
  doc.documentElement = root;
  doc.defaultView = {
    matchMedia: (text) => {
      assert.equal(text, "(prefers-reduced-motion: reduce)");
      return query;
    },
    timers: [],
    setTimeout(run, wait) {
      this.timers.push({ run, wait });
    },
  };
  return { doc, root, query };
}

// The slices the live feed gives, by hand: no engine anywhere.
function plainReading(overrides = {}) {
  return {
    run: { state: "running", seed: SEED },
    results: { time: 61.5, damage: 12_345.6 },
    resources: {
      comboPoints: { value: 3, max: 5 },
      energy: { value: 41.75, max: 100 },
    },
    gcd: { remaining: 0.75, duration: 1.5 },
    effects: { buffs: [], debuffs: [], cooldowns: [] },
    procs: [],
    spend: null,
    moment: null,
    log: [],
    ...overrides,
  };
}

const LOG_ROW = {
  id: 0,
  time: 61.5,
  name: "Sinister Strike",
  type: "skill",
  damage: 99.9,
  status: "Hit",
  outcome: "hit",
  icon: null,
  fromProc: false,
};

// The run slice js/main.js starts with (#153), with `overrides`.
function pageRun(overrides = {}) {
  return {
    mode: "live",
    state: "idle",
    seed: SEED,
    duration: 300,
    iterations: 1000,
    fields: { duration: "300", iterations: "1000", seed: String(SEED) },
    errors: {},
    stoppedAt: null,
    shown: false,
    snapshot: null,
    ...overrides,
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
    run: pageRun({ state: "running", seed: fight.seed }),
    batch: emptyBatch("main"),
    frame: 0,
    results: results(),
    ...feed.read(),
  });
  return { fight, feed, store, results };
}

const VIEWS = {
  controls: createControlsView,
  results: createResultsView,
  resultsPanel: (doc, store) =>
    createResultsPanelView(doc, store, { buildLabel, poisonName }),
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
    assert.ok(owned.resultsPanel.has("#results-body"));
  });

  it("controls show the seed, call the run's actions and draw run.state", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    const calls = [];
    const actions = {
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
    };
    createControlsView(doc, store, actions);
    assert.equal(doc.el("#run-seed").value, String(SEED));
    assert.equal(
      doc.el("#run-status-text").textContent,
      "Running · 00:00 / 05:00",
    );
    assert.equal(doc.el("#pause-button").disabled, false);

    // The view asks; the runner's state change is what redraws it (#153).
    doc.el("#pause-button").click();
    assert.deepEqual(calls, ["pause"]);
    assert.equal(store.get().run.state, "running", "the view never writes it");
    assert.equal(doc.el("#pause-label").textContent, "Pause");

    const setState = (state) =>
      store.update(({ run }) => ({ run: { ...run, state } }));
    setState("paused");
    assert.equal(store.get().run.seed, SEED, "the seed is kept");
    assert.equal(doc.el("#pause-button").getAttribute("aria-pressed"), null);
    assert.equal(doc.el("#pause-label").textContent, "Resume");
    assert.equal(doc.el("#pause-icon").textContent, "▶");
    assert.equal(doc.el("#run-status-text").textContent, "Paused at 00:00");
    assert.ok(doc.el("#run-status").classes.has("is-paused"));
    doc.el("#pause-button").click();
    assert.deepEqual(calls, ["pause", "resume"]);

    setState("running");
    assert.equal(doc.el("#pause-button").getAttribute("aria-pressed"), null);
    assert.equal(doc.el("#pause-label").textContent, "Pause");
    assert.equal(doc.el("#pause-icon").textContent, "Ⅱ");
    assert.equal(doc.el("#run-status").classes.has("is-paused"), false);

    // A finished fight (#153) has nothing to pause.
    setState("finished");
    assert.match(doc.el("#run-status-text").textContent, /^Finished · /);
    assert.equal(doc.el("#pause-button").disabled, true);
    assert.equal(doc.el("#pause-label").textContent, "Pause");
    assert.ok(doc.el("#run-status").classes.has("is-paused"));
    doc.el("#pause-button").click();
    setState("idle");
    assert.equal(
      doc.el("#run-status-text").textContent,
      `Ready · seed ${SEED}`,
    );
    assert.equal(doc.el("#pause-button").disabled, true);
    doc.el("#pause-button").click();
    assert.deepEqual(calls, ["pause", "resume"], "nothing to call");
  });

  it("results draw time, damage and DPS when the results slice changes", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    createResultsView(doc, store);
    assert.equal(doc.el("#time-value").writes, 0, "nothing before a change");

    store.set({ results: { time: 125.9, damage: 25_180.7 } });
    assert.equal(doc.el("#time-value").textContent, "02:05");
    assert.equal(doc.el("#damage-value").textContent, "25,180", "#45 commas");
    assert.equal(doc.el("#dps-value").textContent, "200");

    // Only on a change (#45): the same text is not written again.
    const damageWrites = doc.el("#damage-value").writes;
    store.set({ results: { time: 125.95, damage: 25_180.9 } });
    assert.equal(doc.el("#damage-value").writes, damageWrites);
    assert.equal(doc.el("#time-value").textContent, "02:05");

    store.set({ results: { time: 3000.5, damage: 0 } });
    assert.equal(doc.el("#time-value").textContent, "50:00");

    store.set({ results: { time: 0, damage: 0 } });
    assert.equal(doc.el("#time-value").textContent, "00:00");
    assert.equal(doc.el("#dps-value").textContent, "0");

    // The DPS tile has commas too (#45, Scout), as the pause says it.
    store.set({ results: { time: 10, damage: 12_345 } });
    assert.equal(doc.el("#dps-value").textContent, "1,235");
    assert.equal(doc.el("#damage-value").textContent, "12,345");

    const writes = doc.el("#dps-value").writes;
    store.set({ frame: 1, run: pageRun({ state: "paused" }) });
    assert.equal(doc.el("#dps-value").writes, writes, "other slices: no draw");
  });

  it("batch mode keeps the tiles and the timer: they are the kept live fight's (#242)", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    createResultsView(doc, store);
    store.set({ results: { time: 10, damage: 2000 } });
    assert.equal(doc.el("#dps-value").textContent, "200");

    // A batch running or done leaves the live fight's numbers as they were.
    const writes = doc.el("#dps-value").writes;
    store.set({ run: pageRun({ mode: "batch" }) });
    store.set({
      run: pageRun({ mode: "batch", state: "running" }),
      batch: {
        ...emptyBatch("main"),
        status: "running",
        progress: { completed: 40, total: 100, mean: 250.4 },
      },
    });
    store.set({
      run: pageRun({ mode: "batch", state: "done" }),
      batch: { ...emptyBatch("main"), status: "done" },
    });
    assert.notEqual(doc.el("#time-value").hidden, true);
    assert.equal(doc.el("#dps-value").writes, writes, "no batch numbers drawn");
    assert.equal(doc.el("#time-value").textContent, "00:10");
    assert.equal(doc.el("#dps-value").textContent, "200");
  });

  it("the visualiser redraws on frame changes and on nothing else", () => {
    const doc = recordingDocument();
    const { fight, feed, store, results } = pageStore();
    createVisualiserView(doc, store);
    const energy = doc.el("#energy-value");
    const before = energy.writes;

    store.set({ results: results(), run: pageRun({ state: "paused" }) });
    store.set({ rotation: [] });
    assert.equal(energy.writes, before);

    for (let step = 0; step < k("sim.maxFrameTime") / POLL_STEP; step++) {
      runOnCore(fight.simulation, POLL_STEP);
    }
    store.update(({ frame }) => ({ frame: frame + 1, ...feed.read() }));
    assert.equal(energy.writes, before + 1);
    assert.equal(
      energy.textContent,
      `${Math.floor(fight.rogue.energy)} / ${fight.rogue.maxEnergy}`,
      "draws the engine's state",
    );
  });

  it("the visualiser empties the log for a new fight and dims a stopped one (#153)", () => {
    const doc = recordingDocument();
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({
      frame: 1,
      log: [{ ...LOG_ROW, id: 1, name: "Main-hand" }, LOG_ROW],
    });
    const log = doc.el("#combat-log");
    assert.equal(log.children.length, 2);

    // Ids restart with each fight: a lower newest id is a new fight.
    store.set({
      frame: 2,
      log: [{ ...LOG_ROW, id: 0, name: "Eviscerate" }],
    });
    const names = log.children.map((row) => row.children?.[2]?.textContent);
    assert.equal(names[0], "Eviscerate", "the new fight's row");
    assert.equal(names.includes("Main-hand"), false, "the old rows are gone");

    const frame = doc.el("[data-fight-frame]");
    store.set({ run: { state: "idle", seed: SEED, stoppedAt: 9.5 } });
    assert.ok(frame.classes.has("is-discarded"), "stopped: dimmed");
    store.set({ run: { state: "running", seed: SEED, stoppedAt: null } });
    assert.equal(frame.classes.has("is-discarded"), false);
    store.set({ run: { state: "idle", seed: SEED, stoppedAt: null } });
    assert.equal(frame.classes.has("is-discarded"), false, "reset: not dimmed");
  });

  it("the visualiser draws plain slices, with no engine behind them (#150)", () => {
    const doc = recordingDocument();
    const reading = Object.freeze(
      plainReading({
        effects: {
          buffs: [
            {
              id: "snd",
              name: "Slice and Dice",
              icon: null,
              remaining: 7.4,
              duration: 9,
              stacks: 1,
            },
          ],
          debuffs: [],
          cooldowns: [
            {
              id: "x",
              name: "Sprint",
              icon: null,
              remaining: 12.6,
              duration: 300,
              stacks: 1,
            },
          ],
        },
        log: [LOG_ROW],
      }),
    );
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
    assert.equal(doc.el("#energy-cap").hidden, true, "not at cap");
    assert.equal(doc.el("#combo-spend").textContent, "");
    assert.equal(doc.el("#procs-empty").hidden, false);
  });

  it("#45: readouts and meters are written only when their text changes", () => {
    const doc = recordingDocument();
    const reading = plainReading({
      effects: {
        buffs: [
          {
            id: "snd",
            name: "Slice and Dice",
            icon: null,
            remaining: 7.4,
            duration: 9,
            stacks: 1,
          },
        ],
        debuffs: [],
        cooldowns: [],
      },
    });
    const store = createStore({ frame: 0, ...reading });
    createVisualiserView(doc, store);
    const attributeWrites = new Map();
    for (const id of ["#combo-meter", "#energy-meter", "#gcd-meter"]) {
      const meter = doc.el(id);
      const set = meter.setAttribute;
      attributeWrites.set(id, []);
      meter.setAttribute = (name, value) => {
        attributeWrites.get(id).push(name);
        set(name, value);
      };
    }
    store.set({ frame: 1 });
    assert.equal(
      doc.el("#combo-meter").getAttribute("aria-valuetext"),
      "3 of 5",
    );
    assert.equal(
      doc.el("#energy-meter").getAttribute("aria-valuetext"),
      "41 of 100",
    );
    assert.equal(
      doc.el("#gcd-meter").getAttribute("aria-valuetext"),
      "0.8 seconds remaining",
    );
    const time = doc.el("#active-buffs").children[0].children[2];
    assert.equal(time.getAttribute("aria-live"), "off", "timed effects too");
    const counts = () =>
      ["#combo-value", "#energy-value", "#gcd-value", "#gcd-status"].map(
        (id) => doc.el(id).writes,
      );
    const before = counts();
    const timeWrites = time.writes;
    for (const list of attributeWrites.values()) {
      list.length = 0;
    }

    // A frame that moves nothing a readout shows: nothing written.
    store.set({
      frame: 2,
      resources: {
        comboPoints: { value: 3, max: 5 },
        energy: { value: 41.9, max: 100 },
      },
      gcd: { remaining: 0.76, duration: 1.5 },
      effects: {
        ...reading.effects,
        buffs: [{ ...reading.effects.buffs[0], remaining: 7.3 }],
      },
    });
    assert.deepEqual(counts(), before);
    assert.equal(time.writes, timeWrites);
    for (const [id, list] of attributeWrites) {
      assert.deepEqual(list, [], id);
    }

    // One that does: only what changed, and the max only with talents.
    store.set({
      frame: 3,
      resources: {
        comboPoints: { value: 3, max: 5 },
        energy: { value: 45, max: 110 },
      },
      gcd: { remaining: 0, duration: 1.5 },
    });
    assert.deepEqual(attributeWrites.get("#combo-meter"), []);
    assert.deepEqual(attributeWrites.get("#energy-meter"), [
      "aria-valuemax",
      "aria-valuenow",
      "aria-valuetext",
    ]);
    assert.equal(
      doc.el("#energy-meter").getAttribute("aria-valuetext"),
      "45 of 110",
    );
    assert.deepEqual(attributeWrites.get("#gcd-meter"), [
      "aria-valuenow",
      "aria-valuetext",
    ]);
    assert.equal(doc.el("#gcd-meter").getAttribute("aria-valuetext"), "Ready");
    assert.equal(doc.el("#gcd-status").textContent, "Ready");

    // The status and the meter share one ready test (#45, Scout): they agree
    // at the edges of the one-decimal reading.
    const edges = [
      [0.04, "Ready", "Ready", "0.0s"],
      [0.05, "On cooldown", "0.1 seconds remaining", "0.1s"],
      [0.06, "On cooldown", "0.1 seconds remaining", "0.1s"],
      [1.0, "On cooldown", "1 second remaining", "1.0s"],
      [1.5, "On cooldown", "1.5 seconds remaining", "1.5s"],
      [0, "Ready", "Ready", "0.0s"],
    ];
    edges.forEach(([remaining, status, text, shown], at) => {
      store.set({ frame: 4 + at, gcd: { remaining, duration: 1.5 } });
      const label = `${remaining} s`;
      assert.equal(doc.el("#gcd-status").textContent, status, label);
      assert.equal(
        doc.el("#gcd-status").classes.has("is-active"),
        status !== "Ready",
        label,
      );
      assert.equal(
        doc.el("#gcd-meter").getAttribute("aria-valuetext"),
        text,
        label,
      );
      assert.equal(doc.el("#gcd-value").textContent, shown, label);
    });
  });

  it("Phase 3: aura bars, stacks, labels, low time and cooldowns (#150)", () => {
    const doc = recordingDocument();
    const aura = (id, remaining, duration, stacks) => ({
      id,
      name: id,
      icon: null,
      remaining,
      duration,
      stacks,
    });
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({
      frame: 1,
      effects: {
        buffs: [aura("Slice and Dice", 14.2, 21, 1), aura("Low", 2.46, 10, 1)],
        debuffs: [aura("Deadly Poison", 9, 12, 3)],
        cooldowns: [aura("Sprint", 1.5, 300, 1)],
      },
    });
    const [snd, low] = doc.el("#active-buffs").children;
    const [stack, bar, time] = snd.children;
    assert.equal(snd.getAttribute("role"), "listitem");
    assert.equal(
      snd.getAttribute("aria-label"),
      "Slice and Dice, 14 seconds left, 1 stack",
    );
    assert.equal(time.textContent, "14s");
    assert.equal(bar.children[0].style.width, `${(14.2 / 21) * 100}%`);
    assert.equal(stack.hidden, true);
    assert.equal(snd.classes.has("is-low"), false);
    assert.equal(low.children[2].textContent, "2.5s", "one decimal when low");
    assert.ok(low.classes.has("is-low"));
    assert.equal(
      low.getAttribute("aria-label"),
      "Low, 2.5 seconds left, 1 stack",
    );
    const [poison] = doc.el("#active-debuffs").children;
    assert.equal(poison.children[0].textContent, "×3");
    assert.equal(poison.children[0].hidden, false);
    assert.equal(
      poison.getAttribute("aria-label"),
      "Deadly Poison, 9 seconds left, 3 stacks",
    );
    const [sprint] = doc.el("#skill-cooldowns").children;
    assert.equal(sprint.getAttribute("aria-label"), "Sprint, 2 seconds left");
    assert.equal(
      sprint.classes.has("is-low"),
      false,
      "a cooldown is never low",
    );
  });

  it("Phase 3: energy at cap, the spend flash, proc chips, ↳ rows (#150)", () => {
    const doc = recordingDocument();
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    const spend = {
      source: "eviscerate",
      name: "Eviscerate",
      before: 5,
      after: 0,
      time: 60,
    };
    store.set({
      frame: 1,
      resources: {
        comboPoints: { value: 0, max: 5 },
        energy: { value: 100, max: 100 },
      },
      results: { time: 60 + k("ui.spendFlashSeconds") / 2, damage: 1 },
      spend,
      procs: [
        { id: "a", name: "Hack and Slash", count: 2 },
        { id: "b", name: "Deadly Poison", count: 14 },
      ],
      log: [{ ...LOG_ROW, id: 1, fromProc: true, name: "Main-hand" }, LOG_ROW],
    });
    assert.equal(doc.el("#energy-cap").hidden, false);
    assert.ok(doc.el("#energy-fill").classes.has("is-capped"));
    assert.equal(doc.el("#combo-spend").textContent, "Eviscerate · 5");
    assert.ok(doc.el(".combo-point").classes.has("is-spent"));
    assert.deepEqual(
      doc.el("#proc-chips").children.map((chip) => chip.textContent),
      ["Hack and Slash ×2", "Deadly Poison ×14"],
    );
    assert.equal(doc.el("#procs-empty").hidden, true);
    const names = doc
      .el("#combat-log")
      .children.map((row) => row.children[2].textContent);
    assert.deepEqual(names, ["↳ Main-hand", "Sinister Strike"]);

    store.set({
      frame: 2,
      results: { time: 60.01 + k("ui.spendFlashSeconds"), damage: 1 },
      resources: {
        comboPoints: { value: 1, max: 5 },
        energy: { value: 99.5, max: 100 },
      },
      procs: [
        { id: "a", name: "Hack and Slash", count: 3 },
        { id: "b", name: "Deadly Poison", count: 14 },
      ],
    });
    assert.equal(doc.el("#combo-spend").textContent, "", "the flash is over");
    assert.equal(doc.el(".combo-point").classes.has("is-spent"), false);
    store.set({
      frame: 3,
      results: { time: 61.1, damage: 1 },
      spend: { ...spend, before: 3, after: 1, time: 61 },
    });
    assert.equal(doc.el("#combo-spend").textContent, "Eviscerate · 2");
    assert.equal(
      doc.el(".combo-point").classes.has("is-spent"),
      false,
      "only the points spent, not the one kept",
    );
    assert.equal(doc.el("#energy-cap").hidden, true);
    assert.equal(doc.el("#energy-fill").classes.has("is-capped"), false);
    assert.deepEqual(
      doc.el("#proc-chips").children.map((chip) => chip.textContent),
      ["Hack and Slash ×3", "Deadly Poison ×14"],
      "same chips, same order",
    );
  });

  it("Phase 3: reduced motion from matchMedia, once and on change (#150)", () => {
    const { doc, root, query } = windowedDocument(true);
    createVisualiserView(doc, createStore(plainReading()));
    assert.ok(root.classes.has("reduce-motion"));
    query.matches = false;
    query.change();
    assert.equal(root.classes.has("reduce-motion"), false);
  });

  it("Phase 3: paused, Left and Right step through the log (#150)", () => {
    const doc = recordingDocument();
    const rows = [
      { ...LOG_ROW, id: 2, time: 41.25, name: "Eviscerate", damage: 1812.4 },
      { ...LOG_ROW, id: 1, time: 40.5, status: "Crit", damage: 412 },
      LOG_ROW,
    ];
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({ frame: 1, log: rows });
    const scroll = doc.el(".combat-log-scroll");
    const press = (key) => {
      let prevented = false;
      scroll.fire("keydown", { key, preventDefault: () => (prevented = true) });
      return prevented;
    };
    assert.equal(press("ArrowLeft"), false, "running: the keys do nothing");
    assert.equal(doc.el("#log-readout").textContent, "");

    // #45: the hint is #log-hint, the log's description, not live; the
    // live #log-readout is empty at the pause and says only the steps.
    store.set({ run: { state: "paused", seed: SEED } });
    assert.equal(
      doc.el("#log-hint").textContent,
      "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.",
    );
    assert.equal(doc.el("#log-readout").textContent, "");
    assert.equal(doc.el("#log-step").textContent, "");
    assert.equal(doc.el("#log-hint").classes.has("visually-hidden"), false);
    assert.equal(press("ArrowLeft"), true);
    // U9 polish: the hint stays the log's description, out of sight.
    assert.equal(
      doc.el("#log-hint").textContent,
      "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.",
    );
    assert.equal(doc.el("#log-hint").classes.has("visually-hidden"), true);
    // U9 polish: the shown damage has commas, as the spoken one does.
    assert.equal(
      doc.el("#log-step").textContent,
      "00:41.2 · Eviscerate · Hit · 1,812",
    );
    assert.equal(
      doc.el("#log-readout").textContent,
      "41.2 seconds, Eviscerate, hit, 1,812 damage",
    );
    const logRows = doc.el("#combat-log").children;
    assert.equal(logRows[0].getAttribute("aria-current"), "true");
    press("ArrowLeft");
    assert.equal(
      doc.el("#log-step").textContent,
      "00:40.5 · Sinister Strike · Crit · 412",
    );
    assert.equal(
      doc.el("#log-readout").textContent,
      "40.5 seconds, Sinister Strike, crit, 412 damage",
    );
    assert.equal(logRows[0].getAttribute("aria-current"), null);
    assert.ok(logRows[1].classes.has("is-selected"));
    press("ArrowLeft");
    assert.ok(logRows[2].classes.has("is-selected"));
    assert.match(doc.el("#log-readout").textContent, /damage$/);
    // U9 polish: an arrow past either end says so, and stays on the row.
    assert.equal(press("ArrowLeft"), true);
    assert.ok(logRows[2].classes.has("is-selected"), "stops at the oldest");
    assert.equal(doc.el("#log-readout").textContent, "Start of log");
    assert.match(
      doc.el("#log-step").textContent,
      / · Hit · 99$/,
      "the row shows",
    );
    press("ArrowRight");
    assert.ok(logRows[1].classes.has("is-selected"));
    assert.equal(press("End"), true);
    assert.ok(logRows[0].classes.has("is-selected"), "End: the latest");
    // Scout (#221): Home and End say the end and the row, as one message.
    assert.equal(
      doc.el("#log-readout").textContent,
      "End of log. 41.2 seconds, Eviscerate, hit, 1,812 damage",
    );
    assert.equal(
      doc.el("#log-step").textContent,
      "00:41.2 · Eviscerate · Hit · 1,812",
    );
    press("ArrowRight");
    assert.equal(doc.el("#log-readout").textContent, "End of log");
    assert.ok(logRows[0].classes.has("is-selected"));
    assert.equal(press("Home"), true);
    assert.ok(logRows[2].classes.has("is-selected"), "Home: the earliest");
    assert.equal(
      doc.el("#log-readout").textContent,
      "Start of log. 1 minute 1.5, Sinister Strike, hit, 99 damage",
    );
    press("ArrowLeft");
    assert.equal(doc.el("#log-readout").textContent, "Start of log");
    assert.ok(logRows[2].classes.has("is-selected"), "past the start: stays");
    assert.equal(press("Enter"), false, "other keys are left alone");

    store.set({ run: { state: "running", seed: SEED } });
    assert.equal(press("Home"), false, "running: Home is the browser's");
    assert.equal(doc.el("#log-readout").textContent, "");
    assert.equal(doc.el("#log-step").textContent, "");
    assert.equal(doc.el("#log-hint").textContent, "");
    assert.equal(doc.el("#log-hint").classes.has("visually-hidden"), false);
    assert.equal(logRows[1].classes.has("is-selected"), false);
  });

  it("U9 polish: the step announcer says a repeat again, one message a press", () => {
    const { doc } = windowedDocument(false);
    const frames = [];
    doc.defaultView.requestAnimationFrame = (run) => frames.push(run);
    doc.defaultView.cancelAnimationFrame = () => frames.splice(0);
    const rows = [{ ...LOG_ROW, id: 1, time: 1.5 }, LOG_ROW];
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({ frame: 1, log: rows, run: { state: "paused", seed: SEED } });
    const readout = doc.el("#log-readout");
    const scroll = doc.el(".combat-log-scroll");
    const press = (key) => scroll.fire("keydown", { key, preventDefault() {} });
    const said = [];
    const nextFrame = () => {
      frames.splice(0).forEach((run) => run());
      said.push(readout.textContent);
    };

    press("Home");
    assert.equal(readout.textContent, "", "emptied first");
    nextFrame();
    press("Home");
    assert.equal(readout.textContent, "", "the same words: emptied again");
    nextFrame();
    press("ArrowLeft");
    nextFrame();
    press("ArrowLeft");
    assert.equal(readout.textContent, "", "a bare repeat: emptied again");
    nextFrame();
    press("End");
    nextFrame();
    press("End");
    press("ArrowRight");
    assert.equal(frames.length, 1, "a newer press replaces a waiting one");
    nextFrame();
    const earliest = "1 minute 1.5, Sinister Strike, hit, 99 damage";
    const latest = "1.5 seconds, Sinister Strike, hit, 99 damage";
    assert.deepEqual(said, [
      `Start of log. ${earliest}`,
      `Start of log. ${earliest}`,
      "Start of log",
      "Start of log",
      `End of log. ${latest}`,
      "End of log",
    ]);
  });

  it("U9 log polish: the selected row scrolls into view, nearest (#221)", () => {
    const doc = recordingDocument();
    const rows = [
      { ...LOG_ROW, id: 2, time: 3 },
      { ...LOG_ROW, id: 1, time: 2 },
      { ...LOG_ROW, id: 0, time: 1 },
    ];
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({ frame: 1, log: rows, run: { state: "paused", seed: SEED } });
    const scroll = doc.el(".combat-log-scroll");
    const press = (key) => scroll.fire("keydown", { key, preventDefault() {} });
    const logRows = doc.el("#combat-log").children;
    // The unit-test DOM has no scrollIntoView: the step still works.
    press("ArrowLeft");
    assert.ok(logRows[0].classes.has("is-selected"));
    const scrolled = [];
    logRows.forEach((row, index) => {
      row.scrollIntoView = (options) => scrolled.push([index, options]);
    });
    for (const key of [
      "Home",
      "ArrowLeft",
      "ArrowRight",
      "End",
      "ArrowRight",
    ]) {
      press(key);
    }
    const nearest = { block: "nearest" };
    assert.deepEqual(scrolled, [
      [2, nearest],
      [2, nearest],
      [1, nearest],
      [0, nearest],
      [0, nearest],
    ]);
  });

  it("U9 log polish: Home and End in the hint and the key shortcuts (#221)", async () => {
    assert.equal(
      LOG_HINT,
      "Paused. Newest events first. Left and Right arrow keys step through the log: Left goes to older events, Right to newer. Home jumps to the oldest event, End to the newest.",
    );
    const html = await readFile(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    assert.match(html, /aria-keyshortcuts="ArrowLeft ArrowRight Home End"/);
    const doc = recordingDocument();
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({ run: { state: "paused", seed: SEED } });
    assert.equal(doc.el("#log-hint").textContent, LOG_HINT);
  });

  it("U9 log polish: the log rows' damage has commas (#221)", () => {
    const doc = recordingDocument();
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({
      frame: 1,
      log: [
        { ...LOG_ROW, id: 2, damage: 1234567.8 },
        { ...LOG_ROW, id: 1, damage: 3176.9 },
        { ...LOG_ROW, id: 0, damage: 99.9 },
      ],
    });
    const damage = doc
      .el("#combat-log")
      .children.map((row) => row.children[3])
      .map((cell) => [cell.className, cell.textContent]);
    assert.deepEqual(damage, [
      ["combat-log-damage", "1,234,567"],
      ["combat-log-damage", "3,176"],
      ["combat-log-damage", "99"],
    ]);
  });

  it("#200: a log row's name cell has the full name as its title", () => {
    const doc = recordingDocument();
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    store.set({
      frame: 1,
      log: [
        { ...LOG_ROW, id: 1, name: "Instant Poison VI", fromProc: true },
        { ...LOG_ROW, id: 0, damage: 123456 },
      ],
    });
    const names = doc
      .el("#combat-log")
      .children.map((row) => row.children[2])
      .map((cell) => [cell.className, cell.textContent, cell.title]);
    assert.deepEqual(names, [
      ["combat-log-name", "↳ Instant Poison VI", "Instant Poison VI"],
      ["combat-log-name", "Sinister Strike", "Sinister Strike"],
    ]);
  });

  it("U9 log polish: the start of a log that dropped rows is the kept log's (#221)", () => {
    const { doc } = windowedDocument(false);
    const max = k("log.maxEvents");
    // Newest first, ids from..to.
    const rows = (from, to) =>
      Array.from({ length: to - from + 1 }, (_, back) => {
        const id = to - back;
        return { ...LOG_ROW, id, time: id / 10, damage: id };
      });
    const store = createStore(plainReading());
    createVisualiserView(doc, store);
    const scroll = doc.el(".combat-log-scroll");
    const readout = doc.el("#log-readout");
    const say = (key) => {
      scroll.fire("keydown", { key, preventDefault() {} });
      return readout.textContent;
    };
    const pause = () => store.set({ run: { state: "paused", seed: SEED } });
    const resume = () => store.set({ run: { state: "running", seed: SEED } });

    // Exactly max rows, ids from 0: none dropped, the plain start.
    store.set({ frame: 1, log: rows(0, max - 1) });
    pause();
    assert.equal(say("Home"), `Start of log. ${logRowSpoken(rows(0, 0)[0])}`);
    assert.equal(say("ArrowLeft"), "Start of log");

    // Two more: the oldest two are dropped (the oldest kept id is 2), the
    // start is the kept log's.
    resume();
    store.set({ frame: 2, log: rows(2, max + 1) });
    pause();
    const kept = `Start of kept log (last ${max} events).`;
    assert.equal(kept, "Start of kept log (last 100 events).");
    const home = say("Home");
    assert.equal(home, `${kept} ${logRowSpoken(rows(2, 2)[0])}`);
    assert.equal(home.includes(".."), false, "no double period");
    assert.equal(say("ArrowLeft"), kept);
    assert.equal(say("ArrowLeft"), kept);
    assert.equal(
      say("End"),
      `End of log. ${logRowSpoken(rows(max + 1, max + 1)[0])}`,
      "End is unchanged",
    );
    assert.equal(say("ArrowRight"), "End of log");

    // A new fight starts its ids again: the plain start once more.
    resume();
    store.set({ frame: 3, log: rows(0, 4) });
    pause();
    assert.equal(say("ArrowLeft"), logRowSpoken(rows(4, 4)[0]));
    assert.equal(say("Home"), `Start of log. ${logRowSpoken(rows(0, 0)[0])}`);
  });

  // Fran's #222 check (#200): the drop is read from the ids, so a log that
  // has dropped rows before its first frame reaches the view is still the
  // kept log's, and a short log from id 0 is not.
  it("#200: dropped rows are read from the row ids, from the first frame", async () => {
    const max = k("log.maxEvents");
    const rows = (from, to) =>
      Array.from({ length: to - from + 1 }, (_, back) => {
        const id = to - back;
        return { ...LOG_ROW, id, time: id / 10, damage: id };
      });
    const firstFrame = (log) => {
      const { doc } = windowedDocument(false);
      const store = createStore(plainReading());
      createVisualiserView(doc, store);
      store.set({ frame: 1, log });
      store.set({ run: { state: "paused", seed: SEED } });
      doc.el(".combat-log-scroll").fire("keydown", {
        key: "Home",
        preventDefault() {},
      });
      return doc.el("#log-readout").textContent;
    };
    // The whole kept log arrives in one frame, after 500 rows: dropped.
    assert.equal(
      firstFrame(rows(500 - max, 499)),
      `Start of kept log (last ${max} events). ${logRowSpoken(rows(500 - max, 500 - max)[0])}`,
    );
    // A short first frame from id 0: nothing dropped.
    assert.equal(
      firstFrame(rows(0, 2)),
      `Start of log. ${logRowSpoken(rows(0, 0)[0])}`,
    );
    // The view keeps no count of its own.
    const source = await readFile(
      new URL("../js/views/visualiser.js", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /seenRows/);
  });

  it("U9 polish: identical frames write nothing to the buffs or cooldowns", () => {
    const doc = recordingDocument();
    const effect = (id, remaining, stacks = 1) => ({
      id,
      name: id,
      icon: null,
      remaining,
      duration: 30,
      stacks,
    });
    const effects = {
      buffs: [effect("snd", 7.4), effect("poison", 12, 3)],
      debuffs: [],
      cooldowns: [effect("sprint", 120), effect("vanish", 60)],
    };
    const store = createStore(plainReading({ effects }));
    createVisualiserView(doc, store);
    store.set({ frame: 1 });

    let writes = 0;
    const count = (node) => {
      for (const name of ["hidden"]) {
        let value = node[name];
        Object.defineProperty(node, name, {
          get: () => value,
          set: (next) => {
            writes += 1;
            value = next;
          },
        });
      }
      const style = node.style;
      let width = style.width;
      Object.defineProperty(style, "width", {
        get: () => width,
        set: (next) => {
          writes += 1;
          width = next;
        },
      });
      const { setAttribute, append } = node;
      node.setAttribute = (...args) => {
        writes += 1;
        setAttribute.apply(node, args);
      };
      node.append = (...args) => {
        writes += 1;
        append.apply(node, args);
      };
      let title = node.title;
      Object.defineProperty(node, "title", {
        get: () => title,
        set: (next) => {
          writes += 1;
          title = next;
        },
      });
    };
    const textWrites = (nodes) =>
      nodes.reduce((sum, node) => sum + node.writes, 0);
    const lists = ["#active-buffs", "#skill-cooldowns"].map(doc.el);
    const empties = ["#active-buffs-empty", "#skill-cooldowns-empty"];
    const items = lists.flatMap((list) => [...new Set(list.children)]);
    assert.equal(items.length, 4);
    const parts = items.flatMap((item) => [item, ...item.children]);
    const fills = items.flatMap((item) =>
      item.children.flatMap((part) => part.children),
    );
    [...lists, ...empties.map(doc.el), ...parts, ...fills].forEach(count);
    const before = textWrites([...parts, ...fills]);

    for (let frame = 2; frame < 12; frame += 1) {
      store.set({ frame, effects: structuredClone(effects) });
    }
    assert.equal(writes, 0, "no attribute, style, title, hidden or move");
    assert.equal(textWrites([...parts, ...fills]), before, "no text");

    // A change still lands: the cooldowns swap places and one time moves.
    store.set({
      frame: 12,
      effects: {
        ...effects,
        cooldowns: [effect("sprint", 50), effect("vanish", 60)],
      },
    });
    assert.ok(writes > 0);
    assert.ok(textWrites([...parts, ...fills]) > before);
    assert.equal(
      doc.el("#skill-cooldowns").children.at(-1).title,
      "sprint: 50s",
    );
  });

  it("Phase 3: announces buffs and the pause only when ticked, throttled (#150)", () => {
    const { doc } = windowedDocument(false);
    let now = 100;
    const store = createStore(plainReading());
    createVisualiserView(doc, store, { clock: () => now });
    const spoken = () => doc.el("#live-announcer").textContent;
    const moment = (seq, change) => ({ seq, change, name: "Slice and Dice" });

    store.set({ frame: 1, moment: moment(1, "apply") });
    store.set({ run: { state: "paused", seed: SEED } });
    assert.equal(spoken(), "", "off by default");

    doc.el("#announce-toggle").checked = true;
    store.set({ run: { state: "running", seed: SEED } });
    store.set({ frame: 2, moment: moment(2, "apply") });
    assert.equal(spoken(), "Slice and Dice up");
    now += 0.5;
    store.set({ frame: 3, moment: moment(3, "expire") });
    assert.equal(spoken(), "Slice and Dice up", "throttled");
    now += k("ui.announceIntervalSeconds");
    store.set({ frame: 4 });
    assert.equal(spoken(), "Slice and Dice expired", "said when it may be");
    store.set({ frame: 5 });
    assert.equal(spoken(), "Slice and Dice expired");

    // #45: the pause is #run-announce's to say, once; a key event waiting
    // when the fight pauses, finishes or stops is dropped, not said after.
    let frame = 6;
    let seq = 6;
    for (const run of [
      { state: "paused", seed: SEED },
      { state: "finished", seed: SEED },
      { state: "idle", seed: SEED, stoppedAt: 9.5 },
    ]) {
      const named = (name) => ({ seq: seq++, change: "apply", name });
      store.set({ run: { state: "running", seed: SEED, stoppedAt: null } });
      now += k("ui.announceIntervalSeconds");
      store.set({ frame: frame++, moment: named(`First ${run.state}`) });
      assert.equal(spoken(), `First ${run.state} up`);
      now += 0.5;
      store.set({ frame: frame++, moment: named(`Second ${run.state}`) });
      store.set({ run, results: { time: 83.9, damage: 18_450.9 } });
      now += k("ui.announceIntervalSeconds");
      store.set({ frame: frame++ });
      assert.equal(spoken(), `First ${run.state} up`, run.state);
    }
    store.set({ run: { state: "running", seed: SEED, stoppedAt: null } });

    store.set({ frame: 7, moment: moment(4, "apply") });
    assert.equal(spoken(), "Slice and Dice up");
    now += 0.5;
    store.set({ frame: 8, moment: moment(5, "expire") });
    doc.el("#announce-toggle").checked = false;
    doc.el("#announce-toggle").fire("change");
    doc.el("#announce-toggle").checked = true;
    doc.el("#announce-toggle").fire("change");
    now += k("ui.announceIntervalSeconds");
    store.set({ frame: 9 });
    assert.equal(spoken(), "", "turning it off drops the waiting message");

    doc.el("#announce-toggle").checked = false;
    doc.el("#announce-toggle").fire("change");
    assert.equal(spoken(), "");
  });
});

describe("visualiser readings (#150)", () => {
  it("timedEffectReading: time, bar, stacks and label", () => {
    const effect = { name: "X", remaining: 5, duration: 10, stacks: 2 };
    assert.deepEqual(timedEffectReading(effect, true), {
      time: "5s",
      low: false,
      percent: 50,
      stacks: "×2",
      label: "X, 5 seconds left, 2 stacks",
    });
    const low = k("ui.auraLowSeconds") - 0.04;
    assert.equal(
      timedEffectReading({ ...effect, remaining: low }, true).low,
      true,
    );
    assert.equal(
      timedEffectReading({ ...effect, remaining: k("ui.auraLowSeconds") }, true)
        .low,
      false,
    );
    assert.equal(
      timedEffectReading({ ...effect, remaining: 1, stacks: 1 }, true).label,
      "X, 1.0 seconds left, 1 stack",
    );
    assert.equal(
      timedEffectReading({ ...effect, remaining: 1.2, stacks: 1 }, false).label,
      "X, 1 second left",
    );
    assert.equal(
      timedEffectReading({ ...effect, duration: 0 }, false).percent,
      0,
    );
    assert.equal(
      timedEffectReading({ ...effect, duration: 4 }, false).percent,
      100,
    );
  });

  it("logRowReading and logRowSpoken", () => {
    assert.equal(
      logRowReading({ time: 59.96, name: "A", status: "Miss", damage: 0 }),
      "00:59.9 · A · Miss · 0",
    );
    assert.equal(
      logRowReading({ time: 600.05, name: "B", status: "Hit", damage: 3.7 }),
      "10:00.0 · B · Hit · 3",
    );
    // #45 (Fran, Scout): the spoken copy of the same row.
    assert.equal(
      logRowSpoken({ time: 41.25, name: "A", status: "Crit", damage: 412.9 }),
      "41.2 seconds, A, crit, 412 damage",
    );
    assert.equal(
      logRowSpoken({ time: 72.46, name: "B", status: "Hit", damage: 1234.5 }),
      "1 minute 12.4, B, hit, 1,234 damage",
    );
    assert.equal(
      logRowSpoken({ time: 300, name: "C", status: "Miss", damage: 0 }),
      "5 minutes, C, miss, 0 damage",
    );
  });

  it("createAnnouncer: one message per interval, the newest waits", () => {
    let now = 0;
    let on = true;
    const said = [];
    const timers = [];
    const announcer = createAnnouncer({
      now: () => now,
      enabled: () => on,
      speak: (text) => said.push(text),
      later: (wait, run) => timers.push({ wait, run }),
    });
    const gap = k("ui.announceIntervalSeconds");
    announcer.say("a");
    announcer.say("b");
    announcer.say("c");
    assert.deepEqual(said, ["a"]);
    assert.equal(timers.length, 1, "one timer for the waiting message");
    assert.equal(timers[0].wait, gap);
    now = gap - 0.01;
    announcer.flush();
    assert.deepEqual(said, ["a"]);
    now = gap;
    timers[0].run();
    assert.deepEqual(said, ["a", "c"], "the newest, b is dropped");
    now += gap / 2;
    announcer.say("c2");
    assert.equal(timers.length, 2, "a new timer once the last has run");
    now += gap / 2;
    timers[1].run();
    assert.deepEqual(said, ["a", "c", "c2"]);
    on = false;
    now += gap;
    announcer.say("d");
    on = true;
    announcer.flush();
    assert.deepEqual(said, ["a", "c", "c2"], "not kept while off");
    announcer.say("e");
    announcer.clear();
    now += gap;
    announcer.flush();
    assert.deepEqual(said, ["a", "c", "c2", "e"]);
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
