import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";
import { displayPath } from "./provenance.mjs";

// Pinned talentsforever.com rogue export (#6). The app never fetches it.
// Icon downloads stay with a later issue. This command pretty-prints the
// snapshot, records generated, build, and fetch date, and prints a review diff.

export const EXPORT_URL = "https://talentsforever.com/export/rogue.json";
export const CREDIT_NAME = "talentsforever.com";
export const CREDIT_URL = "https://talentsforever.com/";
export const LICENSE = "CC BY 4.0";
export const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const POISON_TAB = "Poisons";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_SNAPSHOT_PATH = resolve(
  ROOT,
  "data",
  "talentsforever",
  "rogue.json",
);
export const DEFAULT_MANIFEST_PATH = resolve(
  ROOT,
  "data",
  "talentsforever",
  "manifest.json",
);

const PREVIEW_LIMIT = 160;
const DETAILED_SECTIONS = new Set(["talents", "spell_desc"]);
const FETCH_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BUILD_IN_SOURCE = /build\s+(\d+(?:\.\d+)+)/;

export const HELP_TEXT = `Fetch the talentsforever.com rogue export and vendor it.

Usage: node scripts/refresh-data.mjs [--url URL] [--snapshot PATH] [--manifest PATH]

Pretty-prints the snapshot, writes a manifest with generated, build, and fetch
date, then prints added, removed, and changed talents, spells, and poisons.
The app does not fetch this file. --url changes where the bytes are downloaded
from and does not change the credit.

Credit: ${CREDIT_NAME} (${CREDIT_URL}) under ${LICENSE} (${LICENSE_URL})
`;

export function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function show(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function readBuild(snapshot) {
  const build = snapshot?.spellbook?.build;
  if (typeof build === "string" && build.trim() !== "") {
    return build.trim();
  }
  const source = snapshot?.talents?.source;
  if (typeof source === "string") {
    const match = source.match(BUILD_IN_SOURCE);
    if (match) {
      return match[1];
    }
  }
  return "";
}

export function assertSnapshot(snapshot, label = "Export") {
  if (!isPlainObject(snapshot)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (!Array.isArray(snapshot.talents?.trees)) {
    throw new Error(`${label} is missing talents.trees`);
  }
  if (!isPlainObject(snapshot.spell_desc)) {
    throw new Error(`${label} is missing spell_desc`);
  }
  if (
    typeof snapshot.generated !== "string" ||
    snapshot.generated.trim() === ""
  ) {
    throw new Error(`${label} is missing generated`);
  }
  if (!readBuild(snapshot)) {
    throw new Error(`${label} is missing the client build`);
  }
}

export function buildManifest(snapshot, fetched) {
  assertSnapshot(snapshot);
  if (typeof fetched !== "string" || !FETCH_DATE.test(fetched)) {
    throw new Error(`Fetch date must be YYYY-MM-DD, got ${show(fetched)}`);
  }
  return {
    source: EXPORT_URL,
    credit: CREDIT_NAME,
    creditUrl: CREDIT_URL,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    note: "Data from talentsforever.com, used under CC BY 4.0. Pretty-printed; values unchanged. Game names, icons, and tooltip text belong to Blizzard Entertainment.",
    generated: snapshot.generated.trim(),
    build: readBuild(snapshot),
    fetched,
  };
}

// Prettier's JSON printer, so a refresh cannot fail `prettier --check`.
export async function formatSnapshot(value) {
  return format(JSON.stringify(value), { parser: "json" });
}

function talentLabel(talent) {
  if (typeof talent?.name === "string" && talent.name.trim() !== "") {
    return talent.name.trim();
  }
  return `(unnamed r${talent?.row ?? "?"}c${talent?.col ?? "?"})`;
}

function addTalent(talents, id, talent) {
  if (talents.has(id)) {
    throw new Error(`Duplicate talent id ${id}`);
  }
  talents.set(id, talent);
}

export function collectTalents(snapshot) {
  const talents = new Map();
  const trees = snapshot?.talents?.trees ?? [];
  for (const tree of trees) {
    const treeName =
      typeof tree?.name === "string" && tree.name.trim() !== ""
        ? tree.name.trim()
        : "(unknown tree)";
    for (const talent of tree?.talents ?? []) {
      addTalent(talents, `${treeName} / ${talentLabel(talent)}`, talent);
    }
    // Classic talents the current tree no longer has. They are still talent
    // records, so a refresh that edits or restores one shows up in the diff.
    for (const talent of tree?.removed ?? []) {
      addTalent(
        talents,
        `${treeName} / ${talentLabel(talent)} [not in tree]`,
        talent,
      );
    }
  }
  return talents;
}

export function spellNameFromKey(key) {
  const parts = String(key).split("|");
  if (parts.length < 2 || parts[1] === "") {
    return String(key);
  }
  return parts[1];
}

export function poisonNames(snapshot) {
  const names = new Set();
  const tabs = snapshot?.spellbook?.tabs;
  if (!Array.isArray(tabs)) {
    return names;
  }
  for (const tab of tabs) {
    if (tab?.name !== POISON_TAB || !Array.isArray(tab.spells)) {
      continue;
    }
    for (const entry of tab.spells) {
      const name = Array.isArray(entry) ? entry[0] : entry?.name;
      if (typeof name === "string" && name.trim() !== "") {
        names.add(name);
      }
    }
  }
  return names;
}

function isPoisonName(name, names) {
  return names.has(name) || /poison/i.test(name);
}

export function collectSpells(snapshot) {
  const names = poisonNames(snapshot);
  const spells = new Map();
  const poisons = new Map();
  const entries = snapshot?.spell_desc ?? {};
  for (const [key, value] of Object.entries(entries)) {
    const bucket = isPoisonName(spellNameFromKey(key), names)
      ? poisons
      : spells;
    bucket.set(key, value);
  }
  return { spells, poisons };
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const ABSENT = Symbol("absent");

function changedFields(before, after, path = "") {
  if (Object.is(before, after)) {
    return [];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const left = index < before.length ? before[index] : ABSENT;
      const right = index < after.length ? after[index] : ABSENT;
      const child = `${path}[${index}]`;
      changes.push(...changedFields(left, right, child));
    }
    return changes;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    const changes = [];
    for (const key of keys) {
      const child = path ? `${path}.${key}` : key;
      const left = Object.hasOwn(before, key) ? before[key] : ABSENT;
      const right = Object.hasOwn(after, key) ? after[key] : ABSENT;
      changes.push(...changedFields(left, right, child));
    }
    return changes;
  }
  return [{ path: path || "(value)", before, after }];
}

function compareIds(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function diffRecords(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, value] of before) {
    if (!after.has(id)) {
      removed.push(id);
      continue;
    }
    const fields = changedFields(value, after.get(id));
    if (fields.length > 0) {
      changed.push({ id, fields });
    }
  }
  for (const id of after.keys()) {
    if (!before.has(id)) {
      added.push(id);
    }
  }
  added.sort(compareIds);
  removed.sort(compareIds);
  changed.sort((left, right) => compareIds(left.id, right.id));
  return { added, removed, changed };
}

export function changedSections(previous, next) {
  if (!previous) {
    return [];
  }
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed = [];
  for (const key of [...keys].sort(compareIds)) {
    if (DETAILED_SECTIONS.has(key)) {
      continue;
    }
    if (canonical(previous[key]) !== canonical(next[key])) {
      changed.push(key);
    }
  }
  return changed;
}

export function diffSnapshot(previous, next) {
  const beforeTalents = previous ? collectTalents(previous) : new Map();
  const afterTalents = collectTalents(next);
  const beforeSpells = previous
    ? collectSpells(previous)
    : { spells: new Map(), poisons: new Map() };
  const afterSpells = collectSpells(next);
  return {
    talents: diffRecords(beforeTalents, afterTalents),
    spells: diffRecords(beforeSpells.spells, afterSpells.spells),
    poisons: diffRecords(beforeSpells.poisons, afterSpells.poisons),
    sections: changedSections(previous, next),
  };
}

function preview(value) {
  if (value === ABSENT) {
    return "(absent)";
  }
  const text = JSON.stringify(value) ?? "undefined";
  if (text.length <= PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, PREVIEW_LIMIT - 3)}...`;
}

function formatList(label, ids, prefix) {
  const lines = [`  ${label}:`];
  if (ids.length === 0) {
    lines.push("    (none)");
    return lines;
  }
  for (const id of ids) {
    lines.push(`    ${prefix} ${id}`);
  }
  return lines;
}

function formatSection(title, diff) {
  const lines = [
    `${title}: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
    ...formatList("added", diff.added, "+"),
    ...formatList("removed", diff.removed, "-"),
    "  changed:",
  ];
  if (diff.changed.length === 0) {
    lines.push("    (none)");
    return lines;
  }
  for (const change of diff.changed) {
    lines.push(`    ~ ${change.id}`);
    for (const field of change.fields) {
      lines.push(
        `      ${field.path}: ${preview(field.before)} -> ${preview(field.after)}`,
      );
    }
  }
  return lines;
}

export function formatRefreshReport({
  snapshotPath,
  manifestPath,
  manifest,
  diff,
  previousPresent,
}) {
  const lines = [
    `Updated ${displayPath(snapshotPath)}`,
    `Updated ${displayPath(manifestPath)}`,
    `generated: ${manifest.generated}`,
    `build: ${manifest.build}`,
    `fetched: ${manifest.fetched}`,
    `credit: ${manifest.credit} (${manifest.creditUrl}) under ${manifest.license} (${manifest.licenseUrl})`,
  ];
  if (!previousPresent) {
    lines.push(
      "No previous snapshot; every talent, spell, and poison is listed as added.",
    );
  }
  lines.push("");
  lines.push(...formatSection("Talents", diff.talents));
  lines.push("");
  lines.push(...formatSection("Spells", diff.spells));
  lines.push("");
  lines.push(...formatSection("Poisons", diff.poisons));
  lines.push("");
  if (!previousPresent) {
    lines.push("Other sections: (no previous snapshot)");
  } else if (diff.sections.length === 0) {
    lines.push("Other sections: (none)");
  } else {
    lines.push(`Other sections: ${diff.sections.join(", ")}`);
  }
  return lines.join("\n");
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// JSON.parse keeps the last of two identical keys. Scan the raw text so a
// refresh cannot drop a talent, spell, or poison that way. The path uses "."
// between object keys and "[index]" for array elements.
export function findDuplicateKey(text) {
  let index = 0;

  function skipWhitespace() {
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        return;
      }
      index += 1;
    }
  }

  function parseString() {
    if (text[index] !== '"') {
      throw new Error("Expected a JSON string");
    }
    index += 1;
    let value = "";
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        return value;
      }
      if (character === "\\") {
        index += 1;
        const escaped = text[index];
        if (escaped === undefined) {
          throw new Error("Unterminated JSON string");
        }
        if (escaped === "u") {
          const hex = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new Error("Bad unicode escape");
          }
          value += String.fromCharCode(Number.parseInt(hex, 16));
          index += 5;
          continue;
        }
        index += 1;
        if (escaped === '"' || escaped === "\\" || escaped === "/") {
          value += escaped;
        } else if (escaped === "b") {
          value += "\b";
        } else if (escaped === "f") {
          value += "\f";
        } else if (escaped === "n") {
          value += "\n";
        } else if (escaped === "r") {
          value += "\r";
        } else if (escaped === "t") {
          value += "\t";
        } else {
          throw new Error("Bad escape");
        }
        continue;
      }
      value += character;
      index += 1;
    }
    throw new Error("Unterminated JSON string");
  }

  function skipNumber() {
    if (text[index] === "-") {
      index += 1;
    }
    if (text[index] === "0") {
      index += 1;
    } else if (text[index] >= "1" && text[index] <= "9") {
      while (text[index] >= "0" && text[index] <= "9") {
        index += 1;
      }
    } else {
      throw new Error("Bad number");
    }
    if (text[index] === ".") {
      index += 1;
      if (!(text[index] >= "0" && text[index] <= "9")) {
        throw new Error("Bad number");
      }
      while (text[index] >= "0" && text[index] <= "9") {
        index += 1;
      }
    }
    if (text[index] === "e" || text[index] === "E") {
      index += 1;
      if (text[index] === "+" || text[index] === "-") {
        index += 1;
      }
      if (!(text[index] >= "0" && text[index] <= "9")) {
        throw new Error("Bad number");
      }
      while (text[index] >= "0" && text[index] <= "9") {
        index += 1;
      }
    }
  }

  function skipLiteral(word) {
    if (!text.startsWith(word, index)) {
      throw new Error("Bad literal");
    }
    index += word.length;
  }

  function parseObject(path) {
    index += 1;
    const keys = new Set();
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return null;
    }
    while (index < text.length) {
      skipWhitespace();
      const key = parseString();
      const child = path === "" ? key : `${path}.${key}`;
      if (keys.has(key)) {
        return child;
      }
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") {
        throw new Error("Expected a colon");
      }
      index += 1;
      const nested = skipValue(child);
      if (nested !== null) {
        return nested;
      }
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "}") {
        index += 1;
        return null;
      }
      throw new Error("Expected a comma or }");
    }
    throw new Error("Unterminated object");
  }

  function parseArray(path) {
    index += 1;
    let item = 0;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return null;
    }
    while (index < text.length) {
      const nested = skipValue(`${path}[${item}]`);
      if (nested !== null) {
        return nested;
      }
      item += 1;
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        return null;
      }
      throw new Error("Expected a comma or ]");
    }
    throw new Error("Unterminated array");
  }

  function skipValue(path) {
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      return parseObject(path);
    }
    if (character === "[") {
      return parseArray(path);
    }
    if (character === '"') {
      parseString();
      return null;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      skipNumber();
      return null;
    }
    if (character === "t") {
      skipLiteral("true");
      return null;
    }
    if (character === "f") {
      skipLiteral("false");
      return null;
    }
    if (character === "n") {
      skipLiteral("null");
      return null;
    }
    throw new Error("Unexpected JSON");
  }

  return skipValue("");
}

function parseJsonText(text, invalidMessage) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(invalidMessage);
  }
  const duplicate = findDuplicateKey(text);
  if (duplicate) {
    throw new Error(`Duplicate key ${duplicate}`);
  }
  return value;
}

// The snapshot and the manifest are one pin. Both temp files are written
// before either rename, so a failed temp write removes both temps and leaves
// both targets unchanged.
async function writeBoth(files, writeFileImpl) {
  const temps = [];
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
    }
    for (const file of files) {
      const temporary = `${file.path}.${process.pid}.tmp`;
      temps.push(temporary);
      await writeFileImpl(temporary, file.text);
    }
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      await rename(temps[fileIndex], files[fileIndex].path);
    }
  } catch (error) {
    await Promise.all(temps.map((temporary) => rm(temporary, { force: true })));
    throw error;
  }
}

async function fetchExport(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "wowf-dps-sim data-refresh",
      },
    });
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`, {
      cause: error,
    });
  }
  if (!response?.ok) {
    const status = response?.status ?? "unknown";
    const statusText = response?.statusText ?? "";
    throw new Error(`Failed to fetch ${url}: ${status} ${statusText}`.trim());
  }
  let body;
  try {
    body = await response.text();
  } catch (error) {
    throw new Error(`Failed to read ${url}: ${error.message}`, {
      cause: error,
    });
  }
  return parseJsonText(
    body,
    `Export from ${url} is not JSON: ${body.trim().slice(0, 80)}`,
  );
}

export async function refreshData({
  url = EXPORT_URL,
  snapshotPath = DEFAULT_SNAPSHOT_PATH,
  manifestPath = DEFAULT_MANIFEST_PATH,
  fetchImpl = globalThis.fetch,
  fetched = utcDate(),
  writeFileImpl = writeFile,
} = {}) {
  const snapshot = await fetchExport(url, fetchImpl);
  assertSnapshot(snapshot, "Export");
  const manifest = buildManifest(snapshot, fetched);

  const previousText = await readOptional(snapshotPath);
  let previous = null;
  if (previousText !== null) {
    previous = parseJsonText(
      previousText,
      `Existing snapshot ${snapshotPath} is not JSON`,
    );
    assertSnapshot(previous, "Existing snapshot");
  }

  // Diff before writing so a duplicate id cannot replace a good pin.
  const diff = diffSnapshot(previous, snapshot);
  await writeBoth(
    [
      { path: snapshotPath, text: await formatSnapshot(snapshot) },
      { path: manifestPath, text: await formatSnapshot(manifest) },
    ],
    writeFileImpl,
  );

  return {
    manifest,
    diff,
    report: formatRefreshReport({
      snapshotPath,
      manifestPath,
      manifest,
      diff,
      previousPresent: previousText !== null,
    }),
  };
}

export function parseArgs(argv) {
  const options = {
    url: EXPORT_URL,
    snapshotPath: DEFAULT_SNAPSHOT_PATH,
    manifestPath: DEFAULT_MANIFEST_PATH,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--url" || arg === "--snapshot" || arg === "--manifest") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      if (arg === "--url") {
        options.url = value;
      } else if (arg === "--snapshot") {
        options.snapshotPath = resolve(value);
      } else {
        options.manifestPath = resolve(value);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
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
    const outcome = await refreshData(options);
    console.log(outcome.report);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}
