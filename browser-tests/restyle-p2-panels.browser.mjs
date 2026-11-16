// Restyle C, phase 2 (#392): panels and buttons keep today's radii and
// padding, focus uses --focus, hover/current edges may use --trim, and
// armed stays distinct from focus. 360, 1024 and 1280 at 100% and 150%
// text; axe on the screens this phase touches. Do not pin exact pixels
// for typography.
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
const TARGET = 44;
const SWITCH_MIN = 100;
const ROUTES = [
  "#character",
  "#character/start",
  "#character/talents",
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

async function open(
  width,
  text,
  hash = "#character",
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

async function tokenColor(page, name) {
  return page.evaluate((token) => {
    const probe = globalThis.document.createElement("div");
    probe.style.color = `var(${token})`;
    globalThis.document.body.append(probe);
    const color = globalThis.getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
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

async function cssUses(page, selector, property, token) {
  return page.evaluate(
    ({ selector, property, token }) => {
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
          if (!rule.selectorText.includes(selector)) {
            continue;
          }
          const value =
            rule.style.getPropertyValue(property) ||
            rule.style.getPropertyValue("outline") ||
            "";
          if (value.includes(token)) {
            found.push(value);
          }
        }
      };
      for (const sheet of globalThis.document.styleSheets) {
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
    { selector, property, token },
  );
}

async function stylesCssUses(page, selector, property, token) {
  return page.evaluate(
    ({ selector, property, token }) => {
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
          const value =
            rule.style.getPropertyValue(property) ||
            rule.style.getPropertyValue("outline") ||
            "";
          if (value.includes(token)) {
            found.push(value);
          }
        }
      };
      for (const sheet of globalThis.document.styleSheets) {
        const href = sheet.href ?? "";
        if (!href.endsWith("styles.css")) {
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
    { selector, property, token },
  );
}

describe("restyle C phase 2 panels and buttons", () => {
  test("focus rings use --focus and stay when a slot is armed", async () => {
    const { context, page, errors } = await open(1280, "100%", "#fight");
    try {
      const focus = await tokenColor(page, "--focus");
      await page.locator("#run-button").press("Tab");
      await page.locator("#run-button").press("Shift+Tab");
      const run = await page.evaluate(() => {
        const btn = globalThis.document.getElementById("run-button");
        return {
          focused: btn.matches(":focus-visible, :focus"),
          outlineColor: globalThis.getComputedStyle(btn).outlineColor,
        };
      });
      if (!run.focused) {
        await page.locator("#run-button").focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
      }
      const runOutline = await page.evaluate(
        () =>
          globalThis.getComputedStyle(
            globalThis.document.getElementById("run-button"),
          ).outlineColor,
      );
      assert.equal(runOutline, focus);
      const focusRules = await cssUses(
        page,
        ":focus-visible",
        "outline",
        "var(--focus)",
      );
      assert.ok(focusRules.length > 0, "no :focus-visible rule uses --focus");
      const runFocus = await stylesCssUses(
        page,
        ".run-button:focus-visible",
        "outline",
        "var(--focus)",
      );
      assert.ok(
        runFocus.length > 0,
        "styles.css Run focus is not the --focus token",
      );

      const armed = await page.evaluate(() => {
        const node = globalThis.document.createElement("button");
        node.className = "manual-slot is-armed";
        node.type = "button";
        node.textContent = "Probe";
        globalThis.document.body.append(node);
        node.focus();
        const style = globalThis.getComputedStyle(node);
        const out = {
          outlineStyle: style.outlineStyle,
          outlineColor: style.outlineColor,
          borderTopWidth: style.borderTopWidth,
          boxShadow: style.boxShadow,
        };
        node.remove();
        return out;
      });
      assert.notEqual(armed.outlineStyle, "none");
      assert.equal(armed.outlineColor, focus);
      assert.equal(armed.borderTopWidth, "3px");
      assert.match(armed.boxShadow, /inset/);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("forced colours map Run's focus ring to ButtonText", async () => {
    const { context, page, errors } = await open(1280, "100%", "#fight", {
      forcedColors: "active",
    });
    try {
      await page.locator("#run-button").press("Tab");
      await page.locator("#run-button").press("Shift+Tab");
      const run = await page.evaluate(() => {
        const btn = globalThis.document.getElementById("run-button");
        if (!btn.matches(":focus-visible, :focus")) {
          btn.focus();
        }
        return {
          focused: btn.matches(":focus-visible, :focus"),
          outlineColor: globalThis.getComputedStyle(btn).outlineColor,
          outlineStyle: globalThis.getComputedStyle(btn).outlineStyle,
        };
      });
      if (!run.focused) {
        await page.locator("#run-button").focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
      }
      const colors = await page.evaluate(() => {
        const btn = globalThis.document.getElementById("run-button");
        const probe = globalThis.document.createElement("div");
        probe.style.outlineColor = "ButtonText";
        globalThis.document.body.append(probe);
        const buttonText = globalThis.getComputedStyle(probe).outlineColor;
        probe.remove();
        return {
          outlineColor: globalThis.getComputedStyle(btn).outlineColor,
          outlineStyle: globalThis.getComputedStyle(btn).outlineStyle,
          buttonText,
        };
      });
      assert.notEqual(colors.outlineStyle, "none");
      assert.equal(colors.outlineColor, colors.buttonText);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("forced colours map the armed border to Mark", async () => {
    const { context, page, errors } = await open(1280, "100%", "#fight", {
      forcedColors: "active",
    });
    try {
      const armed = await page.evaluate(() => {
        const node = globalThis.document.createElement("button");
        node.className = "manual-slot is-armed";
        node.type = "button";
        node.textContent = "Probe";
        globalThis.document.body.append(node);
        const style = globalThis.getComputedStyle(node);
        const probe = globalThis.document.createElement("div");
        probe.style.borderColor = "Mark";
        globalThis.document.body.append(probe);
        const mark = globalThis.getComputedStyle(probe).borderTopColor;
        const out = {
          borderColor: style.borderTopColor,
          borderWidth: style.borderTopWidth,
          mark,
        };
        node.remove();
        probe.remove();
        return out;
      });
      assert.equal(armed.borderWidth, "3px");
      assert.equal(armed.borderColor, armed.mark);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("hover and current edges use --trim", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/start",
    );
    try {
      const trim = await tokenColor(page, "--trim");
      const pill = page.locator(".pill-button").first();
      await pill.hover();
      const pillBorder = await pill.evaluate(
        (node) => globalThis.getComputedStyle(node).borderTopColor,
      );
      assert.equal(pillBorder, trim, "pill hover");
      const trimHover = await cssUses(
        page,
        ".pill-button:hover",
        "border-color",
        "var(--trim)",
      );
      assert.ok(trimHover.length > 0, "pill hover is not --trim");
      const trimCurrent = await cssUses(
        page,
        "aria-current",
        "box-shadow",
        "var(--trim)",
      );
      assert.ok(trimCurrent.length > 0, "current edge is not --trim");

      const currentNav = page.locator(".area-nav a[aria-current='page']");
      const navShadow = await currentNav.evaluate(
        (node) => globalThis.getComputedStyle(node).boxShadow,
      );
      assert.match(navShadow, /[0-9]/);
      const navUsesTrim = await currentNav.evaluate((node) => {
        const probe = globalThis.document.createElement("div");
        probe.style.boxShadow = "inset 3px 0 0 var(--trim)";
        globalThis.document.body.append(probe);
        const want = globalThis.getComputedStyle(probe).boxShadow;
        probe.remove();
        return globalThis.getComputedStyle(node).boxShadow === want;
      });
      assert.equal(navUsesTrim, true, "nav current bar");

      const card = page.locator(".start-card").first();
      await card.hover();
      const cardBorder = await card.evaluate(
        (node) => globalThis.getComputedStyle(node).borderTopColor,
      );
      assert.equal(cardBorder, trim, "start card hover");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("the result switch stays a wrapping pill bar of at least 100 by 44", async () => {
    const { context, page, errors } = await open(360, "150%", "#results");
    try {
      const metrics = await page.evaluate(() => {
        const bar = globalThis.document.querySelector(".result-switch");
        const style = globalThis.getComputedStyle(bar);
        const links = [...bar.querySelectorAll(".result-switch-link")].map(
          (link) => {
            const box = link.getBoundingClientRect();
            const cs = globalThis.getComputedStyle(link);
            return {
              width: box.width,
              height: box.height,
              minWidth: cs.minWidth,
              minHeight: cs.minHeight,
              radius: cs.borderRadius,
            };
          },
        );
        return {
          wrap: style.flexWrap,
          radius: style.borderRadius,
          links,
        };
      });
      assert.equal(metrics.wrap, "wrap");
      assert.ok(metrics.links.length > 0, "no switch links");
      for (const link of metrics.links) {
        assert.ok(link.width + SLACK >= SWITCH_MIN, `width ${link.width}`);
        assert.ok(link.height + SLACK >= TARGET, `height ${link.height}`);
        assert.equal(link.radius, "999px");
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("panels keep a 14px radius", async () => {
    const { context, page, errors } = await open(1280, "100%", "#character");
    try {
      const radii = await page.evaluate(() => {
        const panel = globalThis.document.querySelector(".panel");
        const run = globalThis.document.querySelector(".run-controls");
        const token = globalThis
          .getComputedStyle(globalThis.document.documentElement)
          .getPropertyValue("--radius-panel")
          .trim();
        return {
          token,
          panel: globalThis.getComputedStyle(panel).borderRadius,
          run: globalThis.getComputedStyle(run).borderRadius,
        };
      });
      assert.equal(radii.token, "14px");
      assert.equal(radii.panel, radii.token);
      assert.equal(radii.run, radii.token);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("reduced motion turns off looping motion and meter transitions", async () => {
    const { context, page, errors } = await open(1280, "100%", "#fight", {
      reducedMotion: true,
    });
    try {
      const motion = await page.evaluate(() => {
        const wrap = globalThis.document.createElement("div");
        wrap.className = "manual-energy";
        const fill = globalThis.document.createElement("div");
        fill.className = "energy-fill";
        wrap.append(fill);
        const floatEl = globalThis.document.createElement("div");
        floatEl.className = "manual-float";
        globalThis.document.body.append(wrap, floatEl);
        const fillStyle = globalThis.getComputedStyle(fill);
        const floatStyle = globalThis.getComputedStyle(floatEl);
        const out = {
          fillTransition: fillStyle.transitionDuration,
          floatAnimation: floatStyle.animationName,
          floatDisplay: floatStyle.display,
        };
        wrap.remove();
        floatEl.remove();
        return out;
      });
      const snapped = motion.fillTransition
        .replace(/\s/g, "")
        .split(",")
        .every((part) => {
          if (part === "0s" || part === "none") {
            return true;
          }
          const ms = Number.parseFloat(part);
          return Number.isFinite(ms) && ms <= 0.0001;
        });
      assert.equal(snapped, true, motion.fillTransition);
      assert.ok(
        motion.floatAnimation === "none" || motion.floatDisplay === "none",
        motion,
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
