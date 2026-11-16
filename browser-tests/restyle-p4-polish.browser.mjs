// Restyle C, phase 4 (#394): per-screen polish — Cinzel h1 letter-spacing,
// footer typography and container, talent connectors, rotation rule cards,
// results tables/charts, dock and rail tokens. 360, 1024 and 1280 at 100%
// and 150% text; axe on the screens this phase touches. Do not pin exact
// pixels for typography. Character and gear screens are left to #297.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const AXE = await readFile(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];
const WIDTHS = [360, 1024, 1280];
const TEXT = ["100%", "150%"];
const SCREEN_HEIGHT = 900;
const SLACK = 1;
const ROUTES = [
  "#character/talents",
  "#rotation",
  "#fight",
  "#results",
  "#results/weights",
];

let server;
let base;
let browser;

before(async () => {
  server = await startStaticServer({ port: 0 });
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch(
    process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" },
  );
});

after(async () => {
  await browser?.close();
  await new Promise((done) => server?.close(done) ?? done());
});

async function open(width, text, hash = "#rotation", { reducedMotion } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}?e2e${hash}`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

async function stylesCssUses(page, selector, property, token, hrefEnds = null) {
  return page.evaluate(
    ({ selector, property, token, hrefEnds }) => {
      const found = [];
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.type === globalThis.CSSRule.MEDIA_RULE) {
            walk(rule.cssRules);
            continue;
          }
          if (rule.type !== globalThis.CSSRule.STYLE_RULE) {
            continue;
          }
          const selectors = rule.selectorText
            .split(",")
            .map((part) => part.trim());
          if (!selectors.includes(selector)) {
            continue;
          }
          const value = rule.style.getPropertyValue(property);
          if (value.includes(token)) {
            found.push(value);
          }
        }
      };
      for (const sheet of globalThis.document.styleSheets) {
        const href = sheet.href ?? "";
        if (hrefEnds && !href.endsWith(hrefEnds)) {
          continue;
        }
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        walk(rules);
      }
      return found;
    },
    { selector, property, token, hrefEnds },
  );
}

async function stylesCssExact(
  page,
  selector,
  property,
  expected,
  hrefEnds = null,
) {
  return page.evaluate(
    ({ selector, property, expected, hrefEnds }) => {
      const found = [];
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.type === globalThis.CSSRule.MEDIA_RULE) {
            walk(rule.cssRules);
            continue;
          }
          if (rule.type !== globalThis.CSSRule.STYLE_RULE) {
            continue;
          }
          const selectors = rule.selectorText
            .split(",")
            .map((part) => part.trim());
          if (!selectors.includes(selector)) {
            continue;
          }
          const value = rule.style.getPropertyValue(property).trim();
          if (value === expected) {
            found.push(value);
          }
        }
      };
      for (const sheet of globalThis.document.styleSheets) {
        const href = sheet.href ?? "";
        if (hrefEnds && !href.endsWith(hrefEnds)) {
          continue;
        }
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        walk(rules);
      }
      return found;
    },
    { selector, property, expected, hrefEnds },
  );
}

async function axeViolations(page) {
  if (!(await page.evaluate(() => "axe" in globalThis))) {
    await page.addScriptTag({ content: AXE });
  }
  return page.evaluate(
    async (values) =>
      (
        await globalThis.axe.run(globalThis.document, {
          runOnly: { type: "tag", values },
        })
      ).violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    AXE_TAGS,
  );
}

describe("restyle C phase 4 per-screen polish", () => {
  test("Cinzel h1 letter-spacing is no longer tight", async () => {
    const { context, page, errors } = await open(
      360,
      "150%",
      "#character/start",
    );
    try {
      const spacing = await stylesCssExact(
        page,
        "h1",
        "letter-spacing",
        "normal",
        "styles.css",
      );
      const titleSpacing = await stylesCssExact(
        page,
        ".app-title",
        "letter-spacing",
        "normal",
        "styles.css",
      );
      assert.ok(spacing.length > 0, "h1 letter-spacing is not normal");
      assert.ok(
        titleSpacing.length > 0,
        ".app-title letter-spacing is not normal",
      );
      const areaSpacing = await stylesCssExact(
        page,
        ".area-title",
        "letter-spacing",
        "-0.015em",
        "styles.css",
      );
      assert.ok(
        areaSpacing.length > 0,
        ".area-title letter-spacing is not -0.015em",
      );
      const overflow = await page.evaluate(() => {
        const titles = [
          ...globalThis.document.querySelectorAll("h1, .app-title"),
        ];
        return titles.map((node) => ({
          text: node.textContent.trim(),
          overflow: node.scrollWidth - node.clientWidth,
          spacing: globalThis.getComputedStyle(node).letterSpacing,
        }));
      });
      for (const title of overflow) {
        assert.ok(
          title.overflow <= SLACK,
          `${title.text} overflow ${title.overflow}`,
        );
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("the footer keeps its wording and uses the UI font and a token edge", async () => {
    const { context, page, errors } = await open(1280, "100%", "#rotation");
    try {
      const footer = await page.evaluate(() => {
        const node = globalThis.document.querySelector(".site-footer");
        const style = globalThis.getComputedStyle(node);
        return {
          text: node.innerText.replace(/\s+/g, " ").trim(),
          font: style.fontFamily,
          color: style.color,
          border: style.borderTopColor,
          paddingTop: style.paddingTop,
        };
      });
      assert.match(footer.text, /talentsforever\.com/);
      assert.match(footer.text, /CC BY 4\.0/);
      assert.match(footer.text, /not affiliated with Blizzard/);
      assert.doesNotMatch(footer.text, /wowsims/i);
      const fontRule = await stylesCssUses(
        page,
        ".site-footer",
        "font-family",
        "var(--font-ui)",
        "styles.css",
      );
      const edgeRule = await stylesCssUses(
        page,
        ".site-footer",
        "border-top",
        "var(--border)",
        "styles.css",
      );
      const hoverRule = await stylesCssUses(
        page,
        ".site-footer a:hover",
        "color",
        "var(--text)",
        "styles.css",
      );
      assert.ok(fontRule.length > 0, "footer font is not --font-ui");
      assert.ok(edgeRule.length > 0, "footer edge is not --border");
      assert.ok(hoverRule.length > 0, "footer hover is not --text");
      assert.notEqual(footer.paddingTop, "0px");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("lit talent connectors use --trim", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/talents",
    );
    try {
      const line = await stylesCssUses(
        page,
        ".talent-arrow.is-lit",
        "border-left",
        "var(--trim)",
        "talent-tree.css",
      );
      const head = await stylesCssUses(
        page,
        ".talent-arrow.is-lit::after",
        "border-top-color",
        "var(--trim)",
        "talent-tree.css",
      );
      assert.ok(line.length > 0, "lit connector line is not --trim");
      assert.ok(head.length > 0, "lit connector head is not --trim");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("alt rotation rules use the control-edge token", async () => {
    const { context, page, errors } = await open(1280, "100%", "#rotation");
    try {
      const rule = await stylesCssUses(
        page,
        ".rule.is-alt",
        "border-left",
        "var(--control)",
        "rotation-builder.css",
      );
      const chip = await stylesCssUses(
        page,
        ".chip.is-alt",
        "border-color",
        "var(--control)",
        "rotation-builder.css",
      );
      assert.ok(rule.length > 0, "alt rule gutter is not --control");
      assert.ok(chip.length > 0, "alt chip edge is not --control");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("results chart labels use --text", async () => {
    const { context, page, errors } = await open(1280, "100%", "#results");
    try {
      const mean = await stylesCssUses(
        page,
        ".chart .chart-mean",
        "color",
        "var(--text)",
        "styles.css",
      );
      const axis = await stylesCssUses(
        page,
        ".chart .chart-axis-title",
        "color",
        "var(--text)",
        "styles.css",
      );
      const lastRow = await stylesCssUses(
        page,
        ".results-table tbody tr:last-child td",
        "border-bottom-color",
        "var(--control)",
        "styles.css",
      );
      assert.ok(mean.length > 0, "chart mean is not --text");
      assert.ok(axis.length > 0, "chart axis title is not --text");
      assert.ok(lastRow.length > 0, "table last-row rule is not --control");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("dock and rail hover uses --text", async () => {
    const { context, page, errors } = await open(1280, "100%", "#rotation");
    try {
      const hover = await stylesCssUses(
        page,
        ".area-nav a:hover",
        "color",
        "var(--text)",
        "styles.css",
      );
      assert.ok(hover.length > 0, "nav hover is not --text");
      const current = page.locator(".area-nav a[aria-current='page']");
      const currentColor = await current.evaluate(
        (node) => globalThis.getComputedStyle(node).color,
      );
      const accent = await page.evaluate(() => {
        const probe = globalThis.document.createElement("div");
        probe.style.color = "var(--accent)";
        globalThis.document.body.append(probe);
        const color = globalThis.getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      assert.equal(currentColor, accent);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("reduced motion leaves the polished chrome in place", async () => {
    const { context, page, errors } = await open(1280, "100%", "#rotation", {
      reducedMotion: true,
    });
    try {
      const footer = await page.evaluate(() => {
        const node = globalThis.document.querySelector(".site-footer");
        const style = globalThis.getComputedStyle(node);
        return {
          display: style.display,
          animation: style.animationName,
        };
      });
      assert.notEqual(footer.display, "none");
      assert.ok(
        footer.animation === "none" || footer.animation === "",
        footer.animation,
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  for (const width of WIDTHS) {
    for (const text of TEXT) {
      test(`no sideways scroll and axe-clean at ${width} and ${text} text`, async () => {
        const { context, page, errors } = await open(width, text, ROUTES[0]);
        try {
          const failures = [];
          for (const hash of ROUTES) {
            await page.evaluate((route) => {
              globalThis.location.hash = route;
            }, hash);
            await page.waitForFunction(() => globalThis.__store != null);
            const sideways = await page.evaluate(() => {
              const doc = globalThis.document.documentElement;
              return doc.scrollWidth - doc.clientWidth;
            });
            if (sideways > SLACK) {
              failures.push(`${hash} sideways ${sideways}`);
            }
            const violations = await axeViolations(page);
            for (const violation of violations) {
              failures.push(`${hash} axe ${violation}`);
            }
          }
          assert.deepEqual(failures, []);
          assert.equal(errors.length, 0, errors.join("\n"));
        } finally {
          await context.close();
        }
      });
    }
  }
});
