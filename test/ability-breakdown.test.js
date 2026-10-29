import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  BREAKDOWN_OUTCOMES,
  BatchBreakdown,
  FightBreakdown,
  breakdownFromEvents,
} from "../js/ability-breakdown.js";
import { BatchRunner, deriveSeed, runBatch } from "../js/batch-runner.js";
import { runFight } from "../js/fight.js";
import { CompensatedSum, RunningStats } from "../js/running-stats.js";
import { SimRunner } from "../js/sim-runner.js";
import { referenceBuild } from "./talentsforever.js";

// Issue #145 (S2): the per-ability breakdown. These are contract tests: they
// read results and events, never an engine step, so they have to pass
// unchanged on the Phase 3.5 engine. Fights are short so the file runs fast.

const FIGHT = 30; // seconds per fight in these tests
const TALENTED = {
  talents: referenceBuild(),
  poisons: { mainHand: "instant", offHand: "deadly" },
};
// Relative tolerance for sums of the same damage added in another order.
const ROUNDING = 1e-12;

function close(actual, expected, message) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= ROUNDING * scale,
    `${message}: ${actual} vs ${expected}`,
  );
}

// One fight with a FightBreakdown attached, and every event it heard.
function observed(seed, config = TALENTED, duration = FIGHT) {
  const runner = new SimRunner({ seed, duration, config });
  const breakdown = new FightBreakdown();
  breakdown.attach(runner);
  const events = [];
  runner.on("*", (event) => events.push(event));
  runner.run();
  runner.advance(Infinity);
  return {
    runner,
    result: runner.result,
    summary: breakdown.summary(),
    events,
  };
}

function hit(ability, outcome, damage, extra = {}) {
  return {
    type: "hit",
    ability,
    name: `Name of ${ability}`,
    icon: null,
    origin: "yellow",
    outcome,
    damage,
    ...extra,
  };
}

function cast(ability) {
  return { type: "cast", ability, name: `Name of ${ability}`, icon: null };
}

describe("one fight", () => {
  it("totals exactly what the fight dealt, and the rows add up to it", () => {
    for (const seed of [1, 2, 3]) {
      const { result, summary } = observed(seed);
      assert.equal(summary.totalDamage, result.totalDamage, `seed ${seed}`);
      const rows = summary.rows.reduce((sum, row) => sum + row.damage, 0);
      close(rows, result.totalDamage, `rows of seed ${seed}`);
      const shares = summary.rows.reduce((sum, row) => sum + row.share, 0);
      close(shares, 1, `shares of seed ${seed}`);
    }
  });

  it("agrees with the engine's own per-ability records", () => {
    // result.abilities is the engine's count, keyed by name; the breakdown is
    // built from the events alone. Two roads to the same numbers.
    const { result, summary } = observed(4, TALENTED, 60);
    const counters = {
      hit: "hits",
      crit: "crits",
      glancing: "glances",
      miss: "misses",
      dodge: "dodges",
      parry: "parries",
      block: "blocks",
    };
    assert.equal(summary.rows.length, Object.keys(result.abilities).length);
    for (const row of summary.rows) {
      const record = result.abilities[row.name];
      assert.ok(record, row.id);
      close(row.damage, record.damage, `${row.id} damage`);
      assert.equal(row.attempts, record.casts, `${row.id} attempts`);
      assert.equal(row.ticks.count, record.ticks, `${row.id} ticks`);
      assert.equal(row.ticks.crits, record.tickCrits, `${row.id} tick crits`);
      for (const [outcome, counter] of Object.entries(counters)) {
        assert.equal(
          row.outcomes[outcome],
          record[counter],
          `${row.id} ${outcome}`,
        );
      }
      const counted = Object.values(row.outcomes).reduce((a, b) => a + b, 0);
      assert.equal(counted, row.attempts, `${row.id} outcomes add up`);
    }
  });

  it("counts cast events as casts, so swings and poisons have none", () => {
    const { summary, events } = observed(5);
    const casts = events.filter((event) => event.type === "cast");
    assert.equal(
      summary.rows.reduce((sum, row) => sum + row.casts, 0),
      casts.length,
    );
    const byId = Object.fromEntries(summary.rows.map((row) => [row.id, row]));
    for (const id of ["main-hand", "off-hand", "instant-poison"]) {
      assert.equal(byId[id].casts, 0, id);
    }
    assert.equal(byId["main-hand"].origin, "white");
    assert.equal(byId["instant-poison"].origin, "poison");
    assert.ok(byId["sinister-strike"].casts > 0);
    assert.ok(byId["deadly-poison"].ticks.count > 0, "the fight has ticks");
  });

  it("lists rows by id and changes nothing about the fight", () => {
    for (const seed of [6, 7]) {
      const { result, summary } = observed(seed);
      const ids = summary.rows.map((row) => row.id);
      assert.deepEqual(ids, [...ids].sort());
      assert.deepEqual(
        result,
        runFight({ seed, duration: FIGHT, config: TALENTED }),
      );
    }
  });

  it("gives the same summary from recorded events", () => {
    const { summary, events } = observed(8);
    assert.deepEqual(breakdownFromEvents(events), summary);
    assert.deepEqual(breakdownFromEvents(events.values()), summary);
  });

  it("can be read mid-fight and stops counting once unsubscribed", () => {
    const runner = new SimRunner({
      seed: 9,
      duration: FIGHT,
      config: TALENTED,
    });
    const breakdown = new FightBreakdown();
    const off = breakdown.attach(runner);
    runner.run();
    runner.advance(FIGHT / 3); // seconds of fight
    const early = breakdown.summary();
    assert.ok(early.totalDamage > 0);
    off();
    runner.advance(Infinity);
    assert.deepEqual(breakdown.summary(), early);
    assert.ok(runner.result.totalDamage > early.totalDamage);
  });

  it("counts by outcome, splits ticks from attempts and pools the averages", () => {
    const summary = breakdownFromEvents([
      cast("b"),
      hit("b", "hit", 10),
      hit("b", "crit", 30),
      hit("b", "miss", 0),
      hit("b", "glancing", 5, { origin: "white" }),
      hit("a", "hit", 0, { origin: "poison" }),
      hit("a", "crit", 4, { origin: "dot" }),
      hit("a", "hit", 2, { origin: "dot" }),
      cast("c"),
      hit("c", "cast", 0),
      { type: "state", state: "running" },
    ]);
    assert.equal(summary.totalDamage, 51);
    assert.deepEqual(
      summary.rows.map((row) => row.id),
      ["a", "b", "c"],
    );
    const [a, b, c] = summary.rows;
    assert.deepEqual(b, {
      id: "b",
      name: "Name of b",
      icon: null,
      origin: "yellow",
      casts: 1,
      attempts: 4,
      outcomes: {
        hit: 1,
        crit: 1,
        glancing: 1,
        miss: 1,
        dodge: 0,
        parry: 0,
        block: 0,
        cast: 0,
      },
      hits: 3,
      directDamage: 45,
      averageHit: 15,
      ticks: { count: 0, crits: 0, damage: 0, average: null },
      damage: 45,
      share: 45 / 51,
    });
    assert.equal(a.origin, "poison");
    assert.equal(a.attempts, 1);
    assert.equal(a.hits, 0);
    assert.equal(a.averageHit, null);
    assert.deepEqual(a.ticks, { count: 2, crits: 1, damage: 6, average: 3 });
    assert.equal(a.damage, 6);
    assert.equal(c.outcomes.cast, 1);
    assert.equal(c.casts, 1);
    assert.equal(c.share, 0);
  });

  it("sorts rows by id whatever order they came in, and keeps the first icon", () => {
    const ids = ["e", "d", "c", "b", "a", "aa", "B"];
    const summary = breakdownFromEvents(
      ids.map((id) => hit(id, "hit", 1, { icon: `icon-${id}` })),
    );
    assert.deepEqual(
      summary.rows.map((row) => row.id),
      ["B", "a", "aa", "b", "c", "d", "e"],
    );
    assert.equal(summary.rows[0].icon, "icon-B");
    const batch = new BatchBreakdown();
    batch.add(summary);
    assert.deepEqual(
      batch.summary().rows.map((row) => [row.id, row.icon]),
      summary.rows.map((row) => [row.id, row.icon]),
    );
  });

  it("names a row with only ticks a dot, and keeps an outcome it does not know", () => {
    const summary = breakdownFromEvents([
      hit("a", "hit", 3, { origin: "dot" }),
      hit("b", "resist", 0),
    ]);
    assert.equal(summary.rows[0].origin, "dot");
    assert.equal(summary.rows[0].attempts, 0);
    assert.equal(summary.rows[1].outcomes.resist, 1);
    assert.equal(summary.rows[1].attempts, 1);
  });

  it("gives an empty fight no rows and no share", () => {
    assert.deepEqual(breakdownFromEvents([]), { totalDamage: 0, rows: [] });
    const summary = breakdownFromEvents([cast("a")]);
    assert.equal(summary.rows[0].share, 0);
    assert.equal(summary.rows[0].averageHit, null);
  });

  it("refuses what is not an event, and a hit without finite damage", () => {
    const breakdown = new FightBreakdown();
    for (const bad of [null, 3, "hit"]) {
      assert.throws(() => breakdown.observe(bad), TypeError, String(bad));
    }
    for (const damage of [NaN, Infinity, "3", undefined]) {
      assert.throws(
        () => breakdown.observe(hit("a", "hit", damage)),
        RangeError,
        String(damage),
      );
    }
    assert.deepEqual(breakdown.summary(), { totalDamage: 0, rows: [] });
  });

  it("returns fresh data on every call", () => {
    const breakdown = new FightBreakdown();
    breakdown.observe(hit("a", "hit", 1));
    const first = breakdown.summary();
    first.rows[0].outcomes.hit = 99;
    first.rows[0].ticks.count = 99;
    assert.equal(breakdown.summary().rows[0].outcomes.hit, 1);
    assert.equal(breakdown.summary().rows[0].ticks.count, 0);
  });

  it("lists the outcomes of docs/events.md", () => {
    assert.deepEqual(BREAKDOWN_OUTCOMES, [
      "hit",
      "crit",
      "glancing",
      "miss",
      "dodge",
      "parry",
      "block",
      "cast",
    ]);
    assert.ok(Object.isFrozen(BREAKDOWN_OUTCOMES));
  });
});

describe("a batch of fights", () => {
  function fights(...summaries) {
    const batch = new BatchBreakdown();
    for (const summary of summaries) {
      batch.add(summary);
    }
    return batch;
  }

  it("sums every count and pools the averages", () => {
    const one = breakdownFromEvents([
      cast("a"),
      hit("a", "hit", 10),
      hit("a", "crit", 0, { origin: "dot" }),
    ]);
    const two = breakdownFromEvents([
      cast("a"),
      cast("a"),
      hit("a", "crit", 40),
      hit("a", "miss", 0),
      hit("a", "hit", 6, { origin: "dot" }),
    ]);
    const summary = fights(one, two).summary();
    assert.equal(summary.fights, 2);
    assert.equal(summary.totalDamage, 56);
    const [row] = summary.rows;
    assert.equal(row.casts, 3);
    assert.equal(row.attempts, 3);
    assert.deepEqual(
      [row.outcomes.hit, row.outcomes.crit, row.outcomes.miss],
      [1, 1, 1],
    );
    assert.equal(row.hits, 2);
    assert.equal(row.directDamage, 50);
    // Pooled: 50 over 2 hits, not the mean of 10 and 40 per fight.
    assert.equal(row.averageHit, 25);
    assert.deepEqual(row.ticks, { count: 2, crits: 1, damage: 6, average: 3 });
    assert.equal(row.damage, 56);
    assert.equal(row.share, 1);
    assert.equal(row.perFight.damage.count, 2);
    assert.equal(row.perFight.damage.mean, 28);
    assert.equal(row.perFight.casts.mean, 1.5);
    assert.equal(row.perFight.casts.min, 1);
  });

  it("counts a fight without the row as zero, before and after it appears", () => {
    const empty = breakdownFromEvents([hit("b", "hit", 1)]);
    const withA = breakdownFromEvents([hit("a", "hit", 9), hit("b", "hit", 1)]);
    const summary = fights(empty, withA, empty).summary();
    const [a, b] = summary.rows;
    assert.equal(a.id, "a");
    const expected = new RunningStats();
    for (const value of [0, 9, 0]) {
      expected.add(value);
    }
    assert.deepEqual(a.perFight.damage, expected.summary());
    assert.equal(a.perFight.casts.mean, 0);
    assert.equal(b.perFight.damage.count, 3);
    assert.equal(b.perFight.damage.stdDev, 0);
    close(a.share + b.share, 1, "shares");
  });

  it("depends on the fights, not on when a row first showed up", () => {
    const x = breakdownFromEvents([hit("x", "hit", 2), cast("x")]);
    const y = breakdownFromEvents([hit("y", "crit", 5)]);
    const xy = breakdownFromEvents([hit("y", "crit", 5), hit("x", "hit", 2)]);
    // Same fights, same order: the same result however the rows arrived.
    assert.deepEqual(
      fights(x, xy, y).summary(),
      fights(
        x,
        breakdownFromEvents([hit("x", "hit", 2), hit("y", "crit", 5)]),
        y,
      ).summary(),
    );
  });

  it("adds the damage with compensated sums", () => {
    // Plain addition loses the small values next to the big ones.
    const big = breakdownFromEvents([hit("a", "hit", 1e16)]);
    const small = breakdownFromEvents([hit("a", "hit", 1)]);
    const summary = fights(big, small, small).summary();
    assert.equal(summary.totalDamage, 1e16 + 2);
    assert.equal(summary.rows[0].damage, 1e16 + 2);
    assert.equal(summary.rows[0].directDamage, 1e16 + 2);
    assert.equal(1e16 + 1 + 1, 1e16, "plain addition would lose them");
  });

  it("gives no share to a batch that dealt no damage, and fresh data on every call", () => {
    const batch = fights(
      breakdownFromEvents([cast("a")]),
      breakdownFromEvents([]),
    );
    const first = batch.summary();
    assert.equal(first.rows[0].share, 0);
    assert.equal(first.rows[0].averageHit, null);
    first.rows[0].outcomes.cast = 99;
    first.rows[0].ticks.count = 99;
    assert.equal(batch.summary().rows[0].outcomes.cast, 0);
    assert.equal(batch.summary().rows[0].ticks.count, 0);
  });

  it("is empty with no fights", () => {
    assert.deepEqual(new BatchBreakdown().summary(), {
      fights: 0,
      totalDamage: 0,
      rows: [],
    });
    assert.equal(new BatchBreakdown().fights, 0);
  });

  it("refuses what is not a fight summary", () => {
    const batch = new BatchBreakdown();
    for (const bad of [
      null,
      7,
      {},
      { rows: [] },
      { totalDamage: 1 },
      { totalDamage: NaN, rows: [] },
    ]) {
      assert.throws(() => batch.add(bad), TypeError, JSON.stringify(bad));
    }
    assert.equal(batch.fights, 0);
  });
});

describe("the batch runner's breakdown", () => {
  const ITERATIONS = 6;
  const options = {
    seed: 11,
    iterations: ITERATIONS,
    duration: FIGHT,
    config: TALENTED,
  };

  it("is the breakdown of each iteration's fight, added in index order", () => {
    const result = runBatch(options);
    const expected = new BatchBreakdown();
    for (let index = 0; index < ITERATIONS; index += 1) {
      const { summary, result: fight } = observed(
        deriveSeed(options.seed, index),
      );
      assert.equal(summary.totalDamage, fight.totalDamage);
      expected.add(summary);
    }
    assert.deepEqual(result.breakdown, expected.summary());
    assert.equal(result.breakdown.fights, result.completed);
    // Its per-fight damage is the batch's DPS times the fight length.
    const total = result.breakdown.rows.reduce(
      (sum, row) => sum + row.perFight.damage.mean,
      0,
    );
    close(total / FIGHT, result.summary.mean, "mean DPS");
  });

  it("does not depend on how the iterations are sliced", () => {
    const whole = runBatch(options).breakdown;
    for (const sizes of [[1], [2], [4, 1], [5, Infinity]]) {
      const runner = new BatchRunner(options);
      runner.run();
      let turn = 0;
      while (runner.state === "running") {
        runner.advance(sizes[turn % sizes.length]);
        turn += 1;
      }
      assert.deepEqual(runner.result.breakdown, whole, JSON.stringify(sizes));
    }
  });

  it("covers the completed iterations of a cancelled batch", () => {
    const runner = new BatchRunner(options);
    runner.run();
    runner.advance(2);
    runner.cancel();
    assert.equal(runner.result.breakdown.fights, 2);
    const expected = new BatchBreakdown();
    for (let index = 0; index < 2; index += 1) {
      expected.add(observed(deriveSeed(options.seed, index)).summary);
    }
    assert.deepEqual(runner.result.breakdown, expected.summary());
  });

  it("starts again from nothing on a repeat run", () => {
    const runner = new BatchRunner(options);
    runner.run();
    runner.advance(Infinity);
    const first = runner.result.breakdown;
    runner.run();
    runner.advance(Infinity);
    assert.deepEqual(runner.result.breakdown, first);
    assert.equal(runner.result.breakdown.fights, ITERATIONS);
  });

  it("is plain data with no step or frame in its keys", () => {
    const { breakdown } = runBatch(options);
    assert.deepEqual(JSON.parse(JSON.stringify(breakdown)), breakdown);
    assert.deepEqual(Object.keys(breakdown), ["fights", "totalDamage", "rows"]);
    assert.deepEqual(Object.keys(breakdown.rows[0]), [
      "id",
      "name",
      "icon",
      "origin",
      "casts",
      "attempts",
      "outcomes",
      "hits",
      "directDamage",
      "averageHit",
      "ticks",
      "damage",
      "share",
      "perFight",
    ]);
    const keys = new Set();
    const walk = (value) => {
      if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(breakdown);
    assert.doesNotMatch([...keys].join(" "), /step|frame/i);
  });
});

describe("compensated sums", () => {
  it("keeps what plain addition loses", () => {
    const sum = new CompensatedSum();
    for (const value of [1e16, 1, 1, -1e16]) {
      sum.add(value);
    }
    assert.equal(sum.value, 2);
    const other = new CompensatedSum();
    for (const value of [1, 1e100, 1, -1e100]) {
      other.add(value);
    }
    assert.equal(other.value, 2);
    assert.equal(new CompensatedSum().value, 0);
  });

  it("refuses a value that is not a finite number", () => {
    const sum = new CompensatedSum();
    for (const bad of [NaN, Infinity, -Infinity, "1", null]) {
      assert.throws(() => sum.add(bad), RangeError, String(bad));
    }
    assert.equal(sum.value, 0);
  });
});

describe("purity", () => {
  it("imports only the statistics, and reads no clock, randomness or engine", async () => {
    for (const [file, allowed] of [
      ["../js/ability-breakdown.js", ["./running-stats.js"]],
      ["../js/running-stats.js", ["../data/constants.js"]],
    ]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map(
        (match) => match[1],
      );
      assert.deepEqual(imports, allowed, file);
      for (const banned of [
        /\bDate\b/,
        /performance\./,
        /Math\.random/,
        /setTimeout/,
        /\bPromise\b/,
        /\.simulation\b/,
        /createFight|runFight|fightResult/,
        /\bstep\b|\bframe\b/i,
      ]) {
        assert.doesNotMatch(
          source.replace(/\/\/.*$/gm, ""),
          banned,
          `${file} ${banned}`,
        );
      }
    }
  });
});
