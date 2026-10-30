// Browser test for #244 (UX6): a native select shows its whole choice. Below
// the narrow breakpoint a condition's fields were two to a line, so at 390
// and 360 "Adrenaline Rush" showed as "Adrenaline" (Fran's #252 check). Each
// select on Character's gear, Rotation's list and every rule's screen of the
// default rotation must fit its chosen option's text beside its arrow. Fonts
// are pinned to DejaVu Sans, CI's and the widest of the ones we test with.
// `npm run test:browser`; Chrome as in the other files.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONT_CSS = ':root { font-family: "DejaVu Sans" !important; }';
const SIZES = [
  [1440, 900],
  [1024, 768],
  [390, 844],
  [360, 640],
];
// The default rotation's rules (data/rotations.js's Default (Combat)).
const RULES = 7;
const SCREENS = [
  "#character/gear",
  "#rotation",
  ...Array.from({ length: RULES }, (_, at) => `#rotation/rule/${at + 1}`),
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

// Each shown select narrower than it needs to be to show its choice: a
// copy with only that option and its own width is what it needs (Chrome
// sizes a select to its widest option and makes room for its arrow).
function cutSelects() {
  const doc = globalThis.document;
  const cut = [];
  for (const select of doc.querySelectorAll("select")) {
    if (!select.checkVisibility()) {
      continue;
    }
    const copy = select.cloneNode(false);
    copy.removeAttribute("id");
    const chosen = select.selectedOptions[0];
    copy.append(chosen?.cloneNode(true) ?? doc.createElement("option"));
    Object.assign(copy.style, {
      position: "absolute",
      width: "auto",
      minWidth: "0",
      maxWidth: "none",
      flex: "none",
    });
    select.parentElement.append(copy);
    const need = copy.getBoundingClientRect().width;
    copy.remove();
    const has = select.getBoundingClientRect().width;
    if (need > has) {
      const text = chosen?.textContent ?? "";
      cut.push(`${select.id} "${text}": needs ${need}, has ${has}`);
    }
  }
  return cut;
}

describe("a select shows its whole choice (#244)", () => {
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
            ? route.fulfill({
                status: 200,
                contentType: "image/jpeg",
                body: ICON,
              })
            : route.abort(),
      );
      try {
        await page.goto(base);
        await page.addStyleTag({ content: FONT_CSS });
        await page.locator("#run-button").waitFor({ state: "attached" });
        let seen = 0;
        for (const hash of SCREENS) {
          await page.evaluate((hash) => {
            globalThis.location.hash = hash;
          }, hash);
          await page.waitForFunction(
            (hash) => globalThis.location.hash === hash,
            hash,
          );
          await page.evaluate(
            () => new Promise((done) => globalThis.requestAnimationFrame(done)),
          );
          seen += await page.locator("select:visible").count();
          assert.deepEqual(await page.evaluate(cutSelects), [], hash);
        }
        assert.ok(seen > SCREENS.length, "the screens have selects to check");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
});
