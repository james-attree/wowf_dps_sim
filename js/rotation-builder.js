import { k } from "../data/constants.js";
import { talentLabel } from "./build-label.js";
import { spellIconUrl } from "./icons.js";
import { editedName, isEditedChoice, originRotation } from "./config-form.js";
import { CONDITION_PARAMS, CONDITION_TYPES } from "./rotation-conditions.js";
import {
  abilityFacts,
  addCondition,
  castableAbilities,
  cooldownAbilities,
  copyRawText,
  defaultCondition,
  draftOf,
  draftRotation,
  dropRawText,
  duplicateRule,
  insertRule,
  moveRule,
  newRule,
  nextConditionType,
  removeCondition,
  removeRule,
  replaceCondition,
  retarget,
  talentAbilities,
  withParam,
} from "./rotation-edit.js";
import {
  EMPTY,
  GRIP_HELP,
  HELP,
  OP_TEXT,
  OTHER_TYPES,
  RESOURCE_LABELS,
  STALE_BANNER,
  TYPE_GROUPS,
  TYPE_LABELS,
  TYPE_NOTES,
  WARNINGS_SUMMARY,
  abilityGroups,
  auraName,
  booleanText,
  count,
  entryText,
  jumpLabel,
  nameOf,
  placeOf,
  poolingHint,
  valueUnit,
} from "./rotation-builder-copy.js";
import { skipOf, takenOf, talentState } from "./rotation-skips.js";
import { rotationContext } from "./rotation-validator.js";
import { summarizeCondition, summarizeRule } from "./rotation-summary.js";

// The rotation builder (Phase 4, #217; Fran's U7 spec). It edits a draft of
// the rotation picked in Fight setup, one draft per origin for the session
// (D20, no persistence: #186), through the config form's setDraft. The config
// form validates it, keeps config.rotation on its last valid version while it
// has errors (D19) and works out its errors and warnings; this file turns all
// of that into the builder's view model, every string and id the view draws,
// in the store's `rotationBuilder` slice. js/views/rotation-builder.js draws
// it and calls these actions; it reads nothing else.
//
// Errors and warnings are placed by their path and worded by their code
// (js/rotation-builder-copy.js); a fix is offered for the codes of section 6.
// Nothing here changes the engine, the validator or the warnings.

const MAX_RULES = k("rotation.maxRules");
const MAX_CONDITIONS = k("rotation.maxConditionsPerRule");
const MAX_NAME = k("rotation.maxNameLength");
const MAX_LISTED = k("rotation.maxListedEntries");
const COUNT_FROM = k("rotation.builderCountFrom");

const TWO = 1 + 1;

const near = (n, max) => n >= max * COUNT_FROM;

// A condition as the summary line can print it: a missing value reads "?".
function printable(condition) {
  const params = CONDITION_PARAMS[condition.type];
  return params?.value !== undefined && !Object.hasOwn(condition, "value")
    ? { ...condition, value: "?" }
    : condition;
}

// A draft condition without its uid.
const bare = (condition) =>
  Object.fromEntries(
    Object.entries(condition).filter(([key]) => key !== "uid"),
  );

const ruleLine = (rule) =>
  summarizeRule({
    action: rule.action,
    conditions: rule.conditions.map((condition) => printable(bare(condition))),
  });

const conditionLine = (condition) =>
  summarizeCondition(printable(bare(condition)));

// The quick fix of an entry on rule `at` (section 6), or null.
export function fixFor(entry, at, rotation) {
  const rule = rotation.rules[at];
  if (rule === undefined) {
    return null;
  }
  const finisherCondition = defaultCondition("comboPoints", rule.action);
  switch (entry.code) {
    case "talentGuard": {
      const condition = { type: "abilityGranted", ability: rule.action };
      return {
        label: `Add "${summarizeCondition(condition)}"`,
        add: condition,
        at: 0,
      };
    }
    case "finisherNoComboPoints":
      return entry.condition === null || entry.condition === undefined
        ? {
            label: `Add "${summarizeCondition(finisherCondition)}"`,
            add: finisherCondition,
          }
        : {
            label: `Set condition ${entry.condition + 1} to "${summarizeCondition(finisherCondition)}"`,
            set: finisherCondition,
            condition: entry.condition,
          };
    case "cooldownNotChecked": {
      const condition = { type: "cooldownReady", ability: rule.action };
      return {
        label: `Add "${summarizeCondition(condition)}"`,
        add: condition,
      };
    }
    case "starves":
      return {
        label: `Move ${nameOf(rule.action)} below them`,
        moveTo: Math.max(at, ...entry.below),
      };
    case "duplicateRule":
      return { label: `Delete rule ${at + 1}`, remove: true };
    default:
      return null;
  }
}

// The default ability of "New rule casts": the first finisher the rotation
// doesn't cast yet (Rupture for the presets, as the mockup has it), else the
// first castable ability.
export function defaultAddAction(rules) {
  const castable = castableAbilities();
  const used = new Set(rules.map((rule) => rule.action));
  return (
    castable.find((id) => abilityFacts(id).finisher && !used.has(id)) ??
    castable[0]
  );
}

function selectOptions(values, label, current) {
  const options = values.map((value) => ({ value, text: label(value) }));
  if (current !== undefined && !values.includes(current)) {
    options.push({ value: String(current), text: label(current) });
  }
  return options;
}

// What an id param's select offers, by the spec's `of` (CONDITION_PARAMS).
// An ability names a cooldown for cooldownReady and a talent ability for the
// talent checks (abilityGranted, abilityUnlocked).
const ID_CONTROLS = {
  ability: (condition) => ({
    label: "ability",
    values:
      condition.type === "cooldownReady"
        ? cooldownAbilities()
        : talentAbilities(),
    text: nameOf,
  }),
  aura: () => ({
    label: "buff",
    values: [...rotationContext().auras],
    text: auraName,
  }),
  debuff: () => ({
    label: "debuff",
    values: Object.keys(rotationContext().debuffs),
    text: auraName,
  }),
};

const noControl = (type, param, spec) =>
  new TypeError(
    `The rotation builder has no control for the ${type} condition's "${param}" (${JSON.stringify(spec)}).`,
  );

// One condition param's control, from its CONDITION_PARAMS spec: its `kind`
// picks the control, `values` (or `of`, for an id) its options, and
// `default` the value shown when it is left out. A kind (or an id's `of`)
// with no control here is a TypeError, never an empty select (Scout's review
// of #218).
function paramField(condition, param, spec, raw) {
  const base = { param, kind: "select" };
  switch (spec.kind) {
    case "operator":
      return {
        ...base,
        label: "comparison",
        value: condition[param] ?? "",
        options: selectOptions(
          [...spec.values],
          (op) => `${op}  ${OP_TEXT[op] ?? ""}`,
          condition[param],
        ),
      };
    case "resource":
      return {
        ...base,
        label: "resource",
        value: condition[param] ?? "",
        options: selectOptions(
          [...spec.values],
          (id) => RESOURCE_LABELS[id] ?? id,
          condition[param],
        ),
      };
    case "id": {
      const control = ID_CONTROLS[spec.of];
      if (control === undefined) {
        throw noControl(condition.type, param, spec);
      }
      const { label, values, text } = control(condition);
      return {
        ...base,
        label,
        value: condition[param] ?? "",
        options: selectOptions(values, text, condition[param]),
      };
    }
    case "boolean": {
      const words = booleanText(param);
      return {
        ...base,
        label: words.label,
        value: String(condition[param] ?? spec.default ?? ""),
        options: [
          { value: "true", text: words.yes },
          { value: "false", text: words.no },
        ],
      };
    }
    case "number": {
      const unit = valueUnit(condition);
      return {
        ...base,
        kind: "number",
        label: unit.words === "" ? param : `${param} in ${unit.words}`,
        unit: unit.unit,
        step: unit.whole ? "1" : "any",
        value:
          raw[condition.uid] ??
          (Object.hasOwn(condition, param) ? String(condition[param]) : ""),
      };
    }
    default:
      throw noControl(condition.type, param, spec);
  }
}

// The controls of one condition, in CONDITION_PARAMS order. `params` is the
// type's spec; a type with none is a TypeError.
export function conditionFields(
  condition,
  raw = {},
  params = CONDITION_PARAMS[condition.type],
) {
  if (params === undefined) {
    throw new TypeError(
      `The rotation builder has no controls for a ${JSON.stringify(condition.type)} condition.`,
    );
  }
  return Object.entries(params).map(([param, spec]) =>
    paramField(condition, param, spec, raw),
  );
}

// The type select's groups: TYPE_GROUPS, then every condition type no group
// names under "Other", so a new type is never hidden.
export function conditionTypeGroups(types = CONDITION_TYPES) {
  const grouped = new Set(TYPE_GROUPS.flatMap(([, members]) => members));
  const groups = [
    ...TYPE_GROUPS,
    [OTHER_TYPES, types.filter((type) => !grouped.has(type))],
  ];
  return groups
    .map(([label, members]) => ({
      label,
      options: members
        .filter((type) => types.includes(type))
        .map((type) => ({ value: type, text: TYPE_LABELS[type] ?? type })),
    }))
    .filter((group) => group.options.length > 0);
}

const typeGroups = conditionTypeGroups();

export function createRotationBuilder(store, formActions) {
  let uidSeq = 0;
  const nextUid = () => {
    uidSeq += 1;
    return `r${uidSeq}`;
  };
  // A pristine draft per origin, so its uids stay put until the first edit.
  const pristine = new Map();
  let expanded = new Map();
  let selected = null;
  let grab = null;
  let banner = null;
  let addAction = null;
  let open = false;
  let seq = 0;
  let fixes = new Map();
  let jumps = new Map();
  let shownChoice = null;
  let built = null;

  const form = () => store.get().form;
  const choice = () => form().rotationChoice;

  function originName(id) {
    return String(originRotation(id, form().imported).name);
  }
  function originLabel(id) {
    return id === "imported"
      ? `Imported: ${form().imported?.name ?? ""}`
      : originName(id);
  }
  const kindOf = (id) => (id === "imported" ? "import" : "preset");

  function current() {
    const id = choice();
    const draft = form().drafts?.[id];
    if (draft !== undefined) {
      return draft;
    }
    const origin = originRotation(id, form().imported);
    const key = JSON.stringify(origin);
    const cached = pristine.get(id);
    if (cached !== undefined && cached.key === key) {
      return cached.draft;
    }
    const made = draftOf(origin, nextUid);
    pristine.set(id, { key, draft: made });
    return made;
  }
  const isEdited = () => isEditedChoice(form(), choice());

  function messagesOf(state) {
    const formSlice = state.form;
    const errors = formSlice.rotationErrors ?? [];
    // rotationWarnings' list as it is, with no filter of its own, so it is
    // the same list the import box shows (#216's finisher-vs-starves rule).
    const warnings =
      errors.length > 0 ? [] : (formSlice.rotationWarnings ?? []);
    return { errors, warnings };
  }

  function view() {
    const state = store.get();
    const draft = current();
    const rotation = draftRotation(draft);
    const rules = draft.rules;
    const { errors, warnings } = messagesOf(state);
    const talents = talentState(state.config);
    fixes = new Map();
    jumps = new Map();

    const byRule = new Map();
    const top = { name: [], list: [] };
    for (const [kind, list] of [
      ["error", errors],
      ["warning", warnings],
    ]) {
      for (const entry of list) {
        const place = placeOf(entry.path);
        if (place.at === "name" || place.at === "list") {
          top[place.at].push({ kind, entry, place });
          continue;
        }
        if (!byRule.has(place.rule)) {
          byRule.set(place.rule, []);
        }
        byRule.get(place.rule).push({ kind, entry, place });
      }
    }

    const isOpen = (rule, index) =>
      expanded.get(rule.uid) ??
      (byRule.get(index) ?? []).some((m) => m.kind === "error");
    const openIndex = rules.findIndex(
      (rule, index) => rule.uid === selected && isOpen(rule, index),
    );

    const jumpList = (list) => {
      const shown = list.slice(0, MAX_LISTED).map((entry) => {
        const id = `j${jumps.size}`;
        jumps.set(id, entry);
        return { id, label: jumpLabel(entry, rotation) };
      });
      return {
        jumps: shown,
        more:
          list.length > MAX_LISTED
            ? `…and ${list.length - MAX_LISTED} more`
            : null,
      };
    };

    const message = (m, index, rule, k2) => {
      const fix = fixFor(m.entry, index, rotation);
      let fixView = null;
      if (fix !== null) {
        const id = `f${fixes.size}`;
        fixes.set(id, { fix, uid: rule.uid, entry: m.entry });
        fixView = { id, label: fix.label };
      }
      return {
        key: `${rule.uid}.msg.${k2}`,
        kind: m.kind,
        code: m.entry.code,
        path: m.entry.path,
        kindText: m.kind === "error" ? "✕ Error" : "⚠ Check",
        text: entryText(m.entry, rotation),
        fix: fixView,
      };
    };

    const ruleViews = rules.map((rule, index) => {
      const n = index + 1;
      const facts = abilityFacts(rule.action);
      const name = facts.name;
      const msgs = byRule.get(index) ?? [];
      const ruleOpen = isOpen(rule, index);
      const errs = msgs.filter((m) => m.kind === "error");
      const warns = msgs.filter((m) => m.kind === "warning");
      const alt = index > 0 && rules[index - 1].action === rule.action;
      const hint = poolingHint(rule.action);
      const skip = skipOf(rotation.rules[index], talents);
      const taken =
        skip === null ? takenOf(rotation.rules[index], talents) : null;
      const isSelected = rule.uid === selected && ruleOpen;
      const grabbed = grab?.uid === rule.uid;
      const chips = [{ kind: "hint", mark: "", text: hint.chip }];
      if (alt) {
        chips.push({
          kind: "alt",
          mark: "",
          text: `Alternative to rule ${index}`,
        });
      }
      if (isSelected) {
        chips.push({
          kind: "sel",
          mark: "",
          text: "Selected: new rules go above",
        });
      }
      if (skip !== null) {
        chips.push({ kind: "skip", mark: "⊘ ", text: `Skipped: ${skip.text}` });
      } else if (taken !== null) {
        chips.push({
          kind: "ok",
          mark: "◆ ",
          text: `${taken.talent} talent taken`,
        });
      }
      if (errs.length > 0) {
        chips.push({
          kind: "error",
          mark: "✕ ",
          text: count(errs.length, "error"),
        });
      }
      if (warns.length > 0) {
        chips.push({
          kind: "warning",
          mark: "⚠ ",
          text: `${warns.length} to check`,
        });
      }
      const keyed = msgs.map((m, k2) => ({ ...m, k2 }));
      const cardMsgs = keyed
        .filter(
          (m) =>
            m.place.at === "rule" ||
            m.place.at === "conditions" ||
            (!ruleOpen &&
              (m.place.at === "condition" || m.place.at === "action")),
        )
        .map((m) => message(m, index, rule, m.k2));
      let body = null;
      if (ruleOpen) {
        const conditionCount = rule.conditions.length;
        const full = conditionCount >= MAX_CONDITIONS;
        body = {
          actionLabel: `Rule ${n} casts`,
          action: rule.action,
          actionGroups: abilityGroups(castableAbilities()),
          actionErrors: keyed
            .filter((m) => m.place.at === "action")
            .map((m) => entryText(m.entry, rotation)),
          hint: hint.long,
          conditionsHead:
            conditionCount > 0
              ? "When all of these hold"
              : "Always (no conditions)",
          conditionsCount: near(conditionCount, MAX_CONDITIONS)
            ? `${conditionCount} of ${MAX_CONDITIONS} conditions`
            : null,
          conditionsLabel: `Conditions of rule ${n}, all must hold`,
          conditions: rule.conditions.map((condition, j) => {
            const m = j + 1;
            const own = keyed.filter(
              (x) => x.place.at === "condition" && x.place.condition === j,
            );
            const badParams = new Set(
              own.map((x) => x.entry.param ?? x.place.param ?? "type"),
            );
            return {
              uid: condition.uid,
              and: j === 0 ? "if" : "and",
              type: condition.type,
              typeLabel: `Rule ${n}, condition ${m}, type`,
              typeGroups,
              note: TYPE_NOTES[condition.type] ?? null,
              fields: conditionFields(condition, draft.raw ?? {}).map(
                (field) => ({
                  ...field,
                  label: `Rule ${n}, condition ${m}, ${field.label}`,
                  invalid: badParams.has(field.param),
                }),
              ),
              typeInvalid:
                badParams.has("type") ||
                [...badParams].some(
                  (param) =>
                    !Object.hasOwn(
                      CONDITION_PARAMS[condition.type] ?? {},
                      param,
                    ),
                ),
              errors: own.map((x) => entryText(x.entry, rotation)),
              removeLabel: `Remove rule ${n}, condition ${m}: ${conditionLine(condition)}`,
            };
          }),
          addCondition: {
            label: `Add condition to rule ${n}`,
            disabled: full,
            why: full
              ? `${MAX_CONDITIONS} of ${MAX_CONDITIONS}: remove one to add another.`
              : null,
          },
        };
      }
      return {
        uid: rule.uid,
        n,
        name,
        icon: spellIconUrl(name),
        line: ruleLine(rule),
        chips,
        open: ruleOpen,
        selected: isSelected,
        lifted: grabbed,
        skipped: skip !== null,
        alt,
        state: errs.length > 0 ? "error" : warns.length > 0 ? "warning" : null,
        grip: { label: `Reorder rule ${n}, ${name}`, pressed: grabbed },
        up: { label: `Move rule ${n}, ${name}, up`, disabled: index === 0 },
        down: {
          label: `Move rule ${n}, ${name}, down`,
          disabled: index === rules.length - 1,
        },
        messages: cardMsgs,
        edit: {
          text: ruleOpen ? "Done" : "Edit conditions",
          label: `${ruleOpen ? "Done editing" : "Edit conditions of"} rule ${n}, ${name}`,
        },
        duplicate: {
          label: `Duplicate as alternative: rule ${n}, ${name}`,
          disabled: rules.length >= MAX_RULES,
        },
        remove: { label: `Delete rule ${n}, ${name}` },
        body,
      };
    });

    const edited = isEdited();
    const id = choice();
    const kind = kindOf(id);
    const skipped = rotation.rules
      .map((rule, index) => [skipOf(rule, talents), index])
      .filter(([skip]) => skip !== null);
    const anyTalent = rules.some((rule) => abilityFacts(rule.action).talent);
    const context = `${
      skipped.length > 0
        ? `${count(skipped.length, "rule")} ${skipped.length === 1 ? "is" : "are"} skipped with this build (${skipped.map(([, index]) => `rule ${index + 1}`).join(", ")}).`
        : anyTalent
          ? "Every talent ability in the list has its talent."
          : "No rule needs a talent."
    } `;
    if (addAction === null || !castableAbilities().includes(addAction)) {
      addAction = defaultAddAction(rules);
    }
    const fullRules = rules.length >= MAX_RULES;
    const limitText = `${MAX_RULES} of ${MAX_RULES} rules: delete one to add another.`;
    const nameLength = draft.name.length;
    const errorsList = jumpList(errors);
    const warningsList = jumpList(warnings);
    return {
      open,
      toggle: open ? "Close rotation builder" : "Edit rotation…",
      origin: edited
        ? {
            edited: true,
            mark: "Edited",
            text: `Your edits to ${originLabel(id)} are kept for this session: pick another rotation and come back, and they're still here. Reloading the page drops them (Export… saves a file). `,
            revert: `Revert to ${kind}`,
          }
        : {
            edited: false,
            text: `Editing ${originLabel(id)}. Your first change starts an edited copy for this session; the ${kind} itself never changes.`,
          },
      name: {
        value: draft.name,
        max: String(MAX_NAME),
        count: near(nameLength, MAX_NAME)
          ? `${nameLength} of ${MAX_NAME} characters`
          : null,
        error:
          top.name.length > 0 ? entryText(top.name[0].entry, rotation) : null,
      },
      context: {
        label: "Talents: ",
        build: `${talentLabel(state.config.talents ?? {}, state.config.talentLevel)}. `,
        text: context,
        button: "Edit talents",
      },
      help: HELP,
      gripHelp: GRIP_HELP,
      clearDisabled: rules.length === 0,
      banner:
        banner === null
          ? null
          : { text: `${banner.text} `, undo: banner.undo !== undefined },
      errors:
        errors.length > 0
          ? {
              count: `${count(errors.length, "error")}. `,
              text: STALE_BANNER,
              ...errorsList,
            }
          : null,
      warnings:
        errors.length === 0 && warnings.length > 0
          ? {
              count: `${WARNINGS_SUMMARY}: ${count(warnings.length, "warning")}. `,
              text: "It still runs; see the warnings below.",
              ...warningsList,
            }
          : null,
      listHead: "Rules, highest priority first",
      ruleCount: near(rules.length, MAX_RULES)
        ? `${rules.length} of ${MAX_RULES} rules`
        : count(rules.length, "rule"),
      empty: rules.length === 0 ? EMPTY : null,
      listMessages: top.list.map((m) => ({
        kind: m.kind,
        code: m.entry.code,
        path: m.entry.path,
        kindText: m.kind === "error" ? "✕ Error" : "⚠ Check",
        text: entryText(m.entry, rotation),
      })),
      rules: ruleViews,
      add: {
        label: "New rule casts",
        groups: abilityGroups(castableAbilities()),
        value: addAction,
        button: "Add rule",
        disabled: fullRules,
        note: `${
          openIndex < 0
            ? "It goes at the bottom"
            : `It goes above rule ${openIndex + 1}, ${nameOf(rules[openIndex].action)} (the rule you're editing)`
        }, with the checks its ability needs (talent, cooldown, combo points) already added.`,
        why: fullRules ? limitText : null,
      },
    };
  }

  function slice() {
    return store.get().rotationBuilder ?? {};
  }

  function refresh(extra = {}) {
    const state = store.get();
    built = { form: state.form, config: state.config };
    store.set({ rotationBuilder: { ...slice(), ...extra, view: view() } });
  }

  function say(text) {
    seq += 1;
    return { announce: { text, seq } };
  }
  function focusOn(key) {
    seq += 1;
    return { focus: { key, seq } };
  }

  // What a keyboard drop says (Space, Enter or Tab).
  const dropText = (name, at, from, total) =>
    at === from
      ? `${name} dropped back at rule ${at + 1}.`
      : `${name} dropped at rule ${at + 1} of ${total}.`;

  function errorTotal() {
    return (form().rotationErrors ?? []).length;
  }

  // One edit of the draft. `change(draft)` returns the new draft. The first
  // edit of an origin starts its session copy, renamed "<name> (edited)"
  // unless the edit is the name itself.
  function edit(
    change,
    { live = null, focus = null, keepBanner = false, rename = true } = {},
  ) {
    const id = choice();
    const before = current();
    const wasEdited = isEdited();
    const errorsBefore = errorTotal();
    let next = change(before);
    if (!wasEdited && rename && next.name === originName(id)) {
      next = { ...next, name: editedName(next.name) };
    }
    if (!keepBanner) {
      banner = null;
    }
    store.batch(() => {
      formActions.setDraft(id, next);
      let text = live;
      const errorsAfter = errorTotal();
      if (errorsBefore > 0 && errorsAfter === 0) {
        const warnings = (form().rotationWarnings ?? []).length;
        const left = `No errors left.${warnings > 0 ? ` ${count(warnings, "thing")} to check, listed above the rules.` : ""}`;
        text = text === null ? left : `${text} ${left}`;
      }
      refresh({
        ...(text === null ? {} : say(text)),
        ...(focus === null ? {} : focusOn(focus)),
      });
    });
  }

  const indexOf = (uid) =>
    current().rules.findIndex((rule) => rule.uid === uid);
  const ruleOf = (uid) => current().rules[indexOf(uid)];
  const withRule = (uid, change) => (draft) => ({
    ...draft,
    rules: draft.rules.map((rule) => (rule.uid === uid ? change(rule) : rule)),
  });
  const conditionIndex = (rule, cuid) =>
    rule.conditions.findIndex((condition) => condition.uid === cuid);

  function show(extra = {}) {
    refresh(extra);
  }

  function moveTo(uid, to, live, focus) {
    const from = indexOf(uid);
    edit((draft) => ({ ...draft, rules: moveRule(draft.rules, from, to) }), {
      live,
      focus,
    });
  }

  function focusKeyFor(entry) {
    const place = placeOf(entry.path);
    if (place.at === "name") {
      return "name";
    }
    if (place.at === "list") {
      return "add-action";
    }
    const rule = current().rules[place.rule];
    if (rule === undefined) {
      return "add-action";
    }
    if (place.at === "condition") {
      const condition = rule.conditions[place.condition];
      if (condition === undefined) {
        return `${rule.uid}.addcond`;
      }
      const params = CONDITION_PARAMS[condition.type] ?? {};
      const param = entry.param ?? place.param;
      return param !== null &&
        param !== undefined &&
        Object.hasOwn(params, param)
        ? `${condition.uid}.${param}`
        : `${condition.uid}.type`;
    }
    if (place.at === "action") {
      return `${rule.uid}.action`;
    }
    return null;
  }

  function jumpTo(entry) {
    open = true;
    const place = placeOf(entry.path);
    const rule =
      place.rule === undefined ? undefined : current().rules[place.rule];
    let key = focusKeyFor(entry);
    if (rule !== undefined) {
      expanded.set(rule.uid, true);
    }
    if (key === null) {
      refresh();
      // Matched on the entry's code and path, never its wording.
      const msg = slice().view.rules[place.rule].messages.find(
        (m) => m.code === entry.code && m.path === entry.path,
      );
      key = msg?.key ?? `${rule.uid}.edit`;
    }
    refresh(focusOn(key));
  }

  const actions = {
    toggle() {
      open = !open;
      show(focusOn("toggle"));
    },
    setName(text) {
      edit((draft) => ({ ...draft, name: String(text) }), { rename: false });
    },
    clearAll() {
      const rules = current().rules;
      if (rules.length === 0) {
        show(say("There are no rules to clear."));
        return;
      }
      const restore = form().drafts?.[choice()] ?? null;
      const n = rules.length;
      // The banner is set before the edit, as revert() does, so its Undo
      // exists when the focus asks for it.
      banner = {
        text: `${count(n, "rule")} cleared.`,
        undo: restore,
        back: "clear",
      };
      edit((draft) => ({ ...draft, rules: [], raw: {} }), {
        live: `All ${n} rules cleared. Undo is in the message above the list.`,
        focus: "undo",
        keepBanner: true,
      });
    },
    undo() {
      if (banner === null || banner.undo === undefined) {
        return;
      }
      const { undo, back } = banner;
      banner = null;
      store.batch(() => {
        formActions.setDraft(choice(), undo);
        refresh({ ...say("Undone."), ...focusOn(back) });
      });
    },
    revert() {
      const id = choice();
      const restore = form().drafts?.[id] ?? null;
      expanded = new Map();
      selected = null;
      grab = null;
      store.batch(() => {
        formActions.setDraft(id, null);
        banner = {
          text: `Back to the ${originLabel(id)} ${kindOf(id)}; your edits are gone.`,
          undo: restore,
          back: "revert",
        };
        refresh({
          ...say(
            `${originLabel(id)} reverted. Undo is in the message above the list.`,
          ),
          ...focusOn("undo"),
        });
      });
    },
    fix(fixId) {
      const found = fixes.get(fixId);
      if (found === undefined) {
        return;
      }
      const { fix, uid } = found;
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      if (rule === undefined) {
        return;
      }
      const n = at + 1;
      if (fix.add !== undefined) {
        const condition = { ...fix.add, uid: nextUid() };
        expanded.set(uid, true);
        edit(
          withRule(uid, (r) =>
            addCondition(r, condition, fix.at ?? r.conditions.length),
          ),
          {
            live: `Added "${summarizeCondition(fix.add)}" to rule ${n}, ${nameOf(rule.action)}.`,
            focus: `${condition.uid}.type`,
          },
        );
      } else if (fix.set !== undefined) {
        const target = rule.conditions[fix.condition];
        expanded.set(uid, true);
        edit(
          (draft) => {
            const raw = { ...draft.raw };
            delete raw[target.uid];
            return withRule(uid, (r) =>
              replaceCondition(r, fix.condition, {
                ...fix.set,
                uid: target.uid,
              }),
            )({ ...draft, raw });
          },
          {
            live: `Rule ${n}, condition ${fix.condition + 1}: ${summarizeCondition(fix.set)}.`,
            focus: `${target.uid}.value`,
          },
        );
      } else if (fix.remove) {
        actions.remove(uid);
      } else if (fix.moveTo !== undefined) {
        moveTo(
          uid,
          fix.moveTo,
          `${nameOf(rule.action)} moved to rule ${fix.moveTo + 1} of ${current().rules.length}.`,
          `${uid}.grip`,
        );
      }
    },
    jump(jumpId) {
      const entry = jumps.get(jumpId);
      if (entry !== undefined) {
        jumpTo(entry);
      }
    },
    // The Run bar's "Fix 1 setting" (D19): open the builder at the first error.
    jumpToFirstError() {
      const [first] = form().rotationErrors ?? [];
      open = true;
      if (first === undefined) {
        show(focusOn("toggle"));
        return;
      }
      jumpTo(first);
    },
    move(uid, direction) {
      const at = indexOf(uid);
      const rules = current().rules;
      const name = nameOf(rules[at].action);
      const which = direction < 0 ? "up" : "down";
      const to = at + direction;
      if (to < 0) {
        show(say(`${name} is already rule 1, the top.`));
        return;
      }
      if (to >= rules.length) {
        show(say(`${name} is already rule ${rules.length}, the bottom.`));
        return;
      }
      moveTo(
        uid,
        to,
        `${name} moved ${which} to rule ${to + 1} of ${rules.length}.`,
        `${uid}.${which}`,
      );
    },
    // A key on a rule's grip (section 2). True when the key was used.
    gripKey(uid, key) {
      const at = indexOf(uid);
      const rules = current().rules;
      if (at < 0) {
        return false;
      }
      const name = nameOf(rules[at].action);
      if (key === " " || key === "Enter") {
        if (grab === null) {
          grab = { uid, from: at, before: form().drafts?.[choice()] ?? null };
          show({
            ...say(
              `Picked up ${name}, rule ${at + 1} of ${rules.length}. Up and down arrows move it, Space drops it, Escape cancels.`,
            ),
            ...focusOn(`${uid}.grip`),
          });
        } else {
          const from = grab.from;
          grab = null;
          show({
            ...say(dropText(name, at, from, rules.length)),
            ...focusOn(`${uid}.grip`),
          });
        }
        return true;
      }
      if (grab !== null && (key === "ArrowUp" || key === "ArrowDown")) {
        const to = at + (key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= rules.length) {
          show(say(to < 0 ? "Top of the list." : "Bottom of the list."));
          return true;
        }
        moveTo(uid, to, `Rule ${to + 1} of ${rules.length}.`, `${uid}.grip`);
        return true;
      }
      if (grab !== null && key === "Escape") {
        const { from, before } = grab;
        grab = null;
        store.batch(() => {
          formActions.setDraft(choice(), before);
          refresh({
            ...say(`Move cancelled. ${name} is back at rule ${from + 1}.`),
            ...focusOn(`${uid}.grip`),
          });
        });
        return true;
      }
      if (grab !== null && key === "Tab") {
        // Tabbing away drops it where it is, and says so as Space does; the
        // browser moves the focus on.
        const from = grab.from;
        grab = null;
        show(say(dropText(name, at, from, rules.length)));
      }
      return false;
    },
    // A pointer drop (section 2): `target` is the card index the drop line
    // was above, or the number of cards for the bottom.
    dragTo(uid, target) {
      const at = indexOf(uid);
      if (at < 0) {
        return;
      }
      const to = target > at ? target - 1 : target;
      const rules = current().rules;
      const name = nameOf(rules[at].action);
      if (to === at) {
        show(say(`${name} stays at rule ${at + 1}.`));
        return;
      }
      moveTo(
        uid,
        to,
        `${name} moved to rule ${to + 1} of ${rules.length}.`,
        `${uid}.grip`,
      );
    },
    toggleRule(uid) {
      const at = indexOf(uid);
      const shown = slice().view?.rules?.[at]?.open ?? false;
      if (shown) {
        expanded.set(uid, false);
        if (selected === uid) {
          selected = null;
        }
      } else {
        expanded.set(uid, true);
        selected = uid;
      }
      show(focusOn(`${uid}.edit`));
    },
    duplicate(uid) {
      const at = indexOf(uid);
      const rules = current().rules;
      if (rules.length >= MAX_RULES) {
        show(
          say(`${MAX_RULES} of ${MAX_RULES} rules: delete one to add another.`),
        );
        return;
      }
      const n = at + 1;
      const name = nameOf(rules[at].action);
      const next = duplicateRule(rules, at, nextUid);
      const made = next[at + 1];
      expanded.set(made.uid, true);
      selected = made.uid;
      edit(
        (draft) => ({
          ...draft,
          rules: next,
          raw: copyRawText(draft.raw ?? {}, rules[at], made),
        }),
        {
          live: `Rule ${n + 1} added: a copy of rule ${n}, ${name}, right below it. It is never reached until you change its conditions: it's tried when rule ${n}'s don't all hold.`,
          focus:
            made.conditions.length > 0
              ? `${made.conditions[0].uid}.type`
              : `${made.uid}.addcond`,
        },
      );
    },
    remove(uid) {
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      if (rule === undefined) {
        return;
      }
      const restore = form().drafts?.[choice()] ?? null;
      const line = ruleLine(rule);
      if (selected === uid) {
        selected = null;
      }
      // The banner first, so its Undo exists when the focus asks for it.
      banner = {
        text: `Rule ${at + 1} deleted: ${line}.`,
        undo: restore,
        back: `${uid}.del`,
      };
      edit(
        (draft) => ({
          ...draft,
          rules: removeRule(draft.rules, at),
          raw: dropRawText(draft.raw ?? {}, rule),
        }),
        {
          live: `Rule ${at + 1} deleted: ${line}. Undo is in the message above the list.`,
          focus: "undo",
          keepBanner: true,
        },
      );
    },
    setAction(uid, action) {
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      if (rule === undefined || rule.action === action) {
        return;
      }
      const { rule: next, added } = retarget(rule, action, nextUid);
      const name = nameOf(action);
      edit(
        withRule(uid, () => next),
        {
          live: `Rule ${at + 1} now casts ${name}.${added === null ? "" : ` Added "${summarizeCondition({ type: added.type, ability: added.ability })}": it comes from a talent.`}`,
          focus: `${uid}.action`,
        },
      );
    },
    setConditionType(uid, cuid, type) {
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      const j = conditionIndex(rule, cuid);
      if (j < 0 || rule.conditions[j].type === type) {
        return;
      }
      const condition = { ...defaultCondition(type, rule.action), uid: cuid };
      edit(
        (draft) => {
          const raw = { ...draft.raw };
          delete raw[cuid];
          return withRule(uid, (r) => replaceCondition(r, j, condition))({
            ...draft,
            raw,
          });
        },
        {
          live: `Rule ${at + 1}, condition ${j + 1}: ${conditionLine(condition)}.`,
          focus: `${cuid}.type`,
        },
      );
    },
    setParam(uid, cuid, param, text) {
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      const j = conditionIndex(rule, cuid);
      if (j < 0) {
        return;
      }
      const condition = withParam(rule.conditions[j], param, text);
      if (param === "value") {
        edit((draft) =>
          withRule(uid, (r) => replaceCondition(r, j, condition))({
            ...draft,
            raw: { ...draft.raw, [cuid]: String(text) },
          }),
        );
        return;
      }
      edit(
        withRule(uid, (r) => replaceCondition(r, j, condition)),
        {
          live: `Rule ${at + 1}, condition ${j + 1}: ${conditionLine(condition)}.`,
        },
      );
    },
    removeCondition(uid, cuid) {
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      const j = conditionIndex(rule, cuid);
      if (j < 0) {
        return;
      }
      const next = rule.conditions[j + 1] ?? rule.conditions[j - 1];
      edit(
        (draft) => {
          const raw = { ...draft.raw };
          delete raw[cuid];
          return withRule(uid, (r) => removeCondition(r, j))({ ...draft, raw });
        },
        {
          live: `Condition ${j + 1} removed from rule ${at + 1}.`,
          focus: next === undefined ? `${uid}.addcond` : `${next.uid}.rm`,
        },
      );
    },
    addCondition(uid) {
      const at = indexOf(uid);
      const rule = ruleOf(uid);
      if (rule === undefined) {
        return;
      }
      if (rule.conditions.length >= MAX_CONDITIONS) {
        show(
          say(
            `${MAX_CONDITIONS} of ${MAX_CONDITIONS} conditions: remove one to add another.`,
          ),
        );
        return;
      }
      const condition = {
        ...defaultCondition(nextConditionType(rule), rule.action),
        uid: nextUid(),
      };
      edit(
        withRule(uid, (r) => addCondition(r, condition)),
        {
          live: `Condition ${rule.conditions.length + 1} added to rule ${at + 1}: ${conditionLine(condition)}.`,
          focus: `${condition.uid}.type`,
        },
      );
    },
    setAddAction(action) {
      addAction = action;
      show();
    },
    addRule() {
      const rules = current().rules;
      if (rules.length >= MAX_RULES) {
        show(
          say(`${MAX_RULES} of ${MAX_RULES} rules: delete one to add another.`),
        );
        return;
      }
      const rule = newRule(addAction ?? defaultAddAction(rules), nextUid);
      const view0 = slice().view;
      const at = rules.findIndex(
        (r, index) =>
          r.uid === selected && (view0?.rules?.[index]?.open ?? false),
      );
      const line = ruleLine(rule);
      const live =
        at < 0
          ? `Rule ${rules.length + 1} added at the bottom: ${line}. Move it up to give it priority.`
          : `Rule ${at + 1} added above ${nameOf(rules[at].action)}, now rule ${at + TWO}: ${line}.`;
      expanded.set(rule.uid, true);
      selected = rule.uid;
      edit(
        (draft) => ({
          ...draft,
          rules: insertRule(
            draft.rules,
            at < 0 ? draft.rules.length : at,
            rule,
          ),
        }),
        { live, focus: `${rule.uid}.up` },
      );
    },
  };

  // Another origin picked, a new import, a talent change or a config the
  // form put back: the view follows. A switch to an edited origin says so.
  store.subscribe(({ state, changed }) => {
    if (!changed.includes("form") && !changed.includes("config")) {
      return;
    }
    if (
      built !== null &&
      built.form === state.form &&
      built.config === state.config
    ) {
      return;
    }
    const id = state.form.rotationChoice;
    let extra = {};
    if (id !== shownChoice) {
      const first = shownChoice === null;
      shownChoice = id;
      expanded = new Map();
      selected = null;
      grab = null;
      banner = null;
      addAction = null;
      if (!first && open) {
        extra = say(
          isEdited()
            ? `Rotation: ${originLabel(id)}, with your edits from this session. Revert to ${kindOf(id)} is in the builder.`
            : `Rotation: ${originLabel(id)}.`,
        );
      }
    }
    refresh(extra);
  });

  shownChoice = choice();
  refresh({ announce: { text: "", seq: 0 }, focus: { key: null, seq: 0 } });
  return actions;
}
