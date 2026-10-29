import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { k } from "../data/constants.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { createFight, runFight } from "../js/fight.js";
import { normalizeConfig } from "../js/sim-config.js";
import { compileRotation, decide } from "../js/rotation-interpreter.js";
import {
  listPresets,
  loadPreset,
  presetRotation,
} from "../js/rotation-presets.js";
import { summarizeRotation } from "../js/rotation-summary.js";
import { validateRotation } from "../js/rotation-validator.js";

// R5 (#142): the preset registry, its API, and the Combat swords preset.

const DOCS = await readFile(
  new URL("../docs/rotation.md", import.meta.url),
  "utf8",
);
const FINISHER = k("rotation.finisherComboPoints");
const { windowSeconds: WINDOW, recastSeconds: RECAST } = k("rotation.pooling");
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

  it("has a Combat swords preset", () => {
    assert.ok(ROTATION_PRESETS.some((preset) => preset.id === "combat-swords"));
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

  it("states the pooling numbers the preset reads", () => {
    assert.ok(presets.includes(`${WINDOW} seconds or less`));
    assert.ok(presets.includes(`${RECAST} second left`));
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

describe("Combat swords: Slice and Dice pooling (#122)", () => {
  const quiet = { ready: [] };

  it("builds with Sinister Strike below the finisher's combo points", () => {
    for (const comboPoints of [0, FINISHER - 1]) {
      const scene = walk({ ...quiet, energy: 60, comboPoints, slice: 12 });
      assert.deepEqual(scene.log, ["sinister-strike"]);
    }
  });

  it("casts Eviscerate at the finisher's points while Slice and Dice has time", () => {
    const scene = walk({
      ...quiet,
      energy: 60,
      comboPoints: FINISHER,
      slice: WINDOW + 0.5,
    });
    assert.deepEqual(scene.log, ["eviscerate"]);
  });

  it("waits inside the window: no Eviscerate and no builder, energy is kept", () => {
    for (const energy of [SND_COST, 60, ENERGY_MAX - 1]) {
      const scene = walk({
        ...quiet,
        energy,
        comboPoints: FINISHER,
        slice: WINDOW,
      });
      assert.deepEqual(scene.log, [], `energy ${energy}`);
      assert.equal(scene.outcome, "none");
    }
  });

  it("recasts Slice and Dice below the recast time, and pools for the energy when short", () => {
    const near = RECAST / 2;
    const cast = walk({
      ...quiet,
      energy: SND_COST,
      comboPoints: FINISHER,
      slice: near,
    });
    assert.deepEqual(cast.log, ["slice-and-dice"]);
    const short = walk({
      ...quiet,
      energy: SND_COST - 1,
      comboPoints: FINISHER,
      slice: near,
    });
    assert.deepEqual(short.log, []);
    assert.equal(short.outcome, "pooling");
    // At the recast time exactly it is still waiting.
    const exactly = walk({
      ...quiet,
      energy: 60,
      comboPoints: FINISHER,
      slice: RECAST,
    });
    assert.deepEqual(exactly.log, []);
  });

  it("recasts at once when Slice and Dice is missing", () => {
    const scene = walk({ ...quiet, energy: SND_COST, comboPoints: FINISHER });
    assert.deepEqual(scene.log, ["slice-and-dice"]);
  });

  it("casts at the energy cap inside the window, and not a point below", () => {
    const full = walk({
      ...quiet,
      energy: ENERGY_MAX,
      comboPoints: FINISHER,
      slice: WINDOW,
    });
    assert.deepEqual(full.log, ["slice-and-dice"]);
    const outside = walk({
      ...quiet,
      energy: ENERGY_MAX,
      comboPoints: FINISHER,
      slice: WINDOW + 0.5,
    });
    assert.deepEqual(outside.log, ["eviscerate"]);
  });

  it("does not recast Slice and Dice below the finisher's points", () => {
    const scene = walk({
      ...quiet,
      energy: ENERGY_MAX,
      comboPoints: FINISHER - 1,
      slice: RECAST / 2,
    });
    assert.deepEqual(scene.log, ["sinister-strike"]);
  });

  it("casts Blade Flurry, then Adrenaline Rush, ahead of the rest: each is on the GCD and ends the walk", () => {
    const both = walk({ energy: 60, comboPoints: 0, slice: 12 });
    assert.deepEqual(both.log, ["blade-flurry"]);
    const rush = walk({
      energy: 60,
      comboPoints: 0,
      slice: 12,
      ready: ["adrenaline-rush"],
    });
    assert.deepEqual(rush.log, ["adrenaline-rush"]);
    const short = walk({
      energy: 0,
      comboPoints: 0,
      slice: 12,
      ready: ["blade-flurry"],
    });
    assert.deepEqual(short.log, [], "Blade Flurry waits for its energy");
    assert.equal(short.outcome, "pooling");
  });

  it("casts a granted Cold Blood right before Eviscerate, and not when it is not granted", () => {
    const granted = walk({
      ...quiet,
      energy: 60,
      comboPoints: FINISHER,
      slice: 12,
      granted: ["cold-blood"],
    });
    assert.deepEqual(granted.log, ["cold-blood", "eviscerate"]);
    const plain = walk({
      ...quiet,
      energy: 60,
      comboPoints: FINISHER,
      slice: 12,
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
