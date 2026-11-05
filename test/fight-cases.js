import { GOLDEN_CASES } from "../scripts/golden-update.mjs";

// The fight configs the core tests run (moved from scripts/parity.mjs when
// #234 retired the parity harness with the fixed-step engine). FIGHT_CASES is
// one case per distinct config: each golden case (scripts/golden-update.mjs)
// less those with the same config as another, then EXTRA_CASES, which are not
// golden cases.

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// dot-hemorrhage-rupture-120s puts DoT tick timing under test (#213): a
// 49-point Subtlety/Assassination/Combat build with Hemorrhage, and a rotation
// that keeps Rupture up at five combo points, builds with Hemorrhage, and
// spends any other five-point finisher on Eviscerate.
//
// partial-build-8-points-300s is #199's partial-build config: the 8-point
// build of test/partial-builds.test.js (#190), with the default rotation. A
// selected build without Blade Flurry or Adrenaline Rush locks them, so the
// rotation falls through to Sinister Strike and Slice and Dice.
export const EXTRA_CASES = deepFreeze([
  {
    name: "dot-hemorrhage-rupture-120s",
    duration: 120,
    config: {
      // #332: needs Hemorrhage — Combat reference has none.
      talents: {
        "subtlety.setup": 3,
        "subtlety.opportunity": 5,
        "subtlety.dirty-deeds": 2,
        "subtlety.improved-ambush": 3,
        "subtlety.initiative": 3,
        "subtlety.serrated-blades": 3,
        "subtlety.ghostly-strike": 1,
        "subtlety.hemorrhage": 1,
      },
      rotation: {
        schemaVersion: 1,
        name: "Hemorrhage and Rupture",
        rules: [
          {
            action: "rupture",
            conditions: [
              { type: "comboPoints", op: ">=", value: 5 },
              { type: "debuffRemaining", debuff: "rupture", op: "<", value: 1 },
            ],
          },
          {
            action: "eviscerate",
            conditions: [{ type: "comboPoints", op: ">=", value: 5 }],
          },
          {
            action: "hemorrhage",
            conditions: [
              { type: "abilityUnlocked", ability: "hemorrhage" },
              { type: "comboPoints", op: "<", value: 5 },
            ],
          },
        ],
      },
    },
  },
  {
    name: "partial-build-8-points-300s",
    duration: 300,
    config: {
      talents: {
        "combat.coup-de-grace": 3,
        "combat.efficient-strikes": 2,
        "combat.precision": 3,
      },
    },
  },
]);

// Golden cases with the default config, as five-minute-seed-1-300s has. The
// scripted one runs a script the cases here do not.
const SAME_CONFIG = new Set([
  "short-seed-1-10s",
  "other-seed-12345-90s",
  "scripted-finishers-in-budget-seed-68-50s",
]);

export const FIGHT_CASES = deepFreeze([
  ...GOLDEN_CASES.filter(({ name }) => !SAME_CONFIG.has(name)).map(
    ({ name, duration, config }) => ({ name, duration, config }),
  ),
  ...EXTRA_CASES.map(({ name, duration, config }) => ({
    name,
    duration,
    config,
  })),
]);
