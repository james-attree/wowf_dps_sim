import { k } from "./constants.js";

// What each talent does, as data (roadmap D5, issue #102). Hand-authored from
// the snapshot's rank text (data/talentsforever/rogue.json), one entry per
// talent id, in the order of the catalogue. The engine reads none of it by
// name: js/talent-build.js expands a map of { talent id: rank } into the
// modifiers (js/modifiers.js) and procs (js/procs.js) a fight takes, and
// anything a fight does with them is the pipeline's.
//
// An entry holds `textHash` and then what the talent does, in one or more of
// these fields, or the single field `noDpsEffect`:
//
//   textHash     SHA-256, in hex, of the talent's rank texts joined with "\n"
//                (the `ranks` of the catalogue entry). It says which text the
//                entry was written from. A test recomputes it from the snapshot
//                and fails when they differ, so a refreshed snapshot that
//                rewords or renumbers a talent cannot go unseen. The coverage
//                check (npm run talents:coverage, D6 #103) lists the same
//                thing with the old and new hash.
//   modifiers    rank tables for expandRank (js/modifiers.js):
//                { kind, op, values: [rank 1, rank 2, ...], scope? }, one value
//                per rank. The kinds and scopes are the pipeline's own. A new
//                kind (D8a's `duration`) is a new MODIFIER_KINDS entry and
//                a modifiers.stacking row, and needs nothing here.
//   procs        raw proc specs for defineRankedProc (js/procs.js), with
//                chance.values in place of chance.value. Triggers, scopes and
//                actions are the proc system's, so a proc on a finisher by
//                `tags` with a `perSpent` chance and a `gainResource` action
//                is written the same way.
//   ability      the id (js/abilities.js) of the ability the talent grants.
//                What it does is the ability's, and its aura's, definition
//                (js/ability-data.js, js/auras.js). Whether a rotation may cast
//                it is not decided here (D7).
//   noDpsEffect  a one-line reason the talent does nothing in a simulated
//                damage fight. It stands alone.
//
// A modifier's numbers are written here and checked against the percentage or
// amount in the snapshot's own rank text by test/talent-effects.test.js, at
// every rank. A proc's chance reads the constants row that records it
// (hackAndSlash.extraAttack, puncturingWounds.comboPoint, ruthlessness.comboPoint,
// relentlessStrikes.energy, sealFate.comboPoint), and the same test checks those against the text too. So the numbers live in data/, none in
// js/, and the provenance is the `talents.*` row of data/constants.js.
//
// The six Assassination talents the reference build spends points on are D8a
// (#119). Malice, Improved Slice and Dice and Lethality (PR 1) are modifier
// tables: Malice `critChance`, Lethality `critDamage` scoped to the abilities
// its text names, Improved Slice and Dice a `duration` modifier on Slice and
// Dice. Ruthlessness and Relentless Strikes (PR 2) are procs on the finisher
// tag, one with a flat chance by rank and one with a perSpent chance, and
// Cold Blood (PR 2) is the ability it grants, whose aura carries the crit. A
// talent with no entry and a rank above 0 is reported by expandTalents as
// `unmapped`.
//
// The other Assassination passives are #266 (P4.6-03): Vigor (`resourceMax` on
// energy), Vile Poisons (`damage` on the poison tag), Improved Poisons (the
// `poisonChance` kind, A9; its charges half does nothing, since charges are
// unlimited), Seal Fate (an onCrit proc on the combo point builders, A8) and
// Murder. Murder's `mobTypes` lists the target types it works on
// (murder.mobTypes); expandTalents drops its modifiers unless target.mobType is
// one of them, so it is inert while the type is "unspecified". Improved Gouge,
// Remorseless Attacks and Improved Kidney Shot have no DPS effect.

const RAW = {
  "assassination.improved-gouge": {
    textHash:
      "cbd0fe5d96d32988f6b33fffa1637bca4337104a2a87c9e9d1cdad3f86818a4d",
    noDpsEffect:
      "Gouge duration: Gouge is crowd control, and no rotation casts it for damage.",
  },
  "assassination.remorseless-attacks": {
    textHash:
      "1a278d147e617da5aa5d9b62766a746475548f05b5320b9284df853a7995496b",
    noDpsEffect:
      "Needs a kill first: the sim is one target that does not die before the fight ends.",
  },
  "assassination.malice": {
    textHash:
      "b6f605a788c6f69c3b1f01d974ebc845b2300d103dccd2d084079950115958b4",
    modifiers: [
      {
        kind: "critChance",
        op: "add",
        values: [0.01, 0.02, 0.03, 0.04, 0.05],
      },
    ],
  },
  "assassination.ruthlessness": {
    textHash:
      "ed34820e2c6513f8d2d5e5a769589366fcd62c0dbae85dac071d30bcab729a15",
    procs: [
      {
        id: "ruthlessness",
        trigger: "onAbility",
        scope: { tags: ["finisher"] },
        chance: {
          mode: "flat",
          values: [...k("ruthlessness.comboPoint").chance],
        },
        actions: [
          {
            type: "gainResource",
            resource: "comboPoints",
            amount: k("ruthlessness.comboPoint").comboPoints,
          },
        ],
      },
    ],
  },
  "assassination.murder": {
    textHash:
      "0922403a7f99b2ff844da74f1d405e8cff2c4c6d7ff75f4ac93d498656472dcc",
    mobTypes: [...k("murder.mobTypes")],
    modifiers: [{ kind: "damage", op: "add", values: [0.02, 0.04] }],
  },
  "assassination.improved-slice-and-dice": {
    textHash:
      "ff51ea59688681eef5c6b5a3eb0ea378d85e65928f838fdd908a1ab7840d6f4b",
    modifiers: [
      {
        kind: "duration",
        op: "add",
        values: [0.15, 0.3, 0.45],
        scope: { abilities: ["slice-and-dice"] },
      },
    ],
  },
  "assassination.relentless-strikes": {
    textHash:
      "43cd64cecd1646ad869e4d9ef60a036980689e8e53f407b753ec742c3f01ead9",
    procs: [
      {
        id: "relentless-strikes",
        trigger: "onAbility",
        scope: { tags: ["finisher"] },
        chance: {
          mode: "perSpent",
          values: [k("relentlessStrikes.energy").chancePerComboPoint],
        },
        actions: [
          {
            type: "gainResource",
            resource: "energy",
            amount: k("relentlessStrikes.energy").energy,
          },
        ],
      },
    ],
  },
  "assassination.lethality": {
    textHash:
      "0f6498f9390e119a5005c63f535f814544feb5193f3ee58e5e84a39893ecab37",
    modifiers: [
      {
        kind: "critDamage",
        op: "add",
        values: [0.04, 0.08, 0.12, 0.16, 0.2],
        scope: {
          abilities: [
            "sinister-strike",
            "gouge",
            "backstab",
            "mutilate",
            "ghostly-strike",
            "hemorrhage",
          ],
        },
      },
    ],
  },
  "assassination.vile-poisons": {
    textHash:
      "6884dfa0909d14da09310fb82a6bff2ec66817b3e0dfd9c1a5ad766eba99f75a",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.04, 0.08, 0.12, 0.16, 0.2],
        scope: { tags: ["poison"] },
      },
    ],
  },
  "assassination.cold-blood": {
    textHash:
      "b1adbe8487451b905ff2fbdf485f350745f66c3049d08505f00cfada8b163a09",
    ability: "cold-blood",
  },
  "assassination.improved-poisons": {
    textHash:
      "7a6d241ac7c74aecaf77e6bbd6d6eff17424d6f432cb795761957ee693216b46",
    modifiers: [
      {
        kind: "poisonChance",
        op: "add",
        values: [0.02, 0.04, 0.06, 0.08, 0.1],
      },
    ],
  },
  "assassination.vigor": {
    textHash:
      "6cf7f109e3aa1f99662f5119b753d60c667b8674b0eabe1b96bdeed52c00a452",
    modifiers: [
      {
        kind: "resourceMax",
        op: "add",
        values: [5, 10],
        scope: { resources: ["energy"] },
      },
    ],
  },
  // #267 (P4.6-04a): the Mutilate ability, as Cold Blood grants its own.
  "assassination.mutilate": {
    textHash:
      "65f33c2d6574dff85196deaeeaf5805f15af7803e3a8d6fb0bed43c5a40c6b9b",
    ability: "mutilate",
  },
  "assassination.improved-kidney-shot": {
    textHash:
      "0277d504a1d78ca13eaec1720c2788ccf6f3c0b89474eb336caf2c0b89761b18",
    noDpsEffect:
      "Only against a stunned target: Kidney Shot's stun is not simulated, and no rotation casts it.",
  },
  "assassination.seal-fate": {
    textHash:
      "acd452f2180e3f0b08d4df0421400c746b9382a4aa5b33bc82b3a9c81c2d467e",
    procs: [
      {
        id: "seal-fate",
        trigger: "onCrit",
        scope: { abilities: [...k("sealFate.comboPoint").abilities] },
        chance: { mode: "flat", values: [...k("sealFate.comboPoint").chance] },
        actions: [
          {
            type: "gainResource",
            resource: "comboPoints",
            amount: k("sealFate.comboPoint").comboPoints,
          },
        ],
      },
    ],
  },
  "combat.improved-eviscerate": {
    textHash:
      "38bb3ab89f86629b00fb85655e8f136a81e7700cfa37bb3a98029567cbfb4d10",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.07, 0.13, 0.2],
        scope: { abilities: ["eviscerate"] },
      },
    ],
  },
  "combat.improved-sinister-strike": {
    textHash:
      "63b5425316309cf861bed9e9e3a9ff9e096fb69789abd3accd8944a2bf723354",
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        values: [-3, -5],
        scope: { abilities: ["sinister-strike"] },
      },
    ],
  },
  "combat.lightning-reflexes": {
    textHash:
      "cb0f6a18b36547a84bbc5f0d7fe29be48b6115679e47a70b169ef170417164e9",
    noDpsEffect: "dodge chance: nothing attacks the rogue",
  },
  "combat.puncturing-wounds": {
    textHash:
      "b303bfd9d6cde1cf3675456ff1c04c476758c208f26c392a29c26fb34ebae2fe",
    modifiers: [
      {
        kind: "critChance",
        op: "add",
        values: [0.1, 0.2, 0.3],
        scope: { abilities: ["backstab"] },
      },
      {
        kind: "critChance",
        op: "add",
        values: [0.05, 0.1, 0.15],
        scope: { abilities: ["mutilate"] },
      },
    ],
    procs: [
      {
        id: "puncturing-wounds",
        trigger: "onAbility",
        scope: { abilities: ["backstab"] },
        chance: {
          mode: "flat",
          values: [...k("puncturingWounds.comboPoint").chance],
        },
        actions: [
          {
            type: "gainResource",
            resource: "comboPoints",
            amount: k("puncturingWounds.comboPoint").comboPoints,
          },
        ],
      },
    ],
  },
  "combat.deflection": {
    textHash:
      "0b95389cf71bac830aedb615eab0f5c5d45619401a839a20de63ee0372ea3ebb",
    noDpsEffect: "parry chance: nothing attacks the rogue",
  },
  "combat.precision": {
    textHash:
      "e4ba9b265a1171194ccd514dde0bb0e7339e4a747f002a8c4b60e2c1e1838147",
    modifiers: [{ kind: "hitChance", op: "add", values: [0.01, 0.02, 0.03] }],
  },
  "combat.endurance": {
    textHash:
      "1f72e31fba7599c0792fb622039ad5536ed40c0e9fafb4b291cf09fa13b43502",
    noDpsEffect:
      "Sprint and Evasion cooldowns: neither is cast in a damage fight",
  },
  "combat.riposte": {
    textHash:
      "31438b457029352aaf920fc694b3d01131d98f74efcf44de37bf449aed858a3f",
    noDpsEffect:
      "needs a parry of an incoming attack; block and parry are out of scope (project owner ruling 2026-10-26)",
  },
  "combat.improved-sprint": {
    textHash:
      "4225f9149fb1454f4058344b61779ab67a9970a8419d0ccedd0f0a8717fc2db5",
    noDpsEffect: "movement: not simulated",
  },
  "combat.improved-kick": {
    textHash:
      "ecc77b6db43e9aac0eb52482011e058e9c921eacff9142993af8d89e3daff89e",
    noDpsEffect: "interrupts and silences: not simulated",
  },
  "combat.flawless-execution": {
    textHash:
      "2b54db5239b098cc672fbe3257a472a822025de5152034b177116ab3c94efefa",
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        values: [-10],
        scope: { abilities: ["eviscerate"] },
      },
    ],
  },
  "combat.dual-wield-specialization": {
    textHash:
      "5ade073a03315616bc576365efc0bedb4f7cb32122871c812f34aba724ca2341",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.05, 0.1, 0.15, 0.2, 0.25],
        scope: { hands: ["offHand"] },
      },
    ],
  },
  "combat.blade-flurry": {
    textHash:
      "6e809855a8b1f90d3dd76673cf19373e4ce13f2efb6a21687b34e9fb05ecaae7",
    ability: "blade-flurry",
  },
  "combat.hack-and-slash": {
    textHash:
      "ccc64f2f47d20c6b5723b693f8fd7f7758950acf1827a52f9dbf9753f3d4664b",
    modifiers: [
      {
        kind: "critChance",
        op: "add",
        values: [0.01, 0.02, 0.03, 0.04, 0.05],
        scope: { weaponTypes: ["dagger", "fist"] },
      },
      {
        kind: "armorIgnore",
        op: "add",
        values: [0.03, 0.06, 0.09, 0.12, 0.15],
        scope: { weaponTypes: ["mace"] },
      },
    ],
    procs: [
      {
        id: "hack-and-slash",
        trigger: "onHit",
        scope: { weaponTypes: [...k("hackAndSlash.extraAttack").weaponTypes] },
        chance: {
          mode: "flat",
          values: [...k("hackAndSlash.extraAttack").chance],
        },
        actions: [{ type: "extraAttack" }],
      },
    ],
  },
  "combat.weapon-expertise": {
    textHash:
      "584a39561acf9655f770dec7c000e737db3bdc97a069ae05a4c190b732d02103",
    modifiers: [
      { kind: "dodgeReduction", op: "add", values: [0.01, 0.02] },
      { kind: "parryReduction", op: "add", values: [0.01, 0.02] },
    ],
  },
  "combat.aggression": {
    textHash:
      "68fe38f14b304c0e144dfd0961732bbaca6a889a82bf644210959ff1fcfb91eb",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.02, 0.04, 0.06],
        scope: { abilities: ["sinister-strike", "backstab", "eviscerate"] },
      },
    ],
  },
  "combat.adrenaline-rush": {
    textHash:
      "a25233e25ca9613deceaaa95c196fe1275178f7bd462389d33cb8b4ab9744ada",
    ability: "adrenaline-rush",
  },
  // Issue #207. The three Subtlety talents that grant an ability the engine
  // casts. Each entry is the ability link alone, so the rotation casts the
  // ability only when the build has the talent, with no build too (#199,
  // Rogue.lockedByBuild), and a rule that casts it needs a guard
  // (js/rotation-validator.js). The rest of Subtlety is not mapped yet.
  "subtlety.ghostly-strike": {
    textHash:
      "cbaf3c73023e1b0f6b47679a27b7131378d0ede7c3d141691a1d117ff78f18cf",
    ability: "ghostly-strike",
  },
  "subtlety.premeditation": {
    textHash:
      "80ab80aeadcc84e51d1957ead8531af1890884dfcfe32f00d55048ea2a7b86c3",
    ability: "premeditation",
  },
  "subtlety.hemorrhage": {
    textHash:
      "67df2d6b721d2e14f2665901eba0b257522b3dcd5a4892bc3c8d921fb4bf8465",
    ability: "hemorrhage",
  },
};

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const TALENT_EFFECTS = deepFreeze(RAW);
