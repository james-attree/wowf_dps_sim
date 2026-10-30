// Browser tests for Rotation's screens (#243, UX5): the list (#rotation), a
// rule's own screen (#rotation/rule/<n>) and Export or import
// (#rotation/share). Each is a route with its own title, h1 and back link;
// the rotation's warnings are a banner under the h1, seen after a Duplicate
// at every size (Fran's #252 and #253 checks); the strip links to them; and
// from the wide breakpoint up an area's h1 comes before the Run column in
// the page (N3). `npm run test:browser`; Chrome as in the other files. Fonts
// are pinned to DejaVu Sans, CI's.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONT_CSS = ':root { font-family: "DejaVu Sans" !important; }';
const APP = "WoW Forever Rogue Simulator";
const SIZES = [
  [1440, 900],
  [1280, 800],
  [1100, 800],
  [1024, 768],
  [1024, 576],
  [390, 844],
  [360, 640],
];
const WIDE_PX = 1024;

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

async function openPage(width, height, hash = "") {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({ status: 200, contentType: "image/jpeg", body: ICON })
        : route.abort(),
  );
  await page.goto(`${base}${hash}`);
  await page.addStyleTag({ content: FONT_CSS });
  await page.locator("#run-button").waitFor({ state: "visible" });
  return { context, page, errors };
}

const hashIs = (page, hash) =>
  page.waitForFunction((hash) => globalThis.location.hash === hash, hash);
// The route is drawn a moment after the hash changes: these wait for the
// focus or the title to settle, then give what they are.
async function focusOf(page, want) {
  await page
    .waitForFunction(
      (want) =>
        (document.activeElement?.dataset?.key ?? document.activeElement?.id) ===
        want,
      want,
      { timeout: 2000 },
    )
    .catch(() => {});
  return activeId(page);
}
async function titleOf(page, want) {
  await page
    .waitForFunction((want) => document.title.startsWith(want), want, {
      timeout: 2000,
    })
    .catch(() => {});
  return page.title();
}
const titleIs = async (page, want) =>
  assert.equal(await titleOf(page, want), want);
const activeId = (page) =>
  page.evaluate(
    () => document.activeElement?.dataset?.key ?? document.activeElement?.id,
  );
const h1 = (page) => page.locator("#area-rotation-title");
const ruleCard = (page, at) =>
  page.locator("#rotation-builder li.rule").nth(at);

// Where the banner and the h1 are, and the bottom of what can be seen: the
// phone dock's top when it is fixed over the page.
const placed = (page) =>
  page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const dock = document.getElementById("run-controls");
    const fixed = getComputedStyle(dock).position === "fixed";
    const banner = document.getElementById("rb-warnings");
    return {
      seen: fixed ? dock.getBoundingClientRect().top : globalThis.innerHeight,
      h1: box("area-rotation-title"),
      banner: banner.checkVisibility() ? banner.getBoundingClientRect() : null,
      focused: document.activeElement?.id,
      hash: globalThis.location.hash,
    };
  });

describe("Rotation's screens", () => {
  test("each screen has its route, title, h1 and back link", async () => {
    const { context, page, errors } = await openPage(1280, 800);
    try {
      await page.click("#cfg-rotation-edit");
      await hashIs(page, "#rotation");
      await titleIs(page, `Rotation · ${APP}`);
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      assert.equal(
        await page.locator("#rotation-back").getAttribute("href"),
        "#character",
      );
      // Read as "Back to Character"; drawn "‹ Character".
      assert.equal(
        await page
          .getByRole("link", { name: "Back to Character", exact: true })
          .getAttribute("id"),
        "rotation-back",
      );
      // A rule's screen, from its Edit link.
      const name = (await ruleCard(page, 1).locator(".rule-name").innerText())
        .trim()
        .replace(/^Rule \d+:\s*/, "");
      const edit = ruleCard(page, 1).locator("[data-key$='.edit']");
      const editKey = await edit.getAttribute("data-key");
      assert.equal(await edit.getAttribute("href"), "#rotation/rule/2");
      await edit.click();
      await hashIs(page, "#rotation/rule/2");
      await titleIs(page, `Rule 2: ${name} · ${APP}`);
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      // The number is drawn, and read as "Rule 2:".
      assert.equal(
        await h1(page).locator(".rule-num").getAttribute("aria-hidden"),
        "true",
      );
      assert.equal(
        await h1(page).locator(".visually-hidden").textContent(),
        "Rule 2: ",
      );
      assert.equal(
        await page.locator("#rotation-back").getAttribute("href"),
        "#rotation",
      );
      // Back, a real link, to the list and its Edit link (not history).
      await page.click("#rotation-back");
      await hashIs(page, "#rotation");
      assert.equal(await focusOf(page, editKey), editKey);
      // Export or import, and Escape back to the list.
      await page.click("[data-key='share']");
      await hashIs(page, "#rotation/share");
      await titleIs(page, `Export or import · ${APP}`);
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      assert.ok(await page.isVisible("#cfg-import-text"));
      await page.keyboard.press("Escape");
      await hashIs(page, "#rotation");
      assert.equal(await focusOf(page, "share"), "share");
      // The list's back link closes the builder, back to Fight setup's
      // Edit rotation link (Fran's #251 check).
      await page.click("#rotation-back");
      await hashIs(page, "#character");
      assert.equal(
        await focusOf(page, "cfg-rotation-edit"),
        "cfg-rotation-edit",
      );
      assert.equal(await page.isVisible("#rotation-builder"), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("a rule's route opens its screen, a missing one the list", async () => {
    const { context, page, errors } = await openPage(
      390,
      844,
      "#rotation/rule/3",
    );
    try {
      await page.locator("#rotation-builder .rule-screen").waitFor();
      assert.match(await titleOf(page, "Rule 3: "), /^Rule 3: /);
      await page.goto(`${base}#rotation/rule/99`);
      await hashIs(page, "#rotation");
      await titleIs(page, `Rotation · ${APP}`);
      assert.equal(await page.locator("#rotation-builder li.rule").count(), 7);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("an import on Export or import stays there, its status shown", async () => {
    const { context, page, errors } = await openPage(
      1280,
      800,
      "#rotation/share",
    );
    try {
      await page.locator("#cfg-import-text").waitFor({ state: "visible" });
      await page.fill(
        "#cfg-import-text",
        JSON.stringify({
          schemaVersion: 1,
          name: "Warned",
          rules: [
            { action: "sinister-strike", conditions: [] },
            { action: "sinister-strike", conditions: [] },
          ],
        }),
      );
      await page.click("#cfg-import-paste");
      await page.locator("#rb-warnings").waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => globalThis.location.hash),
        "#rotation/share",
      );
      assert.ok(await page.isVisible("#cfg-import-status"));
      assert.match(
        await page.locator("#cfg-import-status").textContent(),
        /see What to check above\.$/,
      );
      const { banner, h1: title } = await placed(page);
      assert.ok(banner.top >= title.bottom - 1, "the banner is under the h1");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

// Fran's #252 and #253 checks (D1, D2): after a Duplicate the warning is on
// screen under the h1, the h1 focused, and so after a second Duplicate.
for (const [width, height] of SIZES) {
  test(`after Duplicate, twice, the banner is under the h1 at ${width}x${height}`, async () => {
    const { context, page, errors } = await openPage(
      width,
      height,
      "#rotation",
    );
    try {
      await page.locator("#rotation-builder li.rule").first().waitFor();
      const copy = async (dup, hash) => {
        await dup.scrollIntoViewIfNeeded();
        await dup.click();
        await hashIs(page, hash);
        await page.locator("#rb-warnings").waitFor({ state: "visible" });
        const at = await placed(page);
        assert.equal(at.focused, "area-rotation-title");
        assert.ok(at.h1.top >= -1, JSON.stringify(at));
        assert.ok(at.banner.top >= at.h1.bottom - 1, JSON.stringify(at));
        assert.ok(at.banner.bottom <= at.seen + 1, JSON.stringify(at));
        return at;
      };
      await copy(
        ruleCard(page, 3).locator("[data-key$='.dup']"),
        "#rotation/rule/5",
      );
      if (process.env.U9_SHOTS) {
        await page.screenshot({
          path: `${process.env.U9_SHOTS}/dup1-${width}x${height}.png`,
        });
      }
      // The copy's screen has its own Duplicate, at its foot.
      await copy(
        page.locator("#rotation-builder .rule-foot [data-key$='.dup']"),
        "#rotation/rule/6",
      );
      if (process.env.U9_SHOTS) {
        await page.screenshot({
          path: `${process.env.U9_SHOTS}/dup2-${width}x${height}.png`,
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// N3 (Fran's #253 check): from the wide breakpoint up, off Results, an
// area's h1 is read and tabbed to before the Run column; on Results the
// column is the bar above them (#242), and on a phone the dock is before
// the area (#240), as before.
for (const [width, height] of [
  [1440, 900],
  [1024, 576],
  [390, 844],
]) {
  test(`the area's h1 and the Run column, in order, at ${width}px (N3)`, async () => {
    const { context, page, errors } = await openPage(width, height);
    try {
      for (const area of ["character", "rotation", "fight", "results"]) {
        await page.click(`[data-nav-area="${area}"]`);
        await hashIs(page, `#${area}`);
        await focusOf(page, `area-${area}-title`);
        const h1First = await page.evaluate(
          (area) =>
            Boolean(
              document
                .querySelector(`#area-${area} h1`)
                .compareDocumentPosition(
                  document.getElementById("run-column"),
                ) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          area,
        );
        assert.equal(
          h1First,
          width >= WIDE_PX && area !== "results",
          `${area} at ${width}`,
        );
      }
      // Tabbing on from the area's link in the nav reaches the area before
      // the Run button.
      if (width >= WIDE_PX) {
        await page.click(`[data-nav-area="fight"]`);
        await hashIs(page, "#fight");
        await focusOf(page, "area-fight-title");
        const stops = [];
        for (let i = 0; i < 40; i += 1) {
          await page.keyboard.press("Tab");
          stops.push(await activeId(page));
        }
        const firstRun = stops.indexOf("run-button");
        const inArea = await page.evaluate(
          (stops) =>
            stops.findIndex(
              (id) =>
                id !== undefined &&
                document.getElementById(id)?.closest("#area-fight") !== null,
            ),
          stops,
        );
        assert.ok(inArea !== -1, stops.join(" "));
        assert.ok(firstRun === -1 || inArea < firstRun, stops.join(" "));
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

// The strip's warnings link (#243): on any area, with the rotation's
// warning count; it opens Rotation, its h1 focused.
for (const width of [1280, 390]) {
  test(`the strip links to the rotation's warnings at ${width}px`, async () => {
    const { context, page, errors } = await openPage(width, 800, "#rotation");
    try {
      const link = page.locator("#run-warnings-link");
      assert.equal(await link.isVisible(), false);
      await ruleCard(page, 3).locator("[data-key$='.dup']").click();
      await hashIs(page, "#rotation/rule/5");
      await page.click(`[data-nav-area="character"]`);
      await hashIs(page, "#character");
      await link.waitFor({ state: "visible" });
      assert.match(await link.textContent(), /^⚠ \d+ rotation warnings?$/);
      assert.match(
        await link.getAttribute("aria-label"),
        /^\d+ rotation warnings?$/,
      );
      await link.click();
      await hashIs(page, "#rotation");
      assert.equal(
        await focusOf(page, "area-rotation-title"),
        "area-rotation-title",
      );
      assert.ok(await page.isVisible("#rb-warnings"));
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}
