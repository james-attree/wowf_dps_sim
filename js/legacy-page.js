import { LEGACY_SWORD } from "../data/legacy-sheets.js";
import { presetRotation } from "./rotation-presets.js";
import { referenceBuild } from "./preset-reference-builds.js";
import { defaultConfig } from "./sim-config.js";

// The page default as it stood before #297 PR4. Share links and saved
// setups still diff against this, so an old ?s=2 link opens the config
// it produced then. The page's first load is pageDefaultConfig(), not this.
// coordinator call 15 Nov (James delegated): Q3's read-only "sheet from an
// older link" screen is PR5. This only keeps the numbers the same.
export function legacyPageConfig() {
  const build = referenceBuild("combat-swords-temp");
  const base = defaultConfig();
  return {
    ...base,
    talents: { ...build.talents },
    talentLevel: build.talentLevel,
    weapons: {
      mainHand: { ...LEGACY_SWORD.weapons.mainHand },
      offHand: { ...LEGACY_SWORD.weapons.offHand },
    },
    poisons: { ...build.poisons },
    rotation: presetRotation("combat-swords-temp"),
    target: { ...base.target, behind: true },
  };
}
