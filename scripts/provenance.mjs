import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";

// CI check for data/constants.js (#7, #22). A missing file, a missing ref,
// a bare dash ref, a placeholder ref, or an unknown source tag fails the
// process. When the repository file passes, this command rewrites
// docs/provenance.md. Talent coverage (D6) is a separate later check.

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_CONSTANTS_PATH = resolve(ROOT, "data", "constants.js");
export const DEFAULT_REPORT_PATH = resolve(ROOT, "docs", "provenance.md");

export const SOURCE_TAGS = [
  "wowf-export",
  "wowf-designer",
  "classic-1.12",
  "cataclysm",
  "assumption",
  "engineering",
];

const SOURCE_BLURBS = {
  "wowf-export":
    "Re-read when the talentsforever snapshot refreshes. Not included in the retune list.",
  "wowf-designer": "James's knowledge of WoW Forever.",
  "classic-1.12":
    "Classic 1.12 reference values, kept until WoW Forever is measured.",
  cataclysm: "A later mechanic WoW Forever borrows on purpose.",
  assumption:
    "Defaults and sample inputs. James signed each ref on 22 Oct 2026.",
  engineering:
    "Simulator machinery, not a game rule. The retune flag stays off, so these rows are not on the retune list.",
};

// A ref that is only a hyphen or an en dash names no source.
const BARE_DASH_REFS = new Set(["-", "\u2013"]);

// Placeholder text that does not name a decision. These whole refs are
// rejected in any case, after trimming: "TBD", "N/A", "?", and "tbd later".
// "fill in" and "no recorded owner decision" are rejected wherever they appear.
const TBD_REF = /^tbd$/i;
const NA_REF = /^n\/a$/i;
const QUESTION_REF = /^\?$/;
const TBD_LATER_REF = /^tbd later$/i;
const FILL_IN_REF = /fill in/i;
const NO_DECISION_REF = /no recorded owner decision/i;

function isPlaceholderRef(ref) {
  const text = ref.trim();
  return (
    TBD_REF.test(text) ||
    NA_REF.test(text) ||
    QUESTION_REF.test(text) ||
    TBD_LATER_REF.test(text) ||
    FILL_IN_REF.test(text) ||
    NO_DECISION_REF.test(text)
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function showSource(source) {
  if (typeof source === "string") {
    return JSON.stringify(source);
  }
  if (source === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(source);
  } catch {
    return String(source);
  }
}

export function checkProvenance(constants) {
  if (!isPlainObject(constants)) {
    return {
      ok: false,
      errors: ["CONSTANTS must be a plain object keyed by id"],
    };
  }

  const errors = [];
  for (const [id, entry] of Object.entries(constants)) {
    if (!isPlainObject(entry)) {
      errors.push(`${id}: entry must be an object`);
      continue;
    }
    if (!SOURCE_TAGS.includes(entry.source)) {
      errors.push(`${id}: unknown source ${showSource(entry.source)}`);
    }
    if (typeof entry.ref !== "string" || entry.ref.trim() === "") {
      errors.push(`${id}: missing ref`);
    } else if (BARE_DASH_REFS.has(entry.ref.trim())) {
      errors.push(`${id}: bare dash ref`);
    } else if (isPlaceholderRef(entry.ref)) {
      errors.push(`${id}: placeholder ref`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Non-export constants with retune on. Export rows stay off this list even
// when their flag is on; a flag that is not strictly true stays off too.
export function isOnRetuneList(entry) {
  return (
    isPlainObject(entry) &&
    SOURCE_TAGS.includes(entry.source) &&
    entry.source !== "wowf-export" &&
    entry.retune === true
  );
}

export function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  return JSON.stringify(value, null, 1).replace(/\n\s*/g, " ").trim();
}

function countLabel(count) {
  return `${count} ${count === 1 ? "constant" : "constants"}`;
}

function breakdown(rows) {
  const counts = new Map(SOURCE_TAGS.map((tag) => [tag, 0]));
  let other = 0;
  for (const row of rows) {
    const source = isPlainObject(row.entry) ? row.entry.source : undefined;
    if (counts.has(source)) {
      counts.set(source, counts.get(source) + 1);
    } else {
      other += 1;
    }
  }
  const parts = SOURCE_TAGS.filter((tag) => counts.get(tag) > 0).map(
    (tag) => `${counts.get(tag)} \`${tag}\``,
  );
  if (other > 0) {
    parts.push(`${other} unrecognized`);
  }
  return parts.join(", ");
}

function summaryLine(rows) {
  const detail = breakdown(rows);
  const label = countLabel(rows.length);
  return detail === "" ? `${label}.` : `${label}: ${detail}.`;
}

function rowsBySource(constants) {
  const groups = new Map(SOURCE_TAGS.map((tag) => [tag, []]));
  const unknown = [];
  if (!isPlainObject(constants)) {
    return { groups, unknown };
  }
  for (const [id, entry] of Object.entries(constants)) {
    const row = { id, entry };
    if (isPlainObject(entry) && groups.has(entry.source)) {
      groups.get(entry.source).push(row);
    } else {
      unknown.push(row);
    }
  }
  return { groups, unknown };
}

function escapeCell(value) {
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function codeCell(value) {
  const text = String(value);
  if (text.includes("`")) {
    return text;
  }
  return `\`${text}\``;
}

function textCell(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  return formatValue(value);
}

function retuneLabel(retune) {
  if (retune === true) {
    return "yes";
  }
  if (retune === false) {
    return "no";
  }
  return formatValue(retune);
}

function markdownTable(headers, records) {
  if (records.length === 0) {
    return "None.";
  }
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = records.map(
    (cells) => `| ${cells.map((cell) => escapeCell(cell)).join(" | ")} |`,
  );
  return [header, divider, ...body].join("\n");
}

function retuneCells(row) {
  return [
    codeCell(row.id),
    codeCell(row.entry.source),
    codeCell(formatValue(row.entry.value)),
    textCell(row.entry.unit),
    textCell(row.entry.ref),
    textCell(row.entry.note),
  ];
}

function sourceCells(row) {
  return [
    codeCell(row.id),
    codeCell(formatValue(row.entry.value)),
    textCell(row.entry.unit),
    textCell(row.entry.ref),
    textCell(row.entry.note),
    retuneLabel(row.entry.retune),
  ];
}

function unknownCells(row) {
  const entry = isPlainObject(row.entry) ? row.entry : {};
  return [
    codeCell(row.id),
    codeCell(formatValue(entry.value)),
    textCell(entry.unit),
    textCell(entry.source),
    textCell(entry.ref),
    textCell(entry.note),
    retuneLabel(entry.retune),
  ];
}

function buildMarkdown(constants) {
  const { groups, unknown } = rowsBySource(constants);
  const known = SOURCE_TAGS.flatMap((tag) => groups.get(tag));
  const retuneRows = known.filter((row) => isOnRetuneList(row.entry));
  const lines = [
    "<!-- Generated by `npm run provenance` from `data/constants.js`. Do not edit by hand. -->",
    "",
    "# Provenance",
    "",
    "Every constant in `data/constants.js`, grouped by source.",
    "`npm run provenance` rewrites this file after it checks that each constant",
    "has a ref and a known source tag (`wowf-export`, `wowf-designer`,",
    "`classic-1.12`, `cataclysm`, `assumption`, `engineering`). A missing ref,",
    "a ref that is only a dash, a placeholder ref (`TBD`, `N/A`, `?`, or",
    "`tbd later`, in any case, or text containing `fill in` or",
    "`No recorded owner decision`), or an unknown tag fails the command.",
    "",
    "## Summary",
    "",
    summaryLine(known.concat(unknown)),
    "",
    "## Retune list",
    "",
    "Constants whose source is not `wowf-export` and whose retune flag is on.",
    "Check this list when WoW Forever releases. Rows follow source-tag order,",
    "then the order in `data/constants.js`.",
    "",
    summaryLine(retuneRows),
    "",
    markdownTable(
      ["id", "source", "value", "unit", "ref", "note"],
      retuneRows.map(retuneCells),
    ),
    "",
  ];

  for (const tag of SOURCE_TAGS) {
    const rows = groups.get(tag);
    lines.push(
      `## ${tag}`,
      "",
      `${countLabel(rows.length)}. ${SOURCE_BLURBS[tag]}`,
      "",
      markdownTable(
        ["id", "value", "unit", "ref", "note", "retune"],
        rows.map(sourceCells),
      ),
      "",
    );
  }

  if (unknown.length > 0) {
    lines.push(
      "## Unrecognized",
      "",
      "These entries did not have one of the known source tags,",
      "so they are not in the groups above.",
      "",
      markdownTable(
        ["id", "value", "unit", "source", "ref", "note", "retune"],
        unknown.map(unknownCells),
      ),
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function renderProvenance(constants) {
  return format(buildMarkdown(constants), { parser: "markdown" });
}

export function displayPath(filePath) {
  const fromRoot = relative(ROOT, filePath);
  if (fromRoot === "") {
    return filePath;
  }
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    return filePath;
  }
  return fromRoot;
}

export async function loadConstants(filePath) {
  try {
    await access(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { present: false };
    }
    throw error;
  }

  const imported = await import(pathToFileURL(filePath).href);
  return { present: true, constants: imported.CONSTANTS };
}

export function reportProvenance({ filePath, loaded, result }) {
  const shown = displayPath(filePath);
  if (!result.ok) {
    const lines = result.errors.map((error) => `- ${error}`);
    return `Provenance check failed for ${shown}:\n${lines.join("\n")}`;
  }
  const count = Object.keys(loaded.constants).length;
  const noun = count === 1 ? "constant" : "constants";
  return `Provenance check passed (${count} ${noun}) for ${shown}.`;
}

async function writeReportFile(reportPath, markdown) {
  await mkdir(dirname(reportPath), { recursive: true });
  const temporary = join(
    dirname(reportPath),
    `.${basename(reportPath)}.${process.pid}.tmp`,
  );
  try {
    await writeFile(temporary, markdown);
    await rename(temporary, reportPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function runProvenance(
  filePath = DEFAULT_CONSTANTS_PATH,
  options = {},
) {
  const writeReport =
    options.writeReport ?? filePath === DEFAULT_CONSTANTS_PATH;
  const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;

  let loaded;
  try {
    loaded = await loadConstants(filePath);
  } catch (error) {
    return {
      status: 1,
      message: `Failed to load ${displayPath(filePath)}: ${error.message}`,
    };
  }

  if (!loaded.present) {
    return {
      status: 1,
      message: `Provenance check failed: ${displayPath(filePath)} is not present.`,
    };
  }

  const result = checkProvenance(loaded.constants);
  if (!result.ok) {
    return {
      status: 1,
      message: reportProvenance({ filePath, loaded, result }),
    };
  }

  if (!writeReport) {
    return {
      status: 0,
      message: reportProvenance({ filePath, loaded, result }),
    };
  }

  try {
    const markdown = await renderProvenance(loaded.constants);
    await writeReportFile(reportPath, markdown);
  } catch (error) {
    return {
      status: 1,
      message: `Failed to write ${displayPath(reportPath)}: ${error.message}`,
    };
  }

  return {
    status: 0,
    message: `${reportProvenance({ filePath, loaded, result })}\nWrote ${displayPath(reportPath)}.`,
  };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  const filePath = process.argv[2]
    ? resolve(process.argv[2])
    : DEFAULT_CONSTANTS_PATH;
  const outcome = await runProvenance(filePath);
  if (outcome.status === 0) {
    console.log(outcome.message);
  } else {
    console.error(outcome.message);
    process.exitCode = 1;
  }
}
