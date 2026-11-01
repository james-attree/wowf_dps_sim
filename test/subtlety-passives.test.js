import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { AURAS } from "../js/auras.js";
import { runBatch, deriveSeed } from "../js/batch-runner.js";
import {
  createFight,
  expandTalents,
  fightResult,
  runFight,
} from "../js/fight.js";
import { combine, defineModifier } from "../js/modifiers.js";
import { Rogue } from "../js/rogue.js";
import { defaultDaggerConfig, normalizeConfig } from "../js/sim-config.js";
import { SimRunner } from "../js/sim-runner.js";
import { createRng } from "../js/rng.js";
import { Simulation } from "../js/simulation.js";
import { talentCatalogue } from "../js/talents.js";
import {
  GOLDEN_CASES,
  SUBTLETY_BUILD,
  SUBTLETY_ROTATION,
} from "../scripts/golden-update.mjs";

// Issue #269 (P4.6-05a): Opportunity, Serrated Blades, Thousand Cuts (A13)
// and Quietus (A14), and the eight Subtlety talents with no DPS effect.

const HALF = 0.5;
const RELATIVE = 1e-12;
const EPSILON = 1e-9;
const OPPORTUNITY = "subtlety.opportunity";
const SERRATED = "subtlety.serrated-blades";
const CUTS = "subtlety.thousand-cuts";
const QUIETUS = "subtlety.quietus";
const SUBTLETY_CASE = GOLDEN_CASES.find(
  ({ name }) => name === "subtlety-build-seed-269-60s",
);

function close(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= RELATIVE * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} is not ${expected}`,
  );
}

function maxRank(id) {
  return talentCatalogue.get(id).max;
}

// A rogue on the dagger/dagger alternate with `talents`, in a Simulation
// whose every draw is `roll` (0.5 lands a yellow hit with no crit), at fight
// time `at` of a fight of `length` seconds (null: none told).
function ready(talents, { roll = HALF, at = 0, length = null } = {}) {
  // The talents go in as their modifiers and procs, as in
  // test/assassination-passives.test.js, so a talent can be tried alone
  // without the points the tree's rows ask for.
  const { modifiers, procs } = expandTalents(talents);
  const rogue = new Rogue(
    { ...defaultDaggerConfig(), talents: {} },
    { modifiers, procs },
  );
  let draws = 0;
  const sim = new Simulation(rogue, {
    rng: () => {
      draws += 1;
      return roll;
    },
    fightLength: length,
  });
  sim.currentTime = at;
  rogue.energy = rogue.maxEnergy;
  rogue.comboPoints = k("combo.max");
  sim.gcd = 0;
  return { rogue, sim, draws: () => draws };
}

// The damage multiplier the modifiers give ability `id` (its slug) now.
function multiplier(talents, id, options) {
  const { sim } = ready(talents, options);
  return sim.modifiers.resolve("damage", 1, sim.abilityContext(id));
}

// The damage one cast of `ability` (a Rogue.abilities key) does.
function damageOf(talents, ability, options) {
  const { rogue, sim } = ready(talents, options);
  rogue.abilities[ability].cast(rogue, sim);
  return sim.damageDone;
}

// A fight of `length` seconds on the dagger/dagger alternate with `talents`
// alone (their modifiers and procs, Hemorrhage granted) and `rotation`, on
// `seed`, its draws counted. Not run yet.
function fightOn(talents, rotation, { seed = 269, length = 60 } = {}) {
  const { modifiers, procs } = expandTalents(talents);
  const rogue = new Rogue(
    { ...defaultDaggerConfig(), talents: {}, rotation },
    { modifiers, procs, abilities: ["hemorrhage"] },
  );
  const counted = { draws: 0 };
  const rng = createRng(seed);
  const sim = new Simulation(rogue, {
    rng: () => {
      counted.draws += 1;
      return rng();
    },
    fightLength: length,
  });
  return { sim, counted };
}

function tick(sim) {
  sim.procs.onDotTick(sim.abilityContext("rupture", { bleed: true }));
}

function cuts(sim) {
  return sim.activeBuffs["thousand-cuts"];
}

describe("Subtlety passives read their rank text (#269)", () => {
  const read = (id, pattern) =>
    talentCatalogue.get(id).ranks.map((text) => {
      const found = pattern.exec(text);
      assert.ok(found, `${pattern} finds nothing in ${JSON.stringify(text)}`);
      return Number(found[1]) / 100;
    });

  it("Opportunity: damage by rank on Backstab, Garrote, Ambush and Mutilate", () => {
    const [table] = TALENT_EFFECTS[OPPORTUNITY].modifiers;
    assert.equal(table.kind, "damage");
    assert.deepEqual(table.values, read(OPPORTUNITY, /abilities by (\d+)%/));
    assert.deepEqual([...table.scope.abilities].sort(), [
      "ambush",
      "backstab",
      "garrote",
      "mutilate",
    ]);
  });

  it("Serrated Blades: armor ignored on every attack, and Rupture damage", () => {
    const [ignore, rupture] = TALENT_EFFECTS[SERRATED].modifiers;
    assert.equal(ignore.kind, "armorIgnore");
    assert.equal(ignore.scope, undefined);
    assert.deepEqual(ignore.values, read(SERRATED, /ignore (\d+)%/));
    assert.equal(rupture.kind, "damage");
    assert.deepEqual(rupture.scope.abilities, ["rupture"]);
    assert.deepEqual(
      rupture.values,
      read(SERRATED, /Rupture ability by (\d+)%/),
    );
  });

  it("Quietus: damage by rank on its three strikes, below 35% health", () => {
    const [table] = TALENT_EFFECTS[QUIETUS].modifiers;
    assert.equal(table.kind, "damage");
    assert.deepEqual(table.values, read(QUIETUS, /cause (\d+)% more/));
    assert.deepEqual([...table.scope.abilities].sort(), [
      "ghostly-strike",
      "hemorrhage",
      "sinister-strike",
    ]);
    const { numerator, denominator } = k("quietus.targetHealth");
    assert.deepEqual(table.targetHealthBelow, { numerator, denominator });
    for (const share of read(QUIETUS, /below (\d+)% health/)) {
      close(numerator / denominator, share, "35%");
    }
    assert.equal(k("target.healthModel"), "linear");
  });

  it("Thousand Cuts: the constants row is the text's 3 energy, 5 stacks, 10 s", () => {
    const [text] = talentCatalogue.get(CUTS).ranks;
    const found =
      /within (\d+) sec is reduced by (\d+), stacking up to (\d+) times/.exec(
        text,
      );
    assert.ok(found);
    const row = k("thousandCuts");
    assert.deepEqual(
      [row.duration, row.energyPerStack, row.maxStacks],
      found.slice(1).map(Number),
    );
    assert.match(text, /When your Rupture ability deals periodic damage/);
    assert.match(text, /next Hemorrhage or Backstab/);
    const [spec] = TALENT_EFFECTS[CUTS].procs;
    assert.equal(spec.trigger, "onDotTick");
    assert.deepEqual(spec.scope.abilities, ["rupture"]);
    assert.deepEqual(spec.chance.values, row.chance);
    assert.deepEqual(spec.actions, [
      { type: "applyAura", aura: "thousand-cuts" },
    ]);
    const aura = AURAS.thousandCuts;
    assert.equal(aura.duration, row.duration);
    assert.equal(aura.maxStacks, row.maxStacks);
    assert.equal(aura.stackRule, "add");
    assert.equal(aura.refresh, "refresh");
    assert.equal(aura.charges, 1);
    assert.deepEqual(aura.modifiers, [
      defineModifier({
        kind: "energyCost",
        op: "add",
        value: -row.energyPerStack,
        scope: { abilities: ["hemorrhage", "backstab"] },
        source: "thousand-cuts",
      }),
    ]);
  });
});

describe("Opportunity and Serrated Blades (#269)", () => {
  it("Opportunity 2/2 is ×1.1 on Backstab and Mutilate, and nothing on Sinister Strike", () => {
    const talents = { [OPPORTUNITY]: maxRank(OPPORTUNITY) };
    for (const id of ["backstab", "mutilate", "ambush", "garrote"]) {
      close(multiplier(talents, id), 1.1, id);
    }
    for (const ability of ["backstab", "mutilate"]) {
      assert.ok(damageOf(talents, ability) > damageOf({}, ability), ability);
    }
    assert.equal(multiplier(talents, "sinister-strike"), 1);
    assert.equal(
      damageOf(talents, "sinisterStrike"),
      damageOf({}, "sinisterStrike"),
    );
  });

  it("Serrated Blades 3/3 ignores 9% of the armor, flat with Hack and Slash's mace part", () => {
    const { sim } = ready({ [SERRATED]: maxRank(SERRATED) });
    const context = sim.abilityContext("sinister-strike");
    assert.equal(sim.modifiers.resolve("armorIgnore", 0, context), 0.09);
    const both = ready({
      [SERRATED]: maxRank(SERRATED),
      "combat.hack-and-slash": maxRank("combat.hack-and-slash"),
    });
    const mace = { ...both.sim.abilityContext("sinister-strike") };
    mace.weaponType = "mace";
    close(
      both.sim.modifiers.resolve("armorIgnore", 0, mace),
      0.09 + 0.15,
      "flat",
    );
    const plain = ready({}).sim.armorMultiplier(context);
    assert.ok(sim.armorMultiplier(context) > plain);
  });

  it("Serrated Blades 3/3 is ×1.3 on Rupture's ticks, and leaves Eviscerate alone", () => {
    const tickOf = (talents) => {
      const { rogue, sim } = ready(talents);
      rogue.abilities.rupture.cast(rogue, sim);
      return sim.activeDots.rupture.tickDamage;
    };
    const talents = { [SERRATED]: maxRank(SERRATED) };
    close(multiplier(talents, "rupture"), 1.3, "rupture");
    assert.equal(multiplier(talents, "eviscerate"), 1);
    // Rupture's damage is floored when it is applied, then shared by its ticks.
    assert.ok(tickOf(talents) > tickOf({}) * 1.29);
    assert.ok(tickOf(talents) < tickOf({}) * 1.31);
    // Eviscerate meets armor, so it gains only the armor part.
    const { sim } = ready(talents);
    const context = sim.abilityContext("eviscerate");
    close(
      damageOf(talents, "eviscerate") / damageOf({}, "eviscerate"),
      sim.armorMultiplier(context) / ready({}).sim.armorMultiplier(context),
      "eviscerate",
    );
  });
});

describe("Thousand Cuts (#269, A13)", () => {
  const talents = { [CUTS]: 1 };

  it("each Rupture tick adds a stack, up to 5, and refreshes the 10 s", () => {
    const { sim } = ready(talents);
    for (let at = 1; at <= 7; at += 1) {
      if (cuts(sim) !== undefined) {
        cuts(sim).duration = 1;
      }
      tick(sim);
      assert.equal(cuts(sim).stacks, Math.min(at, 5), `tick ${at}`);
      assert.equal(cuts(sim).duration, 10, `tick ${at}`);
    }
    assert.equal(sim.procs.stats["thousand-cuts"].fires, 7);
  });

  it("a tick of another DoT adds nothing", () => {
    const { sim } = ready(talents);
    sim.procs.onDotTick(sim.abilityContext("deadly-poison"));
    sim.procs.onDotTick(sim.abilityContext("garrote", { bleed: true }));
    assert.equal(cuts(sim), undefined);
  });

  it("takes 3 energy a stack off Hemorrhage and Backstab only", () => {
    const { rogue, sim } = ready(talents);
    const base = (id) => ready({}).rogue.abilities[id].costNow(ready({}).sim);
    for (let stacks = 1; stacks <= 5; stacks += 1) {
      tick(sim);
      for (const id of ["hemorrhage", "backstab"]) {
        assert.equal(
          rogue.abilities[id].costNow(sim),
          base(id) - 3 * stacks,
          `${id} at ${stacks}`,
        );
      }
      for (const id of [
        "sinisterStrike",
        "ghostlyStrike",
        "eviscerate",
        "rupture",
        "mutilate",
      ]) {
        assert.equal(rogue.abilities[id].costNow(sim), base(id), id);
      }
    }
  });

  it("never takes a cost below 0", () => {
    const [modifier] = AURAS.thousandCuts.modifiers;
    assert.equal(
      combine("energyCost", ready({}).rogue.abilities.hemorrhage.cost, [
        { modifier, stacks: 99 },
      ]),
      0,
    );
  });

  it("the Backstab or Hemorrhage that pays the cut cost uses every stack, hit or miss", () => {
    for (const [id, roll] of [
      ["backstab", HALF],
      ["hemorrhage", HALF],
      ["backstab", 0],
      ["hemorrhage", 0],
    ]) {
      const { rogue, sim } = ready(talents, { roll });
      for (let at = 0; at < 4; at += 1) {
        tick(sim);
      }
      const cost = rogue.abilities[id].costNow(sim);
      assert.equal(cost, rogue.abilities[id].cost - 12);
      const casts = [];
      sim.on("cast", (event) => casts.push(event.cost));
      const before = rogue.energy;
      rogue.abilities[id].cast(rogue, sim);
      assert.deepEqual(casts, [cost], id);
      assert.equal(cuts(sim), undefined, `${id} roll ${roll}`);
      if (roll === HALF) {
        assert.equal(rogue.energy, before - cost, id);
      }
    }
  });

  it("a Sinister Strike or Eviscerate leaves the stacks up", () => {
    for (const id of ["sinisterStrike", "eviscerate"]) {
      const { rogue, sim } = ready(talents);
      tick(sim);
      tick(sim);
      rogue.abilities[id].cast(rogue, sim);
      assert.equal(cuts(sim).stacks, 2, id);
    }
  });

  it("in a fight: never over 5, gone 10 s after the last tick, used only by Hemorrhage or Backstab", () => {
    const cutsOnly = {
      schemaVersion: 1,
      name: "Rupture in the first 20 s, then Sinister Strike",
      rules: [
        {
          action: "rupture",
          conditions: [
            { type: "comboPoints", op: ">=", value: 5 },
            { type: "fightTimeRemaining", op: ">", value: 40 },
            { type: "debuffRemaining", debuff: "rupture", op: "<", value: 1 },
          ],
        },
        {
          action: "backstab",
          conditions: [{ type: "fightTimeRemaining", op: "<", value: 10 }],
        },
        { action: "sinister-strike", conditions: [] },
      ],
    };
    const { sim } = fightOn(talents, cutsOnly);
    const ticks = [];
    const events = [];
    const casts = [];
    sim.on("hit", (event) => {
      if (event.ability === "rupture" && event.origin === "dot") {
        ticks.push(event.time);
      }
    });
    sim.on("aura", (event) => {
      if (event.aura === "thousand-cuts") {
        events.push(event);
      }
    });
    sim.on("cast", (event) => casts.push(event));
    sim.run(60);
    assert.ok(ticks.length > 5);
    assert.ok(events.every(({ stacks }) => stacks <= 5));
    assert.ok(events.some(({ stacks }) => stacks === 5));
    const expiries = events.filter(({ change }) => change === "expire");
    const byTime = expiries.filter(({ reason }) => reason === "time");
    assert.ok(byTime.length > 0, "an expiry by time");
    for (const expiry of byTime) {
      const last = Math.max(...ticks.filter((time) => time < expiry.time));
      close(expiry.time - last, 10, `expiry at ${expiry.time}`);
    }
    for (const expiry of expiries.filter(
      ({ reason }) => reason === "charges",
    )) {
      assert.ok(
        casts.some(
          ({ time, ability }) =>
            time === expiry.time &&
            ["backstab", "hemorrhage"].includes(ability),
        ),
        `used at ${expiry.time}`,
      );
    }
    for (const event of events.filter(({ change }) => change !== "expire")) {
      assert.ok(ticks.includes(event.time), `applied at ${event.time}`);
    }
  });
});

describe("Quietus (#269, A14)", () => {
  const talents = { [QUIETUS]: maxRank(QUIETUS) };
  const bonus = TALENT_EFFECTS[QUIETUS].modifiers[0].values.at(-1);

  // (a) A strike just either side of 0.65·L, in exact seconds.
  it("is off up to 0.65·L (65 s of 100, 39 of 60) and on strictly after", () => {
    for (const [length, at, on] of [
      [100, 64, false],
      [100, 64.999, false],
      [100, 65, false],
      [100, 65.001, true],
      [100, 66, true],
      [60, 39, false],
      [60, 40, true],
    ]) {
      for (const [id, ability] of [
        ["hemorrhage", "hemorrhage"],
        ["sinister-strike", "sinisterStrike"],
        ["ghostly-strike", "ghostlyStrike"],
      ]) {
        const options = { at, length };
        const label = `${id} at ${at} of ${length}`;
        assert.equal(
          multiplier(talents, id, options),
          on ? 1 + bonus : 1,
          label,
        );
        const without = damageOf({}, ability, options);
        const withIt = damageOf(talents, ability, options);
        assert.ok(on ? withIt > without : withIt === without, label);
      }
      // Backstab is not one of its strikes.
      assert.equal(
        damageOf(talents, "backstab", { at, length }),
        damageOf({}, "backstab", { at, length }),
      );
    }
  });

  // (d) No fight length: off.
  it("is off with no fight length", () => {
    for (const at of [0, 65, 1e6]) {
      assert.equal(
        damageOf(talents, "hemorrhage", { at, length: null }),
        damageOf({}, "hemorrhage", { at, length: null }),
      );
    }
    const fight = createFight(269, SUBTLETY_CASE.config);
    assert.equal(fight.simulation.fightLength, null);
    assert.equal(
      fight.simulation.targetHealthBelow(k("quietus.targetHealth")),
      false,
    );
  });

  it("Simulation.targetHealthBelow is d·t > (d − n)·L", () => {
    const share = { numerator: 7, denominator: 20 };
    const { sim } = ready({}, { length: 60 });
    for (const [at, below] of [
      [0, false],
      [38.999, false],
      [39, false],
      [39.000001, true],
      [60, true],
    ]) {
      sim.currentTime = at;
      assert.equal(sim.targetHealthBelow(share), below, `${at}`);
    }
  });

  // (b) A cut across 0.65·L is the fight in one piece.
  it("a fight cut across 0.65·L is the fight in one run", () => {
    const logged = () => {
      const fight = createFight(
        SUBTLETY_CASE.seed,
        structuredClone(SUBTLETY_CASE.config),
        { duration: SUBTLETY_CASE.duration },
      );
      const log = [];
      fight.simulation.on("*", (event) => {
        if (event.type !== "end") {
          log.push(JSON.stringify(event));
        }
      });
      return { fight, log };
    };
    const one = logged();
    one.fight.simulation.run(SUBTLETY_CASE.duration);
    const threshold = (SUBTLETY_CASE.duration * 13) / 20;
    for (const cut of [threshold - 0.5, threshold, threshold + 0.25]) {
      const split = logged();
      const { simulation } = split.fight;
      simulation.run(cut);
      simulation.run(SUBTLETY_CASE.duration - simulation.currentTime);
      assert.deepEqual(split.log, one.log, `cut at ${cut}`);
      assert.deepEqual(fightResult(split.fight), fightResult(one.fight));
    }
    // The fight casts Hemorrhage after 0.65·L, so Quietus did something.
    assert.ok(
      one.log
        .map((line) => JSON.parse(line))
        .some(
          ({ type, ability, time }) =>
            type === "cast" && ability === "hemorrhage" && time > threshold,
        ),
    );
  });

  // (c) Live (SimRunner, in chunks) is batch (runBatch) for the same seed.
  it("live equals batch for the same seed", () => {
    const { config, duration } = SUBTLETY_CASE;
    const seed = 269;
    const batch = runBatch({ seed, iterations: 3, duration, config });
    for (let index = 0; index < 3; index += 1) {
      for (const chunk of [Infinity, 0.37]) {
        const runner = new SimRunner({
          seed: deriveSeed(seed, index),
          duration,
          config,
        });
        runner.run();
        while (runner.state === "running") {
          runner.advance(chunk);
        }
        assert.equal(runner.result.dps, batch.dps[index], `${index} ${chunk}`);
      }
    }
  });
});

describe("no phantom draws, and old configs (#269, G2 and G4)", () => {
  it("at rank 0 the four talents give no modifier and no proc", () => {
    const zero = Object.fromEntries(
      [OPPORTUNITY, SERRATED, CUTS, QUIETUS].map((id) => [id, 0]),
    );
    const build = expandTalents(zero);
    assert.deepEqual(build.modifiers, []);
    assert.deepEqual(build.procs, []);
  });

  it("a Rupture tick draws nothing without Thousand Cuts, and one draw with it", () => {
    const none = ready({});
    tick(none.sim);
    assert.equal(none.draws(), 0);
    const one = ready({ [CUTS]: 1 });
    tick(one.sim);
    assert.equal(one.draws(), 1);
  });

  it("Opportunity, Serrated Blades and Quietus draw nothing: the same draws, the same times", () => {
    const run = (talents) => {
      const { sim, counted } = fightOn(talents, SUBTLETY_ROTATION);
      const times = [];
      sim.on("cast", ({ time, ability }) => times.push(`${time} ${ability}`));
      sim.run(SUBTLETY_CASE.duration);
      return { draws: counted.draws, times, damage: sim.damageDone };
    };
    const base = { ...SUBTLETY_CASE.config.talents, [CUTS]: 0 };
    const without = run({
      ...base,
      [OPPORTUNITY]: 0,
      [SERRATED]: 0,
      [QUIETUS]: 0,
    });
    const withThem = run(base);
    assert.ok(without.draws > 100);
    assert.equal(withThem.draws, without.draws);
    assert.deepEqual(withThem.times, without.times);
    assert.ok(withThem.damage > without.damage);
  });

  it("a config without the new talents reads as before: no new field, the default health model", () => {
    const old = { ...defaultDaggerConfig() };
    assert.deepEqual(
      normalizeConfig(old),
      normalizeConfig(structuredClone(old)),
    );
    assert.equal(Object.hasOwn(normalizeConfig(old), "healthModel"), false);
    assert.equal(
      Object.hasOwn(normalizeConfig(old).target ?? {}, "healthModel"),
      false,
    );
    const zero = {
      ...old,
      talents: Object.fromEntries(
        [OPPORTUNITY, SERRATED, CUTS, QUIETUS].map((id) => [id, 0]),
      ),
    };
    assert.deepEqual(
      runFight({ seed: 5, duration: 30, config: zero }).dps,
      runFight({ seed: 5, duration: 30, config: old }).dps,
    );
  });
});

describe("the eight Subtlety talents with no DPS effect (#269)", () => {
  const STEALTH = [
    "subtlety.camouflage",
    "subtlety.master-of-deception",
    "subtlety.improved-distract",
    "subtlety.heightened-senses",
    "subtlety.dirty-deeds",
  ];
  const OWN = [
    "subtlety.setup",
    "subtlety.elusiveness",
    "subtlety.dirty-tricks",
  ];

  it("each has a one-line reason; the five that need Stealth or an opener say so", () => {
    for (const id of [...STEALTH, ...OWN]) {
      assert.match(TALENT_EFFECTS[id].noDpsEffect, /^[^\n]{10,}$/, id);
    }
    for (const id of STEALTH) {
      assert.match(
        TALENT_EFFECTS[id].noDpsEffect,
        /^Needs Stealth or an opener: the sim models neither/,
        id,
      );
    }
    assert.match(TALENT_EFFECTS["subtlety.setup"].noDpsEffect, /[Dd]odg/);
    assert.match(TALENT_EFFECTS["subtlety.elusiveness"].noDpsEffect, /Vanish/);
    assert.match(TALENT_EFFECTS["subtlety.dirty-tricks"].noDpsEffect, /Sap/);
    assert.match(TALENT_EFFECTS["subtlety.dirty-deeds"].noDpsEffect, /behind/);
  });

  it("go into noDps, not unmapped", () => {
    const build = expandTalents(
      Object.fromEntries([...STEALTH, ...OWN].map((id) => [id, 1])),
    );
    assert.deepEqual([...build.noDps].sort(), [...STEALTH, ...OWN].sort());
    assert.deepEqual(build.unmapped, []);
    assert.deepEqual(build.modifiers, []);
  });
});

describe("the Subtlety golden case (#269)", () => {
  it("spends 51 points on the four passives, Hemorrhage and the no-DPS talents", () => {
    const points = Object.values(SUBTLETY_BUILD).reduce((a, b) => a + b, 0);
    assert.equal(points, 51);
    for (const id of [OPPORTUNITY, SERRATED, CUTS, QUIETUS]) {
      assert.equal(SUBTLETY_BUILD[id], maxRank(id), id);
    }
    assert.equal(SUBTLETY_CASE.config.rotation, SUBTLETY_ROTATION);
    assert.equal(SUBTLETY_CASE.seed, 269);
    assert.equal(SUBTLETY_CASE.duration, 60);
  });

  it("Thousand Cuts lowers what Backstab and Hemorrhage pay in it", () => {
    const fight = createFight(SUBTLETY_CASE.seed, SUBTLETY_CASE.config, {
      duration: SUBTLETY_CASE.duration,
    });
    const paid = [];
    fight.simulation.on("cast", ({ ability, cost }) => {
      if (ability === "backstab") {
        paid.push(cost);
      }
    });
    fight.simulation.run(SUBTLETY_CASE.duration);
    const full = ready({}).rogue.abilities.backstab.cost;
    assert.ok(paid.some((cost) => cost < full));
    assert.ok(paid.every((cost) => cost >= full - 15 - EPSILON));
  });
});
