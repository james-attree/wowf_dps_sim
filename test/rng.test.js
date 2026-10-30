import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { createRng, normalizeSeed } from "../js/rng.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { runOnCore } from "../js/core/fight.js";

// The published mulberry32, written out with its literals so a change to
// rng.mulberry32 in data/constants.js is caught here.
function reference(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw(rng, count) {
  return Array.from({ length: count }, () => rng());
}

function fight(seed, { frames = 600, fps = 60 } = {}) {
  const rogue = new Rogue();
  const sim = new Simulation(rogue, { seed });
  for (let frame = 1; frame <= frames; frame++) {
    runOnCore(sim, 1 / fps);
  }
  return sim;
}

function summary(sim) {
  return {
    damageDone: sim.damageDone,
    log: sim.combatLog.map((event) => [event.name, event.status, event.damage]),
  };
}

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    assert.deepEqual(draw(createRng(12345), 50), draw(createRng(12345), 50));
  });

  it("gives different sequences for different seeds", () => {
    assert.notDeepEqual(draw(createRng(1), 20), draw(createRng(2), 20));
    assert.notDeepEqual(draw(createRng(0), 20), draw(createRng(1), 20));
  });

  it("keeps every draw in [0, 1)", () => {
    for (const value of draw(createRng(7), 10_000)) {
      assert.ok(value >= 0 && value < 1, String(value));
    }
  });

  it("is mulberry32, with pinned first values", () => {
    for (const seed of [0, 1, 42, 2 ** 32 - 1]) {
      assert.deepEqual(draw(createRng(seed), 100), draw(reference(seed), 100));
    }
    // Pinned so a platform or engine difference shows up as a failure.
    assert.deepEqual(
      draw(createRng(1), 3),
      [0.6270739405881613, 0.002735721180215478, 0.5274470399599522],
    );
  });

  it("runs independent instances that do not share state", () => {
    const first = createRng(9);
    const second = createRng(9);
    const expected = draw(createRng(9), 6);
    assert.deepEqual(
      [first(), second(), first(), second(), first(), second()],
      [
        expected[0],
        expected[0],
        expected[1],
        expected[1],
        expected[2],
        expected[2],
      ],
    );
  });

  it("starts from rng.defaultSeed when no seed is given", () => {
    assert.deepEqual(
      draw(createRng(), 10),
      draw(createRng(k("rng.defaultSeed")), 10),
    );
  });

  it("wraps a seed to 32 bits and rejects a non-integer", () => {
    assert.equal(normalizeSeed(-1), 4294967295);
    assert.equal(normalizeSeed(2 ** 32 + 5), 5);
    assert.deepEqual(draw(createRng(-1), 5), draw(createRng(2 ** 32 - 1), 5));
    for (const seed of [0.5, Number.NaN, Infinity, "1", null]) {
      assert.throws(() => createRng(seed), {
        name: "RangeError",
        message: `A seed must be an integer; got ${typeof seed === "string" ? JSON.stringify(seed) : String(seed)}.`,
      });
    }
  });
});

describe("Simulation rng", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("owns one rng, shared with the rogue, built from the seed", () => {
    const rogue = new Rogue();
    const sim = new Simulation(rogue, { seed: 99 });
    assert.equal(sim.seed, 99);
    assert.equal(rogue.rng, sim.rng);
    assert.deepEqual(draw(sim.rng, 10), draw(createRng(99), 10));
  });

  it("uses rng.defaultSeed when it is given no seed", () => {
    const sim = new Simulation(new Rogue());
    assert.equal(sim.seed, k("rng.defaultSeed"));
    assert.deepEqual(draw(sim.rng, 10), draw(createRng(), 10));
  });

  it("uses an injected rng in place of the seeded one", () => {
    const rng = () => 0.25;
    const rogue = new Rogue();
    const sim = new Simulation(rogue, { rng });
    assert.equal(sim.rng, rng);
    assert.equal(rogue.rng, rng);
  });

  it("repeats a fight exactly for the same seed", () => {
    const first = fight(2026);
    assert.ok(first.damageDone > 0);
    assert.ok(first.combatLog.length > 0);
    assert.deepEqual(summary(fight(2026)), summary(first));
  });

  it("changes the fight for a different seed", () => {
    assert.notEqual(fight(1).damageDone, fight(2).damageDone);
  });

  it("makes every draw through the simulation's rng, in a fixed order", () => {
    const rogue = new Rogue();
    const seen = [];
    const inner = createRng(5);
    const sim = new Simulation(rogue, {
      rng: () => {
        const value = inner();
        seen.push(value);
        return value;
      },
    });
    for (let frame = 1; frame <= 600; frame++) {
      runOnCore(sim, 1 / 60);
    }
    assert.ok(seen.length > 0);
    assert.equal(sim.damageDone, fight(5).damageDone);
  });

  it("never calls Math.random, including for weapon dice, Eviscerate, attack rolls, and DoT ticks", () => {
    const random = mock.method(Math, "random", () => {
      throw new Error("Math.random should not be called");
    });
    const rogue = new Rogue();
    const sim = new Simulation(rogue, { seed: 3 });
    // Run long enough to swing, cast, and tick Rupture.
    rogue.comboPoints = rogue.maxComboPoints;
    rogue.energy = rogue.maxEnergy;
    const fps = 60;
    const frames = fps * 120;
    for (let frame = 1; frame <= frames; frame++) {
      runOnCore(sim, 1 / fps);
    }
    assert.ok(sim.damageDone > 0);

    rogue.comboPoints = rogue.maxComboPoints;
    assert.equal(Number.isInteger(rogue.abilities.eviscerate.damage()), true);
    assert.equal(random.mock.callCount(), 0);
  });

  it("makes a rogue without a simulation fail loudly instead of drawing unseeded", () => {
    const rogue = new Rogue();
    assert.throws(() => rogue.weapons.mainHand.rollWeaponDamage(), {
      message: /Rogue has no rng/,
    });
  });
});

describe("engine files", () => {
  it("contain no Math.random outside js/main.js", () => {
    const files = readdirSync(new URL("../js/", import.meta.url)).filter(
      (name) => name.endsWith(".js") && name !== "main.js",
    );
    assert.ok(files.includes("rng.js"));
    for (const name of files) {
      const source = readFileSync(
        new URL(`../js/${name}`, import.meta.url),
        "utf8",
      );
      assert.doesNotMatch(source, /Math\.random/, name);
    }
  });

  it("records the rng numbers as engineering constants", () => {
    for (const id of ["rng.defaultSeed", "rng.mulberry32"]) {
      assert.equal(CONSTANTS[id].source, "engineering", id);
      assert.equal(CONSTANTS[id].retune, false, id);
    }
  });
});
