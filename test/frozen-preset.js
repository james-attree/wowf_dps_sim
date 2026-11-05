import { LINK_BASES, baseContent } from "../js/link-codec.js";
import { setupDefaults } from "../js/build-codec.js";
import { normalizeConfig } from "../js/sim-config.js";
import { referenceBuild } from "../data/reference-build.js";
import { abilityCatalogue } from "../js/abilities.js";

// TR-02 / #332: ROTATION_PRESETS is empty until #333. Tests that still need a
// preset-shaped config take weapons/poisons/rotation from the frozen LINK_BASES
// snapshot and the legal James temp reference talents (70755), because the
// frozen talent ranks (e.g. Lethality 5) are illegal under the new catalogue.
// Frozen rotations may still name Venom (pending TR-05 / #334); drop those
// rules so normalizeConfig accepts the rest until #333 rewrites the presets.

function legalRotation(rotation) {
  if (rotation === undefined || rotation === null) return rotation;
  const rules = (rotation.rules ?? []).filter((rule) => {
    const action = rule?.action;
    return action === undefined || abilityCatalogue.get(action) !== undefined;
  });
  return { ...rotation, rules };
}

export function frozenPresetConfig(id, extra = {}) {
  const entry = LINK_BASES.find((e) => e.id === id);
  if (entry === undefined || entry.frozen === undefined) {
    throw new RangeError(
      `No frozen LINK_BASES entry for ${JSON.stringify(id)}.`,
    );
  }
  const base = setupDefaults().config;
  const frozen = baseContent(entry, base);
  const {
    talents: talentsExtra,
    weapons: weaponsExtra,
    poisons: poisonsExtra,
    rotation: rotationExtra,
    talentLevel: levelExtra,
    ...rest
  } = extra;
  return normalizeConfig({
    ...base,
    ...rest,
    talents:
      talentsExtra !== undefined ? talentsExtra : { ...referenceBuild() },
    talentLevel: levelExtra !== undefined ? levelExtra : frozen.talentLevel,
    weapons:
      weaponsExtra !== undefined
        ? weaponsExtra
        : structuredClone(frozen.weapons),
    poisons: poisonsExtra !== undefined ? poisonsExtra : { ...frozen.poisons },
    rotation:
      rotationExtra !== undefined
        ? rotationExtra
        : legalRotation(structuredClone(frozen.rotation)),
  });
}
