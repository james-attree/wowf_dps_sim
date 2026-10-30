import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { referenceBuild } from "../data/reference-build.js";
import {
  createConfigForm,
  draftEdited,
  listedLines,
  nextRunConfig,
  pageDefaultConfig,
  summaryOf,
} from "../js/config-form.js";
import {
  conditionFields,
  conditionTypeGroups,
  createRotationBuilder,
  defaultAddAction,
  fixFor,
} from "../js/rotation-builder.js";
import { TYPE_GROUPS } from "../js/rotation-builder-copy.js";
import {
  CONDITION_PARAMS,
  CONDITION_TYPES,
  OPERATORS,
} from "../js/rotation-conditions.js";
import { entryText, jumpLabel, placeOf } from "../js/rotation-builder-copy.js";
import { defaultRotation } from "../js/rotation-default.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import {
  defaultCondition,
  draftOf,
  draftRotation,
  moveRule,
  newRule,
  withParam,
} from "../js/rotation-edit.js";
import { skipOf, talentState } from "../js/rotation-skips.js";
import { validateRotation } from "../js/rotation-validator.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createStore } from "../js/store.js";

// The rotation builder's model (U7, #217; Fran's spec in
// design/u7-rotation-builder/ and Scout's decisions of 29 Oct): a session
// draft per origin, config.rotation following the draft only while it is
// valid, Run blocked while it has errors, quick fixes, undo and revert.

// A rule's screen (#243, UX5): its route, #rotation/rule/<n>, shown.
function openRule(builder, view, ruleUid) {
  const at = view().rules.findIndex((rule) => rule.uid === ruleUid);
  builder.showScreen("rule", String(at + 1));
}

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
  it("says a rule is skipped with no talents, or with this build (Fran's #232 QA, nit 5; #234)", () => {
    const { store, view } = setup();
    assert.equal(
      view().context.text,
      "3 rules are skipped with no talents (rule 1, rule 2, rule 5). ",
    );
    const ranks = { ...referenceBuild() };
    delete ranks["assassination.cold-blood"];
    store.update((state) => ({
      config: { ...state.config, talents: ranks },
    }));
    assert.equal(
      view().context.text,
      "1 rule is skipped with this build (rule 5). ",
    );
  });
  it("shows its rules, unedited, and changes nothing", () => {
    const { store, view, actions } = setup();
    assert.equal(view().open, true);
    assert.equal(view().screen.kind, "list");
    assert.equal(view().screen.title, "Rotation");
    assert.equal(view().rules.length, DEFAULT_ACTIONS.length);
    assert.equal(view().origin.edited, false);
    assert.equal(view().name.value, defaultRotation().name);
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
    assert.deepEqual(store.get().form.drafts, {});
    assert.equal(view().errors, null);
  });

  it("closes from its back link, back to the link that opened it (Fran's #251 check)", () => {
    const { builder, view } = setup();
    assert.deepEqual(view().screen.back, {
      href: "#character",
      text: "Character",
      focus: "cfg-rotation-edit",
    });
    builder.toggle();
    assert.equal(view().open, false);
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

// A finisher with no combo points check under a rule that builds the points
// (finisherNoComboPoints, and starves with its below: #216's rule), and an
// unconditional builder above Backstab (starves).
const TRAP = {
  schemaVersion: defaultRotation().schemaVersion,
  name: "Trap",
  rules: [
    {
      action: "sinister-strike",
      conditions: [{ type: "comboPoints", op: "<", value: 1 }],
    },
    { action: "eviscerate", conditions: [] },
    { action: "sinister-strike", conditions: [] },
    { action: "backstab", conditions: [] },
  ],
};

// Kira's QA case on #216: SS (CP < 1), Eviscerate, Hemorrhage.
const KIRA = {
  schemaVersion: defaultRotation().schemaVersion,
  name: "Kira",
  rules: [
    {
      action: "sinister-strike",
      conditions: [{ type: "comboPoints", op: "<", value: 1 }],
    },
    { action: "eviscerate", conditions: [] },
    {
      action: "hemorrhage",
      conditions: [{ type: "abilityUnlocked", ability: "hemorrhage" }],
    },
  ],
};

describe("the builder and the import box show the same warnings (Scout on #217)", () => {
  // The builder adds no filter of its own: it shows rotationWarnings as is.
  const cases = [
    [
      "Trap",
      TRAP,
      [
        ["finisherNoComboPoints", "rules[1].conditions", undefined],
        ["starves", "rules[1]", [2, 3]],
        ["starves", "rules[2]", [3]],
      ],
    ],
    [
      "Kira's #216 case",
      KIRA,
      [
        ["finisherNoComboPoints", "rules[1].conditions", undefined],
        ["starves", "rules[1]", [2]],
      ],
    ],
  ];
  for (const [name, rotation, expected] of cases) {
    it(`${name}: the same entries, in the same order, and the same count`, () => {
      const { store, form, view } = setup();
      assert.equal(form.importText(exportRotation(rotation)), true);
      const state = store.get().form;
      const imported = importRotation(exportRotation(rotation)).warnings;
      assert.deepEqual(
        imported.map(({ code, path, below }) => [
          code,
          path,
          below && [...below],
        ]),
        expected,
      );
      // The import box's lines, and the list the builder draws from.
      assert.equal(state.importStatus.warnings, listedLines(imported));
      assert.deepEqual(state.rotationWarnings, imported);
      assert.deepEqual(rotationWarnings(rotation), imported);
      // The builder's cards carry every entry, worded the builder's way, and
      // its summary counts them all.
      const shown = view()
        .rules.flatMap((rule) => rule.messages)
        .filter((m) => m.kind === "warning");
      assert.deepEqual(
        shown.map((m) => [m.code, m.path, m.text]),
        imported.map((entry) => [
          entry.code,
          entry.path,
          entryText(entry, rotation),
        ]),
      );
      assert.match(
        view().warnings.count,
        new RegExp(`: ${imported.length} warnings\\. $`),
      );
      assert.equal(view().warnings.jumps.length, imported.length);
    });
  }
});

describe("Edited clears when the draft is the origin again (Scout on #217)", () => {
  const label = (store) => store.get().form.rotationOptions[0].label;
  const NAME = defaultRotation().name;

  it("move a rule down and up again: not edited, under the origin's name", () => {
    const { store, builder, view, uid, actions } = setup();
    const first = uid(0);
    builder.move(first, 1);
    assert.equal(label(store), `${NAME} · Edited`);
    builder.move(first, -1);
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
    assert.equal(label(store), NAME);
    assert.equal(view().origin.edited, false);
    assert.equal(view().name.value, NAME);
    assert.equal(store.get().config.rotation.name, NAME);
    // The next edit is a first edit again.
    builder.move(first, 1);
    assert.equal(view().name.value, `${NAME} (edited)`);
    assert.equal(label(store), `${NAME} · Edited`);
  });

  it("delete, then undo back to the original: the tag clears", () => {
    const { store, builder, view, uid, actions } = setup();
    builder.remove(uid(6));
    assert.equal(label(store), `${NAME} · Edited`);
    assert.equal(view().origin.edited, true);
    builder.undo();
    assert.deepEqual(actions(), DEFAULT_ACTIONS);
    assert.equal(label(store), NAME);
    assert.equal(view().origin.edited, false);
  });

  it("an edit after an edit, undone, is still edited; revert is unchanged", () => {
    const { store, builder, view, uid } = setup();
    builder.move(uid(0), 1);
    builder.remove(uid(6));
    builder.undo();
    assert.equal(label(store), `${NAME} · Edited`);
    assert.equal(view().origin.edited, true);
    builder.revert();
    assert.deepEqual(store.get().form.drafts, {});
    assert.equal(label(store), NAME);
  });

  it("a renamed copy with the origin's rules is still edited", () => {
    const { store, builder, view } = setup();
    builder.setName("My rotation");
    assert.equal(label(store), `${NAME} · Edited`);
    builder.setName(NAME);
    assert.equal(label(store), NAME);
    assert.equal(view().origin.edited, false);
  });

  it("compares rules with duplicateRule's normaliser: condition and key order, defaults", () => {
    let n = 0;
    const uidOf = () => `e${(n += 1)}`;
    const origin = {
      ...TRAP,
      rules: [
        {
          action: "sinister-strike",
          conditions: [
            { type: "comboPoints", op: "<", value: 1 },
            { type: "cooldownReady", ability: "sinister-strike" },
          ],
        },
        ...TRAP.rules.slice(1),
      ],
    };
    const same = draftOf(
      {
        ...origin,
        rules: [
          {
            action: "sinister-strike",
            conditions: [
              {
                ability: "sinister-strike",
                type: "cooldownReady",
                ready: true,
              },
              { value: 1, op: "<", type: "comboPoints" },
            ],
          },
          ...origin.rules.slice(1),
        ],
      },
      uidOf,
    );
    assert.equal(draftEdited(same, origin), false);
    const moved = { ...same, rules: moveRule(same.rules, 0, 1) };
    assert.equal(draftEdited(moved, origin), true, "rule order counts");
    const unready = draftOf(
      {
        ...origin,
        rules: [
          {
            action: "sinister-strike",
            conditions: [
              { type: "comboPoints", op: "<", value: 1 },
              {
                type: "cooldownReady",
                ability: "sinister-strike",
                ready: false,
              },
            ],
          },
          ...origin.rules.slice(1),
        ],
      },
      uidOf,
    );
    assert.equal(draftEdited(unready, origin), true);
  });
});

describe("a new import never touches the edited presets (Scout on #217)", () => {
  it("keeps the default's and a preset's drafts; drops only the import's", () => {
    const { store, form, builder, uid } = setup();
    builder.move(uid(0), 1);
    const preset = store.get().form.rotationOptions[1].id;
    form.chooseRotation(preset);
    builder.move(uid(0), 1);
    const kept = {
      default: store.get().form.drafts.default,
      [preset]: store.get().form.drafts[preset],
    };
    assert.equal(form.importText(exportRotation(TRAP)), true);
    builder.move(uid(0), 1);
    assert.ok(Object.hasOwn(store.get().form.drafts, "imported"));
    assert.equal(form.importText(exportRotation(TRAP)), true);
    const { drafts, rotationOptions } = store.get().form;
    assert.deepEqual(Object.keys(drafts).sort(), Object.keys(kept).sort());
    assert.equal(drafts.default, kept.default, "the same draft, untouched");
    assert.equal(drafts[preset], kept[preset], "the same draft, untouched");
    const labels = rotationOptions.map((option) => option.label);
    assert.equal(labels[0], `${defaultRotation().name} · Edited`);
    assert.match(labels[1], / · Edited$/);
    assert.equal(labels.at(-1), "Imported: Trap");
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
    openRule(page.builder, page.view, evis);
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

  it("Export is off while there are errors, and says why (D17)", () => {
    const { store, form, builder, evis, cuid } = broken();
    assert.equal(form.exportRotation(), null);
    assert.equal(
      store.get().form.exportOff,
      "Export is off: the rotation has 1 error.",
    );
    builder.setParam(evis, cuid, "value", "4");
    assert.equal(store.get().form.exportOff, null);
    const file = form.exportRotation();
    assert.match(file.fileName, /\.json$/);
    assert.equal(JSON.parse(file.text).rules[5].conditions[0].value, 4);
  });

  it("Export follows the rotation picked: a valid one exports again (D17)", () => {
    const { store, form } = broken();
    form.chooseRotation(store.get().form.rotationOptions[1].id);
    assert.equal(store.get().form.exportOff, null);
    assert.notEqual(form.exportRotation(), null);
    form.chooseRotation("default");
    assert.equal(form.exportRotation(), null);
  });

  it("the error list stops at the cap, then says how many more", () => {
    const { builder, view, uid } = setup();
    const max = k("rotation.maxListedEntries");
    // Blank every value of every rule until there are more errors than shown.
    let errors = 0;
    for (let at = 0; errors <= max && at < view().rules.length; at += 1) {
      const rule = uid(at);
      openRule(builder, view, rule);
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
    openRule(builder, view, evis);
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
    // With no talents it says that plainly (Fran's #232 QA, nit 4; #234).
    assert.match(line, /— skipped with no talents$/);
    const ranks = { ...referenceBuild() };
    delete ranks["assassination.cold-blood"];
    const built = summaryOf(defaultRotation(), {
      talents: talentState({ talents: ranks }),
    }).rules.find((rule) => rule.startsWith("Cold Blood"));
    assert.match(built, /— skipped: no Cold Blood talent$/);
  });
});

describe("condition controls come from CONDITION_PARAMS (Scout's review of #218)", () => {
  const sample = (type) => ({
    ...defaultCondition(type, "sinister-strike"),
    uid: "c1",
  });

  it("every type gets one control per param, in spec order, and no empty select", () => {
    for (const type of CONDITION_TYPES) {
      const fields = conditionFields(sample(type));
      assert.deepEqual(
        fields.map((field) => field.param),
        Object.keys(CONDITION_PARAMS[type]),
        type,
      );
      for (const field of fields) {
        const spec = CONDITION_PARAMS[type][field.param];
        assert.equal(field.kind, spec.kind === "number" ? "number" : "select");
        if (field.kind === "select") {
          assert.ok(field.options.length > 0, `${type}.${field.param}`);
        }
      }
    }
  });

  it("an operator's options are the spec's values", () => {
    const [op] = conditionFields(sample("comboPoints"));
    assert.equal(op.param, "op");
    assert.deepEqual(
      op.options.map((option) => option.value),
      [...CONDITION_PARAMS.comboPoints.op.values],
    );
    assert.deepEqual(
      [...CONDITION_PARAMS.comboPoints.op.values],
      [...OPERATORS],
    );
  });

  it("a left-out boolean shows the spec's default", () => {
    const left = { type: "auraActive", aura: "slice-and-dice", uid: "c1" };
    const field = (params) =>
      conditionFields(left, {}, params).find((f) => f.param === "active");
    assert.equal(field().value, "true");
    const flipped = {
      ...CONDITION_PARAMS.auraActive,
      active: { kind: "boolean", optional: true, default: false },
    };
    assert.equal(field(flipped).value, "false");
    assert.equal(
      conditionFields({ ...left, active: false }).find(
        (f) => f.param === "active",
      ).value,
      "false",
    );
  });

  it("an unknown kind, id or type fails loudly", () => {
    const condition = { type: "comboPoints", uid: "c1" };
    assert.throws(
      () => conditionFields(condition, {}, { colour: { kind: "colour" } }),
      { name: "TypeError", message: /no control .*"colour"/ },
    );
    assert.throws(
      () =>
        conditionFields(condition, {}, { spell: { kind: "id", of: "spell" } }),
      { name: "TypeError", message: /no control .*"spell"/ },
    );
    assert.throws(() => conditionFields({ type: "noSuchType", uid: "c1" }), {
      name: "TypeError",
      message: /no controls for a "noSuchType" condition/,
    });
  });

  it("every condition type is in a TYPE_GROUPS group", () => {
    const grouped = TYPE_GROUPS.flatMap(([, types]) => types);
    assert.deepEqual([...grouped].sort(), [...CONDITION_TYPES].sort());
    assert.equal(new Set(grouped).size, grouped.length, "each once");
    assert.equal(
      conditionTypeGroups().some((group) => group.label === "Other"),
      false,
    );
  });

  it("a type no group names is offered under Other, never hidden", () => {
    const groups = conditionTypeGroups([...CONDITION_TYPES, "newType"]);
    assert.deepEqual(groups.at(-1), {
      label: "Other",
      options: [{ value: "newType", text: "newType" }],
    });
    const offered = groups.flatMap((group) =>
      group.options.map((option) => option.value),
    );
    assert.deepEqual(offered.sort(), [...CONDITION_TYPES, "newType"].sort());
  });
});

describe("a number field reads plain decimals only (Scout's review of #218)", () => {
  const condition = { type: "comboPoints", op: ">=", value: 5 };
  const read = (text) => withParam(condition, "value", text).value;

  it("reads a plain decimal, with an optional sign and point", () => {
    for (const [text, value] of [
      ["40", 40],
      [" 7 ", 7],
      ["-1", -1],
      ["+2.5", 2.5],
      ["2.", 2],
      [".5", 0.5],
      ["0", 0],
    ]) {
      assert.equal(read(text), value, text);
    }
  });

  it("anything else is NaN, so the validator says it is not a number", () => {
    for (const text of [
      "0x10",
      "0b1",
      "0o7",
      "1e1",
      "1E-2",
      "Infinity",
      "-Infinity",
      "1,5",
      "1 2",
      "--1",
      "+-1",
      ".",
      "-",
      "1.2.3",
      "five",
    ]) {
      assert.ok(Number.isNaN(read(text)), text);
    }
    assert.equal(
      Object.hasOwn(withParam(condition, "value", " "), "value"),
      false,
    );
  });
});

describe("half-typed number text follows copies and deletes (Scout's review of #218)", () => {
  const valueOf = (ruleView, at) =>
    ruleView.body.conditions[at].fields.find((f) => f.param === "value").value;

  it("a copy of a rule shows the copied text, never NaN", () => {
    const { store, builder, view, uid } = setup();
    const ruleUid = uid(5);
    openRule(builder, view, ruleUid);
    const cuid = view().rules[5].body.conditions[0].uid;
    builder.setParam(ruleUid, cuid, "value", "abc");
    assert.equal(valueOf(view().rules[5], 0), "abc");
    builder.duplicate(ruleUid);
    const copy = view().rules[6];
    assert.notEqual(copy.uid, ruleUid);
    assert.equal(valueOf(copy, 0), "abc");
    const copied = copy.body.conditions[0].uid;
    assert.equal(store.get().form.drafts.default.raw[copied], "abc");
  });

  it("deleting a rule drops its text; clearing all drops all of it", () => {
    const { store, builder, view, uid } = setup();
    const ruleUid = uid(5);
    openRule(builder, view, ruleUid);
    const cuid = view().rules[5].body.conditions[0].uid;
    builder.setParam(ruleUid, cuid, "value", "abc");
    builder.duplicate(ruleUid);
    const copied = view().rules[6].body.conditions[0].uid;
    builder.remove(ruleUid);
    const raw = () => store.get().form.drafts.default.raw;
    assert.equal(Object.hasOwn(raw(), cuid), false);
    assert.equal(raw()[copied], "abc", "the copy keeps its own");
    builder.clearAll();
    assert.deepEqual(raw(), {});
  });
});

describe("jumps find a message by its entry's code and path (Scout's review of #218)", () => {
  it("each message carries its entry's code and path; a jump focuses that one", () => {
    const { form, builder, view, slice } = setup();
    assert.equal(form.importText(exportRotation(TRAP)), true);
    // Rule 2 has two warnings, so only code and path tell them apart.
    assert.deepEqual(
      view()
        .rules[1].messages.filter((m) => m.kind === "warning")
        .map((m) => [m.code, m.path]),
      [
        ["finisherNoComboPoints", "rules[1].conditions"],
        ["starves", "rules[1]"],
      ],
    );
    const starves = view().rules[1].messages.find((m) => m.code === "starves");
    const jump = view().warnings.jumps[1];
    builder.jump(jump.id);
    assert.equal(slice().focus.key, starves.key);
  });
});

describe("Fran's re-check of #218 (c3b0f5a)", () => {
  it("Delete, the duplicate fix's Delete and Clear all focus the banner's Undo", () => {
    const { builder, view, slice, uid } = setup();
    builder.remove(uid(6));
    assert.ok(view().banner?.undo);
    assert.equal(slice().focus.key, "undo");
    builder.undo();
    builder.clearAll();
    assert.ok(view().banner?.undo);
    assert.equal(slice().focus.key, "undo");
  });

  it("Tab while holding a rule drops it there, and says so as Space does", () => {
    const spaced = setup();
    spaced.builder.gripKey(spaced.uid(1), " ");
    spaced.builder.gripKey(spaced.uid(1), "ArrowDown");
    spaced.builder.gripKey(spaced.uid(2), " ");
    const { builder, view, slice, uid, actions } = setup();
    const second = uid(1);
    builder.gripKey(second, " ");
    builder.gripKey(second, "ArrowDown");
    assert.equal(builder.gripKey(second, "Tab"), false, "the browser tabs on");
    assert.equal(view().rules[2].uid, second);
    assert.equal(view().rules[2].lifted, false);
    assert.deepEqual(actions(), moveRule(DEFAULT_ACTIONS, 1, 2));
    assert.match(slice().announce.text, / dropped at rule 3 of 7\.$/);
    assert.equal(slice().announce.text, spaced.slice().announce.text);
  });

  it("a value that isn't a plain number says so in the builder's words", () => {
    const { builder, view, uid } = setup();
    const at = view().rules.findIndex((rule) => rule.line.includes("CP"));
    const ruleUid = uid(at);
    openRule(builder, view, ruleUid);
    const cuid = view().rules[at].body.conditions[0].uid;
    for (const text of ["1e1", "0x10"]) {
      builder.setParam(ruleUid, cuid, "value", text);
      const condition = view().rules[at].body.conditions[0];
      assert.deepEqual(condition.errors, ["Enter a plain number, such as 10."]);
      assert.ok(condition.fields.find((f) => f.param === "value").invalid);
    }
  });

  it("the not-a-talent copy is rotationWarnings' message, with the builder's name", () => {
    const rotation = {
      schemaVersion: defaultRotation().schemaVersion,
      name: "Not a talent",
      rules: [
        {
          action: "sinister-strike",
          conditions: [{ type: "abilityGranted", ability: "sinister-strike" }],
        },
        {
          action: "eviscerate",
          conditions: [
            { type: "comboPoints", op: ">=", value: 5 },
            { type: "abilityUnlocked", ability: "eviscerate" },
          ],
        },
        { action: "sinister-strike", conditions: [] },
      ],
    };
    const { form, view } = setup();
    assert.equal(form.importText(exportRotation(rotation)), true);
    const entries = rotationWarnings(rotation).filter((w) =>
      ["grantedNotTalent", "unlockedNotTalent"].includes(w.code),
    );
    assert.deepEqual(
      entries.map((w) => w.code),
      ["grantedNotTalent", "unlockedNotTalent"],
    );
    const shown = view().rules.flatMap((rule) => rule.messages);
    for (const entry of entries) {
      const text = entry.message.replace(` (${entry.ability})`, "");
      assert.equal(entryText(entry, rotation), text, entry.code);
      assert.ok(
        shown.some((m) => m.code === entry.code && m.text === text),
        entry.code,
      );
    }
    assert.equal(
      entryText(entries[0], rotation),
      "Sinister Strike isn't granted by a talent, so 'is granted' is never true here and this rule never casts.",
    );
    assert.equal(
      entryText(entries[1], rotation),
      "Eviscerate doesn't need a talent, so 'is not locked' is always true and does nothing.",
    );
  });
});
