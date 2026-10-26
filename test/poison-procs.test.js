import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { createFight, runFight } from "../js/fight.js";
import { poisonCatalogue, poisonProcs } from "../js/poisons.js";
import { defineProc } from "../js/procs.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

// Instant and Deadly Poison through the proc pipeline (A5, #105).

const HIT = 0.99; // a plain landed swing (no crit, full bonus hit)
const NO_CRIT = 0.99; // a tick's crit roll at a crit chance of 0

function scripted(values) {
  let at = 0;
  const rng = () => {
    if (at >= values.length) {
      throw new Error(`draw ${at + 1} was not scripted`);
    }
    return values[at++];
  };
  return { rng, left: () => values.length - at };
}

// A rogue holding the given poisons and a simulation with no rotation, every
// swing landing, and no crit. `rolls` script the rng.
function harness({ poisons, rolls, seed = 1, modifiers, procs }) {
  const rogue = new Rogue({ poisons }, { modifiers, procs });
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  rogue.rotation = () => {};
  const tape = rolls === undefined ? null : scripted(rolls);
  const sim = new Simulation(rogue, tape ? { rng: tape.rng } : { seed });
  return { rogue, sim, tape };
}

function swing(sim, hand = "mainHand") {
  const weapon = sim.rogue.weapons[hand];
  return sim.resolveAttack(weapon.attack, "weapon", 100);
}

// Run `run` with a constant swapped, and put it back.
function withConstant(id, value, run) {
  const row = CONSTANTS[id];
  const saved = row.value;
  row.value = value;
  try {
    return run();
  } finally {
    row.value = saved;
  }
}

const INSTANT_MAIN = { mainHand: "instant", offHand: null };
const DEADLY_MAIN = { mainHand: "deadly", offHand: null };

describe("the poison data", () => {
  const instant = poisonCatalogue.get("instant-poison").top;
  const deadly = poisonCatalogue.get("deadly-poison").top;

  it("is the export's top ranks, and the constants and the aura agree with it", () => {
    assert.equal(instant.rank, 6);
    assert.equal(deadly.rank, 5);
    assert.deepEqual(k("poison.instant"), {
      chance: instant.chance,
      min: instant.effect.min,
      max: instant.effect.max,
      charges: instant.charges,
    });
    assert.deepEqual(k("poison.deadly"), {
      chance: deadly.chance,
      damage: deadly.effect.damage,
      duration: deadly.effect.duration,
      stacks: deadly.effect.maxStacks,
      charges: deadly.charges,
    });
    const { interval, ticks } = k("poison.deadlyTick");
    assert.equal(interval * ticks, deadly.effect.duration);
    const aura = createFight(1).simulation.auraDefinitions.get("deadly-poison");
    assert.equal(aura.maxStacks, deadly.effect.maxStacks);
    assert.equal(aura.duration, deadly.effect.duration);
  });
});

describe("poisonProcs", () => {
  it("gives no proc for no poison, and none for a poison with no DPS here", () => {
    assert.deepEqual(poisonProcs(undefined), []);
    assert.deepEqual(poisonProcs({}), []);
    assert.deepEqual(poisonProcs({ mainHand: null, offHand: null }), []);
    assert.equal(
      poisonProcs({ mainHand: undefined, offHand: "instant" }).length,
      1,
    );
    for (const key of ["wound", "crippling", "mind-numbing"]) {
      assert.deepEqual(poisonProcs({ mainHand: key, offHand: key }), []);
    }
  });

  it("builds Instant Poison VI as a flat 20% on a hit of its hand, a direct spell hit", () => {
    const [proc, ...rest] = poisonProcs(INSTANT_MAIN);
    assert.equal(rest.length, 0);
    assert.equal(proc.id, "instant-poison.mainHand");
    assert.equal(proc.trigger, "onHit");
    assert.deepEqual(proc.chance, { mode: "flat", value: 0.2 });
    assert.deepEqual(proc.scope.hands, ["mainHand"]);
    assert.deepEqual(proc.actions, [
      {
        type: "dealDamage",
        id: "instant-poison",
        name: "Instant Poison",
        min: 76,
        max: 100,
        spellHit: true,
        canCrit: true,
      },
    ]);
  });

  it("builds Deadly Poison V as a flat 30%, a stacking DoT of 92 over 4 ticks 3 s apart", () => {
    const [proc] = poisonProcs({ mainHand: null, offHand: "deadly" });
    assert.equal(proc.id, "deadly-poison.offHand");
    assert.deepEqual(proc.chance, { mode: "flat", value: 0.3 });
    assert.deepEqual(proc.scope.hands, ["offHand"]);
    assert.deepEqual(proc.actions, [
      {
        type: "applyDot",
        id: "deadly-poison",
        name: "Deadly Poison",
        tickDamage: 23,
        interval: 3,
        duration: 12,
        aura: "deadly-poison",
        spellHit: true,
      },
    ]);
  });

  it("lists the main hand first, and refuses a poison it does not know", () => {
    const procs = poisonProcs({ mainHand: "deadly", offHand: "instant" });
    assert.deepEqual(
      procs.map((proc) => proc.id),
      ["deadly-poison.mainHand", "instant-poison.offHand"],
    );
    assert.throws(() => poisonProcs({ mainHand: "venom" }), {
      name: "RangeError",
      message: /not a poison in the catalogue/,
    });
  });

  it("refuses a Deadly Poison whose ticks do not fill the export's duration, either way", () => {
    for (const tick of [
      { interval: 2, ticks: 4 },
      { interval: 4, ticks: 4 },
      { interval: 3, ticks: 5 },
    ]) {
      const read = (id) => (id === "poison.deadlyTick" ? tick : k(id));
      assert.throws(() => poisonProcs(DEADLY_MAIN, poisonCatalogue, read), {
        name: "RangeError",
        message: /lasts 12 s in the export/,
      });
    }
    const read = (id) =>
      id === "poison.deadlyTick" ? { interval: 4, ticks: 3 } : k(id);
    const [proc] = poisonProcs(DEADLY_MAIN, poisonCatalogue, read);
    assert.equal(proc.actions[0].interval, 4);
    assert.equal(proc.actions[0].tickDamage, 92 / 3);
  });

  it("reaches the fight through the config, after the host's procs", () => {
    const host = defineProc({
      id: "host",
      trigger: "onHit",
      chance: { mode: "flat", value: 0.1 },
      actions: [{ type: "gainResource", resource: "comboPoints", amount: 1 }],
    });
    const rogue = new Rogue(
      { poisons: { mainHand: "instant", offHand: "deadly" } },
      { procs: [host] },
    );
    assert.deepEqual(
      rogue.procs.map((proc) => proc.id),
      ["host", "instant-poison.mainHand", "deadly-poison.offHand"],
    );
    assert.deepEqual(new Rogue().procs, []);
  });
});

describe("Instant Poison", () => {
  it("rolls its chance, then a spell hit, then the damage, and logs under its name", () => {
    for (const [damageRoll, damage] of [
      [0, 76],
      [0.99, 100],
    ]) {
      const { sim, tape } = harness({
        poisons: INSTANT_MAIN,
        rolls: [HIT, 0.1, 0.5, damageRoll, NO_CRIT],
      });
      swing(sim);
      assert.equal(tape.left(), 0);
      assert.equal(sim.abilityStats["instant-poison"].damage, damage);
      assert.equal(sim.abilityStats["instant-poison"].hits, 1);
      assert.equal(sim.abilityBreakdown()["Instant Poison"].damage, damage);
      assert.equal(sim.combatLog[0].name, "Instant Poison");
      assert.equal(sim.combatLog[0].damage, damage);
      assert.equal(sim.combatLog[0].status, "Hit");
    }
  });

  it("is a nature hit: it skips armor", () => {
    assert.ok(k("target.armor") > 0);
    const { sim } = harness({
      poisons: INSTANT_MAIN,
      rolls: [HIT, 0.1, 0.5, 0, NO_CRIT],
    });
    swing(sim);
    assert.equal(sim.abilityStats["instant-poison"].damage, 76);
    assert.equal(
      sim.abilityStats["main-hand"].damage < 100,
      true,
      "the white swing next to it took armor",
    );
  });

  it("can resist on the spell table, and a resist takes no damage draw", () => {
    const { sim, tape } = harness({
      poisons: INSTANT_MAIN,
      rolls: [HIT, 0.1, 0.1],
    });
    swing(sim);
    assert.equal(tape.left(), 0);
    const record = sim.abilityStats["instant-poison"];
    assert.equal(record.damage, 0);
    assert.equal(record.misses, 1);
    assert.equal(sim.combatLog[0].status, "Resist");
  });

  it("does not proc at its chance exactly, and then draws nothing more", () => {
    const { sim, tape } = harness({
      poisons: INSTANT_MAIN,
      rolls: [HIT, 0.2],
    });
    swing(sim);
    assert.equal(tape.left(), 0);
    assert.equal(sim.abilityStats["instant-poison"], undefined);
  });

  it("is its hand's poison: an off-hand swing draws nothing for a main-hand poison", () => {
    const { sim, tape } = harness({
      poisons: INSTANT_MAIN,
      rolls: [HIT],
    });
    swing(sim, "offHand");
    assert.equal(tape.left(), 0);
    const off = harness({
      poisons: { mainHand: null, offHand: "instant" },
      rolls: [HIT, 0.1, 0.5, 0, NO_CRIT],
    });
    swing(off.sim, "offHand");
    assert.equal(off.sim.abilityStats["instant-poison"].damage, 76);
  });

  it("is rolled once for each landed skill, as a main-hand attack", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { rogue, sim } = harness({ poisons: INSTANT_MAIN, seed });
      const result = rogue.abilities.sinisterStrike.cast(rogue, sim);
      const stats = sim.procs.stats["instant-poison.mainHand"];
      assert.equal(stats.rolls, result.landed ? 1 : 0, `seed ${seed}`);
    }
  });
});

describe("Instant Poison crits", () => {
  const MELEE_CRIT = 0.5;
  const SUPPRESSED = MELEE_CRIT - 0.048; // 0.03 skill + 0.018 aura, as the ticks

  // One white swing at a melee crit chance of 0.5 whose poison fires, with the
  // given crit roll. The swing's own roll is 0.99, a hit and not a crit.
  function crit(roll, { modifiers } = {}) {
    const { rogue, sim, tape } = harness({
      poisons: INSTANT_MAIN,
      modifiers,
      rolls: [HIT, 0.1, 0.5, 0, roll],
    });
    rogue.critChance = MELEE_CRIT;
    swing(sim);
    return { sim, tape };
  }

  it("draws the crit last: the chance, the spell hit, the damage, then the crit", () => {
    const { sim, tape } = crit(0.99);
    assert.equal(tape.left(), 0);
    assert.equal(sim.abilityStats["instant-poison"].damage, 76);
  });

  it("crits at the melee crit chance less the 4.8% suppression, for 1.5x", () => {
    assert.equal(k("poison.instantCrit"), 1.5);
    assert.equal(k("poison.instantCritSuppression"), true);
    const hit = crit(SUPPRESSED + 0.001);
    assert.equal(hit.sim.abilityStats["instant-poison"].damage, 76);
    assert.equal(hit.sim.combatLog[0].status, "Hit");
    const edge = crit(SUPPRESSED - 0.001);
    assert.equal(edge.sim.abilityStats["instant-poison"].damage, 114);
    assert.equal(edge.sim.combatLog[0].status, "Crit");
    assert.equal(edge.sim.combatLog[0].damage, 114);
    assert.equal(edge.sim.abilityStats["instant-poison"].crits, 1);
    assert.equal(hit.sim.abilityStats["instant-poison"].crits, 0);
  });

  it("is not suppressed when poison.instantCritSuppression is off, and then crits at the full chance", () => {
    const { sim } = withConstant("poison.instantCritSuppression", false, () =>
      crit(MELEE_CRIT - 0.001),
    );
    assert.equal(sim.abilityStats["instant-poison"].damage, 114);
    const miss = withConstant("poison.instantCritSuppression", false, () =>
      crit(MELEE_CRIT + 0.001),
    );
    assert.equal(miss.sim.abilityStats["instant-poison"].damage, 76);
    // With it on, the same roll is a hit: the suppression is what separates them.
    assert.equal(crit(MELEE_CRIT - 0.001).sim.combatLog[0].status, "Hit");
  });

  it("reads poison.instantCrit for the multiplier, and a poison critDamage modifier scales its bonus", () => {
    const x2 = withConstant("poison.instantCrit", 2, () => crit(0));
    assert.equal(x2.sim.abilityStats["instant-poison"].damage, 152);
    const modified = crit(0, {
      modifiers: [
        { kind: "critDamage", value: 1, scope: { tags: ["poison"] } },
      ],
    });
    assert.equal(modified.sim.abilityStats["instant-poison"].damage, 152);
    const other = crit(0, {
      modifiers: [{ kind: "critDamage", value: 1, scope: { tags: ["bleed"] } }],
    });
    assert.equal(other.sim.abilityStats["instant-poison"].damage, 114);
  });

  it("takes the melee crit chance's modifiers, and a crit modifier for poison adds to it", () => {
    const { rogue, sim } = harness({
      poisons: INSTANT_MAIN,
      modifiers: [
        { kind: "critChance", value: 0.2, scope: { tags: ["poison"] } },
      ],
      rolls: [HIT, 0.1, 0.5, 0, 0.6],
    });
    rogue.critChance = MELEE_CRIT;
    swing(sim);
    // 0.5 + 0.2 - 0.048 = 0.652, so 0.6 crits
    assert.equal(sim.abilityStats["instant-poison"].damage, 114);
  });

  it("hands back the outcome and status of the hit it dealt", () => {
    const { rogue, sim } = harness({
      poisons: INSTANT_MAIN,
      rolls: [0.5, 0.5, 0, 0.5],
    });
    rogue.critChance = 1;
    const dealt = sim.resolveProcDamage({
      id: "instant-poison",
      name: "Instant Poison",
      min: 76,
      max: 100,
      spellHit: true,
      canCrit: true,
    });
    assert.equal(dealt.outcome, "crit");
    assert.equal(dealt.status, "Crit");
    assert.equal(dealt.damage, 132);
    const plain = sim.resolveProcDamage({
      id: "instant-poison",
      name: "Instant Poison",
      min: 76,
      max: 100,
      spellHit: false,
      canCrit: false,
    });
    assert.equal(plain.outcome, "hit");
    assert.equal(plain.status, "Hit");
  });

  it("skips armor on a crit as it does on a hit", () => {
    assert.equal(crit(0).sim.abilityStats["instant-poison"].damage, 114);
  });

  it("draws no crit for a resist, and none when the poison does not fire", () => {
    const resist = harness({
      poisons: INSTANT_MAIN,
      rolls: [HIT, 0.1, 0.1],
    });
    resist.rogue.critChance = MELEE_CRIT;
    swing(resist.sim);
    assert.equal(resist.tape.left(), 0);
    const quiet = harness({ poisons: INSTANT_MAIN, rolls: [HIT, 0.9] });
    quiet.rogue.critChance = MELEE_CRIT;
    swing(quiet.sim);
    assert.equal(quiet.tape.left(), 0);
  });

  it("draws exactly one crit roll for a landed poison hit, even at a crit chance of 0", () => {
    const { sim, tape } = harness({
      poisons: INSTANT_MAIN,
      rolls: [HIT, 0.1, 0.5, 0, 0],
    });
    swing(sim);
    assert.equal(tape.left(), 0);
    assert.equal(sim.abilityStats["instant-poison"].damage, 76);
  });

  it("leaves a build with no poison on the same draws: nothing extra is rolled", () => {
    for (const poisons of [undefined, { mainHand: null, offHand: null }]) {
      const draws = (config) => {
        const rogue = new Rogue(config);
        const sim = new Simulation(rogue, { seed: 7 });
        for (let i = 0; i < 20; i++) {
          sim.resolveAttack(rogue.weapons.mainHand.attack, "weapon", 100);
        }
        return sim.rng();
      };
      assert.equal(draws({ poisons }), draws({}));
    }
  });
});

describe("which attacks roll a poison", () => {
  // The rule follows wowsims (its main-hand mask includes the specials) and is
  // a deliberate reference choice, unverified against real Classic: the
  // main-hand poison rolls on every landed main-hand attack, a finisher too.
  const MAIN = { mainHand: "instant", offHand: null };
  const OFF = { mainHand: null, offHand: "instant" };
  const BOTH = { mainHand: "instant", offHand: "instant" };

  // The skill on the rogue by ability id (the keys are camelCase).
  const skill = (rogue, id) =>
    Object.values(rogue.abilities).find((ability) => ability.id === id);

  function cast(id, poisons, seed) {
    const { rogue, sim } = harness({ poisons, seed });
    rogue.resources.comboPoints.gain(5);
    const result = skill(rogue, id).cast(rogue, sim);
    return { rogue, sim, result };
  }

  const rolls = (sim, hand = "mainHand") =>
    sim.procs.stats[`instant-poison.${hand}`].rolls;

  for (const id of [
    "sinister-strike",
    "backstab",
    "ambush",
    "ghostly-strike",
    "hemorrhage",
    "eviscerate",
  ]) {
    it(`${id} is a direct main-hand attack: a landed one rolls the poison, once`, () => {
      let landed = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const { sim, result } = cast(id, MAIN, seed);
        landed += result.landed ? 1 : 0;
        assert.equal(rolls(sim), result.landed ? 1 : 0, `${id} seed ${seed}`);
      }
      assert.ok(landed > 0, `${id} landed in no seed`);
    });
  }

  it("a finisher rolls the poison as a strike does (wowsims; pinned deliberately)", () => {
    // Eviscerate is a finisher and not a weapon strike, and still rolls.
    let rolled = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sim, result } = cast("eviscerate", MAIN, seed);
      assert.equal(rolls(sim), result.landed ? 1 : 0);
      rolled += sim.abilityStats["instant-poison"] === undefined ? 0 : 1;
    }
    assert.ok(rolled > 0, "no Eviscerate fired the poison in 40 seeds");
  });

  it("an attack rolls the main hand's poison and not the off hand's", () => {
    for (const id of ["sinister-strike", "eviscerate"]) {
      for (let seed = 1; seed <= 6; seed++) {
        const { sim } = cast(id, OFF, seed);
        assert.equal(sim.procs.stats["instant-poison.offHand"].rolls, 0, id);
      }
      const { sim } = cast(id, BOTH, 3);
      assert.equal(sim.procs.stats["instant-poison.offHand"].rolls, 0, id);
    }
  });

  it("white swings roll the poison of their own hand", () => {
    const { sim } = harness({ poisons: BOTH, seed: 2 });
    for (let i = 0; i < 10; i++) {
      swing(sim, "mainHand");
    }
    assert.ok(rolls(sim, "mainHand") > 0);
    assert.equal(rolls(sim, "offHand"), 0);
    for (let i = 0; i < 10; i++) {
      swing(sim, "offHand");
    }
    assert.ok(rolls(sim, "offHand") > 0);
  });

  for (const id of [
    "rupture",
    "slice-and-dice",
    "blade-flurry",
    "adrenaline-rush",
    "premeditation",
    "cold-blood",
  ]) {
    it(`${id} is not a direct attack: it rolls no poison and draws nothing for one`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const poisoned = cast(id, BOTH, seed);
        const bare = cast(id, {}, seed);
        assert.equal(rolls(poisoned.sim, "mainHand"), 0, `${id} ${seed}`);
        assert.equal(rolls(poisoned.sim, "offHand"), 0, `${id} ${seed}`);
        assert.equal(poisoned.sim.rng(), bare.sim.rng(), `${id} ${seed}`);
      }
    });
  }

  it("DoT ticks and poison damage roll no poison", () => {
    const { rogue, sim } = harness({ poisons: BOTH, seed: 5 });
    rogue.resources.comboPoints.gain(5);
    skill(rogue, "rupture").cast(rogue, sim);
    for (let i = 0; i < 10; i++) {
      sim.step(2);
    }
    assert.equal(rolls(sim, "mainHand"), 0);
    assert.equal(rolls(sim, "offHand"), 0);
  });
});

describe("Deadly Poison", () => {
  it("applies on a proc and a spell hit with no damage of its own, then ticks 3 s apart", () => {
    const { sim } = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, NO_CRIT, NO_CRIT, NO_CRIT, NO_CRIT],
    });
    swing(sim);
    const dot = sim.activeDots["deadly-poison"];
    assert.equal(dot.tickDamage, 23);
    assert.equal(dot.tickInterval, 3);
    assert.equal(dot.duration, 12);
    assert.equal(sim.activeDebuffs["deadly-poison"].stacks, 1);
    assert.equal(sim.combatLog[0].name, "Deadly Poison");
    assert.equal(sim.combatLog[0].damage, 0);
    assert.equal(sim.damageDone, sim.abilityStats["main-hand"].damage);
    const times = [];
    for (let at = 0; at < 14; at++) {
      const before = sim.abilityStats["deadly-poison"].ticks;
      sim.step(1);
      if (sim.abilityStats["deadly-poison"].ticks > before) {
        times.push(at + 1);
      }
    }
    assert.deepEqual(times, [3, 6, 9, 12]);
    const record = sim.abilityStats["deadly-poison"];
    assert.equal(record.ticks, 4);
    assert.equal(record.damage, 92, "one stack deals the export's 92");
    assert.equal(record.casts, 1);
    assert.equal(sim.activeDots["deadly-poison"], undefined);
    assert.equal(sim.activeDebuffs["deadly-poison"], undefined);
  });

  it("stacks to 5 and no further, each stack adding a tick of its own size", () => {
    const rolls = [];
    for (let index = 0; index < 7; index++) {
      rolls.push(HIT, 0.1, 0.5);
    }
    const { sim, tape } = harness({ poisons: DEADLY_MAIN, rolls });
    const seen = [];
    for (let index = 0; index < 7; index++) {
      swing(sim);
      seen.push([
        sim.activeDebuffs["deadly-poison"].stacks,
        sim.activeDots["deadly-poison"].tickDamage,
      ]);
    }
    assert.equal(tape.left(), 0);
    assert.deepEqual(seen, [
      [1, 23],
      [2, 46],
      [3, 69],
      [4, 92],
      [5, 115],
      [5, 115],
      [5, 115],
    ]);
    assert.equal(sim.abilityStats["deadly-poison"].casts, 7);
  });

  it("refreshes the duration and keeps the tick clock", () => {
    const { sim } = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, HIT, 0.1, 0.5, NO_CRIT, NO_CRIT],
    });
    swing(sim);
    sim.step(1);
    assert.equal(sim.activeDots["deadly-poison"].duration, 11);
    swing(sim);
    const dot = sim.activeDots["deadly-poison"];
    assert.equal(dot.duration, 12);
    assert.equal(sim.activeDebuffs["deadly-poison"].duration, 12);
    assert.equal(dot.timeUntilNextTick, 2, "the next tick is still at 3 s");
    assert.equal(dot.tickDamage, 46);
    sim.step(2);
    assert.equal(sim.abilityStats["deadly-poison"].ticks, 1);
    assert.equal(sim.abilityStats["deadly-poison"].damage, 46);
    sim.step(3);
    assert.equal(sim.abilityStats["deadly-poison"].ticks, 2);
    assert.equal(sim.activeDots["deadly-poison"].duration, 7);
  });

  it("can resist: no stack, no DoT, and a resist in the breakdown", () => {
    const { sim, tape } = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.1],
    });
    swing(sim);
    assert.equal(tape.left(), 0);
    assert.equal(sim.activeDots["deadly-poison"], undefined);
    assert.equal(sim.activeDebuffs["deadly-poison"], undefined);
    const record = sim.abilityBreakdown()["Deadly Poison"];
    assert.equal(record.misses, 1);
    assert.equal(record.casts, 1);
    assert.equal(sim.combatLog[0].status, "Resist");
  });

  it("is nature: its ticks skip armor, and it ticks at a tick crit of 2x", () => {
    const hit = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, NO_CRIT],
    });
    swing(hit.sim);
    hit.sim.step(3);
    assert.equal(hit.sim.abilityStats["deadly-poison"].damage, 23);
    // A tick crit: the crit roll is below the chance, and the damage is 2x.
    const crit = harness({
      poisons: DEADLY_MAIN,
      rolls: [HIT, 0.1, 0.5, 0],
    });
    crit.rogue.critChance = 0.5;
    swing(crit.sim);
    crit.sim.step(3);
    assert.equal(crit.sim.abilityStats["deadly-poison"].damage, 23 * 2);
    assert.equal(crit.sim.abilityStats["deadly-poison"].tickCrits, 1);
  });

  it("stacks from both hands on one DoT", () => {
    const { sim } = harness({
      poisons: { mainHand: "deadly", offHand: "deadly" },
      rolls: [HIT, 0.1, 0.5, HIT, 0.1, 0.5],
    });
    swing(sim);
    swing(sim, "offHand");
    assert.equal(sim.activeDebuffs["deadly-poison"].stacks, 2);
    assert.equal(sim.activeDots["deadly-poison"].tickDamage, 46);
  });
});

describe("modifiers and tags on the poisons", () => {
  const poisonDamage = (value) => ({
    kind: "damage",
    value,
    scope: { tags: ["poison"] },
  });

  it("scales Instant Poison's hit and each Deadly Poison tick by a poison modifier", () => {
    const instant = harness({
      poisons: INSTANT_MAIN,
      modifiers: [poisonDamage(1)],
      rolls: [HIT, 0.1, 0.5, 0, NO_CRIT],
    });
    swing(instant.sim);
    assert.equal(instant.sim.abilityStats["instant-poison"].damage, 152);
    const deadly = harness({
      poisons: DEADLY_MAIN,
      modifiers: [poisonDamage(1)],
      rolls: [HIT, 0.1, 0.5, HIT, 0.1, 0.5],
    });
    swing(deadly.sim);
    assert.equal(deadly.sim.activeDots["deadly-poison"].tickDamage, 46);
    swing(deadly.sim);
    assert.equal(deadly.sim.activeDots["deadly-poison"].tickDamage, 92);
  });

  it("is not a bleed, a white hit or a finisher: those modifiers leave it alone", () => {
    for (const tag of ["bleed", "white", "finisher"]) {
      const { sim } = harness({
        poisons: DEADLY_MAIN,
        modifiers: [{ kind: "damage", value: 1, scope: { tags: [tag] } }],
        rolls: [HIT, 0.1, 0.5, NO_CRIT],
      });
      // a white swing scaled by the white modifier is not the poison's tick
      swing(sim);
      assert.equal(sim.activeDots["deadly-poison"].tickDamage, 23, tag);
    }
  });

  it("ticks as a poison, not a white, yellow or bleed attack: only a poison crit modifier crits it", () => {
    const status = (tag) => {
      const { sim } = harness({
        poisons: DEADLY_MAIN,
        modifiers: [{ kind: "critChance", value: 1, scope: { tags: [tag] } }],
        rolls: [HIT, 0.1, 0.5, 0.5],
      });
      swing(sim);
      sim.step(3);
      return sim.combatLog[0].status;
    };
    assert.equal(status("poison"), "Crit");
    assert.equal(status("yellow"), "Hit");
    assert.equal(status("white"), "Hit");
    assert.equal(status("bleed"), "Hit");
  });

  it("an applyDot with no aura is one stack, however often it lands", () => {
    const own = defineProc({
      id: "test-dot",
      trigger: "onHit",
      chance: { mode: "flat", value: 1 },
      actions: [
        {
          type: "applyDot",
          id: "test-dot",
          name: "Test Dot",
          tickDamage: 10,
          interval: 2,
          duration: 2,
        },
      ],
    });
    const { sim, tape } = harness({
      procs: [own],
      rolls: [HIT, 0.5, HIT, 0.5, NO_CRIT],
    });
    swing(sim);
    swing(sim);
    assert.equal(tape.left(), 1);
    assert.equal(sim.activeDots["test-dot"].tickDamage, 10);
    sim.step(2);
    // Physical, so it took armor: one stack of 10 is under 10, two would not be.
    const damage = sim.abilityStats["test-dot"].damage;
    assert.ok(damage > 0 && damage < 10, `${damage}`);
    assert.equal(sim.activeDots["test-dot"], undefined);
  });
});

describe("over many runs", () => {
  const SEEDS = 40;
  const DURATION = 300;

  function total(poisons, pick) {
    let sum = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const fight = createFight(seed, { poisons });
      fight.simulation.run(DURATION);
      sum += pick(fight.simulation);
    }
    return sum;
  }

  // Four standard errors of a rate over n draws. The draws are independent
  // and the seeds fixed, so this is a bound the test passes with room, and a
  // wrong chance (say 0.25 for 0.2) fails.
  const tolerance = (rate, n) => 4 * Math.sqrt((rate * (1 - rate)) / n);

  for (const [key, id, chance] of [
    ["instant", "instant-poison.mainHand", 0.2],
    ["deadly", "deadly-poison.mainHand", 0.3],
  ]) {
    it(`${key} procs at ${chance} of the landed hits of its hand`, () => {
      let rolls = 0;
      let fires = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const fight = createFight(seed, {
          poisons: { mainHand: key, offHand: null },
        });
        fight.simulation.run(DURATION);
        const stats = fight.simulation.procs.stats[id];
        rolls += stats.rolls;
        fires += stats.fires;
      }
      assert.ok(rolls > 5000, `${rolls} rolls`);
      assert.ok(
        Math.abs(fires / rolls - chance) < tolerance(chance, rolls),
        `${fires} of ${rolls} is not ${chance}`,
      );
    });
  }

  it("resists at the spell table's 17%", () => {
    const applications = total(
      DEADLY_MAIN,
      (sim) => sim.abilityStats["deadly-poison"].casts,
    );
    const misses = total(
      DEADLY_MAIN,
      (sim) => sim.abilityStats["deadly-poison"].misses,
    );
    const rate = k("spell.missTarget").chance;
    assert.ok(applications > 1000);
    assert.ok(
      Math.abs(misses / applications - rate) < tolerance(rate, applications),
    );
  });
});

describe("a build with no poisons", () => {
  it("has no proc and takes the same draws as a fight without the field", () => {
    const plain = createFight(21);
    const none = createFight(21, {
      poisons: { mainHand: null, offHand: null },
    });
    plain.simulation.run(60);
    none.simulation.run(60);
    assert.equal(none.simulation.procs.stats.length, undefined);
    assert.deepEqual(Object.keys(none.simulation.procs.stats), []);
    assert.equal(none.simulation.rng(), plain.simulation.rng());
    assert.equal(none.simulation.damageDone, plain.simulation.damageDone);
  });

  it("gives the result the same shape with poisons or without, and no proc field", () => {
    const plain = runFight({ seed: 5, duration: 60 });
    const poisoned = runFight({
      seed: 5,
      duration: 60,
      config: { poisons: { mainHand: "instant", offHand: "deadly" } },
    });
    assert.deepEqual(Object.keys(poisoned), Object.keys(plain));
    assert.deepEqual(
      Object.keys(poisoned.abilities["Deadly Poison"]),
      Object.keys(plain.abilities["Main-hand"]),
    );
    assert.equal("procs" in poisoned, false);
    assert.equal("procStats" in poisoned, false);
    assert.ok(poisoned.totalDamage > plain.totalDamage);
  });
});
