import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { defineAura } from "../js/auras.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { suppressCrit } from "../js/attack-resolver.js";
import { createFight, expandTalents, runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { talentCatalogue } from "../js/talents.js";
import { decodeBuildLink } from "./talentsforever.js";
import { quiet } from "./quiet.js";

// D8a PR 2 (#119): Ruthlessness, Relentless Strikes and Cold Blood as data and
// as behaviour. Each number in data/talent-effects.js is read back out of the
// snapshot's rank text, as for the PR 1 talents
// (test/assassination-talents-as-data.test.js).

const PERCENT = 100;
const RUTHLESSNESS = "assassination.ruthlessness";
const RELENTLESS = "assassination.relentless-strikes";
const COLD_BLOOD = "assassination.cold-blood";
const HIT = 0.99;
const NO_CRIT = 0.99;
// Every damaging ability draws its damage roll first, then the table, then the crit.
const DAMAGE = 0.5;
const SECONDS = 300;
// The reference build. The default rotation reaches Eviscerate only with its
// talents (Improved Slice and Dice and the procs); without them it refreshes
// Slice and Dice at every 5 points.
const REFERENCE = decodeBuildLink(
  "https://talentsforever.com/rogue/60/00530310501-32030320201515231--CD1FDGISRUWZXbc4defg2hgcK-8?b=70425h&d=261026",
).ranks;

function ranksOf(id) {
  return talentCatalogue.get(id).ranks;
}

function lists(ranks) {
  const { modifiers, procs, abilities } = expandTalents(ranks);
  return { modifiers, procs, abilities };
}

function abilityOf(rogue, id) {
  return Object.values(rogue.abilities).find((ability) => ability.id === id);
}

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

// A rogue that always hits, with 30% crit, full energy and a scripted rng.
function harness(options, rolls, { hit = 1 } = {}) {
  const rogue = new Rogue(undefined, options);
  rogue.bonusHitChance = hit;
  rogue.critChance = 0.3;
  quiet(rogue);
  rogue.energy = 100;
  const tape = scripted(rolls);
  const simulation = new Simulation(rogue, { rng: tape.rng });
  return { rogue, simulation, tape };
}

function counted(seed, options) {
  const fight = createFight(seed, undefined, options);
  const source = fight.simulation.rng;
  const draws = [];
  fight.simulation.rng = () => {
    const value = source();
    draws.push(value);
    return value;
  };
  fight.simulation.run(SECONDS);
  return { fight, draws, damage: fight.simulation.damageDone };
}

describe("the snapshot's text for the three talents", () => {
  it("reads Ruthlessness' chance at every rank, and a Combo Point on the target", () => {
    const entry = TALENT_EFFECTS[RUTHLESSNESS];
    const [spec, ...rest] = entry.procs;
    assert.equal(rest.length, 0);
    assert.equal(spec.trigger, "onAbility");
    assert.deepEqual(spec.scope, { tags: ["finisher"] });
    assert.equal(spec.chance.mode, "flat");
    ranksOf(RUTHLESSNESS).forEach((text, index) => {
      const found =
        /^Gives your finishing moves a (\d+)% chance to add a Combo Point to your target\.$/.exec(
          text,
        );
      assert.ok(found, text);
      assert.equal(spec.chance.values[index], Number(found[1]) / PERCENT);
    });
    assert.equal(spec.chance.values.length, 3);
    assert.deepEqual(spec.actions, [
      { type: "gainResource", resource: "comboPoints", amount: 1 },
    ]);
  });

  it("reads Relentless Strikes' 20% per Combo Point and 25 Energy", () => {
    const [text] = ranksOf(RELENTLESS);
    const found =
      /^Your finishing moves have a (\d+)% chance per Combo Point to restore (\d+) Energy\.$/.exec(
        text,
      );
    assert.ok(found, text);
    const [spec] = TALENT_EFFECTS[RELENTLESS].procs;
    assert.equal(spec.trigger, "onAbility");
    assert.deepEqual(spec.scope, { tags: ["finisher"] });
    assert.equal(spec.chance.mode, "perSpent");
    assert.deepEqual(spec.chance.values, [Number(found[1]) / PERCENT]);
    assert.deepEqual(spec.actions, [
      { type: "gainResource", resource: "energy", amount: Number(found[2]) },
    ]);
  });

  it("reads Cold Blood's +100% and the five abilities its text names, by catalogue id", () => {
    const [text] = ranksOf(COLD_BLOOD);
    const found = /next (.+?) by (\d+)%\.$/.exec(text) ?? assert.fail(text);
    assert.equal(k("coldBlood").critChance, Number(found[2]) / PERCENT);
    const names = found[1].replace(", or ", ", ").split(", ");
    assert.equal(names.length, 5);
    const ids = names.map((name) => {
      const entry = abilityCatalogue.byName(name);
      assert.ok(entry, `${name} is not in the ability catalogue`);
      return entry.id;
    });
    assert.deepEqual(k("coldBlood").abilities, ids);
    assert.deepEqual(TALENT_EFFECTS[COLD_BLOOD], {
      textHash: TALENT_EFFECTS[COLD_BLOOD].textHash,
      ability: "cold-blood",
    });
  });

  it("scopes Cold Blood to Mutilate too, which the engine casts since #267", () => {
    const defined = new Set(ABILITY_DEFINITIONS.map((d) => d.id));
    assert.ok(k("coldBlood").abilities.includes("mutilate"));
    assert.deepEqual(
      k("coldBlood").abilities.filter((id) => !defined.has(id)),
      [],
    );
  });

  it("makes Cold Blood an instant, off-the-GCD, 3 minute cooldown with no cost", () => {
    const entry = abilityCatalogue.get("cold-blood");
    assert.equal(entry.cooldown, 180);
    assert.equal(entry.startsGcd, false);
    const { rogue } = createFight(1);
    const coldBlood = abilityOf(rogue, "cold-blood");
    assert.equal(coldBlood.triggersGcd, false);
    assert.equal(coldBlood.cost, 0);
    assert.equal(coldBlood.cooldown, 180);
  });
});

describe("Ruthlessness", () => {
  const options = lists({ [RUTHLESSNESS]: 3 });

  function evisceratePoints(roll, rank = 3, spent = 5) {
    const build = lists({ [RUTHLESSNESS]: rank });
    const { rogue, simulation, tape } = harness(build, [
      DAMAGE,
      HIT,
      NO_CRIT,
      roll,
    ]);
    rogue.comboPoints = spent;
    abilityOf(rogue, "eviscerate").cast(rogue, simulation);
    assert.equal(tape.left(), 0, "table roll, crit roll, one proc roll");
    return rogue.comboPoints;
  }

  it("adds a Combo Point after the finisher has spent its points, when the roll is under the chance", () => {
    assert.equal(evisceratePoints(0.59), 1);
    assert.equal(evisceratePoints(0.6), 0);
    assert.equal(evisceratePoints(0.39, 2), 1);
    assert.equal(evisceratePoints(0.4, 2), 0);
    assert.equal(evisceratePoints(0.19, 1), 1);
    assert.equal(evisceratePoints(0.2, 1), 0);
  });

  it("rolls once on a finisher that is not an attack, and not at all on a builder", () => {
    const { rogue, simulation, tape } = harness(options, [0.1]);
    rogue.comboPoints = 3;
    abilityOf(rogue, "slice-and-dice").cast(rogue, simulation);
    assert.equal(tape.left(), 0);
    assert.equal(rogue.comboPoints, 1);
    const builder = harness(options, [DAMAGE, HIT, NO_CRIT]);
    abilityOf(builder.rogue, "sinister-strike").cast(
      builder.rogue,
      builder.simulation,
    );
    assert.equal(builder.tape.left(), 0, "no proc roll on a builder");
  });

  it("gives the point to the rogue's pool: the first of the next set", () => {
    assert.equal(evisceratePoints(0.1, 3, 5), 1);
    assert.equal(evisceratePoints(0.1, 3, 3), 1);
  });
});

describe("Relentless Strikes", () => {
  const options = lists({ [RELENTLESS]: 1 });

  function energyAfter(spent, roll) {
    const { rogue, simulation, tape } = harness(options, [
      DAMAGE,
      HIT,
      NO_CRIT,
      roll,
    ]);
    rogue.energy = 60;
    rogue.comboPoints = spent;
    const cost = abilityOf(rogue, "eviscerate").cost;
    abilityOf(rogue, "eviscerate").cast(rogue, simulation);
    assert.equal(tape.left(), 0);
    return rogue.energy - (60 - cost);
  }

  it("has a 20% chance per Combo Point spent, to restore 25 energy, with one roll", () => {
    for (const spent of [1, 2, 3, 4, 5]) {
      const chance = Math.min(1, 0.2 * spent);
      assert.equal(
        energyAfter(spent, chance - 0.001),
        25,
        `${spent} CP, under`,
      );
      if (chance < 1) {
        assert.equal(energyAfter(spent, chance), 0, `${spent} CP, at`);
      }
    }
  });

  it("is a sure thing at 5 points, with the roll still drawn", () => {
    assert.equal(energyAfter(5, 0.999), 25);
  });

  it("rolls once for Slice and Dice, which spends points too", () => {
    const { rogue, simulation, tape } = harness(options, [0.5]);
    rogue.energy = 10;
    rogue.comboPoints = 3;
    const cost = abilityOf(rogue, "slice-and-dice").cost;
    rogue.energy = 100;
    abilityOf(rogue, "slice-and-dice").cast(rogue, simulation);
    assert.equal(tape.left(), 0);
    assert.equal(rogue.energy, Math.min(100, 100 - cost + 25));
  });
});

describe("Cold Blood", () => {
  function coldBloodUp(rolls, hit) {
    const run = harness(lists({ [COLD_BLOOD]: 1 }), rolls, { hit });
    abilityOf(run.rogue, "cold-blood").cast(run.rogue, run.simulation);
    return run;
  }

  it("is cast off the GCD, starts its cooldown, and leaves a one-charge aura", () => {
    const { rogue, simulation } = coldBloodUp([]);
    const aura = simulation.activeBuffs["cold-blood"];
    assert.equal(aura.charges, 1);
    assert.equal(simulation.cooldowns["cold-blood"], 180);
    assert.equal(simulation.gcd ?? 0, 0, "no global cooldown");
    assert.equal(abilityOf(rogue, "cold-blood").cast(rogue, simulation), null);
  });

  it("makes the next Sinister Strike a sure crit, with the crit roll still drawn", () => {
    const withIt = coldBloodUp([DAMAGE, HIT, 0.999]);
    const result = abilityOf(withIt.rogue, "sinister-strike").cast(
      withIt.rogue,
      withIt.simulation,
    );
    assert.equal(withIt.tape.left(), 0, "the same two draws as without");
    const plain = harness(undefined, [DAMAGE, HIT, 0.999]);
    abilityOf(plain.rogue, "sinister-strike").cast(
      plain.rogue,
      plain.simulation,
    );
    assert.equal(plain.tape.left(), 0);
    assert.ok(
      withIt.simulation.damageDone > 1.9 * plain.simulation.damageDone,
      `${withIt.simulation.damageDone} vs ${plain.simulation.damageDone}`,
    );
    assert.equal(result === undefined, false);
    assert.equal(withIt.simulation.activeBuffs["cold-blood"], undefined);
  });

  it("is consumed by the first scoped attack that lands, and not by the next", () => {
    for (const id of ["sinister-strike", "eviscerate"]) {
      const run = coldBloodUp([DAMAGE, HIT, 0.999, DAMAGE, HIT, 0.999]);
      run.rogue.comboPoints = 5;
      abilityOf(run.rogue, id).cast(run.rogue, run.simulation);
      assert.equal(run.simulation.activeBuffs["cold-blood"], undefined, id);
      assert.equal(run.tape.left(), 3, id);
    }
  });

  it("is kept by a white swing, a miss and a Slice and Dice", () => {
    const run = coldBloodUp([0.9], 1);
    const weapon = run.rogue.weapons.mainHand;
    run.simulation.resolveAttack(weapon.attack, "weapon", 100);
    assert.equal(run.simulation.activeBuffs["cold-blood"].charges, 1);
    run.rogue.comboPoints = 2;
    abilityOf(run.rogue, "slice-and-dice").cast(run.rogue, run.simulation);
    assert.equal(run.simulation.activeBuffs["cold-blood"].charges, 1);
    const miss = coldBloodUp([DAMAGE, 0], 0);
    abilityOf(miss.rogue, "sinister-strike").cast(miss.rogue, miss.simulation);
    assert.equal(miss.simulation.activeBuffs["cold-blood"].charges, 1);
    assert.equal(miss.tape.left(), 0, "a miss draws no crit roll");
  });

  it("spends one charge of every charged aura in scope and none of an uncharged one", () => {
    const run = harness(lists({}), [DAMAGE, 0.5, 0.5]);
    const scope = { abilities: ["sinister-strike"] };
    const aura = (id, charges) =>
      defineAura({
        id,
        name: id,
        duration: 60,
        charges,
        modifiers: [{ kind: "critChance", op: "add", value: 0.1, scope }],
      });
    for (const definition of [
      aura("a", 1),
      aura("b", 1),
      aura("c", undefined),
    ]) {
      run.simulation.applyAura(definition);
    }
    abilityOf(run.rogue, "sinister-strike").cast(run.rogue, run.simulation);
    assert.deepEqual(Object.keys(run.simulation.activeBuffs), ["c"]);
  });

  it("changes no crit chance of an ability it does not name", () => {
    const run = coldBloodUp([DAMAGE, HIT, NO_CRIT]);
    run.rogue.comboPoints = 1;
    abilityOf(run.rogue, "rupture").cast(run.rogue, run.simulation);
    assert.equal(run.simulation.activeBuffs["cold-blood"].charges, 1);
  });
});

describe("crit chance above 100%", () => {
  it("takes the suppression first, so +100% on any real crit chance is a sure crit", () => {
    assert.equal(suppressCrit(0.1 + k("coldBlood").critChance), 1);
    assert.equal(suppressCrit(0.1), 0.1 - 0.048);
  });

  it("draws the crit roll whatever the chance, so the draw count is stable", () => {
    for (const critChance of [0.05, 0.3, 1.2, 5]) {
      const rogue = new Rogue(undefined, undefined);
      rogue.bonusHitChance = 1;
      rogue.critChance = critChance;
      const tape = scripted([HIT, 0.999]);
      const simulation = new Simulation(rogue, { rng: tape.rng });
      const result = simulation.resolveAttack(
        abilityOf(rogue, "sinister-strike"),
        "skill",
        100,
      );
      assert.equal(tape.left(), 0, `chance ${critChance}`);
      assert.equal(result.outcome, critChance >= 1.048 ? "crit" : "hit");
    }
  });
});

describe("the Cold Blood rotation rule", () => {
  const granted = lists(REFERENCE);
  const withoutIt = lists({ ...REFERENCE, [COLD_BLOOD]: 0 });

  function record(options, seed = 3) {
    const { rogue, simulation } = createFight(seed, undefined, options);
    const events = [];
    for (const key of ["coldBlood", "eviscerate"]) {
      const original = rogue.abilities[key].cast.bind(rogue.abilities[key]);
      rogue.abilities[key].cast = (r, s) => {
        events.push({
          key,
          comboPoints: r.comboPoints,
          ready: (s.cooldowns["cold-blood"] ?? 0) <= 0,
        });
        return original(r, s);
      };
    }
    simulation.run(SECONDS);
    return { events, simulation };
  }

  it("casts Cold Blood right before a 5 point Eviscerate, when it is off cooldown", () => {
    const { events, simulation } = record(granted);
    const casts = simulation.abilityStats["cold-blood"].casts;
    assert.ok(casts >= 1 && casts <= 2, `${casts} casts in ${SECONDS} s`);
    events.forEach((event, index) => {
      if (event.key !== "coldBlood" || !event.ready) {
        return;
      }
      const next = events[index + 1];
      assert.equal(next.key, "eviscerate");
      assert.equal(next.comboPoints, event.comboPoints);
      assert.equal(event.comboPoints, k("rotation.finisherComboPoints"));
    });
  });

  it("does nothing when the ability is not granted, and leaves the fight as it was", () => {
    for (const options of [withoutIt, { ...withoutIt, abilities: [] }]) {
      const { simulation } = record(options);
      assert.equal(simulation.abilityStats["cold-blood"], undefined);
    }
    const plain = counted(5, undefined);
    const empty = counted(5, { abilities: [] });
    assert.deepEqual(empty.draws, plain.draws);
    assert.equal(empty.damage, plain.damage);
  });

  it("names the ability and finisher in one constants row", () => {
    assert.deepEqual(k("rotation.coldBlood"), {
      ability: "coldBlood",
      beforeFinisher: "eviscerate",
    });
  });
});

describe("a build with the three talents in a fight", () => {
  it("is the same fight again, and deals more than the build without them", () => {
    const options = lists({
      [RUTHLESSNESS]: 3,
      [RELENTLESS]: 1,
      [COLD_BLOOD]: 1,
    });
    const first = counted(9, options);
    const again = counted(9, options);
    assert.deepEqual(again.draws, first.draws);
    assert.ok(first.damage > counted(9, undefined).damage);
  });

  it("draws no random number for the two proc talents at rank 0", () => {
    const zeros = lists({ [RUTHLESSNESS]: 0, [RELENTLESS]: 0 });
    assert.deepEqual(zeros, { modifiers: [], procs: [], abilities: [] });
    const run = counted(4, zeros);
    assert.deepEqual(Object.keys(run.fight.simulation.procs.stats), []);
    assert.deepEqual(run.draws, counted(4, undefined).draws);
  });

  it("is an untalented runFight equal to a createFight with every talent at rank 0", () => {
    const zeros = lists(
      Object.fromEntries(talentCatalogue.talents.map((t) => [t.id, 0])),
    );
    const { simulation } = createFight(11, undefined, zeros);
    simulation.run(60);
    const result = runFight({ seed: 11, duration: 60 });
    assert.equal(result.totalDamage, simulation.damageDone);
    assert.deepEqual(result.log, simulation.combatLog);
    assert.deepEqual(result.abilities, simulation.abilityBreakdown());
  });
});

describe("the Rogue abilities option", () => {
  it("takes catalogue ids, and refuses anything else", () => {
    assert.deepEqual([...new Rogue(undefined, { abilities: [] }).granted], []);
    assert.deepEqual(
      [...new Rogue(undefined, { abilities: ["cold-blood"] }).granted],
      ["cold-blood"],
    );
    for (const bad of ["cold-blood", {}, 1]) {
      assert.throws(
        () => new Rogue(undefined, { abilities: bad }),
        TypeError,
        String(bad),
      );
    }
    for (const bad of [["nope"], [1], ["cold-blood", "nope"]]) {
      assert.throws(
        () => new Rogue(undefined, { abilities: bad }),
        (error) => error instanceof TypeError || error instanceof RangeError,
        JSON.stringify(bad),
      );
    }
    assert.throws(() => new Rogue(undefined, { unknown: [] }), /abilities/);
  });
});
