// Every game number lives here. Engine modules read them through k(id).
// Ability and talent numbers that the engine does not use yet are still
// listed, because the roadmap's provenance table is the seed for this file.

const WOWF_EXPORT = "wowf-export";
const WOWF_DESIGNER = "wowf-designer";
const CLASSIC = "classic-1.12";
const CATACLYSM = "cataclysm";
const ASSUMPTION = "assumption";

const MAGEY = "https://github.com/magey/classic-warrior/wiki/Attack-table";
const BLIZZ_HIT =
  "https://us.forums.blizzard.com/en/wow/t/bug-hit-tables/185675/12";
const ZUG = "https://zugzugdb.com/formulas";
const HIT_WIKI = "https://classic-wow-archive.fandom.com/wiki/Hit";
const ATTACK_WIKI = "https://vanilla-wow-archive.fandom.com/wiki/Attack_table";
const WH_DW = "https://www.wowhead.com/classic/spell=674/dual-wield";
const WH_RUP = "https://www.wowhead.com/classic/spell=1943/rupture";
const WH_CATA_RUP = "https://www.wowhead.com/cata/spell=1943/rupture";
const WS = "https://github.com/wowsims/classic/blob/master/sim/";

function entry(value, unit, source, ref, note, retune) {
  return { value, unit, source, ref, note, retune };
}

function undecided(why) {
  return `No recorded owner decision as of 22 Oct 2026. ${why} James to fill in who decided this and why.`;
}

export const CONSTANTS = {
  // wowf-export: re-read when the talentsforever snapshot refreshes.
  "energy.regenPerSecond": entry(
    10,
    "energy/s",
    WOWF_EXPORT,
    "rogue.json → class_abilities[Energy]",
    "Continuous, 1 point per 0.1s. Classic was 20 per 2s tick.",
    false,
  ),
  "combo.max": entry(
    5,
    "CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Eviscerate|Rank 9]",
    "Finishers say 1 to 5 combo points.",
    false,
  ),
  "premeditation.cpExpiry": entry(
    20,
    "s",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Premeditation|]",
    "The combo points Premeditation added are lost after 20s unless a later cast adds a combo point or a finisher spends them. Classic was 10s and needed Stealth.",
    false,
  ),
  premeditation: entry(
    { energy: 0, cooldown: 120, comboPoints: 2 },
    "energy, s, CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Premeditation|]",
    "2 min cooldown and 2 combo points. The 20s expiry is premeditation.cpExpiry.",
    false,
  ),
  adrenalineRush: entry(
    { energy: 0, regenMultiplier: 2, duration: 15, cooldown: 300 },
    "energy, ×, s, s",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Adrenaline Rush|]",
    "Export cooldown is 5 min. The engine still uses adrenalineRush.engineCooldown (180s) until Q12.",
    false,
  ),
  "adrenalineRush.engineCooldown": entry(
    180,
    "s",
    ASSUMPTION,
    undecided(
      "js/skill.js constructed Adrenaline Rush with a 180s cooldown. The export says 300s, which Q12 tracks.",
    ),
    "Kept so this change does not retune the cooldown.",
    true,
  ),
  bladeFlurry: entry(
    { energy: 25, haste: 0.2, duration: 15, cooldown: 120 },
    "energy, ×, s, s",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Blade Flurry|]",
    "Cleave is ignored on a single target. The engine still leaves it off the GCD (Q15).",
    false,
  ),
  sliceAndDice: entry(
    {
      energy: 25,
      cooldown: 0,
      haste: 0.3,
      durationByCp: [9, 12, 15, 18, 21],
    },
    "energy, ×, s",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Slice and Dice|Rank 2]",
    "Duration is 6 + 3 × CP, stored per combo point. The cast is still commented out (Q13) and off the GCD (Q15).",
    false,
  ),
  "hemorrhage.ruptureBonus": entry(
    { bonus: 0.15, duration: 15 },
    "×, s",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Hemorrhage|]",
    "Export is +15% Rupture damage for 15s. The engine still multiplies every DoT tick (Q14).",
    false,
  ),
  hemorrhage: entry(
    { energy: 35, cooldown: 0, weaponMultiplier: 1.45, comboPoints: 1 },
    "energy, s, ×, CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Hemorrhage|]",
    "145% weapon damage assumes a dagger main hand. Non-dagger is 100% (Q14).",
    false,
  ),
  "abilities.*": entry(
    "per ability",
    "–",
    WOWF_EXPORT,
    "rogue.json → spell_desc (max rank)",
    "Umbrella row for costs, cooldowns, weapon percents, and per-CP tables. The engine reads the per-ability constants until D1 parses spell_desc.",
    false,
  ),
  sinisterStrike: entry(
    { energy: 45, cooldown: 0, bonusDamage: 68, comboPoints: 1 },
    "energy, s, damage, CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Sinister Strike|Rank 8]",
    "Weapon damage plus 68.",
    false,
  ),
  eviscerate: entry(
    {
      energy: 35,
      cooldown: 0,
      damageByCp: [
        { min: 224, max: 332 },
        { min: 394, max: 502 },
        { min: 564, max: 672 },
        { min: 734, max: 842 },
        { min: 904, max: 1012 },
      ],
    },
    "energy, s, damage",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Eviscerate|Rank 9]",
    "Base damage by combo point. AP scaling is eviscerate.apPerCP. Zero CP adds no base damage.",
    false,
  ),
  rupture: entry(
    {
      energy: 25,
      cooldown: 0,
      damageByCp: [159, 222, 295, 377, 469],
      durationByCp: [8, 10, 12, 14, 16],
    },
    "energy, s, damage, s",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Rupture|Rank 6]",
    "Base damage and duration by combo point. AP scaling is rupture.apByCP.",
    false,
  ),
  "rupture.apAtZeroCp": entry(
    0.1,
    "AP",
    ASSUMPTION,
    undecided(
      "Rupture.damage() initialises AP scaling to 0.1 before the per-CP table. It is not a Cataclysm coefficient.",
    ),
    "damage() still uses this factor at 0 CP. Skill.cast rejects that cast, so a fight never spends energy or applies it (Q4).",
    true,
  ),
  ghostlyStrike: entry(
    {
      energy: 40,
      cooldown: 20,
      duration: 7,
      weaponMultiplier: 1.8,
      comboPoints: 1,
    },
    "energy, s, s, ×, CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Ghostly Strike|]",
    "180% assumes a dagger main hand. Otherwise the export says 125% (Q14).",
    false,
  ),
  backstab: entry(
    {
      energy: 60,
      cooldown: 0,
      weaponMultiplier: 1.5,
      bonusDamage: 225,
      comboPoints: 1,
    },
    "energy, s, ×, damage, CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Backstab|Rank 9]",
    "150% weapon damage plus 225. Dagger and behind requirements are not enforced.",
    false,
  ),
  ambush: entry(
    {
      energy: 60,
      cooldown: 0,
      weaponMultiplier: 2.5,
      bonusDamage: 290,
      comboPoints: 1,
    },
    "energy, s, ×, damage, CP",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Ambush|Rank 6]",
    "250% weapon damage plus 290. Stealth, dagger, and behind requirements are not enforced.",
    false,
  ),
  "poison.instant": entry(
    { chance: 0.2, min: 76, max: 100, charges: 175 },
    "chance, damage, charges",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Instant Poison|Rank 6]",
    "Not simulated yet.",
    false,
  ),
  "poison.deadly": entry(
    { chance: 0.3, damage: 92, duration: 12, stacks: 5, charges: 180 },
    "chance, damage, s, stacks, charges",
    WOWF_EXPORT,
    "rogue.json → spell_desc[Rogue|Deadly Poison|Rank 5]",
    "Not simulated yet.",
    false,
  ),
  "talents.maxPoints": entry(
    51,
    "points",
    WOWF_EXPORT,
    "rogue.json → talents.classic_total",
    "Also stated on the Legacy perk Talented.",
    false,
  ),
  "talents.*": entry(
    "per rank",
    "–",
    WOWF_EXPORT,
    "rogue.json → talents.trees[].talents[].desc",
    "Hand-encoded later in the effects map with a text hash (D5, D6).",
    false,
  ),

  // classic-1.12: reference values until WoW Forever is measured.
  "gcd.duration": entry(
    1,
    "s",
    CLASSIC,
    WH_RUP,
    "Rogue GCD. wowsims GCDMin is the same length.",
    true,
  ),
  "gcd.flags": entry(
    "SnD, BF, AR on GCD; Premeditation off",
    "–",
    CLASSIC,
    `${WS}rogue/talents.go`,
    "Not applied. The engine still leaves Blade Flurry, Adrenaline Rush, and Slice and Dice off the GCD (Q15). Premeditation stays off the GCD.",
    true,
  ),
  "ap.perDps": entry(
    14,
    "AP per 1 DPS",
    CLASSIC,
    ZUG,
    "wowsims DefaultAttackPowerPerDPS.",
    true,
  ),
  "normalizedSpeed.dagger": entry(
    1.7,
    "s",
    CLASSIC,
    ZUG,
    "Instant attacks use normalized speed for the AP bonus. The engine assumes a dagger.",
    true,
  ),
  "normalizedSpeed.oneHand": entry(
    2.4,
    "s",
    CLASSIC,
    ZUG,
    "Swords, maces, and fist weapons. Axes are assumed the same. Not selected by the engine yet.",
    true,
  ),
  "offHand.damageMult": entry(
    0.5,
    "×",
    CLASSIC,
    WH_DW,
    "Applied to the whole off-hand hit, weapon roll and AP bonus together. Dual Wield Specialization multiplies on top later and is not applied yet.",
    true,
  ),
  "crit.meleeMultiplier": entry(
    2,
    "×",
    CLASSIC,
    ZUG,
    "Physical crits deal double damage. Lethality-style talents raise the bonus later.",
    true,
  ),
  "weaponSkill.base": entry(
    300,
    "skill",
    CLASSIC,
    MAGEY,
    "Level × 5 at 60. The full attack table is A7.",
    true,
  ),
  "target.defense": entry(
    315,
    "defense",
    CLASSIC,
    MAGEY,
    "Target level × 5. Not applied until A7.",
    true,
  ),
  "miss.yellow": entry(
    0.08,
    "chance",
    CLASSIC,
    BLIZZ_HIT,
    "5% + 0.2% per point when defense − skill > 10, else 0.1%. 8% at 300 skill, 6% at 305.",
    true,
  ),
  "hit.suppression": entry(
    0.01,
    "chance",
    CLASSIC,
    BLIZZ_HIT,
    "First 1% of +hit is ignored when defense − skill > 10, so the hit cap is 9%. Not applied until A7.",
    true,
  ),
  "miss.dualWieldPenalty": entry(
    0.19,
    "chance",
    CLASSIC,
    MAGEY,
    "White swings only. 8% + 19% = 27% miss at 300 skill. Confirmed by James, 22 Oct 2026. The engine previously used a flat 24%.",
    true,
  ),
  "dodge.target": entry(
    0.065,
    "chance",
    CLASSIC,
    BLIZZ_HIT,
    "5% + 0.1% per point of defense over skill.",
    true,
  ),
  "parry.target": entry(
    { front: 0.14, behind: 0 },
    "chance",
    CLASSIC,
    BLIZZ_HIT,
    "Behind removes parry and block. The engine still passes a 0 parry chance on the single roll; the front/behind split is A7.",
    true,
  ),
  "block.target": entry(
    { front: 0.05, behind: 0 },
    "chance",
    CLASSIC,
    MAGEY,
    "Mob block is capped at 5%. Not on the current single-roll table (A7).",
    true,
  ),
  "glancing.chance": entry(
    0.4,
    "chance",
    CLASSIC,
    MAGEY,
    "10% + 2% per point of defense over capped skill. White swings only.",
    true,
  ),
  "glancing.damage": entry(
    0.65,
    "×",
    CLASSIC,
    MAGEY,
    "Flat average in force today. Magey range is 0.55–0.75 (low 1.3 − 0.05Δ, max 0.91; high 1.2 − 0.03Δ, max 0.99). The range is A7.",
    true,
  ),
  "table.white": entry(
    "single roll",
    "–",
    CLASSIC,
    ATTACK_WIKI,
    "Miss, dodge, parry, glancing, block, crit, hit. The engine uses one roll and omits block. Glancing cannot crit.",
    true,
  ),
  "table.yellow": entry(
    "two rolls",
    "–",
    CLASSIC,
    HIT_WIKI,
    "Not applied. Yellow attacks still share the single roll and do not glance (A7).",
    true,
  ),
  "crit.suppressionSkill": entry(
    0.03,
    "chance",
    CLASSIC,
    MAGEY,
    "0.2% per point of defense over capped skill (315 − 300). Not applied until A7.",
    true,
  ),
  "crit.suppressionAura": entry(
    0.018,
    "chance",
    CLASSIC,
    MAGEY,
    "Test estimate for crit from auras against +3 targets. With the skill term, total suppression is 4.8%. Not applied until A7.",
    true,
  ),
  "spell.missTarget": entry(
    { chance: 0.17, floor: 0.01 },
    "chance",
    CLASSIC,
    `${WS}core/target.go`,
    "Spell miss used for poisons. Not applied yet.",
    true,
  ),
  "poison.hitModel": entry(
    "spell hit",
    "–",
    CLASSIC,
    `${WS}rogue/poisons.go`,
    "Melee hit does not reduce poison misses. Uncertain, and not applied yet.",
    true,
  ),
  "poison.procSource": entry(
    "landed weapon hits",
    "–",
    CLASSIC,
    WH_DW,
    "White and yellow. Yellow attacks count as main hand. Not applied yet.",
    true,
  ),
  "poison.deadlyTick": entry(
    { interval: 3, ticks: 4 },
    "s × ticks",
    CLASSIC,
    `${WS}rogue/poisons.go`,
    "Ticks can crit in Forever (dot.canCrit). Not simulated yet.",
    true,
  ),
  "poison.instantCrit": entry(
    1.5,
    "×",
    CLASSIC,
    `${WS}rogue/poisons.go`,
    "Instant Poison crits as a spell. Uncertain, and not applied yet.",
    true,
  ),
  "bleed.ignoresArmor": entry(
    true,
    "–",
    CLASSIC,
    `${WS}core/spell_resistances.go`,
    "Physical DoTs ignore armor. The engine has no armor mitigation yet, so this is not applied (Q11).",
    true,
  ),
  "dot.snapshot": entry(
    "at application",
    "–",
    CLASSIC,
    `${WS}rogue/rupture.go`,
    "Rupture damage is fixed when the cast resolves.",
    true,
  ),
  "rupture.tickInterval": entry(
    2,
    "s",
    CLASSIC,
    WH_RUP,
    "Duration 6 + 2 × CP matches the export. The dot applicator uses this interval for every DoT.",
    true,
  ),
  "eviscerate.apPerCP": entry(
    0.03,
    "AP × CP",
    CLASSIC,
    `${WS}rogue/eviscerate.go`,
    "0.07 is TBC and later.",
    true,
  ),
  "armor.mitigation": entry(
    { constant: 400, perLevel: 85, cap: 0.75 },
    "fraction",
    CLASSIC,
    `${WS}core/spell_resistances.go`,
    "armor / (armor + constant + perLevel × attacker level). At 60 the divisor constant is 5500. Not applied yet.",
    true,
  ),
  "agility.ap": entry(
    1,
    "AP per agi",
    CLASSIC,
    `${WS}rogue/rogue.go`,
    "Only if primary stats are added (OQ8).",
    true,
  ),
  "strength.ap": entry(
    1,
    "AP per str",
    CLASSIC,
    `${WS}core/base_stats.go`,
    "Only if primary stats are added (OQ8).",
    true,
  ),
  "agility.crit": entry(
    29,
    "agi per 1%",
    CLASSIC,
    `${WS}core/base_stats.go`,
    "About 0.0345% crit per agility at 60. Only if primary stats are added (OQ8).",
    true,
  ),
  "energy.max": entry(
    100,
    "energy",
    CLASSIC,
    `${WS}rogue/rogue.go`,
    "Matches Forever Vigor's +10 in the export.",
    true,
  ),

  // cataclysm: Forever borrows this later mechanic on purpose.
  "rupture.apByCP": entry(
    [0.06, 0.12, 0.18, 0.24, 0.3],
    "AP total",
    CATACLYSM,
    WH_CATA_RUP,
    "Owner decision, 22 Oct 2026: keep the Cataclysm totals. Classic was 0.04–0.24. Per tick this is 0.015, 0.024, 0.03, 0.0342857, 0.0375 across 4–8 ticks.",
    true,
  ),

  // wowf-designer: James's knowledge of WoW Forever.
  "dot.canCrit": entry(
    true,
    "–",
    WOWF_DESIGNER,
    "James, 22 Oct 2026: all DoTs, bleeds included, can crit in WoW Forever",
    "Rupture, Garrote, and Deadly Poison. This differs from Classic. The per-tick crit roll stays.",
    false,
  ),
  "dot.critMultiplier": entry(
    2,
    "×",
    WOWF_DESIGNER,
    "James, 22 Oct 2026: DoTs and bleeds crit at 2×",
    "Same multiplier as other crits. The roadmap had listed the 2× as a presumption; the owner stated it as the decision.",
    true,
  ),

  // assumption: defaults or rules nobody has signed by name.
  "target.level": entry(
    63,
    "level",
    ASSUMPTION,
    undecided(
      "Roadmap OQ4 uses 63, the Classic raid boss (level 60 + 3) from https://github.com/wowsims/classic/blob/master/sim/core/target.go.",
    ),
    "Forever boss levels are unknown. Editable later (D15).",
    true,
  ),
  "target.armor": entry(
    3731,
    "armor",
    ASSUMPTION,
    undecided(
      "The roadmap constants table lists 3731 as a common Classic raid-boss armor value before debuffs.",
    ),
    "Editable input. Not applied, because the engine has no armor mitigation yet.",
    true,
  ),
  "target.behind": entry(
    true,
    "–",
    ASSUMPTION,
    undecided(
      "Roadmap OQ4 defaults to behind the target, which removes parry and block.",
    ),
    "Editable input. The engine does not branch on it yet (A7).",
    true,
  ),
  "target.mobType": entry(
    "unspecified",
    "–",
    ASSUMPTION,
    undecided(
      "The roadmap leaves mob type unset so Murder and racial slayer bonuses stay off.",
    ),
    "Editable input.",
    true,
  ),
  "fight.duration": entry(
    180,
    "s",
    ASSUMPTION,
    undecided(
      "The roadmap constants table uses 180s while OQ3 (default fight length) is still open.",
    ),
    "Editable input. The live sim runs until pause and does not read this.",
    true,
  ),
  "fight.iterations": entry(
    1000,
    "runs",
    ASSUMPTION,
    undecided(
      "The roadmap constants table uses 1000 iterations while OQ3 is still open.",
    ),
    "Editable input. There is no batch runner yet.",
    true,
  ),
  "start.state": entry(
    { energy: 100, comboPoints: 0 },
    "energy, CP",
    ASSUMPTION,
    undecided(
      "The roadmap start state is full energy and 0 combo points, with no pre-pull Premeditation (OQ7, Q10).",
    ),
    "The engine reads the energy. Combo points stay on character.startingComboPoints until Q10.",
    true,
  ),
  "talents.rowGating": entry(
    5,
    "points",
    ASSUMPTION,
    undecided(
      "Roadmap OQ14 uses the Classic 5-points-per-row rule (https://warcraft.wiki.gg/wiki/Talent). It is not in the export.",
    ),
    "Not enforced yet.",
    true,
  ),
  latency: entry(
    0,
    "ms",
    ASSUMPTION,
    undecided(
      "The roadmap models a perfect reaction and leaves a configurable delay for later.",
    ),
    "The engine does not delay casts.",
    true,
  ),
  "poison.charges": entry(
    "unlimited",
    "–",
    ASSUMPTION,
    undecided(
      "The roadmap ignores poison charges. The export lists 175–180 per coat.",
    ),
    "Poisons are not simulated yet.",
    true,
  ),
  "hackAndSlash.chain": entry(
    false,
    "–",
    ASSUMPTION,
    undecided(
      "The roadmap says an extra attack cannot trigger another extra attack.",
    ),
    "Hack and Slash is not simulated yet.",
    true,
  ),

  // Values the current engine uses that are not rows in the roadmap table.
  "character.attackPower": entry(
    450,
    "AP",
    ASSUMPTION,
    undecided(
      "js/rogue.js hardcodes 450 attack power as the sample character.",
    ),
    "SimConfig will own this (E2).",
    true,
  ),
  "character.critChance": entry(
    0.1,
    "chance",
    ASSUMPTION,
    undecided(
      "js/rogue.js hardcodes a 10% crit chance as the sample character.",
    ),
    "SimConfig will own this (E2).",
    true,
  ),
  "character.bonusHitChance": entry(
    0.09,
    "chance",
    ASSUMPTION,
    undecided("js/rogue.js hardcodes 9% bonus hit as the sample character."),
    "9% matches the Classic hit cap, but the code does not say that. SimConfig will own this (E2).",
    true,
  ),
  "character.startingComboPoints": entry(
    0,
    "CP",
    ASSUMPTION,
    "No recorded owner decision as of 22 Oct 2026. Issue #18: fights start at 0 combo points. The issue's source is an assumption (no pre-pull Premeditation or stealth opener; OQ7).",
    "The sample fight reads this. start.state records the same 0 combo points and full energy.",
    true,
  ),
  "weapon.mainHand": entry(
    { min: 59, max: 110, speed: 1.8 },
    "damage, damage, s",
    ASSUMPTION,
    undecided(
      "js/rogue.js sample main hand is 59–110 at speed 1.8. Issue #9 corrected min and max, which had been stored as 110 and 59.",
    ),
    "Issue #9 unswaps the sample main hand. SimConfig will own the weapon (E2).",
    true,
  ),
  "weapon.offHand": entry(
    { min: 54, max: 101, speed: 1.7, initialSwing: 0.5 },
    "damage, damage, s, s",
    ASSUMPTION,
    undecided(
      "js/rogue.js sample off hand is 54–101 at speed 1.7, with the first swing delayed by 0.5s.",
    ),
    "The delay stops both hands swinging on the first frame. SimConfig will own the weapon (E2).",
    true,
  ),
  "skill.missEnergyRefund": entry(
    0.8,
    "×",
    ASSUMPTION,
    undecided(
      "Skill.cast refunds 80% of the energy cost when an attack does not land. Classic and the export do not describe that refund.",
    ),
    "Present since the initial skill code.",
    true,
  ),
  "rotation.adrenalineRushEnergy": entry(
    25,
    "energy",
    ASSUMPTION,
    undecided(
      "Rogue.rotation casts Adrenaline Rush when energy is at or below 25.",
    ),
    "Rotation threshold, not a spell cost.",
    true,
  ),
  "rotation.sliceAndDiceComboPoints": entry(
    4,
    "CP",
    ASSUMPTION,
    undecided(
      "Rogue.rotation considers Slice and Dice from 4 combo points. The cast is commented out.",
    ),
    "Rotation threshold.",
    true,
  ),
  "rotation.sliceAndDiceRefreshSeconds": entry(
    3,
    "s",
    ASSUMPTION,
    undecided(
      "Rogue.rotation treats Slice and Dice as due for refresh at 3 seconds remaining.",
    ),
    "The cast is commented out, so this does not change damage today.",
    true,
  ),
  "attack.rollScale": entry(
    100,
    "roll",
    ASSUMPTION,
    undecided(
      "resolveAttack compares an injected roll on a 0–100 scale. The scale came with the resolver so tests can hit each boundary.",
    ),
    "Not a game rule. Callers and the resolver tests depend on it.",
    true,
  ),
  "log.maxEvents": entry(
    100,
    "events",
    ASSUMPTION,
    undecided("Simulation keeps the newest 100 combat-log rows."),
    "Display cap, not a game rule.",
    true,
  ),
  "sim.msPerSecond": entry(
    1000,
    "ms/s",
    ASSUMPTION,
    undecided(
      "Simulation converts the performance clock from milliseconds to seconds with 1000.",
    ),
    "Unit conversion, not a game rule.",
    true,
  ),
  "sim.tickEpsilon": entry(
    1e-9,
    "s",
    ASSUMPTION,
    undecided(
      "The DoT loop treats a remaining tick time at or below 1e-9 seconds as due, to absorb floating-point error.",
    ),
    "Numerical tolerance, not a game rule.",
    true,
  ),
};

export function k(id) {
  const constant = CONSTANTS[id];
  if (!constant) {
    throw new Error(`Unknown constant: ${id}`);
  }
  return constant.value;
}
