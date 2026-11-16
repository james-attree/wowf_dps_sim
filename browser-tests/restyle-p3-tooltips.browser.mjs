// Restyle C, phase 3 (#393): shared .wow-tooltip well on --tooltip-bg with
// a gold or quality edge, --q-* lookalike colours, and the quality named
// in text so colour is never the only cue (Q4). Existing <details> stay
// in the DOM. 360, 1024 and 1280 at 100% and 150% text; axe on the
// screens this phase touches. Do not pin exact pixels for typography.
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
const ROUTES = ["#character/gear", "#character/talents"];
const QUALITY_WORDS = [
  "Poor",
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Artifact",
  "Heirloom",
];
const QUALITY_CLASSES = QUALITY_WORDS.map((name) => `q-${name.toLowerCase()}`);
const CANONICAL_RARE = "#0070dd";
const CANONICAL_EPIC = "#a335ee";

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
  hash = "#character/gear",
  { reducedMotion } = {},
) {
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
          const value = rule.style.getPropertyValue(property);
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

describe("restyle C phase 3 tooltips and quality colours", () => {
  test("the shared well uses --tooltip-bg and a gold --trim edge", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/gear",
    );
    try {
      await page.selectOption("#cfg-poisons-mainHand", "instant");
      await page.locator("#cfg-poisons-mainHand-tooltip").evaluate((node) => {
        node.open = true;
      });
      const bg = await tokenColor(page, "--tooltip-bg");
      const trim = await tokenColor(page, "--trim");
      const poison = await page.evaluate(() => {
        const text = globalThis.document.getElementById(
          "cfg-poisons-mainHand-tooltip-text",
        );
        const style = globalThis.getComputedStyle(text);
        return {
          className: text.className,
          background: style.backgroundColor,
          border: style.borderTopColor,
          details: globalThis.document.getElementById(
            "cfg-poisons-mainHand-tooltip",
          ).tagName,
        };
      });
      assert.match(poison.className, /\bwow-tooltip\b/);
      assert.equal(poison.details, "DETAILS");
      assert.equal(poison.background, bg);
      assert.equal(poison.border, trim);

      await page.evaluate(() => {
        globalThis.location.hash = "#character/talents";
      });
      await page.waitForFunction(() => globalThis.__store != null);
      const talent = await page.evaluate(() => {
        const pane = globalThis.document.getElementById("talents-detail");
        const style = globalThis.getComputedStyle(pane);
        return {
          className: pane.className,
          background: style.backgroundColor,
          border: style.borderTopColor,
        };
      });
      assert.match(talent.className, /\bwow-tooltip\b/);
      assert.equal(talent.background, bg);
      assert.equal(talent.border, trim);

      const bgRule = await stylesCssUses(
        page,
        ".wow-tooltip",
        "background",
        "var(--tooltip-bg)",
      );
      const edgeRule = await stylesCssUses(
        page,
        ".wow-tooltip",
        "border",
        "var(--trim)",
      );
      assert.ok(bgRule.length > 0, "well background is not --tooltip-bg");
      assert.ok(edgeRule.length > 0, "well edge is not --trim");

      const leak = await page.evaluate(() => {
        const text = globalThis.document.getElementById(
          "cfg-poisons-mainHand-tooltip-text",
        );
        const details = globalThis.document.getElementById(
          "cfg-poisons-mainHand-tooltip",
        );
        const summary = details.querySelector("summary");
        const other = globalThis.document.querySelector(
          ".site-footer p, .field-help, p.talent-detail-empty",
        );
        const well = globalThis.getComputedStyle(text);
        const summaryStyle = globalThis.getComputedStyle(summary);
        const otherStyle = other ? globalThis.getComputedStyle(other) : null;
        return {
          wellRadius: well.borderTopLeftRadius,
          summaryBg: summaryStyle.backgroundColor,
          summaryBorder: summaryStyle.borderTopColor,
          summaryTag: summary.tagName,
          otherBg: otherStyle?.backgroundColor ?? null,
          otherBorder: otherStyle?.borderTopColor ?? null,
          otherTag: other?.tagName ?? null,
        };
      });
      assert.equal(leak.wellRadius, "12px");
      assert.notEqual(leak.summaryBg, bg, "summary has the tooltip well");
      assert.notEqual(leak.summaryBorder, trim, "summary has the gold edge");
      assert.equal(leak.summaryTag, "SUMMARY");
      if (leak.otherBg !== null) {
        assert.notEqual(leak.otherBg, bg, "a non-tooltip p has the well");
      }
      const radiusRule = await stylesCssUses(
        page,
        ".wow-tooltip",
        "border-radius",
        "12px",
      );
      assert.ok(radiusRule.length > 0, "well radius is not 12px");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("quality colours use lookalike tokens and are named in text", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/gear",
    );
    try {
      const tokens = {
        rare: await tokenColor(page, "--q-rare"),
        epic: await tokenColor(page, "--q-epic"),
        uncommon: await tokenColor(page, "--q-uncommon"),
        muted: await tokenColor(page, "--text-muted"),
      };
      const painted = await page.evaluate(() => {
        const well = globalThis.document.createElement("div");
        well.className = "wow-tooltip";
        well.dataset.quality = "epic";
        well.innerHTML = [
          '<p class="wow-tooltip-name q-epic">Shadowcraft Tunic <span class="wow-tooltip-quality">(Epic)</span></p>',
          '<p class="wow-tooltip-bind">Binds when picked up</p>',
          '<p class="wow-tooltip-slot">Chest</p>',
          '<p class="wow-tooltip-armour">Leather</p>',
          '<p class="wow-tooltip-stats">+15 Agility</p>',
          '<p class="wow-tooltip-set">Shadowcraft Armor (set)</p>',
          '<p class="wow-tooltip-requires">Requires Level 60</p>',
          '<p class="wow-tooltip-enchant">+15 Agility (enchant)</p>',
        ].join("");
        globalThis.document.body.append(well);
        const colorOf = (sel) =>
          globalThis.getComputedStyle(well.querySelector(sel)).color;
        const out = {
          text: well.textContent,
          name: colorOf(".wow-tooltip-name"),
          quality: colorOf(".wow-tooltip-quality"),
          bind: colorOf(".wow-tooltip-bind"),
          slot: colorOf(".wow-tooltip-slot"),
          armour: colorOf(".wow-tooltip-armour"),
          stats: colorOf(".wow-tooltip-stats"),
          set: colorOf(".wow-tooltip-set"),
          requires: colorOf(".wow-tooltip-requires"),
          enchant: colorOf(".wow-tooltip-enchant"),
          edge: globalThis.getComputedStyle(well).borderTopColor,
        };
        well.remove();
        return out;
      });
      assert.match(painted.text, /Epic/);
      assert.equal(painted.name, tokens.epic);
      assert.equal(painted.quality, tokens.muted);
      assert.equal(painted.edge, tokens.epic);
      for (const key of [
        "bind",
        "slot",
        "armour",
        "stats",
        "set",
        "requires",
        "enchant",
      ]) {
        assert.equal(painted[key], tokens.uncommon, key);
      }

      const rareName = await stylesCssUses(
        page,
        ".q-rare",
        "color",
        "var(--q-rare)",
      );
      const epicName = await stylesCssUses(
        page,
        ".q-epic",
        "color",
        "var(--q-epic)",
      );
      const epicEdge = await stylesCssUses(
        page,
        '.wow-tooltip[data-quality="epic"]',
        "border-color",
        "var(--q-epic)",
      );
      assert.ok(rareName.length > 0, ".q-rare is not --q-rare");
      assert.ok(epicName.length > 0, ".q-epic is not --q-epic");
      assert.ok(epicEdge.length > 0, "epic edge is not --q-epic");

      const cssText = await page.evaluate(() =>
        [...globalThis.document.styleSheets]
          .flatMap((sheet) => {
            try {
              return [...sheet.cssRules].map((rule) => rule.cssText);
            } catch {
              return [];
            }
          })
          .join("\n")
          .toLowerCase(),
      );
      assert.doesNotMatch(cssText, new RegExp(CANONICAL_RARE, "i"));
      assert.doesNotMatch(cssText, new RegExp(CANONICAL_EPIC, "i"));

      const unnamed = await page.evaluate((classes) => {
        const selector = classes.map((name) => `.${name}`).join(", ");
        const words = [
          "Poor",
          "Common",
          "Uncommon",
          "Rare",
          "Epic",
          "Legendary",
          "Artifact",
          "Heirloom",
        ];
        return [...globalThis.document.querySelectorAll(selector)]
          .filter((node) => {
            const root = node.closest(".wow-tooltip") ?? node;
            return !words.some((word) =>
              new RegExp(`\\b${word}\\b`, "i").test(root.textContent),
            );
          })
          .map((node) => node.outerHTML);
      }, QUALITY_CLASSES);
      assert.deepEqual(
        unnamed,
        [],
        "quality colour used without a quality word",
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("talent and poison names carry no quality colour", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/gear",
    );
    try {
      const qualities = {
        poor: await tokenColor(page, "--q-poor"),
        common: await tokenColor(page, "--q-common"),
        uncommon: await tokenColor(page, "--q-uncommon"),
        rare: await tokenColor(page, "--q-rare"),
        epic: await tokenColor(page, "--q-epic"),
        legendary: await tokenColor(page, "--q-legendary"),
        artifact: await tokenColor(page, "--q-artifact"),
        heirloom: await tokenColor(page, "--q-heirloom"),
      };
      await page.selectOption("#cfg-poisons-mainHand", "instant");
      await page.locator("#cfg-poisons-mainHand-tooltip").evaluate((node) => {
        node.open = true;
      });
      await page.evaluate(() => {
        globalThis.location.hash = "#character/talents";
      });
      await page.waitForFunction(() => globalThis.__store != null);
      const talent = page.locator(".talent").filter({ visible: true }).first();
      if ((await talent.count()) > 0) {
        await talent.click();
      }
      const painted = await page.evaluate((tokens) => {
        const names = [
          globalThis.document.getElementById("cfg-poisons-mainHand"),
          globalThis.document.getElementById(
            "cfg-poisons-mainHand-tooltip-text",
          ),
          globalThis.document.getElementById("talents-detail-heading"),
        ].filter(Boolean);
        const qualityValues = Object.values(tokens);
        return names.map((node) => {
          const color = globalThis.getComputedStyle(node).color;
          return {
            id: node.id,
            className: node.className,
            color,
            qualityClass:
              /\bq-(?:poor|common|uncommon|rare|epic|legendary|artifact|heirloom)\b/.test(
                node.className,
              ),
            qualityColor: qualityValues.includes(color),
          };
        });
      }, qualities);
      assert.ok(painted.length >= 2, "missing poison or talent name");
      for (const node of painted) {
        assert.equal(node.qualityClass, false, `${node.id} has a q-* class`);
        assert.equal(
          node.qualityColor,
          false,
          `${node.id} is painted in a quality colour`,
        );
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("a poison tooltip is not a keyboard trap and keeps its details", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/gear",
    );
    try {
      await page.selectOption("#cfg-poisons-mainHand", "instant");
      const details = page.locator("#cfg-poisons-mainHand-tooltip");
      await details.locator("summary").focus();
      await page.keyboard.press("Enter");
      const opened = await details.evaluate((node) => node.open);
      assert.equal(opened, true);
      const before = await page.evaluate(
        () => globalThis.document.activeElement?.id ?? "",
      );
      await page.keyboard.press("Tab");
      const afterTab = await page.evaluate(
        () => globalThis.document.activeElement?.id ?? "",
      );
      assert.notEqual(afterTab, before);
      assert.notEqual(afterTab, "cfg-poisons-mainHand-tooltip");
      const tag = await details.evaluate((node) => node.tagName);
      assert.equal(tag, "DETAILS");
      const summary = await details.locator("summary").textContent();
      assert.equal(summary.trim(), "Tooltip text");
      const size = await details.locator("summary").evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      assert.ok(size.height + SLACK >= TARGET, `summary height ${size.height}`);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("reduced motion leaves the tooltip well in place", async () => {
    const { context, page, errors } = await open(
      1280,
      "100%",
      "#character/gear",
      {
        reducedMotion: true,
      },
    );
    try {
      await page.selectOption("#cfg-poisons-mainHand", "instant");
      await page.locator("#cfg-poisons-mainHand-tooltip").evaluate((node) => {
        node.open = true;
      });
      const motion = await page.evaluate(() => {
        const text = globalThis.document.getElementById(
          "cfg-poisons-mainHand-tooltip-text",
        );
        const style = globalThis.getComputedStyle(text);
        return {
          display: style.display,
          animation: style.animationName,
          transition: style.transitionDuration,
        };
      });
      assert.notEqual(motion.display, "none");
      assert.ok(
        motion.animation === "none" || motion.animation === "",
        motion.animation,
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  for (const width of WIDTHS) {
    for (const text of TEXT) {
      test(`no sideways scroll and axe-clean at ${width} and ${text} text`, async () => {
        const { context, page, errors } = await open(
          width,
          text,
          "#character/gear",
        );
        try {
          const failures = [];
          await page.selectOption("#cfg-poisons-mainHand", "instant");
          await page
            .locator("#cfg-poisons-mainHand-tooltip")
            .evaluate((node) => {
              node.open = true;
            });
          for (const hash of ROUTES) {
            await page.evaluate((route) => {
              globalThis.location.hash = route;
            }, hash);
            await page.waitForFunction(() => globalThis.__store != null);
            if (hash === "#character/talents") {
              const talent = page
                .locator(".talent")
                .filter({ visible: true })
                .first();
              if ((await talent.count()) > 0) {
                await talent.click();
              }
            }
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
