import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  DEFAULT_TEXT_PX,
  NARROW_EM,
  NARROW_PX,
  NARROW_QUERY,
  NOT_WIDE_QUERY,
  WIDE_EM,
  WIDE_PX,
  WIDE_QUERY,
} from "../js/views/breakpoints.js";
import { NARROW_QUERY as CONTROLS_QUERY } from "../js/views/controls.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// The one narrow rule (#153): below 32.5em, 520 px at the default text
// size, so 520 px and up is wide. In em, so bigger text narrows the layout
// with it (Fran's #253 check, N6).
const emOf = (query) => Number(/([\d.]+)em\)$/.exec(query)?.[1]);

describe("the narrow breakpoint", () => {
  it("is below 520 px: 519 is narrow, 520 is wide", () => {
    assert.equal(DEFAULT_TEXT_PX, 16);
    assert.equal(NARROW_PX, 520);
    assert.equal(NARROW_EM * DEFAULT_TEXT_PX, NARROW_PX);
    assert.equal(NARROW_QUERY, "(width < 32.5em)");
    // Strictly below: 519 and 519.5 are narrow, 520 is not.
    const narrowAt = (px) => px < emOf(NARROW_QUERY) * DEFAULT_TEXT_PX;
    assert.ok(narrowAt(519), "519 px is narrow");
    assert.ok(narrowAt(519.5), "a fractional width under 520 is narrow");
    assert.ok(!narrowAt(NARROW_PX), "520 px is wide");
  });

  it("no stylesheet has a breakpoint in px (#253, N6)", async () => {
    for (const file of [
      "../styles.css",
      "../talent-tree.css",
      "../rotation-builder.css",
    ]) {
      const css = await read(file);
      const queries = [...css.matchAll(/@(?:media|container)([^{]+)\{/g)].map(
        ([, query]) => query.trim(),
      );
      for (const query of queries) {
        assert.doesNotMatch(query, /\dpx/, `${file}: ${query}`);
        assert.doesNotMatch(query, /(?:min|max)-(?:width|height)/, query);
      }
    }
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
        /max-width|min-width|width [<>]/,
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
    const narrow = queries.filter(
      (query) => /^\(width < /.test(query) && emOf(query) <= NARROW_EM,
    );
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
    const narrow = queries.filter((query) => /width/.test(query));
    assert.equal(narrow.length, 1, "the tabs and the bigger tiles");
    assert.deepEqual(narrow, [NARROW_QUERY]);
    assert.doesNotMatch(css, /\b520px\b/);
  });

  it("rotation-builder.css uses the same narrow query (#217)", async () => {
    const css = await read("../rotation-builder.css");
    const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map(([, query]) =>
      query.trim(),
    );
    assert.deepEqual(queries, [NARROW_QUERY]);
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

  it("styles.css's wide blocks use the wide query and its complement (#241)", async () => {
    assert.equal(WIDE_PX, 1024);
    assert.equal(WIDE_EM * DEFAULT_TEXT_PX, WIDE_PX);
    assert.equal(WIDE_QUERY, `(width >= ${WIDE_EM}em)`);
    assert.equal(NOT_WIDE_QUERY, `(width < ${WIDE_EM}em)`);
    const css = await read("../styles.css");
    const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map(([, query]) =>
      query.trim(),
    );
    const wide = queries.filter((query) => /^\(width >/.test(query));
    assert.ok(wide.length >= 1, "the desktop layout");
    for (const query of wide) {
      assert.equal(query, WIDE_QUERY);
    }
    const below = queries.filter(
      (query) => /^\(width < /.test(query) && emOf(query) > NARROW_EM,
    );
    assert.ok(below.length >= 2, "the phone dock and the pinned messages");
    for (const query of below) {
      assert.equal(query, NOT_WIDE_QUERY);
    }
  });
});
