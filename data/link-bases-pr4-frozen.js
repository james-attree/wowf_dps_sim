// Frozen live link bases at the start of #297 PR4, before presets
// dropped weapons and the character sheet. Append-only: an old ?s=2
// link that named one of these ids still opens this build.

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const COMBAT_SWORDS_TEMP_337_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.vigor": 2,
    "assassination.blood-splatter": 1,
    "assassination.lethality": 2,
    "combat.coup-de-grace": 3,
    "combat.efficient-strikes": 2,
    "combat.puncturing-wounds": 3,
    "combat.precision": 3,
    "combat.improved-sprint": 2,
    "combat.composure": 2,
    "combat.flawless-execution": 1,
    "combat.weapon-expertise": 2,
    "combat.aggression": 3,
    "combat.dual-wield-specialization": 2,
    "combat.blade-flurry": 1,
    "combat.hack-and-slash": 5,
    "combat.flash-of-steel": 5,
    "combat.adrenaline-rush": 1,
  },
  talentLevel: 60,
  weapons: {
    mainHand: { min: 100, max: 187, speed: 2.6, type: "sword" },
    offHand: { min: 90, max: 168, speed: 2.5, type: "sword" },
  },
  poisons: { mainHand: "instant", offHand: "deadly" },
  rotation: {
    schemaVersion: 1,
    name: "Combat swords (temporary)",
    rules: [
      {
        action: "blood-fury",
        conditions: [{ type: "abilityGranted", ability: "blood-fury" }],
      },
      {
        action: "elunes-light",
        conditions: [{ type: "abilityGranted", ability: "elunes-light" }],
      },
      {
        action: "berserking",
        conditions: [{ type: "abilityGranted", ability: "berserking" }],
      },
      {
        action: "eureka",
        conditions: [{ type: "abilityGranted", ability: "eureka" }],
      },
      {
        action: "slice-and-dice",
        conditions: [
          { type: "comboPoints", op: ">=", value: 3 },
          { type: "auraRemaining", aura: "slice-and-dice", op: "<", value: 1 },
        ],
      },
      {
        action: "adrenaline-rush",
        conditions: [
          { type: "abilityUnlocked", ability: "adrenaline-rush" },
          { type: "cooldownReady", ability: "adrenaline-rush" },
          { type: "resource", resource: "energy", op: "<", value: 25 },
          { type: "auraActive", aura: "slice-and-dice" },
        ],
      },
      {
        action: "blade-flurry",
        conditions: [
          { type: "abilityUnlocked", ability: "blade-flurry" },
          { type: "cooldownReady", ability: "blade-flurry" },
          { type: "auraActive", aura: "slice-and-dice" },
        ],
      },
      {
        action: "shank",
        conditions: [
          { type: "cooldownReady", ability: "shank" },
          { type: "resource", resource: "energy", op: "<", value: 50 },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 5 },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: ">=",
            value: 12,
          },
        ],
      },
      {
        action: "sinister-strike",
        conditions: [{ type: "comboPoints", op: "<", value: 5 }],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 3 },
          { type: "energyToCap", op: "<", value: 1 },
        ],
      },
    ],
  },
});

export const COMBAT_DAGGERS_340_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.lethality": 2,
    "combat.coup-de-grace": 3,
    "combat.efficient-strikes": 2,
    "combat.puncturing-wounds": 3,
    "combat.precision": 3,
    "combat.improved-sprint": 2,
    "combat.composure": 2,
    "combat.flawless-execution": 1,
    "combat.weapon-expertise": 2,
    "combat.aggression": 3,
    "combat.dual-wield-specialization": 2,
    "combat.blade-flurry": 1,
    "combat.hack-and-slash": 5,
    "combat.flash-of-steel": 5,
    "combat.adrenaline-rush": 1,
    "subtlety.opportunity": 3,
  },
  talentLevel: 60,
  weapons: {
    mainHand: { min: 73, max: 137, speed: 1.8, type: "dagger" },
    offHand: { min: 59, max: 111, speed: 1.6, type: "dagger" },
  },
  poisons: { mainHand: "instant", offHand: "deadly" },
  rotation: {
    schemaVersion: 1,
    name: "Combat daggers",
    rules: [
      {
        action: "blood-fury",
        conditions: [{ type: "abilityGranted", ability: "blood-fury" }],
      },
      {
        action: "elunes-light",
        conditions: [{ type: "abilityGranted", ability: "elunes-light" }],
      },
      {
        action: "berserking",
        conditions: [{ type: "abilityGranted", ability: "berserking" }],
      },
      {
        action: "eureka",
        conditions: [{ type: "abilityGranted", ability: "eureka" }],
      },
      {
        action: "slice-and-dice",
        conditions: [
          { type: "comboPoints", op: ">=", value: 3 },
          { type: "auraRemaining", aura: "slice-and-dice", op: "<", value: 1 },
        ],
      },
      {
        action: "adrenaline-rush",
        conditions: [
          { type: "abilityUnlocked", ability: "adrenaline-rush" },
          { type: "cooldownReady", ability: "adrenaline-rush" },
          { type: "resource", resource: "energy", op: "<", value: 25 },
          { type: "auraActive", aura: "slice-and-dice" },
        ],
      },
      {
        action: "blade-flurry",
        conditions: [
          { type: "abilityUnlocked", ability: "blade-flurry" },
          { type: "cooldownReady", ability: "blade-flurry" },
          { type: "auraActive", aura: "slice-and-dice" },
        ],
      },
      {
        action: "shank",
        conditions: [
          { type: "cooldownReady", ability: "shank" },
          { type: "resource", resource: "energy", op: "<", value: 50 },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 5 },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: ">=",
            value: 12,
          },
        ],
      },
      {
        action: "backstab",
        conditions: [{ type: "comboPoints", op: "<", value: 5 }],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 3 },
          { type: "energyToCap", op: "<", value: 1 },
        ],
      },
    ],
  },
});

export const ASSASSINATION_DAGGERS_340_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.vigor": 2,
    "assassination.blood-splatter": 1,
    "assassination.lethality": 2,
    "assassination.vile-poisons": 5,
    "assassination.cold-blood": 1,
    "assassination.improved-poisons": 5,
    "assassination.relentless-strikes": 5,
    "assassination.venom": 1,
    "assassination.seal-fate": 3,
    "assassination.mutilate": 1,
    "combat.coup-de-grace": 3,
    "combat.efficient-strikes": 2,
    "combat.puncturing-wounds": 3,
    "combat.precision": 3,
    "subtlety.opportunity": 3,
  },
  talentLevel: 60,
  weapons: {
    mainHand: { min: 73, max: 137, speed: 1.8, type: "dagger" },
    offHand: { min: 59, max: 111, speed: 1.6, type: "dagger" },
  },
  poisons: { mainHand: "instant", offHand: "deadly" },
  rotation: {
    schemaVersion: 1,
    name: "Assassination daggers",
    rules: [
      {
        action: "blood-fury",
        conditions: [{ type: "abilityGranted", ability: "blood-fury" }],
      },
      {
        action: "elunes-light",
        conditions: [{ type: "abilityGranted", ability: "elunes-light" }],
      },
      {
        action: "berserking",
        conditions: [{ type: "abilityGranted", ability: "berserking" }],
      },
      {
        action: "eureka",
        conditions: [{ type: "abilityGranted", ability: "eureka" }],
      },
      {
        action: "slice-and-dice",
        conditions: [
          { type: "comboPoints", op: ">=", value: 4 },
          { type: "auraRemaining", aura: "slice-and-dice", op: "<", value: 2 },
        ],
      },
      {
        action: "rupture",
        conditions: [
          { type: "comboPoints", op: ">=", value: 4 },
          { type: "debuffRemaining", debuff: "rupture", op: "<", value: 2 },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          { type: "comboPoints", op: ">=", value: 4 },
          { type: "auraRemaining", aura: "slice-and-dice", op: ">", value: 10 },
          { type: "debuffRemaining", debuff: "rupture", op: ">", value: 10 },
        ],
      },
      {
        action: "cold-blood",
        conditions: [
          { type: "abilityGranted", ability: "cold-blood" },
          { type: "cooldownReady", ability: "cold-blood" },
        ],
      },
      {
        action: "mutilate",
        conditions: [
          { type: "abilityUnlocked", ability: "mutilate" },
          { type: "comboPoints", op: "<", value: 4 },
          { type: "resource", resource: "energy", op: ">=", value: 50 },
        ],
      },
      {
        action: "shank",
        conditions: [
          { type: "cooldownReady", ability: "shank" },
          { type: "resource", resource: "energy", op: "<", value: 50 },
        ],
      },
    ],
  },
});

export const SUBTLETY_DAGGERS_340_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.blood-splatter": 1,
    "combat.coup-de-grace": 3,
    "combat.efficient-strikes": 2,
    "combat.precision": 3,
    "subtlety.master-of-deception": 2,
    "subtlety.opportunity": 5,
    "subtlety.dirty-deeds": 2,
    "subtlety.camouflage": 3,
    "subtlety.improved-ambush": 3,
    "subtlety.initiative": 3,
    "subtlety.premeditation": 1,
    "subtlety.serrated-blades": 3,
    "subtlety.ghostly-strike": 1,
    "subtlety.preparation": 1,
    "subtlety.hemorrhage": 1,
    "subtlety.boot-knife": 5,
    "subtlety.death-mark": 1,
  },
  talentLevel: 60,
  weapons: {
    mainHand: { min: 73, max: 137, speed: 1.8, type: "dagger" },
    offHand: { min: 59, max: 111, speed: 1.6, type: "dagger" },
  },
  poisons: { mainHand: "instant", offHand: "deadly" },
  rotation: {
    schemaVersion: 1,
    name: "Subtlety daggers",
    rules: [
      {
        action: "blood-fury",
        conditions: [{ type: "abilityGranted", ability: "blood-fury" }],
      },
      {
        action: "elunes-light",
        conditions: [{ type: "abilityGranted", ability: "elunes-light" }],
      },
      {
        action: "berserking",
        conditions: [{ type: "abilityGranted", ability: "berserking" }],
      },
      {
        action: "eureka",
        conditions: [{ type: "abilityGranted", ability: "eureka" }],
      },
      {
        action: "premeditation",
        conditions: [
          { type: "abilityGranted", ability: "premeditation" },
          { type: "cooldownReady", ability: "premeditation" },
        ],
      },
      {
        action: "preparation",
        conditions: [
          { type: "abilityGranted", ability: "preparation" },
          { type: "cooldownReady", ability: "preparation" },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          { type: "comboPoints", op: ">=", value: 4 },
          { type: "auraRemaining", aura: "slice-and-dice", op: "<", value: 2 },
        ],
      },
      {
        action: "rupture",
        conditions: [
          { type: "comboPoints", op: ">=", value: 4 },
          { type: "debuffRemaining", debuff: "rupture", op: "<", value: 2 },
        ],
      },
      {
        action: "death-mark",
        conditions: [
          { type: "abilityGranted", ability: "death-mark" },
          { type: "cooldownReady", ability: "death-mark" },
          { type: "comboPoints", op: ">=", value: 4 },
          { type: "debuffRemaining", debuff: "garrote", op: ">", value: 6 },
          { type: "debuffRemaining", debuff: "rupture", op: ">", value: 6 },
        ],
      },
      {
        action: "ghostly-strike",
        conditions: [
          { type: "abilityUnlocked", ability: "ghostly-strike" },
          { type: "cooldownReady", ability: "ghostly-strike" },
          { type: "debuffActive", debuff: "garrote", active: false },
        ],
      },
      { action: "garrote", conditions: [] },
      {
        action: "shank",
        conditions: [
          { type: "cooldownReady", ability: "shank" },
          { type: "resource", resource: "energy", op: "<", value: 50 },
        ],
      },
      {
        action: "hemorrhage",
        conditions: [
          { type: "abilityUnlocked", ability: "hemorrhage" },
          { type: "comboPoints", op: "<", value: 4 },
        ],
      },
    ],
  },
});
