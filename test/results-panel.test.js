import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { k } from "../data/constants.js";
import { referenceBuild } from "../data/reference-build.js";
import { BatchRunner, runBatch } from "../js/batch-runner.js";
import { buildLabel, poisonName } from "../js/build-label.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { emptyBatch } from "../js/run-actions.js";
import { createStore } from "../js/store.js";
import { toMarkup } from "../js/svg.js";
import { createResultsPanelView } from "../js/views/results-panel.js";
import {
  announcement,
  breakdownModel,
  DEFAULT_SORT,
  energyCapFlag,
  nextSort,
  panelModel,
  sortRows,
  standardError,
  timeEstimate,
  Z95,
} from "../js/views/results-render.js";

// Issue #154: the batch results panel (Fran's spec, design/154). The render
// functions are pure and return js/svg.js nodes, so these tests read their
// markup; the view is driven through a small stand-in DOM.

const LABELS = { buildLabel, poisonName };
const config = () => ({ ...pageDefaultConfig(), talents: referenceBuild() });
const OPTIONS = { seed: 154, iterations: 24, duration: 60 };
const text = (nodes) =>
  [nodes]
    .flat()
    .map(toMarkup)
    .join("")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const markup = (nodes) => [nodes].flat().map(toMarkup).join("");

// A batch stopped after `fights` fights (0, 1 or more).
function stopped(fights) {
  const runner = new BatchRunner({ ...OPTIONS, config: config() });
  runner.run();
  if (fights > 0) {
    runner.advance(fights);
  }
  runner.cancel();
  return runner.result;
}

const RUN = {
  mode: "batch",
  state: "idle",
  seed: OPTIONS.seed,
  duration: OPTIONS.duration,
  iterations: OPTIONS.iterations,
  snapshot: null,
};
const batchState = (overrides) => ({ ...emptyBatch("worker"), ...overrides });

let done;
let partial;
let single;
let zero;
before(() => {
  done = runBatch({ ...OPTIONS, config: config() });
  partial = stopped(5);
  single = stopped(1);
  zero = stopped(0);
});

describe("the results figures (#154)", () => {
  it("are per fight: the total row equals the mean DPS times the fight length", () => {
    const model = breakdownModel(done);
    assert.ok(
      Math.abs(model.totalPerFight - done.summary.mean * done.duration) < 1e-6,
    );
    assert.equal(
      model.totalPerFight,
      done.breakdown.totalDamage / done.breakdown.fights,
    );
    const sum = model.damageRows.reduce((total, row) => total + row.damage, 0);
    assert.ok(Math.abs(sum - model.totalPerFight) < 1e-6);
  });

  it("shows no parry or block column from behind, and no glance on a yellow row", () => {
    const model = breakdownModel(done);
    assert.equal(model.outcomes.includes("parry"), false);
    assert.equal(model.outcomes.includes("block"), false);
    assert.ok(model.outcomes.includes("crit"));
    for (const row of model.damageRows) {
      if (row.origin !== "white") {
        assert.equal(row.glancing, null, row.name);
      }
    }
    const html = markup(
      panelModel(
        { batch: batchState({ status: "done", result: done }), run: RUN },
        LABELS,
      ).body,
    );
    assert.equal(/>Parry</.test(html), false);
    assert.equal(/>Block</.test(html), false);
    assert.match(html, /<tfoot>/);
  });

  it("derives the standard error from the 95% interval", () => {
    assert.equal(
      standardError(done.summary),
      done.summary.ci95.halfWidth / Z95,
    );
    assert.equal(standardError(single.summary), null);
  });

  it("flags the energy cap over 5% of the fight, from 10 fights", () => {
    assert.equal(k("ui.energyCapWarnFraction"), 0.05);
    assert.equal(k("ui.energyCapWarnMinFights"), 10);
    const flag = (fraction, fights) =>
      energyCapFlag({ energyCappedFraction: fraction, fights });
    assert.equal(flag(0.0501, 10), true);
    assert.equal(flag(0.05, 10), false);
    assert.equal(flag(0.5, 9), false);
    assert.equal(flag(null, 100), false);
  });

  it("sorts stably, a missing figure last, and reverses on a second press", () => {
    const rows = [
      { name: "b", damage: 3, avg: null },
      { name: "a", damage: 1, avg: 5 },
      { name: "c", damage: 2, avg: 5 },
    ];
    assert.deepEqual(
      sortRows(rows, DEFAULT_SORT).map((row) => row.name),
      ["b", "c", "a"],
    );
    for (const direction of ["ascending", "descending"]) {
      assert.deepEqual(
        sortRows(rows, { key: "avg", direction }).map((row) => row.name),
        ["a", "c", "b"],
      );
    }
    assert.deepEqual(nextSort(DEFAULT_SORT, "name"), {
      key: "name",
      direction: "ascending",
    });
    assert.deepEqual(nextSort(DEFAULT_SORT, "damage"), {
      key: "damage",
      direction: "ascending",
    });
    assert.deepEqual(nextSort(DEFAULT_SORT, "share"), {
      key: "share",
      direction: "descending",
    });
  });

  it("estimates the time left only after 5% of the fights or 2 s", () => {
    assert.equal(timeEstimate(0, 1000, 5000), "starting…");
    assert.equal(timeEstimate(10, 1000, 1000), "1 s elapsed");
    assert.equal(timeEstimate(50, 1000, 1000), "1 s elapsed · about 19 s left");
    assert.equal(
      timeEstimate(10, 1000, 2000),
      "2 s elapsed · about 198 s left",
    );
  });
});

describe("the results panel states (#154)", () => {
  const model = (batch, run = RUN) =>
    panelModel({ batch: batchState(batch), run }, LABELS);

  it("starts empty, with no buttons", () => {
    const empty = model({});
    assert.equal(empty.title, "Results");
    assert.equal(empty.meta, "");
    assert.match(text(empty.body), /No batch results yet/);
    assert.equal(/<button/.test(markup(empty.body)), false);
  });

  it("draws 0 of N at once, with the previous result greyed out and inert", () => {
    const running = model(
      {
        status: "running",
        progress: { completed: 0, total: 24, mean: null },
        previous: done,
      },
      { ...RUN, state: "running", snapshot: config() },
    );
    assert.equal(running.title, "Running batch…");
    assert.equal(running.busy, true);
    assert.equal(
      running.meta,
      "24 × 60 s fights · seed 154 · Combat 18/33/0 · Default (Combat) · Instant MH, Deadly OH",
    );
    const html = markup(running.body);
    assert.match(text(running.body), /0 of 24 fights/);
    assert.match(html, /<progress[^>]*value="0"/);
    assert.match(html, /class="previous-result" inert=""/);
    assert.match(text(running.body), /PREVIOUS RESULT · seed 154/);

    // The first progress message clears `previous` (js/run-actions.js).
    const cleared = model(
      {
        status: "running",
        progress: { completed: 3, total: 24, mean: 250 },
        previous: null,
        elapsedMs: 500,
      },
      { ...RUN, state: "running", snapshot: config() },
    );
    assert.equal(/previous-result/.test(markup(cleared.body)), false);
    assert.match(text(cleared.body), /3 of 24 fights · 12%/);
  });

  it("notes a batch on the page thread while it runs", () => {
    const running = model({
      status: "running",
      mode: "main",
      progress: { completed: 1, total: 24, mean: 250 },
    });
    assert.match(text(running.body), /Running on the page/);
  });

  it("shows a finished batch: tables, no panel buttons besides the sort", () => {
    const shown = model({ status: "done", result: done, elapsedMs: 2000 });
    assert.equal(shown.title, "Results");
    assert.equal(shown.busy, false);
    assert.equal(
      shown.meta,
      "24 × 60 s fights · seed 154 · Combat 18/33/0 · Default (Combat) · Instant MH, Deadly OH",
    );
    const html = markup(shown.body);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    assert.ok(buttons.length > 0);
    for (const button of buttons) {
      assert.match(button, /data-sort=/);
    }
    assert.match(text(shown.body), /Damage by ability/);
    assert.match(html, /Instant Poison/);
  });

  it("marks a stopped batch partial, with and without an interval", () => {
    const shown = model({ status: "cancelled", result: partial });
    assert.equal(shown.title, "Results (partial)");
    assert.match(text(shown.body), /PARTIAL/);
    assert.match(text(shown.body), /5 \/ 24/);
    assert.match(shown.meta, /^5 × 60 s fights · seed 154/);

    const one = model({ status: "cancelled", result: single });
    assert.equal(one.title, "Results (partial)");
    assert.match(text(one.body), /One fight only/);
    assert.equal(/Damage by ability/.test(text(one.body)), false);
  });

  it("says Stopped, 0 fights when Stop came before any fight finished", () => {
    const shown = model({ status: "cancelled", result: zero });
    assert.equal(shown.title, "Results");
    assert.match(shown.meta, /^Stopped · 0 of 24 fights · seed 154/);
    assert.equal(/Average DPS/.test(text(shown.body)), false);
  });

  it("shows an error as an alert with the technical detail folded away", () => {
    const shown = model({
      status: "error",
      error: { name: "Error", message: "boom" },
      progress: { completed: 3, total: 24 },
    });
    const html = markup(shown.body);
    assert.match(html, /role="alert"/);
    assert.match(html, /<details>/);
    assert.match(text(shown.body), /boom/);
  });
});

describe("the results panel live region (#154)", () => {
  const running = (completed) =>
    batchState({
      status: "running",
      progress: { completed, total: 100, mean: completed ? 250 : null },
    });

  it("says the start, each quarter once, and the finish", () => {
    const idle = batchState({});
    assert.equal(announcement(idle, running(0)), "Batch started, 100 fights.");
    assert.equal(announcement(running(0), running(24)), null);
    assert.equal(
      announcement(running(24), running(25)),
      "Batch 25% done, 25 of 100 fights.",
    );
    assert.equal(announcement(running(25), running(49)), null);
    assert.equal(
      announcement(running(49), running(76)),
      "Batch 75% done, 76 of 100 fights.",
    );
    assert.match(
      announcement(running(99), batchState({ status: "done", result: done })),
      /^Batch finished: [\d.,]+ DPS, plus or minus [\d.]+\.$/,
    );
    assert.equal(
      announcement(
        running(5),
        batchState({ status: "cancelled", result: partial }),
      ),
      "Batch stopped: partial result from 5 of 24 fights.",
    );
    assert.equal(
      announcement(
        running(0),
        batchState({ status: "cancelled", result: zero }),
      ),
      "Batch stopped before any fight finished.",
    );
    // A slice change that is not a batch transition says nothing.
    const shown = batchState({ status: "done", result: done });
    assert.equal(announcement(shown, shown), null);
  });
});

// A small DOM: enough of Element for toDom and the panel view.
function node(tag) {
  const attributes = new Map();
  return {
    tag,
    attributes,
    children: [],
    parentElement: null,
    listeners: new Map(),
    focused: false,
    hidden: false,
    _text: "",
    get textContent() {
      return this.children.length > 0
        ? this.children.map((child) => child.textContent).join("")
        : this._text;
    },
    set textContent(value) {
      this.children = [];
      this._text = String(value);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = [];
      children.forEach((child) => this.appendChild(child));
    },
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    matches(selector) {
      const [, tagName, name, value] = selector.match(
        /^([a-z0-9]*)(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/,
      );
      return (
        (tagName === "" || tagName === this.tag) &&
        (name === undefined ||
          (attributes.has(name) &&
            (value === undefined || attributes.get(name) === value)))
      );
    },
    closest(selector) {
      for (let at = this; at; at = at.parentElement) {
        if (at.matches?.(selector)) {
          return at;
        }
      }
      return null;
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches?.(selector)) {
          return child;
        }
        const found = child.querySelector?.(selector);
        if (found) {
          return found;
        }
      }
      return null;
    },
    contains(other) {
      for (let at = other; at; at = at.parentElement) {
        if (at === this) {
          return true;
        }
      }
      return false;
    },
    focus() {
      this.focused = true;
    },
  };
}

function panelDocument() {
  const ids = new Map();
  return {
    querySelector(selector) {
      if (!ids.has(selector)) {
        ids.set(selector, node("div"));
      }
      return ids.get(selector);
    },
    createElement: (tag) => node(tag),
    createElementNS: (namespace, tag) => node(tag),
    createTextNode: (value) => ({ textContent: value, parentElement: null }),
  };
}

describe("the results panel view (#154)", () => {
  function mount(batch) {
    const doc = panelDocument();
    const store = createStore({ run: RUN, batch: batchState(batch) });
    createResultsPanelView(doc, store, LABELS);
    return { doc, store, el: (id) => doc.querySelector(id) };
  }

  it("is busy while a batch runs, and announces it", () => {
    const { store, el } = mount({});
    assert.equal(el("#results-panel").getAttribute("aria-busy"), null);
    assert.equal(el("#results-meta").hidden, true);
    store.set({
      batch: batchState({
        status: "running",
        progress: { completed: 0, total: 24, mean: null },
      }),
    });
    assert.equal(el("#results-panel").getAttribute("aria-busy"), "true");
    assert.equal(el("#results-heading").textContent, "Running batch…");
    assert.equal(
      el("#results-announce").textContent,
      "Batch started, 24 fights.",
    );
    store.set({ batch: batchState({ status: "done", result: done }) });
    assert.equal(el("#results-panel").getAttribute("aria-busy"), null);
    assert.equal(el("#results-meta").hidden, false);
    assert.match(el("#results-announce").textContent, /^Batch finished/);
  });

  it("sorts the breakdown in place, keeps focus on the button and says so", () => {
    const { store, el } = mount({ status: "done", result: done });
    const body = el("#results-body");
    const region = body.querySelector("[data-breakdown]");
    const button = region.querySelector('button[data-sort="name"]');
    body.listeners.get("click")({ target: button });
    const sorted = region.querySelector('button[data-sort="name"]');
    assert.notEqual(sorted, button, "the table was redrawn");
    assert.equal(sorted.focused, true);
    assert.equal(sorted.parentElement.getAttribute("aria-sort"), "ascending");
    assert.equal(
      body.querySelector("[data-sort-status]").textContent,
      "Sorted by Ability, ascending.",
    );
    const names = region
      .querySelector("tbody")
      .children.map((row) => row.children[0].children[0].textContent);
    assert.deepEqual(names, [...names].sort());

    // A new result goes back to Damage, high to low.
    store.set({ batch: batchState({ status: "done", result: partial }) });
    const fresh = el("#results-body").querySelector(
      'th[aria-sort="descending"]',
    );
    assert.equal(fresh.getAttribute("data-key"), "damage");
  });

  it("ignores a sort press on the greyed previous result", () => {
    const { el } = mount({
      status: "running",
      progress: { completed: 0, total: 24, mean: null },
      previous: done,
    });
    const body = el("#results-body");
    const button = body.querySelector('button[data-sort="name"]');
    assert.ok(button.closest("[inert]"));
    body.listeners.get("click")({ target: button });
    assert.equal(button.focused, false);
  });
});
