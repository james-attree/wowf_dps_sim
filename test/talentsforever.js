import { talentCatalogue } from "../js/talents.js";

// Decode a talentsforever.com build link into { talent id: rank }, for tests.
// The link's path is /<class>/<level>/<assassination>-<combat>-<subtlety>-...:
// each of the first three segments is one digit for each talent of the tree, in
// the catalogue's order (js/talents.js), with the trailing zeros left off, so
// "" is a tree with no points. What follows the third segment (the glyph and
// the rest of the page's state) says nothing about talents and is ignored, as
// is the query string.
//
// It is checked against the catalogue and against the points the build is known
// to spend (test/talent-effects.test.js). It is a test
// helper because the app takes talent ranks from SimConfig, not from a link.

const TREES = ["assassination", "combat", "subtlety"];
const DIGITS = /^\d*$/;

export function decodeBuildLink(link, catalogue = talentCatalogue) {
  const url = new URL(link);
  const [className, level, ...segments] = url.pathname
    .split("/")
    .filter((part) => part !== "")
    .flatMap((part, index) => (index < 2 ? [part] : part.split("-")));
  const ranks = {};
  TREES.forEach((tree, index) => {
    const digits = segments[index] ?? "";
    if (!DIGITS.test(digits)) {
      throw new RangeError(
        `Tree segment "${digits}" of ${tree} is not digits.`,
      );
    }
    const talents = catalogue.byTree(tree);
    if (digits.length > talents.length) {
      throw new RangeError(
        `${tree} has ${talents.length} talents, but the link spends ${digits.length}.`,
      );
    }
    talents.forEach((talent, position) => {
      const rank = Number(digits[position] ?? 0);
      if (rank > talent.max) {
        throw new RangeError(
          `${talent.id} has ranks 0 to ${talent.max}, not ${rank}.`,
        );
      }
      ranks[talent.id] = rank;
    });
  });
  return { className, level: Number(level), ranks };
}

// The reference build: Assassination 18, Combat 33, Subtlety 0 (the link in
// issue #106). It is a legal 51-point build, and every talent in it has an
// entry in data/talent-effects.js.
export const REFERENCE_LINK =
  "https://talentsforever.com/rogue/60/00530310501-32030320201515231--CD1FDGISRUWZXbc4defg2hgcK-8?b=70425h&d=261026";

// The reference build as a SimConfig talent map: { talent id: rank } with the
// zero ranks left out, the form config.talents takes.
export function referenceBuild() {
  const { ranks } = decodeBuildLink(REFERENCE_LINK);
  return Object.fromEntries(
    Object.entries(ranks).filter(([, rank]) => rank > 0),
  );
}
