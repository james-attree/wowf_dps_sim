import { k } from "./constants.js";

// The weapons and character sheet the preset goldens ran with before presets
// stopped setting either.
// James 15 Nov 2026, to the coordinator: 'Remove the link between weapons and talent/rotation choices.' (supersedes the 10 Nov #340 preset-sets-weapons rulings)
// Every number is a k() id, so this file does not retype a value.
// The rows stay so these goldens and an old link still resolve to the same
// engine input.

function hand(id) {
  const { min, max, speed, type } = k(id);
  return { min, max, speed, type };
}

function sheet(id) {
  return {
    attackPower: k(`${id}.attackPower`),
    critChance: k(`${id}.critChance`),
    bonusHitChance: k("character.bonusHitChance"),
    haste: k("character.haste"),
  };
}

export function legacyPresetGear(presetId) {
  return presetId === "combat-swords-temp"
    ? LEGACY_SWORD
    : LEGACY_DAGGER_PRESET;
}

export const LEGACY_SWORD = Object.freeze({
  character: Object.freeze(sheet("character")),
  weapons: Object.freeze({
    mainHand: Object.freeze(hand("weapon.mainHand")),
    offHand: Object.freeze(hand("weapon.offHand")),
  }),
});

const daggerId = k("presetReferenceBuild.daggerCharacter");

export const LEGACY_DAGGER_PRESET = Object.freeze({
  character: Object.freeze({
    attackPower: k(`${daggerId}.attackPower`),
    critChance: k(`${daggerId}.critChance`),
    bonusHitChance: k("character.bonusHitChance"),
    haste: k("character.haste"),
  }),
  weapons: Object.freeze({
    mainHand: Object.freeze(hand("weapon.dagger.mainHand")),
    offHand: Object.freeze(hand("presetReferenceBuild.daggerOffHand")),
  }),
});
