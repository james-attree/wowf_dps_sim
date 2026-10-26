import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { Ability } from "../js/ability.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { RESOURCE_DEFINITIONS } from "../js/resource-data.js";
import { Resource, createResources } from "../js/resource.js";
import { ModifierPipeline } from "../js/modifiers.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

// D3 (#99): energy and combo points are resources described as data, and the
// generic ability executor spends and gains through them by id.

const definitionOf = (id) =>
  ABILITY_DEFINITIONS.find((definition) => definition.id === id);

function harness(options) {
  setRoll(0.5);
  const rogue = new Rogue(undefined, options);
  rogue.bonusHitChance = 1;
  rogue.critChance = 0;
  rogue.rotation = () => {};
  const sim = new Simulation(rogue, { rng: testRng });
  return { rogue, sim };
}

// A second resource, written as data with constants ids that already exist.
// Nothing in js/ names it.
const RAGE = Object.freeze({
  id: "rage",
  max: "energy.max",
  start: { id: "character.startingComboPoints" },
});

function withRage(rogue, startValue = 100) {
  rogue.resources.rage = new Resource(RAGE, rogue.modifiers);
  rogue.resources.rage.value = startValue;
  return rogue.resources.rage;
}

describe("resource definitions", () => {
  it("describe energy and combo points as frozen data on constants rows", () => {
    assert.deepEqual(
      RESOURCE_DEFINITIONS.map((definition) => definition.id),
      ["energy", "comboPoints"],
    );
    const frozen = (value) => {
      if (value !== null && typeof value === "object") {
        assert.ok(Object.isFrozen(value));
        Object.values(value).forEach(frozen);
      }
    };
    frozen(RESOURCE_DEFINITIONS);
    const [energy, combo] = RESOURCE_DEFINITIONS;
    assert.equal(k(energy.max), 100);
    assert.equal(k(energy.regen.perSecond), 10);
    assert.equal(k(energy.regen.tick), "continuous");
    assert.equal(k(combo.max), 5);
    assert.equal(k(combo.onTargetChange), "clear");
    assert.equal(combo.regen, undefined);
  });

  it("give a rogue one pool each, with the old fields as views on them", () => {
    const rogue = new Rogue();
    assert.deepEqual(Object.keys(rogue.resources), ["energy", "comboPoints"]);
    assert.equal(rogue.energy, 100);
    assert.equal(rogue.maxEnergy, 100);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(rogue.maxComboPoints, 5);
    rogue.energy = 40;
    rogue.comboPoints = 3;
    assert.equal(rogue.resources.energy.value, 40);
    assert.equal(rogue.resources.comboPoints.value, 3);
    rogue.maxEnergy = 80;
    assert.equal(rogue.resources.energy.baseMax, 80);
    assert.equal(rogue.maxEnergy, 80);
    rogue.maxComboPoints = 4;
    assert.equal(rogue.resources.comboPoints.max, 4);
  });
});

describe("the generic executor", () => {
  it("has no rogue-specific names in the executor or the resource model", async () => {
    const banned =
      /\b(energy\w*|comboPoints\w*|maxEnergy|maxComboPoints|premeditation\w*|cpExpiry|expiresComboPoints|byComboPoints)\b/i;
    for (const file of ["../js/ability.js", "../js/resource.js"]) {
      // The code, not its comments, which may say what the data means.
      const source = (
        await readFile(new URL(file, import.meta.url), "utf8")
      ).replace(/\/\/.*$/gm, "");
      assert.equal(
        source.match(banned),
        null,
        `${file}: ${source.match(banned)}`,
      );
    }
  });

  it("holds no energy or combo point field on an ability or the executor", () => {
    const rogue = new Rogue();
    for (const ability of Object.values(rogue.abilities)) {
      for (const name of Object.keys(ability)) {
        assert.equal(/energy|combo|premeditation/i.test(name), false, name);
      }
    }
    for (const name of Object.getOwnPropertyNames(Ability.prototype)) {
      assert.equal(/energy|combo|premeditation/i.test(name), false, name);
    }
  });

  it("runs a builder against a second resource defined in data", () => {
    const { rogue, sim } = harness();
    const rage = withRage(rogue);
    const ability = new Ability(
      {
        ...definitionOf("sinister-strike"),
        key: "rageStrike",
        cost: { resource: "rage", field: "energy" },
        gain: { resource: "rage", field: "comboPoints" },
      },
      rogue,
    );
    const energy = rogue.energy;
    const cost = k("sinisterStrike").energy;
    const result = ability.cast(rogue, sim);
    assert.equal(result.landed, true);
    assert.equal(rage.value, 100 - cost + k("sinisterStrike").comboPoints);
    assert.equal(rogue.energy, energy, "energy was not touched");
    assert.equal(rogue.comboPoints, 0, "combo points were not touched");
  });

  it("runs a spender against a second resource, reading the count first", () => {
    const { rogue, sim } = harness();
    const rage = withRage(rogue, 3);
    const spender = new Ability(
      {
        ...definitionOf("eviscerate"),
        key: "rageFinisher",
        cost: { resource: "rage", field: "energy" },
        spend: { resource: "rage" },
      },
      rogue,
    );
    rage.value = 3 + k("eviscerate").energy;
    const spendable = spender.spendable();
    assert.equal(spendable, rage.value);
    // The same finisher on combo points, for the same count.
    const expected = harness().rogue;
    expected.comboPoints = 3;
    const reference = expected.abilities.eviscerate.resolve().damage;
    const resolved = spender.resolve(3).damage;
    assert.equal(resolved, reference);
    // Cast: pays the cost, then spends what is left, in one go.
    const result = spender.cast(rogue, sim);
    assert.equal(result.landed, true);
    assert.equal(rage.value, 0);
    assert.equal(rogue.comboPoints, 0);
    assert.equal(rogue.energy, k("start.state").energy);
  });

  it("will not cast a spender with none of its resource", () => {
    const { rogue, sim } = harness();
    rogue.comboPoints = 0;
    assert.equal(rogue.abilities.eviscerate.cast(rogue, sim), null);
    assert.equal(rogue.energy, k("start.state").energy);
  });

  it("names the resource a rogue lacks, when the ability first needs it", () => {
    const { rogue, sim } = harness();
    const ability = new Ability(
      {
        ...definitionOf("sinister-strike"),
        key: "x",
        cost: { resource: "focus", field: "energy" },
      },
      rogue,
    );
    assert.throws(() => ability.cast(rogue, sim), /"focus"/);
  });

  it("refunds nothing on a miss when the cost names no refund", () => {
    const { rogue, sim } = harness();
    rogue.bonusHitChance = -1;
    setRoll(0);
    const rage = withRage(rogue);
    const ability = new Ability(
      {
        ...definitionOf("sinister-strike"),
        key: "z",
        cost: { resource: "rage", field: "energy" },
      },
      rogue,
    );
    const result = ability.cast(rogue, sim);
    assert.equal(result.landed, false);
    assert.equal(rage.value, 100 - k("sinisterStrike").energy);
    // The rogue's own entries refund part of the cost.
    sim.gcd = 0;
    const before = rogue.energy;
    const miss = rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(miss.landed, false);
    assert.equal(
      rogue.energy,
      before - k("sinisterStrike").energy * (1 - k("skill.missEnergyRefund")),
    );
  });

  it("takes a resource's cost modifiers from its definition", () => {
    const { rogue, sim } = harness({
      modifiers: [{ kind: "energyCost", value: -10 }],
    });
    rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(rogue.energy, 100 - (k("sinisterStrike").energy - 10) + 0);
    // A pool that names no cost modifier pays the base cost.
    const rage = withRage(rogue);
    const ability = new Ability(
      {
        ...definitionOf("sinister-strike"),
        key: "y",
        cost: { resource: "rage", field: "energy" },
      },
      rogue,
    );
    sim.gcd = 0;
    ability.cast(rogue, sim);
    assert.equal(rage.value, 100 - k("sinisterStrike").energy);
  });
});

describe("the resource cap", () => {
  const MAX = {
    kind: "resourceMax",
    op: "add",
    value: 20,
    scope: { resources: ["energy"] },
  };

  it("is changed by a max-energy modifier and no other resource's", () => {
    const rogue = new Rogue(undefined, { modifiers: [MAX] });
    assert.equal(rogue.maxEnergy, 120);
    assert.equal(rogue.maxComboPoints, 5);
    assert.equal(new Rogue().maxEnergy, 100);
  });

  it("holds energy at the new cap while it regenerates", () => {
    const { rogue, sim } = harness({ modifiers: [MAX] });
    rogue.energy = 100;
    sim.regenerateResources(1);
    assert.equal(rogue.energy, 110);
    sim.regenerateResources(5);
    assert.equal(rogue.energy, 120);
    // The cap is the one the pipeline gives, so a plain Rogue stops at 100.
    const plain = harness();
    plain.rogue.energy = 95;
    plain.sim.regenerateResources(5);
    assert.equal(plain.rogue.energy, 100);
  });

  it("applies to every resource when the modifier names none", () => {
    const rogue = new Rogue(undefined, {
      modifiers: [{ kind: "resourceMax", op: "add", value: 1 }],
    });
    assert.equal(rogue.maxEnergy, 101);
    assert.equal(rogue.maxComboPoints, 6);
    // A builder now reaches the new cap.
    rogue.comboPoints = 5;
    assert.equal(rogue.resources.comboPoints.gain(5), 1);
    assert.equal(rogue.comboPoints, 6);
  });

  it("changes the cap of a resource the rogue's data adds, when unscoped", () => {
    // A scope names the ids in js/resource-data.js, the class's own list, so
    // a modifier scoped to a test-only "rage" would be refused. An unscoped
    // one reaches every pool.
    const { rogue } = harness({
      modifiers: [{ kind: "resourceMax", op: "add", value: 5 }],
    });
    const rage = withRage(rogue, 98);
    assert.equal(rage.max, 105);
    assert.equal(rage.gain(50), 7);
  });

  it("never takes a cap below zero", () => {
    const { rogue } = harness({
      modifiers: [{ kind: "resourceMax", op: "add", value: -500 }],
    });
    assert.equal(rogue.maxEnergy, 0);
    assert.equal(rogue.maxComboPoints, 0);
    // A pool above a cap that fell is brought down to it, and gained nothing.
    assert.equal(rogue.resources.energy.gain(10), 0);
    assert.equal(rogue.energy, 0);
  });

  it("is a kind that takes a resources scope and nothing else", () => {
    const bad = (scope) => () =>
      new ModifierPipeline([
        { kind: "resourceMax", op: "add", value: 1, scope },
      ]);
    assert.throws(bad({ resources: ["mana-that-does-not-exist"] }), /resource/);
    assert.throws(bad({ resources: [] }), RangeError);
    assert.throws(bad({ abilities: ["backstab"] }), /cannot be scoped by/);
    assert.throws(bad({ tags: ["white"] }), /cannot be scoped by/);
    assert.doesNotThrow(bad({ resources: ["energy", "comboPoints"] }));
    // And an attack kind refuses it.
    assert.throws(
      () =>
        new ModifierPipeline([
          {
            kind: "damage",
            op: "add",
            value: 1,
            scope: { resources: ["energy"] },
          },
        ]),
      /cannot be scoped by/,
    );
  });

  it("is data like the rest of the stacking rules", () => {
    assert.equal(k("modifiers.stacking").resourceMax, "flat");
  });
});

describe("Resource", () => {
  const pipeline = () => new ModifierPipeline();
  const energy = () => new Resource(RESOURCE_DEFINITIONS[0], pipeline());
  const combo = () => new Resource(RESOURCE_DEFINITIONS[1], pipeline());

  it("gains up to the cap and says how much it gained", () => {
    const pool = energy();
    pool.value = 90;
    assert.equal(pool.gain(25), 10);
    assert.equal(pool.value, 100);
    assert.equal(pool.gain(25), 0);
    pool.value = 10;
    assert.equal(pool.gain(25), 25);
    assert.equal(pool.value, 35);
  });

  it("spends an amount, and spendAll returns the count before the reset", () => {
    const pool = combo();
    pool.value = 4;
    assert.equal(pool.has(4), true);
    assert.equal(pool.has(5), false);
    assert.equal(pool.spend(3), 3);
    assert.equal(pool.value, 1);
    pool.value = 4;
    assert.equal(pool.spendAll(), 4);
    assert.equal(pool.value, 0);
    assert.equal(pool.spendAll(), 0);
  });

  it("regenerates at a rate and stops at the cap", () => {
    const pool = energy();
    pool.value = 0;
    pool.regenerate(0.5, 10);
    assert.equal(pool.value, 5);
    pool.regenerate(100, 10);
    assert.equal(pool.value, 100);
  });

  it("removes an expiring gift when its time is up, never below 0", () => {
    const pool = combo();
    pool.value = 3;
    pool.armExpiry(2, 1);
    pool.tick(0.5);
    assert.equal(pool.value, 3);
    assert.equal(pool.expiryRemaining, 0.5);
    pool.tick(0.5);
    assert.equal(pool.value, 1);
    assert.equal(pool.expiryAmount, 0);
    assert.equal(pool.expiryRemaining, 0);
    pool.armExpiry(2, 1);
    pool.tick(1);
    assert.equal(pool.value, 0);
    // Nothing armed: a tick changes nothing.
    pool.value = 2;
    pool.tick(10);
    assert.equal(pool.value, 2);
  });

  it("counts an expiry within the tick epsilon as up", () => {
    const pool = combo();
    pool.value = 4;
    pool.armExpiry(2, 1);
    pool.tick(1 - k("sim.tickEpsilon") / 2);
    assert.equal(pool.value, 2);
  });

  it("can have its expiry cancelled and restarted", () => {
    const pool = combo();
    pool.value = 4;
    pool.armExpiry(2, 1);
    pool.clearExpiry();
    pool.tick(5);
    assert.equal(pool.value, 4);
    pool.armExpiry(2, 1);
    pool.tick(0.75);
    pool.armExpiry(2, 1);
    pool.tick(0.75);
    assert.equal(pool.value, 4);
  });

  it("clears on a new target as its data says, and keeps without a rule", () => {
    const pool = combo();
    pool.value = 3;
    pool.armExpiry(2, 1);
    pool.targetChanged();
    assert.equal(pool.value, 0);
    assert.equal(pool.expiryRemaining, 0);
    const kept = energy();
    kept.value = 30;
    kept.targetChanged();
    assert.equal(kept.value, 30);
  });

  it("keeps its points on a new target when its data says keep", () => {
    const row = CONSTANTS["combo.onTargetChange"];
    const saved = row.value;
    row.value = "keep";
    try {
      const pool = combo();
      pool.value = 3;
      pool.armExpiry(2, 1);
      pool.targetChanged();
      assert.equal(pool.value, 3);
      assert.equal(pool.expiryAmount, 2);
      assert.equal(pool.expiryRemaining, 1);
    } finally {
      row.value = saved;
    }
  });

  it("refuses a definition with an unknown rule or constants id", () => {
    const make = (change) => () =>
      new Resource({ ...RESOURCE_DEFINITIONS[0], ...change }, pipeline());
    assert.throws(
      make({ regen: { ...RESOURCE_DEFINITIONS[0].regen, tick: "combo.max" } }),
      /tick mode/,
    );
    assert.throws(
      make({ onTargetChange: "energy.tickMode" }),
      /onTargetChange/,
    );
    assert.throws(make({ max: "no.such.row" }), /no\.such\.row/);
    assert.throws(
      () => createResources(pipeline(), [RAGE, RAGE]),
      /Duplicate resource id "rage"/,
    );
  });

  it("starts at its start value", () => {
    assert.equal(energy().value, k("start.state").energy);
    assert.equal(combo().value, k("character.startingComboPoints"));
  });
});

describe("combo points through the executor", () => {
  it("adds up to the cap through the resource, not the field", () => {
    const { rogue, sim } = harness();
    rogue.comboPoints = 5;
    rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(rogue.comboPoints, 5);
  });

  it("reads the count a finisher spends before it resets", () => {
    const { rogue, sim } = harness();
    rogue.comboPoints = 4;
    const before = rogue.abilities.eviscerate.resolve().damage;
    const reference = harness().rogue;
    reference.comboPoints = 4;
    assert.equal(before, reference.abilities.eviscerate.resolve().damage);
    rogue.abilities.eviscerate.cast(rogue, sim);
    assert.equal(rogue.comboPoints, 0);
  });

  it("refunds a missed cast through the resource, capped at its max", () => {
    const { rogue, sim } = harness();
    rogue.bonusHitChance = -1;
    setRoll(0);
    rogue.energy = 100;
    const result = rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(result.landed, false);
    const cost = k("sinisterStrike").energy;
    assert.equal(rogue.energy, 100 - cost + cost * k("skill.missEnergyRefund"));
  });
});

describe("Premeditation on the resource", () => {
  it("removes exactly premeditation.cpRemovedOnExpiry on expiry, whatever was added", () => {
    const { rogue, sim } = harness();
    rogue.comboPoints = 1;
    rogue.abilities.premeditation.cast(rogue, sim);
    const added = k("premeditation").comboPoints;
    assert.equal(rogue.comboPoints, 1 + added);
    assert.equal(rogue.premeditationCp, k("premeditation.cpRemovedOnExpiry"));
    sim.step(k("premeditation.cpExpiry") + 0.5);
    assert.equal(
      rogue.comboPoints,
      Math.max(0, 1 + added - k("premeditation.cpRemovedOnExpiry")),
    );
    assert.equal(rogue.premeditationCpRemaining, 0);
  });

  it("is cancelled by a later combo point, so the points stay", () => {
    const { rogue, sim } = harness();
    rogue.abilities.premeditation.cast(rogue, sim);
    sim.gcd = 0;
    rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(rogue.premeditationCpRemaining, 0);
    sim.step(k("premeditation.cpExpiry") + 0.5);
    assert.equal(rogue.comboPoints, k("premeditation").comboPoints + 1);
  });
});
