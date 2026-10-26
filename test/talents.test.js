import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  buildTalentCatalogue,
  slugify,
  talentCatalogue,
} from "../js/talents.js";

const execFileAsync = promisify(execFile);

const snapshot = JSON.parse(
  await readFile(
    new URL("../data/talentsforever/rogue.json", import.meta.url),
    "utf8",
  ),
);

function fixture(trees) {
  return { talents: { trees } };
}

function raw(name, extra = {}) {
  return {
    name,
    max: 1,
    row: 1,
    col: 1,
    icon: "icon",
    desc: ["Rank one."],
    ...extra,
  };
}

describe("slugify", () => {
  it("follows the documented rule", () => {
    assert.equal(slugify("Precision"), "precision");
    assert.equal(slugify("Improved Slice and Dice"), "improved-slice-and-dice");
    assert.equal(slugify("Hack and Slash"), "hack-and-slash");
    assert.equal(slugify("Master of Deception"), "master-of-deception");
    assert.equal(slugify("  Rogue's   Gambit! "), "rogues-gambit");
    assert.equal(slugify("Rogue\u2019s Gambit"), "rogues-gambit");
    assert.equal(slugify("Fire-and-Ice  2"), "fire-and-ice-2");
  });

  it("refuses a name with nothing to slug", () => {
    assert.throws(() => slugify("!!!"), RangeError);
    assert.throws(() => slugify(""), RangeError);
    assert.throws(() => slugify(undefined), TypeError);
  });
});

describe("talent catalogue from the vendored snapshot", () => {
  it("has 53 talents: 17 Assassination, 17 Combat, 19 Subtlety", () => {
    assert.equal(talentCatalogue.talents.length, 53);
    assert.deepEqual(
      talentCatalogue.trees.map((tree) => [tree.id, tree.talents.length]),
      [
        ["assassination", 17],
        ["combat", 17],
        ["subtlety", 19],
      ],
    );
    assert.deepEqual(
      talentCatalogue.trees.map((tree) => tree.name),
      ["Assassination", "Combat", "Subtlety"],
    );
    assert.equal(talentCatalogue.byTree("combat").length, 17);
    assert.equal(talentCatalogue.byTree("subtlety").length, 19);
  });

  it("gives every talent a unique tree.slug id", () => {
    const ids = talentCatalogue.talents.map((talent) => talent.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const talent of talentCatalogue.talents) {
      assert.match(talent.id, /^[a-z0-9]+\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(talent.id, `${talent.tree}.${slugify(talent.name)}`);
    }
    assert.ok(talentCatalogue.get("combat.precision"));
    assert.ok(talentCatalogue.get("combat.dual-wield-specialization"));
    assert.ok(talentCatalogue.get("assassination.improved-slice-and-dice"));
  });

  it("copies every field from the snapshot, in snapshot order", () => {
    let index = 0;
    for (const snapshotTree of snapshot.talents.trees) {
      const tree = talentCatalogue.trees.find(
        (candidate) => candidate.name === snapshotTree.name,
      );
      assert.ok(tree, snapshotTree.name);
      assert.equal(tree.icon, snapshotTree.icon);
      snapshotTree.talents.forEach((source, position) => {
        const talent = tree.talents[position];
        assert.equal(talent, talentCatalogue.talents[index]);
        index += 1;
        assert.equal(talent.name, source.name);
        assert.equal(talent.row, source.row);
        assert.equal(talent.col, source.col);
        assert.equal(talent.max, source.max);
        assert.equal(talent.icon, source.icon);
        assert.equal(talent.passive, source.passive);
        assert.deepEqual(talent.ranks, source.desc);
        assert.equal(talent.ranks.length, talent.max);
        assert.equal(talent.cost, source.cost ?? null);
        assert.deepEqual(talent.fixed, source.fixed ?? null);
        if (source.req === undefined) {
          assert.equal(talent.req, null);
        } else {
          const required = tree.talents.find(
            (candidate) => candidate.name === source.req,
          );
          assert.equal(talent.req, required.id);
        }
      });
    }
    assert.equal(index, talentCatalogue.talents.length);
  });

  it("reads known talents end to end", () => {
    const dws = talentCatalogue.get("combat.dual-wield-specialization");
    assert.equal(dws.tree, "combat");
    assert.equal(dws.name, "Dual Wield Specialization");
    assert.deepEqual([dws.row, dws.col, dws.max], [4, 3, 5]);
    assert.equal(dws.req, "combat.precision");
    assert.equal(dws.icon, "ability_dualwield");
    assert.equal(dws.ranks.length, 5);
    assert.equal(
      talentCatalogue.rankText("combat.dual-wield-specialization", 5),
      snapshot.talents.trees[1].talents.find(
        (talent) => talent.name === "Dual Wield Specialization",
      ).desc[4],
    );

    const precision = talentCatalogue.get("combat.precision");
    assert.deepEqual([precision.row, precision.col, precision.max], [2, 3, 3]);
    assert.equal(precision.req, null);
    assert.equal(precision.passive, true);

    const riposte = talentCatalogue.get("combat.riposte");
    assert.deepEqual([riposte.row, riposte.col, riposte.max], [3, 2, 1]);
    assert.equal(riposte.req, "combat.deflection");
    assert.equal(riposte.passive, false);
    assert.match(riposte.cost, /6 sec cooldown/);

    const ar = talentCatalogue.get("combat.adrenaline-rush");
    assert.deepEqual([ar.row, ar.col, ar.max], [7, 2, 1]);
    assert.equal(ar.req, null);

    const lethality = talentCatalogue.get("assassination.lethality");
    assert.equal(lethality.req, "assassination.malice");
    assert.equal(lethality.max, 5);

    const hemorrhage = talentCatalogue.get("subtlety.hemorrhage");
    assert.equal(hemorrhage.req, "subtlety.serrated-blades");
    assert.deepEqual([hemorrhage.row, hemorrhage.col], [5, 3]);

    assert.match(
      talentCatalogue.rankText("combat.improved-sinister-strike", 2),
      /Energy cost of your Sinister Strike ability by 5\./,
    );
  });

  it("resolves every prerequisite to an earlier row in the same tree", () => {
    for (const talent of talentCatalogue.talents) {
      if (talent.req === null) {
        continue;
      }
      const required = talentCatalogue.get(talent.req);
      assert.ok(required, talent.id);
      assert.equal(required.tree, talent.tree);
      assert.ok(required.row < talent.row, talent.id);
    }
  });

  it("looks talents up by id, tree and name", () => {
    const talent = talentCatalogue.get("subtlety.premeditation");
    assert.equal(talentCatalogue.byName("Premeditation"), talent);
    assert.equal(talentCatalogue.byName("  premeditation "), talent);
    assert.equal(talentCatalogue.byName("Premeditation", "subtlety"), talent);
    assert.equal(talentCatalogue.byName("Premeditation", "combat"), undefined);
    assert.equal(talentCatalogue.byName("No Such Talent"), undefined);
    assert.equal(talentCatalogue.get("combat.no-such-talent"), undefined);
    assert.ok(talentCatalogue.byTree("combat").includes(talent) === false);
    assert.ok(talentCatalogue.byTree("subtlety").includes(talent));
    assert.throws(() => talentCatalogue.byTree("outlaw"), RangeError);
  });

  it("returns rank text for 1 to max and refuses other ranks", () => {
    const id = "combat.precision";
    assert.equal(
      talentCatalogue.rankText(id, 1),
      talentCatalogue.get(id).ranks[0],
    );
    assert.throws(() => talentCatalogue.rankText(id, 0), RangeError);
    assert.throws(() => talentCatalogue.rankText(id, 4), RangeError);
    assert.throws(() => talentCatalogue.rankText(id, 1.5), RangeError);
    assert.throws(() => talentCatalogue.rankText("combat.nope", 1), RangeError);
  });

  it("is frozen so one caller cannot change what another reads", () => {
    const talent = talentCatalogue.get("combat.precision");
    assert.ok(Object.isFrozen(talentCatalogue));
    assert.ok(Object.isFrozen(talentCatalogue.talents));
    assert.ok(Object.isFrozen(talent));
    assert.ok(Object.isFrozen(talent.ranks));
    assert.throws(() => {
      talent.max = 9;
    }, TypeError);
  });

  it("freezes trees, each tree and each tree's talents, not just the lookups (#91)", () => {
    assert.ok(Object.isFrozen(talentCatalogue.trees));
    for (const tree of talentCatalogue.trees) {
      assert.ok(Object.isFrozen(tree), tree.id);
      assert.ok(Object.isFrozen(tree.talents), tree.id);
      assert.equal(talentCatalogue.byTree(tree.id), tree.talents);
      assert.throws(() => tree.talents.push(tree.talents[0]), TypeError);
      assert.throws(() => {
        tree.name = "Changed";
      }, TypeError);
    }
    assert.throws(() => talentCatalogue.trees.pop(), TypeError);
    assert.throws(() => talentCatalogue.talents.pop(), TypeError);
    assert.throws(() => {
      talentCatalogue.trees[0].talents[0] = null;
    }, TypeError);
    assert.throws(() => {
      talentCatalogue.get = () => undefined;
    }, TypeError);
    assert.equal(talentCatalogue.talents.length, 53);
  });

  it("refuses a name that is not a string, and trims one that is", () => {
    for (const bad of [undefined, null, 7, {}, ["Precision"]]) {
      assert.throws(
        () => talentCatalogue.byName(bad),
        /byName needs a talent name as a string/,
      );
    }
    // The message says what it got: "object" for null was no help (#92).
    assert.throws(
      () => talentCatalogue.byName(null),
      /byName needs a talent name as a string, not null\./,
    );
    assert.throws(
      () => talentCatalogue.byName(["Precision"]),
      /not an array\./,
    );
    assert.throws(() => talentCatalogue.byName(undefined), /not undefined\./);
    assert.throws(() => talentCatalogue.byName(7), /not number\./);
    assert.equal(
      talentCatalogue.byName("\t Precision\n"),
      talentCatalogue.get("combat.precision"),
    );
    assert.equal(talentCatalogue.byName("   "), undefined);
  });

  it("does not change when the snapshot object it was built from changes", () => {
    const copy = structuredClone(snapshot);
    const catalogue = buildTalentCatalogue(copy);
    copy.talents.trees[1].talents[0].desc[0] = "changed";
    assert.equal(
      catalogue.get("combat.improved-eviscerate").ranks[0],
      snapshot.talents.trees[1].talents[0].desc[0],
    );
  });
});

// Adrenaline Rush has no `req` in the snapshot, and that is legitimate: it is a
// row 7 talent with no prerequisite. A missing `req` is not an error.

function outlaw(...talents) {
  return fixture([{ name: "Outlaw", icon: "i", talents }]);
}

describe("buildTalentCatalogue load-time validation (D11)", () => {
  it("loads the vendored snapshot, which passes every check", () => {
    assert.doesNotThrow(() => buildTalentCatalogue(snapshot));
    assert.equal(talentCatalogue.get("combat.adrenaline-rush").req, null);
  });

  it("rejects a bad or missing name", () => {
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), name: undefined })),
      /"name" must be a string/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), name: 5 })),
      /"name" must be a string/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("   "))),
      /"name" must be a non-empty string/,
    );
    assert.throws(
      () => buildTalentCatalogue(fixture([{ icon: "i", talents: [raw("A")] }])),
      /"name" must be a non-empty string/,
    );
    assert.throws(() => buildTalentCatalogue(outlaw(null)), TypeError);
  });

  it("rejects a bad or missing icon, on a talent or a tree", () => {
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), icon: undefined })),
      /"icon" must be a string/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), icon: 3 })),
      /"icon" must be a string/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { icon: "" }))),
      /"icon" must be a non-empty string/,
    );
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([{ name: "Outlaw", talents: [raw("A")] }]),
        ),
      /"icon" must be a non-empty string/,
    );
  });

  it("rejects a max that is missing, not a whole number, or below 1", () => {
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), max: undefined })),
      /"max" must be a number/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), max: "1" })),
      /"max" must be a number/,
    );
    for (const max of [0, -1, 1.5, Number.NaN]) {
      assert.throws(
        () => buildTalentCatalogue(outlaw(raw("A", { max }))),
        /"max" must be a whole number of 1 or more/,
        String(max),
      );
    }
  });

  it("names NaN and Infinity in the error, not null (#92 carry-over)", () => {
    for (const max of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => buildTalentCatalogue(outlaw(raw("A", { max }))),
        new RegExp(`"max" must be a whole number of 1 or more, not ${max}\\.`),
        String(max),
      );
    }
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { row: Number.NaN }))),
      /"row" must be a whole number of 1 or more, not NaN\./,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), max: undefined })),
      /"max" must be a number, not undefined\./,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), max: "3" })),
      /"max" must be a number, not "3"\./,
    );
  });

  it("says where a talent or tree that is not an object sits, and what it was (#92 carry-over)", () => {
    for (const [bad, kind] of [
      [null, "null"],
      [7, "number"],
      [["A"], "an array"],
    ]) {
      assert.throws(
        () => buildTalentCatalogue(outlaw(raw("A"), bad)),
        new RegExp(
          `Talent at index 1 in outlaw: a talent must be an object, not ${kind}\\.`,
        ),
        kind,
      );
    }
    assert.throws(
      () => buildTalentCatalogue(fixture([null])),
      /Tree at index 0: a tree must be an object, not null\./,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw({ ...raw("A"), name: undefined })),
      /Talent at index 0 in outlaw: "name" must be a string, not undefined\./,
    );
  });

  it("rejects a max that differs from the number of rank texts", () => {
    assert.throws(
      () =>
        buildTalentCatalogue(
          outlaw(raw("A", { max: 3, desc: ["One.", "Two."] })),
        ),
      /"max" is 3 but "desc" has 2 rank texts/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { max: 1, desc: [] }))),
      /"max" is 1 but "desc" has 0 rank texts/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { desc: ["One.", "Two."] }))),
      /"max" is 1 but "desc" has 2 rank texts/,
    );
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { desc: [""] }))),
      /"desc\[0\]" must be a non-empty string/,
    );
  });

  it("rejects a row or column that is not a whole number of 1 or more", () => {
    for (const field of ["row", "col"]) {
      for (const bad of [0, -2, 1.5]) {
        assert.throws(
          () => buildTalentCatalogue(outlaw(raw("A", { [field]: bad }))),
          new RegExp(`"${field}" must be a whole number of 1 or more`),
          `${field} ${bad}`,
        );
      }
    }
  });

  it("rejects two talents on the same row and column of a tree", () => {
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A"), raw("B"))),
      /row 1, col 1 is already taken in outlaw/,
    );
    assert.doesNotThrow(() =>
      buildTalentCatalogue(outlaw(raw("A"), raw("B", { col: 2 }))),
    );
    // The same cell in another tree is fine: every tree has its own grid.
    assert.doesNotThrow(() =>
      buildTalentCatalogue(
        fixture([
          { name: "Outlaw", icon: "i", talents: [raw("A")] },
          { name: "Ranger", icon: "i", talents: [raw("B")] },
        ]),
      ),
    );
  });

  it("rejects a prerequisite in another tree, with a message that says so", () => {
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([
            { name: "Outlaw", icon: "i", talents: [raw("Quick Draw")] },
            {
              name: "Ranger",
              icon: "i",
              talents: [raw("Aim", { row: 2, req: "Quick Draw" })],
            },
          ]),
        ),
      /"ranger\.aim" requires "Quick Draw", which is in outlaw\. A prerequisite must be in the same tree\./,
    );
  });

  it("rejects a prerequisite that is the talent itself or not on an earlier row", () => {
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { req: "A" }))),
      /"outlaw\.a" requires "A", which is not on an earlier row/,
    );
    assert.throws(
      () =>
        buildTalentCatalogue(
          outlaw(raw("A", { row: 2 }), raw("B", { row: 2, col: 2, req: "A" })),
        ),
      /not on an earlier row/,
    );
    assert.throws(
      () =>
        buildTalentCatalogue(
          outlaw(raw("A", { row: 1, req: "B" }), raw("B", { row: 2, col: 2 })),
        ),
      /not on an earlier row/,
    );
    assert.doesNotThrow(() =>
      buildTalentCatalogue(outlaw(raw("A"), raw("B", { row: 2, req: "A" }))),
    );
  });

  it("rejects a prerequisite that is not text", () => {
    assert.throws(
      () => buildTalentCatalogue(outlaw(raw("A", { req: 4 }))),
      /"req" must be a non-empty string/,
    );
  });

  it("rejects a tree whose talents are not a list", () => {
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([{ name: "Outlaw", icon: "i", talents: {} }]),
        ),
      /"talents" must be an array/,
    );
  });

  it("fails the import of js/talents.js itself when the snapshot is bad", async () => {
    // talentCatalogue is built when the module loads. Copy the module next to
    // a broken snapshot and import it in a fresh Node process.
    const dir = await mkdtemp(join(tmpdir(), "wowf-talents-"));
    try {
      await mkdir(join(dir, "js"));
      await mkdir(join(dir, "data/talentsforever"), { recursive: true });
      await writeFile(join(dir, "package.json"), '{"type":"module"}');
      await copyFile(
        new URL("../js/talents.js", import.meta.url),
        join(dir, "js/talents.js"),
      );
      const importIt = () =>
        execFileAsync(process.execPath, [
          "--input-type=module",
          "-e",
          `import(${JSON.stringify(pathToFileURL(join(dir, "js/talents.js")).href)})`,
        ]);

      await writeFile(
        join(dir, "data/talentsforever/rogue.json"),
        JSON.stringify(snapshot),
      );
      await importIt();

      const broken = structuredClone(snapshot);
      broken.talents.trees[1].talents[0].max += 1;
      await writeFile(
        join(dir, "data/talentsforever/rogue.json"),
        JSON.stringify(broken),
      );
      await assert.rejects(importIt(), /"max" is \d+ but "desc" has \d+ rank/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildTalentCatalogue on other data", () => {
  it("follows a refreshed snapshot with no code change", () => {
    const catalogue = buildTalentCatalogue(
      fixture([
        {
          name: "Outlaw",
          icon: "tree_icon",
          talents: [
            raw("Quick Draw", { max: 2, desc: ["One.", "Two."] }),
            raw("Dead Eye's Mark", { row: 2, req: "Quick Draw" }),
          ],
        },
      ]),
    );
    assert.deepEqual(
      catalogue.talents.map((talent) => talent.id),
      ["outlaw.quick-draw", "outlaw.dead-eyes-mark"],
    );
    assert.equal(
      catalogue.get("outlaw.dead-eyes-mark").req,
      "outlaw.quick-draw",
    );
    assert.equal(catalogue.rankText("outlaw.quick-draw", 2), "Two.");
  });

  it("rejects a duplicate talent id", () => {
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([
            {
              name: "Outlaw",
              icon: "i",
              talents: [raw("Quick Draw"), raw("Quick  draw")],
            },
          ]),
        ),
      /Duplicate talent id "outlaw\.quick-draw"/,
    );
  });

  it("rejects a duplicate tree", () => {
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([
            { name: "Outlaw", icon: "i", talents: [raw("A")] },
            { name: "outlaw", icon: "i", talents: [raw("B")] },
          ]),
        ),
      /Duplicate talent tree/,
    );
  });

  it("rejects a prerequisite that is not in the tree", () => {
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([
            {
              name: "Outlaw",
              icon: "i",
              talents: [raw("Quick Draw", { req: "Missing" })],
            },
          ]),
        ),
      /requires "Missing"/,
    );
  });

  it("rejects a snapshot or talent that is missing fields", () => {
    assert.throws(() => buildTalentCatalogue({}), TypeError);
    assert.throws(() => buildTalentCatalogue(fixture([])), TypeError);
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([
            {
              name: "Outlaw",
              icon: "i",
              talents: [{ ...raw("Quick Draw"), row: "1" }],
            },
          ]),
        ),
      /"row" must be a number/,
    );
    assert.throws(
      () =>
        buildTalentCatalogue(
          fixture([
            {
              name: "Outlaw",
              icon: "i",
              talents: [{ ...raw("Quick Draw"), desc: undefined }],
            },
          ]),
        ),
      /"desc" must be an array/,
    );
  });
});
