import { snapshot } from "./snapshot.js";

// The talent catalogue (roadmap D4). Every field is read from the vendored
// talentsforever snapshot when the catalogue is built. Nothing about a talent
// is copied by hand, so a refreshed snapshot (npm run data:refresh) changes
// the catalogue without a code change.
//
// Ids are `tree.slug`, for example `combat.precision`. The slug of a name is
// built by slugify() below, and the tree part is the slug of the tree's name.
//
// This module is pure: no DOM, no clock, no random numbers. It reads the JSON
// module imported above (Node 20.19+ and current browsers support import
// attributes), so it needs no fetch and no fs. Nothing in the live page
// imports it yet; the engine starts using it in later Phase 2 issues.
//
// Load-time validation (roadmap D11). buildTalentCatalogue checks the data and
// throws on the first problem, and the catalogue for the vendored snapshot is
// built when this module loads, so bad data fails the import loudly instead of
// giving a quietly wrong talent. The checks are listed on buildTalentCatalogue.

// The slug rule, in order:
//   1. lower-case the name;
//   2. delete apostrophes (straight and curly), so "Hack's" stays one word;
//   3. replace every run of characters other than a-z and 0-9 with one "-";
//   4. strip leading and trailing "-".
// "Improved Slice and Dice" becomes "improved-slice-and-dice". A name that
// leaves nothing behind is an error, not an empty slug.
export function slugify(name) {
  if (typeof name !== "string") {
    throw new TypeError("slugify needs a string name.");
  }
  const slug = name
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") {
    throw new RangeError(`Name ${JSON.stringify(name)} has no slug.`);
  }
  return slug;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// byName ignores case and leading or trailing whitespace.
function nameKey(name) {
  return name.trim().toLowerCase();
}

// A value as an error message shows it. JSON.stringify turns NaN and Infinity
// into "null" and undefined into nothing, which hides the real problem, so
// numbers and undefined are written with String().
function show(value) {
  if (value === undefined || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

// What kind of value this is, for "not an array" style messages.
function kindOf(value) {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : typeof value;
}

// A plain-data object: not null, not an array.
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireField(talent, field, type, where) {
  if (typeof talent[field] !== type) {
    throw new TypeError(
      `${where}: "${field}" must be a ${type}, not ${show(talent[field])}.`,
    );
  }
}

function requireText(value, field, where) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `${where}: "${field}" must be a non-empty string, not ${show(value)}.`,
    );
  }
}

function requirePositiveInteger(value, field, where) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `${where}: "${field}" must be a whole number of 1 or more, not ${show(value)}.`,
    );
  }
}

// Builds a catalogue from a parsed talentsforever export, and validates it as
// it goes. It throws on the first of these:
//   - a missing or empty tree or talent name, tree icon or talent icon, or a
//     missing row, col, max or desc;
//   - a row, col or max that is not a whole number of 1 or more;
//   - a `max` that differs from the number of rank texts in `desc`, or a rank
//     text that is not a non-empty string;
//   - a duplicate tree, a duplicate talent id, or two talents in one tree on
//     the same row and column;
//   - a `req` that names no talent, names a talent in another tree, names the
//     talent itself, or names a talent that is not on an earlier row.
// The result is deeply frozen, so `trees`, every tree's `talents`, `talents`
// and each talent are read-only. Lookups are by id, by tree and by name:
//
//   catalogue.trees               [{ id, name, icon, talents: [talent...] }]
//   catalogue.talents             every talent, tree by tree, in snapshot order
//   catalogue.get(id)             a talent, or undefined
//   catalogue.byTree(treeId)      that tree's talents (RangeError if no such tree)
//   catalogue.byName(name, tree)  a talent by name, ignoring case; the optional
//                                 tree id limits the search; undefined if none
//   catalogue.rankText(id, rank)  the tooltip text of a rank, 1..max
//
// A talent is { id, tree, name, row, col, max, req, icon, passive, cost,
// fixed, ranks }. `req` is the id of the prerequisite talent in the same tree,
// or null. `ranks[0]` is the text of rank 1. `cost` and `fixed` are the
// snapshot's own fields for active talents, or null when it has none.
export function buildTalentCatalogue(source) {
  const snapshotTrees = source?.talents?.trees;
  if (!Array.isArray(snapshotTrees) || snapshotTrees.length === 0) {
    throw new TypeError("Snapshot has no talents.trees.");
  }

  const trees = [];
  const talents = [];
  const byId = new Map();
  const byTreeId = new Map();
  const byNameKey = new Map();

  // Which tree each talent name is in, so a prerequisite in another tree gets
  // its own message rather than "not found".
  const treeOfName = new Map();
  snapshotTrees.forEach((snapshotTree, index) => {
    if (!isObject(snapshotTree)) {
      throw new TypeError(
        `Tree at index ${index}: a tree must be an object, not ${kindOf(snapshotTree)}.`,
      );
    }
    const label =
      typeof snapshotTree.name === "string"
        ? `Tree ${JSON.stringify(snapshotTree.name)}`
        : `Tree at index ${index}`;
    requireText(snapshotTree.name, "name", label);
    requireText(snapshotTree.icon, "icon", label);
    if (!Array.isArray(snapshotTree.talents)) {
      throw new TypeError(`${label}: "talents" must be an array.`);
    }
    for (const raw of snapshotTree.talents) {
      if (typeof raw?.name === "string") {
        treeOfName.set(raw.name, slugify(snapshotTree.name));
      }
    }
  });

  for (const snapshotTree of snapshotTrees) {
    const treeId = slugify(snapshotTree.name);
    if (byTreeId.has(treeId)) {
      throw new RangeError(`Duplicate talent tree "${treeId}".`);
    }
    const treeTalents = [];
    const nameToId = new Map();
    const nameToRow = new Map();
    const positions = new Set();

    const drafts = snapshotTree.talents.map((raw, index) => {
      if (!isObject(raw)) {
        throw new TypeError(
          `Talent at index ${index} in ${treeId}: a talent must be an object, not ${kindOf(raw)}.`,
        );
      }
      const where =
        typeof raw.name === "string"
          ? `Talent ${JSON.stringify(raw.name)} in ${treeId}`
          : `Talent at index ${index} in ${treeId}`;
      requireField(raw, "name", "string", where);
      requireText(raw.name, "name", where);
      requireField(raw, "row", "number", where);
      requireField(raw, "col", "number", where);
      requireField(raw, "max", "number", where);
      requireField(raw, "icon", "string", where);
      requireText(raw.icon, "icon", where);
      if (!Array.isArray(raw.desc)) {
        throw new TypeError(
          `${where}: "desc" must be an array, not ${kindOf(raw.desc)}.`,
        );
      }
      requirePositiveInteger(raw.row, "row", where);
      requirePositiveInteger(raw.col, "col", where);
      requirePositiveInteger(raw.max, "max", where);
      if (raw.desc.length !== raw.max) {
        throw new RangeError(
          `${where}: "max" is ${raw.max} but "desc" has ${raw.desc.length} rank texts.`,
        );
      }
      raw.desc.forEach((text, index) => {
        requireText(text, `desc[${index}]`, where);
      });
      const id = `${treeId}.${slugify(raw.name)}`;
      if (byId.has(id) || nameToId.has(raw.name)) {
        throw new RangeError(`Duplicate talent id "${id}".`);
      }
      const position = `${raw.row},${raw.col}`;
      if (positions.has(position)) {
        throw new RangeError(
          `${where}: row ${raw.row}, col ${raw.col} is already taken in ${treeId}.`,
        );
      }
      positions.add(position);
      nameToId.set(raw.name, id);
      nameToRow.set(raw.name, raw.row);
      byId.set(id, null);
      return { raw, id };
    });

    for (const { raw, id } of drafts) {
      let req = null;
      if (raw.req !== undefined) {
        requireText(raw.req, "req", `Talent "${id}"`);
        req = nameToId.get(raw.req) ?? null;
        if (req === null) {
          const elsewhere = treeOfName.get(raw.req);
          throw new RangeError(
            elsewhere === undefined
              ? `Talent "${id}" requires "${raw.req}", which is not in ${treeId}.`
              : `Talent "${id}" requires "${raw.req}", which is in ${elsewhere}. A prerequisite must be in the same tree.`,
          );
        }
        if (req === id || nameToRow.get(raw.req) >= raw.row) {
          throw new RangeError(
            `Talent "${id}" requires "${raw.req}", which is not on an earlier row.`,
          );
        }
      }
      const talent = {
        id,
        tree: treeId,
        name: raw.name,
        row: raw.row,
        col: raw.col,
        max: raw.max,
        req,
        icon: raw.icon,
        passive: raw.passive === true,
        cost: raw.cost ?? null,
        fixed: raw.fixed ?? null,
        ranks: [...raw.desc],
      };
      byId.set(id, talent);
      treeTalents.push(talent);
      talents.push(talent);

      const key = nameKey(talent.name);
      byNameKey.set(key, [...(byNameKey.get(key) ?? []), talent]);
    }

    byTreeId.set(treeId, treeTalents);
    trees.push({
      id: treeId,
      name: snapshotTree.name,
      icon: snapshotTree.icon,
      talents: treeTalents,
    });
  }

  const catalogue = {
    trees,
    talents,
    get(id) {
      return byId.get(id);
    },
    byTree(treeId) {
      const found = byTreeId.get(treeId);
      if (found === undefined) {
        throw new RangeError(`Unknown talent tree ${JSON.stringify(treeId)}.`);
      }
      return found;
    },
    byName(name, treeId) {
      if (typeof name !== "string") {
        throw new TypeError(
          `byName needs a talent name as a string, not ${kindOf(name)}.`,
        );
      }
      const matches = byNameKey.get(nameKey(name)) ?? [];
      return matches.find(
        (talent) => treeId === undefined || talent.tree === treeId,
      );
    },
    rankText(id, rank) {
      const talent = byId.get(id);
      if (talent === undefined) {
        throw new RangeError(`Unknown talent ${JSON.stringify(id)}.`);
      }
      if (!Number.isInteger(rank) || rank < 1 || rank > talent.max) {
        throw new RangeError(
          `${id} has ranks 1 to ${talent.max}, not ${rank}.`,
        );
      }
      return talent.ranks[rank - 1];
    },
  };
  return deepFreeze(catalogue);
}

// The catalogue for the vendored snapshot, built once when the module loads.
export const talentCatalogue = buildTalentCatalogue(snapshot);
