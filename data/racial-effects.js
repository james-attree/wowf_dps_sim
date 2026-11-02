import { k } from "./constants.js";

// What each racial does, as data (roadmap D12a, issue #277, P5-02). One entry
// per racial id (js/racials.js: "race.slug"), hand-authored from the
// racial's own text in the snapshot (data/talentsforever/rogue.json
// `racials`), in the catalogue's order. The engine reads none of it by name:
// js/racials.js expandRace turns a race into the static modifiers
// (js/modifiers.js) it gives the rogue's pipeline.
//
// An entry holds `textHash` and then one of:
//
//   modifiers     static modifiers { kind, op, value, scope? }, the
//                 pipeline's own kinds (A18). The numbers are constants rows
//                 (data/constants.js "racial.*", tagged wowf-export with the
//                 text they were read from), and test/racials.test.js checks
//                 each against the percentage in the text.
//     mobTypes    with modifiers: the target types it applies to. Against any
//                 other target (target.mobType "unspecified" by default) the
//                 racial is inert, as Murder is.
//   noDpsEffect   a one-line reason the racial does nothing in a simulated
//                 damage fight. It stands alone.
//   notSimulated  a one-line reason a racial that would change the damage is
//                 not in the fight yet: the on-use racials until P5-03 (#278,
//                 #279), Touch of the Grave (Phase 5 decision 2). It stands
//                 alone.
//
//   textHash      SHA-256, in hex, of the racial's text. It says which text
//                 the entry was written from; a test and the coverage check
//                 (npm run racials:coverage) recompute it from the snapshot,
//                 so a refresh that rewords a racial cannot go unseen.
//
// Racials are static: none is a proc, so none draws a random number (G2).

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const RAW = {
  "orc.blood-fury": {
    textHash:
      "f6b14aa63c88c2746e79b56075868c9a34f72f3f2ee58cb340fd3c85656f90ba",
    notSimulated:
      "On use: +10% attack power for 15 s on a 2 min cooldown. On-use racials are P5-03a (#278); until then the race adds nothing for it.",
  },
  "orc.hardiness": {
    textHash:
      "0bea06497552bf025baf64cf7fb2a9457d5404499289653094192f66462e0a6d",
    noDpsEffect: "Shortens stuns on the rogue; the target does not stun.",
  },
  "orc.command": {
    textHash:
      "c50045eb47fd37e2506ed9cbb458107cc97c585016fe944245f5c5bddc991b7c",
    noDpsEffect: "Raises Hunter and Warlock pet damage; a rogue has no pet.",
  },
  "orc.shatter-curse": {
    textHash:
      "752929b5739a8d2844e346bc2dd13accffcc39dbbb72a291238a89d7c9ea1fcb",
    noDpsEffect:
      "Removes curses and cuts magic damage taken; the target deals no damage.",
  },
  "undead.underwater-breathing": {
    textHash:
      "dd7c007b07f4cf1177714a79770acd8837acfe730f63b48131ba24ddf594c020",
    noDpsEffect: "Breath underwater only.",
  },
  "undead.will-of-the-forsaken": {
    textHash:
      "f3d2a8ba2d3b0ff58a338b4e1d20261d720b8b16ca1b52c8087e79e3bb70bb75",
    noDpsEffect:
      "Removes charm, fear and sleep from the rogue; the target casts none.",
  },
  "undead.cannibalize": {
    textHash:
      "8a807a48775e0269951cd6142f7aee28f1de79350047524b4373b4c4060e732d",
    noDpsEffect: "Restores health and mana out of combat.",
  },
  "undead.touch-of-the-grave": {
    textHash:
      "1137367dfcdec1918d6f8cbdf069313325fa376a5dfcc5089308a5c7189cd081",
    notSimulated:
      "A health drain on hit (20% for rogues, 15 s internal cooldown) of up to 5% of the rogue's maximum health, which the simulator does not model. Not simulated (Phase 5 decision 2); a post-launch issue.",
  },
  "troll.berserking": {
    textHash:
      "477e7258645c5f4da1dced35bf2b0c5adeedf358194edeecaad67f1507f011aa",
    notSimulated:
      "On use: +10% attack speed for 15 s on a 3 min cooldown. On-use racials are P5-03b (#279); until then the race adds nothing for it.",
  },
  "troll.regeneration": {
    textHash:
      "a59f5d6c045b208353478853e0065fd9328ff27cf8ab8d9b4c50932381f35ef8",
    noDpsEffect: "Health regeneration only.",
  },
  "troll.beast-slaying": {
    textHash:
      "dca160d2a89e71b056b9e9457577a25149827e586d00e08a7bfb69885c0d272e",
    mobTypes: [...k("racial.beastSlaying").mobTypes],
    modifiers: [
      { kind: "damage", op: "add", value: k("racial.beastSlaying").damage },
    ],
  },
  "troll.rapid-regeneration": {
    textHash:
      "257510e556d449e17083228fd5a4b6d12fd6326f3f38e40f32d4b5c63f70f214",
    noDpsEffect: "A channelled heal; the rogue takes no damage in the fight.",
  },
  "skyborne-windshaper.walk-on-air": {
    textHash:
      "c269c3896ea01cce5966f4ce4dda2a37a02e9ffcc565491e1b483a97b4c096a6",
    noDpsEffect: "A glide; no movement in the fight.",
  },
  "skyborne-windshaper.skysight": {
    textHash:
      "8464a88aa4a3d64a06916488b6dfa06072102af570f60928273d7d7f78edd2b1",
    noDpsEffect: "Movement speed only.",
  },
  "skyborne-windshaper.elemental-insight": {
    textHash:
      "a7ae36dbdecf9f98bb763048656ddaadafb96dd8e6892f28a0f99aaadbb0aec5",
    mobTypes: [...k("racial.elementalInsight").mobTypes],
    modifiers: [
      { kind: "damage", op: "add", value: k("racial.elementalInsight").damage },
    ],
  },
  "skyborne-windshaper.wind-blessed": {
    textHash:
      "9498ab9ad74ff0e4d77f27a8d3c2b0dd9dc2686c235fbaf3d0cc2651f77e831b",
    modifiers: [
      { kind: "haste", op: "add", value: k("racial.windBlessed.haste") },
    ],
  },
  "human.ruthless": {
    textHash:
      "09c823a1b29096274db5ba12ffa43fb6a17f37b2a557239a692d5dca8ea592aa",
    modifiers: [
      { kind: "critChance", op: "add", value: k("racial.ruthless.critChance") },
    ],
  },
  "human.the-human-spirit": {
    textHash:
      "ecf5203c4cfa29bfa9f311180a1d694600c416f380ffb875ea3cd9b4e7e40ba4",
    noDpsEffect: "Spirit raises health regeneration only; rogues have no mana.",
  },
  "human.perception": {
    textHash:
      "22ee92569e7e383194717e83369e20cca5277e9d94e3e00c538257aeb3572a74",
    noDpsEffect: "Stealth detection only.",
  },
  "human.will-to-survive": {
    textHash:
      "d6a07e489e96bdea9efbddbc0f185f7c4cb4c17ca560be095f1e1827bf9362f4",
    noDpsEffect: "Removes stuns from the rogue; the target does not stun.",
  },
  "dwarf.find-treasure": {
    textHash:
      "d9df8516d32e517cfbd0d1fc922fc51951162e015c6dc433b7334aca1bcff005",
    noDpsEffect: "Shows treasure on the minimap.",
  },
  "dwarf.stoneform": {
    textHash:
      "a20ff9855a0472a299280b5e779a7232f154b30255558cb25ff4f04767728ca1",
    noDpsEffect:
      "Removes bleeds, poisons and diseases from the rogue and cuts physical damage taken; the target deals no damage.",
  },
  "dwarf.artisans-precision": {
    textHash:
      "7011a7e0fb4d7af6407dc50d07b8c7eb0103a8feaf13e934afd1e634ec434106",
    modifiers: [
      {
        kind: "hitChance",
        op: "add",
        value: k("racial.artisansPrecision.hitChance"),
      },
    ],
  },
  "dwarf.big-game-hunter": {
    textHash:
      "dca160d2a89e71b056b9e9457577a25149827e586d00e08a7bfb69885c0d272e",
    mobTypes: [...k("racial.bigGameHunter").mobTypes],
    modifiers: [
      { kind: "damage", op: "add", value: k("racial.bigGameHunter").damage },
    ],
  },
  "night-elf.shadowmeld": {
    textHash:
      "9e56742a791a8f76a1d95048a7953d1ef24a4be12717503684fa06ca9476f2a5",
    noDpsEffect:
      "Out-of-combat stealth; the fight starts in combat and models no opener from stealth.",
  },
  "night-elf.quickness": {
    textHash:
      "ba1a1c72e3faba9b8bbf65e1435032afa1725726b69f9df02040fe7310db83b0",
    noDpsEffect:
      "Dodge, movement speed and stealth detection; the target deals no damage and nothing moves.",
  },
  "night-elf.wisp-spirit": {
    textHash:
      "39b546b3fa1ce06e3592c0c8a660da6f4cc40ea192e89ac1466f8d73ffd008c8",
    noDpsEffect: "Applies on death only.",
  },
  "night-elf.elunes-light": {
    textHash:
      "63cadadcf39264c2f6c7ef15c638b00f945491c65d18e6b050fea6a6cf0bc3e8",
    notSimulated:
      "On use: +10% crit for 15 s on a 3 min cooldown. On-use racials are P5-03a (#278); until then the race adds nothing for it.",
  },
  "gnome.escape-artist": {
    textHash:
      "23f99bfeec932fc5e3050d06dd673ac8f46f56d77283d3d2a7054dee4de88131",
    noDpsEffect: "Removes movement impairment from the rogue.",
  },
  "gnome.expansive-mind": {
    textHash:
      "0d6fe1200072222df65e9cefc1bd7fa945c47a576029a38dc226d11fecbaf35a",
    modifiers: [
      {
        kind: "resourceMax",
        op: "mult",
        value: k("racial.expansiveMind.energyMax"),
        scope: { resources: ["energy"] },
      },
    ],
  },
  "gnome.engineering-specialization": {
    textHash:
      "d16870d89cf7be9ea3c8846429f1fc745888093177d8d7bf3bd7eb6922eb712a",
    noDpsEffect:
      "Engineering device failure rate; no engineering item is in the fight.",
  },
  "gnome.eureka": {
    textHash:
      "f7d5a5e47f763170393c83568afe82b1ade4d7c1c104d6546d48d149f7213436",
    notSimulated:
      "On use: 10% cheaper and 10% more damage on non-periodic abilities for 8 s on a 2 min cooldown. On-use racials are P5-03b (#279); until then the race adds nothing for it.",
  },
  "skyborne-high-order.walk-on-air": {
    textHash:
      "c269c3896ea01cce5966f4ce4dda2a37a02e9ffcc565491e1b483a97b4c096a6",
    noDpsEffect: "A glide; no movement in the fight.",
  },
  "skyborne-high-order.read-leyline": {
    textHash:
      "cd0039790264ea9822b02688084c44e433e0106fc9f8a2e0eae6d537895fe259",
    noDpsEffect: "Health and mana regeneration only.",
  },
  "skyborne-high-order.elemental-insight": {
    textHash:
      "a7ae36dbdecf9f98bb763048656ddaadafb96dd8e6892f28a0f99aaadbb0aec5",
    mobTypes: [...k("racial.elementalInsight").mobTypes],
    modifiers: [
      { kind: "damage", op: "add", value: k("racial.elementalInsight").damage },
    ],
  },
  "skyborne-high-order.wind-blessed": {
    textHash:
      "9498ab9ad74ff0e4d77f27a8d3c2b0dd9dc2686c235fbaf3d0cc2651f77e831b",
    modifiers: [
      { kind: "haste", op: "add", value: k("racial.windBlessed.haste") },
    ],
  },
};

export const RACIAL_EFFECTS = deepFreeze(RAW);
