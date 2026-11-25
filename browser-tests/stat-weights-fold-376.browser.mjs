// #376 item 2, Option B: a name-above fold so the folded CI and the AP
// figure stay on one line when the weights table is tight. Phones at
// 320, 360 and 390, 100% and 150% text, under Inter and DejaVu; 768 /
// 150% DejaVu stays unfolded; 1024 and up stay a four-column table.
// coordinator call 25 Nov (James delegated).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startStaticServer } from "../scripts/serve.mjs";

const ICON = await readFile(new URL("../img/backstab.jpg", import.meta.url));
const PINNED_FONT = "DejaVu Sans";
const FONTS = [null, PINNED_FONT];
const TEXT_SIZES = ["100%", "150%"];
const PHONES = [320, 360, 390];
const DESKTOP = [1024, 1280, 1440];
const SCREEN_HEIGHT = 900;
const SLACK = 1;
const TARGET = 44;
const SHARE_NAME = "Copy link to this build (header)";
const AT = new Date(2026, 10, 15, 9, 12).getTime();
const ITERATIONS = 1000;
const DURATION = 300;
const SEED = 107;
const NINE = 9;

const JOBS = [
  { id: "base", sign: 0 },
  { id: "attackPower", sign: 1 },
  { id: "mainHand", sign: 1 },
  { id: "offHand", sign: 1 },
  { id: "crit", sign: 1 },
  { id: "crit", sign: -1 },
  { id: "hit", sign: 1 },
  { id: "haste", sign: 1 },
];

const ROWS = {
  attackPower: { dpsPerPoint: 1, ci: 0.05, apEquivalent: 1 },
  mainHand: { dpsPerPoint: 2.5, ci: 0.1, apEquivalent: 2.5 },
  offHand: { dpsPerPoint: 2.5, ci: 0.2, apEquivalent: 2.5 },
  crit: { dpsPerPoint: 19.23, ci: 0.4, apEquivalent: 19.23 },
  hit: { dpsPerPoint: 1.67, ci: 0.167, apEquivalent: 1.67 },
};

const WHOLE_WORDS = ["Main-hand", "Off-hand", "One-sided", "measured"];

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
  { text = "100%", font = null, hash = "#results/weights" } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: "no-preference",
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
  const e2e = hash.includes("results") ? "?e2e" : "";
  await page.goto(`${base}${e2e}${hash}`, { waitUntil: "networkidle" });
  const pin = font ? `:root { font-family: "${font}" !important; } ` : "";
  await page.addStyleTag({
    content: `${pin}html { font-size: ${text} !important; }`,
  });
  if (hash.includes("results/weights")) {
    await page.locator("#results-weights").waitFor({ state: "visible" });
    await page.waitForFunction(() => globalThis.__store != null);
  } else {
    await page.locator(".simulator-header").waitFor({ state: "visible" });
  }
  return { context, page, errors };
}

async function show(page) {
  return page.evaluate(
    ({ result, at, duration, iterations, seed }) => {
      const store = globalThis.__store;
      const state = store.get();
      store.set({
        weights: {
          ...(state.weights ?? {}),
          status: "done",
          result,
          jobs: result.jobs,
          progress: null,
          elapsedMs: 0,
          error: null,
        },
        ran: {
          ...(state.ran ?? {}),
          weights: {
            config: state.config,
            seed,
            duration,
            iterations,
            at,
          },
        },
      });
    },
    {
      result: {
        seed: SEED,
        iterations: ITERATIONS,
        variants: NINE,
        rows: ROWS,
        jobs: JOBS,
      },
      at: AT,
      duration: DURATION,
      iterations: ITERATIONS,
      seed: SEED,
    },
  );
}

const LAYOUT_SOURCE = `
  const midWord = (root) => {
    const hits = [];
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue ?? "";
      const words = value.match(/[^\\s]+/g) ?? [];
      let cursor = 0;
      for (const word of words) {
        const start = value.indexOf(word, cursor);
        cursor = start + word.length;
        if (word.length < 2) {
          continue;
        }
        const first = root.ownerDocument.createRange();
        first.setStart(node, start);
        first.setEnd(node, start + 1);
        const last = root.ownerDocument.createRange();
        last.setStart(node, start + word.length - 1);
        last.setEnd(node, start + word.length);
        const a = first.getBoundingClientRect();
        const b = last.getBoundingClientRect();
        if (a.width === 0 || b.width === 0) {
          continue;
        }
        if (Math.abs(a.top - b.top) > 1) {
          hits.push(word);
        }
      }
      node = walker.nextNode();
    }
    return hits;
  };

  const linesOf = (el) => {
    const rects = [...el.getClientRects()].filter((r) => r.width > 0);
    const lines = [];
    for (const rect of rects) {
      const hit = lines.find((row) => Math.abs(row.top - rect.top) < 1);
      if (hit) {
        hit.right = Math.max(hit.right, rect.right);
      } else {
        lines.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        });
      }
    }
    return lines;
  };
`;

describe("Stat-weight names fold above the figures (#376 item 2)", () => {
  for (const font of FONTS) {
    for (const text of TEXT_SIZES) {
      for (const width of PHONES) {
        const label = `${width}, ${text} text, ${font ?? "Inter"}`;
        test(`figures stay on one line under the name at ${label}`, async () => {
          const { context, page, errors } = await open(width, { text, font });
          try {
            await show(page);
            const metrics = await page.evaluate((source) => {
              const helpers = new Function(
                `${source}; return { midWord, linesOf };`,
              )();
              const doc = globalThis.document;
              const table = doc.getElementById("results-weights-table");
              const pageOverflow =
                doc.documentElement.scrollWidth -
                doc.documentElement.clientWidth;
              const tableOverflow = table.scrollWidth - table.clientWidth;
              const rows = [...table.querySelectorAll("tbody tr")].map(
                (row) => {
                  const name = row.querySelector("th");
                  const folded = row.querySelector(".weights-ci-folded");
                  const ap = row.querySelector(".weights-ap");
                  const note = row.querySelector(
                    ".weights-row-note, .weights-row-flag",
                  );
                  const nameBox = name.getBoundingClientRect();
                  const foldedBox = folded.getBoundingClientRect();
                  const apBox = ap.getBoundingClientRect();
                  return {
                    id: row.dataset.stat,
                    foldedLines: helpers.linesOf(folded).length,
                    apLines: helpers.linesOf(ap).length,
                    sameRow: Math.abs(foldedBox.top - apBox.top) <= 2,
                    nameAbove: nameBox.bottom <= foldedBox.top + 2,
                    noteUnder:
                      note == null ||
                      (note.getBoundingClientRect().top >= nameBox.top - 1 &&
                        note.getBoundingClientRect().bottom <=
                          foldedBox.top + 2 &&
                        name.contains(note)),
                    display: globalThis.getComputedStyle(row).display,
                    ciCol: globalThis.getComputedStyle(
                      row.querySelector(".weights-ci-col"),
                    ).display,
                    wrap: globalThis.getComputedStyle(
                      row.querySelector(".weights-stat-name"),
                    ).overflowWrap,
                    foldedWhite: globalThis.getComputedStyle(folded).whiteSpace,
                    apWhite: globalThis.getComputedStyle(ap).whiteSpace,
                    shy: (name.textContent ?? "").includes("\u00AD"),
                  };
                },
              );
              const words = helpers.midWord(table);
              return {
                pageOverflow,
                tableOverflow,
                tableDisplay: globalThis.getComputedStyle(table).display,
                rows,
                words,
                hasHaste: rows.some((row) => row.id === "haste"),
                hasOneSided: [...table.querySelectorAll(".weights-row-note")]
                  .map((node) => node.textContent)
                  .some((text) => (text ?? "").includes("One-sided")),
              };
            }, LAYOUT_SOURCE);
            assert.ok(
              metrics.pageOverflow <= SLACK,
              `page scrolls ${metrics.pageOverflow}`,
            );
            assert.ok(
              metrics.tableOverflow <= SLACK,
              `table scrolls ${metrics.tableOverflow}`,
            );
            assert.equal(metrics.tableDisplay, "block");
            assert.equal(metrics.hasHaste, true);
            assert.equal(metrics.hasOneSided, true);
            for (const row of metrics.rows) {
              assert.equal(row.foldedLines, 1, `${row.id} folded CI wraps`);
              assert.equal(row.apLines, 1, `${row.id} AP wraps`);
              assert.equal(row.sameRow, true, `${row.id} figures split rows`);
              assert.equal(row.nameAbove, true, `${row.id} name not above`);
              assert.equal(row.noteUnder, true, `${row.id} note left the name`);
              assert.equal(row.display, "grid");
              assert.equal(row.ciCol, "none");
              assert.equal(row.wrap, "normal");
              assert.equal(row.foldedWhite, "nowrap");
              assert.equal(row.apWhite, "nowrap");
              assert.equal(row.shy, false);
            }
            const banned = metrics.words.filter((word) =>
              WHOLE_WORDS.some(
                (token) => word.includes(token) || token.includes(word),
              ),
            );
            assert.deepEqual(
              banned,
              [],
              `mid-word: ${metrics.words.join(", ")}`,
            );
            assert.deepEqual(
              metrics.words.filter((word) =>
                /^(Main-hand|Off-hand|One-sided|measured)$/.test(word),
              ),
              [],
            );
            // Any remaining mid-word hit must not be those tokens.
            for (const word of metrics.words) {
              assert.equal(
                WHOLE_WORDS.some(
                  (token) => word === token || word.includes(token),
                ),
                false,
                word,
              );
            }
            assert.equal(errors.length, 0, errors.join("\n"));
          } finally {
            await context.close();
          }
        });
      }
    }
  }

  test("768 / 150% DejaVu stays unfolded with no overflow", async () => {
    const { context, page, errors } = await open(768, {
      text: "150%",
      font: PINNED_FONT,
    });
    try {
      await show(page);
      const metrics = await page.evaluate(() => {
        const doc = globalThis.document;
        const table = doc.getElementById("results-weights-table");
        const shell = doc.getElementById("results-weights");
        const font = Number.parseFloat(
          globalThis.getComputedStyle(shell).fontSize,
        );
        let cutoffEm = null;
        const walk = (rules) => {
          for (const rule of rules) {
            const kids = rule.cssRules;
            if (kids) {
              walk(kids);
            }
            const cond = rule.conditionText ?? "";
            const container = rule.containerName ?? "";
            if (container === "weights" || /\bweights\b/.test(cond)) {
              const match = cond.match(/width\s*<=\s*([\d.]+)em/);
              if (match) {
                cutoffEm = Number.parseFloat(match[1]);
              }
            }
          }
        };
        for (const sheet of globalThis.document.styleSheets) {
          try {
            walk(sheet.cssRules);
          } catch {
            // Cross-origin sheets are ignored.
          }
        }
        const cutoff = (cutoffEm ?? 30) * font;
        const name = table.querySelector('tr[data-stat="crit"] th');
        const figures = table.querySelector(
          'tr[data-stat="crit"] .weights-ci-folded',
        );
        const nameBox = name.getBoundingClientRect();
        const figureBox = figures.getBoundingClientRect();
        return {
          pageOverflow:
            doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          tableOverflow: table.scrollWidth - table.clientWidth,
          display: globalThis.getComputedStyle(table).display,
          ciCol: globalThis.getComputedStyle(
            table.querySelector(".weights-ci-col"),
          ).display,
          shellWidth: shell.getBoundingClientRect().width,
          cutoffEm,
          cutoff,
          margin: shell.getBoundingClientRect().width - cutoff,
          sameRow:
            nameBox.bottom > figureBox.top + 1 &&
            figureBox.bottom > nameBox.top + 1,
          nameTop: nameBox.top,
          figureTop: figureBox.top,
        };
      });
      assert.equal(metrics.display, "table");
      assert.equal(metrics.ciCol, "none");
      assert.ok(
        metrics.shellWidth > metrics.cutoff,
        `shell ${metrics.shellWidth} vs 30em ${metrics.cutoff}`,
      );
      assert.equal(
        metrics.sameRow,
        true,
        `crit name ${metrics.nameTop} vs figures ${metrics.figureTop}`,
      );
      assert.ok(metrics.pageOverflow <= SLACK, `page ${metrics.pageOverflow}`);
      assert.ok(
        metrics.tableOverflow <= SLACK,
        `table ${metrics.tableOverflow}`,
      );
      // 768 / 150% DejaVu: the shell is 728 wide, 30em is 720, so the
      // cutoff sits 8 under the table. Pin that margin so a moved
      // threshold fails even when the row still happens to fit.
      assert.ok(
        Math.abs(metrics.shellWidth - 728) <= 1,
        `shell ${metrics.shellWidth}`,
      );
      assert.equal(metrics.cutoffEm, 30);
      assert.ok(Math.abs(metrics.cutoff - 720) <= 1, `30em ${metrics.cutoff}`);
      assert.ok(Math.abs(metrics.margin - 8) <= 1, `margin ${metrics.margin}`);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  for (const text of TEXT_SIZES) {
    const fonts = text === "150%" ? FONTS : [null];
    for (const font of fonts) {
      for (const width of text === "100%" && font == null
        ? DESKTOP
        : widthSet(text, font)) {
        const label = `${width}, ${text} text, ${font ?? "Inter"}`;
        test(`the four-column table stays unfolded at ${label}`, async () => {
          const { context, page, errors } = await open(width, { text, font });
          try {
            await show(page);
            const metrics = await page.evaluate(() => {
              const doc = globalThis.document;
              const table = doc.getElementById("results-weights-table");
              const row = table.querySelector('tr[data-stat="crit"]');
              const name = row.querySelector("th");
              const figures =
                row.querySelector(".weights-dps") ??
                row.querySelector(".weights-ap");
              const nameBox = name.getBoundingClientRect();
              const figureBox = figures.getBoundingClientRect();
              return {
                display: globalThis.getComputedStyle(table).display,
                ciCol: globalThis.getComputedStyle(
                  table.querySelector("thead .weights-ci-col, .weights-ci-col"),
                ).display,
                rowDisplay: globalThis.getComputedStyle(row).display,
                foldedDisplay: globalThis.getComputedStyle(
                  row.querySelector(".weights-ci-folded"),
                ).display,
                sameRow:
                  nameBox.bottom > figureBox.top + 1 &&
                  figureBox.bottom > nameBox.top + 1,
                nameTop: nameBox.top,
                figureTop: figureBox.top,
                pageOverflow:
                  doc.documentElement.scrollWidth -
                  doc.documentElement.clientWidth,
              };
            });
            assert.equal(metrics.display, "table");
            assert.equal(metrics.ciCol, "table-cell");
            assert.equal(metrics.rowDisplay, "table-row");
            assert.equal(metrics.foldedDisplay, "none");
            assert.equal(
              metrics.sameRow,
              true,
              `name ${metrics.nameTop} vs figures ${metrics.figureTop}`,
            );
            assert.ok(
              metrics.pageOverflow <= SLACK,
              `page ${metrics.pageOverflow}`,
            );
            assert.equal(errors.length, 0, errors.join("\n"));
          } finally {
            await context.close();
          }
        });
      }
    }
  }

  test("ariaSnapshot keeps table semantics at 360 / 150% and 1024 / 100%", async () => {
    const phone = await open(360, { text: "150%" });
    try {
      await show(phone.page);
      const folded = await phone.page
        .locator("#results-weights-table")
        .ariaSnapshot();
      assert.match(folded, /^- table/m);
      assert.match(folded, /columnheader "Stat"/);
      assert.match(folded, /columnheader.*DPS per point/);
      assert.match(folded, /columnheader.*= N AP/);
      assert.doesNotMatch(folded, /± \(95%\)/);
      assert.match(folded, /rowheader.*Crit \(per 1%\)/);
      const critAt = folded.indexOf("Crit (per 1%)");
      const dpsAt = folded.indexOf("19.23 ± 0.40");
      const apAt = folded.indexOf("= 19.2 AP");
      assert.ok(critAt >= 0 && dpsAt > critAt && apAt > dpsAt, folded);
      assert.match(folded, /rowheader.*Haste \(per 1%\)/);
      assert.match(folded, /Not measured/);
      assert.match(folded, /One-sided/);
      assert.equal(phone.errors.length, 0, phone.errors.join("\n"));
    } finally {
      await phone.context.close();
    }

    const wide = await open(1024, { text: "100%" });
    try {
      await show(wide.page);
      const snapshot = await wide.page
        .locator("#results-weights-table")
        .ariaSnapshot();
      assert.match(snapshot, /^- table/m);
      assert.match(snapshot, /columnheader.*Stat/);
      assert.match(snapshot, /columnheader.*DPS per point/);
      assert.match(snapshot, /columnheader.*± \(95%\)/);
      assert.match(snapshot, /columnheader.*= N AP/);
      assert.match(snapshot, /rowheader.*Crit \(per 1%\)/);
      const critAt = snapshot.indexOf("Crit (per 1%)");
      const dpsAt = snapshot.indexOf("19.23");
      const ciAt = snapshot.indexOf("± 0.40");
      const apAt = snapshot.indexOf("= 19.2 AP");
      assert.ok(
        critAt >= 0 && dpsAt > critAt && ciAt > dpsAt && apAt > ciAt,
        snapshot,
      );
      assert.equal(wide.errors.length, 0, wide.errors.join("\n"));
    } finally {
      await wide.context.close();
    }
  });
});

describe("header share stays one line when the header is tight (#434 N1)", () => {
  test("the text label stays visible at 1024 / 100%", async () => {
    const { context, page, errors } = await open(1024, {
      text: "100%",
      hash: "#character/start",
    });
    try {
      const header = await measureHeader(page);
      assert.ok(
        header.box.height <=
          Math.max(header.title.height, header.share.height) + SLACK,
        `header ${header.box.height} tall`,
      );
      assert.ok(header.label.width > 1, "share label is hidden");
      assert.equal(header.name, SHARE_NAME);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the share button is an icon at 1024 / 150% Inter", async () => {
    const { context, page, errors } = await open(1024, {
      text: "150%",
      hash: "#character/start",
    });
    try {
      const header = await measureHeader(page);
      assert.ok(
        header.share.top < header.title.bottom,
        `share at ${header.share.top}, title ends ${header.title.bottom}`,
      );
      assert.ok(
        header.box.height <=
          Math.max(header.title.height, header.share.height) + SLACK,
        `header ${header.box.height} tall`,
      );
      assert.ok(Math.abs(header.share.width - TARGET) <= SLACK);
      assert.ok(header.share.height >= TARGET - SLACK);
      assert.ok(header.label.width <= SLACK, "the label is visually hidden");
      assert.equal(header.name, SHARE_NAME);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test("the share button is an icon at 521 / 150% DejaVu", async () => {
    const { context, page, errors } = await open(521, {
      text: "150%",
      font: PINNED_FONT,
      hash: "#character/start",
    });
    try {
      const header = await measureHeader(page);
      assert.ok(
        header.share.top < header.title.bottom,
        `share at ${header.share.top}, title ends ${header.title.bottom}`,
      );
      assert.ok(
        header.box.height <=
          Math.max(header.title.height, header.share.height) + SLACK,
        `header ${header.box.height} tall`,
      );
      assert.ok(Math.abs(header.share.width - TARGET) <= SLACK);
      assert.ok(header.share.height >= TARGET - SLACK);
      assert.ok(header.label.width <= SLACK, "the label is visually hidden");
      assert.equal(header.name, SHARE_NAME);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

function widthSet(text, font) {
  if (text === "150%" && font === PINNED_FONT) {
    return [1024];
  }
  if (text === "150%") {
    return DESKTOP;
  }
  return DESKTOP;
}

async function measureHeader(page) {
  return page.evaluate(() => {
    const doc = globalThis.document;
    const box = doc.querySelector(".simulator-header").getBoundingClientRect();
    const title = doc
      .querySelector(".simulator-header > div")
      .getBoundingClientRect();
    const share = doc
      .querySelector("#share-link-header")
      .getBoundingClientRect();
    const label = doc
      .querySelector("#share-link-header .share-button-label")
      .getBoundingClientRect();
    return {
      box,
      title,
      share,
      label,
      name: doc.querySelector("#share-link-header").getAttribute("aria-label"),
    };
  });
}
