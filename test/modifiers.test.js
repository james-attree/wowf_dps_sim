import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { AURAS, defineAura } from "../js/auras.js";
import { createFight } from "../js/fight.js";
import {
  MODIFIER_KINDS,
  ModifierPipeline,
  combine,
  defineModifier,
  defineScope,
  expandRank,
  isNeutral,
} from "../js/modifiers.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

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

function pipeline(...specs) {
  return new ModifierPipeline(specs);
}

function fresh(modifiers) {
  const rogue = new Rogue(undefined, { modifiers });
  rogue.rotation = () => {};
  rogue.critChance = 0;
  rogue.bonusHitChance = 0;
  const sim = new Simulation(rogue, { rng: testRng });
  return { rogue, sim };
}

function attack(sim, id, roll, damage = 1000, hand) {
  setRoll(roll);
  const source = { id, name: id };
  if (hand !== undefined) {
    source.hand = hand;
  }
  return sim.resolveAttack(
    source,
    hand === undefined ? "skill" : "weapon",
    damage,
  );
}

describe("defineModifier", () => {
  afterEach(() => mock.restoreAll());

  it("fills in the defaults and freezes the result", () => {
    const modifier = defineModifier({ kind: "critChance", value: 0.05 });
    assert.deepEqual(
      { ...modifier },
      {
        kind: "critChance",
        op: "add",
        value: 0.05,
        scope: null,
        source: null,
      },
    );
    assert.ok(Object.isFrozen(modifier));
  });

  it("freezes and copies the scope, so the input cannot change it later", () => {
    const abilities = ["backstab"];
    const modifier = defineModifier({
      kind: "damage",
      value: 0.1,
      scope: { abilities },
    });
    abilities.push("eviscerate");
    assert.deepEqual([...modifier.scope.abilities], ["backstab"]);
    assert.ok(Object.isFrozen(modifier.scope));
    assert.ok(Object.isFrozen(modifier.scope.abilities));
  });

  it("treats a missing, null and empty scope as unrestricted", () => {
    for (const scope of [undefined, null, {}]) {
      const modifier = defineModifier({ kind: "damage", value: 0.1, scope });
      assert.equal(modifier.scope, null);
    }
  });

  it("accepts its own output, so lists can mix specs and modifiers", () => {
    const once = defineModifier({ kind: "damage", value: 0.1, source: "a" });
    const twice = defineModifier(once);
    assert.deepEqual({ ...twice }, { ...once });
  });

  it("rejects a typo at load", () => {
    const bad = [
      [null, /must be an object/],
      [[], /must be an object/],
      [{ kind: "crit", value: 1 }, /unknown kind "crit"/],
      [{ kind: "toString", value: 1 }, /unknown kind/],
      [{ kind: undefined, value: 1 }, /unknown kind/],
      [{ kind: "damage", op: "multiply", value: 1 }, /op must be/],
      [{ kind: "damage", value: "0.1" }, /finite number/],
      [{ kind: "damage", value: NaN }, /finite number/],
      [{ kind: "damage", value: Infinity }, /finite number/],
      [{ kind: "damage", value: undefined }, /finite number/],
      [{ kind: "damage", op: "mult", value: 0 }, /above 0/],
      [{ kind: "damage", op: "mult", value: -1 }, /above 0/],
      [{ kind: "haste", op: "mult", value: 1.2 }, /haste takes op "add"/],
      [{ kind: "damage", value: 1, extra: true }, /unknown field "extra"/],
      [{ kind: "damage", value: 1, source: "" }, /source must be/],
      [{ kind: "damage", value: 1, source: 3 }, /source must be/],
    ];
    for (const [spec, message] of bad) {
      assert.throws(() => defineModifier(spec), message, JSON.stringify(spec));
    }
  });

  it("names the source of a bad modifier", () => {
    assert.throws(
      () => defineModifier({ kind: "nope", value: 1, source: "combat.x" }),
      /Modifier combat\.x:/,
    );
  });

  it("rejects a bad scope", () => {
    const bad = [
      [{ abilities: [] }, /non-empty array/],
      [{ abilities: "backstab" }, /non-empty array/],
      [{ abilities: ["Backstab"] }, /unknown ability id "Backstab"/],
      [{ abilities: ["no-such"] }, /unknown ability id/],
      [{ hands: ["left"] }, /"left"/],
      [{ weaponTypes: ["wand"] }, /unknown weapon type "wand"/],
      [{ mainHand: true }, /unknown scope key "mainHand"/],
      [[], /plain object/],
      ["backstab", /plain object/],
      [new Map(), /plain object/],
    ];
    for (const [scope, message] of bad) {
      assert.throws(
        () => defineModifier({ kind: "damage", value: 0.1, scope }),
        message,
        JSON.stringify(scope),
      );
    }
  });

  it("only allows a scope that means something for the kind", () => {
    assert.throws(
      () =>
        defineModifier({
          kind: "attackPower",
          value: 10,
          scope: { abilities: ["backstab"] },
        }),
      /attackPower modifier cannot be scoped by abilities/,
    );
    assert.throws(
      () =>
        defineModifier({
          kind: "energyCost",
          value: -3,
          scope: { hands: ["mainHand"] },
        }),
      /energyCost modifier cannot be scoped by hands/,
    );
    assert.throws(
      () =>
        defineModifier({
          kind: "haste",
          value: 0.2,
          scope: { abilities: ["backstab"] },
        }),
      /cannot be scoped/,
    );
    assert.doesNotThrow(() =>
      defineScope("t", "dodgeReduction", { hands: ["offHand"] }),
    );
  });

  it("takes a scope with a null prototype", () => {
    const scope = Object.assign(Object.create(null), {
      abilities: ["backstab"],
    });
    const modifier = defineModifier({ kind: "damage", value: 0.1, scope });
    assert.deepEqual([...modifier.scope.abilities], ["backstab"]);
  });

  it("knows add 0 and mult 1 change nothing", () => {
    const make = (op, value) => defineModifier({ kind: "damage", op, value });
    assert.equal(isNeutral(make("add", 0)), true);
    assert.equal(isNeutral(make("mult", 1)), true);
    assert.equal(isNeutral(make("add", 1)), false);
    assert.equal(isNeutral(make("mult", 0.5)), false);
  });

  it("has a stacking form for every kind, and no more", () => {
    assert.deepEqual(
      Object.keys(k("modifiers.stacking")).sort(),
      Object.keys(MODIFIER_KINDS).sort(),
    );
  });
});

describe("how modifiers of one kind stack", () => {
  it("returns the base untouched when nothing applies", () => {
    for (const kind of Object.keys(MODIFIER_KINDS)) {
      const empty = pipeline();
      // Object.is: not "equal", the same number, so -0 and 0.1 + 0.2 survive.
      assert.ok(Object.is(empty.resolve(kind, 0.1 + 0.2), 0.1 + 0.2), kind);
      assert.ok(Object.is(combine(kind, -0, []), -0), kind);
    }
  });

  it("adds a flat kind, then multiplies it", () => {
    const stat = pipeline(
      { kind: "critChance", value: 0.05 },
      { kind: "critChance", value: 0.03 },
      { kind: "critChance", op: "mult", value: 2 },
    );
    assert.equal(stat.resolve("critChance", 0.1), (0.1 + (0.05 + 0.03)) * 2);
  });

  it("adds a percent kind inside one (1 + sum) factor, then multiplies", () => {
    const stat = pipeline(
      { kind: "damage", value: 0.1 },
      { kind: "damage", value: 0.2 },
      { kind: "damage", op: "mult", value: 1.5 },
    );
    assert.equal(stat.resolve("damage", 100), 100 * (1 + (0.1 + 0.2)) * 1.5);
    // Two percent sources add; they do not compound.
    assert.notEqual(stat.resolve("damage", 100), 100 * 1.1 * 1.2 * 1.5);
  });

  it("scales only the bonus part of a crit multiplier", () => {
    const stat = pipeline(
      { kind: "critDamage", value: 0.2 },
      { kind: "critDamage", value: 0.1 },
    );
    // 2 is a +100% bonus; +30% of that bonus is 2.3, not 2 * 1.3.
    assert.equal(
      stat.resolve("critDamage", 2),
      1 + (2 - 1) * (1 + (0.2 + 0.1)),
    );
    assert.equal(
      pipeline({ kind: "critDamage", op: "mult", value: 1.5 }).resolve(
        "critDamage",
        2,
      ),
      2.5,
    );
  });

  it("stacks haste by haste.stacking, one factor per source and per stack", () => {
    const haste = pipeline(
      { kind: "haste", value: 0.2 },
      { kind: "haste", value: 0.3 },
    );
    assert.equal(haste.resolve("haste", 1), 1 * 1.2 * 1.3);
    withConstant("haste.stacking", "additive", () => {
      assert.equal(haste.resolve("haste", 1), 1 + 0.2 + 0.3);
    });
    withConstant("haste.stacking", "other", () => {
      assert.throws(() => haste.resolve("haste", 1), /haste\.stacking/);
    });
  });

  it("applies the floor of a kind only when something modified it", () => {
    const cheaper = pipeline({ kind: "energyCost", value: -10 });
    assert.equal(cheaper.resolve("energyCost", 4), 0);
    assert.equal(cheaper.resolve("energyCost", 40), 30);
    // Unmodified: whatever the caller gave, even below the floor.
    assert.equal(pipeline().resolve("energyCost", -5), -5);
    assert.equal(
      pipeline({ kind: "critDamage", value: -5 }).resolve("critDamage", 2),
      1,
    );
    assert.equal(
      pipeline({ kind: "damage", value: -2 }).resolve("damage", 100),
      0,
    );
  });

  it("drops a modifier that changes nothing", () => {
    const stat = pipeline(
      { kind: "damage", value: 0 },
      { kind: "damage", op: "mult", value: 1 },
    );
    assert.deepEqual(stat.explain("damage", { ability: "backstab" }), []);
    assert.ok(Object.is(stat.resolve("damage", 7.123), 7.123));
  });

  it("rejects a kind the pipeline does not know when it is asked", () => {
    assert.throws(() => pipeline().resolve("crit", 1), /Unknown modifier kind/);
  });
});

describe("scope and conditions", () => {
  const dagger = {
    ability: "backstab",
    hand: "mainHand",
    weaponType: "dagger",
  };
  const mace = {
    ability: "sinister-strike",
    hand: "mainHand",
    weaponType: "mace",
  };
  const offHandSword = {
    ability: "off-hand",
    hand: "offHand",
    weaponType: "sword",
  };

  it("matches any listed value and needs every listed key", () => {
    const stat = pipeline({
      kind: "critChance",
      value: 0.1,
      scope: {
        abilities: ["backstab", "ambush"],
        weaponTypes: ["dagger"],
      },
    });
    const crit = (context) => stat.resolve("critChance", 0, context);
    assert.equal(crit(dagger), 0.1);
    assert.equal(crit({ ...dagger, ability: "ambush" }), 0.1);
    assert.equal(crit({ ...dagger, ability: "eviscerate" }), 0);
    assert.equal(crit({ ...dagger, weaponType: "mace" }), 0);
    assert.equal(crit(mace), 0);
  });

  it("scopes by hand", () => {
    const stat = pipeline({
      kind: "damage",
      value: 0.25,
      scope: { hands: ["offHand"] },
    });
    assert.equal(stat.resolve("damage", 100, offHandSword), 125);
    assert.equal(stat.resolve("damage", 100, dagger), 100);
  });

  it("fails closed when the context lacks what the scope asks about", () => {
    const stat = pipeline({
      kind: "critChance",
      value: 0.1,
      scope: { weaponTypes: ["dagger"] },
    });
    assert.equal(stat.resolve("critChance", 0), 0);
    assert.equal(stat.resolve("critChance", 0, {}), 0);
    assert.equal(stat.resolve("critChance", 0, { weaponType: null }), 0);
  });

  it("applies an unscoped modifier with no context at all", () => {
    const stat = pipeline({ kind: "attackPower", value: 50 });
    assert.equal(stat.resolve("attackPower", 450), 500);
    assert.equal(stat.resolve("attackPower", 450, undefined), 500);
  });

  it("explains each contribution with its source", () => {
    const stat = pipeline(
      { kind: "damage", value: 0.1, source: "a" },
      {
        kind: "damage",
        op: "mult",
        value: 2,
        source: "b",
        scope: { abilities: ["eviscerate"] },
      },
    );
    assert.deepEqual(stat.explain("damage", { ability: "backstab" }), [
      { source: "a", op: "add", value: 0.1, stacks: 1 },
    ]);
    assert.equal(stat.explain("damage", { ability: "eviscerate" }).length, 2);
  });
});

describe("rank tables", () => {
  const precision = [
    { kind: "hitChance", op: "add", values: [0.01, 0.02, 0.03] },
  ];

  it("gives one modifier per entry at the rank chosen", () => {
    const [modifier, ...rest] = expandRank(precision, 2, "combat.precision");
    assert.equal(rest.length, 0);
    assert.equal(modifier.value, 0.02);
    assert.equal(modifier.source, "combat.precision");
  });

  it("gives nothing at rank 0", () => {
    assert.deepEqual(expandRank(precision, 0, "combat.precision"), []);
  });

  it("rejects a rank outside the table and a malformed table", () => {
    assert.throws(() => expandRank(precision, 4), /above the table's 3 ranks/);
    for (const rank of [-1, 1.5, NaN, "1", null]) {
      assert.throws(() => expandRank(precision, rank), RangeError);
    }
    assert.throws(() => expandRank({}, 1), TypeError);
    assert.throws(
      () => expandRank([{ kind: "hitChance", values: [] }], 1),
      /values array/,
    );
    assert.throws(
      () => expandRank([{ kind: "hitChance", values: [0.01], extra: 1 }], 1),
      /unknown field "extra"/,
    );
  });
});

describe("aura modifiers", () => {
  const define = (spec) =>
    defineAura({ id: "test-aura", name: "Test Aura", duration: 10, ...spec });

  it("compiles haste and energy regen effects into modifiers", () => {
    assert.deepEqual(
      AURAS.sliceAndDice.modifiers.map(({ kind, op, value }) => ({
        kind,
        op,
        value,
      })),
      [{ kind: "haste", op: "add", value: k("sliceAndDice").haste }],
    );
    assert.deepEqual(
      AURAS.adrenalineRush.modifiers.map(({ kind, op, value }) => ({
        kind,
        op,
        value,
      })),
      [
        {
          kind: "energyRegen",
          op: "mult",
          value: k("adrenalineRush").regenMultiplier,
        },
      ],
    );
    assert.equal(AURAS.sliceAndDice.modifiers[0].source, "slice-and-dice");
  });

  it("takes a modifier list of its own", () => {
    const aura = define({
      modifiers: [
        { kind: "damage", value: 0.1, scope: { abilities: ["backstab"] } },
      ],
    });
    assert.equal(aura.modifiers.length, 1);
    assert.equal(aura.modifiers[0].source, "test-aura");
    assert.ok(Object.isFrozen(aura.modifiers));
  });

  it("rejects a bad modifier, naming the aura", () => {
    assert.throws(
      () => define({ modifiers: [{ kind: "nope", value: 1 }] }),
      /Aura "test-aura": Modifier test-aura: unknown kind/,
    );
    assert.throws(() => define({ modifiers: {} }), /array of modifiers/);
  });

  it("applies while the aura is up, once per stack, then not", () => {
    const aura = define({
      target: "target",
      maxStacks: 3,
      stackRule: "add",
      modifiers: [{ kind: "damage", value: 0.1 }],
    });
    const { sim } = fresh();
    const damage = () => sim.modifiers.resolve("damage", 100, { ability: "x" });
    assert.equal(damage(), 100);
    sim.applyAura(aura, { stacks: 2 });
    assert.equal(damage(), 100 * (1 + 0.1 * 2));
    sim.run(11);
    assert.equal(damage(), 100);
  });

  it("applies a scoped aura modifier only to the attack it names", () => {
    const aura = define({
      modifiers: [
        { kind: "damage", value: 1, scope: { abilities: ["backstab"] } },
      ],
    });
    const { sim } = fresh();
    sim.applyAura(aura);
    assert.equal(
      sim.modifiers.resolve("damage", 100, { ability: "backstab" }),
      200,
    );
    assert.equal(
      sim.modifiers.resolve("damage", 100, { ability: "ambush" }),
      100,
    );
  });

  it("is seen by an aura applied after the first read", () => {
    const aura = define({ modifiers: [{ kind: "attackPower", value: 100 }] });
    const { sim } = fresh();
    assert.equal(sim.modifiers.resolve("attackPower", 450), 450);
    sim.applyAura(aura);
    assert.equal(sim.modifiers.resolve("attackPower", 450), 550);
  });

  it("goes after the static modifiers, in registry order", () => {
    const first = define({
      id: "first",
      modifiers: [{ kind: "damage", op: "mult", value: 2 }],
    });
    const second = define({
      id: "second",
      modifiers: [{ kind: "damage", op: "mult", value: 3 }],
    });
    const { sim } = fresh([
      { kind: "damage", op: "mult", value: 5, source: "talent" },
    ]);
    sim.applyAura(second);
    sim.applyAura(first);
    assert.deepEqual(
      sim.modifiers
        .explain("damage", { ability: "x" })
        .map((row) => row.source),
      ["talent", "second", "first"],
      "registry order is the order the fight first saw each definition",
    );
    assert.equal(sim.modifiers.resolve("damage", 1, { ability: "x" }), 30);
  });
});

describe("a run with no effective modifiers", () => {
  const config = {
    weapons: { mainHand: { type: "dagger" }, offHand: { type: "dagger" } },
  };

  function drawCount(options) {
    const fight = createFight(3, config, options);
    let draws = 0;
    const rng = fight.simulation.rng;
    fight.simulation.rng = () => {
      draws += 1;
      return rng();
    };
    fight.simulation.run(60);
    return {
      draws,
      damage: fight.simulation.damageDone,
      log: fight.simulation.combatLog.map((event) => ({ ...event })),
    };
  }

  it("gives the same result as a fight made without the option", () => {
    const plain = drawCount(undefined);
    assert.deepEqual(drawCount({}), plain);
    assert.deepEqual(drawCount({ modifiers: [] }), plain);
  });

  it("is the same with modifiers that add 0 or multiply by 1, whatever their kind and scope", () => {
    const plain = drawCount(undefined);
    const neutral = Object.keys(MODIFIER_KINDS).flatMap((kind) =>
      kind === "haste"
        ? [{ kind, value: 0 }]
        : [
            { kind, value: 0 },
            {
              kind,
              op: "mult",
              value: 1,
              scope: MODIFIER_KINDS[kind].scope.includes("abilities")
                ? { abilities: ["backstab"] }
                : undefined,
            },
          ],
    );
    assert.deepEqual(drawCount({ modifiers: neutral }), plain);
  });

  it("is the same for a modifier scoped to something this fight never does", () => {
    const plain = drawCount(undefined);
    const other = drawCount({
      modifiers: [
        {
          kind: "damage",
          value: 0.5,
          scope: { abilities: ["ghostly-strike", "mutilate", "ambush"] },
        },
        { kind: "critChance", value: 0.2, scope: { weaponTypes: ["axe"] } },
      ],
    });
    assert.deepEqual(other, plain);
  });

  it("draws random numbers only where a roll is asked for, not for a modifier", () => {
    const base = drawCount(undefined);
    const changed = drawCount({
      modifiers: [
        { kind: "attackPower", value: 0 },
        { kind: "energyCost", value: 0 },
      ],
    });
    assert.equal(changed.draws, base.draws);
  });

  it("is not vacuous: a modifier that matters changes the damage and nothing else", () => {
    const plain = drawCount(undefined);
    const stronger = drawCount({
      modifiers: [{ kind: "damage", value: 0.1 }],
    });
    assert.ok(stronger.damage > plain.damage);
    assert.equal(stronger.draws, plain.draws);
  });

  it("is rejected at the door when the options are not an object", () => {
    assert.throws(
      () => createFight(1, undefined, { modifier: [] }),
      /Unknown Rogue option/,
    );
    assert.throws(() => createFight(1, undefined, null), TypeError);
    assert.throws(
      () => createFight(1, undefined, { modifiers: {} }),
      TypeError,
    );
  });
});

describe("modifiers at the engine's hooks", () => {
  // Rolls are 0..100 and the outcome bands for a skill at hit 0 and crit 0 are
  // miss [0, 8), dodge [8, 14.5), then a hit.
  it("shifts the hit table with hitChance and dodgeReduction", () => {
    const base = fresh();
    assert.equal(attack(base.sim, "backstab", 0.13).outcome, "dodge");
    const hit = fresh([{ kind: "hitChance", value: 0.03 }]);
    assert.equal(attack(hit.sim, "backstab", 0.13).outcome, "hit");
    assert.equal(attack(hit.sim, "backstab", 0.04).outcome, "miss");
    const expertise = fresh([{ kind: "dodgeReduction", value: 0.02 }]);
    assert.equal(attack(expertise.sim, "backstab", 0.13).outcome, "hit");
  });

  it("adds crit chance only for the scoped ability", () => {
    const { sim } = fresh([
      { kind: "critChance", value: 0.3, scope: { abilities: ["backstab"] } },
    ]);
    assert.equal(attack(sim, "backstab", 0.2).outcome, "crit");
    assert.equal(attack(sim, "sinister-strike", 0.2).outcome, "hit");
  });

  it("scopes crit chance by the weapon in the hand", () => {
    const rogue = new Rogue(
      { weapons: { mainHand: { type: "dagger" }, offHand: { type: "mace" } } },
      {
        modifiers: [
          {
            kind: "critChance",
            value: 0.5,
            scope: { weaponTypes: ["dagger"] },
          },
        ],
      },
    );
    rogue.rotation = () => {};
    rogue.critChance = 0;
    rogue.bonusHitChance = 1;
    const sim = new Simulation(rogue, { rng: testRng });
    assert.equal(
      attack(sim, "main-hand", 0.3, 100, "mainHand").outcome,
      "glancing",
    );
    // 0.3 is inside the glancing band [0, 40) for a weapon swing at crit 0, so
    // read a roll past it: the dagger crits there, the mace does not.
    assert.equal(
      attack(sim, "main-hand", 0.5, 100, "mainHand").outcome,
      "crit",
    );
    assert.equal(attack(sim, "off-hand", 0.5, 100, "offHand").outcome, "hit");
  });

  it("raises damage before the crit and the armor, from the matching hand", () => {
    const plain = fresh();
    const buffed = fresh([
      { kind: "damage", value: 0.2, scope: { hands: ["offHand"] } },
    ]);
    const off = attack(buffed.sim, "off-hand", 0.99, 1000, "offHand");
    const main = attack(buffed.sim, "main-hand", 0.99, 1000, "mainHand");
    const none = attack(plain.sim, "off-hand", 0.99, 1000, "offHand");
    assert.equal(off.damage, 1200 * plain.sim.armorMultiplier());
    assert.equal(main.damage, none.damage);
    assert.equal(off.outcome, "hit");
  });

  it("scales the crit bonus", () => {
    const { sim } = fresh([
      { kind: "critChance", value: 1 },
      { kind: "critDamage", value: 0.2, scope: { abilities: ["backstab"] } },
    ]);
    const crit = attack(sim, "backstab", 0.5, 1000);
    assert.equal(crit.outcome, "crit");
    assert.equal(crit.damage, 2200 * sim.armorMultiplier());
  });

  it("ignores a share of armor for the attacks it names", () => {
    const { sim } = fresh([
      { kind: "armorIgnore", value: 0.1, scope: { abilities: ["backstab"] } },
    ]);
    const plain = fresh().sim;
    const named = sim.armorMultiplier({ ability: "backstab" });
    assert.ok(named > plain.armorMultiplier());
    assert.equal(
      sim.armorMultiplier({ ability: "ambush" }),
      plain.armorMultiplier(),
    );
    assert.equal(sim.armorMultiplier(), plain.armorMultiplier());
  });

  it("reduces the energy a skill costs, for the skill it names", () => {
    const { rogue, sim } = fresh([
      {
        kind: "energyCost",
        value: -3,
        scope: { abilities: ["sinister-strike"] },
      },
    ]);
    const spent = (skill) => {
      rogue.energy = 100;
      sim.gcd = 0;
      setRoll(0.99);
      assert.ok(skill.cast(rogue, sim));
      return 100 - rogue.energy;
    };
    const { sinisterStrike, backstab } = rogue.abilities;
    assert.equal(spent(sinisterStrike), sinisterStrike.energyCost - 3);
    assert.equal(spent(backstab), backstab.energyCost);
    // The skill's own cost is left as the constants gave it.
    assert.equal(sinisterStrike.energyCost, k("sinisterStrike").energy);
  });

  it("does not let a cost modifier take the cost below 0 or let a skill start without the energy", () => {
    const { rogue, sim } = fresh([{ kind: "energyCost", value: -1000 }]);
    rogue.energy = 0;
    setRoll(0.99);
    assert.ok(rogue.abilities.sinisterStrike.cast(rogue, sim));
    assert.equal(rogue.energy, 0);
    const dearer = fresh([{ kind: "energyCost", value: 10 }]);
    dearer.rogue.energy = dearer.rogue.abilities.sinisterStrike.energyCost;
    assert.equal(
      dearer.rogue.abilities.sinisterStrike.cast(dearer.rogue, dearer.sim),
      null,
    );
  });

  it("adds attack power", () => {
    const { rogue } = fresh([{ kind: "attackPower", value: 55 }]);
    assert.equal(rogue.getAttackPower(), rogue.attackPower + 55);
  });

  it("changes the rate energy comes back at", () => {
    const base = fresh().sim;
    const quicker = fresh([{ kind: "energyRegen", op: "mult", value: 2 }]).sim;
    base.rogue.energy = 0;
    quicker.rogue.energy = 0;
    base.run(2);
    quicker.run(2);
    assert.ok(quicker.rogue.energy > base.rogue.energy);
  });
});

describe("two trees at once", () => {
  it("combine in one pipeline, whatever the order they were listed in", () => {
    const assassination = {
      kind: "critChance",
      value: 0.05,
      source: "assassination.malice",
    };
    const subtlety = {
      kind: "critChance",
      value: 0.15,
      source: "subtlety.improved-ambush",
      scope: { abilities: ["ambush"] },
    };
    const combat = {
      kind: "critChance",
      value: 0.1,
      source: "combat.puncturing-wounds",
      scope: { abilities: ["backstab"] },
    };
    const forward = pipeline(assassination, subtlety, combat);
    const reverse = pipeline(combat, subtlety, assassination);
    // The sum of adds does not depend on the order. (Float addition can; these
    // three sums are exact in binary to the last bit, so equal is the right test.)
    const ambush = { ability: "ambush" };
    const backstab = { ability: "backstab" };
    assert.equal(forward.resolve("critChance", 0, ambush), 0.05 + 0.15);
    assert.equal(reverse.resolve("critChance", 0, ambush), 0.15 + 0.05);
    assert.equal(forward.resolve("critChance", 0, backstab), 0.05 + 0.1);
    assert.equal(
      forward.resolve("critChance", 0, { ability: "eviscerate" }),
      0.05,
    );
    assert.deepEqual(
      forward.explain("critChance", ambush).map((row) => row.source),
      ["assassination.malice", "subtlety.improved-ambush"],
    );
  });
});
