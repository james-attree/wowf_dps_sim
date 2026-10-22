import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// CI check for data/constants.js (#22). A missing ref or an unknown source
// tag fails the process. The file itself arrives with #7; until then there
// is nothing to validate. #22 can extend this command to write
// docs/provenance.md. Talent coverage (D6) is a separate later check.

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_CONSTANTS_PATH = resolve(ROOT, "data", "constants.js");

export const SOURCE_TAGS = [
  "wowf-export",
  "wowf-designer",
  "classic-1.12",
  "cataclysm",
  "assumption",
];

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
    }
  }

  return { ok: errors.length === 0, errors };
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
  if (!loaded.present) {
    return `Provenance check skipped: ${shown} is not present, so there are no constants to validate.`;
  }
  if (!result.ok) {
    const lines = result.errors.map((error) => `- ${error}`);
    return `Provenance check failed for ${shown}:\n${lines.join("\n")}`;
  }
  const count = Object.keys(loaded.constants).length;
  const noun = count === 1 ? "constant" : "constants";
  return `Provenance check passed (${count} ${noun}) for ${shown}.`;
}

export async function runProvenance(filePath = DEFAULT_CONSTANTS_PATH) {
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
      status: 0,
      message: reportProvenance({ filePath, loaded, result: null }),
    };
  }

  const result = checkProvenance(loaded.constants);
  return {
    status: result.ok ? 0 : 1,
    message: reportProvenance({ filePath, loaded, result }),
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
