import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { createStore } from "../js/store.js";
import { createTalentTree } from "../js/talent-tree.js";
import { NARROW_QUERY } from "../js/views/breakpoints.js";
import {
  createTalentTreeView,
  nextTalent,
  tileKeyAction,
} from "../js/views/talent-tree.js";

// Issue #204 (U6): the talent tree's view on a stand-in page. Tiles are made
// once and patched in place, so focus stays on the tile you act on; the
// keys follow Fran's U6 spec section 8; below NARROW_QUERY the trees are tabs.

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
    this.parent = null;
  }
}

class FakeElement {
  constructor(doc, tag) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.listeners = new Map();
    this.childNodes = [];
    this.parent = null;
    this.hidden = false;
    this.value = "";
    this.src = "";
  }
  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(text) {
    this.replaceChildren(new FakeText(String(text)));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    const full = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...event,
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(full);
    }
    return full;
  }
  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === "string" ? new FakeText(node) : node;
      child.parent = this;
      this.childNodes.push(child);
    }
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    for (const node of this.childNodes) {
      node.parent = null;
    }
    this.childNodes = [];
    this.append(...nodes);
  }
  focus() {
    this.doc.activeElement = this;
    this.dispatch("focus");
  }
  click(event = {}) {
    return this.dispatch("click", event);
  }
  *walk() {
    for (const child of this.children) {
      yield child;
      yield* child.walk();
    }
  }
  find(test) {
    for (const node of this.walk()) {
      if (test(node)) {
        return node;
      }
    }
    return null;
  }
  findAll(test) {
    return [...this.walk()].filter(test);
  }
  connected() {
    let node = this;
    while (node.parent !== null) {
      node = node.parent;
    }
    return node === this.doc.body;
  }
}

const IDS = [
  "talents-summary",
  "talents-edit",
  "talent-tree",
  "talents-reset",
  "talents-close",
  "talents-level",
  "talents-level-error",
  "talents-points",
  "talents-message",
  "talents-tabs",
  "talents-trees",
  "talents-legend",
  "talents-detail",
  "talents-effects",
  "talents-live",
];

function page({ config = pageDefaultConfig(), narrow = false } = {}) {
  const doc = {
    activeElement: null,
    createElement: (tag) => new FakeElement(doc, tag),
    createElementNS: (_ns, tag) => new FakeElement(doc, tag),
    createTextNode: (text) => new FakeText(text),
    querySelector(selector) {
      const id = selector.replace(/^#/, "");
      return doc.body.find((node) => node.getAttribute("id") === id);
    },
  };
  doc.body = new FakeElement(doc, "body");
  for (const id of IDS) {
    const node = new FakeElement(doc, id === "talents-level" ? "input" : "div");
    node.setAttribute("id", id);
    doc.body.append(node);
  }
  const listeners = [];
  const media = {
    matches: narrow,
    addEventListener: (_type, listener) => listeners.push(listener),
  };
  const queries = [];
  const store = createStore({ config });
  const actions = createTalentTree(store);
  const unsubscribe = createTalentTreeView(doc, store, actions, {
    matchMedia: (query) => {
      queries.push(query);
      return media;
    },
  });
  const $ = (id) => doc.querySelector(`#${id}`);
  const tile = (id) =>
    doc.body.find((node) => node.getAttribute("data-id") === id);
  const setNarrow = (value) => {
    media.matches = value;
    for (const listener of listeners) {
      listener();
    }
  };
  return { doc, store, actions, $, tile, queries, setNarrow, unsubscribe };
}

describe("talent tree view helpers (#204)", () => {
  const cells = [
    { id: "a", row: 1, col: 1 },
    { id: "b", row: 1, col: 3 },
    { id: "c", row: 2, col: 2 },
    { id: "d", row: 4, col: 3 },
  ];

  it("arrows move in reading order and to the nearest row (§8)", () => {
    assert.equal(nextTalent(cells, "a", "ArrowRight"), "b");
    assert.equal(nextTalent(cells, "b", "ArrowRight"), "c");
    assert.equal(nextTalent(cells, "c", "ArrowLeft"), "b");
    assert.equal(nextTalent(cells, "a", "ArrowLeft"), null);
    assert.equal(nextTalent(cells, "d", "ArrowRight"), null);
    assert.equal(nextTalent(cells, "b", "ArrowDown"), "c");
    assert.equal(nextTalent(cells, "c", "ArrowDown"), "d", "skips empty rows");
    assert.equal(nextTalent(cells, "d", "ArrowUp"), "c");
    assert.equal(nextTalent(cells, "c", "ArrowUp"), "a");
    assert.equal(nextTalent(cells, "c", "Home"), "a");
    assert.equal(nextTalent(cells, "a", "End"), "d");
    assert.equal(nextTalent(cells, "a", "x"), null);
  });

  it("maps the add and remove keys, never right-click only (§8)", () => {
    for (const key of ["Enter", " ", "+", "="]) {
      assert.equal(tileKeyAction({ key }), "add", key);
    }
    for (const key of ["-", "Backspace", "Delete"]) {
      assert.equal(tileKeyAction({ key }), "remove", key);
    }
    assert.equal(tileKeyAction({ key: "Enter", shiftKey: true }), "remove");
    assert.equal(tileKeyAction({ key: "ArrowUp" }), null);
  });
});

describe("talent tree view (#204)", () => {
  it("draws the summary row and opens and closes the panel", () => {
    const { $, store, queries } = page();
    assert.deepEqual(queries, [NARROW_QUERY]);
    assert.equal($("talents-summary").textContent, "No talents");
    assert.equal($("talent-tree").hidden, true);
    assert.equal($("talents-edit").getAttribute("aria-expanded"), "false");
    $("talents-edit").click();
    assert.equal($("talent-tree").hidden, false);
    assert.equal($("talents-edit").getAttribute("aria-expanded"), "true");
    assert.equal($("talents-edit").textContent, "Close talents");
    $("talents-close").click();
    assert.equal(store.get().talents.open, false);
    assert.equal($("talent-tree").hidden, true);
  });

  it("builds three trees of tiles, one tab stop each, with accessible names", () => {
    const { doc } = page();
    const tiles = doc.body.findAll((node) => node.getAttribute("data-id"));
    assert.equal(tiles.length, 53);
    const stops = tiles.filter((node) => node.getAttribute("tabindex") === "0");
    assert.equal(stops.length, 3);
    const grids = doc.body.findAll(
      (node) => node.getAttribute("role") === "group",
    );
    assert.deepEqual(
      grids.map((grid) => grid.getAttribute("aria-label")),
      [
        "Assassination talents, 0 points",
        "Combat talents, 0 points",
        "Subtlety talents, 0 points",
      ],
    );
    const lethality = tiles.find(
      (node) => node.getAttribute("data-id") === "assassination.lethality",
    );
    assert.match(lethality.getAttribute("aria-label"), /locked: Needs 10/);
    assert.match(lethality.getAttribute("class"), /\bis-locked\b/);
  });

  it("adds with a click or Enter and removes with − or Shift+click; focus stays", () => {
    const { tile, store, $, doc } = page();
    const id = "combat.improved-sinister-strike";
    const node = tile(id);
    node.focus();
    assert.equal(store.get().talents.selected, id);
    node.click();
    assert.equal(store.get().config.talents[id], 1);
    node.dispatch("keydown", { key: "Enter" });
    assert.equal(store.get().config.talents[id], 2);
    assert.equal(tile(id), node, "the same tile, patched in place");
    assert.equal(doc.activeElement, node);
    assert.equal(node.connected(), true);
    assert.match(node.getAttribute("class"), /\bis-maxed\b/);
    assert.equal(
      $("talents-live").textContent,
      "Improved Sinister Strike 2 of 2. Combat 2 points. 2 of 51 spent, 49 left.",
    );
    node.dispatch("keydown", { key: "-" });
    assert.equal(store.get().config.talents[id], 1);
    node.click({ shiftKey: true });
    assert.equal(store.get().config.talents[id], undefined);
    const menu = node.dispatch("contextmenu");
    assert.equal(menu.defaultPrevented, true);
    assert.equal($("talents-summary").textContent, "No talents");
  });

  it("keeps a tile's child nodes through a select, a rank change and a lock (Fran's QA of #208)", () => {
    // The first click on an unfocused tile was lost: focus selected it, the
    // redraw rebuilt the tile, and the icon under the pointer was detached
    // between mousedown and mouseup. The tile's nodes must stay put.
    const { tile, store } = page();
    const id = "combat.improved-sinister-strike";
    const node = tile(id);
    const [image, ...badges] = node.childNodes;
    assert.equal(image.tagName, "IMG");
    const before = [...node.childNodes];
    const same = () =>
      node.childNodes.length === before.length &&
      node.childNodes.every((child, at) => child === before[at]);
    node.focus();
    assert.equal(store.get().talents.selected, id);
    assert.equal(same(), true, "select keeps the nodes");
    node.click();
    assert.equal(store.get().config.talents[id], 1);
    assert.equal(same(), true, "a rank change keeps the nodes");
    assert.equal(image.parent, node, "the icon is never detached");
    assert.equal(
      badges.find((badge) => badge.getAttribute("class") === "talent-rank")
        ?.textContent,
      "1/2",
    );
    node.click({ shiftKey: true });
    assert.equal(store.get().config.talents[id], undefined);
    assert.equal(same(), true, "a removal keeps the nodes");
  });

  it("moves the roving tab stop with the arrow keys", () => {
    const { tile, doc } = page();
    const first = tile("combat.improved-eviscerate");
    first.focus();
    const event = first.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(event.defaultPrevented, true);
    const next = doc.activeElement;
    assert.notEqual(next, first);
    assert.equal(next.getAttribute("tabindex"), "0");
    assert.equal(first.getAttribute("tabindex"), "-1");
  });

  it("shows a refused removal with Show buttons that move focus", () => {
    const { tile, $, doc } = page({
      config: { ...pageDefaultConfig(), talents: referenceBuild() },
    });
    tile("assassination.malice").dispatch("keydown", { key: "Backspace" });
    const banner = $("talents-message");
    assert.match(banner.textContent, /^Can't remove a point from Malice/);
    const shows = banner.findAll((node) => node.tagName === "BUTTON");
    assert.deepEqual(
      shows.map((button) => button.textContent),
      ["Show Ruthlessness", "Show Improved Slice and Dice", "Show Lethality"],
    );
    shows[2].click();
    assert.equal(doc.activeElement, tile("assassination.lethality"));
  });

  it("over the cap: the error banner, the pill, and Level described by both", () => {
    const { $ } = page({
      config: { ...pageDefaultConfig(), talents: referenceBuild() },
    });
    const level = $("talents-level");
    assert.equal(level.getAttribute("min"), "10");
    assert.equal(level.getAttribute("max"), "60");
    level.value = "40";
    level.dispatch("change");
    assert.match(
      $("talents-message").textContent,
      /^51 points spent, but level 40 gives 31\. Remove 20 points/,
    );
    assert.match($("talents-points").getAttribute("class"), /is-over/);
    assert.match($("talents-points").textContent, /51 of 31 points spent/);
    assert.equal(
      level.getAttribute("aria-describedby"),
      "talents-level-help talents-over",
    );
    level.value = "abc";
    level.dispatch("keydown", { key: "Enter" });
    assert.equal(level.getAttribute("aria-invalid"), "true");
    assert.equal($("talents-level-error").hidden, false);
    assert.match(
      $("talents-level-error").textContent,
      /Enter a level from 10 to 60\./,
    );
  });

  it("Reset all offers Undo, which restores the build", () => {
    const { $, store } = page({
      config: { ...pageDefaultConfig(), talents: referenceBuild() },
    });
    $("talents-reset").click();
    assert.deepEqual(store.get().config.talents, {});
    const undo = $("talents-message").find(
      (node) => node.textContent === "Undo",
    );
    undo.click();
    assert.deepEqual(store.get().config.talents, referenceBuild());
    assert.equal(
      $("talents-live").textContent.startsWith("Talents restored"),
      true,
    );
  });

  it("the detail pane's steppers use aria-disabled and keep focus", () => {
    const { tile, $, doc } = page();
    tile("assassination.lethality").focus();
    const detail = $("talents-detail");
    assert.equal(
      detail.find((node) => node.tagName === "H3").textContent,
      "Lethality",
    );
    const add = detail.find((node) => node.getAttribute("data-step") === "add");
    assert.equal(add.getAttribute("aria-disabled"), "true");
    assert.equal(add.getAttribute("aria-label"), "Add a point to Lethality");
    tile("combat.improved-sinister-strike").focus();
    const plus = $("talents-detail").find(
      (node) => node.getAttribute("data-step") === "add",
    );
    plus.focus();
    plus.click();
    const again = $("talents-detail").find(
      (node) => node.getAttribute("data-step") === "add",
    );
    assert.equal(doc.activeElement, again, "focus follows the redrawn +");
  });

  it("a not-simulated talent gets the poison note, described by the steppers", () => {
    const { tile, $ } = page();
    tile("subtlety.camouflage").focus();
    const note = $("talents-detail").find(
      (node) => node.getAttribute("id") === "talents-detail-note",
    );
    assert.equal(note.getAttribute("class"), "poison-note");
    assert.match(note.textContent, /^ⓘ Not simulated yet: /);
    const add = $("talents-detail").find(
      (node) => node.getAttribute("data-step") === "add",
    );
    assert.equal(add.getAttribute("aria-describedby"), "talents-detail-note");
  });

  it("below NARROW_QUERY the trees are tabs, one shown at a time (§7)", () => {
    const { $, doc, setNarrow, store } = page({ narrow: true });
    assert.equal($("talents-tabs").hidden, false);
    const tabs = $("talents-tabs").children;
    assert.equal(tabs.length, 3);
    const sections = $("talents-trees").children;
    assert.deepEqual(
      sections.map((section) => section.hidden),
      [false, true, true],
    );
    assert.equal(sections[0].getAttribute("role"), "tabpanel");
    tabs[0].dispatch("keydown", { key: "ArrowLeft" });
    assert.equal(store.get().talents.view.tab, "subtlety");
    assert.equal(doc.activeElement, tabs[2]);
    assert.deepEqual(
      sections.map((section) => section.hidden),
      [true, true, false],
    );
    tabs[1].click();
    assert.equal(tabs[1].getAttribute("aria-selected"), "true");
    setNarrow(false);
    assert.equal($("talents-tabs").hidden, true);
    assert.deepEqual(
      sections.map((section) => section.hidden),
      [false, false, false],
    );
    assert.equal(sections[0].getAttribute("role"), null);
  });

  it("returns its unsubscribe", () => {
    const { unsubscribe, store, $ } = page();
    assert.equal(typeof unsubscribe, "function");
    unsubscribe();
    store.set({
      config: { ...store.get().config, talents: referenceBuild() },
    });
    assert.equal($("talents-summary").textContent, "No talents");
  });
});

describe("talent tree markup (#204)", () => {
  it("index.html has the summary row and the panel the view needs", async () => {
    const html = await readFile(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    for (const id of IDS) {
      assert.match(html, new RegExp(`id="${id}"`), id);
    }
    assert.doesNotMatch(html, /id="cfg-talents"/);
    assert.match(html, /aria-controls="talent-tree"/);
    assert.match(
      html,
      /id="talents-live"[^>]*role="status"|role="status"[^>]*id="talents-live"/,
    );
    assert.match(html, /href="talent-tree.css"/);
  });
});
