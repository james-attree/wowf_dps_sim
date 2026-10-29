import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  createConfigForm,
  nextRunConfig,
  pageDefaultConfig,
} from "../js/config-form.js";
import {
  createRotationBuilder,
  defaultAddAction,
  fixFor,
  shownWarnings,
} from "../js/rotation-builder.js";
import { jumpLabel, placeOf } from "../js/rotation-builder-copy.js";
import { defaultRotation } from "../js/rotation-default.js";
import {
  draftOf,
  draftRotation,
  moveRule,
  newRule,
} from "../js/rotation-edit.js";
import { skipOf, talentState } from "../js/rotation-skips.js";
import { validateRotation } from "../js/rotation-validator.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";

// The rotation builder's model (U7, #217; Fran's spec in
// design/u7-rotation-builder/ and Scout's decisions of 29 Oct): a session
// draft per origin, config.rotation following the draft only while it is
// valid, Run blocked while it has errors, quick fixes, undo and revert.

function setup() {
  const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
  const form = createConfigForm(store);
  const builder = createRotationBuilder(store, form);
  builder.toggle();
  const slice = () => store.get().rotationBuilder;
  const view = () => slice().view;
  const uid = (at) => view().rules[at].uid;
  const actions = () => store.get().config.rotation.rules.map((r) => r.action);
  return { store, form, builder, slice, view, uid, actions };
}

const DEFAULT_ACTIONS = defaultRotation().rules.map((rule) => rule.action);

describe("the builder opens on the rotation picked in Fight setup", () => {
  it("shows its rules, unedited, and changes nothing", () => {
    const { store, view, actions } = setup();
    assert.equal(view().open, true);
    assert.equal(view().toggle, "Close rotation builder");
    assert.equal(view().rules.length, DEFAULT_ACTIONS.length);
    assert.equal(view().origin.edited, false);
    assert.equal(view().name.value, defaultRotation().name);
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
    assert.deepEqual(store.get().form.drafts, {});
    assert.equal(view().errors, null);
  });

  it("closes again and hands focus back to its button", () => {
    const { builder, view, slice } = setup();
    builder.toggle();
    assert.equal(view().open, false);
    assert.equal(view().toggle, "Edit rotation…");
    assert.equal(slice().focus.key, "toggle");
  });
});

describe("the first edit starts a session draft (D10, D20)", () => {
  it("moves a rule, renames the copy and applies to the next run", () => {
    const { store, builder, view, slice, uid, actions } = setup();
    const first = uid(0);
    builder.move(first, 1);
    assert.deepEqual(actions(), moveRule(DEFAULT_ACTIONS, 0, 1));
    assert.equal(view().rules[1].uid, first, "the rule keeps its uid");
    assert.equal(view().name.value, `${defaultRotation().name} (edited)`);
    assert.equal(view().origin.edited, true);
    assert.equal(
      store.get().form.rotationOptions[0].label,
      `${defaultRotation().name} · Edited`,
    );
    assert.match(slice().announce.text, /moved down to rule 2 of 7/);
    assert.equal(slice().focus.key, `${first}.down`);
    assert.notEqual(nextRunConfig(store.get()), null);
  });

  it("keeps the draft across a switch to another rotation and back", () => {
    const { store, form, builder, uid, actions } = setup();
    builder.move(uid(0), 1);
    const edited = actions();
    const other = store.get().form.rotationOptions[1].id;
    form.chooseRotation(other);
    assert.notDeepEqual(actions(), edited);
    form.chooseRotation("default");
    assert.deepEqual(actions(), edited);
  });

  it("revert drops the draft; undo brings it back", () => {
    const { store, builder, view, uid, actions } = setup();
    builder.move(uid(0), 1);
    const edited = actions();
    builder.revert();
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
    assert.equal(view().origin.edited, false);
    assert.deepEqual(store.get().form.drafts, {});
    assert.ok(view().banner?.undo, "the banner offers Undo");
    builder.undo();
    assert.deepEqual(actions(), edited);
    assert.equal(view().origin.edited, true);
  });

  it("delete says so and can be undone", () => {
    const { builder, view, uid, actions } = setup();
    const gone = uid(6);
    builder.remove(gone);
    assert.equal(view().rules.length, DEFAULT_ACTIONS.length - 1);
    assert.ok(view().banner?.undo);
    builder.undo();
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
    assert.equal(view().rules[6].uid, gone);
  });
});

describe("the keyboard grab (section 7)", () => {
  it("Space lifts, ↑ moves, Space drops; focus stays on the grip", () => {
    const { builder, view, slice, uid, actions } = setup();
    const second = uid(1);
    assert.equal(builder.gripKey(second, " "), true);
    assert.equal(view().rules[1].lifted, true);
    assert.equal(builder.gripKey(second, "ArrowUp"), true);
    assert.equal(builder.gripKey(second, " "), true);
    assert.equal(view().rules[0].uid, second);
    assert.equal(view().rules[0].lifted, false);
    assert.deepEqual(actions(), moveRule(DEFAULT_ACTIONS, 1, 0));
    assert.equal(slice().focus.key, `${second}.grip`);
  });

  it("Escape puts the rule back where it was", () => {
    const { builder, view, uid, actions } = setup();
    const second = uid(1);
    builder.gripKey(second, " ");
    builder.gripKey(second, "ArrowDown");
    builder.gripKey(second, "Escape");
    assert.equal(view().rules[1].uid, second);
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
  });

  it("ignores other keys", () => {
    const { builder, uid } = setup();
    assert.equal(builder.gripKey(uid(1), "a"), false);
  });
});

describe("errors keep the last valid version (D17, D19)", () => {
  function broken() {
    const page = setup();
    const evis = page.uid(5);
    page.builder.toggleRule(evis);
    const cuid = page.view().rules[5].body.conditions[0].uid;
    page.builder.setParam(evis, cuid, "value", "");
    return { ...page, evis, cuid };
  }

  it("config keeps the last valid rotation and Run is blocked", () => {
    const { store, view } = broken();
    const form = store.get().form;
    assert.equal(form.rotationErrors.length, 1);
    assert.deepEqual(
      store.get().config.rotation.rules[5].conditions[0].value,
      defaultRotation().rules[5].conditions[0].value,
    );
    assert.equal(nextRunConfig(store.get()), null);
    assert.match(form.summary.stale, /1 error/);
    assert.ok(view().errors !== null);
    assert.equal(view().errors.jumps.length, 1);
    assert.match(view().errors.jumps[0].label, /Rule 6: Eviscerate/);
  });

  it("jumpToFirstError opens the rule and focuses the bad field", () => {
    const { builder, slice, view, cuid } = broken();
    builder.toggle();
    assert.equal(view().open, false);
    builder.jumpToFirstError();
    assert.equal(view().open, true);
    assert.equal(view().rules[5].open, true);
    assert.equal(slice().focus.key, `${cuid}.value`);
  });

  it("fixing the last error says so and the draft runs again", () => {
    const { store, builder, slice, evis, cuid } = broken();
    builder.setParam(evis, cuid, "value", "4");
    assert.equal(store.get().form.rotationErrors.length, 0);
    assert.equal(store.get().config.rotation.rules[5].conditions[0].value, 4);
    assert.equal(slice().announce.text, "No errors left.");
    assert.equal(store.get().form.summary.stale, null);
    assert.notEqual(nextRunConfig(store.get()), null);
  });

  it("the error list stops at the cap, then says how many more", () => {
    const { builder, view, uid } = setup();
    const max = k("rotation.maxListedEntries");
    // Blank every value of every rule until there are more errors than shown.
    let errors = 0;
    for (let at = 0; errors <= max && at < view().rules.length; at += 1) {
      const rule = uid(at);
      builder.toggleRule(rule);
      for (let n = 0; n < k("rotation.maxConditionsPerRule"); n += 1) {
        builder.addCondition(rule);
      }
      for (const condition of view().rules[at].body.conditions) {
        for (const field of condition.fields) {
          if (field.kind === "number") {
            builder.setParam(rule, condition.uid, field.param, "");
          }
        }
      }
      errors = view().errors?.jumps.length ?? 0;
      if (view().errors?.more) {
        break;
      }
    }
    assert.equal(view().errors.jumps.length, max);
    assert.match(view().errors.more, /^…and \d+ more$/);
  });
});

describe("quick fixes (section 6)", () => {
  it("a finisher without a combo point check gets one", () => {
    const { store, builder, view, uid } = setup();
    const evis = uid(5);
    builder.toggleRule(evis);
    const cuid = view().rules[5].body.conditions[0].uid;
    builder.removeCondition(evis, cuid);
    const message = view().rules[5].messages.find(
      (m) => m.fix !== null && /CP/.test(m.fix.label),
    );
    assert.ok(message, "the finisher warning has a fix");
    assert.equal(message.kind, "warning");
    builder.fix(message.fix.id);
    const rule = store.get().config.rotation.rules[5];
    assert.ok(rule.conditions.some((c) => c.type === "comboPoints"));
    assert.equal(
      store
        .get()
        .form.rotationWarnings.filter((w) => w.path.startsWith("rules[5]"))
        .filter((w) => w.code === "finisherNoComboPoints").length,
      0,
    );
  });

  it("the finisher warning alone is shown on its rule (Fran §18 item 6)", () => {
    const warnings = [
      { path: "rules[2]", code: "finisherNoComboPoints" },
      { path: "rules[2]", code: "starves", below: [3] },
      { path: "rules[4]", code: "starves", below: [5] },
    ];
    assert.deepEqual(
      shownWarnings(warnings).map((w) => `${w.path} ${w.code}`),
      ["rules[2] finisherNoComboPoints", "rules[4] starves"],
    );
  });

  it("offers no fix for an entry it can't place", () => {
    const rotation = defaultRotation();
    assert.equal(fixFor({ code: "duplicateRule" }, 99, rotation), null);
    assert.equal(fixFor({ code: "unknownThing" }, 0, rotation), null);
  });
});

describe("adding a rule (section 8)", () => {
  it("defaults to the first finisher the rotation doesn't cast", () => {
    assert.equal(defaultAddAction(defaultRotation().rules), "rupture");
  });

  it("adds it at the bottom with its checks, and it is valid", () => {
    const { store, builder, view } = setup();
    builder.addRule();
    const rules = store.get().config.rotation.rules;
    assert.equal(rules.length, DEFAULT_ACTIONS.length + 1);
    assert.equal(rules.at(-1).action, "rupture");
    assert.ok(rules.at(-1).conditions.some((c) => c.type === "comboPoints"));
    assert.equal(store.get().form.rotationErrors.length, 0);
    assert.equal(view().rules.at(-1).name, "Rupture");
  });
});

describe("rotation-edit drafts", () => {
  it("round-trips a rotation through a draft", () => {
    let n = 0;
    const draft = draftOf(defaultRotation(), () => `u${(n += 1)}`);
    assert.deepEqual(draftRotation(draft), defaultRotation());
    assert.equal(new Set(draft.rules.map((rule) => rule.uid)).size, 7);
  });

  it("a new rule is valid on its own", () => {
    let n = 0;
    for (const action of ["rupture", "eviscerate", "cold-blood"]) {
      const rule = newRule(action, () => `u${(n += 1)}`);
      const rotation = draftRotation({ name: "x", rules: [rule] });
      assert.deepEqual(validateRotation(rotation), [], action);
    }
  });
});

describe("skips and places", () => {
  it("Cold Blood is skipped with no talents", () => {
    const state = talentState({ talents: {} });
    const rule = defaultRotation().rules.find((r) => r.action === "cold-blood");
    assert.equal(skipOf(rule, state)?.text, "no Cold Blood talent");
  });

  it("places a path", () => {
    assert.deepEqual(placeOf("name"), { at: "name" });
    assert.deepEqual(placeOf("rules"), { at: "list" });
    assert.deepEqual(placeOf("rules[3]"), { at: "rule", rule: 3 });
    assert.deepEqual(placeOf("rules[3].action"), { at: "action", rule: 3 });
    assert.deepEqual(placeOf("rules[3].conditions"), {
      at: "conditions",
      rule: 3,
    });
    assert.deepEqual(placeOf("rules[3].conditions[2].value"), {
      at: "condition",
      rule: 3,
      condition: 2,
      param: "value",
    });
  });

  it("names a place the way the jump list reads it", () => {
    const label = jumpLabel(
      { path: "rules[4].conditions[2].value", code: "x" },
      defaultRotation(),
    );
    assert.match(label, /^Rule 5: Cold Blood, condition 3/);
  });
});

describe("the config form's drafts (#217)", () => {
  const fresh = () => {
    const store = createStore({ config: normalizeConfig(pageDefaultConfig()) });
    return { store, form: createConfigForm(store) };
  };
  let n = 0;
  const uidOf = () => `d${(n += 1)}`;

  it("a valid draft is the config's rotation; dropping it restores the origin", () => {
    const { store, form } = fresh();
    const draft = draftOf(defaultRotation(), uidOf);
    draft.rules = moveRule(draft.rules, 0, 6);
    form.setDraft("default", draft);
    assert.equal(store.get().config.rotation.rules[6].action, "blade-flurry");
    assert.equal(store.get().form.rotationChoice, "default");
    form.setDraft("default", null);
    assert.deepEqual(store.get().config.rotation, defaultRotation());
    assert.deepEqual(store.get().form.drafts, {});
  });

  it("an invalid draft keeps its last valid version in the config", () => {
    const { store, form } = fresh();
    const draft = draftOf(defaultRotation(), uidOf);
    draft.rules = moveRule(draft.rules, 0, 6);
    form.setDraft("default", draft);
    const valid = store.get().config.rotation;
    const bad = { ...draft, rules: [...draft.rules] };
    bad.rules[0] = { ...bad.rules[0], action: "no-such-ability" };
    form.setDraft("default", bad);
    assert.deepEqual(store.get().config.rotation, valid);
    assert.ok(store.get().form.rotationErrors.length > 0);
    assert.match(store.get().form.summary.stale, /so the sim keeps this/);
  });

  it("the summary says which rules the build skips (D9)", () => {
    const { store } = fresh();
    const line = store
      .get()
      .form.summary.rules.find((rule) => rule.startsWith("Cold Blood"));
    assert.match(line, /— skipped: no Cold Blood talent$/);
  });
});
