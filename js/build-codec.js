import { k } from "../data/constants.js";
import { pageDefaultConfig } from "./config-form.js";
import { normalizeConfig } from "./sim-config.js";
import { parseRunField } from "./views/run-model.js";

// A build as text (#284, H6-lite), the one encode/decode of the page's setup:
// the share link ("Copy link to this build") and the saved setup (#296,
// js/saved-setup.js, localStorage) both use it, so there is one format.
//
// A setup is { config, run }: config is the normalised sim config (character
// incl. haste, weapons, talents, talent level, poisons and the rotation; the
// target is always "from behind" on the page), run is the run type and its
// settings { mode, duration, iterations, seed }. seed may be null: the page
// draws one.
//
// The text is "<version>.<base64url JSON>", version SETUP_VERSION (1). The
// JSON is { config, run } with every field that equals the page default
// dropped (talents and the rotation are kept or dropped whole), so a default
// build is "1.e30". Reading fills what is missing from the defaults (G4) and
// checks the result with normalizeConfig and the run fields' own rules.
//
// Two ways to read (decodeSetup's `strict`):
//   strict (a share link): a newer version, or a field this version does not
//     know, is "newer" and loads nothing ("This link was made with a newer
//     version of the sim"); anything unreadable or invalid is "corrupt" and
//     loads nothing.
//   lenient (a saved setup, #296): unknown fields are ignored, a section that
//     does not check out reads as its default, and a newer or unreadable save
//     is the defaults. It never throws and never blocks the page's load.
//
// Which setup the page starts with is resolveInitialSetup's one order:
//   1. a share link (?s=) in the address, when it reads;
//   2. the saved setup (#296), when there is one;
//   3. the page defaults.
// So a link opened on load wins over a saved setup for that visit, and
// js/saved-setup.js then saves what loaded as the new setup.

export const SETUP_VERSION = 1;
export const LINK_PARAM = "s";

const RUN_MODES = Object.freeze(["batch", "live"]);
// Talents and the rotation are kept or dropped whole: a partial talent map or
// rotation means nothing on its own.
const WHOLE = new Set(["talents", "rotation"]);
// In Node, browsers and workers alike.
const { atob, btoa, TextDecoder, TextEncoder, URL, URLSearchParams } =
  globalThis;
const FORMAT = /^(\d+)\.([A-Za-z0-9_-]*)$/;

export function runDefaults() {
  return {
    mode: "batch",
    duration: k("batch.duration"),
    iterations: k("fight.iterations"),
    seed: null,
  };
}

export function setupDefaults() {
  return { config: pageDefaultConfig(), run: runDefaults() };
}

const isPlain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What differs from the defaults: plain objects field by field (whole for
// talents and the rotation), anything else by value.
function diff(value, base, whole = false) {
  if (!whole && isPlain(value) && isPlain(base)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!(key in base)) {
        out[key] = item;
        continue;
      }
      const changed = diff(item, base[key], WHOLE.has(key));
      if (changed !== undefined) out[key] = changed;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return same(value, base) ? undefined : value;
}

// A field the defaults do not have, anywhere outside talents and the rotation.
function hasUnknown(value, base) {
  if (!isPlain(value) || !isPlain(base)) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      !(key in base) || (!WHOLE.has(key) && hasUnknown(item, base[key])),
  );
}

// The defaults with `value` laid over them; unknown fields are left out.
function merge(base, value, whole = false) {
  if (whole || !isPlain(base)) return value === undefined ? base : value;
  if (value === undefined) return base;
  if (!isPlain(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(base)) {
    out[key] = merge(item, value[key], WHOLE.has(key));
  }
  return out;
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const checkConfig = (config) => {
  const normal = normalizeConfig(config);
  return { ...normal, target: { ...normal.target, behind: true } };
};

// The run settings, or null when one does not check out. A missing seed is
// null (the page draws one).
function checkRun(run) {
  if (!RUN_MODES.includes(run.mode)) return null;
  const out = { mode: run.mode };
  for (const name of ["duration", "iterations", "seed"]) {
    const value = run[name];
    if (name === "seed" && value === null) {
      out.seed = null;
      continue;
    }
    if (typeof value !== "number") return null;
    const parsed = parseRunField(name, String(value));
    if (parsed.error !== null) return null;
    out[name] = parsed.value;
  }
  return out;
}

// The setup as "1.<base64url JSON>".
export function encodeSetup(setup, defaults = setupDefaults()) {
  const payload = {};
  const config = diff(setup.config, defaults.config);
  const run = diff(setup.run, defaults.run);
  if (config !== undefined) payload.config = config;
  if (run !== undefined) payload.run = run;
  return `${SETUP_VERSION}.${toBase64Url(JSON.stringify(payload))}`;
}

// { status: "ok", setup } | { status: "newer" } | { status: "corrupt" }.
// Lenient reading always says "ok": what did not read is the defaults.
export function decodeSetup(
  text,
  { strict = true, defaults = setupDefaults() } = {},
) {
  const fallback = (status) =>
    strict ? { status } : { status: "ok", setup: defaults };
  const match = typeof text === "string" ? FORMAT.exec(text.trim()) : null;
  if (match === null) return fallback("corrupt");
  const [, version, body] = match;
  if (Number(version) > SETUP_VERSION) return fallback("newer");
  if (Number(version) !== SETUP_VERSION) return fallback("corrupt");
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(body));
  } catch {
    return fallback("corrupt");
  }
  if (!isPlain(payload)) return fallback("corrupt");
  return strict
    ? readStrict(payload, defaults)
    : readLenient(payload, defaults);
}

function readStrict(payload, defaults) {
  if (hasUnknown(payload, defaults)) return { status: "newer" };
  try {
    const config = checkConfig(merge(defaults.config, payload.config));
    const run = checkRun(merge(defaults.run, payload.run));
    return run === null
      ? { status: "corrupt" }
      : { status: "ok", setup: { config, run } };
  } catch {
    return { status: "corrupt" };
  }
}

// Section by section: each one that checks out (with those before it) is
// kept; the rest are the defaults.
function readLenient(payload, defaults) {
  let config = defaults.config;
  const given = isPlain(payload.config) ? payload.config : {};
  for (const section of Object.keys(defaults.config)) {
    if (given[section] === undefined) continue;
    const next = {
      ...config,
      [section]: merge(
        defaults.config[section],
        given[section],
        WHOLE.has(section),
      ),
    };
    try {
      config = checkConfig(next);
    } catch {
      // This section reads as its default.
    }
  }
  const run = { ...defaults.run };
  const givenRun = isPlain(payload.run) ? payload.run : {};
  for (const name of Object.keys(defaults.run)) {
    if (givenRun[name] === undefined) continue;
    const checked = checkRun({ ...run, [name]: givenRun[name] });
    if (checked !== null) Object.assign(run, checked);
  }
  return { status: "ok", setup: { config: checkConfig(config), run } };
}

// The setup the page holds: the store's config and its run settings.
export function setupFromState({ config, run }) {
  return {
    config,
    run: {
      mode: run.mode,
      duration: run.duration,
      iterations: run.iterations,
      seed: run.seed,
    },
  };
}

// The share link for a setup: the page's address with only ?s= in its query
// and no route, so it opens at the start.
export function shareUrl(href, setup, defaults = setupDefaults()) {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(LINK_PARAM, encodeSetup(setup, defaults));
  return url.href;
}

// The address with ?s= taken out (the rest of the query and the route kept),
// for history.replaceState once the link is read, so a reload does not apply
// it again over later edits.
export function withoutLinkParam(href) {
  const url = new URL(href);
  url.searchParams.delete(LINK_PARAM);
  return url.href;
}

// The page's first setup, in the order above. `search` is location.search;
// `saved` is the saved setup's text (#296) or null. notice is null, "loaded",
// "newer" or "corrupt" (the link's banner); hadLink says ?s= is to be taken
// out of the address.
export function resolveInitialSetup({
  search = "",
  saved = null,
  defaults = setupDefaults(),
} = {}) {
  const link = new URLSearchParams(search).get(LINK_PARAM);
  let notice = null;
  if (link !== null) {
    const read = decodeSetup(link, { strict: true, defaults });
    if (read.status === "ok") {
      return {
        setup: read.setup,
        source: "link",
        notice: "loaded",
        hadLink: true,
      };
    }
    notice = read.status;
  }
  const hadLink = link !== null;
  if (saved !== null && saved !== undefined) {
    const read = decodeSetup(saved, { strict: false, defaults });
    return { setup: read.setup, source: "saved", notice, hadLink };
  }
  return { setup: defaults, source: "defaults", notice, hadLink };
}
