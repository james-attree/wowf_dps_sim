import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referenceBuild } from "../data/reference-build.js";
import { legacyPageConfig } from "../js/legacy-page.js";
import { k } from "../data/constants.js";
import { weightsCapNote } from "../js/weights-support.js";

describe("stat weights cap note (#282)", () => {
  it("shows the note for the reference build at 10% hit", () => {
    const config = { ...legacyPageConfig(), talents: referenceBuild() };
    const note = weightsCapNote(config);
    assert.ok(note);
    const one = k("statWeights.onePercent");
    assert.equal(note.cap / one, 9);
    assert.equal(note.hit / one, 10);
    assert.equal(note.step / one, 2);
  });

  it("hides the note when hit is far below the cap and the window misses it", () => {
    const config = legacyPageConfig();
    config.character = { ...config.character, bonusHitChance: 0 };
    config.talents = {};
    const note = weightsCapNote(config);
    assert.equal(note, null);
  });

  it("shows the note when the ± window overlaps the cap", () => {
    const config = legacyPageConfig();
    config.character = { ...config.character, bonusHitChance: 0.07 };
    config.talents = {};
    const note = weightsCapNote(config);
    assert.ok(note);
  });
});
