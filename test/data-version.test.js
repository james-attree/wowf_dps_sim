import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildDataVersion,
  dataVersion,
  dataVersionInfo,
} from "../js/data-version.js";
import { createFight, runFight } from "../js/fight.js";
import { buildManifest } from "../scripts/refresh-data.mjs";
import { runScriptedFight } from "../scripts/scripted-fight.mjs";

// Issue #91 (D11). Every sim result says which data produced it. The version
// is the snapshot's generated date and client build, read from the manifest
// that scripts/refresh-data.mjs writes.

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

const manifest = await readJson("../data/talentsforever/manifest.json");
const snapshot = await readJson("../data/talentsforever/rogue.json");

describe("dataVersion", () => {
  it("is the manifest's generated date and build joined by +", () => {
    assert.equal(dataVersion, `${manifest.generated}+${manifest.build}`);
    assert.deepEqual(
      { ...dataVersionInfo },
      { generated: manifest.generated, build: manifest.build, id: dataVersion },
    );
    assert.match(dataVersion, /^\d{4}-\d{2}-\d{2}\+\d+(?:\.\d+)+$/);
    assert.ok(Object.isFrozen(dataVersionInfo));
  });

  it("agrees with the snapshot it describes", () => {
    assert.equal(snapshot.generated.trim(), dataVersionInfo.generated);
    assert.equal(snapshot.spellbook.build.trim(), dataVersionInfo.build);
  });

  it("is what the refresh script would write for this snapshot", () => {
    const written = buildManifest(snapshot, manifest.fetched);
    assert.equal(buildDataVersion(written).id, dataVersion);
  });

  it("follows a refreshed manifest with no code change", () => {
    const next = buildManifest(
      { ...snapshot, generated: "2030-02-03", spellbook: { build: "2.0.0.1" } },
      "2030-02-04",
    );
    assert.equal(buildDataVersion(next).id, "2030-02-03+2.0.0.1");
  });

  it("rejects a manifest that lacks the generated date or the build", () => {
    for (const field of ["generated", "build"]) {
      for (const bad of [undefined, null, 7, "", "  ", " 1.0", "1+2"]) {
        assert.throws(
          () => buildDataVersion({ ...manifest, [field]: bad }),
          new RegExp(`"${field}"`),
          `${field} ${JSON.stringify(bad)}`,
        );
      }
    }
    assert.throws(() => buildDataVersion(undefined), TypeError);
    assert.throws(() => buildDataVersion({}), TypeError);
  });
});

describe("every sim result records the data version", () => {
  it("runFight, for any seed and duration, including a fight of zero seconds", () => {
    for (const [seed, duration] of [
      [1, 0],
      [1, 10],
      [-5, 30],
      [2 ** 32 + 9, 5],
    ]) {
      assert.equal(runFight({ seed, duration }).dataVersion, dataVersion);
    }
  });

  it("createFight and the scripted harness", () => {
    assert.equal(createFight(7).dataVersion, dataVersion);
    assert.equal(
      runScriptedFight({ seed: 3, duration: 5, script: ["sinisterStrike"] })
        .dataVersion,
      dataVersion,
    );
  });

  it("is a plain string in the plain-data result, just before config, and does not move the numbers", () => {
    const result = runFight({ seed: 1, duration: 20 });
    assert.equal(typeof result.dataVersion, "string");
    assert.equal(Object.keys(result).at(-2), "dataVersion");
    assert.equal(Object.keys(result).at(-1), "config");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.deepEqual(structuredClone(result), result);
    assert.deepEqual(Object.keys(result).slice(0, -2), [
      "seed",
      "duration",
      "totalDamage",
      "dps",
      "abilities",
      "log",
    ]);
  });
});
