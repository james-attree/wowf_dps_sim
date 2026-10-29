import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { decodeBuildLink, referenceBuild } from "../data/reference-build.js";
import { buildLabel } from "../js/build-label.js";
import { createFight, runFight } from "../js/fight.js";
import { loadPreset } from "../js/rotation-presets.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import {
  applyBuild,
  buildProblems,
  canAdd,
  canRemove,
  DEFAULT_TALENT_LEVEL,
  pointsByTree,
  talentLevelRange,
  talentPointCap,
  validateBuild,
  why,
} from "../js/talent-build.js";
import { talentCatalogue } from "../js/talents.js";

// #190 (P3.5-04): partial talent builds, capped by the talent level (level - 9),
// and the non-throwing per-talent model the U6 picker reads.

const REFERENCE = referenceBuild();
const total = (ranks) =>
  Object.values(ranks).reduce((sum, rank) => sum + rank, 0);

// A legal build of `points` points, filled with the model itself: walk the
// Combat tree (then Assassination) in catalogue order and add each point
// canAdd allows. The result is checked with validateBuild in every test.
function fill(points, trees = ["combat", "assassination"]) {
  const ranks = {};
  let added = true;
  while (total(ranks) < points && added) {
    added = false;
    for (const tree of trees) {
      for (const talent of talentCatalogue.byTree(tree)) {
        if (total(ranks) < points && canAdd(ranks, talent.id)) {
          ranks[talent.id] = (ranks[talent.id] ?? 0) + 1;
          added = true;
        }
      }
    }
  }
  assert.equal(total(ranks), points, `fill(${points})`);
  return ranks;
}

const PROBLEM_KEYS = ["code", "talent", "need", "have", "message"];

describe("the talent level and its cap (#190)", () => {
  it("runs from 10 to 60, 60 by default, and caps at level - 9", () => {
    assert.deepEqual({ ...talentLevelRange() }, { min: 10, max: 60 });
    assert.equal(DEFAULT_TALENT_LEVEL, 60);
    assert.equal(talentPointCap(), k("talents.maxPoints"));
    assert.equal(talentPointCap(60), 51);
    assert.equal(talentPointCap(40), 31);
    assert.equal(talentPointCap(10), 1);
    for (let level = 10; level <= 60; level += 1) {
      assert.equal(talentPointCap(level), level - 9);
    }
  });

  it("refuses a level outside 10 to 60, or not a whole number", () => {
    for (const bad of [9, 61, 0, -1, 40.5, NaN, Infinity, "40", null]) {
      assert.throws(() => talentPointCap(bad), {
        name: "RangeError",
        message: /^The talent level must be a whole number from 10 to 60, not /,
      });
    }
  });

  it("is the Classic rule, tagged assumption; the row gating is confirmed for WoW Forever", () => {
    const entry = CONSTANTS["talents.firstPointLevel"];
    assert.equal(entry.value, 10);
    assert.equal(entry.source, "assumption");
    assert.match(entry.ref, /Classic/);
    assert.equal(CONSTANTS["talents.rowGating"].source, "wowf-designer");
    assert.match(
      CONSTANTS["talents.rowGating"].ref,
      /^confirmed by James, 29 Oct 2026: WoW Forever matches Classic, 5 points per row/,
    );
  });

  it("is config.talentLevel: 60 by default, 10 to 60, whole", () => {
    assert.equal(defaultConfig().talentLevel, 60);
    assert.equal(normalizeConfig().talentLevel, 60);
    assert.equal(normalizeConfig({ talentLevel: 10 }).talentLevel, 10);
    assert.equal(normalizeConfig({ talentLevel: 60 }).talentLevel, 60);
    for (const bad of [9, 61, 40.5, NaN, Infinity, -5]) {
      assert.throws(() => normalizeConfig({ talentLevel: bad }), {
        name: "RangeError",
        message:
          /^config\.talentLevel must be a whole number between 10 and 60, not /,
      });
    }
    for (const bad of ["40", null, true, {}]) {
      assert.throws(() => normalizeConfig({ talentLevel: bad }), {
        name: "TypeError",
        message:
          /^config\.talentLevel must be a whole number between 10 and 60/,
      });
    }
    const config = normalizeConfig({ talentLevel: 25 });
    assert.deepEqual(normalizeConfig(config), config);
  });

  it("at level 40, 31 points pass and 32 fail", () => {
    const ok = fill(31);
    const over = fill(32);
    assert.equal(validateBuild(ok, talentCatalogue, { level: 40 }), 31);
    assert.throws(() => validateBuild(over, talentCatalogue, { level: 40 }), {
      name: "RangeError",
      message:
        /^Talent build is not valid: the build spends 32 talent points, and a level 40 character can spend at most 31 \(level - 9, talents\.firstPointLevel\)\.$/,
    });
    assert.equal(validateBuild(over), 32);
    assert.doesNotThrow(() =>
      runFight({
        seed: 3,
        duration: 5,
        config: { talents: ok, talentLevel: 40 },
      }),
    );
    for (const run of [
      () => normalizeConfig({ talents: over, talentLevel: 40 }),
      () =>
        runFight({
          seed: 3,
          duration: 5,
          config: { talents: over, talentLevel: 40 },
        }),
      () => createFight(3, { talents: over, talentLevel: 40 }),
    ]) {
      assert.throws(run, {
        name: "RangeError",
        message:
          /^config\.talents spends 32 talent points, and config\.talentLevel 40 allows at most 31 \(level - 9\)\.$/,
      });
    }
    assert.equal(buildProblems(over, { level: 40 })[0].code, "overLevel");
    assert.deepEqual(buildProblems(ok, { level: 40 }), []);
  });

  it("at level 10, one point passes and two fail; at 60, the reference build", () => {
    assert.equal(validateBuild(fill(1), talentCatalogue, { level: 10 }), 1);
    assert.throws(
      () => validateBuild(fill(2), talentCatalogue, { level: 10 }),
      /can spend at most 1/,
    );
    assert.equal(
      normalizeConfig({ talents: REFERENCE, talentLevel: 60 }).talentLevel,
      60,
    );
    assert.throws(
      () => normalizeConfig({ talents: REFERENCE, talentLevel: 59 }),
      /spends 51 talent points, and config\.talentLevel 59 allows at most 50/,
    );
  });

  it("caps the points and nothing else: not character.level, not armor", () => {
    // The result echoes its config, so compare all but that, and the config
    // but its talentLevel.
    const fight = (config) => {
      const { config: echoed, ...result } = runFight({
        seed: 9,
        duration: config.duration ?? 60,
        config: config.config,
      });
      const { talentLevel, ...rest } = echoed;
      assert.equal(talentLevel, config.config?.talentLevel ?? 60);
      return { ...result, config: rest };
    };
    const ranks = fill(31);
    const at60 = fight({
      config: { talents: ranks },
    });
    for (const talentLevel of [40, 45, 59]) {
      assert.deepEqual(
        fight({ config: { talents: ranks, talentLevel } }),
        at60,
        `talentLevel ${talentLevel}`,
      );
    }
    assert.deepEqual(
      fight({ duration: 30, config: { talentLevel: 10 } }),
      fight({ duration: 30 }),
    );
    assert.equal(k("character.level"), 60);
    const { rogue } = createFight(1, { talentLevel: 10 });
    assert.equal(rogue.config.talentLevel, 10);
    assert.equal(rogue.config.character.level, undefined);
  });
});

describe("partial builds run (#190)", () => {
  for (const points of [0, 1, 31, 50]) {
    it(`a legal ${points}-point build is valid and runs`, () => {
      const ranks = points === 0 ? {} : fill(points);
      assert.equal(validateBuild(ranks), points);
      assert.deepEqual(buildProblems(ranks), []);
      const applied = applyBuild(ranks);
      assert.equal(applied.selected, points > 0);
      assert.equal(applied.points, points);
      const result = runFight({
        seed: 2,
        duration: 30,
        config: { talents: ranks },
      });
      assert.ok(result.dps > 0);
    });
  }

  it("an empty build is no build: the same fight as no talents", () => {
    assert.equal(applyBuild({}).selected, false);
    assert.deepEqual(
      runFight({ seed: 4, duration: 60, config: { talents: {} } }),
      runFight({ seed: 4, duration: 60 }),
    );
  });

  it("a 52-point build, a row-gate break and a prerequisite break still throw", () => {
    const fiftyTwo = { ...REFERENCE, "combat.lightning-reflexes": 1 };
    assert.throws(
      () => validateBuild(fiftyTwo),
      /spends 52 talent points, and at most 51/,
    );
    assert.throws(() => validateBuild({ "combat.precision": 1 }), {
      name: "RangeError",
      message:
        /^Talent build is not valid: "combat\.precision" is on row 2 of combat, which needs 5 points on the rows above it \(talents\.rowGating\), and the build has 0\.$/,
    });
    const noDeflection = {
      "combat.improved-eviscerate": 3,
      "combat.improved-sinister-strike": 2,
      "combat.lightning-reflexes": 5,
      "combat.riposte": 1,
    };
    assert.throws(() => validateBuild(noDeflection), {
      name: "RangeError",
      message:
        /^Talent build is not valid: "combat\.riposte" needs its prerequisite "combat\.deflection" at rank 3, and it is at rank 0\.$/,
    });
    for (const ranks of [fiftyTwo, { "combat.precision": 1 }, noDeflection]) {
      assert.throws(
        () => runFight({ seed: 1, duration: 1, config: { talents: ranks } }),
        RangeError,
      );
    }
  });

  it("decodes a partial talentsforever link, with its level, into a legal build", () => {
    const decoded = decodeBuildLink("https://talentsforever.com/rogue/14/-32");
    assert.equal(decoded.level, 14);
    const ranks = Object.fromEntries(
      Object.entries(decoded.ranks).filter(([, rank]) => rank > 0),
    );
    assert.deepEqual(ranks, {
      "combat.improved-eviscerate": 3,
      "combat.improved-sinister-strike": 2,
    });
    assert.equal(
      validateBuild(ranks, talentCatalogue, { level: decoded.level }),
      5,
    );
    assert.equal(
      normalizeConfig({ talents: ranks, talentLevel: decoded.level })
        .talentLevel,
      14,
    );
    // The reference link still decodes to the 51-point build.
    assert.equal(total(REFERENCE), 51);
  });
});

describe("a partial build locks the talent abilities it lacks (#190, before #199)", () => {
  const casts = (fight, id) => fight.simulation.abilityStats[id]?.casts ?? 0;
  const PARTIAL = {
    "combat.improved-eviscerate": 3,
    "combat.improved-sinister-strike": 2,
    "combat.precision": 3,
  };

  for (const [label, config] of [
    ["the default rotation", { talents: PARTIAL }],
    [
      "the combat-swords preset",
      loadPreset("combat-swords", { talents: PARTIAL }),
    ],
  ]) {
    it(`keeps build.selected, locks Blade Flurry and Adrenaline Rush, and falls through (${label})`, () => {
      const fight = createFight(1, config);
      assert.equal(fight.build.selected, true);
      assert.equal(fight.build.points, 8);
      const { rogue } = fight;
      assert.equal(rogue.lockedByBuild(rogue.abilities.bladeFlurry), true);
      assert.equal(rogue.lockedByBuild(rogue.abilities.adrenalineRush), true);
      fight.simulation.run(120);
      assert.equal(casts(fight, "blade-flurry"), 0);
      assert.equal(casts(fight, "adrenaline-rush"), 0);
      assert.equal(casts(fight, "cold-blood"), 0);
      assert.ok(casts(fight, "sinister-strike") > 0);
      assert.ok(casts(fight, "slice-and-dice") > 0);
    });
  }

  it("with no build, Blade Flurry and Adrenaline Rush are still cast (unchanged)", () => {
    const fight = createFight(1);
    fight.simulation.run(120);
    assert.ok(casts(fight, "blade-flurry") >= 1);
    assert.ok(casts(fight, "adrenaline-rush") >= 1);
  });
});

describe("pointsByTree", () => {
  it("counts the points by tree and in all, frozen", () => {
    const points = pointsByTree(REFERENCE);
    assert.deepEqual(
      { ...points },
      {
        assassination: 18,
        combat: 33,
        subtlety: 0,
        total: 51,
      },
    );
    assert.ok(Object.isFrozen(points));
    assert.deepEqual(
      { ...pointsByTree({}) },
      {
        assassination: 0,
        combat: 0,
        subtlety: 0,
        total: 0,
      },
    );
  });

  it("never throws, and counts nothing that is not a valid rank", () => {
    const zero = { assassination: 0, combat: 0, subtlety: 0, total: 0 };
    for (const bad of [undefined, null, 3, "x", [], [1, 2], () => 1]) {
      assert.deepEqual({ ...pointsByTree(bad) }, zero);
    }
    assert.deepEqual(
      {
        ...pointsByTree({
          "combat.precision": 2,
          "combat.nope": 5,
          "combat.deflection": 9,
          "combat.endurance": "2",
          "combat.riposte": 0.5,
          "subtlety.camouflage": -1,
        }),
      },
      { assassination: 0, combat: 2, subtlety: 0, total: 2 },
    );
  });
});

describe("buildProblems: every problem as data", () => {
  const codes = (list) => list.map((entry) => entry.code);

  it("gives frozen { code, talent, need, have, message } entries", () => {
    const list = buildProblems({ "combat.precision": 1, "combat.riposte": 1 });
    assert.ok(Object.isFrozen(list));
    assert.ok(list.length > 0);
    for (const entry of list) {
      assert.deepEqual(Object.keys(entry), PROBLEM_KEYS);
      assert.ok(Object.isFrozen(entry));
      assert.equal(typeof entry.message, "string");
    }
  });

  it("names each code with its numbers", () => {
    assert.deepEqual(buildProblems(null), [
      {
        code: "notAnObject",
        talent: null,
        need: null,
        have: null,
        message: "a build must be an object of { talent id: rank }, not null",
      },
    ]);
    assert.deepEqual(codes(buildProblems([])), ["notAnObject"]);
    assert.deepEqual(buildProblems({ Precision: 3 })[0], {
      code: "unknownTalent",
      talent: "Precision",
      need: null,
      have: null,
      message:
        '"Precision" is not a talent id. Use a catalogue id such as "combat.precision"',
    });
    assert.deepEqual(buildProblems({ "combat.improved-eviscerate": 4 })[0], {
      code: "badRank",
      talent: "combat.improved-eviscerate",
      need: 3,
      have: 4,
      message: '"combat.improved-eviscerate" has ranks 0 to 3, not 4',
    });
    assert.equal(
      buildProblems({ "combat.improved-eviscerate": "3" })[0].message,
      '"combat.improved-eviscerate" has ranks 0 to 3, not "3"',
    );
    assert.deepEqual(buildProblems({}, { level: 61 })[0], {
      code: "badLevel",
      talent: null,
      need: 60,
      have: 61,
      message: "the talent level must be a whole number from 10 to 60, not 61",
    });
    assert.equal(buildProblems({}, { level: 9 })[0].need, 10);
    assert.equal(buildProblems({}, { level: "x" })[0].need, 10);
    assert.deepEqual(
      buildProblems({ ...REFERENCE, "combat.lightning-reflexes": 1 }),
      [
        {
          code: "overMax",
          talent: null,
          need: 51,
          have: 52,
          message:
            "the build spends 52 talent points, and at most 51 can be spent (talents.maxPoints)",
        },
      ],
    );
    assert.deepEqual(buildProblems(fill(32), { level: 40 }), [
      {
        code: "overLevel",
        talent: null,
        need: 31,
        have: 32,
        message:
          "the build spends 32 talent points, and a level 40 character can spend at most 31 (level - 9, talents.firstPointLevel)",
      },
    ]);
    assert.deepEqual(buildProblems({ "combat.precision": 1 }), [
      {
        code: "rowGate",
        talent: "combat.precision",
        need: 5,
        have: 0,
        message:
          '"combat.precision" is on row 2 of combat, which needs 5 points on the rows above it (talents.rowGating), and the build has 0',
      },
    ]);
    const riposte = buildProblems({
      "combat.improved-eviscerate": 3,
      "combat.improved-sinister-strike": 2,
      "combat.lightning-reflexes": 3,
      "combat.deflection": 2,
      "combat.riposte": 1,
    });
    assert.deepEqual(riposte, [
      {
        code: "prerequisite",
        talent: "combat.riposte",
        need: 3,
        have: 2,
        message:
          '"combat.riposte" needs its prerequisite "combat.deflection" at rank 3, and it is at rank 2',
      },
    ]);
  });

  it("reports the input problems and still the rules for the valid ranks", () => {
    const list = buildProblems(
      { "combat.nope": 1, "combat.deflection": 7, "combat.precision": 1 },
      { level: 5 },
    );
    assert.deepEqual(codes(list), [
      "unknownTalent",
      "badRank",
      "badLevel",
      "rowGate",
    ]);
  });

  it("has a message for each rule problem that validateBuild throws, in order", () => {
    const broken = {
      ...REFERENCE,
      "combat.precision": 2,
      "combat.lightning-reflexes": 2,
    };
    const messages = buildProblems(broken).map((entry) => entry.message);
    assert.throws(() => validateBuild(broken), {
      message: `Talent build is not valid: ${messages.join("; ")}.`,
    });
  });

  it("does not count fewer points than the cap as a problem", () => {
    for (const points of [0, 1, 10, 31, 50, 51]) {
      assert.deepEqual(buildProblems(points === 0 ? {} : fill(points)), []);
    }
  });
});

describe("canAdd, canRemove and why: the per-talent model", () => {
  const ROW1 = {
    "combat.improved-eviscerate": 3,
    "combat.improved-sinister-strike": 2,
  };

  it("allows a point that keeps the build legal, and why() is null", () => {
    assert.equal(canAdd({}, "combat.improved-eviscerate"), true);
    assert.equal(why({}, "combat.improved-eviscerate"), null);
    assert.equal(why({}, "combat.improved-eviscerate", "add"), null);
    assert.equal(canAdd(ROW1, "combat.precision"), true);
    assert.equal(
      canAdd({ ...ROW1, "combat.deflection": 3 }, "combat.riposte"),
      false,
    );
    assert.equal(canRemove(ROW1, "combat.improved-eviscerate"), true);
  });

  it("refuses an add at full rank (maxRank)", () => {
    const answer = why(
      { "combat.improved-eviscerate": 3 },
      "combat.improved-eviscerate",
    );
    assert.deepEqual(
      { ...answer, blockers: [...answer.blockers] },
      {
        code: "maxRank",
        talent: "combat.improved-eviscerate",
        need: 3,
        have: 3,
        message: '"combat.improved-eviscerate" is at its full rank, 3',
        blockers: [],
      },
    );
    assert.ok(Object.isFrozen(answer));
    assert.equal(
      canAdd({ "combat.improved-eviscerate": 3 }, "combat.improved-eviscerate"),
      false,
    );
  });

  it("refuses an add past the cap (capReached), by level", () => {
    const one = { "combat.improved-eviscerate": 1 };
    const answer = why(one, "combat.improved-eviscerate", "add", { level: 10 });
    assert.equal(answer.code, "capReached");
    assert.equal(answer.need, 1);
    assert.equal(answer.have, 1);
    assert.match(
      answer.message,
      /all 1 talent points a level 10 character has/,
    );
    assert.equal(
      canAdd(one, "combat.improved-eviscerate", { level: 11 }),
      true,
    );
    assert.equal(canAdd(REFERENCE, "combat.lightning-reflexes"), false);
    assert.equal(
      why(REFERENCE, "combat.lightning-reflexes").code,
      "capReached",
    );
    assert.equal(why(REFERENCE, "combat.lightning-reflexes").need, 51);
  });

  it("refuses an add above the row gate (rowGate)", () => {
    const answer = why({ "combat.improved-eviscerate": 3 }, "combat.precision");
    assert.equal(answer.code, "rowGate");
    assert.equal(answer.talent, "combat.precision");
    assert.equal(answer.need, 5);
    assert.equal(answer.have, 3);
    assert.deepEqual([...answer.blockers], []);
    assert.equal(why({}, "combat.adrenaline-rush").need, 30);
  });

  it("refuses an add without the prerequisite at full rank, naming it (prerequisite)", () => {
    const ranks = { ...ROW1, "combat.deflection": 2 };
    const answer = why(ranks, "combat.riposte");
    assert.equal(answer.code, "prerequisite");
    assert.equal(answer.talent, "combat.riposte");
    assert.equal(answer.need, 3);
    assert.equal(answer.have, 2);
    assert.deepEqual([...answer.blockers], ["combat.deflection"]);
    assert.equal(
      canAdd({ ...ROW1, "combat.deflection": 3 }, "combat.riposte"),
      false,
    );
    // Riposte is on row 3: 8 points above it, so it needs 2 more points too.
    const ready = {
      ...ROW1,
      "combat.deflection": 3,
      "combat.lightning-reflexes": 2,
    };
    assert.equal(canAdd(ready, "combat.riposte"), true);
  });

  it("refuses a remove with no point (notTaken)", () => {
    const answer = why({}, "combat.precision", "remove");
    assert.equal(answer.code, "notTaken");
    assert.equal(canRemove({}, "combat.precision"), false);
  });

  it("refuses a remove that would strand a talent below on its row gate (strands)", () => {
    const ranks = { ...ROW1, "combat.precision": 3 };
    for (const id of Object.keys(ROW1)) {
      assert.equal(canRemove(ranks, id), false, id);
      const answer = why(ranks, id, "remove");
      assert.equal(answer.code, "strands");
      assert.equal(answer.talent, "combat.precision");
      assert.equal(answer.need, 5);
      assert.equal(answer.have, 4);
      assert.deepEqual([...answer.blockers], ["combat.precision"]);
      assert.match(
        answer.message,
        new RegExp(
          `^taking a point from "${id.replace(".", "\\.")}" would strand "combat\\.precision" is on row 2`,
        ),
      );
    }
    // The talent at the bottom can always go, one point at a time.
    assert.equal(canRemove(ranks, "combat.precision"), true);
    // With a sixth point on row 1, one of them can go.
    const spare = { ...ranks, "combat.lightning-reflexes": 1 };
    assert.equal(canRemove(spare, "combat.improved-eviscerate"), true);
    assert.equal(canRemove(spare, "combat.lightning-reflexes"), true);
  });

  it("refuses a remove that would strand a talent hanging below it (prerequisite)", () => {
    const ranks = {
      ...ROW1,
      "combat.deflection": 3,
      "combat.lightning-reflexes": 2,
      "combat.riposte": 1,
    };
    assert.deepEqual(buildProblems(ranks), []);
    const answer = why(ranks, "combat.deflection", "remove");
    assert.equal(answer.code, "strands");
    assert.equal(answer.talent, "combat.riposte");
    assert.equal(answer.need, 3);
    assert.equal(answer.have, 2);
    assert.deepEqual([...answer.blockers], ["combat.riposte"]);
    assert.equal(canRemove(ranks, "combat.riposte"), true);
    assert.equal(
      canRemove({ ...ranks, "combat.riposte": 0 }, "combat.deflection"),
      true,
    );
  });

  it("lists every talent a remove would strand, and only new problems", () => {
    // The reference build: Combat row 1 has exactly 5, and many talents sit on
    // the rows below it.
    const answer = why(REFERENCE, "combat.improved-sinister-strike", "remove");
    assert.equal(answer.code, "strands");
    assert.ok(answer.blockers.length > 1);
    // A build already broken on Precision: taking from row 1 does not count
    // that again, so the remove is judged on what it changes.
    const broken = { "combat.improved-eviscerate": 3, "combat.precision": 3 };
    assert.equal(canRemove(broken, "combat.improved-eviscerate"), true);
  });

  it("never throws, and answers bad input with its code", () => {
    const cases = [
      [[null, "combat.precision"], "notAnObject"],
      [[[], "combat.precision"], "notAnObject"],
      [[{}, "combat.nope"], "unknownTalent"],
      [[{}, undefined], "unknownTalent"],
      [[{}, 7], "unknownTalent"],
      [[{ "combat.nope": 1 }, "combat.precision"], "unknownTalent"],
      [[{ "combat.precision": 9 }, "combat.precision"], "badRank"],
      [[{}, "combat.precision", "add", { level: 70 }], "badLevel"],
      [[{}, "combat.precision", "toggle"], "badAction"],
    ];
    for (const [args, code] of cases) {
      assert.equal(why(...args).code, code, JSON.stringify(args));
    }
    const junk = [
      undefined,
      null,
      0,
      "x",
      [],
      {},
      { "combat.precision": "3" },
      { a: NaN },
      () => 1,
    ];
    const ids = [undefined, null, 0, "", "combat.precision", "combat.nope", {}];
    const levels = [undefined, 10, 60, 0, 99, "40", NaN, null];
    for (const ranks of junk) {
      assert.doesNotThrow(() => pointsByTree(ranks));
      for (const level of levels) {
        assert.doesNotThrow(() => buildProblems(ranks, { level }));
        for (const id of ids) {
          for (const action of ["add", "remove", "x", undefined]) {
            assert.doesNotThrow(() => why(ranks, id, action, { level }));
          }
          assert.equal(typeof canAdd(ranks, id, { level }), "boolean");
          assert.equal(typeof canRemove(ranks, id, { level }), "boolean");
        }
      }
    }
    assert.doesNotThrow(() => buildProblems(undefined, undefined));
    assert.doesNotThrow(() => canAdd({}, "combat.precision", undefined));
  });

  it("agrees with buildProblems: every add canAdd allows keeps a legal build legal", () => {
    for (const level of [10, 25, 40, 60]) {
      let ranks = {};
      for (let step = 0; step < 60; step += 1) {
        const next = talentCatalogue.talents.find((talent) =>
          canAdd(ranks, talent.id, { level }),
        );
        if (next === undefined) {
          break;
        }
        ranks = { ...ranks, [next.id]: (ranks[next.id] ?? 0) + 1 };
        assert.deepEqual(
          buildProblems(ranks, { level }),
          [],
          `${level}: ${next.id}`,
        );
      }
      assert.equal(total(ranks), talentPointCap(level));
      for (const talent of talentCatalogue.talents) {
        if (canRemove(ranks, talent.id, { level })) {
          const fewer = { ...ranks, [talent.id]: ranks[talent.id] - 1 };
          assert.deepEqual(buildProblems(fewer, { level }), [], talent.id);
        }
      }
    }
  });

  it("takes the catalogue as the last argument", () => {
    const tiny = {
      trees: [{ id: "t" }],
      talents: [
        { id: "t.a", tree: "t", row: 1, max: 1, req: null },
        { id: "t.b", tree: "t", row: 1, max: 1, req: "t.a" },
      ],
      get(id) {
        return this.talents.find((talent) => talent.id === id);
      },
    };
    assert.equal(canAdd({}, "t.a", {}, tiny), true);
    assert.equal(canAdd({}, "t.b", {}, tiny), false);
    assert.equal(why({}, "t.b", "add", {}, tiny).code, "prerequisite");
    assert.equal(canRemove({ "t.a": 1, "t.b": 1 }, "t.a", {}, tiny), false);
    assert.deepEqual(
      { ...pointsByTree({ "t.a": 1 }, tiny) },
      { t: 1, total: 1 },
    );
    assert.deepEqual(
      buildProblems({ "t.b": 1 }, {}, tiny).map((entry) => entry.code),
      ["prerequisite"],
    );
  });
});

describe("validateBuild stays the throwing wrapper", () => {
  it("keeps its signature: validateBuild(ranks, catalogue), and returns the points", () => {
    assert.equal(validateBuild(REFERENCE), 51);
    assert.equal(validateBuild(REFERENCE, talentCatalogue), 51);
    assert.equal(validateBuild({}), 0);
  });

  it("keeps the id and rank errors of before #190", () => {
    assert.throws(() => validateBuild({ "combat.nope": 1 }), {
      name: "RangeError",
      message:
        'validateBuild got an unknown talent id "combat.nope". Use a catalogue id such as "combat.precision".',
    });
    assert.throws(() => validateBuild({ "combat.precision": 4 }), {
      name: "RangeError",
      message: 'Talent "combat.precision" has ranks 0 to 3. Got 4.',
    });
    assert.throws(() => validateBuild(null), {
      name: "RangeError",
      message:
        "validateBuild needs an object of { talent id: rank }, not null.",
    });
  });

  it("throws a RangeError for a bad level", () => {
    assert.throws(() => validateBuild({}, talentCatalogue, { level: 61 }), {
      name: "RangeError",
      message: "The talent level must be a whole number from 10 to 60, not 61.",
    });
  });

  it("applyBuild takes the level too, and the Rogue's default caps at 51", () => {
    assert.throws(
      () => applyBuild(fill(32), undefined, undefined, { level: 40 }),
      /at most 31/,
    );
    assert.equal(applyBuild(fill(32)).points, 32);
  });
});

describe("the build label shows a partial build's points (#190)", () => {
  it("adds (N/cap) for a partial build and nothing for a full one", () => {
    const part = (config) => buildLabel(config).split(" · ")[0];
    assert.equal(part({ talents: REFERENCE }), "Combat 18/33/0");
    assert.equal(
      part({
        talents: {
          "combat.improved-eviscerate": 3,
          "combat.improved-sinister-strike": 2,
        },
      }),
      "Combat 0/5/0 (5/51)",
    );
    assert.equal(
      part({ talents: fill(31, ["combat"]), talentLevel: 40 }),
      "Combat 0/31/0",
    );
    assert.equal(
      part({ talents: fill(30, ["combat"]), talentLevel: 40 }),
      "Combat 0/30/0 (30/31)",
    );
    assert.equal(
      part({ talents: fill(5, ["combat"]), talentLevel: 999 }),
      "Combat 0/5/0 (5/51)",
    );
    assert.equal(part({ talents: {} }), "No talents");
  });
});
