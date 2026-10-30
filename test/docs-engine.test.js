import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CONSTANTS } from "../data/constants.js";

// Issue #234 (Kira's #238 QA, item 1, and #248 QA, polish 2). The fixed-step
// engine, `Simulation.step` and the `sim.fixedStep` constant are gone. Every
// doc (README.md and every Markdown file under docs/) is read line by line:
// a line that names one of them, or times something by a fixed step, fails
// unless it is one of the history lines below, matched by file and exact
// text. A "#234" or "removed" nearby no longer exempts a line, and a new
// line needs its own entry here.
const STALE = [
  /sim\.fixedStep/,
  /Simulation\.step\b/,
  /\bstep\(dt\)/,
  /fixed[- ]step before/i,
];

// Each entry is history: what the removal took out, or the Phase 3.5 plan
// written before it.
const HISTORY_LINES = [
  [
    "README.md",
    "  says when. `step(dt)`, the fixed-step engine, went in #234.",
  ],
  [
    "docs/mechanics.md",
    "engine since #234, which removed the fixed-step engine (`Simulation.step`, the",
  ],
  [
    "docs/mechanics.md",
    "`sim.fixedStep` constant and the `engine` option). The last commit with the",
  ],
  [
    "docs/mechanics.md",
    "`Simulation.step`. The Simulation stays the store of the fight's state and",
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    '`k("sim.fixedStep")`. It changes how time is resolved. It does not change game',
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    "fixed-step `Simulation` in `js/simulation.js`. `Simulation.step(dt)` moves time,",
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    '`Simulation.run(duration)` calls it in steps of `k("sim.fixedStep")`, and',
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    "`Simulation.step` as a public method (or a documented shim if the live page or",
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    'tests still need it), `k("sim.fixedStep")`, `k("sim.maxFrameTime")` if nothing',
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    'loop, `Simulation.step`, `k("sim.fixedStep")`, the `engine` option and the',
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    "- `step(dt)` runs the same sequence every step: regenerate energy, count down",
  ],
  [
    "docs/phase-3.5-engine-rewrite.md",
    "`step(dt)`. Where a test pins a rule (not a timing), port it to the new core.",
  ],
];

function isHistory(file, line) {
  return HISTORY_LINES.some(([where, text]) => where === file && text === line);
}

// The stale lines of one file, as "file:line: text". A phrase broken over two
// lines is caught on the pair, reported at its first line.
function staleLines(file, text) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, index) => {
    const pair = `${line} ${lines[index + 1] ?? ""}`.replace(/\s+/g, " ");
    const hit =
      STALE.some((pattern) => pattern.test(line)) ||
      (index + 1 < lines.length &&
        !STALE.some((pattern) => pattern.test(lines[index + 1])) &&
        STALE.some((pattern) => pattern.test(pair)));
    if (hit && !isHistory(file, line)) {
      found.push(`${file}:${index + 1}: ${line}`);
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

describe("docs describe the event core, not the fixed step", () => {
  it("sim.fixedStep is not a constant any more", () => {
    assert.equal(Object.hasOwn(CONSTANTS, "sim.fixedStep"), false);
  });

  it("reads README.md and every Markdown file under docs/", () => {
    for (const file of [
      "README.md",
      "docs/mechanics.md",
      "docs/roadmap.md",
      "docs/events.md",
      "docs/phase-3.5-engine-rewrite.md",
    ]) {
      assert.ok(DOCS.includes(file), file);
    }
  });

  for (const file of DOCS) {
    it(`${file} names the fixed step only on its history lines`, async () => {
      assert.deepEqual(staleLines(file, await read(file)), []);
    });
  }

  it("every history line is still in its file, word for word", async () => {
    for (const [file, line] of HISTORY_LINES) {
      const lines = (await read(file)).split("\n");
      assert.ok(lines.includes(line), `${file}: ${line}`);
    }
  });

  it("flags each stale line #238's and #248's QA found", () => {
    const flagged = (file, text) => staleLines(file, text).length;
    // #238 QA: the Hemorrhage expiry and the roadmap's live mode.
    assert.equal(
      flagged(
        "docs/mechanics.md",
        "  15 s. It is gone at 15 s (one fixed step before, it still counts).",
      ),
      1,
    );
    assert.equal(
      flagged(
        "docs/roadmap.md",
        "  `createFight`, steps it in whole steps of `sim.fixedStep`, and shows",
      ),
      1,
    );
    // #248 QA, D3 to D7.
    assert.equal(
      flagged(
        "docs/roadmap.md",
        "  core through `Simulation.step(dt)` each frame, and shows the seed.",
      ),
      1,
    );
    assert.equal(
      flagged(
        "docs/mechanics.md",
        "  15 s. It is gone at 15 s (a fixed step before, it still counts).",
      ),
      1,
    );
    assert.equal(
      flagged(
        "docs/roadmap.md",
        "  core in `sim.fixedStep` slices (#234), and shows the seed.",
      ),
      1,
    );
    assert.equal(
      flagged(
        "README.md",
        "  of the placeholder rotation, stepped by `sim.fixedStep`, for the",
      ),
      1,
    );
    assert.equal(
      flagged(
        "docs/events.md",
        "The fight advances in steps of `sim.fixedStep`.",
      ),
      1,
    );
    // A phrase broken over two lines.
    assert.equal(
      flagged(
        "docs/mechanics.md",
        "It is gone at 15 s (a fixed\nstep before).",
      ),
      1,
    );
  });

  it("passes a history line only in its own file, word for word", () => {
    const [file, line] = HISTORY_LINES[1];
    assert.deepEqual(staleLines(file, line), []);
    assert.equal(staleLines("docs/roadmap.md", line).length, 1);
    assert.equal(staleLines(file, `${line} today`).length, 1);
    assert.deepEqual(
      staleLines("docs/mechanics.md", "#234 removed the fixed-step engine."),
      [],
    );
  });
});
