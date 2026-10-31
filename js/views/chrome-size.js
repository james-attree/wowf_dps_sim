// The phone dock's two parts grow with the text (#245, Fran's #253 and #258
// checks): the strip's lines are in rem, and with bigger text the nav turns
// into two rows of two. Below the wide breakpoint both are fixed to the foot
// of the screen, so the strip sits on the nav's height and the page leaves
// room for both (styles.css, --area-nav-height and --strip-height). CSS
// cannot hand a fixed box's height to another, so this measures each one as
// it changes and sets the two properties on the root; until it runs, the
// stylesheet's own least heights stand in.
export const NAV_HEIGHT_PROPERTY = "--area-nav-height";
export const STRIP_HEIGHT_PROPERTY = "--strip-height";

// The nav's height without the safe-area inset under it, which the
// stylesheet adds on its own.
function navHeight(nav, view) {
  const inset = Number.parseFloat(view.getComputedStyle(nav).paddingBottom);
  return (
    nav.getBoundingClientRect().height - (Number.isFinite(inset) ? inset : 0)
  );
}

export function trackChromeSize(doc = globalThis.document) {
  const view = doc?.defaultView;
  const nav = doc?.querySelector(".area-nav");
  const strip = doc?.querySelector(".run-row-actions");
  if (!view || !nav || !strip || typeof view.ResizeObserver !== "function") {
    return () => {};
  }
  const root = doc.documentElement;
  const measure = () => {
    root.style.setProperty(NAV_HEIGHT_PROPERTY, `${navHeight(nav, view)}px`);
    root.style.setProperty(
      STRIP_HEIGHT_PROPERTY,
      `${strip.getBoundingClientRect().height}px`,
    );
  };
  const observer = new view.ResizeObserver(measure);
  observer.observe(nav);
  observer.observe(strip);
  measure();
  return () => observer.disconnect();
}
