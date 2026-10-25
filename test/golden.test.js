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
import { runFight } from "../js/fight.js";
import {
  GOLDEN_CASES,
  GOLDEN_DIR,
  MAX_LISTED_CHANGES,
  UPDATE_COMMAND,
  diffResults,
  formatGolden,
  formatMismatch,
  formatMissing,
  formatReport,
  goldenPath,
  parseArgs,
  parseGolden,
  updateGolden,
} from "../scripts/golden-update.mjs";

// Issue #77. The full headless result for a few fixed seeds and durations is
// pinned in test/golden/*.json. This file only reads those fixtures. Only
// `npm run golden:update -- --write` (scripts/golden-update.mjs) rewrites them.

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const script = resolve(root, "scripts/golden-update.mjs");
const FIVE_MINUTES = 300;
const MAX_FIXTURE_BYTES = 32 * 1024;

async function fixtureFiles() {
  return (await readdir(GOLDEN_DIR)).sort();
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
      const actual = runFight({
        seed: goldenCase.seed,
        duration: goldenCase.duration,
      });
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
  const fixture = parseGolden(
    formatGolden(
      runFight({ seed: goldenCase.seed, duration: goldenCase.duration }),
    ),
  );

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
      assert.match(formatReport(wrote), /Wrote 3 fixture files/);
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
        runFight({ seed: goldenCase.seed, duration: goldenCase.duration }),
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
