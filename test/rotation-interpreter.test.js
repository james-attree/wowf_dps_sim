import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { abilityCatalogue } from "../js/abilities.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import { rotationProblems } from "../js/rotation-validator.js";

// R3 (#140): the interpreter on its own, with a host written by hand. No Rogue,
// no Simulation, no step: the walk rule of docs/rotation.md.

const rule = (action, ...conditions) => ({ action, conditions });
const rotation = (...rules) => ({
  schemaVersion: 1,
  name: "Test",
  rules,
});
const points = (value) => ({
  type: "comboPoints",
  op: ">=",
  value,
});

// A world of ability ids. `ready` is the ids canCast says yes to, `gcd` the
// ids that start the GCD, `clear` whether the GCD is clear. A cast is logged,
// and `after` may change the state (a cast that spends points, say).
function world({
  ready = [],
  gcd = [],
  clear = true,
  comboPoints = 0,
  after,
} = {}) {
  const log = [];
  const current = { comboPoints };
  const reads = [];
  return {
    log,
    reads,
    current,
    host: {
      state: () => {
        reads.push(current.comboPoints);
        return {
          resources: {
            comboPoints: {
              value: current.comboPoints,
              max: 5,
              regenPerSecond: 0,
            },
          },
        };
      },
      canCast: (id) => ready.includes(id),
      onGcd: (id) => gcd.includes(id),
      gcdClear: () => clear,
      cast: (id) => {
        log.push(id);
        after?.(id, current);
      },
    },
  };
}

const walk = (rules, options) => {
  const w = world(options);
  const result = decide(compileRotation(rotation(...rules)), w.host);
  return { ...result, log: w.log, reads: w.reads };
};

describe("decide: the walk", () => {
  it("casts the first on-GCD rule that holds and can be cast, and stops", () => {
    const result = walk([rule("sinister-strike"), rule("eviscerate")], {
      ready: ["sinister-strike", "eviscerate"],
      gcd: ["sinister-strike", "eviscerate"],
    });
    assert.deepEqual(result, {
      casts: ["sinister-strike"],
      outcome: "cast",
      log: ["sinister-strike"],
      reads: result.reads,
    });
  });

  it("passes over a rule whose conditions do not all hold", () => {
    const rules = [rule("eviscerate", points(5)), rule("sinister-strike")];
    const options = {
      ready: ["eviscerate", "sinister-strike"],
      gcd: ["eviscerate", "sinister-strike"],
    };
    assert.deepEqual(walk(rules, { ...options, comboPoints: 4 }).casts, [
      "sinister-strike",
    ]);
    assert.deepEqual(walk(rules, { ...options, comboPoints: 5 }).casts, [
      "eviscerate",
    ]);
  });

  it("needs every condition of a rule, and an empty list always applies", () => {
    const rules = [
      rule("eviscerate", points(3), {
        type: "comboPoints",
        op: "<=",
        value: 4,
      }),
      rule("sinister-strike"),
    ];
    const options = {
      ready: ["eviscerate", "sinister-strike"],
      gcd: ["eviscerate", "sinister-strike"],
    };
    for (const [comboPoints, cast] of [
      [2, "sinister-strike"],
      [3, "eviscerate"],
      [4, "eviscerate"],
      [5, "sinister-strike"],
    ]) {
      assert.deepEqual(
        walk(rules, { ...options, comboPoints }).casts,
        [cast],
        `${comboPoints}`,
      );
    }
  });

  it("casts an off-GCD ability and goes on to the next rule", () => {
    const result = walk([rule("cold-blood"), rule("eviscerate")], {
      ready: ["cold-blood", "eviscerate"],
      gcd: ["eviscerate"],
    });
    assert.deepEqual(result.casts, ["cold-blood", "eviscerate"]);
    assert.equal(result.outcome, "cast");
  });

  it("skips an off-GCD ability that cannot be cast, with no conditions at all", () => {
    const result = walk([rule("cold-blood"), rule("sinister-strike")], {
      ready: ["sinister-strike"],
      gcd: ["sinister-strike"],
    });
    assert.deepEqual(result.casts, ["sinister-strike"]);
  });

  it("ends the walk, with nothing cast, at an on-GCD rule that holds and cannot be afforded", () => {
    const result = walk([rule("eviscerate"), rule("sinister-strike")], {
      ready: ["sinister-strike"],
      gcd: ["eviscerate", "sinister-strike"],
    });
    assert.deepEqual(result.casts, []);
    assert.equal(result.outcome, "pooling");
    assert.deepEqual(result.log, []);
  });

  it("keeps an off-GCD cast made before the walk ends in pooling", () => {
    const result = walk(
      [rule("cold-blood"), rule("eviscerate"), rule("sinister-strike")],
      {
        ready: ["cold-blood", "sinister-strike"],
        gcd: ["eviscerate", "sinister-strike"],
      },
    );
    assert.deepEqual(result.casts, ["cold-blood"]);
    assert.equal(result.outcome, "pooling");
  });

  it("passes over an on-GCD rule that cannot be cast while the GCD is running", () => {
    const result = walk(
      [rule("eviscerate"), rule("cold-blood"), rule("sinister-strike")],
      {
        ready: ["cold-blood"],
        gcd: ["eviscerate", "sinister-strike"],
        clear: false,
      },
    );
    assert.deepEqual(result.casts, ["cold-blood"]);
    assert.equal(result.outcome, "none");
  });

  it("is none when the walk runs off the end", () => {
    assert.deepEqual(
      walk([rule("eviscerate", points(5))], {
        comboPoints: 0,
        gcd: ["eviscerate"],
      }).outcome,
      "none",
    );
  });

  it("never casts an ability whose conditions fail", () => {
    const result = walk(
      [rule("eviscerate", points(5)), rule("sinister-strike")],
      {
        comboPoints: 0,
        ready: ["eviscerate", "sinister-strike"],
        gcd: ["eviscerate", "sinister-strike"],
      },
    );
    assert.deepEqual(result.casts, ["sinister-strike"]);
    assert.deepEqual(result.log, ["sinister-strike"]);
  });

  it("builds no state view for a rule that cannot matter", () => {
    // The GCD is running and every rule is on-GCD: none can hold the walk and
    // none can be cast, so the state is not even read.
    const busy = walk(
      [rule("eviscerate", points(5)), rule("sinister-strike")],
      {
        comboPoints: 5,
        gcd: ["eviscerate", "sinister-strike"],
        clear: false,
      },
    );
    assert.deepEqual(busy.reads, []);
    assert.equal(busy.outcome, "none");
    // An off-GCD rule is still read for: Cold Blood below them can be cast.
    const below = walk(
      [rule("eviscerate", points(5)), rule("cold-blood", points(5))],
      {
        comboPoints: 5,
        ready: ["cold-blood"],
        gcd: ["eviscerate"],
        clear: false,
      },
    );
    assert.deepEqual(below.reads, [5]);
    assert.deepEqual(below.casts, ["cold-blood"]);
    // The GCD clear and an on-GCD rule that cannot be cast: its conditions
    // decide whether the walk pools for it.
    const clear = walk([rule("eviscerate", points(5))], {
      comboPoints: 5,
      gcd: ["eviscerate"],
    });
    assert.deepEqual(clear.reads, [5]);
    assert.equal(clear.outcome, "pooling");
  });

  it("asks canCast only of a rule whose conditions hold", () => {
    const asked = [];
    const probe = world({
      comboPoints: 2,
      gcd: ["eviscerate", "sinister-strike"],
    });
    probe.host.canCast = (id) => {
      asked.push(id);
      return false;
    };
    const result = decide(
      compileRotation(
        rotation(
          rule("cold-blood", points(5)),
          rule("eviscerate", points(5)),
          rule("sinister-strike", points(2)),
        ),
      ),
      probe.host,
    );
    assert.deepEqual(asked, ["sinister-strike"]);
    assert.equal(result.outcome, "pooling");
  });

  it("asks a host which abilities start the GCD once, not at every decision point", () => {
    const asked = [];
    const probe = world({
      ready: ["sinister-strike"],
      gcd: ["sinister-strike"],
    });
    const { onGcd } = probe.host;
    probe.host.onGcd = (id) => {
      asked.push(id);
      return onGcd(id);
    };
    const compiled = compileRotation(
      rotation(rule("cold-blood"), rule("sinister-strike")),
    );
    decide(compiled, probe.host);
    decide(compiled, probe.host);
    assert.deepEqual(asked, ["cold-blood", "sinister-strike"]);
    // Another host is asked afresh and its answers are the ones used.
    const other = world({ ready: ["cold-blood"], gcd: ["cold-blood"] });
    assert.deepEqual(decide(compiled, other.host), {
      casts: ["cold-blood"],
      outcome: "cast",
    });
    assert.deepEqual(decide(compiled, probe.host).casts, ["sinister-strike"]);
  });

  it("returns results that are shared when nothing was cast, and frozen", () => {
    const idle = decide(
      compileRotation(rotation(rule("eviscerate", points(5)))),
      world({ gcd: ["eviscerate"] }).host,
    );
    assert.ok(Object.isFrozen(idle) && Object.isFrozen(idle.casts));
    assert.deepEqual(idle, { casts: [], outcome: "none" });
    const pooling = decide(
      compileRotation(rotation(rule("eviscerate"))),
      world({ gcd: ["eviscerate"] }).host,
    );
    assert.ok(Object.isFrozen(pooling) && Object.isFrozen(pooling.casts));
    assert.deepEqual(pooling, { casts: [], outcome: "pooling" });
    const cast = decide(
      compileRotation(rotation(rule("sinister-strike"))),
      world({ ready: ["sinister-strike"], gcd: ["sinister-strike"] }).host,
    );
    assert.deepEqual(cast, { casts: ["sinister-strike"], outcome: "cast" });
    assert.ok(!Object.isFrozen(cast));
  });

  it("reads the state again after a cast, and only then", () => {
    const rules = [
      rule("cold-blood", points(5)),
      rule("eviscerate", points(5)),
      rule("sinister-strike"),
    ];
    // Cold Blood spends the points, so the Eviscerate rule no longer holds.
    const spent = walk(rules, {
      comboPoints: 5,
      ready: ["cold-blood", "eviscerate", "sinister-strike"],
      gcd: ["eviscerate", "sinister-strike"],
      after: (id, current) => {
        if (id === "cold-blood") {
          current.comboPoints = 0;
        }
      },
    });
    assert.deepEqual(spent.casts, ["cold-blood", "sinister-strike"]);
    // One read at the start and one after the cast.
    assert.deepEqual(spent.reads, [5, 0]);
    // With no cast, the state is read once for the whole walk.
    const idle = walk(rules, {
      comboPoints: 5,
      ready: ["sinister-strike"],
      gcd: ["eviscerate", "sinister-strike"],
    });
    assert.deepEqual(idle.reads, [5]);
    assert.equal(idle.outcome, "pooling");
  });
});

describe("compileRotation", () => {
  it("returns a frozen copy, so the original can change after", () => {
    const original = rotation(rule("sinister-strike"));
    const compiled = compileRotation(original);
    assert.notEqual(compiled, original);
    assert.deepEqual(compiled, original);
    assert.ok(Object.isFrozen(compiled));
    assert.ok(Object.isFrozen(compiled.rules[0].conditions));
    original.rules[0].action = "eviscerate";
    assert.equal(compiled.rules[0].action, "sinister-strike");
  });

  it("rejects a bad rotation with every problem named by path", () => {
    const bad = rotation(
      rule("sinister-strike", { type: "comboPoints", op: "~", value: 1 }),
      rule("nonsense"),
    );
    assert.throws(
      () => compileRotation(bad),
      (error) => {
        assert.equal(error.name, "RangeError");
        assert.match(error.message, /^Bad rotation:\n/);
        assert.match(error.message, /rules\[0\]\.conditions\[0\]/);
        assert.match(
          error.message,
          /rules\[1\]\.action "nonsense" is not an ability in the spell data/,
        );
        return true;
      },
    );
  });

  it("reports a wrong shape and nothing else", () => {
    const problems = rotationProblems({ schemaVersion: 1, name: "X" });
    assert.ok(problems.length > 0);
    assert.ok(problems.every((problem) => !problem.includes("conditions[")));
    assert.throws(() => compileRotation(null), RangeError);
    assert.throws(() => compileRotation(undefined), RangeError);
  });

  it("takes an ability id, never a display name", () => {
    for (const definition of ABILITY_DEFINITIONS) {
      const { name } = abilityCatalogue.get(definition.id);
      assert.deepEqual(
        rotationProblems(rotation(rule(definition.id))),
        [],
        definition.id,
      );
      if (name !== definition.id) {
        assert.equal(
          rotationProblems(rotation(rule(name))).length,
          1,
          `${name} is not an id`,
        );
      }
    }
    assert.ok(rotationProblems(rotation(rule("Sinister Strike"))).length > 0);
  });

  it("rejects a condition the vocabulary does not have, or with a bad param", () => {
    assert.ok(
      rotationProblems(rotation(rule("eviscerate", { type: "moonPhase" })))
        .length > 0,
    );
    assert.ok(
      rotationProblems(
        rotation(rule("eviscerate", { type: "comboPoints", op: ">=" })),
      ).length > 0,
    );
  });

  it("accepts the rule limits and rejects past them", () => {
    const many = Array.from({ length: 50 }, () => rule("sinister-strike"));
    assert.deepEqual(rotationProblems(rotation(...many)), []);
    assert.ok(
      rotationProblems(rotation(...many, rule("eviscerate"))).length > 0,
    );
  });
});

describe("decide: what it takes", () => {
  it("refuses a rotation that was not compiled", () => {
    const w = world();
    assert.throws(
      () => decide(rotation(rule("sinister-strike")), w.host),
      TypeError,
    );
    assert.throws(
      () =>
        decide(
          JSON.parse(
            JSON.stringify(compileRotation(rotation(rule("sinister-strike")))),
          ),
          w.host,
        ),
      TypeError,
    );
  });

  it("is the same on every call: the walk holds no state of its own", () => {
    const compiled = compileRotation(
      rotation(rule("eviscerate", points(5)), rule("sinister-strike")),
    );
    const options = {
      ready: ["sinister-strike"],
      gcd: ["eviscerate", "sinister-strike"],
    };
    const outcomes = [];
    for (const comboPoints of [5, 0, 5, 0]) {
      const w = world({ ...options, comboPoints });
      outcomes.push(decide(compiled, w.host).outcome);
    }
    assert.deepEqual(outcomes, ["pooling", "cast", "pooling", "cast"]);
  });

  it("names no step, frame or tick", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../js/rotation-interpreter.js", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\/.*$/gm, "");
    for (const word of [
      "step",
      "frame",
      "tick",
      "dt",
      "Math.random",
      "document",
      "window",
    ]) {
      assert.doesNotMatch(code, new RegExp(`\\b${word}\\b`), word);
    }
  });
});
