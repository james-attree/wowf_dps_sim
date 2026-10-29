import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFight, fightResult } from "../js/fight.js";
import { Rogue } from "../js/rogue.js";
import { defaultConfig, defaultDaggerConfig } from "../js/sim-config.js";
import { legacyCastRotation } from "./legacy-rotation.js";
import { buildWithout } from "./builds.js";
import { referenceBuild } from "./talentsforever.js";

// R3 (#140): the placeholder Combat rotation, written as a RotationRule list
// and walked by the interpreter, is the code rotation it replaced, fight for
// fight. The code rotation lives in test/legacy-rotation.js and is patched
// over Rogue.prototype.castRotation for the legacy half of each pair. Equal
// means equal in everything a fight records: the total, every ability's
// record, the whole log, the rng draw count, and the cooldowns and buffs
// left at the end.

const BUILDS = {
  "no build": {},
  "reference build": referenceBuild(),
  "no Adrenaline Rush": buildWithout(["combat.adrenaline-rush"]),
  "no Cold Blood": buildWithout(["assassination.cold-blood"]),
  "no Adrenaline Rush, no Cold Blood": buildWithout([
    "combat.adrenaline-rush",
    "assassination.cold-blood",
  ]),
};

const modern = Rogue.prototype.castRotation;

function fightWith(
  { seed, duration, talents, dagger, poisons, grant },
  legacy,
) {
  const config = dagger ? defaultDaggerConfig() : defaultConfig();
  config.talents = structuredClone(talents);
  if (poisons) {
    config.poisons = { mainHand: "instant", offHand: "deadly" };
  }
  Rogue.prototype.castRotation = legacy
    ? function castLegacy(simulation) {
        legacyCastRotation(this, simulation);
      }
    : modern;
  try {
    const fight = createFight(
      seed,
      config,
      grant ? { abilities: ["cold-blood"] } : undefined,
    );
    let draws = 0;
    const draw = fight.simulation.rng;
    fight.simulation.rng = () => {
      draws += 1;
      return draw.call(fight.simulation);
    };
    fight.simulation.run(duration);
    return {
      result: fightResult(fight),
      draws,
      cooldowns: { ...fight.simulation.cooldowns },
      buffs: structuredClone(fight.simulation.activeBuffs),
    };
  } finally {
    Rogue.prototype.castRotation = modern;
  }
}

function sameFight(spec) {
  const legacy = fightWith(spec, true);
  const walked = fightWith(spec, false);
  // The rotation is the one thing the two configs differ in, and only by being
  // recorded: both fights run the default.
  assert.deepEqual(walked, legacy);
  return walked;
}

describe("the Combat rotation as JSON is the code rotation it replaced", () => {
  // Every build and loadout, short fights over several seeds.
  for (const [name, talents] of Object.entries(BUILDS)) {
    for (const dagger of [false, true]) {
      for (const poisons of [false, true]) {
        for (const grant of [false, true]) {
          const label = `${name}, ${dagger ? "daggers" : "sword and mace"}${poisons ? ", poisons" : ""}${grant ? ", Cold Blood granted by the host" : ""}`;
          it(`${label}: 90 s over 4 seeds, 300 s over 1`, () => {
            for (let seed = 1; seed <= 4; seed += 1) {
              sameFight({
                seed,
                duration: 90,
                talents,
                dagger,
                poisons,
                grant,
              });
            }
            for (const seed of [1, 2]) {
              sameFight({
                seed,
                duration: 300,
                talents,
                dagger,
                poisons,
                grant,
              });
            }
          });
        }
      }
    }
  }

  // Past ten minutes Blade Flurry and Adrenaline Rush come off cooldown close
  // together: the seeds below are ones where Adrenaline Rush is ready while
  // Blade Flurry is ready and short of energy, and a rotation that held the
  // walk at Blade Flurry would diverge from the code rotation there.
  it("holds past ten minutes, where both Combat cooldowns are ready together", () => {
    const specs = [
      { seed: 2, dagger: false },
      { seed: 3, dagger: true },
      { seed: 1, dagger: false, talents: BUILDS["reference build"] },
      { seed: 3, dagger: false, talents: BUILDS["reference build"] },
    ];
    for (const spec of specs) {
      sameFight({
        duration: 700,
        talents: {},
        poisons: false,
        grant: false,
        ...spec,
      });
    }
  });

  it("the walk does nothing a long fight without the build's talents did not", () => {
    // Blade Flurry and Adrenaline Rush are held back by the build: a build
    // without Adrenaline Rush never casts it, and the walk goes on past it.
    const { result } = sameFight({
      seed: 1,
      duration: 90,
      talents: BUILDS["no Adrenaline Rush"],
      dagger: false,
      poisons: false,
      grant: false,
    });
    assert.equal(result.abilities["Adrenaline Rush"], undefined);
    assert.ok(result.abilities["Blade Flurry"].casts >= 1);
    assert.ok(result.abilities["Sinister Strike"].casts > 10);
  });
});
