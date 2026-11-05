// The preset rotations (R5, issue #142), as data: a list of
// { id, name, description, rotation }, where `rotation` is a RotationRule
// rotation (js/rotation-schema.js, docs/rotation.md). Nothing here runs
// anything. js/rotation-presets.js lists them for a page and loads one into a
// config, and checks every one against the validator when it is imported.
//
// TR-03 / #333: James's temporary Combat swords (16/35/0) is the only
// selectable preset until later TRs restore the rest. Shank (energy < 50)
// is pending TR-04 / #337 — the engine does not cast it yet, so the rule is
// omitted from the live rotation and pinned as PENDING_SHANK_RULE below.

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// The only Shank rule James ruled for the temporary Combat swords preset
// (5 Nov 2026): cast when energy < 50 and the cooldown is ready. Insert into
// the live rules once TR-04 / #337 teaches the engine to cast Shank.
export const PENDING_SHANK_RULE = deepFreeze({
  action: "shank",
  conditions: [
    { type: "cooldownReady", ability: "shank" },
    { type: "resource", resource: "energy", op: "<", value: 50 },
  ],
});

const COMBAT_SWORDS_TEMP_RULES = deepFreeze([
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
]);

export const ROTATION_PRESETS = deepFreeze([
  {
    id: "combat-swords-temp",
    name: "Combat swords (temporary)",
    description:
      "James's temporary Combat swords build for the 70755 rework (TR-03 / #333): Assassination 16 / Combat 35 / Subtlety 0. Shank when energy is low lands in TR-04 / #337.",
    rotation: {
      schemaVersion: 1,
      name: "Combat swords (temporary)",
      rules: COMBAT_SWORDS_TEMP_RULES,
    },
  },
]);
