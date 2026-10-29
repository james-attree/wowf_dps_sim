import assert from "node:assert/strict";
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
import { batchTotals, createResultsView } from "../js/views/results.js";
import {
  createAnnouncer,
  createVisualiserView,
  logRowReading,
  pausedReading,
  timedEffectReading,
} from "../js/views/visualiser.js";

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
    assert.equal(doc.el("#pause-button").getAttribute("aria-pressed"), "true");
    assert.equal(doc.el("#pause-label").textContent, "Resume");
    assert.equal(doc.el("#pause-icon").textContent, "▶");
    assert.equal(doc.el("#run-status-text").textContent, "Paused at 00:00");
    assert.ok(doc.el("#run-status").classes.has("is-paused"));
    doc.el("#pause-button").click();
    assert.deepEqual(calls, ["pause", "resume"]);

    setState("running");
    assert.equal(doc.el("#pause-button").getAttribute("aria-pressed"), "false");
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
    assert.equal(doc.el("#damage-value").textContent, "25180");
    assert.equal(doc.el("#dps-value").textContent, "200");
    assert.equal(doc.el("#dps-value").value, "200");

    store.set({ results: { time: 3000.5, damage: 0 } });
    assert.equal(doc.el("#time-value").textContent, "50:00");

    store.set({ results: { time: 0, damage: 0 } });
    assert.equal(doc.el("#time-value").textContent, "00:00");
    assert.equal(doc.el("#dps-value").textContent, "0");

    const writes = doc.el("#dps-value").writes;
    store.set({ frame: 1, run: pageRun({ state: "paused" }) });
    assert.equal(doc.el("#dps-value").writes, writes, "other slices: no draw");
  });

  it("batch mode: Total damage and DPS show the batch, a partial Stop too (#154)", () => {
    const doc = recordingDocument();
    const { store } = pageStore();
    createResultsView(doc, store);
    store.set({ results: { time: 10, damage: 2000 } });
    assert.equal(doc.el("#dps-value").textContent, "200");

    // Switching to batch mode shows the (empty) batch, not the live fight.
    store.set({ run: pageRun({ mode: "batch" }) });
    assert.equal(doc.el("#damage-value").textContent, "0");
    assert.equal(doc.el("#dps-value").textContent, "0");

    // While it runs: the running mean, over the run's fight length.
    store.set({
      run: pageRun({ mode: "batch", state: "running", duration: 300 }),
      batch: {
        ...emptyBatch("main"),
        status: "running",
        progress: { completed: 40, total: 100, mean: 250.4 },
      },
    });
    assert.equal(doc.el("#damage-value").textContent, "75120");
    assert.equal(doc.el("#dps-value").textContent, "250");

    // Stopped after 40 fights: the partial result's per-fight figures. Before
    // #154 both tiles read 0 here.
    const partial = {
      completed: 40,
      iterations: 100,
      cancelled: true,
      duration: 300,
      summary: { mean: 251.6 },
      breakdown: { fights: 40, totalDamage: 40 * 75_480 },
    };
    store.set({
      run: pageRun({ mode: "batch", state: "idle", duration: 300 }),
      batch: { ...emptyBatch("main"), status: "cancelled", result: partial },
    });
    assert.equal(doc.el("#damage-value").textContent, "75480");
    assert.equal(doc.el("#dps-value").textContent, "252");

    // The live clock does not overwrite the batch totals.
    store.set({ results: { time: 20, damage: 9000 } });
    assert.equal(doc.el("#time-value").textContent, "00:20");
    assert.equal(doc.el("#dps-value").textContent, "252");

    // Back to live mode: the live fight again.
    store.set({ run: pageRun({ mode: "live" }) });
    assert.equal(doc.el("#dps-value").textContent, "450");
  });

  it("batchTotals reads 0 with no fight finished, and after a Stop at 0 fights", () => {
    const run = pageRun({ mode: "batch" });
    assert.deepEqual(batchTotals({ run, batch: emptyBatch("main") }), {
      damage: 0,
      dps: 0,
    });
    assert.deepEqual(
      batchTotals({
        run,
        batch: {
          ...emptyBatch("main"),
          status: "running",
          progress: { completed: 0, total: 10, mean: null },
        },
      }),
      { damage: 0, dps: 0 },
    );
    assert.deepEqual(
      batchTotals({
        run,
        batch: {
          ...emptyBatch("main"),
          status: "cancelled",
          result: { completed: 0, summary: { mean: null } },
        },
      }),
      { damage: 0, dps: 0 },
    );
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
      { ...LOG_ROW, id: 2, time: 41.25, name: "Eviscerate", damage: 812.4 },
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

    store.set({ run: { state: "paused", seed: SEED } });
    assert.match(doc.el("#log-readout").textContent, /^Paused\./);
    assert.equal(press("ArrowLeft"), true);
    assert.equal(
      doc.el("#log-readout").textContent,
      "00:41.2 · Eviscerate · Hit · 812",
    );
    const logRows = doc.el("#combat-log").children;
    assert.equal(logRows[0].getAttribute("aria-current"), "true");
    press("ArrowLeft");
    assert.equal(
      doc.el("#log-readout").textContent,
      "00:40.5 · Sinister Strike · Crit · 412",
    );
    assert.equal(logRows[0].getAttribute("aria-current"), null);
    assert.ok(logRows[1].classes.has("is-selected"));
    press("ArrowLeft");
    press("ArrowLeft");
    assert.ok(logRows[2].classes.has("is-selected"), "stops at the oldest");
    press("ArrowRight");
    assert.ok(logRows[1].classes.has("is-selected"));
    assert.equal(press("Enter"), false, "other keys are left alone");

    store.set({ run: { state: "running", seed: SEED } });
    assert.equal(doc.el("#log-readout").textContent, "");
    assert.equal(logRows[1].classes.has("is-selected"), false);
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

    now += k("ui.announceIntervalSeconds");
    store.set({
      run: { state: "paused", seed: SEED },
      results: { time: 83.9, damage: 18_450.9 },
    });
    assert.equal(spoken(), "Paused at 01:23, 18,450 damage, 219 DPS");
    now += k("ui.announceIntervalSeconds");
    store.set({ frame: 6 });
    assert.equal(
      spoken(),
      "Paused at 01:23, 18,450 damage, 219 DPS",
      "a moment is said once",
    );

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

  it("logRowReading and pausedReading", () => {
    assert.equal(
      logRowReading({ time: 59.96, name: "A", status: "Miss", damage: 0 }),
      "00:59.9 · A · Miss · 0",
    );
    assert.equal(
      logRowReading({ time: 600.05, name: "B", status: "Hit", damage: 3.7 }),
      "10:00.0 · B · Hit · 3",
    );
    assert.equal(
      pausedReading({ time: 0, damage: 0 }),
      "Paused at 00:00, 0 damage, 0 DPS",
    );
    assert.equal(
      pausedReading({ time: 3601, damage: 7_654_321 }),
      "Paused at 60:01, 7,654,321 damage, 2,125 DPS",
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
