// #285 (P5-08): keyboard-only journey through the new Phase 5 flows, ending
// on a version-2 share link (#306), not the ?s=1. form from #284.
// coordinator call 15 Nov (James delegated). Tab order, a visible focus
// ring, Enter (and Space on buttons), focus after navigation, no traps.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";
import { LINK_VERSION } from "../js/build-codec.js";
import { NOTICES } from "../js/views/share-link.js";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const PINNED_FONT = "DejaVu Sans";
const WIDTH = 1024;
const PHONE = 360;
const SCREEN_HEIGHT = 900;
const ASSASSINATION = "assassination-daggers";
const HASTE = "5";
const RACE = "human";
const FIGHT_SECONDS = "4";
const FIGHTS = "2";
const TAB_CAP = 60;
const RUN_TIMEOUT = 60_000;

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
  { hash = "#character", clipboard = "allow", search = "?e2e" } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
  });
  if (clipboard === "allow") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: base,
    });
  } else {
    await context.addInitScript((how) => {
      const nav = document.defaultView.navigator;
      if (how === "missing") {
        Object.defineProperty(nav, "clipboard", { value: undefined });
      } else {
        Object.defineProperty(nav, "clipboard", {
          value: { writeText: () => Promise.reject(new Error("denied")) },
        });
      }
    }, clipboard);
  }
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
  const url = new URL(
    search.startsWith("http") ? search : `${base}${search}${hash}`,
  );
  url.searchParams.set("e2e", "");
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `:root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

async function focused(page) {
  return page.evaluate(() => {
    const el = globalThis.document.activeElement;
    if (el === null || el === globalThis.document.body) {
      return { id: "", tag: "body" };
    }
    return {
      id: el.id ?? "",
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute("href"),
      area: el.getAttribute("data-nav-area"),
      key:
        el.id ||
        `${el.tagName.toLowerCase()}:${el.getAttribute("data-nav-area") ?? el.getAttribute("href") ?? el.textContent.trim().slice(0, 24)}`,
    };
  });
}

async function focusRing(page) {
  return page.evaluate(() => {
    const el = globalThis.document.activeElement;
    if (el === null) {
      return { outlineStyle: "none", outlineWidth: 0, boxShadow: "none" };
    }
    const style = globalThis.getComputedStyle(el);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      boxShadow: style.boxShadow,
    };
  });
}

function assertRing(ring, where) {
  const outline = ring.outlineStyle !== "none" && ring.outlineWidth > 0;
  const shadow = ring.boxShadow !== "none" && Boolean(ring.boxShadow);
  assert.ok(outline || shadow, `no visible focus ring on ${where}`);
}

async function tabUntil(page, want, label) {
  const seen = [];
  for (let step = 0; step < TAB_CAP; step += 1) {
    await page.keyboard.press("Tab");
    const now = await focused(page);
    const name = now.id || now.tag;
    seen.push(name);
    if (now.tag !== "body") {
      assertRing(await focusRing(page), name);
    }
    if (typeof want === "function" ? want(now) : now.id === want) {
      return now;
    }
  }
  assert.fail(`${label}: never reached (focused ${seen.join(" → ")})`);
}

async function enterTo(page, hash, heading = null) {
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (to) =>
      globalThis.location.hash === to ||
      globalThis.location.hash.startsWith(`${to}/`),
    hash,
  );
  if (heading) {
    await page.waitForFunction(
      (id) => globalThis.document.activeElement?.id === id,
      heading,
    );
    assert.equal((await focused(page)).id, heading);
    assertRing(await focusRing(page), heading);
  }
}

async function assertNoTrap(page, hops = 24) {
  let last = null;
  let same = 0;
  for (let step = 0; step < hops; step += 1) {
    await page.keyboard.press("Tab");
    const now = await focused(page);
    const name = now.key || now.id || now.tag;
    if (name === last) {
      same += 1;
      assert.ok(same < 2, `keyboard trap on ${name}`);
    } else {
      same = 0;
      last = name;
    }
  }
}

describe("Phase 5 keyboard wrap-up (#285)", () => {
  test("the v2-link journey is usable from the keyboard at 1024", async () => {
    const { context, page, errors } = await open(WIDTH, {
      clipboard: "reject",
    });
    try {
      await page.locator("#area-character").waitFor({ state: "visible" });
      await page.locator("body").press("Tab");
      assertRing(await focusRing(page), (await focused(page)).id || "first");

      await tabUntil(page, "talents-edit", "Talents row");
      await enterTo(page, "#character/talents");
      await tabUntil(page, "character-back", "back from Talents");
      await enterTo(page, "#character");

      await tabUntil(page, "character-row-stats", "Stats row");
      await enterTo(page, "#character/stats");

      await tabUntil(page, "cfg-race", "Race");
      await page.locator("#cfg-race").selectOption(RACE);
      await tabUntil(page, "cfg-character-haste", "Haste");
      await page.locator("#cfg-character-haste").fill(HASTE);
      await page.keyboard.press("Tab");

      await tabUntil(page, (now) => now.area === "rotation", "Rotation nav");
      await enterTo(page, "#rotation", "area-rotation-title");

      await tabUntil(page, "cfg-rotation", "rotation select");
      await page.locator("#cfg-rotation").selectOption(ASSASSINATION);
      await tabUntil(page, "cfg-preset-build-start", "Starting point link");
      await enterTo(page, "#character/start", "area-character-title");

      await tabUntil(
        page,
        `start-card-${ASSASSINATION}`,
        "Assassination start card",
      );
      await page.keyboard.press("Space");
      await page.locator("#start-undo").waitFor({ state: "visible" });
      assert.equal((await focused(page)).id, "start-undo");
      assertRing(await focusRing(page), "start-undo");

      await tabUntil(page, (now) => now.area === "fight", "Fight nav");
      await enterTo(page, "#fight", "area-fight-title");

      await tabUntil(page, "run-duration", "fight length");
      await page.locator("#run-duration").fill(FIGHT_SECONDS);
      await tabUntil(page, "run-iterations", "fights");
      await page.locator("#run-iterations").fill(FIGHTS);
      await tabUntil(page, "run-button", "Run");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          /average|done|finished|ready/i.test(
            globalThis.document.getElementById("run-status-text")?.dataset
              .dock ??
              globalThis.document.getElementById("run-status-text")
                ?.textContent ??
              "",
          ) &&
          globalThis.document.getElementById("run-button")?.disabled === false,
        { timeout: RUN_TIMEOUT },
      );

      if (
        !(await page.evaluate(() =>
          globalThis.location.hash.startsWith("#results"),
        ))
      ) {
        await tabUntil(page, (now) => now.area === "results", "Results nav");
        await enterTo(page, "#results", "area-results-title");
      }

      await tabUntil(page, "result-view-weights", "Stat weights switch");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => globalThis.location.hash === "#results/weights",
      );
      assert.equal((await focused(page)).id, "result-view-weights");

      await tabUntil(page, "results-weights-run", "Run stat weights");
      assert.equal(
        (await page.locator("#results-weights-run").innerText()).trim(),
        "Run stat weights",
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          globalThis.document
            .getElementById("results-weights-run")
            ?.getAttribute("data-weights-action") === "cancel",
      );
      assert.equal((await focused(page)).id, "results-weights-run");
      assert.equal(
        (await page.locator("#results-weights-run").innerText()).trim(),
        "Cancel",
      );
      assertRing(await focusRing(page), "Cancel");
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () =>
          globalThis.document
            .getElementById("results-weights-run")
            ?.getAttribute("data-weights-action") === "run",
      );
      assert.equal((await focused(page)).id, "results-weights-run");

      await tabUntil(page, "share-link-header", "Copy link");
      await page.keyboard.press("Enter");
      await page.locator("#share-url-header").waitFor({ state: "visible" });
      assert.equal((await focused(page)).id, "share-url-header");
      const shared = await page.locator("#share-url-header").inputValue();
      const param = new URL(shared).searchParams.get("s");
      assert.match(param, new RegExp(`^${LINK_VERSION}\\.`));
      assert.notEqual(param.split(".")[0], "1");
      const selected = await page.evaluate(() => {
        const field = globalThis.document.getElementById("share-url-header");
        return (
          field === globalThis.document.activeElement &&
          field.selectionStart === 0 &&
          field.selectionEnd === field.value.length
        );
      });
      assert.equal(selected, true);
      await assertNoTrap(page);

      const loaded = new URL(shared);
      loaded.searchParams.set("e2e", "");
      const {
        context: openedCtx,
        page: opened,
        errors: loadErrors,
      } = await open(WIDTH, {
        hash: "",
        search: loaded.search,
      });
      try {
        await opened.locator("#share-banner").waitFor({ state: "visible" });
        assert.equal(
          ((await opened.locator("#share-banner-text").textContent()) ?? "")
            .replace(/\s+/g, " ")
            .trim(),
          NOTICES.loaded,
        );
        const after = await opened.evaluate(() => ({
          search: globalThis.location.search,
          haste: globalThis.document.getElementById("cfg-character-haste")
            ?.value,
          race: globalThis.document.getElementById("cfg-race")?.value,
          link: new globalThis.URL(globalThis.location.href).searchParams.get(
            "s",
          ),
        }));
        assert.equal(after.link, null);
        assert.equal(after.haste, HASTE);
        assert.equal(after.race, RACE);
        await opened.locator("body").press("Tab");
        await tabUntil(opened, "share-banner-close", "Dismiss on a v2 load");
        await opened.keyboard.press("Enter");
        await opened.locator("#share-banner").waitFor({ state: "hidden" });
        await assertNoTrap(opened);
        assert.deepEqual(loadErrors, []);
      } finally {
        await openedCtx.close();
      }

      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the Results nav and dock stay keyboard-usable at 360", async () => {
    const { context, page, errors } = await open(PHONE);
    try {
      await page.locator("#area-character").waitFor({ state: "visible" });
      await page.locator("body").press("Tab");
      await tabUntil(
        page,
        (now) => now.area === "results",
        "Results in the dock",
      );
      assertRing(await focusRing(page), "Results");
      await enterTo(page, "#results", "area-results-title");
      await tabUntil(page, "result-view-weights", "Stat weights switch");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => globalThis.location.hash === "#results/weights",
      );
      await tabUntil(
        page,
        "results-weights-run",
        "Run stat weights on a phone",
      );
      await assertNoTrap(page);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});
