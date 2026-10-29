import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { NARROW_PX, NARROW_QUERY } from "../js/views/breakpoints.js";
import { NARROW_QUERY as CONTROLS_QUERY } from "../js/views/controls.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// The one narrow rule (#153): max-width 519.98px, so 520 px and up is wide.
describe("the narrow breakpoint", () => {
  it("is below 520 px: 519 is narrow, 520 is wide", () => {
    assert.equal(NARROW_PX, 520);
    assert.equal(NARROW_QUERY, "(max-width: 519.98px)");
    const max = Number(/max-width: ([\d.]+)px/.exec(NARROW_QUERY)[1]);
    assert.ok(519 <= max, "519 px is narrow");
    assert.ok(519.5 <= max, "a fractional width under 520 is narrow");
    assert.ok(NARROW_PX > max, "520 px is wide");
  });

  it("every view uses the shared query", async () => {
    assert.equal(CONTROLS_QUERY, NARROW_QUERY);
    const dir = new URL("../js/", import.meta.url);
    const files = await readdir(dir, { recursive: true });
    for (const file of files.filter((name) => name.endsWith(".js"))) {
      const text = await read(`../js/${file}`);
      if (file.endsWith("breakpoints.js")) {
        continue;
      }
      assert.doesNotMatch(
        text,
        /max-width|min-width/,
        `${file} uses breakpoints.js`,
      );
    }
    for (const file of [
      "views/controls.js",
      "views/config-form.js",
      "views/talent-tree.js",
    ]) {
      assert.match(
        await read(`../js/${file}`),
        /import \{ NARROW_QUERY \} from "\.\/breakpoints\.js";/,
        file,
      );
    }
  });

  it("every narrow @media block in styles.css uses the same query", async () => {
    const css = await read("../styles.css");
    const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map(([, query]) =>
      query.trim(),
    );
    const narrow = queries.filter((query) => {
      const width = /max-width: ([\d.]+)px/.exec(query);
      return width !== null && Number(width[1]) < NARROW_PX + 1;
    });
    assert.ok(narrow.length >= 3, "the run bar, the page and the form");
    for (const query of narrow) {
      assert.equal(query, NARROW_QUERY);
    }
    // The one 520px that is not a breakpoint: a chart's own minimum width
    // inside its sideways-scrolling region (#154, decision 3).
    const chartWidth = /\.chart-scroll \.chart \{\s*min-width: 520px;\s*\}/g;
    assert.equal(css.match(chartWidth)?.length, 1, "the chart minimum width");
    const rest = css.replace(chartWidth, "");
    assert.doesNotMatch(rest, /\b520px\b/);
    assert.doesNotMatch(rest, /min-width: 52\dpx/);
  });

  it("talent-tree.css uses the same narrow query (#204)", async () => {
    const css = await read("../talent-tree.css");
    const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map(([, query]) =>
      query.trim(),
    );
    const narrow = queries.filter((query) => /max-width/.test(query));
    assert.equal(narrow.length, 1, "the tabs and the bigger tiles");
    assert.deepEqual(narrow, [NARROW_QUERY]);
    assert.doesNotMatch(css, /\b520px\b/);
  });

  it("contains each sideways scroller's inline size, so it cannot widen the page (#154)", async () => {
    const css = await read("../styles.css");
    const rule = css.match(
      /((?:\.[\w-]+,\s*)*\.[\w-]+)\s*\{\s*contain: inline-size;\s*\}/,
    );
    assert.ok(rule, "a contain: inline-size rule");
    const selectors = rule[1].split(",").map((part) => part.trim());
    assert.ok(selectors.includes(".table-scroll"), ".table-scroll");
    assert.ok(selectors.includes(".chart-scroll"), ".chart-scroll");
  });
});
