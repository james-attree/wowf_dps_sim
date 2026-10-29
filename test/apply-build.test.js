import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { suppressCrit } from "../js/attack-resolver.js";
import { createFight, expandTalents, runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { defaultDaggerConfig } from "../js/sim-config.js";
import {
  applyBuild,
  talentGrantedAbilities,
  validateBuild,
} from "../js/talent-build.js";
import { talentCatalogue } from "../js/talents.js";
import { referenceBuild } from "./talentsforever.js";

// D7 (#106): a selected talent build in config.talents is validated and applied
// by the engine itself, so runFight and createFight run a talented fight from
// the SimConfig alone. The reference build (Assassination 18, Combat 33, the
// link in the issue) is the fixture.

const REFERENCE = referenceBuild();
const SECONDS = 120;
const SEEDS = 40;
const SHORT = 30;
const ASSASSINATION_ABILITIES = [
  "cold-blood",
  "blade-flurry",
  "adrenaline-rush",
];
// Malice 5 / 5 is 5% crit on every attack and poison.
const MALICE_CRIT = 0.05;
const HACK_AND_SLASH_CRIT = 0.05;

// A build that differs from `ranks` by `changes` ({ id: rank }, 0 removes it).
function swap(ranks, changes) {
  const next = { ...ranks, ...changes };
  return Object.fromEntries(
    Object.entries(next).filter(([, rank]) => rank > 0),
  );
}

const points = (ranks) =>
  Object.values(ranks).reduce((total, rank) => total + rank, 0);

// The reference build without Aggression (3 points), those points in a talent
// with no DPS effect (Lightning Reflexes, row 1): still a legal 51.
const NO_AGGRESSION = swap(REFERENCE, {
  "combat.aggression": 0,
  "combat.lightning-reflexes": 3,
});

// Without Blade Flurry, Weapon Expertise (it hangs below Flurry) and Adrenaline
// Rush: 4 points, put in Lightning Reflexes.
const NO_FLURRY_OR_RUSH = swap(REFERENCE, {
  "combat.blade-flurry": 0,
  "combat.weapon-expertise": 0,
  "combat.adrenaline-rush": 0,
  "combat.lightning-reflexes": 4,
});

// 43 Assassination points and 8 Combat points, with Precision on row 2 and
// exactly 5 points on row 1 of Combat above it: the smallest gap row gating
// allows.
const ASSASSINATION_43 = {
  "assassination.improved-gouge": 3,
  "assassination.remorseless-attacks": 2,
  "assassination.malice": 5,
  "assassination.ruthlessness": 3,
  "assassination.murder": 2,
  "assassination.improved-slice-and-dice": 3,
  "assassination.relentless-strikes": 1,
  "assassination.improved-expose-armor": 2,
  "assassination.lethality": 5,
  "assassination.vile-poisons": 5,
  "assassination.cold-blood": 1,
  "assassination.improved-poisons": 5,
  "assassination.vigor": 2,
  "assassination.mutilate": 1,
  "assassination.improved-kidney-shot": 2,
  "assassination.venom": 1,
};
const BOUNDARY = {
  ...ASSASSINATION_43,
  "combat.improved-eviscerate": 3,
  "combat.improved-sinister-strike": 2,
  "combat.precision": 3,
};

function seeded(config, options) {
  const out = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const fight = createFight(seed, config, options);
    fight.simulation.run(SECONDS);
    out.push(fight);
  }
  return out;
}

const mean = (values) =>
  values.reduce((total, value) => total + value, 0) / values.length;

describe("validateBuild: what a character can have", () => {
  it("accepts the reference build, which spends exactly 51 points", () => {
    assert.equal(points(REFERENCE), k("talents.maxPoints"));
    assert.equal(validateBuild(REFERENCE), k("talents.maxPoints"));
  });

  it("accepts a talent exactly rowGating * (row - 1) points below the top", () => {
    assert.equal(points(BOUNDARY), 8 + points(ASSASSINATION_43));
    // 5 + 3 + 43 = 51, with the Combat row-1 points at exactly 5.
    assert.equal(points(BOUNDARY), k("talents.maxPoints"));
    assert.equal(validateBuild(BOUNDARY), k("talents.maxPoints"));
  });

  it("rejects a build one point short of the row above it, by id", () => {
    const short = swap(BOUNDARY, {
      "combat.improved-sinister-strike": 1,
      "assassination.seal-fate": 1,
    });
    assert.equal(points(short), k("talents.maxPoints"));
    assert.throws(() => validateBuild(short), {
      name: "RangeError",
      message:
        /"combat\.precision" is on row 2 of combat, which needs 5 points on the rows above it \(talents\.rowGating\), and the build has 4/,
    });
  });

  it("gates on the row, with a talent far down the tree (Adrenaline Rush, row 7)", () => {
    const top = swap(
      {
        ...ASSASSINATION_43,
        "assassination.seal-fate": 5,
        "subtlety.master-of-deception": 2,
      },
      { "combat.adrenaline-rush": 1 },
    );
    assert.equal(points(top), k("talents.maxPoints"));
    assert.throws(() => validateBuild(top), {
      name: "RangeError",
      message:
        /"combat\.adrenaline-rush" is on row 7 of combat, which needs 30 points on the rows above it \(talents\.rowGating\), and the build has 0/,
    });
  });

  it("counts points per tree: points in another tree do not open a row", () => {
    const wrongTree = { ...ASSASSINATION_43, "combat.precision": 3 };
    assert.throws(
      () => validateBuild(wrongTree),
      /"combat\.precision" is on row 2/,
    );
  });

  // #190: fewer than 51 points is legal; only "exactly 51" was relaxed.
  for (const [label, ranks, total] of [
    ["50 points", swap(REFERENCE, { "combat.aggression": 2 }), 50],
    ["no points", {}, 0],
  ]) {
    it(`accepts ${label}: a partial build is legal (#190)`, () => {
      assert.equal(points(ranks), total);
      assert.equal(validateBuild(ranks), total);
    });
  }

  it("rejects 52 points: at most 51 can be spent", () => {
    const ranks = swap(REFERENCE, { "combat.lightning-reflexes": 1 });
    assert.equal(points(ranks), k("talents.maxPoints") + 1);
    assert.throws(() => validateBuild(ranks), {
      name: "RangeError",
      message:
        /^Talent build is not valid: the build spends 52 talent points, and at most 51 can be spent \(talents\.maxPoints\)\.$/,
    });
  });

  it("requires a prerequisite at full rank, and names both ids", () => {
    // Malice 5 -> 4, the point in Improved Gouge: 51, row gating kept.
    const oneShort = swap(REFERENCE, {
      "assassination.malice": 4,
      "assassination.improved-gouge": 1,
    });
    assert.equal(points(oneShort), k("talents.maxPoints"));
    assert.throws(() => validateBuild(oneShort), {
      name: "RangeError",
      message:
        /"assassination\.lethality" needs its prerequisite "assassination\.malice" at rank 5, and it is at rank 4/,
    });
    const gone = swap(REFERENCE, {
      "combat.precision": 0,
      "combat.lightning-reflexes": 3,
    });
    assert.throws(() => validateBuild(gone), {
      message:
        /"combat\.dual-wield-specialization" needs its prerequisite "combat\.precision" at rank 3, and it is at rank 0/,
    });
  });

  it("lists every problem in one error, with ids and not display names", () => {
    // Precision 3 -> 2 and two more points in Lightning Reflexes: 52 points,
    // and Dual Wield Specialization lost its prerequisite.
    const broken = swap(REFERENCE, {
      "combat.precision": 2,
      "combat.lightning-reflexes": 2,
    });
    let message = "";
    try {
      validateBuild(broken);
    } catch (error) {
      message = error.message;
    }
    assert.match(message, /^Talent build is not valid: /);
    assert.match(message, /spends 52 talent points/);
    assert.match(message, /"combat\.dual-wield-specialization" needs/);
    assert.doesNotMatch(message, /Precision|Dual Wield|Specialization /);
  });

  it("checks ids and ranks first, as expandTalents does", () => {
    assert.throws(() => validateBuild({ "combat.nope": 1 }), {
      name: "RangeError",
      message: /validateBuild got an unknown talent id "combat\.nope"/,
    });
    assert.throws(() => validateBuild({ Precision: 3 }), RangeError);
    assert.throws(() => validateBuild({ "combat.precision": 4 }), {
      name: "RangeError",
      message: /"combat\.precision" has ranks 0 to 3\. Got 4/,
    });
    assert.throws(() => validateBuild(null), RangeError);
  });

  it('shows a string rank in quotes, so "3" is not mistaken for 3', () => {
    assert.throws(() => validateBuild({ "combat.precision": "3" }), {
      name: "RangeError",
      message: /"combat\.precision" has ranks 0 to 3\. Got "3"\./,
    });
    assert.throws(() => validateBuild({ "combat.precision": 3.5 }), {
      message: /Got 3\.5\./,
    });
    assert.throws(() => validateBuild({ "combat.precision": 4 }), {
      message: /Got 4\./,
    });
  });
});

describe("applyBuild", () => {
  it("is expandTalents for a build that passed validateBuild", () => {
    const applied = applyBuild(REFERENCE);
    const expanded = expandTalents(REFERENCE);
    assert.equal(applied.selected, true);
    assert.equal(applied.points, k("talents.maxPoints"));
    for (const key of [
      "modifiers",
      "procs",
      "abilities",
      "noDps",
      "unmapped",
    ]) {
      assert.deepEqual(applied[key], expanded[key], key);
    }
    assert.ok(Object.isFrozen(applied));
  });

  it("applies the reference build: every talent in it has an effect or a reason", () => {
    const { unmapped, abilities, noDps } = applyBuild(REFERENCE);
    assert.deepEqual(unmapped, []);
    assert.deepEqual(
      [...abilities].sort(),
      [...ASSASSINATION_ABILITIES].sort(),
    );
    assert.deepEqual(noDps, ["combat.endurance", "combat.improved-sprint"]);
  });

  it("no ranks, or only zero ranks, is no build: nothing is checked or given", () => {
    for (const ranks of [undefined, {}, { "combat.precision": 0 }]) {
      const build = applyBuild(ranks);
      assert.equal(build.selected, false);
      assert.equal(build.points, 0);
      assert.deepEqual(
        [build.modifiers, build.procs, build.abilities],
        [[], [], []],
      );
    }
  });

  it("a build of one or two points is a selected build, and runs (#190)", () => {
    for (const ranks of [
      { "combat.improved-eviscerate": 1 },
      { "combat.improved-eviscerate": 2 },
      { "combat.improved-eviscerate": 1, "combat.improved-sinister-strike": 1 },
    ]) {
      const small = points(ranks);
      assert.ok(small >= 1 && small <= 2);
      const applied = applyBuild(ranks);
      assert.equal(applied.selected, true);
      assert.equal(applied.points, small);
      assert.doesNotThrow(() =>
        runFight({ seed: 1, duration: 1, config: { talents: ranks } }),
      );
    }
  });

  it("an illegal build is an error, and an unmodelled talent is only reported", () => {
    assert.throws(() => applyBuild({ "combat.precision": 3 }), RangeError);
    // Venom is a legal talent with no entry in the effects data.
    assert.equal(TALENT_EFFECTS["assassination.venom"], undefined);
    const withVenom = swap(BOUNDARY, {});
    assert.deepEqual(applyBuild(withVenom).unmapped.slice(-1), [
      "assassination.venom",
    ]);
  });

  it("names the abilities a talent grants, from the effects data", () => {
    // The reference build's three, and the three Subtlety ones (#207).
    assert.deepEqual(
      [...talentGrantedAbilities].sort(),
      [
        ...ASSASSINATION_ABILITIES,
        "ghostly-strike",
        "premeditation",
        "hemorrhage",
      ].sort(),
    );
  });

  it("is a Set that cannot be changed (#207)", () => {
    assert.ok(talentGrantedAbilities instanceof Set);
    assert.ok(Object.isFrozen(talentGrantedAbilities));
    const before = [...talentGrantedAbilities];
    assert.throws(
      () => talentGrantedAbilities.add("sinister-strike"),
      /^TypeError: talentGrantedAbilities is read-only \(add\)\.$/,
    );
    assert.throws(
      () => talentGrantedAbilities.delete("cold-blood"),
      /^TypeError: talentGrantedAbilities is read-only \(delete\)\.$/,
    );
    assert.throws(
      () => talentGrantedAbilities.clear(),
      /^TypeError: talentGrantedAbilities is read-only \(clear\)\.$/,
    );
    assert.deepEqual([...talentGrantedAbilities], before);
    assert.equal(talentGrantedAbilities.size, before.length);
    assert.ok(talentGrantedAbilities.has("hemorrhage"));
  });
});

describe("a selected build in config.talents runs the fight", () => {
  it("matches the same build expanded by hand, fight for fight", () => {
    const { modifiers, procs, abilities } = expandTalents(REFERENCE);
    for (let seed = 1; seed <= 5; seed += 1) {
      const applied = runFight({
        seed,
        duration: SECONDS,
        config: { talents: REFERENCE },
      });
      const manual = createFight(seed, undefined, {
        modifiers,
        procs,
        abilities,
      });
      manual.simulation.run(SECONDS);
      assert.equal(applied.totalDamage, manual.simulation.damageDone, seed);
      assert.deepEqual(applied.abilities, manual.simulation.abilityBreakdown());
      assert.deepEqual(applied.log, manual.simulation.combatLog);
      assert.deepEqual(applied.config.talents, REFERENCE);
    }
  });

  it("repeats from the result's config", () => {
    const first = runFight({
      seed: 9,
      duration: SHORT,
      config: { talents: REFERENCE },
    });
    assert.deepEqual(
      runFight({ seed: 9, duration: SHORT, config: first.config }),
      first,
    );
  });

  it("returns the applied build, and Rogue.build is the same", () => {
    const fight = createFight(1, { talents: REFERENCE });
    assert.equal(fight.build, fight.rogue.build);
    assert.equal(fight.build.selected, true);
    assert.deepEqual(
      [...fight.build.abilities].sort(),
      [...ASSASSINATION_ABILITIES].sort(),
    );
    assert.equal(createFight(1).build.selected, false);
  });

  it("an illegal build is a RangeError from runFight, createFight and Rogue", () => {
    // 52 points (a partial build is legal since #190).
    const config = {
      talents: swap(REFERENCE, { "combat.lightning-reflexes": 1 }),
    };
    const expected = {
      name: "RangeError",
      message: /spends 52 talent points, and at most 51 can be spent/,
    };
    assert.throws(() => runFight({ seed: 1, duration: 1, config }), expected);
    assert.throws(() => createFight(1, config), expected);
    assert.throws(() => new Rogue(config), expected);
  });

  it("a build with no ranks is the default fight: same result, same rng", () => {
    const plain = runFight({ seed: 5, duration: SECONDS });
    const zeros = Object.fromEntries(
      talentCatalogue.talents.map((talent) => [talent.id, 0]),
    );
    for (const talents of [{}, zeros]) {
      assert.deepEqual(
        runFight({ seed: 5, duration: SECONDS, config: { talents } }),
        plain,
      );
    }
    const a = createFight(5);
    const b = createFight(5, { talents: zeros });
    a.simulation.run(SECONDS);
    b.simulation.run(SECONDS);
    assert.equal(b.simulation.rng(), a.simulation.rng());
  });

  it("a host's own modifiers are added to the build's", () => {
    const base = createFight(1, { talents: REFERENCE });
    const gear = [{ kind: "critChance", op: "add", value: 0.1 }];
    const geared = createFight(1, { talents: REFERENCE }, { modifiers: gear });
    const context = base.simulation.attackContext({ id: "sinister-strike" });
    assert.ok(
      Math.abs(
        geared.rogue.getCritChance(context) -
          base.rogue.getCritChance(context) -
          0.1,
      ) < 1e-9,
    );
  });
});

describe("the build's modifiers reach the stats and the damage", () => {
  it("Precision adds its hit chance to the config's", () => {
    const fight = createFight(1, { talents: REFERENCE });
    const plain = createFight(1);
    const context = fight.simulation.attackContext({ id: "sinister-strike" });
    assert.ok(
      Math.abs(
        fight.rogue.getBonusHitChance(context) -
          plain.rogue.getBonusHitChance(context) -
          0.03,
      ) < 1e-9,
    );
  });

  it("Aggression raises Sinister Strike and Eviscerate damage, seeded", () => {
    const withIt = seeded({ talents: REFERENCE });
    const without = seeded({ talents: NO_AGGRESSION });
    const perHit = (fights, id) =>
      mean(
        fights.map((fight) => {
          const record = fight.simulation.abilityStats[id];
          return record.damage / (record.hits + record.crits);
        }),
      );
    assert.ok(
      perHit(withIt, "sinister-strike") >
        perHit(without, "sinister-strike") * 1.03,
    );
    assert.ok(
      mean(withIt.map((fight) => fight.simulation.damageDone)) >
        mean(without.map((fight) => fight.simulation.damageDone)),
    );
  });

  it("the Assassination talents reach the same fight as Combat's: a hybrid build", () => {
    const fight = createFight(1, { talents: REFERENCE });
    const modifiers = fight.rogue.modifiers;
    const strike = fight.simulation.attackContext({ id: "sinister-strike" });
    const base = createFight(1).rogue.getCritChance(strike);
    // Malice (Assassination, every attack) on a sword: no Hack and Slash crit.
    assert.ok(
      Math.abs(fight.rogue.getCritChance(strike) - base - MALICE_CRIT) < 1e-9,
    );
    // Lethality (Assassination) and Aggression (Combat) on one pipeline.
    const critDamage = modifiers.resolve("critDamage", 2, strike);
    assert.ok(Math.abs(critDamage - 2 - 0.2) < 1e-9);
    const damage = modifiers.resolve("damage", 100, strike);
    assert.ok(Math.abs(damage - 100 * 1.06) < 1e-6);
    const ids = new Set(
      fight.build.procs.map((proc) => proc.id ?? proc.source),
    );
    for (const id of [
      "ruthlessness",
      "relentless-strikes",
      "puncturing-wounds",
      "hack-and-slash",
    ]) {
      assert.ok(ids.has(id), id);
    }
  });
});

describe("a selected build gates the abilities a talent grants", () => {
  const casts = (fight, id) => fight.simulation.abilityStats[id]?.casts ?? 0;

  it("casts Blade Flurry, Adrenaline Rush and Cold Blood when the build has them", () => {
    const fight = createFight(1, { talents: REFERENCE });
    fight.simulation.run(SECONDS);
    for (const id of ASSASSINATION_ABILITIES) {
      assert.ok(casts(fight, id) >= 1, id);
    }
  });

  it("casts none of them when the build does not have the talent", () => {
    const fight = createFight(1, { talents: NO_FLURRY_OR_RUSH });
    assert.equal(validateBuild(NO_FLURRY_OR_RUSH), k("talents.maxPoints"));
    fight.simulation.run(SECONDS);
    assert.equal(casts(fight, "blade-flurry"), 0);
    assert.equal(casts(fight, "adrenaline-rush"), 0);
    assert.ok(casts(fight, "cold-blood") >= 1);
    // The rest of the rotation is still cast.
    assert.ok(casts(fight, "sinister-strike") > 0);
    assert.ok(casts(fight, "slice-and-dice") > 0);
    assert.equal(fight.simulation.activeBuffs["blade-flurry"], undefined);
  });

  it("with no build, the rotation casts its whole list, as before talents", () => {
    const fight = createFight(1);
    fight.simulation.run(SECONDS);
    assert.ok(casts(fight, "blade-flurry") >= 1);
    assert.ok(casts(fight, "adrenaline-rush") >= 1);
    assert.equal(casts(fight, "cold-blood"), 0);
  });

  it("an ability the host grants is cast even when the build lacks the talent", () => {
    const fight = createFight(
      1,
      { talents: NO_FLURRY_OR_RUSH },
      { abilities: ["blade-flurry"] },
    );
    fight.simulation.run(SECONDS);
    assert.ok(casts(fight, "blade-flurry") >= 1);
    assert.equal(casts(fight, "adrenaline-rush"), 0);
  });

  it("lockedByBuild is only for an ability some talent grants", () => {
    const { rogue } = createFight(1, { talents: NO_FLURRY_OR_RUSH });
    assert.equal(rogue.lockedByBuild(rogue.abilities.bladeFlurry), true);
    assert.equal(rogue.lockedByBuild(rogue.abilities.adrenalineRush), true);
    assert.equal(rogue.lockedByBuild(rogue.abilities.sinisterStrike), false);
    assert.equal(rogue.lockedByBuild(rogue.abilities.sliceAndDice), false);
    const full = createFight(1, { talents: REFERENCE }).rogue;
    assert.equal(full.lockedByBuild(full.abilities.bladeFlurry), false);
    const none = createFight(1).rogue;
    assert.equal(none.lockedByBuild(none.abilities.bladeFlurry), false);
  });
});

// Issue #207: Ghostly Strike, Premeditation and Hemorrhage come from Subtlety
// talents, so a selected build without them holds them back like Blade Flurry.
// A legal 21-point Subtlety build that takes all three.
const SUBTLETY_THREE = {
  "subtlety.camouflage": 5,
  "subtlety.master-of-deception": 3,
  "subtlety.setup": 2,
  "subtlety.ghostly-strike": 1,
  "subtlety.initiative": 3,
  "subtlety.improved-distract": 1,
  "subtlety.premeditation": 1,
  "subtlety.serrated-blades": 3,
  "subtlety.heightened-senses": 1,
  "subtlety.hemorrhage": 1,
};
const SUBTLETY_KEYS = ["ghostlyStrike", "premeditation", "hemorrhage"];

describe("the Subtlety talent abilities are held back by a build without them (#207)", () => {
  it("grants all three to a build that has the talents", () => {
    assert.deepEqual(applyBuild(SUBTLETY_THREE).abilities, [
      "ghostly-strike",
      "premeditation",
      "hemorrhage",
    ]);
  });

  it("locks them for the reference build, not for the Subtlety build or no build", () => {
    const reference = createFight(1, { talents: REFERENCE }).rogue;
    const subtlety = createFight(1, { talents: SUBTLETY_THREE }).rogue;
    const none = createFight(1).rogue;
    for (const key of SUBTLETY_KEYS) {
      assert.equal(
        reference.lockedByBuild(reference.abilities[key]),
        true,
        key,
      );
      assert.equal(subtlety.lockedByBuild(subtlety.abilities[key]), false, key);
      assert.equal(none.lockedByBuild(none.abilities[key]), false, key);
    }
  });

  it("a guarded Hemorrhage rule casts only when the build has the talent", () => {
    const hemorrhage = {
      schemaVersion: 1,
      name: "Hemorrhage",
      rules: [
        {
          action: "hemorrhage",
          conditions: [{ type: "abilityUnlocked", ability: "hemorrhage" }],
        },
        { action: "sinister-strike", conditions: [] },
      ],
    };
    const casts = (fight, id) => fight.simulation.abilityStats[id]?.casts ?? 0;
    const run = (talents) => {
      const fight = createFight(1, { talents, rotation: hemorrhage });
      fight.simulation.run(SHORT);
      return fight;
    };
    const without = run(REFERENCE);
    assert.equal(casts(without, "hemorrhage"), 0);
    assert.ok(casts(without, "sinister-strike") >= 1);
    assert.ok(casts(run(SUBTLETY_THREE), "hemorrhage") >= 1);
  });
});

describe("weapons are the config's, and the build's weapon talents follow them", () => {
  it("a build never changes the weapons", () => {
    const { config } = createFight(1, { talents: REFERENCE });
    const { weapons } = createFight(1).config;
    assert.deepEqual(config.weapons, weapons);
    assert.equal(config.weapons.mainHand.type, "sword");
  });

  it("Hack and Slash 5 / 5 gives the dagger crit on daggers only, and the proc on swords", () => {
    const sword = createFight(1, { talents: REFERENCE });
    const dagger = createFight(1, {
      ...defaultDaggerConfig(),
      talents: REFERENCE,
    });
    const swordCrit = sword.rogue.getCritChance(
      sword.simulation.attackContext({ id: "sinister-strike" }),
    );
    const daggerBase = createFight(1, defaultDaggerConfig()).rogue;
    const daggerContext = dagger.simulation.attackContext({
      id: "sinister-strike",
    });
    assert.equal(dagger.rogue.weapons.mainHand.type, "dagger");
    // The dagger sheet has its own crit; the talents add Malice and Hack and Slash.
    assert.ok(
      Math.abs(
        dagger.rogue.getCritChance(daggerContext) -
          daggerBase.getCritChance(daggerContext) -
          MALICE_CRIT -
          HACK_AND_SLASH_CRIT,
      ) < 1e-9,
    );
    assert.ok(
      Math.abs(
        swordCrit -
          createFight(1).rogue.getCritChance(
            sword.simulation.attackContext({ id: "sinister-strike" }),
          ) -
          MALICE_CRIT,
      ) < 1e-9,
    );
    // The extra attack is scoped to the weapon types the constant names.
    const proc = sword.build.procs.find((p) => p.id === "hack-and-slash");
    assert.ok(proc);
    assert.ok(k("hackAndSlash.extraAttack").weaponTypes.includes("sword"));
    assert.ok(!k("hackAndSlash.extraAttack").weaponTypes.includes("dagger"));
  });

  it("Backstab's dagger requirement is enforced: a sword cannot cast it, a dagger can", () => {
    for (const [type, casts] of [
      ["sword", 0],
      ["dagger", 1],
    ]) {
      const fight = createFight(1, {
        talents: REFERENCE,
        weapons: { mainHand: { type } },
      });
      fight.rogue.energy = fight.rogue.maxEnergy;
      fight.simulation.rng = () => 0.5;
      fight.rogue.abilities.backstab.cast(fight.rogue, fight.simulation);
      assert.equal(fight.simulation.abilityStats.backstab?.casts ?? 0, casts);
    }
  });
});

describe("the build's modifiers reach poison damage where the talent says so", () => {
  const POISONS = { mainHand: "instant", offHand: "deadly" };
  const instant = { id: "instant-poison", hand: "mainHand" };

  it("Malice adds its crit to Instant Poison and to Deadly Poison's ticks", () => {
    const talented = createFight(1, { talents: REFERENCE, poisons: POISONS });
    const plain = createFight(1, { poisons: POISONS });
    for (const context of [
      (fight) => fight.simulation.attackContext(instant, "skill"),
      (fight) => fight.simulation.abilityContext("deadly-poison"),
    ]) {
      assert.ok(
        Math.abs(
          talented.rogue.getCritChance(context(talented)) -
            plain.rogue.getCritChance(context(plain)) -
            MALICE_CRIT,
        ) < 1e-9,
      );
    }
  });

  it("an Instant Poison roll between the two crit chances crits only with Malice", () => {
    const rolls = {};
    for (const [label, config] of [
      ["with", { talents: REFERENCE, poisons: POISONS }],
      ["without", { poisons: POISONS }],
    ]) {
      const fight = createFight(1, config);
      const chance = fight.rogue.getCritChance(
        fight.simulation.attackContext(instant, "skill"),
      );
      rolls[label] = { fight, chance: suppressCrit(chance) };
    }
    // One draw is the crit roll (the damage is fixed and the poison is no spell hit).
    const draw = (rolls.with.chance + rolls.without.chance) / 2;
    assert.ok(rolls.without.chance < draw && draw < rolls.with.chance);
    const outcome = (fight) => {
      fight.simulation.rng = () => draw;
      return fight.simulation.resolveProcDamage({
        id: "instant-poison",
        name: "Instant Poison",
        min: 100,
        max: 100,
        spellHit: false,
        canCrit: true,
      }).outcome;
    };
    assert.equal(outcome(rolls.with.fight), "crit");
    assert.equal(outcome(rolls.without.fight), "hit");
  });

  it("Lethality, Aggression and Improved Eviscerate stay on their own abilities", () => {
    const fight = createFight(1, { talents: REFERENCE, poisons: POISONS });
    const { modifiers } = fight.rogue;
    const context = fight.simulation.attackContext(instant, "skill");
    assert.equal(
      modifiers.resolve("critDamage", k("poison.instantCrit"), context),
      k("poison.instantCrit"),
    );
    assert.equal(modifiers.resolve("damage", 100, context), 100);
    const deadly = fight.simulation.abilityContext("deadly-poison");
    assert.equal(modifiers.resolve("damage", 100, deadly), 100);
  });

  it("Vile Poisons, Improved Poisons and Venom are not modelled yet and are reported as unmapped", () => {
    const build = swap(BOUNDARY, {});
    const { unmapped } = createFight(1, { talents: build }).build;
    for (const id of [
      "assassination.vile-poisons",
      "assassination.improved-poisons",
      "assassination.venom",
    ]) {
      assert.ok(unmapped.includes(id), id);
      assert.equal(TALENT_EFFECTS[id], undefined);
    }
  });
});
