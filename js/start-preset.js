import { k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { isEditedChoice } from "./config-form.js";
import {
  CUSTOM,
  buildDifferences,
  currentBuild,
  differingParts,
  pointsText,
  poisonShort,
  presetOfChoice,
  weaponsText,
} from "./preset-build.js";
import { nameOf } from "./rotation-builder-copy.js";
import {
  listPresets,
  presetRotation,
  referenceBuild,
} from "./rotation-presets.js";
import { pointsByTree } from "./talent-build.js";
import { talentCatalogue } from "./talents.js";

// Start from a preset (#323, Fran's design/preset-first): at the top of
// Character on a first visit, four cards (Assassination, Combat swords,
// Subtlety and Custom). One press puts in the card's build and rotation
// (js/preset-build.js's pick, with its one-step Undo), and the panel folds
// into the first Character row, "Starting point: Assassination", which
// opens the cards again at #character/start.
//
// When it is open (James's answers on #323): only when the page started
// from the defaults (js/build-codec.js's resolveInitialSetup, source
// "defaults", which a link that failed to load with nothing saved is too),
// and Custom was not chosen before. A saved setup or a link that opened
// starts folded. Reset to defaults opens it again.
//
// Custom is remembered under its own small key, START_KEY, not in the
// saved setup: choosing it may change nothing, and the share link and
// save formats stay as they were. A preset's pick and Reset to defaults
// forget it (a preset's build is saved with the setup anyway).
//
// No DOM: js/views/start-preset.js draws the store's `start` slice,
//
//   { open, lead, cards, point, focus }
//     open    whether the cards show at the top of the Character list.
//     lead    the panel's first line.
//     cards   [{ id, name, detail, short, current, edited }], in the
//             talent trees' order, then Custom. `short` is the compact
//             grid's detail (the points); `current` the starting point's
//             card.
//     point   { id, text }: the starting point, worked out from the
//             build as #273's hint is: the rotation's preset, " · Edited"
//             when the build or the rotation differs from it; else Custom.
//     needsRace  whether the line after a preset's pick asks for a race.
//     focus   null, or { target, id, seq }: "card" (id), "row" or "gear",
//             after a press that changed nothing, or after Undo.

export const START_KEY = "wowf_dps_sim.start";
// The value under START_KEY once Custom is chosen.
export const CUSTOM_CHOSEN = "custom";

const CUSTOM_NAME = "Custom";
const CUSTOM_DETAIL =
  "The page defaults: temporary Combat swords talents and rotation";
const CUSTOM_SHORT = "16/35/0";
const EDITED = " · Edited";
const DOT = " · ";

// What START_KEY holds, or null: nothing, no storage, or reading threw.
export function readStartChoice(storage) {
  try {
    return storage?.getItem(START_KEY) ?? null;
  } catch {
    return null;
  }
}

// Remember `value`, or forget it (null). Storage errors are dropped: the
// panel then opens again next time, which is the safe side.
export function writeStartChoice(storage, value) {
  try {
    if (value === null) {
      storage?.removeItem(START_KEY);
    } else {
      storage?.setItem(START_KEY, value);
    }
  } catch {
    // Nothing to do.
  }
}

// Whether the panel is open on load: the page started from the defaults,
// and Custom was not chosen before.
export const opensFirst = ({ source, remembered }) =>
  source === "defaults" && remembered !== CUSTOM_CHOSEN;

// The rotation's builder: its last rule that adds combo points
// ("Mutilate" for Assassination).
export function builderOf(rotation, definitions = ABILITY_DEFINITIONS) {
  const builders = new Set(
    definitions
      .filter((ability) => ability.gain?.resource === "comboPoints")
      .map((ability) => ability.id),
  );
  const rules = (rotation?.rules ?? []).filter((rule) =>
    builders.has(rule.action),
  );
  return rules.length === 0 ? null : nameOf(rules[rules.length - 1].action);
}

// The tree with the most points (the first on a tie), as an index.
function topTree(talents, catalogue = talentCatalogue) {
  const points = pointsByTree(talents, catalogue);
  const counts = catalogue.trees.map((tree) => points[tree.id] ?? 0);
  return counts.indexOf(Math.max(...counts));
}

// The cards: the presets with a reference build, in their top tree's order
// (Assassination, Combat, Subtlety), then Custom.
export function startCards(presets = listPresets()) {
  const cards = presets
    .map((preset, order) => ({
      preset,
      order,
      build: referenceBuild(preset.id),
    }))
    .filter(({ build }) => build !== null)
    .sort(
      (a, b) =>
        topTree(a.build.talents) - topTree(b.build.talents) ||
        a.order - b.order,
    )
    .map(({ preset, build }) => {
      const builder = builderOf(presetRotation(preset.id));
      const points = pointsText(build.talents);
      const poisons = ["mainHand", "offHand"]
        .map((hand) => poisonShort(build.poisons[hand]))
        .join(" / ");
      const lead = builder === null ? [] : [builder];
      return {
        id: preset.id,
        name: preset.name,
        detail: [...lead, points, weaponsText(build.weapons), poisons].join(
          DOT,
        ),
        short: points,
      };
    });
  return [
    ...cards,
    {
      id: CUSTOM,
      name: CUSTOM_NAME,
      detail: CUSTOM_DETAIL,
      short: CUSTOM_SHORT,
    },
  ];
}

// The panel's first line, at the reference builds' level.
export function leadText(presets = listPresets()) {
  const levels = presets
    .map(({ id }) => referenceBuild(id)?.talentLevel)
    .filter((level) => Number.isFinite(level));
  // TR-02 / #332: no selectable presets until #333; fall back to the page
  // default level so the Custom-only start screen still reads sensibly.
  const level =
    levels.length === 0 ? k("character.level") : Math.max(...levels);
  return `Each sets talents, weapons, poisons and the rotation for a level${"\u00a0"}${level} rogue.`;
}

// After a preset's pick, with no race chosen: its racial rules (Blood
// Fury, Berserking...) need one, so the line links to the Race select.
export function needsRace(state) {
  const pick = state.presetBuild?.applied?.pick ?? null;
  return (
    pick !== null && pick !== CUSTOM && (state.config?.race ?? null) === null
  );
}

// The starting point: { id, edited }.
export function startingPoint(state) {
  const presetId = presetOfChoice(state.form);
  const build = presetId === null ? null : referenceBuild(presetId);
  if (build === null) {
    return { id: CUSTOM, edited: false };
  }
  const parts = differingParts(buildDifferences(build, currentBuild(state)));
  const edited =
    parts.length > 0 || isEditedChoice(state.form, state.form.rotationChoice);
  return { id: presetId, edited };
}

// "Assassination", "Assassination · Edited", "Custom".
export const pointText = (name, edited) => `${name}${edited ? EDITED : ""}`;

// The model. `presetBuild` is js/preset-build.js's actions; `open` whether
// the panel starts open (opensFirst); `remember(value)` writes START_KEY
// (null forgets it), `remembered` what it held; `toList()` moves to the
// Character list, before a press on #character/start puts the build in,
// so Undo is on the page the press leaves. Returns { pick, undo, reset,
// restore }.
export function createStartPreset(
  store,
  presetBuild,
  {
    open: openAtFirst = false,
    remembered: rememberedAtFirst = null,
    remember = () => {},
    toList = () => {},
    cards: cardList = startCards(),
    lead = leadText(),
  } = {},
) {
  let open = openAtFirst;
  let remembered = rememberedAtFirst;
  // What Undo of a pick puts back: the panel's state before it.
  let undoes = null;
  let focusSeq = 0;

  const nameOfCard = (id) =>
    cardList.find((card) => card.id === id)?.name ?? id;

  function sliceOf(state, focus) {
    const point = startingPoint(state);
    return {
      open,
      lead,
      cards: cardList.map((card) => ({
        ...card,
        current: card.id === point.id,
        edited: card.id === point.id && point.edited,
      })),
      point: {
        id: point.id,
        text: pointText(nameOfCard(point.id), point.edited),
      },
      needsRace: needsRace(state),
      focus,
    };
  }

  function refresh(focus = store.get().start?.focus ?? null) {
    store.set({ start: sliceOf(store.get(), focus) });
  }

  const nextFocus = (target, id = null) => {
    focusSeq += 1;
    return { target, id, seq: focusSeq };
  };

  function setRemembered(value) {
    if (value !== remembered) {
      remembered = value;
      remember(value);
    }
  }

  // A card. Folds the panel; Custom is remembered, a preset forgets it.
  function pick(id) {
    const before = { open, remembered };
    const route = store.get().route;
    let changed = false;
    // Off #character/start first, so the line and Undo are on the list
    // (and Undo's page is the list's).
    if (route?.area === "character" && route?.sub === "start") {
      toList();
    }
    store.batch(() => {
      changed = presetBuild.pick(id, nameOfCard(id));
      open = false;
      setRemembered(id === CUSTOM ? CUSTOM_CHOSEN : null);
      undoes = changed ? { ...before, id } : null;
      // Nothing changed: no Undo, so the focus goes on (Custom: to Gear,
      // its next step; a preset: to the Starting point row).
      refresh(changed ? null : nextFocus(id === CUSTOM ? "gear" : "row"));
    });
    return changed;
  }

  // The pick's Undo: the build and rotation (js/preset-build.js), then the
  // panel as it was, and the focus back on the card when the cards show.
  function undo() {
    const last = undoes;
    undoes = null;
    let done = false;
    store.batch(() => {
      done = presetBuild.undo();
      if (done && last !== null) {
        open = last.open;
        setRemembered(last.remembered);
        const route = store.get().route;
        const cardsShow = open || route?.sub === "start";
        refresh(cardsShow ? nextFocus("card", last.id) : nextFocus("row"));
      }
    });
    return done;
  }

  // Reset to defaults: open again, Custom forgotten. Returns what restore
  // takes, for Reset's own Undo.
  function reset() {
    const before = { open, remembered };
    open = true;
    setRemembered(null);
    undoes = null;
    refresh();
    return before;
  }

  function restore(before) {
    open = before.open;
    setRemembered(before.remembered);
    refresh();
  }

  refresh(null);
  store.subscribe(({ changed }) => {
    if (changed.length === 1 && changed[0] === "start") {
      return;
    }
    if (
      ["config", "form", "talents", "presetBuild"].some((name) =>
        changed.includes(name),
      )
    ) {
      const state = store.get();
      const next = sliceOf(state, state.start?.focus ?? null);
      if (JSON.stringify(next) !== JSON.stringify(state.start)) {
        store.set({ start: next });
      }
    }
  });

  return { pick, undo, reset, restore };
}
