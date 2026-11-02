import { k } from "../data/constants.js";

// The two levels of a fight and what follows from them (#290): the character
// level (config.talentLevel, which also sets the talent points), the enemy
// level (config.target.level, or the character level + 3 while it is null),
// and the target's armour at that enemy level. js/simulation.js reads them
// for the attack table (deriveAttackTable) and the armour divisor; the rogue
// reads the character level for its ranks (js/ranks.js).

// The character level of a config: its talentLevel (10 to 60). A config with
// none is the default level, character.level.
export function characterLevel(config) {
  return config?.talentLevel ?? k("character.level");
}

// The enemy level of a config: config.target.level when it is a number, and
// otherwise (null, the default, or an old config without one) the character
// level + target.levelAboveCharacter, so it follows the level.
export function targetLevel(config) {
  const level = config?.target?.level;
  if (typeof level === "number") {
    return level;
  }
  return characterLevel(config) + k("target.levelAboveCharacter");
}

// The target's armour at an enemy level: target.armorByLevel's points
// ([level, armor], level order) and then [target.level, target.armor] (63,
// 3731: the armour the fight always had), joined by straight lines and
// rounded. A level outside the points takes the nearest end.
export function targetArmor(level) {
  const points = [
    ...k("target.armorByLevel"),
    [k("target.level"), k("target.armor")],
  ];
  if (!Number.isFinite(level)) {
    throw new RangeError(`targetArmor needs a level, not ${String(level)}.`);
  }
  if (level <= points[0][0]) {
    return points[0][1];
  }
  for (let index = 1; index < points.length; index += 1) {
    const [toLevel, toArmor] = points[index];
    if (level <= toLevel) {
      const [fromLevel, fromArmor] = points[index - 1];
      const share = (level - fromLevel) / (toLevel - fromLevel);
      return Math.round(fromArmor + share * (toArmor - fromArmor));
    }
  }
  return points[points.length - 1][1];
}
