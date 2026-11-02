// "Copy link to this build" (#284, H6-lite). The buttons (the header's, by
// "Rogue", and each Results run label's) copy the store's build (config and
// run settings) as a share link: linkOf() from js/main.js, which makes it
// with js/build-codec.js. On success the button
// reads "Link copied" for COPIED_MS and #run-announce says so politely. With
// no clipboard, or one that refuses, a read-only field under the button holds
// the link, selected, to copy by hand; it never fails silently. A link over
// LINK_CAP says to export the rotation as a file instead, and the button
// stays usable. While the talents are over their level's cap the link would
// be of the last legal build, so none is made and the button says why
// (#326, item 9).
//
// The banner says what a link opened on load did ("loaded", "newer" or
// "corrupt"); it sits under the shown area's h1, following the route, until
// dismissed. "newer" and "corrupt" are warnings, styled apart from
// "loaded" by data-notice (styles.css), and say that nothing was loaded.

import { talentErrorCount } from "./run-model.js";

// The longest share link the button makes (#284): 8 KB.
export const LINK_CAP = 8192;
export const COPIED_MS = 2000;
export const BUTTON_TEXT = "Copy link to this build";
export const COPIED_TEXT = "Link copied";
// Each button's accessible name (Fran's #299 P2): the visible label first
// (label in name), then which row it is on.
export const BUTTON_NAMES = Object.freeze({
  header: `${BUTTON_TEXT} (header)`,
  average: `${BUTTON_TEXT} (average result)`,
  live: `${BUTTON_TEXT} (live fight)`,
});
export const NOTICES = Object.freeze({
  loaded: "Loaded a shared build. Press Run to see its DPS.",
  newer:
    "This link is from a newer version. Nothing was loaded; update the page and try again.",
  corrupt:
    "This link is damaged. Nothing was loaded; the build on the page is unchanged.",
});

// A setup read with some fields put back to their defaults (#326, item
// 13): js/build-codec.js's `reset`, the paths it dropped, named here.
const RESET_NAMES = Object.freeze({
  character: "the character's stats",
  race: "the race",
  talents: "the talents",
  talentLevel: "the talent level",
  weapons: "the weapons",
  poisons: "the poisons",
  rotation: "the rotation",
  fight: "the fight settings",
  "weapons.mainHand": "the main-hand weapon",
  "weapons.offHand": "the off-hand weapon",
  "poisons.mainHand": "the main-hand poison",
  "poisons.offHand": "the off-hand poison",
  "target.level": "the target's level",
  "target.armor": "the target's armour",
  "target.behind": "the target's position",
  target: "the target",
  "run.mode": "the run mode",
  "run.duration": "the fight length",
  "run.iterations": "the number of fights",
  "run.seed": "the seed",
});

const resetName = (path) =>
  RESET_NAMES[path] ?? RESET_NAMES[path.split(".")[0]] ?? "a setting";

export function resetText(paths) {
  const names = [...new Set(paths.map(resetName))];
  if (names.length === 0) return "";
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const back =
    names.length === 1
      ? "is back to its default"
      : "are back to their defaults";
  return `Part of your saved setup couldn't be read, so ${list} ${back}.`;
}

export function createShareLinkView(
  doc,
  store,
  { linkOf, notice = null, reset = [] },
) {
  const overCap = () => talentErrorCount(store.get()) > 0;
  const view = doc.defaultView;
  const $ = (id) => doc.querySelector(`#${id}`);
  const announcer = $("run-announce");
  const timers = new Map();

  const announce = (text) => {
    if (announcer === null) return;
    announcer.textContent = "";
    if (typeof view?.requestAnimationFrame !== "function") {
      announcer.textContent = text;
      return;
    }
    view.requestAnimationFrame(() => {
      announcer.textContent = text;
    });
  };

  const parts = (name) => ({
    button: $(`share-link-${name}`),
    box: $(`share-feedback-${name}`),
    tooLong: $(`share-too-long-${name}`),
    overCap: $(`share-over-cap-${name}`),
    fallback: $(`share-fallback-${name}`),
    field: $(`share-url-${name}`),
  });

  const show = (part, what) => {
    part.box.hidden = what === null;
    part.tooLong.hidden = what !== "too-long";
    if (part.overCap) part.overCap.hidden = what !== "over-cap";
    part.fallback.hidden = what !== "fallback";
  };

  // Said once while the button reads "Link copied" (#326, item 12: five
  // quick presses said it five times), and taken out of the announcer when
  // the button reads its label again, so it doesn't linger.
  const copied = (name, part) => {
    show(part, null);
    const already = part.button.textContent.trim() === COPIED_TEXT;
    part.button.textContent = COPIED_TEXT;
    part.button.setAttribute("aria-label", COPIED_TEXT);
    if (!already) announce(COPIED_TEXT);
    view?.clearTimeout?.(timers.get(name));
    timers.set(
      name,
      view?.setTimeout?.(() => {
        part.button.textContent = BUTTON_TEXT;
        part.button.setAttribute("aria-label", BUTTON_NAMES[name]);
        if (announcer?.textContent === COPIED_TEXT) announcer.textContent = "";
      }, COPIED_MS),
    );
  };

  const fallback = (part, url) => {
    part.field.value = url;
    show(part, "fallback");
    part.field.focus();
    part.field.select();
  };

  const copy = async (name) => {
    const part = parts(name);
    if (overCap()) {
      show(part, "over-cap");
      announce(part.overCap.textContent.replace(/\s+/g, " ").trim());
      return;
    }
    const url = linkOf();
    if (url.length > LINK_CAP) {
      show(part, "too-long");
      // Said aloud too (Fran's #299 P1), not only shown.
      announce(part.tooLong.textContent.replace(/\s+/g, " ").trim());
      return;
    }
    const clipboard = view?.navigator?.clipboard;
    if (typeof clipboard?.writeText !== "function") {
      fallback(part, url);
      return;
    }
    try {
      await clipboard.writeText(url);
      copied(name, part);
    } catch {
      fallback(part, url);
    }
  };

  for (const button of doc.querySelectorAll("[data-share]")) {
    button.addEventListener("click", () => copy(button.dataset.share));
  }
  for (const field of doc.querySelectorAll(".share-url")) {
    field.addEventListener("focus", () => field.select());
  }

  // The banner, only when a link was opened or a setup was read in part.
  const known = notice !== null && NOTICES[notice] !== undefined;
  const resetLine = resetText(reset);
  if (!known && resetLine === "") return;
  const banner = $("share-banner");
  const place = () => {
    if (banner.hidden) return;
    const area = doc.querySelector(".area:not([hidden])");
    const title = area?.querySelector(".area-title");
    if (title && title.nextElementSibling !== banner) title.after(banner);
  };
  $("share-banner-text").textContent = [known ? NOTICES[notice] : "", resetLine]
    .filter((text) => text !== "")
    .join(" ");
  banner.dataset.notice = known ? notice : "reset";
  banner.hidden = false;
  place();
  // Dismissed, the focus goes to the area's heading, where the banner was
  // (#326, item 10: it fell to the page's body).
  $("share-banner-close").addEventListener("click", () => {
    doc.querySelector(".area:not([hidden]) .area-title")?.focus?.();
    banner.hidden = true;
  });
  store.subscribe(({ changed }) => {
    if (changed.includes("route")) place();
  });
}
