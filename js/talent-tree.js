import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "./abilities.js";
import { ABILITY_DEFINITIONS } from "./ability-data.js";
import { talentLabel } from "./build-label.js";
import { iconUrl, talentIconUrl } from "./icons.js";
import { normalizeConfig } from "./sim-config.js";
import { snapshot } from "./snapshot.js";
import {
  DEFAULT_TALENT_LEVEL,
  buildProblems,
  pointsByTree,
  talentLevelRange,
  talentPointCap,
  why,
} from "./talent-build.js";
import { talentCatalogue } from "./talents.js";

// The talent tree picker's model (Phase 4, #204, roadmap task U6; Fran's spec
// in the U6 design folder). Everything the tree does except drawing it, in
// the pattern of the stats form (js/config-form.js, #151): no DOM and no
// clock, so it runs and is tested in Node. js/main.js makes one with the
// page's store and hands its actions to the view (js/views/talent-tree.js),
// which may not import the engine or the talent catalogue (eslint.config.js):
// the view draws the `talents` slice and calls these actions.
//
// The rules are #190's, never copied: whether a point may go in or come out
// is why() / buildProblems() from js/talent-build.js, which never throw, and
// the points are pointsByTree(). This module only words their answers with
// talent names. The row-gate numbers it shows come from k("talents.rowGating").
//
// One source of truth for the build: config.talents and config.talentLevel
// (#190). Every change that leaves a legal build writes both (through
// normalizeConfig). A build over the level's cap (the level was lowered)
// cannot be a config, so the config keeps the last legal build, the slice's
// `error` says why, and nextRunConfig() (js/config-form.js) returns null, so
// Run is off until the points or the level are fixed. Nothing is removed for
// the player. When the config changes from outside (the stats form's Reset or
// Undo), the tree takes its build. Nothing persists across reloads (#186).
//
// The `talents` slice:
//
//   open        whether the tree section is open (the summary row's button).
//   ranks       { talent id: rank } the tree shows, ranks above 0 only.
//   level       the talent level the cap comes from, 10 to 60.
//   levelText   what the Level field holds (it may be invalid).
//   levelError  the Level field's message, or null.
//   error       the over-cap message (Run is off while it is set), or null.
//   selected    the talent the detail pane shows, or null.
//   tab         the tree shown at narrow width, or null for the top tree.
//   message     null, { kind: "refused", text, blockers: [{ id, name, tree }] }
//               or { kind: "undo", text } (after Reset all).
//   announce    { text, count }: what the live region says after an action.
//               count moves on every announcement, so the same words repeat.
//   view        what the view draws, from talentTreeView().

const COVERAGE_NAMES = {
  simulated: "Simulated",
  noDps: "No DPS effect",
  notSimulated: "Not simulated yet",
};

const CLASSIC_TAGS = {
  changed: "Changed from Classic 1.12",
  moved: "Moved from Classic 1.12",
  new: "New in WoW Forever",
};

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// A chance as a percentage to one decimal: 0.03 is "3%". (Intl, so the
// engine-purity rule's no-literals check holds: no 100 here.)
const PERCENT = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 1,
});
export const percentText = (value) => PERCENT.format(value);

const rowsText = (row) => (row - 1 === 1 ? "row 1" : `rows 1–${row - 1}`);

// The points a talent on `row` needs on the rows above it, in its tree.
export function rowGate(row) {
  return k("talents.rowGating") * (row - 1);
}

function classicOf(source) {
  const found = new Map();
  for (const tree of source?.talents?.trees ?? []) {
    for (const talent of tree.talents ?? []) {
      found.set(`${tree.name}/${talent.name}`, talent.classic ?? null);
    }
  }
  return found;
}

// A stat a talent adds to every attack (no scope or condition), by rank:
// { critChance: [..], hitChance: [..] }. Scoped modifiers are per ability and
// not listed (spec section 5).
function statBonuses(effect) {
  const stats = {};
  for (const modifier of effect?.modifiers ?? []) {
    const plain =
      modifier.op === "add" &&
      modifier.scope === undefined &&
      modifier.condition === undefined &&
      modifier.when === undefined;
    if (
      plain &&
      (modifier.kind === "critChance" || modifier.kind === "hitChance")
    ) {
      stats[modifier.kind] = modifier.values;
    }
  }
  return stats;
}

// What the tree knows of each talent besides its rank, worked out once:
// coverage (data/talent-effects.js: no entry is "not simulated yet"), the
// ability it grants, the Classic 1.12 difference, and the icon URL.
export function talentInfo({
  catalogue = talentCatalogue,
  effects = TALENT_EFFECTS,
  abilities = abilityCatalogue,
  definitions = ABILITY_DEFINITIONS,
  source = snapshot,
} = {}) {
  const simulatedAbilities = new Set(definitions.map(({ id }) => id));
  const classic = classicOf(source);
  const abilityName = (id) => abilities.get(id)?.name ?? id;
  const info = new Map();
  for (const tree of catalogue.trees) {
    for (const talent of tree.talents) {
      const effect = effects[talent.id];
      const coverage =
        effect === undefined
          ? "notSimulated"
          : typeof effect.noDpsEffect === "string"
            ? "noDps"
            : "simulated";
      const slug = talent.id.slice(talent.id.indexOf(".") + 1);
      const active = !talent.passive;
      const grants =
        typeof effect?.ability === "string" ? effect.ability : null;
      const own = active && grants === null ? slug : null;
      info.set(talent.id, {
        ...talent,
        treeName: tree.name,
        iconUrl: talentIconUrl(talent),
        coverage,
        noDpsReason: coverage === "noDps" ? effect.noDpsEffect : null,
        ability:
          grants === null ? null : { id: grants, name: abilityName(grants) },
        // An active talent whose ability the sim does not have (Mutilate).
        noAbility:
          own !== null && !simulatedAbilities.has(own) && coverage !== "noDps"
            ? talent.name
            : null,
        classic: classic.get(`${tree.name}/${talent.name}`) ?? null,
        stats: statBonuses(effect),
      });
    }
  }
  return info;
}

function rankOf(ranks, id) {
  return ranks[id] ?? 0;
}

function pointsAbove(ranks, tree, row) {
  return tree.talents
    .filter((talent) => talent.row < row)
    .reduce((sum, talent) => sum + rankOf(ranks, talent.id), 0);
}

// Why a point can't go into `id`, worded for the player, or null. The lock
// (row gate first, then the prerequisite, as the tile shows it) comes from
// buildProblems() on the build with the point added; the rest is why().
function addRefusal(ranks, id, level, info, catalogue) {
  const talent = info.get(id);
  const rank = rankOf(ranks, id);
  if (rank >= talent.max) {
    return {
      code: "maxRank",
      text: `${talent.name} is at ${talent.max} of ${talent.max}.`,
    };
  }
  const lock = lockOf(ranks, id, info, catalogue);
  if (lock !== null) {
    return lock;
  }
  const refused = why(ranks, id, "add", { level }, catalogue);
  if (refused === null) {
    return null;
  }
  if (refused.code === "capReached") {
    const cap = talentPointCap(level);
    return {
      code: refused.code,
      text:
        refused.have > cap
          ? `No points left: ${refused.have} spent, and level ${level} gives ${cap}.`
          : `No points left: level ${level} gives ${cap}.`,
    };
  }
  return { code: refused.code, text: refused.message };
}

// The row gate or prerequisite that keeps `id` from its next point, whatever
// the level, or null.
function lockOf(ranks, id, info, catalogue) {
  const talent = info.get(id);
  const next = { ...ranks, [id]: rankOf(ranks, id) + 1 };
  const problems = buildProblems(
    next,
    { level: DEFAULT_TALENT_LEVEL },
    catalogue,
  ).filter((problem) => problem.talent === id);
  const gate = problems.find((problem) => problem.code === "rowGate");
  if (gate !== undefined) {
    return {
      code: "rowGate",
      text: `Needs ${gate.need} points in ${talent.treeName} ${rowsText(talent.row)} (${gate.have} spent).`,
    };
  }
  const req = problems.find((problem) => problem.code === "prerequisite");
  if (req !== undefined) {
    const before = info.get(talent.req);
    return {
      code: "prerequisite",
      text: `Needs ${before.name} at ${before.max} of ${before.max} (${rankOf(ranks, before.id)} now).`,
      blockers: [before.id],
    };
  }
  return null;
}

// Why a point can't come out of `id`, worded for the player, or null:
// "Can't remove a point from Malice: Ruthlessness (row 2) needs 5 points in
// row 1, and this would leave 4. Remove points from row 2 or below first."
function removeRefusal(ranks, id, level, info, catalogue) {
  const talent = info.get(id);
  const refused = why(ranks, id, "remove", { level }, catalogue);
  if (refused === null) {
    return null;
  }
  if (refused.code === "notTaken") {
    return {
      code: refused.code,
      text: `${talent.name} has no points.`,
      blockers: [],
    };
  }
  if (refused.code !== "strands") {
    return { code: refused.code, text: refused.message, blockers: [] };
  }
  const first = info.get(refused.talent);
  const after = { ...ranks, [id]: rankOf(ranks, id) - 1 };
  const isPrerequisite =
    first.req === id &&
    buildProblems(after, { level }, catalogue).some(
      (problem) =>
        problem.talent === first.id && problem.code === "prerequisite",
    ) &&
    refused.need === talent.max;
  const reason = isPrerequisite
    ? `${first.name} needs ${talent.name} at ${talent.max} of ${talent.max}. Remove ${first.name} first.`
    : `${first.name} (row ${first.row}) needs ${refused.need} points in ${rowsText(first.row)}, and this would leave ${refused.have}. Remove points from row ${first.row} or below first.`;
  const others = refused.blockers.filter((other) => other !== first.id);
  const more =
    others.length > 0
      ? ` It would also strand ${others.map((other) => info.get(other).name).join(", ")}.`
      : "";
  return {
    code: refused.code,
    text: `Can't remove a point from ${talent.name}: ${reason}${more}`,
    blockers: refused.blockers,
  };
}

function cellState(ranks, id, level, info, catalogue) {
  const talent = info.get(id);
  const rank = rankOf(ranks, id);
  if (rank >= talent.max) {
    return { state: "maxed", lock: null };
  }
  const lock = lockOf(ranks, id, info, catalogue);
  if (rank > 0) {
    return { state: "partial", lock: null };
  }
  if (lock !== null) {
    return { state: "locked", lock };
  }
  const refused = why(ranks, id, "add", { level }, catalogue);
  return { state: refused?.code === "capReached" ? "nopoints" : "open", lock };
}

// "30 of 31 spent, 1 left" or "51 spent, 20 over the 31 that level 40 gives".
export function pointsLine(total, cap, level) {
  return total > cap
    ? `${total} spent, ${total - cap} over the ${cap} that level ${level} gives`
    : `${total} of ${cap} spent, ${cap - total} left`;
}

function topTree(points, catalogue) {
  let best = catalogue.trees[0].id;
  for (const tree of catalogue.trees) {
    if (points[tree.id] > points[best]) {
      best = tree.id;
    }
  }
  return best;
}

function detailOf(ranks, id, level, info, catalogue) {
  const talent = info.get(id);
  if (talent === undefined) {
    return null;
  }
  const tree = catalogue.trees.find(({ id: treeId }) => treeId === talent.tree);
  const rank = rankOf(ranks, id);
  const add = addRefusal(ranks, id, level, info, catalogue);
  const remove = removeRefusal(ranks, id, level, info, catalogue);
  const requirements = [];
  if (talent.row > 1) {
    const need = rowGate(talent.row);
    const have = pointsAbove(ranks, tree, talent.row);
    requirements.push({
      met: have >= need,
      text: `${need} points in ${tree.name} ${rowsText(talent.row)} (${have} spent)`,
    });
  }
  if (talent.req !== null && talent.req !== undefined) {
    const before = info.get(talent.req);
    requirements.push({
      met: rankOf(ranks, before.id) >= before.max,
      text: `${before.name} at ${before.max} of ${before.max} (${rankOf(ranks, before.id)} now)`,
    });
  }
  for (const after of tree.talents.filter((other) => other.req === id)) {
    requirements.push({
      met: null,
      text: `Unlocks ${after.name} at ${talent.max} of ${talent.max}`,
    });
  }
  const notes = [];
  if (talent.ability !== null) {
    notes.push({
      strong: `Grants ${talent.ability.name}.`,
      text:
        rank > 0
          ? "The rotation can cast it now."
          : `Without this talent the rotation skips ${talent.ability.name}.`,
    });
  }
  if (talent.noAbility !== null) {
    notes.push({
      strong: "",
      text: `The sim has no ${talent.noAbility} ability yet, so taking it adds nothing.`,
    });
  }
  const classic = talent.classic;
  const classicText =
    classic !== null && classic.status !== "same" && classic.text
      ? `${classic.text}${classic.renamed ? ` (was ${classic.renamed})` : ""}${classic.note ? ` Forever: ${classic.note}.` : ""}`
      : null;
  let block = null;
  if (remove !== null && rank > 0) {
    block = remove.text;
  } else if (add !== null && add.code !== "maxRank") {
    block = `Can't add: ${add.text}`;
  }
  return {
    id,
    name: talent.name,
    iconUrl: talent.iconUrl,
    tree: talent.tree,
    sub: `${tree.name}, row ${talent.row} · rank ${rank} of ${talent.max}${talent.passive ? "" : " · ability"}`,
    rank,
    max: talent.max,
    rankText: `${rank}/${talent.max}`,
    coverage: talent.coverage,
    coverageTag:
      talent.coverage === "notSimulated"
        ? null
        : COVERAGE_NAMES[talent.coverage],
    classicTag:
      classic === null ? null : (CLASSIC_TAGS[classic.status] ?? null),
    noDpsReason: talent.noDpsReason,
    now:
      rank > 0
        ? { label: `Now (rank ${rank})`, text: talent.ranks[rank - 1] }
        : null,
    next:
      rank < talent.max
        ? { label: `Next (rank ${rank + 1})`, text: talent.ranks[rank] }
        : null,
    requirements,
    notes,
    classicText,
    block,
    canAdd: add === null,
    canRemove: remove === null,
    addLabel: `Add a point to ${talent.name}`,
    removeLabel: `Remove a point from ${talent.name}`,
  };
}

// The rules of the rotation that cast a talent's ability, and whether this
// build lets them, by the engine's own test (Rogue.lockedByBuild): a talent
// ability casts only with its talent, with no points spent too (no talents
// is untalented, #199). Like the rotation preview it knows no host grants:
// see js/rotation-skips.js talentState.
function rotationLines(ranks, rotation, info) {
  const granting = new Map();
  for (const talent of info.values()) {
    if (talent.ability !== null) {
      granting.set(talent.ability.id, talent);
    }
  }
  const lines = [];
  (rotation?.rules ?? []).forEach((rule, index) => {
    const talent = granting.get(rule.action);
    if (talent === undefined) {
      return;
    }
    const casts = rankOf(ranks, talent.id) > 0;
    lines.push({
      ok: casts,
      name: talent.ability.name,
      text: casts
        ? ` · rule ${index + 1} casts it`
        : ` · rule ${index + 1} skipped: no ${talent.name} talent`,
    });
  });
  return lines;
}

// With no points spent the fight is untalented (#199): the engine skips
// every talent ability the rotation lists (Blade Flurry, Adrenaline Rush and
// Cold Blood, in the default rotation).
// The verb follows the skipped rules, not the names: one ability in two rules
// is "rules need".
function emptyBuildNote(lines) {
  const skippedRules = lines.filter(({ ok }) => !ok);
  const skipped = [...new Set(skippedRules.map(({ name }) => name))];
  const need = skippedRules.length === 1 ? "rule needs" : "rules need";
  const names =
    skipped.length > 1
      ? `${skipped.slice(0, -1).join(", ")} and ${skipped.at(-1)}`
      : skipped.join("");
  return skipped.length > 0
    ? `With no talents picked, the fight is untalented: the sim skips ${names}, whose ${need} the talent.`
    : "With no talents picked, the fight is untalented.";
}

function effectsOf(ranks, total, config, info) {
  const picked = [...info.values()].filter(
    (talent) => rankOf(ranks, talent.id) > 0,
  );
  let crit = 0;
  let hit = 0;
  const bits = [];
  for (const talent of picked) {
    const rank = rankOf(ranks, talent.id);
    const where = `(${talent.name} ${rank}/${talent.max})`;
    if (talent.stats.critChance) {
      crit += talent.stats.critChance[rank - 1];
      bits.push(
        `+${percentText(talent.stats.critChance[rank - 1])} crit ${where}`,
      );
    }
    if (talent.stats.hitChance) {
      hit += talent.stats.hitChance[rank - 1];
      bits.push(
        `+${percentText(talent.stats.hitChance[rank - 1])} hit ${where}`,
      );
    }
  }
  const character = config?.character ?? {};
  const baseCrit = Number(character.critChance ?? 0);
  const baseHit = Number(character.bonusHitChance ?? 0);
  const notSimulated = picked.filter(
    (talent) => talent.coverage === "notSimulated",
  );
  const noDps = picked.filter((talent) => talent.coverage === "noDps");
  const lines = rotationLines(ranks, config?.rotation, info);
  const rotationName =
    typeof config?.rotation?.name === "string" && config.rotation.name !== ""
      ? config.rotation.name
      : "Default rotation";
  return {
    stats: {
      text: `Enter crit and hit under Character without talent bonuses. ${bits.length > 0 ? `This build adds ${bits.join(", ")}.` : "This build adds no crit or hit."}`,
      sheet: `With your Character fields (${percentText(baseCrit)} crit, ${percentText(baseHit)} hit) the fight uses ${percentText(baseCrit + crit)} crit and ${percentText(baseHit + hit)} hit.`,
    },
    rotation: {
      title: `Rotation: ${rotationName}`,
      lines,
      note: total === 0 ? emptyBuildNote(lines) : null,
    },
    coverage: {
      plain:
        notSimulated.length === 0 && noDps.length === 0
          ? picked.length > 0
            ? "Every talent in this build is simulated."
            : "No talents picked."
          : null,
      notSimulated:
        notSimulated.length > 0
          ? `Not simulated yet: ${notSimulated.map(({ name }) => name).join(", ")} (${notSimulated.length}). Their points add no DPS.`
          : null,
      noDps:
        noDps.length > 0
          ? {
              strong: `${noDps.length} no DPS effect: `,
              text: `${noDps.map(({ name }) => name).join(", ")}.`,
            }
          : null,
    },
  };
}

// Everything the view draws for one build: pure, so the tests walk every
// state through it. `config` gives the Character fields and the rotation.
export function talentTreeView(
  ranks,
  level,
  {
    selected = null,
    tab = null,
    config = null,
    info,
    catalogue = talentCatalogue,
  },
) {
  const points = pointsByTree(ranks, catalogue);
  const total = points.total;
  const cap = talentPointCap(level);
  const over = total > cap;
  const top = topTree(points, catalogue);
  const trees = catalogue.trees.map((tree) => {
    const treePoints = points[tree.id];
    const rows = Math.max(...tree.talents.map((talent) => talent.row));
    const gutters = [];
    for (let row = 1; row <= rows; row += 1) {
      gutters.push({
        row,
        need: rowGate(row),
        met: pointsAbove(ranks, tree, row) >= rowGate(row),
      });
    }
    const arrows = tree.talents
      .filter((talent) => talent.req !== null && talent.req !== undefined)
      .map((talent) => {
        const before = info.get(talent.req);
        return {
          col: talent.col,
          fromRow: before.row,
          toRow: talent.row,
          lit: rankOf(ranks, before.id) >= before.max,
        };
      });
    const cells = tree.talents.map((talent) => {
      const known = info.get(talent.id);
      const rank = rankOf(ranks, talent.id);
      const { state, lock } = cellState(
        ranks,
        talent.id,
        level,
        info,
        catalogue,
      );
      const parts = [`${talent.name}, ${rank} of ${talent.max}`];
      if (state === "locked") {
        parts.push(`locked: ${lock.text.replace(/\.$/, "")}`);
      }
      if (state === "nopoints") {
        parts.push("no points left");
      }
      if (known.coverage !== "simulated") {
        parts.push(COVERAGE_NAMES[known.coverage].toLowerCase());
      }
      if (!talent.passive) {
        parts.push("ability");
      }
      return {
        id: talent.id,
        name: talent.name,
        row: talent.row,
        col: talent.col,
        rank,
        max: talent.max,
        rankText: `${rank}/${talent.max}`,
        state,
        coverage: known.coverage,
        active: !talent.passive,
        iconUrl: known.iconUrl,
        label: parts.join(", "),
        selected: talent.id === selected,
      };
    });
    return {
      id: tree.id,
      name: tree.name,
      iconUrl: iconUrl(tree.icon),
      points: treePoints,
      pointsText: plural(treePoints, "point"),
      label: `${tree.name} talents, ${plural(treePoints, "point")}`,
      gutters,
      arrows,
      cells,
    };
  });
  const left = cap - total;
  return {
    summary: talentLabel(ranks, level, { catalogue }),
    total,
    cap,
    over,
    pill: over ? `⚠ ${total - cap} over` : `${left} left`,
    pointsLine: pointsLine(total, cap, level),
    errorBanner: over
      ? {
          strong: `${plural(total, "point")} spent, but level ${level} gives ${cap}.`,
          text: ` Remove ${plural(total - cap, "point")} or raise the level. Run is off until then; nothing was removed for you.`,
        }
      : null,
    note:
      !over && total > 0 && left > 0
        ? `${plural(left, "point")} unspent. That's fine: partial builds run as they are.`
        : null,
    topTree: top,
    tab: tab ?? top,
    trees,
    detail:
      selected === null
        ? null
        : detailOf(ranks, selected, level, info, catalogue),
    effects: effectsOf(ranks, total, config, info),
  };
}

function cleanRanks(ranks) {
  return Object.fromEntries(
    Object.entries(ranks ?? {})
      .filter(([, rank]) => rank > 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function buildKey(talents, level) {
  return JSON.stringify([cleanRanks(talents), level ?? DEFAULT_TALENT_LEVEL]);
}

// The Level field's text read: { level, error }; level is null when it is
// not a whole number in the range.
export function parseLevel(text) {
  const { min, max } = talentLevelRange();
  const trimmed = String(text).trim();
  const level = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return level >= min && level <= max
    ? { level, error: null }
    : { level: null, error: `Enter a level from ${min} to ${max}.` };
}

// The actions the view calls. Creating the model fills the `talents` slice
// from the store's config.
export function createTalentTree(
  store,
  { catalogue = talentCatalogue, info = talentInfo({ catalogue }) } = {},
) {
  let saved = null;
  let count = 0;
  let written = null;

  const slice = () => store.get().talents;

  function viewOf(next, config = store.get().config) {
    return talentTreeView(next.ranks, next.level, {
      selected: next.selected,
      tab: next.tab,
      config,
      info,
      catalogue,
    });
  }

  function announce(text) {
    count += 1;
    return { text, count };
  }

  // Write `next` as the slice; when its build is legal at its level, write
  // the config too.
  function commit(next, text = null) {
    const legal =
      buildProblems(next.ranks, { level: next.level }, catalogue).length === 0;
    const state = store.get();
    let config = state.config;
    if (legal) {
      const key = buildKey(next.ranks, next.level);
      if (key !== buildKey(config.talents, config.talentLevel)) {
        config = normalizeConfig({
          ...config,
          talents: { ...next.ranks },
          talentLevel: next.level,
        });
      }
      written = key;
    }
    const view = viewOf(next, config);
    const talents = {
      ...next,
      error: legal ? null : view.errorBanner.strong,
      announce: text === null ? next.announce : announce(text),
      view,
    };
    store.batch(() => {
      store.set({ talents });
      if (config !== state.config) {
        store.set({ config });
      }
    });
  }

  function fromConfig(config, base = {}) {
    const level = config.talentLevel ?? DEFAULT_TALENT_LEVEL;
    written = buildKey(config.talents, level);
    const next = {
      open: false,
      selected: null,
      tab: null,
      announce: { text: "", count },
      ...base,
      ranks: cleanRanks(config.talents),
      level,
      levelText: String(level),
      levelError: null,
      levelRange: talentLevelRange(),
      message: null,
    };
    return { ...next, error: null, view: viewOf(next, config) };
  }

  store.set({ talents: fromConfig(store.get().config) });

  // The config changed: from outside (the stats form's Reset or Undo), take
  // its build; from a field, redraw the effects box.
  store.subscribe(({ state, changed }) => {
    if (!changed.includes("config")) {
      return;
    }
    const { config, talents } = state;
    if (buildKey(config.talents, config.talentLevel) !== written) {
      saved = null;
      store.set({
        talents: fromConfig(config, {
          open: talents.open,
          selected: talents.selected,
          tab: talents.tab,
          announce: talents.announce,
        }),
      });
    } else {
      store.set({ talents: { ...talents, view: viewOf(talents, config) } });
    }
  });

  const nameOf = (id) => info.get(id).name;
  const treeOf = (id) => info.get(id).tree;

  function after(next, id) {
    const view = viewOf(next);
    const talent = info.get(id);
    const tree = view.trees.find(({ id: treeId }) => treeId === talent.tree);
    return `${talent.name} ${rankOf(next.ranks, id)} of ${talent.max}. ${tree.name} ${tree.pointsText}. ${view.pointsLine}.`;
  }

  function known(id) {
    if (!info.has(id)) {
      throw new RangeError(`No talent ${JSON.stringify(id)}.`);
    }
  }

  return {
    // The summary row's Edit talents / Close talents.
    setOpen(open) {
      store.set({ talents: { ...slice(), open: Boolean(open) } });
    },
    toggle() {
      store.set({ talents: { ...slice(), open: !slice().open } });
    },
    // A tile took focus: the detail pane shows it.
    select(id) {
      known(id);
      if (slice().selected === id) {
        return;
      }
      const next = { ...slice(), selected: id };
      store.set({ talents: { ...next, view: viewOf(next) } });
    },
    // The narrow tabs.
    chooseTab(treeId) {
      if (!catalogue.trees.some(({ id }) => id === treeId)) {
        throw new RangeError(`No talent tree ${JSON.stringify(treeId)}.`);
      }
      const next = { ...slice(), tab: treeId };
      store.set({ talents: { ...next, view: viewOf(next) } });
    },
    // A refused removal's "Show <talent>": its tree's tab and its detail.
    show(id) {
      known(id);
      const next = { ...slice(), selected: id, tab: treeOf(id) };
      store.set({ talents: { ...next, view: viewOf(next) } });
    },
    // One point in. Returns whether it went in; a refusal is announced and
    // drawn in the detail pane, not as a banner.
    add(id) {
      known(id);
      saved = null;
      const current = slice();
      const refused = addRefusal(
        current.ranks,
        id,
        current.level,
        info,
        catalogue,
      );
      if (refused !== null) {
        commit(
          { ...current, selected: id, message: null },
          `Can't add to ${nameOf(id)}: ${refused.text}`,
        );
        return false;
      }
      const ranks = cleanRanks({
        ...current.ranks,
        [id]: rankOf(current.ranks, id) + 1,
      });
      const next = { ...current, ranks, selected: id, message: null };
      commit(next, after(next, id));
      return true;
    },
    // One point out. A removal that would strand a talent is refused with a
    // banner that names the fix and offers "Show" for each talent in the way.
    remove(id) {
      known(id);
      saved = null;
      const current = slice();
      const refused = removeRefusal(
        current.ranks,
        id,
        current.level,
        info,
        catalogue,
      );
      if (refused !== null) {
        const message =
          refused.code === "strands"
            ? {
                kind: "refused",
                text: refused.text,
                blockers: refused.blockers.map((blocker) => ({
                  id: blocker,
                  name: nameOf(blocker),
                  tree: treeOf(blocker),
                })),
              }
            : null;
        commit({ ...current, selected: id, message }, refused.text);
        return false;
      }
      const ranks = cleanRanks({
        ...current.ranks,
        [id]: rankOf(current.ranks, id) - 1,
      });
      const next = { ...current, ranks, selected: id, message: null };
      commit(next, after(next, id));
      return true;
    },
    // The Level field, committed. An invalid level keeps the last valid one
    // (and its cap) and shows the field's error.
    setLevel(text) {
      saved = null;
      const current = slice();
      const { level, error } = parseLevel(text);
      if (level === null) {
        commit({ ...current, levelText: String(text), levelError: error });
        return false;
      }
      const next = {
        ...current,
        level,
        levelText: String(level),
        levelError: null,
        message: null,
      };
      const view = viewOf(next);
      commit(
        next,
        `Level ${level}: ${view.cap} talent points. ${view.pointsLine}.`,
      );
      return true;
    },
    // Every point out, with Undo until anything else is done.
    resetAll() {
      const current = slice();
      const total = pointsByTree(current.ranks, catalogue).total;
      if (total === 0) {
        commit({ ...current, message: null }, "No talent points to remove.");
        return false;
      }
      const next = {
        ...current,
        ranks: {},
        message: {
          kind: "undo",
          text: `Removed all ${plural(total, "point")}.`,
        },
      };
      commit(next, `All talents removed. ${viewOf(next).pointsLine}.`);
      saved = current.ranks;
      return true;
    },
    undo() {
      if (saved === null) {
        return false;
      }
      const ranks = saved;
      saved = null;
      const next = { ...slice(), ranks, message: null };
      commit(next, `Talents restored. ${viewOf(next).pointsLine}.`);
      return true;
    },
  };
}
