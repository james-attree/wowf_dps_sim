// Manual in the share link and the saved setup (#287 PR1).
// coordinator call 19 Nov (James delegated).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_PARAM,
  SETUP_ERA,
  SETUP_VERSION,
  decodeSetup,
  encodeLink,
  encodeSetup,
  freshPageSetup,
  resolveInitialSetup,
  setupDefaults,
  setupFromState,
} from "../js/build-codec.js";
import { defaultRotation } from "../js/rotation-default.js";
import { talentCatalogue } from "../js/talents.js";

const scripted = () => {
  const setup = freshPageSetup();
  setup.run = { ...setup.run, seed: 1 };
  return setup;
};

const manualOf = (setup) => ({
  ...setup,
  run: { ...setup.run, mode: "live", fightMode: "manual" },
});

describe("fight mode in the link and the save (#287)", () => {
  it("a Scripted link and save stay the bytes they were", () => {
    assert.equal(encodeLink(setupDefaults()), "2.BgA");
    const page = scripted();
    assert.equal(encodeLink(freshPageSetup()), "2.DYEgBQA");
    const link = encodeLink(page);
    const save = encodeSetup(page);
    assert.equal(link.includes("manual"), false);
    const read = decodeSetup(link);
    assert.equal(read.status, "ok");
    assert.equal(read.setup.run.fightMode, undefined);
    assert.equal(read.setup.run.mode, page.run.mode);
    const saved = decodeSetup(save);
    assert.equal(saved.setup.run.fightMode, undefined);
    assert.equal(encodeLink(page), link);
    assert.equal(encodeSetup(page), save);
  });

  it("a Manual link round-trips to Manual and live, and an old link is Scripted", () => {
    const link = encodeLink(manualOf(scripted()));
    const read = decodeSetup(link);
    assert.equal(read.status, "ok");
    assert.equal(read.setup.run.fightMode, "manual");
    assert.equal(read.setup.run.mode, "live");
    const old = decodeSetup("2.BgA");
    assert.equal(old.status, "ok");
    assert.equal(old.setup.run.fightMode, undefined);
    assert.equal(old.setup.run.mode, "batch");
  });

  // Both parts are corrupt: coordinator call 19 Nov (James delegated).
  // Ignoring that link silently is the coordinator's #332 ruling.
  it("a link with both manual and mode is corrupt and ignored", () => {
    // base 0, part bits 8 (mode) and 13 (manual), then live's mode index.
    const text = `2.${Buffer.from([0, 0x80, 66, 1]).toString("base64url")}`;
    assert.deepEqual(decodeSetup(text), { status: "corrupt" });
    const opened = resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` });
    assert.equal(opened.notice, null);
    assert.equal(opened.setup.run.fightMode, undefined);
  });

  it("a part bit past manual is still a newer link", () => {
    const text = `2.${Buffer.from([0, 0x80, 0x80, 0x01]).toString("base64url")}`;
    assert.deepEqual(decodeSetup(text), { status: "newer" });
    const opened = resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` });
    assert.equal(opened.notice, "newer");
  });

  it("the save writes fightMode only for Manual, and dropping the carry fails this", () => {
    const page = scripted();
    const state = {
      config: page.config,
      run: {
        ...manualOf(page).run,
        state: "idle",
        fields: {},
        errors: {},
      },
    };
    const setup = setupFromState(state);
    assert.equal(setup.run.fightMode, "manual");
    const text = encodeSetup(setup);
    const back = decodeSetup(text);
    assert.equal(back.status, "ok");
    assert.equal(back.setup.run.fightMode, "manual");
    assert.equal(back.setup.run.mode, "live");
    const scriptedState = setupFromState({
      config: page.config,
      run: { ...page.run, fightMode: "scripted" },
    });
    assert.equal(scriptedState.run.fightMode, undefined);
  });
});

describe("codec pins from #275 (#330 N3/N4, #343 N2–N4)", () => {
  it("pins a dropped rule, a custom name, a whole rotation, and a crit edit with a fight length", () => {
    const base = scripted();
    const dropped = {
      ...base,
      config: {
        ...base.config,
        rotation: {
          ...base.config.rotation,
          rules: base.config.rotation.rules.slice(1),
        },
      },
    };
    const named = {
      ...base,
      config: {
        ...base.config,
        rotation: { ...base.config.rotation, name: "Night raid" },
      },
    };
    const whole = {
      ...base,
      config: {
        ...base.config,
        rotation: {
          ...defaultRotation(),
          name: "Whole",
          rules: defaultRotation().rules.slice(0, 1),
        },
      },
    };
    const edited = {
      ...base,
      config: {
        ...base.config,
        character: { ...base.config.character, critChance: 0.2 },
      },
      run: { ...base.run, duration: 120 },
    };
    assert.deepEqual(
      {
        dropped: encodeLink(dropped),
        named: encodeLink(named),
        whole: encodeLink(whole),
        edited: encodeLink(edited),
      },
      {
        dropped: "2.DYExBQEKAgQGCAoMDhASFAECAA",
        named: "2.DYExBQULTmlnaHQgcmFpZAsAAgQGCAoMDhASFAECAA",
        whole:
          "2.DYExBQUGV2hvbGUBlwN7ImFjdGlvbiI6ImJsYWRlLWZsdXJyeSIsImNvbmRpdGlvbnMiOlt7InR5cGUiOiJhYmlsaXR5VW5sb2NrZWQiLCJhYmlsaXR5IjoiYmxhZGUtZmx1cnJ5In0seyJ0eXBlIjoiY29vbGRvd25SZWFkeSIsImFiaWxpdHkiOiJibGFkZS1mbHVycnkifSx7InR5cGUiOiJyZXNvdXJjZSIsInJlc291cmNlIjoiZW5lcmd5Iiwib3AiOiI-PSIsInZhbHVlIjoyNX1dfQECAA",
        edited: "2.DYcUBQfACaAfzA3_AWzMAegCAY4BjALgAwTgEgEC",
      },
    );
  });

  it("a custom rotation name with a lone surrogate still reads (#330 N4)", () => {
    const base = scripted();
    const setup = {
      ...base,
      config: {
        ...base.config,
        rotation: { ...base.config.rotation, name: "a\ud800b" },
      },
    };
    const text = encodeLink(setup);
    const read = decodeSetup(text);
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.rotation.name, "a\ufffdb");
  });

  it("a v2 link that breaks a talent row gate is invalid, not corrupt (#343 N2)", () => {
    const gated = talentCatalogue.talents.find((talent) => talent.row >= 2);
    const base = scripted();
    const setup = {
      ...base,
      config: {
        ...base.config,
        talents: { [gated.id]: 1 },
      },
    };
    const text = encodeLink(setup);
    assert.deepEqual(decodeSetup(text), { status: "invalid" });
    const opened = resolveInitialSetup({ search: `?${LINK_PARAM}=${text}` });
    assert.equal(opened.notice, null);
  });

  it("explicit era 0 is invalid, and a later era is invalid rather than newer (#343 N4)", () => {
    const body = (era) => {
      const payload = JSON.stringify({ era, run: { duration: 90 } });
      return `${SETUP_VERSION}.${Buffer.from(payload).toString("base64url")}`;
    };
    assert.notEqual(SETUP_ERA, 0);
    assert.equal(decodeSetup(body(0)).status, "invalid");
    assert.equal(decodeSetup(body(SETUP_ERA + 1)).status, "invalid");
    assert.equal(
      resolveInitialSetup({ search: `?${LINK_PARAM}=${body(SETUP_ERA + 1)}` })
        .notice,
      null,
    );
  });
});
