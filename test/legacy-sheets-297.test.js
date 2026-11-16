import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deriveSheet } from "../js/gear-derive.js";
import { GEAR_SLOTS } from "../js/gear-build.js";
import { P1_BACKSTAB_COMBAT } from "../data/p1-backstab-combat.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { decodeSetup } from "../js/build-codec.js";
import { normalizeConfig } from "../js/sim-config.js";
import { GOLDEN_CASES } from "../scripts/golden-update.mjs";
import { referenceBuild } from "../js/preset-reference-builds.js";

const before = JSON.parse(
  readFileSync(
    new URL("./fixtures/golden-configs-before.json", import.meta.url),
    "utf8",
  ),
);

describe("preset golden configs (#297 PR4)", () => {
  it("each golden config is the same engine input as before the move", () => {
    for (const item of GOLDEN_CASES) {
      assert.deepEqual(
        normalizeConfig(item.config),
        before[item.name],
        item.name,
      );
    }
  });
});

describe("page default Backstab Combat (#297 PR4)", () => {
  it("matches deriveSheet of the pinned p1_bscombat list for a human", () => {
    const gear = JSON.parse(
      readFileSync(
        new URL("../data/gear/p1-bscombat.gear.json", import.meta.url),
        "utf8",
      ),
    );
    const tables = {
      items: JSON.parse(
        readFileSync(
          new URL("../data/items/rogue-items.json", import.meta.url),
          "utf8",
        ),
      ),
      enchants: JSON.parse(
        readFileSync(
          new URL("../data/items/enchants.json", import.meta.url),
          "utf8",
        ),
      ),
      suffixes: JSON.parse(
        readFileSync(
          new URL("../data/items/suffixes.json", import.meta.url),
          "utf8",
        ),
      ),
    };
    const slots = {};
    gear.items.forEach((entry, index) => {
      slots[GEAR_SLOTS[index]] = {
        item: entry.id,
        enchant: entry.enchant ?? null,
        suffix: null,
      };
    });
    const sheet = deriveSheet({ slots }, { level: 60, race: "human" }, tables);
    assert.equal(sheet.character.attackPower, 608);
    assert.equal(sheet.character.critChance, 0.179705);
    assert.equal(sheet.character.bonusHitChance, 0.087);
    assert.equal(sheet.weapons.mainHand.type, "dagger");
    assert.equal(sheet.weapons.offHand.type, "axe");
    assert.deepEqual(P1_BACKSTAB_COMBAT.weapons, sheet.weapons);
    assert.equal(
      P1_BACKSTAB_COMBAT.character.attackPower,
      sheet.character.attackPower,
    );
    assert.equal(
      P1_BACKSTAB_COMBAT.character.critChance,
      sheet.character.critChance,
    );
    assert.equal(
      P1_BACKSTAB_COMBAT.character.bonusHitChance,
      sheet.character.bonusHitChance,
    );
    const page = pageDefaultConfig();
    assert.equal(page.race, "human");
    assert.equal(page.weapons.mainHand.type, "dagger");
    assert.equal(page.weapons.offHand.type, "axe");
    assert.equal(page.poisons.mainHand, "instant");
    assert.equal(page.poisons.offHand, "deadly");
    assert.deepEqual(page.talents, referenceBuild("combat-daggers").talents);
    assert.equal(referenceBuild("combat-daggers").weapons, undefined);
    assert.equal(referenceBuild("combat-daggers").character, undefined);
  });
});

describe("a link from before the page default changed (#297 PR4)", () => {
  it("decodes the pre-change ?s=2 body to the sword sheet with attack power 800", () => {
    const read = decodeSetup("2.BgIBwAw");
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.character.attackPower, 800);
    assert.equal(read.setup.config.character.critChance, 0.2245);
    assert.equal(read.setup.config.character.bonusHitChance, 0.07);
    assert.deepEqual(read.setup.config.weapons.mainHand, {
      min: 100,
      max: 187,
      speed: 2.6,
      type: "sword",
    });
    assert.equal(read.setup.config.weapons.offHand.type, "sword");
  });
});
