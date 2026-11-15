// Stat-only set bonuses a rogue can wear, hand-written from wowsims/forever
// @92e67a7ae61f984e8a1fc006ebdeb012f31ac7d1 (MIT). Each bonus cites the file
// and line. modelled bonuses change the sheet. The others are listed and
// flagged not modelled (energy, damage, cost, cooldown, resists, mob-only).
//
// coordinator call 15 Nov (James delegated): Q8, stat-only bonuses in v1.

export const SET_BONUSES = [
  {
    id: 184,
    name: "Shadowcraft Armor",
    source: "sim/common/forever/items_sets.go:437",
    bonuses: [
      {
        pieces: 3,
        modelled: true,
        stats: { attackPower: 30 },
        comment: "+30 attack power",
      },
      {
        pieces: 5,
        modelled: false,
        kind: "energy",
        comment: "Shadowcraft 5-piece Proc",
      },
    ],
  },
  {
    id: 478,
    name: "Madcap's Outfit",
    source: "sim/common/forever/item_sets_auto_gen.go:774",
    bonuses: [
      {
        pieces: 2,
        modelled: true,
        stats: { attackPower: 20 },
        comment: "+20 Attack Power.",
      },
      {
        pieces: 5,
        modelled: false,
        kind: "cost",
        comment: "Decrease the energy cost of Eviscerate and Rupture by 5.",
      },
    ],
  },
  {
    id: 41,
    name: "Dal'Rend's Arms",
    source: "sim/common/forever/item_sets_auto_gen.go:44",
    bonuses: [
      {
        pieces: 2,
        modelled: true,
        stats: { attackPower: 50 },
        comment: "+50 Attack Power.",
      },
    ],
  },
  {
    id: 142,
    name: "Stormshroud Armor",
    source: "sim/common/forever/item_sets_auto_gen.go:169",
    bonuses: [
      {
        pieces: 2,
        modelled: false,
        kind: "damage",
        comment:
          "10% chance of dealing 20 Nature damage on a successful melee attack.",
      },
      {
        pieces: 3,
        modelled: false,
        kind: "energy",
        comment: "4% chance on melee attack of restoring 30 energy.",
      },
      {
        pieces: 4,
        modelled: true,
        stats: { attackPower: 14 },
        comment: "+14 Attack Power.",
      },
    ],
  },
  {
    id: 348,
    name: "Lieutenant Commander's Vestments",
    source: "sim/common/forever/item_sets_auto_gen.go:338",
    bonuses: [
      {
        pieces: 2,
        modelled: true,
        stats: { attackPower: 40 },
        comment: "+40 Attack Power.",
      },
      {
        pieces: 6,
        modelled: true,
        stats: { stamina: 20 },
        comment: "+20 Stamina.",
      },
    ],
  },
  {
    id: 522,
    name: "Champion's Vestments",
    source: "sim/common/forever/item_sets_auto_gen.go:1068",
    bonuses: [
      {
        pieces: 2,
        modelled: true,
        stats: { attackPower: 40 },
        comment: "+40 Attack Power.",
      },
    ],
  },
  {
    id: 393,
    name: "Warlord's Vestments",
    source: "sim/common/forever/item_sets_auto_gen.go:492",
    bonuses: [
      {
        pieces: 6,
        modelled: true,
        stats: { attackPower: 40 },
        comment: "+40 Attack Power.",
      },
    ],
  },
  {
    id: 394,
    name: "Field Marshal's Vestments",
    source: "sim/common/forever/item_sets_auto_gen.go:506",
    bonuses: [
      {
        pieces: 6,
        modelled: true,
        stats: { attackPower: 40 },
        comment: "+40 Attack Power.",
      },
    ],
  },
  {
    id: 548,
    name: "Lieutenant Commander's Guard",
    source: "sim/common/forever/item_sets_auto_gen.go:1296",
    bonuses: [
      {
        pieces: 2,
        modelled: true,
        stats: { attackPower: 40 },
        comment: "+40 Attack Power.",
      },
    ],
  },
  {
    id: 162,
    name: "Embrace of the Viper",
    source: "sim/common/forever/item_sets_auto_gen.go:219",
    bonuses: [
      {
        pieces: 3,
        modelled: true,
        stats: { attackPower: 10 },
        comment: "+10 Attack Power.",
      },
    ],
  },
  {
    id: 143,
    name: "Devilsaur Armor",
    source: "sim/common/forever/item_sets_auto_gen.go:176",
    bonuses: [
      {
        pieces: 2,
        modelled: true,
        stats: { hitPercent: 2 },
        comment: "Improves your chance to hit by 2.0%.",
      },
    ],
  },
  {
    id: 121,
    name: "Cadaverous Garb",
    source: "sim/common/forever/items_sets.go:529",
    bonuses: [
      {
        pieces: 3,
        modelled: true,
        stats: { attackPower: 10 },
        comment: "+10 attack power",
      },
      {
        pieces: 5,
        modelled: true,
        stats: { hitPercent: 2 },
        comment: "2% hit",
      },
    ],
  },
  {
    id: 221,
    name: "Garb of Thero-shan",
    source: "sim/common/forever/item_sets_auto_gen.go:274",
    bonuses: [
      {
        pieces: 6,
        modelled: true,
        stats: { critPercent: 1 },
        comment:
          "Improves your chance to get a critical strike with melee attacks by 1.0%.",
      },
    ],
  },
  {
    id: 161,
    name: "Defias Leather",
    source: "sim/common/forever/item_sets_auto_gen.go:208",
    bonuses: [
      {
        pieces: 4,
        modelled: false,
        kind: "damage",
        comment: "Bleed for 75 Physical damage over 5s.",
      },
      {
        pieces: 5,
        modelled: true,
        weaponSkills: { daggers: 1 },
        comment: "Increased Daggers +1.",
      },
    ],
  },
  {
    id: 2136,
    name: "Defias Enforcer's Garb",
    source: "sim/common/forever/item_sets_auto_gen.go:1866",
    bonuses: [
      {
        pieces: 4,
        modelled: true,
        weaponSkills: { swords: 1 },
        comment: "Increased Swords +1.",
      },
      {
        pieces: 5,
        modelled: false,
        kind: "proc",
        comment:
          "Melee attacks have a chance to increase your Critical Strike chance by 2% for 20s.",
      },
    ],
  },
  {
    id: 1676,
    name: "Darkmantle Armor",
    source: "sim/common/forever/items_sets.go:452",
    bonuses: [
      {
        pieces: 4,
        modelled: false,
        kind: "energy",
        comment: "Darkmantle 4-piece Proc",
      },
    ],
  },
  {
    id: 524,
    name: "Bonescythe Armor",
    source: "sim/common/forever/item_sets_auto_gen.go:1090",
    bonuses: [
      {
        pieces: 4,
        modelled: false,
        kind: "energy",
        comment:
          "Your Backstab, Sinister Strike, and Hemorrhage critical hits cause you to regain 5 energy.",
      },
      {
        pieces: 8,
        modelled: false,
        kind: "proc",
        comment:
          "Your Eviscerate has a chance per combo point to reveal a flaw in your opponent's armor",
      },
    ],
  },
  {
    id: 497,
    name: "Deathdealer's Embrace",
    source: "sim/common/forever/item_sets_auto_gen.go:924",
    bonuses: [
      {
        pieces: 5,
        modelled: false,
        kind: "damage",
        comment: "15% increased damage to your Eviscerate ability.",
      },
    ],
  },
  {
    id: 498,
    name: "Emblems of Veiled Shadows",
    source: "sim/common/forever/item_sets_auto_gen.go:932",
    bonuses: [
      {
        pieces: 3,
        modelled: false,
        kind: "cost",
        comment: "energy cost for your Slice and Dice ability.",
      },
    ],
  },
];

const BY_ID = new Map(SET_BONUSES.map((set) => [set.id, set]));

export function setBonus(id) {
  return BY_ID.get(id) ?? null;
}
