import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import { referenceBuild } from "../data/reference-build.js";
import { EnergyPool } from "../js/core/energy.js";
import { Scheduler } from "../js/core/scheduler.js";
import { createFight, runFight } from "../js/fight.js";
import { ModifierPipeline } from "../js/modifiers.js";
import {
  buildRaceCatalogue,
  checkRacialEffects,
  expandRace,
  raceCatalogue,
  racialStatus,
} from "../js/racials.js";
import { RESOURCE_DEFINITIONS } from "../js/resource-data.js";
import { Resource } from "../js/resource.js";
import { Rogue } from "../js/rogue.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { snapshot } from "../js/snapshot.js";
import { ASSASSINATION_BUILD } from "../scripts/golden-update.mjs";

// D12a (#277, P5-02): the races and their passive racials as data.

const RACES = [
  "orc",
  "undead",
  "troll",
  "skyborne-windshaper",
  "human",
  "dwarf",
  "night-elf",
  "gnome",
  "skyborne-high-order",
];
// In the export's order. The on-use racials (#278) are simulated as abilities
// the race grants: Blood Fury and Elune's Light since #278, Berserking and
// Eureka! since #279.
const SIMULATED = [
  "orc.blood-fury",
  "troll.berserking",
  "skyborne-windshaper.wind-blessed",
  "human.ruthless",
  "dwarf.artisans-precision",
  "night-elf.elunes-light",
  "gnome.expansive-mind",
  "gnome.eureka",
  "skyborne-high-order.wind-blessed",
];
const MOB_TYPE = [
  "troll.beast-slaying",
  "skyborne-windshaper.elemental-insight",
  "dwarf.big-game-hunter",
  "skyborne-high-order.elemental-insight",
];
const NOT_SIMULATED = ["undead.touch-of-the-grave"];
const ENERGY = RESOURCE_DEFINITIONS.find(
  (definition) => definition.id === "energy",
);
const POISONS = { mainHand: "instant", offHand: "deadly" };
const SEEDS = [1, 2, 277];
const SECONDS = 60;
const PERCENT = 100;
const VIGOR_CAP = 110;
const VIGOR_GNOME_CAP = 115;
const GNOME_CAP = 105;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function text(id) {
  return raceCatalogue.racial(id).text;
}

// The first "N%" in a racial's text, as a fraction.
function percentIn(id) {
  const match = /(\d+(?:\.\d+)?)%/.exec(text(id));
  assert.ok(match, `${id}: no percentage in "${text(id)}"`);
  return Number(match[1]) / PERCENT;
}

function sources(modifiers, id) {
  return modifiers.filter((modifier) => modifier.source === id);
}

// A fight with a count of the draws it makes from the generator (G2).
function counted(seed, config) {
  const fight = createFight(seed, config);
  let count = 0;
  const rng = fight.simulation.rng;
  fight.simulation.rng = () => {
    count += 1;
    return rng();
  };
  fight.simulation.run(SECONDS);
  return { fight, count: () => count };
}

function copySnapshot() {
  return structuredClone(snapshot);
}

describe("race catalogue (#277)", () => {
  it("reads the 9 rogue races from the snapshot, 4 racials each", () => {
    assert.deepEqual([...raceCatalogue.ids], RACES);
    for (const race of raceCatalogue.races) {
      assert.equal(race.racials.length, 4, race.id);
      assert.ok(["Horde", "Alliance"].includes(race.faction), race.id);
    }
    assert.equal(raceCatalogue.racials.length, 36);
    assert.ok(Object.isFrozen(raceCatalogue.races[0].racials[0]));
  });

  it("copies every racial name and text from the export", () => {
    for (const [faction, list] of Object.entries(snapshot.racials)) {
      for (const entry of list) {
        if (!entry.classes.includes("Rogue")) {
          continue;
        }
        const race = raceCatalogue.races.find(
          (candidate) => candidate.name === entry.race,
        );
        assert.equal(race.faction, faction);
        assert.deepEqual(
          race.racials.map((racial) => [racial.name, racial.text]),
          entry.abilities.map(([name, body]) => [name, body]),
        );
      }
    }
  });

  it("refuses a malformed export", () => {
    assert.throws(() => buildRaceCatalogue(null), TypeError);
    assert.throws(() => buildRaceCatalogue({ races: {} }), TypeError);
    const unlisted = copySnapshot();
    unlisted.races.Alliance = unlisted.races.Alliance.slice(1);
    assert.throws(() => buildRaceCatalogue(unlisted), /does not list/);
    const missing = copySnapshot();
    missing.races.Horde.push("Goblin");
    assert.throws(() => buildRaceCatalogue(missing), /no entry for it/);
    const badAbility = copySnapshot();
    badAbility.racials.Horde[0].abilities[0] = ["Name", ""];
    assert.throws(() => buildRaceCatalogue(badAbility), TypeError);
    assert.throws(
      () => buildRaceCatalogue(copySnapshot(), "Paladin of Nowhere"),
      /no race for the class/,
    );
  });
});

describe("racial effects (#277)", () => {
  it("has an entry for every racial and no other, in catalogue order", () => {
    assert.deepEqual(
      Object.keys(RACIAL_EFFECTS),
      raceCatalogue.racials.map((racial) => racial.id),
    );
    assert.ok(Object.isFrozen(RACIAL_EFFECTS["human.ruthless"].modifiers[0]));
  });

  it("stores the hash of the text each entry was written from", () => {
    for (const racial of raceCatalogue.racials) {
      assert.equal(
        RACIAL_EFFECTS[racial.id].textHash,
        sha256(racial.text),
        `${racial.id}: the text changed; re-read the effect and set textHash`,
      );
    }
  });

  it("classes the racials: 9 simulated, 4 by target type, 1 not simulated, the rest no DPS effect", () => {
    const by = (status) =>
      raceCatalogue.racials
        .map((racial) => racial.id)
        .filter((id) => racialStatus(id) === status);
    assert.deepEqual(by("simulated"), SIMULATED);
    assert.deepEqual(by("inert"), MOB_TYPE);
    assert.deepEqual(by("notSimulated"), NOT_SIMULATED);
    assert.equal(by("noDpsEffect").length, 36 - 9 - 4 - 1);
    assert.deepEqual(by("unmapped"), []);
  });

  it("reads each value from its export text (A18)", () => {
    assert.match(text("human.ruthless"), /critical strike chance/i);
    assert.equal(k("racial.ruthless.critChance"), percentIn("human.ruthless"));
    assert.match(text("dwarf.artisans-precision"), /hit chance/i);
    assert.equal(
      k("racial.artisansPrecision.hitChance"),
      percentIn("dwarf.artisans-precision"),
    );
    assert.match(text("gnome.expansive-mind"), /Energy/);
    assert.equal(
      k("racial.expansiveMind.energyMax"),
      1 + percentIn("gnome.expansive-mind"),
    );
    for (const id of [
      "skyborne-windshaper.wind-blessed",
      "skyborne-high-order.wind-blessed",
    ]) {
      assert.match(text(id), /melee, and ranged Haste/);
      assert.equal(k("racial.windBlessed.haste"), percentIn(id));
    }
    for (const [id, row, type] of [
      ["troll.beast-slaying", "racial.beastSlaying", /Beasts/],
      ["dwarf.big-game-hunter", "racial.bigGameHunter", /Beasts/],
      [
        "skyborne-windshaper.elemental-insight",
        "racial.elementalInsight",
        /Elementals/,
      ],
      [
        "skyborne-high-order.elemental-insight",
        "racial.elementalInsight",
        /Elementals/,
      ],
    ]) {
      assert.match(text(id), type);
      assert.equal(k(row).damage, percentIn(id), id);
      assert.deepEqual(RACIAL_EFFECTS[id].mobTypes, k(row).mobTypes, id);
    }
  });

  it("refuses an unknown key, an unknown racial and a reason with company", () => {
    const hash = RACIAL_EFFECTS["human.ruthless"].textHash;
    assert.throws(
      () => checkRacialEffects({ "human.ruthles": { textHash: hash } }),
      /no such racial/,
    );
    assert.throws(
      () =>
        checkRacialEffects({
          "human.ruthless": { textHash: hash, noDpsEffect: "x", modifiers: [] },
        }),
      /stands alone/,
    );
    assert.throws(
      () => checkRacialEffects({ "human.ruthless": { textHash: hash, x: 1 } }),
      /unknown key/,
    );
    assert.throws(
      () => checkRacialEffects({ "human.ruthless": { textHash: "abc" } }),
      /textHash/,
    );
    assert.throws(
      () => checkRacialEffects({ "human.ruthless": { textHash: hash } }),
      /needs modifiers/,
    );
  });
});

describe("expandRace (#277)", () => {
  it("gives nothing for no race, and refuses an unknown race", () => {
    assert.deepEqual(expandRace(null), {
      race: null,
      modifiers: [],
      abilities: [],
      racials: [],
    });
    assert.throws(() => expandRace("pandaren"), RangeError);
  });

  it("lists every racial of the race with its status", () => {
    const { racials, modifiers } = expandRace("undead");
    assert.deepEqual(
      racials.map((racial) => racial.status),
      ["noDpsEffect", "noDpsEffect", "noDpsEffect", "notSimulated"],
    );
    assert.deepEqual(modifiers, []);
  });

  it("keeps the mob-type racials inert while the target type is unspecified", () => {
    assert.equal(k("target.mobType"), "unspecified");
    assert.deepEqual(expandRace("troll").modifiers, []);
    const beast = expandRace("troll", undefined, undefined, {
      mobType: "beast",
    });
    assert.deepEqual(
      beast.modifiers.map(({ kind, op, value, source }) => [
        kind,
        op,
        value,
        source,
      ]),
      [
        [
          "damage",
          "add",
          k("racial.beastSlaying").damage,
          "troll.beast-slaying",
        ],
      ],
    );
  });
});

describe("config.race (#277)", () => {
  it("defaults to null, and an old config without it reads as no race (G4)", () => {
    assert.equal(defaultConfig().race, null);
    assert.equal(k("character.race"), null);
    const old = { character: { attackPower: 1000 } };
    assert.equal(normalizeConfig(old).race, null);
    assert.deepEqual(
      normalizeConfig(old),
      normalizeConfig({ ...old, race: null }),
    );
  });

  it("keeps a known race and refuses anything else", () => {
    for (const id of RACES) {
      assert.equal(normalizeConfig({ race: id }).race, id);
    }
    assert.throws(() => normalizeConfig({ race: "Human" }), RangeError);
    assert.throws(() => normalizeConfig({ race: "pandaren" }), RangeError);
    assert.throws(() => normalizeConfig({ race: 7 }));
  });

  it("round-trips through the result config", () => {
    const result = runFight({
      seed: 1,
      duration: 10,
      config: { race: "dwarf" },
    });
    assert.equal(result.config.race, "dwarf");
    assert.deepEqual(
      runFight({ seed: 1, duration: 10, config: result.config }),
      result,
    );
  });
});

describe("race: null is the fight before races (#277)", () => {
  const configs = [
    undefined,
    { talents: referenceBuild(), poisons: POISONS },
    { talents: { ...ASSASSINATION_BUILD }, poisons: POISONS },
  ];
  it("gives a byte-identical result to a config without race", () => {
    for (const config of configs) {
      for (const seed of SEEDS) {
        const plain = runFight({ seed, duration: SECONDS, config });
        const none = runFight({
          seed,
          duration: SECONDS,
          config: { ...config, race: null },
        });
        assert.equal(JSON.stringify(none), JSON.stringify(plain));
      }
    }
  });

  it("adds no modifier", () => {
    const plain = new Rogue({ talents: referenceBuild() });
    const none = new Rogue({ talents: referenceBuild(), race: null });
    assert.deepEqual(none.modifiers.modifiers, plain.modifiers.modifiers);
    assert.equal(none.race.race, null);
  });
});

describe("passive racials in the fight (#277)", () => {
  it("Human Ruthless adds 1% crit to the entered crit (Q7)", () => {
    const plain = new Rogue({});
    const human = new Rogue({ race: "human" });
    assert.equal(
      human.getCritChance({}),
      plain.getCritChance({}) + k("racial.ruthless.critChance"),
    );
    assert.deepEqual(
      sources(human.modifiers.modifiers, "human.ruthless").map(
        ({ kind, op, value }) => [kind, op, value],
      ),
      [["critChance", "add", k("racial.ruthless.critChance")]],
    );
  });

  it("Dwarf Artisan's Precision adds 1% hit to the entered hit (Q7)", () => {
    const plain = new Rogue({});
    const dwarf = new Rogue({ race: "dwarf" });
    assert.equal(
      dwarf.getBonusHitChance({}),
      plain.getBonusHitChance({}) + k("racial.artisansPrecision.hitChance"),
    );
  });

  it("Gnome Expansive Mind: energy cap 105, and 115 with Vigor (A19)", () => {
    assert.equal(new Rogue({ race: "gnome" }).resources.energy.max, GNOME_CAP);
    const vigor = new Rogue({ talents: ASSASSINATION_BUILD });
    assert.equal(vigor.resources.energy.max, VIGOR_CAP);
    const gnome = new Rogue({ talents: ASSASSINATION_BUILD, race: "gnome" });
    assert.equal(gnome.resources.energy.max, VIGOR_GNOME_CAP);
    // The event core's energy pool reads the same cap.
    const pool = new EnergyPool({
      definition: ENERGY,
      modifiers: gnome.modifiers,
      scheduler: new Scheduler({ endTime: SECONDS, handle() {} }),
    });
    assert.equal(pool.max, VIGOR_GNOME_CAP);
  });

  it("rounds an energy cap down after multipliers: 110 x 1.05 = 115.5 -> 115 (A19)", () => {
    const pipeline = new ModifierPipeline([
      {
        kind: "resourceMax",
        op: "mult",
        value: k("racial.expansiveMind.energyMax"),
        scope: { resources: ["energy"] },
        source: "test",
      },
    ]);
    const energy = new Resource(ENERGY, pipeline);
    energy.baseMax = VIGOR_CAP;
    assert.equal(VIGOR_CAP * k("racial.expansiveMind.energyMax"), 115.5);
    assert.equal(energy.max, VIGOR_GNOME_CAP);
    // A whole cap is left as it is, and a product a hair under a whole number
    // (float error) is not dropped a point.
    energy.baseMax = 100;
    assert.equal(energy.max, GNOME_CAP);
    for (let base = 100; base <= 200; base += 20) {
      energy.baseMax = base;
      assert.equal(energy.max, Math.floor((base * 105) / 100), String(base));
    }
    assert.equal(k("energy.maxRounding"), "floor");
  });

  it("refuses an unknown energy rounding", () => {
    assert.throws(
      () =>
        new Resource(
          { ...ENERGY, roundMax: "energy.max" },
          new ModifierPipeline([]),
        ),
      /roundMax/,
    );
  });

  it("Skyborne Wind Blessed is +2% attack speed, multiplied with gear haste (A20)", () => {
    for (const race of ["skyborne-windshaper", "skyborne-high-order"]) {
      const sky = new Rogue({ race });
      assert.equal(
        sky.modifiers.resolve("haste", 1),
        1 + k("racial.windBlessed.haste"),
      );
      const geared = new Rogue({
        race,
        character: { ...defaultConfig().character, haste: 0.05 },
      });
      assert.ok(
        Math.abs(
          geared.modifiers.resolve("haste", 1) -
            1.05 * (1 + k("racial.windBlessed.haste")),
        ) < 1e-12,
      );
    }
  });

  it("Wind Blessed speeds the swings only: energy regen is unchanged", () => {
    const plain = new Rogue({});
    const sky = new Rogue({ race: "skyborne-windshaper" });
    assert.equal(
      sky.modifiers.resolve("energyRegen", 1, { resource: "energy" }),
      plain.modifiers.resolve("energyRegen", 1, { resource: "energy" }),
    );
  });

  it("the two Skyborne races fight the same fight", () => {
    for (const seed of SEEDS) {
      const config = { talents: referenceBuild(), poisons: POISONS };
      const a = runFight({
        seed,
        duration: SECONDS,
        config: { ...config, race: "skyborne-high-order" },
      });
      const b = runFight({
        seed,
        duration: SECONDS,
        config: { ...config, race: "skyborne-windshaper" },
      });
      assert.deepEqual({ ...a, config: null }, { ...b, config: null });
    }
  });

  // Orc, Night Elf (#278) and Troll (#279) grant an on-use racial, but the
  // default rotation has no rule for it, so their default fight is still the
  // no-race fight.
  it("a race with nothing simulated, or nothing the rotation casts, fights the no-race fight", () => {
    for (const race of ["orc", "undead", "troll", "night-elf"]) {
      for (const seed of SEEDS) {
        const plain = runFight({ seed, duration: SECONDS });
        const raced = runFight({ seed, duration: SECONDS, config: { race } });
        assert.deepEqual(
          { ...raced, config: null },
          { ...plain, config: null },
          race,
        );
      }
    }
  });

  it("racials add no proc and draw no random number of their own (G2)", () => {
    const config = { talents: referenceBuild(), poisons: POISONS };
    const plainProcs = new Rogue(config).procs.map((proc) => proc.id);
    for (const race of RACES) {
      assert.deepEqual(
        new Rogue({ ...config, race }).procs.map((proc) => proc.id),
        plainProcs,
        race,
      );
    }
    // A race with no simulated racial draws exactly the no-race draws.
    for (const race of ["orc", "undead", "troll", "night-elf"]) {
      assert.equal(
        counted(1, { ...config, race }).count(),
        counted(1, config).count(),
        race,
      );
    }
  });
});
