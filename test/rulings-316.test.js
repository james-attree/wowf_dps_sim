import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { deriveAttackTable, suppressCrit } from "../js/attack-resolver.js";
import { Rogue } from "../js/rogue.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { coreHost } from "./core-host.js";
import { quiet } from "./quiet.js";
import { setRoll, testRng } from "./rolls.js";

// The #316 rulings of 2 Nov 2026 (relayed by Scout): James on the 1.8% and on
// spell and poison crit, Scout on DoT ticks by school, and Kira's N2 (an upper
// bound on weapon skill).

const near = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message}: ${actual}, not ${expected}`,
  );
const totalCrit = ({ crit }) => crit.skill + crit.flat + crit.levelAura;

function withRow(id, value, run) {
  const original = CONSTANTS[id].value;
  CONSTANTS[id].value = value;
  try {
    return run();
  } finally {
    CONSTANTS[id].value = original;
  }
}

describe("James, 2 Nov 2026: weapon skill within 10 of the defense removes the 1.8%", () => {
  it("is its own row, James's ruling, on the retune list", () => {
    const row = CONSTANTS["attackTable.flatAboveSkillGap"];
    assert.equal(row.value, 10);
    assert.equal(row.source, "wowf-designer");
    assert.equal(row.retune, true);
    assert.match(row.ref, /^James, 2 Nov 2026, issue #295: /);
    assert.match(row.ref, /should remove the 1\.8%/);
    for (const model of Object.values(k("attackTable.critModels"))) {
      assert.equal(Object.hasOwn(model, "flatAboveSkillGap"), false);
    }
  });

  it("keeps the 1.8% at a gap of 15 (300 skill against 315 defense)", () => {
    const table = deriveAttackTable({ weaponSkill: 300 });
    assert.equal(table.crit.flat, 0.018);
    near(totalCrit(table), 0.048, "300");
  });

  it("removes it at a gap of 10 (305 skill)", () => {
    const table = deriveAttackTable({ weaponSkill: 305 });
    assert.equal(table.crit.flat, 0);
    // The classic skill term stays on the capped skill: 15 x 0.2%.
    near(totalCrit(table), 0.03, "305");
    near(suppressCrit(0.148, table), 0.118, "a hit 14.8% to 11.8%");
  });

  it("removes it at a gap of 7 (308 skill)", () => {
    const table = deriveAttackTable({ weaponSkill: 308 });
    assert.equal(table.crit.flat, 0);
    near(totalCrit(table), 0.03, "308");
  });

  it("is configurable: null keeps the 1.8% at any skill, 7 keeps it at 305", () => {
    withRow("attackTable.flatAboveSkillGap", null, () => {
      for (const weaponSkill of [300, 305, 308]) {
        near(totalCrit(deriveAttackTable({ weaponSkill })), 0.048, weaponSkill);
      }
    });
    withRow("attackTable.flatAboveSkillGap", 7, () => {
      near(totalCrit(deriveAttackTable({ weaponSkill: 305 })), 0.048, "305");
      near(totalCrit(deriveAttackTable({ weaponSkill: 308 })), 0.03, "308");
    });
  });

  it("refuses a value that is not null or a number", () => {
    withRow("attackTable.flatAboveSkillGap", "10", () => {
      assert.throws(() => deriveAttackTable(), { name: "RangeError" });
    });
  });
});

describe("James, 2 Nov 2026: spell and poison crits take no suppression", () => {
  it("has Instant Poison's row off, James's ruling", () => {
    const row = CONSTANTS["poison.instantCritSuppression"];
    assert.equal(row.value, false);
    assert.equal(row.source, "wowf-designer");
    assert.match(row.ref, /^James, 2 Nov 2026, issue #295: /);
  });

  it("splits the DoT tick rows by school (Scout's ruling, an assumption)", () => {
    const bleed = CONSTANTS["dot.critSuppression"];
    assert.equal(bleed.value, true);
    assert.equal(bleed.source, "assumption");
    const spell = CONSTANTS["dot.spellCritSuppression"];
    assert.equal(spell.value, false);
    assert.equal(spell.source, "assumption");
    assert.equal(spell.retune, true);
    assert.match(spell.ref, /Scout \(coordinator\), 2 Nov 2026/);
    assert.match(spell.ref, /James, 2 Nov 2026/);
  });
});

describe("Kira's N2: weapon skill has an upper bound of level x 5 + 50", () => {
  it("reads the margin from attackTable.weaponSkill", () => {
    assert.equal(k("attackTable.weaponSkill").maxAboveBase, 50);
  });

  it("accepts 350 at level 60 and refuses 351", () => {
    const at = (weaponSkill) =>
      normalizeConfig({
        character: { ...defaultConfig().character, weaponSkill },
      });
    assert.equal(at(350).character.weaponSkill, 350);
    assert.equal(at(1).character.weaponSkill, 1);
    assert.throws(() => at(351), {
      name: "RangeError",
      message: /weaponSkill must be a whole number between 1 and 350, not 351/,
    });
    assert.throws(() => at(1e6), { name: "RangeError" });
  });
});

// #316 QA N2 (Kira's mutant M29): a bleed tick's crit is suppressed with the
// fight's own attack table (js/simulation.js, resolveDotTick), not the default
// one. With a 20% crit chance, the 3% at 305 skill leaves 17% and the 4.8% at
// 300 leaves 15.2%, so a fixed roll between them tells the tables apart.
describe("#316 QA N2: a Rupture tick reads the fight's attack table", () => {
  const RUPTURE = { id: "rupture", name: "Rupture", icon: null };
  const CRIT = 0.2;
  const LANDS = 0.99;

  afterEach(() => setRoll(LANDS));

  // Rupture's ticks at this weapon skill, every tick's crit roll `roll`. The
  // cast itself rolls LANDS (a plain landed hit at full bonus hit).
  function ruptureTicks(weaponSkill, roll) {
    const base = defaultConfig();
    const rogue = new Rogue(
      normalizeConfig({
        ...base,
        character: { ...base.character, weaponSkill },
      }),
    );
    rogue.bonusHitChance = 1;
    rogue.critChance = CRIT;
    quiet(rogue);
    setRoll(LANDS);
    const sim = new Simulation(rogue, { rng: testRng });
    const ticks = [];
    sim.on("hit", (event) => {
      if (event.origin === "dot" && event.name === "Rupture") {
        ticks.push(event.outcome);
      }
    });
    const host = coreHost(sim, { endTime: 20, swings: false });
    host.at(1, () => sim.resolveDotAttack(RUPTURE, "skill", 800, 8, true));
    host.at(1.5, () => setRoll(roll));
    host.run();
    assert.equal(rogue.getCritChance({}), CRIT, "no crit modifier in play");
    assert.equal(ticks.length, 4);
    return ticks;
  }

  it("suppresses by 3% at 305 skill: 16% crits and 17.5% does not", () => {
    near(
      suppressCrit(CRIT, deriveAttackTable({ weaponSkill: 305 })),
      0.17,
      "305",
    );
    assert.deepEqual(ruptureTicks(305, 0.16), Array(4).fill("crit"));
    assert.deepEqual(ruptureTicks(305, 0.175), Array(4).fill("hit"));
  });

  it("suppresses by 4.8% at 300 skill: 16% does not crit and 15% does", () => {
    near(suppressCrit(CRIT, deriveAttackTable()), 0.152, "300");
    assert.deepEqual(ruptureTicks(300, 0.16), Array(4).fill("hit"));
    assert.deepEqual(ruptureTicks(300, 0.15), Array(4).fill("crit"));
  });
});
