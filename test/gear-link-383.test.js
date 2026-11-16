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
import { configFromForm, formFromConfig } from "../js/config-form.js";
import { GEAR_MARKER_P1_BSCOMBAT_92E67A7A } from "../data/gear-marker.js";
import { runFight } from "../js/fight.js";
import { createHash } from "node:crypto";

const before = JSON.parse(
  readFileSync(
    new URL("./fixtures/pr5-decode-before.json", import.meta.url),
    "utf8",
  ),
);

const P1_LINK_LENGTH = 9;
const P1_LINK_CEILING = 24;
const MARKER_SLOTS_HASH =
  "987cf6bb4457587c0375fc1e693f64e360978633d337cec7fb92f011cdb72312";

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

describe("the frozen P1 gear marker (#383)", () => {
  it("locks the exact p1_bscombat slots", () => {
    const canonical = JSON.stringify(
      GEAR_MARKER_P1_BSCOMBAT_92E67A7A.slots,
      (key, value) =>
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
            )
          : value,
    );
    assert.equal(
      createHash("sha256").update(canonical).digest("hex"),
      MARKER_SLOTS_HASH,
    );
    assert.equal(
      GEAR_MARKER_P1_BSCOMBAT_92E67A7A.commit,
      "92e67a7ae61f984e8a1fc006ebdeb012f31ac7d1",
    );
  });

  it("an empty slot mask round-trips to that frozen list", () => {
    const page = freshPageSetup();
    const read = decodeSetup(encodeLink(page));
    assert.equal(read.status, "ok");
    assert.deepEqual(
      read.setup.config.gear.slots,
      GEAR_MARKER_P1_BSCOMBAT_92E67A7A.slots,
    );
    assert.equal(encodeLink(page), "2.DYEgBQA");
  });
});

describe("typing the sheet leaves gear (#383)", () => {
  it("a typed attack power drops gear and matches a sheet link", () => {
    const page = freshPageSetup();
    const form = formFromConfig(page.config);
    form.values["character.attackPower"] = 900;
    const next = configFromForm(form, page.config);
    assert.equal(next.gear, undefined);
    assert.equal(next.character.attackPower, 900);
    const text = encodeLink({ ...page, config: next });
    assert.equal(text, encodeLink({ ...page, config: { ...next } }));
    const bare = structuredClone(next);
    assert.equal(encodeLink({ ...page, config: bare }), text);
    assert.equal(decodeSetup(text).setup.config.gear, undefined);
    assert.equal(decodeSetup(text).setup.config.character.attackPower, 900);
  });

  it("a typed weapon speed drops gear the same way", () => {
    const page = freshPageSetup();
    const form = formFromConfig(page.config);
    form.values["weapons.mainHand.speed"] = 1.9;
    const next = configFromForm(form, page.config);
    assert.equal(next.gear, undefined);
    assert.equal(next.weapons.mainHand.speed, 1.9);
    const text = encodeLink({ ...page, config: next });
    assert.equal(decodeSetup(text).setup.config.weapons.mainHand.speed, 1.9);
    assert.equal(decodeSetup(text).setup.config.gear, undefined);
  });

  it("weapon skill and target level survive beside gear, link and save", () => {
    const page = freshPageSetup();
    const form = formFromConfig(page.config);
    form.values["character.weaponSkill"] = 305;
    form.values["target.level"] = 63;
    const next = configFromForm(form, page.config);
    next.weapons.mainHand = { ...next.weapons.mainHand, weaponSkill: 310 };
    assert.ok(next.gear);
    for (const text of [
      encodeLink({ ...page, config: next }),
      encodeSetup({ ...page, config: next }),
    ]) {
      const read = decodeSetup(text);
      assert.equal(read.status, "ok");
      assert.equal(read.setup.config.character.weaponSkill, 305);
      assert.equal(read.setup.config.weapons.mainHand.weaponSkill, 310);
      assert.equal(read.setup.config.target.level, 63);
      assert.deepEqual(read.setup.config.gear.slots, next.gear.slots);
    }
  });
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
