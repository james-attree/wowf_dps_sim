import {
  fieldErrors,
  formErrorCount,
  rotationErrorCount,
  talentErrorCount,
} from "./run-model.js";

// The page's areas and the sections in them (#239, Phase 4.5 UX1; Fran's
// approved UX proposal, §3 and §4). Plain data and plain functions: no DOM,
// so the tests run them in Node. js/views/router.js shows one area at a time
// and draws the nav from them; js/main.js registers the page's sections.
//
// Four areas, in the nav's order. Character is the default route.
export const AREAS = Object.freeze([
  Object.freeze({ id: "character", label: "Character" }),
  Object.freeze({ id: "rotation", label: "Rotation" }),
  Object.freeze({ id: "fight", label: "Fight" }),
  Object.freeze({ id: "results", label: "Results" }),
]);

export const DEFAULT_AREA = "character";

export const areaIds = () => AREAS.map((area) => area.id);
export const isArea = (id) => AREAS.some((area) => area.id === id);
export const areaLabel = (id) =>
  AREAS.find((area) => area.id === id)?.label ?? null;

const NO_STATUS = Object.freeze({ errors: 0, warnings: 0, edited: false });

// A section's status (proposal §4): its errors, its warnings and whether it
// was edited. The errors follow Run's one blocked count (#237): every setting
// that blocks Run is in exactly one section, so the areas' errors add up to
// blockedCount (the equality test in test/sections.test.js). `edited` is
// false for now: the stale state is UX4's (#242).
const status = (errors, warnings = 0) => ({ errors, warnings, edited: false });

// The stats form: its fields' errors, as the form's footer counts them.
export const formStatus = (state) => status(formErrorCount(state.form));

// The talent tree: a build over its level's cap is one setting to fix.
export const talentStatus = (state) => status(talentErrorCount(state));

// The rotation: a draft with errors is one setting to fix (Scout, 29 Oct);
// its warnings only count when it has no errors, as the builder shows them.
export const rotationStatus = (state) => {
  const errors = rotationErrorCount(state);
  const warnings =
    errors === 0 ? (state.form?.rotationWarnings?.length ?? 0) : 0;
  return status(errors, warnings);
};

// The fight's settings: the run bar's fields with an error in this mode
// (fights only count in batch mode, as Run counts them).
export const fightStatus = (state) => status(fieldErrors(state.run).length);

// Results hold nothing to fix.
export const resultsStatus = () => NO_STATUS;

// No chip summaries yet: the areas' summary rows come with the dock (UX2,
// #240) and the Character rows (UX6, #244). A section's summary is null until then.
const noSummary = () => null;

// The page's sections, without their render (js/main.js adds it). Their
// order in an area is their order in this list.
const PAGE_LIST = [
  {
    id: "setup",
    label: "Fight setup",
    area: "character",
    summary: noSummary,
    status: formStatus,
  },
  {
    id: "talents",
    label: "Talents",
    area: "character",
    summary: noSummary,
    status: talentStatus,
  },
  {
    id: "rotation",
    label: "Rotation",
    area: "rotation",
    summary: noSummary,
    status: rotationStatus,
  },
  {
    id: "fight",
    label: "Fight",
    area: "fight",
    summary: noSummary,
    status: fightStatus,
  },
  {
    id: "results",
    label: "Results",
    area: "results",
    summary: noSummary,
    status: resultsStatus,
  },
];

export const PAGE_SECTIONS = Object.freeze(
  PAGE_LIST.map((section, order) => Object.freeze({ ...section, order })),
);

const FUNCTIONS = ["summary", "status", "render"];

// A registry of sections: registerSection({ id, label, area, order, summary,
// status, render }), where summary(state) is a line or null, status(state)
// is { errors, warnings, edited } and render(el, store, actions) draws the
// section into its area's element and returns its unmount function.
export function createSections() {
  const sections = [];

  function registerSection(section) {
    const { id, label, area, order } = section ?? {};
    if (typeof id !== "string" || id === "") {
      throw new TypeError("A section needs an id.");
    }
    if (sections.some((other) => other.id === id)) {
      throw new Error(`Section "${id}" is already registered.`);
    }
    if (typeof label !== "string" || label === "") {
      throw new TypeError(`Section "${id}" needs a label.`);
    }
    if (!isArea(area)) {
      throw new RangeError(`Section "${id}" has no area "${area}".`);
    }
    if (!Number.isFinite(order)) {
      throw new TypeError(`Section "${id}" needs a number order.`);
    }
    for (const name of FUNCTIONS) {
      if (typeof section[name] !== "function") {
        throw new TypeError(`Section "${id}" needs a ${name} function.`);
      }
    }
    sections.push(Object.freeze({ ...section }));
    return sections.at(-1);
  }

  // The sections of an area, in their order.
  const inArea = (area) =>
    sections
      .filter((section) => section.area === area)
      .sort((a, b) => a.order - b.order);

  // An area's status: its sections' errors and warnings added up, and
  // whether any was edited.
  function areaStatus(state, area) {
    return inArea(area).reduce(
      (total, section) => {
        const own = section.status(state);
        return {
          errors: total.errors + own.errors,
          warnings: total.warnings + own.warnings,
          edited: total.edited || own.edited,
        };
      },
      { ...NO_STATUS },
    );
  }

  // Every area's errors added up: Run's blocked count when every section
  // that blocks Run is registered.
  const totalErrors = (state) =>
    areaIds().reduce((sum, area) => sum + areaStatus(state, area).errors, 0);

  return {
    registerSection,
    inArea,
    areaStatus,
    totalErrors,
    all: () => [...sections],
  };
}

// The nav badge's hidden words (proposal §5): "2 errors", "1 warning". The
// errors win: an area with an error shows only its errors. Null for none.
export function badgeOf(status) {
  if (status.errors > 0) {
    return { count: status.errors, words: plural(status.errors, "error") };
  }
  if (status.warnings > 0) {
    return {
      count: status.warnings,
      words: plural(status.warnings, "warning"),
    };
  }
  return null;
}

const plural = (count, word) => (count === 1 ? word : `${word}s`);

// An element asks for its area to be shown before it is focused: a view
// that moves focus to a control in another area (the Run bar's Fix link to a
// stats form field, say) calls reveal(control) first. js/views/router.js
// listens for it and shows the area the control is in.
export const REVEAL_EVENT = "section-reveal";

export function reveal(node) {
  const win = node?.ownerDocument?.defaultView;
  if (typeof win?.CustomEvent !== "function") {
    return;
  }
  node.dispatchEvent(new win.CustomEvent(REVEAL_EVENT, { bubbles: true }));
}
