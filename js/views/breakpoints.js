// The page's one narrow breakpoint (#153). Narrow is below 520 px: the media
// query is max-width 519.98px, so a 520 px viewport (and anything wider) is
// wide, and 519 px is narrow. The 0.02 px keeps a fractional width (zoom, a
// high-DPR screen) between 519 and 520 on the narrow side without catching 520.
// styles.css repeats the same query in each narrow @media block (CSS cannot
// import it); test/breakpoints.test.js pins the two together.
export const NARROW_PX = 520;
export const NARROW_QUERY = "(max-width: 519.98px)";

// The wide breakpoint (#241, UX3; proposal section 3). From 1024 px up the
// page has the nav down the left, the areas, and the results column on the
// right with Run in it; nothing sticks to the top. Below it the Run panel is
// the phone dock (#240). styles.css repeats the query as (min-width: 1024px)
// and its complement as (max-width: 1023.98px); test/breakpoints.test.js pins
// all three together.
export const WIDE_PX = 1024;
export const WIDE_QUERY = "(min-width: 1024px)";
