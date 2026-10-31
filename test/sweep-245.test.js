// #245 PR 3 (the 44px and dock sweep): the copy it changes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TYPE_NOTES } from "../js/rotation-builder-copy.js";

describe("the copy the move to Fight left behind (#245)", () => {
  it("fight time left names Fight, where its length now is", () => {
    const note = TYPE_NOTES.fightTimeRemaining;
    assert.match(note, /Fight length \(s\) in Fight\./);
    assert.doesNotMatch(note, /Run bar/);
  });
});
