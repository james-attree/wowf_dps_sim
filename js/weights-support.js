// Host helpers for the stat-weights Results view (issue #282). Not a view
// module: it may read the attack table and the rogue's hit figure so the
// view can draw the cap note without importing the engine.

import { k } from "../data/constants.js";
import {
  deriveAttackTable,
  hitSuppression,
  weaponSkillFor,
} from "./attack-resolver.js";
import { characterLevel, targetLevel } from "./levels.js";
import { Rogue } from "./rogue.js";
import { normalizeConfig } from "./sim-config.js";

// coordinator call 15 Nov (James delegated), Decision 4's cap note (spec
// §5): show the note when the build's total yellow hit is at least the
// yellow-hit cap minus one percentage point, or when the ± hit window
// overlaps the cap. Cap = miss + hit suppression, no dual-wield penalty.
export function weightsCapNote(config) {
  const base = normalizeConfig(config);
  const table = deriveAttackTable({
    weaponSkill: weaponSkillFor(base),
    characterLevel: characterLevel(base),
    targetLevel: targetLevel(base),
  });
  const cap = table.miss + hitSuppression(table);
  const hit = new Rogue(base).getBonusHitChance();
  const step = k("statWeights.hit");
  const near = k("statWeights.onePercent");
  const overlaps = hit - step <= cap && cap <= hit + step;
  const close = hit + near >= cap;
  if (!overlaps && !close) {
    return null;
  }
  return { cap, hit, step };
}
