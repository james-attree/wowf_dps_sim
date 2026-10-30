import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { k } from "../data/constants.js";
import { resolveAttack } from "../js/attack-resolver.js";
import { dataVersion } from "../js/data-version.js";
import { defaultConfig } from "../js/sim-config.js";
import { runFight } from "../js/fight.js";
import {
  FINISHER_SCRIPT,
  FINISHER_SCRIPT_IN_BUDGET,
  GOLDEN_CASES,
  GOLDEN_DIR,
  IGNORED_FILES,
  MAX_LISTED_CHANGES,
  UNPINNED_FIELDS,
  UPDATE_COMMAND,
  diffResults,
  formatGolden,
  formatMismatch,
  formatMissing,
  formatReport,
  goldenPath,
  parseArgs,
  parseGolden,
  pinnedPart,
  runGoldenCase,
  updateGolden,
} from "../scripts/golden-update.mjs";
import { runScriptedFight } from "../scripts/scripted-fight.mjs";
import { Rogue } from "../js/rogue.js";
import { referenceBuild } from "./talentsforever.js";

// Issues #77 and #85. The full headless result for a few fixed seeds and durations is
// pinned in test/golden/*.json. This file only reads those fixtures. Only
// `npm run golden:update -- --write` (scripts/golden-update.mjs) rewrites them.

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const script = resolve(root, "scripts/golden-update.mjs");
const FIVE_MINUTES = 300;
const MAX_FIXTURE_BYTES = 32 * 1024;

// Every file in test/golden/ except the ones that are not fixtures (.DS_Store).
async function fixtureFiles() {
  return (await readdir(GOLDEN_DIR))
    .filter((file) => !IGNORED_FILES.includes(file))
    .sort();
}

async function snapshotFixtures() {
  const snapshot = {};
  for (const file of await fixtureFiles()) {
    const path = join(GOLDEN_DIR, file);
    snapshot[file] = {
      text: await readFile(path, "utf8"),
      mtime: (await stat(path)).mtimeMs,
    };
  }
  return snapshot;
}

describe("golden fights match their fixtures", () => {
  for (const goldenCase of GOLDEN_CASES) {
    it(`${goldenCase.name}: seed ${goldenCase.seed}, ${goldenCase.duration}s`, async () => {
      let text;
      try {
        text = await readFile(goldenPath(goldenCase.name), "utf8");
      } catch (error) {
        if (error.code === "ENOENT") {
          assert.fail(formatMissing(goldenCase));
        }
        throw error;
      }
      const expected = parseGolden(text);
      const actual = runGoldenCase(goldenCase);
      const changes = diffResults(expected, actual);
      if (changes.length > 0) {
        assert.fail(formatMismatch(goldenCase, changes));
      }
      assert.deepEqual(actual, expected);
    });
  }
});

describe("golden fixtures", () => {
  it("cover a short fight, a 5-minute fight, and more than one seed", () => {
    const durations = GOLDEN_CASES.map((goldenCase) => goldenCase.duration);
    const seeds = new Set(GOLDEN_CASES.map((goldenCase) => goldenCase.seed));
    assert.ok(Math.min(...durations) <= 10);
    assert.ok(durations.includes(FIVE_MINUTES));
    assert.ok(seeds.size >= 2);
    assert.equal(
      new Set(GOLDEN_CASES.map((goldenCase) => goldenCase.name)).size,
      GOLDEN_CASES.length,
    );
  });

  it("holds exactly one fixture per case and no other file", async () => {
    assert.deepEqual(
      await fixtureFiles(),
      GOLDEN_CASES.map((goldenCase) => `${goldenCase.name}.json`).sort(),
      "test/golden/ holds a file that is not a golden case. Delete the file, or add its case to GOLDEN_CASES in scripts/golden-update.mjs (then run `" +
        UPDATE_COMMAND +
        "`). Only .DS_Store is ignored.",
    );
  });

  it("pins the full result: seed, duration, damage, DPS, abilities and log", async () => {
    for (const goldenCase of GOLDEN_CASES) {
      const fixture = parseGolden(
        await readFile(goldenPath(goldenCase.name), "utf8"),
      );
      assert.deepEqual(Object.keys(fixture), [
        "seed",
        "duration",
        "totalDamage",
        "dps",
        "abilities",
        "log",
      ]);
      assert.equal(fixture.seed, goldenCase.seed);
      assert.equal(fixture.duration, goldenCase.duration);
      assert.ok(fixture.totalDamage > 0);
      assert.ok(Object.keys(fixture.abilities).length > 0);
      assert.ok(fixture.log.length > 0);
      assert.ok(fixture.log.length <= k("log.maxEvents"));
    }
  });

  it("do not pin dataVersion or config, but every result carries the current version and the default config (#91, #92)", async () => {
    for (const goldenCase of GOLDEN_CASES) {
      const text = await readFile(goldenPath(goldenCase.name), "utf8");
      assert.doesNotMatch(text, /dataVersion/, goldenCase.name);
      assert.doesNotMatch(text, /"config"/, goldenCase.name);
      assert.ok(!("dataVersion" in runGoldenCase(goldenCase)));
      assert.ok(!("config" in runGoldenCase(goldenCase)));
      const full = goldenCase.script
        ? runScriptedFight(goldenCase)
        : runFight({
            seed: goldenCase.seed,
            duration: goldenCase.duration,
            config: goldenCase.config,
          });
      assert.equal(full.dataVersion, dataVersion, goldenCase.name);
      if (goldenCase.config === undefined) {
        assert.deepEqual(full.config, defaultConfig(), goldenCase.name);
      } else {
        // A case with a config ran with it, and the rest is the defaults.
        const defaults = defaultConfig();
        assert.deepEqual(
          full.config,
          {
            ...defaults,
            talents: goldenCase.config.talents ?? defaults.talents,
            poisons: { ...defaults.poisons, ...goldenCase.config.poisons },
            rotation: goldenCase.config.rotation ?? defaults.rotation,
          },
          goldenCase.name,
        );
      }
      assert.deepEqual(pinnedPart(full), runGoldenCase(goldenCase));
    }
    assert.deepEqual(UNPINNED_FIELDS, ["dataVersion", "config"]);
  });

  it("do not change when only the data version changes", () => {
    const [goldenCase] = GOLDEN_CASES;
    const result = runFight({
      seed: goldenCase.seed,
      duration: goldenCase.duration,
    });
    const refreshed = { ...result, dataVersion: "2099-01-01+9.9.9" };
    assert.deepEqual(pinnedPart(refreshed), pinnedPart(result));
    assert.equal(
      formatGolden(pinnedPart(refreshed)),
      formatGolden(pinnedPart(result)),
    );
  });

  it("are readable and small: one line per ability and per log event", async () => {
    for (const goldenCase of GOLDEN_CASES) {
      const text = await readFile(goldenPath(goldenCase.name), "utf8");
      assert.ok(text.length <= MAX_FIXTURE_BYTES, goldenCase.name);
      assert.ok(text.endsWith("}\n"), goldenCase.name);
      const fixture = parseGolden(text);
      const expectedLines =
        // braces, 4 scalar fields, and the two blocks' open and close lines
        2 +
        4 +
        2 +
        2 +
        Object.keys(fixture.abilities).length +
        fixture.log.length;
      assert.equal(text.split("\n").length - 1, expectedLines, goldenCase.name);
      // The file is the canonical layout, so a regenerate gives no noise.
      assert.equal(text, formatGolden(fixture), goldenCase.name);
    }
  });
});

describe("a golden mismatch message", () => {
  const goldenCase = GOLDEN_CASES[0];
  const fixture = parseGolden(formatGolden(runGoldenCase(goldenCase)));

  it("lists the fields that changed, and how to regenerate on purpose", () => {
    const changed = structuredClone(fixture);
    changed.totalDamage += 1;
    changed.abilities["Main-hand"].damage += 2;
    changed.abilities["Main-hand"].casts += 1;
    changed.log[3].damage += 3;
    const message = formatMismatch(goldenCase, diffResults(fixture, changed));
    assert.match(message, new RegExp(`"${goldenCase.name}"`));
    assert.match(message, /4 fields changed/);
    assert.match(message, /^ {2}totalDamage: .* -> .*$/m);
    assert.match(message, /^ {2}abilities\.Main-hand\.damage: /m);
    assert.match(message, /^ {2}abilities\.Main-hand\.casts: /m);
    assert.match(message, /^ {2}log\[3\]\.damage: /m);
    assert.ok(message.includes(`\`${UPDATE_COMMAND}\``));
    assert.match(message, /explain in the pull request why/);
    assert.match(message, /regression/);
    assert.match(message, /do not regenerate/);
    assert.equal(UPDATE_COMMAND, "npm run golden:update -- --write");
  });

  it("names a field that is missing or added, and caps a long list", () => {
    const changed = structuredClone(fixture);
    delete changed.abilities["Sinister Strike"];
    changed.abilities["New Ability"] = { damage: 1 };
    const paths = diffResults(fixture, changed).map(({ path }) => path);
    assert.ok(paths.includes("abilities.Sinister Strike"));
    assert.ok(paths.includes("abilities.New Ability"));
    assert.match(
      formatMismatch(goldenCase, diffResults(fixture, changed)),
      /\(missing\)/,
    );

    const shifted = structuredClone(fixture);
    for (const event of shifted.log) {
      event.damage += 1;
      event.time += 1;
    }
    const changes = diffResults(fixture, shifted);
    assert.ok(changes.length > MAX_LISTED_CHANGES);
    const message = formatMismatch(goldenCase, changes);
    assert.match(
      message,
      new RegExp(`and ${changes.length - MAX_LISTED_CHANGES} more`),
    );
    assert.equal(
      message
        .split("\n")
        .filter((line) => line.startsWith("  ") && line.includes(" -> "))
        .length,
      MAX_LISTED_CHANGES,
    );
  });

  it("has no differences for equal results, and tells a log length change from a field", () => {
    assert.deepEqual(diffResults(fixture, structuredClone(fixture)), []);
    const shorter = structuredClone(fixture);
    shorter.log.pop();
    const [change] = diffResults(fixture, shorter);
    assert.equal(change.path, `log[${fixture.log.length - 1}]`);
    assert.equal(change.actual, undefined);
  });
});

describe("the golden:update script", () => {
  async function tempDir() {
    return mkdtemp(join(tmpdir(), "wowf-golden-"));
  }

  it("writes nothing unless it is given --write", async () => {
    const dir = await tempDir();
    try {
      const dry = await updateGolden({ dir });
      assert.ok(dry.outcomes.every((outcome) => outcome.status === "missing"));
      assert.deepEqual(await readdir(dir), []);
      assert.match(formatReport(dry), /Dry run: nothing was written/);

      const wrote = await updateGolden({ dir, write: true });
      assert.ok(wrote.outcomes.every((outcome) => outcome.written));
      assert.deepEqual(
        (await readdir(dir)).sort(),
        GOLDEN_CASES.map((goldenCase) => `${goldenCase.name}.json`).sort(),
      );
      assert.match(
        formatReport(wrote),
        new RegExp(`Wrote ${GOLDEN_CASES.length} fixture files`),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reproduces the committed fixtures byte for byte", async () => {
    const dir = await tempDir();
    try {
      await updateGolden({ dir, write: true });
      for (const goldenCase of GOLDEN_CASES) {
        assert.equal(
          await readFile(goldenPath(goldenCase.name, dir), "utf8"),
          await readFile(goldenPath(goldenCase.name), "utf8"),
          goldenCase.name,
        );
      }
      const again = await updateGolden({ dir, write: true });
      assert.ok(
        again.outcomes.every((o) => o.status === "unchanged" && !o.written),
      );
      assert.match(formatReport(again), /Nothing to do/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a changed fixture in a dry run and only rewrites it with --write", async () => {
    const dir = await tempDir();
    try {
      await updateGolden({ dir, write: true });
      const [goldenCase] = GOLDEN_CASES;
      const path = goldenPath(goldenCase.name, dir);
      const tampered = parseGolden(await readFile(path, "utf8"));
      tampered.totalDamage += 1;
      const tamperedText = formatGolden(tampered);
      await writeFile(path, tamperedText);

      const dry = await updateGolden({ dir });
      const [outcome] = dry.outcomes;
      assert.equal(outcome.status, "changed");
      assert.deepEqual(
        outcome.changes.map((change) => change.path),
        ["totalDamage"],
      );
      assert.equal(await readFile(path, "utf8"), tamperedText);
      assert.match(formatReport(dry), /totalDamage: .* -> /);

      await updateGolden({ dir, write: true });
      assert.deepEqual(
        parseGolden(await readFile(path, "utf8")),
        runGoldenCase(goldenCase),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns about a file that is not a golden case, and does not delete it", async () => {
    const dir = await tempDir();
    try {
      await writeFile(join(dir, "old-case.json"), "{}\n");
      const outcome = await updateGolden({ dir, write: true });
      assert.deepEqual(outcome.stray, ["old-case.json"]);
      assert.match(
        formatReport(outcome),
        /old-case\.json is not a golden case/,
      );
      assert.equal(await readFile(join(dir, "old-case.json"), "utf8"), "{}\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not call .DS_Store a stray file, and tells a real stray what to do", async () => {
    const dir = await tempDir();
    try {
      await writeFile(join(dir, ".DS_Store"), "x");
      assert.deepEqual((await updateGolden({ dir })).stray, []);
      await writeFile(join(dir, "old-case.json"), "{}\n");
      const outcome = await updateGolden({ dir });
      assert.deepEqual(outcome.stray, ["old-case.json"]);
      assert.match(
        formatReport(outcome),
        /Delete the file, or add its case to GOLDEN_CASES/,
      );
      assert.doesNotMatch(formatReport(outcome), /DS_Store/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses --write and --help, and refuses anything else", () => {
    assert.deepEqual(parseArgs([]), { write: false, help: false });
    assert.deepEqual(parseArgs(["--write"]), { write: true, help: false });
    assert.deepEqual(parseArgs(["--help"]), { write: false, help: true });
    assert.throws(() => parseArgs(["--force"]), /Unknown argument: --force/);
    assert.throws(() => parseArgs(["write"]), /Unknown argument/);
  });

  it("run with no flag leaves the committed fixtures untouched and says so", async () => {
    const before = await snapshotFixtures();
    const { stdout } = await execFileAsync(process.execPath, [script], {
      cwd: root,
    });
    assert.match(stdout, /Every fixture already matches\. Nothing to do\./);
    assert.deepEqual(await snapshotFixtures(), before);
  });

  it("run with an unknown flag exits non-zero and writes nothing", async () => {
    const before = await snapshotFixtures();
    await assert.rejects(
      execFileAsync(process.execPath, [script, "--yes"], { cwd: root }),
      (error) =>
        error.code === 1 && /Unknown argument: --yes/.test(error.stderr),
    );
    assert.deepEqual(await snapshotFixtures(), before);
  });
});

// Issue #85. The placeholder rotation never casts Eviscerate or Rupture, so the
// other cases cannot pin them. The scripted cases cast a script instead: the
// #85 case FINISHER_SCRIPT, and the #234 case FINISHER_SCRIPT_IN_BUDGET, which
// finishes on every seed.
const SCRIPTED = [
  {
    name: "scripted-finishers-seed-68-50s",
    script: FINISHER_SCRIPT,
    sinisterStrikes: 12,
  },
  {
    name: "scripted-finishers-in-budget-seed-68-50s",
    script: FINISHER_SCRIPT_IN_BUDGET,
    sinisterStrikes: 10,
  },
];

describe("the scripted golden cases", () => {
  const scripted = GOLDEN_CASES.filter((goldenCase) => goldenCase.script);

  it("are the two cases with a script, each casting its own script", () => {
    assert.deepEqual(
      scripted.map(({ name, script }) => ({ name, script })),
      SCRIPTED.map(({ name, script }) => ({ name, script })),
    );
  });

  // Issue #234. FINISHER_SCRIPT costs more energy than a 50 s fight gives when
  // every attack lands, so it finishes only on some seeds. The in-budget
  // script fits with room to spare, and finishes on every seed from 1 to 200.
  function scriptCost(list) {
    const rogue = new Rogue();
    return list.reduce((total, key) => total + rogue.abilities[key].cost, 0);
  }

  it("FINISHER_SCRIPT_IN_BUDGET fits the fight's energy with every attack landed", () => {
    const { duration } = GOLDEN_CASES.find(
      (goldenCase) => goldenCase.script === FINISHER_SCRIPT_IN_BUDGET,
    );
    const start = new Rogue().energy;
    const regen = k("energy.regenPerSecond");
    assert.equal(scriptCost(FINISHER_SCRIPT), 635);
    assert.equal(scriptCost(FINISHER_SCRIPT_IN_BUDGET), 545);
    // The energy for the last cast arrives this long into the fight: 53.5 s
    // for FINISHER_SCRIPT, 44.5 s for the in-budget one.
    assert.ok((scriptCost(FINISHER_SCRIPT) - start) / regen > duration);
    assert.ok(
      (scriptCost(FINISHER_SCRIPT_IN_BUDGET) - start) / regen <= duration - 5,
    );
  });

  it("FINISHER_SCRIPT_IN_BUDGET finishes on seeds 1 to 200, with Rupture and Eviscerate cast", () => {
    // runScriptedFight throws when a cast is still waiting at the end.
    for (let seed = 1; seed <= 200; seed++) {
      const { abilities } = runScriptedFight({
        seed,
        duration: 50,
        script: FINISHER_SCRIPT_IN_BUDGET,
      });
      assert.equal(abilities.Rupture?.casts, 1, `seed ${seed}`);
      assert.equal(abilities.Eviscerate?.casts, 1, `seed ${seed}`);
      assert.equal(abilities["Sinister Strike"]?.casts, 10, `seed ${seed}`);
      assert.equal(abilities.Hemorrhage?.casts, 1, `seed ${seed}`);
    }
  });

  it("FINISHER_SCRIPT does not finish on every seed, and the one left waiting is Eviscerate", () => {
    let unfinished = 0;
    for (let seed = 1; seed <= 200; seed++) {
      try {
        runScriptedFight({ seed, duration: 50, script: FINISHER_SCRIPT });
      } catch (error) {
        assert.match(
          error.message,
          /1 cast still waiting after 50s, next "eviscerate"/,
        );
        unfinished += 1;
      }
    }
    assert.ok(unfinished > 0);
  });

  it("has no parry or block, because every golden case fights from behind", async () => {
    // The default config puts the rogue behind the target (target.behind), and
    // the attack table (A7) gives parry and block to the front only. The
    // golden cases pin parries and blocks at 0 and this test proves the
    // reason. A case that fights from the front needs its own fixture.
    assert.equal(defaultConfig().target.behind, true);
    for (const attackType of ["skill", "weapon"]) {
      for (let roll = 0; roll <= k("attack.rollScale"); roll += 0.25) {
        const { outcome } = resolveAttack({
          attackType,
          baseDamage: 100,
          bonusHitChance: 0,
          critChance: k("character.critChance"),
          roll,
          glanceRoll: 50,
          critRoll: 50,
        });
        assert.notEqual(outcome, "parry", `${attackType} roll ${roll}`);
        assert.notEqual(outcome, "block", `${attackType} roll ${roll}`);
      }
    }
    for (const goldenCase of GOLDEN_CASES) {
      const { abilities } = parseGolden(
        await readFile(goldenPath(goldenCase.name), "utf8"),
      );
      for (const [name, record] of Object.entries(abilities)) {
        assert.equal(record.parries, 0, `${goldenCase.name}: ${name}`);
        assert.equal(record.blocks, 0, `${goldenCase.name}: ${name}`);
      }
    }
  });
});

for (const { name, script, sinisterStrikes } of SCRIPTED) {
  describe(`the scripted golden case ${name}`, () => {
    const goldenCase = GOLDEN_CASES.find(
      (candidate) => candidate.name === name,
    );

    async function fixture() {
      return parseGolden(await readFile(goldenPath(goldenCase.name), "utf8"));
    }

    it("casts exactly the scripted abilities, never the placeholder rotation", async () => {
      const { abilities } = await fixture();
      // 1 cast per script entry, and no Slice and Dice, Blade Flurry or
      // Adrenaline Rush, which the placeholder rotation would have cast.
      const scriptedCasts = {
        "Sinister Strike": sinisterStrikes,
        Hemorrhage: 1,
        Rupture: 1,
        Eviscerate: 1,
      };
      assert.equal(
        script.length,
        Object.values(scriptedCasts).reduce((sum, casts) => sum + casts, 0),
      );
      for (const [name, casts] of Object.entries(scriptedCasts)) {
        assert.equal(abilities[name]?.casts, casts, name);
      }
      assert.deepEqual(Object.keys(abilities).sort(), [
        "Eviscerate",
        "Hemorrhage",
        "Main-hand",
        "Off-hand",
        "Rupture",
        "Sinister Strike",
      ]);
    });

    it("pins Eviscerate, Rupture, DoT ticks and a tick crit", async () => {
      const { abilities, log, totalDamage } = await fixture();
      const eviscerate = abilities.Eviscerate;
      assert.equal(eviscerate.casts, 1);
      assert.ok(eviscerate.damage > 0, "Eviscerate landed and dealt damage");
      // A cast of Rupture deals no damage. Its ticks do.
      const rupture = abilities.Rupture;
      assert.equal(rupture.casts, 1);
      assert.equal(rupture.hits, 1, "the Rupture application landed");
      assert.ok(rupture.ticks >= 5, "Rupture has several ticks");
      assert.ok(rupture.tickCrits >= 1, "at least one Rupture tick crit");
      assert.ok(rupture.tickCrits < rupture.ticks);
      assert.ok(rupture.damage > 0);
      // The log is not capped out in this fight, so every Rupture tick is in it.
      assert.ok(log.length < k("log.maxEvents"));
      const ticks = log.filter(
        (event) => event.name === "Rupture" && event.damage > 0,
      );
      assert.equal(ticks.length, rupture.ticks);
      assert.equal(
        ticks.filter((event) => event.status === "Crit").length,
        rupture.tickCrits,
      );
      const eviscerateEvents = log.filter(
        (event) => event.name === "Eviscerate",
      );
      assert.equal(eviscerateEvents.length, 1);
      assert.equal(eviscerateEvents[0].damage, eviscerate.damage);
      // Ability damage adds up to the fight's total.
      const sum = Object.values(abilities).reduce(
        (total, record) => total + record.damage,
        0,
      );
      assert.ok(Math.abs(sum - totalDamage) < 1e-6);
    });

    it("has Rupture ticks both with and without the Hemorrhage bonus", async () => {
      // Hemorrhage is cast just before Rupture and lasts hemorrhage.ruptureBonus
      // .duration, which ends inside the 16 s Rupture. Non-crit tick sizes
      // therefore take exactly two values, one 1 + bonus times the other.
      const { log } = await fixture();
      const plain = new Set(
        log
          .filter(
            (event) =>
              event.name === "Rupture" &&
              event.damage > 0 &&
              event.status === "Hit",
          )
          .map((event) => event.damage),
      );
      assert.equal(plain.size, 2);
      const [low, high] = [...plain].sort((a, b) => a - b);
      assert.ok(
        Math.abs(high / low - (1 + k("hemorrhage.ruptureBonus").bonus)) < 1e-9,
      );
    });

    it("matches runGoldenCase, and leaves the placeholder rotation as it was", async () => {
      const plain = GOLDEN_CASES.find(
        (c) => c.script === undefined && c.duration >= 60,
      );
      const before = runGoldenCase(plain);
      assert.deepEqual(runGoldenCase(goldenCase), await fixture());
      assert.deepEqual(runGoldenCase(plain), before);
      assert.ok(
        before.abilities["Slice and Dice"].casts > 0,
        "the placeholder rotation still runs for a case with no script",
      );
    });
  });
}

// Issue #107. A case may carry a config, which runFight gets like any
// caller's. The first four cases carry none.
describe("a golden case with a config", () => {
  const config = {
    talents: referenceBuild(),
    poisons: { mainHand: "instant", offHand: "deadly" },
  };
  const withConfig = {
    name: "config-case",
    seed: 3,
    duration: 20,
    config,
  };
  const plain = { name: "plain-case", seed: 3, duration: 20 };

  it("runs the fight with that config, and without one runs the defaults", () => {
    assert.deepEqual(
      runGoldenCase(withConfig),
      pinnedPart(runFight({ seed: 3, duration: 20, config })),
    );
    assert.deepEqual(
      runGoldenCase(plain),
      pinnedPart(runFight({ seed: 3, duration: 20 })),
    );
    assert.notDeepEqual(runGoldenCase(withConfig), runGoldenCase(plain));
  });

  it("passes the config to a scripted case too", () => {
    const scripted = { ...withConfig, script: ["sinisterStrike"] };
    assert.deepEqual(
      runGoldenCase(scripted),
      pinnedPart(runScriptedFight({ ...scripted })),
    );
    assert.notDeepEqual(
      runGoldenCase(scripted),
      runGoldenCase({ ...scripted, config: undefined }),
    );
  });

  it("says what the case ran with in a mismatch or missing message", () => {
    const missing = formatMissing(withConfig);
    assert.match(
      missing,
      /seed 3, 20s, \d+ talents, poisons instant\/deadly\)/,
    );
    assert.match(formatMissing(plain), /\(seed 3, 20s\)/);
    assert.match(
      formatMismatch(
        { ...withConfig, config: { poisons: { mainHand: "deadly" } } },
        [],
      ),
      /poisons deadly\/none/,
    );
  });

  it("writes and reads back its fixture like any case, and a plain case is unaffected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowf-golden-config-"));
    try {
      const cases = [plain, withConfig];
      const wrote = await updateGolden({ dir, cases, write: true });
      assert.deepEqual(
        wrote.outcomes.map((outcome) => outcome.status),
        ["missing", "missing"],
      );
      const again = await updateGolden({ dir, cases });
      assert.deepEqual(
        again.outcomes.map((outcome) => outcome.status),
        ["unchanged", "unchanged"],
      );
      const fixture = parseGolden(
        await readFile(goldenPath("config-case", dir), "utf8"),
      );
      assert.deepEqual(Object.keys(fixture), [
        "seed",
        "duration",
        "totalDamage",
        "dps",
        "abilities",
        "log",
      ]);
      // The poisons of the config proc, so they are in the breakdown.
      assert.ok(fixture.abilities["Instant Poison"]);
      assert.ok(fixture.abilities["Deadly Poison"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
