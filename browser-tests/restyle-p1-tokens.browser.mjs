// Restyle C, phase 1: C tokens, self-hosted Cinzel on headings, and
// Fran's 360 / 150% wrap check. Do not pin Cinzel (or DejaVu) in
// metric-stable asserts; assert tokens, font load, and wrapping.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const SCREEN_HEIGHT = 900;
const PHONE = 360;
const TEXT = ["100%", "150%"];
const SLACK = 1;
const ROUTES = [
  "#character",
  "#character/start",
  "#character/gear",
  "#character/stats",
  "#character/talents",
  "#rotation",
  "#rotation/share",
  "#fight",
  "#results",
  "#results/weights",
];
const HEADINGS =
  "h1, .app-title, .area-title, h2, .start-title, .eyebrow, legend";
const TOKENS = {
  "--page": "#100f0c",
  "--text": "#f3eee2",
  "--error": "#f19389",
  "--surface": "#171510",
  "--surface-raised": "#211d16",
  "--border": "#403728",
  "--text-muted": "#a99d86",
  "--accent": "#e8c547",
  "--header": "#e8c547",
  "--trim": "#e8c547",
  "--focus": "#e8c547",
  "--tooltip-bg": "#11100e",
  "--energy": "#f0c44e",
  "--gcd": "#c99b3b",
  "--control-border": "#7d6c50",
  "--q-poor": "#9d9d9d",
  "--q-common": "#ffffff",
  "--q-uncommon": "#1eff00",
  "--q-rare": "#4ea0ff",
  "--q-epic": "#c86cff",
  "--q-legendary": "#ff8000",
  "--q-artifact": "#e6cc80",
  "--q-heirloom": "#00ccff",
};
const ALIASES = {
  "--raised": "--surface-raised",
  "--muted": "--text-muted",
  "--control": "--control-border",
};

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

async function open(width, text, hash = "#character") {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
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
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    await Promise.all([
      globalThis.document.fonts.load("600 1rem Cinzel"),
      globalThis.document.fonts.load("700 1.25rem Cinzel"),
    ]);
  });
  return { context, page, errors };
}

describe("restyle C phase 1 tokens and heading font", () => {
  test("C tokens and aliases are on :root", async () => {
    const { context, page, errors } = await open(1280, "100%");
    try {
      const found = await page.evaluate(
        (names) => {
          const root = globalThis.getComputedStyle(
            globalThis.document.documentElement,
          );
          const values = {};
          for (const name of names) {
            values[name] = root.getPropertyValue(name).trim();
          }
          return values;
        },
        [
          ...Object.keys(TOKENS),
          ...Object.keys(ALIASES),
          "--font-display",
          "--font-ui",
          "--radius-panel",
        ],
      );
      for (const [name, hex] of Object.entries(TOKENS)) {
        assert.equal(found[name].toLowerCase(), hex, name);
      }
      const aliases = await page.evaluate((pairs) => {
        const probe = globalThis.document.createElement("div");
        globalThis.document.body.append(probe);
        const miss = [];
        for (const [alias, source] of Object.entries(pairs)) {
          probe.style.color = `var(${alias})`;
          const fromAlias = globalThis.getComputedStyle(probe).color;
          probe.style.color = `var(${source})`;
          const fromSource = globalThis.getComputedStyle(probe).color;
          if (fromAlias !== fromSource) {
            miss.push(`${alias} ${fromAlias} != ${source} ${fromSource}`);
          }
        }
        probe.remove();
        return miss;
      }, ALIASES);
      assert.deepEqual(aliases, []);
      assert.match(found["--font-display"], /Cinzel/i);
      assert.match(found["--font-display"], /Palatino/);
      assert.match(found["--font-display"], /Georgia/);
      assert.match(found["--font-ui"], /Inter/);
      assert.equal(found["--radius-panel"], "14px");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Cinzel 600 and 700 load with font-display swap", async () => {
    const { context, page, errors } = await open(1280, "100%");
    try {
      const fonts = await page.evaluate((selector) => {
        const familyOf = (name) =>
          String(name)
            .replace(/^["']|["']$/g, "")
            .toLowerCase();
        const registered = [...globalThis.document.fonts].map((face) => ({
          family: familyOf(face.family),
          weight: String(face.weight),
          status: face.status,
        }));
        const loaded = {
          w600: globalThis.document.fonts.check("600 1rem Cinzel"),
          w700: globalThis.document.fonts.check("700 1.25rem Cinzel"),
          registered,
        };
        const faces = [];
        for (const sheet of globalThis.document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (rule.type === globalThis.CSSRule.FONT_FACE_RULE) {
              faces.push({
                family: String(rule.style.getPropertyValue("font-family")),
                weight: String(rule.style.getPropertyValue("font-weight")),
                display: String(rule.style.getPropertyValue("font-display")),
                src: String(rule.style.getPropertyValue("src")),
              });
            }
          }
        }
        const visible = (node) => {
          if (node.closest(".visually-hidden, [hidden]")) {
            return false;
          }
          const style = globalThis.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") {
            return false;
          }
          const box = node.getBoundingClientRect();
          return box.width > 2 && box.height > 2;
        };
        const headings = [...globalThis.document.querySelectorAll(selector)]
          .filter(visible)
          .map((node) => ({
            name: node.className || node.tagName,
            family: globalThis.getComputedStyle(node).fontFamily,
            weight: globalThis.getComputedStyle(node).fontWeight,
          }));
        const gold = [
          ".area-title",
          ".app-title",
          ".eyebrow",
          ".start-title",
          "legend",
        ];
        const labelled = gold
          .flatMap((sel) => [...globalThis.document.querySelectorAll(sel)])
          .filter(visible)
          .map((node) => ({
            name: node.className || node.tagName,
            color: globalThis.getComputedStyle(node).color,
          }));
        return { loaded, faces, headings, labelled };
      }, HEADINGS);
      assert.equal(fonts.loaded.w600, true, "Cinzel 600 did not load");
      assert.equal(fonts.loaded.w700, true, "Cinzel 700 did not load");
      const registered = fonts.loaded.registered.filter(
        (face) => face.family === "cinzel",
      );
      assert.ok(
        registered.some(
          (face) => face.weight === "600" && face.status === "loaded",
        ),
        registered,
      );
      assert.ok(
        registered.some(
          (face) => face.weight === "700" && face.status === "loaded",
        ),
        registered,
      );
      const cinzel = fonts.faces.filter(
        (face) =>
          String(face.family)
            .replace(/^["']|["']$/g, "")
            .toLowerCase() === "cinzel",
      );
      assert.ok(cinzel.length >= 2, `font-face count ${cinzel.length}`);
      for (const face of cinzel) {
        assert.equal(face.display, "swap", face);
        assert.match(face.src, /fonts\/cinzel-latin-(600|700)\.woff2/);
      }
      const weights = new Set(cinzel.map((face) => face.weight));
      assert.ok(weights.has("600"), weights);
      assert.ok(weights.has("700"), weights);
      assert.ok(fonts.headings.length > 0, "no visible headings");
      const header = await page.evaluate(() => {
        const probe = globalThis.document.createElement("div");
        probe.style.color = "var(--header)";
        globalThis.document.body.append(probe);
        const color = globalThis.getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      for (const heading of fonts.headings) {
        assert.match(heading.family, /Cinzel/i, heading.name);
        assert.ok(
          heading.weight === "600" || heading.weight === "700",
          `${heading.name} weight ${heading.weight}`,
        );
      }
      assert.ok(fonts.labelled.length > 0, "no visible section labels");
      for (const label of fonts.labelled) {
        assert.equal(label.color, header, label.name);
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  for (const text of TEXT) {
    test(`headings do not overflow at ${PHONE} and ${text} text`, async () => {
      const { context, page, errors } = await open(PHONE, text, ROUTES[0]);
      try {
        const failures = [];
        for (const hash of ROUTES) {
          await page.evaluate((route) => {
            globalThis.location.hash = route;
          }, hash);
          await page.waitForFunction(() => globalThis.__store != null);
          await page.evaluate(async () => {
            await globalThis.document.fonts.ready;
          });
          const report = await page.evaluate(
            ({ selector, slack }) => {
              const doc = globalThis.document.documentElement;
              const sideways = doc.scrollWidth - doc.clientWidth;
              const cuts = [];
              const spills = [];
              const visible = (node) => {
                if (node.closest(".visually-hidden, [hidden]")) {
                  return false;
                }
                const style = globalThis.getComputedStyle(node);
                if (style.display === "none" || style.visibility === "hidden") {
                  return false;
                }
                const box = node.getBoundingClientRect();
                return box.width > 2 && box.height > 2;
              };
              for (const node of doc.querySelectorAll(selector)) {
                if (!visible(node)) {
                  continue;
                }
                const cut = node.scrollWidth - node.clientWidth;
                if (cut > slack) {
                  cuts.push({
                    name: node.className || node.tagName,
                    text: (node.textContent ?? "").trim(),
                    cut,
                  });
                }
                const box = node.getBoundingClientRect();
                if (box.right > doc.clientWidth + slack || box.left < -slack) {
                  spills.push({
                    name: node.className || node.tagName,
                    text: (node.textContent ?? "").trim(),
                    left: box.left,
                    right: box.right,
                    width: doc.clientWidth,
                  });
                }
              }
              return { hash: globalThis.location.hash, sideways, cuts, spills };
            },
            { selector: HEADINGS, slack: SLACK },
          );
          if (report.sideways > SLACK) {
            failures.push(`${report.hash} sideways ${report.sideways}`);
          }
          for (const cut of report.cuts) {
            failures.push(
              `${report.hash} clipped ${cut.name} "${cut.text}" by ${cut.cut}`,
            );
          }
          for (const spill of report.spills) {
            failures.push(
              `${report.hash} spilled ${spill.name} "${spill.text}" ${spill.left}–${spill.right} in ${spill.width}`,
            );
          }
        }
        assert.deepEqual(failures, []);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    });
  }
});
