import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { k } from "../data/constants.js";
import {
  SETUP_VERSION,
  decodeSetup,
  encodeSetup,
  runDefaults,
  setupDefaults,
} from "../js/build-codec.js";
import { createFight, runFight } from "../js/fight.js";
import { fightArmor, targetArmor } from "../js/levels.js";
import { loadPreset, referenceBuild } from "../js/rotation-presets.js";
import { defaultConfig, normalizeConfig } from "../js/sim-config.js";

// Issue #290's DPS check, as Scout ruled on #317 (2 Nov 2026): with the gear
// and the target's armour held fixed (config.target.armor pinned), DPS falls
// as the level drops. That leaves the ranks, the abilities and poisons
// learned, the weapon skill (level x 5, against a target 3 levels up) and the
// armour divisor (85 a level) to move with the level. Level-appropriate gear
// is #297.

const LEVELS = [60, 50, 40, 30, 20, 10];
const SEEDS = 30;
const DURATION = 60;

// The default config, and each preset's rotation, weapons and poisons with no
// talents: a 51-point build is not legal below 60, so the talents are held
// fixed (at none) like the gear.
const CONFIGS = {
  default: () => ({}),
  ...Object.fromEntries(
    ["assassination-daggers", "combat-swords", "subtlety-daggers"].map((id) => [
      id,
      () => {
        const build = referenceBuild(id);
        return loadPreset(id, {
          talents: {},
          weapons: structuredClone(build.weapons),
          poisons: { ...build.poisons },
        });
      },
    ]),
  ),
};

function meanDps(config, level, armor) {
  let total = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    total += runFight({
      seed,
      duration: DURATION,
      config: {
        ...config,
        talentLevel: level,
        target: { ...config.target, armor },
      },
    }).dps;
  }
  return total / SEEDS;
}

describe("config.target.armor pins the target's armour (#290, #317)", () => {
  it("defaults to null, which is the armour at the enemy level", () => {
    assert.equal(defaultConfig().target.armor, null);
    assert.equal(normalizeConfig({}).target.armor, null);
    assert.equal(fightArmor(normalizeConfig({})), k("target.armor"));
    assert.equal(
      fightArmor(normalizeConfig({ talentLevel: 40 })),
      targetArmor(43),
    );
  });

  it("keeps a pinned armour whatever the levels", () => {
    for (const talentLevel of LEVELS) {
      const config = normalizeConfig({ talentLevel, target: { armor: 1234 } });
      assert.equal(config.target.armor, 1234);
      assert.equal(fightArmor(config), 1234, String(talentLevel));
    }
    const config = normalizeConfig({ target: { level: 30, armor: 0 } });
    assert.equal(fightArmor(config), 0);
  });

  it("refuses an armour that is not a whole number from 0", () => {
    for (const armor of [-1, 10.5, "3731", Number.NaN, true]) {
      assert.throws(
        () => normalizeConfig({ target: { armor } }),
        /config\.target\.armor/,
        String(armor),
      );
    }
  });

  it("uses the pinned armour in the armour divisor", () => {
    const { constant, perLevel } = k("armor.mitigation");
    const { simulation } = createFight(1, {
      talentLevel: 40,
      target: { armor: 3731 },
    });
    assert.ok(
      Math.abs(
        simulation.armorMultiplier({}) -
          (1 - 3731 / (3731 + constant + perLevel * 40)),
      ) < 1e-12,
    );
    const bare = createFight(1, { talentLevel: 40, target: { armor: 0 } });
    assert.equal(bare.simulation.armorMultiplier({}), 1);
  });

  it("gives the same fight as null when pinned at the level's own armour", () => {
    for (const [talentLevel, armor] of [
      [60, k("target.armor")],
      [40, targetArmor(43)],
    ]) {
      const free = runFight({
        seed: 5,
        duration: 120,
        config: { talentLevel },
      });
      const pinned = runFight({
        seed: 5,
        duration: 120,
        config: { talentLevel, target: { armor } },
      });
      assert.equal(pinned.totalDamage, free.totalDamage, String(talentLevel));
      assert.deepEqual(pinned.abilities, free.abilities);
    }
  });

  it("reads old configs, links and saved setups with no armour as null (G4)", () => {
    const old = normalizeConfig({ target: { behind: true, level: null } });
    assert.equal(old.target.armor, null);
    // The default setup's text is unchanged, so every link made before reads.
    assert.equal(encodeSetup(setupDefaults()), `${SETUP_VERSION}.e30`);
    const before = encodeSetup({
      config: normalizeConfig({ talentLevel: 40, target: { level: 41 } }),
      run: runDefaults(),
    });
    for (const strict of [true, false]) {
      const read = decodeSetup(before, { strict });
      assert.equal(read.status, "ok");
      assert.equal(read.setup.config.target.armor, null);
      assert.equal(read.setup.config.target.level, 41);
      assert.equal(read.setup.config.talentLevel, 40);
    }
  });

  it("carries a pinned armour through a share link", () => {
    const config = normalizeConfig({ target: { armor: 2000 } });
    const read = decodeSetup(encodeSetup({ config, run: runDefaults() }));
    assert.equal(read.status, "ok");
    assert.equal(read.setup.config.target.armor, 2000);
  });
});

describe("DPS falls as the level drops, gear and armour fixed (#290 check, #317)", () => {
  it("is non-increasing from 60 to 10 with the armour pinned at target.armor", () => {
    for (const [name, make] of Object.entries(CONFIGS)) {
      const config = make();
      const dps = LEVELS.map((level) =>
        meanDps(config, level, k("target.armor")),
      );
      for (let index = 1; index < dps.length; index += 1) {
        assert.ok(
          dps[index] <= dps[index - 1],
          `${name}: level ${LEVELS[index]} ${dps[index]} > level ${LEVELS[index - 1]} ${dps[index - 1]}`,
        );
      }
    }
  });

  it("falls with no armour too, so it is not the armour divisor alone", () => {
    for (const [name, make] of Object.entries(CONFIGS)) {
      const config = make();
      const top = meanDps(config, 60, 0);
      for (const level of [40, 10]) {
        const low = meanDps(config, level, 0);
        assert.ok(low < top, `${name}: level ${level} ${low} >= 60 ${top}`);
      }
    }
  });
});
