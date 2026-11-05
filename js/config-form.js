import { k } from "../data/constants.js";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import { defaultWeaponSkill, maxWeaponSkill } from "./attack-resolver.js";
import { characterLevel } from "./levels.js";
import { defaultRotation } from "./rotation-default.js";
import { exportRotation, importRotation } from "./rotation-io.js";
import { poisonCatalogue } from "./poisons.js";
import { raceCatalogue, racialStatus } from "./racials.js";
import {
  listPresets,
  presetRotation,
  referenceBuild,
} from "./rotation-presets.js";
import { placeText } from "./rotation-builder-copy.js";
import { draftRotation } from "./rotation-edit.js";
import { skipOf, talentState } from "./rotation-skips.js";
import { summarizeRule } from "./rotation-summary.js";
import { validateRotation } from "./rotation-validator.js";
import { rotationWarnings, sameRuleKey } from "./rotation-warnings.js";
import { defaultConfig, normalizeConfig } from "./sim-config.js";
import { formErrorCount } from "./views/run-model.js";

// The stats form's model (Phase 3, #151, roadmap task U2): everything the
// "Fight setup" form does except drawing it. No DOM, no clock, so it runs and
// is tested in Node like the engine. js/main.js makes one with the page's store
// and hands its actions to the view (js/views/config-form.js), which may not
// import the engine (#150): the view draws the `form` slice and calls these
// actions; the actions write the `form` and `config` slices.
//
// One source of truth for the rotation (Scout, 29 Oct): config.rotation. The
// store has no separate `rotation` slice; the form's rotation choice writes
// config.rotation like any other field.
//
// The `form` slice:
//
//   values          { field path: value } in config units: chances 0 to 1, not
//                   percent (the view converts at its edge), damage, speed and
//                   attack power as numbers, weapon types and poisons as ids
//                   (a poison is null for None). A value the player typed
//                   that is not a number is NaN. Weapon skill and the target
//                   level (#318) are null while blank: they follow the
//                   level (OPTIONAL_FIELDS).
//   levels          levelsInfo() of the config's level: what a blank weapon
//                   skill or target level is, and their bounds, for the view
//                   to show (#318).
//   errors          { field path: message } for each field that is invalid
//                   now. A message of null marks a field invalid with its
//                   message on another field (the Min of a Min/Max pair).
//                   FORM_ERROR is the normalizeConfig backstop's message.
//                   js/views/run-model.js formErrorCount is the one count of
//                   them (#237): one per message, FORM_ERROR included.
//   rotationChoice  "default", a preset id, or "imported": the origin the
//                   rotation comes from, tracked as an id (U7 D20, #217).
//   imported        { name, rotation } of the last imported rotation, or null.
//   drafts          { origin: draft } the rotation builder's session drafts
//                   (#217, D10 and D20): one per origin that was edited, each
//                   a js/rotation-edit.js draft plus `lastValid`, the last
//                   valid rotation it was (null until it has been valid).
//                   Nothing persists across reloads (#186).
//   rotationErrors  validateRotation's entries for the selected rotation (its
//                   draft when it has one). While there are any, config keeps
//                   the last valid version (D19) and Run is off (D17).
//   rotationWarnings rotationWarnings' entries for it ([] while it has errors).
//   exportOff       null, or why Export is off while there are rotation
//                   errors ("Export is off: the rotation has N errors.", D17).
//   importStatus    null, or { ok, message, detail, warnings } from the last
//                   import. `detail` is the errors of a refused file and
//                   `warnings` the warnings of an accepted one (issue #189),
//                   one per line; each is "" when there are none.
//   rotationOptions [{ id, label }] for the rotation select.
//   summary         { name, rules: [text], stale } of the rotation the sim
//                   uses: the selected one, or its last valid version while
//                   its draft has errors (stale is then the note, else null).
//                   A rule the build skips ends "— skipped: no X talent" (D9),
//                   or "— skipped with no talents" with none picked (#234);
//                   one no talent lifts says so with any build (#244).
//   poisonOptions   { simulated, notSimulated: [{ id, label }] } for the two
//                   poison selects (#152); id is the config id ("instant").
//   poisons         { mainHand, offHand }: poisonInfo() of each hand's poison,
//                   or null for None.
//   raceOptions     [{ faction, races: [{ id, label }] }] for the Race select
//                   (#321), faction by faction as js/racials.js lists them.
//   race            raceInfo() of config.race: its racials and how each
//                   stands in the fight, or null for no race.
//   revision        Moves when the values change other than by typing (fill,
//                   Reset, Undo), so the view rewrites its inputs.
//   canUndo         Reset was the last action, and Undo puts the form back.
//
// `config` holds the last valid config, in full form (normalizeConfig). It is
// written only when `errors` is empty, so an invalid edit never reaches it.
// Changes apply to the next run: nextRunConfig() is what #153's Run starts.
// The form never touches the fight length (#153's control bar owns it).

export const FORM_ERROR = "form";

const HANDS = ["mainHand", "offHand"];
// The fields a blank leaves to follow the level (#318): null in the config
// and the form while blank.
export const OPTIONAL_FIELDS = Object.freeze([
  "character.weaponSkill",
  "target.level",
]);
// The lowest weapon skill the engine takes (js/sim-config.js
// CHARACTER_LIMITS.weaponSkill; test/config-form.test.js holds them to it).
export const MIN_WEAPON_SKILL = 1;
const PERCENT_MESSAGE = "Enter a percentage from 0 to 100.";
const NUMBER_MESSAGE = "Enter a number.";
const WHOLE_MESSAGE = "Use a whole number, 0 or more.";

// What a blank weapon skill and target level are at a config's level, and
// their bounds (#318; the engine's: js/attack-resolver.js defaultWeaponSkill
// and maxWeaponSkill, js/levels.js targetLevel, target.levelRange).
export function levelsInfo(level = k("character.level")) {
  const { min, max } = k("target.levelRange");
  return {
    level,
    weaponSkill: {
      blank: defaultWeaponSkill(level),
      perLevel: k("attackTable.weaponSkill").perLevel,
      min: MIN_WEAPON_SKILL,
      max: maxWeaponSkill(level),
    },
    targetLevel: {
      blank: Math.min(max, level + k("target.levelAboveCharacter")),
      above: k("target.levelAboveCharacter"),
      // The raid boss's level (target.level, 63: OQ4), for the help to
      // name it only when blank gives it (Fran's qa-319 D-P1).
      boss: k("target.level"),
      min,
      max,
    },
  };
}

const isWholeIn = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;

// A field blank is null: fine, it follows the level. Text that is not a
// number is NaN.
function optionalCheck(rangeMessage, inRange) {
  return (value, values, levels) => {
    if (value === null) {
      return "";
    }
    if (typeof value !== "number" || Number.isNaN(value)) {
      return `Enter a number, or leave it blank.`;
    }
    return inRange(value, levels) ? "" : rangeMessage(levels);
  };
}

// Every field the form edits, in page order, with its check. A check gets the
// value, all values and levelsInfo() of the config's level, and returns a
// message, or "" when the value is fine.
function numberCheck(rangeMessage, inRange) {
  return (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return NUMBER_MESSAGE;
    }
    return Number.isFinite(value) && inRange(value) ? "" : rangeMessage;
  };
}
const chance = numberCheck(
  PERCENT_MESSAGE,
  (value) => value >= 0 && value <= 1,
);
const whole = numberCheck(
  WHOLE_MESSAGE,
  (value) => value >= 0 && Number.isInteger(value),
);

function weaponFields(hand) {
  const path = `weapons.${hand}`;
  return [
    {
      path: `${path}.type`,
      check: (value) =>
        k("config.weaponTypes").includes(value) ? "" : "Choose a weapon type.",
    },
    { path: `${path}.min`, check: whole },
    {
      path: `${path}.max`,
      check: (value, values) => {
        const own = whole(value);
        const min = values[`${path}.min`];
        if (own !== "" || whole(min) !== "" || value >= min) {
          return own;
        }
        return `Max damage must be at least the min damage (${min}).`;
      },
    },
    {
      path: `${path}.speed`,
      check: numberCheck(
        `Speed must be at least ${k("config.minWeaponSpeed")} s.`,
        (value) => value >= k("config.minWeaponSpeed"),
      ),
    },
  ];
}

export const FORM_FIELDS = Object.freeze(
  [
    // The race (#321): a race id from js/racials.js, or null for none. A
    // select cannot hold anything else, so this only catches a value set
    // from outside the page.
    {
      path: "race",
      check: (value) =>
        value === null || raceCatalogue.get(value) !== undefined
          ? ""
          : "Choose a race.",
    },
    {
      path: "character.attackPower",
      check: numberCheck(
        "Attack power can't be negative.",
        (value) => value >= 0,
      ),
    },
    { path: "character.critChance", check: chance },
    { path: "character.bonusHitChance", check: chance },
    // A fraction of attack speed, entered as a percent like the chances
    // (#274): Classic haste, attacks only.
    { path: "character.haste", check: chance },
    // Blank is level x 5; at most level x 5 + 50, the engine's cap (#318).
    {
      path: "character.weaponSkill",
      check: optionalCheck(
        ({ level, weaponSkill: { min, max } }) =>
          `Weapon skill must be a whole number from ${min} to ${max} at level ${level}.`,
        (value, { weaponSkill: { min, max } }) => isWholeIn(value, min, max),
      ),
    },
    // Blank is your level + 3 (#318).
    {
      path: "target.level",
      check: optionalCheck(
        ({ targetLevel: { min, max } }) =>
          `Target level must be a whole number from ${min} to ${max}.`,
        (value, { targetLevel: { min, max } }) => isWholeIn(value, min, max),
      ),
    },
    ...HANDS.flatMap(weaponFields),
    // The poison selects (#152). A select cannot hold anything else, so this
    // only catches a value set from outside the page.
    ...HANDS.map((hand) => ({
      path: `poisons.${hand}`,
      check: (value) =>
        value === null || k("config.poisonIds").includes(value)
          ? ""
          : "Choose a poison.",
    })),
  ].map(Object.freeze),
);

const FIELD_PATHS = FORM_FIELDS.map(({ path }) => path);

// The Min of a pair whose Max says "at least the min damage" is invalid too,
// with its message on the Max (Fran's notes, section 3).
function pairedMin(path) {
  return path.endsWith(".max") ? path.replace(/\.max$/, ".min") : null;
}

// The config the page starts with and Reset restores: James's temporary
// Combat swords preset (TR-03 / #333) — talents, weapons, Instant MH / Deadly
// OH poisons, and its rotation. Race is left unset (the preset does not set
// one). The engine's defaultConfig() keeps empty talents and no poisons so
// engine goldens that omit a config stay put.
export function pageDefaultConfig() {
  const build = referenceBuild("combat-swords-temp");
  return fromBehind({
    ...defaultConfig(),
    talents: { ...build.talents },
    talentLevel: build.talentLevel,
    weapons: {
      mainHand: { ...build.weapons.mainHand },
      offHand: { ...build.weapons.offHand },
    },
    poisons: { ...build.poisons },
    rotation: presetRotation("combat-swords-temp"),
  });
}

// The sim is built for attacking from behind (docs/mechanics.md, "Scope:
// behind only"; James's ruling on Fran's qa-256): every config the page
// builds or runs has target.behind true, whatever it was given (a stored or
// imported false too), with no message. The page has no control for it.
export function fromBehind(config) {
  if (config?.target?.behind === true) {
    return config;
  }
  return { ...config, target: { ...config?.target, behind: true } };
}

// A poison or race select's value: its config id, "" for None. The config id is the
// catalogue's `key` ("instant"), not its `id` ("instant-poison").
function controlValue(path, value) {
  return ((path.startsWith("poisons.") || path === "race") && value === "") ||
    (OPTIONAL_FIELDS.includes(path) && (value === "" || value === undefined))
    ? null
    : value;
}

const optionOf = ({ key, name }) => ({ id: key, label: name });

// The poison choices, from the catalogue: the simulated ones, then the rest.
export function poisonOptions(catalogue = poisonCatalogue) {
  return {
    simulated: catalogue.dps.map(optionOf),
    notSimulated: catalogue.noOps.map(optionOf),
  };
}

// What the form shows under a hand's poison select, from the rank the engine
// simulates (always the catalogue's top rank; the rank is read-only), or null
// for None. The view words it; this gives the numbers.
export function poisonInfo(key, catalogue = poisonCatalogue) {
  if (key === null || key === undefined) {
    return null;
  }
  const poison = catalogue.byKey(key);
  if (poison === undefined) {
    return null;
  }
  const { rank, chance, effect, charges, text } = poison.top;
  return {
    name: poison.name,
    rank,
    highest: rank === poison.ranks.length,
    chance,
    effect: { ...effect },
    charges,
    simulated: poison.dps,
    noDpsReason: poison.noDpsReason,
    text,
  };
}

// The Race select's choices (#321), from the race catalogue: one group per
// faction, in its order. The view adds "None (no racials)" first.
export function raceOptions(catalogue = raceCatalogue) {
  const groups = [];
  for (const { id, name, faction } of catalogue.races) {
    let group = groups.find((entry) => entry.faction === faction);
    if (group === undefined) {
      group = { faction, races: [] };
      groups.push(group);
    }
    group.races.push({ id, label: name });
  }
  return groups;
}

// What the form shows under the Race select (#321), or null for no race:
// each racial with its own text and how it stands in the fight
// (js/racials.js racialStatus against the page's target), with the effects
// data's one-line reason for one that does nothing or is not simulated.
// onUse is an on-use racial a rotation rule casts; casts, for one, whether
// `rotation` (the one the run uses) has a rule that casts it, or null with no
// rotation given; mobTypes the targets a mob-type racial is for. The view
// words it.
export function raceInfo(
  id,
  catalogue = raceCatalogue,
  effects = RACIAL_EFFECTS,
  rotation = null,
) {
  const race = id === null || id === undefined ? undefined : catalogue.get(id);
  if (race === undefined) {
    return null;
  }
  return {
    id: race.id,
    name: race.name,
    faction: race.faction,
    racials: race.racials.map((racial) => {
      const entry = effects[racial.id] ?? {};
      return {
        id: racial.id,
        name: racial.name,
        text: racial.text,
        status: racialStatus(racial.id, effects),
        reason: entry.noDpsEffect ?? entry.notSimulated ?? null,
        onUse: entry.ability !== undefined,
        casts:
          entry.ability === undefined || rotation === null
            ? null
            : (rotation.rules ?? []).some(
                (rule) => rule.action === entry.ability,
              ),
        mobTypes: entry.mobTypes ?? null,
      };
    }),
  };
}

// `now` when it says what `was` said, so the slice keeps its identity.
const sameRace = (was, now) =>
  was !== undefined && sameJson(was, now) ? was : now;

function poisonsInfo(values) {
  return Object.fromEntries(
    HANDS.map((hand) => [hand, poisonInfo(values[`poisons.${hand}`])]),
  );
}

const read = (object, path) =>
  path.split(".").reduce((value, key) => value?.[key], object);

function write(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((value, key) => value[key], object);
  parent[last] = value;
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// { field path: value } of a config.
export function formValues(config) {
  return Object.fromEntries(
    FIELD_PATHS.map((path) => [
      path,
      OPTIONAL_FIELDS.includes(path)
        ? (read(config, path) ?? null)
        : read(config, path),
    ]),
  );
}

// Each field's message, or no entry when it is fine, at `levels`
// (levelsInfo of the config's level).
export function validateValues(values, levels = levelsInfo()) {
  const errors = {};
  for (const { path, check } of FORM_FIELDS) {
    const message = check(values[path], values, levels);
    if (message !== "") {
      errors[path] = message;
      // Only "at least the min damage" is the pair's error; a Max that is
      // wrong on its own leaves the Min alone.
      const min = pairedMin(path);
      if (min !== null && whole(values[path]) === "" && !(min in errors)) {
        errors[min] = null;
      }
    }
  }
  return errors;
}

const MAX_NAME = k("rotation.maxNameLength");

// The name the first edit of an origin gives its session copy (D20).
export const editedName = (name) => `${name} (edited)`.slice(0, MAX_NAME);

// Whether a draft is an edit of its origin (Scout's call on #217): it is not
// once it is valid, has the origin's name, and has the origin's rules in
// order, each compared by sameRuleKey, the normaliser duplicateRule uses
// (js/rotation-warnings.js: conditions and keys in any order, a param at its
// default counts as left out). Undoing back to the origin, or moving a rule
// down and up again, makes the draft the origin again.
export function draftEdited(draft, origin) {
  const rotation = draftRotation(draft);
  return (
    validateRotation(rotation).length > 0 ||
    rotation.name !== origin.name ||
    rotation.rules.length !== origin.rules.length ||
    rotation.rules.some(
      (rule, at) => sameRuleKey(rule) !== sameRuleKey(origin.rules[at]),
    )
  );
}

// Whether the form's draft of an origin is an edit of it (draftEdited); an
// origin with no draft is not.
export function isEditedChoice(form, choice) {
  const draft = form.drafts?.[choice];
  return (
    draft !== undefined &&
    draftEdited(draft, originRotation(choice, form.imported))
  );
}

// The default first (under the name defaultRotation() gives it; #153 renames
// it), then the presets, then the imported rotation when there is one.
// Each origin whose session draft is an edit of it reads " · Edited" (D20;
// draftEdited: a draft that is the origin again reads as the origin).
export function rotationOptions(imported, drafts = {}) {
  const edited = (id, label) => ({
    id,
    label: isEditedChoice({ imported, drafts }, id)
      ? `${label} · Edited`
      : label,
  });
  return [
    edited("default", defaultRotation().name),
    ...listPresets().map(({ id, name }) => edited(id, name)),
    ...(imported === null
      ? []
      : [edited("imported", `Imported: ${imported.name}`)]),
  ];
}

// The rotation an origin is, before any edit: the default, a preset, or the
// import.
export function originRotation(choice, imported) {
  if (choice === "default") {
    return defaultRotation();
  }
  if (choice === "imported") {
    return copy(imported.rotation);
  }
  return presetRotation(choice);
}

// The rotation the sim uses for a choice: its draft's last valid version
// when it has a draft that has been valid (D19), else the origin itself.
export function rotationOf(choice, imported, drafts = {}) {
  const lastValid = drafts[choice]?.lastValid ?? null;
  return lastValid === null
    ? originRotation(choice, imported)
    : copy(lastValid);
}

// The rotation on screen for a choice: its draft, or the origin.
function shownRotation(form) {
  const draft = form.drafts?.[form.rotationChoice];
  return draft === undefined
    ? originRotation(form.rotationChoice, form.imported)
    : draftRotation(draft);
}

// The errors and warnings of the rotation on screen. Warnings are only
// worked out when there are no errors (rotationWarnings returns [] then).
export function rotationCheck(form) {
  const rotation = shownRotation(form);
  const errors = validateRotation(rotation);
  return {
    errors,
    warnings: errors.length === 0 ? rotationWarnings(rotation) : [],
  };
}

// D19's note over the summary while the draft has errors.
export function staleNote(count) {
  return `Your edits have ${count === 1 ? "1 error" : `${count} errors`}, so the sim keeps this until they're fixed.`;
}

function rotationChoiceOf(rotation) {
  if (sameJson(rotation, defaultRotation())) {
    return { rotationChoice: "default", imported: null };
  }
  const preset = listPresets().find(({ id }) =>
    sameJson(rotation, presetRotation(id)),
  );
  if (preset !== undefined) {
    return { rotationChoice: preset.id, imported: null };
  }
  return {
    rotationChoice: "imported",
    imported: { name: String(rotation.name), rotation: copy(rotation) },
  };
}

// The summary of `rotation`: its name and a line per rule. With `talents`
// (talentState of the config), a rule the build skips says so (D9). With
// errors > 0 the summary is of the last valid version, and `stale` says so.
export function summaryOf(rotation, { talents = null, errors = 0 } = {}) {
  return {
    name: String(rotation.name),
    rules: rotation.rules.map((rule) => {
      const skip = talents === null ? null : skipOf(rule, talents);
      const line = summarizeRule(rule);
      if (skip === null) {
        return line;
      }
      // With no talents a talent's skip is that, so the line says it
      // plainly rather than "…is not locked by the build … — skipped: no
      // Blade Flurry talent" (Fran's #232 QA, nit 4; #234). A skip no talent
      // lifts (talent null: a baseline ability's check, or an on-use racial
      // the race doesn't grant, #280) is the same with any build, so it says
      // why (#244, P1).
      return talents.build.selected || skip.talent === null
        ? `${line} — skipped: ${skip.phrase}`
        : `${line} — skipped with no talents`;
    }),
    stale: errors > 0 ? staleNote(errors) : null,
  };
}

// The form slice that shows `config`, with no errors.
export function formFromConfig(config, revision = 0) {
  const { rotationChoice, imported } = rotationChoiceOf(config.rotation);
  return {
    values: formValues(config),
    errors: {},
    edited: [],
    rotationChoice,
    imported,
    drafts: {},
    rotationErrors: [],
    exportOff: null,
    rotationWarnings: rotationWarnings(config.rotation),
    importStatus: null,
    rotationOptions: rotationOptions(imported),
    summary: summaryOf(config.rotation, { talents: talentState(config) }),
    poisonOptions: poisonOptions(),
    poisons: poisonsInfo(formValues(config)),
    raceOptions: raceOptions(),
    race: raceInfo(config.race, raceCatalogue, RACIAL_EFFECTS, config.rotation),
    levels: levelsInfo(characterLevel(config)),
    revision,
    canUndo: false,
  };
}

// The config the form describes, on top of `base` (which keeps the sections
// the form does not edit: the target (always from behind, fromBehind), and the build, config.talents and
// config.talentLevel, which the talent tree owns (#204); the form used to
// rebuild the talents from a select and wiped any other build). normalizeConfig checks it: the
// backstop behind the field checks, so a config it refuses never reaches the
// store. Throws what normalizeConfig throws.
export function configFromForm(form, base) {
  const config = copy(base);
  for (const path of FIELD_PATHS) {
    write(config, path, form.values[path]);
  }
  config.rotation = rotationOf(form.rotationChoice, form.imported, form.drafts);
  return normalizeConfig(fromBehind(config));
}

// What #153's Run starts: a snapshot of the store's config, or null while the
// form has errors, the rotation builder's draft has errors (#217, D17: config
// holds its last valid version, which must not run as if it were the edit),
// or the talent tree's build is over its level's cap (#204,
// state.talents.error; Run is disabled then). The form's count is
// formErrorCount, the one Run's blocked check uses (#247). A field typed in
// but not yet checked (form.edited) is not in the config either, so that is
// null too: a run never uses a config the fields do not show (#247).
export function nextRunConfig(state) {
  if (formErrorCount(state.form) > 0) {
    return null;
  }
  if ((state.form?.edited?.length ?? 0) > 0) {
    return null;
  }
  if ((state.form?.rotationErrors?.length ?? 0) > 0) {
    return null;
  }
  if (typeof state.talents?.error === "string") {
    return null;
  }
  return normalizeConfig(fromBehind(state.config));
}

function slug(name) {
  const text = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text === "" ? "rotation" : text;
}

// The status line of an accepted import. Warnings (issue #189) never block
// it: the rotation is imported and selected, and the line says how many to
// check.
export function importedText(name, warnings) {
  if (warnings === 0) {
    return `Imported "${name}".`;
  }
  const count = warnings === 1 ? "1 warning" : `${warnings} warnings`;
  return `Imported "${name}" with ${count}. It still runs; see What to check above.`;
}

// One line of an import's detail or warnings: the entry's readable place
// ("Rule 2, condition 1", from its path) and then its message. Messages never say where
// (the message contract, #214); the place comes from the path alone, never
// the text (U7 spec D4 and section 5, #217). The thrown and string forms keep
// the raw path (formatError).
//
// A problem with the file as a whole, not a rule or the name (the path ""
// or one placeText has no words for, such as "schemaVersion"), reads
// "File: …" (Fran's P4 on #219).
export const FILE_PLACE = "File";
export function errorLine(entry) {
  const place = placeText(entry.path);
  const file = place === null || place === entry.path;
  return `${file ? FILE_PLACE : place}: ${entry.message}`;
}

// Why Export is off: the rotation on screen has errors (U7 spec D17, #217).
// Its last valid version is what the sim keeps, but the file would not be
// what the builder shows, so none is written.
export function exportOffText(count) {
  return `Export is off: the rotation has ${count === 1 ? "1 error" : `${count} errors`}.`;
}

// The most entries an import's detail or warnings lists (#214, Kira's QA of
// #215: a 50-rule file can give some 18,000 errors). The validator and
// rotationWarnings still return every one; only the text shown is cut, and
// the counts (the status line's warnings, the Run bar's settings to fix) are
// of all of them. A display cap, not a game rule (rotation.maxListedEntries;
// docs/rotation.md, "Import and export").
export const MAX_LISTED = k("rotation.maxListedEntries");

// The lines of an import's detail or warnings: the first MAX_LISTED entries,
// each by errorLine, then "…and N more" for the rest.
export function listedLines(entries, most = MAX_LISTED) {
  const lines = entries.slice(0, most).map(errorLine);
  if (entries.length > most) {
    lines.push(`…and ${entries.length - most} more`);
  }
  return lines.join("\n");
}

// The actions the view calls. `defaults` gives the config Reset restores.
// Creating the model fills the `form` slice from the store's config.
export function createConfigForm(store, { defaults = pageDefaultConfig } = {}) {
  let saved = null;
  if (store.get().config?.target?.behind !== true) {
    store.set({ config: fromBehind(store.get().config) });
  }
  store.set({ form: formFromConfig(store.get().config) });

  const form = () => store.get().form;
  // The bounds at the config's level (#318): a weapon skill's cap is.
  const levelsNow = () => levelsInfo(characterLevel(store.get().config));

  // Write `next` as the form; when it has no errors, write the config it
  // describes too. A config normalizeConfig refuses is a FORM_ERROR instead.
  // A field typed in since the last commit (next.edited) is checked again
  // here, whatever its value (#247: typing back the value it had on focus
  // fires no change, and typing cleared its error).
  function commit(next) {
    const errors =
      (next.edited?.length ?? 0) > 0
        ? validateValues(next.values, levelsNow())
        : { ...next.errors };
    delete errors[FORM_ERROR];
    let config = null;
    if (Object.keys(errors).length === 0) {
      try {
        config = configFromForm(next, store.get().config);
      } catch (error) {
        errors[FORM_ERROR] =
          `This setup can't run: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const rotation = rotationOf(
      next.rotationChoice,
      next.imported,
      next.drafts,
    );
    const check = rotationCheck(next);
    store.batch(() => {
      store.set({
        form: {
          ...next,
          errors,
          edited: [],
          rotationErrors: check.errors,
          rotationWarnings: check.warnings,
          exportOff:
            check.errors.length > 0 ? exportOffText(check.errors.length) : null,
          rotationOptions: rotationOptions(next.imported, next.drafts),
          summary: summaryOf(rotation, {
            talents: talentState(config ?? store.get().config),
            errors: check.errors.length,
          }),
          poisons: poisonsInfo(next.values),
          // The same object while it says the same, so the view redraws
          // the racials only when the race, or what the run's rotation
          // casts, changes.
          race: sameRace(
            next.race,
            raceInfo(
              next.values.race,
              raceCatalogue,
              RACIAL_EFFECTS,
              (config ?? store.get().config).rotation,
            ),
          ),
          levels: levelsInfo(characterLevel(config ?? store.get().config)),
          canUndo: false,
        },
      });
      if (config !== null) {
        store.set({ config });
      }
    });
  }

  function forget() {
    saved = null;
  }

  // The fields in error when typing began (input, below).
  let checkedLive = new Set();
  // A field typed in that was not in error: its error (and its pair's) goes
  // once it is valid again; none is added.
  function clearValid(path, errors, now) {
    const min = path.endsWith(".min") ? path : pairedMin(path);
    // Max's error is the pair's while its Min is marked (a null message).
    const paired = min !== null && errors[min] === null;
    for (const key of [path, pairedMin(path)]) {
      if (key !== null && key in errors && !(key in now)) {
        delete errors[key];
      }
    }
    if (path.endsWith(".min")) {
      const max = path.replace(/\.min$/, ".max");
      if (max in errors && !(max in now)) {
        delete errors[max];
      }
      // A null Min only marks its Max's error (#237): with that gone it
      // marks nothing, so it goes too.
      if (errors[path] === null && !(max in errors)) {
        delete errors[path];
      }
    }
    // The pair's error goes once the pair check passes (#247, Fran's flow J).
    if (paired && now[min] !== null) {
      delete errors[min];
      delete errors[min.replace(/\.min$/, ".max")];
    }
  }

  // The summary follows the build: a rule the talent tree's build skips says
  // so (D9). The tree writes config.talents, not the form.
  let talents = store.get().config.talents;
  let talentLevel = store.get().config.talentLevel;
  store.subscribe(({ state, changed }) => {
    if (!changed.includes("config")) {
      return;
    }
    const { config } = state;
    if (config.talents === talents && config.talentLevel === talentLevel) {
      return;
    }
    const levelChanged = config.talentLevel !== talentLevel;
    talents = config.talents;
    talentLevel = config.talentLevel;
    const now = state.form;
    // Another level moves the weapon skill's cap (#318): a typed skill over
    // the new one is an error (the talent tree leaves the config's blank),
    // and one back under it is fine again, so the config takes it.
    if (levelChanged) {
      const path = "character.weaponSkill";
      const message = validateValues(now.values, levelsNow())[path];
      if (message !== now.errors[path]) {
        const errors = { ...now.errors };
        if (message === undefined) {
          delete errors[path];
        } else {
          errors[path] = message;
        }
        commit({ ...now, errors });
        return;
      }
    }
    store.set({
      form: {
        ...now,
        levels: levelsInfo(characterLevel(config)),
        summary: summaryOf(
          rotationOf(now.rotationChoice, now.imported, now.drafts),
          {
            talents: talentState(config),
            errors: now.rotationErrors.length,
          },
        ),
      },
    });
  });

  return {
    // Typing: keep the value. A field, or Min/Max pair, that was in error
    // when the typing began is checked as it is typed (#240, Fran's #249
    // N1 and N2): its message follows the value, so "Use a whole number" goes
    // once Max reads 45, and the pair's error comes back at Min 50 after 5.
    // Any other field's error only clears once it is valid again, and none is
    // added: that waits for change.
    input(path, raw) {
      forget();
      const value = controlValue(path, raw);
      const values = { ...form().values, [path]: value };
      const errors = { ...form().errors };
      const now = validateValues(values, levelsNow());
      if ((form().edited?.length ?? 0) === 0) {
        checkedLive = new Set(Object.keys(errors));
      }
      const min = path.endsWith(".min") ? path : pairedMin(path);
      const group =
        min === null ? [path] : [min, min.replace(/\.min$/, ".max")];
      if (group.some((key) => checkedLive.has(key))) {
        for (const key of group) {
          checkedLive.add(key);
          if (key in now) {
            errors[key] = now[key];
          } else {
            delete errors[key];
          }
        }
      } else {
        clearValid(path, errors, now);
      }
      const edited = form().edited ?? [];
      store.set({
        form: {
          ...form(),
          values,
          errors,
          edited: edited.includes(path) ? edited : [...edited, path],
          canUndo: false,
        },
      });
    },
    // Check the fields typed in since the last commit (#247): the form view
    // calls it when an edited field loses focus, and the Run bar before Run.
    // Nothing typed, nothing to do.
    commitEdits() {
      if ((form().edited?.length ?? 0) > 0) {
        forget();
        commit(form());
      }
    },
    // A committed edit: check every field, and write the config when all pass.
    change(path, raw) {
      forget();
      const value = controlValue(path, raw);
      const values = { ...form().values, [path]: value };
      commit({
        ...form(),
        values,
        errors: validateValues(values, levelsNow()),
      });
    },
    // A field set from another control than its own (#323: the Race
    // select on Start from a preset): as change, and a new revision, so
    // the form's own control shows it too.
    setField(path, raw) {
      forget();
      const value = controlValue(path, raw);
      const values = { ...form().values, [path]: value };
      commit({
        ...form(),
        values,
        errors: validateValues(values, levelsNow()),
        revision: form().revision + 1,
      });
    },
    chooseRotation(choice) {
      forget();
      if (!form().rotationOptions.some(({ id }) => id === choice)) {
        throw new RangeError(`No rotation choice ${JSON.stringify(choice)}.`);
      }
      // Another rotation: the last import's status and warnings are about the
      // one left, so they go (Kira's #206 review).
      const importStatus =
        choice === form().rotationChoice ? form().importStatus : null;
      commit({ ...form(), rotationChoice: choice, importStatus });
    },
    // A rotation file's text. A good one becomes the "Imported: <name>"
    // choice and is selected; a bad one changes nothing but the status.
    importText(text) {
      forget();
      const result = importRotation(text);
      if (!result.ok) {
        store.set({
          form: {
            ...form(),
            importStatus: {
              ok: false,
              message: "This file isn't a valid rotation.",
              detail: listedLines(result.errors),
              warnings: "",
            },
          },
        });
        return false;
      }
      const name = String(result.rotation.name);
      // A new import replaces the last one, and its draft with it (D20).
      const drafts = { ...form().drafts };
      delete drafts.imported;
      commit({
        ...form(),
        drafts,
        rotationChoice: "imported",
        imported: { name, rotation: result.rotation },
        importStatus: {
          ok: true,
          message: importedText(name, result.warnings.length),
          detail: "",
          warnings: listedLines(result.warnings),
        },
      });
      return true;
    },
    // The rotation builder's draft of the selected origin (#217): a
    // js/rotation-edit.js draft, or null to drop it (Revert to preset). The
    // config takes the draft only while it is valid (D19); while it has
    // errors the draft keeps the last valid version it had, and the config
    // and the summary use that (or the origin, if it never was valid).
    setDraft(choice, draft) {
      forget();
      const drafts = { ...form().drafts };
      if (draft === null) {
        delete drafts[choice];
      } else {
        // Back to the origin's rules under the name the first edit gave it:
        // the origin again, under its own name, so the next edit renames it
        // as a first edit does (Scout's call on #217).
        const origin = originRotation(choice, form().imported);
        if (
          draft.name === editedName(origin.name) &&
          !draftEdited({ ...draft, name: origin.name }, origin)
        ) {
          draft = { ...draft, name: origin.name };
        }
        const valid =
          validateRotation(draftRotation(draft)).length === 0
            ? draftRotation(draft)
            : (draft.lastValid ?? drafts[choice]?.lastValid ?? null);
        drafts[choice] = { ...draft, lastValid: valid };
      }
      commit({ ...form(), drafts });
    },
    // The selected rotation as a file: { fileName, text }, or null while it
    // has errors (Export is off, D17).
    exportRotation() {
      const { rotationChoice, imported, drafts, rotationErrors } = form();
      if (rotationErrors.length > 0) {
        return null;
      }
      const rotation = rotationOf(rotationChoice, imported, drafts);
      return {
        fileName: `${slug(String(rotation.name))}.json`,
        text: exportRotation(rotation),
      };
    },
    // A preset's reference build (#273), or the build it replaced: `values`
    // are form fields ({ path: value }, the weapons and poisons), `talents`
    // and `talentLevel` the talent tree's part of the config. The fields
    // are redrawn (a new revision). The config takes the build even while
    // another field is in error, so the talents and weapons are never left
    // half applied; the fields in error stay as typed, and the config gets
    // them when they are fixed, as any edit does. `rotation` (#323, the
    // Start from a preset panel) is the rotation's part of the form too:
    // { rotationChoice, imported, drafts, importStatus }, written in the
    // same change; without it the rotation is left as it is.
    applyBuild({ values: patch, talents, talentLevel, rotation = null }) {
      forget();
      const now = store.get();
      const values = { ...form().values, ...patch };
      const base = copy(now.config);
      base.talents = copy(talents);
      base.talentLevel = talentLevel;
      // The rotation goes in with them, even while another field's error
      // keeps the form's config back.
      if (rotation !== null) {
        base.rotation = rotationOf(
          rotation.rotationChoice,
          rotation.imported,
          rotation.drafts,
        );
      }
      for (const [path, value] of Object.entries(patch)) {
        write(base, path, value);
      }
      store.batch(() => {
        store.set({ config: normalizeConfig(fromBehind(base)) });
        commit({
          ...form(),
          ...(rotation === null ? {} : rotation),
          values,
          errors: validateValues(values, levelsNow()),
          revision: form().revision + 1,
        });
      });
    },
    // Back to the page defaults, errors cleared. Undo puts back the form and
    // config from before, until anything else is done.
    reset() {
      const before = store.get();
      const config = normalizeConfig(fromBehind(defaults()));
      store.batch(() => {
        store.set({
          form: {
            ...formFromConfig(config, before.form.revision + 1),
            canUndo: true,
          },
          config,
        });
      });
      saved = { form: before.form, config: before.config };
    },
    undo() {
      if (saved === null) {
        return false;
      }
      const { form: previous, config } = saved;
      saved = null;
      store.set({
        form: {
          ...previous,
          revision: form().revision + 1,
          canUndo: false,
        },
        config,
      });
      return true;
    },
  };
}
