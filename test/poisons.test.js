import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { AbilityParseError } from "../js/abilities.js";
import {
  buildPoisonCatalogue,
  parsePoison,
  poisonCatalogue,
} from "../js/poisons.js";
import { snapshot } from "../js/snapshot.js";

// The poison definitions (D9, #104): chance, damage, duration, stacks and
// charges read from the snapshot text, per rank, and which poisons deal DPS.

const INSTANT = "Rogue|Instant Poison|Rank 6";
const DEADLY = "Rogue|Deadly Poison|Rank 5";
const WOUND = "Rogue|Wound Poison|Rank 4";
const CRIPPLING = "Rogue|Crippling Poison|Rank 2";
const MIND_NUMBING = "Rogue|Mind-numbing Poison|Rank 3";

function mutated(change) {
  const copy = structuredClone(snapshot);
  change(copy);
  return copy;
}

function entryOf(copy, key) {
  const entry = copy.spell_desc[key];
  assert.ok(entry, `${key} is in the snapshot`);
  return entry;
}

function withText(key, change) {
  return mutated((copy) => {
    const entry = entryOf(copy, key);
    entry.d = change(entry.d);
  });
}

// A constant reader with some constants replaced, so a test can break a
// constant without touching the shared table.
function reading(overrides) {
  return (id) => (Object.hasOwn(overrides, id) ? overrides[id] : k(id));
}

function failsWith(source, spell, rank, problem, read) {
  assert.throws(
    () => buildPoisonCatalogue(source, read),
    (error) => {
      assert.ok(error instanceof AbilityParseError, String(error));
      assert.equal(error.spell, spell);
      assert.equal(error.rank, rank);
      const where = rank === null ? spell : `${spell} rank ${rank}`;
      assert.ok(
        error.message.startsWith(`Cannot read ${where} from the spell data:`),
        error.message,
      );
      assert.match(error.message, problem);
      return true;
    },
  );
}

describe("Instant Poison rank 6 and Deadly Poison rank 5, against the snapshot", () => {
  it("reads Instant Poison rank 6: 20% for 76 to 100 Nature damage, 175 charges", () => {
    const rank = poisonCatalogue.rank("instant-poison", 6);
    assert.equal(
      snapshot.spell_desc[INSTANT].d,
      "Coats a weapon with poison that lasts for 30 minutes. Each strike has a 20% chance of poisoning the enemy which instantly inflicts 76 to 100 Nature damage. 175 charges.",
    );
    assert.equal(rank.rank, 6);
    assert.equal(rank.spellId, snapshot.spell_desc[INSTANT].id);
    assert.equal(rank.chance, 0.2);
    assert.equal(rank.charges, 175);
    assert.equal(rank.coatingDuration, 1800);
    assert.deepEqual(rank.effect, {
      kind: "damage",
      school: "nature",
      min: 76,
      max: 100,
    });
    assert.equal(rank.text, snapshot.spell_desc[INSTANT].d);
  });

  it("reads Deadly Poison rank 5: 30% for 92 Nature damage over 12 s, 5 stacks, 180 charges", () => {
    const rank = poisonCatalogue.rank("deadly-poison", 5);
    assert.equal(
      snapshot.spell_desc[DEADLY].d,
      "Coats a weapon with poison that lasts for 30 minutes. Each strike has a 30% chance of poisoning the enemy for 92 Nature damage over 12 sec. Stacks up to 5 times on a single target. 180 charges.",
    );
    assert.equal(rank.rank, 5);
    assert.equal(rank.spellId, snapshot.spell_desc[DEADLY].id);
    assert.equal(rank.chance, 0.3);
    assert.equal(rank.charges, 180);
    assert.deepEqual(rank.effect, {
      kind: "dot",
      school: "nature",
      damage: 92,
      duration: 12,
      maxStacks: 5,
    });
  });

  it("reads the other three top ranks", () => {
    const wound = poisonCatalogue.rank("wound-poison", 4);
    assert.equal(wound.chance, 0.3);
    assert.equal(wound.charges, 160);
    assert.deepEqual(wound.effect, {
      kind: "healingReduction",
      amount: 165,
      duration: 15,
      maxStacks: 5,
    });
    const crippling = poisonCatalogue.rank("crippling-poison", 2);
    assert.equal(crippling.chance, 0.3);
    assert.equal(crippling.charges, null, "the text gives no charges");
    assert.deepEqual(crippling.effect, {
      kind: "slow",
      fraction: 0.7,
      duration: 12,
    });
    const mind = poisonCatalogue.rank("mind-numbing-poison", 3);
    assert.equal(mind.chance, 0.2);
    assert.equal(mind.charges, 150);
    assert.deepEqual(mind.effect, {
      kind: "castSlow",
      fraction: 0.6,
      duration: 14,
    });
  });
});

describe("every rank of every poison", () => {
  it("lists the five poisons in spellbook order, with every rank", () => {
    assert.deepEqual(
      poisonCatalogue.poisons.map((p) => [p.id, p.ranks.length]),
      [
        ["crippling-poison", 2],
        ["instant-poison", 6],
        ["mind-numbing-poison", 3],
        ["deadly-poison", 5],
        ["wound-poison", 4],
      ],
    );
    for (const poison of poisonCatalogue.poisons) {
      assert.deepEqual(
        poison.ranks.map((rank) => rank.rank),
        poison.ranks.map((_, index) => index + 1),
        poison.id,
      );
      assert.equal(poison.top, poison.ranks.at(-1));
      assert.equal(poisonCatalogue.get(poison.id), poison);
      assert.equal(poisonCatalogue.byKey(poison.key), poison);
    }
  });

  it("matches the numbers in each rank's text, checked with a separate reader", () => {
    for (const poison of poisonCatalogue.poisons) {
      for (const rank of poison.ranks) {
        const text =
          snapshot.spell_desc[`Rogue|${poison.name}|Rank ${rank.rank}`].d;
        const found = (text.match(/\d+/g) ?? []).map(Number);
        const { effect } = rank;
        const numbers = [
          30,
          rank.chance * 100,
          ...(effect.kind === "damage" ? [effect.min, effect.max] : []),
          ...(effect.kind === "dot" ? [effect.damage] : []),
          ...(effect.kind === "healingReduction" ? [effect.amount] : []),
          ...(effect.fraction === undefined
            ? []
            : [Math.round(effect.fraction * 100)]),
          ...(effect.duration === undefined ? [] : [effect.duration]),
          ...(text.includes("Stacks up to") ? [effect.maxStacks] : []),
          ...(rank.charges === null ? [] : [rank.charges]),
        ];
        assert.deepEqual(
          found.sort((a, b) => a - b),
          numbers.sort((a, b) => a - b),
          `${poison.id} rank ${rank.rank}`,
        );
      }
    }
  });

  it("has rising damage and charges up the ranks of the damage poisons", () => {
    for (const poison of poisonCatalogue.dps) {
      const amounts = poison.ranks.map((rank) =>
        rank.effect.kind === "damage" ? rank.effect.max : rank.effect.damage,
      );
      assert.deepEqual(
        amounts,
        [...amounts].sort((a, b) => a - b),
        poison.id,
      );
      assert.ok(
        poison.ranks.every((rank) => rank.charges > 0),
        poison.id,
      );
    }
  });

  it("is deeply frozen", () => {
    assert.ok(Object.isFrozen(poisonCatalogue));
    assert.ok(Object.isFrozen(poisonCatalogue.poisons));
    const rank = poisonCatalogue.rank("deadly-poison", 5);
    assert.ok(Object.isFrozen(rank));
    assert.ok(Object.isFrozen(rank.effect));
    assert.ok(Object.isFrozen(poisonCatalogue.get("wound-poison")));
    assert.throws(() => {
      rank.chance = 1;
    }, TypeError);
  });

  it("answers an unknown id or rank with undefined", () => {
    assert.equal(poisonCatalogue.get("nope"), undefined);
    assert.equal(poisonCatalogue.byKey("nope"), undefined);
    assert.equal(poisonCatalogue.rank("instant-poison", 0), undefined);
    assert.equal(poisonCatalogue.rank("instant-poison", 7), undefined);
    assert.equal(poisonCatalogue.rank("nope", 1), undefined);
  });
});

describe("DPS poisons and explicit no-ops", () => {
  it("flags Instant and Deadly as the DPS poisons", () => {
    assert.deepEqual(
      poisonCatalogue.dps.map((p) => p.id),
      ["instant-poison", "deadly-poison"],
    );
    for (const poison of poisonCatalogue.dps) {
      assert.equal(poison.dps, true);
      assert.equal(poison.noDpsReason, null);
    }
  });

  it("lists Wound, Crippling and Mind-numbing as no-ops, each with a reason", () => {
    assert.deepEqual(
      poisonCatalogue.noOps.map((p) => p.id),
      ["crippling-poison", "mind-numbing-poison", "wound-poison"],
    );
    for (const poison of poisonCatalogue.noOps) {
      assert.equal(poison.dps, false);
      assert.match(
        poison.noDpsReason,
        /^no DPS effect in this sim: /,
        poison.id,
      );
      assert.equal(poison.noDpsReason, k("poison.noDpsReasons")[poison.id]);
    }
  });

  it("says a poison is a no-op only if it deals no damage", () => {
    for (const poison of poisonCatalogue.poisons) {
      const damages = poison.ranks.every((rank) =>
        ["damage", "dot"].includes(rank.effect.kind),
      );
      assert.equal(poison.dps, damages, poison.id);
    }
  });

  it("keeps the constants that name poisons in step with the catalogue", () => {
    assert.deepEqual(
      poisonCatalogue.poisons.map((p) => p.key).sort(),
      [...k("config.poisonIds")].sort(),
    );
    assert.deepEqual(
      poisonCatalogue.dps.map((p) => p.id),
      k("poison.spells"),
    );
    // A damage poison's school in the text is the school the armor skip reads.
    for (const poison of poisonCatalogue.dps) {
      assert.equal(poison.top.effect.school, "nature", poison.id);
      assert.ok(k("nature.spells").includes(poison.id), poison.id);
    }
    assert.deepEqual(
      Object.keys(k("poison.noDpsReasons")).sort(),
      poisonCatalogue.noOps.map((p) => p.id).sort(),
    );
  });

  it("agrees with the top-rank numbers kept in data/constants.js", () => {
    const instant = poisonCatalogue.get("instant-poison").top;
    assert.deepEqual(k("poison.instant"), {
      chance: instant.chance,
      min: instant.effect.min,
      max: instant.effect.max,
      charges: instant.charges,
    });
    const deadly = poisonCatalogue.get("deadly-poison").top;
    assert.deepEqual(k("poison.deadly"), {
      chance: deadly.chance,
      damage: deadly.effect.damage,
      duration: deadly.effect.duration,
      stacks: deadly.effect.maxStacks,
      charges: deadly.charges,
    });
  });

  it("keeps the parsed charges although the engine ignores them", () => {
    assert.equal(k("poison.charges"), "unlimited");
    assert.equal(poisonCatalogue.get("instant-poison").top.charges, 175);
    assert.equal(poisonCatalogue.get("deadly-poison").top.charges, 180);
  });

  it("skips the Blinding Powder reagent in the poison tab and nothing else", () => {
    const tab = snapshot.spellbook.tabs.find((t) => t.name === k("poison.tab"));
    assert.ok(
      tab.spells.some(([name]) =>
        k("poison.tabSkip").includes(name.toLowerCase().replaceAll(" ", "-")),
      ),
    );
    assert.ok(poisonCatalogue.poisons.every((p) => /Poison$/.test(p.name)));
    failsWith(
      snapshot,
      "Blinding Powder",
      null,
      /rank label/,
      reading({ "poison.tabSkip": [] }),
    );
  });
});

describe("malformed text", () => {
  const cases = [
    [
      "a missing coating sentence",
      INSTANT,
      (t) =>
        t.replace("Coats a weapon with poison that lasts for 30 minutes. ", ""),
      /does not start with the coating sentence/,
    ],
    [
      "a reworded coating sentence",
      INSTANT,
      (t) => t.replace("Coats a weapon", "Applies poison to a weapon"),
      /does not start with the coating sentence/,
    ],
    [
      "a missing chance",
      DEADLY,
      (t) => t.replace("a 30% chance", "a chance"),
      /does not start with the coating sentence/,
    ],
    [
      "a chance of 0%",
      INSTANT,
      (t) => t.replace("a 20% chance", "a 0% chance"),
      /chance 0% is not above 0/,
    ],
    [
      "a chance over 100%",
      INSTANT,
      (t) => t.replace("a 20% chance", "a 101% chance"),
      /chance 101% is not above 0/,
    ],
    [
      "an unknown effect sentence",
      INSTANT,
      (t) => t.replace("which instantly inflicts", "which sometimes deals"),
      /effect sentence is not one the parser knows/,
    ],
    [
      "a damage range with min above max",
      INSTANT,
      (t) => t.replace("76 to 100", "100 to 76"),
      /min above max/,
    ],
    [
      "a damage range with no minimum",
      INSTANT,
      (t) => t.replace("76 to 100", "to 100"),
      /effect sentence is not one the parser knows/,
    ],
    [
      "a damage over time with no duration",
      DEADLY,
      (t) => t.replace(" over 12 sec", ""),
      /effect sentence is not one the parser knows/,
    ],
    [
      "a zero duration",
      DEADLY,
      (t) => t.replace("over 12 sec", "over 0 sec"),
      /duration must be above 0/,
    ],
    [
      "zero damage",
      DEADLY,
      (t) => t.replace("for 92 Nature", "for 0 Nature"),
      /damage over time must be above 0/,
    ],
    [
      "a damage school the entry does not have",
      DEADLY,
      (t) => t.replace("92 Nature", "92 Fire"),
      /says fire damage but the entry's school is "Nature"/,
    ],
    [
      "stacking on a poison that does not stack",
      INSTANT,
      (t) =>
        t.replace(
          " 175 charges.",
          " Stacks up to 5 times on a single target. 175 charges.",
        ),
      /does not stack/,
    ],
    [
      "a stack count of 0",
      DEADLY,
      (t) => t.replace("up to 5 times", "up to 0 times"),
      /stack count 0 is not a whole number of at least 1/,
    ],
    [
      "a fractional stack count",
      DEADLY,
      (t) => t.replace("up to 5 times", "up to 2.5 times"),
      /stack count 2.5 is not a whole number/,
    ],
    [
      "a charge count of 0",
      INSTANT,
      (t) => t.replace("175 charges", "0 charges"),
      /charge count 0 is not a whole number of at least 1/,
    ],
    [
      "a fractional charge count",
      INSTANT,
      (t) => t.replace("175 charges", "17.5 charges"),
      /charge count 17.5 is not a whole number/,
    ],
    [
      "a reworded charge sentence",
      INSTANT,
      (t) => t.replace("175 charges.", "Lasts 175 hits."),
      /text the parser does not read: " Lasts 175 hits\."/,
    ],
    [
      "an extra sentence at the end",
      DEADLY,
      (t) => `${t} Also slows the target.`,
      /text the parser does not read: " Also slows the target\."/,
    ],
    [
      "an extra sentence before the charges",
      DEADLY,
      (t) => t.replace(" 180 charges.", " Cannot be dodged. 180 charges."),
      /text the parser does not read/,
    ],
    [
      "a slow with no percent sign",
      CRIPPLING,
      (t) => t.replace("by 70% for", "by 70 for"),
      /effect sentence is not one the parser knows/,
    ],
    [
      "a healing reduction of 0",
      WOUND,
      (t) => t.replace("by 165 for", "by 0 for"),
      /amount must be above 0/,
    ],
    [
      "a cast slow with a zero duration",
      MIND_NUMBING,
      (t) => t.replace("for 14 sec", "for 0 sec"),
      /duration must be above 0/,
    ],
    [
      "a coating that lasts 0 minutes",
      INSTANT,
      (t) => t.replace("30 minutes", "0 minutes"),
      /coating duration must be above 0/,
    ],
    [
      "a direct damage range that starts at 0",
      INSTANT,
      (t) => t.replace("76 to 100", "0 to 100"),
      /the damage must be above 0/,
    ],
    [
      "a slow of 0%",
      CRIPPLING,
      (t) => t.replace("by 70% for", "by 0% for"),
      /fraction must be above 0/,
    ],
    [
      "a stack count of 0",
      DEADLY,
      (t) => t.replace("up to 5 times", "up to 0 times"),
      /stack count 0 is not a whole number of at least 1/,
    ],
    [
      "a charge count of 0",
      DEADLY,
      (t) => t.replace("180 charges", "0 charges"),
      /charge count 0 is not a whole number of at least 1/,
    ],
    [
      "an empty text",
      WOUND,
      () => "",
      /does not start with the coating sentence/,
    ],
  ];

  for (const [label, key, change, problem] of cases) {
    it(`rejects ${label}, naming the poison and rank`, () => {
      const [, name, rankLabel] = key.split("|");
      failsWith(
        withText(key, change),
        name,
        Number(rankLabel.replace(/\D/g, "")),
        problem,
      );
    });
  }

  it("rejects an entry that is not { l, d, id }", () => {
    for (const change of [
      (e) => delete e.d,
      (e) => delete e.l,
      (e) => delete e.id,
      (e) => {
        e.id = "11343";
      },
      (e) => {
        e.d = 5;
      },
    ]) {
      failsWith(
        mutated((copy) => change(entryOf(copy, INSTANT))),
        "Instant Poison",
        6,
        /lacks l, d or id/,
      );
    }
    failsWith(
      mutated((copy) => {
        delete copy.spell_desc[INSTANT];
      }),
      "Instant Poison",
      6,
      /lacks l, d or id/,
    );
  });

  it("rejects a cell it does not know, or a row that is not strings", () => {
    failsWith(
      mutated((copy) => entryOf(copy, DEADLY).l.push(["Requires Stealth", ""])),
      "Deadly Poison",
      5,
      /unrecognised cell "Requires Stealth"/,
    );
    failsWith(
      mutated((copy) => entryOf(copy, DEADLY).l.push(["Instant", 5])),
      "Deadly Poison",
      5,
      /not a list of strings/,
    );
    failsWith(
      mutated((copy) => {
        entryOf(copy, DEADLY).l.push("Reagents: Deathweed");
      }),
      "Deadly Poison",
      5,
      /not a list of strings/,
    );
  });

  it("names the text in the error", () => {
    assert.throws(
      () =>
        buildPoisonCatalogue(
          withText(INSTANT, (t) => t.replace("20%", "twenty percent")),
        ),
      (error) => {
        assert.match(error.message, /Text: "Coats a weapon.*twenty percent/);
        return true;
      },
    );
  });

  it("reads a coating in seconds as seconds, and one in minutes in minutes", () => {
    const seconds = parsePoison({
      name: "Instant Poison",
      rank: 6,
      key: INSTANT,
      entry: {
        ...snapshot.spell_desc[INSTANT],
        d: snapshot.spell_desc[INSTANT].d.replace("30 minutes", "90 sec"),
      },
    });
    assert.equal(seconds.coatingDuration, 90);
    const minute = parsePoison({
      name: "Instant Poison",
      rank: 6,
      key: INSTANT,
      entry: {
        ...snapshot.spell_desc[INSTANT],
        d: snapshot.spell_desc[INSTANT].d.replace("30 minutes", "1 min"),
      },
    });
    assert.equal(minute.coatingDuration, 60);
  });
});

describe("values at the edge of what is accepted", () => {
  function parsed(key, change) {
    const [, name, rankLabel] = key.split("|");
    return parsePoison({
      name,
      rank: Number(rankLabel.replace(/\D/g, "")),
      key,
      entry: {
        ...snapshot.spell_desc[key],
        d: change(snapshot.spell_desc[key].d),
      },
    });
  }

  it("accepts a chance of exactly 100%", () => {
    assert.equal(
      parsed(INSTANT, (t) => t.replace("a 20% chance", "a 100% chance")).chance,
      1,
    );
  });

  it("accepts a direct damage range whose min equals its max", () => {
    const rank = parsed(INSTANT, (t) => t.replace("76 to 100", "80 to 80"));
    assert.equal(rank.effect.min, 80);
    assert.equal(rank.effect.max, 80);
  });

  it("accepts one stack and one charge", () => {
    const rank = parsed(DEADLY, (t) =>
      t
        .replace("up to 5 times", "up to 1 times")
        .replace("180 charges", "1 charges"),
    );
    assert.equal(rank.effect.maxStacks, 1);
    assert.equal(rank.charges, 1);
  });

  it("gives a stackable poison one stack when the text has no stacking sentence", () => {
    const rank = parsed(DEADLY, (t) =>
      t.replace(" Stacks up to 5 times on a single target.", ""),
    );
    assert.equal(rank.effect.maxStacks, 1);
    assert.equal(rank.charges, 180);
  });

  it("gives the poison's id as the slug of its name", () => {
    assert.equal(parsed(MIND_NUMBING, (t) => t).id, "mind-numbing-poison");
  });
});

describe("a snapshot or constants that do not fit", () => {
  it("sorts ranks that are listed out of order", () => {
    const catalogue = buildPoisonCatalogue(
      mutated((copy) => {
        const tab = copy.spellbook.tabs.find((t) => t.name === "Poisons");
        tab.spells = [...tab.spells].reverse();
      }),
    );
    for (const poison of catalogue.poisons) {
      assert.deepEqual(
        poison.ranks.map((rank) => rank.rank),
        poison.ranks.map((_, index) => index + 1),
        poison.id,
      );
      assert.equal(poison.top.rank, poison.ranks.length);
    }
  });

  it("lists the DPS poisons in the order of poison.spells", () => {
    const catalogue = buildPoisonCatalogue(
      snapshot,
      reading({ "poison.spells": ["deadly-poison", "instant-poison"] }),
    );
    assert.deepEqual(
      catalogue.dps.map((poison) => poison.id),
      ["deadly-poison", "instant-poison"],
    );
  });

  it("does not take a no-op reason from the object's prototype", () => {
    const source = mutated((copy) => {
      const tab = copy.spellbook.tabs.find((t) => t.name === "Poisons");
      tab.spells.push(["Constructor", "Rank 1"]);
      copy.spell_desc["Rogue|Constructor|Rank 1"] = structuredClone(
        copy.spell_desc[WOUND],
      );
    });
    failsWith(
      source,
      "Constructor",
      null,
      /neither poison\.spells nor poison\.noDpsReasons/,
    );
  });

  it("rejects a snapshot with no spellbook, spell_desc or class", () => {
    for (const source of [
      null,
      {},
      { ...snapshot, spellbook: undefined },
      { ...snapshot, spell_desc: undefined },
      { ...snapshot, class: undefined },
    ]) {
      failsWith(source, "the snapshot", null, /no spellbook\.tabs/);
    }
  });

  it("rejects a missing poison tab", () => {
    failsWith(
      mutated((copy) => {
        copy.spellbook.tabs = copy.spellbook.tabs.filter(
          (tab) => tab.name !== "Poisons",
        );
      }),
      "Poisons",
      null,
      /no spellbook tab named "Poisons"/,
    );
    failsWith(
      mutated((copy) => {
        delete copy.spellbook.tabs.find((tab) => tab.name === "Poisons").spells;
      }),
      "Poisons",
      null,
      /no spellbook tab named "Poisons"/,
    );
  });

  it("rejects a spellbook entry that is not a [name, rank] pair", () => {
    for (const pair of [["Instant Poison"], "Instant Poison", [1, "Rank 1"]]) {
      failsWith(
        mutated((copy) => {
          copy.spellbook.tabs
            .find((tab) => tab.name === "Poisons")
            .spells.push(pair);
        }),
        "Poisons",
        null,
        /not a \[name, rank label\] pair/,
      );
    }
  });

  it("rejects a rank label that is not Rank N", () => {
    for (const label of ["", "Passive", "Rank", "Rank two"]) {
      failsWith(
        mutated((copy) => {
          copy.spellbook.tabs
            .find((tab) => tab.name === "Poisons")
            .spells.push(["Instant Poison", label]);
        }),
        "Instant Poison",
        null,
        /rank label/,
      );
    }
  });

  it("rejects a rank listed twice", () => {
    failsWith(
      mutated((copy) => {
        copy.spellbook.tabs
          .find((tab) => tab.name === "Poisons")
          .spells.push(["Instant Poison", "Rank 3"]);
      }),
      "Instant Poison",
      3,
      /listed twice/,
    );
  });

  it("rejects ranks with a gap", () => {
    failsWith(
      mutated((copy) => {
        const tab = copy.spellbook.tabs.find((t) => t.name === "Poisons");
        tab.spells = tab.spells.filter(
          ([name, label]) => !(name === "Deadly Poison" && label === "Rank 3"),
        );
      }),
      "Deadly Poison",
      4,
      /gap \(expected rank 3\)/,
    );
  });

  it("rejects a poison with no spell_desc entry for a listed rank", () => {
    failsWith(
      mutated((copy) => {
        copy.spellbook.tabs
          .find((tab) => tab.name === "Poisons")
          .spells.push(["Instant Poison", "Rank 7"]);
      }),
      "Instant Poison",
      7,
      /lacks l, d or id/,
    );
  });

  it("rejects a poison that is neither a DPS poison nor a no-op", () => {
    failsWith(
      snapshot,
      "Deadly Poison",
      null,
      /neither poison\.spells nor poison\.noDpsReasons/,
      reading({ "poison.spells": ["instant-poison"] }),
    );
  });

  it("rejects a poison that is both a DPS poison and a no-op", () => {
    failsWith(
      snapshot,
      "Instant Poison",
      null,
      /in poison\.spells and in poison\.noDpsReasons/,
      reading({
        "poison.noDpsReasons": {
          ...k("poison.noDpsReasons"),
          "instant-poison": "no DPS effect in this sim: a mistake",
        },
      }),
    );
  });

  it("rejects a no-op reason that is not text", () => {
    for (const reason of ["", 5, true]) {
      failsWith(
        snapshot,
        "Wound Poison",
        null,
        /reason for wound-poison is not text/,
        reading({
          "poison.noDpsReasons": {
            ...k("poison.noDpsReasons"),
            "wound-poison": reason,
          },
        }),
      );
    }
  });

  it("rejects an id in poison.spells or poison.noDpsReasons that the tab lacks", () => {
    failsWith(
      snapshot,
      "Poisons",
      null,
      /ghost-poison is named in poison\.spells/,
      reading({ "poison.spells": [...k("poison.spells"), "ghost-poison"] }),
    );
    failsWith(
      snapshot,
      "Poisons",
      null,
      /ghost-poison is named in poison\.spells/,
      reading({
        "poison.noDpsReasons": {
          ...k("poison.noDpsReasons"),
          "ghost-poison": "no DPS effect in this sim: a ghost",
        },
      }),
    );
  });

  it("rejects poisons that are not config.poisonIds", () => {
    failsWith(
      snapshot,
      "Poisons",
      null,
      /are not config\.poisonIds/,
      reading({ "config.poisonIds": ["instant", "deadly"] }),
    );
    failsWith(
      snapshot,
      "Poisons",
      null,
      /are not config\.poisonIds/,
      reading({
        "config.poisonIds": [...k("config.poisonIds"), "numbing"],
      }),
    );
  });

  it("rejects a poison whose name makes the same id as another", () => {
    failsWith(
      mutated((copy) => {
        const tab = copy.spellbook.tabs.find((t) => t.name === "Poisons");
        tab.spells.push(["instant poison", "Rank 1"]);
      }),
      "instant poison",
      null,
      /two poisons have the id "instant-poison"/,
    );
  });

  it("reads from the tab named by poison.tab", () => {
    const catalogue = buildPoisonCatalogue(
      mutated((copy) => {
        copy.spellbook.tabs.find((t) => t.name === "Poisons").name = "Potions";
      }),
      reading({ "poison.tab": "Potions" }),
    );
    assert.equal(catalogue.poisons.length, 5);
  });
});
