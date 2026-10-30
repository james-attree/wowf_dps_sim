import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { expandTalents } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { quiet } from "./quiet.js";

// Follow-ups from the reviews of #123 and #124 (D5), each a gap a mutant got
// through: when Puncturing Wounds rolls, the keys expandTalents ignores and
// refuses, and the load-time check of the talent data.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HIT = 0.99;

// A scripted rng that throws past its last value, so a test sees every draw.
function scripted(values) {
  let at = 0;
  return {
    rng() {
      if (at >= values.length) {
        throw new Error(`draw ${at + 1} was not scripted`);
      }
      return values[at++];
    },
    left: () => values.length - at,
  };
}

describe("Puncturing Wounds is rolled when a Backstab has been cast", () => {
  const build = expandTalents({ "combat.puncturing-wounds": 3 });

  function backstab(comboPoints, roll) {
    const rogue = new Rogue(
      { weapons: { mainHand: { type: "dagger" } } },
      { procs: build.procs },
    );
    rogue.bonusHitChance = 1;
    rogue.critChance = 0;
    quiet(rogue);
    // The weapon roll, the attack table, the crit roll, then the proc's roll.
    const tape = scripted([0.5, HIT, HIT, roll]);
    const simulation = new Simulation(rogue, { rng: tape.rng });
    rogue.comboPoints = comboPoints;
    rogue.abilities.backstab.cast(rogue, simulation);
    return { rogue, stats: simulation.procs.stats["puncturing-wounds"], tape };
  }

  it("is an onAbility proc on Backstab at 15, 30 and 45%", () => {
    assert.equal(build.procs.length, 1);
    assert.equal(build.procs[0].trigger, "onAbility");
    assert.deepEqual(build.procs[0].scope.abilities, ["backstab"]);
    for (const [rank, chance] of [
      [1, 0.15],
      [2, 0.3],
      [3, 0.45],
    ]) {
      const [proc] = expandTalents({ "combat.puncturing-wounds": rank }).procs;
      assert.equal(proc.chance.mode, "flat");
      assert.equal(proc.chance.value, chance);
    }
  });

  it("adds its point after the cast's own, so a fifth point is turned away", () => {
    // At 4 points the cast takes the pool to 5 first, and the proc's point has
    // nowhere to go. An onHit proc would add its point before the cast's own.
    const full = backstab(4, 0);
    assert.equal(full.tape.left(), 0);
    assert.equal(full.rogue.comboPoints, 5);
    assert.equal(full.stats.fires, 1);
    assert.equal(full.stats.gained, 0);
    // At 3 points both land.
    const room = backstab(3, 0);
    assert.equal(room.rogue.comboPoints, 5);
    assert.equal(room.stats.gained, 1);
  });

  it("rolls once per landed Backstab and adds no point on a failed roll", () => {
    const failed = backstab(2, HIT);
    assert.equal(failed.tape.left(), 0);
    assert.deepEqual(failed.stats, {
      rolls: 1,
      fires: 0,
      blocked: 0,
      gained: 0,
    });
    assert.equal(failed.rogue.comboPoints, 3);
  });
});

describe("expandTalents ignores inherited keys and refuses names it does not know", () => {
  it("refuses a name the object prototype has, as an unknown talent", () => {
    for (const name of [
      "toString",
      "constructor",
      "hasOwnProperty",
      "valueOf",
    ]) {
      assert.throws(
        () => expandTalents({ [name]: 1 }),
        { name: "RangeError", message: /unknown talent id/ },
        name,
      );
      assert.throws(() => expandTalents({ [name]: 0 }), RangeError, name);
    }
    assert.throws(
      () => expandTalents(JSON.parse('{"__proto__": 1}')),
      /unknown talent id "__proto__"/,
    );
  });

  it("refuses an unknown id at rank 0, as it does at any other rank", () => {
    assert.throws(() => expandTalents({ "combat.nope": 0 }), {
      name: "RangeError",
      message: /unknown talent id "combat.nope"/,
    });
    assert.throws(
      () => expandTalents({ "combat.precision": 0, "x.y": 0 }),
      /unknown talent id "x.y"/,
    );
  });

  it("does not read a rank the map only inherits", () => {
    const inherited = Object.create({ "combat.precision": 3 });
    const build = expandTalents(inherited);
    assert.deepEqual(build.modifiers, []);
    assert.deepEqual(build.unmapped, []);
    const own = Object.create({ "combat.precision": 3 });
    own["combat.endurance"] = 1;
    assert.deepEqual(expandTalents(own).noDps, ["combat.endurance"]);
    assert.deepEqual(expandTalents(own).modifiers, []);
  });
});

describe("the talent data is checked when js/talent-build.js is imported", () => {
  // The check runs as the module loads, so it can only be seen by importing
  // the module afresh. This copies the code and data, optionally changes the
  // effects data, and imports it in a new process.
  function importIn(change) {
    const dir = mkdtempSync(join(tmpdir(), "talent-build-"));
    try {
      for (const name of ["js", "data", "package.json"]) {
        cpSync(join(ROOT, name), join(dir, name), { recursive: true });
      }
      if (change !== undefined) {
        const path = join(dir, "data", "talent-effects.js");
        writeFileSync(path, change(readFileSync(path, "utf8")));
      }
      return spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'await import("./js/talent-build.js"); console.log("loaded");',
        ],
        { cwd: dir, encoding: "utf8" },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("loads with the data as it is", () => {
    const run = importIn();
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /loaded/);
  });

  it("fails the import on an entry the check refuses", () => {
    const run = importIn((source) =>
      source.replace(
        '"combat.precision": {',
        '"combat.precision": {\n    colour: "red",',
      ),
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /unknown key "colour"/);
  });

  it("fails the import on a rank table the pipeline refuses", () => {
    const run = importIn((source) =>
      source.replace('kind: "hitChance",', 'kind: "hitChanse",'),
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /unknown kind "hitChanse"/);
  });
});
