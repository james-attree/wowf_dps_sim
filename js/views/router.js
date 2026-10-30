import {
  AREAS,
  DEFAULT_AREA,
  REVEAL_EVENT,
  areaLabel,
  badgeOf,
  isArea,
} from "./sections.js";

// The page's router (#239, Phase 4.5 UX1; Fran's approved UX proposal §3).
// The route is the hash, #area[/sub[/param]], and the store's `route` slice
// { area, sub, param } is what it last showed; the build is never in it.
// Each area is a shell in index.html (<section data-area>) with one h1; the
// router shows the current one and hides the rest with `hidden`, so every
// control and id stays in the page and every view keeps working unchanged.
//
// Focus (proposal §3): going forward (a nav link, a typed hash, Forward)
// focuses the new screen's h1; Back puts the focus back where it was when
// that screen was left, which is the control that opened the next one.
// A move the page makes itself (Run showing its fight, the rotation builder
// opening) leaves the focus to the view that made it.

export const APP_TITLE = "WoW Forever Rogue Simulator";

// No area has sub-screens yet: UX5 (#243) and UX6 (#244) add the rotation's
// and Character's. A route's sub or param that is not one of its area's is
// dropped, so #character/stats is #character until then.
const SUBS = Object.freeze({});

const SEPARATOR = "/";

// A new area is shown from the top of the page.
const PAGE_TOP = 0;

// "#rotation/rule/2" as { area, sub, param }. An unknown area is the default
// one; an unknown sub is the area's top level.
export function parseRoute(hash, subs = SUBS) {
  const [area, sub, param] = String(hash ?? "")
    .replace(/^#/, "")
    .split(SEPARATOR)
    .map((part) => decodeURIComponent(part));
  if (!isArea(area)) {
    return { area: DEFAULT_AREA, sub: null, param: null };
  }
  if (sub === undefined || !(subs[area] ?? []).includes(sub)) {
    return { area, sub: null, param: null };
  }
  return { area, sub, param: param === undefined ? null : param };
}

export function formatRoute({ area, sub = null, param = null }) {
  return `#${[area, sub, param]
    .filter((part) => part !== null)
    .map((part) => encodeURIComponent(part))
    .join(SEPARATOR)}`;
}

// A hash that names an area, or none (the default area).
export const isRouteHash = (hash) => {
  const head = String(hash ?? "")
    .replace(/^#/, "")
    .split(SEPARATOR)[0];
  return head === "" || isArea(head);
};

// "Rotation · WoW Forever Rogue Simulator".
export const titleFor = (route) => `${areaLabel(route.area)} · ${APP_TITLE}`;

const isRunning = (state) =>
  state.run?.mode === "batch"
    ? state.batch?.status === "running"
    : state.run?.state === "running";
const builderOpen = (state) => state.rotationBuilder?.view?.open === true;

// The area a store change shows, or null for none (proposal §3: the page
// goes where the work is). Run shows the live fight (Fight) or the batch
// (Results) when it starts; a resumed fight stays where it is. The rotation
// builder is the Rotation area: opening it from anywhere goes there, and
// closing it there goes back to Character, where its opener is.
export function followArea(before, after, area) {
  if (!builderOpen(before) && builderOpen(after) && area !== "rotation") {
    return "rotation";
  }
  if (builderOpen(before) && !builderOpen(after) && area === "rotation") {
    return DEFAULT_AREA;
  }
  const resumed = before.run?.state === "paused";
  if (!isRunning(before) && isRunning(after) && !resumed) {
    const shows = after.run?.mode === "batch" ? "results" : "fight";
    return shows === area ? null : shows;
  }
  return null;
}

// A page with no window (a stand-in page in the tests) is shown with no
// history: its route is the default area's.
const NO_WINDOW = Object.freeze({
  location: Object.freeze({ hash: "" }),
  history: Object.freeze({
    state: null,
    pushState: () => {},
    replaceState: () => {},
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
});

// Whether the focus can go back to a node: still in the page and shown.
const canFocus = (doc, node) =>
  node !== null &&
  node !== undefined &&
  node !== doc.body &&
  node.isConnected === true &&
  node.closest?.("[hidden]") === null;

// Shows the store's areas in the page. `panels` ties an area to a view's
// open state: { rotation: { isOpen(state), toggle() } } opens the rotation
// builder when Rotation is shown and closes it when Rotation is left.
// Returns { start, go, route, destroy }: start() shows the route the page
// was opened at (a deep link), after the views are mounted.
export function mountRouter(doc, store, registry, { panels = {} } = {}) {
  const win = doc.defaultView ?? NO_WINDOW;
  const shells = new Map(
    [...doc.querySelectorAll("[data-area]")].map((shell) => [
      shell.getAttribute("data-area"),
      shell,
    ]),
  );
  const links = new Map(
    [...doc.querySelectorAll("[data-nav-area]")].map((link) => [
      link.getAttribute("data-nav-area"),
      link,
    ]),
  );
  let route = null;
  let index = 0;
  // Where the focus was when each history entry was left (its index).
  const left = new Map();
  let last = store.get();

  const entryIndex = () => {
    const state = win.history.state;
    return typeof state?.routerIndex === "number" ? state.routerIndex : null;
  };

  function show(next, focus) {
    const from = route?.area ?? null;
    route = next;
    for (const [area, shell] of shells) {
      shell.hidden = area !== next.area;
    }
    for (const [area, link] of links) {
      if (area === next.area) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
    doc.title = titleFor(next);
    store.set({ route: Object.freeze({ ...next }) });
    if (from !== next.area && from !== null) {
      win.scrollTo?.(PAGE_TOP, PAGE_TOP);
    }
    syncPanels(from, next.area);
    const heading = shells.get(next.area)?.querySelector("h1");
    if (focus === "heading") {
      heading?.focus();
    } else if (focus === "restore") {
      const back = left.get(index);
      if (canFocus(doc, back)) {
        back.focus();
      } else {
        heading?.focus();
      }
    }
  }

  // Opens a panel's view when its area is shown, closes it when it is left.
  function syncPanels(from, to) {
    for (const [area, panel] of Object.entries(panels)) {
      const open = panel.isOpen(store.get());
      if (area === to && !open) {
        panel.toggle();
      } else if (area === from && area !== to && open) {
        panel.toggle();
      }
    }
  }

  // A move the page makes: a new history entry, and the focus left as it is.
  function go(area, { focus = "none" } = {}) {
    if (route?.area === area) {
      return;
    }
    left.set(index, doc.activeElement);
    index += 1;
    const next = { area, sub: null, param: null };
    win.history.pushState({ routerIndex: index }, "", formatRoute(next));
    show(next, focus);
  }

  // The area a node is in, or null when it is outside every area (the nav,
  // the Run bar).
  const areaOf = (node) =>
    node?.closest?.("[data-area]")?.getAttribute("data-area") ?? null;

  function onHashChange() {
    const hash = win.location.hash;
    const known = entryIndex();
    left.set(index, doc.activeElement);
    const direction = known !== null && known < index ? "back" : "forward";
    index = known ?? index + 1;
    // A link to an element on the page (#run-errors-link in the form's
    // footer, say): its area is shown, and the browser does the rest.
    if (!isRouteHash(hash)) {
      const target = doc.getElementById(
        decodeURIComponent(hash.replace(/^#/, "")),
      );
      if (target !== null) {
        win.history.replaceState({ routerIndex: index }, "");
        const area = areaOf(target);
        if (area !== null && area !== route.area) {
          show({ area, sub: null, param: null }, "none");
        }
        return;
      }
    }
    const next = parseRoute(hash);
    win.history.replaceState({ routerIndex: index }, "", formatRoute(next));
    show(next, direction === "back" ? "restore" : "heading");
  }

  function onReveal(event) {
    const area = areaOf(event.target);
    if (area !== null) {
      go(area);
    }
  }

  function drawBadges(state) {
    for (const { id } of AREAS) {
      const badge = links.get(id)?.querySelector("[data-badge]");
      if (!badge) {
        continue;
      }
      const shown = badgeOf(registry.areaStatus(state, id));
      const key = shown === null ? "" : `${shown.count} ${shown.words}`;
      if (badge.getAttribute("data-badge") === key) {
        continue;
      }
      badge.setAttribute("data-badge", key);
      badge.hidden = shown === null;
      const words = doc.createElement("span");
      words.className = "visually-hidden";
      words.textContent = shown === null ? "" : ` ${shown.words}`;
      badge.replaceChildren(shown === null ? "" : String(shown.count), words);
    }
  }

  const unsubscribe = store.subscribe(({ state }) => {
    const before = last;
    last = state;
    drawBadges(state);
    if (route === null) {
      return;
    }
    const area = followArea(before, state, route.area);
    if (area !== null) {
      go(area);
    }
  });

  function start() {
    const hash = win.location.hash;
    const target = isRouteHash(hash)
      ? null
      : doc.getElementById(decodeURIComponent(hash.replace(/^#/, "")));
    const next =
      target === null
        ? parseRoute(hash)
        : { area: areaOf(target) ?? DEFAULT_AREA, sub: null, param: null };
    index = entryIndex() ?? 0;
    win.history.replaceState(
      { routerIndex: index },
      "",
      target === null ? formatRoute(next) : undefined,
    );
    last = store.get();
    drawBadges(last);
    for (const section of registry.all()) {
      section.render(shells.get(section.area), store);
    }
    show(next, "none");
    win.addEventListener("hashchange", onHashChange);
    doc.addEventListener?.(REVEAL_EVENT, onReveal);
  }

  function destroy() {
    unsubscribe();
    win.removeEventListener("hashchange", onHashChange);
    doc.removeEventListener?.(REVEAL_EVENT, onReveal);
  }

  return { start, go, route: () => route, destroy };
}
