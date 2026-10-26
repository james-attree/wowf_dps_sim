import snapshot from "../data/talentsforever/rogue.json" with { type: "json" };

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

function nameKey(name) {
  return name.trim().toLowerCase();
}

function requireField(talent, field, type, where) {
  if (typeof talent[field] !== type) {
    throw new TypeError(`${where}: "${field}" must be a ${type}.`);
  }
}

// Builds a catalogue from a parsed talentsforever export. The result is deeply
// frozen. Lookups are by id, by tree and by name:
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

  for (const snapshotTree of snapshotTrees) {
    const treeId = slugify(snapshotTree.name);
    if (byTreeId.has(treeId)) {
      throw new RangeError(`Duplicate talent tree "${treeId}".`);
    }
    const treeTalents = [];
    const nameToId = new Map();

    const drafts = snapshotTree.talents.map((raw) => {
      const where = `Talent ${JSON.stringify(raw?.name)} in ${treeId}`;
      requireField(raw, "name", "string", where);
      requireField(raw, "row", "number", where);
      requireField(raw, "col", "number", where);
      requireField(raw, "max", "number", where);
      requireField(raw, "icon", "string", where);
      if (!Array.isArray(raw.desc)) {
        throw new TypeError(`${where}: "desc" must be an array.`);
      }
      const id = `${treeId}.${slugify(raw.name)}`;
      if (byId.has(id) || nameToId.has(raw.name)) {
        throw new RangeError(`Duplicate talent id "${id}".`);
      }
      nameToId.set(raw.name, id);
      byId.set(id, null);
      return { raw, id };
    });

    for (const { raw, id } of drafts) {
      let req = null;
      if (raw.req !== undefined) {
        req = nameToId.get(raw.req) ?? null;
        if (req === null) {
          throw new RangeError(
            `Talent "${id}" requires "${raw.req}", which is not in ${treeId}.`,
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
