// The stale state (#242, UX4; Fran's approved UX proposal §6). Plain data and
// plain functions: no DOM, so the tests run them in Node.
//
// The Results area keeps two results side by side, the average (batch) and
// the live fight, and the store's `ran` slice (js/run-actions.js) holds what
// each ran with. A kept result is out of date when the settings it ran with
// are not the settings now: the stats, the weapons, the talents, the poisons,
// the rotation or the target. The run fields (fight length, fights, seed) do
// not make it out of date: they are in the result's own label, and they are
// the next run's, not this one's.

const KINDS = Object.freeze(["batch", "live"]);

// What a config's parts are called in "You changed Attack power after this
// ran". The character's stats each have their own name; a part not named
// here is "the settings".
const STAT_NAMES = Object.freeze({
  attackPower: "Attack power",
  critChance: "Crit chance",
  bonusHitChance: "Hit chance",
  haste: "Haste",
});
const WEAPON_NAMES = Object.freeze({
  mainHand: "the main-hand weapon",
  offHand: "the off-hand weapon",
});
const PART_NAMES = Object.freeze({
  target: "the target",
  talents: "the talents",
  talentLevel: "the talents",
  poisons: "the poisons",
  rotation: "the rotation",
});
const OTHER = "the settings";
// More changes than this are "and other settings".
const MAX_NAMED = 2;

const NONE = 0;
const FIRST = 0;
const REST = 1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The kept result's record for a kind ("batch" or "live"), or null when
// there is no result of that kind to be out of date.
export function ranOf(state, kind) {
  const record = state.ran?.[kind] ?? null;
  if (record === null) {
    return null;
  }
  if (kind === "batch") {
    const result = state.batch?.result ?? null;
    return result !== null && result.completed > NONE ? record : null;
  }
  return state.run?.shown === true ? record : null;
}

// Whether the kept result of a kind ran with settings that are not today's.
export const isStale = (state, kind) => {
  const record = ranOf(state, kind);
  return record !== null && !same(record.config, state.config);
};

// The kinds whose kept result is out of date, average first.
export const staleKinds = (state) =>
  KINDS.filter((kind) => isStale(state, kind));

export const anyStale = (state) => staleKinds(state).length > NONE;

// The names of what changed between two configs, in the config's order and
// each once: ["Attack power", "the rotation"].
export function changedNames(before, after) {
  const names = [];
  const add = (name) => {
    if (!names.includes(name)) {
      names.push(name);
    }
  };
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const key of keys) {
    const a = before?.[key];
    const b = after?.[key];
    if (same(a, b)) {
      continue;
    }
    const parts =
      key === "character"
        ? STAT_NAMES
        : key === "weapons"
          ? WEAPON_NAMES
          : null;
    if (parts === null) {
      add(PART_NAMES[key] ?? OTHER);
      continue;
    }
    const inner = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const part of inner) {
      if (!same(a?.[part], b?.[part])) {
        add(parts[part] ?? OTHER);
      }
    }
  }
  return names;
}

// "Attack power", "Attack power and the rotation", "Attack power, the
// rotation and other settings".
export function namesText(names) {
  if (names.length === NONE) {
    return OTHER;
  }
  if (names.length > MAX_NAMED) {
    return `${names.slice(FIRST, MAX_NAMED).join(", ")} and other settings`;
  }
  return names.join(" and ");
}

const capital = (text) => text.charAt(FIRST).toUpperCase() + text.slice(REST);

// The 24-hour clock time a result ran at, "09:12", or null with no time.
const CLOCK_DIGITS = 2;
const pad = (value) => String(value).padStart(CLOCK_DIGITS, "0");
export function ranClock(at) {
  if (typeof at !== "number" || !Number.isFinite(at)) {
    return null;
  }
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The banner over an out-of-date result (proposal §6), or null when it is
// up to date: { title, detail, short }. `short` is the results column's
// card's one line. While Run is blocked the caller hands in the title that
// says what to fix (run-model.js staleFixTitle; #245): Run again cannot.
export const STALE_TITLE = "Out of date — Run again.";
export function staleBanner(state, kind, title = null) {
  if (!isStale(state, kind)) {
    return null;
  }
  const record = ranOf(state, kind);
  const names = namesText(changedNames(record.config, state.config));
  return {
    title: title ?? STALE_TITLE,
    detail: `You changed ${names} after this ran, so these numbers are for the old settings.`,
    short: `${capital(names)} changed after this ran.`,
  };
}

// What the Run bar's status says of an out-of-date result: "Out of date ·
// edited after the 09:12 run".
export function staleStatus(state, kind) {
  const clock = ranClock(ranOf(state, kind)?.at);
  return clock === null
    ? "Out of date · edited after this ran"
    : `Out of date · edited after the ${clock} run`;
}

// What #run-announce says once when a result goes out of date.
export const STALE_ANNOUNCEMENT = "Results out of date";
