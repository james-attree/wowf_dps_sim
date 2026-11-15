// #285 (P5-08): 44 px tap-target audit of the stat weights view and the
// #283 cross-screen surfaces (nav badge, dock strip, Results link,
// Run/Cancel, wake-lock fallback, card links). WCAG 2.5.5's inline-text
// exception is not used: the #282 spec and the #245 audit require every
// target to be at least --target (44 CSS px). 360, 1024 and 1280, at 100%
// and 150% text. DejaVu Sans, as the other audits pin it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const PINNED_FONT = "DejaVu Sans";
const TARGET = 44;
const SLACK = 0.5;
const SCREEN_HEIGHT = 900;
const WIDTHS = [360, 1024, 1280];
const TEXT = ["100%", "150%"];
const NINE = 9;
const AT = new Date(2026, 10, 15, 10, 2).getTime();
const ROWS = {
  attackPower: { dpsPerPoint: 1, ci: 0.05, apEquivalent: 1 },
  mainHand: { dpsPerPoint: 2.5, ci: 0.1, apEquivalent: 2.5 },
  offHand: { dpsPerPoint: 2.5, ci: 0.2, apEquivalent: 2.5 },
  crit: { dpsPerPoint: 19.23, ci: 0.4, apEquivalent: 19.23 },
  hit: { dpsPerPoint: 14.8, ci: 0.2, apEquivalent: 14.8 },
};
const doneResult = {
  seed: 107,
  iterations: 1000,
  variants: NINE,
  rows: ROWS,
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
  const inScope = (el) =>
    el.closest("#area-nav") ||
    el.closest("#run-column") ||
    el.closest("#run-controls") ||
    el.closest("#results-weights") ||
    el.closest(".result-switch") ||
    el.closest("#results-card-weights") ||
    el.closest("#results-card");
  const small = [];
  for (const control of doc.querySelectorAll(TARGETS)) {
    if (
      !control.checkVisibility({ visibilityProperty: true }) ||
      control.closest("[inert]") ||
      !inScope(control)
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

async function open(width, text, hash) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
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
  await page.goto(`${base}?e2e${hash}`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content:
      `html { font-size: ${text} !important; }` +
      ` :root { font-family: "${PINNED_FONT}" !important; }`,
  });
  await page.waitForFunction(() => globalThis.__store != null);
  return { context, page, errors };
}

async function setWeights(page, over) {
  await page.evaluate(
    ({ status, result, progress, wakeLock, at }) => {
      const store = globalThis.__store;
      const state = store.get();
      store.set({
        weights: {
          ...(state.weights ?? {}),
          status,
          result,
          jobs: result?.jobs ?? [],
          progress,
          error: null,
          wakeLock,
        },
        ran: {
          ...(state.ran ?? {}),
          weights:
            result == null
              ? null
              : {
                  config: state.config,
                  seed: 107,
                  duration: 300,
                  iterations: 1000,
                  at,
                },
        },
      });
    },
    { at: AT, progress: null, wakeLock: null, result: null, ...over },
  );
}

const states = [
  {
    name: "idle weights view",
    hash: "#results/weights",
    prep: async () => {},
  },
  {
    name: "running weights with wake-lock fallback",
    hash: "#results/weights",
    prep: async (page) => {
      await setWeights(page, {
        status: "running",
        result: null,
        progress: { completed: 3, total: NINE },
      });
      await page
        .waitForFunction(() => {
          const lock = globalThis.__store.get().weights?.wakeLock;
          return lock === "held" || lock === "fallback";
        })
        .catch(() => {});
      await setWeights(page, {
        status: "running",
        result: null,
        progress: { completed: 3, total: NINE },
        wakeLock: "fallback",
      });
    },
  },
  {
    name: "re-run with previous card and badge",
    hash: "#character",
    prep: async (page) => {
      await setWeights(page, {
        status: "running",
        result: doneResult,
        progress: { completed: 3, total: NINE },
        wakeLock: "fallback",
      });
    },
  },
  {
    name: "finished card",
    hash: "#character",
    prep: async (page) => {
      await setWeights(page, { status: "done", result: doneResult });
    },
  },
];

describe("stat weights and #283 tap targets (#285)", () => {
  for (const text of TEXT) {
    for (const width of WIDTHS) {
      test(`every in-scope control is at least 44×44 at ${width} / ${text}`, async () => {
        const found = [];
        for (const state of states) {
          const { context, page, errors } = await open(width, text, state.hash);
          try {
            await state.prep(page);
            const small = await page.evaluate(smallTargets, TARGET - SLACK);
            for (const item of small) {
              found.push(`${state.name}: ${item}`);
            }
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        }
        assert.deepEqual(found, []);
      });
    }
  }
});
