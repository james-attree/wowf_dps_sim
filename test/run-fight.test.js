import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { k } from "../data/constants.js";
import { runFight } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

// Issue #74. runFight({ seed, duration }) builds a rogue and a simulation,
// runs one fight with a single Simulation.run call, and returns plain data.

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const FIVE_MINUTES = 300;
const SHORT_FIGHT = 10;
const LOG_CAP = k("log.maxEvents");
const COUNTERS = ["hits", "crits", "glances", "misses", "dodges", "parries"];

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// Plain data only: no functions, no class instances, no cycles.
function assertPlain(value, path = "result") {
  if (value === null) {
    return;
  }
  const type = typeof value;
  if (type === "number" || type === "string" || type === "boolean") {
    return;
  }
  assert.equal(type, "object", `${path} is ${type}`);
  const proto = Object.getPrototypeOf(value);
  assert.ok(
    proto === Object.prototype || proto === Array.prototype,
    `${path} is not a plain object or array`,
  );
  for (const [key, child] of Object.entries(value)) {
    assertPlain(child, `${path}.${key}`);
  }
}

// Every object reachable from the value, so two results can be checked for
// shared references.
function objectsIn(value, found = new Set()) {
  if (value !== null && typeof value === "object" && !found.has(value)) {
    found.add(value);
    Object.values(value).forEach((child) => objectsIn(child, found));
  }
  return found;
}

describe("runFight result shape", () => {
  const result = runFight({ seed: 1, duration: SHORT_FIGHT });

  it("returns the seed, simulated duration, total damage, DPS, abilities and log", () => {
    assert.deepEqual(Object.keys(result).sort(), [
      "abilities",
      "config",
      "dataVersion",
      "dps",
      "duration",
      "log",
      "seed",
      "totalDamage",
    ]);
    assert.equal(result.seed, 1);
    assert.equal(result.duration, SHORT_FIGHT);
    assert.ok(Number.isFinite(result.totalDamage) && result.totalDamage > 0);
    assert.equal(result.dps, result.totalDamage / result.duration);
    assert.ok(Array.isArray(result.log));
    assert.equal(typeof result.abilities, "object");
  });

  it("is plain data that structuredClone and JSON carry unchanged", () => {
    assertPlain(result);
    assert.deepEqual(structuredClone(result), result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });

  it("reports the seed as an unsigned 32-bit integer", () => {
    assert.equal(runFight({ seed: -1, duration: 1 }).seed, 4294967295);
    assert.deepEqual(runFight({ seed: -1, duration: SHORT_FIGHT }), {
      ...runFight({ seed: 4294967295, duration: SHORT_FIGHT }),
    });
  });
});

describe("runFight seeds of 2^32 and above", () => {
  it("wrap and alias to a small seed, as docs/mechanics.md says", () => {
    const wrap = 2 ** 32;
    const small = runFight({ seed: 5, duration: SHORT_FIGHT });
    assert.deepEqual(
      runFight({ seed: wrap + 5, duration: SHORT_FIGHT }),
      small,
    );
    assert.equal(runFight({ seed: wrap + 5, duration: 1 }).seed, 5);
  });
});

describe("runFight per-ability breakdown", () => {
  const result = runFight({ seed: 1, duration: SHORT_FIGHT });
  const fiveMinutes = runFight({ seed: 1, duration: FIVE_MINUTES });

  it("has damage, casts, hits, crits and misses for every ability that acted", () => {
    const names = Object.keys(result.abilities);
    assert.ok(names.includes("Main-hand"));
    assert.ok(names.includes("Off-hand"));
    assert.ok(names.includes("Sinister Strike"));
    for (const record of Object.values(result.abilities)) {
      for (const field of [
        "damage",
        "casts",
        "hits",
        "crits",
        "misses",
        "ticks",
      ]) {
        assert.ok(Number.isFinite(record[field]) && record[field] >= 0, field);
      }
    }
  });

  it("adds the abilities' damage up to the total damage", () => {
    for (const fight of [result, fiveMinutes]) {
      const damage = sum(Object.values(fight.abilities).map((a) => a.damage));
      assert.ok(
        Math.abs(damage - fight.totalDamage) <= fight.totalDamage * 1e-9,
        `${damage} vs ${fight.totalDamage}`,
      );
    }
  });

  it("counts every attack once: the outcome counters add up to casts", () => {
    for (const name of ["Main-hand", "Off-hand", "Sinister Strike"]) {
      const record = fiveMinutes.abilities[name];
      assert.ok(record.casts > 0, name);
      assert.equal(sum(COUNTERS.map((field) => record[field])), record.casts);
    }
    // White hits can glance and be avoided; the weapon table has no parry yet.
    const mainHand = fiveMinutes.abilities["Main-hand"];
    assert.ok(mainHand.crits > 0);
    assert.ok(mainHand.glances > 0);
    assert.ok(mainHand.misses > 0);
    assert.equal(mainHand.parries, 0);
    assert.equal(mainHand.ticks, 0);
  });

  it("counts a non-attack cast as a cast with no damage", () => {
    // Slice and Dice: the untalented default casts no Adrenaline Rush (#199).
    const dice = fiveMinutes.abilities["Slice and Dice"];
    assert.ok(dice.casts >= 1);
    assert.equal(dice.damage, 0);
    assert.equal(sum(COUNTERS.map((field) => dice[field])), 0);
  });

  it("counts DoT ticks apart from casts, and the application deals no damage", () => {
    // Rupture is not in the placeholder rotation, so cast it by hand on a
    // seed where it lands, then compare the record with the log.
    let sim = null;
    for (let seed = 1; seed <= 50 && !sim; seed++) {
      const candidate = new Simulation(new Rogue(), { seed });
      candidate.rogue.energy = candidate.rogue.maxEnergy;
      candidate.rogue.comboPoints = candidate.rogue.maxComboPoints;
      candidate.rogue.abilities.rupture.cast(candidate.rogue, candidate);
      if (candidate.activeDots.rupture) {
        sim = candidate;
      }
    }
    assert.ok(sim, "no seed landed Rupture");
    sim.run(Math.max(...k("rupture").durationByCp));
    const record = sim.abilityStats.rupture;
    assert.equal(record.casts, 1);
    assert.equal(record.hits, 1);
    assert.equal(record.crits, 0);
    assert.ok(record.ticks > 0);
    assert.ok(record.tickCrits <= record.ticks);
    assert.ok(record.damage > 0);
    const events = sim.combatLog.filter((event) => event.name === "Rupture");
    assert.equal(events.length, record.casts + record.ticks);
    assert.ok(
      Math.abs(sum(events.map((event) => event.damage)) - record.damage) <=
        1e-9 * record.damage,
    );
    assert.equal(sim.activeDots.rupture, undefined);
  });

  it("matches the combat log when the log has not been capped", () => {
    assert.ok(result.log.length < LOG_CAP);
    for (const [name, record] of Object.entries(result.abilities)) {
      const events = result.log.filter((event) => event.name === name);
      assert.equal(events.length, record.casts + record.ticks, name);
      assert.ok(
        Math.abs(sum(events.map((event) => event.damage)) - record.damage) <=
          1e-9 * Math.max(1, record.damage),
        name,
      );
    }
  });
});

describe("runFight combat log", () => {
  it("keeps the newest k('log.maxEvents') events, newest first", () => {
    const { log, duration } = runFight({ seed: 1, duration: FIVE_MINUTES });
    assert.equal(log.length, LOG_CAP);
    for (let index = 1; index < log.length; index++) {
      assert.equal(log[index].id, log[index - 1].id - 1);
      assert.ok(log[index].time <= log[index - 1].time);
    }
    assert.ok(log[0].time <= duration);
    assert.ok(log[0].id >= LOG_CAP);
  });

  it("returns events the engine wrote, with no shared references", () => {
    const { log } = runFight({ seed: 1, duration: SHORT_FIGHT });
    for (const event of log) {
      assert.deepEqual(Object.keys(event).sort(), [
        "damage",
        "icon",
        "id",
        "name",
        "outcome",
        "status",
        "time",
        "type",
      ]);
    }
  });
});

describe("runFight determinism", () => {
  it("returns a deep-equal result for the same seed and duration", () => {
    for (const [seed, duration] of [
      [1, SHORT_FIGHT],
      [7, 90],
      [123456789, FIVE_MINUTES],
      [0, 45.5],
    ]) {
      assert.deepEqual(
        runFight({ seed, duration }),
        runFight({ seed, duration }),
        `seed ${seed}, ${duration}s`,
      );
    }
  });

  it("does not depend on what ran before it", () => {
    const first = runFight({ seed: 5, duration: 60 });
    runFight({ seed: 99, duration: 30 });
    runFight({ seed: 5, duration: 10 });
    assert.deepEqual(runFight({ seed: 5, duration: 60 }), first);
  });

  it("shares no object between two results, or with live engine state", () => {
    const a = runFight({ seed: 3, duration: SHORT_FIGHT });
    const b = runFight({ seed: 3, duration: SHORT_FIGHT });
    const inA = objectsIn(a);
    for (const object of objectsIn(b)) {
      assert.ok(!inA.has(object));
    }
    // Changing one result changes nothing in a fresh run.
    a.abilities["Main-hand"].damage = -1;
    a.log[0].name = "tampered";
    a.log.length = 0;
    assert.deepEqual(runFight({ seed: 3, duration: SHORT_FIGHT }), b);
  });

  it("copies the engine's records instead of exposing them", () => {
    const sims = [];
    const original = Simulation.prototype.run;
    const spy = mock.method(Simulation.prototype, "run", function (duration) {
      sims.push(this);
      return original.call(this, duration);
    });
    try {
      const result = runFight({ seed: 3, duration: SHORT_FIGHT });
      const [sim] = sims;
      assert.notEqual(result.log, sim.combatLog);
      const inside = sim.abilityBreakdown();
      assert.notEqual(result.abilities, sim.abilityStats);
      assert.notEqual(result.abilities, inside);
      for (const event of result.log) {
        assert.ok(!sim.combatLog.includes(event));
      }
      for (const [id, record] of Object.entries(sim.abilityStats)) {
        const copy = result.abilities[sim.abilityNames[id]];
        assert.notEqual(copy, record);
        assert.deepEqual(copy, record);
      }
    } finally {
      spy.mock.restore();
    }
  });

  it("gives different results for different seeds", () => {
    const one = runFight({ seed: 1, duration: 60 });
    const two = runFight({ seed: 2, duration: 60 });
    assert.notDeepEqual(one, two);
    assert.notEqual(one.totalDamage, two.totalDamage);
    assert.notDeepEqual(one.log, two.log);
    const totals = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        (seed) => runFight({ seed, duration: 60 }).totalDamage,
      ),
    );
    assert.equal(totals.size, 8);
  });
});

describe("runFight clock", () => {
  it("makes a single Simulation.run call with the duration", () => {
    const calls = [];
    const original = Simulation.prototype.run;
    const spy = mock.method(Simulation.prototype, "run", function (duration) {
      calls.push(duration);
      return original.call(this, duration);
    });
    try {
      runFight({ seed: 1, duration: 12.5 });
    } finally {
      spy.mock.restore();
    }
    assert.deepEqual(calls, [12.5]);
  });

  it("reports the simulated duration, and DPS as damage over it", () => {
    for (const duration of [FIVE_MINUTES, 90, 0.1, 12.3456789]) {
      const result = runFight({ seed: 1, duration });
      assert.equal(result.duration, duration);
      assert.equal(result.dps, result.totalDamage / duration);
    }
  });

  it("returns an empty fight for a duration of 0", () => {
    const result = runFight({ seed: 1, duration: 0 });
    assert.equal(result.duration, 0);
    assert.equal(result.totalDamage, 0);
    assert.equal(result.dps, 0);
    assert.deepEqual(result.abilities, {});
    assert.deepEqual(result.log, []);
  });
});

describe("runFight, a 5-minute fight", () => {
  const result = runFight({ seed: 1, duration: FIVE_MINUTES });

  it("runs the whole five minutes", () => {
    assert.equal(result.duration, FIVE_MINUTES);
    assert.ok(result.totalDamage > 0);
    assert.equal(result.dps, result.totalDamage / FIVE_MINUTES);
  });

  it("casts the placeholder rotation, less the talent abilities with no talents (#199)", () => {
    assert.equal(result.abilities["Adrenaline Rush"], undefined);
    assert.equal(result.abilities["Blade Flurry"], undefined);
    assert.equal(result.abilities["Cold Blood"], undefined);
    assert.ok(result.abilities["Slice and Dice"].casts >= 1);
    assert.ok(result.abilities["Sinister Strike"].casts > 1);
  });

  it("repeats exactly", () => {
    assert.deepEqual(runFight({ seed: 1, duration: FIVE_MINUTES }), result);
  });
});

describe("runFight inputs", () => {
  it("refuses a duration that is negative, NaN, infinite, or not a number", () => {
    for (const duration of [-1, NaN, Infinity, -Infinity, undefined, "5"]) {
      assert.throws(
        () => runFight({ seed: 1, duration }),
        RangeError,
        String(duration),
      );
    }
  });

  it("needs a seed, and refuses one that is not an integer", () => {
    assert.throws(() => runFight({ duration: 1 }), RangeError);
    for (const seed of [1.5, NaN, Infinity, "1", null]) {
      assert.throws(
        () => runFight({ seed, duration: 1 }),
        RangeError,
        String(seed),
      );
    }
    assert.throws(() => runFight(), RangeError);
  });

  it("refuses a missing or non-object argument with a RangeError", () => {
    assert.throws(() => runFight(null), RangeError);
    assert.throws(() => runFight(undefined), RangeError);
    assert.throws(() => runFight(), /options object/);
    for (const options of [1, "seed", true, Symbol("seed"), () => ({})]) {
      assert.throws(
        () => runFight(options),
        RangeError,
        String(typeof options),
      );
    }
    // An object without a seed or duration still fails on that field.
    assert.throws(() => runFight({}), RangeError);
    assert.throws(() => runFight([]), RangeError);
  });
});

describe("runFight in Node with no DOM", () => {
  // A fresh Node process whose browser globals throw if anything reads them,
  // so an import or a fight that touched one would fail.
  const script = `
    for (const name of [
      "document",
      "window",
      "performance",
      "crypto",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "localStorage",
      "navigator",
    ]) {
      delete globalThis[name];
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error("engine read the global " + name);
        },
      });
    }
    const { runFight } = await import("./js/fight.js");
    process.stdout.write(
      JSON.stringify(runFight({ seed: 1, duration: ${SHORT_FIGHT} })),
    );
  `;

  it("imports and runs with the browser globals poisoned, and matches an in-process run", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: root, maxBuffer: 1 << 24 },
    );
    assert.deepEqual(
      JSON.parse(stdout),
      runFight({ seed: 1, duration: SHORT_FIGHT }),
    );
  });
});
