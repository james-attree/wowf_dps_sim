import { placeRunColumn, watchReadingOrder } from "./reading-order.js";
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
// opening) leaves the focus to the view that made it, unless the focus was
// in the area it leaves: that control is hidden now, so the new area's h1
// takes the focus rather than the page dropping it (Fran's QA of #251, B1:
// "Edit rotation…" is in Character and opens the builder in Rotation).
//
// An area's name in the hash is matched in any case: #Fight is #fight.

export const APP_TITLE = "WoW Forever Rogue Simulator";

// The areas' sub-screens. Results has two views (#242, UX4): the average,
// its first and #results itself, and the live fight. Rotation (#243, UX5)
// has a rule's screen, #rotation/rule/2, and Export or import,
// #rotation/share (js/views/rotation-builder.js shows them). Character
// (#244, UX6) has Gear and weapons, Stats and Talents
// (js/views/character-screens.js). A route's sub or param that is not one of
// its area's is dropped, so #character/armor is #character.
export const SUBS = Object.freeze({
  character: Object.freeze(["gear", "stats", "talents"]),
  results: Object.freeze(["average", "live"]),
  rotation: Object.freeze(["rule", "share"]),
});

// A sub-screen's own name, for the page's title (#244): "Stats · WoW Forever
// Rogue Simulator". Rotation's screens name themselves
// (js/views/rotation-builder.js).
export const SCREEN_NAMES = Object.freeze({
  character: Object.freeze({
    gear: "Gear and weapons",
    stats: "Stats",
    talents: "Talents",
  }),
});
export const RESULT_VIEWS = SUBS.results;

const SEPARATOR = "/";

// A new area is shown from the top of the page.
const PAGE_TOP = 0;
// The run moves' count, which makes each `moved` a change.
const NO_MOVES = 0;
const ONE_MOVE = 1;

// "#rotation/rule/2" as { area, sub, param }. An unknown area is the default
// one; an unknown sub is the area's top level.
export function parseRoute(hash, subs = SUBS) {
  const [head, sub, param] = String(hash ?? "")
    .replace(/^#/, "")
    .split(SEPARATOR)
    .map((part) => decodeURIComponent(part));
  const area = head.toLowerCase();
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
  return head === "" || isArea(head.toLowerCase());
};

// "Rotation · WoW Forever Rogue Simulator", or a sub-screen's name.
export const titleFor = (route) =>
  `${SCREEN_NAMES[route.area]?.[route.sub] ?? areaLabel(route.area)} · ${APP_TITLE}`;

const isRunning = (state) =>
  state.run?.mode === "batch"
    ? state.batch?.status === "running"
    : state.run?.state === "running";
const builderOpen = (state) => state.rotationBuilder?.view?.open === true;

// The area a store change shows, or null for none (proposal §3: the page
// goes where the work is). Run shows the live fight (Fight) or the batch
// (Results) when it starts; a resumed fight stays where it is. The rotation
// builder is the Rotation area: opening it from anywhere goes there, to the
// screen it opened at (a message's rule, #243), and closing it there goes
// back to Character, where its opener is.
export function followArea(before, after, area) {
  return followRoute(before, after, { area, sub: null })?.area ?? null;
}

// The same as a route, { area, sub, param, run }, or null: an average shows
// Results' Average view (#242), from its Live view too; `run` is true for a
// move Run made, which the Run bar says (js/views/controls.js).
export function followRoute(before, after, route) {
  const { area } = route;
  if (!builderOpen(before) && builderOpen(after) && area !== "rotation") {
    const screen = after.rotationBuilder.view.screen;
    return {
      area: "rotation",
      sub: screen?.sub ?? null,
      param: screen?.param ?? null,
      run: false,
    };
  }
  if (builderOpen(before) && !builderOpen(after) && area === "rotation") {
    return { area: DEFAULT_AREA, sub: null, param: null, run: false };
  }
  const resumed = before.run?.state === "paused";
  if (!isRunning(before) && isRunning(after) && !resumed) {
    const batch = after.run?.mode === "batch";
    const shows = batch ? "results" : "fight";
    const onAverage = route.sub === null || route.sub === "average";
    if (shows === area && (!batch || onAverage)) {
      return null;
    }
    return { area: shows, sub: null, param: null, run: true };
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
  let moves = NO_MOVES;
  let stopWatching = () => {};

  // The area a node is in, or null when it is outside every area (the nav,
  // the Run bar).
  const areaOf = (node) =>
    node?.closest?.("[data-area]")?.getAttribute("data-area") ?? null;

  // The sub-screen a node is on (#244): the nearest data-screen, a list of
  // the screens it shows on ("list" is the area's top). The current screen
  // when it is one of them, else the first.
  const subOf = (node, area) => {
    const screens = (
      node?.closest?.("[data-screen]")?.getAttribute("data-screen") ?? ""
    )
      .split(" ")
      .filter((screen) => screen !== "");
    if (screens.length === 0) {
      return null;
    }
    const here = route?.area === area ? (route.sub ?? "list") : null;
    const screen = screens.includes(here) ? here : screens[0];
    return screen === "list" ? null : screen;
  };

  const entryIndex = () => {
    const state = win.history.state;
    return typeof state?.routerIndex === "number" ? state.routerIndex : null;
  };

  function show(next, focus) {
    const from = route?.area ?? null;
    const had = doc.activeElement;
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
    placeRunColumn(doc, next.area);
    store.set({ route: Object.freeze({ ...next }) });
    if (from !== next.area && from !== null) {
      win.scrollTo?.(PAGE_TOP, PAGE_TOP);
    }
    syncPanels(from, next.area);
    // The focus was in a screen that is hidden now: another area, or another
    // of this area's screens (#244: a Character row opens its screen). A
    // view that has moved it already (Rotation's Back, to the rule's Edit
    // link) keeps it there.
    const stranded =
      areaOf(had) !== null && doc.activeElement === had && !canFocus(doc, had);
    const heading = shells.get(next.area)?.querySelector("h1");
    if (focus === "heading" || (focus === "none" && stranded)) {
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
  function go(area, { focus = "none", sub = null, param = null } = {}) {
    if (route?.area === area && route?.sub === sub && route?.param === param) {
      return;
    }
    left.set(index, doc.activeElement);
    index += 1;
    const next = { area, sub, param };
    win.history.pushState({ routerIndex: index }, "", formatRoute(next));
    show(next, focus);
  }

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
        const sub = area === null ? null : subOf(target, area);
        if (area !== null && (area !== route.area || sub !== route.sub)) {
          show({ area, sub, param: null }, "none");
        }
        return;
      }
    }
    const next = parseRoute(hash);
    win.history.replaceState({ routerIndex: index }, "", formatRoute(next));
    // A link can name where the focus goes once its screen is shown
    // (data-return-focus): Rotation's "‹ Character" goes back to the "Edit
    // rotation…" link that opened it (#243, Fran's #251 check), and the Run
    // bar's warnings link to the h1 the warnings are under.
    const active = doc.activeElement;
    const returnId =
      direction === "forward"
        ? (active?.getAttribute?.("data-return-focus") ?? null)
        : null;
    const returnTo =
      returnId === null ? null : (doc.getElementById(returnId) ?? null);
    // A view's switch in the same area (Results' Average and Live, #242)
    // keeps the focus on the switch, which stays shown.
    const within =
      route !== null && next.area === route.area && canFocus(doc, active);
    if (returnTo !== null) {
      show(next, "none");
      if (canFocus(doc, returnTo)) {
        returnTo.focus();
      }
      return;
    }
    show(next, within ? "none" : direction === "back" ? "restore" : "heading");
  }

  function onReveal(event) {
    const area = areaOf(event.target);
    if (area !== null) {
      go(area, { sub: subOf(event.target, area) });
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
    const next = followRoute(before, state, route);
    if (next !== null) {
      const had = doc.activeElement;
      go(next.area, { sub: next.sub, param: next.param ?? null });
      // Run's move is said (#242), unless the focus moved with it to the
      // new area's heading, which says it.
      if (next.run && doc.activeElement === had) {
        moves += ONE_MOVE;
        store.set({ moved: Object.freeze({ area: next.area, count: moves }) });
      }
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
        : {
            area: areaOf(target) ?? DEFAULT_AREA,
            sub: areaOf(target) === null ? null : subOf(target, areaOf(target)),
            param: null,
          };
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
    stopWatching = watchReadingOrder(doc, () => route?.area ?? null);
    win.addEventListener("hashchange", onHashChange);
    doc.addEventListener?.(REVEAL_EVENT, onReveal);
  }

  function destroy() {
    unsubscribe();
    stopWatching();
    win.removeEventListener("hashchange", onHashChange);
    doc.removeEventListener?.(REVEAL_EVENT, onReveal);
  }

  return { start, go, route: () => route, destroy };
}
