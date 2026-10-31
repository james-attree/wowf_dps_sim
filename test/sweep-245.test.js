// #245 PR 3 (the 44px and dock sweep): the copy it changes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TYPE_NOTES } from "../js/rotation-builder-copy.js";
import { summaryText } from "../js/views/run-model.js";

describe("the copy the move to Fight left behind (#245)", () => {
  it("fight time left names Fight, where its length now is", () => {
    const note = TYPE_NOTES.fightTimeRemaining;
    assert.match(note, /Fight length \(s\) in Fight\./);
    assert.doesNotMatch(note, /Run bar/);
  });
});

describe("one name per run type, and words kept with their numbers (#245, Fran's #260 check)", () => {
  const run = (mode) => ({
    mode,
    state: "idle",
    seed: 1234,
    duration: 300,
    iterations: 1000,
    errors: {},
  });
  it("the summary names the run type as the switch does", () => {
    assert.equal(
      summaryText(run("batch")),
      "Average · 1,000 × 300\u00a0s · seed\u00a01234",
    );
    assert.equal(
      summaryText(run("live")),
      "Live fight · 300\u00a0s · seed\u00a01234",
    );
    for (const mode of ["batch", "live"]) {
      assert.doesNotMatch(summaryText(run(mode)), /Batch|Live ·/);
    }
  });
});
