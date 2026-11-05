// #306: short share links. The link is version 2 of the build codec's text,
// "2.<base64url bytes>" against a base (the defaults or a preset), from
// js/link-codec.js; old "?s=1." links and the saved setup (still version 1)
// keep reading. The bases and lists are append-only, and each base's build
// and rotation is locked here by hash (Scout's ruling (b)).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  LINK_PARAM,
  LINK_VERSION,
  SETUP_VERSION,
  decodeSetup,
  encodeLink,
  encodeSetup,
  resolveInitialSetup,
  setupDefaults,
  shareUrl,
} from "../js/build-codec.js";
import {
  LINK_BASES,
  LINK_EDITED_SUFFIX,
  LINK_POISONS,
  LINK_RACES,
  LINK_RUN_MODES,
  LINK_TALENTS,
  LINK_WEAPON_TYPES,
  baseContent,
} from "../js/link-codec.js";
import { editedName } from "../js/config-form.js";
import { listPresets, presetRotation } from "../js/rotation-presets.js";
import { referenceBuild } from "../js/preset-reference-builds.js";
import { normalizeConfig } from "../js/sim-config.js";
import { talentCatalogue } from "../js/talents.js";
import { raceCatalogue } from "../js/racials.js";
import { poisonCatalogue } from "../js/poisons.js";
import { k } from "../data/constants.js";

// The page's address on GitHub Pages; the budget is what comes after it.
const PAGE = "https://james-attree.github.io/wowf_dps_sim/";
// #306: a preset plus a typical edit, at the longest seed, in this many
// characters after the page's address (Scout's ruling; LINK_CAP stays 8 KB).
const PRESET_LINK_MAX = 64;
const MAX_SEED = 4294967295;
const SEED = 2718281828;
const PRESETS = ["combat-swords-temp"];

const after = (url) => url.length - PAGE.length;
const textOf = (url) => new URL(url).searchParams.get(LINK_PARAM);

function presetConfig(id) {
  const build = referenceBuild(id);
  return normalizeConfig({
    ...setupDefaults().config,
    talents: { ...build.talents },
    talentLevel: build.talentLevel,
    weapons: {
      mainHand: { ...build.weapons.mainHand },
      offHand: { ...build.weapons.offHand },
    },
    poisons: { ...build.poisons },
    rotation: presetRotation(id),
  });
}

// The setups #306's phase 1 measured, each [name, setup, typical].
function measuredCases(seed = SEED) {
  const d = setupDefaults();
  const cases = [];
  const add = (name, config, run = {}, typical = true) =>
    cases.push([
      name,
      {
        config: {
          ...normalizeConfig(config),
          target: { ...config.target, behind: true },
        },
        run: { ...d.run, seed, ...run },
      },
      typical,
    ]);
  add("defaults", d.config);
  add("defaults, no seed", d.config, { seed: null });
  const swaps = {
    "combat-swords-temp": ["combat.aggression", "combat.lightning-reflexes"],
  };
  for (const id of PRESETS) {
    const p = presetConfig(id);
    const [from, to] = swaps[id];
    const talents = { ...p.talents };
    const moved = Math.min(talents[from], 2);
    talents[from] -= moved;
    if (talents[from] === 0) delete talents[from];
    talents[to] = (talents[to] ?? 0) + moved;
    const mainHand = { ...p.weapons.mainHand, min: 80, max: 150, speed: 1.9 };
    const level62 = { ...p.target, level: 62 };
    add(id, p);
    add(`${id} + talent swap`, { ...p, talents });
    add(`${id} + main hand`, { ...p, weapons: { ...p.weapons, mainHand } });
    add(`${id} + target 62`, { ...p, target: level62 });
    add(`${id} + orc + 62`, { ...p, race: "orc", target: level62 });
    add(`${id} + all four`, {
      ...p,
      talents,
      race: "human",
      target: level62,
      weapons: { ...p.weapons, mainHand },
    });
  }
  const cs = presetConfig("combat-swords-temp");
  const talents = { ...cs.talents };
  delete talents["combat.improved-sprint"];
  delete talents["combat.flash-of-steel"];
  talents["combat.lightning-reflexes"] = 3;
  const heavy = {
    ...cs,
    race: "night-elf",
    character: {
      attackPower: 1034,
      critChance: 0.2871,
      bonusHitChance: 0.05,
      haste: 0.03,
      weaponSkill: 305,
    },
    weapons: {
      mainHand: { min: 106, max: 198, speed: 2.7, type: "sword" },
      offHand: { min: 66, max: 123, speed: 1.5, type: "dagger" },
    },
    target: { ...cs.target, level: 62, armor: 3200 },
    poisons: { mainHand: "instant", offHand: "wound" },
    talents,
  };
  const run = { duration: 180, iterations: 5000 };
  const rules = cs.rotation.rules;
  add("heavy custom", heavy, run, false);
  add(
    "heavy custom + rule dropped",
    { ...heavy, rotation: { ...cs.rotation, rules: rules.slice(1) } },
    run,
    false,
  );
  add(
    "heavy custom + rule moved first",
    {
      ...heavy,
      rotation: {
        ...cs.rotation,
        rules: [rules[5], ...rules.filter((_, i) => i !== 5)],
      },
    },
    run,
    false,
  );
  return cases;
}

describe("short links: version 2 round trip (#306)", () => {
  it("every measured case round-trips through a 2. link", () => {
    for (const [name, setup] of measuredCases()) {
      const text = textOf(shareUrl(PAGE, setup));
      assert.match(text, /^2\.[\w-]*$/, name);
      assert.deepEqual(decodeSetup(text), { status: "ok", setup }, name);
    }
  });

  it("the same at the longest seed and with no seed", () => {
    for (const seed of [MAX_SEED, null, 0]) {
      for (const [name, setup] of measuredCases(seed)) {
        const read = decodeSetup(encodeLink(setup));
        assert.deepEqual(read.setup, setup, `${name}, seed ${seed}`);
      }
    }
  });

  it("round-trips fine values (any number goes as a float64) and the run", () => {
    const d = setupDefaults();
    const setup = {
      config: {
        ...d.config,
        character: {
          ...d.config.character,
          critChance: 0.123456789,
          haste: 0.05,
        },
        weapons: {
          ...d.config.weapons,
          offHand: { ...d.config.weapons.offHand, speed: 1.234, type: "fist" },
        },
        talentLevel: 40,
        talents: { "assassination.malice": 5 },
        poisons: { mainHand: null, offHand: "mind-numbing" },
        rotation: { ...d.config.rotation, name: "Mine, édité ✓" },
      },
      run: { mode: "live", duration: 120.5, iterations: 250, seed: 7 },
    };
    assert.deepEqual(decodeSetup(encodeLink(setup)).setup, setup);
  });

  it("an edited rotation sends its rules as references to the base's", () => {
    const cases = Object.fromEntries(
      measuredCases().map(([name, setup]) => [name, setup]),
    );
    for (const name of [
      "heavy custom + rule dropped",
      "heavy custom + rule moved first",
    ]) {
      const v1 = after(PAGE + `?${LINK_PARAM}=` + encodeSetup(cases[name]));
      const v2 = after(shareUrl(PAGE, cases[name]));
      assert.ok(v2 < PRESET_LINK_MAX * 2, `${name}: ${v2}`);
      assert.ok(v2 * 20 < v1, `${name}: ${v2} vs v1 ${v1}`);
    }
  });

  it("an edited rule goes whole, and a rotation unlike the base's goes as JSON", () => {
    const d = setupDefaults();
    const cs = presetConfig("combat-swords-temp");
    const edited = structuredClone(cs.rotation);
    edited.rules[0].conditions.push(...edited.rules[1].conditions);
    const renamed = { ...cs.rotation, name: "Renamed" };
    for (const rotation of [edited, renamed]) {
      const setup = { config: { ...cs, rotation }, run: d.run };
      assert.deepEqual(decodeSetup(encodeLink(setup)).setup, setup);
    }
  });

  it("a preset's rotation on the default build is one tag", () => {
    const d = setupDefaults();
    for (const { id } of listPresets()) {
      const setup = {
        config: { ...d.config, ...presetConfig(id) },
        run: d.run,
      };
      const text = encodeLink(setup);
      assert.ok(text.length <= 8, `${id}: ${text}`);
      assert.deepEqual(decodeSetup(text).setup, setup);
    }
  });
});

describe("short links: the budget (#306)", () => {
  it(`a preset plus a typical edit is ${PRESET_LINK_MAX} characters or fewer after the address, at the longest seed`, () => {
    for (const [name, setup, typical] of measuredCases(MAX_SEED)) {
      if (!typical) continue;
      const url = shareUrl(PAGE, setup);
      assert.ok(url.startsWith(`${PAGE}?${LINK_PARAM}=2.`), url);
      assert.ok(after(url) <= PRESET_LINK_MAX, `${name}: ${after(url)}`);
    }
  });

  it("every measured case is shorter than its version 1 link", () => {
    for (const [name, setup] of measuredCases()) {
      const v1 = `?${LINK_PARAM}=${encodeSetup(setup)}`.length;
      const v2 = after(shareUrl(PAGE, setup));
      assert.ok(v2 <= v1, `${name}: ${v2} vs ${v1}`);
    }
  });
});

describe("short links: version 1 still reads, and saves stay version 1 (#306)", () => {
  const V1 =
    "1.eyJjb25maWciOnsiY2hhcmFjdGVyIjp7ImF0dGFja1Bvd2VyIjo5MDAsImhhc3RlIjowLjA1fSwicG9pc29ucyI6eyJtYWluSGFuZCI6ImRlYWRseSIsIm9mZkhhbmQiOiJpbnN0YW50In19LCJydW4iOnsibW9kZSI6ImxpdmUiLCJkdXJhdGlvbiI6MTIwLCJpdGVyYXRpb25zIjo1MDAsInNlZWQiOjd9fQ";

  it("the era-only default link and a re-era'd #284-shaped payload decode", () => {
    const d = setupDefaults();
    assert.deepEqual(decodeSetup("1.eyJlcmEiOjF9"), { status: "ok", setup: d });
    assert.equal(decodeSetup("1.e30").status, "invalid");
    // Pre-SETUP_ERA capture: missing era is invalid. The same body with era 1 loads.
    assert.equal(decodeSetup(V1).status, "invalid");
    const body = JSON.parse(
      Buffer.from(V1.slice(2), "base64url").toString("utf8"),
    );
    const withEra = `${SETUP_VERSION}.${Buffer.from(
      JSON.stringify({ era: 1, ...body }),
    ).toString("base64url")}`;
    const read = decodeSetup(withEra);
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.character.attackPower, 900);
    assert.deepEqual(read.setup.run, {
      mode: "live",
      duration: 120,
      iterations: 500,
      seed: 7,
    });
  });

  it("every measured case's 1. text still reads, strict and lenient, to the same setup as its 2. link", () => {
    for (const [name, setup] of measuredCases()) {
      const v1 = encodeSetup(setup);
      assert.match(v1, /^1\./);
      assert.deepEqual(decodeSetup(v1).setup, setup, name);
      assert.deepEqual(decodeSetup(v1, { strict: false }).setup, setup, name);
      assert.deepEqual(decodeSetup(encodeLink(setup)).setup, setup, name);
    }
  });

  it("an old ?s=1. link in the address still opens", () => {
    const setup = measuredCases()[2][1];
    const search = `?${LINK_PARAM}=${encodeSetup(setup)}`;
    const first = resolveInitialSetup({ search });
    assert.equal(first.notice, "loaded");
    assert.deepEqual(first.setup, setup);
  });

  it("the saved setup's text is still version 1; the link's is 2", () => {
    assert.equal(SETUP_VERSION, 1);
    assert.equal(LINK_VERSION, 2);
    assert.equal(LINK_VERSION, k("link.codec").version);
    assert.equal(encodeSetup(setupDefaults()), "1.eyJlcmEiOjF9");
    assert.equal(encodeLink(setupDefaults()), "2.BQA");
  });

  it("a saved setup in version 2 reads too (readers take both)", () => {
    const setup = measuredCases()[3][1];
    assert.deepEqual(
      decodeSetup(encodeLink(setup), { strict: false }).setup,
      setup,
    );
  });

  it("a value the lists cannot name falls back to a version 1 link", () => {
    const d = setupDefaults();
    const odd = { ...d, config: { ...d.config, race: "not-a-race" } };
    assert.match(encodeLink(odd), /^1\./);
  });
});

// The lists' order at #306. Append only: an index in an old link keeps its
// meaning. A new talent, race, poison, weapon type, mode or base goes at the end.
const LOCKED_LISTS = {
  LINK_TALENTS: [
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
    "assassination.blood-splatter",
    "combat.coup-de-grace",
    "combat.efficient-strikes",
    "combat.composure",
    "combat.flash-of-steel",
    "subtlety.quick-getaway",
    "subtlety.boot-knife",
    "subtlety.death-mark",
  ],
  LINK_RACES: [
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
  ],
  LINK_POISONS: [
    null,
    "crippling",
    "instant",
    "mind-numbing",
    "deadly",
    "wound",
  ],
  LINK_WEAPON_TYPES: [null, "dagger", "sword", "mace", "axe", "fist", "other"],
  LINK_RUN_MODES: ["batch", "live"],
  LINK_BASES: [
    "defaults",
    "combat-swords",
    "assassination-daggers",
    "subtlety-daggers",
    "combat-daggers",
    "combat-swords-temp",
  ],
};

// sha256 of each base's { talents, talentLevel, weapons, poisons, rotation }
// (keys sorted). When a preset's build or rotation changes, this fails: add a
// NEW entry to LINK_BASES for the new content, and turn the old entry into a
// frozen copy of what it was ({ id, frozen }), so old links still open the
// build they were made from (Scout's ruling (b) on #306). Never edit a hash.
const LOCKED_CONTENT = {
  defaults: "ffca12ba2416057c461a932aa5ff857c3deb5916d0bb9964ed820a8354c160a1",
  "combat-swords":
    "55b22491b93e1b16fb03c83f55bba6018b9e3d66537afb8ff250f83e3238a1e6",
  "assassination-daggers":
    "cf3c105b4cce841554322ec38f29050ca90568eb5fe374e49945208394b0de3f",
  "subtlety-daggers":
    "1ac01ca6f8163a120178cd28a291d6069d76dfbcbe3be4df62024d5637304de1",
  "combat-daggers":
    "49ebf8a7b8e656c56b4fda8a3ce5b414e10b314ca40b289faf8c6ea3ea52deda",
  "combat-swords-temp":
    "562241521d99d14492fa537f11eed0384188c9aaddf2178ef29fe4e2a6664182",
};

const canonical = (value) =>
  JSON.stringify(value, (key, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");

describe("short links: the frozen lists and bases (#306, ruling (b))", () => {
  const lists = {
    LINK_TALENTS,
    LINK_RACES,
    LINK_POISONS,
    LINK_WEAPON_TYPES,
    LINK_RUN_MODES,
    LINK_BASES: LINK_BASES.map(({ id }) => id),
  };

  it("each list keeps its #306 order: entries are only appended", () => {
    for (const [name, locked] of Object.entries(LOCKED_LISTS)) {
      assert.deepEqual(lists[name].slice(0, locked.length), locked, name);
      assert.equal(
        new Set(lists[name]).size,
        lists[name].length,
        `${name}: no repeats`,
      );
    }
  });

  it("each list names everything the config accepts", () => {
    for (const { id } of talentCatalogue.talents)
      assert.ok(LINK_TALENTS.includes(id), id);
    for (const id of raceCatalogue.ids) assert.ok(LINK_RACES.includes(id), id);
    for (const { key } of poisonCatalogue.poisons)
      assert.ok(LINK_POISONS.includes(key), key);
    for (const type of k("config.weaponTypes"))
      assert.ok(LINK_WEAPON_TYPES.includes(type), type);
    const live = LINK_BASES.filter((b) => b.frozen === undefined).map(
      (b) => b.preset,
    );
    for (const { id } of listPresets()) {
      if (referenceBuild(id) !== null)
        assert.ok(live.includes(id), `${id} has a live base`);
    }
  });

  it("each base's build and rotation is locked by hash", () => {
    const config = setupDefaults().config;
    for (const entry of LINK_BASES) {
      assert.equal(
        hash(baseContent(entry, config)),
        LOCKED_CONTENT[entry.id],
        `${entry.id}: its content changed. Add a new LINK_BASES entry and freeze the old one (see the comment above LOCKED_CONTENT).`,
      );
    }
  });

  it("the live preset base is combat-swords-temp; older bases stay frozen (#333)", () => {
    assert.deepEqual(
      LINK_BASES.filter((b) => b.frozen === undefined).map((b) => b.id),
      ["combat-swords-temp"],
    );
    assert.deepEqual(
      LINK_BASES.filter((b) => b.preset !== undefined).map((b) => b.preset),
      ["combat-swords-temp"],
    );
  });

  it("pins the temporary Combat swords share link (#333)", () => {
    assert.equal(encodeLink(setupDefaults()), "2.BQA");
  });

  it("a frozen base is its own copy, whatever the presets are now", () => {
    const frozen = {
      talents: { "combat.precision": 5 },
      talentLevel: 60,
      weapons: setupDefaults().config.weapons,
      poisons: { mainHand: null, offHand: null },
      rotation: setupDefaults().config.rotation,
    };
    assert.deepEqual(
      baseContent({ id: "old", frozen }, setupDefaults().config),
      frozen,
    );
  });
});

const varint = (n) => {
  const out = [];
  let rest = n;
  do {
    out.push((rest % 128) + (rest >= 128 ? 128 : 0));
    rest = Math.floor(rest / 128);
  } while (rest > 0);
  return out;
};
const bytes = (...list) => `2.${Buffer.from(list).toString("base64url")}`;

describe("short links: newer and damaged version 2 links (#306)", () => {
  it("a later version, base, part, list index or tag is 'newer'", () => {
    const newer = [
      `${LINK_VERSION + 1}.AAAA`,
      bytes(LINK_BASES.length, 0), // a base this version lacks
      bytes(0, 0x80, 0x20), // part bit 12
      bytes(0, 1, LINK_RACES.length), // a race index past the list
      bytes(0, 0x10, 1, ...varint(LINK_TALENTS.length * 8 + 1)), // a later talent
      bytes(0, 0x80, 1, LINK_BASES.length * 2), // a later base's rotation
      bytes(0, 0x80, 1, 7), // a rotation tag this version lacks
      bytes(0, 0x80, 2, LINK_RUN_MODES.length), // a later run mode
    ];
    for (const text of newer) {
      assert.deepEqual(decodeSetup(text), { status: "newer" }, text);
      assert.deepEqual(
        decodeSetup(text, { strict: false }),
        { status: "ok", setup: setupDefaults() },
        text,
      );
      const first = resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` });
      assert.equal(first.notice, "newer", text);
    }
  });

  it("bytes that do not read, or a build that does not check out, are 'corrupt'", () => {
    const good = encodeLink(measuredCases()[3][1]);
    const raw = [...Buffer.from(good.slice(2), "base64url")];
    const corrupt = [
      "2.",
      "2.!!!",
      "2.A",
      `2.${Buffer.from(raw.slice(0, -1)).toString("base64url")}`, // cut short
      `2.${Buffer.from([...raw, 0]).toString("base64url")}`, // a byte too many
      bytes(0, 0x20, 200, 7), // talent level 200
      bytes(0, 0x80, 3, 3, 0x6e, 0x6f, 0x21), // rotation JSON "no!"
      bytes(0, 0x80, 1, 1, 200), // a base rule that is not there
      bytes(0, 0x80, 1, 5, 9, 0x41), // a rotation name cut short
      bytes(0, 0x80, 1, 5, 0, 1, 200), // a named list's rule not there
      bytes(0, 0x80, 4, 0), // zero iterations
      bytes(0, 0x02, 1, 3), // a float tag with no float
    ];
    for (const text of corrupt) {
      assert.deepEqual(decodeSetup(text), { status: "corrupt" }, text);
      assert.deepEqual(
        decodeSetup(text, { strict: false }),
        { status: "ok", setup: setupDefaults() },
        text,
      );
    }
  });

  it("garbage never throws", () => {
    const seen = new Set();
    let state = 12345;
    for (let n = 0; n < 2000; n += 1) {
      const length = n % 24;
      const list = [];
      for (let i = 0; i < length; i += 1) {
        state = (state * 1103515245 + 12345) % 2147483648;
        list.push(state % 256);
      }
      const status = decodeSetup(bytes(...list)).status;
      seen.add(status);
    }
    assert.ok(seen.has("corrupt"));
  });
});

// #330 review, B1: the app renames a rotation "<name> (edited)" on its first
// edit (editedName in js/config-form.js), so the rules-by-reference form
// carries the name too: one byte for the base's name + LINK_EDITED_SUFFIX,
// or the name's text for any other rename.
describe("short links: a rotation edited in the app keeps a short link (#330 B1)", () => {
  const editedSetup = (id, name, seed = MAX_SEED) => {
    const p = presetConfig(id);
    const rotation = { ...p.rotation, rules: p.rotation.rules.slice(1), name };
    return {
      config: { ...p, rotation },
      run: { ...setupDefaults().run, seed },
    };
  };

  it("the codec's edited name is the app's, for every base", () => {
    const d = setupDefaults().config;
    for (const entry of LINK_BASES) {
      const { name } = baseContent(entry, d).rotation;
      assert.equal(editedName(name), `${name}${LINK_EDITED_SUFFIX}`, entry.id);
    }
  });

  it("a rule dropped and the name made '<name> (edited)' costs a byte more than the name kept", () => {
    for (const id of PRESETS) {
      const kept = editedSetup(id, presetRotation(id).name);
      const named = editedSetup(id, editedName(presetRotation(id).name));
      const keptLength = after(shareUrl(PAGE, kept));
      const length = after(shareUrl(PAGE, named));
      assert.ok(length <= PRESET_LINK_MAX, `${id}: ${length}`);
      assert.ok(length - keptLength <= 2, `${id}: ${length} vs ${keptLength}`);
      assert.deepEqual(decodeSetup(encodeLink(named)).setup, named, id);
    }
  });

  it("any other rename sends the name's text with the rules as references", () => {
    for (const name of ["Mine", "Edited ✨ ünïcode", "x".repeat(40)]) {
      const setup = editedSetup("combat-swords-temp", name);
      const kept = after(
        shareUrl(
          PAGE,
          editedSetup("combat-swords-temp", "Combat swords (temporary)"),
        ),
      );
      const bytes = Buffer.byteLength(name, "utf8");
      const length = after(shareUrl(PAGE, setup));
      assert.ok(length <= kept + Math.ceil(((bytes + 2) * 4) / 3), name);
      assert.deepEqual(decodeSetup(encodeLink(setup)).setup, setup, name);
    }
  });

  it("a fuzz of app-style edits (drop, move, duplicate, rename) stays short", () => {
    // Kira's corpus (#330 review): renamed rotations were p50 1,920, max
    // 2,488 characters. Each case here is a preset with 1-4 rule edits, the
    // name "<name> (edited)" or a custom rename, and sometimes a race,
    // target level or talent change.
    let state = 330;
    const rnd = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const lengths = [];
    for (let n = 0; n < 300; n += 1) {
      const id = pick(PRESETS);
      const p = presetConfig(id);
      const rules = structuredClone(p.rotation.rules);
      const edits = 1 + Math.floor(rnd() * 4);
      for (let e = 0; e < edits; e += 1) {
        const op = pick(["drop", "move", "dup"]);
        const at = Math.floor(rnd() * rules.length);
        if (op === "drop" && rules.length > 1) rules.splice(at, 1);
        if (op === "move") {
          const [rule] = rules.splice(at, 1);
          rules.splice(Math.floor(rnd() * (rules.length + 1)), 0, rule);
        }
        if (op === "dup") rules.push(structuredClone(rules[at]));
      }
      const custom = rnd() < 0.25;
      const name = custom
        ? pick(["Mine", "Edited ✨ ünïcode", "x".repeat(40)])
        : editedName(p.rotation.name);
      const config = { ...p, rotation: { ...p.rotation, name, rules } };
      if (rnd() < 0.3) config.race = pick(["orc", "human", "gnome"]);
      if (rnd() < 0.3) config.target = { ...config.target, level: 62 };
      const setup = { config, run: { ...setupDefaults().run, seed: MAX_SEED } };
      assert.deepEqual(decodeSetup(encodeLink(setup)).setup, setup, `#${n}`);
      const length = after(shareUrl(PAGE, setup));
      if (!custom) {
        assert.ok(length <= PRESET_LINK_MAX, `#${n}: ${length}`);
      }
      lengths.push(length);
    }
    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const max = lengths[lengths.length - 1];
    assert.ok(median <= 40, `median ${median}`);
    assert.ok(max <= 100, `max ${max}`);
  });
});

// #330 review, N2: known-answer links. A change to the format's numbers
// (data/constants.js "link.codec") or to its lists changes these texts, and
// every link already shared would read differently: such a change needs a
// new LINK_VERSION, not an edit here.
describe("short links: pinned version 2 texts (#330 N2)", () => {
  const d = setupDefaults();
  const at = (config) => ({ config, run: { ...d.run, seed: SEED } });
  const cs = presetConfig("combat-swords-temp");
  // Live bases only (#333). Retired preset pins wait on later preset TRs.
  const PINNED = [
    ["defaults", at(d.config), "2.BYAQAcjBraAU"],
    ["combat-swords-temp", at(cs), "2.BYAQAcjBraAU"],
    [
      "combat-swords-temp, rule 1 deleted in the app",
      at({
        ...cs,
        rotation: {
          ...cs.rotation,
          name: editedName(cs.rotation.name),
          rules: cs.rotation.rules.slice(1),
        },
      }),
      "2.BYARBQAJAgQGCAoMDhASAcjBraAU",
    ],
    [
      "combat-swords-temp, orc, target level 62",
      at({ ...cs, race: "orc", target: { ...cs.target, level: 62 } }),
      "2.BYkQAQEBfAHIwa2gFA",
    ],
    [
      "combat-swords-temp, main hand 80-150 at 1.9",
      at({
        ...cs,
        weapons: {
          ...cs.weapons,
          mainHand: { ...cs.weapons.mainHand, min: 80, max: 150, speed: 1.9 },
        },
      }),
      "2.BYQQB6ABrAL8AgHIwa2gFA",
    ],
  ];

  it.skip("retired preset pins stay locked until later preset TRs (combat-swords / daggers)", () => {
    // Frozen LINK_BASES entries remain decodable; live referenceBuild only
    // has combat-swords-temp after #333. Re-pin when those presets return.
  });

  it("each pinned setup encodes to its text", () => {
    for (const [name, setup, text] of PINNED) {
      assert.equal(encodeLink(setup), text, name);
    }
  });

  it("each pinned text decodes to its setup", () => {
    for (const [name, setup, text] of PINNED) {
      assert.deepEqual(decodeSetup(text), { status: "ok", setup }, name);
    }
  });

  it("the defaults' pin reads byte by byte as the format says", () => {
    // Page defaults match the combat-swords-temp base (index 5) after #333, so
    // the encoder picks that base; parts: seed only (bit 11); seed present.
    assert.equal(PINNED[0][2], "2.BYAQAcjBraAU");
    assert.equal(
      PINNED[0][2],
      PINNED[1][2],
      "defaults and the live preset share a pin",
    );
  });
});
