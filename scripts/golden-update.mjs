import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runFight } from "../js/fight.js";
import { runScriptedFight } from "./scripted-fight.mjs";
import { loadPreset } from "../js/rotation-presets.js";
import { referenceBuild } from "../data/reference-build.js";

// Golden-seed regression fixtures (#77, #85). Each case pins the full result of
// runFight({ seed, duration }), or of a scripted-cast fight (see
// scripts/scripted-fight.mjs), in a readable JSON file under test/golden/.
// test/golden.test.js compares a fresh run with those files and never writes
// them. This script is the only thing that does, and it writes nothing unless
// it is given --write. See "Golden-seed tests" in docs/mechanics.md.

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const GOLDEN_DIR = resolve(ROOT, "test", "golden");
export const UPDATE_COMMAND = "npm run golden:update -- --write";

// A scripted case (#85) casts these Rogue.abilities in this order, each as soon
// as it can be cast, instead of following the placeholder rotation, which never
// casts Eviscerate or Rupture. Hemorrhage goes last before Rupture so its
// debuff is up for every Rupture tick, and Rupture needs 5 combo points for its
// full 16 s, which outlasts the debuff, so the fixture has ticks both with and
// without the bonus. Five builders at 5 combo points feed Eviscerate. The seed
// was chosen so that the fight has Rupture ticks and a tick crit;
// test/golden.test.js checks that it keeps them. After A7 (#100) the attack
// table moved the draws and the crit chance: two of the first four Sinister
// Strikes dodged, so Rupture went out at 3 combo points and lost the ticks
// without the bonus. The script now opens with seven Sinister Strikes, so
// Rupture still goes out at 5 combo points when two dodge (a landed extra only
// wastes a point, as combo points stop at 5), and the seed was kept.
// Whether the Eviscerate hits or crits depends on the seed and the default
// sheet; the fixture records the outcome.
export const FINISHER_SCRIPT = [
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "hemorrhage",
  "rupture",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "sinisterStrike",
  "eviscerate",
];

// A case may also carry a `config` (issue #107): a partial SimConfig, such as
// { talents, poisons }, passed to runFight like any caller's. A case without
// one runs the defaults, as the first four do. The config is not pinned (see
// UNPINNED_FIELDS), but it is in this file, so a case says what it ran with.
//
// One short fight, one 5-minute fight, one more seed, and one scripted fight.
// Keep this list short: every case is a file to review whenever results move
// on purpose. A case with a script runs it (scripts/scripted-fight.mjs) instead
// of the placeholder rotation; any other case is plain runFight.
// Frozen all the way down (#213): a caller, such as the parity harness, reads
// the cases and copies a config before it runs one, and never changes one in
// place.
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const GOLDEN_CASES = deepFreeze([
  { name: "short-seed-1-10s", seed: 1, duration: 10 },
  { name: "five-minute-seed-1-300s", seed: 1, duration: 300 },
  { name: "other-seed-12345-90s", seed: 12345, duration: 90 },
  {
    name: "scripted-finishers-seed-68-50s",
    seed: 68,
    duration: 50,
    script: FINISHER_SCRIPT,
  },
  // Issue #107. The two cases below run the reference build (Assassination 18
  // / Combat 33 / Subtlety 0, the talentsforever.com link in
  // data/reference-build.js, the same one the talent coverage check uses)
  // through applyBuild, and they share a seed.
  // The first has the talents and no poisons. The second adds Instant Poison
  // on the main hand and Deadly Poison on the off hand. The build is read from
  // the test helper so that the link is written down in one place.
  {
    name: "talented-build-seed-107-60s",
    seed: 107,
    duration: 60,
    config: { talents: referenceBuild() },
  },
  {
    name: "poisons-instant-deadly-seed-107-60s",
    seed: 107,
    duration: 60,
    config: {
      talents: referenceBuild(),
      poisons: { mainHand: "instant", offHand: "deadly" },
    },
  },
  // Issue #142. The Combat swords preset (js/rotation-presets.js) on the
  // reference build, to pin what the preset rotation does: the Slice and Dice
  // pooling rule of #122, with Blade Flurry and Adrenaline Rush on cooldown.
  // The default fight kept the placeholder rotation, so the cases above did
  // not move then. Issue #155 gave the default the preset's two Slice and Dice
  // rules, which moved three of them (other-seed, talented-build and poisons).
  {
    name: "combat-swords-preset-seed-142-120s",
    seed: 142,
    duration: 120,
    config: loadPreset("combat-swords", { talents: referenceBuild() }),
  },
]);

// Files that can turn up in test/golden/ without being a stray case: macOS
// writes .DS_Store into any folder Finder opens. They are not fixtures.
export const IGNORED_FILES = [".DS_Store"];

// Result fields that are not pinned by a fixture. `dataVersion` (D11, #91)
// names the data snapshot, so it changes whenever `npm run data:refresh` runs,
// even when no number in a fight moves. Pinning it would rewrite every fixture
// on each refresh. test/golden.test.js checks it separately: every result must
// carry the current dataVersion.
//
// `config` (E2-lite, #92) is the SimConfig the fight ran with. A case with no
// config runs the defaults, which come from constants the fixtures already pin
// through their numbers. It is left out so a result field added for the config
// does not rewrite the fixtures. test/golden.test.js checks it separately: it
// is the default config, or for a case that has a config, that config's talents
// and poisons (issue #107).
export const UNPINNED_FIELDS = ["dataVersion", "config"];

// A result without the unpinned fields: the payload a fixture holds.
export function pinnedPart(result) {
  return Object.fromEntries(
    Object.entries(result).filter(([key]) => !UNPINNED_FIELDS.includes(key)),
  );
}

// The fight a case pins: runFight, or the case's script on the real engine,
// without the unpinned fields.
export function runGoldenCase(goldenCase) {
  const { seed, duration, script, config } = goldenCase;
  return pinnedPart(
    script === undefined
      ? runFight({ seed, duration, config })
      : runScriptedFight({ seed, duration, script, config }),
  );
}

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

// "seed 1, 10s", or "seed 68, 50s, scripted casts" for a case with a script.
function describeCase({ seed, duration, script, config }) {
  const parts = [`seed ${seed}`, `${duration}s`];
  if (script !== undefined) {
    parts.push("scripted casts");
  }
  const talents = Object.keys(config?.talents ?? {}).length;
  if (talents > 0) {
    parts.push(`${talents} talents`);
  }
  const { mainHand, offHand } = config?.poisons ?? {};
  if (mainHand || offHand) {
    parts.push(`poisons ${mainHand ?? "none"}/${offHand ?? "none"}`);
  }
  return parts.join(", ");
}

// The text a failing golden test prints: which fields changed, then how and
// when to regenerate.
export function formatMismatch(goldenCase, changes) {
  const { name } = goldenCase;
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
    `Golden fight "${name}" (${describeCase(goldenCase)}) no longer matches test/golden/${name}.json.`,
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
  const { name } = goldenCase;
  return [
    `Golden fight "${name}" (${describeCase(goldenCase)}) has no fixture at test/golden/${name}.json.`,
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
    const result = runGoldenCase(goldenCase);
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
  const known = new Set([
    ...cases.map((goldenCase) => `${goldenCase.name}.json`),
    ...IGNORED_FILES,
  ]);
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
      `Warning: test/golden/${file} is not a golden case. Delete the file, or add its case to GOLDEN_CASES.`,
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
