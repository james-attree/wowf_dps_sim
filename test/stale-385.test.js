import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pageDefaultConfig } from "../js/config-form.js";
import { changedNames } from "../js/views/stale.js";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../js/views/stale.js", import.meta.url)),
  "utf8",
);

const SKIP =
  /if \(key === "character" && DERIVED_STATS\.includes\(part\)\) \{\s*continue;\s*\}/;

function preludeAndChangedNames(source) {
  const start = source.indexOf("const STAT_NAMES = Object.freeze({");
  const end = source.indexOf('\n// "attack power"', start);
  assert.ok(start >= 0 && end > start, "changedNames block bounds");
  // From STAT_NAMES through changedNames, up to namesText.
  const midEnd = source.indexOf("\nexport function namesText", start);
  assert.ok(midEnd > start);
  let body = source.slice(start, midEnd);
  body = body.replaceAll("export ", "");
  return body;
}

function runChangedNames(source, before, after) {
  const body = preludeAndChangedNames(source);
  const run = new Function(
    "before",
    "after",
    `${body}\nreturn changedNames(before, after);`,
  );
  return run(before, after);
}

function withRaceAndDerivedSheet(base) {
  return {
    ...base,
    race: "night-elf",
    character: {
      ...base.character,
      attackPower: (base.character.attackPower ?? 0) + 2,
      critChance: (base.character.critChance ?? 0) + 0.001,
    },
  };
}

describe("stale banner names only user changes (#385)", () => {
  it("a race change that also moves AP and crit names only the race", () => {
    const before = pageDefaultConfig();
    const after = withRaceAndDerivedSheet(before);
    assert.deepEqual(changedNames(before, after), ["the race"]);
    assert.match(SOURCE, SKIP);
  });

  it("M: dropping the derived-stat skip names attack power on a race change", () => {
    assert.match(SOURCE, SKIP);
    const mutant = SOURCE.replace(SKIP, "");
    assert.notEqual(mutant, SOURCE);
    const before = pageDefaultConfig();
    const after = withRaceAndDerivedSheet(before);
    assert.deepEqual(runChangedNames(SOURCE, before, after), ["the race"]);
    const named = runChangedNames(mutant, before, after);
    assert.ok(
      named.includes("attack power"),
      `mutant should name attack power, got ${JSON.stringify(named)}`,
    );
    assert.ok(named.includes("the race"));
  });

  it("stat names are lower case mid-sentence (#287 PR 7b, #327 N8)", () => {
    const before = pageDefaultConfig();
    const unskipped = SOURCE.replace(SKIP, "");
    const named = runChangedNames(
      unskipped,
      before,
      withRaceAndDerivedSheet(before),
    );
    assert.deepEqual(
      named.filter((name) => name !== "the race"),
      ["attack power", "crit chance"],
    );
    const sheet = (part, step) => ({
      ...before,
      character: {
        ...before.character,
        [part]: (before.character[part] ?? 0) + step,
      },
    });
    assert.deepEqual(runChangedNames(unskipped, before, sheet("haste", 1)), [
      "haste",
    ]);
    assert.deepEqual(
      runChangedNames(unskipped, before, sheet("bonusHitChance", 0.01)),
      ["hit chance"],
    );
  });
});
