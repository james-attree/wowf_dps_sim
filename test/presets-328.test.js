// #328: the Combat daggers preset is James's share link's setup (2 Nov
// 2026). The link's payload is kept, decoded, in
// test/fixtures/presets-328/combat-daggers.json; it is read back through the
// build codec as a link and compared with the preset and its reference
// build (Kira checks this). The link has no poisons: the build carries the
// dagger presets' Instant MH / Deadly OH (#310's ruling, an assumption).
// The link's race (Night Elf) and seed are not part of a preset (#323).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETUP_VERSION, decodeSetup } from "../js/build-codec.js";
import {
  listPresets,
  loadPreset,
  presetRotation,
  referenceBuild,
} from "../js/rotation-presets.js";
import { checkReferenceBuild } from "../js/preset-reference-builds.js";
import { validateRotation } from "../js/rotation-validator.js";
import { normalizeConfig } from "../js/sim-config.js";
import { createFight } from "../js/fight.js";
import { pointsByTree, talentPointCap } from "../js/talent-build.js";
import { startCards } from "../js/start-preset.js";
import { COMBAT_DAGGERS, WAITING } from "./combat-daggers-328.js";

const payload = JSON.parse(
  readFileSync(
    new URL("fixtures/presets-328/combat-daggers.json", import.meta.url),
  ),
);
const LEVEL_60 = 60;
const SEEDS = [1, 2, 3];
const FIGHT_SECONDS = 120;
const TALENTED = ["blade-flurry", "adrenaline-rush"];

function linkSetup() {
  const link = `${SETUP_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const read = decodeSetup(link);
  assert.equal(read.status, "ok");
  return read.setup.config;
}

// The preset as a pick puts it in: its whole reference build and rotation.
function presetSetup() {
  const build = referenceBuild(COMBAT_DAGGERS);
  return normalizeConfig(
    loadPreset(COMBAT_DAGGERS, {
      talents: { ...build.talents },
      talentLevel: build.talentLevel,
      weapons: structuredClone(build.weapons),
      poisons: { ...build.poisons },
    }),
  );
}

describe(
  "#328: Combat daggers is James's link's setup",
  { skip: WAITING },
  () => {
    it("the reference build's talents and level are the link's: 16/33/2, 51 points", () => {
      const build = referenceBuild(COMBAT_DAGGERS);
      const link = linkSetup();
      assert.deepEqual(build.talents, link.talents);
      assert.equal(build.talentLevel, link.talentLevel);
      assert.equal(build.talentLevel, LEVEL_60);
      const points = pointsByTree(build.talents);
      assert.deepEqual(
        [points.assassination, points.combat, points.subtlety],
        [16, 33, 2],
      );
      assert.equal(points.total, talentPointCap(LEVEL_60));
    });

    it("the weapons are the link's two daggers", () => {
      assert.deepEqual(
        referenceBuild(COMBAT_DAGGERS).weapons,
        linkSetup().weapons,
      );
      assert.deepEqual(referenceBuild(COMBAT_DAGGERS).weapons, {
        mainHand: { min: 73, max: 137, speed: 1.8, type: "dagger" },
        offHand: { min: 59, max: 111, speed: 1.6, type: "dagger" },
      });
    });

    it("the link has no poisons; the build has Instant MH / Deadly OH, as the dagger presets (assumption)", () => {
      assert.equal(Object.hasOwn(payload.config, "poisons"), false);
      assert.deepEqual(referenceBuild(COMBAT_DAGGERS).poisons, {
        mainHand: "instant",
        offHand: "deadly",
      });
      assert.deepEqual(
        referenceBuild(COMBAT_DAGGERS).poisons,
        referenceBuild("assassination-daggers").poisons,
      );
      assert.deepEqual(
        checkReferenceBuild(COMBAT_DAGGERS, referenceBuild(COMBAT_DAGGERS)),
        [],
      );
    });

    it("the rotation's rules are the link's, in order, racials included", () => {
      assert.deepEqual(
        presetRotation(COMBAT_DAGGERS).rules,
        linkSetup().rotation.rules,
      );
      assert.equal(presetSetup().rotation.rules.length, 8);
    });

    it("the race and seed are not part of the preset", () => {
      assert.equal(payload.config.race, "night-elf");
      assert.equal(Object.hasOwn(loadPreset(COMBAT_DAGGERS), "race"), false);
      assert.equal(presetSetup().race ?? null, null);
    });

    it("the rotation select lists it, named Combat daggers", () => {
      const preset = listPresets().find(({ id }) => id === COMBAT_DAGGERS);
      assert.equal(preset.name, "Combat daggers");
      assert.equal(presetRotation(COMBAT_DAGGERS).name, "Combat daggers");
      assert.ok(preset.summary.endsWith("8. Backstab if CP < 4"));
    });
  },
);

describe(
  "#328: the combat-swords Blade Flurry and Adrenaline Rush guard",
  { skip: WAITING },
  () => {
    it("does not fire on Combat daggers: no rule casts them, and it validates", () => {
      const rotation = presetRotation(COMBAT_DAGGERS);
      assert.deepEqual(validateRotation(rotation), []);
      const actions = rotation.rules.map(({ action }) => action);
      for (const id of TALENTED) {
        assert.ok(!actions.includes(id), id);
      }
    });

    it("still fires if a rule casts Blade Flurry with no talent check", () => {
      const rotation = presetRotation(COMBAT_DAGGERS);
      rotation.rules.push({ action: "blade-flurry", conditions: [] });
      const errors = validateRotation(rotation);
      assert.deepEqual(
        errors.map(({ code, ability }) => [code, ability]),
        [["talentGuard", "blade-flurry"]],
      );
    });

    it("with the reference build it backstabs and never casts Blade Flurry or Adrenaline Rush", () => {
      const config = presetSetup();
      for (const seed of SEEDS) {
        const fight = createFight(seed, config);
        fight.simulation.run(FIGHT_SECONDS);
        const stats = fight.simulation.abilityStats;
        for (const id of ["backstab", "eviscerate", "slice-and-dice"]) {
          assert.ok((stats[id]?.casts ?? 0) > 0, `${seed}: ${id}`);
        }
        for (const id of TALENTED) {
          assert.equal(stats[id]?.casts ?? 0, 0, `${seed}: ${id}`);
        }
      }
    });
  },
);

describe("#328: the start card", { skip: WAITING }, () => {
  it("is the fifth card, after Combat swords (the trees' order) and before Custom", () => {
    const cards = startCards();
    assert.equal(cards.length, 5);
    const index = cards.findIndex(({ id }) => id === COMBAT_DAGGERS);
    assert.equal(cards[index - 1].id, "combat-swords");
    assert.equal(cards.at(-1).id, "custom");
    assert.deepEqual(cards[index], {
      id: COMBAT_DAGGERS,
      name: "Combat daggers",
      detail: "Backstab · 16/33/2 · two daggers · Instant / Deadly",
      short: "16/33/2",
    });
  });
});
