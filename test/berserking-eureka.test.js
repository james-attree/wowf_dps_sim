import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import { RACIAL_EFFECTS } from "../data/racial-effects.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { abilityCatalogue } from "../js/abilities.js";
import { ABILITY_DEFINITIONS } from "../js/ability-data.js";
import { AURAS } from "../js/auras.js";
import { createFight, runFight } from "../js/fight.js";
import { FightAuras } from "../js/fight-metrics.js";
import {
  expandRace,
  raceCatalogue,
  raceGrantedAbilities,
  racialStatus,
} from "../js/racials.js";
import { RESOURCE_DEFINITIONS } from "../js/resource-data.js";
import { resolveCost } from "../js/resource.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";
import { talentState, skipOf } from "../js/rotation-skips.js";
import { validateRotation } from "../js/rotation-validator.js";
import { Rogue } from "../js/rogue.js";
import { evaluate } from "../js/rotation-conditions.js";
import { rotationState } from "../js/rotation-state.js";
import { defaultConfig } from "../js/sim-config.js";
const COMBAT_DAGGERS = "combat-daggers";

// P5-03b (#279, D12b-2): the on-use racials Berserking (Troll, +10% attack
// speed for 15 s, 3 min) and Eureka! (Gnome, non-periodic damaging abilities
// cost 10% less and deal 10% more for 8 s, 2 min), granted by race as #278's
// Blood Fury is, cast at the top of the presets when granted (decision 6),
// off the GCD and free (A21). Berserking is a haste add (A20): a swing under
// way is not rescaled. Eureka's cost is rounded down (A19): 45 x 0.9 = 40.5
// -> 40. "Non-periodic" is the direct abilities and Instant Poison (A22).

const BERSERKING = "berserking";
const EUREKA = "eureka";
const ON_USE = [
  { racial: "troll.berserking", ability: BERSERKING, race: "troll" },
  { racial: "gnome.eureka", ability: EUREKA, race: "gnome" },
];
const PRESETS = ROTATION_PRESETS.map((preset) => preset.id);
const COMBAT = "combat-swords";
const PERCENT = 100;
const MINUTE = 60;
const FIVE_MINUTES = 300;
const SEEDS = [1, 2, 279];
const EPSILON = 1e-9;
const ENERGY = RESOURCE_DEFINITIONS.find((d) => d.id === "energy");
// Kinds of damage that are periodic or none: a DoT's ticks, and an attack
// that rolls the table but deals nothing (Expose Armor).
const NOT_DIRECT = ["dot", "attackOnly"];

function text(id) {
  return raceCatalogue.racial(id).text;
}

function presetConfig(id, race = null) {
  const build = referenceBuild(id);
  return loadPreset(id, {
    race,
    talents: { ...build.talents },
    talentLevel: build.talentLevel,
    weapons: structuredClone(build.weapons),
    poisons: { ...build.poisons },
  });
}

function withoutRacialRules(config) {
  return {
    ...config,
    rotation: {
      ...config.rotation,
      rules: config.rotation.rules.filter(
        (rule) => !raceGrantedAbilities.has(rule.action),
      ),
    },
  };
}

function fought(seed, config, seconds) {
  const fight = createFight(seed, config, { duration: seconds });
  const casts = [];
  fight.simulation.on("cast", (event) => casts.push(event));
  const auras = new FightAuras();
  auras.attach(fight.simulation);
  fight.simulation.run(seconds);
  return { fight, casts, auras: auras.summary() };
}

// The direct (non-periodic) damaging abilities of the catalogue: those with
// a damage roll that is not a DoT's ticks or an attack with no damage.
function directAbilities() {
  return ABILITY_DEFINITIONS.filter(
    (d) =>
      d.damage !== undefined &&
      !NOT_DIRECT.includes(d.damage.kind) &&
      abilityCatalogue.get(d.id) !== undefined,
  ).map((d) => d.id);
}

describe("Berserking and Eureka! in the ability catalogue (#279)", () => {
  for (const { racial, ability } of ON_USE) {
    it(`${ability}: read from the export's racial text`, () => {
      const entry = abilityCatalogue.get(ability);
      assert.ok(entry, ability);
      assert.equal(entry.name, raceCatalogue.racial(racial).name);
      assert.equal(entry.text, text(racial));
      assert.equal(entry.racial, racial);
      assert.equal(entry.castTime, 0);
      assert.equal(entry.cost, null);
      assert.equal(entry.passive, false);
      assert.equal(entry.startsGcd, false, "A21: off the GCD");
      const minutes = Number(/(\d+) min cooldown/.exec(text(racial))[1]);
      assert.equal(entry.cooldown, minutes * MINUTE);
    });
  }

  it("lists the four on-use racials after the spellbook tabs", () => {
    const racials = abilityCatalogue.abilities.filter(
      (entry) => entry.racial !== undefined && entry.racial !== null,
    );
    assert.deepEqual(
      racials.map((entry) => entry.id),
      ["blood-fury", "elunes-light", BERSERKING, EUREKA],
    );
  });
});

describe("Berserking and Eureka! values (A19, A20, A21, A22)", () => {
  it("Berserking: attack speed +10% for 15 s, 3 min cooldown, from its text", () => {
    const words = text("troll.berserking");
    assert.match(words, /attack speed by 10% for 15 sec/);
    const row = k("racial.berserking");
    assert.equal(row.haste, Number(/(\d+)%/.exec(words)[1]) / PERCENT);
    assert.equal(row.duration, Number(/for (\d+) sec/.exec(words)[1]));
    assert.equal(row.cooldown, abilityCatalogue.get(BERSERKING).cooldown);
    assert.equal(row.cooldown, 3 * MINUTE);
  });

  it("Eureka!: cost x0.90 and damage x1.10 for 8 s, 2 min cooldown, from its text", () => {
    const words = text("gnome.eureka");
    assert.match(
      words,
      /For (\d+) sec, your non-periodic damaging abilities cost (\d+)% less/,
    );
    assert.match(words, /deal (\d+)% more damage/);
    const row = k("racial.eureka");
    const less = Number(/cost (\d+)% less/.exec(words)[1]);
    const more = Number(/deal (\d+)% more damage/.exec(words)[1]);
    assert.equal(row.energyCost, 1 - less / PERCENT);
    assert.equal(row.damage, 1 + more / PERCENT);
    assert.equal(row.duration, Number(/For (\d+) sec/.exec(words)[1]));
    assert.equal(row.cooldown, abilityCatalogue.get(EUREKA).cooldown);
    assert.equal(row.cooldown, 2 * MINUTE);
  });

  it("A22: Eureka's abilities are the catalogue's direct damaging ones", () => {
    assert.deepEqual(
      [...k("racial.eurekaAbilities")].sort(),
      directAbilities().sort(),
    );
    for (const periodic of ["rupture", "expose-armor", "slice-and-dice"]) {
      assert.ok(!k("racial.eurekaAbilities").includes(periodic), periodic);
    }
  });

  it("the abilities cost nothing and their auras carry the values", () => {
    for (const { ability } of ON_USE) {
      const definition = ABILITY_DEFINITIONS.find((d) => d.id === ability);
      assert.ok(definition, ability);
      assert.equal(definition.cost, undefined, `${ability}: A21, no cost`);
      assert.equal(definition.damage, undefined, `${ability}: no attack`);
      assert.ok(AURAS[definition.aura.id], ability);
    }
    assert.deepEqual(
      AURAS.berserking.modifiers.map(({ kind, op, value, scope }) => [
        kind,
        op,
        value,
        scope,
      ]),
      [["haste", "add", k("racial.berserking").haste, null]],
    );
    const eureka = AURAS.eureka.modifiers.map(({ kind, op, value, scope }) => [
      kind,
      op,
      value,
      scope,
    ]);
    assert.deepEqual(eureka, [
      [
        "energyCost",
        "mult",
        k("racial.eureka").energyCost,
        { abilities: [...k("racial.eurekaAbilities")] },
      ],
      [
        "damage",
        "mult",
        k("racial.eureka").damage,
        { abilities: [...k("racial.eurekaAbilities"), "instant-poison"] },
      ],
    ]);
  });
});

describe("A19: a cost after a multiplier is rounded down", () => {
  const pipeline = (mult) => ({
    resolve: (kind, base) => (kind === "energyCost" ? base * mult : base),
  });

  it("45 x 0.9 = 40.5 pays 40; 35 x 0.9 = 31.5 pays 31", () => {
    const mult = k("racial.eureka").energyCost;
    assert.equal(resolveCost(ENERGY, pipeline(mult), 45, {}), 40);
    assert.equal(resolveCost(ENERGY, pipeline(mult), 35, {}), 31);
    assert.equal(resolveCost(ENERGY, pipeline(mult), 60, {}), 54);
  });

  it("a whole cost is left as it is, and a hair under a whole one rounds up to it", () => {
    assert.equal(resolveCost(ENERGY, pipeline(1), 45, {}), 45);
    assert.equal(resolveCost(ENERGY, pipeline(1), 40 - 1e-12, {}), 40);
  });

  it("energy rounds its costs down (energy.costRounding)", () => {
    assert.equal(k("energy.costRounding"), "floor");
    assert.equal(ENERGY.roundCost, "energy.costRounding");
  });
});

describe("racial effects grant Berserking and Eureka! (#279)", () => {
  it("both racials are simulated, by an ability grant", () => {
    for (const { racial, ability } of ON_USE) {
      assert.equal(RACIAL_EFFECTS[racial].ability, ability);
      assert.equal(racialStatus(racial), "simulated");
    }
    // In the export's racial order (Orc, Troll, ..., Night Elf, Gnome).
    assert.deepEqual(
      [...raceGrantedAbilities],
      ["blood-fury", BERSERKING, "elunes-light", EUREKA],
    );
  });

  it("expandRace: the Troll has Berserking, the Gnome Eureka! and Expansive Mind", () => {
    assert.deepEqual(expandRace("troll").abilities, [BERSERKING]);
    assert.deepEqual(expandRace("gnome").abilities, [EUREKA]);
    assert.deepEqual(
      expandRace("gnome").modifiers.map((m) => m.kind),
      ["resourceMax"],
    );
    assert.deepEqual(expandRace("troll").modifiers, []);
  });

  it("the rogue is granted its race's ability and locked out of the other's", () => {
    const troll = new Rogue({ race: "troll" });
    assert.ok(troll.granted.has(BERSERKING));
    assert.ok(!troll.granted.has(EUREKA));
    assert.equal(troll.lockedByBuild(troll.abilities.berserking), false);
    assert.equal(troll.lockedByBuild(troll.abilities.eureka), true);
    const gnome = new Rogue({ race: "gnome" });
    assert.equal(gnome.lockedByBuild(gnome.abilities.eureka), false);
    assert.equal(gnome.lockedByBuild(gnome.abilities.berserking), true);
  });

  it("an old config with no race grants neither (G4)", () => {
    const rogue = new Rogue({ character: { attackPower: 1000 } });
    assert.equal(rogue.config.race, null);
    assert.ok(!rogue.granted.has(BERSERKING));
    assert.ok(!rogue.granted.has(EUREKA));
  });
});

// Decision 6 puts every on-use racial at the top of every preset, Combat
// included (Scout, 2 Nov 2026, on #315). The 2,048 was only a test budget
// (test/build-codec.test.js); the app's cap is LINK_CAP, 8,192.
const ALL_FOUR = ["blood-fury", "elunes-light", BERSERKING, EUREKA];
const RACIALS_IN = {
  "assassination-daggers": ALL_FOUR,
  "subtlety-daggers": ALL_FOUR,
  "combat-swords": ALL_FOUR,
  [COMBAT_DAGGERS]: ALL_FOUR,
};
const DAGGERS = "assassination-daggers";

describe("the presets cast the on-use racials when granted (decision 6)", () => {
  it("every preset is listed", () => {
    assert.deepEqual(PRESETS.toSorted(), Object.keys(RACIALS_IN).toSorted());
  });

  for (const id of PRESETS) {
    it(`${id}: its racial rules, guarded by abilityGranted, at the top`, () => {
      const { rules } = ROTATION_PRESETS.find((p) => p.id === id).rotation;
      const racials = RACIALS_IN[id];
      assert.deepEqual(
        rules.slice(0, racials.length),
        racials.map((action) => ({
          action,
          conditions: [{ type: "abilityGranted", ability: action }],
        })),
      );
      assert.ok(
        rules
          .slice(racials.length)
          .every((rule) => !raceGrantedAbilities.has(rule.action)),
      );
    });

    it(`${id}: with no race, the fight is the preset without them`, () => {
      for (const seed of SEEDS) {
        const config = presetConfig(id);
        const plain = runFight({
          seed,
          duration: MINUTE,
          config: withoutRacialRules(config),
        });
        const preset = runFight({ seed, duration: MINUTE, config });
        assert.deepEqual(
          { ...preset, config: null },
          { ...plain, config: null },
          `${id} seed ${seed}`,
        );
      }
    });
  }
});

describe("combat-swords casts Berserking and Eureka! too (Scout, 2 Nov 2026)", () => {
  it("a Troll or a Gnome casts its racial at the pull, and only its own", () => {
    for (const { race, ability } of ON_USE) {
      const { casts } = fought(1, presetConfig(COMBAT, race), FIVE_MINUTES);
      const own = casts.filter((c) => c.ability === ability);
      assert.ok(own.length > 0, race);
      assert.equal(own[0].time, 0, race);
      const other = ON_USE.find((o) => o.race !== race).ability;
      assert.ok(!casts.some((c) => c.ability === other), race);
    }
  });
});

describe("Berserking in the fight (#279, A20)", () => {
  it("is cast at 0 and 3 min of a 5 min fight, off the GCD and free", () => {
    const { casts } = fought(1, presetConfig(DAGGERS, "troll"), FIVE_MINUTES);
    const cast = casts.filter((c) => c.ability === BERSERKING);
    assert.deepEqual(
      cast.map((c) => c.time),
      [0, 3 * MINUTE],
    );
    for (const c of cast) {
      assert.equal(c.onGcd, false);
      assert.equal(c.cost, 0);
    }
    assert.ok(!casts.some((c) => c.ability === EUREKA));
  });

  it("uptime is casts x 15 s over 5 min", () => {
    const { casts, auras } = fought(
      2,
      presetConfig(DAGGERS, "troll"),
      FIVE_MINUTES,
    );
    const times = casts.filter((c) => c.ability === BERSERKING);
    const row = auras.rows.find((r) => r.id === BERSERKING);
    assert.equal(row.applications, times.length);
    assert.ok(
      Math.abs(row.uptime - times.length * k("racial.berserking").duration) <
        EPSILON,
    );
  });

  it("multiplies haste by 1.10 while up, on top of the rest (haste.stacking)", () => {
    const config = presetConfig(DAGGERS, "troll");
    const up = createFight(1, config, { duration: MINUTE });
    up.simulation.run(1);
    const none = createFight(1, presetConfig(DAGGERS), { duration: MINUTE });
    none.simulation.run(1);
    const haste = (f) => f.rogue.modifiers.resolve("haste", 1);
    assert.ok(
      Math.abs(haste(up) - haste(none) * (1 + k("racial.berserking").haste)) <
        EPSILON,
    );
  });

  it("does not rescale a swing under way, at the start or the end of the aura", () => {
    // Berserking held until 1 s, so the swing begun at 0 is under way when it
    // starts; the aura ends at 16 s, inside a swing begun while it was up.
    const config = {
      race: "troll",
      rotation: {
        schemaVersion: 1,
        name: "Berserking at 1 s",
        rules: [
          {
            action: BERSERKING,
            conditions: [
              { type: "abilityGranted", ability: BERSERKING },
              { type: "fightTime", op: ">=", value: 1 },
            ],
          },
        ],
      },
    };
    const seconds = 30;
    const fight = createFight(1, config, { duration: seconds });
    const swings = [];
    let start = null;
    fight.simulation.on("cast", (event) => {
      if (event.ability === BERSERKING) {
        start = event.time;
      }
    });
    fight.simulation.on("hit", (event) => {
      if (event.ability === "main-hand") {
        swings.push(event.time);
      }
    });
    fight.simulation.run(seconds);
    assert.equal(start, 1);
    const end = start + k("racial.berserking").duration;
    const speed = fight.rogue.weapons.mainHand.speed;
    const hasted = speed / (1 + k("racial.berserking").haste);
    let straddledStart = false;
    let straddledEnd = false;
    for (let i = 0; i + 1 < swings.length; i += 1) {
      const [from, to] = [swings[i], swings[i + 1]];
      const up = from >= start && from < end;
      assert.ok(
        Math.abs(to - from - (up ? hasted : speed)) < EPSILON,
        `swing at ${from}: ${to - from}`,
      );
      straddledStart ||= from < start && to > start;
      straddledEnd ||= from < end && to > end;
    }
    assert.ok(straddledStart, "a swing straddles the aura's start");
    assert.ok(straddledEnd, "a swing straddles the aura's end");
  });
});

describe("Eureka! in the fight (#279, A19, A22)", () => {
  it("is cast at 0, 2 and 4 min of a 5 min fight, off the GCD and free", () => {
    const { casts } = fought(1, presetConfig(DAGGERS, "gnome"), FIVE_MINUTES);
    const cast = casts.filter((c) => c.ability === EUREKA);
    assert.deepEqual(
      cast.map((c) => c.time),
      [0, 2 * MINUTE, 4 * MINUTE],
    );
    for (const c of cast) {
      assert.equal(c.onGcd, false);
      assert.equal(c.cost, 0);
    }
    assert.ok(!casts.some((c) => c.ability === BERSERKING));
  });

  it("a cast inside the window pays its cost x 0.9 rounded down, outside the full cost", () => {
    for (const id of [DAGGERS, "subtlety-daggers"]) {
      const { casts } = fought(1, presetConfig(id, "gnome"), FIVE_MINUTES);
      const windows = casts
        .filter((c) => c.ability === EUREKA)
        .map((c) => [c.time, c.time + k("racial.eureka").duration]);
      const inside = (t) => windows.some(([a, b]) => t >= a && t < b);
      const full = {};
      for (const c of casts) {
        if (c.ability === EUREKA || c.cost === 0 || inside(c.time)) {
          continue;
        }
        full[c.ability] ??= new Set();
        full[c.ability].add(c.cost);
      }
      let seen = 0;
      for (const c of casts.filter((x) => inside(x.time) && x.cost > 0)) {
        const outside = [...(full[c.ability] ?? [])];
        if (outside.length !== 1) {
          continue;
        }
        const [base] = outside;
        const expected = k("racial.eurekaAbilities").includes(c.ability)
          ? Math.floor(base * k("racial.eureka").energyCost + EPSILON)
          : base;
        assert.equal(c.cost, expected, `${id} ${c.ability} at ${c.time}`);
        seen += 1;
      }
      assert.ok(seen > 0, id);
    }
  });

  it("multiplies the damage of the direct abilities and Instant Poison by 1.10, nothing else", () => {
    const up = createFight(1, presetConfig(DAGGERS, "gnome"), {
      duration: MINUTE,
    });
    up.simulation.run(1);
    assert.ok(up.simulation.hasAura(EUREKA));
    const sim = up.simulation;
    const mult = k("racial.eureka").damage;
    const none = createFight(1, presetConfig(DAGGERS), { duration: MINUTE });
    none.simulation.run(1);
    const ratio = (context) =>
      sim.modifiers.resolve("damage", PERCENT, context) /
      none.simulation.modifiers.resolve("damage", PERCENT, context);
    for (const id of [...k("racial.eurekaAbilities"), "instant-poison"]) {
      assert.ok(Math.abs(ratio(sim.abilityContext(id)) - mult) < EPSILON, id);
    }
    for (const context of [
      sim.abilityContext("rupture", { bleed: true }),
      sim.abilityContext("deadly-poison"),
      sim.abilityContext("main-hand", { attackType: "weapon" }),
      sim.abilityContext("off-hand", { attackType: "weapon" }),
    ]) {
      assert.ok(Math.abs(ratio(context) - 1) < EPSILON, context.ability);
    }
  });

  it("costs nothing less after the window: 8 s later every cost is back", () => {
    const fight = createFight(1, presetConfig(DAGGERS, "gnome"), {
      duration: MINUTE,
    });
    fight.simulation.run(k("racial.eureka").duration + 1);
    assert.equal(fight.simulation.hasAura(EUREKA), false);
    const ss = fight.rogue.abilities.sinisterStrike;
    const plain = createFight(1, presetConfig(DAGGERS), { duration: MINUTE });
    plain.simulation.run(k("racial.eureka").duration + 1);
    assert.equal(
      ss.costNow(fight.simulation),
      plain.rogue.abilities.sinisterStrike.costNow(plain.simulation),
    );
  });
});

describe("Berserking and Eureka! add no random draw and no proc (G2)", () => {
  it("the cast itself draws no random number", () => {
    for (const { race, ability } of ON_USE) {
      const fight = createFight(1, presetConfig(DAGGERS, race), {
        duration: MINUTE,
      });
      let count = 0;
      const rng = fight.simulation.rng;
      fight.simulation.rng = () => {
        count += 1;
        return rng();
      };
      const key = ability === BERSERKING ? "berserking" : "eureka";
      const entry = fight.rogue.abilities[key];
      assert.ok(entry.canCast(fight.rogue, fight.simulation), ability);
      entry.cast(fight.rogue, fight.simulation);
      assert.equal(count, 0, ability);
      assert.ok(fight.simulation.hasAura(ability), ability);
    }
  });

  it("adds no proc", () => {
    for (const { race } of ON_USE) {
      assert.deepEqual(
        new Rogue(presetConfig(DAGGERS, race)).procs.map((p) => p.id),
        new Rogue(presetConfig(DAGGERS)).procs.map((p) => p.id),
      );
    }
  });
});

describe("the validator and the builder state (#279)", () => {
  for (const { ability, race } of ON_USE) {
    it(`${ability}: a rule needs abilityGranted; the ${race} grants it`, () => {
      const rotation = (conditions) => ({
        schemaVersion: 1,
        name: "racial",
        rules: [{ action: ability, conditions }],
      });
      assert.deepEqual(
        validateRotation(rotation([{ type: "abilityGranted", ability }])),
        [],
      );
      const errors = validateRotation(rotation([]));
      assert.deepEqual(
        errors.map((error) => error.code),
        ["talentGuard"],
      );
      const rule = {
        action: ability,
        conditions: [{ type: "abilityGranted", ability }],
      };
      assert.equal(skipOf(rule, talentState({ race })), null);
      assert.notEqual(skipOf(rule, talentState({ race: null })), null);
      assert.ok(!castableAbilities().includes(ability), ability);
    });
  }
});

// QA N3 (#315; #314 N5): the rotation state lists the race-granted abilities
// as ones that need a grant, so with a build selected a race that lacks one
// has it locked. Without the race grants in that list (mutant K26) every
// on-use racial would read as unlocked for every race.
describe("the rotation state's grants with and without a race (#279 QA N3)", () => {
  const stateFor = (race) => {
    const config = defaultConfig();
    config.race = race;
    config.talents = { ...referenceBuild("assassination-daggers").talents };
    const { rogue, simulation } = createFight(1, config);
    return rotationState(rogue, simulation);
  };
  const unlocked = (ability, state) =>
    evaluate({ type: "abilityUnlocked", ability }, state);

  it("with no race: both need a grant, neither is granted, both are locked", () => {
    const state = stateFor(null);
    assert.equal(state.build.selected, true);
    for (const { ability } of ON_USE) {
      assert.ok(state.talentAbilities.includes(ability), ability);
      assert.ok(!state.granted.includes(ability), ability);
      assert.equal(unlocked(ability, state), false, ability);
    }
  });

  for (const { ability, race } of ON_USE) {
    it(`with the ${race}: ${ability} is granted and unlocked, the other is not`, () => {
      const state = stateFor(race);
      for (const other of ON_USE) {
        const mine = other.ability === ability;
        assert.ok(state.talentAbilities.includes(other.ability), other.ability);
        assert.equal(
          state.granted.includes(other.ability),
          mine,
          other.ability,
        );
        assert.equal(unlocked(other.ability, state), mine, other.ability);
      }
    });
  }
});
