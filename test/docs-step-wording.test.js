import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

// Issue #245 (Kira's #250 QA): what test/docs-engine.test.js missed. The
// fixed-step engine and its `step()` method are gone (#234), so no doc (README
// and every Markdown file under docs/) may still say a host calls a bare
// `step()`, that something happens "every fixed step", or time something by a
// fixed step with the phrase hyphen-split over a line break ("fixed-" then
// "step before"). A line that does fails unless it is one of the history lines
// below, matched by file and exact text.
const STALE = [
  /\bstep\(\)/,
  /\bevery fixed[- ]?steps?\b/i,
  /\bfixed[- ]?steps? (?:at a time|before|after)\b/i,
  /\bone fixed[- ]?step\b/i,
];

// A phrase broken over up to this many lines is caught on the lines joined.
const WINDOW_LINES = 3;

// History: what #234 took out.
const HISTORY_LINES = [
  [
    "docs/mechanics.md",
    "the legacy `step()` loop ticked DoTs itself until #234. `new DotTicks({ scheduler })` keeps one pending event per DoT, of kind",
  ],
];

// Lines joined as read: a word hyphen-split at a line's end is one word again
// ("fixed-" and "step" read "fixed-step"); any other break is a space.
function joined(lines) {
  return lines
    .join("\n")
    .replace(/-\n\s*/g, "-")
    .replace(/\s+/g, " ");
}

function isStale(lines) {
  const text = joined(lines);
  return STALE.some((pattern) => pattern.test(text));
}

function isHistory(file, line) {
  return HISTORY_LINES.some(([where, text]) => where === file && text === line);
}

// The stale lines of one file, as "file:line: text", each phrase reported at
// the line it starts on.
function staleLines(file, text) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, index) => {
    for (let count = 1; count <= WINDOW_LINES; count++) {
      if (index + count > lines.length) {
        break;
      }
      const run = lines.slice(index, index + count);
      if (isStale(run) && !isStale(run.slice(1))) {
        if (!run.every((each) => isHistory(file, each))) {
          found.push(`${file}:${index + 1}: ${line}`);
        }
        break;
      }
    }
  });
  return found;
}

async function markdownUnder(directory) {
  const entries = await readdir(new URL(`../${directory}/`, import.meta.url), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await markdownUnder(path)));
    } else if (entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

const DOCS = ["README.md", ...(await markdownUnder("docs"))].sort();

function read(file) {
  return readFile(new URL(`../${file}`, import.meta.url), "utf8");
}

describe("docs name no step() host and no fixed step, however worded (#245)", () => {
  it("reads docs/events.md among the rest", () => {
    assert.ok(DOCS.includes("docs/events.md"));
    assert.ok(DOCS.includes("README.md"));
  });

  for (const file of DOCS) {
    it(`${file} has none`, async () => {
      assert.deepEqual(staleLines(file, await read(file)), []);
    });
  }

  it("every history line is in its file, word for word", async () => {
    for (const [file, line] of HISTORY_LINES) {
      const lines = (await read(file)).split("\n");
      assert.ok(lines.includes(line), `${file}: ${line}`);
    }
  });

  it("flags each wording #250's QA found", () => {
    // docs/events.md:135 as it was.
    assert.deepEqual(
      staleLines(
        "docs/events.md",
        "`time` is the fight duration. A host that moves a `Simulation` with `step()`",
      ),
      [
        "docs/events.md:1: `time` is the fight duration. A host that moves a `Simulation` with `step()`",
      ],
    );
    // A bare step() without backticks, too.
    assert.equal(
      staleLines("README.md", "the host calls step() itself").length,
      1,
    );
    assert.equal(
      staleLines("docs/mechanics.md", "Energy regenerates every fixed step.")
        .length,
      1,
    );
    assert.equal(
      staleLines("docs/mechanics.md", "It regenerates every fixed-step.")
        .length,
      1,
    );
    // Hyphen-split at a line break.
    assert.deepEqual(
      staleLines(
        "docs/mechanics.md",
        "It is gone at 15 s (one fixed-\nstep before, it still counts).",
      ),
      ["docs/mechanics.md:1: It is gone at 15 s (one fixed-"],
    );
    assert.equal(
      staleLines("docs/mechanics.md", "a\n  fixed-\n  step after").length,
      1,
    );
  });

  it("passes what the core does now", () => {
    for (const text of [
      "`step(dt)` was the fixed-step engine's method.",
      "A host that runs the fight's core itself calls `Simulation.end()`.",
      "The runner steps through events in time order.",
      "#234 removed the fixed-step engine.",
    ]) {
      assert.deepEqual(staleLines("docs/events.md", text), [], text);
    }
    // A history line passes only in its own file.
    const [file, line] = HISTORY_LINES[0];
    assert.deepEqual(staleLines(file, line), []);
    assert.equal(staleLines("docs/events.md", line).length, 1);
  });
});
