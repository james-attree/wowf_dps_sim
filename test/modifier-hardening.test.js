import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { AURAS, defineAura } from "../js/auras.js";
import { resolveAttack } from "../js/attack-resolver.js";
import { createFight, runFight } from "../js/fight.js";
import {
  MODIFIER_KINDS,
  ModifierPipeline,
  expandRank,
} from "../js/modifiers.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

// Tests added after the QA of the modifier pipeline (PR #115). Each one pins
// something the first tests left open: a mutated copy of the engine that
// drops the hook, reads it without the context, keys it by display name or
// swaps two values must fail one of them. They go through the engine's own
// seams (resolveAttack, resolveDotAttack, the tick loop, Skill.cast, a weapon
// swing) and not through pipeline.resolve alone.

const TICKS = Math.floor(12 / k("rupture.tickInterval"));
const NEAR = 1e-9;

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

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= NEAR * Math.max(1, Math.abs(expected)),
    `${message ?? "value"}: ${actual} is not ${expected}`,
  );
}

// An attack source whose display name is never its id, so a lookup by name
// finds nothing.
function source(id, extra = {}) {
  return { id, name: `Display name of ${id}`, ...extra };
}

function build(modifiers, config, { rotate = false } = {}) {
  const rogue = new Rogue(config, { modifiers });
  if (!rotate) {
    rogue.rotation = () => {};
  }
  rogue.critChance = 0;
  rogue.bonusHitChance = 0;
  const sim = new Simulation(rogue, { rng: testRng });
  return { rogue, sim };
}

// The share of a hit armor lets through. Mirrors armor.mitigation, written
// out again so the tests do not call the engine's own function.
function throughArmor(armor) {
  const { constant, perLevel, cap } = k("armor.mitigation");
  const share = Math.min(
    cap,
    Math.max(0, armor) /
      (Math.max(0, armor) + constant + perLevel * k("character.level")),
  );
  return 1 - share;
}

// Run one tick of a DoT the test sets up by hand, and return the ability's
// fight totals.
function tickOnce(sim, id, { bleed, damage = 100 } = {}) {
  const interval = k("rupture.tickInterval");
  sim.activeDots[id] = {
    name: `Display name of ${id}`,
    duration: interval,
    tickInterval: interval,
    timeUntilNextTick: interval,
    tickDamage: damage,
    icon: null,
    bleed,
  };
  sim.step(interval);
  return sim.abilityStats[id];
}

describe("a DoT's damage modifier is applied when it is cast", () => {
  afterEach(() => mock.restoreAll());

  it("scales the whole DoT for the ability it names, found by id", () => {
    setRoll(0.99);
    const { sim } = build([
      { kind: "damage", value: 0.5, scope: { abilities: ["rupture"] } },
    ]);
    sim.resolveDotAttack(source("rupture"), "skill", 1000, 12, true);
    sim.resolveDotAttack(source("garrote"), "skill", 1000, 12, true);
    assert.equal(sim.activeDots.rupture.tickDamage, 1500 / TICKS);
    assert.equal(sim.activeDots.garrote.tickDamage, 1000 / TICKS);
  });

  it("keeps the snapshot: an aura that comes up later does not change the ticks", () => {
    setRoll(0.99);
    const { sim } = build();
    sim.resolveDotAttack(source("rupture"), "skill", 1000, 12, true);
    sim.applyAura(
      defineAura({
        id: "late-buff",
        name: "Late buff",
        duration: 30,
        modifiers: [{ kind: "damage", value: 1 }],
      }),
    );
    const record = tickOnce(sim, "rupture", {
      bleed: true,
      damage: sim.activeDots.rupture.tickDamage,
    });
    assert.equal(record.damage, 1000 / TICKS);
  });
});

describe("the hit table reads its modifiers with the attack's context", () => {
  afterEach(() => mock.restoreAll());

  // Rolls are 0..100. A skill at hit 0 misses on [0, 8) and is dodged on
  // [8, 14.5). +3% hit moves the miss to [0, 5) and the dodge to [5, 11.5),
  // so a roll of 13 is a dodge without it and a hit with it.
  it("gives a scoped hitChance to the direct hit it names and no other", () => {
    const { sim } = build([
      { kind: "hitChance", value: 0.03, scope: { abilities: ["backstab"] } },
    ]);
    setRoll(0.13);
    assert.equal(
      sim.resolveAttack(source("backstab"), "skill", 100).outcome,
      "hit",
    );
    assert.equal(
      sim.resolveAttack(source("sinister-strike"), "skill", 100).outcome,
      "dodge",
    );
  });

  it("gives a scoped hitChance to the DoT it names and no other", () => {
    const { sim } = build([
      { kind: "hitChance", value: 0.03, scope: { abilities: ["rupture"] } },
    ]);
    setRoll(0.13);
    assert.equal(
      sim.resolveDotAttack(source("rupture"), "skill", 100, 12, true).outcome,
      "hit",
    );
    assert.equal(
      sim.resolveDotAttack(source("garrote"), "skill", 100, 12, true).outcome,
      "dodge",
    );
  });

  it("takes dodgeReduction when a DoT is applied, as it does for a direct hit", () => {
    const { sim } = build([{ kind: "dodgeReduction", value: 0.02 }]);
    setRoll(0.13);
    assert.equal(
      sim.resolveDotAttack(source("rupture"), "skill", 100, 12, true).outcome,
      "hit",
    );
    const plain = build().sim;
    assert.equal(
      plain.resolveDotAttack(source("rupture"), "skill", 100, 12, true).outcome,
      "dodge",
    );
  });
});

describe("a DoT tick reads crit chance and crit damage with the DoT's context", () => {
  afterEach(() => mock.restoreAll());

  it("crits only the scoped DoT", () => {
    setRoll(0.5);
    const { sim } = build([
      { kind: "critChance", value: 1, scope: { abilities: ["rupture"] } },
    ]);
    const rupture = tickOnce(sim, "rupture", { bleed: true });
    const garrote = tickOnce(sim, "garrote", { bleed: true });
    assert.equal(rupture.tickCrits, 1);
    assert.equal(rupture.damage, 100 * k("dot.critMultiplier"));
    assert.equal(garrote.tickCrits, 0);
    assert.equal(garrote.damage, 100);
  });

  it("scales a tick crit's bonus by the scoped critDamage modifier", () => {
    setRoll(0.5);
    const { sim } = build([
      { kind: "critChance", value: 1 },
      { kind: "critDamage", value: 0.5, scope: { abilities: ["rupture"] } },
    ]);
    const rupture = tickOnce(sim, "rupture", { bleed: true });
    const garrote = tickOnce(sim, "garrote", { bleed: true });
    const base = k("dot.critMultiplier");
    close(rupture.damage, 100 * (1 + (base - 1) * 1.5), "scoped DoT");
    close(garrote.damage, 100 * base, "other DoT");
  });
});

describe("armorIgnore is read with the context and taken off the armor that is left", () => {
  afterEach(() => mock.restoreAll());

  const IGNORE = [
    { kind: "armorIgnore", value: 0.1, scope: { abilities: ["backstab"] } },
  ];

  it("applies to the direct hit it names and no other", () => {
    setRoll(0.99);
    const { sim } = build(IGNORE);
    const named = sim.resolveAttack(source("backstab"), "skill", 1000);
    const other = sim.resolveAttack(source("sinister-strike"), "skill", 1000);
    close(named.damage, 1000 * throughArmor(k("target.armor") * 0.9), "named");
    close(other.damage, 1000 * throughArmor(k("target.armor")), "other");
  });

  it("takes the share off the armor left after an armorReduction aura", () => {
    setRoll(0.99);
    const { sim } = build(IGNORE);
    const stacks = 3;
    sim.applyAura(AURAS.exposeArmor, { stacks });
    const left =
      k("target.armor") - stacks * k("exposeArmor").armorPerComboPoint;
    assert.ok(left > 0);
    const hit = sim.resolveAttack(source("backstab"), "skill", 1000);
    close(hit.damage, 1000 * throughArmor(left * 0.9), "10% of what is left");
  });

  it("cannot ignore more than all of it", () => {
    setRoll(0.99);
    const { sim } = build([{ kind: "armorIgnore", value: 1.5 }]);
    assert.equal(sim.armorMultiplier({ ability: "backstab" }), 1);
  });

  it("applies to a DoT tick that armor reaches, for the DoT it names", () => {
    setRoll(0.5);
    // A tick skips armor only while it is a bleed. With no bleed spells and
    // no bleed flag, Rupture's tick takes armor like a physical hit.
    withConstant("bleed.spells", [], () => {
      const { sim } = build([
        {
          kind: "armorIgnore",
          value: 0.2,
          scope: { abilities: ["rupture"] },
        },
      ]);
      const named = tickOnce(sim, "rupture", { bleed: false });
      close(named.damage, 100 * throughArmor(k("target.armor") * 0.8));
      const other = tickOnce(sim, "garrote", { bleed: false });
      close(other.damage, 100 * throughArmor(k("target.armor")));
    });
  });
});

describe("a skill's miss refund uses the cost it paid", () => {
  afterEach(() => mock.restoreAll());

  it("refunds the share of the modified cost, not the base cost", () => {
    const { rogue, sim } = build([
      {
        kind: "energyCost",
        value: -3,
        scope: { abilities: ["sinister-strike"] },
      },
    ]);
    const skill = rogue.abilities.sinisterStrike;
    rogue.energy = 100;
    sim.gcd = 0;
    setRoll(0.01);
    const result = skill.cast(rogue, sim);
    assert.equal(result.outcome, "miss");
    const paid = skill.energyCost - 3;
    close(rogue.energy, 100 - paid * (1 - k("skill.missEnergyRefund")));
  });
});

describe("a weapon swing names its hand", () => {
  afterEach(() => mock.restoreAll());

  it("treats a skill, which names no hand, as a main-hand attack", () => {
    setRoll(0.99);
    const { sim } = build([
      { kind: "damage", value: 1, scope: { hands: ["mainHand"] } },
      { kind: "critDamage", value: 1, scope: { hands: ["offHand"] } },
    ]);
    const hit = sim.resolveAttack(source("backstab"), "skill", 1000);
    close(hit.damage, 2000 * throughArmor(k("target.armor")));
    const off = sim.resolveAttack(
      source("backstab", { hand: "offHand" }),
      "skill",
      1000,
    );
    close(off.damage, 1000 * throughArmor(k("target.armor")));
  });

  it("tags the main hand and the off hand as what they are", () => {
    const { rogue } = build();
    assert.equal(rogue.weapons.mainHand.attack.hand, "mainHand");
    assert.equal(rogue.weapons.offHand.attack.hand, "offHand");
  });

  it("gives an off-hand modifier to the off-hand's swings only", () => {
    const damageOf = (modifiers) => {
      setRoll(0.99);
      const { sim } = build(modifiers, undefined, { rotate: true });
      sim.run(3);
      return {
        main: sim.abilityStats["main-hand"],
        off: sim.abilityStats["off-hand"],
      };
    };
    const plain = damageOf();
    const buffed = damageOf([
      { kind: "damage", value: 1, scope: { hands: ["offHand"] } },
    ]);
    assert.ok(plain.main.casts > 0 && plain.off.casts > 0);
    assert.equal(buffed.main.damage, plain.main.damage);
    assert.equal(buffed.off.casts, plain.off.casts);
    assert.ok(buffed.off.damage > plain.off.damage * 1.9);
  });

  it("scopes by the weapon in the hand that swings", () => {
    const config = {
      weapons: { mainHand: { type: "dagger" }, offHand: { type: "mace" } },
    };
    const damageOf = (types) => {
      setRoll(0.99);
      const { sim } = build(
        [{ kind: "damage", value: 1, scope: { weaponTypes: types } }],
        config,
        { rotate: true },
      );
      sim.run(3);
      return [
        sim.abilityStats["main-hand"].damage,
        sim.abilityStats["off-hand"].damage,
      ];
    };
    const [plainMain, plainOff] = (() => {
      setRoll(0.99);
      const { sim } = build(undefined, config, { rotate: true });
      sim.run(3);
      return [
        sim.abilityStats["main-hand"].damage,
        sim.abilityStats["off-hand"].damage,
      ];
    })();
    const [daggerMain, daggerOff] = damageOf(["dagger"]);
    assert.ok(daggerMain > plainMain * 1.9);
    assert.equal(daggerOff, plainOff);
    const [maceMain, maceOff] = damageOf(["mace"]);
    assert.equal(maceMain, plainMain);
    assert.ok(maceOff > plainOff * 1.9);
  });
});

describe("aura modifiers with more than one stack", () => {
  const define = (spec) =>
    defineAura({
      id: "stacking-aura",
      name: "Stacking aura",
      duration: 10,
      maxStacks: 5,
      stackRule: "add",
      ...spec,
    });

  it("multiplies a mult modifier once per stack", () => {
    const { sim } = build();
    sim.applyAura(
      define({ modifiers: [{ kind: "damage", op: "mult", value: 1.1 }] }),
      { stacks: 3 },
    );
    close(
      sim.modifiers.resolve("damage", 100, { ability: "x" }),
      100 * 1.1 ** 3,
    );
  });

  it("counts an add modifier once per stack", () => {
    const { sim } = build();
    sim.applyAura(define({ modifiers: [{ kind: "damage", value: 0.1 }] }), {
      stacks: 3,
    });
    close(sim.modifiers.resolve("damage", 100, { ability: "x" }), 130);
  });

  for (const stacking of ["multiplicative", "additive"]) {
    it(`stacks haste once per stack, ${stacking}`, () => {
      withConstant("haste.stacking", stacking, () => {
        const { sim } = build();
        sim.applyAura(define({ modifiers: [{ kind: "haste", value: 0.1 }] }), {
          stacks: 3,
        });
        const expected = stacking === "additive" ? 1 + 0.3 : 1.1 ** 3;
        close(sim.modifiers.resolve("haste", 1), expected);
      });
    });
  }

  it("applies the haste of an aura with stacks to the swing speed", () => {
    const { sim } = build();
    sim.applyAura(define({ effects: { haste: 0.1 } }), { stacks: 2 });
    const expected = withConstant("haste.stacking", "multiplicative", () =>
      sim.modifiers.resolve("haste", 1),
    );
    close(expected, 1.1 ** 2);
  });

  it("does not index a modifier that changes nothing", () => {
    const { sim } = build();
    sim.applyAura(
      define({
        modifiers: [
          { kind: "damage", value: 0 },
          { kind: "damage", op: "mult", value: 1 },
        ],
      }),
    );
    assert.deepEqual(sim.modifiers.explain("damage", { ability: "x" }), []);
  });

  it("puts the effects' shorthand modifiers before the explicit ones", () => {
    const aura = define({
      effects: { haste: 0.1 },
      modifiers: [{ kind: "haste", value: 0.2 }],
    });
    assert.deepEqual(
      aura.modifiers.map((modifier) => modifier.value),
      [0.1, 0.2],
    );
  });

  it("splits a step's energy where each timed aura runs out", () => {
    const boost = (id, value) =>
      defineAura({
        id,
        name: id,
        duration: 1,
        modifiers: [{ kind: "energyRegen", op: "mult", value }],
      });
    const { rogue, sim } = build();
    rogue.energy = 0;
    sim.applyAura(boost("short-boost", 2), { duration: 0.1 });
    sim.applyAura(boost("long-boost", 3), { duration: 0.2 });
    sim.regenerateEnergy(0.2);
    const base = k("energy.regenPerSecond");
    close(rogue.energy, base * (6 * 0.1 + 3 * 0.1));
  });
});

describe("a modifier a static pipeline holds does not expire", () => {
  it("has an infinite duration", () => {
    const stat = new ModifierPipeline([{ kind: "damage", value: 0.1 }]);
    assert.deepEqual(
      stat.contributions("damage", { ability: "x" }).map((c) => c.duration),
      [Number.POSITIVE_INFINITY],
    );
  });
});

describe("a hands scope fails closed", () => {
  it("does not match a context that names no hand", () => {
    const stat = new ModifierPipeline([
      { kind: "damage", value: 0.25, scope: { hands: ["offHand"] } },
    ]);
    assert.equal(stat.resolve("damage", 100, { ability: "x" }), 100);
    assert.equal(stat.resolve("damage", 100, { hand: undefined }), 100);
    assert.equal(stat.resolve("damage", 100, { hand: null }), 100);
    assert.equal(stat.resolve("damage", 100), 100);
    assert.equal(stat.resolve("damage", 100, { hand: "offHand" }), 125);
  });
});

describe("modifiers.stacking", () => {
  // The three forms, written out from their definition and not from the
  // engine: flat is (base + adds) x mults, percent is base x (1 + adds) x
  // mults, and bonus is the percent form on (base - 1), plus 1.
  const FORM = {
    flat: (base, add, mult) => (base + add) * mult,
    percent: (base, add, mult) => base * (1 + add) * mult,
    bonus: (base, add, mult) => 1 + (base - 1) * (1 + add) * mult,
  };

  for (const [kind, form] of Object.entries(k("modifiers.stacking"))) {
    if (form === "haste") {
      continue;
    }
    it(`${kind} stacks as ${form}`, () => {
      const stat = new ModifierPipeline([
        { kind, value: 0.25 },
        { kind, op: "mult", value: 2 },
      ]);
      const base = form === "bonus" ? 2 : 10;
      close(
        stat.resolve(kind, base, { ability: "x", hand: "mainHand" }),
        FORM[form](base, 0.25, 2),
      );
    });
  }

  it("takes a haste modifier once per source, by haste.stacking", () => {
    const stat = new ModifierPipeline([
      { kind: "haste", value: 0.1 },
      { kind: "haste", value: 0.2 },
    ]);
    const expected = k("haste.stacking") === "additive" ? 1.3 : 1.1 * 1.2;
    close(stat.resolve("haste", 1), expected);
  });

  it("is checked when the module loads: a missing, extra or unknown form is a RangeError", async () => {
    const table = k("modifiers.stacking");
    const bad = [
      Object.fromEntries(Object.entries(table).slice(1)),
      { ...table, unheardOf: "flat" },
      { ...table, damage: "sideways" },
    ];
    let count = 0;
    for (const value of bad) {
      count += 1;
      const row = CONSTANTS["modifiers.stacking"];
      const saved = row.value;
      row.value = value;
      try {
        await assert.rejects(
          import(`../js/modifiers.js?stacking-${count}`),
          RangeError,
        );
      } finally {
        row.value = saved;
      }
    }
  });

  it("is a guess at the game, so it is an assumption on the retune list", () => {
    const row = CONSTANTS["modifiers.stacking"];
    assert.equal(row.source, "assumption");
    assert.equal(row.retune, true);
    assert.match(row.ref, /^Developer, \d+ Oct 2026, issue #96: /);
    assert.deepEqual(
      Object.keys(row.value).sort(),
      Object.keys(MODIFIER_KINDS).sort(),
    );
  });
});

describe("the constants that cite the dev, not James", () => {
  const DEV = [
    "attack.rollScale",
    "log.maxEvents",
    "sim.msPerSecond",
    "sim.tickEpsilon",
    "sim.fixedStep",
    "sim.maxFrameTime",
    "config.minWeaponSpeed",
  ];
  for (const id of DEV) {
    it(`${id} is signed by the dev`, () => {
      assert.match(CONSTANTS[id].ref, /^Developer, \d+ Oct 2026/);
    });
  }

  it("leaves the seed's ref as the issue James wrote", () => {
    assert.match(CONSTANTS["rng.defaultSeed"].ref, /^James, /);
  });
});

describe("a rank table is checked whole", () => {
  const table = [
    { kind: "damage", op: "add", values: [0.1, 0.2] },
    { kind: "critChance", op: "add", values: [0.01, 0.02] },
  ];

  it("rejects a bad value at a rank the build does not spend, even at rank 0", () => {
    for (const rank of [0, 1]) {
      assert.throws(
        () => expandRank([{ ...table[0], values: [0.1, "x"] }], rank, "t"),
        /finite number/,
      );
      assert.throws(
        () =>
          expandRank(
            [{ ...table[0], values: [0.1], scope: { abilities: ["nope"] } }],
            rank,
            "t",
          ),
        /scope/,
      );
      assert.throws(
        () => expandRank([{ kind: "nope", values: [1] }], rank, "t"),
        /unknown kind/,
      );
    }
  });

  it("rejects a null, sparse or non-object entry with a RangeError", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [table[0], , table[1]];
    for (const entries of [[null], [undefined], sparse, ["x"], [[]], [5]]) {
      for (const rank of [0, 1]) {
        assert.throws(() => expandRank(entries, rank, "t"), RangeError);
      }
    }
  });

  it("still gives nothing at rank 0 and the rank's value above it", () => {
    assert.deepEqual(expandRank(table, 0), []);
    assert.deepEqual(
      expandRank(table, 2).map((modifier) => modifier.value),
      [0.2, 0.02],
    );
  });
});

describe("a pipeline takes one fight", () => {
  it("is not taken over by a second Simulation on the same rogue", () => {
    const rogue = new Rogue();
    rogue.rotation = () => {};
    const first = new Simulation(rogue, { seed: 1 });
    assert.throws(
      () => new Simulation(rogue, { seed: 2 }),
      /already belongs to another Simulation/,
    );
    assert.equal(
      rogue.rng,
      first.rng,
      "the failed attempt left the rogue alone",
    );
  });

  it("lets the same simulation attach again, and a new rogue take a new fight", () => {
    const rogue = new Rogue();
    const sim = new Simulation(rogue, { seed: 1 });
    assert.doesNotThrow(() => sim.modifiers.attach(sim));
    assert.doesNotThrow(() => new Simulation(new Rogue(), { seed: 1 }));
  });

  it("rejects a pipeline that is not a list", () => {
    for (const value of ["x", {}, 5, new Set()]) {
      assert.throws(
        () => new ModifierPipeline(value),
        /modifiers must be an array/,
      );
    }
  });
});

describe("options that are not an object are refused", () => {
  it("refuses an array or a number for the Rogue's options", () => {
    for (const options of [[], [1], 5, "x", true]) {
      assert.throws(() => new Rogue(undefined, options), TypeError);
      assert.throws(() => createFight(1, undefined, options), TypeError);
    }
  });

  it("refuses an array for runFight, even one that carries a seed and a duration", () => {
    const array = Object.assign([], { seed: 1, duration: 5 });
    assert.throws(() => runFight(array), RangeError);
    assert.throws(() => runFight([]), RangeError);
    assert.doesNotThrow(() => runFight({ seed: 1, duration: 5 }));
  });
});

describe("the attack resolver's reductions and multiplier", () => {
  const skill = {
    attackType: "skill",
    baseDamage: 100,
    bonusHitChance: 1,
    critChance: 0.05,
  };

  it("never takes the dodge chance below 0, so the crit band does not move", () => {
    // Dodge is 0 and the crit band is [0, 5) however large the reduction.
    assert.equal(
      resolveAttack({ ...skill, dodgeReduction: 1, roll: 1 }).outcome,
      "crit",
    );
    assert.equal(
      resolveAttack({ ...skill, dodgeReduction: 1, roll: 6 }).outcome,
      "hit",
    );
  });

  it("does not turn a parry reduction into a parry chance", () => {
    for (const roll of [0, 1, 50]) {
      assert.notEqual(
        resolveAttack({ ...skill, parryReduction: 0.5, roll }).outcome,
        "parry",
      );
    }
  });

  it("refuses a negative or non-finite crit multiplier", () => {
    for (const critMultiplier of [-1, NaN, Infinity]) {
      assert.throws(
        () => resolveAttack({ ...skill, critMultiplier, roll: 10 }),
        RangeError,
      );
    }
    assert.equal(
      resolveAttack({ ...skill, critMultiplier: 3, roll: 10 }).damage,
      300,
    );
  });
});
