import { k } from "../data/constants.js";
import iconCheck from "../data/icons.json" with { type: "json" };
import { snapshot } from "./snapshot.js";

// Icons by hot-link (issue #107, D10). The talentsforever snapshot names an
// icon for every talent, talent tree and spell ("ability_rogue_eviscerate").
// This module turns such a name into a URL on a public image CDN
// (k("icons.cdn"), see docs/icons.md). Nothing is downloaded, nothing is
// stored in the repo, and nothing here fetches: the URL is built from the name
// and the browser loads it when it draws the image.
//
// A name that has no usable form, or that data/icons.json lists as missing from
// the CDN, resolves to the fallback icon (k("icons.fallback")). The list is
// written by `npm run icons:check` (scripts/check-icons.mjs) when the data is
// refreshed, never at test time. An icon the browser still cannot load is
// swapped for the fallback by attachIconFallback.

// What an icon name looks like in the export: lower case letters, digits and
// underscores.
const ICON_NAME = /^[a-z0-9_]+$/;

// The URL of the icon `name`. `read` and `missing` are injectable for tests.
export function iconUrl(name, read = k, missing = iconCheck.missing) {
  const { base, size, extension } = read("icons.cdn");
  const fallback = read("icons.fallback");
  const usable =
    typeof name === "string" && ICON_NAME.test(name) && !missing.includes(name);
  return `${base}${size}/${usable ? name : fallback}${extension}`;
}

// The icon of the spell (an ability or a poison) with this display name, from
// the snapshot's spellbook. A spell with no icon there gets the fallback.
export function spellIconUrl(spellName, source = snapshot) {
  return iconUrl(source?.spellbook?.icons?.[spellName]);
}

// The icon of a talent from the talent catalogue (js/talents.js).
export function talentIconUrl(talent) {
  return iconUrl(talent?.icon);
}

// Every distinct icon name the snapshot refers to: the trees, the talents, the
// spellbook's per-spell icons and its tabs. The refresh step checks each one
// against the CDN, and a test resolves each one.
export function collectIconNames(source = snapshot) {
  const names = new Set();
  const add = (name) => {
    if (typeof name === "string" && name !== "") {
      names.add(name);
    }
  };
  for (const tree of source?.talents?.trees ?? []) {
    add(tree.icon);
    for (const talent of tree.talents ?? []) {
      add(talent.icon);
    }
  }
  for (const name of Object.values(source?.spellbook?.icons ?? {})) {
    add(name);
  }
  for (const tab of source?.spellbook?.tabs ?? []) {
    add(tab.icon);
  }
  return [...names].sort();
}

// Show the fallback when an <img> cannot load its icon (a missing file, an
// offline page, a blocked host). The first failure swaps in the fallback icon.
// If that fails too, the image is hidden, so it never loops and never shows
// the browser's broken-image glyph.
export function attachIconFallback(image, fallbackUrl = iconUrl(null)) {
  let swapped = false;
  image.addEventListener("error", () => {
    if (swapped) {
      image.hidden = true;
      return;
    }
    swapped = true;
    image.src = fallbackUrl;
  });
  return image;
}
