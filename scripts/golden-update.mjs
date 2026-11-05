import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runFight } from "../js/fight.js";
import { runScriptedFight } from "./scripted-fight.mjs";
import { referenceBuild } from "../data/reference-build.js";
import { defaultDaggerConfig } from "../js/sim-config.js";

// Golden-seed regression fixtures (#77, #85). Each case pins the full result of
// runFight({ seed, duration }), or of a scripted-cast fight (see
// scripts/scripted-fight.mjs), in a readable JSON file under test/golden/.
// test/golden.test.js compares a fresh run with those files and never writes
// them. This script is the only thing that does, and it writes nothing unless
// it is given --write. See "Golden-seed tests" in docs/mechanics.md.

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const GOLDEN_DIR = resolve(ROOT, "test", "golden");
export const UPDATE_COMMAND = "npm run golden:update -- --write";

// The scripted case (#85) casts these Rogue.abilities in this order, each as
// soon as it can be cast, instead of following the placeholder rotation,
// which never casts Eviscerate or Rupture. Hemorrhage goes last before Rupture
// so its debuff is up for every Rupture tick, and Rupture needs 5 combo points
// for its full 16 s, which outlasts the debuff, so the fixture has ticks both
// with and without the bonus. Seven builders (six Sinister Strikes and
// Hemorrhage) feed Rupture, so it still goes out at 5 combo points (16 s, 8
// ticks) when two of them do not land; four Sinister Strikes feed Eviscerate.
//
// Issue #234. It replaces #85's script (12 Sinister Strikes), whose case
// scripted-finishers-seed-68-50s was retired by James's decision: that script
// cost 635 energy, so with every attack landed its Eviscerate waited for 53.5 s
// of energy in a 50 s fight and finished only on 130 of seeds 1 to 200. This
// one costs 10 × 45 + 35 + 25 + 35 = 545; the fight starts with 100 and
// regenerates 10 a second, so with every attack landed it casts its last at
// 44.5 s. An attack that does not land refunds skill.missEnergyRefund of its
// cost, so a seed with misses finishes no later: on seeds 1 to 1,000 the last
// cast is at 44.5 s at the latest. test/golden.test.js runs it on seeds 1 to
// 200 and checks that it finishes on every one. Whether the Eviscerate hits
// or crits depends on the seed and the default sheet; the fixture records the
// outcome.
export const FINISHER_SCRIPT_IN_BUDGET = [
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
  "eviscerate",
];

// A case may also carry a `config` (issue #107): a partial SimConfig, such as
// { talents, poisons }, passed to runFight like any caller's. A case without
// one runs the defaults, as the first four do. The config is not pinned (see
// UNPINNED_FIELDS), but it is in this file, so a case says what it ran with.
//
// One short fight, one 5-minute fight, one more seed, and a scripted fight.
// Keep this list short: every case is a file to review whenever results move
// on purpose. A case with a script runs it (scripts/scripted-fight.mjs) instead
// of the placeholder rotation; any other case is plain runFight.
// Frozen all the way down (#213): a caller, such as test/fight-cases.js, reads
// the cases and copies a config before it runs one, and never changes one in
// place.
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Issue #266 (P4.6-03), retuned for TR-02 / #332 (1.60.1.70755): Murder,
// Improved Sinister Strike and Improved Eviscerate are gone; Lethality is
// max 2, Seal Fate max 3, Relentless Strikes max 5. Points fill Coup de
// Grace, Efficient Strikes and Precision instead. Blood Splatter is pending
// (TR-07) but legal to spend.
export const ASSASSINATION_BUILD = deepFreeze({
  "assassination.improved-gouge": 3,
  "assassination.remorseless-attacks": 2,
  "assassination.malice": 5,
  "assassination.ruthlessness": 3,
  "assassination.improved-expose-armor": 2,
  "assassination.improved-slice-and-dice": 3,
  "assassination.vigor": 2,
  "assassination.blood-splatter": 1,
  "assassination.lethality": 2,
  "assassination.vile-poisons": 5,
  "assassination.cold-blood": 1,
  "assassination.improved-poisons": 5,
  "assassination.relentless-strikes": 5,
  "assassination.improved-kidney-shot": 2,
  "assassination.seal-fate": 3,
  "combat.coup-de-grace": 3,
  "combat.efficient-strikes": 2,
  "combat.precision": 2,
});

// Issue #267 (P4.6-04a). Mutilate now requires Venom (still a talent; the
// Venom ability was removed from the spellbook — TR-05 owns the passive).
export const MUTILATE_BUILD = deepFreeze({
  "assassination.improved-gouge": 2,
  "assassination.remorseless-attacks": 2,
  "assassination.malice": 5,
  "assassination.ruthlessness": 3,
  "assassination.improved-expose-armor": 2,
  "assassination.improved-slice-and-dice": 3,
  "assassination.vigor": 2,
  "assassination.blood-splatter": 1,
  "assassination.lethality": 2,
  "assassination.vile-poisons": 5,
  "assassination.cold-blood": 1,
  "assassination.improved-poisons": 5,
  "assassination.relentless-strikes": 5,
  "assassination.venom": 1,
  "assassination.improved-kidney-shot": 2,
  "assassination.seal-fate": 3,
  "assassination.mutilate": 1,
  "combat.coup-de-grace": 3,
  "combat.efficient-strikes": 2,
  "combat.precision": 1,
});

// Eviscerate at 5 CP, otherwise Mutilate (with the talent check a rule for a
// talent ability needs).
const MUTILATE_ROTATION = deepFreeze({
  schemaVersion: 1,
  name: "Eviscerate at 5 CP, otherwise Mutilate",
  rules: [
    {
      action: "eviscerate",
      conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
    },
    {
      action: "mutilate",
      conditions: [{ type: "abilityGranted", ability: "mutilate" }],
    },
  ],
});

// The same, but every rule is held for the first 10 s so a Gnome + Vigor
// fight (#277) can fill to the raised energy cap before the first spend.
const POOL_SECONDS = 10;
const POOLED_MUTILATE_ROTATION = deepFreeze({
  schemaVersion: 1,
  name: "Pool to the cap for 10 s, then Eviscerate at 5 CP, otherwise Mutilate",
  rules: MUTILATE_ROTATION.rules.map((rule) => ({
    ...rule,
    conditions: [
      ...rule.conditions,
      { type: "fightTime", op: ">=", value: POOL_SECONDS },
    ],
  })),
});

const FIVE_CP = deepFreeze({ type: "comboPoints", op: ">=", value: 5 });
const UNDER_FIVE_CP = deepFreeze({ type: "comboPoints", op: "<", value: 5 });

// Issue #269. Subtlety on the 70755 tree: Quietus, Thousand Cuts and
// Improved Distract are gone; Opportunity is max 5. Pending talents (Boot
// Knife, Death Mark, Quick Getaway) are left for later TR issues.
export const SUBTLETY_BUILD = deepFreeze({
  "assassination.malice": 5,
  "assassination.ruthlessness": 3,
  "assassination.improved-slice-and-dice": 3,
  "assassination.vigor": 2,
  "assassination.blood-splatter": 1,
  "assassination.lethality": 2,
  "assassination.vile-poisons": 4,
  "subtlety.setup": 3,
  "subtlety.opportunity": 5,
  "subtlety.dirty-deeds": 2,
  "subtlety.camouflage": 2,
  "subtlety.improved-ambush": 3,
  "subtlety.dirty-tricks": 2,
  "subtlety.initiative": 3,
  "subtlety.premeditation": 1,
  "subtlety.serrated-blades": 3,
  "subtlety.elusiveness": 2,
  "subtlety.ghostly-strike": 1,
  "subtlety.heightened-senses": 2,
  "subtlety.preparation": 1,
  "subtlety.hemorrhage": 1,
});

export const SUBTLETY_ROTATION = deepFreeze({
  schemaVersion: 1,
  name: "Rupture, Eviscerate, Hemorrhage, then Backstab",
  rules: [
    {
      action: "rupture",
      conditions: [
        FIVE_CP,
        { type: "debuffRemaining", debuff: "rupture", op: "<", value: 1 },
      ],
    },
    { action: "eviscerate", conditions: [FIVE_CP] },
    {
      action: "hemorrhage",
      conditions: [
        { type: "abilityGranted", ability: "hemorrhage" },
        UNDER_FIVE_CP,
        { type: "debuffRemaining", debuff: "hemorrhage", op: "<", value: 1 },
      ],
    },
    { action: "backstab", conditions: [UNDER_FIVE_CP] },
  ],
});

export const PREPARATION_ROTATION = deepFreeze({
  schemaVersion: 1,
  name: "Ghostly Strike, Preparation, then the Subtlety rotation",
  rules: [
    {
      action: "ghostly-strike",
      conditions: [
        { type: "abilityGranted", ability: "ghostly-strike" },
        UNDER_FIVE_CP,
        { type: "cooldownReady", ability: "ghostly-strike" },
      ],
    },
    {
      action: "preparation",
      conditions: [
        { type: "abilityGranted", ability: "preparation" },
        { type: "cooldownReady", ability: "ghostly-strike", ready: false },
        { type: "cooldownReady", ability: "preparation" },
      ],
    },
    ...SUBTLETY_ROTATION.rules,
  ],
});

export const CUTTHROAT_BUILD = deepFreeze({
  "assassination.malice": 5,
  "assassination.ruthlessness": 3,
  "assassination.murder": 2,
  "assassination.lethality": 5,
  "subtlety.master-of-deception": 3,
  "subtlety.opportunity": 2,
  "subtlety.setup": 3,
  "subtlety.dirty-tricks": 2,
  "subtlety.improved-ambush": 3,
  "subtlety.initiative": 3,
  "subtlety.ghostly-strike": 1,
  "subtlety.premeditation": 1,
  "subtlety.serrated-blades": 3,
  "subtlety.dirty-deeds": 2,
  "subtlety.preparation": 1,
  "subtlety.hemorrhage": 1,
  "subtlety.quietus": 5,
  "subtlety.cutthroat": 5,
  "subtlety.thousand-cuts": 1,
});
export const AMBUSH_ROTATION = deepFreeze({
  schemaVersion: 1,
  name: "Rupture, Eviscerate, Ambush, Hemorrhage, then Backstab",
  rules: [
    ...SUBTLETY_ROTATION.rules.slice(0, 2),
    { action: "ambush", conditions: [UNDER_FIVE_CP] },
    ...SUBTLETY_ROTATION.rules.slice(2),
  ],
});

// CUTTHROAT_BUILD / AMBUSH_ROTATION kept for unit tests (#271).
// The cutthroat golden case is retired until a later issue remaps Ambush.

export const GOLDEN_CASES = deepFreeze([
  { name: "short-seed-1-10s", seed: 1, duration: 10 },
  { name: "five-minute-seed-1-300s", seed: 1, duration: 300 },
  { name: "other-seed-12345-90s", seed: 12345, duration: 90 },
  {
    name: "scripted-finishers-in-budget-seed-68-50s",
    seed: 68,
    duration: 50,
    script: FINISHER_SCRIPT_IN_BUDGET,
  },
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
  // TR-02 / #332 interim: the combat-swords / dagger preset goldens and the
  // Cutthroat / Venom-ability cases are retired until TR-03 / TR-11 (presets
  // empty; those talents/abilities are gone). DPS before retirement is
  // logged in the PR body.
  {
    name: "assassination-build-seed-266-60s",
    seed: 266,
    duration: 60,
    config: {
      talents: { ...ASSASSINATION_BUILD },
      poisons: { mainHand: "instant", offHand: "deadly" },
    },
  },
  {
    name: "mutilate-daggers-seed-267-60s",
    seed: 267,
    duration: 60,
    config: {
      character: defaultDaggerConfig().character,
      weapons: defaultDaggerConfig().weapons,
      talents: { ...MUTILATE_BUILD },
      poisons: { mainHand: "instant", offHand: "deadly" },
      rotation: MUTILATE_ROTATION,
    },
  },
  {
    name: "subtlety-build-seed-269-60s",
    seed: 269,
    duration: 60,
    config: {
      character: defaultDaggerConfig().character,
      weapons: defaultDaggerConfig().weapons,
      talents: { ...SUBTLETY_BUILD },
      rotation: SUBTLETY_ROTATION,
    },
  },
  {
    name: "preparation-subtlety-seed-270-60s",
    seed: 270,
    duration: 60,
    config: {
      character: defaultDaggerConfig().character,
      weapons: defaultDaggerConfig().weapons,
      talents: { ...SUBTLETY_BUILD },
      rotation: PREPARATION_ROTATION,
    },
  },
  ...["human", "dwarf", "skyborne-windshaper"].map((race) => ({
    name: `race-${race}-seed-277-60s`,
    seed: 277,
    duration: 60,
    config: {
      race,
      talents: referenceBuild(),
      poisons: { mainHand: "instant", offHand: "deadly" },
    },
  })),
  {
    name: "race-gnome-vigor-seed-277-60s",
    seed: 277,
    duration: 60,
    config: {
      race: "gnome",
      character: defaultDaggerConfig().character,
      weapons: defaultDaggerConfig().weapons,
      talents: { ...MUTILATE_BUILD },
      poisons: { mainHand: "instant", offHand: "deadly" },
      rotation: POOLED_MUTILATE_ROTATION,
    },
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
