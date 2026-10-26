import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { k } from "../data/constants.js";
import { collectIconNames, iconUrl } from "../js/icons.js";

// Check that every icon the snapshot names exists on the icon CDN, and record
// the ones that do not (issue #107, D10). Run it when the data is refreshed:
//
//   npm run icons:check            read-only: prints what is missing
//   npm run icons:check -- --write  also writes data/icons.json
//
// It sends one HEAD request per icon name and downloads no image. It is the
// only place that touches the CDN: js/icons.js builds URLs without fetching,
// and no test calls the network. The manifest holds names only.

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const MANIFEST = resolve(ROOT, "data", "icons.json");
export const CHECK_COMMAND = "npm run icons:check -- --write";

const HELP_TEXT = `Usage: npm run icons:check [-- --write]

Sends a HEAD request for every icon name in the snapshot to the icon CDN and
lists the ones that are missing. With --write it also updates data/icons.json.
No image is downloaded.`;

// The names that are not on the CDN. `fetchImpl` is injectable. A 404 or 410
// is a missing icon; any other failure (a network error, a 5xx) stops the check,
// so a flaky run never marks real icons missing.
export async function findMissing(names, fetchImpl = fetch) {
  const missing = [];
  const noneMissing = [];
  for (const name of names) {
    const url = iconUrl(name, k, noneMissing);
    const response = await fetchImpl(url, { method: "HEAD" });
    if (response.status === 404 || response.status === 410) {
      missing.push(name);
    } else if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}. Try again later.`);
    }
  }
  return missing;
}

export function formatManifest({ names, missing }) {
  const { base, size, extension } = k("icons.cdn");
  return `${JSON.stringify(
    {
      checked: { base, size, extension, names: names.length },
      missing,
    },
    null,
    2,
  )}\n`;
}

export async function checkIcons({ write = false, fetchImpl, names } = {}) {
  const wanted = names ?? collectIconNames();
  const fallback = k("icons.fallback");
  const missing = await findMissing(
    [...new Set([...wanted, fallback])],
    fetchImpl,
  );
  if (missing.includes(fallback)) {
    throw new Error(`The fallback icon ${fallback} is missing from the CDN.`);
  }
  const text = formatManifest({ names: wanted, missing });
  const current = await readFile(MANIFEST, "utf8").catch(() => "");
  const changed = text !== current;
  if (write && changed) {
    await writeFile(MANIFEST, text);
  }
  return { names: wanted.length, missing, changed, written: write && changed };
}

export function formatReport({ names, missing, changed, written }) {
  const lines = [`${names} icon names checked.`];
  lines.push(
    missing.length === 0
      ? "None are missing from the CDN."
      : `Missing from the CDN (${missing.length}): ${missing.join(", ")}`,
  );
  if (written) {
    lines.push("Wrote data/icons.json.");
  } else if (changed) {
    lines.push(`data/icons.json is out of date. Run ${CHECK_COMMAND}.`);
  } else {
    lines.push("data/icons.json is up to date.");
  }
  return lines.join("\n");
}

function isDirectRun() {
  const entry = process.argv[1];
  return (
    Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href
  );
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--write" && arg !== "--help");
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown[0]}\n\n${HELP_TEXT}`);
    process.exitCode = 1;
    return;
  }
  if (args.includes("--help")) {
    console.log(HELP_TEXT);
    return;
  }
  try {
    const result = await checkIcons({ write: args.includes("--write") });
    console.log(formatReport(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}
