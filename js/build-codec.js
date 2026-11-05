import { k } from "../data/constants.js";
import { pageDefaultConfig } from "./config-form.js";
import { normalizeConfig } from "./sim-config.js";
import { validateBuild } from "./talent-build.js";
import { LINK_VERSION, decodeLinkBody, encodeLinkBody } from "./link-codec.js";
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
// The share link is version 2 (#306), a short binary body against a base
// (the defaults or a preset): js/link-codec.js. The saved setup stays
// version 1, below, and decodeSetup reads both (old ?s=1. links too).
//
// Version 1's text is "<version>.<base64url JSON>", SETUP_VERSION (1). The
// JSON is { config, run } with every field that equals the page default
// dropped (talents and the rotation are kept or dropped whole), so a default
// build is "1.e30". Reading fills what is missing from the defaults (G4) and
// checks the result with normalizeConfig and the run fields' own rules.
//
// Two ways to read (decodeSetup's `strict`):
//   strict (a share link): a newer version, or a field this version does not
//     know, is "newer" and loads nothing ("This link was made with a newer
//     version of the sim"); bytes that do not read are "corrupt"; a setup
//     the live catalogue refuses (unknown talent, rank over max, row gates /
//     prerequisites, unknown rotation action, or an old SETUP_ERA) is
//     "invalid" (#331) and loads nothing, with no banner (James 5 Nov 2026).
//   lenient (a saved setup, #296): unknown fields are ignored; a soft field
//     error recovers that field (#326); a catalogue refusal discards the
//     whole save and is the defaults (#331). A newer or unreadable save is
//     the defaults. It never throws and never blocks the page's load.
//
// Which setup the page starts with is resolveInitialSetup's one order:
//   1. a share link (?s=) in the address, when it reads;
//   2. the saved setup (#296), when there is one;
//   3. the page defaults.
// So a link opened on load wins over a saved setup for that visit, and
// js/saved-setup.js then saves what loaded as the new setup.

export const SETUP_VERSION = 1;
// The share link's version (#306): a short binary body, js/link-codec.js.
// Readers take both; the saved setup is still written as SETUP_VERSION.
export { LINK_VERSION };
export const LINK_PARAM = "s";
// Setup era (#331 / TR-01). 0 is pre-rework. TR-02 bumps this when the 70755
// catalogue lands; a v1 payload whose era (missing counts as 0) does not
// match is refused. encodeSetup writes era only once it is non-zero, so
// today's "1.e30" bytes stay put until then.
export const SETUP_ERA = 0;

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

// True when the error is a live-catalogue refusal (#331): talents, rotation,
// or talent build rules (row gates / prerequisites / point cap at the level).
const isCatalogueError = (error) =>
  error instanceof Error &&
  /config\.talents|config\.rotation|Talent build is not valid/.test(
    error.message,
  );

// normalizeConfig plus validateBuild. Catalogue failures throw; other shape
// failures throw too (callers classify with isCatalogueError).
function checkLiveCatalogue(config) {
  const checked = checkConfig(config);
  validateBuild(checked.talents, undefined, { level: checked.talentLevel });
  return checked;
}

// Strip and check the optional v1 `era` field. Missing era counts as 0.
function takeEra(payload) {
  if (!isPlain(payload) || !("era" in payload)) {
    return { era: 0, rest: payload };
  }
  const { era, ...rest } = payload;
  return { era, rest };
}

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
  if (SETUP_ERA !== 0) payload.era = SETUP_ERA;
  const config = diff(setup.config, defaults.config);
  const run = diff(setup.run, defaults.run);
  if (config !== undefined) payload.config = config;
  if (run !== undefined) payload.run = run;
  return `${SETUP_VERSION}.${toBase64Url(JSON.stringify(payload))}`;
}

// The setup as a share link's text, "2.<base64url bytes>" (#306,
// js/link-codec.js). A value the link's lists cannot name (none today: the
// tests hold the lists to the catalogues) falls back to version 1's text.
export function encodeLink(setup, defaults = setupDefaults()) {
  try {
    return `${LINK_VERSION}.${encodeLinkBody(setup, defaults)}`;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return encodeSetup(setup, defaults);
  }
}

// { status: "ok", setup } | { status: "newer" } | { status: "corrupt" }
// | { status: "invalid" }. Lenient reading always says "ok": what did not
// read is the defaults.
export function decodeSetup(
  text,
  { strict = true, defaults = setupDefaults() } = {},
) {
  const fallback = (status) =>
    strict ? { status } : { status: "ok", setup: defaults };
  const match = typeof text === "string" ? FORMAT.exec(text.trim()) : null;
  if (match === null) return fallback("corrupt");
  const [, version, body] = match;
  if (Number(version) > LINK_VERSION) return fallback("newer");
  if (Number(version) === LINK_VERSION) {
    const read = decodeLinkBody(body, defaults);
    if (read.status !== "ok") return fallback(read.status);
    try {
      const config = checkLiveCatalogue(read.setup.config);
      const run = checkRun(read.setup.run);
      return run === null
        ? fallback("corrupt")
        : { status: "ok", setup: { config, run } };
    } catch (error) {
      return fallback(isCatalogueError(error) ? "invalid" : "corrupt");
    }
  }
  if (Number(version) !== SETUP_VERSION) return fallback("corrupt");
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(body));
  } catch {
    return fallback("corrupt");
  }
  if (!isPlain(payload)) return fallback("corrupt");
  const { era, rest } = takeEra(payload);
  if (era !== SETUP_ERA) return fallback("invalid");
  return strict ? readStrict(rest, defaults) : readLenient(rest, defaults);
}

function readStrict(payload, defaults) {
  if (hasUnknown(payload, defaults)) return { status: "newer" };
  try {
    const config = checkLiveCatalogue(merge(defaults.config, payload.config));
    const run = checkRun(merge(defaults.run, payload.run));
    return run === null
      ? { status: "corrupt" }
      : { status: "ok", setup: { config, run } };
  } catch (error) {
    return { status: isCatalogueError(error) ? "invalid" : "corrupt" };
  }
}

// The config with `section` set to `value`, checked; null when it does not
// check out.
function tryConfig(config, section, value) {
  try {
    return checkConfig({ ...config, [section]: value });
  } catch {
    return null;
  }
}

// Section by section: each one that checks out (with those before it) is
// kept. One that does not is read field by field (its top-level fields, over
// its defaults), so one bad field does not take the rest of it with it
// (#326, item 13: an armour of -1 reset the target's level too). `reset`
// lists what reads as its default: "target.armor", or a whole section that
// can't be read by field. A talents or rotation section the live catalogue
// refuses, or a finished build that fails validateBuild, discards the whole
// save (#331). Soft field errors still recover.
function readLenient(payload, defaults) {
  const discard = () => ({ status: "ok", setup: defaults });
  let config = defaults.config;
  const reset = [];
  const given = isPlain(payload.config) ? payload.config : {};
  for (const section of Object.keys(defaults.config)) {
    if (given[section] === undefined) continue;
    const base = defaults.config[section];
    const whole = WHOLE.has(section);
    const next = tryConfig(config, section, merge(base, given[section], whole));
    if (next !== null) {
      config = next;
      continue;
    }
    // Talents and rotation are whole: a catalogue refusal drops the save.
    if (WHOLE.has(section)) return discard();
    if (!isPlain(base) || !isPlain(given[section])) {
      reset.push(section);
      continue;
    }
    for (const field of Object.keys(base)) {
      const value = given[section][field];
      if (value === undefined) continue;
      const fieldNext = tryConfig(config, section, {
        ...config[section],
        [field]: merge(base[field], value, WHOLE.has(field)),
      });
      if (fieldNext === null) {
        reset.push(`${section}.${field}`);
      } else {
        config = fieldNext;
      }
    }
  }
  const run = { ...defaults.run };
  const givenRun = isPlain(payload.run) ? payload.run : {};
  for (const name of Object.keys(defaults.run)) {
    if (givenRun[name] === undefined) continue;
    const checked = checkRun({ ...run, [name]: givenRun[name] });
    if (checked === null) {
      reset.push(`run.${name}`);
    } else {
      Object.assign(run, checked);
    }
  }
  try {
    const setup = { config: checkLiveCatalogue(config), run };
    return reset.length === 0
      ? { status: "ok", setup }
      : { status: "ok", setup, reset };
  } catch (error) {
    if (isCatalogueError(error)) return discard();
    throw error;
  }
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
  url.searchParams.set(LINK_PARAM, encodeLink(setup, defaults));
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
// "newer" or "corrupt" (the link's banner). "invalid" (#331) sets no notice:
// the link is discarded and the next source loads in silence. hadLink says
// ?s= is to be taken out of the address. reset, only when there are any,
// lists the saved setup's fields read as their defaults (#326, item 13).
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
    // Catalogue refusals are silent (#331). Damaged / newer still say so.
    if (read.status !== "invalid") notice = read.status;
  }
  const hadLink = link !== null;
  if (saved !== null && saved !== undefined) {
    const read = decodeSetup(saved, { strict: false, defaults });
    const found = { setup: read.setup, source: "saved", notice, hadLink };
    return read.reset === undefined ? found : { ...found, reset: read.reset };
  }
  return { setup: defaults, source: "defaults", notice, hadLink };
}
