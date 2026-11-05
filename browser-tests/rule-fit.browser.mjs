// TR-02 / #332: whole file skipped — empty presets until #333
// Browser test for #322 B1 (Fran's check): at 1024 wide and 150% text a
// condition's fields (flex: 1 1 min-content) grew .rotation-panel's auto
// grid track past its card, so every rule with conditions spilled its body
// out of the builder card and under the run panel, worst in DejaVu. As an
// Orc (so the presets' Blood Fury rules show the "Race or talent granted"
// guard), every rule screen of every rotation on offer must keep the
// builder body, each rule body and each condition inside the panel. Run in DejaVu Sans pinned (CI's
// font, the widest we test with) and in the page's own font stack.
// `npm run test:browser`; Chrome as in the other files.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONTS = [
  ["DejaVu Sans", ':root { font-family: "DejaVu Sans" !important; }'],
  ["the default font stack", ""],
];
const SIZE = { width: 1024, height: 768 };
const TEXT = "150%";
// Rounding slack for a box edge, not a layout allowance.
const EDGE = 1;
// The default rotation's rules (data/rotations.js's Default (Combat)).
const RULES = 7;
const RACE = "orc";
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

// What spills out of the shown rotation panel's content box: the builder
// body, the rule body and each condition, and any sideways scroll.
function spills(edge) {
  const doc = globalThis.document;
  const panel = [...doc.querySelectorAll(".rotation-panel")].find((node) =>
    node.checkVisibility(),
  );
  if (panel === undefined) {
    return { conds: 0, out: ["no rotation panel shown"] };
  }
  const style = globalThis.getComputedStyle(panel);
  const box = panel.getBoundingClientRect();
  const left = box.left + parseFloat(style.borderLeftWidth);
  const right = box.right - parseFloat(style.borderRightWidth);
  const out = [];
  const parts = panel.querySelectorAll(
    ".rotation-builder-body, .rule-body, .cond, .cond select",
  );
  for (const node of parts) {
    if (!node.checkVisibility()) {
      continue;
    }
    const at = node.getBoundingClientRect();
    if (at.left < left - edge || at.right > right + edge) {
      out.push(
        `${node.className || node.tagName} ${node.id}: ${at.left}–${at.right} in ${left}–${right}`,
      );
    }
  }
  if (panel.scrollWidth > panel.clientWidth + edge) {
    out.push(`panel scrolls: ${panel.scrollWidth} > ${panel.clientWidth}`);
  }
  const root = doc.documentElement;
  if (root.scrollWidth > root.clientWidth) {
    out.push(`page scrolls: ${root.scrollWidth} > ${root.clientWidth}`);
  }
  return { conds: panel.querySelectorAll(".cond").length, out };
}

async function show(page, hash) {
  await page.evaluate((to) => {
    globalThis.location.hash = to;
  }, hash);
  await page.waitForFunction((to) => globalThis.location.hash === to, hash);
  await page.evaluate(
    () => new Promise((done) => globalThis.requestAnimationFrame(done)),
  );
}

describe.skip("a rule's body stays in the builder card at 1024 and 150% (#322 B1)", () => {
  for (const [font, css] of FONTS) {
    test(`in ${font}`, async () => {
      const context = await browser.newContext({ viewport: SIZE });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(
        (url) => !url.href.startsWith(base),
        (route) =>
          route.request().resourceType() === "image"
            ? route.fulfill({
                status: 200,
                contentType: "image/jpeg",
                body: ICON,
              })
            : route.abort(),
      );
      try {
        await page.goto(`${base}#character/stats`);
        await page.addStyleTag({
          content: `${css} html { font-size: ${TEXT} !important; }`,
        });
        await page.evaluate(() => document.fonts.ready);
        await page.locator("#cfg-race").selectOption(RACE);
        let conds = 0;
        let screens = 0;
        await show(page, "#rotation");
        const rotations = await page
          .locator("#cfg-rotation option")
          .evaluateAll((options) =>
            options.map((option) => option.value).filter(Boolean),
          );
        for (const rotation of rotations) {
          await show(page, "#rotation");
          await page.selectOption("#cfg-rotation", rotation);
          const rules = await page.locator(".rule-title").count();
          for (let at = 1; at <= rules; at += 1) {
            const hash = `#rotation/rule/${at}`;
            await show(page, hash);
            const seen = await page.evaluate(spills, EDGE);
            conds += seen.conds;
            screens += 1;
            assert.deepEqual(seen.out, [], `${rotation} ${hash}`);
          }
        }
        assert.ok(rotations.length > 1, "the presets to check");
        assert.ok(screens > RULES, "the rule screens to check");
        assert.ok(conds > RULES, "the rules have conditions to check");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
