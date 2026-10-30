// Fran's design check of PR #256 (qa-256, #244): a repeated condition's
// warning is said on its field (B1); a sub-screen route with an extra part
// is normalised in place (P-b); the talent trees' headings read "Assassination,
// 0 points", with the effects blocks a level below a heading of their own
// (P-d); the poison selects are named by hand (P-e). What a screen reader is
// given comes from Chrome's accessibility tree. Fonts are pinned to DejaVu
// Sans, CI's. `npm run test:browser`; Chrome as in the other files.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const FONT_CSS = ':root { font-family: "DejaVu Sans" !important; }';
const WIDE = 1280;
const PHONE = 390;
const HEIGHT = 900;
const FINISHER = 5;
const REPEATED = Object.freeze({
  type: "comboPoints",
  op: ">=",
  value: FINISHER,
});

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

async function open(width, hash) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
  });
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
  page.waitForFunction((want) => globalThis.location.hash === want, hash);

async function axOf(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
      nodeId,
      fetchRelatives: false,
    });
    return {
      name: nodes[0]?.name?.value ?? "",
      description: nodes[0]?.description?.value ?? "",
    };
  } finally {
    await cdp.detach();
  }
}

for (const width of [WIDE, PHONE]) {
  describe(`qa-256 at ${width}px (#244)`, () => {
    test("B1: a repeated condition's warning is said on its type select", async () => {
      const { context, page, errors } = await open(width, "#rotation/share");
      try {
        await page.locator("#cfg-import-text").waitFor({ state: "visible" });
        await page.fill(
          "#cfg-import-text",
          JSON.stringify({
            schemaVersion: 1,
            name: "Repeat",
            rules: [
              { action: "eviscerate", conditions: [REPEATED, REPEATED] },
              { action: "sinister-strike", conditions: [] },
            ],
          }),
        );
        await page.click("#cfg-import-paste");
        await page.locator("#rb-warnings").waitFor({ state: "visible" });
        await page.evaluate(() => {
          globalThis.location.hash = "#rotation/rule/1";
        });
        await hashIs(page, "#rotation/rule/1");
        const warning = page.locator(
          "#rotation-builder .rule-screen p.rule-msg.is-warning",
        );
        await warning.waitFor({ state: "visible" });
        const id = await warning.getAttribute("id");
        assert.match(id ?? "", /^rb-\S+-msg-\d+$/, "the warning has an id");
        assert.equal(await page.locator(`[id="${id}"]`).count(), 1);
        const select = page
          .locator('#rotation-builder .rule-screen select[id$="-type"]')
          .nth(1);
        const described = (await select.getAttribute("aria-describedby")) ?? "";
        assert.ok(described.split(" ").includes(id), described);
        assert.equal(await select.getAttribute("aria-invalid"), null);
        const text = (await warning.innerText()).replace(/\s+/g, " ").trim();
        const { description } = await axOf(
          page,
          `#${await select.getAttribute("id")}`,
        );
        assert.match(
          description,
          /Condition 2 is the same as condition 1, so it changes nothing\. Delete it\./,
        );
        assert.match(text, /Condition 2 is the same as condition 1/);
        // The first condition, which is not the repeat, says nothing of it.
        const first = page
          .locator('#rotation-builder .rule-screen select[id$="-type"]')
          .nth(0);
        assert.ok(
          !((await first.getAttribute("aria-describedby")) ?? "").includes(id),
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("P-b: #character/gear/x is #character/gear, with no new history entry", async () => {
      const { context, page, errors } = await open(width, "#fight");
      try {
        const before = await page.evaluate(() => globalThis.history.length);
        for (const sub of ["gear", "stats", "talents"]) {
          await page.evaluate((sub) => {
            globalThis.location.hash = `#character/${sub}/x`;
          }, sub);
          await hashIs(page, `#character/${sub}`);
        }
        const length = await page.evaluate(() => globalThis.history.length);
        // One entry per hash change, none for the replace.
        assert.equal(length - before, 3);
        await page.goBack();
        await hashIs(page, "#character/stats");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("P-d: the talent headings read 'Tree, N points'; the effects are h3s", async () => {
      const { context, page, errors } = await open(width, "#character/talents");
      try {
        const head = page.locator("#talents-tree-h-assassination");
        await head.waitFor({ state: "visible" });
        assert.equal(
          (await axOf(page, "#talents-tree-h-assassination")).name,
          "Assassination, 0 points",
        );
        const outline = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              "#area-character h1, #area-character h2, #area-character h3",
            ),
          ]
            .filter(
              (node) =>
                node.checkVisibility() ||
                node.classList.contains("visually-hidden"),
            )
            .filter((node) => !node.closest("[hidden]"))
            .map(
              (node) =>
                `${node.tagName} ${node.textContent.replace(/\s+/g, " ").trim()}`,
            ),
        );
        const at = (text) => outline.findIndex((line) => line.endsWith(text));
        const effects = at("What your talents change");
        assert.ok(effects > 0, outline.join("\n"));
        assert.equal(outline[effects].slice(0, 2), "H2");
        for (const block of ["Character stats", "What the sim covers"]) {
          assert.equal(outline[at(block)].slice(0, 2), "H3", block);
          assert.ok(at(block) > effects, block);
        }
        assert.ok(
          outline[effects + 2].startsWith("H3 Rotation"),
          outline.join("\n"),
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test("P-e: the poison selects are named by hand", async () => {
      const { context, page, errors } = await open(width, "#character/gear");
      try {
        assert.equal(
          await page
            .getByRole("combobox", { name: "Main hand poison", exact: true })
            .getAttribute("id"),
          "cfg-poisons-mainHand",
        );
        assert.equal(
          await page
            .getByRole("combobox", { name: "Off hand poison", exact: true })
            .getAttribute("id"),
          "cfg-poisons-offHand",
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
