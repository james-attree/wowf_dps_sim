import { TALENTS_3UP_QUERY, WIDE_QUERY } from "./breakpoints.js";

// The page's reading order on wide screens (#243, Fran's #253 check, N3).
// From the wide breakpoint up the results column (Run, then the Average
// card) is drawn beside the areas, in its own grid column (styles.css), so
// where it is in the page changes nothing on screen; it is put after the
// areas there, and an area's h1 is the first thing read and tabbed to after
// the nav. On Results the column is the bar above the results (#242, UX4),
// and below the wide breakpoint it is the phone dock with its settings over
// the area (#240, UX2): both are drawn before the area, and the column stays
// before it in the page, where index.html has it. From 80em the Talents
// screen draws the column as that same bar above the area (#263), so there
// it stays before the area too, and goes back after it below 80em or on
// leaving Talents (Fran's #437 P1, WCAG 2.4.3; coordinator call 25 Nov,
// James delegated).
export function placeRunColumn(doc, area, sub = null) {
  // A page that can't move nodes (the unit tests' stand-ins) keeps its order.
  if (
    typeof doc.getElementById !== "function" ||
    typeof doc.querySelectorAll !== "function"
  ) {
    return;
  }
  const column = doc.getElementById("run-column");
  const shells = [...doc.querySelectorAll("[data-area]")];
  if (
    column == null ||
    shells.length === 0 ||
    typeof column.after !== "function" ||
    typeof column.before !== "function"
  ) {
    return;
  }
  const win = doc.defaultView;
  const wide = win?.matchMedia?.(WIDE_QUERY).matches === true;
  const talentsBar =
    area === "character" &&
    sub === "talents" &&
    win?.matchMedia?.(TALENTS_3UP_QUERY).matches === true;
  const after = wide && area !== "results" && !talentsBar;
  const had = doc.activeElement;
  if (after && shells.at(-1).nextElementSibling !== column) {
    shells.at(-1).after(column);
  } else if (!after && shells[0].previousElementSibling !== column) {
    shells[0].before(column);
  } else {
    return;
  }
  // Moving a node blurs what is focused in it (Run, which started a batch
  // and showed Results): the focus stays on it.
  if (column.contains(had) && doc.activeElement !== had) {
    had.focus({ preventScroll: true });
  }
}

// Places the column again when the page crosses the wide breakpoint, or
// the Talents bar's 80em (#263).
export function watchReadingOrder(doc, areaNow, subNow = () => null) {
  const queries = [WIDE_QUERY, TALENTS_3UP_QUERY].map((query) =>
    doc.defaultView?.matchMedia?.(query),
  );
  const change = () => placeRunColumn(doc, areaNow(), subNow());
  for (const query of queries) {
    query?.addEventListener?.("change", change);
  }
  return () => {
    for (const query of queries) {
      query?.removeEventListener?.("change", change);
    }
  };
}
