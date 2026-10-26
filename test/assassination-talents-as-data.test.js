import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { createFight, expandTalents, runFight } from "../js/fight.js";
import {
  MODIFIER_KINDS,
  ModifierPipeline,
  expandRank,
} from "../js/modifiers.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { talentCatalogue } from "../js/talents.js";

// D8a PR 1 (#119): Malice, Lethality and Improved Slice and Dice as data, and
// the `duration` modifier kind. Each number in data/talent-effects.js is read
// back out of the snapshot's rank text at every rank, as for the Combat talents
// (test/combat-talents-as-data.test.js).

const PERCENT = 100;
const MALICE = "assassination.malice";
const LETHALITY = "assassination.lethality";
const IMPROVED_SND = "assassination.improved-slice-and-dice";
const FINISHER_POINTS = k("rotation.finisherComboPoints");
const SND_SECONDS = k("sliceAndDice").durationByCp;
const HIT = 0.99;
// A white swing's one roll, inside the crit band at a 50% crit chance.
const WHITE_CRIT = 0.85;

function ranksOf(id) {
  return talentCatalogue.get(id).ranks;
}

// The two lists Rogue takes, for a build of one talent.
function only(id, rank) {
  const { modifiers, procs } = expandTalents({ [id]: rank });
  return { modifiers, procs };
}

// The ability of a rogue by catalogue id (Rogue keys them by row name).
function abilityOf(rogue, id) {
  return Object.values(rogue.abilities).find((ability) => ability.id === id);
}

function percentIn(text) {
  const found = /by (\d+)%/.exec(text);
  assert.ok(found, `no "by N%" in ${JSON.stringify(text)}`);
  return Number(found[1]) / PERCENT;
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

// A scripted rng that throws past the last value.
function scripted(values) {
  let at = 0;
  return {
    rng() {
      if (at >= values.length) {
        throw new Error(`draw ${at + 1} was not scripted`);
      }
      return values[at++];
    },
    left: () => values.length - at,
  };
}

describe("the Assassination modifier tables match the snapshot's rank text", () => {
  for (const id of [MALICE, LETHALITY, IMPROVED_SND]) {
    it(`reads ${id} at every rank from the text`, () => {
      const [table, ...rest] = TALENT_EFFECTS[id].modifiers;
      assert.equal(rest.length, 0);
      assert.equal(table.op, "add");
      assert.equal(table.values.length, talentCatalogue.get(id).max);
      ranksOf(id).forEach((text, index) => {
        near(table.values[index], percentIn(text));
      });
    });
  }

  it("keeps the kind and scope the text names", () => {
    assert.equal(TALENT_EFFECTS[MALICE].modifiers[0].kind, "critChance");
    assert.equal(TALENT_EFFECTS[MALICE].modifiers[0].scope, undefined);
    assert.equal(TALENT_EFFECTS[IMPROVED_SND].modifiers[0].kind, "duration");
    assert.deepEqual(TALENT_EFFECTS[IMPROVED_SND].modifiers[0].scope, {
      abilities: ["slice-and-dice"],
    });
    assert.equal(TALENT_EFFECTS[LETHALITY].modifiers[0].kind, "critDamage");
  });

  it("scopes Lethality to the six abilities its text names, by their catalogue ids", () => {
    const named = /of your (.+?) abilities by/.exec(ranksOf(LETHALITY)[0])[1];
    const names = named.replace(", and ", ", ").split(", ");
    assert.equal(names.length, 6);
    const ids = names.map((name) => {
      const found = abilityCatalogue.byName(name);
      assert.ok(found, `${name} is not in the ability catalogue`);
      return found.id;
    });
    assert.deepEqual(
      TALENT_EFFECTS[LETHALITY].modifiers[0].scope.abilities,
      ids,
    );
  });

  it("names two abilities, Gouge and Mutilate, that the engine has no definition for", () => {
    const defined = new Set(
      ABILITY_DEFINITIONS.map((definition) => definition.id),
    );
    const scoped = TALENT_EFFECTS[LETHALITY].modifiers[0].scope.abilities;
    assert.deepEqual(
      scoped.filter((id) => !defined.has(id)),
      ["gouge", "mutilate"],
    );
    const { rogue } = createFight(1);
    for (const id of scoped) {
      assert.equal(abilityOf(rogue, id) !== undefined, defined.has(id), id);
    }
  });

  it("expands each at rank 0 to nothing", () => {
    for (const id of [MALICE, LETHALITY, IMPROVED_SND]) {
      const build = expandTalents({ [id]: 0 });
      assert.deepEqual(build.modifiers, [], id);
      assert.deepEqual(build.procs, [], id);
      assert.deepEqual(build.unmapped, [], id);
    }
    assert.deepEqual(expandTalents({}).modifiers, []);
  });

  it("leaves the three PR 2 talents to their own tables: modifiers only here", () => {
    const build = expandTalents({
      [MALICE]: 5,
      [IMPROVED_SND]: 3,
      [LETHALITY]: 5,
      "assassination.ruthlessness": 3,
      "assassination.relentless-strikes": 1,
      "assassination.cold-blood": 1,
    });
    assert.deepEqual(
      build.modifiers.map(({ kind, source }) => [kind, source]),
      [
        ["critChance", MALICE],
        ["duration", IMPROVED_SND],
        ["critDamage", LETHALITY],
      ],
    );
    assert.deepEqual(build.unmapped, []);
  });
});

describe("the duration modifier kind", () => {
  it("is scoped by ability, floored at 0, and stacks as a percentage", () => {
    assert.deepEqual(MODIFIER_KINDS.duration.scope, ["abilities"]);
    assert.equal(MODIFIER_KINDS.duration.floor, 0);
    assert.equal(k("modifiers.stacking").duration, "percent");
  });

  it("adds +x% to a length, to the scoped ability only, and never below 0", () => {
    const tables = expandRank(
      [
        {
          kind: "duration",
          op: "add",
          values: [0.15, 0.3, 0.45],
          scope: { abilities: ["slice-and-dice"] },
        },
      ],
      3,
      "t",
    );
    const stats = new ModifierPipeline(tables);
    near(stats.resolve("duration", 10, { ability: "slice-and-dice" }), 14.5);
    assert.equal(stats.resolve("duration", 10, { ability: "rupture" }), 10);
    assert.equal(stats.resolve("duration", 10, {}), 10);
    assert.equal(
      stats.resolve("duration", 0, { ability: "slice-and-dice" }),
      0,
    );
    const cut = new ModifierPipeline(
      expandRank([{ kind: "duration", op: "add", values: [-2] }], 1, "t"),
    );
    assert.equal(cut.resolve("duration", 10, { ability: "x" }), 0);
  });

  it("refuses a duration scoped by something other than abilities", () => {
    assert.throws(
      () =>
        expandRank(
          [
            {
              kind: "duration",
              op: "add",
              values: [0.1],
              scope: { hands: ["mainHand"] },
            },
          ],
          1,
          "t",
        ),
      RangeError,
    );
  });
});

describe("Improved Slice and Dice lengthens the aura Slice and Dice puts up", () => {
  function cast(rank, points) {
    const options = rank === undefined ? undefined : only(IMPROVED_SND, rank);
    const rogue = new Rogue(undefined, options);
    rogue.rotation = () => {};
    const simulation = new Simulation(rogue, { seed: 1 });
    rogue.comboPoints = points;
    rogue.energy = rogue.maxEnergy;
    abilityOf(rogue, "slice-and-dice").cast(rogue, simulation);
    return simulation.activeBuffs["slice-and-dice"]?.duration;
  }

  it("multiplies the length for the combo points spent by 1.15, 1.30 and 1.45", () => {
    for (let points = 1; points <= FINISHER_POINTS; points += 1) {
      const base = SND_SECONDS[points - 1];
      assert.equal(cast(undefined, points), base, `${points} points`);
      assert.equal(cast(0, points), base);
      near(cast(1, points), base * 1.15);
      near(cast(2, points), base * 1.3);
      near(cast(3, points), base * 1.45);
    }
  });

  it("puts up no aura for 0 combo points, with or without the talent", () => {
    assert.equal(cast(3, 0), undefined);
  });

  it("leaves Rupture and the other auras as they are", () => {
    const plain = new Rogue();
    const talented = new Rogue(undefined, only(IMPROVED_SND, 3));
    for (const id of ["rupture", "blade-flurry", "adrenaline-rush"]) {
      for (let points = 1; points <= FINISHER_POINTS; points += 1) {
        assert.deepEqual(
          abilityOf(talented, id).resolve(points),
          abilityOf(plain, id).resolve(points),
          `${id} at ${points}`,
        );
      }
    }
    assert.equal(
      abilityOf(talented, "slice-and-dice").resolve(FINISHER_POINTS).duration,
      SND_SECONDS[FINISHER_POINTS - 1] * 1.45,
    );
  });

  it("makes the rotation refresh later, so a fight casts it less often", () => {
    const seconds = 180;
    const casts = (options) => {
      const { simulation } = createFight(5, undefined, options);
      simulation.run(seconds);
      return simulation.abilityStats["slice-and-dice"].casts;
    };
    const plain = casts(undefined);
    const talented = casts(only(IMPROVED_SND, 3));
    assert.ok(plain > 0, "the fight casts Slice and Dice");
    assert.ok(talented < plain, `${talented} casts is not fewer than ${plain}`);
  });

  it("changes nothing for an untalented fight, nor a build at rank 0", () => {
    const plain = runFight({ seed: 3, duration: 120 });
    const zero = createFight(3, undefined, only(IMPROVED_SND, 0));
    zero.simulation.run(120);
    assert.equal(zero.simulation.damageDone, plain.totalDamage);
  });
});

describe("Malice adds 1% crit chance a rank to every attack", () => {
  it("adds to a white swing and a skill, at every rank, and draws nothing", () => {
    for (let rank = 1; rank <= 5; rank += 1) {
      const { rogue } = createFight(1, undefined, only(MALICE, rank));
      const base = new Rogue().critChance;
      near(rogue.getCritChance({}), base + rank / PERCENT);
      near(rogue.getCritChance({ ability: "backstab" }), base + rank / PERCENT);
      near(
        rogue.getCritChance({ ability: "hemorrhage", weaponType: "dagger" }),
        base + rank / PERCENT,
      );
    }
  });

  it("gives more crits than the same fight without it, over a few seeds", () => {
    const crits = (options) => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed += 1) {
        const { simulation } = createFight(seed, undefined, options);
        simulation.run(60);
        for (const record of Object.values(simulation.abilityStats)) {
          total += record.crits;
        }
      }
      return total;
    };
    const plain = crits(undefined);
    const talented = crits(only(MALICE, 5));
    assert.ok(talented > plain, `${talented} crits, ${plain} without`);
  });
});

describe("Lethality adds to the crit damage bonus of the abilities it names", () => {
  // One Backstab (or another source) at 100 damage, the table roll a hit and
  // the crit roll a crit (0) or not (HIT), through resolveAttack.
  function attack(options, abilityId, crit, type = "skill") {
    const rogue = new Rogue(undefined, options);
    rogue.bonusHitChance = 1;
    rogue.critChance = 0.5;
    const tape = scripted(
      type === "skill" ? [HIT, crit ? 0 : HIT] : [WHITE_CRIT],
    );
    const simulation = new Simulation(rogue, { rng: tape.rng });
    const source =
      type === "skill"
        ? abilityOf(rogue, abilityId)
        : rogue.weapons.mainHand.attack;
    const result = simulation.resolveAttack(source, type, 100);
    // A white swing is one draw, with its crit band in the table roll.
    assert.equal(tape.left(), 0);
    return type === "skill" ? result.damage : result;
  }

  it("takes a 2x crit to 2.2x at 5/5, because the bonus is scaled and not the whole hit", () => {
    assert.equal(k("crit.meleeMultiplier"), 2);
    assert.equal(k("modifiers.stacking").critDamage, "bonus");
    const options = only(LETHALITY, 5);
    for (const id of [
      "backstab",
      "sinister-strike",
      "hemorrhage",
      "ghostly-strike",
    ]) {
      const normal = attack(undefined, id, false);
      near(attack(undefined, id, true) / normal, 2);
      near(attack(options, id, true) / normal, 2.2);
      assert.equal(attack(options, id, false), normal, `${id} without a crit`);
    }
  });

  it("adds 4% to the bonus a rank: 2.04x, 2.08x, 2.12x, 2.16x, 2.2x", () => {
    const normal = attack(undefined, "backstab", false);
    [2.04, 2.08, 2.12, 2.16, 2.2].forEach((expected, index) => {
      const crit = attack(only(LETHALITY, index + 1), "backstab", true);
      near(crit / normal, expected);
    });
  });

  it("does not touch an ability it does not name, nor a white swing", () => {
    const options = only(LETHALITY, 5);
    for (const id of ["eviscerate", "ambush"]) {
      assert.equal(attack(options, id, true), attack(undefined, id, true), id);
    }
    const white = attack(options, null, true, "weapon");
    assert.deepEqual(white, attack(undefined, null, true, "weapon"));
    assert.equal(white.outcome, "crit");
  });

  it("is nothing at rank 0", () => {
    assert.equal(
      attack(only(LETHALITY, 0), "backstab", true),
      attack(undefined, "backstab", true),
    );
  });
});
