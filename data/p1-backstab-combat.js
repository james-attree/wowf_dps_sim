// Level-60 human sheet for wowsims/forever Backstab Combat
// (ui/specs/rogue/dps/gear_sets/p1_bscombat.gear.json at
// 92e67a7ae61f984e8a1fc006ebdeb012f31ac7d1). The numbers are what
// deriveSheet returns for that list. test/page-default-297.test.js
// derives them again from data/gear/p1-bscombat.gear.json and the item
// snapshot, so this module does not import the item catalogue.
// coordinator call 15 Nov (James delegated): this is the page default.
// Expertise is rating (10 per 1%). The derived fraction is 1.1%.

export const P1_BACKSTAB_COMBAT = Object.freeze({
  character: Object.freeze({
    attackPower: 608,
    critChance: 0.179705,
    bonusHitChance: 0.087,
    haste: 0,
    expertise: 11,
  }),
  weapons: Object.freeze({
    mainHand: Object.freeze({
      min: 54,
      max: 102,
      speed: 1.8,
      type: "dagger",
      weaponSkill: 300,
    }),
    offHand: Object.freeze({
      min: 71,
      max: 134,
      speed: 2.4,
      type: "axe",
      weaponSkill: 300,
    }),
  }),
});
