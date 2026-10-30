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
  EngineResultError,
  GATE_TOLERANCE,
  MAX_DURATION,
  PARITY_ONLY_CASES,
  SCRIPT_LEFT_OFF,
  checkResult,
  compareCase,
  copyResult,
  parityCases,
  PARITY_CASES,
  resultsDiffer,
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
  withinGate,
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

  it("covers every golden case, in order, then the parity-only cases", () => {
    assert.deepEqual(
      report.cases.map(({ name }) => name),
      [
        ...GOLDEN_CASES.map(({ name }) =>
          Object.hasOwn(SCRIPT_LEFT_OFF, name)
            ? SCRIPT_LEFT_OFF[name].as
            : name,
        ),
        "dot-hemorrhage-rupture-120s",
        "partial-build-8-points-300s",
      ],
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
  it("are the golden cases' durations and configs, then the parity-only cases", () => {
    assert.deepEqual(
      PARITY_CASES.map(({ golden, duration, config }) => ({
        golden,
        duration,
        config,
      })),
      [
        ...GOLDEN_CASES.map(({ name, duration, config }) => ({
          golden: name,
          duration,
          config,
        })),
        ...PARITY_ONLY_CASES.map(({ duration, config }) => ({
          golden: null,
          duration,
          config,
        })),
      ],
    );
  });

  it("leave off only the scripts SCRIPT_LEFT_OFF names, under a name that says so", () => {
    // Pinned: a change to the list, or to which golden cases are scripted,
    // must come with a change here.
    assert.deepEqual(Object.keys(SCRIPT_LEFT_OFF), [
      "scripted-finishers-seed-68-50s",
    ]);
    assert.deepEqual(
      GOLDEN_CASES.filter(({ script }) => script !== undefined).map(
        ({ name }) => name,
      ),
      ["scripted-finishers-seed-68-50s"],
    );
    const entry = SCRIPT_LEFT_OFF["scripted-finishers-seed-68-50s"];
    assert.equal(entry.as, "finishers-50s-without-script");
    // Since #197 the script hooks castRotation, which both engines call, so
    // the reason is only that it does not finish on every seed (#199).
    assert.doesNotMatch(entry.reason, /Rogue\.prototype\.rotation|legacy-only/);
    assert.match(
      entry.reason,
      /^its script was written for seed 68 and does not finish on 79 of seeds 1 to 200 on legacy \(70 on events\)$/,
    );
    assert.deepEqual(
      PARITY_CASES.filter(({ scriptLeftOff }) => scriptLeftOff !== null).map(
        ({ name, golden, scriptLeftOff }) => [name, golden, scriptLeftOff],
      ),
      [
        [
          "finishers-50s-without-script",
          "scripted-finishers-seed-68-50s",
          entry.reason,
        ],
      ],
    );
    // The golden name is not a parity case name: --cases takes the new one.
    assert.equal(
      PARITY_CASES.some(
        ({ name }) => name === "scripted-finishers-seed-68-50s",
      ),
      false,
    );
    assert.equal(
      PARITY_CASES.some((c) => "script" in c),
      false,
    );
  });

  it("refuses a scripted case not on the list, a listed case with no script, and a repeated name", () => {
    const plain = { name: "plain", duration: 10, config: {} };
    const scripted = { ...plain, name: "scripted", script: ["eviscerate"] };
    const why = { scripted: { as: "plain-without-script", reason: "why" } };
    assert.deepEqual(
      parityCases([plain, scripted], why, []).map((c) => [
        c.name,
        c.scriptLeftOff,
      ]),
      [
        ["plain", null],
        ["plain-without-script", "why"],
      ],
    );
    // A case that quietly becomes scripted.
    assert.throws(() => parityCases([plain, scripted], {}, []), {
      name: "RangeError",
      message: /^Golden case "scripted" is scripted, .*SCRIPT_LEFT_OFF/,
    });
    // A case that quietly stops being scripted, or is renamed or removed.
    assert.throws(
      () => parityCases([plain, { ...scripted, script: undefined }], why, []),
      {
        name: "RangeError",
        message:
          /^SCRIPT_LEFT_OFF lists "scripted", which is not a scripted golden case/,
      },
    );
    assert.throws(() => parityCases([plain], why, []), RangeError);
    assert.throws(
      () =>
        parityCases(
          [plain, scripted],
          {
            scripted: { as: "plain", reason: "why" },
          },
          [],
        ),
      { name: "RangeError", message: 'Two parity cases are named "plain".' },
    );
    assert.throws(() => parityCases([plain], {}, [plain]), {
      message: 'Two parity cases are named "plain".',
    });
  });

  it("are frozen all the way down, and so are the golden cases", () => {
    const frozenDeep = (value, path) => {
      if (value !== null && typeof value === "object") {
        assert.ok(Object.isFrozen(value), `${path} is not frozen`);
        for (const [key, child] of Object.entries(value)) {
          frozenDeep(child, `${path}.${key}`);
        }
      }
    };
    frozenDeep(GOLDEN_CASES, "GOLDEN_CASES");
    frozenDeep(PARITY_CASES, "PARITY_CASES");
    frozenDeep(SCRIPT_LEFT_OFF, "SCRIPT_LEFT_OFF");
    frozenDeep(PARITY_ONLY_CASES, "PARITY_ONLY_CASES");
    const talented = GOLDEN_CASES.find(({ config }) => config?.talents);
    assert.throws(() => {
      delete talented.config.talents;
    }, TypeError);
  });

  it("include a DoT case: legacy casts Hemorrhage and Rupture, and Rupture deals damage", () => {
    const dot = PARITY_CASES.find(
      ({ name }) => name === "dot-hemorrhage-rupture-120s",
    );
    assert.equal(dot.golden, null);
    for (const seed of [1, 2]) {
      const { abilities } = runFight({
        seed,
        duration: dot.duration,
        config: structuredClone(dot.config),
      });
      assert.ok(abilities.Hemorrhage.casts > 10, `seed ${seed} Hemorrhage`);
      assert.ok(abilities.Rupture.casts >= 3, `seed ${seed} Rupture casts`);
      assert.ok(abilities.Rupture.damage > 0, `seed ${seed} Rupture damage`);
    }
  });

  it("include a partial build (#199): Blade Flurry and Adrenaline Rush stay locked, on both engines", () => {
    const partial = PARITY_CASES.find(
      ({ name }) => name === "partial-build-8-points-300s",
    );
    assert.equal(partial.golden, null);
    assert.equal(partial.duration, 300);
    assert.equal(partial.config.rotation, undefined);
    assert.equal(
      Object.values(partial.config.talents).reduce((x, y) => x + y, 0),
      8,
    );
    for (const engine of ["legacy", "events"]) {
      const { abilities } = ENGINES[engine]({
        seed: 1,
        duration: 120,
        config: structuredClone(partial.config),
      });
      assert.equal(abilities["Blade Flurry"]?.casts ?? 0, 0, engine);
      assert.equal(abilities["Adrenaline Rush"]?.casts ?? 0, 0, engine);
      assert.ok(abilities["Sinister Strike"].casts > 0, engine);
      assert.ok(abilities["Slice and Dice"].casts > 0, engine);
    }
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
      message: 'Unknown engine "core". Engines: legacy, events.',
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
        "--duration",
        "300",
        "--json",
      ]),
      {
        json: true,
        help: false,
        engine: "legacy",
        against: "legacy",
        seeds: 12,
        cases: [SHORT, "other-seed-12345-90s"],
        duration: 300,
      },
    );
    assert.equal(parseArgs(["--duration", "0.5"]).duration, 0.5);
    assert.equal(
      parseArgs(["--duration", String(MAX_DURATION)]).duration,
      MAX_DURATION,
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
      ["--duration"],
      ["--duration", "0"],
      ["--duration", "-5"],
      ["--duration", "1e2"],
      ["--duration", "300s"],
      ["--duration", String(MAX_DURATION + 1)],
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
    assert.equal(err.at(-1), 'Unknown engine "core". Engines: legacy, events.');
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
    assert.ok(
      out[0].includes(
        `finishers-50s-without-script (50 s, config only)\n  script left off: ${SCRIPT_LEFT_OFF["scripted-finishers-seed-68-50s"].reason}\n`,
      ),
    );
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

// A fake engine: dps and casts from a function of the seed.
function fakeEngine(dps, casts = () => 1) {
  return ({ seed }) => ({
    dps: dps(seed),
    abilities: { Jab: { damage: dps(seed), casts: casts(seed) } },
  });
}

describe("parity: an engine cannot change what the other one runs (#213)", () => {
  const talented = "talented-build-seed-107-60s";

  it("each call gets its own options and config copy", () => {
    const seen = [];
    const record = (options) => {
      seen.push(options);
      return { dps: 1, abilities: {} };
    };
    const vandal = (options) => {
      seen.push(options);
      delete options.config.talents;
      options.seed = -1;
      return { dps: 1, abilities: {} };
    };
    runParity({
      engine: "vandal",
      against: "record",
      seeds: 2,
      cases: [talented],
      engines: { vandal, record },
    });
    assert.equal(seen.length, 4);
    assert.equal(new Set(seen).size, 4);
    assert.equal(new Set(seen.map(({ config }) => config)).size, 4);
    // B's copies still have their talents and their seed.
    assert.deepEqual(
      [seen[1], seen[3]].map(({ seed, config }) => [seed, "talents" in config]),
      [
        [1, true],
        [2, true],
      ],
    );
    const golden = GOLDEN_CASES.find(({ name }) => name === talented);
    assert.ok(seen.every(({ config }) => config !== golden.config));
    assert.ok("talents" in golden.config);
  });

  it("Kira's false pass: an engine that ignores talents and deletes them is about -36%, not 0", () => {
    const ignoresAndMutates = (options) => {
      const result = runFight({
        ...options,
        config: { ...options.config, talents: undefined },
      });
      delete options.config.talents;
      return result;
    };
    const [c] = runParity({
      engine: "ignoresAndMutates",
      against: "legacy",
      seeds: 10,
      cases: [talented],
      engines: { ...ENGINES, ignoresAndMutates },
    }).cases;
    const relative = (100 * c.difference.mean) / c.against.dpsMean;
    assert.ok(relative < -30 && relative > -45, `got ${relative}%`);
    assert.equal(c.seedsDiffering, 10);
    assert.ok(c.difference.high < 0);
  });
});

describe("parity: the gate (#213, for #199)", () => {
  const base = fakeEngine(() => 100);
  const run = (dps, gate) =>
    runParity({
      engine: "b",
      against: "a",
      seeds: 3,
      cases: [SHORT],
      engines: { a: base, b: fakeEngine(dps) },
      gate,
    });

  it("passes within the limit and at it, and fails over it, either way", () => {
    for (const [dps, passed] of [
      [() => 101, true],
      [() => 102, true],
      [() => 98, true],
      [() => 102.001, false],
      [() => 97.999, false],
    ]) {
      const report = run(dps, 2);
      assert.equal(report.cases[0].gatePassed, passed, String(dps));
      assert.deepEqual(report.gate, {
        percent: 2,
        failed: passed ? [] : [SHORT],
      });
    }
  });

  it("gates on the point estimate, not the interval", () => {
    // Mean 102 (2%), with seeds spread so the interval reaches past 2%.
    const report = run((seed) => [99, 102, 105][seed - 1], 2);
    const [c] = report.cases;
    close(c.relativeDifferencePercent, 2);
    assert.ok(c.differenceCiPercent.high > 2);
    assert.equal(c.gatePassed, true);
  });

  it("reports the difference and its interval as a percentage of B's mean", () => {
    const [c] = run((seed) => [99, 102, 105][seed - 1], null).cases;
    assert.equal(c.gatePassed, null);
    close(c.differenceCiPercent.low, c.difference.low);
    close(c.differenceCiPercent.high, c.difference.high);
    const [d] = runParity({
      engine: "b",
      against: "a",
      seeds: 2,
      cases: [SHORT],
      engines: { a: fakeEngine(() => 200), b: fakeEngine(() => 190) },
    }).cases;
    assert.equal(d.relativeDifferencePercent, 5);
    assert.deepEqual(d.differenceCiPercent, { low: -5, high: -5 });
  });

  it("legacy against legacy passes a 0% gate", () => {
    const report = runParity({ seeds: 2, cases: [SHORT], gate: 0 });
    assert.deepEqual(report.gate, { percent: 0, failed: [] });
  });

  it("refuses a bad gate", () => {
    for (const gate of [-1, Number.NaN, Infinity, "2"]) {
      assert.throws(() => runParity({ seeds: 1, cases: [SHORT], gate }), {
        name: "RangeError",
        message: /^gate must be a percentage of at least 0/,
      });
    }
    assert.equal(parseArgs(["--gate", "2"]).gate, 2);
    assert.equal(parseArgs(["--gate", "0.5"]).gate, 0.5);
    for (const text of ["-1", "2%", "", "1e1", "abc"]) {
      assert.throws(() => parseArgs(["--gate", text]), /--gate needs/);
    }
  });

  it("--gate exits 2 on a fail, 0 on a pass, and says which case failed", () => {
    const out = [];
    const io = { log: (t) => out.push(t), logError: (t) => out.push(t) };
    const fake = (options) =>
      runParity({
        ...options,
        engine: "b",
        against: "a",
        engines: { a: base, b: fakeEngine(() => 103) },
      });
    assert.equal(
      cli(["--seeds", "2", "--cases", SHORT, "--gate", "2"], {
        ...io,
        run: fake,
      }),
      2,
    );
    assert.match(out[0], /gate 2%: FAIL/);
    assert.match(out[0], /Gate 2%: FAIL on short-seed-1-10s\.$/);
    out.length = 0;
    assert.equal(
      cli(["--seeds", "2", "--cases", SHORT, "--gate", "3"], {
        ...io,
        run: fake,
      }),
      0,
    );
    assert.match(out[0], /Gate 3%: every case passes\.$/);
    out.length = 0;
    assert.equal(
      cli(["--seeds", "2", "--cases", SHORT], { ...io, run: fake }),
      0,
    );
    assert.doesNotMatch(out[0], /Gate/);
    assert.match(
      out[0],
      /relative to B: \(A - B\) \/ B \+3\.0000%, 95% CI \[\+3\.0000%, \+3\.0000%\]; \|A - B\| \/ B 3\.0000%$/m,
    );
  });
});

describe("parity: engine results are checked (#213)", () => {
  const where = { engine: "x", name: "c", seed: 4 };
  const good = { dps: 1, abilities: { Jab: { damage: 1, casts: 1 } } };

  it("accepts a runFight-shaped result", () => {
    assert.equal(checkResult(good, where), good);
    checkResult({ dps: 0, abilities: {} }, where);
  });

  it("refuses NaN, a missing or non-numeric dps, and bad abilities", () => {
    for (const [result, pattern] of [
      [undefined, /returned undefined, not a result object/],
      [null, /returned null, not a result object/],
      [{ abilities: {} }, /dps undefined; it must be a finite number/],
      [{ dps: Number.NaN, abilities: {} }, /dps NaN/],
      [{ dps: Infinity, abilities: {} }, /dps Infinity/],
      [{ dps: "1", abilities: {} }, /dps 1; it must/],
      [{ dps: 1 }, /abilities undefined; it must be an object/],
      [{ dps: 1, abilities: [] }, /abilities ; it must be an object/],
      [
        { dps: 1, abilities: { Jab: null } },
        /abilities\["Jab"\]\.damage undefined/,
      ],
      [
        { dps: 1, abilities: { Jab: { damage: 1 } } },
        /abilities\["Jab"\]\.casts undefined/,
      ],
      [
        { dps: 1, abilities: { Jab: { damage: Number.NaN, casts: 1 } } },
        /\.damage NaN/,
      ],
    ]) {
      assert.throws(
        () => checkResult(result, where),
        (error) => {
          assert.ok(error instanceof EngineResultError);
          assert.match(error.message, /^Engine "x" on c, seed 4 /);
          assert.match(error.message, pattern);
          return true;
        },
      );
    }
  });

  it("stops the run, and the command exits 1 with the message", () => {
    const broken = () => ({ dps: Number.NaN, abilities: {} });
    const engines = { ...ENGINES, broken };
    assert.throws(
      () => runParity({ engine: "broken", seeds: 1, cases: [SHORT], engines }),
      /^EngineResultError: Engine "broken" on short-seed-1-10s, seed 1 returned dps NaN/,
    );
    // B is checked too.
    assert.throws(
      () => runParity({ against: "broken", seeds: 1, cases: [SHORT], engines }),
      /Engine "broken"/,
    );
    const errors = [];
    const status = cli(["--seeds", "1"], {
      run: (options) => runParity({ ...options, engine: "broken", engines }),
      log: () => assert.fail("no report"),
      logError: (t) => errors.push(t),
    });
    assert.equal(status, 1);
    assert.match(errors[0], /returned dps NaN; it must be a finite number\.$/);
  });
});

describe("parity: a seed differs when its DPS or any cast count does (#213)", () => {
  const result = (dps, abilities) => ({ dps, abilities });
  const jab = (casts) => ({ Jab: { damage: 5, casts } });

  it("resultsDiffer", () => {
    assert.equal(resultsDiffer(result(1, jab(2)), result(1, jab(2))), false);
    assert.equal(resultsDiffer(result(1, jab(2)), result(2, jab(2))), true);
    assert.equal(resultsDiffer(result(2, jab(2)), result(1, jab(2))), true);
    assert.equal(resultsDiffer(result(1, jab(2)), result(1, jab(3))), true);
    assert.equal(resultsDiffer(result(1, jab(3)), result(1, jab(2))), true);
    // Missing counts as 0 casts, either side.
    assert.equal(resultsDiffer(result(1, jab(1)), result(1, {})), true);
    assert.equal(resultsDiffer(result(1, {}), result(1, jab(1))), true);
    assert.equal(resultsDiffer(result(1, jab(0)), result(1, {})), false);
    // Damage alone is not counted (the DPS carries it).
    assert.equal(
      resultsDiffer(
        result(1, { Jab: { damage: 5, casts: 1 } }),
        result(1, { Jab: { damage: 6, casts: 1 } }),
      ),
      false,
    );
  });

  it("compareCase counts a seed whose casts differ at the same DPS", () => {
    const c = compareCase(PARITY_CASES[0], {
      engine: "a",
      against: "b",
      seeds: 4,
      engines: {
        a: fakeEngine(
          () => 100,
          () => 1,
        ),
        b: fakeEngine(
          () => 100,
          (seed) => (seed === 3 ? 2 : 1),
        ),
      },
    });
    assert.equal(c.difference.mean, 0);
    assert.equal(c.seedsDiffering, 1);
  });
});

describe("parity: the #199 harness fixes", () => {
  const gateRun = (b, a, gate = 2) =>
    runParity({
      engine: "a",
      against: "b",
      seeds: 2,
      cases: [SHORT],
      engines: { a: fakeEngine(() => a), b: fakeEngine(() => b) },
      gate,
    }).cases[0];

  it("a difference of exactly the gate passes on either side of B, and just over fails (#213 QA)", () => {
    // Exactly 2% computes as just over 2 for some means (Kira's #213 QA
    // found 0.98 x B at 2.000000000000007): these pass only with the
    // tolerance.
    for (const b of [226.85, 199.21]) {
      const c = gateRun(b, 0.98 * b);
      assert.ok(c.relativeDifferencePercent > 2, `${b} rounds over 2`);
      assert.equal(c.gatePassed, true);
    }
    for (const b of [100, 144.52, 226.85, 256.77, 199.21, 3.3, 1e6, 0.07]) {
      for (const factor of [1.02, 0.98]) {
        assert.equal(
          gateRun(b, factor * b).gatePassed,
          true,
          `${factor} x ${b}`,
        );
      }
      for (const factor of [1.0201, 0.9799]) {
        assert.equal(
          gateRun(b, factor * b).gatePassed,
          false,
          `${factor} x ${b}`,
        );
      }
    }
    assert.equal(GATE_TOLERANCE, 1e-9);
    assert.equal(withinGate(2 + GATE_TOLERANCE, 2), true);
    assert.equal(withinGate(2 + 2 * GATE_TOLERANCE, 2), false);
    assert.equal(withinGate(0, 0), true);
  });

  it("reports the signed difference as a percentage of B, next to the signed interval", () => {
    const down = gateRun(200, 190, null);
    assert.equal(down.signedDifferencePercent, -5);
    assert.equal(down.relativeDifferencePercent, 5);
    assert.deepEqual(down.differenceCiPercent, { low: -5, high: -5 });
    const up = gateRun(200, 203, null);
    close(up.signedDifferencePercent, 1.5);
    close(up.relativeDifferencePercent, 1.5);
    const text = formatReport({
      engine: "a",
      against: "b",
      seeds: 2,
      duration: null,
      confidence: CONFIDENCE,
      gate: null,
      cases: [down],
    });
    assert.match(
      text,
      /relative to B: \(A - B\) \/ B -5\.0000%, 95% CI \[-5\.0000%, -5\.0000%\]; \|A - B\| \/ B 5\.0000%$/m,
    );
    const zero = runParity({ seeds: 2, cases: [SHORT] }).cases[0];
    assert.equal(zero.signedDifferencePercent, 0);
    assert.match(
      formatReport(runParity({ seeds: 2, cases: [SHORT] })),
      /\(A - B\) \/ B 0\.0000%, 95% CI \[0\.0000%, 0\.0000%\]/,
    );
  });

  it("copies each result as its call returns, so a reused or later-changed result object cannot move a counted seed", () => {
    // One object for every call, changed in place on the next call: without
    // the copy every seed would read the last call's numbers.
    const shared = { dps: 0, abilities: { Jab: { damage: 0, casts: 0 } } };
    const reuse = ({ seed }) => {
      shared.dps = 100 + seed;
      shared.abilities.Jab.damage = 100 + seed;
      shared.abilities.Jab.casts = seed;
      return shared;
    };
    const [c] = runParity({
      engine: "reuse",
      against: "base",
      seeds: 3,
      cases: [SHORT],
      engines: { reuse, base: fakeEngine(() => 100) },
    }).cases;
    assert.equal(c.engine.dpsMean, 102);
    assert.equal(c.engine.dpsSd, 1);
    assert.deepEqual(c.engine.abilities.Jab, { damage: 102, casts: 2 });
    assert.deepEqual(c.difference.mean, 2);
    // copyResult keeps dps and a deep copy of abilities, and nothing else.
    const result = {
      dps: 5,
      abilities: { Jab: { damage: 5, casts: 1 } },
      simulation: {},
    };
    const copy = copyResult(result);
    assert.deepEqual(copy, {
      dps: 5,
      abilities: { Jab: { damage: 5, casts: 1 } },
    });
    assert.notEqual(copy.abilities, result.abilities);
    assert.notEqual(copy.abilities.Jab, result.abilities.Jab);
  });

  it("--duration runs every chosen case for that long, and says so", () => {
    const seen = [];
    const record = (options) => {
      seen.push(options.duration);
      return { dps: 1, abilities: {} };
    };
    const report = runParity({
      engine: "record",
      against: "record",
      seeds: 1,
      cases: [SHORT, "talented-build-seed-107-60s"],
      engines: { record },
      duration: 300,
    });
    assert.deepEqual(seen, [300, 300, 300, 300]);
    assert.equal(report.duration, 300);
    assert.deepEqual(
      report.cases.map(({ duration }) => duration),
      [300, 300],
    );
    assert.match(formatReport(report), /seeds 1 to 1, every case at 300 s,/);
    assert.match(formatReport(report), /^short-seed-1-10s \(300 s\)$/m);
    seen.length = 0;
    const own = runParity({
      engine: "record",
      against: "record",
      seeds: 1,
      cases: [SHORT],
      engines: { record },
    });
    assert.deepEqual(seen, [10, 10]);
    assert.equal(own.duration, null);
    assert.doesNotMatch(formatReport(own), /every case at/);
    for (const duration of [
      0,
      -1,
      Number.NaN,
      Infinity,
      MAX_DURATION + 1,
      "300",
    ]) {
      assert.throws(
        () =>
          runParity({
            seeds: 1,
            cases: [SHORT],
            duration,
            engines: { legacy: record },
          }),
        {
          name: "RangeError",
          message: /^duration must be a number of seconds over 0, at most 3600/,
        },
      );
    }
    assert.equal(MAX_DURATION, 3600);
  });

  it("the events engine is the event core: it differs from legacy, and events against events is exactly 0", () => {
    const options = { seed: 3, duration: 30, config: {} };
    assert.deepEqual(
      ENGINES.events(structuredClone(options)),
      runFight({ ...structuredClone(options), engine: "events" }),
    );
    assert.deepEqual(
      ENGINES.legacy(structuredClone(options)),
      runFight(structuredClone(options)),
    );
    const [cross] = runParity({
      engine: "events",
      against: "legacy",
      seeds: 3,
      cases: [SHORT],
    }).cases;
    assert.ok(cross.seedsDiffering > 0);
    const [same] = runParity({
      engine: "events",
      against: "events",
      seeds: 3,
      cases: [SHORT],
      gate: 0,
    }).cases;
    assert.deepEqual(same.difference, { mean: 0, sd: 0, low: 0, high: 0 });
    assert.equal(same.seedsDiffering, 0);
    assert.equal(same.gatePassed, true);
  });
});
