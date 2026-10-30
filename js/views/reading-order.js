import { WIDE_QUERY } from "./breakpoints.js";

// The page's reading order on wide screens (#243, Fran's #253 check, N3).
// From the wide breakpoint up the results column (Run, then the Average
// card) is drawn beside the areas, in its own grid column (styles.css), so
// where it is in the page changes nothing on screen; it is put after the
// areas there, and an area's h1 is the first thing read and tabbed to after
// the nav. On Results the column is the bar above the results (#242, UX4),
// and below the wide breakpoint it is the phone dock with its settings over
// the area (#240, UX2): both are drawn before the area, and the column stays
// before it in the page, where index.html has it.
export function placeRunColumn(doc, area) {
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
  const after = wide && area !== "results";
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

// Places the column again when the page crosses the wide breakpoint.
export function watchReadingOrder(doc, areaNow) {
  const query = doc.defaultView?.matchMedia?.(WIDE_QUERY);
  const change = () => placeRunColumn(doc, areaNow());
  query?.addEventListener?.("change", change);
  return () => query?.removeEventListener?.("change", change);
}
