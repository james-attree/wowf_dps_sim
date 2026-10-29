import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { resolveAttack } from "../js/attack-resolver.js";
import { AURAS } from "../js/auras.js";
import { Rogue } from "../js/rogue.js";
import { defaultConfig, defaultDaggerConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { setRoll, testRng } from "./rolls.js";
import { SOURCE_TAGS } from "../scripts/provenance.mjs";

const FIELDS = ["value", "unit", "source", "ref", "note", "retune"];
const BARE_DASH = new Set(["-", "–"]);

// The 62 roadmap rows, in table order, with the source tag each one carries.
const ROADMAP = [
  ["energy.regenPerSecond", "wowf-export"],
  ["combo.max", "wowf-export"],
  ["premeditation.cpExpiry", "wowf-export"],
  ["adrenalineRush", "wowf-export"],
  ["bladeFlurry", "wowf-export"],
  ["sliceAndDice", "wowf-export"],
  ["hemorrhage.ruptureBonus", "wowf-export"],
  ["abilities.*", "wowf-export"],
  ["poison.instant", "wowf-export"],
  ["poison.deadly", "wowf-export"],
  ["talents.maxPoints", "wowf-export"],
  ["talents.*", "wowf-export"],
  ["gcd.duration", "classic-1.12"],
  ["gcd.flags", "classic-1.12"],
  ["ap.perDps", "classic-1.12"],
  ["normalizedSpeed.dagger", "classic-1.12"],
  ["normalizedSpeed.oneHand", "classic-1.12"],
  ["offHand.damageMult", "classic-1.12"],
  ["crit.meleeMultiplier", "classic-1.12"],
  ["weaponSkill.base", "classic-1.12"],
  ["target.defense", "classic-1.12"],
  ["miss.yellow", "classic-1.12"],
  ["hit.suppression", "classic-1.12"],
  ["miss.dualWieldPenalty", "classic-1.12"],
  ["dodge.target", "classic-1.12"],
  ["parry.target", "classic-1.12"],
  ["block.target", "classic-1.12"],
  ["glancing.chance", "classic-1.12"],
  ["glancing.damage", "classic-1.12"],
  ["table.white", "classic-1.12"],
  ["table.yellow", "classic-1.12"],
  ["crit.suppressionSkill", "classic-1.12"],
  ["crit.suppressionAura", "classic-1.12"],
  ["spell.missTarget", "classic-1.12"],
  ["poison.hitModel", "classic-1.12"],
  ["poison.procSource", "classic-1.12"],
  ["poison.deadlyTick", "classic-1.12"],
  ["poison.instantCrit", "assumption"],
  ["poison.instantCritSuppression", "assumption"],
  ["bleed.ignoresArmor", "classic-1.12"],
  ["dot.snapshot", "classic-1.12"],
  ["rupture.tickInterval", "classic-1.12"],
  ["eviscerate.apPerCP", "classic-1.12"],
  ["armor.mitigation", "classic-1.12"],
  ["agility.ap", "classic-1.12"],
  ["strength.ap", "classic-1.12"],
  ["agility.crit", "classic-1.12"],
  ["energy.max", "classic-1.12"],
  ["rupture.apByCP", "cataclysm"],
  ["dot.canCrit", "wowf-designer"],
  ["dot.critMultiplier", "assumption"],
  ["target.level", "assumption"],
  ["target.armor", "assumption"],
  ["target.behind", "assumption"],
  ["target.mobType", "assumption"],
  ["batch.duration", "assumption"],
  ["fight.iterations", "assumption"],
  ["start.state", "assumption"],
  ["talents.rowGating", "wowf-designer"],
  ["latency", "assumption"],
  ["poison.charges", "assumption"],
  ["hackAndSlash.chain", "assumption"],
];

function expectSkill(skill, fields) {
  for (const [key, value] of Object.entries(fields)) {
    assert.equal(skill[key], value, `${skill.name} ${key}`);
  }
}

describe("constants", () => {
  it("includes every roadmap row with all six fields", () => {
    assert.equal(ROADMAP.length, 62);
    const counts = {};
    for (const [id, source] of ROADMAP) {
      const row = CONSTANTS[id];
      assert.ok(row, `missing ${id}`);
      assert.equal(row.source, source, id);
      for (const field of FIELDS) {
        assert.equal(Object.hasOwn(row, field), true, `${id} ${field}`);
      }
      assert.equal(typeof row.unit, "string", id);
      assert.equal(typeof row.note, "string", id);
      assert.notEqual(row.note.trim(), "", id);
      assert.equal(typeof row.ref, "string", id);
      assert.equal(BARE_DASH.has(row.ref.trim()), false, id);
      assert.equal(typeof row.retune, "boolean", id);
      assert.equal(k(id), row.value, id);
      counts[source] = (counts[source] ?? 0) + 1;
    }
    assert.deepEqual(counts, {
      "wowf-export": 12,
      "wowf-designer": 2,
      "classic-1.12": 34,
      cataclysm: 1,
      assumption: 13,
    });
  });

  it("rejects an unknown id and only uses the known source tags", () => {
    assert.throws(() => k("not.a.constant"), {
      name: "Error",
      message: "Unknown constant: not.a.constant",
    });
    for (const [id, row] of Object.entries(CONSTANTS)) {
      assert.equal(SOURCE_TAGS.includes(row.source), true, id);
    }
  });

  it("records a signed reason on every assumption and engineering ref", () => {
    assert.match(
      CONSTANTS["dot.canCrit"].ref,
      /^James, 22 Oct 2026: all DoTs, bleeds included, can crit/,
    );
    assert.equal(
      CONSTANTS["dot.critMultiplier"].ref,
      "James, 22 Oct 2026: 2x DoT/bleed crit is standard and unlikely to change; update the code if it does",
    );
    assert.equal(CONSTANTS["dot.critMultiplier"].source, "assumption");
    assert.equal(CONSTANTS["dot.critMultiplier"].retune, false);
    assert.equal(k("dot.canCrit"), true);
    assert.equal(k("dot.critMultiplier"), 2);
    assert.equal(k("bleed.ignoresArmor"), true);
    assert.deepEqual(k("rupture.apByCP"), [0.06, 0.12, 0.18, 0.24, 0.3]);
    assert.equal(k("miss.yellow") + k("miss.dualWieldPenalty"), 0.27);
    assert.equal(CONSTANTS["rupture.apAtZeroCp"], undefined);
    assert.equal(
      CONSTANTS["character.startingComboPoints"].ref,
      "James, 22 Oct 2026: no pre-pull Premeditation or stealth opener (#18, OQ7)",
    );
    assert.equal(
      CONSTANTS["character.startingComboPoints"].source,
      "assumption",
    );
    assert.equal(
      CONSTANTS["premeditation.cpRemovedOnExpiry"].ref,
      "James, 22 Oct 2026: always removes 2 on expiry",
    );
    assert.equal(
      CONSTANTS["premeditation.cpRemovedOnExpiry"].source,
      "assumption",
    );
    assert.equal(CONSTANTS["premeditation.cpRemovedOnExpiry"].retune, true);
    assert.equal(k("premeditation.cpRemovedOnExpiry"), 2);

    // The default character (issue #127): a request of the project owner,
    // relayed. The ref says so and names no statement James made.
    const relayed = /issue #127: project owner request 2026-10-26, relayed/;
    for (const id of [
      "character.attackPower",
      "character.critChance",
      "character.bonusHitChance",
      "character.dagger.attackPower",
      "character.dagger.critChance",
      "weapon.mainHand",
      "weapon.offHand",
      "weapon.dagger.mainHand",
      "weapon.dagger.offHand",
    ]) {
      assert.match(CONSTANTS[id].ref, relayed, id);
    }
    for (const id of [
      "character.attackPower",
      "character.critChance",
      "character.dagger.attackPower",
      "character.dagger.critChance",
    ]) {
      // Classic 1.12 reference values (wowsims base stats and preset), with
      // an https ref, and on the retune list until WoW Forever is measured.
      assert.equal(CONSTANTS[id].source, "classic-1.12", id);
      assert.match(
        CONSTANTS[id].ref,
        /^https:\/\/github\.com\/wowsims\/classic\//,
        id,
      );
      assert.equal(CONSTANTS[id].retune, true, id);
    }
    assert.deepEqual(k("weapon.mainHand"), {
      min: 100,
      max: 187,
      speed: 2.6,
      type: "sword",
    });
    // The main-hand type row records the project owner's Tier 1 request and that the sword pairing is Scout's recommendation.
    assert.equal(k("weapon.mainHand.type"), "sword");
    assert.equal(CONSTANTS["weapon.mainHand.type"].source, "wowf-designer");
    assert.match(
      CONSTANTS["weapon.mainHand.type"].ref,
      /^James, 26 Oct 2026, issue #127: the project owner asked for the standard Tier 1 stats and weapon damage; the sword\/sword pairing is Scout's recommendation from the research \(relayed\), not James's explicit choice/,
    );
    assert.equal(k("weapon.mainHand").type, k("weapon.mainHand.type"));

    for (const id of [
      "attack.rollScale",
      "log.maxEvents",
      "rng.defaultSeed",
      "rng.mulberry32",
      "sim.fixedStep",
      "sim.maxFrameTime",
      "sim.msPerSecond",
      "sim.tickEpsilon",
    ]) {
      assert.equal(CONSTANTS[id].source, "engineering", id);
      assert.equal(CONSTANTS[id].retune, false, id);
    }
    for (const field of ["ref", "note"]) {
      const text = CONSTANTS["sim.tickEpsilon"][field];
      assert.match(text, /buffs/, field);
      assert.match(text, /cooldowns/, field);
      assert.match(text, /GCD/, field);
      assert.match(text, /DoT expiry/, field);
      assert.match(text, /weapon swings/, field);
    }

    for (const [id, row] of Object.entries(CONSTANTS)) {
      assert.doesNotMatch(row.ref, /^tbd$/i, id);
      assert.doesNotMatch(row.ref, /fill in/i, id);
      assert.doesNotMatch(row.ref, /no recorded owner decision/i, id);
      if (row.source === "assumption" || row.source === "engineering") {
        assert.match(
          row.ref,
          /^(?:(?:James|Developer), \d+ Oct 2026(, issue #\d+)?|Scout \(coordinator\), \d+ Oct 2026, #\d+): /,
          id,
        );
      } else if (row.source === "wowf-export") {
        assert.match(row.ref, /^rogue\.json → /, id);
      } else if (row.source === "classic-1.12" || row.source === "cataclysm") {
        assert.match(row.ref, /^https:\/\//, id);
      }
    }
  });

  it("records the placeholder Combat rotation from issue #68", () => {
    const ref = "James, 25 Oct 2026, issue #68: placeholder Combat rotation";
    for (const id of [
      "rotation.priority",
      "rotation.finisherComboPoints",
      "rotation.sliceAndDiceRefreshSeconds",
    ]) {
      assert.equal(CONSTANTS[id].source, "wowf-designer", id);
      assert.equal(CONSTANTS[id].ref, ref, id);
      assert.equal(CONSTANTS[id].retune, true, id);
      assert.equal(typeof CONSTANTS[id].unit, "string", id);
      assert.notEqual(CONSTANTS[id].note.trim(), "", id);
      assert.equal(k(id), CONSTANTS[id].value, id);
    }
    assert.equal(k("rotation.finisherComboPoints"), 5);
    assert.equal(k("rotation.sliceAndDiceRefreshSeconds"), 10);
    assert.deepEqual(k("rotation.priority"), {
      onCooldown: ["bladeFlurry", "adrenalineRush"],
      sliceAndDice: "sliceAndDice",
      eviscerate: "eviscerate",
      builder: "sinisterStrike",
    });
    assert.equal(CONSTANTS["rotation.adrenalineRushEnergy"], undefined);
    assert.equal(CONSTANTS["rotation.sliceAndDiceComboPoints"], undefined);
    assert.match(CONSTANTS["rotation.priority"].note, /Ghostly Strike/);
    assert.match(CONSTANTS["rotation.priority"].note, /Premeditation/);
    assert.match(CONSTANTS["rotation.priority"].note, /Hemorrhage/);
    assert.match(CONSTANTS["rotation.priority"].note, /Rupture/);
    assert.match(CONSTANTS["rotation.priority"].note, /4 combo points/);
  });
});

describe("simulator values other than white miss", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("keeps the sample character, weapons, and spell parameters", () => {
    const rogue = new Rogue();
    assert.equal(rogue.energy, 100);
    assert.equal(rogue.maxEnergy, 100);
    assert.equal(rogue.attackPower, 767);
    assert.equal(rogue.critChance, 0.2245);
    assert.equal(rogue.bonusHitChance, 0.07);
    assert.equal(k("character.startingComboPoints"), 0);
    assert.equal(k("start.state").comboPoints, 0);
    assert.equal(rogue.comboPoints, k("character.startingComboPoints"));
    assert.equal(rogue.maxComboPoints, 5);
    assert.equal(rogue.normalizedWeaponSpeed, 2.4); // the sword default

    assert.deepEqual(k("weapon.mainHand"), {
      min: 100,
      max: 187,
      speed: 2.6,
      type: "sword",
    });
    assert.equal(rogue.weapons.mainHand.minDamage, 100);
    assert.equal(rogue.weapons.mainHand.maxDamage, 187);
    assert.equal(rogue.weapons.mainHand.speed, 2.6);
    assert.equal(rogue.weapons.mainHand.type, "sword");
    assert.equal(rogue.weapons.offHand.type, "sword");
    assert.equal(rogue.weapons.offHand.minDamage, 90);
    assert.equal(rogue.weapons.offHand.maxDamage, 168);
    assert.equal(rogue.weapons.offHand.speed, 2.5);
    assert.equal(rogue.weapons.offHand.swingTimer, 0.5);

    expectSkill(rogue.abilities.sinisterStrike, {
      cost: 45,
      cooldown: 0,
      gain: 1,
      triggersGcd: true,
    });
    expectSkill(rogue.abilities.eviscerate, {
      cost: 35,
      cooldown: 0,
      spender: true,
    });
    expectSkill(rogue.abilities.premeditation, {
      cost: 0,
      cooldown: 120,
      gain: 2,
      triggersGcd: false,
      attackSkill: false,
    });
    assert.deepEqual(rogue.abilities.premeditation.expires, {
      amount: k("premeditation.cpRemovedOnExpiry"),
      after: k("premeditation.cpExpiry"),
    });
    expectSkill(rogue.abilities.adrenalineRush, {
      cost: 0,
      cooldown: 300,
      duration: 15,
      triggersGcd: true,
      attackSkill: false,
      aura: AURAS.adrenalineRush, // on the self
    });
    expectSkill(rogue.abilities.sliceAndDice, {
      cost: 25,
      cooldown: 0,
      spender: true,
      triggersGcd: true,
      attackSkill: false,
      aura: AURAS.sliceAndDice, // on the self
    });
    expectSkill(rogue.abilities.ghostlyStrike, {
      cost: 40,
      cooldown: 20,
      duration: 7,
      gain: 1,
      aura: AURAS.ghostlyStrike, // on the self
    });
    expectSkill(rogue.abilities.backstab, {
      cost: 60,
      cooldown: 0,
      gain: 1,
    });
    expectSkill(rogue.abilities.ambush, {
      cost: 60,
      cooldown: 0,
      gain: 1,
    });
    expectSkill(rogue.abilities.bladeFlurry, {
      cost: 25,
      cooldown: 120,
      duration: 15,
      triggersGcd: true,
      attackSkill: false,
      aura: AURAS.bladeFlurry, // on the self
    });
    expectSkill(rogue.abilities.rupture, {
      cost: 25,
      cooldown: 0,
      spender: true,
      dot: true,
      triggersGcd: true,
      aura: AURAS.rupture, // on the target
    });
    expectSkill(rogue.abilities.hemorrhage, {
      cost: 35,
      cooldown: 0,
      duration: 15,
      gain: 1,
      aura: AURAS.hemorrhage, // on the target
    });
    assert.equal(k("adrenalineRush").cooldown, 300);
    assert.equal(new Simulation(rogue, { rng: testRng }).gcdDuration, 1);
  });

  it("normalizes by main-hand type: dagger 1.7, any other one-hand 2.4 (issue #129)", () => {
    assert.equal(k("normalizedSpeed.dagger"), 1.7);
    assert.equal(k("normalizedSpeed.oneHand"), 2.4);
    const withType = (type) => {
      const config = defaultConfig();
      config.weapons.mainHand.type = type;
      return new Rogue(config).normalizedWeaponSpeed;
    };
    assert.equal(withType("dagger"), 1.7);
    for (const type of ["sword", "mace", "axe", "fist", "other", null]) {
      assert.equal(withType(type), 2.4, String(type));
    }
    // Literal Sinister Strike, die at its minimum (setRoll(0)), plus its
    // 68 flat bonus. Sword: 100 + 767 x 2.4 / 14 + 68.
    setRoll(0);
    const sword = new Rogue();
    sword.rng = testRng;
    assert.equal(sword.normalizedWeaponSpeed, 2.4);
    assert.equal(
      sword.abilities.sinisterStrike.damage(),
      100 + (767 * 2.4) / 14 + 68,
    );
    assert.ok(
      Math.abs(sword.abilities.sinisterStrike.damage() - 299.4857142857) < 1e-9,
    );
    // Dagger: 73 + 769 x 1.7 / 14 + 68. The off-hand type does not matter:
    // abilities roll the main hand only.
    const dagger = new Rogue(defaultDaggerConfig());
    dagger.rng = testRng;
    assert.equal(dagger.normalizedWeaponSpeed, 1.7);
    assert.equal(
      dagger.abilities.sinisterStrike.damage(),
      73 + (769 * 1.7) / 14 + 68,
    );
    assert.ok(
      Math.abs(dagger.abilities.sinisterStrike.damage() - 234.3785714286) <
        1e-9,
    );
    const mixed = defaultDaggerConfig();
    mixed.weapons.offHand.type = "sword";
    assert.equal(new Rogue(mixed).normalizedWeaponSpeed, 1.7);
    // And the other way round: a sword main hand with a dagger off hand is
    // 2.4, because the main-hand type governs.
    const swordDagger = defaultConfig();
    swordDagger.weapons.offHand.type = "dagger";
    assert.equal(swordDagger.weapons.mainHand.type, "sword");
    const mixedRogue = new Rogue(swordDagger);
    mixedRogue.rng = testRng;
    assert.equal(mixedRogue.normalizedWeaponSpeed, 2.4);
    assert.equal(
      mixedRogue.abilities.sinisterStrike.damage(),
      100 + (767 * 2.4) / 14 + 68,
    );
  });

  it("keeps damage formulas, with the main-hand die at its minimum", () => {
    setRoll(0);
    const rogue = new Rogue();
    rogue.rng = testRng;
    const weaponDie = 100;
    const apBonus = (speed) => (767 / 14) * speed;
    // The default main hand is a sword, so the normalized speed is 2.4.
    const normalized = weaponDie + apBonus(2.4);

    assert.equal(rogue.abilities.sinisterStrike.damage(), normalized + 68);
    assert.equal(rogue.abilities.backstab.damage(), normalized * 1.5 + 225);
    assert.equal(rogue.abilities.ambush.damage(), normalized * 2.5 + 290);
    const ghostly = k("ghostlyStrike").weaponMultiplier;
    const hemorrhage = k("hemorrhage").weaponMultiplier;
    assert.equal(rogue.weapons.mainHand.type, "sword");
    assert.equal(
      rogue.abilities.ghostlyStrike.damage(),
      normalized * ghostly.other,
    );
    assert.equal(
      rogue.abilities.hemorrhage.damage(),
      normalized * hemorrhage.other,
    );
    rogue.weapons.mainHand.type = "dagger";
    assert.equal(
      rogue.abilities.ghostlyStrike.damage(),
      normalized * ghostly.dagger,
    );
    assert.equal(
      rogue.abilities.hemorrhage.damage(),
      normalized * hemorrhage.dagger,
    );
    rogue.weapons.mainHand.type = "sword";
    assert.equal(
      rogue.abilities.ghostlyStrike.damage(),
      normalized * ghostly.other,
    );
    assert.equal(
      rogue.abilities.hemorrhage.damage(),
      normalized * hemorrhage.other,
    );
    assert.equal(rogue.weapons.mainHand.rollDamage(), weaponDie + apBonus(2.6));
    assert.equal(
      rogue.weapons.offHand.rollDamage(),
      (90 + apBonus(2.5)) * k("offHand.damageMult"),
    );

    rogue.comboPoints = 0;
    assert.equal(rogue.abilities.eviscerate.damage(), 0);
    assert.equal(rogue.abilities.rupture.damage(), 0);
    assert.equal(rogue.abilities.rupture.resolve().duration, 0);

    rogue.comboPoints = 1;
    assert.equal(
      rogue.abilities.eviscerate.damage(),
      Math.floor(767 * 0.03 + 224),
    );
    assert.equal(rogue.abilities.rupture.damage(), 159 + 767 * 0.06);
    assert.equal(rogue.abilities.rupture.resolve().duration, 8);

    rogue.comboPoints = 5;
    assert.equal(
      rogue.abilities.eviscerate.damage(),
      Math.floor(767 * 5 * 0.03 + 904),
    );
    assert.equal(rogue.abilities.rupture.damage(), 469 + 767 * 0.3);
    assert.equal(rogue.abilities.rupture.resolve().duration, 16);

    const sim = new Simulation(rogue, { rng: testRng });
    rogue.energy = 100;
    sim.gcd = 0;
    rogue.comboPoints = 2;
    rogue.abilities.sliceAndDice.cast(rogue, sim);
    assert.equal(sim.activeBuffs["slice-and-dice"].duration, 12);

    // Out of the table's combo points (6 of a table of 5, set by hand: only
    // the instance seam can hold more than the cap), the cast spends them but
    // applies no buff and changes none.
    rogue.energy = 100;
    sim.gcd = 0;
    rogue.comboPoints = 6;
    rogue.abilities.sliceAndDice.cast(rogue, sim);
    assert.equal(sim.activeBuffs["slice-and-dice"].duration, 12);
    assert.equal(rogue.comboPoints, 0);

    rogue.energy = 100;
    sim.gcd = 0;
    rogue.comboPoints = 5;
    rogue.abilities.sliceAndDice.cast(rogue, sim);
    assert.equal(sim.activeBuffs["slice-and-dice"].duration, 21);
  });

  it("deals no Rupture damage outside 1–5 combo points", () => {
    const rogue = new Rogue();
    for (const comboPoints of [0, 6, -1]) {
      rogue.comboPoints = comboPoints;
      assert.equal(
        rogue.abilities.rupture.damage(),
        0,
        `damage at ${comboPoints} CP`,
      );
      assert.equal(
        rogue.abilities.rupture.resolve().duration,
        0,
        `duration at ${comboPoints} CP`,
      );
    }

    rogue.comboPoints = 3;
    assert.equal(rogue.abilities.rupture.damage(), 295 + 767 * 0.18);
    assert.equal(rogue.abilities.rupture.resolve().duration, 12);
  });

  it("still refunds 80% energy on a miss and crits DoT ticks at 2×", () => {
    setRoll(0);
    const rogue = new Rogue();
    rogue.bonusHitChance = 0;
    const sim = new Simulation(rogue, { rng: testRng });
    const result = rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(result.outcome, "miss");
    assert.equal(rogue.energy, 100 - 45 + 45 * 0.8);
    assert.equal(rogue.comboPoints, k("character.startingComboPoints"));

    mock.restoreAll();
    setRoll(0);
    const ticking = new Rogue();
    ticking.rotation = () => {};
    const fight = new Simulation(ticking, { rng: testRng });
    fight.activeDots.rupture = {
      duration: 2,
      tickInterval: 2,
      timeUntilNextTick: 2,
      tickDamage: 100,
      icon: null,
    };
    fight.activeDebuffs.hemorrhage = { duration: 15, icon: null };
    fight.step(2);
    assert.equal(
      fight.damageDone,
      100 * (1 + k("hemorrhage.ruptureBonus").bonus) * k("dot.critMultiplier"),
    );

    mock.restoreAll();
    setRoll(0.5);
    const quiet = new Rogue();
    quiet.energy = 0;
    quiet.rotation = () => {};
    const regen = new Simulation(quiet, { rng: testRng });
    regen.activeBuffs["adrenaline-rush"] = { duration: 15, icon: null };
    regen.step(1);
    assert.equal(quiet.energy, 20);

    const plain = new Rogue();
    plain.energy = 0;
    plain.rotation = () => {};
    const base = new Simulation(plain, { rng: testRng });
    base.step(1);
    assert.equal(plain.energy, 10);
  });

  it("moves white miss from 24% to 27% and leaves yellow miss at 8%", () => {
    const attack = {
      baseDamage: 100,
      bonusHitChance: 0,
      critChance: 0.1,
    };
    assert.equal(
      resolveAttack({ ...attack, attackType: "weapon", roll: 24 }).outcome,
      "miss",
    );
    assert.equal(
      resolveAttack({ ...attack, attackType: "weapon", roll: 27 }).outcome,
      "dodge",
    );
    assert.equal(
      resolveAttack({ ...attack, attackType: "skill", roll: 8 }).outcome,
      "dodge",
    );
    assert.equal(
      resolveAttack({ ...attack, attackType: "skill", roll: 7.999 }).outcome,
      "miss",
    );
  });
});
