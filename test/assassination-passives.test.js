import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSTANTS, k } from "../data/constants.js";
import { TALENT_EFFECTS } from "../data/talent-effects.js";
import { abilityCatalogue } from "../js/abilities.js";
import { createFight, expandTalents } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";
import { talentCatalogue } from "../js/talents.js";
import {
  ASSASSINATION_BUILD,
  GOLDEN_CASES,
} from "../scripts/golden-update.mjs";

// Issue #266 (P4.6-03): Vigor, Vile Poisons, Seal Fate, Murder and Improved
// Poisons, and the three Assassination talents with no DPS effect.

const POISONS = { mainHand: "instant", offHand: "deadly" };
const HALF = 0.5;
const RELATIVE = 1e-12;
const VILE = 0.2;
const IMPROVED = 0.1;

function without(ids) {
  return Object.fromEntries(
    Object.entries(ASSASSINATION_BUILD).filter(([id]) => !ids.includes(id)),
  );
}

function sources(modifiers, id) {
  return modifiers.filter((modifier) => modifier.source === id);
}

describe("Assassination passives (#266)", () => {
  it("map each talent's rank text, at every rank", () => {
    const read = (id, pattern) =>
      talentCatalogue
        .get(id)
        .ranks.map((text) => Number(pattern.exec(text)[1]));
    const values = (id) => TALENT_EFFECTS[id].modifiers[0].values;
    assert.deepEqual(
      values("assassination.vigor"),
      read("assassination.vigor", /maximum Energy by (\d+)/),
    );
    for (const [id, pattern] of [
      ["assassination.vile-poisons", /poisons by (\d+)%/],
      ["assassination.murder", /by (\d+)% against/],
      ["assassination.improved-poisons", /target by (\d+)%/],
    ]) {
      assert.deepEqual(
        values(id),
        read(id, pattern).map((percent) => percent / 100),
        id,
      );
    }
    const [sealFate] = TALENT_EFFECTS["assassination.seal-fate"].procs;
    assert.deepEqual(
      sealFate.chance.values,
      read("assassination.seal-fate", /have a (\d+)% chance/).map(
        (percent) => percent / 100,
      ),
    );
    assert.equal(CONSTANTS["sealFate.comboPoint"].source, "wowf-export");
    assert.deepEqual(k("murder.mobTypes"), ["humanoid", "giant"]);
  });

  it("Vigor raises the energy cap to 110, a whole number; no Vigor leaves 100", () => {
    const base = new Rogue().resources.energy.max;
    const vigor = new Rogue({ talents: ASSASSINATION_BUILD }).resources.energy
      .max;
    assert.equal(vigor, base + 10);
    assert.equal(vigor, 110);
    assert.ok(Number.isInteger(vigor));
    const none = new Rogue({ talents: without(["assassination.vigor"]) });
    assert.equal(none.resources.energy.max, base);
  });

  it("Vile Poisons is +20% exact on Instant Poison hits and Deadly Poison ticks", () => {
    const fight = (talents) => {
      const result = createFight(5, { talents, poisons: POISONS });
      const hits = [];
      result.simulation.events.on("hit", (event) => {
        if (/poison/.test(event.ability) && event.damage > 0) {
          hits.push(event);
        }
      });
      result.simulation.run(60);
      return { result, hits };
    };
    const vile = fight(ASSASSINATION_BUILD);
    const plain = fight(without(["assassination.vile-poisons"]));
    const { modifiers } = vile.result.rogue;
    for (const id of ["instant-poison", "deadly-poison"]) {
      const context = vile.result.simulation.abilityContext(id);
      assert.equal(modifiers.resolve("damage", 100, context), 100 * (1 + VILE));
    }
    assert.equal(vile.hits.length, plain.hits.length);
    const kinds = new Set();
    vile.hits.forEach((hit, index) => {
      const other = plain.hits[index];
      assert.equal(hit.time, other.time);
      assert.equal(hit.ability, other.ability);
      kinds.add(`${hit.ability}/${hit.origin}`);
      const ratio = hit.damage / other.damage;
      assert.ok(Math.abs(ratio - (1 + VILE)) < RELATIVE, `${ratio}`);
    });
    assert.ok(kinds.has("instant-poison/poison"));
    assert.ok(kinds.has("deadly-poison/dot"));
  });

  it("Improved Poisons 5/5 adds 10 points to each poison's chance; its charges half is inert", () => {
    const rogue = new Rogue({ talents: ASSASSINATION_BUILD, poisons: POISONS });
    assert.deepEqual(
      rogue.procs
        .filter((proc) => /poison/.test(proc.id))
        .map((proc) => [proc.id, proc.chance.value]),
      [
        ["instant-poison.mainHand", 0.2 + IMPROVED],
        ["deadly-poison.offHand", 0.3 + IMPROVED],
      ],
    );
    assert.equal(k("poison.charges"), "unlimited");
  });

  it("Seal Fate fires on CP builder crits only, and with Ruthlessness never passes 5 CP (A8)", () => {
    const builders = abilityCatalogue.abilities
      .filter((ability) => ability.comboPointsAwarded > 0)
      .map((ability) => ability.id);
    const [spec] = TALENT_EFFECTS["assassination.seal-fate"].procs;
    assert.equal(spec.trigger, "onCrit");
    assert.deepEqual([...spec.scope.abilities].sort(), builders.sort());
    // Every attack crits (critChance 1), every roll is 0.5: Seal Fate 5/5
    // always fires, Ruthlessness 3/3 (60%) always fires.
    const rogue = new Rogue({
      talents: ASSASSINATION_BUILD,
      character: { critChance: 1 },
    });
    const sim = new Simulation(rogue, { rng: () => HALF, fightLength: 120 });
    const points = [];
    sim.events.on("resource", (event) => {
      if (event.resource === "comboPoints") {
        points.push(event);
      }
    });
    sim.run(120);
    const max = k("combo.max");
    assert.ok(points.every((event) => event.after <= max));
    const sealFate = points.filter((event) => event.source === "seal-fate");
    assert.ok(sealFate.length > 0);
    assert.ok(points.some((event) => event.source === "ruthlessness"));
    // A point over the cap is lost: the pool does not report a gain that
    // added nothing, and counts the point as overflow.
    assert.ok(rogue.resources.comboPoints.waste().overflow > 0);
    assert.ok(sealFate.every((event) => event.before < max));
    assert.ok(
      sealFate.every(
        (event) => event.after === Math.min(max, event.before + 1),
      ),
    );
    // Each one follows a builder's own gain at the same time.
    for (const event of sealFate) {
      const index = points.indexOf(event);
      assert.ok(builders.includes(points[index - 1].source), event.time);
      assert.equal(points[index - 1].time, event.time);
    }
  });

  it("Murder is inert while target.mobType is unspecified", () => {
    assert.equal(k("target.mobType"), "unspecified");
    const build = expandTalents({ "assassination.murder": 2 });
    assert.deepEqual(sources(build.modifiers, "assassination.murder"), []);
    assert.deepEqual(build.unmapped, []);
    const humanoid = expandTalents(
      { "assassination.murder": 2 },
      undefined,
      undefined,
      {
        mobType: "humanoid",
      },
    );
    assert.deepEqual(
      sources(humanoid.modifiers, "assassination.murder").map((modifier) => [
        modifier.kind,
        modifier.op,
        modifier.value,
      ]),
      [["damage", "add", 0.04]],
    );
    const beast = expandTalents(
      { "assassination.murder": 2 },
      undefined,
      undefined,
      {
        mobType: "beast",
      },
    );
    assert.deepEqual(sources(beast.modifiers, "assassination.murder"), []);
  });

  it("says why Improved Gouge, Remorseless Attacks and Improved Kidney Shot do nothing", () => {
    const build = expandTalents(ASSASSINATION_BUILD);
    for (const id of [
      "assassination.improved-gouge",
      "assassination.remorseless-attacks",
      "assassination.improved-kidney-shot",
    ]) {
      assert.match(TALENT_EFFECTS[id].noDpsEffect, /^[^\n]{10,}$/, id);
      assert.ok(build.noDps.includes(id), id);
    }
    assert.deepEqual(build.unmapped, []);
  });

  it("registers no proc and draws nothing at 0 points (G2, Seal Fate)", () => {
    assert.deepEqual(expandTalents({ "assassination.seal-fate": 0 }).procs, []);
    const rogue = new Rogue({ talents: without(["assassination.seal-fate"]) });
    assert.ok(!rogue.procs.some((proc) => proc.id === "seal-fate"));
  });

  it("an old config, with none of these talents, reads their defaults (G4)", () => {
    const rogue = new Rogue({});
    assert.equal(rogue.resources.energy.max, k("energy.max"));
    assert.deepEqual(rogue.procs, []);
    assert.equal(rogue.modifiers.resolve("poisonChance", 0), 0);
  });

  it("has an Assassination-build golden case with poisons", () => {
    const found = GOLDEN_CASES.find(
      (goldenCase) => goldenCase.name === "assassination-build-seed-266-60s",
    );
    assert.deepEqual(found.config.talents, ASSASSINATION_BUILD);
    assert.deepEqual(found.config.poisons, POISONS);
  });
});
