import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { PRESET_REFERENCE_BUILDS } from "../data/preset-reference-builds.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { createFight, runFight } from "../js/fight.js";
import {
  checkReferenceBuild,
  referenceBuild,
  referenceWeapon,
  talentDifferences,
  weaponTypeDifferences,
} from "../js/preset-reference-builds.js";
import { listPresets, loadPreset } from "../js/rotation-presets.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { buildProblems } from "../js/talent-build.js";

// Issue #272 (P4.6-06): the Assassination and Subtlety presets, and the
// reference build (talents and daggers) each is written for. Loading a preset
// sets only the rotation; the reference build is data for #273's button, and
// nothing here puts it into a config but these tests.

const ASSASSINATION = "assassination-daggers";
const SUBTLETY = "subtlety-daggers";
const SIGNATURES = {
  [ASSASSINATION]: ["mutilate", "venom"],
  [SUBTLETY]: ["hemorrhage", "ambush", "preparation"],
};
const SEEDS = [1, 2, 3];
const LONG_FIGHT = 300;

const presetById = (id) => ROTATION_PRESETS.find((preset) => preset.id === id);

// A config with the preset loaded and its reference build put in by hand, as
// #273's button will.
function withReferenceBuild(id) {
  const build = referenceBuild(id);
  return loadPreset(id, {
    talents: { ...build.talents },
    weapons: {
      mainHand: referenceWeapon(build, "mainHand"),
      offHand: referenceWeapon(build, "offHand"),
    },
  });
}

describe("the Assassination and Subtlety presets (#272)", () => {
  it("are listed after Combat swords, each with a summary", () => {
    const ids = listPresets().map((preset) => preset.id);
    assert.deepEqual(ids, ["combat-swords", ASSASSINATION, SUBTLETY]);
    for (const preset of listPresets()) {
      assert.ok(preset.summary.length > 0, preset.id);
    }
  });

  it("cast no Expose Armor and no stealth opener, and Ambush has no aura condition", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      const actions = presetById(id).rotation.rules.map((rule) => rule.action);
      for (const banned of ["expose-armor", "garrote", "cheap-shot"]) {
        assert.ok(!actions.includes(banned), `${id} casts ${banned}`);
      }
    }
    const ambush = presetById(SUBTLETY).rotation.rules.filter(
      (rule) => rule.action === "ambush",
    );
    assert.equal(ambush.length, 1);
    assert.ok(
      ambush[0].conditions.every((c) => c.type !== "auraRemaining"),
      "no lock or hint on the cutthroat aura",
    );
  });

  it("Assassination builds with Mutilate below 5 CP and keeps Slice and Dice, Rupture and Venom up", () => {
    const actions = presetById(ASSASSINATION).rotation.rules.map(
      (rule) => rule.action,
    );
    for (const action of [
      "slice-and-dice",
      "rupture",
      "venom",
      "cold-blood",
      "mutilate",
    ]) {
      assert.ok(actions.includes(action), action);
    }
    const mutilate = presetById(ASSASSINATION).rotation.rules.find(
      (rule) => rule.action === "mutilate",
    );
    assert.ok(
      mutilate.conditions.some(
        (c) =>
          c.type === "comboPoints" &&
          c.op === "<" &&
          c.value === k("rotation.finisherComboPoints"),
      ),
    );
  });

  it("Subtlety keeps Slice and Dice and Hemorrhage up, Premeditation on cooldown, Preparation, Ambush and Backstab", () => {
    const actions = presetById(SUBTLETY).rotation.rules.map(
      (rule) => rule.action,
    );
    for (const action of [
      "slice-and-dice",
      "hemorrhage",
      "premeditation",
      "preparation",
      "ghostly-strike",
      "ambush",
      "backstab",
    ]) {
      assert.ok(actions.includes(action), action);
    }
    const hemorrhage = presetById(SUBTLETY).rotation.rules.find(
      (rule) => rule.action === "hemorrhage",
    );
    assert.ok(
      hemorrhage.conditions.some(
        (c) => c.type === "debuffRemaining" && c.debuff === "hemorrhage",
      ),
      "Hemorrhage is cast to keep its debuff up",
    );
  });

  it("loading one sets only the rotation: talents, weapons and the rest are the config's (G4)", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      assert.deepEqual(Object.keys(loadPreset(id)), ["rotation"]);
      const config = { talents: { "combat.precision": 3 }, target: {} };
      const loaded = loadPreset(id, config);
      assert.deepEqual(loaded.talents, { "combat.precision": 3 });
      assert.equal(loaded.weapons, undefined);
      const normal = normalizeConfig(loaded);
      const defaults = defaultConfig();
      assert.deepEqual(normal.weapons, normalizeConfig(defaults).weapons);
      assert.deepEqual(normal.poisons, normalizeConfig(defaults).poisons);
    }
  });

  it("an old config with no rotation still reads the default rotation (G4)", () => {
    const old = normalizeConfig({ talents: {} });
    assert.deepEqual(old.rotation, normalizeConfig(defaultConfig()).rotation);
  });

  it("run on the default swords without their talents, they cast no talent ability and do not throw", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      const fight = createFight(1, loadPreset(id));
      fight.simulation.run(60);
      for (const ability of [
        "mutilate",
        "venom",
        "hemorrhage",
        "preparation",
      ]) {
        assert.equal(
          fight.simulation.abilityStats[ability]?.casts ?? 0,
          0,
          `${id} ${ability}`,
        );
      }
    }
  });

  for (const [id, signatures] of Object.entries(SIGNATURES)) {
    it(`${id} casts ${signatures.join(", ")} with its reference build loaded`, () => {
      for (const seed of SEEDS) {
        const fight = createFight(seed, withReferenceBuild(id));
        fight.simulation.run(LONG_FIGHT);
        for (const ability of signatures) {
          assert.ok(
            (fight.simulation.abilityStats[ability]?.casts ?? 0) > 0,
            `${id} seed ${seed}: ${ability}`,
          );
        }
        assert.equal(
          fight.simulation.abilityStats["expose-armor"]?.casts ?? 0,
          0,
        );
      }
    });
  }

  it("a fight with a preset and its reference build repeats from its recorded config", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      const first = runFight({
        seed: 7,
        duration: 60,
        config: withReferenceBuild(id),
      });
      const again = runFight({ seed: 7, duration: 60, config: first.config });
      assert.equal(again.totalDamage, first.totalDamage, id);
    }
  });
});

describe("the preset reference builds (#272, for #273)", () => {
  it("has one for each dagger preset, and none (yet) for Combat swords", () => {
    assert.deepEqual(Object.keys(PRESET_REFERENCE_BUILDS).sort(), [
      ASSASSINATION,
      SUBTLETY,
    ]);
    assert.equal(referenceBuild("combat-swords"), null);
    assert.throws(() => referenceBuild("nope"), RangeError);
  });

  it("each is a legal level 60 build of 51 points, with the dagger alternate in both hands", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      const build = referenceBuild(id);
      assert.deepEqual(buildProblems(build.talents), [], id);
      const points = Object.values(build.talents).reduce((a, b) => a + b, 0);
      assert.equal(points, 51, id);
      assert.deepEqual(build.weapons.mainHand, k("weapon.dagger.mainHand"));
      assert.deepEqual(build.weapons.offHand, k("weapon.dagger.offHand"));
      assert.equal(
        build.talentLevel,
        undefined,
        "the level flag is James's call",
      );
    }
  });

  it("Assassination has Mutilate, Venom and Cold Blood and no Improved Expose Armor; Subtlety has Hemorrhage, Cutthroat, Premeditation and Preparation", () => {
    const assassination = referenceBuild(ASSASSINATION).talents;
    for (const id of [
      "assassination.mutilate",
      "assassination.venom",
      "assassination.cold-blood",
    ]) {
      assert.ok(assassination[id] > 0, id);
    }
    assert.equal(
      assassination["assassination.improved-expose-armor"],
      undefined,
    );
    const subtlety = referenceBuild(SUBTLETY).talents;
    for (const id of [
      "subtlety.hemorrhage",
      "subtlety.cutthroat",
      "subtlety.premeditation",
      "subtlety.preparation",
      "subtlety.ghostly-strike",
    ]) {
      assert.ok(subtlety[id] > 0, id);
    }
  });

  it("referenceBuild gives a copy: changing it changes nothing else", () => {
    const build = referenceBuild(SUBTLETY);
    build.talents["subtlety.cutthroat"] = 0;
    build.weapons.mainHand.min = 1;
    assert.equal(referenceBuild(SUBTLETY).talents["subtlety.cutthroat"], 5);
    assert.deepEqual(
      referenceBuild(SUBTLETY).weapons.mainHand,
      k("weapon.dagger.mainHand"),
    );
  });

  it("talentDifferences lists each talent whose rank differs, both ways, with a missing rank as 0 (a)", () => {
    const build = referenceBuild(ASSASSINATION);
    assert.deepEqual(talentDifferences(build, { ...build.talents }), []);
    const current = {
      ...build.talents,
      "combat.precision": 1,
      "subtlety.setup": 2,
    };
    delete current["assassination.venom"];
    assert.deepEqual(talentDifferences(build, current), [
      { id: "assassination.venom", reference: 1, current: 0 },
      { id: "combat.precision", reference: 3, current: 1 },
      { id: "subtlety.setup", reference: 0, current: 2 },
    ]);
    assert.equal(
      talentDifferences(build, undefined).length,
      Object.keys(build.talents).length,
    );
  });

  it("weaponTypeDifferences compares the type in each hand (b)", () => {
    const build = referenceBuild(SUBTLETY);
    const swords = normalizeConfig(defaultConfig()).weapons;
    assert.deepEqual(weaponTypeDifferences(build, swords), {
      mainHand: {
        reference: "dagger",
        current: swords.mainHand.type,
        same: false,
      },
      offHand: {
        reference: "dagger",
        current: swords.offHand.type,
        same: false,
      },
    });
    const daggers = weaponTypeDifferences(build, build.weapons);
    assert.equal(daggers.mainHand.same && daggers.offHand.same, true);
  });

  it("referenceWeapon is a SimConfig hand: type, min, max and speed, a copy (c)", () => {
    const build = referenceBuild(ASSASSINATION);
    const hand = referenceWeapon(build, "offHand");
    assert.deepEqual(Object.keys(hand).sort(), ["max", "min", "speed", "type"]);
    hand.speed = 9;
    assert.deepEqual(
      referenceWeapon(build, "offHand"),
      k("weapon.dagger.offHand"),
    );
    assert.throws(() => referenceWeapon(build, "ranged"), RangeError);
    const config = normalizeConfig({
      weapons: { mainHand: referenceWeapon(build, "mainHand") },
    });
    assert.deepEqual(config.weapons.mainHand, k("weapon.dagger.mainHand"));
  });

  it("checkReferenceBuild accepts the documented optional fields and refuses bad ones", () => {
    const good = referenceBuild(SUBTLETY);
    assert.deepEqual(checkReferenceBuild(SUBTLETY, good), []);
    assert.deepEqual(
      checkReferenceBuild(SUBTLETY, { ...good, talentLevel: 60 }),
      [],
    );
    assert.deepEqual(
      checkReferenceBuild("combat-swords", { ...good, talents: {} }),
      [],
    );
    const bad = [
      ["nope", good],
      [SUBTLETY, { ...good, talentLevel: 5 }],
      [SUBTLETY, { ...good, colour: "red" }],
      [SUBTLETY, { ...good, talents: { "subtlety.cutthroat": 9 } }],
      [SUBTLETY, { ...good, weapons: { mainHand: good.weapons.mainHand } }],
      [
        SUBTLETY,
        {
          ...good,
          weapons: {
            ...good.weapons,
            offHand: { type: "dagger", min: 9, max: 1, speed: 1 },
          },
        },
      ],
      [SUBTLETY, { ...good, talentLevel: 20 }],
    ];
    for (const [id, build] of bad) {
      assert.ok(
        checkReferenceBuild(id, build).length > 0,
        JSON.stringify(build).slice(0, 80),
      );
    }
  });
});
