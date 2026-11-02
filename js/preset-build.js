import { poisonName } from "./build-label.js";
import {
  isEditedChoice,
  originRotation,
  pageDefaultConfig,
} from "./config-form.js";
import { exportRotation } from "./rotation-io.js";
import {
  listPresets,
  poisonDifferences,
  presetRotation,
  referenceBuild,
  referencePoison,
  referenceWeapon,
  talentDifferences,
  weaponTypeDifferences,
} from "./rotation-presets.js";
import { pointsByTree } from "./talent-build.js";
import { talentCatalogue } from "./talents.js";
import { MOVED_BY_RUN } from "./views/router.js";

// The preset's reference build (#273, Fran's design/pre-273.md): under the
// Rotation select, a preset with a reference build (#272,
// data/preset-reference-builds.js) says what it was built for, and while
// the build differs from it, a button applies it: "Use its talents,
// weapons and poisons too". The button replaces the talents, the weapon in
// each hand (type, damage and speed) and the poisons, and sets level 60
// below it; the stats are left as they are. After it a line says what was
// set, with a one-step Undo that puts all of it back. Undo closes on the
// next build edit, a rotation change or leaving the page.
//
// Matching (James's ruling): the talent ranks, the weapon type in each hand
// and the poisons, from the current build. Weapon damage and speed, the
// level and the stats are not compared.
//
// No DOM: js/views/preset-build.js draws the store's `presetBuild` slice,
//
//   { hint, applied, announce, focus }
//     hint      null, or { presetId, text, label, undoName }: the line under
//               the select and the button's label, while the build differs.
//     applied   null, or { text, undoName }: the line after the button was
//               pressed, and Undo's accessible name.
//     announce  null, or { text, seq }: the one message for #run-announce
//               (js/views/controls.js adds "Results out of date." to it when
//               a kept result goes out of date with it).
//     focus     null, or { target, seq }: "undo", "button" or "select",
//               where the focus goes after a press.
//
// and main.js hands its actions, { apply, pick, undo }, to that view and
// to js/start-preset.js.
//
// pick (#323, the Start from a preset panel on Character) is the same
// press for a card: the preset's reference build and its rotation, or
// Custom's (the page defaults' talents, weapons and poisons, and the
// default rotation). Its Undo puts the rotation back too: the choice, the
// import and the session drafts.

const HANDS = ["mainHand", "offHand"];
const NBSP = "\u00a0";
const WEAPON_FIELDS = ["type", "min", "max", "speed"];

// The parts of a build the button replaces, in the order they are named.
export const BUILD_PARTS = ["talents", "weapons", "poisons"];

// A weapon type as the hint names it: "dagger", "two daggers".
const WEAPON_NOUNS = {
  dagger: ["dagger", "daggers"],
  sword: ["sword", "swords"],
  mace: ["mace", "maces"],
  axe: ["axe", "axes"],
  fist: ["fist weapon", "fist weapons"],
  other: ["weapon", "weapons"],
};
const nounOf = (type, many) => {
  const nouns = WEAPON_NOUNS[type] ?? [`${type} weapon`, `${type} weapons`];
  return many ? nouns[1] : nouns[0];
};
const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");

// "a", "a and b", "a, b and c".
export function listText(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const capital = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// The preset a rotation choice stands for, or null: a preset (edited or
// not), or an import identical to one, name and all (as js/config-form.js's
// rotationChoiceOf calls a loaded one). The default rotation and other
// imports have no reference build.
export function presetOfChoice(form) {
  const choice = form?.rotationChoice ?? null;
  if (choice === null) {
    return null;
  }
  const presets = listPresets().map(({ id }) => id);
  if (presets.includes(choice)) {
    return choice;
  }
  if (choice !== "imported" || (form.imported ?? null) === null) {
    return null;
  }
  // Compared as files: an import's keys come back in the file's order.
  const rotation = exportRotation(originRotation(choice, form.imported));
  return (
    presets.find((id) => exportRotation(presetRotation(id)) === rotation) ??
    null
  );
}

// The build the page has now: the talents and level from the config (the
// talent tree's last valid build), the weapons and poisons from the
// form's fields (the config's, without a form).
export function currentBuild(state) {
  const { config, form } = state;
  const value = (path, fallback) =>
    form?.values !== undefined && path in form.values
      ? form.values[path]
      : fallback;
  return {
    talents: config.talents ?? {},
    talentLevel: config.talentLevel,
    weapons: Object.fromEntries(
      HANDS.map((hand) => [
        hand,
        Object.fromEntries(
          WEAPON_FIELDS.map((field) => [
            field,
            value(`weapons.${hand}.${field}`, config.weapons?.[hand]?.[field]),
          ]),
        ),
      ]),
    ),
    poisons: Object.fromEntries(
      HANDS.map((hand) => [
        hand,
        value(`poisons.${hand}`, config.poisons?.[hand] ?? null),
      ]),
    ),
  };
}

// Which parts differ: { talents, weapons, poisons, level }. `level` is
// whether applying raises the level, not a part that is compared.
export function buildDifferences(build, current) {
  const types = weaponTypeDifferences(build, current.weapons);
  const poisons = poisonDifferences(build, current.poisons);
  return {
    talents: talentDifferences(build, current.talents).length > 0,
    weapons: HANDS.some((hand) => !types[hand].same),
    poisons: HANDS.some((hand) => !poisons[hand].same),
    level:
      !Number.isInteger(current.talentLevel) ||
      current.talentLevel < build.talentLevel,
  };
}

export const differingParts = (differences) =>
  BUILD_PARTS.filter((part) => differences[part]);

// "Use its talents too", "Use its talents, weapons and poisons too".
export const buttonLabel = (parts) => `Use its ${listText(parts)} too`;

// "Assassination 41/10/0": the tree with the most points (the first on a
// tie), then the points in each tree, kept on one line.
export function treeText(talents, catalogue = talentCatalogue) {
  const points = pointsByTree(talents, catalogue);
  const trees = catalogue.trees;
  const counts = trees.map((tree) => points[tree.id] ?? 0);
  let top = 0;
  counts.forEach((count, index) => {
    if (count > counts[top]) {
      top = index;
    }
  });
  return `${trees[top].name}${NBSP}${counts.join("/")}`;
}

// "two daggers", "a sword and a dagger".
export function weaponsText(weapons) {
  const [main, off] = HANDS.map((hand) => weapons[hand].type);
  if (main === off) {
    return `two ${nounOf(main, true)}`;
  }
  return [main, off]
    .map((type) => `${article(nounOf(type, false))} ${nounOf(type, false)}`)
    .join(" and ");
}

// The build's name without its note: "Assassination daggers" for
// "Assassination daggers (Mutilate, Venom)". The full names run long
// (#273 watch out) and the note is for the data's readers.
export const shortName = (build) => build.name.replace(/\s*\(.*\)\s*$/, "");

// The hint under the select: "Built for Assassination 41/10/0 with two
// daggers." Below the build's level it says the level ("at level 60"); while
// the poisons differ it names them.
export function hintText(build, differences, names = poisonName) {
  const level = differences.level ? ` at level${NBSP}${build.talentLevel}` : "";
  const poisons = differences.poisons
    ? `, ${names(referencePoison(build, "mainHand"))} on the main hand and ${names(referencePoison(build, "offHand"))} on the off hand`
    : "";
  return `Built for ${treeText(build.talents)}${level} with ${weaponsText(build.weapons)}${poisons}.`;
}

const levelSentence = (build) => `Level set to${NBSP}${build.talentLevel}.`;

// Sentences joined with a space, the empty ones left out.
const sentences = (...texts) => texts.filter((text) => text !== "").join(" ");

// What a change puts back: the parts, and "level" when it was set.
const withLevel = (parts, level) => (level ? [...parts, "level"] : parts);

// The line after the button: "Talents and weapons set to the
// Assassination daggers build." and "Level set to 60." when it was below;
// just "Level set to 60." when the level is all that changed.
export function appliedText(build, parts, level) {
  if (parts.length === 0 && !level) {
    return "Nothing changed.";
  }
  return sentences(
    parts.length > 0
      ? `${capital(listText(parts))} set to the ${shortName(build)} build.`
      : "",
    level ? levelSentence(build) : "",
  );
}

// #run-announce after the button: "Talents and weapons replaced." (and the
// level, or only "Level set to 60."); after Undo: "Talents and weapons put
// back.", "Talents, weapons, poisons and level put back." or "Level put
// back." A change of nothing says so, though a pick of nothing has no Undo.
export function announceText(build, parts, level, undone = false) {
  const what = withLevel(parts, level);
  if (what.length === 0) {
    return undone ? "Nothing to put back." : "Nothing changed.";
  }
  if (undone) {
    return `${capital(listText(what))} put back.`;
  }
  return sentences(
    parts.length > 0 ? `${capital(listText(parts))} replaced.` : "",
    level ? levelSentence(build) : "",
  );
}

// Undo's accessible name, which starts with its visible label: "Undo: put
// back your talents and level", "Undo: put back your level".
export function undoName(parts, level = false) {
  const what = withLevel(parts, level);
  return what.length === 0 ? "Undo" : `Undo: put back your ${listText(what)}`;
}

// The hint for a state, or null.
export function hintOf(state) {
  const presetId = presetOfChoice(state.form);
  const build = presetId === null ? null : referenceBuild(presetId);
  if (build === null) {
    return null;
  }
  const differences = buildDifferences(build, currentBuild(state));
  const parts = differingParts(differences);
  if (parts.length === 0) {
    return null;
  }
  return {
    presetId,
    text: hintText(build, differences),
    label: buttonLabel(parts),
  };
}

// The form fields the button writes: { "weapons.mainHand.type": ..., ... }.
export function buildValues(build) {
  const values = {};
  for (const hand of HANDS) {
    const weapon = referenceWeapon(build, hand);
    for (const field of WEAPON_FIELDS) {
      values[`weapons.${hand}.${field}`] = weapon[field];
    }
    values[`poisons.${hand}`] = referencePoison(build, hand);
  }
  return values;
}

// Whether the weapons' fields differ from the build's: a type, or a damage
// or speed as a number (a field's value is its text).
export function weaponValuesDiffer(build, current) {
  const wanted = buildValues(build);
  const now = savedValues(current);
  return Object.keys(wanted)
    .filter((path) => path.startsWith("weapons."))
    .some((path) =>
      path.endsWith(".type")
        ? wanted[path] !== now[path]
        : Number(wanted[path]) !== Number(now[path]),
    );
}

// The same fields as they are now, for Undo.
export function savedValues(current) {
  const values = {};
  for (const hand of HANDS) {
    for (const field of WEAPON_FIELDS) {
      values[`weapons.${hand}.${field}`] = current.weapons[hand][field];
    }
    values[`poisons.${hand}`] = current.poisons[hand];
  }
  return values;
}

// The Custom card (#323): the page defaults, no preset.
export const CUSTOM = "custom";
// The rotation as a part a pick replaces, after BUILD_PARTS.
export const ROTATION_PART = "rotation";

// Custom's build: the page defaults' talents, level, weapons and poisons,
// in a reference build's shape.
export function customBuild(defaults = pageDefaultConfig()) {
  return {
    name: "Custom",
    talents: { ...(defaults.talents ?? {}) },
    talentLevel: defaults.talentLevel,
    weapons: {
      mainHand: { ...defaults.weapons.mainHand },
      offHand: { ...defaults.weapons.offHand },
    },
    poisons: { ...defaults.poisons },
  };
}

// The build a card puts in: a preset's reference build, or Custom's.
export const pickBuild = (choice, defaults) =>
  choice === CUSTOM ? customBuild(defaults) : referenceBuild(choice);

// The rotation choice a card puts in: the preset, or the default.
export const pickRotation = (choice) =>
  choice === CUSTOM ? "default" : choice;

// Whether the card's rotation differs from the form's: another choice, or
// an edited draft of it (a pick gives the clean rotation).
export function rotationDiffers(form, choice) {
  const target = pickRotation(choice);
  return form?.rotationChoice !== target || isEditedChoice(form, target);
}

// The points in each tree, "38/11/2", or "no talents".
export function pointsText(talents, catalogue = talentCatalogue) {
  const points = pointsByTree(talents, catalogue);
  const counts = catalogue.trees.map((tree) => points[tree.id] ?? 0);
  return counts.some((count) => count > 0) ? counts.join("/") : "";
}

// A poison as a card names it: "Instant" for Instant Poison.
export const poisonShort = (id, names = poisonName) =>
  id === null || id === undefined
    ? "no poison"
    : names(id).replace(/\s+Poison$/i, "");

// "Instant and Deadly poisons", "Deadly poison on both hands".
export function poisonsText(poisons, names = poisonName) {
  const [main, off] = HANDS.map((hand) => poisonShort(poisons[hand], names));
  return main === off
    ? `${main} poison on both hands`
    : `${main} and ${off} poisons`;
}

// The line after a pick: "Assassination set: talents 38/11/2, two daggers,
// Instant and Deadly poisons and its rotation. Your stats and race are
// unchanged." It names the parts put in, `parts` (all of them by default),
// as the announcement does (#326, item 7: a re-pick named the whole build
// while it said only what changed); `level` adds "level 60" when it was
// below.
export function pickedText(
  name,
  build,
  choice,
  level,
  parts = [...BUILD_PARTS, ROTATION_PART],
) {
  const points = pointsText(build.talents);
  const says = {
    talents: points === "" ? "no talents" : `talents ${points}`,
    weapons: weaponsText(build.weapons),
    poisons: poisonsText(build.poisons),
    [ROTATION_PART]:
      choice === CUSTOM ? "the default rotation" : "its rotation",
  };
  const items = [...BUILD_PARTS, ROTATION_PART]
    .filter((part) => parts.includes(part))
    .map((part) => says[part]);
  if (level) {
    items.push(`level${NBSP}${build.talentLevel}`);
  }
  return `${name} set: ${listText(items)}. Your stats and race are unchanged.`;
}

// The slice's `applied`: the line, Undo's name, and the card picked (null
// for #273's button).
const appliedOf = (saved) =>
  saved === null
    ? null
    : { text: saved.text, undoName: saved.undoName, pick: saved.pick };

const routeKey = (route) =>
  route === undefined || route === null
    ? ""
    : JSON.stringify([route.area, route.sub ?? null, route.param ?? null]);

// The model. `formActions` is js/config-form.js's: applyBuild writes the
// fields and the config in one change. `defaults` is the config Custom puts
// back (the form's Reset's). Returns { apply, pick, undo }.
export function createPresetBuild(
  store,
  formActions,
  { defaults = pageDefaultConfig() } = {},
) {
  // What Undo puts back, and the state just after the press it undoes.
  let saved = null;
  let seq = 0;
  let focusSeq = 0;

  const slice = () =>
    store.get().presetBuild ?? {
      hint: null,
      applied: null,
      announce: null,
      focus: null,
    };

  function refresh(extra = {}) {
    const state = store.get();
    const hint = hintOf(state);
    const applied = appliedOf(saved);
    store.set({
      presetBuild: { ...slice(), hint, applied, ...extra },
    });
  }

  // Still the state the press left? A build edit (any config change, or
  // a talent rank the tree holds back from the config), another rotation
  // or leaving the page closes Undo.
  // The tree's ranks are checked on its own changes only: it catches up
  // with the config one change after the press.
  // Leaving the page is a move by the nav, a link, a hash or Back
  // (a reload starts with no Undo at all). Run's own move to Results
  // (#242) is not: Undo stays there and on the way back to the page, so
  // the build can be run and then put back. Any other move from Results
  // closes it.
  function closes(state, changed) {
    if (saved === null) {
      return false;
    }
    if (changed.includes("route")) {
      const key = routeKey(state.route);
      if (key === saved.after.route || state.routeBy === MOVED_BY_RUN) {
        saved.route = key;
      }
    }
    const ranks = changed.includes("talents") ? state.talents?.ranks : null;
    return (
      state.config !== saved.after.config ||
      state.form?.rotationChoice !== saved.after.choice ||
      routeKey(state.route) !== saved.route ||
      (ranks !== undefined &&
        ranks !== null &&
        talentDifferences({ talents: saved.after.talents }, ranks).length > 0)
    );
  }

  const nextFocus = (target) => {
    focusSeq += 1;
    return { target, seq: focusSeq };
  };
  const nextAnnounce = (text) => {
    seq += 1;
    return { text, seq };
  };

  // Put `build` in, with the rotation `rotation` (a pick's) or the
  // rotation as it is (#273's button). `parts` are what differs.
  function replace({ build, parts, level, rotation, text, pick }) {
    const state = store.get();
    const current = currentBuild(state);
    const { form } = state;
    const before = {
      values: savedValues(current),
      talents: { ...current.talents },
      talentLevel: current.talentLevel,
      rotation:
        rotation === null
          ? null
          : {
              rotationChoice: form.rotationChoice,
              imported: form.imported,
              drafts: form.drafts,
              importStatus: form.importStatus ?? null,
            },
    };
    store.batch(() => {
      formActions.applyBuild({
        values: buildValues(build),
        talents: build.talents,
        talentLevel: level ? build.talentLevel : current.talentLevel,
        rotation,
      });
      const now = store.get();
      saved = {
        before,
        parts,
        level,
        build,
        pick,
        text,
        undoName: undoName(parts, level),
        // Where Undo may be now: the page, or where Run moved it.
        route: routeKey(now.route),
        after: {
          config: now.config,
          choice: now.form.rotationChoice,
          route: routeKey(now.route),
          talents: { ...build.talents },
        },
      };
      refresh({
        announce: nextAnnounce(announceText(build, parts, level)),
        focus: nextFocus("undo"),
      });
    });
    return true;
  }

  function apply() {
    const state = store.get();
    const presetId = presetOfChoice(state.form);
    const build = presetId === null ? null : referenceBuild(presetId);
    if (build === null) {
      return false;
    }
    const differences = buildDifferences(build, currentBuild(state));
    const parts = differingParts(differences);
    if (parts.length === 0) {
      return false;
    }
    const level = differences.level;
    return replace({
      build,
      parts,
      level,
      rotation: null,
      text: appliedText(build, parts, level),
      pick: null,
    });
  }

  // A card (#323): `choice` is a preset id or CUSTOM, `name` the card's.
  // False when the page has that build and rotation already (nothing to
  // put in, and no Undo).
  function pick(choice, name = choice) {
    const state = store.get();
    const build = pickBuild(choice, defaults);
    if (build === null) {
      return false;
    }
    const current = currentBuild(state);
    const differences = buildDifferences(build, current);
    // A re-pick puts back weapon damage and speed edited since (#326, item
    // 6): the card is the whole build, where #273's button compares types.
    differences.weapons ||= weaponValuesDiffer(build, current);
    const parts = [
      ...differingParts(differences),
      ...(rotationDiffers(state.form, choice) ? [ROTATION_PART] : []),
    ];
    const level = differences.level;
    if (parts.length === 0 && !level) {
      return false;
    }
    const drafts = { ...(state.form.drafts ?? {}) };
    delete drafts[pickRotation(choice)];
    return replace({
      build,
      parts,
      level,
      rotation: {
        rotationChoice: pickRotation(choice),
        imported: state.form.imported,
        drafts,
        importStatus: null,
      },
      text: pickedText(name, build, choice, level, parts),
      pick: choice,
    });
  }

  function undo() {
    if (saved === null) {
      return false;
    }
    const { before, parts, level, build, pick: picked } = saved;
    saved = null;
    store.batch(() => {
      formActions.applyBuild(before);
      const hint = hintOf(store.get());
      refresh({
        announce: nextAnnounce(announceText(build, parts, level, true)),
        // A card's Undo: the Start from a preset view puts the focus back.
        focus: nextFocus(
          picked !== null ? "start" : hint === null ? "select" : "button",
        ),
      });
    });
    return true;
  }

  refresh();
  store.subscribe(({ state, changed }) => {
    if (changed.length === 1 && changed[0] === "presetBuild") {
      return;
    }
    if (closes(state, changed)) {
      saved = null;
    }
    const hint = hintOf(state);
    const current = slice();
    const applied = appliedOf(saved);
    if (
      JSON.stringify(hint) !== JSON.stringify(current.hint) ||
      JSON.stringify(applied) !== JSON.stringify(current.applied)
    ) {
      store.set({ presetBuild: { ...current, hint, applied } });
    }
  });

  return { apply, pick, undo };
}
