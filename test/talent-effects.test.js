import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { createFight, expandTalents } from "../js/fight.js";
import { ModifierPipeline } from "../js/modifiers.js";
import { PROC_TABLES } from "../js/proc-data.js";
import { procsFromTalents } from "../js/procs.js";
import { checkTalentEffects } from "../js/talent-build.js";
import { talentCatalogue } from "../js/talents.js";
import { decodeBuildLink } from "./talentsforever.js";

// D5 (#102): the effects of the Combat talents as data, and the expansion of a
// map of talent ranks into what a fight takes. The numbers of the modifier
// tables are checked against the snapshot's text in
// test/combat-talents-as-data.test.js; this file is the data's shape, its hashes,
// the expansion, and the reference build.

const COMBAT = talentCatalogue.byTree("combat");
const ASSASSINATION = talentCatalogue.byTree("assassination");
const SEED = 7;
const FIGHT_SECONDS = 60;

// The build the issue names, as the link a person would share, and the
// ranks that link must decode to (written out from the issue, so the decoder
// is checked against something other than itself).
const REFERENCE_LINK =
  "https://talentsforever.com/rogue/60/00530310501-32030320201515231--CD1FDGISRUWZXbc4defg2hgcK-8?b=70425h&d=261026";
const REFERENCE_ASSASSINATION = {
  "assassination.malice": 5,
  "assassination.ruthlessness": 3,
  "assassination.improved-slice-and-dice": 3,
  "assassination.relentless-strikes": 1,
  "assassination.lethality": 5,
  "assassination.cold-blood": 1,
};
const REFERENCE_COMBAT = {
  "combat.improved-eviscerate": 3,
  "combat.improved-sinister-strike": 2,
  "combat.puncturing-wounds": 3,
  "combat.precision": 3,
  "combat.endurance": 2,
  "combat.improved-sprint": 2,
  "combat.flawless-execution": 1,
  "combat.dual-wield-specialization": 5,
  "combat.blade-flurry": 1,
  "combat.hack-and-slash": 5,
  "combat.weapon-expertise": 2,
  "combat.aggression": 3,
  "combat.adrenaline-rush": 1,
};
const POINTS_AT_LEVEL_60 = 51;

// The three lists of a build that Rogue takes as options.
function onlyLists({ modifiers, procs, abilities }) {
  return { modifiers, procs, abilities };
}

function sum(ranks) {
  return Object.values(ranks).reduce((total, rank) => total + rank, 0);
}

function inTree(ranks, tree) {
  return Object.fromEntries(
    Object.entries(ranks).filter(([id]) => id.startsWith(`${tree}.`)),
  );
}

function nonZero(ranks) {
  return Object.fromEntries(Object.entries(ranks).filter(([, rank]) => rank));
}

// A fight with a count of the draws it makes from the generator.
function counted(seed, config, options) {
  const fight = createFight(seed, config, options);
  let count = 0;
  const rng = fight.simulation.rng;
  fight.simulation.rng = () => {
    count += 1;
    return rng();
  };
  fight.simulation.run(FIGHT_SECONDS);
  return {
    fight,
    get count() {
      return count;
    },
    damage: fight.simulation.damageDone,
    log: fight.simulation.combatLog.map((event) => ({ ...event })),
  };
}

// The six Assassination talents of the reference build (D8a, #119) are all
// mapped; the talents it does not spend points on have no entry.
const ASSASSINATION_MAPPED = [
  "assassination.malice",
  "assassination.ruthlessness",
  "assassination.improved-slice-and-dice",
  "assassination.relentless-strikes",
  "assassination.lethality",
  "assassination.cold-blood",
];
const MAPPED = talentCatalogue.talents.filter(
  (talent) => TALENT_EFFECTS[talent.id] !== undefined,
);

describe("the talent effects data covers the Combat tree and six Assassination talents", () => {
  it("has an entry for each of the 17 Combat talents and six Assassination ones, in catalogue order, and no others", () => {
    assert.equal(COMBAT.length, 17);
    assert.deepEqual(Object.keys(TALENT_EFFECTS), [
      ...ASSASSINATION_MAPPED,
      ...COMBAT.map((talent) => talent.id),
    ]);
    for (const id of ASSASSINATION_MAPPED) {
      assert.ok(
        ASSASSINATION.some((talent) => talent.id === id),
        id,
      );
    }
  });

  it("is checked against the catalogue and found well formed", () => {
    assert.doesNotThrow(() => checkTalentEffects());
  });

  it("says which text each entry was written from, and the snapshot still has that text", () => {
    assert.equal(MAPPED.length, 23);
    for (const talent of MAPPED) {
      const hash = createHash("sha256")
        .update(talent.ranks.join("\n"))
        .digest("hex");
      assert.equal(
        TALENT_EFFECTS[talent.id].textHash,
        hash,
        `${talent.id}: the snapshot's rank text changed, so re-read the entry against it and set textHash to ${hash}`,
      );
    }
  });

  it("is frozen all the way down, so a host cannot change a talent", () => {
    const entry = TALENT_EFFECTS["combat.puncturing-wounds"];
    assert.ok(Object.isFrozen(TALENT_EFFECTS));
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.modifiers[0].values));
    assert.ok(Object.isFrozen(entry.procs[0].chance.values));
    assert.throws(() => entry.modifiers[0].values.push(1), TypeError);
  });

  it("is the same list of procs the proc code reads", () => {
    const ids = Object.keys(PROC_TABLES);
    assert.deepEqual(
      ids,
      talentCatalogue.talents
        .filter((talent) => TALENT_EFFECTS[talent.id]?.procs !== undefined)
        .map((talent) => talent.id),
    );
    for (const id of ids) {
      assert.equal(PROC_TABLES[id], TALENT_EFFECTS[id].procs);
    }
  });

  it("says why each of the six talents with no DPS effect has none", () => {
    const none = COMBAT.filter(
      (talent) => TALENT_EFFECTS[talent.id].noDpsEffect !== undefined,
    ).map((talent) => talent.id);
    assert.deepEqual(none, [
      "combat.lightning-reflexes",
      "combat.deflection",
      "combat.endurance",
      "combat.riposte",
      "combat.improved-sprint",
      "combat.improved-kick",
    ]);
    for (const id of none) {
      assert.match(TALENT_EFFECTS[id].noDpsEffect, /^[^\n]{10,}$/);
    }
  });
});

describe("the procs' chances match the snapshot's rank text", () => {
  const readings = {
    "combat.puncturing-wounds": /gives Backstab a (\d+)% chance/,
    "combat.hack-and-slash": /Axe\/Sword:[\s\S]*?have a (\d+)% chance/,
  };
  for (const [id, text] of Object.entries(readings)) {
    it(id, () => {
      const talent = talentCatalogue.get(id);
      const [spec] = TALENT_EFFECTS[id].procs;
      assert.equal(spec.chance.values.length, talent.max);
      talent.ranks.forEach((rank, index) => {
        const found = text.exec(rank);
        assert.ok(found, `${text} finds nothing in ${JSON.stringify(rank)}`);
        assert.equal(
          spec.chance.values[index],
          Number(found[1]) / 100,
          `${id} rank ${index + 1}`,
        );
      });
    });
  }

  it("scopes Hack and Slash to the weapons its text names", () => {
    const [spec] = TALENT_EFFECTS["combat.hack-and-slash"].procs;
    assert.match(
      talentCatalogue.get("combat.hack-and-slash").ranks[0],
      /Axe\/Sword/,
    );
    assert.deepEqual([...spec.scope.weaponTypes].sort(), ["axe", "sword"]);
  });

  it("scopes Puncturing Wounds to Backstab, which its text names", () => {
    const [spec] = TALENT_EFFECTS["combat.puncturing-wounds"].procs;
    assert.deepEqual(spec.scope.abilities, ["backstab"]);
  });
});

describe("the 11 DPS-relevant Combat talents, and the 6 that are not", () => {
  it("splits the 17 into 11 with an effect and 6 without", () => {
    const withEffect = COMBAT.filter(
      (talent) => TALENT_EFFECTS[talent.id].noDpsEffect === undefined,
    ).map((talent) => talent.id);
    assert.equal(withEffect.length, 11);
    assert.deepEqual(withEffect, [
      "combat.improved-eviscerate",
      "combat.improved-sinister-strike",
      "combat.puncturing-wounds",
      "combat.precision",
      "combat.flawless-execution",
      "combat.dual-wield-specialization",
      "combat.blade-flurry",
      "combat.hack-and-slash",
      "combat.weapon-expertise",
      "combat.aggression",
      "combat.adrenaline-rush",
    ]);
  });
});

describe("expandTalents", () => {
  it("expands a modifier talent at its lowest and highest rank to the data's value", () => {
    for (const talent of COMBAT) {
      const { modifiers } = TALENT_EFFECTS[talent.id];
      for (const rank of [1, talent.max]) {
        const build = expandTalents({ [talent.id]: rank });
        assert.equal(build.modifiers.length, modifiers?.length ?? 0, talent.id);
        (modifiers ?? []).forEach((table, index) => {
          assert.deepEqual(build.modifiers[index], {
            kind: table.kind,
            op: table.op,
            value: table.values[rank - 1],
            scope: table.scope ?? null,
            source: talent.id,
          });
        });
      }
    }
  });

  it("gives a proc talent its chance for the rank, and nothing at rank 0", () => {
    for (const [id, [spec]] of [
      [
        "combat.puncturing-wounds",
        TALENT_EFFECTS["combat.puncturing-wounds"].procs,
      ],
      ["combat.hack-and-slash", TALENT_EFFECTS["combat.hack-and-slash"].procs],
    ]) {
      const { max } = talentCatalogue.get(id);
      assert.deepEqual(expandTalents({ [id]: 0 }).procs, []);
      for (const rank of [1, max]) {
        const { procs } = expandTalents({ [id]: rank });
        assert.equal(procs.length, 1);
        assert.equal(procs[0].id, spec.id);
        assert.equal(procs[0].chance.value, spec.chance.values[rank - 1]);
      }
    }
  });

  it("gives the same procs as procsFromTalents, without the nulls", () => {
    const ranks = { ...REFERENCE_COMBAT };
    assert.deepEqual(
      expandTalents(ranks).procs,
      procsFromTalents(ranks).filter((proc) => proc !== null),
    );
  });

  it("gives nothing for no ranks, for an empty map, and for every talent at rank 0", () => {
    const empty = {
      modifiers: [],
      procs: [],
      abilities: [],
      noDps: [],
      unmapped: [],
    };
    assert.deepEqual(expandTalents(), empty);
    assert.deepEqual(expandTalents({}), empty);
    const zeros = Object.fromEntries(
      talentCatalogue.talents.map((talent) => [talent.id, 0]),
    );
    assert.deepEqual(expandTalents(zeros), empty);
  });

  it("makes the same lists whatever order the map is in", () => {
    const entries = Object.entries(REFERENCE_COMBAT);
    const forward = expandTalents(Object.fromEntries(entries));
    const backward = expandTalents(Object.fromEntries(entries.reverse()));
    assert.deepEqual(backward, forward);
  });

  it("reports what a build spends points on that does nothing in the fight", () => {
    const build = expandTalents({
      "combat.endurance": 1,
      "combat.riposte": 1,
      "combat.blade-flurry": 1,
      "combat.adrenaline-rush": 0,
      "assassination.murder": 2,
      "subtlety.premeditation": 1,
      "combat.precision": 0,
    });
    assert.deepEqual(build.noDps, ["combat.endurance", "combat.riposte"]);
    assert.deepEqual(build.abilities, ["blade-flurry"]);
    assert.deepEqual(build.unmapped, [
      "assassination.murder",
      "subtlety.premeditation",
    ]);
    assert.deepEqual(build.modifiers, []);
  });

  it("freezes the result", () => {
    const build = expandTalents({ "combat.precision": 1 });
    assert.ok(Object.isFrozen(build));
    assert.ok(Object.isFrozen(build.modifiers));
    assert.throws(() => build.procs.push(1), TypeError);
  });

  it("refuses a map that is not an object, an unknown talent, and a rank that is not a rank of the talent", () => {
    for (const bad of [null, [], "combat.precision", 3, true]) {
      assert.throws(() => expandTalents(bad), RangeError, String(bad));
    }
    assert.throws(
      () => expandTalents({ "combat.nope": 1 }),
      /unknown talent id/,
    );
    for (const rank of [-1, 4, 1.5, NaN, "2", null, undefined]) {
      assert.throws(
        () => expandTalents({ "combat.precision": rank }),
        /ranks 0 to 3/,
        String(rank),
      );
    }
    // A talent with no table to check against has its rank checked too.
    assert.throws(() => expandTalents({ "combat.riposte": 2 }), /ranks 0 to 1/);
    assert.throws(
      () => expandTalents({ "combat.blade-flurry": 2 }),
      /ranks 0 to 1/,
    );
    assert.throws(
      () => expandTalents({ "assassination.malice": 6 }),
      /ranks 0 to 5/,
    );
  });

  it("applies in a pipeline the way the talents read", () => {
    const stats = new ModifierPipeline(
      expandTalents({
        "combat.precision": 2,
        "combat.aggression": 3,
        "combat.hack-and-slash": 4,
      }).modifiers,
    );
    assert.equal(stats.resolve("hitChance", 0, { ability: "backstab" }), 0.02);
    assert.equal(stats.resolve("damage", 100, { ability: "backstab" }), 106);
    assert.equal(stats.resolve("damage", 100, { ability: "rupture" }), 100);
    assert.equal(
      stats.resolve("critChance", 0, {
        ability: "backstab",
        weaponType: "fist",
      }),
      0.04,
    );
    assert.equal(
      stats.resolve("armorIgnore", 0, {
        ability: "backstab",
        weaponType: "mace",
      }),
      0.12,
    );
  });
});

describe("the data is checked when it loads, and the check refuses a bad entry", () => {
  const hash = "0".repeat(64);
  const entry = (extra) => ({ textHash: hash, ...extra });
  const modifier = (values) => ({ kind: "hitChance", op: "add", values });
  const proc = (id, values) => ({
    id,
    trigger: "onHit",
    chance: { mode: "flat", values },
    actions: [{ type: "extraAttack" }],
  });
  const refuses = (effects, pattern) =>
    assert.throws(() => checkTalentEffects(effects), pattern);

  it("accepts each shape of entry", () => {
    assert.doesNotThrow(() =>
      checkTalentEffects({
        "combat.precision": entry({ modifiers: [modifier([1, 2, 3])] }),
        "combat.riposte": entry({ noDpsEffect: "no parry to answer" }),
        "combat.blade-flurry": entry({ ability: "blade-flurry" }),
        "combat.hack-and-slash": entry({
          procs: [proc("a", [1, 2, 3, 4, 5])],
          modifiers: [modifier([1, 2, 3, 4, 5])],
        }),
      }),
    );
  });

  it("refuses data that is not an object", () => {
    for (const bad of [null, [], "x", 1]) {
      refuses(bad, /object keyed by talent id/);
    }
  });

  it("refuses a talent that is not in the catalogue", () => {
    refuses(
      { "combat.nope": entry({ ability: "blade-flurry" }) },
      /no such talent/,
    );
  });

  it("refuses an entry that is not an object or has an unknown key", () => {
    refuses({ "combat.precision": null }, /must be an object/);
    refuses({ "combat.precision": [] }, /must be an object/);
    refuses(
      {
        "combat.precision": entry({
          modifiers: [modifier([1, 2, 3])],
          extra: 1,
        }),
      },
      /unknown key "extra"/,
    );
  });

  it("refuses a missing or malformed text hash", () => {
    for (const textHash of [
      undefined,
      "",
      "abc",
      "G".repeat(64),
      "A".repeat(64),
      1,
    ]) {
      refuses(
        { "combat.precision": { textHash, modifiers: [modifier([1, 2, 3])] } },
        /textHash/,
      );
    }
  });

  it("refuses an entry that does nothing and says nothing", () => {
    refuses(
      { "combat.precision": entry({}) },
      /needs modifiers, procs, an ability or noDpsEffect/,
    );
  });

  it("refuses noDpsEffect that is empty, not text, or not alone", () => {
    refuses(
      { "combat.riposte": entry({ noDpsEffect: "" }) },
      /one-line reason/,
    );
    refuses({ "combat.riposte": entry({ noDpsEffect: 1 }) }, /one-line reason/);
    refuses(
      { "combat.riposte": entry({ noDpsEffect: "x", ability: "riposte" }) },
      /stands alone/,
    );
  });

  it("refuses a rank table with the wrong number of values", () => {
    for (const values of [[], [1, 2], [1, 2, 3, 4], undefined]) {
      refuses(
        { "combat.precision": entry({ modifiers: [modifier(values)] }) },
        /one value for each of the 3 ranks/,
      );
    }
    for (const values of [[], [1], undefined]) {
      refuses(
        { "combat.hack-and-slash": entry({ procs: [proc("a", values)] }) },
        /one chance for each of the 5 ranks/,
      );
    }
  });

  it("refuses a proc id used twice, and an ability that does not exist", () => {
    refuses(
      {
        "combat.hack-and-slash": entry({ procs: [proc("a", [1, 2, 3, 4, 5])] }),
        "combat.puncturing-wounds": entry({ procs: [proc("a", [1, 2, 3])] }),
      },
      /used twice/,
    );
    refuses(
      { "combat.blade-flurry": entry({ ability: "no-such-ability" }) },
      /not in the ability catalogue/,
    );
  });

  it("refuses, when expanded, a table the pipeline refuses, even at rank 0", () => {
    const effects = {
      "combat.precision": entry({
        modifiers: [{ kind: "nope", op: "add", values: [1, 2, 3] }],
      }),
    };
    assert.throws(() => expandTalents({}, effects), RangeError);
  });
});

describe("the reference build (Assassination 18 / Combat 33 / Subtlety 0), decoded from its link", () => {
  const decoded = decodeBuildLink(REFERENCE_LINK);

  it("decodes to the ranks the issue lists, and no others", () => {
    assert.equal(decoded.className, "rogue");
    assert.equal(decoded.level, 60);
    assert.deepEqual(nonZero(decoded.ranks), {
      ...REFERENCE_ASSASSINATION,
      ...REFERENCE_COMBAT,
    });
    assert.equal(sum(decoded.ranks), POINTS_AT_LEVEL_60);
    assert.equal(sum(inTree(decoded.ranks, "assassination")), 18);
    assert.equal(sum(inTree(decoded.ranks, "combat")), 33);
    assert.equal(sum(inTree(decoded.ranks, "subtlety")), 0);
  });

  it("is a full map: every talent, with a rank no higher than its maximum", () => {
    assert.deepEqual(
      Object.keys(decoded.ranks).sort(),
      talentCatalogue.talents.map((talent) => talent.id).sort(),
    );
    for (const talent of talentCatalogue.talents) {
      assert.ok(decoded.ranks[talent.id] <= talent.max, talent.id);
    }
  });

  it("is refused when a segment is not digits, is too long or spends more than a talent holds", () => {
    const link = (path) => `https://talentsforever.com/rogue/60/${path}`;
    assert.throws(() => decodeBuildLink(link("0x0--")), /not digits/);
    assert.throws(
      () => decodeBuildLink(link("-" + "1".repeat(18) + "-")),
      /has 17 talents/,
    );
    assert.throws(() => decodeBuildLink(link("9--")), /ranks 0 to 3/);
    assert.deepEqual(nonZero(decodeBuildLink(link("--")).ranks), {});
  });

  it("expands to the Combat talents' and six Assassination talents' modifiers, procs and abilities, and reports nothing unmapped", () => {
    const build = expandTalents(decoded.ranks);
    // Three Assassination modifier talents (D8a PR 1), then nine Combat ones,
    // three of them with two tables (Puncturing Wounds, Hack and Slash, Weapon
    // Expertise). Ruthlessness, Relentless Strikes and Cold Blood (D8a PR 2)
    // are procs and an ability, so they add no modifier.
    assert.deepEqual(
      [...new Set(build.modifiers.map((m) => m.source))],
      [
        "assassination.malice",
        "assassination.improved-slice-and-dice",
        "assassination.lethality",
        "combat.improved-eviscerate",
        "combat.improved-sinister-strike",
        "combat.puncturing-wounds",
        "combat.precision",
        "combat.flawless-execution",
        "combat.dual-wield-specialization",
        "combat.hack-and-slash",
        "combat.weapon-expertise",
        "combat.aggression",
      ],
    );
    assert.equal(build.modifiers.length, 15);
    assert.deepEqual(
      build.modifiers
        .slice(0, 3)
        .map(({ kind, op, value }) => [kind, op, value]),
      [
        ["critChance", "add", 0.05],
        ["duration", "add", 0.45],
        ["critDamage", "add", 0.2],
      ],
    );
    assert.deepEqual(
      build.procs.map((proc) => proc.id),
      [
        "ruthlessness",
        "relentless-strikes",
        "puncturing-wounds",
        "hack-and-slash",
      ],
    );
    assert.deepEqual(build.abilities, [
      "cold-blood",
      "blade-flurry",
      "adrenaline-rush",
    ]);
    assert.deepEqual(build.noDps, [
      "combat.endurance",
      "combat.improved-sprint",
    ]);
    assert.deepEqual(build.unmapped, []);
    assert.deepEqual(
      Object.keys(REFERENCE_ASSASSINATION).sort(),
      [...ASSASSINATION_MAPPED].sort(),
    );
  });
});

describe("a talented fight through createFight", () => {
  const build = expandTalents(decodeBuildLink(REFERENCE_LINK).ranks);
  const options = onlyLists(build);
  const swords = {
    weapons: { mainHand: { type: "sword" }, offHand: { type: "sword" } },
  };

  it("deals more than the same fight without the talents, and is the same fight again", () => {
    const plain = counted(SEED, undefined, undefined);
    const talented = counted(SEED, undefined, options);
    assert.ok(talented.damage > plain.damage);
    assert.deepEqual(counted(SEED, undefined, options).log, talented.log);
  });

  it("rolls Hack and Slash on a sword's hit and not on a dagger's", () => {
    const sword = counted(SEED, swords, options).fight.simulation.procs.stats;
    assert.ok(sword["hack-and-slash"].rolls > 0);
    const dagger = counted(
      SEED,
      {
        weapons: { mainHand: { type: "dagger" }, offHand: { type: "dagger" } },
      },
      options,
    ).fight.simulation.procs.stats;
    assert.equal(dagger["hack-and-slash"].rolls, 0);
  });

  it("rolls Puncturing Wounds on a Backstab, which the rotation never casts", () => {
    const config = { weapons: { mainHand: { type: "dagger" } } };
    const run = counted(SEED, config, options);
    assert.equal(
      run.fight.simulation.procs.stats["puncturing-wounds"].rolls,
      0,
    );
    const { rogue, simulation } = createFight(SEED, config, options);
    rogue.abilities.backstab.cast(rogue, simulation);
    assert.equal(simulation.procs.stats["puncturing-wounds"].rolls, 1);
  });

  it("changes nothing for a build with every talent at rank 0, and draws nothing extra", () => {
    const zeros = expandTalents(
      Object.fromEntries(
        talentCatalogue.talents.map((talent) => [talent.id, 0]),
      ),
    );
    const plain = counted(SEED, swords, undefined);
    const empty = counted(SEED, swords, {
      modifiers: zeros.modifiers,
      procs: zeros.procs,
    });
    assert.equal(empty.count, plain.count);
    assert.deepEqual(empty.log, plain.log);
    assert.equal(empty.damage, plain.damage);
  });

  it("draws no random number for a proc talent at rank 0", () => {
    // Hack and Slash at 0 beside Precision at 3: only the numbers change, and
    // the proc that is not listed is never rolled.
    const run = counted(
      SEED,
      swords,
      onlyLists(
        expandTalents({
          "combat.hack-and-slash": 0,
          "combat.puncturing-wounds": 0,
          "combat.precision": 3,
        }),
      ),
    );
    assert.deepEqual(Object.keys(run.fight.simulation.procs.stats), []);
  });
});
