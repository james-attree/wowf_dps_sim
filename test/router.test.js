// The page's router (#239, Phase 4.5 UX1): its routes, the areas the page
// goes to on its own, and, in a small fake page, deep links, Back and
// Forward, focus, the nav's aria-current and the badges.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStore } from "../js/store.js";
import {
  APP_TITLE,
  followArea,
  formatRoute,
  isRouteHash,
  mountRouter,
  parseRoute,
  titleFor,
} from "../js/views/router.js";
import {
  PAGE_SECTIONS,
  REVEAL_EVENT,
  areaIds,
  createSections,
} from "../js/views/sections.js";

describe("routes", () => {
  it("parse an area, and the default for anything else", () => {
    const top = (area) => ({ area, sub: null, param: null });
    assert.deepEqual(parseRoute("#rotation"), top("rotation"));
    assert.deepEqual(parseRoute("results"), top("results"));
    assert.deepEqual(parseRoute(""), top("character"));
    assert.deepEqual(parseRoute(undefined), top("character"));
    assert.deepEqual(parseRoute("#nowhere"), top("character"));
    // An area's name in any case (Fran's QA of #251): #Fight is #fight.
    assert.deepEqual(parseRoute("#Fight"), top("fight"));
    assert.deepEqual(parseRoute("#RESULTS"), top("results"));
    // No sub-screens yet (UX5, UX6): a sub is dropped.
    assert.deepEqual(parseRoute("#character/stats"), top("character"));
  });

  it("parse a sub and its param when the area has it", () => {
    const subs = { rotation: ["rule"] };
    assert.deepEqual(parseRoute("#rotation/rule/2", subs), {
      area: "rotation",
      sub: "rule",
      param: "2",
    });
    assert.deepEqual(parseRoute("#rotation/rule", subs), {
      area: "rotation",
      sub: "rule",
      param: null,
    });
    assert.deepEqual(parseRoute("#rotation/other", subs), {
      area: "rotation",
      sub: null,
      param: null,
    });
  });

  it("format back to the hash they came from", () => {
    assert.equal(formatRoute({ area: "fight" }), "#fight");
    assert.equal(
      formatRoute({ area: "rotation", sub: "rule", param: "a b" }),
      "#rotation/rule/a%20b",
    );
    for (const area of areaIds()) {
      assert.equal(formatRoute(parseRoute(`#${area}`)), `#${area}`);
    }
  });

  it("tell an area's hash from a link to an element", () => {
    assert.equal(isRouteHash("#results"), true);
    assert.equal(isRouteHash(""), true);
    assert.equal(isRouteHash("#Rotation"), true);
    assert.equal(isRouteHash("#run-errors-link"), false);
  });

  it("title the page with the area", () => {
    assert.equal(titleFor({ area: "rotation" }), `Rotation · ${APP_TITLE}`);
  });
});

const idle = (mode = "live") => ({ run: { mode, state: "idle" } });
const running = (mode = "live") => ({ run: { mode, state: "running" } });
const builder = (open) => ({ rotationBuilder: { view: { open } } });

describe("followArea", () => {
  it("shows the live fight or the batch when Run starts", () => {
    assert.equal(followArea(idle(), running(), "character"), "fight");
    assert.equal(followArea(idle(), running(), "fight"), null);
    const batch = {
      run: { mode: "batch", state: "idle" },
      batch: { status: "running" },
    };
    assert.equal(followArea(idle("batch"), batch, "rotation"), "results");
    assert.equal(followArea(idle("batch"), batch, "results"), null);
  });

  it("leaves a resumed fight where it is", () => {
    const paused = { run: { mode: "live", state: "paused" } };
    assert.equal(followArea(paused, running(), "character"), null);
  });

  it("follows the rotation builder opening and closing", () => {
    assert.equal(
      followArea(builder(false), builder(true), "fight"),
      "rotation",
    );
    assert.equal(followArea(builder(false), builder(true), "rotation"), null);
    assert.equal(
      followArea(builder(true), builder(false), "rotation"),
      "character",
    );
    assert.equal(followArea(builder(true), builder(false), "fight"), null);
  });

  it("moves nowhere for any other change", () => {
    assert.equal(followArea(idle(), idle(), "results"), null);
    assert.equal(followArea(running(), running(), "character"), null);
  });
});

// A small fake page: elements with attributes, `hidden`, focus and closest(),
// a window with a hash, a history and listeners.
class FakeElement {
  constructor(doc, tag, attrs = {}, children = []) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.hidden = false;
    this.parent = null;
    this.children = [];
    this.isConnected = true;
    this.className = "";
    this.textContent = "";
    for (const child of children) {
      this.append(child);
    }
  }
  append(child) {
    child.parent = this;
    this.children.push(child);
  }
  replaceChildren(...nodes) {
    this.children = nodes.filter((node) => node instanceof FakeElement);
    this.textContent = nodes
      .map((node) => (typeof node === "string" ? node : node.textContent))
      .join("");
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  get id() {
    return this.attrs.id ?? "";
  }
  get ownerDocument() {
    return this.doc;
  }
  matches(selector) {
    if (selector === "[hidden]") {
      return this.hidden;
    }
    const attr = /^\[([a-z-]+)\]$/.exec(selector);
    if (attr) {
      return this.getAttribute(attr[1]) !== null;
    }
    return this.tagName === selector.toUpperCase();
  }
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (node.matches?.(selector)) {
        return node;
      }
    }
    return null;
  }
  *walk() {
    for (const child of this.children) {
      yield child;
      yield* child.walk();
    }
  }
  querySelectorAll(selector) {
    return [...this.walk()].filter((node) => node.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus() {
    this.doc.activeElement = this;
  }
  dispatchEvent(event) {
    event.target = this;
    this.doc.fire(event.type, event);
  }
}

function fakePage(hash = "") {
  const listeners = new Map();
  const on = (type, fn) =>
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const off = (type, fn) =>
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  const entries = [{ state: null, hash }];
  let at = 0;
  const win = {
    location: {
      get hash() {
        return entries[at].hash;
      },
    },
    history: {
      get state() {
        return entries[at].state;
      },
      pushState(state, _title, url) {
        entries.splice(at + 1);
        entries.push({ state, hash: url });
        at += 1;
      },
      replaceState(state, _title, url) {
        entries[at] = { state, hash: url ?? entries[at].hash };
      },
    },
    scrolls: 0,
    scrollTo() {
      this.scrolls += 1;
    },
    addEventListener: on,
    removeEventListener: off,
    CustomEvent: class {
      constructor(type, init) {
        Object.assign(this, { type, ...init });
      }
    },
  };
  const doc = {
    defaultView: win,
    title: "",
    activeElement: null,
    addEventListener: on,
    removeEventListener: off,
    fire: (type, event) =>
      (listeners.get(type) ?? []).forEach((fn) => fn(event)),
    createElement: (tag) => new FakeElement(doc, tag),
  };
  const el = (tag, attrs, children) =>
    new FakeElement(doc, tag, attrs, children);
  const fix = el("input", { id: "cfg-ap" });
  // A control outside every area, as Run is in the Run bar.
  const runButton = el("button", { id: "run-button" });
  const shells = areaIds().map((area) =>
    el("section", { "data-area": area }, [
      el("h1", { id: `area-${area}-title` }),
      ...(area === "character" ? [fix] : []),
    ]),
  );
  const links = areaIds().map((area) =>
    el("a", { "data-nav-area": area, href: `#${area}` }, [
      el("span", { "data-badge": "" }),
    ]),
  );
  // The badges start hidden, as index.html has them.
  for (const link of links) {
    link.querySelector("[data-badge]").hidden = true;
  }
  const root = el("body", {}, [el("nav", {}, links), runButton, ...shells]);
  doc.body = root;
  doc.querySelectorAll = (selector) => root.querySelectorAll(selector);
  doc.getElementById = (id) =>
    [...root.walk()].find((node) => node.id === id) ?? null;
  doc.activeElement = root;
  // The browser's part of a hash change: a new entry, then hashchange.
  const visit = (next) => {
    entries.splice(at + 1);
    entries.push({ state: null, hash: next });
    at += 1;
    doc.fire("hashchange", {});
  };
  const travel = (step) => {
    at += step;
    doc.fire("hashchange", {});
  };
  return {
    doc,
    win,
    shells,
    links,
    fix,
    runButton,
    visit,
    travel,
    entries: () => entries,
  };
}

const registryFor = () => {
  const registry = createSections();
  const rendered = [];
  for (const section of PAGE_SECTIONS) {
    registry.registerSection({
      ...section,
      render: (shell) => {
        rendered.push([section.id, shell.getAttribute("data-area")]);
        return () => {};
      },
    });
  }
  return { registry, rendered };
};

const baseState = () => ({
  run: { mode: "live", state: "idle", errors: {} },
  form: { errors: {} },
  talents: {},
  rotationBuilder: { view: { open: false } },
});

function mount(hash) {
  const page = fakePage(hash);
  const store = createStore(baseState());
  const { registry, rendered } = registryFor();
  const toggles = [];
  const router = mountRouter(page.doc, store, registry, {
    panels: {
      rotation: {
        isOpen: (state) => state.rotationBuilder.view.open,
        toggle: () => {
          toggles.push(true);
          const open = !store.get().rotationBuilder.view.open;
          store.set({ rotationBuilder: { view: { open } } });
        },
      },
    },
  });
  router.start();
  return { ...page, store, router, rendered, toggles };
}

const shown = (shells) =>
  shells
    .filter((shell) => !shell.hidden)
    .map((s) => s.getAttribute("data-area"));
const current = (links) =>
  links
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("data-nav-area"));

describe("mountRouter", () => {
  it("opens at a deep link with only its area shown", () => {
    const page = mount("#results");
    assert.deepEqual(shown(page.shells), ["results"]);
    assert.deepEqual(current(page.links), ["results"]);
    assert.equal(page.doc.title, `Results · ${APP_TITLE}`);
    assert.deepEqual(page.store.get().route, {
      area: "results",
      sub: null,
      param: null,
    });
    // A deep link does not move the focus.
    assert.equal(page.doc.activeElement, page.doc.body);
    assert.deepEqual(
      page.rendered.map(([, area]) => area),
      ["character", "character", "rotation", "fight", "results"],
    );
  });

  it("opens at Character for no hash or an unknown one, canonically", () => {
    for (const hash of ["", "#nowhere"]) {
      const page = mount(hash);
      assert.deepEqual(shown(page.shells), ["character"]);
      assert.equal(page.win.location.hash, "#character");
    }
  });

  it("focuses the h1 going forward and restores the focus on Back", () => {
    const page = mount("#character");
    page.fix.focus();
    page.visit("#fight");
    assert.deepEqual(shown(page.shells), ["fight"]);
    assert.deepEqual(current(page.links), ["fight"]);
    const fightHeading = page.shells[2].querySelector("h1");
    assert.equal(page.doc.activeElement, fightHeading);
    page.travel(-1);
    assert.deepEqual(shown(page.shells), ["character"]);
    assert.equal(page.doc.activeElement, page.fix);
    page.travel(1);
    assert.deepEqual(shown(page.shells), ["fight"]);
    assert.equal(page.doc.activeElement, fightHeading);
    assert.ok(page.win.scrolls > 0);
  });

  it("falls back to the h1 on Back when the old focus is gone", () => {
    const page = mount("#character");
    page.fix.focus();
    page.visit("#results");
    page.fix.isConnected = false;
    page.travel(-1);
    assert.equal(page.doc.activeElement, page.shells[0].querySelector("h1"));
  });

  it("opens the rotation builder in Rotation and closes it on leaving", () => {
    const page = mount("#character");
    page.visit("#rotation");
    assert.equal(page.store.get().rotationBuilder.view.open, true);
    page.visit("#fight");
    assert.equal(page.store.get().rotationBuilder.view.open, false);
    assert.equal(page.toggles.length, 2);
  });

  it("goes to Rotation when the builder opens, and back when it closes", () => {
    const page = mount("#character");
    page.store.set({ rotationBuilder: { view: { open: true } } });
    assert.deepEqual(shown(page.shells), ["rotation"]);
    assert.equal(page.win.location.hash, "#rotation");
    page.store.set({ rotationBuilder: { view: { open: false } } });
    assert.deepEqual(shown(page.shells), ["character"]);
  });

  it("shows the fight when a live Run starts, the focus left alone", () => {
    const page = mount("#character");
    page.runButton.focus();
    page.store.set({ run: { mode: "live", state: "running", errors: {} } });
    assert.deepEqual(shown(page.shells), ["fight"]);
    assert.equal(page.doc.activeElement, page.runButton);
  });

  it("focuses the new h1 when the focus was in the area it leaves", () => {
    // Fran's QA of #251, B1: "Edit rotation…" (in Character) opens the
    // builder, the page goes to Rotation, and the focus must not be left
    // on a hidden control.
    const page = mount("#character");
    page.fix.focus();
    page.store.set({ rotationBuilder: { view: { open: true } } });
    assert.deepEqual(shown(page.shells), ["rotation"]);
    assert.equal(page.doc.activeElement, page.shells[1].querySelector("h1"));
    assert.equal(page.doc.activeElement.id, "area-rotation-title");
  });

  it("goes to an area named in any case, canonically", () => {
    const page = mount("#Results");
    assert.deepEqual(shown(page.shells), ["results"]);
    assert.equal(page.win.location.hash, "#results");
    page.visit("#Fight");
    assert.deepEqual(shown(page.shells), ["fight"]);
    assert.equal(page.win.location.hash, "#fight");
  });

  it("shows a control's area when a view reveals it", () => {
    const page = mount("#results");
    page.fix.dispatchEvent(new page.win.CustomEvent(REVEAL_EVENT, {}));
    assert.deepEqual(shown(page.shells), ["character"]);
    assert.equal(page.win.location.hash, "#character");
  });

  it("shows the area of an element a hash links to", () => {
    const page = mount("#results");
    page.visit("#cfg-ap");
    assert.deepEqual(shown(page.shells), ["character"]);
    assert.equal(page.win.location.hash, "#cfg-ap");
  });

  it("badges an area's errors with hidden words", () => {
    const page = mount("#character");
    const badge = (area) =>
      page.links[areaIds().indexOf(area)].querySelector("[data-badge]");
    assert.equal(badge("character").hidden, true);
    page.store.set({
      talents: { error: "Over the level cap" },
      form: { errors: { attackPower: "Too high" }, rotationErrors: ["x"] },
    });
    assert.equal(badge("character").hidden, false);
    assert.equal(badge("character").textContent, "2 errors");
    assert.equal(badge("rotation").textContent, "1 error");
    assert.equal(badge("fight").hidden, true);
  });

  it("stops listening when destroyed", () => {
    const page = mount("#character");
    page.router.destroy();
    page.visit("#fight");
    assert.deepEqual(shown(page.shells), ["character"]);
  });
});
