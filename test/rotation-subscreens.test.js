import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConfigForm, pageDefaultConfig } from "../js/config-form.js";
import { createRotationBuilder } from "../js/rotation-builder.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";
import { warningsText } from "../js/views/run-model.js";

// Rotation's screens (#243, UX5): the list, a rule's screen
// (#rotation/rule/<n>) and Export or import (#rotation/share). The model owns
// which is shown; js/views/rotation-builder.js keeps it and the route in step.

function setup() {
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const form = createConfigForm(store);
  const builder = createRotationBuilder(store, form);
  builder.toggle();
  const slice = () => store.get().rotationBuilder;
  const view = () => slice().view;
  const uid = (at) => view().rules[at].uid;
  return { store, form, builder, slice, view, uid };
}

describe("Rotation's screens (#243)", () => {
  it("opens on the list, its back link to Character", () => {
    const { view } = setup();
    assert.equal(view().screen.kind, "list");
    assert.equal(view().screen.title, "Rotation");
    assert.deepEqual(view().screen.heading, {
      n: null,
      hidden: null,
      text: "Rotation",
    });
    assert.equal(view().screen.back.href, "#character");
    assert.equal(view().rules[0].edit.href, "#rotation/rule/1");
    assert.match(view().rules[0].edit.label, /^Edit rule 1, /);
  });

  it("a rule's screen: its title, its h1 (number hidden, spoken), back to the list", () => {
    const { builder, view, slice } = setup();
    builder.showScreen("rule", "2");
    const screen = view().screen;
    assert.equal(screen.kind, "rule");
    assert.equal(screen.param, "2");
    assert.equal(screen.title, `Rule 2: ${view().rules[1].name}`);
    assert.deepEqual(screen.heading, {
      n: "2",
      hidden: "Rule 2: ",
      text: view().rules[1].name,
    });
    assert.deepEqual(screen.back, {
      href: "#rotation",
      text: "Rotation",
      focus: null,
    });
    assert.equal(slice().focus.key, "heading");
    assert.equal(view().rules[1].open, true);
    assert.equal(view().rules[0].open, false);
  });

  it("back to the list focuses the Edit link that opened the screen", () => {
    const { builder, slice, uid } = setup();
    builder.showScreen("rule", "3");
    builder.showScreen(null, null);
    assert.equal(slice().focus.key, `${uid(2)}.edit`);
    builder.showScreen("share", null);
    assert.equal(slice().focus.key, "heading");
    builder.showScreen(null, null);
    assert.equal(slice().focus.key, "share");
  });

  it("a rule number that is not one shows the list", () => {
    const { builder, view } = setup();
    for (const param of ["0", "99", "1.5", "x", null]) {
      builder.showScreen("rule", param);
      assert.equal(view().screen.kind, "list", String(param));
    }
  });

  it("Export or import has its own screen", () => {
    const { builder, view } = setup();
    builder.showScreen("share", null);
    assert.equal(view().screen.kind, "share");
    assert.equal(view().screen.title, "Export or import");
    assert.equal(view().screen.back.href, "#rotation");
  });

  it("Duplicate opens the copy's screen, its h1 focused, twice over (Fran's #252/#253, D1 and D2)", () => {
    const { builder, view, slice, uid } = setup();
    const first = uid(1);
    builder.duplicate(first);
    assert.equal(view().screen.kind, "rule");
    assert.equal(view().screen.param, "3");
    assert.equal(view().screen.uid, uid(2));
    assert.equal(slice().focus.key, "heading");
    assert.ok(view().warnings !== null, "the copy's warning is in the banner");
    // The second, from the copy's own screen.
    builder.duplicate(uid(2));
    assert.equal(view().screen.param, "4");
    assert.equal(view().screen.uid, uid(3));
    assert.equal(slice().focus.key, "heading");
  });

  it("Add rule appends and opens the new rule's screen", () => {
    const { builder, view, slice } = setup();
    const n = view().rules.length;
    builder.addRule();
    assert.equal(view().rules.length, n + 1);
    assert.equal(view().screen.param, String(n + 1));
    assert.equal(slice().focus.key, "heading");
    assert.match(slice().announce.text, /added at the bottom/);
  });

  it("Delete on a rule's screen goes back to the list, with Undo", () => {
    const { builder, view, slice, uid } = setup();
    const gone = uid(1);
    builder.showScreen("rule", "2");
    builder.remove(gone);
    assert.equal(view().screen.kind, "list");
    assert.equal(slice().focus.key, "undo");
  });

  it("a rule moved while its screen is open keeps the screen, on its new number", () => {
    const { builder, view, uid } = setup();
    const moved = uid(1);
    builder.showScreen("rule", "2");
    builder.move(moved, 1);
    assert.equal(view().screen.uid, moved);
    assert.equal(view().screen.param, "3");
  });
});

describe("the Run bar's warnings link (#243)", () => {
  const state = (warnings, errors = 0, run = { state: "idle" }) => ({
    run,
    form: {
      rotationWarnings: Array.from({ length: warnings }, () => ({})),
      rotationErrors: Array.from({ length: errors }, () => ({})),
    },
  });
  it("counts the warnings, with a mark that is not read", () => {
    assert.equal(warningsText(state(1), false), "⚠ 1 rotation warning");
    assert.equal(warningsText(state(3), false), "⚠ 3 rotation warnings");
  });
  it("is not shown with none, with errors, while Run is blocked, or running", () => {
    assert.equal(warningsText(state(0), false), null);
    assert.equal(warningsText(state(2, 1), false), null);
    assert.equal(warningsText(state(2), true), null);
    assert.equal(
      warningsText(state(2, 0, { mode: "batch", state: "running" }), false),
      null,
    );
  });
});
