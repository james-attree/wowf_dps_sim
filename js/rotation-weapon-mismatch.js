import { ABILITY_DEFINITIONS } from "./ability-data.js";
import {
  listText,
  presetOfChoice,
  weaponArticle,
  weaponNoun,
} from "./preset-build.js";

// A short note next to the Rotation preset when the chosen rotation's
// abilities require a weapon type and the equipped hand does not match.
// coordinator call 16 Nov (James delegated). It does not block Run and
// does not change gear. The expected type is read only from existing
// ability-data `requiresMainHand` / `requiresOffHand` on the rotation's
// actions (Backstab, Ambush, Mutilate today). No new rule is added, and
// a preset whose actions have no such field (Combat swords) does not
// raise this note.

const BY_ID = new Map(ABILITY_DEFINITIONS.map((row) => [row.id, row]));
const GEAR_HREF = "#character/gear";

function usesText(types) {
  return listText([...types].map((type) => weaponNoun(type, true)));
}

function equippedText(type) {
  if (type == null) {
    return "empty";
  }
  const noun = weaponNoun(type, false);
  return `${weaponArticle(noun)} ${noun}`;
}

// True when the rotation requires at least one type and the equipped
// type is not among them (including an empty hand).
export function hasWeaponTypeMismatch(expectedTypes, equippedType) {
  return expectedTypes.size > 0 && !expectedTypes.has(equippedType);
}

function requiredTypes(rotation) {
  const mainHand = new Set();
  const offHand = new Set();
  for (const rule of rotation?.rules ?? []) {
    const definition = BY_ID.get(rule.action);
    if (definition?.requiresMainHand) {
      mainHand.add(definition.requiresMainHand);
    }
    if (definition?.requiresOffHand) {
      offHand.add(definition.requiresOffHand);
    }
  }
  return { mainHand, offHand };
}

// The note's sentence, or null when the hands match or no action
// requires a weapon type. `isPreset` chooses "This preset's rotation"
// vs "This rotation".
export function rotationWeaponMismatch(
  rotation,
  weapons,
  { isPreset = false } = {},
) {
  const expected = requiredTypes(rotation);
  const all = new Set([...expected.mainHand, ...expected.offHand]);
  if (all.size === 0) {
    return null;
  }
  const mainType = weapons?.mainHand?.type ?? null;
  const offType = weapons?.offHand?.type ?? null;
  const mainMismatches = hasWeaponTypeMismatch(expected.mainHand, mainType);
  const offMismatches = hasWeaponTypeMismatch(expected.offHand, offType);
  if (!mainMismatches && !offMismatches) {
    return null;
  }
  const lead = isPreset
    ? `This preset's rotation uses ${usesText(all)}`
    : `This rotation uses ${usesText(all)}`;
  if (mainMismatches) {
    return `${lead}; your main hand is ${equippedText(mainType)}.`;
  }
  return `${lead}; your off hand is ${equippedText(offType)}.`;
}

export function weaponMismatchOf(state) {
  const text = rotationWeaponMismatch(
    state.config?.rotation,
    state.config?.weapons,
    { isPreset: presetOfChoice(state.form) !== null },
  );
  return text === null ? null : { text, href: GEAR_HREF };
}

function sameNote(left, right) {
  if (left === right) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return left.text === right.text && left.href === right.href;
}

export function createRotationWeaponNote(store) {
  function refresh() {
    const next = weaponMismatchOf(store.get());
    if (sameNote(store.get().weaponMismatch ?? null, next)) {
      return;
    }
    store.set({ weaponMismatch: next });
  }
  refresh();
  return store.subscribe(({ changed }) => {
    if (changed.includes("config") || changed.includes("form")) {
      refresh();
    }
  });
}
