// The 44px target audit (#245, UX7; WCAG 2.5.5): on every screen, at each
// width Fran checks, every shown button, link, field, disclosure and check
// row is at least 44 by 44 where a pointer or a finger lands on it. A radio
// or a check box lands on its label, a visually hidden input on the label
// that names it, and a link with an absolutely placed ::after on the box
// that reaches. Each screen is also run through axe (WCAG 2 A and AA, 2.1,
// 2.2 and best practice), before a run, after a batch and after a Watch.
// Fonts are pinned to DejaVu Sans, CI's and the widest of the ones we test.
// `npm run test:browser`; Chrome as in the other files.
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
const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONT_CSS = ':root { font-family: "DejaVu Sans" !important; }';
const SHOTS = process.env.SHOTS_DIR ?? null;
// The least a target may be, each way (styles.css --target).
const TARGET = 44;
// Half a pixel of rounding either way.
const SLACK = 0.5;
const SIZES = [
  [1440, 900],
  [1280, 900],
  [1024, 768],
  [390, 844],
  [360, 640],
];
const SCREENS = [
  "#character",
  "#character/gear",
  "#character/stats",
  "#character/talents",
  "#rotation",
  "#rotation/rule/2",
  "#rotation/share",
  "#fight",
  "#results",
  "#results/live",
];
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];
const BATCH_FIGHTS = "5";
const FIGHT_SECONDS = "4";
const RUN_TIMEOUT = 60_000;
// Time for a screen's own scroll and focus moves to settle.
const SETTLE_MS = 150;

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

// Each shown target smaller than `least` either way, as "what: w×h".
function smallTargets(least) {
  const doc = globalThis.document;
  const TARGETS = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='tab']",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");
  const landsOn = (control) => {
    if (control.tagName !== "INPUT") {
      return control;
    }
    const label =
      control.closest("label") ??
      (control.id ? doc.querySelector(`label[for="${control.id}"]`) : null);
    const own = control.getBoundingClientRect();
    const tiny = own.width <= 1 || own.height <= 1;
    const check = control.type === "radio" || control.type === "checkbox";
    return label && (check || tiny) ? label : control;
  };
  const reach = (box, control) => {
    const after = globalThis.getComputedStyle(control, "::after");
    if (after.content === "none" || after.position !== "absolute") {
      return box;
    }
    const out = (side) => Math.max(0, -parseFloat(after[side]) || 0);
    return {
      width: box.width + out("left") + out("right"),
      height: box.height + out("top") + out("bottom"),
    };
  };
  const small = [];
  for (const control of doc.querySelectorAll(TARGETS)) {
    if (
      !control.checkVisibility({ visibilityProperty: true }) ||
      control.closest("[inert]")
    ) {
      continue;
    }
    const target = landsOn(control);
    if (!target.checkVisibility({ visibilityProperty: true })) {
      continue;
    }
    const box = reach(target.getBoundingClientRect(), control);
    if (box.width < least || box.height < least) {
      const name =
        control.id ||
        `${control.tagName.toLowerCase()}.${control.className}` +
          ` "${control.textContent.trim().slice(0, 24)}"`;
      small.push(`${name}: ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
  }
  return small;
}

async function axe(page) {
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

async function go(page, hash) {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.waitForFunction((to) => globalThis.location.hash === to, hash);
  await page.waitForTimeout(SETTLE_MS);
}

async function field(page, id) {
  const control = page.locator(`#${id}`);
  if (!(await control.isVisible())) {
    await go(page, "#fight");
  }
  return control;
}

async function run(page, mode, done) {
  await (await field(page, `run-mode-${mode}`)).check();
  await (await field(page, "run-duration")).fill(FIGHT_SECONDS);
  if (mode === "batch") {
    await (await field(page, "run-iterations")).fill(BATCH_FIGHTS);
  }
  await page.locator("#run-button").click();
  await page.waitForFunction(
    (pattern) =>
      new RegExp(pattern).test(
        globalThis.document.getElementById("run-status-text")?.dataset.dock ??
          "",
      ),
    done,
    { timeout: RUN_TIMEOUT },
  );
}

// Every screen's small targets and axe violations, as "where: what".
async function audit(page, screens, when, size) {
  const found = [];
  for (const hash of screens) {
    await go(page, hash);
    for (const small of await page.evaluate(smallTargets, TARGET - SLACK)) {
      found.push(`${when} ${hash}: ${small}`);
    }
    for (const violation of await axe(page)) {
      found.push(`${when} ${hash}: axe ${violation}`);
    }
    if (SHOTS) {
      const name = hash.slice(1).replaceAll("/", "-");
      await page.screenshot({
        path: `${SHOTS}/targets-${size}-${when}-${name}.png`,
      });
    }
  }
  return found;
}

describe("every target is 44 by 44 and axe passes (#245)", () => {
  for (const [width, height] of SIZES) {
    test(`at ${width}×${height}`, async () => {
      const context = await browser.newContext({
        viewport: { width, height },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => !url.href.startsWith(base),
        (route) =>
          route.request().resourceType() === "image"
            ? route.fulfill({ contentType: "image/jpeg", body: ICON })
            : route.abort(),
      );
      try {
        await page.goto(`${base}#character`);
        await page.locator("#run-button").waitFor({ state: "visible" });
        await page.addStyleTag({ content: FONT_CSS });
        const size = `${width}x${height}`;
        const found = await audit(page, SCREENS, "fresh", size);
        await run(page, "batch", "^Done");
        found.push(...(await audit(page, ["#results"], "batch", size)));
        await run(page, "live", "^Finished");
        found.push(...(await audit(page, ["#results/live"], "watch", size)));
        assert.deepEqual(found, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
