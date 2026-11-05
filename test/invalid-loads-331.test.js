// #331 (TR-01): an invalid old link or saved setup loads the new default.
// James 5 Nov 2026: no migration, no migration notice. Catalogue failures
// (unknown talent, rank over max, row gates / prerequisites, unknown
// rotation action, or a setup era older than SETUP_ERA) discard the whole
// setup. Until TR-03's temporary Combat swords preset lands, the default is
// pageDefaultConfig (setupDefaults). Soft field errors (armour, run, …) still
// recover section by section in a save (#326).
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
import { referenceBuild } from "../js/preset-reference-builds.js";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const v1 = (payload) => `${SETUP_VERSION}.${b64(payload)}`;

const withTalents = (talents, extra = {}) =>
  v1({ config: { talents, ...extra } });

describe("#331: invalid old loads become the new default (TR-01)", () => {
  it("SETUP_ERA is 0 until the 70755 data refresh (TR-02)", () => {
    assert.equal(SETUP_ERA, 0);
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

  it("a share link from a future setup era is invalid; a damaged body stays corrupt", () => {
    assert.equal(decodeSetup(v1({ era: SETUP_ERA + 1 })).status, "invalid");
    assert.equal(decodeSetup("1.nope!").status, "corrupt");
    assert.equal(
      resolveInitialSetup({ search: `?${LINK_PARAM}=1.nope!` }).notice,
      "corrupt",
    );
  });

  it("an old combat-swords / assassination / subtlety / combat-daggers save with a removed talent loads the defaults whole", () => {
    for (const id of [
      "combat-swords",
      "assassination-daggers",
      "subtlety-daggers",
      "combat-daggers",
    ]) {
      const build = referenceBuild(id);
      // Mimic a post-rework catalogue that no longer has one of the preset's
      // talents: the save still names it, so the whole save is discarded.
      const gone = Object.keys(build.talents)[0];
      const talents = { ...build.talents, [gone]: build.talents[gone] };
      // Swap the first id for one the live catalogue will never have.
      delete talents[gone];
      talents["removed." + id] = 1;
      const saved = withTalents(talents, {
        weapons: build.weapons,
        talentLevel: build.talentLevel,
      });
      const read = decodeSetup(saved, { strict: false });
      assert.equal(read.status, "ok", id);
      assert.equal(read.reset, undefined, id);
      assert.deepEqual(read.setup, setupDefaults(), id);
      assert.deepEqual(
        resolveInitialSetup({ search: "", saved }),
        {
          setup: setupDefaults(),
          source: "saved",
          notice: null,
          hadLink: false,
        },
        id,
      );
    }
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
});
