// "Copy link to this build" (#284, H6-lite). The buttons (the header's, by
// "Rogue", and each Results run label's) copy the store's build (config and
// run settings) as a share link: linkOf() from js/main.js, which makes it
// with js/build-codec.js. On success the button
// reads "Link copied" for COPIED_MS and #run-announce says so politely. With
// no clipboard, or one that refuses, a read-only field under the button holds
// the link, selected, to copy by hand; it never fails silently. A link over
// LINK_CAP says to export the rotation as a file instead, and the button
// stays usable.
//
// The banner says what a link opened on load did ("loaded", "newer" or
// "corrupt"); it sits under the shown area's h1, following the route, until
// dismissed. "newer" and "corrupt" are warnings, styled apart from
// "loaded" by data-notice (styles.css), and say that nothing was loaded.

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

export function createShareLinkView(doc, store, { linkOf, notice = null }) {
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
    fallback: $(`share-fallback-${name}`),
    field: $(`share-url-${name}`),
  });

  const show = (part, what) => {
    part.box.hidden = what === null;
    part.tooLong.hidden = what !== "too-long";
    part.fallback.hidden = what !== "fallback";
  };

  const copied = (name, part) => {
    show(part, null);
    part.button.textContent = COPIED_TEXT;
    part.button.setAttribute("aria-label", COPIED_TEXT);
    announce(COPIED_TEXT);
    view?.clearTimeout?.(timers.get(name));
    timers.set(
      name,
      view?.setTimeout?.(() => {
        part.button.textContent = BUTTON_TEXT;
        part.button.setAttribute("aria-label", BUTTON_NAMES[name]);
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

  // The banner, only when a link was opened.
  if (notice === null || NOTICES[notice] === undefined) return;
  const banner = $("share-banner");
  const place = () => {
    if (banner.hidden) return;
    const area = doc.querySelector(".area:not([hidden])");
    const title = area?.querySelector(".area-title");
    if (title && title.nextElementSibling !== banner) title.after(banner);
  };
  $("share-banner-text").textContent = NOTICES[notice];
  banner.dataset.notice = notice;
  banner.hidden = false;
  place();
  $("share-banner-close").addEventListener("click", () => {
    banner.hidden = true;
  });
  store.subscribe(({ changed }) => {
    if (changed.includes("route")) place();
  });
}
