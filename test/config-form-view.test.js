import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  FORM_FIELDS,
  createConfigForm,
  pageDefaultConfig,
} from "../js/config-form.js";
import { listPresets } from "../js/rotation-presets.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import {
  createConfigFormView,
  fieldId,
  fixHeadingText,
  formatField,
  formatPercent,
  parseField,
  runGateText,
} from "../js/views/config-form.js";

// Issue #151 (U2), the stats form's view on a stand-in page: it shows chances
// as percentages and stores them 0 to 1, marks errors for assistive tech,
// lists what to fix, never submits, and offers Undo for a while after Reset.

function element(tag, id) {
  const attributes = new Map();
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(),
    id,
    value: "",
    textContent: "",
    hidden: false,
    open: true,
    children: [],
    classes: new Set(),
    focused: 0,
    get classList() {
      const classes = this.classes;
      return { toggle: (name, on) => classes[on ? "add" : "delete"](name) };
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    fire(type, event = {}) {
      return listeners.get(type)?.(event);
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    focus() {
      this.focused += 1;
    },
    click() {
      this.fire("click", { preventDefault() {} });
    },
  };
}

const SELECTS = new Set([
  "cfg-talents",
  "cfg-rotation",
  "cfg-weapons-mainHand-type",
  "cfg-weapons-offHand-type",
]);
const PERCENT = new Set([
  "cfg-character-critChance",
  "cfg-character-bonusHitChance",
]);

function page({ narrow = false } = {}) {
  const byId = new Map();
  const queried = new Set();
  const created = [];
  const timers = [];
  const doc = {
    querySelector(selector) {
      queried.add(selector);
      const label = selector.match(/^label\[for="(.+)"\]$/);
      if (label) {
        return { firstChild: { textContent: `Label of ${label[1]}\n` } };
      }
      const id = selector.slice(1);
      if (!byId.has(id)) {
        const made = element(SELECTS.has(id) ? "select" : "input", id);
        if (PERCENT.has(id)) made.setAttribute("data-percent", "");
        made.setAttribute("data-field", id);
        byId.set(id, made);
      }
      return byId.get(id);
    },
    createElement(tag) {
      const made = element(tag);
      created.push(made);
      return made;
    },
    defaultView: {
      matchMedia: (query) => ({
        matches: narrow && query === "(max-width: 520px)",
      }),
      setTimeout(run, wait) {
        timers.push({ run, wait });
        return timers.length;
      },
      clearTimeout() {},
      Blob: class {
        constructor(parts) {
          this.text = parts.join("");
        }
      },
      URL: {
        createObjectURL: (blob) => `blob:${blob.text.length}`,
        revokeObjectURL() {},
      },
    },
  };
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const actions = createConfigForm(store);
  createConfigFormView(doc, store, actions);
  const $ = (id) => doc.querySelector(`#${id}`);
  const commit = (path, text) => {
    $(fieldId(path)).value = text;
    $(fieldId(path)).fire("change");
  };
  return { doc, store, actions, $, commit, queried, created, timers };
}

describe("percent at the edge", () => {
  it("shows 0.2245 as 22.45 and 0.07 as 7, and reads them back", () => {
    assert.equal(formatPercent(0.2245), "22.45");
    assert.equal(formatPercent(0.07), "7");
    assert.equal(parseField("22.45", true), 0.2245);
    assert.equal(parseField("7", true), 0.07);
    assert.ok(Number.isNaN(parseField("  ", false)));
    assert.ok(Number.isNaN(parseField("abc", true)));
    assert.equal(formatField(Number.NaN, false), "");
    assert.equal(formatField("dagger", false), "dagger");
  });

  it("the page shows the defaults' chances as percentages and stores 0 to 1", () => {
    const { $, commit, store } = page();
    const config = normalizeConfig(pageDefaultConfig());
    assert.equal(
      $("cfg-character-critChance").value,
      formatPercent(config.character.critChance),
    );
    assert.equal(
      $("cfg-character-attackPower").value,
      String(config.character.attackPower),
    );
    commit("character.critChance", "22.45");
    assert.equal(store.get().config.character.critChance, 0.2245);
    commit("character.bonusHitChance", "7");
    assert.equal(store.get().config.character.bonusHitChance, 0.07);
  });
});

describe("errors", () => {
  it("mark the field, describe it by its help and error, and show the message", () => {
    const { $, commit } = page();
    const type = $("cfg-weapons-mainHand-type");
    type.setAttribute("data-help", "cfg-weapons-mainHand-type-help");
    commit("weapons.mainHand.type", "bow");
    assert.equal(type.getAttribute("aria-invalid"), "true");
    assert.equal(
      type.getAttribute("aria-describedby"),
      "cfg-weapons-mainHand-type-help cfg-weapons-mainHand-type-error",
    );
    const error = $("cfg-weapons-mainHand-type-error");
    assert.equal(error.hidden, false);
    assert.equal(error.children[0].getAttribute("aria-hidden"), "true");
    assert.equal(error.children[1], "Choose a weapon type.");
    commit("weapons.mainHand.type", "sword");
    assert.equal(type.getAttribute("aria-invalid"), null);
    assert.equal(
      type.getAttribute("aria-describedby"),
      "cfg-weapons-mainHand-type-help",
    );
    assert.equal(error.hidden, true);
  });

  it("min > max: both invalid, the message on Max only", () => {
    const { $, commit } = page();
    commit("weapons.mainHand.max", "10");
    assert.equal(
      $("cfg-weapons-mainHand-min").getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      $("cfg-weapons-mainHand-max").getAttribute("aria-invalid"),
      "true",
    );
    assert.equal($("cfg-weapons-mainHand-min-error").hidden, true);
    assert.match(
      $("cfg-weapons-mainHand-max-error").children[1],
      /^Max damage must be at least/,
    );
  });

  it("the footer lists each field to fix, links focus it, and says Run is off", () => {
    const { $, commit } = page();
    assert.equal($("cfg-status-ok").hidden, false);
    assert.equal($("cfg-run-gate").textContent, "");
    commit("character.attackPower", "");
    commit("weapons.offHand.max", "1");
    assert.equal($("cfg-status-ok").hidden, true);
    assert.equal($("cfg-fix").hidden, false);
    assert.equal($("cfg-fix-heading").textContent, fixHeadingText(2));
    assert.equal($("cfg-run-gate").textContent, runGateText(2));
    assert.equal(runGateText(1), "1 field needs fixing. Run is disabled.");
    const links = $("cfg-fix-list").children.map((item) => item.children[0]);
    assert.deepEqual(
      links.map((link) => link.textContent),
      [
        "Label of cfg-character-attackPower",
        "Off hand, Label of cfg-weapons-offHand-max",
      ],
    );
    links[1].click();
    assert.equal($("cfg-weapons-offHand-max").focused, 1);
    commit("character.attackPower", "700");
    commit("weapons.offHand.max", "170");
    assert.equal($("cfg-fix").hidden, true);
    assert.equal($("cfg-run-gate").textContent, "");
  });

  it("the fix list keeps its links while the same fields stay wrong", () => {
    const { $, commit } = page();
    commit("character.attackPower", "-1");
    const before = $("cfg-fix-list").children;
    commit("character.attackPower", "-2");
    assert.equal($("cfg-fix-list").children, before);
  });

  it("typing clears an error once the value is fine, and never adds one", () => {
    const { $, store } = page();
    const ap = $("cfg-character-attackPower");
    ap.value = "x";
    ap.fire("input");
    assert.equal(ap.getAttribute("aria-invalid"), null);
    ap.fire("change");
    assert.equal(ap.getAttribute("aria-invalid"), "true");
    ap.value = "800";
    ap.fire("input");
    assert.equal(ap.getAttribute("aria-invalid"), null);
    assert.notEqual(
      store.get().config.character.attackPower,
      800,
      "input writes no config",
    );
  });
});

describe("the form never runs anything", () => {
  it("submit and Enter are prevented; Enter commits the field", () => {
    const { $, store } = page();
    let prevented = 0;
    const event = (extra) => ({
      preventDefault: () => (prevented += 1),
      ...extra,
    });
    $("config-form").fire("submit", event());
    assert.equal(prevented, 1);
    const ap = $("cfg-character-attackPower");
    ap.setAttribute("data-field", "character.attackPower");
    ap.value = "950";
    $("config-form").fire("keydown", event({ key: "Enter", target: ap }));
    assert.equal(prevented, 2);
    assert.equal(store.get().config.character.attackPower, 950);
    $("config-form").fire("keydown", event({ key: "a", target: ap }));
    assert.equal(prevented, 2);
  });

  it("owns only the cfg- elements and the form", () => {
    const { queried } = page();
    for (const selector of queried) {
      assert.match(
        selector,
        /^#config-form$|^#cfg-|^label\[for="cfg-/,
        selector,
      );
    }
  });
});

describe("rotation and talents", () => {
  it("fills the selects, and a choice reaches config.rotation and the summary", () => {
    const { $, store } = page();
    const rotation = $("cfg-rotation");
    assert.deepEqual(
      rotation.children.map((option) => option.value),
      ["default", ...listPresets().map(({ id }) => id)],
    );
    rotation.value = listPresets()[0].id;
    rotation.fire("change");
    assert.equal(store.get().config.rotation.name, listPresets()[0].name);
    assert.equal($("cfg-summary-name").textContent, listPresets()[0].name);
    assert.equal(
      $("cfg-summary-rules").children.length,
      store.get().config.rotation.rules.length,
    );
    const talents = $("cfg-talents");
    talents.value = "reference";
    talents.fire("change");
    assert.ok(Object.keys(store.get().config.talents).length > 0);
  });

  it("export downloads the rotation file", () => {
    const { $, created, actions } = page();
    $("cfg-export").click();
    const link = created.find((made) => made.tagName === "A" && made.download);
    assert.equal(link.download, actions.exportRotation().fileName);
    assert.equal(link.href, `blob:${actions.exportRotation().text.length}`);
  });

  it("a pasted import shows its status, and the details when it fails", () => {
    const { $, actions } = page();
    $("cfg-import-text").value = "{";
    $("cfg-import-paste").click();
    assert.equal(
      $("cfg-import-status").textContent,
      "This file isn't a valid rotation.",
    );
    assert.ok($("cfg-import-status").classes.has("is-error"));
    assert.equal($("cfg-import-detail").hidden, false);
    assert.equal(
      $("cfg-import-text").value,
      "{",
      "a failed paste keeps the text",
    );
    $("cfg-import-text").value = actions.exportRotation().text;
    $("cfg-import-paste").click();
    assert.equal($("cfg-import-detail").hidden, true);
    assert.equal($("cfg-import-text").value, "");
    assert.ok(!$("cfg-import-status").classes.has("is-error"));
  });

  it("closes the summary on a narrow screen", () => {
    assert.equal(page({ narrow: true }).$("cfg-summary").open, false);
    assert.equal(page().$("cfg-summary").open, true);
  });
});

describe("Reset and Undo", () => {
  it("Reset shows 'Defaults restored' with Undo for the ui constant's time", () => {
    const { $, commit, timers, store } = page();
    commit("character.attackPower", "1234");
    $("cfg-reset").click();
    assert.equal(
      $("cfg-character-attackPower").value,
      String(normalizeConfig(pageDefaultConfig()).character.attackPower),
    );
    assert.equal($("cfg-toast-text").textContent, "Defaults restored");
    assert.equal($("cfg-undo").hidden, false);
    assert.ok($("cfg-toast").classes.has("is-shown"));
    assert.equal(timers.at(-1).wait, k("ui.undoToastSeconds") * 1000);
    $("cfg-undo").click();
    assert.equal($("cfg-character-attackPower").value, "1234");
    assert.equal(store.get().config.character.attackPower, 1234);
    assert.equal($("cfg-toast-text").textContent, "");
    assert.equal($("cfg-undo").hidden, true);
  });

  it("the toast goes when its time is up", () => {
    const { $, timers } = page();
    $("cfg-reset").click();
    timers.at(-1).run();
    assert.equal($("cfg-toast-text").textContent, "");
    assert.equal($("cfg-undo").hidden, true);
  });
});

describe("index.html's form", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const form = html.match(/<form\s+id="config-form"[\s\S]*?<\/form>/)[0];

  it("is not validated by the browser and has no fight controls", () => {
    assert.match(form, /^<form\s[^>]*\bnovalidate\b/);
    assert.doesNotMatch(form, /type="submit"|\b(Run|Pause|Stop)\b<\/button>/);
    assert.doesNotMatch(form, /duration|fight length/i);
  });

  it("has a labelled control and an error line for every field", () => {
    for (const { path } of FORM_FIELDS) {
      const id = fieldId(path);
      assert.match(form, new RegExp(`id="${id}"`), path);
      assert.match(
        form,
        new RegExp(`data-field="${path.replaceAll(".", "\\.")}"`),
        path,
      );
      assert.match(form, new RegExp(`<label[^>]*for="${id}"`), path);
      assert.match(form, new RegExp(`id="${id}-error"`), path);
    }
  });

  it("marks the chances as percentages and only them", () => {
    const percent = [...form.matchAll(/<input\s[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => /\bdata-percent\b/.test(tag))
      .map((tag) => tag.match(/\bid="([^"]+)"/)[1]);
    assert.deepEqual(percent.sort(), [
      "cfg-character-bonusHitChance",
      "cfg-character-critChance",
    ]);
  });
});
