import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { AURAS } from "../js/auras.js";
import { createFight, expandTalents, runFight } from "../js/fight.js";
import { defineProc, defineRankedProc } from "../js/procs.js";
import { Rogue } from "../js/rogue.js";
import { defaultDaggerConfig } from "../js/sim-config.js";
import { Simulation } from "../js/simulation.js";
import { applyBuild, validateBuild } from "../js/talent-build.js";
import { talentCatalogue } from "../js/talents.js";
import {
  AMBUSH_ROTATION,
  CUTTHROAT_BUILD,
  GOLDEN_CASES,
  SUBTLETY_BUILD,
} from "../scripts/golden-update.mjs";

// Issue #271 (P4.6-05c, D8d-3): Cutthroat (a Backstab proc that puts up the
// cutthroat aura, "Ambush allowed", for 10 s), Improved Ambush (+15% crit
// per rank on Ambush) and Initiative (a chance of one more combo point on a
// landed Ambush). With them every Subtlety talent is mapped (closes D8).

const CUTTHROAT = "subtlety.cutthroat";
const IMPROVED = "subtlety.improved-ambush";
const INITIATIVE = "subtlety.initiative";
// A draw this high lands a yellow strike with no crit (test/preparation.test.js).
const HIT = 0.99;
const EPSILON = 1e-12;
const CUTTHROAT_CASE = GOLDEN_CASES.find(
  ({ name }) => name === "cutthroat-subtlety-seed-271-60s",
);

function maxRank(id) {
  return talentCatalogue.get(id).max;
}

function percents(id, pattern) {
  return talentCatalogue.get(id).ranks.map((text) => {
    const found = pattern.exec(text);
    assert.ok(found, `${pattern} finds nothing in ${JSON.stringify(text)}`);
    return Number(found[1]) / 100;
  });
}

// A rogue on the dagger/dagger alternate with `talents` alone (their
// modifiers and procs, as test/subtlety-passives.test.js does), in a
// Simulation whose draw `i` (from 0) is roll(i), its draws counted. Full
// energy, no combo points, the GCD clear.
function ready(talents, roll = () => HIT) {
  const { modifiers, procs } = expandTalents(talents);
  const rogue = new Rogue(
    { ...defaultDaggerConfig(), talents: {} },
    { modifiers, procs },
  );
  const counted = { draws: 0 };
  const sim = new Simulation(rogue, {
    rng: () => roll(counted.draws++),
    fightLength: 60,
  });
  rogue.energy = rogue.maxEnergy;
  rogue.comboPoints = 0;
  sim.gcd = 0;
  return { rogue, sim, counted };
}

function cast({ rogue, sim }, key) {
  sim.gcd = 0;
  rogue.energy = rogue.maxEnergy;
  return rogue.abilities[key].cast(rogue, sim);
}

// The draws one landed cast of `key` takes with no talent: the proc's roll,
// if any, is the draw after them.
function drawsOf(key, before) {
  const h = ready({});
  before?.(h);
  cast(h, key);
  return h.counted.draws;
}

const BACKSTAB_DRAWS = drawsOf("backstab");
const AMBUSH_DRAWS = drawsOf("ambush", (h) =>
  h.sim.applyAura(AURAS.cutthroat, { duration: 10 }),
);

// A Backstab whose proc roll is `procRoll`, all else landing with no crit.
function backstabWith(talents, procRoll) {
  const h = ready(talents, (i) => (i === BACKSTAB_DRAWS ? procRoll : HIT));
  cast(h, "backstab");
  return h;
}

describe("Cutthroat, Improved Ambush and Initiative read their rank text (#271)", () => {
  it("Cutthroat: a 3/6/9/12/15% Backstab proc that allows Ambush for 10 s", () => {
    const row = k("cutthroat.proc");
    assert.deepEqual(
      percents(CUTTHROAT, /Backstab has a (\d+)% chance/),
      row.chance,
    );
    for (const text of talentCatalogue.get(CUTTHROAT).ranks) {
      assert.match(text, /next Ambush within (\d+) sec/);
      assert.equal(
        Number(/within (\d+) sec/.exec(text)[1]),
        row.duration,
        text,
      );
    }
    const [spec] = TALENT_EFFECTS[CUTTHROAT].procs;
    assert.equal(spec.id, "cutthroat");
    assert.equal(spec.trigger, "onAbility");
    assert.deepEqual(spec.scope, { abilities: ["backstab"] });
    assert.deepEqual(spec.chance, { mode: "flat", values: row.chance });
    // No rank is certain, so it always draws (G2 allows drawless only for a
    // roll that cannot fail).
    assert.equal(Object.hasOwn(spec, "drawless"), false);
    assert.deepEqual(spec.actions, [
      { type: "applyAura", aura: "cutthroat", duration: row.duration },
    ]);
    assert.equal(AURAS.cutthroat.charges, 1);
    assert.equal(AURAS.cutthroat.name, "Ambush allowed");
  });

  it("Improved Ambush: +15/30/45% crit chance on Ambush", () => {
    const values = percents(IMPROVED, /Ambush ability by (\d+)%/);
    assert.deepEqual(values, k("improvedAmbush.critChance"));
    assert.deepEqual(TALENT_EFFECTS[IMPROVED].modifiers, [
      {
        kind: "critChance",
        op: "add",
        values,
        scope: { abilities: ["ambush"] },
      },
    ]);
  });

  it("Initiative: a 33/67/100% chance of one more combo point on Ambush", () => {
    const row = k("initiative.comboPoint");
    assert.deepEqual(percents(INITIATIVE, /a (\d+)% chance/), row.chance);
    const [spec] = TALENT_EFFECTS[INITIATIVE].procs;
    assert.equal(spec.id, "initiative");
    assert.equal(spec.trigger, "onAbility");
    assert.deepEqual(spec.scope, { abilities: ["ambush"] });
    assert.deepEqual(row.abilities, ["ambush"]);
    assert.deepEqual(spec.chance, { mode: "flat", values: row.chance });
    assert.equal(spec.drawless, "whenCertain");
    assert.deepEqual(spec.actions, [
      { type: "gainResource", resource: "comboPoints", amount: 1 },
    ]);
  });

  it("every new constant has its source (G3)", () => {
    for (const id of [
      "cutthroat.proc",
      "improvedAmbush.critChance",
      "initiative.comboPoint",
    ]) {
      assert.equal(CONSTANTS[id].source, "wowf-export", id);
    }
    assert.equal(CONSTANTS["cutthroat.rules"].source, "assumption");
    assert.match(CONSTANTS["cutthroat.rules"].ref, /issue #271/);
  });
});

describe('a ranked proc with drawless "whenCertain" (#271, G2)', () => {
  const spec = {
    id: "certain-at-max",
    trigger: "onAbility",
    scope: { abilities: ["ambush"] },
    chance: { mode: "flat", values: [0.33, 0.67, 1] },
    drawless: "whenCertain",
    actions: [{ type: "gainResource", resource: "comboPoints", amount: 1 }],
  };

  it("is drawless only at a rank whose chance is 1", () => {
    assert.equal(defineRankedProc(spec, 0), null);
    assert.equal(Object.hasOwn(defineRankedProc(spec, 1), "drawless"), false);
    assert.equal(Object.hasOwn(defineRankedProc(spec, 2), "drawless"), false);
    assert.equal(defineRankedProc(spec, 3).drawless, true);
    assert.equal(defineRankedProc(spec, 3).chance.value, 1);
  });

  it("is a ranked-only value: a single proc still takes true or false", () => {
    assert.throws(
      () =>
        defineProc({
          ...spec,
          chance: { mode: "flat", value: 1 },
        }),
      /drawless must be true or false/,
    );
  });

  it("is never drawless with a chanceBonus or another mode", () => {
    const withBonus = {
      ...spec,
      chanceBonus: { kind: "poisonChance", cap: 1, points: 100 },
    };
    assert.equal(
      Object.hasOwn(defineRankedProc(withBonus, 3), "drawless"),
      false,
    );
    const perSpent = { ...spec, chance: { mode: "perSpent", values: [1] } };
    assert.equal(
      Object.hasOwn(defineRankedProc(perSpent, 1), "drawless"),
      false,
    );
  });
});

describe("Cutthroat's proc (#271)", () => {
  it("at 0 points is no proc: no draw, no aura, nothing granted (G2)", () => {
    for (const talents of [{}, { [CUTTHROAT]: 0 }]) {
      const h = backstabWith(talents, 0);
      assert.equal(h.counted.draws, BACKSTAB_DRAWS);
      assert.equal(h.sim.hasAura("cutthroat"), false);
      assert.equal(h.rogue.grantedAuras.size, 0);
      assert.equal(h.sim.procs.stats.cutthroat, undefined);
    }
  });

  it("grants the aura to the rotation host at any rank above 0", () => {
    for (let rank = 1; rank <= maxRank(CUTTHROAT); rank += 1) {
      const { rogue } = ready({ [CUTTHROAT]: rank });
      assert.deepEqual([...rogue.grantedAuras], ["cutthroat"], `rank ${rank}`);
    }
  });

  it("rolls once per landed Backstab at its rank's chance", () => {
    const chances = k("cutthroat.proc").chance;
    chances.forEach((chance, index) => {
      const talents = { [CUTTHROAT]: index + 1 };
      const below = backstabWith(talents, chance - EPSILON);
      assert.equal(below.counted.draws, BACKSTAB_DRAWS + 1);
      assert.equal(below.sim.hasAura("cutthroat"), true, `${chance} fires`);
      const at = backstabWith(talents, chance);
      assert.equal(at.counted.draws, BACKSTAB_DRAWS + 1);
      assert.equal(at.sim.hasAura("cutthroat"), false, `${chance} misses`);
    });
  });

  it("does not roll on a Backstab that misses, or on another ability", () => {
    const missed = ready({ [CUTTHROAT]: 5 }, () => 0);
    cast(missed, "backstab");
    assert.equal(missed.sim.procs.stats.cutthroat.rolls, 0);
    assert.equal(missed.sim.hasAura("cutthroat"), false);
    const other = ready({ [CUTTHROAT]: 5 }, () => 0.5);
    cast(other, "sinisterStrike");
    assert.equal(other.sim.procs.stats.cutthroat.rolls, 0);
  });

  it("puts the aura up for 10 s with one charge, and it ends at 10 s", () => {
    const h = backstabWith({ [CUTTHROAT]: 5 }, 0);
    const aura = h.sim.activeBuffs.cutthroat;
    assert.equal(aura.duration, k("cutthroat.proc").duration);
    assert.equal(aura.charges, 1);
    const log = [];
    h.sim.on("aura", (event) => log.push(event));
    h.sim.run(k("cutthroat.proc").duration - 0.01);
    assert.equal(h.sim.hasAura("cutthroat"), true);
    h.sim.run(0.02);
    assert.equal(h.sim.hasAura("cutthroat"), false);
  });

  it("a proc while the aura is up starts its 10 s over, with one charge", () => {
    const h = backstabWith({ [CUTTHROAT]: 5 }, 0);
    h.sim.activeBuffs.cutthroat.duration = 2;
    h.sim.activeBuffs.cutthroat.charges = 0;
    h.counted.draws = 0;
    cast(h, "backstab");
    assert.equal(h.sim.activeBuffs.cutthroat.duration, 10);
    assert.equal(h.sim.activeBuffs.cutthroat.charges, 1);
  });

  it("one Ambush uses the aura and a second Ambush is refused", () => {
    const h = backstabWith({ [CUTTHROAT]: 5 }, 0);
    assert.notEqual(cast(h, "ambush"), null);
    assert.equal(h.sim.hasAura("cutthroat"), false);
    const before = h.counted.draws;
    assert.equal(cast(h, "ambush"), null);
    assert.equal(h.counted.draws, before);
    assert.equal(h.sim.abilityStats.ambush.casts, 1);
  });
});

describe("Improved Ambush (#271)", () => {
  it("adds exactly 15% crit chance per rank to Ambush and nothing to Backstab", () => {
    const base = ready({});
    const crit = (h, id) => h.rogue.getCritChance(h.sim.abilityContext(id));
    for (let rank = 1; rank <= maxRank(IMPROVED); rank += 1) {
      const h = ready({ [IMPROVED]: rank });
      const added = crit(h, "ambush") - crit(base, "ambush");
      assert.ok(
        Math.abs(added - k("improvedAmbush.critChance")[rank - 1]) < EPSILON,
        `rank ${rank}: ${added}`,
      );
      assert.equal(crit(h, "backstab"), crit(base, "backstab"));
    }
  });
});

describe("Initiative (#271)", () => {
  // An Ambush with the aura up, every draw HIT but the one after the
  // Ambush's own (Initiative's roll, if it rolls), which is `procRoll`.
  function ambushWith(talents, procRoll = HIT) {
    const h = ready(talents, (i) => (i === AMBUSH_DRAWS ? procRoll : HIT));
    h.sim.applyAura(AURAS.cutthroat, { duration: 10 });
    cast(h, "ambush");
    return h;
  }

  it("at 0 points adds nothing and draws nothing (G2)", () => {
    const h = ambushWith({ [INITIATIVE]: 0 }, 0);
    assert.equal(h.rogue.comboPoints, k("ambush").comboPoints);
    assert.equal(h.counted.draws, AMBUSH_DRAWS);
  });

  it("at 1 and 2 points rolls once at 33% and 67%", () => {
    k("initiative.comboPoint")
      .chance.slice(0, 2)
      .forEach((chance, index) => {
        const talents = { [INITIATIVE]: index + 1 };
        const fired = ambushWith(talents, chance - EPSILON);
        assert.equal(fired.counted.draws, AMBUSH_DRAWS + 1);
        assert.equal(fired.rogue.comboPoints, k("ambush").comboPoints + 1);
        const missed = ambushWith(talents, chance);
        assert.equal(missed.counted.draws, AMBUSH_DRAWS + 1);
        assert.equal(missed.rogue.comboPoints, k("ambush").comboPoints);
      });
  });

  it("at 3 points always adds the point, with no draw (G2: drawless)", () => {
    const h = ambushWith({ [INITIATIVE]: 3 });
    assert.equal(h.counted.draws, AMBUSH_DRAWS);
    assert.equal(h.rogue.comboPoints, k("ambush").comboPoints + 1);
    assert.equal(h.sim.procs.stats.initiative.fires, 1);
  });

  it("gives nothing on an Ambush that misses", () => {
    const h = ready({ [INITIATIVE]: 3 }, () => 0);
    h.sim.applyAura(AURAS.cutthroat, { duration: 10 });
    cast(h, "ambush");
    assert.equal(h.rogue.comboPoints, 0);
    assert.equal(h.sim.procs.stats.initiative.fires, 0);
  });

  it("caps at five combo points", () => {
    const h = ready({ [INITIATIVE]: 3 });
    h.sim.applyAura(AURAS.cutthroat, { duration: 10 });
    h.rogue.comboPoints = k("combo.max") - 1;
    cast(h, "ambush");
    assert.equal(h.rogue.comboPoints, k("combo.max"));
  });
});

describe("a Cutthroat build in a fight (#271)", () => {
  const config = (talents, rotation = AMBUSH_ROTATION) => ({
    ...defaultDaggerConfig(),
    talents,
    rotation,
  });

  it("the golden build is legal and casts Ambush only after a Cutthroat proc", () => {
    assert.equal(validateBuild(CUTTHROAT_BUILD), 51);
    assert.deepEqual(applyBuild(CUTTHROAT_BUILD).unmapped, []);
    const fight = createFight(271, config(CUTTHROAT_BUILD), { duration: 60 });
    const order = [];
    fight.simulation.on("*", (event) => {
      if (event.type === "aura" && event.aura === "cutthroat") {
        order.push(`aura ${event.change}`);
      } else if (event.type === "cast" && event.ability === "ambush") {
        order.push("ambush");
      }
    });
    fight.simulation.run(60);
    const ambushes = order.filter((entry) => entry === "ambush").length;
    assert.ok(ambushes > 0, "Ambush is cast");
    // Each Ambush follows an apply (or refresh) of the aura, and uses it.
    order.forEach((entry, index) => {
      if (entry === "ambush") {
        assert.match(order[index - 1], /^aura (apply|refresh)$/);
        assert.equal(order[index + 1], "aura expire");
      }
    });
    assert.ok(ambushes <= fight.simulation.procs.stats.cutthroat.fires);
  });

  it("is the golden fixture's config", () => {
    assert.ok(CUTTHROAT_CASE, "the golden case exists");
    assert.deepEqual(CUTTHROAT_CASE.config.talents, CUTTHROAT_BUILD);
    assert.deepEqual(CUTTHROAT_CASE.config.rotation, AMBUSH_ROTATION);
  });

  it("without Cutthroat the Ambush rule is passed over, never pooled for (G2)", () => {
    // The #269 Subtlety build has no Cutthroat.
    const without = SUBTLETY_BUILD;
    const rotation = {
      ...AMBUSH_ROTATION,
      rules: AMBUSH_ROTATION.rules.filter(({ action }) => action !== "ambush"),
    };
    const a = runFight({ seed: 5, duration: 120, config: config(without) });
    const b = runFight({
      seed: 5,
      duration: 120,
      config: config(without, rotation),
    });
    assert.equal(a.abilities.Ambush, undefined);
    // The same fight but for the config (with its rotation) it echoes.
    const { config: configA, ...restA } = a;
    const { config: configB, ...restB } = b;
    assert.notDeepEqual(configA.rotation, configB.rotation);
    assert.deepEqual(restA, restB);
  });

  it("an old config, with none of the three talents, reads as 0 points (G4)", () => {
    const old = runFight({
      seed: 9,
      duration: 60,
      config: config(SUBTLETY_BUILD),
    });
    const zero = runFight({
      seed: 9,
      duration: 60,
      config: config({
        ...SUBTLETY_BUILD,
        [CUTTHROAT]: 0,
        [IMPROVED]: 0,
        [INITIATIVE]: 0,
      }),
    });
    assert.deepEqual(zero, old);
    const fight = createFight(9, config(SUBTLETY_BUILD), { duration: 60 });
    assert.equal(fight.rogue.grantedAuras.size, 0);
  });
});
