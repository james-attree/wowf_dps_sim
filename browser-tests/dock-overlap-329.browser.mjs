// Phone dock vs the start-preset cards (#329 / #417 / #287 PR 3). At
// 320 / 100%, 360 / 100% and 360 / 150% text, the last preset and the
// race field must sit above the dock with a real margin, under the live
// fonts (Inter + Cinzel) and under a DejaVu Sans pin (as CI has it).
// Names use overflow-wrap: break-word so a word that fits the column
// stays whole (Fran's #417 N1). Viewport height 844, as the #329 harness.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const CASES = [
  { width: 320, textSize: "100%" },
  { width: 360, textSize: "100%" },
  { width: 360, textSize: "150%" },
];
const FONTS = [
  { label: "Inter", family: null },
  { label: "DejaVu Sans", family: "DejaVu Sans" },
];
const PHONE_HEIGHT = 844;
const WIDE = 1024;
const SLACK = 1;
// Several CSS pixels of clearance, so the DejaVu 360 / 150% case cannot
// sit on a 1px allowance (Kira's #417 N4).
const MIN_CLEAR = 6;

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

const dockTop = (page) =>
  page.evaluate(() => {
    const tops = ["#run-bar", "#area-nav"]
      .map((selector) => document.querySelector(selector))
      .filter(
        (element) =>
          element !== null && getComputedStyle(element).position === "fixed",
      )
      .map((element) => element.getBoundingClientRect().top);
    return tops.length === 0 ? null : Math.min(...tops);
  });

const box = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const { top, bottom, height } = node.getBoundingClientRect();
    return { top, bottom, height };
  });

function midWordBreaks(slack) {
  const issues = [];
  const wordsOf = (value) =>
    (value.match(/[^\s]+/g) ?? []).filter((word) => word.length > 1);
  for (const node of document.querySelectorAll(".start-card-name")) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      continue;
    }
    const contentWidth = node.getBoundingClientRect().width;
    const canvas = document.createElement("canvas").getContext("2d");
    canvas.font = style.font;
    // NodeFilter.SHOW_TEXT. Named here so the file lints in Node.
    const walker = document.createTreeWalker(node, 4);
    const texts = [];
    while (walker.nextNode()) {
      texts.push(walker.currentNode);
    }
    for (const textNode of texts) {
      const value = textNode.nodeValue ?? "";
      let offset = 0;
      for (const word of wordsOf(value)) {
        const start = value.indexOf(word, offset);
        if (start < 0) {
          continue;
        }
        offset = start + word.length;
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + word.length);
        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        if (rects.length < 2) {
          continue;
        }
        const wordWidth = canvas.measureText(word).width;
        if (wordWidth <= contentWidth - slack) {
          const button = node.closest("button");
          issues.push(
            `${button?.id ?? "card"}: "${word}" breaks mid-word but fits (${wordWidth.toFixed(1)} in ${contentWidth.toFixed(1)})`,
          );
        }
      }
    }
  }
  return issues;
}

async function open(width, textSize, fontFamily = null) {
  const context = await browser.newContext({
    viewport: { width, height: PHONE_HEIGHT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await page.goto(`${base}#character/start`);
  const fontCss = fontFamily
    ? `:root { font-family: "${fontFamily}" !important; }`
    : "";
  await page.addStyleTag({
    content: `${fontCss} html { font-size: ${textSize} !important; }`,
  });
  await page.locator("#start-panel").waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  return { context, page, errors };
}

describe("start cards stay above the phone dock (#329)", () => {
  for (const font of FONTS) {
    for (const { width, textSize } of CASES) {
      test(`the last preset and the start-race field clear the dock at ${width}, ${textSize} text (${font.label})`, async () => {
        const { context, page, errors } = await open(
          width,
          textSize,
          font.family,
        );
        const name = `${width}-${textSize.replace("%", "")}-${font.label}`;
        try {
          assert.deepEqual(errors, [], errors.join("\n"));
          const dock = await dockTop(page);
          assert.equal(
            dock !== null,
            width < WIDE,
            `${name}: a fixed dock on phones`,
          );
          const foot =
            dock ?? (await page.evaluate(() => globalThis.innerHeight));
          const cards = page.locator("#start-cards button");
          const count = await cards.count();
          assert.ok(count >= 1, `${name}: start cards are on the page`);
          for (let index = 0; index < count; index += 1) {
            const cardBox = await cards.nth(index).evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return { id: node.id, bottom: rect.bottom };
            });
            assert.ok(
              cardBox.bottom <= foot + SLACK,
              `${name}: ${cardBox.id} over the dock (${cardBox.bottom} against ${foot})`,
            );
          }
          const last = await box(page, "#start-cards li:last-child button");
          assert.ok(
            last.bottom <= foot - MIN_CLEAR + SLACK,
            `${name}: the last card clears the dock by at least ${MIN_CLEAR}px (${last.bottom} against ${foot})`,
          );
          const race = await box(page, ".start-race");
          assert.ok(
            race.bottom <= foot - MIN_CLEAR + SLACK,
            `${name}: the race field clears the dock by at least ${MIN_CLEAR}px (${race.bottom} against ${foot})`,
          );
          const wrap = await page.evaluate(() => {
            const node = document.querySelector(".start-card-name");
            const style = node ? getComputedStyle(node) : null;
            return {
              lang: document.documentElement.lang,
              overflowWrap: style?.overflowWrap ?? null,
              hyphens: style?.hyphens ?? null,
            };
          });
          assert.equal(
            wrap.lang,
            "en",
            `${name}: html lang is set for hyphenation`,
          );
          assert.equal(
            wrap.overflowWrap,
            "break-word",
            `${name}: start-card names use break-word, not anywhere`,
          );
          const midWord = await page.evaluate(midWordBreaks, SLACK);
          assert.deepEqual(midWord, [], `${name}: ${midWord.join("; ")}`);
          const proof = await page.evaluate(() => {
            const word = "Assassination";
            const host = document.createElement("div");
            host.style.cssText =
              "position:absolute;left:0;top:0;font:400 20px sans-serif;";
            const sample = document.createElement("span");
            sample.className = "start-card-name";
            sample.style.font = "400 20px sans-serif";
            sample.textContent = word;
            host.append(sample);
            document.body.append(host);
            const wordWidth = sample.getBoundingClientRect().width;
            host.style.width = `${wordWidth + 12}px`;
            sample.textContent = `XXXX ${word}`;
            const style = getComputedStyle(sample);
            const textNode = sample.firstChild;
            const start = textNode.nodeValue.indexOf(word);
            const range = document.createRange();
            range.setStart(textNode, start);
            range.setEnd(textNode, start + word.length);
            const rects = [...range.getClientRects()].filter(
              (rect) => rect.width > 0 && rect.height > 0,
            );
            const result = {
              overflowWrap: style.overflowWrap,
              wordWidth,
              boxWidth: host.getBoundingClientRect().width,
              lines: rects.length,
            };
            host.remove();
            return result;
          });
          assert.equal(proof.overflowWrap, "break-word");
          assert.ok(
            proof.wordWidth <= proof.boxWidth - SLACK,
            `${name}: proof word should fit the box (${proof.wordWidth} in ${proof.boxWidth})`,
          );
          assert.equal(
            proof.lines,
            1,
            `${name}: a word that fits the column stays whole (got ${proof.lines} line boxes)`,
          );
          const clipped = await page.evaluate((slack) => {
            const issues = [];
            for (const button of document.querySelectorAll(
              "#start-cards button",
            )) {
              const card = button.getBoundingClientRect();
              if (button.scrollWidth > button.clientWidth + slack) {
                issues.push(
                  `${button.id}: scrollWidth ${button.scrollWidth} > clientWidth ${button.clientWidth}`,
                );
              }
              // A name's own scrollWidth can be 0 or can match a box that
              // has already grown past the card, so also compare each
              // visible label's line boxes to the card edge.
              for (const node of button.querySelectorAll(
                ".start-card-name, .start-card-short, .start-card-detail, .start-card-edited",
              )) {
                if (getComputedStyle(node).display === "none") {
                  continue;
                }
                for (const rect of node.getClientRects()) {
                  if (rect.width <= 0 || rect.height <= 0) {
                    continue;
                  }
                  if (
                    rect.right > card.right + slack ||
                    rect.left < card.left - slack
                  ) {
                    issues.push(
                      `${button.id}: label ${rect.right} outside card ${card.right}`,
                    );
                  }
                }
              }
            }
            return issues;
          }, SLACK);
          assert.deepEqual(clipped, [], `${name}: ${clipped.join("; ")}`);
          // Full name stays in the accessibility tree (visually hidden
          // detail on the compact grid), and the visible short label is
          // still in that name (WCAG 2.5.3).
          assert.equal(
            await page
              .getByRole("button", {
                name: /Assassination daggers 37\/11\/3 Mutilate · 37\/11\/3 · Instant \/ Deadly/,
              })
              .count(),
            1,
            `${name}: Assassination card has its full accessible name`,
          );
          assert.equal(
            await page
              .getByRole("button", {
                name: /Custom 13\/35\/3 The page defaults: Combat daggers talents and rotation/,
              })
              .count(),
            1,
            `${name}: Custom card has its full accessible name`,
          );
        } finally {
          await context.close();
        }
      });
    }
  }
});
