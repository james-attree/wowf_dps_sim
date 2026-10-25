import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runFight } from "../js/fight.js";

// Golden-seed regression fixtures (#77). Each case pins the full result of
// runFight({ seed, duration }) in a readable JSON file under test/golden/.
// test/golden.test.js compares a fresh run with those files and never writes
// them. This script is the only thing that does, and it writes nothing unless
// it is given --write. See "Golden-seed tests" in docs/mechanics.md.

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const GOLDEN_DIR = resolve(ROOT, "test", "golden");
export const UPDATE_COMMAND = "npm run golden:update -- --write";

// One short fight, one 5-minute fight, and one more seed. Keep this list
// short: every case is a file to review whenever results move on purpose.
export const GOLDEN_CASES = [
  { name: "short-seed-1-10s", seed: 1, duration: 10 },
  { name: "five-minute-seed-1-300s", seed: 1, duration: 300 },
  { name: "other-seed-12345-90s", seed: 12345, duration: 90 },
];

// How many changed fields a failure message lists before it says "and N more".
export const MAX_LISTED_CHANGES = 20;

export const HELP_TEXT = `Compare, or rewrite, the golden-seed fixtures in test/golden/.

Usage: npm run golden:update [-- --write]

  (no flag)  Dry run. Runs every golden case, prints the fields that differ from
             the fixture files, and writes nothing.
  --write    Rewrite the fixture files that differ. Do this only when a change
             to a rule, a constant, or the engine should move fight results.
  --help     Show this text.

After --write, review the fixture diff in git and explain why the results
changed in the pull request description.`;

export function goldenPath(name, dir = GOLDEN_DIR) {
  return join(dir, `${name}.json`);
}

function leaf(value) {
  return JSON.stringify(value);
}

// The fixture text: top-level fields on their own lines, one ability per line,
// one log event per line. That keeps the files short and makes a git diff show
// the ability or event that moved. JSON.parse reads it back to the same
// result, because a result is plain numbers and strings.
export function formatGolden(result) {
  const lines = ["{"];
  const fields = [];
  for (const [key, value] of Object.entries(result)) {
    if (key === "abilities") {
      const rows = Object.entries(value).map(
        ([name, record]) => `    ${leaf(name)}: ${leaf(record)}`,
      );
      fields.push(
        rows.length === 0
          ? `  "abilities": {}`
          : `  "abilities": {\n${rows.join(",\n")}\n  }`,
      );
    } else if (key === "log") {
      const rows = value.map((event) => `    ${leaf(event)}`);
      fields.push(
        rows.length === 0
          ? `  "log": []`
          : `  "log": [\n${rows.join(",\n")}\n  ]`,
      );
    } else {
      fields.push(`  ${leaf(key)}: ${leaf(value)}`);
    }
  }
  lines.push(fields.join(",\n"), "}", "");
  return lines.join("\n");
}

export function parseGolden(text) {
  return JSON.parse(text);
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function joinPath(path, key, parent) {
  if (Array.isArray(parent)) {
    return `${path}[${key}]`;
  }
  return path === "" ? String(key) : `${path}.${key}`;
}

// Every leaf field that differs, as { path, expected, actual }. A field one
// side lacks has the value undefined on that side. Paths read like
// abilities.Sinister Strike.damage and log[3].damage.
export function diffResults(expected, actual, path = "") {
  if (isObject(expected) && isObject(actual)) {
    if (Array.isArray(expected) !== Array.isArray(actual)) {
      return [{ path, expected, actual }];
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap((key) =>
      diffResults(
        expected[key],
        actual[key],
        joinPath(path, key, Array.isArray(expected) ? expected : actual),
      ),
    );
  }
  return Object.is(expected, actual) ? [] : [{ path, expected, actual }];
}

function show(value) {
  return value === undefined ? "(missing)" : leaf(value);
}

// The text a failing golden test prints: which fields changed, then how and
// when to regenerate.
export function formatMismatch(goldenCase, changes) {
  const { name, seed, duration } = goldenCase;
  const listed = changes
    .slice(0, MAX_LISTED_CHANGES)
    .map(
      ({ path, expected, actual }) =>
        `  ${path}: ${show(expected)} -> ${show(actual)}`,
    );
  if (changes.length > MAX_LISTED_CHANGES) {
    listed.push(`  ... and ${changes.length - MAX_LISTED_CHANGES} more`);
  }
  return [
    `Golden fight "${name}" (seed ${seed}, ${duration}s) no longer matches test/golden/${name}.json.`,
    `${changes.length} field${changes.length === 1 ? "" : "s"} changed (fixture -> now):`,
    ...listed,
    "",
    "Results should only move when you changed a rule, a constant, or the engine on purpose.",
    "- Not on purpose (a refactor, a speed-up, an unrelated change): this is a regression. Fix the code, and do not regenerate the fixtures.",
    `- On purpose: run \`${UPDATE_COMMAND}\`, review the fixture diff in git, and explain in the pull request why the results changed.`,
    "Run `npm run golden:update` without --write for a dry run that writes nothing.",
  ].join("\n");
}

export function formatMissing(goldenCase) {
  const { name, seed, duration } = goldenCase;
  return [
    `Golden fight "${name}" (seed ${seed}, ${duration}s) has no fixture at test/golden/${name}.json.`,
    `If this case is new, create the file with \`${UPDATE_COMMAND}\`, review it, and commit it.`,
    "If the file was deleted or renamed by accident, restore it from git instead.",
  ].join("\n");
}

async function readFixture(path) {
  try {
    return parseGolden(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

// Run every case and compare it with its fixture. With write: true, rewrite
// the fixtures that are missing or differ. With the default, write nothing.
export async function updateGolden({
  dir = GOLDEN_DIR,
  cases = GOLDEN_CASES,
  write = false,
} = {}) {
  const outcomes = [];
  for (const goldenCase of cases) {
    const result = runFight({
      seed: goldenCase.seed,
      duration: goldenCase.duration,
    });
    const path = goldenPath(goldenCase.name, dir);
    const fixture = await readFixture(path);
    const changes = fixture === undefined ? [] : diffResults(fixture, result);
    // The text must match too, so a hand-edited layout is put back.
    const text = formatGolden(result);
    const current =
      fixture === undefined ? undefined : await readFile(path, "utf8");
    const status =
      fixture === undefined
        ? "missing"
        : changes.length > 0 || current !== text
          ? "changed"
          : "unchanged";
    if (write && status !== "unchanged") {
      await mkdir(dir, { recursive: true });
      await writeFile(path, text);
    }
    outcomes.push({
      case: goldenCase,
      path,
      status,
      changes,
      written: write && status !== "unchanged",
    });
  }
  const known = new Set(cases.map((goldenCase) => `${goldenCase.name}.json`));
  let stray = [];
  try {
    stray = (await readdir(dir)).filter((file) => !known.has(file)).sort();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return { outcomes, stray, write };
}

export function formatReport({ outcomes, stray, write }) {
  const lines = [];
  for (const outcome of outcomes) {
    const { name } = outcome.case;
    if (outcome.status === "unchanged") {
      lines.push(`${name}: unchanged`);
    } else if (outcome.status === "missing") {
      lines.push(`${name}: no fixture yet${write ? ", written" : ""}`);
    } else {
      lines.push(
        `${name}: ${outcome.changes.length} field${outcome.changes.length === 1 ? " differs" : "s differ"}${write ? ", rewritten" : ""}`,
      );
      for (const { path, expected, actual } of outcome.changes.slice(
        0,
        MAX_LISTED_CHANGES,
      )) {
        lines.push(`  ${path}: ${show(expected)} -> ${show(actual)}`);
      }
      if (outcome.changes.length > MAX_LISTED_CHANGES) {
        lines.push(
          `  ... and ${outcome.changes.length - MAX_LISTED_CHANGES} more`,
        );
      }
    }
  }
  for (const file of stray) {
    lines.push(
      `Warning: test/golden/${file} is not a golden case. Delete it by hand, or add the case to GOLDEN_CASES.`,
    );
  }
  const pending = outcomes.filter((outcome) => outcome.status !== "unchanged");
  if (pending.length === 0) {
    lines.push("Every fixture already matches. Nothing to do.");
  } else if (write) {
    lines.push(
      `Wrote ${pending.length} fixture file${pending.length === 1 ? "" : "s"}. Review the diff in git and explain the change in the pull request.`,
    );
  } else {
    lines.push(
      `Dry run: nothing was written. To rewrite the fixtures on purpose, run \`${UPDATE_COMMAND}\`.`,
    );
  }
  return lines.join("\n");
}

export function parseArgs(argv) {
  const options = { write: false, help: false };
  for (const arg of argv) {
    if (arg === "--write") {
      options.write = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${HELP_TEXT}`);
    }
  }
  return options;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  try {
    console.log(formatReport(await updateGolden({ write: options.write })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}
