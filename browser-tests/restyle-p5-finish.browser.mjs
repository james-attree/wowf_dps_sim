// Restyle C, #395 part (a): non-gear leftovers — h2 tracking, unlit
// connector token, skip-chip border, forced-colours current-nav bar and
// start-card inset, favicon gold, and the checked run-mode pill's --trim
// border. 360, 1024 and 1280 at 100% and 150% text. Character and gear
// screens, and the 0.65rem phone stats summary, are out of scope.
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
  "#character/start",
  "#character/talents",
  "#rotation",
  "#fight",
  "#results",
];
const FAVICON_GOLD = "#e8c547";
const CONNECTOR_UNLIT = "rgb(84, 69, 43)";

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

async function open(
  width,
  text,
  hash = "#rotation",
  { reducedMotion, forcedColors } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    ...(forcedColors ? { forcedColors } : {}),
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
          if (value.toLowerCase().includes(token.toLowerCase())) {
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

async function systemColor(page, property, name) {
  return page.evaluate(
    ({ property, name }) => {
      const probe = globalThis.document.createElement("div");
      probe.style[property] = name;
      globalThis.document.body.append(probe);
      const value = globalThis.getComputedStyle(probe)[property];
      probe.remove();
      return value;
    },
    { property, name },
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

describe("restyle C #395 part a leftovers", () => {
  test("Cinzel h2 letter-spacing is normal", async () => {
    const { context, page, errors } = await open(
      360,
      "150%",
      "#character/start",
    );
    try {
      const spacing = await stylesCssExact(
        page,
        "h2",
        "letter-spacing",
        "normal",
        "styles.css",
      );
      assert.ok(spacing.length > 0, "h2 letter-spacing is not normal");
      const overflow = await page.evaluate(() =>
        [...globalThis.document.querySelectorAll("h2")]
          .filter((node) => node.getClientRects().length > 0)
          .map((node) => ({
            text: node.textContent.trim(),
            overflow: node.scrollWidth - node.clientWidth,
          })),
      );
      for (const heading of overflow) {
        assert.ok(
          heading.overflow <= SLACK,
          `${heading.text} overflows by ${heading.overflow}`,
        );
      }
      const sideways = await page.evaluate(() => {
        const doc = globalThis.document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      assert.ok(sideways <= SLACK, `page sideways ${sideways}`);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("unlit talent connectors use the decorative token", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/talents",
    );
    try {
      const line = await stylesCssUses(
        page,
        ".talent-arrow",
        "border-left",
        "var(--connector-unlit)",
        "talent-tree.css",
      );
      assert.ok(line.length > 0, "unlit connector is not --connector-unlit");
      const head = await stylesCssUses(
        page,
        ".talent-arrow::after",
        "border-top",
        "var(--connector-unlit)",
        "talent-tree.css",
      );
      assert.ok(
        head.length > 0,
        "unlit connector head is not --connector-unlit",
      );
      const painted = await page.evaluate(() =>
        globalThis
          .getComputedStyle(globalThis.document.documentElement)
          .getPropertyValue("--connector-unlit")
          .trim(),
      );
      assert.equal(painted, "#54452b");
      const computed = await page.evaluate(() => {
        const probe = globalThis.document.createElement("div");
        probe.style.borderColor = "var(--connector-unlit)";
        globalThis.document.body.append(probe);
        const color = globalThis.getComputedStyle(probe).borderTopColor;
        probe.remove();
        return color;
      });
      assert.equal(computed, CONNECTOR_UNLIT);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("the skip-chip border uses the control-edge token", async () => {
    const { context, page, errors } = await open(1280, "100%", "#rotation");
    try {
      const chip = await stylesCssUses(
        page,
        ".chip.is-skip",
        "border-color",
        "var(--control)",
        "rotation-builder.css",
      );
      assert.ok(chip.length > 0, "skip-chip border is not --control");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("the favicon gold is #e8c547", async () => {
    const svg = await readFile(new URL("../img/favicon.svg", import.meta.url), {
      encoding: "utf8",
    });
    const golds = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map(
      (match) => match[1],
    );
    assert.equal(
      golds.filter((color) => color.toLowerCase() === FAVICON_GOLD).length,
      2,
      svg,
    );
    assert.equal(svg.includes("#e7bd55"), false, "favicon uses the old gold");
  });

  test("the checked run-mode pill has a --trim border", async () => {
    const { context, page, errors } = await open(1280, "100%", "#fight");
    try {
      const border = await stylesCssUses(
        page,
        ".run-mode-pill input:checked + span",
        "border-color",
        "var(--trim)",
        "styles.css",
      );
      assert.ok(border.length > 0, "checked pill border is not --trim");
      const fill = await stylesCssUses(
        page,
        ".run-mode-pill input:checked + span",
        "background",
        "var(--accent)",
        "styles.css",
      );
      assert.ok(fill.length > 0, "checked pill fill is not --accent");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("the current-nav bar and start-card inset still use box-shadow outside forced colours", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/start",
    );
    try {
      const nav = page.locator(".area-nav a[aria-current='page']");
      const navStyle = await nav.evaluate((node) => {
        const style = globalThis.getComputedStyle(node);
        return {
          boxShadow: style.boxShadow,
          borderLeftWidth: style.borderLeftWidth,
          borderTopWidth: style.borderTopWidth,
        };
      });
      assert.match(navStyle.boxShadow, /inset/);
      assert.equal(navStyle.borderLeftWidth, "0px");
      const card = page.locator(".start-card[aria-current='true']");
      const cardStyle = await card.evaluate((node) => {
        const style = globalThis.getComputedStyle(node);
        return {
          boxShadow: style.boxShadow,
          borderTopWidth: style.borderTopWidth,
        };
      });
      assert.match(cardStyle.boxShadow, /inset/);
      assert.equal(cardStyle.borderTopWidth, "1px");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("forced colours paint the current-nav bar with a ButtonText border at 360", async () => {
    const { context, page, errors } = await open(
      360,
      "100%",
      "#character/start",
      { forcedColors: "active" },
    );
    try {
      const buttonText = await systemColor(
        page,
        "borderTopColor",
        "ButtonText",
      );
      const nav = page.locator(".area-nav a[aria-current='page']");
      const style = await nav.evaluate((node) => {
        const computed = globalThis.getComputedStyle(node);
        return {
          borderTopWidth: computed.borderTopWidth,
          borderTopColor: computed.borderTopColor,
          borderLeftWidth: computed.borderLeftWidth,
          boxShadow: computed.boxShadow,
        };
      });
      assert.equal(style.borderTopWidth, "3px");
      assert.equal(style.borderTopColor, buttonText);
      assert.equal(style.borderLeftWidth, "0px");
      const specified = await stylesCssUses(
        page,
        '.area-nav a[aria-current="page"]',
        "border-top",
        "ButtonText",
        "styles.css",
      );
      assert.ok(specified.length > 0, "forced-colours nav bar is not a border");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("forced colours paint the current-nav bar with a ButtonText border at 1280", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/start",
      { forcedColors: "active" },
    );
    try {
      const buttonText = await systemColor(
        page,
        "borderLeftColor",
        "ButtonText",
      );
      const nav = page.locator(".area-nav a[aria-current='page']");
      const style = await nav.evaluate((node) => {
        const computed = globalThis.getComputedStyle(node);
        return {
          borderLeftWidth: computed.borderLeftWidth,
          borderLeftColor: computed.borderLeftColor,
          borderTopWidth: computed.borderTopWidth,
          boxShadow: computed.boxShadow,
        };
      });
      assert.equal(style.borderLeftWidth, "3px");
      assert.equal(style.borderLeftColor, buttonText);
      assert.equal(style.borderTopWidth, "0px");
      const specified = await stylesCssUses(
        page,
        '.area-nav a[aria-current="page"]',
        "border-left",
        "ButtonText",
        "styles.css",
      );
      assert.ok(
        specified.length > 0,
        "wide forced-colours nav bar is not a border",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("forced colours paint the start-card inset with a ButtonText border", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/start",
      { forcedColors: "active" },
    );
    try {
      const buttonText = await systemColor(
        page,
        "borderTopColor",
        "ButtonText",
      );
      const card = page.locator(".start-card[aria-current='true']");
      const style = await card.evaluate((node) => {
        const computed = globalThis.getComputedStyle(node);
        return {
          borderTopWidth: computed.borderTopWidth,
          borderRightWidth: computed.borderRightWidth,
          borderBottomWidth: computed.borderBottomWidth,
          borderLeftWidth: computed.borderLeftWidth,
          borderTopColor: computed.borderTopColor,
        };
      });
      assert.equal(style.borderTopWidth, "2px");
      assert.equal(style.borderRightWidth, "2px");
      assert.equal(style.borderBottomWidth, "2px");
      assert.equal(style.borderLeftWidth, "2px");
      assert.equal(style.borderTopColor, buttonText);
      const specified = await stylesCssUses(
        page,
        '.start-card[aria-current="true"]',
        "border-width",
        "2px",
        "styles.css",
      );
      assert.ok(
        specified.length > 0,
        "forced-colours start-card inset is not a 2px border",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("forced colours paint the header share icon with ButtonText at 360", async () => {
    const { context, page, errors } = await open(360, "100%", "#character", {
      forcedColors: "active",
    });
    try {
      const buttonText = await systemColor(
        page,
        "backgroundColor",
        "ButtonText",
      );
      const icon = await page
        .locator(".simulator-header .share-button")
        .evaluate((node) => {
          const computed = globalThis.getComputedStyle(node, "::before");
          return {
            backgroundColor: computed.backgroundColor,
            width: computed.width,
            height: computed.height,
            content: computed.content,
          };
        });
      assert.notEqual(icon.content, "none");
      assert.ok(parseFloat(icon.width) > 0, "share icon has a width");
      assert.equal(icon.backgroundColor, buttonText);
      const specified = await stylesCssUses(
        page,
        ".simulator-header .share-button::before",
        "background-color",
        "ButtonText",
        "styles.css",
      );
      assert.ok(
        specified.length > 0,
        "forced-colours share icon is not ButtonText",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("reduced motion leaves the leftover chrome in place", async () => {
    const { context, page, errors } = await open(1280, "100%", "#fight", {
      reducedMotion: true,
    });
    try {
      const pill = await page.evaluate(() => {
        const node = globalThis.document.querySelector(
          ".run-mode-pill input:checked + span",
        );
        const style = globalThis.getComputedStyle(node);
        return {
          display: style.display,
          borderStyle: style.borderStyle,
        };
      });
      assert.notEqual(pill.display, "none");
      assert.notEqual(pill.borderStyle, "none");
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
