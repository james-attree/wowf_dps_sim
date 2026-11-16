import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decodeSetup,
  encodeLink,
  encodeSetup,
  freshPageSetup,
  isLegacySheet,
} from "../js/build-codec.js";
import { GEAR_SLOTS } from "../js/gear-build.js";
import { runFight } from "../js/fight.js";

const before = JSON.parse(
  readFileSync(
    new URL("./fixtures/pr5-decode-before.json", import.meta.url),
    "utf8",
  ),
);

const P1_LINK_LENGTH = 133;
const P1_LINK_CEILING = 160;

describe("old links and saves stay byte-identical (#383)", () => {
  for (const text of Object.keys(before)) {
    it(text, () => {
      const read = decodeSetup(text);
      assert.deepEqual(
        { status: read.status, setup: read.setup ?? null },
        before[text],
      );
      if (read.status === "ok")
        assert.equal(isLegacySheet(read.setup.config), true);
    });
  }
});

describe("gear on the share link (#383)", () => {
  it("pins the first-load link length", () => {
    const text = encodeLink(freshPageSetup());
    assert.equal(text.length, P1_LINK_LENGTH);
    assert.ok(text.length <= P1_LINK_CEILING);
  });

  it("the first-load link round-trips the config and the seed-1 DPS", () => {
    const page = freshPageSetup();
    const read = decodeSetup(encodeLink(page));
    assert.equal(read.status, "ok");
    assert.equal(isLegacySheet(read.setup.config), false);
    assert.deepEqual(read.setup.config, page.config);
    assert.equal(
      runFight({ seed: 1, duration: 300, config: read.setup.config }).dps,
      307.2716836384642,
    );
  });

  it("a save of the first-load default round-trips", () => {
    const page = freshPageSetup();
    const read = decodeSetup(encodeSetup(page));
    assert.equal(read.status, "ok");
    assert.deepEqual(read.setup, page);
    assert.equal(
      runFight({ seed: 1, duration: 300, config: read.setup.config }).dps,
      307.2716836384642,
    );
  });

  it("an empty off hand still decodes and runs", () => {
    const page = freshPageSetup();
    const slots = { ...page.config.gear.slots };
    delete slots.offHand;
    const config = {
      ...page.config,
      gear: { slots },
      weapons: { ...page.config.weapons, offHand: null },
    };
    const read = decodeSetup(encodeLink({ ...page, config }));
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.weapons.offHand, null);
    assert.equal(read.setup.config.gear.slots.offHand, undefined);
    const fight = runFight({
      seed: 1,
      duration: 300,
      config: read.setup.config,
    });
    assert.equal(typeof fight.dps, "number");
  });

  it("an unknown item is corrupt", () => {
    const page = withSlot({ item: 1, enchant: null, suffix: null }, "head");
    assert.equal(decodeSetup(encodeLink(page)).status, "corrupt");
  });

  it("an item in the wrong slot is corrupt", () => {
    const page = withSlot(
      { item: 11735, enchant: null, suffix: null },
      "finger1",
    );
    assert.equal(decodeSetup(encodeLink(page)).status, "corrupt");
  });

  it("a truncated gear varint is corrupt", () => {
    const text = encodeLink(freshPageSetup());
    const body = Buffer.from(text.slice(2), "base64url");
    const cut = `2.${body.subarray(0, body.length - 1).toString("base64url")}`;
    assert.equal(decodeSetup(cut).status, "corrupt");
  });

  it("a slot bit past the 17 is newer", () => {
    const text = gearMaskLink(1 << GEAR_SLOTS.length);
    assert.equal(decodeSetup(text).status, "newer");
  });
});

function withSlot(entry, slot) {
  const page = freshPageSetup();
  return {
    ...page,
    config: {
      ...page.config,
      gear: {
        slots: { ...page.config.gear.slots, [slot]: entry },
      },
    },
  };
}

function gearMaskLink(mask) {
  const bytes = [0, 0x80, 0x20, ...varint(mask)];
  return `2.${Buffer.from(bytes).toString("base64url")}`;
}

function varint(n) {
  const out = [];
  let rest = n;
  do {
    out.push((rest % 128) + (rest >= 128 ? 128 : 0));
    rest = Math.floor(rest / 128);
  } while (rest > 0);
  return out;
}
