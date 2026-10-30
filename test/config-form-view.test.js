import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  FORM_ERROR,
  FORM_FIELDS,
  createConfigForm,
  pageDefaultConfig,
} from "../js/config-form.js";
import { poisonInfo } from "../js/config-form.js";
import { listPresets } from "../js/rotation-presets.js";
import { defaultRotation } from "../js/rotation-default.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { NARROW_QUERY } from "../js/views/breakpoints.js";
import {
  createConfigFormView,
  fieldId,
  fixHeadingText,
  formatField,
  formatPercent,
  parseField,
  poisonEffectText,
  poisonNoteText,
  poisonRankText,
  runGateText,
} from "../js/views/config-form.js";
import { blockedCount } from "../js/views/run-model.js";

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
  "cfg-rotation",
  "cfg-weapons-mainHand-type",
  "cfg-weapons-offHand-type",
  "cfg-poisons-mainHand",
  "cfg-poisons-offHand",
]);
const PERCENT = new Set([
  "cfg-character-critChance",
  "cfg-character-bonusHitChance",
]);

function page({ narrow = false, run } = {}) {
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
        matches: narrow && query === NARROW_QUERY,
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
  const store = createStore({
    config: normalizeConfig(pageDefaultConfig()),
    ...(run === undefined ? {} : { run }),
  });
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

  it("counts the run bar's errors too, so it never says Run is on while it is off (#155)", () => {
    // Fran's Phase 3 QA 1: a bad Fight length left the footer saying
    // "Changes apply to the next run", even after Reset to defaults.
    const run = {
      mode: "live",
      errors: { duration: "Bad.", iterations: "Batch only." },
    };
    const { $, commit, store } = page({ run });
    assert.equal($("cfg-status-ok").hidden, true);
    assert.equal($("cfg-fix").hidden, false);
    assert.equal($("cfg-fix-heading").textContent, fixHeadingText(1));
    assert.equal($("cfg-run-gate").textContent, runGateText(1));
    let links = $("cfg-fix-list").children.map((item) => item.children[0]);
    assert.deepEqual(
      links.map((link) => [link.textContent, link.href]),
      [["Run bar, Fight length", "#run-errors-link"]],
      "Fights is batch only, so not counted in live mode",
    );

    commit("character.attackPower", "");
    assert.equal($("cfg-run-gate").textContent, runGateText(2));
    links = $("cfg-fix-list").children.map((item) => item.children[0]);
    assert.deepEqual(
      links.map((link) => link.textContent),
      ["Label of cfg-character-attackPower", "Run bar, Fight length"],
    );

    $("cfg-reset").click();
    assert.equal($("cfg-status-ok").hidden, true, "Reset leaves the bar's");
    assert.equal($("cfg-run-gate").textContent, runGateText(1));

    store.set({ run: { ...run, mode: "batch" } });
    assert.equal($("cfg-run-gate").textContent, runGateText(2), "Fights now");
    store.set({ run: { ...run, errors: {} } });
    assert.equal($("cfg-status-ok").hidden, false);
    assert.equal($("cfg-fix").hidden, true);
    assert.equal($("cfg-run-gate").textContent, "");
    assert.deepEqual($("cfg-fix-list").children, []);
  });

  it("the footer's count is Run's, for a null Min, the backstop and the bar (#237)", () => {
    const run = { mode: "live", errors: { duration: "Bad." } };
    const { $, commit, store, actions } = page({ run });
    const gate = () => $("cfg-run-gate").textContent;
    const runCount = () => blockedCount(store.get());
    const same = (count, step) => {
      assert.equal(runCount(), count, step);
      assert.equal(gate(), count === 0 ? "" : runGateText(count), step);
      assert.equal($("cfg-status-ok").hidden, count > 0, step);
    };
    same(1, "the bar's");
    commit("weapons.mainHand.min", "50");
    commit("weapons.mainHand.max", "40");
    same(2, "the pair counts once");
    const min = $("cfg-weapons-mainHand-min");
    min.value = "1.5";
    min.fire("input");
    same(1, "typing drops the Min's mark with the Max's error");
    min.fire("change");
    same(2, "the Min's own error");
    commit("weapons.mainHand.min", "30");
    same(1, "fixed");
    // The normalizeConfig backstop: one setting, with no field to link.
    store.set({ config: { ...store.get().config, target: { level: "high" } } });
    actions.change("character.attackPower", 900);
    assert.equal(typeof store.get().form.errors[FORM_ERROR], "string");
    same(2, "the backstop");
    assert.equal($("cfg-fix-heading").textContent, fixHeadingText(2));
    store.set({ run: { ...run, errors: {} } });
    same(1, "the backstop alone");
    assert.equal($("cfg-fix").hidden, true, "no field to list");
    assert.equal($("cfg-form-error").hidden, false);
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

describe("rotation", () => {
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
    assert.equal($("cfg-import-warnings").hidden, true);
    $("cfg-import-text").value = actions.exportRotation().text;
    $("cfg-import-paste").click();
    assert.equal($("cfg-import-detail").hidden, true);
    assert.equal($("cfg-import-warnings").hidden, true);
    assert.equal($("cfg-import-text").value, "");
    assert.ok(!$("cfg-import-status").classes.has("is-error"));
    assert.ok(!$("cfg-import-status").classes.has("is-warning"));
  });

  it("an import with warnings is accepted and shows them, not as errors (#189)", () => {
    const { $, store } = page();
    $("cfg-import-text").value = JSON.stringify({
      schemaVersion: 1,
      name: "Trap",
      // Two warnings since #207: the finisher one for rules[0] (alone), and
      // rules[1] starving Backstab.
      rules: [
        { action: "eviscerate", conditions: [] },
        { action: "sinister-strike", conditions: [] },
        { action: "backstab", conditions: [] },
      ],
    });
    $("cfg-import-paste").click();
    assert.equal(store.get().config.rotation.name, "Trap");
    assert.equal(
      $("cfg-import-status").textContent,
      'Imported "Trap" with 2 warnings. It still runs; see the warnings below.',
    );
    assert.ok($("cfg-import-status").classes.has("is-warning"));
    assert.ok(!$("cfg-import-status").classes.has("is-error"));
    assert.equal($("cfg-import-detail").hidden, true);
    assert.equal($("cfg-import-warnings").hidden, false);
    assert.equal(
      $("cfg-import-warnings-text").textContent,
      store.get().form.importStatus.warnings,
    );
    assert.match(
      $("cfg-import-warnings-text").textContent,
      /^Rule 1: Eviscerate \(eviscerate\) is a finisher/,
    );
    assert.equal($("cfg-import-text").value, "", "an accepted paste clears");
    $("cfg-import-text").value = "{";
    $("cfg-import-paste").click();
    assert.equal($("cfg-import-warnings").hidden, true);
    assert.equal($("cfg-import-warnings-text").textContent, "");
    assert.ok(!$("cfg-import-status").classes.has("is-warning"));
  });

  it("the What to check box is a labelled region only while it overflows (#200)", () => {
    const { $ } = page();
    const box = $("cfg-import-warnings-text");
    const region = () => [
      box.getAttribute("tabindex"),
      box.getAttribute("role"),
      box.getAttribute("aria-label"),
    ];
    const paste = (rules) => {
      $("cfg-import-text").value = JSON.stringify({
        schemaVersion: 1,
        name: "Trap",
        rules,
      });
      $("cfg-import-paste").click();
    };
    const two = [
      { action: "eviscerate", conditions: [] },
      { action: "sinister-strike", conditions: [] },
    ];
    // It fits: no Tab stop, no region.
    box.scrollHeight = 100;
    box.clientHeight = 100;
    paste(two);
    assert.equal($("cfg-import-warnings").hidden, false);
    assert.deepEqual(region(), [null, null, null]);
    // New content that overflows, drawn: a region named in Fran's words.
    box.scrollHeight = 300;
    box.clientHeight = 160;
    paste([...two, { action: "eviscerate", conditions: [] }]);
    assert.deepEqual(region(), ["0", "region", "What to check"]);
    // The box opened, or resized, to fit: no longer a region.
    box.scrollHeight = 300;
    box.clientHeight = 300;
    $("cfg-import-warnings").fire("toggle");
    assert.deepEqual(region(), [null, null, null]);
    // Overflowing again, read on the toggle too.
    box.clientHeight = 160;
    $("cfg-import-warnings").fire("toggle");
    assert.deepEqual(region(), ["0", "region", "What to check"]);
    // Closed, it shows nothing to scroll, whatever sizes it last had.
    $("cfg-import-warnings").open = false;
    $("cfg-import-warnings").fire("toggle");
    assert.deepEqual(region(), [null, null, null]);
    $("cfg-import-warnings").open = true;
    $("cfg-import-warnings").fire("toggle");
    assert.deepEqual(region(), ["0", "region", "What to check"]);
    // No warnings: empty and not a region.
    box.scrollHeight = 0;
    box.clientHeight = 0;
    $("cfg-import-text").value = "{";
    $("cfg-import-paste").click();
    assert.equal($("cfg-import-warnings-text").textContent, "");
    assert.deepEqual(region(), [null, null, null]);
  });

  it("switching to another rotation clears the import status and warnings (Kira's #206 review)", () => {
    const { $, store } = page();
    $("cfg-import-text").value = JSON.stringify({
      schemaVersion: 1,
      name: "Trap",
      rules: [
        { action: "eviscerate", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    });
    $("cfg-import-paste").click();
    assert.equal($("cfg-import-warnings").hidden, false);
    const rotation = $("cfg-rotation");
    rotation.value = "default";
    rotation.fire("change");
    assert.equal(store.get().config.rotation.name, defaultRotation().name);
    assert.equal(store.get().form.importStatus, null);
    assert.equal($("cfg-import-status").textContent, "");
    assert.ok(!$("cfg-import-status").classes.has("is-warning"));
    assert.equal($("cfg-import-warnings").hidden, true);
    assert.equal($("cfg-import-warnings-text").textContent, "");
    // A refused file's status and details go too.
    $("cfg-import-text").value = "{";
    $("cfg-import-paste").click();
    assert.equal($("cfg-import-detail").hidden, false);
    rotation.value = listPresets()[0].id;
    rotation.fire("change");
    assert.equal($("cfg-import-status").textContent, "");
    assert.ok(!$("cfg-import-status").classes.has("is-error"));
    assert.equal($("cfg-import-detail").hidden, true);
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

describe("poison selects (#152)", () => {
  const pick = ($, hand, value) => {
    $(`cfg-poisons-${hand}`).value = value;
    $(`cfg-poisons-${hand}`).fire("change");
  };

  it("offer None, then Simulated and Not simulated yet, by config id", () => {
    const { $ } = page();
    for (const hand of ["mainHand", "offHand"]) {
      const [none, simulated, other] = $(`cfg-poisons-${hand}`).children;
      assert.equal(none.tagName, "OPTION");
      assert.equal(none.value, "");
      assert.equal(none.textContent, "None");
      assert.equal(simulated.tagName, "OPTGROUP");
      assert.equal(simulated.getAttribute("label"), "Simulated");
      assert.deepEqual(
        simulated.children.map(({ value, textContent }) => [
          value,
          textContent,
        ]),
        [
          ["instant", "Instant Poison"],
          ["deadly", "Deadly Poison"],
        ],
      );
      assert.equal(other.getAttribute("label"), "Not simulated yet");
      assert.deepEqual(
        other.children.map(({ value }) => value),
        ["crippling", "mind-numbing", "wound"],
      );
    }
  });

  it("show the page defaults with rank, effect and the charges tag", () => {
    const { $ } = page();
    assert.equal($("cfg-poisons-mainHand").value, "instant");
    assert.equal($("cfg-poisons-offHand").value, "deadly");
    assert.equal(
      $("cfg-poisons-mainHand-rank").textContent,
      "Rank 6 (highest)",
    );
    assert.equal(
      $("cfg-poisons-mainHand-effect").textContent,
      "20% on hit · 76–100 Nature",
    );
    assert.equal(
      $("cfg-poisons-offHand-effect").textContent,
      "30% on hit · 92 Nature over 12 s, stacks ×5",
    );
    assert.equal($("cfg-poisons-mainHand-charges").hidden, false);
    assert.equal($("cfg-poisons-mainHand-note").hidden, true);
    assert.equal($("cfg-poisons-mainHand-tooltip").hidden, false);
    assert.equal(
      $("cfg-poisons-mainHand-tooltip-text").textContent,
      poisonInfo("instant").text,
    );
    assert.equal(
      $("cfg-poisons-mainHand").getAttribute("aria-describedby"),
      "cfg-poisons-mainHand-rank cfg-poisons-mainHand-effect cfg-poisons-mainHand-charges",
    );
  });

  it("a choice reaches config.poisons; None writes null and hides the lines", () => {
    const { $, store } = page();
    pick($, "mainHand", "deadly");
    assert.equal(store.get().config.poisons.mainHand, "deadly");
    pick($, "offHand", "");
    assert.equal(store.get().config.poisons.offHand, null);
    assert.equal($("cfg-poisons-offHand-rank").hidden, true);
    assert.equal($("cfg-poisons-offHand-line").hidden, true);
    assert.equal($("cfg-poisons-offHand-charges").hidden, true);
    assert.equal($("cfg-poisons-offHand-tooltip").hidden, true);
    assert.equal(
      $("cfg-poisons-offHand").getAttribute("aria-describedby"),
      null,
    );
  });

  it("a poison the sim does not simulate gets the amber note, not the tag", () => {
    const { $, store } = page();
    pick($, "offHand", "crippling");
    assert.equal(store.get().config.poisons.offHand, "crippling");
    assert.equal($("cfg-poisons-offHand-note").hidden, false);
    assert.equal(
      $("cfg-poisons-offHand-note-text").textContent,
      "Not simulated yet: it slows the target's movement, and does no damage.",
    );
    assert.equal($("cfg-poisons-offHand-charges").hidden, true);
    assert.equal($("cfg-poisons-offHand-rank").textContent, "Rank 2 (highest)");
    assert.equal(
      $("cfg-poisons-offHand").getAttribute("aria-describedby"),
      "cfg-poisons-offHand-rank cfg-poisons-offHand-effect cfg-poisons-offHand-note",
    );
  });

  it("Reset and Undo move the selects", () => {
    const { $, actions } = page();
    pick($, "mainHand", "wound");
    actions.reset();
    assert.equal($("cfg-poisons-mainHand").value, "instant");
    actions.undo();
    assert.equal($("cfg-poisons-mainHand").value, "wound");
    assert.equal($("cfg-poisons-mainHand-note").hidden, false);
  });

  it("words every poison's effect and only non-DPS ones get a note", () => {
    for (const key of k("config.poisonIds")) {
      const info = poisonInfo(key);
      assert.match(poisonRankText(info), /^Rank \d+ \(highest\)$/, key);
      assert.match(poisonEffectText(info), /^\d+% on hit · \S/, key);
      assert.equal(poisonNoteText(info) === "", info.simulated, key);
    }
    assert.equal(
      poisonRankText({ rank: 3, highest: false }),
      "Rank 3",
      "a lower rank is not called highest",
    );
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

  it("has a Poison select and its lines in each hand's fieldset", () => {
    for (const hand of ["mainHand", "offHand"]) {
      const id = `cfg-poisons-${hand}`;
      const fieldset = form
        .split("</fieldset>")
        .find((part) => part.includes(`id="cfg-weapons-${hand}-type"`));
      assert.match(fieldset, new RegExp(`<select\\s+id="${id}"`));
      assert.match(fieldset, new RegExp(`<label for="${id}">Poison</label>`));
      for (const part of [
        "",
        "-rank",
        "-line",
        "-effect",
        "-charges",
        "-note",
        "-note-text",
        "-tooltip",
        "-tooltip-text",
        "-error",
      ]) {
        assert.match(fieldset, new RegExp(`id="${id}${part}"`), part);
      }
      assert.match(fieldset, /Charges not\s+tracked/);
      assert.match(fieldset, /<summary>Tooltip text<\/summary>/);
      assert.match(
        fieldset,
        new RegExp(`<select\\s+id="${id}"[^>]*>\\s*</select>`),
        "options come from the catalogue",
      );
      assert.doesNotMatch(
        fieldset,
        /aria-live|role="status"/,
        "no live region",
      );
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

describe("a field typed in is checked on blur (#247)", () => {
  it("Backspace then the same digit: no change fires, and blur checks it", () => {
    const { $, commit, store } = page();
    commit("weapons.mainHand.min", "50");
    commit("weapons.mainHand.max", "40");
    const min = $("cfg-weapons-mainHand-min");
    const max = $("cfg-weapons-mainHand-max");
    assert.equal(max.getAttribute("aria-invalid"), "true");
    min.value = "5";
    min.fire("input");
    assert.equal(max.getAttribute("aria-invalid"), null, "typing cleared it");
    min.value = "50";
    min.fire("input");
    assert.equal($("cfg-status-ok").hidden, false, "no error while typing");
    min.fire("blur");
    assert.equal(max.getAttribute("aria-invalid"), "true", "checked again");
    assert.equal(min.getAttribute("aria-invalid"), "true", "the Min marked");
    assert.equal(
      blockedCount({ ...store.get(), run: { mode: "live", errors: {} } }),
      1,
    );
    assert.deepEqual(store.get().form.edited, []);
  });

  it("blur after a change, or with nothing typed, writes nothing", () => {
    const { $, commit, store } = page();
    commit("weapons.mainHand.min", "30");
    const before = store.get().form;
    $("cfg-weapons-mainHand-min").fire("blur");
    $("cfg-weapons-mainHand-max").fire("blur");
    assert.equal(store.get().form, before);
  });
});
