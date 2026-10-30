// The page's breakpoints, in em (Fran's #253 check, N6). In a media query
// 1em is the browser's own text size (16 px unless the reader changed it),
// so with bigger text the layouts switch at a wider screen and the text
// still fits. The *_PX values are the same widths at that default size.
// styles.css (and talent-tree.css, rotation-builder.css) repeat the queries
// (CSS cannot import them); test/breakpoints.test.js pins the two together.
export const DEFAULT_TEXT_PX = 16;

// The one narrow breakpoint (#153). Narrow is below 32.5em (520 px): a
// 520 px viewport (and anything wider) is wide, and 519 px is narrow. The
// range form keeps a fractional width (zoom, a high-DPR screen) between 519
// and 520 on the narrow side without catching 520.
export const NARROW_EM = 32.5;
export const NARROW_PX = NARROW_EM * DEFAULT_TEXT_PX;
export const NARROW_QUERY = `(width < ${NARROW_EM}em)`;

// The wide breakpoint (#241, UX3; proposal section 3). From 64em (1024 px)
// up the page has the nav down the left, the areas, and the results column
// on the right with Run in it; nothing sticks to the top. Below it the Run
// panel is the phone dock (#240). styles.css repeats the query, and its
// complement as (width < 64em); test/breakpoints.test.js pins all three
// together.
export const WIDE_EM = 64;
export const WIDE_PX = WIDE_EM * DEFAULT_TEXT_PX;
export const WIDE_QUERY = `(width >= ${WIDE_EM}em)`;
export const NOT_WIDE_QUERY = `(width < ${WIDE_EM}em)`;
