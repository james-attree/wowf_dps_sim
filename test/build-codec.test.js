// #284 (P5-07, H6-lite): the build codec (js/build-codec.js), the one text
// format of the page's setup that the share link uses now and the saved setup
// (#296) is to reuse, and the order the page's first setup is chosen in.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_PARAM,
  LINK_VERSION,
  SETUP_ERA,
  SETUP_VERSION,
  decodeSetup,
  encodeSetup,
  resolveInitialSetup,
  runDefaults,
  setupDefaults,
  setupFromState,
  shareUrl,
  withoutLinkParam,
} from "../js/build-codec.js";
import {
  listPresets,
  loadPreset,
  referenceBuild,
} from "../js/rotation-presets.js";
const COMBAT_DAGGERS = "combat-daggers";
import { defaultRotation } from "../js/rotation-default.js";
import { k } from "../data/constants.js";
import { LINK_CAP, NOTICES } from "../js/views/share-link.js";

// GitHub Pages' address for the sim, with a route: the link drops the route.
const PAGES = "https://james-attree.github.io/wowf_dps_sim/#rotation/share";
// A test budget for the presets' links, not an app limit: the app's real cap
// is LINK_CAP (8,192) in js/views/share-link.js, over which the copy button
// offers a file export instead. Characters after the page's address. 64
// since #306's short links (Scout's ruling, 2 Nov 2026); it was 4,096 of the
// whole address (#315), and test/short-links-306.test.js holds a preset plus
// a typical edit to it too.
const PRESET_LINK_MAX = 64;
const SEED = 424242;
const MAX_SEED = 4294967295;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
// TR-02 / #332: SETUP_ERA is 1; a payload without era is era 0 and invalid.
const linkOf = (payload, version = SETUP_VERSION) => {
  const body =
    payload && typeof payload === "object" && !("era" in payload)
      ? { era: SETUP_ERA, ...payload }
      : payload;
  return `${version}.${b64(body)}`;
};
const DEFAULT_LINK = linkOf({});

// Every field away from its default.
function busySetup() {
  const d = setupDefaults();
  return {
    config: {
      ...d.config,
      character: {
        attackPower: 1234,
        critChance: 0.3,
        bonusHitChance: 0.05,
        haste: 0.05,
        // At or under talentLevel 40's cap, 40 x 5 + 50 (#290).
        weaponSkill: 245,
      },
      weapons: {
        mainHand: { min: 60, max: 110, speed: 1.8, type: "dagger" },
        offHand: { min: 50, max: 95, speed: 1.4, type: "dagger" },
      },
      talents: { "assassination.malice": 5 },
      talentLevel: 40,
      poisons: { mainHand: "deadly", offHand: "instant" },
      rotation: { ...defaultRotation(), name: "Mine, édité ✓" },
    },
    run: { mode: "live", duration: 120.5, iterations: 250, seed: SEED },
  };
}

describe("share-link NOTICES: no corrupt / damaged (#344 N1 / Kira M2)", () => {
  it("has no corrupt key and no damaged notice text", () => {
    assert.equal(Object.hasOwn(NOTICES, "corrupt"), false);
    assert.equal(NOTICES.corrupt, undefined);
    for (const [key, text] of Object.entries(NOTICES)) {
      assert.doesNotMatch(String(text), /damaged/i, key);
      assert.doesNotMatch(key, /corrupt/i);
    }
    assert.deepEqual(Object.keys(NOTICES).sort(), ["loaded", "newer"]);
  });
});

describe("build codec: round trip (#284)", () => {
  it("round-trips every config field and the run settings", () => {
    const setup = busySetup();
    const text = encodeSetup(setup);
    assert.match(text, /^1\.[A-Za-z0-9_-]+$/);
    const read = decodeSetup(text);
    assert.equal(read.status, "ok");
    assert.deepEqual(read.setup, setup);
  });

  it("round-trips haste (#274) on its own", () => {
    const d = setupDefaults();
    const setup = {
      ...d,
      config: {
        ...d.config,
        character: { ...d.config.character, haste: 0.2 },
      },
    };
    assert.equal(
      decodeSetup(encodeSetup(setup)).setup.config.character.haste,
      0.2,
    );
  });

  it("round-trips each preset rotation", () => {
    for (const { id } of listPresets()) {
      const d = setupDefaults();
      const setup = {
        config: loadPreset(id, d.config),
        run: { ...d.run, seed: SEED },
      };
      assert.deepEqual(decodeSetup(encodeSetup(setup)).setup, setup, id);
    }
  });

  it("drops default fields: the defaults are era-only, a seed alone stays short", () => {
    assert.equal(encodeSetup(setupDefaults()), DEFAULT_LINK);
    const d = setupDefaults();
    const text = encodeSetup({ ...d, run: { ...d.run, seed: SEED } });
    assert.deepEqual(JSON.parse(Buffer.from(text.slice(2), "base64url")), {
      era: SETUP_ERA,
      run: { seed: SEED },
    });
  });

  it("keeps the talents and the rotation whole when they differ", () => {
    const d = setupDefaults();
    const rotation = { ...defaultRotation(), name: "Renamed" };
    const text = encodeSetup({ ...d, config: { ...d.config, rotation } });
    const payload = JSON.parse(Buffer.from(text.slice(2), "base64url"));
    assert.deepEqual(payload.config.rotation, rotation);
  });

  it("reads setupFromState from the store's config and run", () => {
    const setup = busySetup();
    const state = {
      config: setup.config,
      run: {
        ...setup.run,
        state: "idle",
        fields: {},
        errors: {},
        snapshot: null,
      },
    };
    assert.deepEqual(setupFromState(state), setup);
  });
});

describe("build codec: a pre-era v1 link is invalid (#332)", () => {
  // Made when #284 merged (no era field). SETUP_ERA 1 refuses it silently
  // (James, #332): same path as catalogue refusals; no damaged banner.
  const V1 =
    "1.eyJjb25maWciOnsiY2hhcmFjdGVyIjp7ImF0dGFja1Bvd2VyIjo5MDAsImhhc3RlIjowLjA1fSwicG9pc29ucyI6eyJtYWluSGFuZCI6ImRlYWRseSIsIm9mZkhhbmQiOiJpbnN0YW50In19LCJydW4iOnsibW9kZSI6ImxpdmUiLCJkdXJhdGlvbiI6MTIwLCJpdGVyYXRpb25zIjo1MDAsInNlZWQiOjd9fQ";

  it("is invalid, and resolveInitialSetup loads save-or-default with no notice", () => {
    assert.deepEqual(decodeSetup(V1), { status: "invalid" });
    const resolved = resolveInitialSetup({
      search: `?${LINK_PARAM}=${V1}`,
      saved: null,
    });
    assert.equal(resolved.notice, null);
    assert.deepEqual(resolved.setup, setupDefaults());
  });
});

describe("build codec: versions and unknown fields (#284)", () => {
  it("a newer version is 'newer' for a link and the defaults for a save", () => {
    const text = linkOf({ run: { seed: 1 } }, LINK_VERSION + 1);
    assert.deepEqual(decodeSetup(text), { status: "newer" });
    assert.deepEqual(decodeSetup(text, { strict: false }), {
      status: "ok",
      setup: setupDefaults(),
    });
  });

  it("an unknown field is 'newer' for a link and ignored for a save", () => {
    for (const payload of [
      { config: { character: { attackPower: 900, mastery: 3 } } },
      { config: { faction: "horde", character: { attackPower: 900 } } },
      { config: { character: { attackPower: 900 } }, saved: true },
      {
        config: { character: { attackPower: 900 } },
        run: { seed: 1, speed: 2 },
      },
    ]) {
      const text = linkOf(payload);
      assert.deepEqual(
        decodeSetup(text),
        { status: "newer" },
        JSON.stringify(payload),
      );
      const read = decodeSetup(text, { strict: false });
      assert.equal(read.status, "ok");
      assert.equal(read.setup.config.character.attackPower, 900);
    }
  });

  it("config.race (#277) is a known field: it round-trips, and no race is the default", () => {
    const d = setupDefaults();
    assert.equal(d.config.race, null);
    const setup = { ...d, config: { ...d.config, race: "night-elf" } };
    const read = decodeSetup(encodeSetup(setup));
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.race, "night-elf");
    assert.equal(
      encodeSetup(d),
      encodeSetup({ ...d, config: { ...d.config } }),
    );
  });

  it("missing fields read as their defaults", () => {
    const read = decodeSetup(
      linkOf({ config: { weapons: { offHand: { speed: 1.5 } } } }),
    );
    assert.equal(read.status, "ok");
    const d = setupDefaults();
    assert.deepEqual(read.setup.config.weapons, {
      ...d.config.weapons,
      offHand: { ...d.config.weapons.offHand, speed: 1.5 },
    });
    assert.deepEqual(read.setup.run, runDefaults());
  });

  it("the target is always from behind, as on the page", () => {
    const read = decodeSetup(linkOf({ config: { target: { behind: false } } }));
    assert.equal(read.setup.config.target.behind, true);
  });
});

describe("build codec: garbage never throws (#284, G4)", () => {
  const garbage = [
    "",
    "e30",
    "1.",
    "1.%%%",
    "1.e30=",
    "x.e30",
    "0.e30",
    "1.e30.e30",
    "1.bm90IGpzb24",
    `1.${b64([1, 2])}`,
    `1.${b64("text")}`,
    `1.${b64(null)}`,
    `1.${Buffer.from([0xff, 0xfe]).toString("base64url")}`,
    linkOf({ config: { character: "fast" } }),
    linkOf({ config: { character: { attackPower: -5 } } }),
    linkOf({ config: { character: { critChance: 2 } } }),
    linkOf({ config: { talentLevel: 999 } }),
    linkOf({ run: { mode: "forever" } }),
    linkOf({ run: { duration: 0 } }),
    linkOf({ run: { duration: "300" } }),
    linkOf({ run: { iterations: 1.5 } }),
    linkOf({ run: { iterations: k("batch.maxIterations") + 1 } }),
    linkOf({ run: { seed: MAX_SEED + 1 } }),
    linkOf({ run: { seed: -1 } }),
    null,
    undefined,
    42,
    {},
  ];

  it("a link that does not read is 'corrupt'", () => {
    for (const text of garbage) {
      assert.deepEqual(decodeSetup(text), { status: "corrupt" }, String(text));
    }
  });

  it("a link the live catalogue refuses is 'invalid' (#331)", () => {
    for (const text of [
      linkOf({ config: { talents: { "not.a-talent": 3 } } }),
      linkOf({ config: { rotation: { schemaVersion: 1, rules: "none" } } }),
    ]) {
      assert.deepEqual(decodeSetup(text), { status: "invalid" }, String(text));
    }
  });

  it("a save that does not read is the defaults, section by section", () => {
    for (const text of garbage) {
      const read = decodeSetup(text, { strict: false });
      assert.equal(read.status, "ok", String(text));
      assert.deepEqual(read.setup, setupDefaults(), String(text));
    }
    // A bad section next to a good one: only the bad one is the default.
    const read = decodeSetup(
      linkOf({
        config: {
          character: { attackPower: -5 },
          poisons: { mainHand: "deadly" },
        },
        run: { seed: SEED, duration: 0 },
      }),
      { strict: false },
    );
    assert.deepEqual(
      read.setup.config.character,
      setupDefaults().config.character,
    );
    assert.equal(read.setup.config.poisons.mainHand, "deadly");
    assert.equal(read.setup.run.seed, SEED);
    assert.equal(read.setup.run.duration, runDefaults().duration);
  });
});

describe("build codec: the share link's address and length (#284)", () => {
  it("is the page's address with only ?s=, no route", () => {
    const url = shareUrl(`${PAGES}`, busySetup());
    const parsed = new URL(url);
    assert.equal(
      parsed.origin + parsed.pathname,
      "https://james-attree.github.io/wowf_dps_sim/",
    );
    assert.equal(parsed.hash, "");
    assert.deepEqual([...parsed.searchParams.keys()], [LINK_PARAM]);
    assert.deepEqual(
      decodeSetup(parsed.searchParams.get(LINK_PARAM)).setup,
      busySetup(),
    );
  });

  it("replaces an old ?s= rather than adding a second", () => {
    const url = shareUrl(
      "https://example.test/sim/?s=1.e30&x=1#fight",
      busySetup(),
    );
    assert.equal(new URL(url).searchParams.getAll(LINK_PARAM).length, 1);
  });

  it("keeps each preset's link under the test budget, at the longest seed", () => {
    const presets = ["default", ...listPresets().map(({ id }) => id)];
    for (const id of presets) {
      const d = setupDefaults();
      const config = id === "default" ? d.config : loadPreset(id, d.config);
      // The preset as picked, at the longest seed.
      const setup = { config, run: { ...d.run, seed: MAX_SEED } };
      const url = shareUrl(PAGES, setup);
      const address = PAGES.slice(0, PAGES.indexOf("#"));
      const length = url.length - address.length;
      assert.ok(length <= PRESET_LINK_MAX, `${id}: ${length}`);
    }
  });

  // #328: Combat daggers as a card pick puts it in, its whole reference
  // build and rotation, at the longest seed.
  it.skip("keeps the Combat daggers link, with its reference build, under the test budget (combat-daggers preset retired; needs a later dagger preset TR, not #333)", () => {
    const build = referenceBuild(COMBAT_DAGGERS);
    const d = setupDefaults();
    const config = loadPreset(COMBAT_DAGGERS, {
      ...d.config,
      talents: { ...build.talents },
      talentLevel: build.talentLevel,
      weapons: structuredClone(build.weapons),
      poisons: { ...build.poisons },
    });
    const setup = { config, run: { ...d.run, seed: MAX_SEED } };
    const url = shareUrl(PAGES, setup);
    assert.ok(url.length < PRESET_LINK_MAX, String(url.length));
    assert.deepEqual(
      decodeSetup(new URL(url).searchParams.get(LINK_PARAM)).setup.config
        .talents,
      build.talents,
    );
  });

  it("goes over the 8 KB cap with a long rotation, and that link still reads", () => {
    // A rule unlike the base's: #306's link sends a base's own rule as a
    // reference, so this rule (25 energy made 26) fills the link instead.
    const first = defaultRotation().rules[0];
    const rule = {
      ...first,
      conditions: first.conditions.map((c) =>
        c.type === "resource" ? { ...c, value: c.value + 1 } : c,
      ),
    };
    const rotation = {
      ...defaultRotation(),
      rules: Array.from({ length: k("rotation.maxRules") }, () => rule),
    };
    const d = setupDefaults();
    const setup = { config: { ...d.config, rotation }, run: d.run };
    const url = shareUrl(PAGES, setup);
    assert.ok(url.length > LINK_CAP, String(url.length));
    assert.deepEqual(
      decodeSetup(new URL(url).searchParams.get(LINK_PARAM)).setup,
      setup,
    );
  });

  it("takes ?s= out of the address, keeping the rest", () => {
    assert.equal(
      withoutLinkParam("https://example.test/sim/?a=1&s=1.e30#fight"),
      "https://example.test/sim/?a=1#fight",
    );
    assert.equal(
      withoutLinkParam("https://example.test/sim/?s=1.e30#results/live"),
      "https://example.test/sim/#results/live",
    );
  });
});

describe("the page's first setup: link, then saved, then defaults (#284, #296)", () => {
  const linked = busySetup();
  const savedSetup = (() => {
    const d = setupDefaults();
    // Empty talents so talentLevel 30 stays legal under the 51-point page default.
    return {
      ...d,
      config: { ...d.config, talents: {}, talentLevel: 30 },
    };
  })();
  const search = `?${LINK_PARAM}=${encodeSetup(linked)}`;
  const saved = encodeSetup(savedSetup);

  it("a link that reads wins over a saved setup", () => {
    const first = resolveInitialSetup({ search, saved });
    assert.deepEqual(first, {
      setup: linked,
      source: "link",
      notice: "loaded",
      hadLink: true,
    });
  });

  it("a saved setup comes next", () => {
    assert.deepEqual(resolveInitialSetup({ search: "", saved }), {
      setup: savedSetup,
      source: "saved",
      notice: null,
      hadLink: false,
    });
  });

  it("then the defaults", () => {
    assert.deepEqual(resolveInitialSetup({ search: "?other=1" }), {
      setup: setupDefaults(),
      source: "defaults",
      notice: null,
      hadLink: false,
    });
  });

  it("a newer link loads nothing, says why, and is still taken out; corrupt is silent (Scout #332)", () => {
    const newer = `?${LINK_PARAM}=${linkOf({}, LINK_VERSION + 1)}`;
    assert.deepEqual(resolveInitialSetup({ search: newer }), {
      setup: setupDefaults(),
      source: "defaults",
      notice: "newer",
      hadLink: true,
    });
    const corrupt = `?${LINK_PARAM}=1.nope!`;
    const first = resolveInitialSetup({ search: corrupt, saved });
    assert.equal(first.notice, null);
    assert.equal(first.source, "saved");
    assert.deepEqual(first.setup, savedSetup);
    const alone = resolveInitialSetup({ search: corrupt });
    assert.equal(alone.notice, null);
    assert.equal(alone.source, "defaults");
  });

  it("a broken save is the defaults, never an error", () => {
    assert.deepEqual(
      resolveInitialSetup({ saved: "{not json" }).setup,
      setupDefaults(),
    );
  });
});

describe("build codec: the target's pinned armour (#317's pin; #296 ruling)", () => {
  // The codec carries config.target.armor as it carries every config field:
  // a pinned number is in the link and the save, and null (the default,
  // follow the enemy level) or a missing field is left out, so a default
  // link is the same bytes it was before the pin existed.
  const V1 =
    "1.eyJjb25maWciOnsiY2hhcmFjdGVyIjp7ImF0dGFja1Bvd2VyIjo5MDAsImhhc3RlIjowLjA1fSwicG9pc29ucyI6eyJtYWluSGFuZCI6ImRlYWRseSIsIm9mZkhhbmQiOiJpbnN0YW50In19LCJydW4iOnsibW9kZSI6ImxpdmUiLCJkdXJhdGlvbiI6MTIwLCJpdGVyYXRpb25zIjo1MDAsInNlZWQiOjd9fQ";
  const withTarget = (target) => {
    const d = setupDefaults();
    return {
      ...d,
      config: { ...d.config, target: { ...d.config.target, ...target } },
    };
  };

  it("a pinned armour round-trips through a link (strict) and a save (lenient)", () => {
    for (const armor of [0, 1500, 3731]) {
      const setup = withTarget({ armor });
      const text = encodeSetup(setup);
      assert.deepEqual(decodeSetup(text), { status: "ok", setup });
      assert.deepEqual(decodeSetup(text, { strict: false }), {
        status: "ok",
        setup,
      });
    }
  });

  it("at its default (null) or unset, it is left out: the default link is era-only", () => {
    assert.equal(encodeSetup(withTarget({ armor: null })), DEFAULT_LINK);
    const d = setupDefaults();
    const { armor, ...unset } = d.config.target;
    assert.equal(armor, null);
    const text = encodeSetup({ ...d, config: { ...d.config, target: unset } });
    assert.equal(text, DEFAULT_LINK);
    assert.equal(text, encodeSetup(setupDefaults()));
  });

  it("an old pre-era link (captured at #284) is invalid under SETUP_ERA 1 (#332)", () => {
    assert.deepEqual(decodeSetup(V1), { status: "invalid" });
  });

  it("a bad pin is refused whole in a link, and reads as the target's default in a save", () => {
    const text = linkOf({ config: { target: { armor: -1 } } });
    assert.equal(decodeSetup(text).status, "corrupt");
    const read = decodeSetup(text, { strict: false });
    assert.deepEqual(read.setup.config.target, setupDefaults().config.target);
  });
});
