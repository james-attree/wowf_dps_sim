import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CONSTANTS, k } from "../data/constants.js";
import { abilityCatalogue } from "../js/abilities.js";
import { createFight } from "../js/fight.js";
import { DAMAGE_TAGS, SCHOOLS, damageTags } from "../js/damage-tags.js";
import {
  MODIFIER_KINDS,
  ModifierPipeline,
  SCOPE_KEYS,
  defineModifier,
} from "../js/modifiers.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";

// Damage modifier hooks by tag (A3, #97). A damage event has an ability id, a
// school and tags (js/damage-tags.js), and a modifier scopes itself by any of
// them. These tests go through the engine's seams (a skill's cast, a weapon
// swing, resolveAttack, resolveDotAttack and the tick loop in step) and check
// the scope as well as the value: what a modifier must change and what it must
// leave alone.

const execFileAsync = promisify(execFile);
const TICKS = Math.floor(12 / k("rupture.tickInterval"));
const NEAR = 1e-9;
const HIT = 0.99;

function withConstant(id, value, run) {
  const row = CONSTANTS[id];
  const saved = row.value;
  row.value = value;
  try {
    return run();
  } finally {
    row.value = saved;
  }
}

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= NEAR * Math.max(1, Math.abs(expected)),
    `${message ?? "value"}: ${actual} is not ${expected}`,
  );
}

// A source whose display name is never its id.
function source(id, extra = {}) {
  return { id, name: `Display name of ${id}`, ...extra };
}

function build(modifiers, { crit = 0 } = {}) {
  const rogue = new Rogue(undefined, { modifiers });
  rogue.rotation = () => {};
  rogue.critChance = crit;
  rogue.bonusHitChance = 0;
  const sim = new Simulation(rogue, { rng: testRng });
  return { rogue, sim };
}

// Mirrors armor.mitigation, written out again so the tests do not call the
// engine's own function.
function throughArmor(armor = k("target.armor")) {
  const { constant, perLevel, cap } = k("armor.mitigation");
  const share = Math.min(
    cap,
    armor / (armor + constant + perLevel * k("character.level")),
  );
  return 1 - share;
}

const DAMAGE_UP = (value, scope) => ({ kind: "damage", value, scope });

describe("the tags of a damage event", () => {
  it("lists the catalogue's own fields, not names", () => {
    const rows = [
      ["rupture", "skill", true, "physical", ["bleed", "yellow", "finisher"]],
      ["garrote", "skill", false, "physical", ["bleed", "yellow"]],
      ["eviscerate", "skill", false, "physical", ["yellow", "finisher"]],
      ["slice-and-dice", "skill", false, "physical", ["yellow", "finisher"]],
      ["backstab", "skill", false, "physical", ["yellow"]],
      ["sinister-strike", "skill", false, "physical", ["yellow"]],
      ["main-hand", "weapon", false, "physical", ["white"]],
      ["off-hand", "weapon", false, "physical", ["white"]],
      ["instant-poison", "skill", false, "nature", ["poison"]],
      ["deadly-poison", "skill", false, "nature", ["poison"]],
      ["made-up-by-a-test", "skill", false, "physical", ["yellow"]],
    ];
    for (const [id, attackType, bleed, school, tags] of rows) {
      assert.deepEqual(
        damageTags({ id, attackType, bleed: bleed && id !== "rupture" }),
        { school, tags },
        id,
      );
    }
  });

  it("gives the finisher tag to exactly the catalogue's finishers", () => {
    const finishers = abilityCatalogue.abilities
      .filter((ability) => ability.finisher !== null)
      .map((ability) => ability.id);
    assert.ok(finishers.includes("eviscerate"));
    assert.ok(finishers.includes("rupture"));
    for (const ability of abilityCatalogue.abilities) {
      const { tags } = damageTags({ id: ability.id, attackType: "skill" });
      assert.equal(
        tags.includes("finisher"),
        finishers.includes(ability.id),
        ability.id,
      );
    }
  });

  it("takes the school from the catalogue and from nature.spells", () => {
    for (const ability of abilityCatalogue.abilities) {
      const { school } = damageTags({ id: ability.id, attackType: "skill" });
      assert.equal(school, ability.school, ability.id);
    }
    assert.ok(abilityCatalogue.abilities.some((a) => a.school === "nature"));
    assert.equal(
      withConstant("nature.spells", ["backstab"], () =>
        damageTags({ id: "backstab", attackType: "skill" }),
      ).school,
      "nature",
    );
    assert.equal(
      withConstant("nature.spells", [], () =>
        damageTags({ id: "deadly-poison", attackType: "skill" }),
      ).school,
      "physical",
    );
  });

  it("keeps every school the catalogue has in SCHOOLS, so a scope can name it", () => {
    for (const ability of abilityCatalogue.abilities) {
      assert.ok(SCHOOLS.includes(ability.school), ability.id);
    }
  });

  it("has exactly these schools and tags, frozen, in this order", () => {
    assert.deepEqual([...SCHOOLS], ["physical", "nature"]);
    assert.deepEqual(
      [...DAMAGE_TAGS],
      ["bleed", "poison", "white", "yellow", "finisher"],
    );
    assert.ok(Object.isFrozen(SCHOOLS));
    assert.ok(Object.isFrozen(DAMAGE_TAGS));
    assert.throws(() => DAMAGE_TAGS.push("fire"), TypeError);
    assert.throws(() => SCHOOLS.push("fire"), TypeError);
  });

  it("fails the import of js/damage-tags.js when the catalogue has a school it does not know", async () => {
    // The check runs when the module loads. Copy js/ and data/ next to a
    // snapshot that gives Rupture a school nobody listed, and import the copy
    // in a fresh Node process.
    const root = fileURLToPath(new URL("..", import.meta.url));
    const dir = await mkdtemp(join(tmpdir(), "wowf-schools-"));
    try {
      await writeFile(join(dir, "package.json"), '{"type":"module"}');
      await cp(join(root, "js"), join(dir, "js"), { recursive: true });
      await cp(join(root, "data"), join(dir, "data"), { recursive: true });
      const importIt = () =>
        execFileAsync(process.execPath, [
          "--input-type=module",
          "-e",
          `import(${JSON.stringify(pathToFileURL(join(dir, "js/damage-tags.js")).href)})`,
        ]);
      await importIt();

      const file = join(dir, "data/talentsforever/rogue.json");
      const broken = JSON.parse(await readFile(file, "utf8"));
      broken.spell_desc["Rogue|Rupture|Rank 6"].sc = "Fire";
      await writeFile(file, JSON.stringify(broken));
      await assert.rejects(importIt(), (error) => {
        assert.match(error.stderr, /RangeError/);
        assert.match(error.stderr, /school "fire"/);
        assert.match(error.stderr, /Known: physical, nature/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists every poison as a Nature spell, so the poison tag and the school agree", () => {
    for (const id of k("poison.spells")) {
      assert.ok(k("nature.spells").includes(id), id);
    }
    assert.deepEqual(k("poison.spells"), ["instant-poison", "deadly-poison"]);
  });

  it("reads the constants when it is asked, not when the module loads", () => {
    const poisonTags = (id) =>
      damageTags({ id, attackType: "skill" }).tags.join();
    assert.equal(poisonTags("backstab"), "yellow");
    assert.equal(
      withConstant("poison.spells", ["backstab"], () => poisonTags("backstab")),
      "poison",
    );
    assert.equal(
      withConstant("bleed.spells", ["backstab"], () => poisonTags("backstab")),
      "bleed,yellow",
    );
    assert.equal(poisonTags("backstab"), "yellow");
    assert.equal(
      withConstant("poison.spells", [], () => poisonTags("deadly-poison")),
      "yellow",
    );
  });

  it("marks a source that says it is a bleed, whatever its id", () => {
    assert.deepEqual(
      damageTags({ id: "made-up-by-a-test", attackType: "skill", bleed: true }),
      { school: "physical", tags: ["bleed", "yellow"] },
    );
    assert.deepEqual(
      damageTags({ id: "made-up-by-a-test", attackType: "skill" }).tags,
      ["yellow"],
    );
  });

  it("keeps the tags in DAMAGE_TAGS order", () => {
    const all = withConstant("poison.spells", ["rupture"], () =>
      damageTags({ id: "rupture", attackType: "skill" }),
    );
    assert.deepEqual(all.tags, ["bleed", "poison", "finisher"]);
    const order = all.tags.map((tag) => DAMAGE_TAGS.indexOf(tag));
    assert.deepEqual(order, [...order].sort());
  });

  it("throws a RangeError for an attack type it does not know", () => {
    for (const attackType of [
      "spell",
      "constructor",
      "toString",
      "Skill",
      "",
      undefined,
      null,
      1,
    ]) {
      assert.throws(
        () => damageTags({ id: "backstab", attackType }),
        (error) =>
          error instanceof RangeError &&
          /Unknown attack type/.test(error.message),
        String(attackType),
      );
    }
    // The throw comes before any tag is built, poison or not.
    assert.throws(
      () => damageTags({ id: "deadly-poison", attackType: "spell" }),
      RangeError,
    );
  });

  it("throws a RangeError for a missing or non-object event", () => {
    for (const event of [undefined, null, "rupture", 1, true]) {
      assert.throws(
        () => damageTags(event),
        (error) =>
          error instanceof RangeError && /needs an event/.test(error.message),
        String(event),
      );
    }
    assert.throws(() => damageTags(), RangeError);
  });

  it("returns a fresh list each time", () => {
    const first = damageTags({ id: "backstab", attackType: "skill" });
    first.tags.push("bleed");
    assert.deepEqual(damageTags({ id: "backstab", attackType: "skill" }).tags, [
      "yellow",
    ]);
  });
});

describe("the context an attack passes", () => {
  it("carries the school and tags with the ability, hand and weapon type", () => {
    const { rogue, sim } = build();
    assert.deepEqual(sim.attackContext(source("backstab"), "skill"), {
      ability: "backstab",
      hand: "mainHand",
      weaponType: rogue.weapons.mainHand.type,
      school: "physical",
      tags: ["yellow"],
    });
    const swing = sim.attackContext(rogue.weapons.offHand.attack, "weapon");
    assert.equal(swing.hand, "offHand");
    assert.equal(swing.weaponType, rogue.weapons.offHand.type);
    assert.deepEqual(swing.tags, ["white"]);
    assert.equal(swing.school, "physical");
  });

  it("treats a skill's own bleed flag as the bleed tag", () => {
    const { rogue, sim } = build();
    const rupture = rogue.abilities.rupture;
    assert.deepEqual(sim.attackContext(rupture, "skill").tags, [
      "bleed",
      "yellow",
      "finisher",
    ]);
    assert.deepEqual(
      sim.attackContext(rogue.abilities.hemorrhage, "skill").tags,
      ["yellow"],
    );
  });

  it("gives a DoT tick the context of the cast that applied it", () => {
    setRoll(HIT);
    const { sim } = build();
    sim.resolveDotAttack(source("made-up-by-a-test"), "skill", 1000, 12, true);
    const dot = sim.activeDots["made-up-by-a-test"];
    assert.equal(dot.bleed, true);
    assert.equal(dot.attackType, "skill");
    assert.deepEqual(sim.abilityContext("made-up-by-a-test", dot).tags, [
      "bleed",
      "yellow",
    ]);
    // With no application to read, a bare id is a yellow, non-bleed attack.
    assert.deepEqual(sim.abilityContext("made-up-by-a-test").tags, ["yellow"]);
  });
});

describe("abilityContext input", () => {
  it("takes no options, or an object, and throws a RangeError for anything else", () => {
    const { sim } = build();
    assert.deepEqual(sim.abilityContext("backstab").tags, ["yellow"]);
    assert.deepEqual(
      sim.abilityContext("main-hand", { attackType: "weapon" }).tags,
      ["white"],
    );
    for (const options of [null, "weapon", 1, true]) {
      assert.throws(
        () => sim.abilityContext("backstab", options),
        (error) =>
          error instanceof RangeError &&
          /options must be an object/.test(error.message),
        String(options),
      );
    }
    assert.throws(
      () => sim.abilityContext("backstab", { attackType: "spell" }),
      RangeError,
    );
  });
});

describe("scope.schools and scope.tags", () => {
  const damage = (scope) =>
    defineModifier({ kind: "damage", op: "add", value: 0.5, scope });

  it("are known scope keys, accepted by the kinds that scope an attack", () => {
    assert.deepEqual(SCOPE_KEYS.slice(-2), ["schools", "tags"]);
    for (const kind of [
      "critChance",
      "hitChance",
      "armorIgnore",
      "damage",
      "critDamage",
    ]) {
      assert.deepEqual(
        MODIFIER_KINDS[kind].scope.slice(-2),
        ["schools", "tags"],
        kind,
      );
    }
    assert.deepEqual(damage({ schools: ["nature"] }).scope.schools, ["nature"]);
    assert.deepEqual(damage({ tags: ["bleed", "poison"] }).scope.tags, [
      "bleed",
      "poison",
    ]);
  });

  it("are rejected for a kind that is not per attack or only has abilities", () => {
    for (const kind of [
      "attackPower",
      "energyRegen",
      "haste",
      "energyCost",
      "dodgeReduction",
      "parryReduction",
    ]) {
      for (const scope of [{ schools: ["physical"] }, { tags: ["white"] }]) {
        assert.throws(
          () => defineModifier({ kind, value: 1, scope }),
          /cannot be scoped by/,
          `${kind} ${Object.keys(scope)}`,
        );
      }
    }
  });

  it("reject an unknown, empty or mistyped value when they are defined", () => {
    for (const scope of [
      { schools: ["fire"] },
      { schools: [] },
      { schools: "nature" },
      { schools: [undefined] },
      { tags: ["Bleed"] },
      { tags: ["bleeds"] },
      { tags: [] },
      { tags: "bleed" },
      { tags: ["bleed", "nope"] },
      { tags: [["bleed"]] },
    ]) {
      assert.throws(
        () => damage(scope),
        /scope\.(schools|tags)/,
        JSON.stringify(scope),
      );
    }
    assert.throws(() => damage({ tag: ["bleed"] }), /unknown scope key "tag"/);
  });

  it("match any of the listed values and fail closed on a missing part", () => {
    const pipeline = new ModifierPipeline([
      damage({ tags: ["bleed", "poison"] }),
    ]);
    const rupture = { ability: "rupture", tags: ["bleed", "yellow"] };
    const poison = { ability: "deadly-poison", tags: ["poison"] };
    const strike = { ability: "backstab", tags: ["yellow"] };
    assert.equal(pipeline.resolve("damage", 100, rupture), 150);
    assert.equal(pipeline.resolve("damage", 100, poison), 150);
    assert.equal(pipeline.resolve("damage", 100, strike), 100);
    assert.equal(pipeline.resolve("damage", 100, { ability: "rupture" }), 100);
    assert.equal(pipeline.resolve("damage", 100, { tags: null }), 100);
    assert.equal(pipeline.resolve("damage", 100, { tags: "bleed" }), 100);
    assert.equal(pipeline.resolve("damage", 100), 100);

    const school = new ModifierPipeline([damage({ schools: ["nature"] })]);
    assert.equal(
      school.resolve("damage", 100, { ability: "x", school: "nature" }),
      150,
    );
    assert.equal(
      school.resolve("damage", 100, { ability: "x", school: "physical" }),
      100,
    );
    assert.equal(school.resolve("damage", 100, { ability: "x" }), 100);
    assert.equal(school.resolve("damage", 100), 100);
  });

  it("match a school that is not first in the list", () => {
    const both = new ModifierPipeline([
      damage({ schools: ["physical", "nature"] }),
    ]);
    const only = new ModifierPipeline([damage({ schools: ["nature"] })]);
    const reversed = new ModifierPipeline([
      damage({ schools: ["nature", "physical"] }),
    ]);
    for (const school of ["physical", "nature"]) {
      const context = { ability: "x", school };
      assert.equal(both.resolve("damage", 100, context), 150, school);
      assert.equal(reversed.resolve("damage", 100, context), 150, school);
    }
    assert.equal(
      only.resolve("damage", 100, { ability: "x", school: "physical" }),
      100,
    );
    // A school outside the list, even one that is a prefix of a listed one.
    for (const school of ["fire", "natur", "", null, undefined]) {
      assert.equal(
        both.resolve("damage", 100, { ability: "x", school }),
        100,
        String(school),
      );
    }
  });

  it("treat an explicit undefined as a mistake, not as unrestricted", () => {
    for (const scope of [
      { tags: undefined },
      { schools: undefined },
      { abilities: ["rupture"], tags: undefined },
      { hands: ["mainHand"], schools: undefined },
    ]) {
      assert.throws(
        () => damage(scope),
        /scope\.(schools|tags) must be a non-empty array/,
        JSON.stringify(scope),
      );
    }
    // And a context whose tags or school is explicitly undefined fails closed.
    const pipeline = new ModifierPipeline([
      damage({ tags: ["yellow"] }),
      defineModifier({
        kind: "damage",
        op: "add",
        value: 0.25,
        scope: { schools: ["physical"] },
      }),
    ]);
    assert.equal(
      pipeline.resolve("damage", 100, {
        ability: "x",
        school: undefined,
        tags: undefined,
      }),
      100,
    );
  });

  it("and with the other keys: every key present must match", () => {
    const pipeline = new ModifierPipeline([
      damage({ tags: ["yellow"], hands: ["offHand"], schools: ["physical"] }),
    ]);
    const context = {
      hand: "offHand",
      school: "physical",
      tags: ["yellow"],
    };
    assert.equal(pipeline.resolve("damage", 100, context), 150);
    assert.equal(
      pipeline.resolve("damage", 100, { ...context, hand: "mainHand" }),
      100,
    );
    assert.equal(
      pipeline.resolve("damage", 100, { ...context, school: "nature" }),
      100,
    );
    assert.equal(
      pipeline.resolve("damage", 100, { ...context, tags: ["white"] }),
      100,
    );
  });
});

describe("data-only damage modifiers by tag, through the engine", () => {
  afterEach(() => mock.restoreAll());

  it("+30% Rupture damage is a modifier and no engine code: a real cast", () => {
    setRoll(HIT);
    const cast = (modifiers) => {
      const { rogue, sim } = build(modifiers);
      rogue.comboPoints = 5;
      rogue.energy = 100;
      sim.gcd = 0;
      rogue.abilities.rupture.cast(rogue, sim);
      return sim.activeDots.rupture;
    };
    const plain = cast([]);
    const up = cast([DAMAGE_UP(0.3, { abilities: ["rupture"] })]);
    // The hit is floored before the ticks split it.
    const total = (dot) =>
      dot.tickDamage * Math.floor(dot.duration / dot.tickInterval);
    const baseTotal = (() => {
      const { rogue } = build();
      rogue.comboPoints = 5;
      return rogue.abilities.rupture.damage();
    })();
    close(total(plain), Math.floor(baseTotal));
    close(total(up), Math.floor(baseTotal * 1.3));
    assert.equal(up.bleed, true);
    // The same effect from the tag: Rupture is a bleed.
    close(total(cast([DAMAGE_UP(0.3, { tags: ["bleed"] })])), total(up));
    // And from the finisher tag, which it also has.
    close(total(cast([DAMAGE_UP(0.3, { tags: ["finisher"] })])), total(up));
    close(total(cast([DAMAGE_UP(0.3, { tags: ["poison"] })])), total(plain));
  });

  it("+20% poison damage is a modifier: a direct hit and a DoT, and nothing else", () => {
    setRoll(HIT);
    const { sim } = build([DAMAGE_UP(0.2, { tags: ["poison"] })]);
    const instant = sim.resolveAttack(source("instant-poison"), "skill", 1000);
    assert.equal(instant.outcome, "hit");
    // Nature skips armor, so the whole +20% shows.
    close(instant.damage, 1200);
    const strike = sim.resolveAttack(source("backstab"), "skill", 1000);
    close(strike.damage, 1000 * throughArmor());

    sim.resolveDotAttack(source("deadly-poison"), "skill", 1000, 12);
    close(sim.activeDots["deadly-poison"].tickDamage, 1200 / TICKS);
    sim.resolveDotAttack(source("garrote"), "skill", 1000, 12, true);
    close(sim.activeDots.garrote.tickDamage, 1000 / TICKS);
  });

  it("a DoT's tick is dealt at the snapshot, with no armor for a poison or a bleed", () => {
    setRoll(HIT);
    const { sim } = build([DAMAGE_UP(0.2, { tags: ["poison"] })]);
    sim.resolveDotAttack(source("deadly-poison"), "skill", 1000, 12);
    sim.step(k("rupture.tickInterval"));
    close(sim.abilityStats["deadly-poison"].damage, 1200 / TICKS);
    assert.equal(sim.abilityStats["deadly-poison"].ticks, 1);
  });

  it("scopes by school: +10% Nature touches poison and not the physical hit", () => {
    setRoll(HIT);
    const { sim } = build([DAMAGE_UP(0.1, { schools: ["nature"] })]);
    close(
      sim.resolveAttack(source("deadly-poison"), "skill", 1000).damage,
      1100,
    );
    close(
      sim.resolveAttack(source("sinister-strike"), "skill", 1000).damage,
      1000 * throughArmor(),
    );
  });

  it("scopes a swing as white and an ability as yellow", () => {
    setRoll(HIT);
    const white = build([DAMAGE_UP(0.5, { tags: ["white"] })]);
    const swing = white.sim.resolveAttack(
      white.rogue.weapons.mainHand.attack,
      "weapon",
      1000,
    );
    assert.equal(swing.outcome, "hit");
    close(swing.damage, 1500 * throughArmor());
    close(
      white.sim.resolveAttack(source("backstab"), "skill", 1000).damage,
      1000 * throughArmor(),
    );

    const yellow = build([DAMAGE_UP(0.5, { tags: ["yellow"] })]);
    close(
      yellow.sim.resolveAttack(
        yellow.rogue.weapons.mainHand.attack,
        "weapon",
        1000,
      ).damage,
      1000 * throughArmor(),
    );
    close(
      yellow.sim.resolveAttack(source("backstab"), "skill", 1000).damage,
      1500 * throughArmor(),
    );
  });

  it("scopes a finisher: Eviscerate and not Sinister Strike", () => {
    setRoll(HIT);
    const { sim } = build([DAMAGE_UP(1, { tags: ["finisher"] })]);
    close(
      sim.resolveAttack(source("eviscerate"), "skill", 1000).damage,
      2000 * throughArmor(),
    );
    close(
      sim.resolveAttack(source("sinister-strike"), "skill", 1000).damage,
      1000 * throughArmor(),
    );
  });

  it("combines a tag with a hand and an ability scope, and adds to one for the same hit", () => {
    setRoll(HIT);
    const { rogue, sim } = build([
      DAMAGE_UP(0.1, { tags: ["white"], hands: ["offHand"] }),
      DAMAGE_UP(0.2, { tags: ["white"] }),
      DAMAGE_UP(0.4, { schools: ["physical"] }),
    ]);
    const off = sim.resolveAttack(
      rogue.weapons.offHand.attack,
      "weapon",
      1000,
    ).damage;
    const main = sim.resolveAttack(
      rogue.weapons.mainHand.attack,
      "weapon",
      1000,
    ).damage;
    close(off, 1000 * (1 + 0.1 + 0.2 + 0.4) * throughArmor());
    close(main, 1000 * (1 + 0.2 + 0.4) * throughArmor());
  });

  it("applies the damage modifier before the crit multiplier, the floor and armor", () => {
    setRoll(HIT);
    const { sim } = build(
      [
        DAMAGE_UP(0.37, { tags: ["yellow"] }),
        { kind: "critDamage", value: 0.5, scope: { tags: ["yellow"] } },
      ],
      { crit: 1 },
    );
    // An odd base, so the floor tells the orders apart.
    const base = 1001;
    const hit = sim.resolveAttack(source("backstab"), "skill", base);
    assert.equal(hit.outcome, "crit");
    const crit = 1 + (k("crit.meleeMultiplier") - 1) * 1.5;
    const factor = 1 + 0.37;
    const expected = Math.floor(base * factor * crit) * throughArmor();
    close(hit.damage, expected, "damage, crit, floor, armor");
    // The orders the engine must not use give other numbers.
    const afterFloor = Math.floor(base * crit) * factor * throughArmor();
    const afterArmor = Math.floor(base * crit) * throughArmor() * factor;
    const floorFirst = Math.floor(base * factor) * crit * throughArmor();
    for (const wrong of [afterFloor, afterArmor, floorFirst]) {
      assert.ok(Math.abs(wrong - expected) > 1e-6, `${wrong} vs ${expected}`);
    }
  });

  it("reads the crit chance of a tick with the DoT's tags", () => {
    setRoll(0.5);
    const tick = (id, { bleed } = {}) => {
      const { sim } = build([
        { kind: "critChance", value: 1, scope: { tags: ["bleed"] } },
      ]);
      const interval = k("rupture.tickInterval");
      sim.activeDots[id] = {
        name: `Display name of ${id}`,
        duration: interval,
        tickInterval: interval,
        timeUntilNextTick: interval,
        tickDamage: 100,
        icon: null,
        bleed,
      };
      sim.step(interval);
      return sim.combatLog[0];
    };
    assert.equal(tick("rupture").status, "Crit");
    assert.equal(tick("garrote").status, "Crit");
    assert.equal(tick("made-up-by-a-test", { bleed: true }).status, "Crit");
    assert.equal(tick("deadly-poison").status, "Hit");
    assert.equal(tick("made-up-by-a-test").status, "Hit");
  });

  it("ticks with the attack type the DoT was applied with", () => {
    setRoll(HIT);
    const tickStatus = (attackType, tag) => {
      const { sim } = build([
        { kind: "critChance", value: 1, scope: { tags: [tag] } },
      ]);
      setRoll(HIT);
      sim.resolveDotAttack(source("made-up-by-a-test"), attackType, 1000, 12);
      setRoll(0.5);
      sim.step(k("rupture.tickInterval"));
      return sim.combatLog[0].status;
    };
    assert.equal(tickStatus("weapon", "white"), "Crit");
    assert.equal(tickStatus("weapon", "yellow"), "Hit");
    assert.equal(tickStatus("skill", "yellow"), "Crit");
    assert.equal(tickStatus("skill", "white"), "Hit");
  });

  it("reads the crit multiplier of a tick with its tags, not only its id", () => {
    setRoll(0);
    const { sim } = build(
      [{ kind: "critDamage", value: 1, scope: { tags: ["poison"] } }],
      { crit: 1 },
    );
    const interval = k("rupture.tickInterval");
    for (const id of ["deadly-poison", "rupture"]) {
      sim.activeDots[id] = {
        name: id,
        duration: interval,
        tickInterval: interval,
        timeUntilNextTick: interval,
        tickDamage: 100,
        icon: null,
      };
    }
    sim.step(interval);
    const bonus = k("dot.critMultiplier") - 1;
    close(sim.abilityStats["deadly-poison"].damage, 100 * (1 + bonus * 2));
    close(sim.abilityStats.rupture.damage, 100 * (1 + bonus));
  });
});

describe("armor follows the tags", () => {
  afterEach(() => mock.restoreAll());

  const direct = (src, attackType = "skill") => {
    setRoll(HIT);
    const { sim } = build();
    return sim.resolveAttack(src, attackType, 1000).damage;
  };

  it("skips armor for a nature hit and a bleed hit, and keeps it for a physical one", () => {
    assert.equal(direct(source("instant-poison")), 1000);
    assert.equal(direct(source("deadly-poison")), 1000);
    assert.equal(direct(source("made-up-by-a-test", { bleed: true })), 1000);
    close(direct(source("backstab")), 1000 * throughArmor());
    close(direct(source("main-hand"), "weapon"), 1000 * throughArmor());
  });

  it("reads bleed.ignoresArmor and nature.ignoresArmor for those hits", () => {
    close(
      withConstant("nature.ignoresArmor", false, () =>
        direct(source("instant-poison")),
      ),
      1000 * throughArmor(),
    );
    close(
      withConstant("bleed.ignoresArmor", false, () =>
        direct(source("made-up-by-a-test", { bleed: true })),
      ),
      1000 * throughArmor(),
    );
    assert.equal(
      withConstant("bleed.ignoresArmor", false, () =>
        direct(source("instant-poison")),
      ),
      1000,
    );
  });

  it("follows poison.spells only for the tag, and nature.spells for the armor", () => {
    close(
      withConstant("poison.spells", ["backstab"], () =>
        direct(source("backstab")),
      ),
      1000 * throughArmor(),
    );
    close(
      withConstant("nature.spells", [], () => direct(source("instant-poison"))),
      1000 * throughArmor(),
    );
  });
});

describe("a run with no matching modifier", () => {
  const config = {
    weapons: { mainHand: { type: "dagger" }, offHand: { type: "dagger" } },
  };

  function run(options) {
    const fight = createFight(7, config, options);
    let draws = 0;
    const rng = fight.simulation.rng;
    fight.simulation.rng = () => {
      draws += 1;
      return rng();
    };
    fight.simulation.run(120);
    return {
      draws,
      damage: fight.simulation.damageDone,
      stats: structuredClone(fight.simulation.abilityStats),
      log: fight.simulation.combatLog.map((event) => ({ ...event })),
    };
  }

  it("is the same as none, and draws the same random numbers, when no event has the tag", () => {
    const plain = run(undefined);
    const poisoned = run({
      modifiers: [
        DAMAGE_UP(0.5, { tags: ["poison"] }),
        { kind: "critChance", value: 0.3, scope: { schools: ["nature"] } },
        { kind: "armorIgnore", value: 1, scope: { tags: ["poison"] } },
      ],
    });
    assert.deepEqual(poisoned, plain);
  });

  it("changes only the events with the tag, and draws the same random numbers", () => {
    // Rupture is not in the placeholder rotation, so finish with it instead.
    const priority = {
      ...k("rotation.priority"),
      sliceAndDice: "rupture",
      eviscerate: "rupture",
    };
    withConstant("rotation.priority", priority, () => {
      const plain = run(undefined);
      const bleeds = run({
        modifiers: [DAMAGE_UP(0.3, { tags: ["bleed"] })],
      });
      assert.equal(bleeds.draws, plain.draws);
      assert.ok(plain.stats.rupture.ticks > 0);
      assert.equal(bleeds.stats.rupture.ticks, plain.stats.rupture.ticks);
      assert.ok(bleeds.stats.rupture.damage > plain.stats.rupture.damage * 1.2);
      assert.ok(
        bleeds.stats.rupture.damage < plain.stats.rupture.damage * 1.3 + 1,
      );
      for (const id of Object.keys(plain.stats)) {
        if (id !== "rupture") {
          assert.deepEqual(bleeds.stats[id], plain.stats[id], id);
        }
      }
    });
  });

  it("scopes the white hits of a whole fight and leaves the abilities alone", () => {
    const plain = run(undefined);
    const whites = run({ modifiers: [DAMAGE_UP(0.25, { tags: ["white"] })] });
    assert.equal(whites.draws, plain.draws);
    const swings = ["main-hand", "off-hand"];
    for (const id of Object.keys(plain.stats)) {
      if (swings.includes(id)) {
        assert.ok(whites.stats[id].damage > plain.stats[id].damage, id);
      } else {
        assert.deepEqual(whites.stats[id], plain.stats[id], id);
      }
    }
  });
});
