import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { createFight } from "../js/fight.js";
import {
  CONDITION_PARAMS,
  CONDITION_TYPES,
  OPERATORS,
  assertCondition,
  conditionErrors,
  conditionProblems,
  evaluate,
  evaluateAll,
  compileCondition,
  evaluateTrusted,
} from "../js/rotation-conditions.js";
import { rotationState } from "../js/rotation-state.js";
import { COMBAT_GRANTS } from "./combat-grants.js";
import { referenceBuild } from "./talentsforever.js";
import { runOnCore } from "../js/core/fight.js";
import { POLL_STEP } from "./poll-step.js";

// R2 (#139): the condition vocabulary, docs/rotation.md. The examples are read
// out of the page, so the page cannot drift from the code.
const doc = await readFile(
  new URL("../docs/rotation.md", import.meta.url),
  "utf8",
);
const JSON_BLOCK = /```json\n([\s\S]*?)\n```/g;
const section = (from, to) =>
  doc.slice(doc.indexOf(from), to === undefined ? undefined : doc.indexOf(to));
const blocks = (text) =>
  [...text.matchAll(JSON_BLOCK)].map((match) => JSON.parse(match[1]));
const vocabularyExamples = blocks(
  section("\n## The condition vocabulary", "\n## Examples"),
);
const rotationExamples = blocks(section("\n## Examples"));

// A state by hand: 60 s into a 120 s fight, 40 energy of 100 regenerating 20 a
// second, 3 combo points, Slice and Dice with 8 s left, Rupture on the target,
// Blade Flurry 12 s from ready, no build.
function state(changes = {}) {
  return {
    time: 60,
    duration: 120,
    resources: {
      energy: { value: 40, max: 100, regenPerSecond: 20 },
      comboPoints: { value: 3, max: 5, regenPerSecond: 0 },
    },
    auras: { "slice-and-dice": { remaining: 8, stacks: 1 } },
    debuffs: {
      rupture: { remaining: 6, stacks: 1 },
      "deadly-poison": { remaining: 10, stacks: 3 },
    },
    cooldowns: { "blade-flurry": 12 },
    build: { selected: false },
    granted: [],
    talentAbilities: ["blade-flurry", "adrenaline-rush", "cold-blood"],
    ...changes,
  };
}

const holds = (condition, changes) => evaluate(condition, state(changes));

describe("the vocabulary: the documented examples", () => {
  it("has one example of every type, and nothing else", () => {
    assert.deepEqual(
      vocabularyExamples.map((example) => example.type),
      CONDITION_TYPES,
    );
  });

  it("passes the check, in the vocabulary and in the three rotations", () => {
    const used = rotationExamples.flatMap((rotation) =>
      rotation.rules.flatMap((rule) => rule.conditions),
    );
    assert.ok(used.length > 0);
    for (const condition of [...vocabularyExamples, ...used]) {
      assert.deepEqual(
        conditionProblems(condition),
        [],
        JSON.stringify(condition),
      );
    }
  });

  it("lists the same types as the table, with a row for each", () => {
    for (const type of CONDITION_TYPES) {
      assert.ok(doc.includes(`| \`${type}\``), type);
    }
  });

  it("lists every operator", () => {
    assert.deepEqual(OPERATORS, [">=", ">", "<=", "<", "=="]);
    for (const operator of OPERATORS) {
      assert.ok(doc.includes(`\`${operator}\``), operator);
    }
  });

  it("evaluates every example against a state", () => {
    for (const example of vocabularyExamples) {
      assert.equal(typeof evaluate(example, state()), "boolean", example.type);
    }
  });
});

// Each comparing type: the value it reads, so a boundary is tested at the
// value, one above and one below, for every operator.
describe("the comparing types, at the boundary and for every operator", () => {
  const cases = [
    ["resource", { resource: "energy" }, 40],
    ["resource", { resource: "comboPoints" }, 3],
    ["comboPoints", {}, 3],
    ["auraRemaining", { aura: "slice-and-dice" }, 8],
    ["debuffRemaining", { debuff: "rupture" }, 6],
    ["debuffStacks", { debuff: "deadly-poison" }, 3],
    ["fightTime", {}, 60],
    ["fightTimeRemaining", {}, 60],
    ["energyToCap", {}, 3],
  ];
  for (const [type, params, actual] of cases) {
    const label = `${type} ${JSON.stringify(params)} reading ${actual}`;
    it(label, () => {
      const test = (op, value) => holds({ type, ...params, op, value });
      assert.deepEqual(
        [">=", ">", "<=", "<", "=="].map((op) => test(op, actual)),
        [true, false, true, false, true],
        "at the value",
      );
      assert.deepEqual(
        [">=", ">", "<=", "<", "=="].map((op) => test(op, actual - 1)),
        [true, true, false, false, false],
        "below the value",
      );
      assert.deepEqual(
        [">=", ">", "<=", "<", "=="].map((op) => test(op, actual + 1)),
        [false, false, true, true, false],
        "above the value",
      );
    });
  }

  it("compares exactly: no tolerance either side of a boundary", () => {
    const rule = { type: "auraRemaining", aura: "slice-and-dice", op: "<=" };
    const remaining = (seconds) => ({
      auras: { "slice-and-dice": { remaining: seconds, stacks: 1 } },
    });
    assert.equal(holds({ ...rule, value: 10 }, remaining(10)), true);
    assert.equal(
      holds({ ...rule, value: 10 }, remaining(10 + Number.EPSILON * 8)),
      false,
    );
  });

  it("has no tolerance on == or >= either", () => {
    const at = (op, value, remaining) =>
      holds(
        { type: "auraRemaining", aura: "slice-and-dice", op, value },
        { auras: { "slice-and-dice": { remaining, stacks: 1 } } },
      );
    assert.equal(at("==", 10, 10), true);
    assert.equal(at("==", 10, 10 + 1e-10), false);
    assert.equal(at("==", 10, 10 - 1e-10), false);
    assert.equal(at(">=", 10, 10 - 1e-12), false);
    assert.equal(at(">=", 10, 10), true);
  });
});

describe("what is not up counts as zero", () => {
  const none = { auras: {}, debuffs: {}, cooldowns: {} };
  const refresh = {
    type: "auraRemaining",
    aura: "slice-and-dice",
    op: "<=",
    value: 10,
  };

  it("an aura that is not up has 0 s remaining, so '<= 10' holds", () => {
    assert.equal(holds(refresh, none), true);
    assert.equal(holds({ ...refresh, op: "==", value: 0 }, none), true);
    assert.equal(holds({ ...refresh, op: ">", value: 10 }, none), false);
    assert.equal(holds({ ...refresh, op: ">=", value: 1 }, none), false);
  });

  it("an aura with 11 s left does not, and one with 10 s does", () => {
    const left = (seconds) => ({
      auras: { "slice-and-dice": { remaining: seconds, stacks: 1 } },
    });
    assert.equal(holds(refresh, left(11)), false);
    assert.equal(holds(refresh, left(10)), true);
  });

  it("a debuff that is not up has 0 s and 0 stacks", () => {
    for (const type of ["debuffRemaining", "debuffStacks"]) {
      const condition = { type, debuff: "rupture", op: "==", value: 0 };
      assert.equal(holds(condition, none), true, type);
      assert.equal(holds(condition), false, type);
    }
  });

  it("an aura or a debuff that is not up is not active", () => {
    assert.equal(holds({ type: "auraActive", aura: "blade-flurry" }), false);
    assert.equal(
      holds({ type: "auraActive", aura: "blade-flurry", active: false }),
      true,
    );
    assert.equal(holds({ type: "auraActive", aura: "slice-and-dice" }), true);
    assert.equal(
      holds({ type: "auraActive", aura: "slice-and-dice", active: false }),
      false,
    );
    assert.equal(holds({ type: "debuffActive", debuff: "rupture" }), true);
    assert.equal(
      holds({ type: "debuffActive", debuff: "rupture", active: false }),
      false,
    );
    assert.equal(
      holds({ type: "debuffActive", debuff: "rupture" }, none),
      false,
    );
    assert.equal(
      holds({ type: "debuffActive", debuff: "rupture", active: false }, none),
      true,
    );
  });

  it("an ability with no cooldown running is ready", () => {
    const ready = { type: "cooldownReady", ability: "blade-flurry" };
    assert.equal(holds(ready), false);
    assert.equal(holds({ ...ready, ready: false }), true);
    assert.equal(holds(ready, none), true);
    assert.equal(holds({ ...ready, ready: false }, none), false);
    assert.equal(holds(ready, { cooldowns: { "blade-flurry": 0 } }), true);
    assert.equal(holds({ type: "cooldownReady", ability: "eviscerate" }), true);
  });

  it("an id that merely sounds like a property is not up", () => {
    // The maps are read by own property, so the prototype is not an aura.
    assert.equal(holds({ type: "auraActive", aura: "constructor" }), false);
    assert.equal(
      holds({ type: "cooldownReady", ability: "constructor" }),
      true,
    );
  });
});

describe("energy to cap and the fight clock", () => {
  const toCap = (op, value, energy) =>
    holds(
      { type: "energyToCap", op, value },
      {
        resources: {
          ...state().resources,
          energy: {
            value: energy.value,
            max: 100,
            regenPerSecond: energy.rate,
          },
        },
      },
    );

  it("is the time to fill the pool at the current rate", () => {
    assert.equal(toCap("==", 2.5, { value: 50, rate: 20 }), true);
    assert.equal(toCap("==", 1, { value: 80, rate: 20 }), true);
  });

  it("is 0 at the cap, and above it", () => {
    assert.equal(toCap("==", 0, { value: 100, rate: 20 }), true);
    assert.equal(toCap("==", 0, { value: 120, rate: 20 }), true);
    assert.equal(toCap("==", 0, { value: 100, rate: 0 }), true);
  });

  it("is infinite when the pool does not regenerate", () => {
    assert.equal(toCap(">", 1e9, { value: 50, rate: 0 }), true);
    assert.equal(toCap("==", 0, { value: 50, rate: 0 }), false);
  });

  it("fight time remaining is the length less the time, and not below 0", () => {
    const left = (changes) =>
      holds({ type: "fightTimeRemaining", op: "==", value: 0 }, changes);
    assert.equal(left({ time: 120 }), true);
    assert.equal(left({ time: 130 }), true);
    assert.equal(left({ time: 119 }), false);
  });

  it("fight time remaining is infinite when the length is unknown", () => {
    const unknown = { duration: null };
    assert.equal(
      holds({ type: "fightTimeRemaining", op: ">", value: 1e9 }, unknown),
      true,
    );
    assert.equal(
      holds({ type: "fightTimeRemaining", op: "<", value: 1e9 }, unknown),
      false,
    );
    assert.equal(
      holds({ type: "fightTime", op: "==", value: 60 }, unknown),
      true,
    );
  });
});

describe("abilityGranted and abilityUnlocked", () => {
  const granted = (ability) => ({ type: "abilityGranted", ability });
  const unlocked = (ability) => ({ type: "abilityUnlocked", ability });
  const BF = "blade-flurry";

  it("with no build and no grant, a talent ability is not granted but is unlocked", () => {
    assert.equal(holds(granted(BF)), false);
    assert.equal(holds(unlocked(BF)), true);
    assert.equal(holds(granted("cold-blood")), false);
    assert.equal(holds(unlocked("cold-blood")), true);
  });

  it("with a build that lacks the talent, it is neither", () => {
    const lacks = { build: { selected: true }, granted: ["cold-blood"] };
    assert.equal(holds(granted(BF), lacks), false);
    assert.equal(holds(unlocked(BF), lacks), false);
    assert.equal(holds(granted("cold-blood"), lacks), true);
    assert.equal(holds(unlocked("cold-blood"), lacks), true);
  });

  it("with a build that has the talent, it is both", () => {
    const has = { build: { selected: true }, granted: [BF] };
    assert.equal(holds(granted(BF), has), true);
    assert.equal(holds(unlocked(BF), has), true);
  });

  it("an ability no talent grants is unlocked under any build, and not granted", () => {
    const build = { build: { selected: true } };
    assert.equal(holds(unlocked("sinister-strike"), build), true);
    assert.equal(holds(granted("sinister-strike"), build), false);
  });

  it("a host grant counts with no build", () => {
    const host = { granted: [BF] };
    assert.equal(holds(granted(BF), host), true);
    assert.equal(holds(unlocked(BF), host), true);
  });
});

describe("evaluateAll", () => {
  it("is true for no conditions: the rule always applies", () => {
    assert.equal(evaluateAll([], state()), true);
  });

  it("is an AND", () => {
    const yes = { type: "comboPoints", op: ">=", value: 3 };
    const no = { type: "comboPoints", op: ">=", value: 4 };
    assert.equal(evaluateAll([yes, yes], state()), true);
    assert.equal(evaluateAll([yes, no], state()), false);
    assert.equal(evaluateAll([no, yes], state()), false);
  });
});

describe("bad conditions are rejected with the param named", () => {
  const bad = (condition) => conditionProblems(condition);

  for (const value of [null, undefined, [], "comboPoints", 1, new Map()]) {
    it(`rejects ${String(value)} as a condition`, () => {
      assert.match(bad(value)[0], /must be an object/);
    });
  }

  it("rejects an unknown type, listing the known ones", () => {
    const [problem] = bad({ type: "energyNow" });
    assert.match(problem, /unknown type "energyNow"/);
    for (const type of CONDITION_TYPES) {
      assert.ok(problem.includes(type), type);
    }
    assert.match(bad({})[0], /unknown type undefined/);
    assert.match(bad({ type: 5 })[0], /unknown type 5/);
    assert.match(bad({ type: "__proto__" })[0], /unknown type/);
    assert.match(bad({ type: "toString" })[0], /unknown type/);
  });

  it("rejects a missing param and names it", () => {
    assert.match(bad({ type: "comboPoints", value: 5 })[0], /missing "op"/);
    assert.match(bad({ type: "comboPoints", op: ">=" })[0], /missing "value"/);
    assert.match(
      bad({ type: "auraRemaining", op: "<=", value: 1 })[0],
      /missing "aura"/,
    );
    assert.match(
      bad({ type: "debuffStacks", op: "<=", value: 1 })[0],
      /missing "debuff"/,
    );
    assert.match(bad({ type: "cooldownReady" })[0], /missing "ability"/);
    assert.match(bad({ type: "abilityGranted" })[0], /missing "ability"/);
    assert.match(bad({ type: "abilityUnlocked" })[0], /missing "ability"/);
    assert.match(
      bad({ type: "resource", op: ">=", value: 1 })[0],
      /missing "resource"/,
    );
  });

  it("rejects a bad operator", () => {
    for (const op of ["=", "===", "!=", "=>", ">>", "", 5, null]) {
      const [problem] = bad({ type: "comboPoints", op, value: 5 });
      assert.match(problem, /bad "op"/, String(op));
    }
  });

  it("rejects a value that is not a finite number", () => {
    for (const value of ["5", NaN, Infinity, -Infinity, null, [], {}, true]) {
      const [problem] = bad({ type: "comboPoints", op: ">=", value });
      assert.match(problem, /bad "value"/, String(value));
    }
  });

  it("accepts a number that is negative, zero or fractional", () => {
    for (const value of [-1, 0, 0.5, 1e9]) {
      assert.deepEqual(bad({ type: "comboPoints", op: ">=", value }), []);
    }
  });

  it("rejects an id that is a display name or is not a string", () => {
    for (const id of [
      "Slice and Dice",
      "slice_and_dice",
      "-x",
      "x-",
      "x--y",
      "",
      5,
      null,
    ]) {
      assert.match(
        bad({ type: "auraActive", aura: id })[0],
        /bad "aura".*not a display name/,
        String(id),
      );
    }
    assert.match(
      bad({ type: "debuffActive", debuff: "Rupture" })[0],
      /bad "debuff"/,
    );
    assert.match(
      bad({ type: "cooldownReady", ability: "Blade Flurry" })[0],
      /bad "ability"/,
    );
  });

  it("rejects a resource that is not a pool", () => {
    const [problem] = bad({
      type: "resource",
      resource: "rage",
      op: ">=",
      value: 1,
    });
    assert.match(problem, /bad "resource".*energy, comboPoints/);
    assert.match(
      bad({ type: "resource", resource: "__proto__", op: ">=", value: 1 })[0],
      /bad "resource"/,
    );
  });

  it("rejects a boolean param that is not a boolean", () => {
    for (const active of ["false", 0, null]) {
      assert.match(
        bad({ type: "auraActive", aura: "slice-and-dice", active })[0],
        /bad "active".*true or false/,
        String(active),
      );
    }
    assert.match(
      bad({ type: "cooldownReady", ability: "blade-flurry", ready: "no" })[0],
      /bad "ready"/,
    );
  });

  it("rejects a param the type does not list, and names the allowed ones", () => {
    const [problem] = bad({
      type: "comboPoints",
      op: ">=",
      value: 5,
      aura: "x",
    });
    assert.match(problem, /unknown param "aura"/);
    assert.match(problem, /Allowed: op, value/);
    assert.match(
      bad({ type: "abilityGranted", ability: "cold-blood", active: true })[0],
      /unknown param "active"/,
    );
    assert.match(
      bad({ type: "fightTime", op: ">=", value: 1, debuff: "rupture" })[0],
      /unknown param "debuff"/,
    );
  });

  it("reports every problem in one condition", () => {
    const found = bad({ type: "auraRemaining", aura: "No", op: "?", extra: 1 });
    assert.equal(found.length, 4);
  });

  it("writes each problem as its path from `where`, then the message (#214)", () => {
    const found = conditionProblems(
      { type: "comboPoints" },
      "rules[2].conditions[1]",
    );
    assert.deepEqual(found, [
      'rules[2].conditions[1].op: The comboPoints condition is missing "op": one of >= > <= < ==.',
      'rules[2].conditions[1].value: The comboPoints condition is missing "value": a finite number.',
    ]);
    assert.deepEqual(conditionProblems(5, "x"), [
      "x: The condition must be an object { type, ...params }.",
    ]);
  });

  it("a default prefix names the condition", () => {
    assert.ok(conditionProblems(5)[0].startsWith("The condition "));
  });

  it("a type that is not a string is not a type, even one that coerces to one", () => {
    const found = bad({ type: ["comboPoints"], op: ">=", value: 1 });
    assert.equal(found.length, 1);
    assert.match(found[0], /type/);
  });

  it("a parameter named like a property of Object is unknown", () => {
    const found = bad({ type: "comboPoints", op: ">=", value: 1, toString: 1 });
    assert.equal(found.length, 1);
    assert.match(found[0], /toString/);
  });

  it("assertCondition returns a good condition and throws a RangeError on a bad one", () => {
    const good = { type: "comboPoints", op: ">=", value: 5 };
    assert.equal(assertCondition(good), good);
    assert.throws(
      () => assertCondition({ type: "comboPoints" }),
      (error) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, /Bad rotation condition/);
        assert.match(error.message, /missing "op"/);
        assert.match(error.message, /missing "value"/);
        return true;
      },
    );
  });

  it("evaluate and evaluateAll refuse a bad condition and never guess", () => {
    assert.throws(() => evaluate({ type: "comboPoints" }, state()), RangeError);
    assert.throws(() => evaluate({ type: "nope" }, state()), RangeError);
    assert.throws(
      () =>
        evaluateAll([{ type: "comboPoints", op: ">=", value: 1 }, {}], state()),
      RangeError,
    );
  });

  it("accepts an object with a null prototype as a condition", () => {
    const condition = Object.assign(Object.create(null), {
      type: "comboPoints",
      op: ">=",
      value: 3,
    });
    assert.equal(evaluate(condition, state()), true);
  });
});

describe("evaluate is pure", () => {
  it("changes neither the condition nor the state", () => {
    const frozen = (value) => {
      Object.values(value).forEach((inner) => {
        if (inner !== null && typeof inner === "object") frozen(inner);
      });
      return Object.freeze(value);
    };
    const snapshot = frozen(state());
    for (const example of vocabularyExamples) {
      const condition = Object.freeze({ ...example });
      assert.doesNotThrow(() => evaluate(condition, snapshot), example.type);
    }
    assert.deepEqual(snapshot, state());
  });

  it("gives the same answer every time", () => {
    for (const example of vocabularyExamples) {
      const first = evaluate(example, state());
      for (let i = 0; i < 3; i++) {
        assert.equal(evaluate(example, state()), first, example.type);
      }
    }
  });
});

describe("rotationState builds the view from a fight", () => {
  it("is frozen all the way down", () => {
    const fight = createFight(1);
    runOnCore(fight.simulation, POLL_STEP);
    const view = rotationState(fight.rogue, fight.simulation);
    const check = (value, path) => {
      assert.ok(Object.isFrozen(value), path);
      for (const [key, inner] of Object.entries(value)) {
        if (inner !== null && typeof inner === "object")
          check(inner, `${path}.${key}`);
      }
    };
    check(view, "state");
    assert.throws(() => {
      "use strict";
      view.time = 0;
    }, TypeError);
  });

  it("is frozen unless the host says freeze: false, and then it is the same view", () => {
    const fight = createFight(2);
    fight.simulation.run(20);
    const { rogue, simulation } = fight;
    const frozen = rotationState(rogue, simulation);
    const loose = rotationState(rogue, simulation, { freeze: false });
    assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.resources));
    assert.ok(!Object.isFrozen(loose) && !Object.isFrozen(loose.resources));
    assert.ok(!Object.isFrozen(loose.talentAbilities));
    assert.deepEqual(loose, frozen);
    // Only the exact value false turns the freeze off.
    assert.ok(Object.isFrozen(rotationState(rogue, simulation, { freeze: 0 })));
    // The conditions only read it: evaluating every documented one changes
    // nothing in the unfrozen view.
    const before = structuredClone(loose);
    for (const condition of vocabularyExamples.flat()) {
      evaluateTrusted(condition, loose);
    }
    assert.deepEqual(loose, before);
  });

  it("starts as the fight starts", () => {
    const fight = createFight(1);
    const view = rotationState(fight.rogue, fight.simulation);
    assert.equal(view.time, 0);
    assert.equal(view.duration, null);
    assert.equal(
      view.resources.energy.value,
      fight.rogue.resources.energy.value,
    );
    assert.equal(view.resources.energy.max, k("energy.max"));
    assert.equal(
      view.resources.energy.regenPerSecond,
      k("energy.regenPerSecond"),
    );
    assert.equal(view.resources.comboPoints.value, fight.rogue.comboPoints);
    assert.equal(view.resources.comboPoints.max, k("combo.max"));
    assert.equal(view.resources.comboPoints.regenPerSecond, 0);
    assert.deepEqual(view.auras, {});
    assert.deepEqual(view.debuffs, {});
    assert.deepEqual(view.cooldowns, {});
    assert.deepEqual(view.build, { selected: false });
    assert.deepEqual(view.granted, []);
    assert.ok(view.talentAbilities.includes("blade-flurry"));
    assert.ok(view.talentAbilities.includes("cold-blood"));
    assert.ok(view.talentAbilities.includes("adrenaline-rush"));
    assert.ok(!view.talentAbilities.includes("sinister-strike"));
  });

  it("reads debuffs from the debuff list and auras from the buff list", () => {
    const { rogue, simulation } = createFight(1);
    simulation.activeDebuffs.rupture = {
      id: "rupture",
      duration: 6,
      stacks: 2,
    };
    const view = rotationState(rogue, simulation);
    assert.deepEqual(view.debuffs, { rupture: { remaining: 6, stacks: 2 } });
    assert.deepEqual(view.auras, {});
  });

  it("lists a cooldown only while it has time left", () => {
    const { rogue, simulation } = createFight(1);
    simulation.cooldowns["blade-flurry"] = 0.5;
    simulation.cooldowns["adrenaline-rush"] = 0;
    simulation.cooldowns["cold-blood"] = 3;
    const view = rotationState(rogue, simulation);
    assert.deepEqual(view.cooldowns, { "blade-flurry": 0.5, "cold-blood": 3 });
  });

  it("reports the cap the engine uses, modifiers included", () => {
    const { rogue, simulation } = createFight(1);
    const pool = rogue.resources.energy;
    const base = pool.baseMax;
    Object.defineProperty(pool, "max", { get: () => base + base });
    const view = rotationState(rogue, simulation);
    assert.equal(view.resources.energy.max, base + base);
  });

  it("takes the fight length from options.duration", () => {
    const fight = createFight(1);
    const view = rotationState(fight.rogue, fight.simulation, { duration: 90 });
    assert.equal(view.duration, 90);
    assert.equal(
      evaluate({ type: "fightTimeRemaining", op: "==", value: 90 }, view),
      true,
    );
  });

  it("reports the regeneration rate with Adrenaline Rush up", () => {
    // Granted: the untalented default casts no Adrenaline Rush (#199).
    const fight = createFight(1, undefined, COMBAT_GRANTS);
    const { simulation, rogue } = fight;
    // Step until the rotation has cast it.
    for (
      let i = 0;
      i < 200 && !simulation.activeBuffs["adrenaline-rush"];
      i++
    ) {
      runOnCore(simulation, POLL_STEP);
    }
    assert.ok(
      simulation.activeBuffs["adrenaline-rush"],
      "Adrenaline Rush is up",
    );
    const view = rotationState(rogue, simulation);
    assert.equal(
      view.resources.energy.regenPerSecond,
      k("energy.regenPerSecond") * k("adrenalineRush").regenMultiplier,
    );
    assert.equal(
      view.auras["adrenaline-rush"].remaining,
      simulation.activeBuffs["adrenaline-rush"].duration,
    );
    assert.equal(view.auras["adrenaline-rush"].stacks, 1);
  });

  it("does not change the fight: the same seed gives the same fight", () => {
    const run = (observe) => {
      const fight = createFight(7, { talents: referenceBuild() });
      const steps = Math.round(60 / POLL_STEP);
      for (let i = 0; i < steps; i++) {
        if (observe) {
          rotationState(fight.rogue, fight.simulation, { duration: 60 });
        }
        runOnCore(fight.simulation, POLL_STEP);
      }
      return {
        damage: fight.simulation.damageDone,
        log: fight.simulation.combatLog,
        draws: fight.simulation.rng(),
      };
    };
    assert.deepEqual(run(true), run(false));
  });
});

// The reference build without Blade Flurry, Weapon Expertise (it hangs below
// Flurry) and Adrenaline Rush, the 4 points put in Lightning Reflexes: still a
// legal 51 (test/apply-build.test.js).
function withoutFlurryOrRush() {
  const ranks = {
    ...referenceBuild(),
    "combat.blade-flurry": 0,
    "combat.weapon-expertise": 0,
    "combat.adrenaline-rush": 0,
    "combat.lightning-reflexes": 4,
  };
  return Object.fromEntries(
    Object.entries(ranks).filter(([, rank]) => rank > 0),
  );
}

// The conditions against the code rotation, every step of a real fight: for
// each question the code rotation asks, the vocabulary gives the same answer.
// R3 (#140) proves the whole rotation; this proves the words.
describe("the vocabulary answers what the code rotation asks, step by step", () => {
  const SECONDS = 70;
  const fights = {
    "no build (the default fight)": () => createFight(3),
    "the reference build": () => createFight(3, { talents: referenceBuild() }),
    "a build without Blade Flurry and Adrenaline Rush": () =>
      createFight(3, { talents: withoutFlurryOrRush() }),
    "a host grant of Cold Blood, no build": () =>
      createFight(3, undefined, { abilities: ["cold-blood"] }),
    "a host grant of Blade Flurry, no build": () =>
      createFight(3, undefined, { abilities: ["blade-flurry"] }),
  };

  for (const [label, make] of Object.entries(fights)) {
    it(label, () => {
      const { rogue, simulation } = make();
      const seen = { missing: false, up: false, cp: new Set() };
      const steps = Math.round(SECONDS / POLL_STEP);
      for (let i = 0; i < steps; i++) {
        const view = rotationState(rogue, simulation, { duration: SECONDS });
        const ok = (condition) => evaluate(condition, view);

        // Slice and Dice refresh: missing or at most 10 s left.
        const dice = simulation.activeBuffs["slice-and-dice"];
        const legacyRefresh =
          !dice || dice.duration <= k("rotation.sliceAndDiceRefreshSeconds");
        assert.equal(
          ok({
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<=",
            value: k("rotation.sliceAndDiceRefreshSeconds"),
          }),
          legacyRefresh,
          `Slice and Dice refresh at ${view.time}`,
        );
        assert.equal(
          ok({ type: "auraActive", aura: "slice-and-dice" }),
          dice !== undefined,
        );
        seen[dice ? "up" : "missing"] = true;

        // The finisher combo points.
        const finisher = k("rotation.finisherComboPoints");
        assert.equal(
          ok({ type: "comboPoints", op: ">=", value: finisher }),
          rogue.comboPoints >= finisher,
        );
        assert.equal(
          ok({
            type: "resource",
            resource: "comboPoints",
            op: "==",
            value: rogue.comboPoints,
          }),
          true,
        );
        seen.cp.add(rogue.comboPoints);

        // The build lock and the grant, for each talent ability.
        for (const id of ["blade-flurry", "adrenaline-rush", "cold-blood"]) {
          const ability =
            rogue.abilities[
              Object.keys(rogue.abilities).find(
                (key) => rogue.abilities[key].id === id,
              )
            ];
          // abilityUnlocked is about a selected build: with none it is true,
          // while the engine skips a talent ability no one grants anyway
          // (#199, Rogue.lockedByBuild through host.usable).
          assert.equal(
            ok({ type: "abilityUnlocked", ability: id }),
            !(rogue.build.selected && rogue.lockedByBuild(ability)),
            `unlocked ${id} at ${view.time}`,
          );
          assert.equal(
            ok({ type: "abilityGranted", ability: id }),
            rogue.granted.has(id),
            `granted ${id} at ${view.time}`,
          );
          // The cooldown.
          assert.equal(
            ok({ type: "cooldownReady", ability: id }),
            !(simulation.cooldowns[id] > 0),
            `cooldown ${id} at ${view.time}`,
          );
        }

        // Energy, and the time to fill the pool.
        const energy = rogue.resources.energy;
        assert.equal(
          ok({
            type: "resource",
            resource: "energy",
            op: "==",
            value: energy.value,
          }),
          true,
        );
        const toCap =
          (energy.max - energy.value) / view.resources.energy.regenPerSecond;
        assert.equal(
          ok({ type: "energyToCap", op: "<=", value: Math.max(0, toCap) }),
          true,
        );
        assert.equal(
          ok({ type: "energyToCap", op: "<", value: Math.max(0, toCap) }),
          false,
        );

        // The target: Rupture's marker.
        assert.equal(
          ok({ type: "debuffActive", debuff: "rupture" }),
          simulation.activeDebuffs.rupture !== undefined,
        );

        // The clock.
        assert.equal(
          ok({ type: "fightTime", op: "==", value: simulation.currentTime }),
          true,
        );
        runOnCore(simulation, POLL_STEP);
      }
      // The fight went through both a missing and a running Slice and Dice, and
      // through the finisher combo points, so the comparisons above were not
      // all on one side.
      assert.ok(seen.missing && seen.up, "Slice and Dice came and went");
      assert.ok(
        seen.cp.has(0) && seen.cp.has(k("rotation.finisherComboPoints")),
      );
    });
  }
});

describe("evaluateTrusted (R3, #140)", () => {
  // The interpreter checks a rotation's conditions once, when it loads it, and
  // reads them with evaluateTrusted at every decision point.
  const conditions = [
    ...vocabularyExamples.flat(),
    ...rotationExamples.flatMap((example) =>
      example.rules.flatMap((rule) => rule.conditions),
    ),
  ];

  it("gives evaluate's answer for every documented condition, on states of both kinds", () => {
    assert.ok(conditions.length > 15);
    let trues = 0;
    let falses = 0;
    for (const changes of [
      {},
      { time: 0, duration: null },
      { auras: {}, debuffs: {}, cooldowns: {} },
      { granted: ["cold-blood"], build: { selected: true } },
    ]) {
      for (const condition of conditions) {
        const answer = evaluate(condition, state(changes));
        assert.equal(evaluateTrusted(condition, state(changes)), answer);
        trues += answer ? 1 : 0;
        falses += answer ? 0 : 1;
      }
    }
    assert.ok(trues > 10 && falses > 10);
  });

  it("is what compileCondition makes of a condition, for every documented one", () => {
    let checked = 0;
    for (const changes of [
      {},
      { time: 0, duration: null },
      { auras: {}, debuffs: {}, cooldowns: {} },
      { granted: ["cold-blood"], build: { selected: true } },
    ]) {
      for (const condition of conditions) {
        const compiled = compileCondition(condition);
        assert.equal(
          compiled(state(changes)),
          evaluate(condition, state(changes)),
        );
        checked += 1;
      }
    }
    assert.ok(checked > 60);
  });

  it("is the evaluate that skips the check of the condition", () => {
    const bad = { type: "comboPoints", op: "~", value: 1 };
    assert.throws(() => evaluate(bad, state()), RangeError);
    // Not the RangeError that names the problem: the unknown operator is
    // just a missing comparison.
    assert.throws(() => evaluateTrusted(bad, state()), TypeError);
  });
});

describe("conditionErrors (R4)", () => {
  it("names the param, and conditionProblems is each path and message (#214)", () => {
    const where = "rules[3].conditions[2]";
    const cases = [
      [{ type: "moonPhase" }, "type"],
      [{ type: "comboPoints", op: ">=" }, "value"],
      [{ type: "comboPoints", op: "~", value: 1 }, "op"],
      [{ type: "comboPoints", op: ">=", value: 1, extra: 1 }, "extra"],
      [{ type: "comboPoints", op: ">=", value: NaN }, "value"],
    ];
    for (const [condition, param] of cases) {
      const errors = conditionErrors(condition, where);
      assert.deepEqual(
        errors.map((error) => error.path),
        [`${where}.${param}`],
      );
      assert.deepEqual(
        conditionProblems(condition, where),
        errors.map((error) => `${error.path}: ${error.message}`),
      );
      for (const error of errors) {
        assert.ok(!error.message.includes(where), error.message);
      }
    }
    assert.deepEqual(
      conditionErrors(null, where).map((e) => e.path),
      [where],
    );
    assert.deepEqual(
      conditionErrors({ type: "comboPoints", op: ">=", value: 1 }),
      [],
    );
    assert.doesNotMatch(
      conditionErrors({ type: "comboPoints", op: ">=", value: NaN })[0].message,
      /null/,
    );
  });
});

describe("CONDITION_PARAMS (#214)", () => {
  const KINDS = ["id", "operator", "number", "boolean", "resource"];

  it("has every type, in CONDITION_TYPES order, and is frozen all the way down", () => {
    assert.deepEqual(Object.keys(CONDITION_PARAMS), [...CONDITION_TYPES]);
    assert.ok(Object.isFrozen(CONDITION_PARAMS));
    for (const [type, params] of Object.entries(CONDITION_PARAMS)) {
      assert.ok(Object.isFrozen(params), type);
      for (const [name, spec] of Object.entries(params)) {
        assert.ok(Object.isFrozen(spec), `${type}.${name}`);
        if (spec.values !== undefined) {
          assert.ok(Object.isFrozen(spec.values), `${type}.${name}`);
        }
      }
    }
    assert.throws(() => {
      "use strict";
      CONDITION_PARAMS.comboPoints.value.kind = "id";
    }, TypeError);
  });

  it("each param is { kind, optional?, default?, of?, values? }", () => {
    for (const [type, params] of Object.entries(CONDITION_PARAMS)) {
      for (const [name, spec] of Object.entries(params)) {
        const where = `${type}.${name}`;
        assert.ok(KINDS.includes(spec.kind), where);
        for (const key of Object.keys(spec)) {
          assert.ok(
            ["kind", "optional", "default", "of", "values"].includes(key),
            `${where}.${key}`,
          );
        }
        assert.equal(spec.kind === "id", spec.of !== undefined, where);
        if (spec.of !== undefined) {
          assert.ok(["ability", "aura", "debuff"].includes(spec.of), where);
        }
        assert.equal(
          ["operator", "resource"].includes(spec.kind),
          spec.values !== undefined,
          where,
        );
        if (Object.hasOwn(spec, "default")) {
          assert.equal(spec.optional, true, where);
        }
      }
    }
    assert.deepEqual(CONDITION_PARAMS.comboPoints, {
      op: { kind: "operator", values: [...OPERATORS] },
      value: { kind: "number" },
    });
    assert.deepEqual(CONDITION_PARAMS.auraActive, {
      aura: { kind: "id", of: "aura" },
      active: { kind: "boolean", optional: true, default: true },
    });
    assert.deepEqual(CONDITION_PARAMS.cooldownReady.ability, {
      kind: "id",
      of: "ability",
    });
    assert.deepEqual(CONDITION_PARAMS.resource.resource.values, [
      "energy",
      "comboPoints",
    ]);
  });

  it("is what conditionErrors checks: the required params, and no others", () => {
    for (const [type, params] of Object.entries(CONDITION_PARAMS)) {
      const required = Object.keys(params).filter(
        (name) => params[name].optional !== true,
      );
      const missing = conditionErrors({ type }, "c").map((e) => e.path);
      assert.deepEqual(
        missing,
        required.map((name) => `c.${name}`),
        type,
      );
      const extra = conditionErrors({ type, zz: 1 }, "c").at(-1);
      assert.match(
        extra.message,
        new RegExp(`Allowed: ${Object.keys(params).join(", ")}\\.$`),
        type,
      );
    }
  });
});
