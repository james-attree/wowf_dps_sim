import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSTANTS, k } from "../data/constants.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { Ability } from "../js/ability.js";
import { createFight, runFight } from "../js/fight.js";
import { rotationHost } from "../js/rotation-host.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import { AURAS } from "../js/auras.js";
import { rotationStateReader } from "../js/rotation-state.js";
import { summarizeCondition } from "../js/rotation-summary.js";
import { exportRotation, importRotation } from "../js/rotation-io.js";
import { rotationWarnings } from "../js/rotation-warnings.js";
import { validateRotation } from "../js/rotation-validator.js";
import { REQUIRED_AURAS } from "../js/required-auras.js";
import {
  allowCutthroat,
  grantCutthroat,
  procCutthroat,
} from "./cutthroat-override.js";

// Issue #261: Ambush needs a dagger in the main hand and the cutthroat aura
// ("Ambush allowed", js/required-auras.js), the only way the sim lets Ambush
// be cast, as it models no Stealth. Nothing in a fight grants the aura yet, so
// Ambush is never cast. A rotation may still hold an Ambush rule, with no
// warning: it is passed over. The test-only override
// (test/cutthroat-override.js) grants the aura as Cutthroat will in Phase 4.6,
// which proves the hook: Ambush casts, uses the aura up, and is refused again,
// and while the aura is down the rule is passed over, never pooled for.

const SEED = 7;
const DURATION = 300;
const fivePoints = { type: "comboPoints", op: ">=", value: 5 };
const rotation = (...builders) => ({
  schemaVersion: 1,
  name: "Eviscerate at 5 CP, otherwise a builder",
  rules: [
    { action: "eviscerate", conditions: [fivePoints] },
    ...builders.map((action) => ({ action, conditions: [] })),
  ],
});
const weapons = (type) => ({ mainHand: { type } });

function ready(type, options) {
  const fight = createFight(5, { weapons: weapons(type) }, options);
  fight.rogue.energy = fight.rogue.maxEnergy;
  fight.rogue.comboPoints = 0;
  fight.simulation.gcd = 0;
  return fight;
}

// What a refused cast must leave alone, and a count of the rng draws.
function snapshot({ rogue, simulation }) {
  return JSON.stringify({
    energy: rogue.energy,
    points: rogue.comboPoints,
    gcd: simulation.gcd,
    buffs: simulation.activeBuffs,
    cooldowns: simulation.cooldowns,
    log: simulation.combatLog.length,
    damage: simulation.damageDone,
    casts: simulation.abilityStats.ambush?.casts ?? 0,
  });
}
function countDraws(simulation) {
  const counter = { draws: 0 };
  const draw = simulation.rng;
  simulation.rng = () => {
    counter.draws += 1;
    return draw();
  };
  return counter;
}

describe("Ambush in the issue's repro (#261)", () => {
  // Before the fix (main at 108403c): 204.7 DPS with 48 Ambush on a sword,
  // 194.4 with 48 on a dagger.
  for (const type of ["sword", "dagger"]) {
    it(`casts no Ambush on a ${type}: the fight is Eviscerate at 5 CP alone`, () => {
      const config = (...builders) => ({
        weapons: weapons(type),
        rotation: rotation(...builders),
      });
      const withAmbush = runFight({
        seed: SEED,
        duration: DURATION,
        config: config("ambush"),
      });
      const alone = runFight({
        seed: SEED,
        duration: DURATION,
        config: config(),
      });
      assert.equal(withAmbush.abilities.Ambush, undefined);
      assert.equal(
        withAmbush.log.some((line) => JSON.stringify(line).includes("Ambush")),
        false,
      );
      const { config: ignored, ...rest } = withAmbush;
      const { config: ignoredToo, ...restAlone } = alone;
      assert.deepEqual(rest, restAlone);
      assert.ok(ignored && ignoredToo);
    });
  }
});

describe("a refused Ambush spends nothing (#261)", () => {
  for (const type of ["sword", "dagger"]) {
    it(`with no cutthroat aura on a ${type}: no cast, energy, combo point, GCD, cooldown or draw`, () => {
      const fight = ready(type);
      const { rogue, simulation } = fight;
      const before = snapshot(fight);
      const counter = countDraws(simulation);
      const events = [];
      simulation.on("*", (event) => events.push(event));
      assert.equal(rogue.abilities.ambush.canCast(rogue, simulation), false);
      assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
      assert.equal(counter.draws, 0);
      assert.equal(snapshot(fight), before);
      assert.deepEqual(events, []);
    });
  }

  it("on a sword with the cutthroat aura: still refused, nothing spent (it needs a dagger too)", () => {
    const fight = ready("sword");
    const { rogue, simulation } = fight;
    grantCutthroat(rogue, simulation);
    const before = snapshot(fight);
    const counter = countDraws(simulation);
    assert.equal(rogue.abilities.ambush.canCast(rogue, simulation), false);
    assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
    assert.equal(counter.draws, 0);
    assert.equal(snapshot(fight), before);
    assert.equal(simulation.hasAura("cutthroat"), true, "not used up");
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("ambush"), false);
    assert.equal(host.canCast("ambush"), false);
  });
});

describe("the host passes an Ambush rule over (#261)", () => {
  const program = () =>
    compileRotation({
      schemaVersion: 1,
      name: "Ambush, then Sinister Strike",
      rules: [
        { action: "ambush", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    });
  for (const type of ["sword", "dagger"]) {
    it(`on a ${type}: not usable, not castable, and the walk falls through to Sinister Strike`, () => {
      const { rogue, simulation } = ready(type);
      const host = rotationHost(rogue, simulation);
      assert.equal(host.usable("ambush"), false);
      assert.equal(host.canCast("ambush"), false);
      assert.deepEqual(decide(program(), host), {
        casts: ["sinister-strike"],
        outcome: "cast",
      });
    });

    it(`on a ${type} with too little energy: the walk pools for Sinister Strike, not Ambush`, () => {
      const { rogue, simulation } = ready(type);
      rogue.energy = 0;
      const counter = countDraws(simulation);
      const host = rotationHost(rogue, simulation);
      assert.equal(decide(program(), host).outcome, "pooling");
      assert.equal(counter.draws, 0);
      assert.equal(simulation.abilityStats.ambush?.casts ?? 0, 0);
    });
  }
});

describe("the Ambush hook: what Cutthroat will plug into (#261)", () => {
  it("names the aura: Ambush requires the self aura cutthroat, with one charge", () => {
    const aura = REQUIRED_AURAS.cutthroat;
    assert.equal(aura.id, "cutthroat");
    assert.equal(aura.name, "Ambush allowed");
    assert.equal(aura.target, "self");
    assert.equal(aura.charges, k("cutthroat.aura").charges);
    assert.equal(aura.charges, 1);
    assert.equal(aura.duration, null, "the granter gives the duration");
    assert.deepEqual(
      ABILITY_DEFINITIONS.find(({ id }) => id === "ambush").requiresAura,
      [aura.id],
    );
  });

  it("nothing in a fight grants it: no granted aura, and it is not up", () => {
    for (const type of ["sword", "dagger"]) {
      const { rogue, simulation } = ready(type);
      assert.deepEqual([...rogue.grantedAuras], []);
      assert.equal(simulation.hasAura("cutthroat"), false);
    }
  });

  it("granted, with a dagger: Ambush casts, uses the aura up, and is refused again with nothing spent", () => {
    const fight = ready("dagger");
    const { rogue, simulation } = fight;
    const events = [];
    simulation.on("aura", (event) => events.push(event));
    grantCutthroat(rogue, simulation);
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("ambush"), true);
    assert.equal(host.canCast("ambush"), true);
    assert.ok(rogue.abilities.ambush.cast(rogue, simulation));
    assert.equal(simulation.abilityStats.ambush.casts, 1);
    assert.equal(rogue.energy, rogue.maxEnergy - k("ambush").energy);
    // Consumed: the cast used the one charge, and the aura ended.
    assert.equal(simulation.hasAura("cutthroat"), false);
    assert.equal(Object.hasOwn(simulation.activeBuffs, "cutthroat"), false);
    assert.deepEqual(
      events
        .filter(({ aura }) => aura === "cutthroat")
        .map(({ change, reason }) => [change, reason]),
      [
        ["apply", null],
        ["expire", "charges"],
      ],
    );
    // Refused again: nothing spent, drawn or told.
    rogue.energy = rogue.maxEnergy;
    simulation.gcd = 0;
    const before = snapshot(fight);
    const counter = countDraws(simulation);
    const after = [];
    simulation.on("*", (event) => after.push(event));
    assert.equal(host.canCast("ambush"), false);
    assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
    assert.equal(counter.draws, 0);
    assert.equal(snapshot(fight), before);
    assert.deepEqual(after, []);
    assert.equal(simulation.abilityStats.ambush.casts, 1);
  });

  it("a cast that misses uses the aura up too: it is used by a cast that goes ahead, whatever the outcome", () => {
    const { rogue, simulation } = ready("dagger");
    grantCutthroat(rogue, simulation);
    // The lowest roll is a miss on the attack table.
    simulation.rng = () => 0;
    const result = rogue.abilities.ambush.cast(rogue, simulation);
    assert.ok(result);
    assert.equal(result.landed, false);
    assert.equal(result.outcome, "miss");
    assert.equal(simulation.hasAura("cutthroat"), false);
  });

  it("a cast refused for something else (energy) leaves the aura up", () => {
    const { rogue, simulation } = ready("dagger");
    grantCutthroat(rogue, simulation);
    rogue.energy = 0;
    assert.equal(rogue.abilities.ambush.cast(rogue, simulation), null);
    assert.equal(simulation.hasAura("cutthroat"), true);
  });

  it("granted, in a rotation: an Ambush rule casts while the aura is up, then is passed over, not pooled for", () => {
    const { rogue, simulation } = ready("dagger");
    grantCutthroat(rogue, simulation);
    const program = compileRotation({
      schemaVersion: 1,
      name: "Ambush, then Sinister Strike",
      rules: [
        { action: "ambush", conditions: [] },
        { action: "sinister-strike", conditions: [] },
      ],
    });
    const host = rotationHost(rogue, simulation);
    assert.deepEqual(decide(program, host), {
      casts: ["ambush"],
      outcome: "cast",
    });
    // The aura is used up: the rule is passed over and the walk moves on.
    simulation.gcd = 0;
    rogue.energy = rogue.maxEnergy;
    assert.equal(host.usable("ambush"), true);
    assert.equal(host.ready("ambush"), false);
    assert.deepEqual(decide(program, host), {
      casts: ["sinister-strike"],
      outcome: "cast",
    });
    // Up again (a new proc): the rule holds the walk as any other, casting or
    // pooling for its energy.
    procCutthroat(simulation);
    simulation.gcd = 0;
    rogue.energy = 0;
    assert.equal(host.ready("ambush"), true);
    assert.equal(decide(program, host).outcome, "pooling");
    rogue.energy = rogue.maxEnergy;
    assert.deepEqual(decide(program, host), {
      casts: ["ambush"],
      outcome: "cast",
    });
  });

  it("granted but down, with too little energy for Ambush: the walk pools for the next rule, not for Ambush", () => {
    const { rogue, simulation } = ready("dagger");
    allowCutthroat(rogue);
    rogue.energy = k("backstab").energy;
    const program = compileRotation({
      schemaVersion: 1,
      name: "Ambush, then Backstab",
      rules: [
        { action: "ambush", conditions: [] },
        { action: "backstab", conditions: [] },
      ],
    });
    const host = rotationHost(rogue, simulation);
    assert.deepEqual(decide(program, host), {
      casts: ["backstab"],
      outcome: "cast",
    });
  });

  it("Kira's B1 repro: a granted Ambush rule above Backstab does not stall the fight (dagger, seed 7, 120 s)", () => {
    const repro = (setup) => {
      const fight = createFight(
        SEED,
        {
          weapons: weapons("dagger"),
          rotation: rotation("ambush", "backstab"),
        },
        { duration: 120 },
      );
      const casts = [];
      fight.simulation.on("cast", ({ ability }) => {
        casts.push([ability, fight.simulation.hasAura("cutthroat")]);
      });
      setup(fight);
      fight.simulation.run(120);
      return { casts, dps: fight.simulation.damageDone / 120 };
    };
    const count = (casts, id) => casts.filter(([ability]) => ability === id);
    const plain = repro(() => {});
    // Granted once: one Ambush, then the fight carries on as Backstab and
    // Eviscerate (before the fix, 1 Ambush and then nothing: 90.7 DPS).
    const once = repro(({ rogue, simulation }) =>
      grantCutthroat(rogue, simulation),
    );
    assert.equal(count(once.casts, "ambush").length, 1);
    assert.equal(once.casts[0][0], "ambush");
    assert.ok(count(once.casts, "backstab").length > 10);
    assert.ok(count(once.casts, "eviscerate").length >= 3);
    assert.ok(once.dps > plain.dps * 0.9, `${once.dps} vs ${plain.dps}`);
    // A stand-in Cutthroat: every third Backstab puts the aura up. Ambush is
    // cast only while it is up, and Backstab and Eviscerate fire in between.
    const procs = repro(({ rogue, simulation }) => {
      allowCutthroat(rogue);
      let backstabs = 0;
      simulation.on("cast", ({ ability }) => {
        if (ability === "backstab") {
          backstabs += 1;
          if (backstabs % 3 === 0) {
            procCutthroat(simulation, 10);
          }
        }
      });
    });
    const ambushes = count(procs.casts, "ambush");
    assert.ok(ambushes.length > 3, `${ambushes.length} Ambush`);
    assert.ok(
      ambushes.every(([, up]) => up),
      "Ambush only with the aura up",
    );
    for (let index = 1; index < procs.casts.length; index += 1) {
      if (procs.casts[index][0] === "ambush") {
        assert.notEqual(procs.casts[index - 1][0], "ambush", "one per proc");
      }
    }
    assert.ok(count(procs.casts, "backstab").length > 10);
    assert.ok(count(procs.casts, "eviscerate").length >= 2);
  });

  it("the cast is told first: the aura is used up after the cast event, whatever follows it", () => {
    const { rogue, simulation } = ready("dagger");
    grantCutthroat(rogue, simulation);
    const order = [];
    simulation.on("*", (event) => {
      if (event.type === "cast") {
        order.push(["cast", event.ability, simulation.hasAura("cutthroat")]);
      } else if (event.type === "aura" && event.aura === "cutthroat") {
        order.push(["aura", event.change, event.reason]);
      }
    });
    assert.ok(rogue.abilities.ambush.cast(rogue, simulation));
    assert.deepEqual(order, [
      ["cast", "ambush", true],
      ["aura", "expire", "charges"],
    ]);
  });

  it("the aura up but not granted: a cast goes ahead, and a rotation rule is still passed over", () => {
    const { rogue, simulation } = ready("dagger");
    simulation.applyAura(REQUIRED_AURAS.cutthroat, { duration: 10 });
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("ambush"), false);
    assert.ok(rogue.abilities.ambush.cast(rogue, simulation));
  });

  it("is in the AURAS registry, so auraActive and the labels see it, and nothing reads it as Stealth", () => {
    assert.equal(AURAS.cutthroat, REQUIRED_AURAS.cutthroat);
    const condition = { type: "auraActive", aura: "cutthroat" };
    const program = {
      schemaVersion: 1,
      name: "Ambush while Cutthroat is up",
      rules: [{ action: "ambush", conditions: [condition] }],
    };
    assert.deepEqual(validateRotation(program), []);
    assert.equal(summarizeCondition(condition), "Ambush allowed is up");
    const { rogue, simulation } = ready("dagger");
    const read = () =>
      Object.hasOwn(
        rotationStateReader(rogue, simulation)().auras,
        "cutthroat",
      );
    assert.equal(read(), false);
    grantCutthroat(rogue, simulation);
    assert.equal(read(), true);
    // Not Stealth: no stealth aura is up, and Premeditation's rules ignore it.
    assert.equal(simulation.hasAura("stealth"), false);
  });

  it("the override is test-only: no Rogue or fight option grants the aura", () => {
    for (const key of ["states", "auras", "grantedAuras", "cutthroat"]) {
      assert.throws(
        () => createFight(1, {}, { [key]: ["cutthroat"] }),
        /Unknown Rogue option/,
        key,
      );
    }
  });
});

describe("the requirements are data (#261)", () => {
  it("Ambush needs a dagger and the cutthroat aura; only it requires an aura", () => {
    assert.deepEqual(
      ABILITY_DEFINITIONS.filter(
        (definition) => definition.requiresAura !== undefined,
      ).map((definition) => [definition.id, definition.requiresAura]),
      [["ambush", ["cutthroat"]]],
    );
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    assert.equal(ambush.requiresMainHand, "dagger");
  });

  it("requiresAura is a list of self aura ids from AURAS; anything else is refused", () => {
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    const { rogue } = createFight(1);
    for (const [requiresAura, message] of [
      ["cutthroat", /a list of aura ids/],
      [[], /a list of aura ids/],
      [["invisible"], /requires the aura "invisible"/],
      [["rupture"], /requires the aura "rupture"/],
      [["cutthroat", "cutthroat"], /more than once/],
    ]) {
      assert.throws(
        () => new Ability({ ...ambush, requiresAura }, rogue),
        message,
        JSON.stringify(requiresAura),
      );
    }
    assert.ok(new Ability(ambush, rogue));
    assert.ok(
      new Ability(
        { ...ambush, requiresAura: ["slice-and-dice", "cutthroat"] },
        rogue,
      ),
    );
    // The ability keeps its own frozen copy: the data list cannot change it.
    const given = ["cutthroat"];
    const held = new Ability({ ...ambush, requiresAura: given }, rogue);
    given.push("slice-and-dice");
    assert.deepEqual(held.requiresAura, ["cutthroat"]);
    assert.ok(Object.isFrozen(held.requiresAura));
    assert.ok(
      Object.isFrozen(new Ability(ABILITY_DEFINITIONS[0], rogue).requiresAura),
    );
  });

  it("with more than one id, any one up meets it, and the cast uses a charge of the first that is up", () => {
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    const either = { ...ambush, requiresAura: ["slice-and-dice", "cutthroat"] };
    const sliceAndDice = () => ({ duration: 30 });
    const cases = [
      // [slice and dice up, cutthroat up, castable]
      [false, false, false],
      [true, false, true],
      [false, true, true],
      [true, true, true],
    ];
    for (const [snd, cut, castable] of cases) {
      const { rogue, simulation } = ready("dagger");
      allowCutthroat(rogue);
      const ability = new Ability(either, rogue);
      if (snd) {
        simulation.applyAura(AURAS.sliceAndDice, sliceAndDice());
      }
      if (cut) {
        procCutthroat(simulation);
      }
      const label = JSON.stringify({ snd, cut });
      assert.equal(ability.auraMet(simulation), castable, label);
      assert.equal(ability.auraReachable(rogue), true, label);
      assert.equal(ability.canCast(rogue, simulation), castable, label);
      assert.equal(ability.cast(rogue, simulation) !== null, castable, label);
      // Slice and Dice is listed first and has no charges, so it stays; when
      // it is up it is the aura the cast uses, so cutthroat stays up too.
      assert.equal(simulation.hasAura("slice-and-dice"), snd, label);
      assert.equal(simulation.hasAura("cutthroat"), snd && cut, label);
    }
    // Reachable when any one is granted, and not otherwise.
    const { rogue } = ready("dagger");
    const ability = new Ability(either, rogue);
    assert.equal(ability.auraReachable(rogue), false);
    rogue.grantedAuras.add("slice-and-dice");
    assert.equal(ability.auraReachable(rogue), true);
  });

  it("two charged auras: a cast uses one charge of only the first listed that is up (the coordinator, QA round 1b)", () => {
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    const coldBlood = () => ({ duration: k("coldBlood").duration });
    // [listed, cold blood up, cutthroat up, what is up after the cast]
    const cases = [
      [["cold-blood", "cutthroat"], true, true, ["cutthroat"]],
      [["cold-blood", "cutthroat"], false, true, []],
      [["cold-blood", "cutthroat"], true, false, []],
      [["cutthroat", "cold-blood"], true, true, ["cold-blood"]],
      [["cutthroat", "cold-blood"], true, false, []],
      [["cutthroat", "cold-blood"], false, true, []],
    ];
    for (const [requiresAura, cold, cut, after] of cases) {
      const { rogue, simulation } = ready("dagger");
      allowCutthroat(rogue);
      const ability = new Ability({ ...ambush, requiresAura }, rogue);
      if (cold) {
        simulation.applyAura(AURAS.coldBlood, coldBlood());
      }
      if (cut) {
        procCutthroat(simulation);
      }
      const used = [];
      const consume = simulation.consumeCharge.bind(simulation);
      simulation.consumeCharge = (id, ...rest) => {
        used.push(id);
        return consume(id, ...rest);
      };
      // A miss: Cold Blood's crit has no say in it, so only the requirement
      // uses a charge (Simulation.consumeCharge from Ability.cast).
      simulation.rng = () => 0;
      const label = JSON.stringify({ requiresAura, cold, cut });
      assert.ok(ability.cast(rogue, simulation), label);
      const up = ["cold-blood", "cutthroat"].filter((id) =>
        simulation.hasAura(id),
      );
      assert.deepEqual(up, after, label);
      // Exactly one charge is asked for: the first listed aura that was up.
      const first = requiresAura.find((id) =>
        id === "cold-blood" ? cold : cut,
      );
      assert.deepEqual(used, [first], label);
    }
  });

  it("two auras of three charges, both up: only the first listed loses a charge, the other keeps all three; the reverse order the opposite (Kira, QA round 1b)", () => {
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    const apply = {
      "cold-blood": (simulation) =>
        simulation.applyAura(AURAS.coldBlood, {
          duration: k("coldBlood").duration,
        }),
      cutthroat: (simulation) => procCutthroat(simulation),
    };
    for (const [first, second] of [
      ["cold-blood", "cutthroat"],
      ["cutthroat", "cold-blood"],
    ]) {
      const { rogue, simulation } = ready("dagger");
      allowCutthroat(rogue);
      const ability = new Ability(
        { ...ambush, requiresAura: [first, second] },
        rogue,
      );
      // Three charges each, for this test only, so a charge used shows as a
      // count and not only as the aura ending.
      for (const id of [first, second]) {
        apply[id](simulation);
        simulation.activeBuffs[id].charges = 3;
      }
      // A miss: Cold Blood's crit has no say, so only the requirement uses a
      // charge.
      simulation.rng = () => 0;
      const label = JSON.stringify([first, second]);
      assert.ok(ability.cast(rogue, simulation), label);
      assert.equal(simulation.activeBuffs[first].charges, 2, label);
      assert.equal(simulation.activeBuffs[second].charges, 3, label);
    }
  });

  it("the first aura up pays: when it has no charges the cast uses nothing and does not skip ahead to a later charged aura (Kira, QA round 1b)", () => {
    const ambush = ABILITY_DEFINITIONS.find(({ id }) => id === "ambush");
    const apply = {
      "cold-blood": (simulation) =>
        simulation.applyAura(AURAS.coldBlood, {
          duration: k("coldBlood").duration,
        }),
      cutthroat: (simulation) => procCutthroat(simulation),
    };
    for (const second of ["cutthroat", "cold-blood"]) {
      const { rogue, simulation } = ready("dagger");
      allowCutthroat(rogue);
      const ability = new Ability(
        { ...ambush, requiresAura: ["slice-and-dice", second] },
        rogue,
      );
      simulation.applyAura(AURAS.sliceAndDice, { duration: 30 });
      apply[second](simulation);
      simulation.activeBuffs[second].charges = 3;
      const used = [];
      const consume = simulation.consumeCharge.bind(simulation);
      simulation.consumeCharge = (id, ...rest) => {
        used.push(id);
        return consume(id, ...rest);
      };
      simulation.rng = () => 0;
      assert.ok(ability.cast(rogue, simulation), second);
      // Slice and Dice (duration only) stays up, untouched; the charged aura
      // after it keeps every charge.
      assert.equal(simulation.hasAura("slice-and-dice"), true, second);
      assert.equal(
        simulation.activeBuffs["slice-and-dice"].duration,
        30,
        second,
      );
      assert.equal(
        simulation.activeBuffs["slice-and-dice"].charges,
        null,
        second,
      );
      assert.equal(simulation.activeBuffs[second].charges, 3, second);
      assert.ok(
        used.every((id) => id === "slice-and-dice"),
        second,
      );
    }
  });

  it("Premeditation is unchanged: it requires no aura and casts with no aura up", () => {
    const premeditation = ABILITY_DEFINITIONS.find(
      ({ id }) => id === "premeditation",
    );
    assert.equal(premeditation.requiresAura, undefined);
    assert.equal(premeditation.requiresMainHand, undefined);
    const { rogue, simulation } = ready("sword", {
      abilities: ["premeditation"],
    });
    const host = rotationHost(rogue, simulation);
    assert.equal(host.usable("premeditation"), true);
    assert.equal(host.canCast("premeditation"), true);
    rogue.abilities.premeditation.cast(rogue, simulation);
    assert.equal(simulation.abilityStats.premeditation.casts, 1);
    assert.equal(rogue.comboPoints, k("premeditation").comboPoints);
  });

  it("the ambush constants note says what is enforced", () => {
    const { note, source } = CONSTANTS.ambush;
    assert.match(note, /dagger in the main hand/);
    assert.match(note, /cutthroat aura/);
    assert.doesNotMatch(
      note,
      /Stealth, dagger, and behind requirements are not enforced/,
    );
    assert.equal(source, CONSTANTS.backstab.source);
  });

  it("the aura's one charge is an assumption, read from Cutthroat's \"your next Ambush\"", () => {
    const row = CONSTANTS["cutthroat.aura"];
    assert.deepEqual(row.value, { charges: 1 });
    assert.equal(row.source, "assumption");
    assert.equal(row.retune, true);
    assert.match(row.ref, /Cutthroat/);
    assert.equal(CONSTANTS["stealth.aura"], undefined);
  });
});

describe("an Ambush rule is not warned for (#261: the coordinator dropped the warning)", () => {
  it("a rotation with an Ambush rule validates, and its warnings are those of the rule as any other", () => {
    const withAmbush = rotation("ambush");
    assert.deepEqual(validateRotation(withAmbush), []);
    assert.deepEqual(
      rotationWarnings(withAmbush).filter(
        ({ ability }) => ability === "ambush",
      ),
      [],
    );
    assert.equal(importRotation(exportRotation(withAmbush)).ok, true);
  });
});
