import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { PRESET_REFERENCE_BUILDS } from "../data/preset-reference-builds.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { createFight, runFight } from "../js/fight.js";
import {
  checkReferenceBuild,
  poisonDifferences,
  referenceBuild,
  referencePoison,
  referenceWeapon,
  talentDifferences,
  weaponTypeDifferences,
} from "../js/preset-reference-builds.js";
import * as presetApi from "../js/rotation-presets.js";
import { listPresets, loadPreset } from "../js/rotation-presets.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { buildProblems, talentLevelRange } from "../js/talent-build.js";
import { referenceBuild as combatReferenceTalents } from "../data/reference-build.js";

// Issue #272 (P4.6-06): the Assassination and Subtlety presets, and the
// reference build (talents and daggers) each is written for. Loading a preset
// sets only the rotation; the reference build is data for #273's button, and
// nothing here puts it into a config but these tests.

const ASSASSINATION = "assassination-daggers";
const SUBTLETY = "subtlety-daggers";
const COMBAT = "combat-swords";
const LEVEL_60 = talentLevelRange().max;
const SIGNATURES = {
  [ASSASSINATION]: ["mutilate", "venom"],
  [SUBTLETY]: ["hemorrhage", "ghostly-strike", "rupture", "preparation"],
};
const SEEDS = [1, 2, 3];
const LONG_FIGHT = 300;
const SHORT_FIGHT = 60;
// Scout's #304 ruling on N1 let a proc-reliant signature (Venom, which then
// needed a free 5 CP finisher; Ambush, which needed a Cutthroat proc) go
// uncast on some 60 s seeds. Since #310 no preset relies on a proc for one:
// Venom is cast at 4 CP and there is no Ambush, so every signature is cast on
// every seed (all 200 seeds measured at 60 s and 300 s; a cheap 40-seed
// sample here).
const SAMPLE_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

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
    poisons: {
      mainHand: referencePoison(build, "mainHand"),
      offHand: referencePoison(build, "offHand"),
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

  it("cast no Expose Armor and no stealth opener (no Ambush since #310)", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      const actions = presetById(id).rotation.rules.map((rule) => rule.action);
      for (const banned of [
        "expose-armor",
        "garrote",
        "cheap-shot",
        "ambush",
      ]) {
        assert.ok(!actions.includes(banned), `${id} casts ${banned}`);
      }
    }
  });

  it("Assassination builds with Mutilate below 4 CP and keeps Slice and Dice and Venom up, with no Rupture (#310)", () => {
    const actions = presetById(ASSASSINATION).rotation.rules.map(
      (rule) => rule.action,
    );
    for (const action of [
      "slice-and-dice",
      "venom",
      "eviscerate",
      "cold-blood",
      "mutilate",
    ]) {
      assert.ok(actions.includes(action), action);
    }
    assert.ok(!actions.includes("rupture"));
    const mutilate = presetById(ASSASSINATION).rotation.rules.find(
      (rule) => rule.action === "mutilate",
    );
    assert.ok(
      mutilate.conditions.some(
        (c) =>
          c.type === "comboPoints" &&
          c.op === "<" &&
          c.value === k("presetRotation.assassination").finisherComboPoints,
      ),
    );
  });

  it("Subtlety keeps Rupture up, Premeditation on cooldown, Preparation, Slice and Dice with Rupture up, and builds with Ghostly Strike and Hemorrhage (#310)", () => {
    const actions = presetById(SUBTLETY).rotation.rules.map(
      (rule) => rule.action,
    );
    assert.deepEqual(actions, [
      // The on-use racials first (#278, Decision 6).
      "blood-fury",
      "elunes-light",
      "rupture",
      "premeditation",
      "preparation",
      "slice-and-dice",
      "ghostly-strike",
      "hemorrhage",
    ]);
    const hemorrhage = presetById(SUBTLETY).rotation.rules.find(
      (rule) => rule.action === "hemorrhage",
    );
    assert.ok(
      hemorrhage.conditions.every((c) => c.type !== "debuffRemaining"),
      "Hemorrhage is the builder, not kept for its debuff",
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

  for (const [id, signatures] of Object.entries(SIGNATURES)) {
    it(`${id}: each signature on each of ${SAMPLE_SEEDS.length} seeds${id === SUBTLETY ? ", and no Eviscerate" : ""}`, () => {
      for (const duration of [SHORT_FIGHT, LONG_FIGHT]) {
        const casts = SAMPLE_SEEDS.map((seed) => {
          const fight = createFight(seed, withReferenceBuild(id));
          fight.simulation.run(duration);
          const stats = fight.simulation.abilityStats;
          return (ability) => stats[ability]?.casts ?? 0;
        });
        for (const ability of signatures) {
          const counts = casts.map((of) => of(ability));
          const cast = counts.filter((n) => n > 0).length / counts.length;
          const label = `${id} ${duration}s ${ability}`;
          assert.equal(cast, 1, `${label}: cast on every seed`);
        }
        // Subtlety has no Eviscerate rule (#310); Assassination's spends
        // spare energy at 4 CP.
        if (id === SUBTLETY) {
          for (const of of casts) {
            assert.equal(of("eviscerate"), 0, `${id} ${duration}s Eviscerate`);
          }
        }
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
  it("has one for each of the three presets (James's decision, relayed by Scout)", () => {
    assert.deepEqual(Object.keys(PRESET_REFERENCE_BUILDS).sort(), [
      ASSASSINATION,
      COMBAT,
      SUBTLETY,
    ]);
    for (const { id } of listPresets()) {
      assert.notEqual(referenceBuild(id), null, id);
    }
    assert.throws(() => referenceBuild("nope"), RangeError);
  });

  it("every build carries talent level 60, which #273 sets on a config below it", () => {
    assert.equal(LEVEL_60, 60);
    for (const id of [ASSASSINATION, COMBAT, SUBTLETY]) {
      assert.equal(referenceBuild(id).talentLevel, LEVEL_60, id);
    }
  });

  it("each is a legal level 60 build of 51 points", () => {
    for (const id of [ASSASSINATION, COMBAT, SUBTLETY]) {
      const build = referenceBuild(id);
      assert.deepEqual(
        buildProblems(build.talents, { level: LEVEL_60 }),
        [],
        id,
      );
      const points = Object.values(build.talents).reduce((a, b) => a + b, 0);
      assert.equal(points, 51, id);
    }
  });

  it("the dagger presets' builds have the dagger alternate's main hand and James's ruled off hand (#310)", () => {
    for (const id of [ASSASSINATION, SUBTLETY]) {
      const build = referenceBuild(id);
      assert.deepEqual(build.weapons.mainHand, k("weapon.dagger.mainHand"));
      assert.deepEqual(
        build.weapons.offHand,
        k("presetReferenceBuild.daggerOffHand"),
      );
    }
  });

  it("Combat swords' build is the current defaults: the #151 Combat talents and the default config's swords", () => {
    const build = referenceBuild(COMBAT);
    assert.deepEqual(build.talents, combatReferenceTalents());
    const defaults = defaultConfig();
    assert.deepEqual(build.weapons, defaults.weapons);
    assert.equal(build.weapons.mainHand.type, "sword");
    assert.equal(build.weapons.offHand.type, "sword");
    assert.equal(build.talentLevel, defaults.talentLevel);
    // Applying it to the default config changes no talent and no weapon type.
    assert.deepEqual(talentDifferences(build, combatReferenceTalents()), []);
    const types = weaponTypeDifferences(build, defaults.weapons);
    assert.equal(types.mainHand.same && types.offHand.same, true);
    // Each hand put into a config reads back as the default hand.
    const config = normalizeConfig({
      weapons: {
        mainHand: referenceWeapon(build, "mainHand"),
        offHand: referenceWeapon(build, "offHand"),
      },
    });
    assert.deepEqual(config.weapons, normalizeConfig(defaultConfig()).weapons);
  });

  it("Combat swords with its build casts its cooldowns and finishers", () => {
    const build = referenceBuild(COMBAT);
    const config = loadPreset(COMBAT, {
      talents: { ...build.talents },
      weapons: build.weapons,
    });
    for (const seed of SEEDS) {
      const fight = createFight(seed, config);
      fight.simulation.run(LONG_FIGHT);
      const stats = fight.simulation.abilityStats;
      for (const id of [
        "blade-flurry",
        "adrenaline-rush",
        "slice-and-dice",
        "sinister-strike",
      ]) {
        assert.ok(stats[id]?.casts > 0, `${id} seed ${seed}`);
      }
    }
  });

  it("Assassination has Mutilate, Venom and Cold Blood and no Improved Expose Armor; Subtlety has Hemorrhage, Premeditation, Preparation and Ghostly Strike and no Cutthroat (#310)", () => {
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
      "subtlety.premeditation",
      "subtlety.preparation",
      "subtlety.ghostly-strike",
    ]) {
      assert.ok(subtlety[id] > 0, id);
    }
    assert.equal(subtlety["subtlety.cutthroat"], undefined);
  });

  it("referenceBuild gives a copy: changing it changes nothing else", () => {
    const build = referenceBuild(SUBTLETY);
    build.talents["subtlety.quietus"] = 0;
    build.weapons.mainHand.min = 1;
    build.poisons.mainHand = "wound";
    assert.equal(referenceBuild(SUBTLETY).talents["subtlety.quietus"], 5);
    assert.equal(referenceBuild(SUBTLETY).poisons.mainHand, "instant");
    assert.notEqual(
      referenceBuild(SUBTLETY).poisons,
      referenceBuild(SUBTLETY).poisons,
    );
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
    // Only the map's own ranks count (Kira's #304 N6): an inherited one is
    // not a rank, and the prototype's keys are not talents.
    const inherited = Object.create({ "combat.precision": 1 });
    Object.assign(inherited, build.talents);
    assert.deepEqual(talentDifferences(build, inherited), []);
    assert.deepEqual(
      talentDifferences(build, { ...build.talents, constructor: 0 }),
      [],
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
      k("presetReferenceBuild.daggerOffHand"),
    );
    assert.throws(() => referenceWeapon(build, "ranged"), RangeError);
    const config = normalizeConfig({
      weapons: { mainHand: referenceWeapon(build, "mainHand") },
    });
    assert.deepEqual(config.weapons.mainHand, k("weapon.dagger.mainHand"));
  });

  it("each build carries its preset's poisons: Deadly MH / Instant OH on Combat, Instant MH / Deadly OH on the daggers (James's ruling, #310)", () => {
    const rulings = k("presetReferenceBuild.poisons");
    assert.deepEqual(rulings, {
      [COMBAT]: { mainHand: "deadly", offHand: "instant" },
      [ASSASSINATION]: { mainHand: "instant", offHand: "deadly" },
      [SUBTLETY]: { mainHand: "instant", offHand: "deadly" },
    });
    for (const id of [ASSASSINATION, COMBAT, SUBTLETY]) {
      const build = referenceBuild(id);
      assert.deepEqual(build.poisons, rulings[id], id);
      // The SimConfig shape: a config reads it back as it is.
      assert.deepEqual(
        normalizeConfig({ poisons: build.poisons }).poisons,
        build.poisons,
        id,
      );
    }
  });

  it("referencePoison gives a hand's poison id; poisonDifferences compares each hand", () => {
    const build = referenceBuild(ASSASSINATION);
    assert.equal(referencePoison(build, "mainHand"), "instant");
    assert.equal(referencePoison(build, "offHand"), "deadly");
    assert.throws(() => referencePoison(build, "ranged"), RangeError);
    // The default config has no poisons.
    assert.deepEqual(poisonDifferences(build, defaultConfig().poisons), {
      mainHand: { reference: "instant", current: null, same: false },
      offHand: { reference: "deadly", current: null, same: false },
    });
    for (const none of [undefined, null, "instant", ["instant"]]) {
      assert.deepEqual(poisonDifferences(build, none), {
        mainHand: { reference: "instant", current: null, same: false },
        offHand: { reference: "deadly", current: null, same: false },
      });
    }
    // An inherited hand is not the config's poison (Kira's #304 N5).
    assert.deepEqual(
      poisonDifferences(build, Object.create({ mainHand: "instant" })),
      {
        mainHand: { reference: "instant", current: null, same: false },
        offHand: { reference: "deadly", current: null, same: false },
      },
    );
    assert.deepEqual(
      poisonDifferences(build, { mainHand: "instant", offHand: "instant" }),
      {
        mainHand: { reference: "instant", current: "instant", same: true },
        offHand: { reference: "deadly", current: "instant", same: false },
      },
    );
    const same = poisonDifferences(build, { ...build.poisons });
    assert.equal(same.mainHand.same && same.offHand.same, true);
  });

  it("js/rotation-presets.js re-exports every helper #273 needs", () => {
    for (const name of [
      "referenceBuild",
      "referenceWeapon",
      "referencePoison",
      "talentDifferences",
      "weaponTypeDifferences",
      "poisonDifferences",
    ]) {
      assert.equal(typeof presetApi[name], "function", name);
    }
  });

  it("the reference poisons change the fight: Venom and Mutilate's poisoned bonus have Deadly to read", () => {
    const build = referenceBuild(ASSASSINATION);
    const poisoned = runFight({
      seed: 1,
      duration: 60,
      config: withReferenceBuild(ASSASSINATION),
    });
    const bare = runFight({
      seed: 1,
      duration: 60,
      config: loadPreset(ASSASSINATION, {
        talents: { ...build.talents },
        weapons: build.weapons,
      }),
    });
    assert.ok(poisoned.dps > bare.dps);
  });

  it("checkReferenceBuild accepts the documented fields and refuses bad ones", () => {
    const good = referenceBuild(SUBTLETY);
    assert.deepEqual(checkReferenceBuild(SUBTLETY, good), []);
    assert.deepEqual(checkReferenceBuild(COMBAT, referenceBuild(COMBAT)), []);
    const { talentLevel, ...noLevel } = good;
    const { poisons, ...noPoisons } = good;
    assert.deepEqual(poisons, { mainHand: "instant", offHand: "deadly" });
    assert.equal(talentLevel, LEVEL_60);
    // Kira's #304 N5: the level is named as given, so the string "60" is
    // not reported as 60.
    assert.ok(
      checkReferenceBuild(SUBTLETY, { ...good, talentLevel: "60" }).includes(
        'talentLevel is "60", not 60.',
      ),
    );
    const fewer = { ...good.talents };
    delete fewer["subtlety.quietus"];
    const bad = [
      ["nope", good],
      [SUBTLETY, { ...good, talentLevel: "60" }],
      // The 51-point contract: no points and fewer than 51 are refused.
      [SUBTLETY, { ...good, talents: {} }],
      [SUBTLETY, { ...good, talents: fewer }],
      // A weapon type the SimConfig does not know.
      [
        SUBTLETY,
        {
          ...good,
          weapons: {
            ...good.weapons,
            mainHand: { ...good.weapons.mainHand, type: "spoon" },
          },
        },
      ],
      // An inherited hand is not a hand, and a third hand is refused.
      [SUBTLETY, { ...good, poisons: Object.create(good.poisons) }],
      [SUBTLETY, { ...good, poisons: { ...good.poisons, ranged: "instant" } }],
      [SUBTLETY, noLevel],
      [SUBTLETY, { ...good, talentLevel: 5 }],
      [SUBTLETY, { ...good, talentLevel: 40 }],
      [SUBTLETY, noPoisons],
      [SUBTLETY, { ...good, poisons: { mainHand: "instant" } }],
      [SUBTLETY, { ...good, poisons: { mainHand: "nope", offHand: "deadly" } }],
      [
        SUBTLETY,
        { ...good, poisons: { mainHand: "deadly", offHand: "instant" } },
      ],
      [SUBTLETY, { ...good, poisons: { mainHand: null, offHand: null } }],
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
      // #310: Combat's ruling is Deadly MH / Instant OH, so the daggers'
      // pair is refused on it.
      [
        COMBAT,
        {
          ...referenceBuild(COMBAT),
          poisons: { mainHand: "instant", offHand: "deadly" },
        },
      ],
    ];
    for (const [id, build] of bad) {
      assert.ok(
        checkReferenceBuild(id, build).length > 0,
        JSON.stringify(build).slice(0, 80),
      );
    }
  });
});
