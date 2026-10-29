import assert from "node:assert/strict";
import { validateBuild } from "../js/fight.js";
import { talentCatalogue } from "../js/talents.js";
import { referenceBuild } from "./talentsforever.js";

// A helper, not a test file.

const total = (ranks) => Object.values(ranks).reduce((a, b) => a + b, 0);

// The reference build without some talents, the points put back in other
// talents so it is still a valid build (51 points, rows and prerequisites).
export function buildWithout(drops) {
  const base = Object.fromEntries(
    Object.entries(referenceBuild()).filter(([id]) => !drops.includes(id)),
  );
  const missing = total(referenceBuild()) - total(base);
  const open = talentCatalogue.talents.filter(
    (talent) =>
      !drops.includes(talent.id) && (base[talent.id] ?? 0) < talent.max,
  );
  const valid = (ranks) => {
    try {
      validateBuild(ranks, talentCatalogue);
      return true;
    } catch {
      return false;
    }
  };
  const add = (ranks, talent, points) => ({
    ...ranks,
    [talent.id]: (ranks[talent.id] ?? 0) + points,
  });
  for (const first of open) {
    for (const second of open) {
      const split = missing - 1;
      const ranks =
        missing === 1
          ? add(base, first, 1)
          : add(add(base, first, 1), second, split);
      if (first === second && missing > 1) {
        continue;
      }
      if (valid(ranks)) {
        return ranks;
      }
    }
  }
  assert.fail("a valid build with those talents left out");
}
