import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CONSTANTS } from "../data/constants.js";

// Issue #234 (Kira's #238 QA, item 1). The fixed-step engine and its
// `sim.fixedStep` constant are gone. A doc that describes the engine as it is
// may name the constant only beside the removal (#234, "removed", or the
// `legacy-engine-final` tag), and may not time an aura by a fixed step.
// docs/phase-3.5-engine-rewrite.md is the plan written before the removal and
// is not checked.
const DOCS = ["README.md", "docs/mechanics.md", "docs/roadmap.md"];
const HISTORY = /#234|removed|legacy-engine-final/i;
const STALE = [/one fixed step before/i, /steps of `sim\.fixedStep`/];

function stale(text) {
  const named = text
    .split(/\n\s*\n/)
    .filter((part) => part.includes("sim.fixedStep") && !HISTORY.test(part));
  const phrases = text
    .split("\n")
    .filter((line) => STALE.some((pattern) => pattern.test(line)));
  return [...named, ...phrases];
}

describe("docs describe the event core, not the fixed step", () => {
  it("sim.fixedStep is not a constant any more", () => {
    assert.equal(Object.hasOwn(CONSTANTS, "sim.fixedStep"), false);
  });

  for (const file of DOCS) {
    it(`${file} names the fixed step only as history`, async () => {
      const text = await readFile(
        new URL(`../${file}`, import.meta.url),
        "utf8",
      );
      assert.deepEqual(stale(text), []);
    });
  }

  it("the check flags the two stale lines #238's QA found, and passes the removal note", () => {
    assert.equal(
      stale(
        "  15 s. It is gone at 15 s (one fixed step before, it still counts).",
      ).length,
      1,
    );
    assert.equal(
      stale(
        "  `createFight`, steps it in whole steps of `sim.fixedStep`, and shows",
      ).length,
      2,
    );
    assert.deepEqual(
      stale(
        "#234 removed the fixed-step engine (the `sim.fixedStep` constant).",
      ),
      [],
    );
  });
});
