// #331 (TR-01) / #332: an invalid old link or saved setup loads the new
// default. James 5 Nov 2026: no migration, no migration notice. Catalogue
// failures (unknown talent, rank over max, row gates / prerequisites,
// unknown rotation action, unknown race / weapon type / poison, or a setup
// era older than SETUP_ERA) discard the whole setup with no banner. An
// invalid link does nothing: the page loads the save if there is one,
// otherwise the default. Until TR-03's temporary Combat swords preset lands,
// the default is pageDefaultConfig (setupDefaults). Soft field errors
// (armour, run, …) still recover section by section in a save (#326).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_PARAM,
  SETUP_ERA,
  SETUP_VERSION,
  decodeSetup,
  encodeSetup,
  resolveInitialSetup,
  setupDefaults,
} from "../js/build-codec.js";
import { defaultRotation } from "../js/rotation-default.js";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
// Current-era payload by default. Pass era explicitly only when the test is
// about era itself.
const v1 = (payload) => {
  const body = Object.hasOwn(payload, "era")
    ? payload
    : { era: SETUP_ERA, ...payload };
  return `${SETUP_VERSION}.${b64(body)}`;
};

const withTalents = (talents, extra = {}) =>
  v1({ config: { talents, ...extra } });

describe("#331: invalid old loads become the new default (TR-01)", () => {
  it("SETUP_ERA is 1 after the 70755 data refresh (TR-02 / #332)", () => {
    assert.equal(SETUP_ERA, 1);
  });

  it("a share link with an unknown talent is invalid: nothing loads, no notice", () => {
    const text = withTalents({ "removed.old-talent": 1 });
    assert.deepEqual(decodeSetup(text), { status: "invalid" });
    assert.deepEqual(
      resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` }),
      {
        setup: setupDefaults(),
        source: "defaults",
        notice: null,
        hadLink: true,
      },
    );
  });

  it("a share link with a rank over the talent's max is invalid", () => {
    const text = withTalents({ "combat.precision": 99 });
    assert.equal(decodeSetup(text).status, "invalid");
  });

  it("a share link that breaks row gating is invalid (normalizeConfig alone still accepts it)", () => {
    // Blade Flurry is on row 5: 20 points above it are required.
    const text = withTalents({ "combat.blade-flurry": 1 });
    assert.equal(decodeSetup(text).status, "invalid");
    assert.deepEqual(
      resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` }).setup,
      setupDefaults(),
    );
  });

  it("a share link whose rotation names an ability the spell data lacks is invalid", () => {
    const rotation = {
      ...defaultRotation(),
      rules: [
        {
          ...defaultRotation().rules[0],
          action: "not-a-real-ability",
        },
      ],
    };
    const text = v1({ config: { rotation } });
    assert.equal(decodeSetup(text).status, "invalid");
  });

  it("a share link from a future setup era is invalid; a damaged body is silent (Scout #332)", () => {
    assert.equal(decodeSetup(v1({ era: SETUP_ERA + 1 })).status, "invalid");
    assert.equal(decodeSetup("1.nope!").status, "corrupt");
    const damaged = resolveInitialSetup({ search: `?${LINK_PARAM}=1.nope!` });
    assert.equal(damaged.notice, null);
    assert.equal(damaged.source, "defaults");
  });

  it("a pure garbage link loads the save if present, otherwise the default, with no banner", () => {
    const garbage = "1.nope!";
    const alone = resolveInitialSetup({ search: `?${LINK_PARAM}=${garbage}` });
    assert.equal(alone.notice, null);
    assert.deepEqual(alone.setup, setupDefaults());
    assert.equal(alone.source, "defaults");
    assert.equal(alone.hadLink, true);
    const saved = encodeSetup({
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        character: { ...setupDefaults().config.character, attackPower: 900 },
      },
    });
    const withSave = resolveInitialSetup({
      search: `?${LINK_PARAM}=${garbage}`,
      saved,
    });
    assert.equal(withSave.notice, null);
    assert.equal(withSave.source, "saved");
    assert.equal(withSave.setup.config.character.attackPower, 900);
  });

  it("a save with a removed talent loads the defaults whole", () => {
    // Presets are empty until TR-03 / #333; a synthetic removed talent is
    // enough to pin the discard path.
    const saved = withTalents({ "removed.old-preset-talent": 1 });
    const read = decodeSetup(saved, { strict: false });
    assert.equal(read.status, "ok");
    assert.equal(read.reset, undefined);
    assert.deepEqual(read.setup, setupDefaults());
    assert.deepEqual(resolveInitialSetup({ search: "", saved }), {
      setup: setupDefaults(),
      source: "saved",
      notice: null,
      hadLink: false,
    });
  });

  it("a save that breaks row gating is the defaults whole, not a partial recovery", () => {
    const saved = withTalents(
      { "combat.blade-flurry": 1 },
      {
        character: { attackPower: 900 },
      },
    );
    const read = decodeSetup(saved, { strict: false });
    assert.deepEqual(read.setup, setupDefaults());
    assert.equal(read.reset, undefined);
  });

  it("a save with only a soft field error still recovers that field (#326)", () => {
    const text = v1({
      config: {
        character: { attackPower: 900 },
        target: { armor: -1 },
      },
    });
    const read = decodeSetup(text, { strict: false });
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.character.attackPower, 900);
    assert.deepEqual(read.setup.config.target, setupDefaults().config.target);
    assert.ok(read.reset.includes("target.armor"));
  });

  it("a valid save and a valid link still load as they did", () => {
    const setup = {
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        character: { ...setupDefaults().config.character, attackPower: 900 },
        talents: { "assassination.malice": 5 },
      },
    };
    const text = encodeSetup(setup);
    assert.deepEqual(decodeSetup(text), { status: "ok", setup });
    assert.deepEqual(decodeSetup(text, { strict: false }), {
      status: "ok",
      setup,
    });
    const linked = resolveInitialSetup({
      search: `?${LINK_PARAM}=${text}`,
      saved: encodeSetup(setupDefaults()),
    });
    assert.equal(linked.source, "link");
    assert.equal(linked.notice, "loaded");
    assert.deepEqual(linked.setup, setup);
  });

  it("an invalid link does not apply, falls through with no notice, and a valid save still loads", () => {
    const savedSetup = {
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        talents: { "assassination.malice": 5 },
      },
    };
    const saved = encodeSetup(savedSetup);
    const bad = withTalents({ "removed.x": 1 });
    const first = resolveInitialSetup({
      search: `?${LINK_PARAM}=${bad}`,
      saved,
    });
    assert.equal(first.notice, null);
    assert.equal(first.source, "saved");
    assert.deepEqual(first.setup, savedSetup);
    assert.equal(first.hadLink, true);
  });

  it("a share link with an unknown race, weapon type or poison is invalid (James #332)", () => {
    const cases = [
      withTalents({}, { race: "not-a-race" }),
      v1({
        config: {
          weapons: {
            mainHand: { type: "potato", min: 1, max: 2, speed: 2.0 },
          },
        },
      }),
      v1({ config: { poisons: { mainHand: "banana" } } }),
    ];
    for (const text of cases) {
      assert.equal(decodeSetup(text).status, "invalid", text.slice(0, 40));
      assert.deepEqual(
        resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` }),
        {
          setup: setupDefaults(),
          source: "defaults",
          notice: null,
          hadLink: true,
        },
      );
    }
  });

  it("an invalid link leaves a valid save in place; with no save it loads the defaults (James #332)", () => {
    const savedSetup = {
      ...setupDefaults(),
      config: {
        ...setupDefaults().config,
        character: { ...setupDefaults().config.character, attackPower: 900 },
      },
    };
    const saved = encodeSetup(savedSetup);
    for (const bad of [
      withTalents({ "removed.x": 1 }),
      v1({ era: 0, config: { character: { attackPower: 900 } } }),
      v1({ config: { race: "not-a-race" } }),
    ]) {
      const withSave = resolveInitialSetup({
        search: `?${LINK_PARAM}=${bad}`,
        saved,
      });
      assert.equal(withSave.notice, null, bad.slice(0, 24));
      assert.equal(withSave.source, "saved");
      assert.deepEqual(withSave.setup, savedSetup);
      assert.equal(withSave.hadLink, true);

      const noSave = resolveInitialSetup({
        search: `?${LINK_PARAM}=${bad}`,
      });
      assert.equal(noSave.notice, null);
      assert.equal(noSave.source, "defaults");
      assert.deepEqual(noSave.setup, setupDefaults());
    }
  });
});
