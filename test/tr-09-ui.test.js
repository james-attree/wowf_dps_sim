// TR-09 / #339: the builder offers the rework's actions and the auras and
// debuffs TR-08 already accepts, the start screen is the temporary Combat
// swords preset plus Custom, and breakdown names are the engine's names.
// A pending talent effect is covered in test/talent-tree.test.js.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { FightBreakdown } from "../js/ability-breakdown.js";
import { abilityCatalogue } from "../js/abilities.js";
import { pageDefaultConfig } from "../js/config-form.js";
import { runOnCore } from "../js/core/fight.js";
import { createFight, runFight } from "../js/fight.js";
import { LINK_BASES } from "../js/link-codec.js";
import { conditionFields } from "../js/rotation-builder.js";
import { abilityGroups } from "../js/rotation-builder-copy.js";
import { CONDITION_TYPES } from "../js/rotation-conditions.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { startCards } from "../js/start-preset.js";
import { expandTalents } from "../js/talent-build.js";

const optionText = (groups) =>
  groups.flatMap((group) => group.options.map((option) => option.text));

const fieldOptions = (condition, param) =>
  conditionFields(condition, {}).find((field) => field.param === param).options;

describe("TR-09 builder pickers and start cards (#339)", () => {
  it("offers Shank and Death Mark, and the rework's buffs and debuff", () => {
    const actions = optionText(abilityGroups(castableAbilities()));
    assert.ok(actions.includes("Shank"));
    assert.ok(actions.includes("Death Mark (talent)"));
    const buffs = fieldOptions(
      { type: "auraActive", uid: "c", aura: "slice-and-dice" },
      "aura",
    ).map((option) => option.text);
    for (const name of ["Venom", "Poised", "Ambush window"]) {
      assert.ok(buffs.includes(name), name);
    }
    const debuffs = fieldOptions(
      { type: "debuffActive", uid: "c", debuff: "rupture" },
      "debuff",
    ).map((option) => option.text);
    assert.ok(debuffs.includes("Death Mark"));
    assert.equal(CONDITION_TYPES.includes("deathMarkStored"), false);
  });

  it("shows only temporary Combat swords and Custom", () => {
    assert.deepEqual(
      startCards().map((card) => card.id),
      ["combat-swords-temp", "custom"],
    );
  });

  it("does not change the short-link bases", () => {
    assert.deepEqual(
      LINK_BASES.map((base) => base.id),
      [
        "defaults",
        "combat-swords",
        "assassination-daggers",
        "subtlety-daggers",
        "combat-daggers",
        "combat-swords-temp",
        "combat-swords-temp-337",
      ],
    );
  });
});

describe("TR-09 breakdown labels (#339)", () => {
  it("names Shank and the Death Mark release as the catalogue does", () => {
    assert.equal(abilityCatalogue.get("shank").name, "Shank");
    assert.equal(abilityCatalogue.get("death-mark").name, "Death Mark");
    const named = runFight({
      seed: 3,
      duration: 12,
      config: pageDefaultConfig(),
    });
    assert.equal(Object.hasOwn(named.abilities, "Shank"), true);
    const build = expandTalents({ "subtlety.death-mark": 1 });
    const weapons = pageDefaultConfig().weapons;
    const h = createFight(
      1,
      {
        character: { attackPower: 2000, critChance: 0 },
        target: { armor: 0 },
        weapons,
        rotation: {
          schemaVersion: 1,
          name: "idle",
          rules: [
            {
              action: "sinister-strike",
              conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
            },
          ],
        },
      },
      {
        abilities: build.abilities,
        modifiers: build.modifiers,
        procs: build.procs,
      },
    );
    const breakdown = new FightBreakdown();
    breakdown.attach(h.simulation);
    h.simulation.rng = () => 0.99;
    h.rogue.comboPoints = 5;
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    h.rogue.abilities.deathMark.cast(h.rogue, h.simulation);
    h.rogue.energy = h.rogue.maxEnergy;
    h.simulation.gcd = 0;
    h.rogue.abilities.sinisterStrike.cast(h.rogue, h.simulation);
    runOnCore(h.simulation, k("deathMark").duration);
    const rows = breakdown.summary().rows.map((row) => row.name);
    assert.ok(rows.includes("Death Mark"));
    assert.ok(rows.includes("Sinister Strike"));
    assert.equal(rows.includes("Boot Knife"), false);
    assert.equal(rows.includes("Flash of Steel"), false);
  });
});
