import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { resolveAttack } from "../js/attack-resolver.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { SOURCE_TAGS } from "../scripts/provenance.mjs";

const FIELDS = ["value", "unit", "source", "ref", "note", "retune"];
const BARE_DASH = new Set(["-", "–"]);

// The 61 roadmap rows, in table order, with the source tag each one carries.
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
  ["poison.instantCrit", "classic-1.12"],
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
  ["dot.critMultiplier", "wowf-designer"],
  ["target.level", "assumption"],
  ["target.armor", "assumption"],
  ["target.behind", "assumption"],
  ["target.mobType", "assumption"],
  ["fight.duration", "assumption"],
  ["fight.iterations", "assumption"],
  ["start.state", "assumption"],
  ["talents.rowGating", "assumption"],
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
    assert.equal(ROADMAP.length, 61);
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
      "classic-1.12": 35,
      cataclysm: 1,
      assumption: 11,
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
    assert.match(
      CONSTANTS["dot.critMultiplier"].ref,
      /^Issue #23: DoTs and bleeds crit at 2×/,
    );
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

    const sampleInput = "James, 22 Oct 2026: sample input until SimConfig (E2)";
    for (const id of [
      "character.attackPower",
      "character.critChance",
      "character.bonusHitChance",
      "weapon.offHand",
      "rotation.adrenalineRushEnergy",
      "rotation.sliceAndDiceComboPoints",
      "rotation.sliceAndDiceRefreshSeconds",
    ]) {
      assert.equal(CONSTANTS[id].ref, sampleInput, id);
      assert.equal(CONSTANTS[id].source, "assumption", id);
    }
    assert.equal(
      CONSTANTS["weapon.mainHand"].ref,
      `${sampleInput}; #9 is 59–110 at 1.8s`,
    );
    assert.deepEqual(k("weapon.mainHand"), { min: 59, max: 110, speed: 1.8 });

    for (const id of [
      "attack.rollScale",
      "log.maxEvents",
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
        assert.match(row.ref, /^James, 22 Oct 2026: /, id);
      } else if (row.source === "wowf-export") {
        assert.match(row.ref, /^rogue\.json → /, id);
      } else if (row.source === "classic-1.12" || row.source === "cataclysm") {
        assert.match(row.ref, /^https:\/\//, id);
      }
    }
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
    assert.equal(rogue.attackPower, 450);
    assert.equal(rogue.critChance, 0.1);
    assert.equal(rogue.bonusHitChance, 0.09);
    assert.equal(k("character.startingComboPoints"), 0);
    assert.equal(k("start.state").comboPoints, 0);
    assert.equal(rogue.comboPoints, k("character.startingComboPoints"));
    assert.equal(rogue.maxComboPoints, 5);
    assert.equal(rogue.normalizedWeaponSpeed, 1.7);

    assert.deepEqual(k("weapon.mainHand"), {
      min: 59,
      max: 110,
      speed: 1.8,
    });
    assert.equal(rogue.weapons.mainHand.minDamage, 59);
    assert.equal(rogue.weapons.mainHand.maxDamage, 110);
    assert.equal(rogue.weapons.mainHand.speed, 1.8);
    assert.equal(rogue.weapons.offHand.minDamage, 54);
    assert.equal(rogue.weapons.offHand.maxDamage, 101);
    assert.equal(rogue.weapons.offHand.speed, 1.7);
    assert.equal(rogue.weapons.offHand.swingTimer, 0.5);

    expectSkill(rogue.abilities.sinisterStrike, {
      energyCost: 45,
      cooldown: 0,
      comboPointsGenerated: 1,
      triggersGcd: true,
    });
    expectSkill(rogue.abilities.eviscerate, {
      energyCost: 35,
      cooldown: 0,
      spender: true,
    });
    expectSkill(rogue.abilities.premeditation, {
      energyCost: 0,
      cooldown: 120,
      comboPointsGenerated: 2,
      triggersGcd: false,
      attackSkill: false,
      expiresComboPoints: true,
    });
    expectSkill(rogue.abilities.adrenalineRush, {
      energyCost: 0,
      cooldown: 300,
      duration: 15,
      triggersGcd: false,
      attackSkill: false,
      targetAura: false,
    });
    expectSkill(rogue.abilities.sliceAndDice, {
      energyCost: 25,
      cooldown: 0,
      spender: true,
      triggersGcd: false,
      attackSkill: false,
      targetAura: false,
    });
    expectSkill(rogue.abilities.ghostlyStrike, {
      energyCost: 40,
      cooldown: 20,
      duration: 7,
      comboPointsGenerated: 1,
      targetAura: false,
    });
    expectSkill(rogue.abilities.backstab, {
      energyCost: 60,
      cooldown: 0,
      comboPointsGenerated: 1,
    });
    expectSkill(rogue.abilities.ambush, {
      energyCost: 60,
      cooldown: 0,
      comboPointsGenerated: 1,
    });
    expectSkill(rogue.abilities.bladeFlurry, {
      energyCost: 25,
      cooldown: 120,
      duration: 15,
      triggersGcd: false,
      attackSkill: false,
      targetAura: false,
    });
    expectSkill(rogue.abilities.rupture, {
      energyCost: 25,
      cooldown: 0,
      spender: true,
      dot: true,
      triggersGcd: true,
      targetAura: true,
    });
    expectSkill(rogue.abilities.hemorrhage, {
      energyCost: 35,
      cooldown: 0,
      duration: 15,
      comboPointsGenerated: 1,
      targetAura: true,
    });
    assert.equal(k("adrenalineRush").cooldown, 300);
    assert.equal(new Simulation(rogue).gcdDuration, 1);
  });

  it("keeps damage formulas, with the main-hand die at its minimum", () => {
    mock.method(Math, "random", () => 0);
    const rogue = new Rogue();
    const weaponDie = 59;
    const apBonus = (speed) => (450 / 14) * speed;
    const normalized = weaponDie + apBonus(1.7);

    assert.equal(rogue.abilities.sinisterStrike.damage(), normalized + 68);
    assert.equal(rogue.abilities.backstab.damage(), normalized * 1.5 + 225);
    assert.equal(rogue.abilities.ambush.damage(), normalized * 2.5 + 290);
    assert.equal(rogue.abilities.ghostlyStrike.damage(), normalized * 1.8);
    assert.equal(rogue.abilities.hemorrhage.damage(), normalized * 1.45);
    assert.equal(rogue.weapons.mainHand.rollDamage(), weaponDie + apBonus(1.8));
    assert.equal(
      rogue.weapons.offHand.rollDamage(),
      (54 + apBonus(1.7)) * k("offHand.damageMult"),
    );

    rogue.comboPoints = 0;
    assert.equal(rogue.abilities.eviscerate.damage(), 0);
    assert.equal(rogue.abilities.rupture.damage(), 0);
    assert.equal(rogue.abilities.rupture.duration, 0);

    rogue.comboPoints = 1;
    assert.equal(
      rogue.abilities.eviscerate.damage(),
      Math.floor(450 * 0.03 + 224),
    );
    assert.equal(rogue.abilities.rupture.damage(), 159 + 450 * 0.06);
    assert.equal(rogue.abilities.rupture.duration, 8);

    rogue.comboPoints = 5;
    assert.equal(
      rogue.abilities.eviscerate.damage(),
      Math.floor(450 * 5 * 0.03 + 904),
    );
    assert.equal(rogue.abilities.rupture.damage(), 469 + 450 * 0.3);
    assert.equal(rogue.abilities.rupture.duration, 16);

    const sim = new Simulation(rogue);
    rogue.energy = 100;
    sim.gcd = 0;
    rogue.comboPoints = 2;
    rogue.abilities.sliceAndDice.cast(rogue, sim);
    assert.equal(rogue.abilities.sliceAndDice.duration, 12);

    const kept = rogue.abilities.sliceAndDice.duration;
    rogue.energy = 100;
    sim.gcd = 0;
    rogue.comboPoints = 0;
    rogue.abilities.sliceAndDice.cast(rogue, sim);
    assert.equal(rogue.abilities.sliceAndDice.duration, kept);

    rogue.energy = 100;
    sim.gcd = 0;
    rogue.comboPoints = 5;
    rogue.abilities.sliceAndDice.cast(rogue, sim);
    assert.equal(rogue.abilities.sliceAndDice.duration, 21);
  });

  it("deals no Rupture damage outside 1–5 combo points", () => {
    const rogue = new Rogue();
    for (const comboPoints of [0, 6, -1]) {
      rogue.comboPoints = comboPoints;
      rogue.abilities.rupture.duration = 16;
      assert.equal(
        rogue.abilities.rupture.damage(),
        0,
        `damage at ${comboPoints} CP`,
      );
      assert.equal(
        rogue.abilities.rupture.duration,
        0,
        `duration at ${comboPoints} CP`,
      );
    }

    rogue.comboPoints = 3;
    assert.equal(rogue.abilities.rupture.damage(), 295 + 450 * 0.18);
    assert.equal(rogue.abilities.rupture.duration, 12);
  });

  it("still refunds 80% energy on a miss and crits DoT ticks at 2×", () => {
    mock.method(Math, "random", () => 0);
    const rogue = new Rogue();
    rogue.bonusHitChance = 0;
    const sim = new Simulation(rogue);
    const result = rogue.abilities.sinisterStrike.cast(rogue, sim);
    assert.equal(result.outcome, "miss");
    assert.equal(rogue.energy, 100 - 45 + 45 * 0.8);
    assert.equal(rogue.comboPoints, k("character.startingComboPoints"));

    mock.restoreAll();
    mock.method(Math, "random", () => 0);
    const ticking = new Rogue();
    ticking.rotation = () => {};
    const fight = new Simulation(ticking);
    fight.activeDots.Rupture = {
      duration: 2,
      tickInterval: 2,
      timeUntilNextTick: 2,
      tickDamage: 100,
      icon: null,
    };
    fight.activeDebuffs.Hemorrhage = { duration: 15, icon: null };
    fight.lastFrameTime = 0;
    fight.update(2000);
    assert.equal(
      fight.damageDone,
      100 * (1 + k("hemorrhage.ruptureBonus").bonus) * k("dot.critMultiplier"),
    );

    mock.restoreAll();
    mock.method(Math, "random", () => 0.5);
    const quiet = new Rogue();
    quiet.energy = 0;
    quiet.rotation = () => {};
    const regen = new Simulation(quiet);
    regen.activeBuffs["Adrenaline Rush"] = { duration: 15, icon: null };
    regen.lastFrameTime = 0;
    regen.update(1000);
    assert.equal(quiet.energy, 20);

    const plain = new Rogue();
    plain.energy = 0;
    plain.rotation = () => {};
    const base = new Simulation(plain);
    base.lastFrameTime = 0;
    base.update(1000);
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
