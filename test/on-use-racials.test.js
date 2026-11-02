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
  checkRacialEffects,
  expandRace,
  raceCatalogue,
  raceGrantedAbilities,
  racialStatus,
} from "../js/racials.js";
import { castableAbilities } from "../js/rotation-edit.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";
import { talentState, skipOf } from "../js/rotation-skips.js";
import { validateRotation } from "../js/rotation-validator.js";
import { Rogue } from "../js/rogue.js";

// P5-03a (#278, D12b-1): the on-use racials Blood Fury (Orc) and Elune's
// Light (Night Elf), granted by race through the Cold Blood route (an
// `ability` grant and the abilityGranted condition), cast at the top of the
// three presets when granted (decision 6), off the GCD and free (A21).

const BLOOD_FURY = "blood-fury";
const ELUNES_LIGHT = "elunes-light";
const ON_USE = [
  { racial: "orc.blood-fury", ability: BLOOD_FURY, race: "orc" },
  {
    racial: "night-elf.elunes-light",
    ability: ELUNES_LIGHT,
    race: "night-elf",
  },
];
const PRESETS = ROTATION_PRESETS.map((preset) => preset.id);
const COMBAT = "combat-swords";
const PERCENT = 100;
const MINUTE = 60;
const FIVE_MINUTES = 300;
const CLIPPED = 250;
const SEEDS = [1, 2, 278];

function text(id) {
  return raceCatalogue.racial(id).text;
}

// The preset as #273's button loads it: its rotation and its whole
// reference build, plus `race`.
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

// The preset with its on-use racial rules taken out: the rotation as it was
// before #278.
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

// A fight run to `seconds`, with its casts and its aura uptimes.
function fought(seed, config, seconds) {
  const fight = createFight(seed, config, { duration: seconds });
  const casts = [];
  fight.simulation.on("cast", (event) => casts.push(event));
  const auras = new FightAuras();
  auras.attach(fight.simulation);
  fight.simulation.run(seconds);
  return { fight, casts, auras: auras.summary() };
}

describe("on-use racials in the ability catalogue (#278)", () => {
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
      // A21: off the GCD (not in the export; Classic racials).
      assert.equal(entry.startsGcd, false);
      const minutes = Number(/(\d+) min cooldown/.exec(text(racial))[1]);
      assert.equal(entry.cooldown, minutes * MINUTE);
    });
  }

  it("keeps the spellbook tabs as they were and adds the racials after them", () => {
    const racials = abilityCatalogue.abilities.filter(
      (entry) => entry.racial !== undefined && entry.racial !== null,
    );
    // Berserking and Eureka! (#279) come after them.
    assert.deepEqual(
      racials.map((entry) => entry.id),
      [BLOOD_FURY, ELUNES_LIGHT, "berserking", "eureka"],
    );
    assert.deepEqual(k("abilities.racials"), [
      ...ON_USE.map((on) => on.racial),
      "troll.berserking",
      "gnome.eureka",
    ]);
  });
});

describe("Blood Fury and Elune's Light values (A18, A21)", () => {
  it("Blood Fury: attack power x1.10 for 15 s, 2 min cooldown, from its text", () => {
    const words = text("orc.blood-fury");
    assert.match(
      words,
      /Increases Attack Power and Spell Power by 10% for 15 sec/,
    );
    const row = k("racial.bloodFury");
    assert.equal(
      row.attackPower,
      1 + Number(/(\d+)%/.exec(words)[1]) / PERCENT,
    );
    assert.equal(row.duration, Number(/for (\d+) sec/.exec(words)[1]));
    assert.equal(row.cooldown, abilityCatalogue.get(BLOOD_FURY).cooldown);
    assert.equal(row.cooldown, 2 * MINUTE);
  });

  it("Elune's Light: +10% crit for 15 s, 3 min cooldown, from its text", () => {
    const words = text("night-elf.elunes-light");
    assert.match(
      words,
      /critical strike chance with all spells and attacks by 10% for 15 sec/,
    );
    const row = k("racial.elunesLight");
    assert.equal(row.critChance, Number(/(\d+)%/.exec(words)[1]) / PERCENT);
    assert.equal(row.duration, Number(/for (\d+) sec/.exec(words)[1]));
    assert.equal(row.cooldown, abilityCatalogue.get(ELUNES_LIGHT).cooldown);
    assert.equal(row.cooldown, 3 * MINUTE);
  });

  it("the abilities cost nothing and their rows match the definitions", () => {
    for (const { ability } of ON_USE) {
      const definition = ABILITY_DEFINITIONS.find((d) => d.id === ability);
      assert.ok(definition, ability);
      assert.equal(definition.cost, undefined, `${ability}: A21, no cost`);
      assert.equal(definition.damage, undefined, `${ability}: no attack`);
      assert.ok(AURAS[definition.aura.id], ability);
    }
    assert.deepEqual(
      AURAS.bloodFury.modifiers.map(({ kind, op, value }) => [kind, op, value]),
      [["attackPower", "mult", k("racial.bloodFury").attackPower]],
    );
    assert.deepEqual(
      AURAS.elunesLight.modifiers.map(({ kind, op, value, scope }) => [
        kind,
        op,
        value,
        scope,
      ]),
      [["critChance", "add", k("racial.elunesLight").critChance, null]],
    );
  });
});

describe("racial effects grant the on-use abilities (#278)", () => {
  it("the two racials are simulated, by an ability grant", () => {
    for (const { racial, ability } of ON_USE) {
      assert.equal(RACIAL_EFFECTS[racial].ability, ability);
      assert.equal(racialStatus(racial), "simulated");
    }
    // Berserking and Eureka! (#279) are granted too.
    assert.ok(raceGrantedAbilities.has(BLOOD_FURY));
    assert.ok(raceGrantedAbilities.has(ELUNES_LIGHT));
  });

  it("expandRace lists the race's granted abilities, none for no race", () => {
    assert.deepEqual(expandRace("orc").abilities, [BLOOD_FURY]);
    assert.deepEqual(expandRace("night-elf").abilities, [ELUNES_LIGHT]);
    assert.deepEqual(expandRace("human").abilities, []);
    assert.deepEqual(expandRace(null).abilities, []);
    assert.deepEqual(expandRace("orc").modifiers, []);
  });

  it("refuses an ability grant that is not in the catalogue, or with company", () => {
    const hash = RACIAL_EFFECTS["orc.blood-fury"].textHash;
    assert.throws(
      () =>
        checkRacialEffects({
          "orc.blood-fury": { textHash: hash, ability: "blood-furry" },
        }),
      /not in the ability catalogue/,
    );
    assert.throws(
      () =>
        checkRacialEffects({
          "orc.blood-fury": { textHash: hash, ability: ELUNES_LIGHT },
        }),
      /another racial/,
    );
    assert.throws(
      () =>
        checkRacialEffects({
          "orc.blood-fury": {
            textHash: hash,
            ability: BLOOD_FURY,
            modifiers: [{ kind: "attackPower", op: "add", value: 1 }],
          },
        }),
      /stands alone/,
    );
  });

  it("the rogue is granted its race's ability and locked out of the other's", () => {
    const orc = new Rogue({ race: "orc" });
    assert.ok(orc.granted.has(BLOOD_FURY));
    assert.ok(!orc.granted.has(ELUNES_LIGHT));
    assert.equal(orc.lockedByBuild(orc.abilities.bloodFury), false);
    assert.equal(orc.lockedByBuild(orc.abilities.elunesLight), true);
    const none = new Rogue();
    assert.equal(none.granted.size, 0);
    assert.equal(none.lockedByBuild(none.abilities.bloodFury), true);
    assert.equal(none.lockedByBuild(none.abilities.elunesLight), true);
  });

  it("an old config with no race grants neither (G4)", () => {
    const rogue = new Rogue({ character: { attackPower: 1000 } });
    assert.equal(rogue.config.race, null);
    assert.ok(!rogue.granted.has(BLOOD_FURY));
    assert.ok(!rogue.granted.has(ELUNES_LIGHT));
  });
});

describe("the presets cast the on-use racials on cooldown when granted (decision 6)", () => {
  for (const id of PRESETS) {
    it(`${id}: Blood Fury and Elune's Light, guarded by abilityGranted, at the top`, () => {
      const { rules } = ROTATION_PRESETS.find((p) => p.id === id).rotation;
      assert.deepEqual(rules.slice(0, 2), [
        {
          action: BLOOD_FURY,
          conditions: [{ type: "abilityGranted", ability: BLOOD_FURY }],
        },
        {
          action: ELUNES_LIGHT,
          conditions: [{ type: "abilityGranted", ability: ELUNES_LIGHT }],
        },
      ]);
      // Berserking and Eureka! (#279) follow; test/berserking-eureka.test.js.
      assert.ok(
        rules.slice(4).every((rule) => !raceGrantedAbilities.has(rule.action)),
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

describe("on-use racials in the fight (#278)", () => {
  it("Blood Fury is cast at 0, 2 and 4 min of a 5 min fight, off the GCD and free", () => {
    const { casts } = fought(1, presetConfig(COMBAT, "orc"), FIVE_MINUTES);
    const fury = casts.filter((cast) => cast.ability === BLOOD_FURY);
    assert.deepEqual(
      fury.map((cast) => cast.time),
      [0, 2 * MINUTE, 4 * MINUTE],
    );
    for (const cast of fury) {
      assert.equal(cast.onGcd, false);
      assert.equal(cast.cost, 0);
    }
    // Off the GCD: an on-GCD ability is cast at 0 too, after it.
    const first = casts.find((cast) => cast.onGcd);
    assert.equal(first.time, 0);
    assert.ok(casts.indexOf(first) > casts.indexOf(fury[0]));
    assert.ok(!casts.some((cast) => cast.ability === ELUNES_LIGHT));
  });

  it("Elune's Light is cast at 0 and 3 min of a 5 min fight", () => {
    const { casts } = fought(
      1,
      presetConfig(COMBAT, "night-elf"),
      FIVE_MINUTES,
    );
    assert.deepEqual(
      casts
        .filter((cast) => cast.ability === ELUNES_LIGHT)
        .map((cast) => cast.time),
      [0, 3 * MINUTE],
    );
    assert.ok(!casts.some((cast) => cast.ability === BLOOD_FURY));
  });

  for (const { ability, race, row } of [
    { ability: BLOOD_FURY, race: "orc", row: "racial.bloodFury" },
    { ability: ELUNES_LIGHT, race: "night-elf", row: "racial.elunesLight" },
  ]) {
    for (const seconds of [FIVE_MINUTES, CLIPPED]) {
      it(`${ability}: uptime = casts x duration / L, end clip included (L = ${seconds} s)`, () => {
        const { casts, auras } = fought(2, presetConfig(COMBAT, race), seconds);
        const times = casts
          .filter((cast) => cast.ability === ability)
          .map((cast) => cast.time);
        const { duration } = k(row);
        const expected = times.reduce(
          (sum, time) => sum + Math.min(duration, seconds - time),
          0,
        );
        const auraRow = auras.rows.find((r) => r.id === ability);
        assert.equal(auraRow.applications, times.length);
        assert.ok(Math.abs(auraRow.uptime - expected) < 1e-9, ability);
        assert.ok(
          Math.abs(auraRow.uptimeFraction - expected / seconds) < 1e-12,
          ability,
        );
        if (seconds === FIVE_MINUTES) {
          assert.equal(expected, times.length * duration);
        } else {
          // The last cast (4 min for Blood Fury, 3 min for Elune's Light)
          // fits or is clipped by the end: Blood Fury at 240 s has 10 s left.
          assert.ok(expected <= times.length * duration);
        }
      });
    }
  }

  it("Blood Fury multiplies attack power by 1.10 while up, and only then", () => {
    const config = presetConfig(COMBAT, "orc");
    const up = createFight(1, config, { duration: MINUTE });
    up.simulation.run(1);
    const base = up.rogue.attackPower;
    assert.ok(up.simulation.activeBuffs[BLOOD_FURY] !== undefined);
    assert.equal(
      up.rogue.getAttackPower(),
      base * k("racial.bloodFury").attackPower,
    );
    const after = createFight(1, config, { duration: MINUTE });
    after.simulation.run(k("racial.bloodFury").duration + 1);
    assert.equal(after.simulation.activeBuffs[BLOOD_FURY], undefined);
    assert.equal(after.rogue.getAttackPower(), base);
  });

  it("Elune's Light adds 10% crit while up, to every attack", () => {
    const config = presetConfig(COMBAT, "night-elf");
    const up = createFight(1, config, { duration: MINUTE });
    up.simulation.run(1);
    const none = new Rogue(presetConfig(COMBAT));
    for (const context of [
      {},
      { ability: "sinister-strike" },
      { ability: "eviscerate" },
    ]) {
      assert.ok(
        Math.abs(
          up.rogue.getCritChance(context) -
            (none.getCritChance(context) + k("racial.elunesLight").critChance),
        ) < 1e-12,
      );
    }
  });

  it("an ungranted rule is skipped: an Orc never casts Elune's Light, a Night Elf never Blood Fury", () => {
    for (const { race, never } of [
      { race: "orc", never: ELUNES_LIGHT },
      { race: "night-elf", never: BLOOD_FURY },
      { race: "human", never: BLOOD_FURY },
      { race: null, never: ELUNES_LIGHT },
    ]) {
      const { casts } = fought(1, presetConfig(COMBAT, race), FIVE_MINUTES);
      assert.ok(!casts.some((cast) => cast.ability === never), String(race));
    }
    // A rule with no guard never gets to the fight: the config refuses it
    // (the validator's talentGuard); the engine would pass it over anyway
    // (Rogue.lockedByBuild, above).
    const bare = {
      ...presetConfig(COMBAT, "human"),
      rotation: {
        schemaVersion: 1,
        name: "bare",
        rules: [
          { action: BLOOD_FURY, conditions: [] },
          { action: "sinister-strike", conditions: [] },
        ],
      },
    };
    assert.throws(
      () => createFight(1, bare, { duration: MINUTE }),
      /comes from a race/,
    );
  });

  it("Blood Fury draws no random number and changes no outcome (G2)", () => {
    for (const seed of SEEDS) {
      const draws = (race) => {
        const fight = createFight(seed, presetConfig(COMBAT, race), {
          duration: MINUTE,
        });
        let count = 0;
        const rng = fight.simulation.rng;
        fight.simulation.rng = () => {
          count += 1;
          return rng();
        };
        const outcomes = [];
        // The cast's own log row (outcome "cast", as Cold Blood's) is the
        // only new one; every attack keeps its time and outcome.
        fight.simulation.on("hit", (event) => {
          if (event.ability === BLOOD_FURY) {
            assert.equal(event.outcome, "cast");
          } else {
            outcomes.push(`${event.time}|${event.ability}|${event.outcome}`);
          }
        });
        fight.simulation.run(MINUTE);
        return { count, outcomes };
      };
      const orc = draws("orc");
      const none = draws(null);
      assert.equal(orc.count, none.count, `seed ${seed}`);
      assert.deepEqual(orc.outcomes, none.outcomes, `seed ${seed}`);
    }
  });

  it("adds no proc (G2)", () => {
    for (const { race } of ON_USE) {
      assert.deepEqual(
        new Rogue(presetConfig(COMBAT, race)).procs.map((p) => p.id),
        new Rogue(presetConfig(COMBAT)).procs.map((p) => p.id),
      );
    }
  });
});

describe("the validator and the builder state (#278)", () => {
  const rotation = (conditions) => ({
    schemaVersion: 1,
    name: "racial",
    rules: [{ action: BLOOD_FURY, conditions }],
  });

  it("an on-use racial rule needs abilityGranted, as Cold Blood's does", () => {
    assert.deepEqual(
      validateRotation(
        rotation([{ type: "abilityGranted", ability: BLOOD_FURY }]),
      ),
      [],
    );
    for (const conditions of [
      [],
      [{ type: "abilityUnlocked", ability: BLOOD_FURY }],
    ]) {
      const errors = validateRotation(rotation(conditions));
      assert.deepEqual(
        errors.map((error) => error.code),
        ["talentGuard"],
      );
      assert.match(errors[0].message, /race/);
    }
  });

  it("the builder's state grants the race's ability (rotation-skips)", () => {
    const rule = {
      action: BLOOD_FURY,
      conditions: [{ type: "abilityGranted", ability: BLOOD_FURY }],
    };
    assert.equal(skipOf(rule, talentState({ race: "orc" })), null);
    assert.notEqual(skipOf(rule, talentState({ race: null })), null);
    assert.notEqual(skipOf(rule, talentState({})), null);
  });

  it("the palette leaves the on-use racials out with no race, and offers the race's (#280)", () => {
    for (const { ability, race } of ON_USE) {
      assert.ok(!castableAbilities().includes(ability), ability);
      assert.ok(castableAbilities(race).includes(ability), ability);
    }
  });
});
