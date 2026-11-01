import { PRESET_REFERENCE_BUILDS } from "../data/preset-reference-builds.js";
import { ROTATION_PRESETS } from "../data/rotation-presets.js";
import { k } from "../data/constants.js";
import { buildProblems, talentLevelRange } from "./talent-build.js";

// The small API over the preset reference builds (issue #272,
// data/preset-reference-builds.js), for #273's "use this preset's build"
// button. No DOM and no config is changed: each function reads a build and
// returns new data.
//
//   referenceBuild(presetId)        a copy of the preset's build, or null when
//                                   the preset has none. An id that is not a
//                                   preset is a RangeError.
//   talentDifferences(build, talents)
//                                   [{ id, reference, current }], one for each
//                                   talent whose rank differs (a missing rank
//                                   is 0), sorted by id. [] when they agree.
//   weaponTypeDifferences(build, weapons)
//                                   { mainHand, offHand }, each
//                                   { reference, current, same }: the weapon
//                                   type in that hand.
//   referenceWeapon(build, hand)    a copy of that hand: { type, min, max,
//                                   speed }, the SimConfig weapon shape.
//   poisonDifferences(build, poisons)
//                                   { mainHand, offHand }, each
//                                   { reference, current, same }: the poison
//                                   id in that hand (a missing one is null,
//                                   as in the default config).
//   referencePoison(build, hand)    that hand's poison id, for
//                                   config.poisons.
//   checkReferenceBuild(presetId, build)
//                                   the problems with one entry, as strings;
//                                   [] for a good one. Every entry is checked
//                                   when this module is imported.

const HANDS = ["mainHand", "offHand"];
const WEAPON_NUMBERS = ["min", "max", "speed"];
const FIELDS = ["name", "talentLevel", "talents", "weapons", "poisons"];
const PRESET_IDS = new Set(ROTATION_PRESETS.map((preset) => preset.id));

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function weaponProblems(hand, weapon) {
  if (!isObject(weapon)) {
    return [`weapons.${hand} is missing.`];
  }
  const problems = [];
  if (typeof weapon.type !== "string" || weapon.type === "") {
    problems.push(`weapons.${hand}.type is not a weapon type.`);
  }
  for (const field of WEAPON_NUMBERS) {
    if (!Number.isFinite(weapon[field]) || weapon[field] <= 0) {
      problems.push(`weapons.${hand}.${field} is not a positive number.`);
    }
  }
  if (weapon.min > weapon.max) {
    problems.push(`weapons.${hand}.min is above its max.`);
  }
  return problems;
}

// Every reference build is for the top talent level, 60 (James's decision,
// relayed by Scout, #272).
function levelProblems(build) {
  const { max } = talentLevelRange();
  return build.talentLevel === max
    ? []
    : [`talentLevel is ${build.talentLevel}, not ${max}.`];
}

// Every build carries Instant Poison on the main hand and Deadly on the off
// hand (James's ruling, relayed by Scout: presetReferenceBuild.poisons), in
// the SimConfig poisons shape.
function poisonProblems(poisons) {
  if (!isObject(poisons)) {
    return ["poisons is not an object."];
  }
  const ids = k("config.poisonIds");
  const ruling = k("presetReferenceBuild.poisons");
  const problems = [];
  for (const field of Object.keys(poisons)) {
    if (!HANDS.includes(field)) {
      problems.push(`"poisons.${field}" is not a hand.`);
    }
  }
  for (const hand of HANDS) {
    const id = poisons[hand];
    if (!ids.includes(id)) {
      problems.push(`poisons.${hand} ${JSON.stringify(id)} is not a poison.`);
    } else if (id !== ruling[hand]) {
      problems.push(`poisons.${hand} is ${id}, not ${ruling[hand]}.`);
    }
  }
  return problems;
}

export function checkReferenceBuild(presetId, build) {
  if (!PRESET_IDS.has(presetId)) {
    return [`"${presetId}" is not a preset.`];
  }
  if (!isObject(build)) {
    return ["The build is not an object."];
  }
  const problems = [];
  for (const field of Object.keys(build)) {
    if (!FIELDS.includes(field)) {
      problems.push(`"${field}" is not a reference build field.`);
    }
  }
  if (typeof build.name !== "string" || build.name === "") {
    problems.push("name is missing.");
  }
  const levels = levelProblems(build);
  problems.push(...levels);
  if (!isObject(build.talents)) {
    problems.push("talents is not an object.");
  } else if (levels.length === 0) {
    const options = { level: build.talentLevel };
    for (const problem of buildProblems(build.talents, options)) {
      problems.push(problem.message);
    }
  }
  problems.push(...poisonProblems(build.poisons));
  if (!isObject(build.weapons)) {
    problems.push("weapons is not an object.");
  } else {
    for (const hand of HANDS) {
      problems.push(...weaponProblems(hand, build.weapons[hand]));
    }
  }
  return problems;
}

for (const [presetId, build] of Object.entries(PRESET_REFERENCE_BUILDS)) {
  const problems = checkReferenceBuild(presetId, build);
  if (problems.length > 0) {
    throw new RangeError(
      `Reference build "${presetId}": ${problems.join(" ")}`,
    );
  }
}

export function referenceBuild(presetId) {
  if (!PRESET_IDS.has(presetId)) {
    throw new RangeError(
      `"${presetId}" is not a preset. The presets are: ${[...PRESET_IDS].join(", ")}.`,
    );
  }
  const build = PRESET_REFERENCE_BUILDS[presetId];
  if (build === undefined) {
    return null;
  }
  const copy = {
    ...build,
    talents: { ...build.talents },
    weapons: {
      mainHand: { ...build.weapons.mainHand },
      offHand: { ...build.weapons.offHand },
    },
    poisons: { ...build.poisons },
  };
  return copy;
}

export function talentDifferences(build, talents = {}) {
  const current = isObject(talents) ? talents : {};
  const ids = new Set([...Object.keys(build.talents), ...Object.keys(current)]);
  return [...ids]
    .sort()
    .map((id) => ({
      id,
      reference: build.talents[id] ?? 0,
      current: current[id] ?? 0,
    }))
    .filter((entry) => entry.reference !== entry.current);
}

export function weaponTypeDifferences(build, weapons = {}) {
  const current = isObject(weapons) ? weapons : {};
  return Object.fromEntries(
    HANDS.map((hand) => {
      const reference = build.weapons[hand].type;
      const type = current[hand]?.type;
      return [hand, { reference, current: type, same: reference === type }];
    }),
  );
}

export function referenceWeapon(build, hand) {
  if (!HANDS.includes(hand)) {
    throw new RangeError(`"${hand}" is not a hand: ${HANDS.join(" or ")}.`);
  }
  return { ...build.weapons[hand] };
}

export function poisonDifferences(build, poisons = {}) {
  const current = isObject(poisons) ? poisons : {};
  return Object.fromEntries(
    HANDS.map((hand) => {
      const reference = build.poisons[hand];
      const id = current[hand] ?? null;
      return [hand, { reference, current: id, same: reference === id }];
    }),
  );
}

export function referencePoison(build, hand) {
  if (!HANDS.includes(hand)) {
    throw new RangeError(`"${hand}" is not a hand: ${HANDS.join(" or ")}.`);
  }
  return build.poisons[hand];
}
