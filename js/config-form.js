import { k } from "../data/constants.js";
import { referenceBuild } from "../data/reference-build.js";
import { defaultRotation } from "./rotation-default.js";
import { exportRotation, importRotation } from "./rotation-io.js";
import { poisonCatalogue } from "./poisons.js";
import { listPresets, presetRotation } from "./rotation-presets.js";
import { summarizeRule } from "./rotation-summary.js";
import { defaultConfig, normalizeConfig } from "./sim-config.js";
import { talentCatalogue } from "./talents.js";

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
//                   that is not a number is NaN.
//   errors          { field path: message } for each field that is invalid
//                   now. A message of null marks a field invalid with its
//                   message on another field (the Min of a Min/Max pair).
//                   FORM_ERROR is the normalizeConfig backstop's message.
//   talentsChoice   "none" or "reference".
//   rotationChoice  "default", a preset id, or "imported".
//   imported        { name, rotation } of the last imported rotation, or null.
//   importStatus    null, or { ok, message, detail, warnings } from the last
//                   import. `detail` is the errors of a refused file and
//                   `warnings` the warnings of an accepted one (issue #189),
//                   one per line; each is "" when there are none.
//   talentOptions, rotationOptions   [{ id, label }] for the two selects.
//   summary         { name, rules: [text] } of the selected rotation.
//   poisonOptions   { simulated, notSimulated: [{ id, label }] } for the two
//                   poison selects (#152); id is the config id ("instant").
//   poisons         { mainHand, offHand }: poisonInfo() of each hand's poison,
//                   or null for None.
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
const PERCENT_MESSAGE = "Enter a percentage from 0 to 100.";
const NUMBER_MESSAGE = "Enter a number.";
const WHOLE_MESSAGE = "Use a whole number, 0 or more.";

// Every field the form edits, in page order, with its check. A check gets the
// value and all values, and returns a message, or "" when the value is fine.
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
    {
      path: "character.attackPower",
      check: numberCheck(
        "Attack power can't be negative.",
        (value) => value >= 0,
      ),
    },
    { path: "character.critChance", check: chance },
    { path: "character.bonusHitChance", check: chance },
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

// The config the page starts with and Reset restores: defaultConfig() with
// the page's poisons (#152, Scout: Instant on the main hand, Deadly on the off
// hand). The engine's default keeps no poisons, so goldens do not move.
export function pageDefaultConfig() {
  return { ...defaultConfig(), poisons: { ...k("ui.pageDefaultPoisons") } };
}

// A poison select's value: its config id, "" for None. The config id is the
// catalogue's `key` ("instant"), not its `id` ("instant-poison").
function controlValue(path, value) {
  return path.startsWith("poisons.") && value === "" ? null : value;
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
    FIELD_PATHS.map((path) => [path, read(config, path)]),
  );
}

// Each field's message, or no entry when it is fine.
export function validateValues(values) {
  const errors = {};
  for (const { path, check } of FORM_FIELDS) {
    const message = check(values[path], values);
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

// The reference build's points in each tree, e.g. "18/33/0".
function treePoints(ranks, catalogue = talentCatalogue) {
  return catalogue.trees
    .map(({ id }) =>
      Object.entries(ranks)
        .filter(([talent]) => catalogue.get(talent).tree === id)
        .reduce((sum, [, rank]) => sum + rank, 0),
    )
    .join("/");
}

const TALENT_CHOICES = {
  none: () => ({}),
  reference: () => normalizeConfig({ talents: referenceBuild() }).talents,
};

export function talentOptions() {
  return [
    { id: "none", label: "No talents" },
    {
      id: "reference",
      label: `Reference Combat (${treePoints(TALENT_CHOICES.reference())})`,
    },
  ];
}

function talentsChoiceOf(talents) {
  return sameJson(talents, TALENT_CHOICES.reference()) ? "reference" : "none";
}

// The default first (under the name defaultRotation() gives it; #153 renames
// it), then the presets, then the imported rotation when there is one.
export function rotationOptions(imported) {
  return [
    { id: "default", label: defaultRotation().name },
    ...listPresets().map(({ id, name }) => ({ id, label: name })),
    ...(imported === null
      ? []
      : [{ id: "imported", label: `Imported: ${imported.name}` }]),
  ];
}

function rotationOf(choice, imported) {
  if (choice === "default") {
    return defaultRotation();
  }
  if (choice === "imported") {
    return copy(imported.rotation);
  }
  return presetRotation(choice);
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

export function summaryOf(rotation) {
  return {
    name: String(rotation.name),
    rules: rotation.rules.map(summarizeRule),
  };
}

// The form slice that shows `config`, with no errors.
export function formFromConfig(config, revision = 0) {
  const { rotationChoice, imported } = rotationChoiceOf(config.rotation);
  return {
    values: formValues(config),
    errors: {},
    talentsChoice: talentsChoiceOf(config.talents),
    rotationChoice,
    imported,
    importStatus: null,
    talentOptions: talentOptions(),
    rotationOptions: rotationOptions(imported),
    summary: summaryOf(config.rotation),
    poisonOptions: poisonOptions(),
    poisons: poisonsInfo(formValues(config)),
    revision,
    canUndo: false,
  };
}

// The config the form describes, on top of `base` (which keeps the sections
// the form does not edit: the target). normalizeConfig checks it: the
// backstop behind the field checks, so a config it refuses never reaches the
// store. Throws what normalizeConfig throws.
export function configFromForm(form, base) {
  const config = copy(base);
  for (const path of FIELD_PATHS) {
    write(config, path, form.values[path]);
  }
  config.talents = TALENT_CHOICES[form.talentsChoice]();
  config.rotation = rotationOf(form.rotationChoice, form.imported);
  return normalizeConfig(config);
}

// What #153's Run starts: a snapshot of the store's config, or null while the
// form has errors (Run is disabled then).
export function nextRunConfig(state) {
  if (Object.keys(state.form?.errors ?? {}).length > 0) {
    return null;
  }
  return normalizeConfig(state.config);
}

// How many fields need fixing: one for each message.
export function errorCount(errors) {
  return Object.values(errors).filter((message) => message !== null).length;
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
  return `Imported "${name}" with ${count}. It still runs; see the warnings below.`;
}

// One line of a refused import's detail. The validator's messages already
// name their place ("rules[0]: Blade Flurry ...", "rules[0] is missing ...",
// "rules is empty: ..."), so the path is written in front only when the
// message does not start with it or with the part of it before a ".".
// "" is the path of a problem with the whole text.
export function errorLine({ path, message }) {
  const lead = /^[\w.[\]]+/.exec(message)?.[0];
  const named = path === lead || path.startsWith(`${lead}.`);
  return path === "" || named ? message : `${path}: ${message}`;
}

// The actions the view calls. `defaults` gives the config Reset restores.
// Creating the model fills the `form` slice from the store's config.
export function createConfigForm(store, { defaults = pageDefaultConfig } = {}) {
  let saved = null;
  store.set({ form: formFromConfig(store.get().config) });

  const form = () => store.get().form;

  // Write `next` as the form; when it has no errors, write the config it
  // describes too. A config normalizeConfig refuses is a FORM_ERROR instead.
  function commit(next) {
    const errors = { ...next.errors };
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
    const rotation = rotationOf(next.rotationChoice, next.imported);
    store.batch(() => {
      store.set({
        form: {
          ...next,
          errors,
          rotationOptions: rotationOptions(next.imported),
          summary: summaryOf(rotation),
          poisons: poisonsInfo(next.values),
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

  return {
    // Typing: keep the value; clear the field's error only once it is valid
    // again, and never add one (that waits for change).
    input(path, raw) {
      forget();
      const value = controlValue(path, raw);
      const values = { ...form().values, [path]: value };
      const errors = { ...form().errors };
      const now = validateValues(values);
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
      }
      store.set({ form: { ...form(), values, errors, canUndo: false } });
    },
    // A committed edit: check every field, and write the config when all pass.
    change(path, raw) {
      forget();
      const value = controlValue(path, raw);
      const values = { ...form().values, [path]: value };
      commit({ ...form(), values, errors: validateValues(values) });
    },
    chooseTalents(choice) {
      forget();
      if (!(choice in TALENT_CHOICES)) {
        throw new RangeError(`No talent choice ${JSON.stringify(choice)}.`);
      }
      commit({ ...form(), talentsChoice: choice });
    },
    chooseRotation(choice) {
      forget();
      if (!form().rotationOptions.some(({ id }) => id === choice)) {
        throw new RangeError(`No rotation choice ${JSON.stringify(choice)}.`);
      }
      commit({ ...form(), rotationChoice: choice });
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
              detail: result.errors.map(errorLine).join("\n"),
              warnings: "",
            },
          },
        });
        return false;
      }
      const name = String(result.rotation.name);
      commit({
        ...form(),
        rotationChoice: "imported",
        imported: { name, rotation: result.rotation },
        importStatus: {
          ok: true,
          message: importedText(name, result.warnings.length),
          detail: "",
          warnings: result.warnings.map(({ message }) => message).join("\n"),
        },
      });
      return true;
    },
    // The selected rotation as a file: { fileName, text }.
    exportRotation() {
      const { rotationChoice, imported } = form();
      const rotation = rotationOf(rotationChoice, imported);
      return {
        fileName: `${slug(String(rotation.name))}.json`,
        text: exportRotation(rotation),
      };
    },
    // Back to the page defaults, errors cleared. Undo puts back the form and
    // config from before, until anything else is done.
    reset() {
      const before = store.get();
      const config = normalizeConfig(defaults());
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
