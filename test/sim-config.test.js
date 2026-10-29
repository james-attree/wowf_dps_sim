import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { createFight, runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Weapon } from "../js/weapon.js";
import { Simulation } from "../js/simulation.js";
import {
  defaultConfig,
  defaultDaggerConfig,
  normalizeConfig,
} from "../js/sim-config.js";
import { defaultRotation } from "../js/rotation-default.js";
import { talentCatalogue } from "../js/talents.js";
import { runScriptedFight } from "../scripts/scripted-fight.mjs";
import { referenceBuild } from "./talentsforever.js";

const DURATION = 30;
const REFERENCE_BUILD = referenceBuild();

function rejects(config, error, pattern, label) {
  assert.throws(
    () => normalizeConfig(config),
    { name: error.name, message: pattern },
    label,
  );
}

describe("defaultDaggerConfig", () => {
  it("is the default config with the dagger sheet and the dagger pair", () => {
    const expected = defaultConfig();
    expected.character.attackPower = k("character.dagger.attackPower");
    expected.character.critChance = k("character.dagger.critChance");
    for (const hand of ["mainHand", "offHand"]) {
      const { min, max, speed, type } = k(`weapon.dagger.${hand}`);
      expected.weapons[hand] = { min, max, speed, type };
    }
    assert.deepEqual(defaultDaggerConfig(), expected);
    assert.equal(defaultDaggerConfig().weapons.mainHand.type, "dagger");
    assert.equal(defaultDaggerConfig().weapons.offHand.type, "dagger");
    // The recomputed values, as literals (issue #127): 100 + 157 Str + 410 Agi
    // + 102 gear AP, and 410 Agi / 29 + 8% gear crit.
    const dagger = defaultDaggerConfig();
    assert.equal(dagger.character.attackPower, 769);
    assert.equal(dagger.character.critChance, 0.2214);
    assert.equal(dagger.character.bonusHitChance, 0.07);
    assert.deepEqual(dagger.weapons.mainHand, {
      min: 73,
      max: 137,
      speed: 1.8,
      type: "dagger",
    });
    assert.deepEqual(dagger.weapons.offHand, {
      min: 57,
      max: 107,
      speed: 1.6,
      type: "dagger",
    });
    // The sword default, as literals too: 100 + 166 Str + 419 Agi + 82.
    assert.equal(defaultConfig().character.attackPower, 767);
    assert.equal(defaultConfig().character.critChance, 0.2245);
    // The fight accepts it and records it.
    const result = runFight({
      seed: 3,
      duration: 20,
      config: defaultDaggerConfig(),
    });
    assert.deepEqual(result.config, defaultDaggerConfig());
  });
});

describe("defaultConfig", () => {
  it("is built from the constants, in full form", () => {
    assert.deepEqual(defaultConfig(), {
      character: {
        attackPower: k("character.attackPower"),
        critChance: k("character.critChance"),
        bonusHitChance: k("character.bonusHitChance"),
      },
      weapons: {
        mainHand: {
          min: k("weapon.mainHand").min,
          max: k("weapon.mainHand").max,
          speed: k("weapon.mainHand").speed,
          type: k("weapon.mainHand").type,
        },
        offHand: {
          min: k("weapon.offHand").min,
          max: k("weapon.offHand").max,
          speed: k("weapon.offHand").speed,
          type: k("weapon.offHand").type,
        },
      },
      target: { behind: k("target.behind") },
      talents: {},
      poisons: { mainHand: null, offHand: null },
      rotation: defaultRotation(),
    });
  });

  it("is a new object each call, so one fight cannot change another's defaults", () => {
    const first = defaultConfig();
    first.character.attackPower = 1;
    first.weapons.mainHand.min = 1;
    first.talents["combat.precision"] = 5;
    assert.deepEqual(defaultConfig(), normalizeConfig());
    assert.notEqual(defaultConfig().weapons, defaultConfig().weapons);
  });
});

describe("normalizeConfig defaults and merging", () => {
  it("gives the defaults for undefined, {} and empty sections", () => {
    const expected = defaultConfig();
    assert.deepEqual(normalizeConfig(), expected);
    assert.deepEqual(normalizeConfig(undefined), expected);
    assert.deepEqual(normalizeConfig({}), expected);
    assert.deepEqual(
      normalizeConfig({
        character: {},
        weapons: { mainHand: {}, offHand: {} },
        talents: {},
        poisons: {},
      }),
      expected,
    );
  });

  it("fills in only what is missing", () => {
    const config = normalizeConfig({
      character: { attackPower: 900 },
      weapons: { mainHand: { speed: 2.6, type: "dagger" } },
      poisons: { offHand: "deadly" },
    });
    const expected = defaultConfig();
    expected.character.attackPower = 900;
    expected.weapons.mainHand.speed = 2.6;
    expected.weapons.mainHand.type = "dagger";
    expected.poisons.offHand = "deadly";
    assert.deepEqual(config, expected);
  });

  it("treats an undefined field like a missing one", () => {
    assert.deepEqual(
      normalizeConfig({
        character: { attackPower: undefined },
        weapons: { mainHand: { type: undefined } },
        poisons: { mainHand: undefined },
      }),
      defaultConfig(),
    );
  });

  it("is idempotent, and shares nothing with its input", () => {
    const input = {
      character: { critChance: 0.25 },
      talents: { "combat.precision": 3, "assassination.malice": 0 },
      poisons: { mainHand: "instant" },
    };
    const once = normalizeConfig(input);
    assert.deepEqual(normalizeConfig(once), once);
    assert.notEqual(normalizeConfig(once), once);
    assert.notEqual(normalizeConfig(once).character, once.character);
    input.character.critChance = 0.9;
    input.talents["combat.precision"] = 1;
    assert.equal(once.character.critChance, 0.25);
    assert.equal(once.talents["combat.precision"], 3);
  });

  it("accepts a null-prototype object", () => {
    const config = Object.assign(Object.create(null), { character: {} });
    assert.deepEqual(normalizeConfig(config), defaultConfig());
  });

  it("is plain data that JSON and structuredClone carry unchanged", () => {
    const config = normalizeConfig({
      talents: { "combat.precision": 3 },
      poisons: { mainHand: "wound" },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
    assert.deepEqual(structuredClone(config), config);
  });

  it("takes the edges of every range", () => {
    const config = normalizeConfig({
      character: { attackPower: 0, critChance: 1, bonusHitChance: 0 },
      weapons: {
        mainHand: {
          min: 0,
          max: 0,
          speed: k("config.minWeaponSpeed"),
          type: null,
        },
        offHand: { min: 5, max: 5, type: "fist" },
      },
    });
    assert.equal(config.character.attackPower, 0);
    assert.equal(config.character.critChance, 1);
    assert.equal(config.weapons.mainHand.type, null);
    assert.equal(config.weapons.offHand.min, config.weapons.offHand.max);
  });

  it("accepts every listed weapon type and poison", () => {
    for (const type of k("config.weaponTypes")) {
      assert.equal(
        normalizeConfig({ weapons: { offHand: { type } } }).weapons.offHand
          .type,
        type,
      );
    }
    for (const poison of k("config.poisonIds")) {
      assert.equal(
        normalizeConfig({ poisons: { mainHand: poison } }).poisons.mainHand,
        poison,
      );
    }
  });
});

describe("normalizeConfig strict validation", () => {
  it("rejects a config that is not a plain object, and says what it was", () => {
    for (const [bad, kind] of [
      [null, "null"],
      [5, "number"],
      ["x", "string"],
      [[], "an array"],
      [() => ({}), "function"],
      [new Map(), "object"],
    ]) {
      rejects(bad, TypeError, /^config must be an object, not /, kind);
    }
    rejects(null, TypeError, /not null\./);
    rejects([], TypeError, /not an array\./);
  });

  it("rejects an unknown key at every level, naming it and the allowed ones", () => {
    rejects(
      { charcter: {} },
      RangeError,
      /config has an unknown field "charcter"\. Allowed fields: character, weapons, target, talents, poisons, rotation\./,
    );
    rejects(
      { character: { ap: 5 } },
      RangeError,
      /config\.character has an unknown field "ap"\. Allowed fields: attackPower, critChance, bonusHitChance\./,
    );
    rejects(
      { weapons: { mainhand: {} } },
      RangeError,
      /config\.weapons has an unknown field "mainhand"\. Allowed fields: mainHand, offHand\./,
    );
    rejects(
      { weapons: { offHand: { dps: 3 } } },
      RangeError,
      /config\.weapons\.offHand has an unknown field "dps"\. Allowed fields: min, max, speed, type\./,
    );
    rejects(
      { poisons: { both: "deadly" } },
      RangeError,
      /config\.poisons has an unknown field "both"/,
    );
    rejects(
      JSON.parse('{"__proto__": {}}'),
      RangeError,
      /unknown field "__proto__"/,
    );
  });

  it("rejects a target that is not a position, and an unknown target field", () => {
    for (const behind of ["yes", 1, 0, null, {}]) {
      rejects(
        { target: { behind } },
        TypeError,
        /^config\.target\.behind must be true or false, not /,
        String(behind),
      );
    }
    rejects(
      { target: { front: true } },
      RangeError,
      /config\.target has an unknown field "front"\. Allowed fields: behind\./,
    );
    assert.equal(
      normalizeConfig({ target: { behind: false } }).target.behind,
      false,
    );
    assert.equal(normalizeConfig({ target: {} }).target.behind, true);
  });

  it("takes the default position from target.behind, not from a literal", () => {
    const before = CONSTANTS["target.behind"].value;
    CONSTANTS["target.behind"].value = false;
    try {
      assert.equal(defaultConfig().target.behind, false);
      assert.equal(normalizeConfig({}).target.behind, false);
      assert.equal(normalizeConfig({ target: {} }).target.behind, false);
      assert.equal(
        normalizeConfig({ target: { behind: true } }).target.behind,
        true,
      );
    } finally {
      CONSTANTS["target.behind"].value = before;
    }
  });

  it("rejects a section that is not an object", () => {
    for (const section of ["character", "weapons", "talents", "poisons"]) {
      rejects(
        { [section]: 7 },
        TypeError,
        new RegExp(`^config\\.${section} must be an object, not number\\.`),
        section,
      );
      rejects(
        { [section]: null },
        TypeError,
        new RegExp(`^config\\.${section} must be an object, not null\\.`),
        section,
      );
    }
    rejects(
      { weapons: { mainHand: [] } },
      TypeError,
      /^config\.weapons\.mainHand must be an object, not an array\./,
    );
  });

  it("rejects bad character numbers, naming the field and the value", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejects(
        { character: { attackPower: bad } },
        RangeError,
        new RegExp(
          `^config\\.character\\.attackPower must be a number 0 or more, not ${bad}\\.`,
        ),
        String(bad),
      );
    }
    for (const field of ["critChance", "bonusHitChance"]) {
      for (const bad of [-0.1, 1.5, Number.NaN]) {
        rejects(
          { character: { [field]: bad } },
          RangeError,
          new RegExp(
            `^config\\.character\\.${field} must be a number between 0 and 1, not ${bad}\\.`,
          ),
          `${field} ${bad}`,
        );
      }
    }
    for (const bad of ["450", null, true, {}, 10n]) {
      assert.throws(
        () => normalizeConfig({ character: { attackPower: bad } }),
        TypeError,
        String(bad),
      );
    }
    rejects(
      { character: { attackPower: "450" } },
      TypeError,
      /config\.character\.attackPower must be a number 0 or more, not "450"\./,
    );
  });

  it("rejects bad weapon numbers", () => {
    for (const field of ["min", "max"]) {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        rejects(
          { weapons: { offHand: { [field]: bad } } },
          RangeError,
          new RegExp(
            `^config\\.weapons\\.offHand\\.${field} must be a whole number 0 or more, not ${bad}\\.`,
          ),
          `${field} ${bad}`,
        );
      }
    }
    for (const bad of [0, -1.8, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => normalizeConfig({ weapons: { mainHand: { speed: bad } } }),
        RangeError,
        String(bad),
      );
    }
    rejects(
      { weapons: { mainHand: { speed: 0 } } },
      RangeError,
      /config\.weapons\.mainHand\.speed must be a number 0\.1 or more, not 0\./,
    );
    rejects(
      { weapons: { mainHand: { speed: "1.8" } } },
      TypeError,
      /config\.weapons\.mainHand\.speed must be a number 0\.1 or more, not "1\.8"\./,
    );
  });

  it("rejects min above max, whether given or defaulted", () => {
    rejects(
      { weapons: { mainHand: { min: 20, max: 10 } } },
      RangeError,
      /config\.weapons\.mainHand\.min \(20\) is greater than config\.weapons\.mainHand\.max \(10\)\./,
    );
    rejects(
      { weapons: { offHand: { min: k("weapon.offHand").max + 1 } } },
      RangeError,
      /config\.weapons\.offHand\.min \(\d+\) is greater than config\.weapons\.offHand\.max \(\d+\)\./,
    );
  });

  it("rejects an unknown or non-string weapon type, and lists the choices", () => {
    rejects(
      { weapons: { mainHand: { type: "Dagger" } } },
      RangeError,
      /config\.weapons\.mainHand\.type has an unknown weapon type "Dagger"\. Use one of: dagger, sword, mace, axe, fist, other, or null for none\./,
    );
    rejects(
      { weapons: { offHand: { type: 3 } } },
      TypeError,
      /config\.weapons\.offHand\.type must be a weapon type id \(.*\) or null, not 3\./,
    );
  });

  it("rejects an unknown or non-string poison", () => {
    rejects(
      { poisons: { mainHand: "venom" } },
      RangeError,
      /config\.poisons\.mainHand has an unknown poison "venom"\. Use one of: instant, deadly, wound, crippling, mind-numbing, or null for none\./,
    );
    rejects(
      { poisons: { offHand: false } },
      TypeError,
      /config\.poisons\.offHand must be a poison id \(.*\) or null, not false\./,
    );
  });
});

describe("normalizeConfig talents", () => {
  const precision = talentCatalogue.get("combat.precision");

  it("keeps a rank by catalogue id, drops a rank of 0, and orders by catalogue", () => {
    const config = normalizeConfig({
      talents: {
        "subtlety.premeditation": 1,
        "combat.precision": precision.max,
        "assassination.malice": 0,
      },
    });
    assert.deepEqual(config.talents, {
      "combat.precision": precision.max,
      "subtlety.premeditation": 1,
    });
    assert.deepEqual(
      Object.keys(config.talents),
      Object.keys(config.talents).sort(
        (a, b) =>
          talentCatalogue.talents.indexOf(talentCatalogue.get(a)) -
          talentCatalogue.talents.indexOf(talentCatalogue.get(b)),
      ),
    );
  });

  it("gives one config for two spellings of one build", () => {
    assert.deepEqual(
      normalizeConfig({
        talents: { "combat.precision": 2, "assassination.malice": 0 },
      }),
      normalizeConfig({ talents: { "combat.precision": 2 } }),
    );
    assert.equal(
      JSON.stringify(
        normalizeConfig({
          talents: { "subtlety.premeditation": 1, "combat.precision": 2 },
        }),
      ),
      JSON.stringify(
        normalizeConfig({
          talents: { "combat.precision": 2, "subtlety.premeditation": 1 },
        }),
      ),
    );
  });

  it("accepts every talent at rank 0 and at its max", () => {
    for (const talent of talentCatalogue.talents) {
      assert.deepEqual(
        normalizeConfig({ talents: { [talent.id]: 0 } }).talents,
        {},
      );
      assert.equal(
        normalizeConfig({ talents: { [talent.id]: talent.max } }).talents[
          talent.id
        ],
        talent.max,
      );
    }
  });

  it("rejects an unknown talent id, naming it", () => {
    rejects(
      { talents: { "combat.nope": 1 } },
      RangeError,
      /config\.talents names an unknown talent "combat\.nope"\. Use a catalogue id such as "combat\.precision"\./,
    );
    rejects(
      { talents: { Precision: 1 } },
      RangeError,
      /unknown talent "Precision"/,
    );
    rejects(
      { talents: JSON.parse('{"__proto__": 1}') },
      RangeError,
      /__proto__/,
    );
  });

  it("rejects a rank that is not a whole number from 0 to the talent's max", () => {
    for (const bad of [-1, precision.max + 1, 1.5, Number.NaN]) {
      rejects(
        { talents: { "combat.precision": bad } },
        RangeError,
        new RegExp(
          `^config\\.talents\\["combat\\.precision"\\] must be a whole number between 0 and ${precision.max}, not ${bad}\\.`,
        ),
        String(bad),
      );
    }
    for (const bad of ["2", null, true, undefined]) {
      assert.throws(
        () => normalizeConfig({ talents: { "combat.precision": bad } }),
        TypeError,
        String(bad),
      );
    }
    rejects(
      { talents: { "combat.precision": undefined } },
      TypeError,
      /config\.talents\["combat\.precision"\] must be a whole number between 0 and \d+, not undefined\./,
    );
  });

  it("does not check the 51 points, the rows, or the prerequisites (that is D7)", () => {
    const all = Object.fromEntries(
      talentCatalogue.talents.map((talent) => [talent.id, talent.max]),
    );
    assert.equal(
      Object.keys(normalizeConfig({ talents: all }).talents).length,
      talentCatalogue.talents.length,
    );
  });

  it("reads each given rank once", () => {
    const reads = {};
    const talents = {};
    for (const [id, rank] of [
      ["combat.precision", 2],
      ["subtlety.premeditation", 1],
      ["assassination.malice", 0],
    ]) {
      reads[id] = 0;
      Object.defineProperty(talents, id, {
        enumerable: true,
        get() {
          reads[id] += 1;
          return rank;
        },
      });
    }
    const config = normalizeConfig({ talents });
    assert.deepEqual(reads, {
      "combat.precision": 1,
      "subtlety.premeditation": 1,
      "assassination.malice": 1,
    });
    assert.deepEqual(config.talents, {
      "combat.precision": 2,
      "subtlety.premeditation": 1,
    });
  });

  it("uses the catalogue it is given", () => {
    const catalogue = {
      get: (id) => (id === "x.y" ? { id, max: 2 } : undefined),
      talents: [{ id: "x.y", max: 2 }],
    };
    assert.deepEqual(
      normalizeConfig({ talents: { "x.y": 2 } }, catalogue).talents,
      { "x.y": 2 },
    );
    assert.throws(
      () => normalizeConfig({ talents: { "combat.precision": 1 } }, catalogue),
      /unknown talent "combat\.precision"/,
    );
  });
});

describe("a fight with no config is the fight there was before", () => {
  it("gives the same result as the default config, and as explicit defaults", () => {
    const plain = runFight({ seed: 7, duration: DURATION });
    assert.deepEqual(
      runFight({ seed: 7, duration: DURATION, config: undefined }),
      plain,
    );
    assert.deepEqual(
      runFight({ seed: 7, duration: DURATION, config: {} }),
      plain,
    );
    assert.deepEqual(
      runFight({ seed: 7, duration: DURATION, config: defaultConfig() }),
      plain,
    );
    assert.deepEqual(plain.config, defaultConfig());
  });

  it("builds the rogue the old way: constants straight into the weapons", () => {
    const rogue = new Rogue();
    assert.equal(rogue.attackPower, k("character.attackPower"));
    assert.equal(rogue.critChance, k("character.critChance"));
    assert.equal(rogue.bonusHitChance, k("character.bonusHitChance"));
    const { mainHand, offHand } = rogue.weapons;
    assert.equal(mainHand.speed, k("weapon.mainHand").speed);
    assert.equal(mainHand.type, k("weapon.mainHand").type);
    assert.equal(offHand.speed, k("weapon.offHand").speed);
    assert.equal(offHand.type, k("weapon.offHand").type);
    assert.equal(offHand.swingTimer, k("weapon.offHand").initialSwing);
    assert.deepEqual(rogue.config, defaultConfig());
  });

  it("a partial talent list is a valid config and an illegal fight (D7)", () => {
    // normalizeConfig checks ids and ranks only; the 51 points, the prerequisites
    // and the row gating are checked when the build is applied, in the Rogue.
    const partial = { talents: { "combat.precision": 3 } };
    assert.deepEqual(normalizeConfig(partial).talents, {
      "combat.precision": 3,
    });
    assert.throws(
      () => runFight({ seed: 11, duration: DURATION, config: partial }),
      { name: "RangeError", message: /combat\.precision/ },
    );
    assert.throws(() => createFight(11, partial), RangeError);
  });

  it("no poison, and a poison that deals no DPS here, leave the fight and the rng alone", () => {
    const plain = createFight(11);
    plain.simulation.run(DURATION);
    const next = plain.simulation.rng();
    for (const poisons of [
      { mainHand: null, offHand: null },
      { mainHand: "wound", offHand: "crippling" },
      { mainHand: "mind-numbing" },
    ]) {
      const dressed = createFight(11, { poisons });
      dressed.simulation.run(DURATION);
      assert.equal(dressed.simulation.rng(), next);
      assert.equal(
        dressed.simulation.damageDone,
        plain.simulation.damageDone,
        JSON.stringify(poisons),
      );
    }
  });

  it("Instant and Deadly Poison are read: they deal damage (A5)", () => {
    const poisoned = runFight({
      seed: 11,
      duration: DURATION,
      config: { poisons: { mainHand: "instant", offHand: "deadly" } },
    });
    assert.deepEqual(poisoned.config.poisons, {
      mainHand: "instant",
      offHand: "deadly",
    });
    assert.ok(poisoned.abilities["Instant Poison"].damage > 0);
    assert.ok(poisoned.abilities["Deadly Poison"].damage > 0);
  });

  it("zero-rank talents leave the rng stream where it was", () => {
    const zeros = Object.fromEntries(
      talentCatalogue.talents.map((talent) => [talent.id, 0]),
    );
    const plain = createFight(5);
    const withZeros = createFight(5, { talents: zeros });
    plain.simulation.run(DURATION);
    withZeros.simulation.run(DURATION);
    assert.equal(withZeros.simulation.rng(), plain.simulation.rng());
    assert.deepEqual(withZeros.config.talents, {});
  });
});

describe("a config changes the fight it names", () => {
  it("character stats and weapons reach the rogue", () => {
    const config = {
      character: { attackPower: 1000, critChance: 0.3, bonusHitChance: 0.05 },
      weapons: {
        mainHand: { min: 100, max: 120, speed: 2.6, type: "dagger" },
        offHand: { min: 80, max: 90, speed: 1.4, type: "sword" },
      },
    };
    const { rogue } = createFight(1, config);
    assert.equal(rogue.attackPower, 1000);
    assert.equal(rogue.critChance, 0.3);
    assert.equal(rogue.bonusHitChance, 0.05);
    assert.equal(rogue.weapons.mainHand.speed, 2.6);
    assert.equal(rogue.weapons.mainHand.minDamage, 100);
    assert.equal(rogue.weapons.mainHand.maxDamage, 120);
    assert.equal(rogue.weapons.mainHand.type, "dagger");
    assert.equal(rogue.weapons.offHand.speed, 1.4);
    assert.equal(rogue.weapons.offHand.minDamage, 80);
    assert.equal(rogue.weapons.offHand.maxDamage, 90);
    assert.equal(rogue.weapons.offHand.type, "sword");
    assert.equal(
      rogue.weapons.offHand.swingTimer,
      k("weapon.offHand").initialSwing,
    );
  });

  it("more attack power gives a different, larger result", () => {
    const low = runFight({ seed: 3, duration: DURATION });
    const high = runFight({
      seed: 3,
      duration: DURATION,
      config: { character: { attackPower: 2000 } },
    });
    assert.ok(high.totalDamage > low.totalDamage);
    assert.equal(high.config.character.attackPower, 2000);
  });

  it("the result's config repeats the fight exactly", () => {
    const first = runFight({
      seed: 9,
      duration: DURATION,
      config: {
        character: { critChance: 0.4 },
        weapons: { mainHand: { type: "dagger" } },
        talents: REFERENCE_BUILD,
      },
    });
    const again = runFight({
      seed: 9,
      duration: DURATION,
      config: first.config,
    });
    assert.deepEqual(again, first);
  });

  it("the same seed and config give the same result, run after run", () => {
    const options = {
      seed: 21,
      duration: DURATION,
      config: { character: { attackPower: 700 } },
    };
    assert.deepEqual(runFight(options), runFight(options));
  });

  it("does not change the config it was given, and the result does not share it", () => {
    const config = { character: { attackPower: 600 } };
    const before = structuredClone(config);
    const result = runFight({ seed: 1, duration: 1, config });
    assert.deepEqual(config, before);
    result.config.character.attackPower = 1;
    const fight = createFight(1, config);
    assert.equal(fight.rogue.attackPower, 600);
    const second = runFight({ seed: 1, duration: 1, config });
    assert.equal(second.config.character.attackPower, 600);
  });

  it("one fight's config cannot leak into the next", () => {
    runFight({
      seed: 1,
      duration: 1,
      config: { weapons: { mainHand: { min: 1, max: 2 } } },
    });
    assert.deepEqual(
      runFight({ seed: 1, duration: 1 }).config,
      defaultConfig(),
    );
  });
});

describe("the weapon speed lower bound", () => {
  const minimum = k("config.minWeaponSpeed");
  const WINDOW = 60;
  const TIME_LIMIT_MS = 5000;

  it("is a positive number below the sample weapons", () => {
    assert.ok(minimum > 0);
    assert.ok(minimum < k("weapon.mainHand").speed);
    assert.ok(minimum < k("weapon.offHand").speed);
  });

  it("rejects a speed below the bound, with the bound in the message", () => {
    for (const speed of [1e-9, 0.001, minimum / 2]) {
      assert.throws(
        () => normalizeConfig({ weapons: { offHand: { speed } } }),
        {
          name: "RangeError",
          message: new RegExp(
            `^config\\.weapons\\.offHand\\.speed must be a number ${minimum} or more, not `,
          ),
        },
        String(speed),
      );
    }
    assert.equal(
      normalizeConfig({ weapons: { mainHand: { speed: minimum } } }).weapons
        .mainHand.speed,
      minimum,
    );
  });

  it("runFight rejects a tiny speed at once instead of hanging", () => {
    const started = Date.now();
    assert.throws(
      () =>
        runFight({
          seed: 1,
          duration: DURATION,
          config: { weapons: { mainHand: { speed: 1e-9 } } },
        }),
      RangeError,
    );
    assert.ok(Date.now() - started < TIME_LIMIT_MS);
  });

  it("a Weapon built directly enforces the bound too", () => {
    assert.throws(() => new Weapon(null, 1, 2, 1e-9, "main"), {
      name: "RangeError",
      message: /Weapon speed must be at least/,
    });
    assert.equal(new Weapon(null, 1, 2, minimum, "main").speed, minimum);
  });

  it("a fight at the legal minimum on both hands still finishes, with swings", () => {
    const started = Date.now();
    const result = runFight({
      seed: 1,
      duration: WINDOW,
      config: {
        weapons: {
          mainHand: { speed: minimum },
          offHand: { speed: minimum },
        },
      },
    });
    assert.ok(Date.now() - started < TIME_LIMIT_MS);
    assert.ok(result.totalDamage > 0);
    assert.equal(result.config.weapons.mainHand.speed, minimum);
    assert.equal(result.config.weapons.offHand.speed, minimum);
  });
});

describe("createFight and runFight options", () => {
  it("createFight returns the config in full form, and the rogue holds the same one", () => {
    const fight = createFight(4, { poisons: { mainHand: "deadly" } });
    assert.equal(fight.config, fight.rogue.config);
    assert.equal(fight.config.poisons.mainHand, "deadly");
    assert.ok(fight.rogue instanceof Rogue);
    assert.ok(fight.simulation instanceof Simulation);
    assert.deepEqual(createFight(4).config, defaultConfig());
  });

  it("a bad config throws before any fight runs, from both entry points", () => {
    assert.throws(
      () => createFight(1, { character: { attackPower: -5 } }),
      /config\.character\.attackPower/,
    );
    assert.throws(
      () =>
        runFight({
          seed: 1,
          duration: 5,
          config: { character: { attackPower: -5 } },
        }),
      /config\.character\.attackPower/,
    );
    assert.throws(
      () => runFight({ seed: 1, duration: 5, config: null }),
      /config must be an object, not null/,
    );
  });

  it("runFight rejects an option it does not know, naming it", () => {
    assert.throws(
      () => runFight({ seed: 1, duration: 5, confg: {} }),
      /runFight has no option "confg"\. Options: seed, duration, config\./,
    );
    assert.throws(
      () => runFight({ seed: 1, duration: 5, script: [] }),
      RangeError,
    );
  });

  it("the scripted harness passes a config through", () => {
    const script = ["sinisterStrike"];
    const plain = runScriptedFight({ seed: 3, duration: 5, script });
    const strong = runScriptedFight({
      seed: 3,
      duration: 5,
      script,
      config: { character: { attackPower: 5000 } },
    });
    assert.deepEqual(plain.config, defaultConfig());
    assert.equal(strong.config.character.attackPower, 5000);
    assert.ok(strong.totalDamage > plain.totalDamage);
  });
});
