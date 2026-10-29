import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runFight } from "../js/fight.js";
import { GOLDEN_CASES } from "../scripts/golden-update.mjs";
import {
  CONFIDENCE,
  DEFAULT_SEEDS,
  ENGINES,
  HELP_TEXT,
  MAX_SEEDS,
  PARITY_CASES,
  abilityMeans,
  cli,
  formatReport,
  mean,
  pairedDifference,
  parseArgs,
  runParity,
  standardDeviation,
  studentTCdf,
  studentTQuantile,
} from "../scripts/parity.mjs";

// The parity harness (#192, E11). With only the legacy engine, legacy against
// legacy must differ by exactly 0, which is what proves the harness.

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/parity.mjs", import.meta.url));
const SHORT = "short-seed-1-10s";

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

describe("parity: legacy against legacy is exactly 0 (#192)", () => {
  const report = runParity({ seeds: 3 });

  it("covers every golden case, in order", () => {
    assert.deepEqual(
      report.cases.map(({ name }) => name),
      GOLDEN_CASES.map(({ name }) => name),
    );
  });

  for (const c of report.cases) {
    it(`${c.name}: the difference, its SD and its interval are exactly 0`, () => {
      assert.equal(c.seeds, 3);
      assert.deepEqual(c.difference, { mean: 0, sd: 0, low: 0, high: 0 });
      assert.equal(c.seedsDiffering, 0);
      assert.deepEqual(c.engine, c.against);
      assert.ok(Object.keys(c.abilityDifference).length > 0);
      for (const diff of Object.values(c.abilityDifference)) {
        assert.deepEqual(diff, { damage: 0, casts: 0 });
      }
      // Not a vacuous 0: the fights did something, and seeds differ.
      assert.ok(c.engine.dpsMean > 0);
      assert.ok(c.engine.dpsSd > 0);
    });
  }

  it("the means are runFight's, seeds 1 to N", () => {
    const c = report.cases.find(({ name }) => name === SHORT);
    const dps = [1, 2, 3].map((seed) => runFight({ seed, duration: 10 }).dps);
    assert.equal(c.engine.dpsMean, mean(dps));
    assert.equal(c.engine.dpsSd, standardDeviation(dps));
  });
});

describe("parity: a different engine is caught", () => {
  const plusTen = (options) => {
    const result = runFight(options);
    return { ...result, dps: result.dps + 10 };
  };
  const bySeed = (options) => {
    const result = runFight(options);
    return { ...result, dps: result.dps + options.seed };
  };
  const engines = { ...ENGINES, plusTen, bySeed };

  it("a constant offset gives that mean and a zero-width interval", () => {
    const [c] = runParity({
      engine: "plusTen",
      against: "legacy",
      seeds: 4,
      cases: [SHORT],
      engines,
    }).cases;
    close(c.difference.mean, 10);
    close(c.difference.sd, 0);
    close(c.difference.low, 10);
    close(c.difference.high, 10);
    assert.equal(c.seedsDiffering, 4);
  });

  it("a varying offset gives an interval around its mean", () => {
    const [c] = runParity({
      engine: "bySeed",
      against: "legacy",
      seeds: 4,
      cases: [SHORT],
      engines,
    }).cases;
    // Differences 1, 2, 3, 4: mean 2.5, SD √(5/3), t(0.975, 3) = 3.182446305.
    close(c.difference.mean, 2.5);
    close(c.difference.sd, Math.sqrt(5 / 3));
    const half = (3.182446305 * Math.sqrt(5 / 3)) / 2;
    close(c.difference.low, 2.5 - half, 1e-8);
    close(c.difference.high, 2.5 + half, 1e-8);
  });

  it("runs A then B for each seed, so a leak between fights shows", () => {
    const calls = [];
    const record = (label) => (options) => {
      calls.push(`${label}${options.seed}`);
      return { dps: options.seed, abilities: {} };
    };
    runParity({
      engine: "a",
      against: "b",
      seeds: 3,
      cases: [SHORT],
      engines: { a: record("a"), b: record("b") },
    });
    assert.deepEqual(calls, ["a1", "b1", "a2", "b2", "a3", "b3"]);
  });

  it("passes each case's duration and config, and the seed", () => {
    const seen = [];
    const record = (options) => {
      seen.push(options);
      return { dps: 1, abilities: {} };
    };
    runParity({ seeds: 1, engines: { legacy: record } });
    assert.deepEqual(
      seen.filter((_, index) => index % 2 === 0),
      PARITY_CASES.map(({ duration, config }) => ({
        seed: 1,
        duration,
        config,
      })),
    );
  });

  it("an ability only one engine uses counts as 0 for the other", () => {
    const one = () => ({
      dps: 1,
      abilities: { Hemorrhage: { damage: 30, casts: 2 } },
    });
    const other = () => ({
      dps: 1,
      abilities: { "Sinister Strike": { damage: 10, casts: 1 } },
    });
    const [c] = runParity({
      engine: "one",
      against: "other",
      seeds: 2,
      cases: [SHORT],
      engines: { one, other },
    }).cases;
    assert.deepEqual(c.abilityDifference, {
      Hemorrhage: { damage: 30, casts: 2 },
      "Sinister Strike": { damage: -10, casts: -1 },
    });
    assert.deepEqual(c.difference, { mean: 0, sd: 0, low: 0, high: 0 });
  });
});

describe("parity: the cases", () => {
  it("are the golden cases' names, durations and configs", () => {
    assert.deepEqual(
      PARITY_CASES.map(({ name, duration, config }) => ({
        name,
        duration,
        config,
      })),
      GOLDEN_CASES.map(({ name, duration, config }) => ({
        name,
        duration,
        config,
      })),
    );
  });

  it("drop only the scripted case's script, and say so", () => {
    assert.deepEqual(
      PARITY_CASES.filter(({ scriptDropped }) => scriptDropped).map(
        ({ name }) => name,
      ),
      GOLDEN_CASES.filter(({ script }) => script !== undefined).map(
        ({ name }) => name,
      ),
    );
    assert.equal(
      PARITY_CASES.some((c) => "script" in c),
      false,
    );
    assert.ok(Object.isFrozen(PARITY_CASES));
    assert.ok(PARITY_CASES.every((c) => Object.isFrozen(c)));
  });

  it("include the default fight at 300 s", () => {
    assert.ok(
      PARITY_CASES.some(
        ({ duration, config }) => duration === 300 && config === undefined,
      ),
    );
  });
});

describe("parity: statistics", () => {
  it("mean and sample SD", () => {
    assert.equal(mean([2, 4, 4, 4, 5, 5, 7, 9]), 5);
    close(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7));
    assert.equal(standardDeviation([5]), null);
    assert.equal(standardDeviation([3, 3, 3]), 0);
    assert.throws(() => mean([]), RangeError);
  });

  it("Student t quantiles match the table", () => {
    const table = [
      [0.975, 1, 12.706204736],
      [0.975, 2, 4.30265273],
      [0.975, 5, 2.570581836],
      [0.975, 10, 2.228138852],
      [0.975, 30, 2.042272456],
      [0.975, 199, 1.971956544],
      [0.995, 10, 3.169272673],
      [0.95, 20, 1.724718243],
    ];
    for (const [p, df, t] of table) {
      close(studentTQuantile(p, df), t, 1e-7);
    }
    assert.equal(studentTQuantile(0.5, 7), 0);
  });

  it("the t CDF is symmetric about 0", () => {
    assert.equal(studentTCdf(0, 5), 0.5);
    close(studentTCdf(-2, 9) + studentTCdf(2, 9), 1, 1e-12);
    close(studentTCdf(2.228138852, 10), 0.975, 1e-9);
  });

  it("the quantile refuses bad arguments", () => {
    for (const [p, df] of [
      [0.975, 0],
      [0.975, 1.5],
      [0.975, Number.NaN],
      [0.4, 5],
      [1, 5],
      [Number.NaN, 5],
    ]) {
      assert.throws(() => studentTQuantile(p, df), RangeError);
    }
  });

  it("the paired difference", () => {
    const d = pairedDifference([1, 2, 3, 4], [0, 0, 0, 0]);
    close(d.mean, 2.5);
    close(d.sd, Math.sqrt(5 / 3));
    const half = (3.182446305 * Math.sqrt(5 / 3)) / 2;
    close(d.low, 2.5 - half, 1e-8);
    close(d.high, 2.5 + half, 1e-8);
    assert.deepEqual(pairedDifference([7], [5]), {
      mean: 2,
      sd: null,
      low: null,
      high: null,
    });
    assert.equal(CONFIDENCE, 0.95);
    assert.throws(() => pairedDifference([1, 2], [1]), RangeError);
    assert.throws(() => pairedDifference([], []), RangeError);
  });

  it("ability means take every ability, missing ones as 0", () => {
    assert.deepEqual(
      abilityMeans([
        { abilities: { X: { damage: 2, casts: 1 } } },
        { abilities: { Y: { damage: 4, casts: 2 } } },
      ]),
      { X: { damage: 1, casts: 0.5 }, Y: { damage: 2, casts: 1 } },
    );
  });
});

describe("parity: arguments and the command", () => {
  it("refuses an unknown engine or case and a bad seed count", () => {
    assert.throws(() => runParity({ engine: "core" }), {
      name: "RangeError",
      message: 'Unknown engine "core". Engines: legacy.',
    });
    assert.throws(() => runParity({ against: "toString" }), RangeError);
    assert.throws(() => runParity({ cases: ["nope"] }), {
      name: "RangeError",
      message: new RegExp(`^Unknown case "nope". Cases: ${SHORT}, `),
    });
    // The check comes before any fight: this engine throws if it is run.
    const engines = {
      legacy: () => {
        throw new Error("ran a fight");
      },
    };
    const cases = [SHORT];
    for (const seeds of [0, 1.5, -1, MAX_SEEDS + 1, "3"]) {
      assert.throws(() => runParity({ seeds, cases, engines }), {
        name: "RangeError",
        message: new RegExp(
          `^seeds must be a positive integer, at most ${MAX_SEEDS}, got ${seeds}\\.$`,
        ),
      });
    }
    for (const seeds of [1, MAX_SEEDS]) {
      assert.throws(() => runParity({ seeds, cases, engines }), {
        message: "ran a fight",
      });
    }
  });

  it("parses its flags", () => {
    assert.deepEqual(parseArgs([]), { json: false, help: false });
    assert.deepEqual(
      parseArgs([
        "--engine",
        "legacy",
        "--against",
        "legacy",
        "--seeds",
        "12",
        "--cases",
        `${SHORT},other-seed-12345-90s`,
        "--json",
      ]),
      {
        json: true,
        help: false,
        engine: "legacy",
        against: "legacy",
        seeds: 12,
        cases: [SHORT, "other-seed-12345-90s"],
      },
    );
    assert.equal(parseArgs(["-h"]).help, true);
    assert.equal(DEFAULT_SEEDS, 200);
  });

  it("refuses bad flags", () => {
    for (const argv of [
      ["--seeds", "1e1"],
      ["--seeds", ""],
      ["--seeds", "0"],
      ["--seeds", String(MAX_SEEDS + 1)],
      ["--seeds"],
      ["--engine"],
      ["--engine", "--json"],
      ["--cases"],
      ["--fast"],
    ]) {
      assert.throws(() => parseArgs(argv), Error, argv.join(" "));
    }
  });

  it("cli: help, a bad flag, a bad engine, text and JSON", () => {
    const out = [];
    const err = [];
    const io = { log: (t) => out.push(t), logError: (t) => err.push(t) };
    assert.equal(cli(["--help"], io), 0);
    assert.deepEqual(out, [HELP_TEXT]);
    assert.equal(cli(["--fast"], io), 1);
    assert.match(err.at(-1), /^Unknown argument: --fast/);
    assert.equal(cli(["--engine", "core", "--seeds", "1"], io), 1);
    assert.equal(err.at(-1), 'Unknown engine "core". Engines: legacy.');
    const fake = (options) =>
      runParity({
        ...options,
        engines: { legacy: () => ({ dps: 1, abilities: {} }) },
      });
    out.length = 0;
    assert.equal(cli(["--seeds", "2", "--json"], { ...io, run: fake }), 0);
    const report = JSON.parse(out[0]);
    assert.equal(report.cases.length, PARITY_CASES.length);
    out.length = 0;
    assert.equal(cli(["--seeds", "2"], { ...io, run: fake }), 0);
    assert.equal(out[0], formatReport(fake({ seeds: 2 })));
    assert.match(out[0], /config only: the script is not run/);
  });

  it("npm run parity runs the script, and it reports a 0 difference", async () => {
    const pkg = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
    assert.equal(pkg.scripts.parity, "node scripts/parity.mjs");
    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, "--seeds", "2", "--cases", SHORT],
      { cwd: root },
    );
    assert.match(stdout, /^Parity: A legacy vs B legacy, seeds 1 to 2, Node /);
    assert.match(
      stdout,
      /difference \(A - B\): mean 0\.0000, 95% CI \[0\.0000, 0\.0000\], 0 of 2 seeds differ/,
    );
  });
});
