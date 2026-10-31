import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { Ability } from "../js/ability.js";
import { AURAS } from "../js/auras.js";
import { createFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { rotationHost } from "../js/rotation-host.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { validateRotation } from "../js/rotation-validator.js";
import { defaultDaggerConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { GOLDEN_CASES } from "../scripts/golden-update.mjs";
import { quiet } from "./quiet.js";

// Issue #267 (P4.6-04a): Mutilate, with the TBC rules James accepted (Q1, 31
// Oct 2026), one test per row A1-A7 of the issue, and gates G2 and G4.

const MUTILATE = "assassination.mutilate";
const SEAL_FATE = "assassination.seal-fate";
// The 20 points Mutilate's row needs (talents.rowGating), on talents that do
// nothing to a strike's roll: Cold Blood only grants its ability, Improved
// Expose Armor is not mapped yet, and the rest are finisher, poison or no-DPS
// talents (Murder is inert while the target's mobType is unspecified).
const ROWS_ABOVE = {
  "assassination.improved-gouge": 3,
  "assassination.remorseless-attacks": 2,
  "assassination.murder": 2,
  "assassination.improved-slice-and-dice": 3,
  "assassination.ruthlessness": 3,
  "assassination.relentless-strikes": 1,
  "assassination.improved-expose-armor": 1,
  "assassination.vile-poisons": 5,
  "assassination.cold-blood": 1,
};
const TALENTED = { ...ROWS_ABOVE, [MUTILATE]: 1 };
// The 5 more Seal Fate's row needs: Vigor and Improved Kidney Shot.
const SEAL_FATE_BUILD = {
  ...TALENTED,
  "assassination.vigor": 2,
  "assassination.improved-kidney-shot": 2,
  [SEAL_FATE]: 5,
};
const HIT = 0.99;
const NO_CRIT = 0.99;
const LOW = 0;
const TOP = 0.999999;
const HALF = 0.5;
const SECONDS = 60;
const DAGGERS = defaultDaggerConfig().weapons;
const SWORD = { type: "sword", min: 80, max: 150, speed: 2.6 };

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

const constant = (value) => () => value;

// A quiet rogue on two daggers with Mutilate talented, full energy, no crit
// and a sure hit unless asked, and every base damage given to resolveAttack.
function harness(
  rng,
  { talents = TALENTED, weapons = DAGGERS, ...config } = {},
) {
  const rogue = new Rogue({ ...config, weapons, talents });
  quiet(rogue);
  rogue.critChance = 0;
  rogue.bonusHitChance = 1;
  rogue.energy = rogue.maxEnergy;
  const simulation = new Simulation(rogue, { rng });
  const strikes = [];
  const resolve = simulation.resolveAttack.bind(simulation);
  simulation.resolveAttack = (source, type, damage, options) => {
    const result = resolve(source, type, damage, options);
    strikes.push({ hand: source.hand, damage, outcome: result.outcome });
    return result;
  };
  const hits = [];
  simulation.events.on("hit", (event) => hits.push(event));
  return {
    rogue,
    simulation,
    strikes,
    hits,
    mutilate: rogue.abilities.mutilate,
  };
}

// (weapon roll + AP bonus at the dagger's normalized speed + 38) × 0.75.
function expected(rogue, hand, roll) {
  const weapon = rogue.weapons[hand];
  const die =
    Math.floor(roll * (weapon.maxDamage - weapon.minDamage + 1)) +
    weapon.minDamage;
  const ap =
    (rogue.getAttackPower() / k("ap.perDps")) * k("normalizedSpeed.dagger");
  return (
    (die + ap + k("mutilate").bonusDamage) * k("mutilate").weaponMultiplier
  );
}

const rotation = (...actions) => ({
  schemaVersion: 1,
  name: "Eviscerate at 5 CP, otherwise Mutilate",
  rules: [
    {
      action: "eviscerate",
      conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
    },
    ...actions.map((action) => ({
      action,
      conditions:
        action === "mutilate"
          ? [{ type: "abilityGranted", ability: "mutilate" }]
          : [],
    })),
  ],
});

function casts(config, seed = 267) {
  const fight = createFight(seed, {
    rotation: rotation("mutilate", "sinister-strike"),
    ...config,
  });
  let count = 0;
  fight.simulation.events.on("cast", (event) => {
    if (event.ability === "mutilate") {
      count += 1;
    }
  });
  fight.simulation.run(SECONDS);
  return { count, fight };
}

describe("Mutilate as data (#267)", () => {
  it("is an engine ability that needs a dagger in both hands", () => {
    const entry = ABILITY_DEFINITIONS.find(({ id }) => id === "mutilate");
    assert.ok(entry);
    assert.equal(entry.requiresMainHand, "dagger");
    assert.equal(entry.requiresOffHand, "dagger");
    assert.equal(entry.damage.kind, "bothHands");
  });

  it("reads 60 energy, 2 CP, 75% and +38 from the export's Rank 4 row", () => {
    const row = k("mutilate");
    const spell = abilityCatalogue.get("mutilate");
    assert.equal(row.energy, spell.cost.amount);
    assert.equal(row.energy, 60);
    assert.equal(row.comboPoints, 2);
    assert.equal(row.weaponMultiplier, 0.75);
    assert.equal(row.bonusDamage, 38);
    assert.equal(row.cooldown, 0);
    assert.equal(CONSTANTS.mutilate.source, "wowf-export");
    assert.equal(row.poisonedMultiplier, 1.2);
    assert.match(
      spell.text,
      /75% weapon damage plus an additional 38 with each weapon\. Damage increased by 20% against Poisoned targets\. Awards 2 Combo Points\./,
    );
  });

  it("is granted by the Mutilate talent, with the hash of its rank text", () => {
    assert.equal(TALENT_EFFECTS[MUTILATE].ability, "mutilate");
    assert.equal(
      new Rogue({ talents: TALENTED }).granted.has("mutilate"),
      true,
    );
    assert.equal(
      new Rogue().lockedByBuild(new Rogue().abilities.mutilate),
      true,
    );
  });

  it("is in the builder palette, and a rule for it validates", () => {
    assert.ok(castableAbilities().includes("mutilate"));
    assert.deepEqual(validateRotation(rotation("mutilate")), []);
  });
});

describe("A1: +20% only against a target with Deadly Poison", () => {
  it("Deadly Poison up: ×1.2 exactly on each hand; down: no bonus", () => {
    const rolls = [HIT, HALF, NO_CRIT, HIT, HALF, NO_CRIT];
    const plain = harness(scripted(rolls).rng);
    plain.mutilate.cast(plain.rogue, plain.simulation);
    const poisoned = harness(scripted(rolls).rng);
    poisoned.simulation.applyAura(AURAS.deadlyPoison, { duration: 12 });
    assert.equal(poisoned.simulation.hasAura("deadly-poison"), true);
    poisoned.mutilate.cast(poisoned.rogue, poisoned.simulation);
    assert.equal(plain.strikes.length, 2);
    plain.strikes.forEach((strike, index) => {
      assert.equal(
        poisoned.strikes[index].damage,
        strike.damage * k("mutilate").poisonedMultiplier,
      );
    });
  });

  it("Instant Poison on both hands leaves no aura: never poisoned", () => {
    const { fight, count } = casts({
      weapons: DAGGERS,
      talents: TALENTED,
      poisons: { mainHand: "instant", offHand: "instant" },
    });
    assert.ok(count > 0);
    assert.equal(
      fight.rogue.abilities.mutilate.poisoned(fight.simulation),
      false,
    );
    assert.equal(fight.simulation.hasAura("deadly-poison"), false);
  });
});

describe("A2: needs a dagger in both hands; otherwise passed over, no warning", () => {
  for (const [label, weapons] of [
    ["a sword in the main hand", { ...DAGGERS, mainHand: SWORD }],
    ["a sword in the off hand", { ...DAGGERS, offHand: SWORD }],
  ]) {
    it(`${label}: 0 casts, the rule passed over, nothing drawn`, () => {
      assert.equal(casts({ weapons, talents: TALENTED }).count, 0);
      const { rogue, simulation } = harness(scripted([]).rng, { weapons });
      const host = rotationHost(rogue, simulation);
      assert.equal(host.usable("mutilate"), false);
      assert.equal(host.canCast("mutilate"), false);
      assert.equal(rogue.abilities.mutilate.cast(rogue, simulation), null);
      assert.equal(rogue.energy, rogue.maxEnergy);
    });
  }

  it("daggers in both hands: it casts", () => {
    assert.ok(casts({ weapons: DAGGERS, talents: TALENTED }).count > 0);
  });

  it("a Mutilate rule is never warned for", () => {
    assert.deepEqual(
      rotationWarnings(rotation("mutilate")).filter(
        ({ ability }) => ability === "mutilate",
      ),
      [],
    );
  });
});

describe("A3: per hand (weapon + 38) × 0.75, no off-hand penalty", () => {
  it("gives each hand's exact damage at a fixed roll", () => {
    const { rogue, simulation, strikes, mutilate } = harness(
      scripted([HIT, LOW, NO_CRIT, HIT, TOP, NO_CRIT]).rng,
    );
    mutilate.cast(rogue, simulation);
    assert.deepEqual(strikes, [
      {
        hand: "mainHand",
        damage: expected(rogue, "mainHand", LOW),
        outcome: "hit",
      },
      {
        hand: "offHand",
        damage: expected(rogue, "offHand", TOP),
        outcome: "hit",
      },
    ]);
  });
});

describe("A4: the main hand resolves fully first, then the off hand", () => {
  it("draws attack, damage, crit for the main hand, then for the off hand", () => {
    const tape = scripted([HIT, LOW, NO_CRIT, HIT, TOP, NO_CRIT]);
    const { rogue, simulation, hits, mutilate } = harness(tape.rng);
    const order = [];
    simulation.events.on("cast", () => order.push("cast"));
    simulation.events.on("hit", (event) => order.push(event.outcome));
    mutilate.cast(rogue, simulation);
    assert.equal(tape.left(), 0);
    assert.deepEqual(order, ["cast", "hit", "hit"]);
    assert.deepEqual(
      hits.map((hit) => hit.ability),
      ["mutilate", "mutilate"],
    );
    assert.ok(hits[0].damage < hits[1].damage);
    assert.equal(rogue.comboPoints, 2);
  });

  for (const [label, hit, outcome] of [
    ["misses", 0, "miss"],
    ["is dodged", 1, "dodge"],
  ]) {
    it(`a main hand that ${label}: no off hand, no CP, the miss refund`, () => {
      const tape = scripted([LOW, HALF]);
      const { rogue, simulation, strikes, mutilate } = harness(tape.rng);
      rogue.bonusHitChance = hit;
      const result = mutilate.cast(rogue, simulation);
      assert.equal(tape.left(), 0);
      assert.equal(result.outcome, outcome);
      assert.deepEqual(
        strikes.map((strike) => strike.hand),
        ["mainHand"],
      );
      assert.equal(rogue.comboPoints, 0);
      const cost = k("mutilate").energy;
      assert.equal(
        rogue.energy,
        rogue.maxEnergy - cost + cost * k("skill.missEnergyRefund"),
      );
    });
  }

  it("an off hand that misses still leaves the 2 CP of the main hand", () => {
    const tape = scripted([HIT, HALF, NO_CRIT, LOW, HALF]);
    const { rogue, simulation, strikes, mutilate } = harness(tape.rng);
    rogue.bonusHitChance = 0;
    mutilate.cast(rogue, simulation);
    assert.equal(tape.left(), 0);
    assert.deepEqual(
      strikes.map((strike) => strike.outcome),
      ["hit", "miss"],
    );
    assert.equal(rogue.comboPoints, 2);
  });
});

describe("A5: each hand procs its own weapon's poison", () => {
  it("at 100% chance, the main hand's Instant and the off hand's Deadly both fire", () => {
    const rogue = new Rogue(
      {
        weapons: DAGGERS,
        talents: TALENTED,
        poisons: { mainHand: "instant", offHand: "deadly" },
      },
      {
        modifiers: [
          {
            kind: "poisonChance",
            op: "add",
            value: 1,
            scope: null,
            source: "test",
          },
        ],
      },
    );
    quiet(rogue);
    rogue.critChance = 0;
    rogue.bonusHitChance = 1;
    rogue.energy = rogue.maxEnergy;
    const simulation = new Simulation(rogue, { rng: constant(HALF) });
    rogue.abilities.mutilate.cast(rogue, simulation);
    const { stats } = simulation.procs;
    assert.equal(stats["instant-poison.mainHand"].fires, 1);
    assert.equal(stats["deadly-poison.offHand"].fires, 1);
    assert.equal(stats["instant-poison.offHand"], undefined);
    assert.equal(simulation.hasAura("deadly-poison"), true);
  });
});

describe("A6: 2 CP, Seal Fate at most 1 more, capped at 5", () => {
  function doubleCrit(start, talents) {
    const { rogue, simulation, strikes, mutilate } = harness(constant(HALF), {
      talents,
    });
    rogue.critChance = 1;
    rogue.comboPoints = start;
    mutilate.cast(rogue, simulation);
    return { rogue, simulation, strikes };
  }

  it("a double crit with Seal Fate 5/5 gives 3 CP, and Seal Fate rolls once", () => {
    const { rogue, simulation, strikes } = doubleCrit(0, SEAL_FATE_BUILD);
    assert.deepEqual(
      strikes.map((strike) => strike.outcome),
      ["crit", "crit"],
    );
    assert.equal(rogue.comboPoints, 3);
    assert.equal(simulation.procs.stats["seal-fate"].rolls, 1);
    assert.equal(simulation.procs.stats["seal-fate"].fires, 1);
  });

  it("without Seal Fate a double crit gives 2", () => {
    assert.equal(doubleCrit(0, TALENTED).rogue.comboPoints, 2);
  });

  it("caps at 5", () => {
    const { rogue } = doubleCrit(4, SEAL_FATE_BUILD);
    assert.equal(rogue.comboPoints, 5);
    assert.equal(rogue.resources.comboPoints.waste().overflow, 2);
  });
});

describe("A7: Cold Blood makes both hands crit, and is used once", () => {
  it("both crit; the charge goes once, after the off hand", () => {
    const { rogue, simulation, strikes, mutilate } = harness(constant(HALF));
    const removed = [];
    simulation.events.on("aura", (event) => {
      if (event.aura === "cold-blood" && event.change !== "apply") {
        removed.push(event.change);
      }
    });
    rogue.abilities.coldBlood.cast(rogue, simulation);
    assert.equal(simulation.hasAura("cold-blood"), true);
    simulation.gcd = 0;
    mutilate.cast(rogue, simulation);
    assert.deepEqual(
      strikes.map((strike) => strike.outcome),
      ["crit", "crit"],
    );
    assert.equal(simulation.hasAura("cold-blood"), false);
    assert.equal(removed.length, 1);
  });
});

describe("G2 and G4: no talent, no Mutilate; old configs read the default", () => {
  it("Mutilate at 0 points is locked by the build and never cast", () => {
    assert.equal(casts({ weapons: DAGGERS }).count, 0);
    const rogue = new Rogue({ weapons: DAGGERS });
    assert.equal(rogue.lockedByBuild(rogue.abilities.mutilate), true);
  });

  it("a definition with no requiresOffHand takes any off hand", () => {
    const rogue = new Rogue({ weapons: { ...DAGGERS, offHand: SWORD } });
    const backstab = ABILITY_DEFINITIONS.find(({ id }) => id === "backstab");
    assert.equal(backstab.requiresOffHand, undefined);
    const ability = new Ability(backstab, rogue);
    assert.equal(ability.requiresOffHand, null);
    assert.equal(ability.offHandAllowed(rogue), true);
  });

  it("the fixture runs Mutilate on two daggers", () => {
    const fixture = GOLDEN_CASES.find(
      ({ name }) => name === "mutilate-daggers-seed-267-60s",
    );
    assert.ok(fixture);
    const { fight, count } = (() => {
      const run = createFight(fixture.seed, fixture.config);
      let n = 0;
      run.simulation.events.on("cast", (event) => {
        n += event.ability === "mutilate" ? 1 : 0;
      });
      run.simulation.run(fixture.duration);
      return { fight: run, count: n };
    })();
    assert.ok(count > 0);
    assert.equal(fight.rogue.weapons.offHand.type, "dagger");
  });
});
