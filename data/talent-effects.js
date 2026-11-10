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
//   pending      a one-line reason naming the follow-up issue that will map
//                the talent. It stands alone. Coverage treats it as covered.
//                A pending entry still needs textHash (64 hex digits) or boot
//                throws in js/talent-build.js.
//
// A modifier's numbers are written here and checked against the percentage or
// amount in the snapshot's own rank text by test/talent-effects.test.js, at
// every rank. A proc's chance reads the constants row that records it
// (hackAndSlash.extraAttack, puncturingWounds.comboPoint, ruthlessness.comboPoint,
// relentlessStrikes.energy, sealFate.comboPoint, thousandCuts), and the same test checks those against the text too. So the numbers live in data/, none in
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
// Murder was removed in the 3 Nov / 70755 rework (TR-02 / #332). Remorseless
// Attacks and Improved Kidney Shot have no DPS effect. New 70755 talents that
// need engine work are marked `pending`. Venom and Composure are mapped
// (TR-05 / #334). Blood Splatter's Rupture seconds are mapped
// (TR-06 / #335); its Garrote seconds are inert. Death Mark is mapped
// (TR-07 / #336).

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
  "assassination.improved-expose-armor": {
    textHash:
      "afb8de558b07711c51a09b57eff17ad7f0d20d007e43097d3b45d4a8a712e0ac",
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        values: [-5, -10],
        scope: { abilities: ["expose-armor"] },
      },
      {
        kind: "comboRefund",
        op: "add",
        values: [1, 2],
        scope: { abilities: ["expose-armor"] },
      },
    ],
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
  "assassination.blood-splatter": {
    textHash:
      "6d86c1fb8bffdb133105cd9f51935958f62f9bd9daf264fa109290f36780b14b",
    modifiers: [
      {
        kind: "flatDuration",
        op: "add",
        values: [k("bloodSplatter").rupture],
        scope: { abilities: ["rupture"] },
      },
      {
        kind: "flatDuration",
        op: "add",
        values: [k("bloodSplatter").garrote],
        scope: { abilities: ["garrote"] },
      },
    ],
  },
  "assassination.lethality": {
    textHash:
      "432e1f4b33da651496b330773e8b63a4a91e56033caf1ddca1d4c87e22b6cb6c",
    modifiers: [
      {
        kind: "critDamage",
        op: "add",
        values: [0.1, 0.2],
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
  "assassination.relentless-strikes": {
    textHash:
      "53bd23c8c4c586ff360e721f67059ae35d03e97bb9a5964d287ea9e7dfd9f440",
    procs: [
      {
        id: "relentless-strikes",
        trigger: "onAbility",
        scope: { tags: ["finisher"] },
        chance: {
          mode: "perSpent",
          values: [...k("relentlessStrikes.energy").chancePerComboPoint],
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
  "assassination.venom": {
    textHash:
      "ab33e37b89c7fb46aa4985e2ed074b6ef3c83f88d7588b0c0f96552bbb1bc9d1",
    procs: [
      {
        id: "venom",
        trigger: "onHit",
        scope: { abilities: [...k("venom").abilities] },
        chance: { mode: "flat", values: [1] },
        drawless: "whenCertain",
        actions: [{ type: "applyAura", aura: "venom" }],
      },
    ],
  },
  "assassination.improved-kidney-shot": {
    textHash:
      "0277d504a1d78ca13eaec1720c2788ccf6f3c0b89474eb336caf2c0b89761b18",
    noDpsEffect:
      "Only against a stunned target: Kidney Shot's stun is not simulated, and no rotation casts it.",
  },
  "assassination.seal-fate": {
    textHash:
      "346fecba55d8823658fb26ab4f2e76cac854c1d9d0c54240c1914d9cf98c286b",
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
  "assassination.mutilate": {
    textHash:
      "14c34c1dac0402649630fa65721b995ddfd1dd9d6b1ce12143301dae4c69c89d",
    ability: "mutilate",
  },
  "combat.coup-de-grace": {
    textHash:
      "29a705776a7ad658d1b67e9ef239f9dc5547ba2a922b3b9b04be2b2f9ecc580a",
    // Eviscerate damage, and Death Mark's storage rate and dealt damage
    // (TR-07 / #336). The cap is not scaled.
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.07, 0.13, 0.2],
        scope: { abilities: ["eviscerate"] },
      },
      {
        kind: "damage",
        op: "add",
        values: [0.07, 0.13, 0.2],
        scope: { abilities: ["death-mark"] },
      },
      {
        kind: "storageRate",
        op: "add",
        values: [0.07, 0.13, 0.2],
        scope: { abilities: ["death-mark"] },
      },
    ],
  },
  "combat.efficient-strikes": {
    textHash:
      "3751d930cfb5395a87e92565b687ffa9d309ff89ba0088f30bb4df75b7d615fa",
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        values: [-3, -5],
        scope: { abilities: ["sinister-strike", "hemorrhage"] },
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
  "combat.improved-sprint": {
    textHash:
      "4225f9149fb1454f4058344b61779ab67a9970a8419d0ccedd0f0a8717fc2db5",
    noDpsEffect: "movement: not simulated",
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
  "combat.composure": {
    textHash:
      "eb293255ebade87da6cffa23996437960b13e04aeb8186107e90cdbea419d99b",
    modifiers: [
      {
        kind: "poisedEnergy",
        op: "add",
        values: [...k("composure.energy")],
      },
    ],
  },
  "combat.improved-kick": {
    textHash:
      "ecc77b6db43e9aac0eb52482011e058e9c921eacff9142993af8d89e3daff89e",
    noDpsEffect: "interrupts and silences: not simulated",
  },
  "combat.flawless-execution": {
    textHash:
      "6a65a7426ee451aa8e5fe98e140884c5293dd5e95f29056a95d1977103c485b1",
    modifiers: [
      {
        kind: "energyCost",
        op: "add",
        values: [-15],
        scope: { abilities: ["eviscerate"] },
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
      "3efe4fdc21234a4615a8bfa740bdd0f13d52a2f5184d3bc9b8bec778c773a9d1",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.05, 0.1, 0.15],
        scope: { abilities: ["sinister-strike", "eviscerate"] },
      },
    ],
  },
  "combat.dual-wield-specialization": {
    textHash:
      "bbcc8cd7e18374f42bc807e269a05fda1ca221492477ccc4069c0c1c7f24a70b",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.25, 0.5],
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
  "combat.flash-of-steel": {
    textHash:
      "3d455e1528445216a8729da00eafb6500e05bf176d326c9a2dea680f479590d7",
    modifiers: [
      {
        kind: "castGain",
        op: "add",
        values: [...k("flashOfSteel.energy").energy],
        scope: { abilities: ["shank"] },
      },
      {
        kind: "cooldown",
        op: "add",
        values: [...k("flashOfSteel.cooldown").seconds],
        scope: { abilities: ["shank"] },
      },
    ],
  },
  "combat.adrenaline-rush": {
    textHash:
      "a25233e25ca9613deceaaa95c196fe1275178f7bd462389d33cb8b4ab9744ada",
    ability: "adrenaline-rush",
  },
  "subtlety.setup": {
    textHash:
      "cb610db4d13a397b27e9e1b3c0f33dd9d533dc4eaa18708afbeaf0d3943a61f0",
    noDpsEffect: "Needs a dodge of an enemy attack: nothing attacks the rogue.",
  },
  "subtlety.master-of-deception": {
    textHash:
      "99b1bdad38ba6ffa2728b4a17fc185c2932fc15a1348f59300ad366ccb5e8ae8",
    noDpsEffect:
      "Needs Stealth or an opener: the sim models neither; Master of Deception makes the rogue harder to detect in stealth.",
  },
  "subtlety.opportunity": {
    textHash:
      "e3aa7d109f8ecb2a9d83fb48f60cfe1e6ee2ba4e44fe252b48259452b6b346dd",
    modifiers: [
      {
        kind: "damage",
        op: "add",
        values: [0.04, 0.08, 0.12, 0.16, 0.2],
        scope: { abilities: ["backstab", "garrote", "ambush", "mutilate"] },
      },
    ],
  },
  "subtlety.dirty-deeds": {
    textHash:
      "3d8fdc2486a32de0fdbfa8f57419a5a2cca47613b30b104ce804df0ead7093ad",
    noDpsEffect:
      "Needs Stealth or an opener: the sim models neither; Dirty Deeds cuts the cost of Garrote and Cheap Shot, openers the sim never casts, and its not-behind part is moot when the rogue is always behind.",
  },
  "subtlety.camouflage": {
    textHash:
      "9f380cbf63291ae0901901def9fde290dc914256f354764ce0422cda2485d220",
    noDpsEffect:
      "Needs Stealth or an opener: the sim models neither; Camouflage is speed and stealth detection while stealthed.",
  },
  "subtlety.improved-ambush": {
    textHash:
      "bde5d5e3ab8ddba89321814f205d38888eac4ae8918b5fac9be18d71c2fba0f9",
    modifiers: [
      {
        kind: "critChance",
        op: "add",
        values: [...k("improvedAmbush.critChance")],
        scope: { abilities: ["ambush"] },
      },
    ],
  },
  "subtlety.dirty-tricks": {
    textHash:
      "d6762cc441add5295373d0f6a057f96e2fad3744b774074723437f01032c0a58",
    noDpsEffect:
      "Sap and Blind range and energy cost: neither is cast in a damage fight.",
  },
  "subtlety.initiative": {
    textHash:
      "4266f766714189cc0cc0ae8dd2ba8bdbe779e05b8a901398939f97dbf5f5f0f4",
    procs: [
      {
        id: "initiative",
        trigger: "onAbility",
        scope: { abilities: [...k("initiative.comboPoint").abilities] },
        chance: {
          mode: "flat",
          values: [...k("initiative.comboPoint").chance],
        },
        // Drawless at a rank whose chance is 1 (3/3), so no roll that cannot
        // fail is drawn (G2); 1/3 and 2/3 roll.
        drawless: "whenCertain",
        actions: [
          {
            type: "gainResource",
            resource: "comboPoints",
            amount: k("initiative.comboPoint").comboPoints,
          },
        ],
      },
    ],
  },
  "subtlety.premeditation": {
    textHash:
      "80ab80aeadcc84e51d1957ead8531af1890884dfcfe32f00d55048ea2a7b86c3",
    ability: "premeditation",
  },
  "subtlety.serrated-blades": {
    textHash:
      "4be1765f177fbe1ef94693c84ccc2890a1b9c70e13ee2bc4761024e476c43bd3",
    modifiers: [
      { kind: "armorIgnore", op: "add", values: [0.03, 0.06, 0.09] },
      {
        kind: "damage",
        op: "add",
        values: [0.1, 0.2, 0.3],
        scope: { abilities: ["rupture"] },
      },
    ],
  },
  "subtlety.elusiveness": {
    textHash:
      "a0f882c213637be7e9be60e940246cc65e0cde7cb8dbd3dbf99d0c6311dadb41",
    noDpsEffect:
      "Vanish and Blind cooldowns: neither is cast in a damage fight.",
  },
  "subtlety.ghostly-strike": {
    textHash:
      "710845f74a092462f5a6c14f27c0d0f61a43c21cf7ef78f999dc2f1d02c1fbc3",
    ability: "ghostly-strike",
  },
  "subtlety.quick-getaway": {
    textHash:
      "f7394b07a1740212a3b376eb9edd2863b6b8f58e297e99e312213e9371a31cfb",
    noDpsEffect:
      "Sap target count and post-Sap movement: Sap is not cast in a damage fight.",
  },
  "subtlety.heightened-senses": {
    textHash:
      "2bb4814bbd217e046959304f707fa97549b96fb675d38cf5166fda90bfb717df",
    noDpsEffect:
      "Needs Stealth or an opener: the sim models neither; Heightened Senses is stealth detection and spell hit taken.",
  },
  "subtlety.preparation": {
    textHash:
      "40b086f126c9a5a986b7e9c007982aace22e72f7b36ade6c4a60717bc2e3ce64",
    ability: "preparation",
  },
  "subtlety.hemorrhage": {
    textHash:
      "6358b8fdbde842219d4e8370e80858c08e8141efa537ca9e83797d4bd516f885",
    ability: "hemorrhage",
  },
  "subtlety.boot-knife": {
    textHash:
      "31294ac2ba6e3e8c5ac664ed81403f3ce6f8eb528cbe8981891f8843898a110f",
    procs: [
      {
        id: "boot-knife",
        trigger: "onHit",
        scope: { abilities: [...k("bootKnife.comboPoint").abilities] },
        chance: {
          mode: "flat",
          values: [...k("bootKnife.comboPoint").chance],
        },
        actions: [
          {
            type: "gainResource",
            resource: "comboPoints",
            amount: k("bootKnife.comboPoint").comboPoints,
          },
        ],
      },
    ],
  },
  "subtlety.death-mark": {
    textHash:
      "d68af3c464e41a0e92a3ebdd01c58ee787974dd8514346a66264fa3807c4e3d9",
    ability: "death-mark",
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
