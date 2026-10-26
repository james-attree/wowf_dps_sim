import { k } from "../data/constants.js";
import { abilityCatalogue } from "./abilities.js";

// Tags for damage events (roadmap A3). Every attack, DoT tick and (later)
// poison hit is described by its ability id, a school and a few tags, so a
// modifier can say "Rupture", "Nature", "bleeds", "poisons", "finishers" or
// "white hits" in data (scope.abilities, scope.schools, scope.tags in
// js/modifiers.js) and the engine never names an ability to find out.
//
//   school  "physical" or "nature". One per event.
//   tags    any of:
//             bleed     periodic physical damage that skips armor
//             poison    a poison's damage (poison.spells)
//             white     an auto attack (the attack type "weapon")
//             yellow    an ability's attack (the attack type "skill")
//             finisher  a finishing move (a combo point cell in the spell data)
//
// Where each part comes from, in data and never in the engine:
//   - the school and the finisher tag are the ability's own fields in the
//     ability catalogue (js/abilities.js), read from the spell data;
//   - bleed is bleed.spells (or a source that says it is a bleed);
//   - poison is poison.spells;
//   - nature is nature.spells (the poisons are listed in both), or a Nature
//     ability in the catalogue; everything else is physical;
//   - white and yellow come from the attack type. A poison is a spell attack,
//     so it is neither.
// An id the catalogue does not know (a test's own source) is physical and has
// only the tags it earns from the attack type.
//
// The tags are read from the constants on every call, not copied at load, so
// a changed constant (a test's, or a retune) takes effect at once. This module
// is pure: no DOM, no clock, no random numbers.

export const SCHOOLS = Object.freeze(["physical", "nature"]);
export const DAMAGE_TAGS = Object.freeze([
  "bleed",
  "poison",
  "white",
  "yellow",
  "finisher",
]);

const PHYSICAL = SCHOOLS[0];
const NATURE = SCHOOLS[1];

// The attack types resolveAttack knows, and the tag each one earns.
const ATTACK_TAGS = Object.freeze({ weapon: "white", skill: "yellow" });

// A snapshot refresh that brought in a school this module does not know
// would otherwise be a silent no-match for every scope. It fails the import.
for (const ability of abilityCatalogue.abilities) {
  if (!SCHOOLS.includes(ability.school)) {
    throw new RangeError(
      `Ability "${ability.id}" has the school "${ability.school}", which js/damage-tags.js does not know. Known: ${SCHOOLS.join(", ")}.`,
    );
  }
}

// The school and tags of one damage event.
//   id          the ability id (the catalogue's slug), or a poison's id
//   attackType  "weapon" (white) or "skill" (yellow)
//   bleed       true when the source says it is a bleed, whatever its id
// Returns { school, tags }, tags in DAMAGE_TAGS order. The result is fresh,
// so a caller may keep it.
export function damageTags({ id, attackType, bleed = false }) {
  const ability = abilityCatalogue.get(id);
  const isPoison = k("poison.spells").includes(id);
  const tags = [];
  if (bleed || k("bleed.spells").includes(id)) {
    tags.push("bleed");
  }
  if (isPoison) {
    tags.push("poison");
  } else if (Object.hasOwn(ATTACK_TAGS, attackType)) {
    tags.push(ATTACK_TAGS[attackType]);
  }
  if (ability !== undefined && ability.finisher !== null) {
    tags.push("finisher");
  }
  return {
    school: k("nature.spells").includes(id)
      ? NATURE
      : (ability?.school ?? PHYSICAL),
    tags,
  };
}
