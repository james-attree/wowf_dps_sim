import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFight } from "../js/fight.js";
import { ModifierPipeline, expandRank } from "../js/modifiers.js";
import { talentCatalogue } from "../js/talents.js";

// A2's done-when: modifiers from two trees combine. Combat talents are in
// test/combat-talents-as-data.test.js; these are Assassination and Subtlety
// talents written the same way, then put through one pipeline together with
// Combat's. Each number is checked against the snapshot's rank text.

const TABLES = {
  "assassination.malice": [
    {
      kind: "critChance",
      values: [0.01, 0.02, 0.03, 0.04, 0.05],
      text: /all attacks and Poisons by (\d+)%/,
    },
  ],
  "assassination.lethality": [
    {
      kind: "critDamage",
      values: [0.04, 0.08, 0.12, 0.16, 0.2],
      scope: {
        abilities: [
          "sinister-strike",
          "gouge",
          "backstab",
          "mutilate",
          "ghostly-strike",
          "hemorrhage",
        ],
      },
      text: /damage bonus of your [\s\S]*? by (\d+)%/,
    },
  ],
  "subtlety.opportunity": [
    {
      kind: "damage",
      values: [0.05, 0.1],
      scope: { abilities: ["backstab", "garrote", "ambush", "mutilate"] },
      text: /Mutilate abilities by (\d+)%/,
    },
  ],
  "subtlety.improved-ambush": [
    {
      kind: "critChance",
      values: [0.15, 0.3, 0.45],
      scope: { abilities: ["ambush"] },
      text: /Ambush ability by (\d+)%/,
    },
  ],
  "subtlety.serrated-blades": [
    {
      kind: "armorIgnore",
      values: [0.03, 0.06, 0.09],
      text: /ignore (\d+)% of your target's Armor/,
    },
    {
      kind: "damage",
      values: [0.1, 0.2, 0.3],
      scope: { abilities: ["rupture"] },
      text: /Rupture ability by (\d+)%/,
    },
  ],
  "combat.aggression": [
    {
      kind: "damage",
      values: [0.02, 0.04, 0.06],
      scope: { abilities: ["sinister-strike", "backstab", "eviscerate"] },
      text: /Eviscerate abilities by (\d+)%/,
    },
  ],
  "combat.precision": [
    {
      kind: "hitChance",
      values: [0.01, 0.02, 0.03],
      text: /chance to hit by (\d+)%/,
    },
  ],
};

function build(ids) {
  return ids.flatMap((id) =>
    expandRank(
      TABLES[id].map((entry) => {
        const rest = { ...entry, op: "add" };
        delete rest.text;
        return rest;
      }),
      talentCatalogue.get(id).max,
      id,
    ),
  );
}

describe("talents from Assassination, Subtlety and Combat in one pipeline", () => {
  it("match the snapshot's rank text", () => {
    for (const [id, entries] of Object.entries(TABLES)) {
      const talent = talentCatalogue.get(id);
      for (const entry of entries) {
        assert.equal(entry.values.length, talent.max, id);
        entry.values.forEach((value, index) => {
          const found = entry.text.exec(talent.ranks[index]);
          assert.ok(found, `${id} rank ${index + 1}`);
          assert.equal(
            value,
            Number(found[1]) / 100,
            `${id} rank ${index + 1}`,
          );
        });
      }
    }
  });

  it("add into one crit chance for an Ambush, from both trees", () => {
    const stats = new ModifierPipeline(
      build([
        "assassination.malice",
        "subtlety.improved-ambush",
        "combat.precision",
      ]),
    );
    const ambush = {
      ability: "ambush",
      hand: "mainHand",
      weaponType: "dagger",
    };
    assert.equal(stats.resolve("critChance", 0.1, ambush), 0.1 + (0.05 + 0.45));
    assert.deepEqual(
      stats.explain("critChance", ambush).map((row) => row.source),
      ["assassination.malice", "subtlety.improved-ambush"],
    );
    // Backstab gets Malice only.
    assert.equal(
      stats.resolve("critChance", 0.1, { ...ambush, ability: "backstab" }),
      0.1 + 0.05,
    );
  });

  it("scale one crit bonus and one damage factor from different trees", () => {
    const stats = new ModifierPipeline(
      build([
        "assassination.lethality",
        "subtlety.opportunity",
        "combat.aggression",
      ]),
    );
    const backstab = {
      ability: "backstab",
      hand: "mainHand",
      weaponType: "dagger",
    };
    assert.equal(stats.resolve("critDamage", 2, backstab), 1 + 1 * (1 + 0.2));
    assert.equal(
      stats.resolve("damage", 1000, backstab),
      1000 * (1 + (0.1 + 0.06)),
    );
    assert.equal(
      stats.resolve("damage", 1000, { ...backstab, ability: "ambush" }),
      1000 * (1 + 0.1),
    );
    assert.equal(
      stats.resolve("critDamage", 2, { ...backstab, ability: "ambush" }),
      2,
    );
  });

  it("change a fight, and change it the same way in any order", () => {
    const ids = Object.keys(TABLES);
    const run = (order) => {
      const fight = createFight(11, undefined, { modifiers: build(order) });
      fight.simulation.run(60);
      return fight.simulation.damageDone;
    };
    const none = createFight(11);
    none.simulation.run(60);
    const forward = run(ids);
    assert.ok(forward > none.simulation.damageDone);
    // Adds of the same kind commute exactly here; the kinds that multiply do
    // not appear twice, so the order of the list does not matter.
    assert.equal(run([...ids].reverse()), forward);
  });
});
