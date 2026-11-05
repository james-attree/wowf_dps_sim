// Frozen LINK_BASES snapshots for TR-02 / #332.
// Old-era preset bases kept so append-only indexes stay stable;
// decode still resolves them, then SETUP_ERA marks the load invalid.
// Temporary Combat swords lands in TR-03 / #333 as a new base id.
// Content matches test/short-links-306.test.js LOCKED_CONTENT hashes.

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Page defaults as they stood at the end of TR-02 / #332 (empty talents,
// placeholder Default (Combat) rotation, Instant MH / Deadly OH). Frozen so
// TR-03 can retarget pageDefaultConfig at combat-swords-temp without moving
// the append-only "defaults" short-link base (#306 ruling (b)).
export const DEFAULTS_FROZEN = deepFreeze({
  talents: {},
  talentLevel: 60,
  weapons: {
    mainHand: {
      min: 100,
      max: 187,
      speed: 2.6,
      type: "sword",
    },
    offHand: {
      min: 90,
      max: 168,
      speed: 2.5,
      type: "sword",
    },
  },
  poisons: {
    mainHand: "instant",
    offHand: "deadly",
  },
  rotation: {
    schemaVersion: 1,
    name: "Default (Combat)",
    rules: [
      {
        action: "blade-flurry",
        conditions: [
          {
            type: "abilityUnlocked",
            ability: "blade-flurry",
          },
          {
            type: "cooldownReady",
            ability: "blade-flurry",
          },
          {
            type: "resource",
            resource: "energy",
            op: ">=",
            value: 25,
          },
        ],
      },
      {
        action: "adrenaline-rush",
        conditions: [
          {
            type: "abilityUnlocked",
            ability: "adrenaline-rush",
          },
          {
            type: "cooldownReady",
            ability: "adrenaline-rush",
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<",
            value: 1,
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<=",
            value: 5,
          },
          {
            type: "resource",
            resource: "energy",
            op: ">=",
            value: 100,
          },
        ],
      },
      {
        action: "cold-blood",
        conditions: [
          {
            type: "abilityGranted",
            ability: "cold-blood",
          },
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: ">",
            value: 10,
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
        ],
      },
      {
        action: "sinister-strike",
        conditions: [],
      },
    ],
  },
});

export const COMBAT_SWORDS_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.relentless-strikes": 1,
    "assassination.lethality": 5,
    "assassination.cold-blood": 1,
    "combat.improved-eviscerate": 3,
    "combat.improved-sinister-strike": 2,
    "combat.puncturing-wounds": 3,
    "combat.precision": 3,
    "combat.endurance": 2,
    "combat.improved-sprint": 2,
    "combat.flawless-execution": 1,
    "combat.dual-wield-specialization": 5,
    "combat.blade-flurry": 1,
    "combat.hack-and-slash": 5,
    "combat.weapon-expertise": 2,
    "combat.aggression": 3,
    "combat.adrenaline-rush": 1,
  },
  talentLevel: 60,
  weapons: {
    mainHand: {
      min: 100,
      max: 187,
      speed: 2.6,
      type: "sword",
    },
    offHand: {
      min: 90,
      max: 168,
      speed: 2.5,
      type: "sword",
    },
  },
  poisons: {
    mainHand: "deadly",
    offHand: "instant",
  },
  rotation: {
    schemaVersion: 1,
    name: "Combat swords",
    rules: [
      {
        action: "blood-fury",
        conditions: [
          {
            type: "abilityGranted",
            ability: "blood-fury",
          },
        ],
      },
      {
        action: "elunes-light",
        conditions: [
          {
            type: "abilityGranted",
            ability: "elunes-light",
          },
        ],
      },
      {
        action: "berserking",
        conditions: [
          {
            type: "abilityGranted",
            ability: "berserking",
          },
        ],
      },
      {
        action: "eureka",
        conditions: [
          {
            type: "abilityGranted",
            ability: "eureka",
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 3,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<",
            value: 1,
          },
        ],
      },
      {
        action: "adrenaline-rush",
        conditions: [
          {
            type: "abilityUnlocked",
            ability: "adrenaline-rush",
          },
          {
            type: "cooldownReady",
            ability: "adrenaline-rush",
          },
          {
            type: "resource",
            resource: "energy",
            op: "<",
            value: 25,
          },
          {
            type: "auraActive",
            aura: "slice-and-dice",
          },
        ],
      },
      {
        action: "blade-flurry",
        conditions: [
          {
            type: "abilityUnlocked",
            ability: "blade-flurry",
          },
          {
            type: "cooldownReady",
            ability: "blade-flurry",
          },
          {
            type: "auraActive",
            aura: "slice-and-dice",
          },
        ],
      },
      {
        action: "cold-blood",
        conditions: [
          {
            type: "abilityGranted",
            ability: "cold-blood",
          },
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: ">",
            value: 5,
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
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
        conditions: [
          {
            type: "comboPoints",
            op: "<",
            value: 5,
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 3,
          },
          {
            type: "energyToCap",
            op: "<",
            value: 1,
          },
        ],
      },
    ],
  },
});

export const ASSASSINATION_DAGGERS_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.murder": 1,
    "assassination.improved-slice-and-dice": 3,
    "assassination.relentless-strikes": 1,
    "assassination.lethality": 5,
    "assassination.vile-poisons": 5,
    "assassination.cold-blood": 1,
    "assassination.improved-poisons": 5,
    "assassination.vigor": 2,
    "assassination.mutilate": 1,
    "assassination.seal-fate": 5,
    "assassination.venom": 1,
    "combat.improved-eviscerate": 3,
    "combat.improved-sinister-strike": 2,
    "combat.puncturing-wounds": 3,
    "combat.precision": 3,
    "subtlety.opportunity": 2,
  },
  talentLevel: 60,
  weapons: {
    mainHand: {
      min: 73,
      max: 137,
      speed: 1.8,
      type: "dagger",
    },
    offHand: {
      min: 59,
      max: 111,
      speed: 1.6,
      type: "dagger",
    },
  },
  poisons: {
    mainHand: "instant",
    offHand: "deadly",
  },
  rotation: {
    schemaVersion: 1,
    name: "Assassination",
    rules: [
      {
        action: "blood-fury",
        conditions: [
          {
            type: "abilityGranted",
            ability: "blood-fury",
          },
        ],
      },
      {
        action: "elunes-light",
        conditions: [
          {
            type: "abilityGranted",
            ability: "elunes-light",
          },
        ],
      },
      {
        action: "berserking",
        conditions: [
          {
            type: "abilityGranted",
            ability: "berserking",
          },
        ],
      },
      {
        action: "eureka",
        conditions: [
          {
            type: "abilityGranted",
            ability: "eureka",
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<",
            value: 1,
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<=",
            value: 5,
          },
          {
            type: "resource",
            resource: "energy",
            op: ">=",
            value: 100,
          },
        ],
      },
      {
        action: "venom",
        conditions: [
          {
            type: "abilityGranted",
            ability: "venom",
          },
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
          {
            type: "auraRemaining",
            aura: "venom",
            op: "<=",
            value: 3,
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
          {
            type: "resource",
            resource: "energy",
            op: ">=",
            value: 75,
          },
        ],
      },
      {
        action: "cold-blood",
        conditions: [
          {
            type: "abilityGranted",
            ability: "cold-blood",
          },
          {
            type: "comboPoints",
            op: "<",
            value: 5,
          },
        ],
      },
      {
        action: "mutilate",
        conditions: [
          {
            type: "abilityGranted",
            ability: "mutilate",
          },
          {
            type: "comboPoints",
            op: "<",
            value: 4,
          },
        ],
      },
    ],
  },
});

export const SUBTLETY_DAGGERS_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.relentless-strikes": 1,
    "combat.improved-eviscerate": 3,
    "combat.improved-sinister-strike": 2,
    "combat.precision": 3,
    "subtlety.camouflage": 5,
    "subtlety.master-of-deception": 3,
    "subtlety.setup": 1,
    "subtlety.elusiveness": 2,
    "subtlety.dirty-tricks": 2,
    "subtlety.initiative": 3,
    "subtlety.ghostly-strike": 1,
    "subtlety.premeditation": 1,
    "subtlety.serrated-blades": 3,
    "subtlety.dirty-deeds": 2,
    "subtlety.preparation": 1,
    "subtlety.hemorrhage": 1,
    "subtlety.quietus": 5,
    "subtlety.thousand-cuts": 1,
  },
  talentLevel: 60,
  weapons: {
    mainHand: {
      min: 73,
      max: 137,
      speed: 1.8,
      type: "dagger",
    },
    offHand: {
      min: 59,
      max: 111,
      speed: 1.6,
      type: "dagger",
    },
  },
  poisons: {
    mainHand: "instant",
    offHand: "deadly",
  },
  rotation: {
    schemaVersion: 1,
    name: "Subtlety",
    rules: [
      {
        action: "blood-fury",
        conditions: [
          {
            type: "abilityGranted",
            ability: "blood-fury",
          },
        ],
      },
      {
        action: "elunes-light",
        conditions: [
          {
            type: "abilityGranted",
            ability: "elunes-light",
          },
        ],
      },
      {
        action: "berserking",
        conditions: [
          {
            type: "abilityGranted",
            ability: "berserking",
          },
        ],
      },
      {
        action: "eureka",
        conditions: [
          {
            type: "abilityGranted",
            ability: "eureka",
          },
        ],
      },
      {
        action: "rupture",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
          {
            type: "debuffRemaining",
            debuff: "rupture",
            op: "<",
            value: 1,
          },
        ],
      },
      {
        action: "premeditation",
        conditions: [
          {
            type: "abilityGranted",
            ability: "premeditation",
          },
          {
            type: "comboPoints",
            op: "<=",
            value: 3,
          },
        ],
      },
      {
        action: "preparation",
        conditions: [
          {
            type: "abilityGranted",
            ability: "preparation",
          },
          {
            type: "cooldownReady",
            ability: "preparation",
          },
          {
            type: "cooldownReady",
            ability: "ghostly-strike",
            ready: false,
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 3,
          },
          {
            type: "debuffRemaining",
            debuff: "rupture",
            op: ">=",
            value: 10,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<",
            value: 2,
          },
        ],
      },
      {
        action: "ghostly-strike",
        conditions: [
          {
            type: "abilityGranted",
            ability: "ghostly-strike",
          },
          {
            type: "comboPoints",
            op: "<",
            value: 5,
          },
          {
            type: "cooldownReady",
            ability: "ghostly-strike",
          },
        ],
      },
      {
        action: "hemorrhage",
        conditions: [
          {
            type: "abilityGranted",
            ability: "hemorrhage",
          },
          {
            type: "comboPoints",
            op: "<",
            value: 5,
          },
        ],
      },
    ],
  },
});

export const COMBAT_DAGGERS_FROZEN = deepFreeze({
  talents: {
    "assassination.malice": 5,
    "assassination.ruthlessness": 3,
    "assassination.improved-slice-and-dice": 3,
    "assassination.relentless-strikes": 1,
    "assassination.lethality": 4,
    "combat.improved-eviscerate": 3,
    "combat.improved-sinister-strike": 2,
    "combat.puncturing-wounds": 3,
    "combat.precision": 3,
    "combat.endurance": 2,
    "combat.improved-sprint": 2,
    "combat.flawless-execution": 1,
    "combat.dual-wield-specialization": 5,
    "combat.blade-flurry": 1,
    "combat.hack-and-slash": 5,
    "combat.weapon-expertise": 2,
    "combat.aggression": 3,
    "combat.adrenaline-rush": 1,
    "subtlety.opportunity": 2,
  },
  talentLevel: 60,
  weapons: {
    mainHand: {
      min: 73,
      max: 137,
      speed: 1.8,
      type: "dagger",
    },
    offHand: {
      min: 59,
      max: 111,
      speed: 1.6,
      type: "dagger",
    },
  },
  poisons: {
    mainHand: "instant",
    offHand: "deadly",
  },
  rotation: {
    schemaVersion: 1,
    name: "Combat daggers",
    rules: [
      {
        action: "blood-fury",
        conditions: [
          {
            type: "abilityGranted",
            ability: "blood-fury",
          },
        ],
      },
      {
        action: "elunes-light",
        conditions: [
          {
            type: "abilityGranted",
            ability: "elunes-light",
          },
        ],
      },
      {
        action: "berserking",
        conditions: [
          {
            type: "abilityGranted",
            ability: "berserking",
          },
        ],
      },
      {
        action: "eureka",
        conditions: [
          {
            type: "abilityGranted",
            ability: "eureka",
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<",
            value: 1,
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<=",
            value: 5,
          },
          {
            type: "resource",
            resource: "energy",
            op: ">=",
            value: 100,
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 4,
          },
        ],
      },
      {
        action: "backstab",
        conditions: [
          {
            type: "resource",
            resource: "comboPoints",
            op: "<",
            value: 4,
          },
        ],
      },
    ],
  },
});

// Frozen at TR-04 / #337: combat-swords-temp before Shank entered the live
// rotation. Old short links that named this base keep the pre-Shank rules.
export const COMBAT_SWORDS_TEMP_FROZEN = deepFreeze({
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
    mainHand: {
      min: 100,
      max: 187,
      speed: 2.6,
      type: "sword",
    },
    offHand: {
      min: 90,
      max: 168,
      speed: 2.5,
      type: "sword",
    },
  },
  poisons: {
    mainHand: "instant",
    offHand: "deadly",
  },
  rotation: {
    schemaVersion: 1,
    name: "Combat swords (temporary)",
    rules: [
      {
        action: "blood-fury",
        conditions: [
          {
            type: "abilityGranted",
            ability: "blood-fury",
          },
        ],
      },
      {
        action: "elunes-light",
        conditions: [
          {
            type: "abilityGranted",
            ability: "elunes-light",
          },
        ],
      },
      {
        action: "berserking",
        conditions: [
          {
            type: "abilityGranted",
            ability: "berserking",
          },
        ],
      },
      {
        action: "eureka",
        conditions: [
          {
            type: "abilityGranted",
            ability: "eureka",
          },
        ],
      },
      {
        action: "slice-and-dice",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 3,
          },
          {
            type: "auraRemaining",
            aura: "slice-and-dice",
            op: "<",
            value: 1,
          },
        ],
      },
      {
        action: "adrenaline-rush",
        conditions: [
          {
            type: "abilityUnlocked",
            ability: "adrenaline-rush",
          },
          {
            type: "cooldownReady",
            ability: "adrenaline-rush",
          },
          {
            type: "resource",
            resource: "energy",
            op: "<",
            value: 25,
          },
          {
            type: "auraActive",
            aura: "slice-and-dice",
          },
        ],
      },
      {
        action: "blade-flurry",
        conditions: [
          {
            type: "abilityUnlocked",
            ability: "blade-flurry",
          },
          {
            type: "cooldownReady",
            ability: "blade-flurry",
          },
          {
            type: "auraActive",
            aura: "slice-and-dice",
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 5,
          },
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
        conditions: [
          {
            type: "comboPoints",
            op: "<",
            value: 5,
          },
        ],
      },
      {
        action: "eviscerate",
        conditions: [
          {
            type: "comboPoints",
            op: ">=",
            value: 3,
          },
          {
            type: "energyToCap",
            op: "<",
            value: 1,
          },
        ],
      },
    ],
  },
});
