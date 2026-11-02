// #284 (P5-07, H6-lite): the build codec (js/build-codec.js), the one text
// format of the page's setup that the share link uses now and the saved setup
// (#296) is to reuse, and the order the page's first setup is chosen in.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_PARAM,
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
import { listPresets, loadPreset } from "../js/rotation-presets.js";
import { defaultRotation } from "../js/rotation-default.js";
import { k } from "../data/constants.js";
import { LINK_CAP } from "../js/views/share-link.js";

// GitHub Pages' address for the sim, with a route: the link drops the route.
const PAGES = "https://james-attree.github.io/wowf_dps_sim/#rotation/share";
// A test budget for the presets' links, with margin, not an app limit: the
// app's real cap is LINK_CAP (8,192) in js/views/share-link.js, over which
// the copy button offers a file export instead. Raised from 2,048 so every
// preset can carry all four on-use racial rules (Scout, 2 Nov 2026, #315).
const PRESET_LINK_MAX = 4096;
const SEED = 424242;
const MAX_SEED = 4294967295;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const linkOf = (payload, version = SETUP_VERSION) =>
  `${version}.${b64(payload)}`;

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
      },
      weapons: {
        mainHand: { min: 60, max: 110, speed: 1.8, type: "dagger" },
        offHand: { min: 50, max: 95, speed: 1.4, type: "dagger" },
      },
      talents: { "combat.precision": 3 },
      talentLevel: 40,
      poisons: { mainHand: "deadly", offHand: "instant" },
      rotation: { ...defaultRotation(), name: "Mine, édité ✓" },
    },
    run: { mode: "live", duration: 120.5, iterations: 250, seed: SEED },
  };
}

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

  it("drops default fields: the defaults are '1.e30', a seed alone stays short", () => {
    assert.equal(encodeSetup(setupDefaults()), "1.e30");
    const d = setupDefaults();
    const text = encodeSetup({ ...d, run: { ...d.run, seed: SEED } });
    assert.deepEqual(JSON.parse(Buffer.from(text.slice(2), "base64url")), {
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

describe("build codec: a captured v1 link still loads (#284)", () => {
  // Made when #284 merged. It must keep loading: a later field (race, #277)
  // reads as its default.
  const V1 =
    "1.eyJjb25maWciOnsiY2hhcmFjdGVyIjp7ImF0dGFja1Bvd2VyIjo5MDAsImhhc3RlIjowLjA1fSwicG9pc29ucyI6eyJtYWluSGFuZCI6ImRlYWRseSIsIm9mZkhhbmQiOiJpbnN0YW50In19LCJydW4iOnsibW9kZSI6ImxpdmUiLCJkdXJhdGlvbiI6MTIwLCJpdGVyYXRpb25zIjo1MDAsInNlZWQiOjd9fQ";

  it("decodes to the build it was made from", () => {
    const read = decodeSetup(V1);
    assert.equal(read.status, "ok");
    const d = setupDefaults();
    assert.deepEqual(read.setup, {
      config: {
        ...d.config,
        character: { ...d.config.character, attackPower: 900, haste: 0.05 },
        poisons: { mainHand: "deadly", offHand: "instant" },
      },
      run: { mode: "live", duration: 120, iterations: 500, seed: 7 },
    });
  });
});

describe("build codec: versions and unknown fields (#284)", () => {
  it("a newer version is 'newer' for a link and the defaults for a save", () => {
    const text = linkOf({ run: { seed: 1 } }, SETUP_VERSION + 1);
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
    linkOf({ config: { talents: { "not.a-talent": 3 } } }),
    linkOf({ config: { talentLevel: 999 } }),
    linkOf({ config: { rotation: { schemaVersion: 1, rules: "none" } } }),
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
      assert.ok(url.length < PRESET_LINK_MAX, `${id}: ${url.length}`);
    }
  });

  it("goes over the 8 KB cap with a long rotation, and that link still reads", () => {
    const rule = defaultRotation().rules[0];
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
    return { ...d, config: { ...d.config, talentLevel: 30 } };
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

  it("a newer or corrupt link loads nothing, says why, and is still taken out", () => {
    const newer = `?${LINK_PARAM}=${linkOf({}, SETUP_VERSION + 1)}`;
    assert.deepEqual(resolveInitialSetup({ search: newer }), {
      setup: setupDefaults(),
      source: "defaults",
      notice: "newer",
      hadLink: true,
    });
    const corrupt = `?${LINK_PARAM}=1.nope!`;
    const first = resolveInitialSetup({ search: corrupt, saved });
    assert.equal(first.notice, "corrupt");
    assert.equal(first.source, "saved");
    assert.deepEqual(first.setup, savedSetup);
  });

  it("a broken save is the defaults, never an error", () => {
    assert.deepEqual(
      resolveInitialSetup({ saved: "{not json" }).setup,
      setupDefaults(),
    );
  });
});
