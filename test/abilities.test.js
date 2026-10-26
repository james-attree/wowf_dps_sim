import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CONSTANTS, k } from "../data/constants.js";
import {
  AbilityParseError,
  abilityCatalogue,
  buildAbilityCatalogue,
  parseSpell,
} from "../js/abilities.js";
import { snapshot } from "../js/snapshot.js";

const execFileAsync = promisify(execFile);

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

function failsWith(source, spell, rank, problem, read) {
  assert.throws(
    () => buildAbilityCatalogue(source, read),
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

describe("the catalogue for the vendored snapshot", () => {
  const { abilities } = abilityCatalogue;

  it("holds the Assassination, Combat and Subtlety abilities, highest rank each", () => {
    const tabs = [...new Set(abilities.map((ability) => ability.tab))];
    assert.deepEqual(tabs, k("abilities.tabs"));
    for (const tab of snapshot.spellbook.tabs) {
      if (!k("abilities.tabs").includes(tab.name)) {
        continue;
      }
      const names = [...new Set(tab.spells.map(([name]) => name))];
      assert.deepEqual(
        abilities.filter((a) => a.tab === tab.name).map((a) => a.name),
        names,
        tab.name,
      );
      for (const name of names) {
        const ranks = tab.spells
          .filter(([spell]) => spell === name)
          .map(([, label]) => Number(label.replace(/\D/g, "")) || 1);
        assert.equal(
          abilityCatalogue.byName(name).rank,
          Math.max(...ranks),
          name,
        );
      }
    }
  });

  it("leaves the poisons and the General list to later issues", () => {
    for (const name of ["Instant Poison", "Deadly Poison", "Attack", "Dodge"]) {
      assert.equal(abilityCatalogue.byName(name), undefined, name);
    }
  });

  it("carries the snapshot's spell id, school and text for every ability", () => {
    for (const ability of abilities) {
      const label = ability.passive
        ? "Passive"
        : snapshot.spellbook.tabs
            .find((tab) => tab.name === ability.tab)
            .spells.filter(([name]) => name === ability.name)
            .map(([, rank]) => rank)
            .find(
              (rank) => rank === "" || Number(rank.slice(5)) === ability.rank,
            );
      const entry = snapshot.spell_desc[`Rogue|${ability.name}|${label}`];
      assert.equal(ability.spellId, entry.id, ability.name);
      assert.equal(ability.school, entry.sc.toLowerCase(), ability.name);
      assert.equal(ability.text, entry.d, ability.name);
    }
  });

  it("has unique ids and finds an ability by id or by name", () => {
    assert.equal(new Set(abilities.map((a) => a.id)).size, abilities.length);
    assert.equal(
      abilityCatalogue.get("sinister-strike").name,
      "Sinister Strike",
    );
    assert.equal(
      abilityCatalogue.byName(" sinister STRIKE "),
      abilityCatalogue.get("sinister-strike"),
    );
    assert.equal(abilityCatalogue.get("nope"), undefined);
    assert.equal(abilityCatalogue.byName("nope"), undefined);
    assert.throws(() => abilityCatalogue.byName(1), TypeError);
  });

  it("is frozen all the way down", () => {
    assert.ok(Object.isFrozen(abilityCatalogue));
    assert.ok(Object.isFrozen(abilityCatalogue.abilities));
    const evisc = abilityCatalogue.get("eviscerate");
    assert.ok(Object.isFrozen(evisc));
    assert.ok(Object.isFrozen(evisc.perComboPoint[0].damage));
    assert.throws(() => {
      evisc.cost.amount = 1;
    }, TypeError);
  });
});

// The values below are written out by hand from the snapshot's spell_desc
// text for the highest rank. If the snapshot is refreshed and the text
// changes, these fail on purpose: the change should be read, not absorbed.
describe("parsed values match the snapshot text", () => {
  const blank = {
    passive: false,
    castTime: 0,
    cooldown: 0,
    flatDamage: null,
    weaponPercent: null,
    dot: null,
    perComboPoint: null,
    finisher: null,
    comboPointsAwarded: 0,
    scalesWithAttackPower: false,
    ap: null,
    bleed: false,
    startsGcd: true,
    requires: [],
  };

  it("Sinister Strike rank 8", () => {
    const { text, spellId, ...ability } =
      abilityCatalogue.get("sinister-strike");
    assert.equal(
      text,
      "An instant strike that causes 68 damage in addition to your normal weapon damage. Awards 1 combo point.",
    );
    assert.equal(spellId, 11294);
    assert.deepEqual(ability, {
      ...blank,
      id: "sinister-strike",
      name: "Sinister Strike",
      rank: 8,
      tab: "Combat",
      school: "physical",
      cost: { resource: "energy", amount: 45 },
      flatDamage: 68,
      weaponPercent: { base: 1, dagger: null },
      comboPointsAwarded: 1,
    });
  });

  it("Eviscerate rank 9", () => {
    const { text, spellId, ...ability } = abilityCatalogue.get("eviscerate");
    assert.match(text, /^Finishing move that causes damage per combo point/);
    assert.equal(spellId, 31016);
    const damage = [
      [224, 332],
      [394, 502],
      [564, 672],
      [734, 842],
      [904, 1012],
    ];
    assert.deepEqual(ability, {
      ...blank,
      id: "eviscerate",
      name: "Eviscerate",
      rank: 9,
      tab: "Assassination",
      school: "physical",
      cost: { resource: "energy", amount: 35 },
      finisher: { min: 1, max: 5 },
      scalesWithAttackPower: true,
      ap: { kind: "perCp", constant: "eviscerate.apPerCP", value: 0.03 },
      perComboPoint: damage.map(([min, max], index) => ({
        comboPoints: index + 1,
        damage: { min, max },
        duration: null,
        armorReduction: null,
      })),
    });
  });

  it("Rupture rank 6", () => {
    const { text, spellId, ...ability } = abilityCatalogue.get("rupture");
    assert.match(text, /^Finishing move that causes damage over time/);
    assert.equal(spellId, 11275);
    const rows = [
      [159, 8],
      [222, 10],
      [295, 12],
      [377, 14],
      [469, 16],
    ];
    assert.deepEqual(ability, {
      ...blank,
      id: "rupture",
      name: "Rupture",
      rank: 6,
      tab: "Assassination",
      school: "physical",
      cost: { resource: "energy", amount: 25 },
      finisher: { min: 1, max: 5 },
      scalesWithAttackPower: true,
      bleed: true,
      ap: {
        kind: "totalByCp",
        constant: "rupture.apByCP",
        value: [0.06, 0.12, 0.18, 0.24, 0.3],
      },
      perComboPoint: rows.map(([total, duration], index) => ({
        comboPoints: index + 1,
        damage: { min: total, max: total },
        duration,
        armorReduction: null,
      })),
    });
  });

  it("Slice and Dice rank 2", () => {
    const { text, spellId, ...ability } =
      abilityCatalogue.get("slice-and-dice");
    assert.match(
      text,
      /^Finishing move that increases melee attack speed by 30%/,
    );
    assert.equal(spellId, 6774);
    assert.deepEqual(ability, {
      ...blank,
      id: "slice-and-dice",
      name: "Slice and Dice",
      rank: 2,
      tab: "Assassination",
      school: "physical",
      cost: { resource: "energy", amount: 25 },
      finisher: { min: 1, max: 5 },
      perComboPoint: [9, 12, 15, 18, 21].map((duration, index) => ({
        comboPoints: index + 1,
        damage: null,
        duration,
        armorReduction: null,
      })),
    });
  });

  it("reads cooldowns in minutes and seconds, and dagger percents", () => {
    assert.equal(abilityCatalogue.get("adrenaline-rush").cooldown, 300);
    assert.equal(abilityCatalogue.get("blade-flurry").cooldown, 120);
    assert.equal(abilityCatalogue.get("kick").cooldown, 10);
    assert.deepEqual(abilityCatalogue.get("ghostly-strike").weaponPercent, {
      base: 1.25,
      dagger: 1.8,
    });
    assert.deepEqual(abilityCatalogue.get("hemorrhage").weaponPercent, {
      base: 1,
      dagger: 1.45,
    });
  });

  it("reads requirements, combo points awarded, passives and non-weapon damage", () => {
    assert.deepEqual(abilityCatalogue.get("ambush").requires, [
      "stealth",
      "daggers",
    ]);
    assert.deepEqual(abilityCatalogue.get("garrote").requires, ["stealth"]);
    assert.equal(abilityCatalogue.get("cheap-shot").comboPointsAwarded, 2);
    assert.equal(abilityCatalogue.get("premeditation").comboPointsAwarded, 2);
    assert.equal(abilityCatalogue.get("mutilate").flatDamage, 38);
    assert.deepEqual(abilityCatalogue.get("garrote").dot, {
      damage: 552,
      duration: 18,
    });
    assert.equal(abilityCatalogue.get("kick").flatDamage, 80);
    assert.equal(abilityCatalogue.get("gouge").flatDamage, 75);
    assert.equal(abilityCatalogue.get("safe-fall").passive, true);
    assert.equal(abilityCatalogue.get("safe-fall").startsGcd, false);
    assert.deepEqual(abilityCatalogue.get("expose-armor").perComboPoint[4], {
      comboPoints: 5,
      damage: null,
      duration: null,
      armorReduction: 2250,
    });
  });

  it("takes what the text omits from the constants", () => {
    assert.equal(abilityCatalogue.get("garrote").scalesWithAttackPower, true);
    assert.equal(abilityCatalogue.get("garrote").ap, null);
    assert.equal(abilityCatalogue.get("garrote").bleed, true);
    assert.equal(abilityCatalogue.get("premeditation").startsGcd, false);
    assert.equal(abilityCatalogue.get("sinister-strike").startsGcd, true);
  });
});

// The engine still runs on the hand-set constants until D2. Every number the
// catalogue parses must equal the constant the engine uses, or the switch in
// D2 would move a number.
describe("the catalogue agrees with the constants the engine reads", () => {
  const get = (id) => abilityCatalogue.get(id);

  it("costs and cooldowns", () => {
    const pairs = [
      ["sinister-strike", "sinisterStrike"],
      ["eviscerate", "eviscerate"],
      ["rupture", "rupture"],
      ["ghostly-strike", "ghostlyStrike"],
      ["backstab", "backstab"],
      ["ambush", "ambush"],
      ["hemorrhage", "hemorrhage"],
      ["slice-and-dice", "sliceAndDice"],
      ["blade-flurry", "bladeFlurry"],
      ["adrenaline-rush", "adrenalineRush"],
      ["premeditation", "premeditation"],
    ];
    for (const [id, constant] of pairs) {
      const ability = get(id);
      const values = k(constant);
      assert.equal(ability.cost?.amount ?? 0, values.energy, id);
      assert.equal(ability.cooldown, values.cooldown, id);
      if (values.comboPoints !== undefined) {
        assert.equal(ability.comboPointsAwarded, values.comboPoints, id);
      }
    }
  });

  it("weapon percents and flat damage", () => {
    assert.equal(
      get("sinister-strike").flatDamage,
      k("sinisterStrike").bonusDamage,
    );
    for (const [id, constant] of [
      ["backstab", "backstab"],
      ["ambush", "ambush"],
    ]) {
      assert.equal(
        get(id).weaponPercent.base,
        k(constant).weaponMultiplier,
        id,
      );
      assert.equal(get(id).flatDamage, k(constant).bonusDamage, id);
    }
    for (const [id, constant] of [
      ["ghostly-strike", "ghostlyStrike"],
      ["hemorrhage", "hemorrhage"],
    ]) {
      const percent = get(id).weaponPercent;
      const { dagger, other } = k(constant).weaponMultiplier;
      assert.equal(percent.dagger, dagger, id);
      assert.equal(percent.base, other, id);
    }
  });

  it("per-combo-point tables", () => {
    assert.deepEqual(
      get("eviscerate").perComboPoint.map((row) => row.damage),
      k("eviscerate").damageByCp,
    );
    const rupture = get("rupture").perComboPoint;
    assert.deepEqual(
      rupture.map((row) => row.damage.min),
      k("rupture").damageByCp,
    );
    assert.deepEqual(
      rupture.map((row) => row.damage.max),
      k("rupture").damageByCp,
    );
    assert.deepEqual(
      rupture.map((row) => row.duration),
      k("rupture").durationByCp,
    );
    assert.deepEqual(
      get("slice-and-dice").perComboPoint.map((row) => row.duration),
      k("sliceAndDice").durationByCp,
    );
    assert.equal(get("eviscerate").finisher.max, k("combo.max"));
    assert.equal(get("rupture").finisher.max, k("combo.max"));
  });

  it("the GCD flag and the bleed flag", () => {
    for (const id of [
      "sinister-strike",
      "eviscerate",
      "slice-and-dice",
      "blade-flurry",
      "adrenaline-rush",
    ]) {
      assert.equal(get(id).startsGcd, true, id);
    }
    assert.equal(get("premeditation").startsGcd, false);
    assert.deepEqual(
      abilityCatalogue.abilities
        .filter((a) => a.bleed)
        .map((a) => a.id)
        .sort(),
      [...k("bleed.spells")].sort(),
    );
  });
});

describe("the parser rejects text it does not understand", () => {
  const evis = "Rogue|Eviscerate|Rank 9";
  const strike = "Rogue|Sinister Strike|Rank 8";

  it("an unknown table row names the spell and rank", () => {
    const source = mutated((copy) => {
      const entry = entryOf(copy, evis);
      entry.d = entry.d.replace("564-672 damage", "564-672 dmg");
    });
    failsWith(
      source,
      "Eviscerate",
      9,
      /unrecognised table row "3 points: 564-672 dmg"/,
    );
  });

  it("the message quotes the offending text", () => {
    const source = mutated((copy) => {
      entryOf(copy, strike).l[0][0] = "45 Energy!";
    });
    failsWith(
      source,
      "Sinister Strike",
      8,
      /unrecognised cell "45 Energy!"\. Text: "An instant strike/,
    );
  });

  it("a missing table row", () => {
    const source = mutated((copy) => {
      const entry = entryOf(copy, evis);
      entry.d = entry.d.replace(/\n 5 points.*$/, "");
    });
    failsWith(
      source,
      "Eviscerate",
      9,
      /the table has 4 rows for 5 combo points/,
    );
  });

  it("a table row out of order", () => {
    const source = mutated((copy) => {
      const entry = entryOf(copy, evis);
      entry.d = entry.d.replace(" 2 points:", " 3 points:");
    });
    failsWith(source, "Eviscerate", 9, /table row 2 is for 3 combo points/);
  });

  it("a cost cell with a unit that is not a resource, such as 45 sec", () => {
    const source = mutated((copy) => {
      entryOf(copy, strike).l[0][0] = "45 sec";
    });
    failsWith(source, "Sinister Strike", 8, /unrecognised cell "45 sec"/);
  });

  it("a cost cell for a resource the constants do not list", () => {
    const source = mutated((copy) => {
      entryOf(copy, strike).l[0][0] = "45 Rage";
    });
    failsWith(source, "Sinister Strike", 8, /unrecognised cell "45 Rage"/);
  });

  it("a table row with min damage above max damage", () => {
    const source = mutated((copy) => {
      const entry = entryOf(copy, evis);
      entry.d = entry.d.replace("564-672 damage", "672-564 damage");
    });
    failsWith(
      source,
      "Eviscerate",
      9,
      /the table row "3 points: 672-564 damage" has min damage above max/,
    );
  });

  it("a damage-over-time sentence the parser does not read", () => {
    const source = mutated((copy) => {
      const entry = entryOf(copy, "Rogue|Garrote|Rank 6");
      entry.d = entry.d.replace(
        /causing (\d+) damage over/,
        "dealing $1 damage over",
      );
    });
    failsWith(
      source,
      "Garrote",
      6,
      /describes damage over time in a form the parser does not know/,
    );
  });

  it("a damage number the parser does not read", () => {
    const source = mutated((copy) => {
      entryOf(copy, "Rogue|Garrote|Rank 6").d += " Also deals 77 damage.";
    });
    failsWith(
      source,
      "Garrote",
      6,
      /a damage number the parser does not read: 77 damage/,
    );
  });

  it("two cooldown cells", () => {
    const source = mutated((copy) => {
      entryOf(copy, "Rogue|Kick|Rank 4").l.push(["5 sec cooldown", ""]);
    });
    failsWith(source, "Kick", 4, /two "cooldown" cells/);
  });

  it("an unknown requirement", () => {
    const source = mutated((copy) => {
      entryOf(copy, "Rogue|Kick|Rank 4").l.push(["Requires Fire", ""]);
    });
    failsWith(source, "Kick", 4, /unknown requirement "Requires Fire"/);
  });

  it("a finisher range that does not start at 1", () => {
    const source = mutated((copy) => {
      entryOf(copy, evis).l[1][0] = "2 to 5 Combo Points";
    });
    failsWith(source, "Eviscerate", 9, /2 to 5 does not start at 1/);
  });

  it("a finishing move with no combo point cell, and the reverse", () => {
    failsWith(
      mutated((copy) => {
        entryOf(copy, evis).l[1][0] = "";
      }),
      "Eviscerate",
      9,
      /finishing move but there is no combo point cell/,
    );
    failsWith(
      mutated((copy) => {
        entryOf(copy, strike).l.push(["1 to 5 Combo Points", ""]);
      }),
      "Sinister Strike",
      8,
      /combo point cell but the text is not a finishing move/,
    );
  });

  it("weapon damage in a form it does not know", () => {
    const source = mutated((copy) => {
      const entry = entryOf(copy, "Rogue|Backstab|Rank 9");
      entry.d = entry.d.replace("150% weapon damage", "1.5x weapon damage");
    });
    failsWith(source, "Backstab", 9, /mentions weapon damage in a form/);
  });

  it("a spell with no spell_desc entry, or an entry without its fields", () => {
    failsWith(
      mutated((copy) => {
        delete copy.spell_desc["Rogue|Rupture|Rank 6"];
      }),
      "Rupture",
      6,
      /spell_desc entry "Rogue\|Rupture\|Rank 6" lacks l, d, id or sc/,
    );
    failsWith(
      mutated((copy) => {
        delete entryOf(copy, evis).id;
      }),
      "Eviscerate",
      9,
      /lacks l, d, id or sc/,
    );
    failsWith(
      mutated((copy) => {
        entryOf(copy, evis).l[0] = "35 Energy";
      }),
      "Eviscerate",
      9,
      /a row of cells is not a list of strings/,
    );
  });

  it("a rank label it does not understand", () => {
    const source = mutated((copy) => {
      copy.spellbook.tabs[1].spells.push(["Sinister Strike", "Rank Nine"]);
    });
    failsWith(source, "Sinister Strike", null, /rank label "Rank Nine"/);
  });

  it("a missing tab, a bad spellbook entry and a bad snapshot", () => {
    failsWith(
      mutated((copy) => {
        copy.spellbook.tabs = copy.spellbook.tabs.filter(
          (t) => t.name !== "Combat",
        );
      }),
      "Combat",
      null,
      /no spellbook tab named "Combat"/,
    );
    failsWith(
      mutated((copy) => {
        copy.spellbook.tabs[0].spells.push("Kick");
      }),
      "Assassination",
      null,
      /not a \[name, rank label\] pair: "Kick"/,
    );
    failsWith({}, "the snapshot", null, /no spellbook\.tabs/);
    failsWith(null, "the snapshot", null, /no spellbook\.tabs/);
  });

  it("two abilities with one id", () => {
    const source = mutated((copy) => {
      copy.spellbook.tabs[1].spells.push(["Cheap Shot", ""]);
    });
    failsWith(
      source,
      "Cheap Shot",
      1,
      /two abilities have the id "cheap-shot"/,
    );
  });

  it("an AP coefficient for an ability whose text has no Attack Power", () => {
    const read = (id) =>
      id === "abilities.apCoefficients"
        ? {
            ...k(id),
            backstab: { kind: "perCp", constant: "eviscerate.apPerCP" },
          }
        : k(id);
    failsWith(
      snapshot,
      "Backstab",
      9,
      /does not say it scales with Attack Power/,
      read,
    );
  });

  it("parseSpell throws the same error for a bad entry on its own", () => {
    assert.throws(
      () =>
        parseSpell({
          name: "Test",
          rank: 2,
          label: "Rank 2",
          tab: "Combat",
          key: "Rogue|Test|Rank 2",
          entry: {
            l: [["10 sec cooldown", "huh"]],
            d: "",
            id: 1,
            sc: "Physical",
          },
        }),
      {
        name: "AbilityParseError",
        message: /^Cannot read Test rank 2 .*unrecognised cell "huh"/,
      },
    );
  });

  it("a refreshed snapshot with a higher rank uses it", () => {
    const source = mutated((copy) => {
      copy.spellbook.tabs[0].spells.push(["Eviscerate", "Rank 10"]);
      copy.spell_desc["Rogue|Eviscerate|Rank 10"] = {
        ...entryOf(copy, evis),
        id: 1,
        l: [
          ["40 Energy", "Melee Range"],
          ["1 to 5 Combo Points", ""],
          ["Instant", ""],
        ],
      };
    });
    const ability = buildAbilityCatalogue(source).get("eviscerate");
    assert.equal(ability.rank, 10);
    assert.equal(ability.cost.amount, 40);
  });
});

describe("constants added for the schema", () => {
  const ids = [
    "config.minWeaponSpeed",
    "abilities.tabs",
    "abilities.secondsPerMinute",
    "abilities.percentScale",
    "abilities.apCoefficients",
    "abilities.offGcd",
  ];

  it("each has a source tag and a ref", () => {
    for (const id of ids) {
      const entry = CONSTANTS[id];
      assert.ok(entry, id);
      assert.ok(
        [
          "wowf-export",
          "wowf-designer",
          "classic-1.12",
          "cataclysm",
          "assumption",
          "engineering",
        ].includes(entry.source),
        id,
      );
      assert.ok(entry.ref.length > 0, id);
    }
  });

  it("the AP coefficient map names real constants and real abilities", () => {
    for (const [id, { kind, constant }] of Object.entries(
      k("abilities.apCoefficients"),
    )) {
      assert.ok(abilityCatalogue.get(id), id);
      assert.ok(["perCp", "totalByCp"].includes(kind), id);
      assert.ok(CONSTANTS[constant], constant);
    }
    for (const id of k("abilities.offGcd")) {
      assert.ok(abilityCatalogue.get(id), id);
    }
  });
});

describe("load-time validation of js/abilities.js", () => {
  it("fails the import of the module itself when the snapshot is bad", async () => {
    // abilityCatalogue is built when the module loads. Copy the modules next
    // to a broken snapshot and import them in a fresh Node process.
    const dir = await mkdtemp(join(tmpdir(), "wowf-abilities-"));
    try {
      await mkdir(join(dir, "js"));
      await mkdir(join(dir, "data/talentsforever"), { recursive: true });
      await writeFile(join(dir, "package.json"), '{"type":"module"}');
      for (const file of ["abilities.js", "snapshot.js", "talents.js"]) {
        await copyFile(
          new URL(`../js/${file}`, import.meta.url),
          join(dir, "js", file),
        );
      }
      await copyFile(
        new URL("../data/constants.js", import.meta.url),
        join(dir, "data/constants.js"),
      );
      const importIt = () =>
        execFileAsync(process.execPath, [
          "--input-type=module",
          "-e",
          `import(${JSON.stringify(pathToFileURL(join(dir, "js/abilities.js")).href)})`,
        ]);

      await writeFile(
        join(dir, "data/talentsforever/rogue.json"),
        JSON.stringify(snapshot),
      );
      await importIt();

      const broken = structuredClone(snapshot);
      entryOf(broken, "Rogue|Rupture|Rank 6").d =
        "Finishing move.\n 1 point : lots";
      await writeFile(
        join(dir, "data/talentsforever/rogue.json"),
        JSON.stringify(broken),
      );
      await assert.rejects(importIt(), /Cannot read Rupture rank 6/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
