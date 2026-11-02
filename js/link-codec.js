import { k } from "../data/constants.js";
import { presetRotation } from "./rotation-presets.js";
import { referenceBuild } from "./preset-reference-builds.js";

// The short share link's body (#306): version 2 of the build codec's text,
// "2.<base64url bytes>". js/build-codec.js owns the text, the checks and the
// version switch; this module only turns a setup into bytes and back. The
// saved setup (#296) stays version 1 (JSON), and both versions read.
//
// A link names a base (LINK_BASES: the page defaults or a preset's build and
// rotation) and carries only what differs from it, as a small binary record:
//
//   base       varint, an index into LINK_BASES
//   parts      varint bitmask of the parts that follow, in PARTS order
//   race       varint, an index into LINK_RACES (0 is no race)
//   character  varint bitmask of CHARACTER_FIELDS, then each that differs
//   weapons    varint bitmask (4 bits a hand: min, max, speed, type), then
//              each that differs, main hand first
//   target     varint bitmask (level, armour), then each that differs
//   talents    varint count, then count x varint (talent index x 8 + rank),
//              each a talent whose rank differs from the base's (0 removes)
//   talentLevel varint
//   poisons    two varints, LINK_POISONS indexes (0 is None)
//   rotation   varint tag: 2e, LINK_BASES[e]'s rotation; 1, the base's
//              rotation with its rules listed (varint count, then 2i for the
//              base's rule i, or 2n+1 and n bytes of one rule's JSON); 3, the
//              whole rotation as n bytes of JSON (varint n first)
//   run        mode (varint, LINK_RUN_MODES), duration (number), iterations
//              (varint), seed (0 for none, else 1 and the number)
//
// A number is varint 2n for a value v = n / scale (n a whole number, 0 or
// more), or 1 and 8 bytes of float64 for anything else, so every value the
// config allows round-trips. The race, character, target and run parts are
// against the page defaults, as version 1's are; the base only gives the
// build (talents, talent level, weapons, poisons) and the rotation.
//
// The lists below are append-only (test/short-links-306.test.js locks their
// order), so an old link's indexes keep their meaning. A base whose build or
// rotation changes gets a NEW entry, and the old one keeps its content as a
// frozen copy ({ id, frozen: { talents, talentLevel, weapons, poisons,
// rotation } }), so an old link still opens the build it was made from (the
// test locks each entry's content by hash; Scout's ruling (b) on #306).
//
// An index or bit this version does not know is "newer" (the link was made
// by a later version); bytes that do not read are "corrupt".

export const LINK_VERSION = k("link.codec").version;
// The format's numbers (data/constants.js, "link.codec").
const C = k("link.codec");

// The bases a link can start from. "defaults" is the page defaults; the
// others are live presets (preset: its id) until they change.
export const LINK_BASES = Object.freeze([
  Object.freeze({ id: "defaults" }),
  Object.freeze({ id: "combat-swords", preset: "combat-swords" }),
  Object.freeze({
    id: "assassination-daggers",
    preset: "assassination-daggers",
  }),
  Object.freeze({ id: "subtlety-daggers", preset: "subtlety-daggers" }),
]);

// talentCatalogue order at #306.
export const LINK_TALENTS = Object.freeze([
  "assassination.improved-gouge",
  "assassination.remorseless-attacks",
  "assassination.malice",
  "assassination.ruthlessness",
  "assassination.murder",
  "assassination.improved-slice-and-dice",
  "assassination.relentless-strikes",
  "assassination.improved-expose-armor",
  "assassination.lethality",
  "assassination.vile-poisons",
  "assassination.cold-blood",
  "assassination.improved-poisons",
  "assassination.vigor",
  "assassination.mutilate",
  "assassination.improved-kidney-shot",
  "assassination.seal-fate",
  "assassination.venom",
  "combat.improved-eviscerate",
  "combat.improved-sinister-strike",
  "combat.lightning-reflexes",
  "combat.puncturing-wounds",
  "combat.deflection",
  "combat.precision",
  "combat.endurance",
  "combat.riposte",
  "combat.improved-sprint",
  "combat.improved-kick",
  "combat.flawless-execution",
  "combat.dual-wield-specialization",
  "combat.blade-flurry",
  "combat.hack-and-slash",
  "combat.weapon-expertise",
  "combat.aggression",
  "combat.adrenaline-rush",
  "subtlety.camouflage",
  "subtlety.master-of-deception",
  "subtlety.opportunity",
  "subtlety.setup",
  "subtlety.elusiveness",
  "subtlety.dirty-tricks",
  "subtlety.improved-ambush",
  "subtlety.initiative",
  "subtlety.ghostly-strike",
  "subtlety.improved-distract",
  "subtlety.heightened-senses",
  "subtlety.premeditation",
  "subtlety.serrated-blades",
  "subtlety.dirty-deeds",
  "subtlety.preparation",
  "subtlety.hemorrhage",
  "subtlety.quietus",
  "subtlety.cutthroat",
  "subtlety.thousand-cuts",
]);

// null (no race), then raceCatalogue order at #306.
export const LINK_RACES = Object.freeze([
  null,
  "orc",
  "undead",
  "troll",
  "skyborne-windshaper",
  "human",
  "dwarf",
  "night-elf",
  "gnome",
  "skyborne-high-order",
]);

// null (no type), then config.weaponTypes at #306.
export const LINK_WEAPON_TYPES = Object.freeze([
  null,
  "dagger",
  "sword",
  "mace",
  "axe",
  "fist",
  "other",
]);

// The run modes.
export const LINK_RUN_MODES = Object.freeze(["batch", "live"]);

// null (None), then poisonCatalogue order at #306.
export const LINK_POISONS = Object.freeze([
  null,
  "crippling",
  "instant",
  "mind-numbing",
  "deadly",
  "wound",
]);

// The parts of a link, in mask-bit order.
const PARTS = Object.freeze([
  "race",
  "character",
  "weapons",
  "target",
  "talents",
  "talentLevel",
  "poisons",
  "rotation",
  "mode",
  "duration",
  "iterations",
  "seed",
]);
// [field, scale, nullable]
const CHARACTER_FIELDS = Object.freeze([
  ["attackPower", 1, false],
  ["critChance", C.chanceScale, false],
  ["bonusHitChance", C.chanceScale, false],
  ["haste", C.chanceScale, false],
  ["weaponSkill", 1, true],
]);
const HANDS = Object.freeze(["mainHand", "offHand"]);
const WEAPON_FIELDS = Object.freeze([
  ["min", 1],
  ["max", 1],
  ["speed", C.speedScale],
]);
const TARGET_FIELDS = Object.freeze(["level", "armor"]);
// A talent index and rank in one varint: index x RANK_SPAN + rank.
const RANK_SPAN = C.rankSpan;
const DURATION_SCALE = C.durationScale;

const { atob, btoa, TextDecoder, TextEncoder } = globalThis;

// Thrown while reading: "newer" or "corrupt".
class LinkError extends Error {
  constructor(status) {
    super(status);
    this.status = status;
  }
}

class Writer {
  constructor() {
    this.bytes = [];
  }
  uint(n) {
    let rest = n;
    do {
      const low = rest % C.byteBase;
      rest = Math.floor(rest / C.byteBase);
      this.bytes.push(rest > 0 ? low + C.byteBase : low);
    } while (rest > 0);
  }
  num(value, scale) {
    const n = Math.round(value * scale);
    if (Number.isSafeInteger(n * C.radix) && n >= 0 && n / scale === value) {
      this.uint(n * C.radix);
      return;
    }
    this.uint(1);
    const view = new DataView(new ArrayBuffer(C.floatBytes));
    view.setFloat64(0, value);
    for (let i = 0; i < C.floatBytes; i += 1) this.bytes.push(view.getUint8(i));
  }
  optional(value, scale) {
    if (value === null) {
      this.uint(0);
    } else {
      this.uint(1);
      this.num(value, scale);
    }
  }
  text(value) {
    const bytes = new TextEncoder().encode(value);
    this.uint(bytes.length);
    this.bytes.push(...bytes);
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
  }
  byte() {
    if (this.at >= this.bytes.length) throw new LinkError("corrupt");
    return this.bytes[this.at++];
  }
  uint() {
    let n = 0;
    let scale = 1;
    let byte;
    do {
      byte = this.byte();
      n += (byte % C.byteBase) * scale;
      scale *= C.byteBase;
      if (!Number.isSafeInteger(n)) throw new LinkError("corrupt");
    } while (byte >= C.byteBase);
    return n;
  }
  num(scale) {
    const tag = this.uint();
    if (tag % C.radix === 0) return tag / C.radix / scale;
    if (tag !== 1) throw new LinkError("corrupt");
    const view = new DataView(new ArrayBuffer(C.floatBytes));
    for (let i = 0; i < C.floatBytes; i += 1) view.setUint8(i, this.byte());
    return view.getFloat64(0);
  }
  optional(scale) {
    const tag = this.uint();
    if (tag === 0) return null;
    if (tag !== 1) throw new LinkError("corrupt");
    return this.num(scale);
  }
  text() {
    const length = this.uint();
    if (length > this.bytes.length - this.at) throw new LinkError("corrupt");
    const bytes = this.bytes.slice(this.at, this.at + length);
    this.at += length;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new LinkError("corrupt");
    }
  }
  json() {
    try {
      return JSON.parse(this.text());
    } catch (error) {
      throw error instanceof LinkError ? error : new LinkError("corrupt");
    }
  }
  // A bitmask: a bit past `known` was set by a later version.
  mask(known) {
    const mask = this.uint();
    if (mask >= C.radix ** known) throw new LinkError("newer");
    return mask;
  }
  // An entry of an append-only list: one past its end is from a later
  // version.
  pick(list) {
    const index = this.uint();
    if (index >= list.length) throw new LinkError("newer");
    return list[index];
  }
  get done() {
    return this.at === this.bytes.length;
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (value) => JSON.parse(JSON.stringify(value));
const bit = (mask, i) => Math.floor(mask / C.radix ** i) % C.radix === 1;

function indexIn(list, value, what) {
  const index = list.indexOf(value);
  if (index < 0) throw new RangeError(`No link index for ${what} ${value}.`);
  return index;
}

// A base's build and rotation: { talents, talentLevel, weapons, poisons,
// rotation }. "defaults" is the page defaults' (`defaultsConfig`); a live
// preset is its reference build (the page defaults' build when it has none)
// and its rotation; a frozen entry is its own copy.
export function baseContent(entry, defaultsConfig) {
  if (entry.frozen !== undefined) return clone(entry.frozen);
  const own = {
    talents: defaultsConfig.talents,
    talentLevel: defaultsConfig.talentLevel,
    weapons: defaultsConfig.weapons,
    poisons: defaultsConfig.poisons,
    rotation: defaultsConfig.rotation,
  };
  if (entry.preset === undefined) return clone(own);
  const build = referenceBuild(entry.preset);
  const picked =
    build === null
      ? own
      : {
          talents: build.talents,
          talentLevel: build.talentLevel,
          weapons: build.weapons,
          poisons: build.poisons,
        };
  return clone({ ...own, ...picked, rotation: presetRotation(entry.preset) });
}

function writeRotation(w, rotation, base, bases) {
  const options = [];
  bases.forEach((content, e) => {
    if (same(rotation, content.rotation)) options.push([C.radix * e]);
  });
  const { rules, ...rest } = rotation;
  const { rules: baseRules, ...baseRest } = base.rotation;
  if (Array.isArray(rules) && same(rest, baseRest)) {
    const out = new Writer();
    out.uint(C.rulesTag);
    out.uint(rules.length);
    for (const rule of rules) {
      const i = baseRules.findIndex((r) => same(r, rule));
      if (i >= 0) {
        out.uint(C.radix * i);
      } else {
        const bytes = new TextEncoder().encode(JSON.stringify(rule));
        out.uint(C.radix * bytes.length + 1);
        out.bytes.push(...bytes);
      }
    }
    options.push(out.bytes);
  }
  const whole = new Writer();
  whole.uint(C.wholeTag);
  whole.text(JSON.stringify(rotation));
  options.push(whole.bytes);
  const shortest = options.reduce((a, b) => (b.length < a.length ? b : a));
  w.bytes.push(...shortest);
}

function readRotation(r, base, bases) {
  const tag = r.uint();
  if (tag % C.radix === 0) {
    const e = tag / C.radix;
    if (e >= bases.length) throw new LinkError("newer");
    return bases[e].rotation;
  }
  if (tag === C.wholeTag) return r.json();
  if (tag !== C.rulesTag) throw new LinkError("newer");
  const count = r.uint();
  if (count > r.bytes.length) throw new LinkError("corrupt");
  const rules = [];
  for (let n = 0; n < count; n += 1) {
    const code = r.uint();
    if (code % C.radix === 0) {
      const rule = base.rotation.rules[code / C.radix];
      if (rule === undefined) throw new LinkError("corrupt");
      rules.push(clone(rule));
    } else {
      const length = (code - 1) / C.radix;
      if (length > r.bytes.length - r.at) throw new LinkError("corrupt");
      const bytes = r.bytes.slice(r.at, r.at + length);
      r.at += length;
      try {
        rules.push(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      } catch {
        throw new LinkError("corrupt");
      }
    }
  }
  return { ...base.rotation, rules };
}

function writeBody(setup, defaults, index, bases) {
  const { config, run } = setup;
  const base = bases[index];
  const page = defaults.config;
  const changed = {
    race: config.race !== page.race,
    character: !same(config.character, page.character),
    weapons: !same(config.weapons, base.weapons),
    target:
      config.target.level !== page.target.level ||
      config.target.armor !== page.target.armor,
    talents: !same(sorted(config.talents), sorted(base.talents)),
    talentLevel: config.talentLevel !== base.talentLevel,
    poisons: !same(config.poisons, base.poisons),
    rotation: !same(config.rotation, base.rotation),
    mode: run.mode !== defaults.run.mode,
    duration: run.duration !== defaults.run.duration,
    iterations: run.iterations !== defaults.run.iterations,
    seed: run.seed !== defaults.run.seed,
  };
  const w = new Writer();
  w.uint(index);
  w.uint(
    PARTS.reduce((m, part, i) => m + (changed[part] ? C.radix ** i : 0), 0),
  );
  if (changed.race) w.uint(indexIn(LINK_RACES, config.race, "race"));
  if (changed.character) {
    const fields = CHARACTER_FIELDS.filter(
      ([name]) => config.character[name] !== page.character[name],
    );
    w.uint(
      CHARACTER_FIELDS.reduce(
        (m, field, i) => m + (fields.includes(field) ? C.radix ** i : 0),
        0,
      ),
    );
    for (const [name, scale, nullable] of fields) {
      if (nullable) w.optional(config.character[name], scale);
      else w.num(config.character[name], scale);
    }
  }
  if (changed.weapons) {
    let mask = 0;
    const writes = [];
    HANDS.forEach((hand, h) => {
      const now = config.weapons[hand];
      const was = base.weapons[hand];
      WEAPON_FIELDS.forEach(([name, scale], f) => {
        if (now[name] === was[name]) return;
        mask += C.radix ** (h * C.handBits + f);
        writes.push(() => w.num(now[name], scale));
      });
      if (now.type !== was.type) {
        mask += C.radix ** (h * C.handBits + C.typeBit);
        writes.push(() =>
          w.uint(indexIn(LINK_WEAPON_TYPES, now.type, "weapon type")),
        );
      }
    });
    w.uint(mask);
    for (const write of writes) write();
  }
  if (changed.target) {
    const fields = TARGET_FIELDS.filter(
      (name) => config.target[name] !== page.target[name],
    );
    w.uint(
      TARGET_FIELDS.reduce(
        (m, name, i) => m + (fields.includes(name) ? C.radix ** i : 0),
        0,
      ),
    );
    for (const name of fields) w.optional(config.target[name], 1);
  }
  if (changed.talents) {
    const ids = [
      ...new Set([
        ...Object.keys(base.talents),
        ...Object.keys(config.talents),
      ]),
    ]
      .filter((id) => (config.talents[id] ?? 0) !== (base.talents[id] ?? 0))
      .sort();
    w.uint(ids.length);
    for (const id of ids) {
      const rank = config.talents[id] ?? 0;
      if (!Number.isInteger(rank) || rank < 0 || rank >= RANK_SPAN) {
        throw new RangeError(`No link code for rank ${rank}.`);
      }
      w.uint(indexIn(LINK_TALENTS, id, "talent") * RANK_SPAN + rank);
    }
  }
  if (changed.talentLevel) w.uint(config.talentLevel);
  if (changed.poisons) {
    for (const hand of HANDS) {
      w.uint(indexIn(LINK_POISONS, config.poisons[hand], "poison"));
    }
  }
  if (changed.rotation) writeRotation(w, config.rotation, base, bases);
  if (changed.mode) w.uint(indexIn(LINK_RUN_MODES, run.mode, "run mode"));
  if (changed.duration) w.num(run.duration, DURATION_SCALE);
  if (changed.iterations) w.num(run.iterations, 1);
  if (changed.seed) w.optional(run.seed, 1);
  return w.bytes;
}

function sorted(map) {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([, rank]) => rank !== 0)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

function liveBases(defaults) {
  return LINK_BASES.map((entry) => baseContent(entry, defaults.config));
}

// The link body (after "2.") for a setup: from whichever live base gives the
// fewest bytes. A RangeError when a value has no link index.
export function encodeLinkBody(setup, defaults) {
  const bases = liveBases(defaults);
  let best = null;
  LINK_BASES.forEach((entry, index) => {
    if (entry.frozen !== undefined) return;
    const bytes = writeBody(setup, defaults, index, bases);
    if (best === null || bytes.length < best.length) best = bytes;
  });
  return toBase64Url(best);
}

// { status: "ok", setup } (not yet checked: build-codec checks it) |
// { status: "newer" } | { status: "corrupt" }.
export function decodeLinkBody(body, defaults) {
  let bytes;
  try {
    bytes = fromBase64Url(body);
  } catch {
    return { status: "corrupt" };
  }
  try {
    return { status: "ok", setup: readBody(new Reader(bytes), defaults) };
  } catch (error) {
    if (error instanceof LinkError) return { status: error.status };
    return { status: "corrupt" };
  }
}

function readBody(r, defaults) {
  const bases = liveBases(defaults);
  const base = r.pick(bases);
  const page = defaults.config;
  const mask = r.mask(PARTS.length);
  const has = (part) => bit(mask, PARTS.indexOf(part));
  const config = {
    ...clone(page),
    talents: clone(base.talents),
    talentLevel: base.talentLevel,
    weapons: clone(base.weapons),
    poisons: clone(base.poisons),
    rotation: clone(base.rotation),
  };
  const run = { ...defaults.run };
  if (has("race")) config.race = r.pick(LINK_RACES);
  if (has("character")) {
    const fields = r.mask(CHARACTER_FIELDS.length);
    CHARACTER_FIELDS.forEach(([name, scale, nullable], i) => {
      if (!bit(fields, i)) return;
      config.character[name] = nullable ? r.optional(scale) : r.num(scale);
    });
  }
  if (has("weapons")) {
    const fields = r.mask(HANDS.length * C.handBits);
    HANDS.forEach((hand, h) => {
      WEAPON_FIELDS.forEach(([name, scale], f) => {
        if (bit(fields, h * C.handBits + f))
          config.weapons[hand][name] = r.num(scale);
      });
      if (bit(fields, h * C.handBits + C.typeBit)) {
        config.weapons[hand].type = r.pick(LINK_WEAPON_TYPES);
      }
    });
  }
  if (has("target")) {
    const fields = r.mask(TARGET_FIELDS.length);
    TARGET_FIELDS.forEach((name, i) => {
      if (bit(fields, i)) config.target[name] = r.optional(1);
    });
  }
  if (has("talents")) {
    const count = r.uint();
    if (count > r.bytes.length) throw new LinkError("corrupt");
    for (let n = 0; n < count; n += 1) {
      const code = r.uint();
      const index = Math.floor(code / RANK_SPAN);
      if (index >= LINK_TALENTS.length) throw new LinkError("newer");
      const id = LINK_TALENTS[index];
      const rank = code % RANK_SPAN;
      if (rank === 0) delete config.talents[id];
      else config.talents[id] = rank;
    }
  }
  if (has("talentLevel")) config.talentLevel = r.uint();
  if (has("poisons")) {
    for (const hand of HANDS) config.poisons[hand] = r.pick(LINK_POISONS);
  }
  if (has("rotation")) config.rotation = readRotation(r, base, bases);
  if (has("mode")) run.mode = r.pick(LINK_RUN_MODES);
  if (has("duration")) run.duration = r.num(DURATION_SCALE);
  if (has("iterations")) run.iterations = r.num(1);
  if (has("seed")) run.seed = r.optional(1);
  if (!r.done) throw new LinkError("corrupt");
  return { config, run };
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
