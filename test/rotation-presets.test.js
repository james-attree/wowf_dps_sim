import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { createFight, runFight } from "../js/fight.js";
import { normalizeConfig } from "../js/sim-config.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import {
  indexPresets,
  listPresets,
  loadPreset,
  presetRotation,
} from "../js/rotation-presets.js";
import { summarizeRotation } from "../js/rotation-summary.js";
import { validateRotation } from "../js/rotation-validator.js";
import { withDaggers } from "./combat-daggers-328.js";

// R5 (#142): the preset registry, its API, and the Combat swords preset.

const DOCS = await readFile(
  new URL("../docs/rotation.md", import.meta.url),
  "utf8",
);
const COMBAT = k("presetRotation.combat");
const SND_COST = k("sliceAndDice").energy;
const SS_COST = k("sinisterStrike").energy;
const EVISCERATE_COST = k("eviscerate").energy;
const ENERGY_MAX = k("energy.max");

describe("the preset registry", () => {
  it("has presets with a unique id, a name and a description, each valid", () => {
    assert.ok(ROTATION_PRESETS.length >= 1);
    const ids = ROTATION_PRESETS.map((preset) => preset.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const preset of ROTATION_PRESETS) {
      assert.match(preset.id, /^[a-z]+(-[a-z]+)*$/);
      assert.ok(preset.name.length > 0 && preset.description.length > 0);
      assert.equal(preset.rotation.name, preset.name);
      assert.deepEqual(validateRotation(preset.rotation), [], preset.id);
      // Plain JSON: it survives a round trip unchanged.
      assert.deepEqual(
        JSON.parse(JSON.stringify(preset.rotation)),
        preset.rotation,
      );
    }
  });

  it("is frozen all the way down, so no caller changes a preset (#155)", () => {
    const unfrozen = [];
    const walk = (value, path) => {
      if (value !== null && typeof value === "object") {
        if (!Object.isFrozen(value)) {
          unfrozen.push(path);
        }
        for (const [key, member] of Object.entries(value)) {
          walk(member, `${path}.${key}`);
        }
      }
    };
    walk(ROTATION_PRESETS, "ROTATION_PRESETS");
    assert.deepEqual(unfrozen, []);
    assert.throws(() => {
      ROTATION_PRESETS[0].rotation.rules[0].conditions.push({});
    }, TypeError);
  });

  it("has a Combat swords preset", () => {
    assert.ok(ROTATION_PRESETS.some((preset) => preset.id === "combat-swords"));
  });
});

describe("indexPresets", () => {
  const good = ROTATION_PRESETS[0];

  it("indexes a list by id", () => {
    const byId = indexPresets([good]);
    assert.equal(byId.get(good.id), good);
    assert.equal(byId.size, 1);
  });

  it("refuses two presets with one id", () => {
    assert.throws(() => indexPresets([good, good]), {
      name: "RangeError",
      message: /share an id/,
    });
  });

  it("refuses a preset whose rotation the validator refuses", () => {
    const bad = {
      ...good,
      id: "bad",
      rotation: { ...good.rotation, rules: [] },
    };
    assert.throws(() => indexPresets([good, bad]), /Bad rotation/);
  });
});

describe("the preset API", () => {
  it("lists id, name, description and the readable summary, in order", () => {
    const list = listPresets();
    assert.deepEqual(
      list.map((entry) => entry.id),
      ROTATION_PRESETS.map((preset) => preset.id),
    );
    for (const [index, entry] of list.entries()) {
      const preset = ROTATION_PRESETS[index];
      assert.deepEqual(Object.keys(entry), [
        "id",
        "name",
        "description",
        "summary",
      ]);
      assert.equal(entry.name, preset.name);
      assert.equal(entry.description, preset.description);
      assert.equal(entry.summary, summarizeRotation(preset.rotation));
    }
  });

  it("gives a new copy each time, so changing one changes nothing else", () => {
    const first = presetRotation("combat-swords");
    first.rules.pop();
    first.name = "changed";
    first.rules[0].conditions.length = 0;
    const second = presetRotation("combat-swords");
    assert.notEqual(second, first);
    assert.deepEqual(second, ROTATION_PRESETS[0].rotation);
    assert.deepEqual(validateRotation(second), []);
  });

  it("rejects an id that is not a preset, naming the ids", () => {
    for (const id of [
      "nope",
      "",
      undefined,
      null,
      1,
      "__proto__",
      "toString",
    ]) {
      assert.throws(
        () => presetRotation(id),
        (error) =>
          error instanceof RangeError && /combat-swords/.test(error.message),
        String(id),
      );
    }
    assert.throws(() => loadPreset("nope"), RangeError);
  });

  it("loads a preset into a config without changing the config", () => {
    const config = { talents: { "combat.precision": 5 }, weapons: {} };
    const frozen = structuredClone(config);
    const loaded = loadPreset("combat-swords", config);
    assert.deepEqual(config, frozen);
    assert.deepEqual(loaded.talents, config.talents);
    assert.deepEqual(loaded.rotation, ROTATION_PRESETS[0].rotation);
    assert.notEqual(loaded, config);
    assert.deepEqual(Object.keys(loadPreset("combat-swords")), ["rotation"]);
    // A rotation already in the config is replaced, not merged.
    const other = loadPreset("combat-swords", { rotation: { name: "x" } });
    assert.deepEqual(other.rotation, ROTATION_PRESETS[0].rotation);
  });

  it("runs from createFight and runFight, and the result's config carries the rotation", () => {
    const config = loadPreset("combat-swords");
    const fight = createFight(3, config);
    assert.equal(fight.rogue.config.rotation.name, "Combat swords");
    const result = runFight({ seed: 3, duration: 60, config });
    assert.deepEqual(result.config.rotation, ROTATION_PRESETS[0].rotation);
    assert.ok(result.totalDamage > 0);
    assert.deepEqual(result.config, normalizeConfig(config));
    const again = runFight({ seed: 3, duration: 60, config: result.config });
    assert.deepEqual(again, result);
  });

  it("is not the default: a fight with no preset keeps the placeholder rotation", () => {
    const result = runFight({ seed: 3, duration: 30 });
    assert.notEqual(result.config.rotation.name, "Combat swords");
  });
});

describe("the readable summary in docs/rotation.md", () => {
  const presets = DOCS.slice(
    DOCS.indexOf("\n## Presets"),
    DOCS.indexOf("\n## Examples"),
  );
  const blocks = [...presets.matchAll(/```text\n([\s\S]*?)```/g)].map((match) =>
    match[1].trimEnd(),
  );

  it("shows each preset's summary exactly as summarizeRotation writes it", () => {
    for (const preset of ROTATION_PRESETS) {
      assert.ok(
        blocks.includes(summarizeRotation(preset.rotation)),
        `${preset.id}'s summary is in the Presets section`,
      );
      assert.ok(presets.includes(`### ${preset.id}`), preset.id);
    }
  });

  // Kira's #304 N7: the summary is the first text block under the preset's
  // own heading, not just somewhere in the section.
  it("puts each summary under its own preset heading", () => {
    for (const preset of ROTATION_PRESETS) {
      const start = presets.indexOf(`\n### ${preset.id}\n`);
      assert.ok(start >= 0, preset.id);
      const rest = presets.slice(start + 1);
      const next = rest.indexOf("\n### ");
      const section = next < 0 ? rest : rest.slice(0, next);
      const block = /```text\n([\s\S]*?)```/.exec(section);
      assert.ok(block !== null, `${preset.id} has a summary block`);
      assert.equal(
        block[1].trimEnd(),
        summarizeRotation(preset.rotation),
        preset.id,
      );
    }
  });

  it("names the constants row each preset reads its numbers from (#310)", () => {
    for (const row of [
      "presetRotation.combat",
      "presetRotation.assassination",
      "presetRotation.subtlety",
      ...withDaggers([], "presetRotation.combatDaggers"),
    ]) {
      assert.ok(presets.includes(`\`${row}\``), row);
    }
  });
});

// A scene the Combat swords rules are walked on: no engine, a fake host. The
// energy decides what can be cast (the cost of each ability from the data),
// the GCD is clear, and the cast is logged.
const COSTS = {
  "sinister-strike": SS_COST,
  eviscerate: EVISCERATE_COST,
  "slice-and-dice": SND_COST,
  "blade-flurry": k("bladeFlurry").energy,
  "adrenaline-rush": 0,
  "cold-blood": 0,
};
const OFF_GCD = new Set(["cold-blood"]);

function walk({
  energy,
  comboPoints,
  slice = null,
  ready = ["blade-flurry", "adrenaline-rush"],
  granted = [],
}) {
  // Blade Flurry and Adrenaline Rush are on cooldown unless listed in `ready`.
  const cooldown = ["blade-flurry", "adrenaline-rush"].filter(
    (id) => !ready.includes(id),
  );
  const log = [];
  const host = {
    state: () => ({
      resources: {
        energy: { value: energy, max: ENERGY_MAX, regenPerSecond: 10 },
        comboPoints: { value: comboPoints, max: 5, regenPerSecond: 0 },
      },
      auras: slice === null ? {} : { "slice-and-dice": { remaining: slice } },
      debuffs: {},
      cooldowns: Object.fromEntries(cooldown.map((id) => [id, 1])),
      build: { selected: false },
      granted,
      talentAbilities: [],
      time: 0,
      duration: null,
    }),
    canCast: (id) =>
      id in COSTS &&
      (id !== "cold-blood" || granted.includes(id)) &&
      energy >= COSTS[id] &&
      (!["blade-flurry", "adrenaline-rush"].includes(id) ||
        ready.includes(id)) &&
      (id !== "slice-and-dice" || comboPoints >= 1),
    onGcd: (id) => !OFF_GCD.has(id),
    gcdClear: () => true,
    cast: (id) => log.push(id),
  };
  const { outcome } = decide(
    compileRotation(presetRotation("combat-swords")),
    host,
  );
  return { outcome, log };
}

describe("Combat swords: James's rotation (#310)", () => {
  const quiet = { ready: [] };
  const finisher = COMBAT.finisherComboPoints;
  const low = COMBAT.sliceAndDiceComboPoints;
  const long = COMBAT.eviscerateSliceAndDiceSeconds;
  // Energy this far from the cap is more than energyToCapSeconds away.
  const MID = 60;

  it("builds with Sinister Strike below the finisher's combo points", () => {
    for (const comboPoints of [0, low, finisher - 1]) {
      const scene = walk({ ...quiet, energy: MID, comboPoints, slice: long });
      assert.deepEqual(scene.log, ["sinister-strike"], `${comboPoints} CP`);
    }
  });

  it("casts Eviscerate at the finisher's points while Slice and Dice has long enough", () => {
    const scene = walk({
      ...quiet,
      energy: MID,
      comboPoints: finisher,
      slice: long,
    });
    assert.deepEqual(scene.log, ["eviscerate"]);
  });

  it("below that at the finisher's points, waits until the energy is about to cap, then Eviscerates", () => {
    const below = long - COMBAT.sliceAndDiceRecastSeconds;
    const waiting = walk({
      ...quiet,
      energy: MID,
      comboPoints: finisher,
      slice: below,
    });
    assert.deepEqual(waiting.log, []);
    assert.equal(waiting.outcome, "none");
    const regen = 10;
    const nearCap = ENERGY_MAX - (COMBAT.energyToCapSeconds * regen) / 2;
    const capped = walk({
      ...quiet,
      energy: nearCap,
      comboPoints: finisher,
      slice: below,
    });
    assert.deepEqual(capped.log, ["eviscerate"]);
  });

  it("recasts Slice and Dice at its combo points when it is missing or about to end, and pools for it when short", () => {
    const near = COMBAT.sliceAndDiceRecastSeconds / 2;
    for (const slice of [null, near]) {
      const cast = walk({
        ...quiet,
        energy: SND_COST,
        comboPoints: low,
        slice,
      });
      assert.deepEqual(cast.log, ["slice-and-dice"], String(slice));
    }
    const short = walk({
      ...quiet,
      energy: SND_COST - 1,
      comboPoints: low,
      slice: near,
    });
    assert.deepEqual(short.log, []);
    assert.equal(short.outcome, "pooling");
    // At the recast time exactly, and below its points, it is not recast.
    const exactly = walk({
      ...quiet,
      energy: MID,
      comboPoints: low,
      slice: COMBAT.sliceAndDiceRecastSeconds,
    });
    assert.deepEqual(exactly.log, ["sinister-strike"]);
    const fewer = walk({ ...quiet, energy: MID, comboPoints: low - 1 });
    assert.deepEqual(fewer.log, ["sinister-strike"]);
  });

  it("casts Adrenaline Rush under its energy with Slice and Dice up, and not otherwise", () => {
    const rushReady = { ready: ["adrenaline-rush"], comboPoints: 0 };
    const under = COMBAT.adrenalineRushEnergyBelow - 1;
    const rush = walk({ ...rushReady, energy: under, slice: long });
    assert.deepEqual(rush.log, ["adrenaline-rush"]);
    const full = walk({
      ...rushReady,
      energy: COMBAT.adrenalineRushEnergyBelow + SS_COST,
      slice: long,
    });
    assert.deepEqual(full.log, ["sinister-strike"]);
    const noSlice = walk({ ...rushReady, energy: under });
    assert.deepEqual(noSlice.log, []);
    assert.equal(noSlice.outcome, "pooling", "Sinister Strike waits");
  });

  it("casts Blade Flurry with Slice and Dice up, and pools for its energy", () => {
    const flurry = walk({
      ready: ["blade-flurry"],
      energy: MID,
      comboPoints: 0,
      slice: long,
    });
    assert.deepEqual(flurry.log, ["blade-flurry"]);
    const short = walk({
      ready: ["blade-flurry"],
      energy: 0,
      comboPoints: 0,
      slice: long,
    });
    assert.deepEqual(short.log, [], "Blade Flurry waits for its energy");
    assert.equal(short.outcome, "pooling");
    const noSlice = walk({
      ready: ["blade-flurry"],
      energy: MID,
      comboPoints: 0,
    });
    assert.deepEqual(noSlice.log, ["sinister-strike"]);
  });

  it("casts a granted Cold Blood right before Eviscerate, and not when it is not granted", () => {
    const granted = walk({
      ...quiet,
      energy: MID,
      comboPoints: finisher,
      slice: long,
      granted: ["cold-blood"],
    });
    assert.deepEqual(granted.log, ["cold-blood", "eviscerate"]);
    const plain = walk({
      ...quiet,
      energy: MID,
      comboPoints: finisher,
      slice: long,
    });
    assert.deepEqual(plain.log, ["eviscerate"]);
  });
});

describe("Combat swords does not rely on Backstab", () => {
  it("has no Backstab rule, and never casts it, even with a dagger main hand", () => {
    assert.ok(
      ROTATION_PRESETS[0].rotation.rules.every(
        (rule) => rule.action !== "backstab",
      ),
    );
    for (const type of ["sword", "dagger"]) {
      const config = loadPreset("combat-swords", {
        weapons: { mainHand: { type } },
      });
      const fight = createFight(4, config);
      fight.simulation.run(60);
      assert.equal(fight.simulation.abilityStats.backstab?.casts ?? 0, 0, type);
      assert.ok(fight.simulation.abilityStats["sinister-strike"].casts > 0);
    }
  });
});
