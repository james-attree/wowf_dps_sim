// Manual fight B1 board (#348): 3-column phone bar, 44px slots, 100% and
// 150% text with no sideways scroll, reduced motion, keybinds, Replay.

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
const WIDTHS = [360, 390, 1024, 1280, 1440];
const PHONE = [360, 390];
const SCREEN_HEIGHT = 900;
const TARGET_PX = 44;
const COLUMNS = 3;

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

async function open(width, { text = "100%", reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: SCREEN_HEIGHT },
    reducedMotion: reduced ? "reduce" : "no-preference",
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
  await page.goto(`${base}#fight`, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: `html { font-size: ${text} !important; }`,
  });
  await page.locator("#area-fight").waitFor({ state: "visible" });
  await page.locator("#run-button").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const duration = globalThis.document.getElementById("run-duration");
    const button = globalThis.document.getElementById("run-button");
    return Boolean(duration?.value) && button && !button.disabled;
  });
  return { context, page, errors };
}

async function startManual(page, durationSeconds) {
  await page.locator("#fight-mode-manual").check();
  await page.locator("#manual-board").waitFor({ state: "visible" });
  const live = page.locator("#run-mode-live");
  if (await live.count()) {
    await live.check();
  }
  if (durationSeconds != null) {
    await setDuration(page, durationSeconds);
  }
  await page.locator("#run-button").click();
  await page.locator(".manual-slot").first().waitFor({ state: "visible" });
}

describe("Manual fight board layout and behaviour (#348)", () => {
  for (const text of ["100%", "150%"]) {
    for (const width of WIDTHS) {
      test(`${width} at ${text} text: no sideways scroll, slots at least 44px`, async () => {
        const { context, page, errors } = await open(width, { text });
        try {
          await startManual(page);
          const metrics = await page.evaluate(() => {
            const doc = globalThis.document;
            const scrolled =
              doc.documentElement.scrollWidth >
              doc.documentElement.clientWidth + 1;
            const slots = [...doc.querySelectorAll(".manual-slot")].map(
              (slot) => {
                const box = slot.getBoundingClientRect();
                return { w: box.width, h: box.height };
              },
            );
            const bar = doc.querySelector(".manual-bar");
            const style = globalThis.getComputedStyle(bar);
            return {
              scrolled,
              slots,
              columns: style.gridTemplateColumns.split(" ").length,
              overflow: doc.documentElement.scrollWidth,
              client: doc.documentElement.clientWidth,
            };
          });
          assert.equal(errors.length, 0, errors.join("\n"));
          assert.equal(
            metrics.scrolled,
            false,
            `scroll ${metrics.overflow} > ${metrics.client}`,
          );
          assert.ok(metrics.slots.length > 0, "slots rendered");
          for (const slot of metrics.slots) {
            assert.ok(slot.w + 0.01 >= TARGET_PX, `width ${slot.w}`);
            assert.ok(slot.h + 0.01 >= TARGET_PX, `height ${slot.h}`);
          }
          if (PHONE.includes(width)) {
            assert.equal(metrics.columns, COLUMNS);
          }
        } finally {
          await context.close();
        }
      });
    }
  }

  test("keys 1 and W, initials path, reduced motion, Replay keeps the seed", async () => {
    const { context, page, errors } = await open(390, { reduced: true });
    try {
      await startManual(page);
      const first = page.locator(".manual-slot").first();
      await first.focus();
      const clockBefore = await page.locator("#manual-clock").textContent();
      await page.keyboard.press("1");
      const clockAfter = await page.locator("#manual-clock").textContent();
      assert.notEqual(clockAfter, clockBefore);
      assert.match(clockAfter, /00:01\./);
      const fill = await page
        .locator("#manual-mock-health-fill")
        .evaluate((node) => node.style.width);
      assert.notEqual(fill, "100%");
      const well = await page.locator("#manual-well-event").textContent();
      assert.ok(well.trim().length > 0, `well was ${well}`);
      assert.notEqual(await first.getAttribute("aria-disabled"), "true");
      await page.keyboard.press("w");
      const waitFocused = await page.evaluate(() =>
        globalThis.document.activeElement?.classList.contains("manual-wait"),
      );
      assert.equal(waitFocused, true);
      const floats = await page.locator(".manual-float").count();
      assert.equal(floats, 0, "reduced motion has no floats");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("keys 1–0 and W fire nothing when focus is outside the board (Kira N1)", async () => {
    const { context, page, errors } = await open(390);
    try {
      await startManual(page);
      const fightState = () =>
        page.evaluate(() => {
          const doc = globalThis.document;
          const log = doc.getElementById("combat-log");
          return {
            clock: doc.getElementById("manual-clock")?.textContent,
            prompt: doc.getElementById("manual-well-prompt")?.textContent,
            event: doc.getElementById("manual-well-event")?.textContent,
            announce: doc.getElementById("manual-announce")?.textContent,
            log: log?.textContent,
            focusWait: doc.activeElement?.classList.contains("manual-wait"),
            focusSlot: doc.activeElement?.classList.contains("manual-slot"),
          };
        });
      const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "w", "W"];

      async function assertSilent(where, stillFocused) {
        const before = await fightState();
        for (const key of keys) {
          await page.keyboard.press(key);
          const after = await fightState();
          assert.equal(
            after.clock,
            before.clock,
            `${key} clock while ${where}`,
          );
          assert.equal(
            after.prompt,
            before.prompt,
            `${key} well prompt while ${where}`,
          );
          assert.equal(
            after.event,
            before.event,
            `${key} well event while ${where}`,
          );
          assert.equal(
            after.announce,
            before.announce,
            `${key} announce while ${where}`,
          );
          assert.equal(after.log, before.log, `${key} log while ${where}`);
          assert.equal(
            after.focusWait,
            false,
            `${key} focused a Wait while ${where}`,
          );
          assert.equal(
            after.focusSlot,
            false,
            `${key} focused a slot while ${where}`,
          );
        }
        const focused = await page.evaluate(stillFocused);
        assert.equal(focused, true, `focus left the ${where} target`);
      }

      // Fight dock fields are locked while running, so the test plants a
      // throwaway input outside the board (and outside the dock).
      await page.evaluate(() => {
        const input = globalThis.document.createElement("input");
        input.id = "kira-n1-off-board";
        input.type = "text";
        globalThis.document.body.prepend(input);
        input.focus();
      });
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.id),
        "kira-n1-off-board",
      );
      await assertSilent(
        "form input",
        () => globalThis.document.activeElement?.id === "kira-n1-off-board",
      );
      await page.evaluate(() =>
        globalThis.document.getElementById("kira-n1-off-board")?.remove(),
      );

      await page.evaluate(() => {
        const body = globalThis.document.body;
        body.tabIndex = -1;
        body.focus();
      });
      assert.equal(
        await page.evaluate(
          () => globalThis.document.activeElement === globalThis.document.body,
        ),
        true,
      );
      await assertSilent(
        "body",
        () => globalThis.document.activeElement === globalThis.document.body,
      );
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Replay restarts the same seed from 0:00", async () => {
    const { context, page, errors } = await open(390);
    try {
      await page.locator("#run-duration").fill("1");
      await page.locator("#run-duration").press("Tab");
      await startManual(page);
      const seed = await page.locator("#run-seed").inputValue();
      await page.locator(".manual-wait[data-wait-kind='time']").click();
      const reached = await page.locator("#manual-well-event").textContent();
      assert.equal(reached.trim(), "Reached the wait");
      await page.locator(".manual-wait[data-wait-kind='time']").click();
      await page.locator("#manual-review").waitFor({ state: "visible" });
      const announced = await page.locator("#manual-announce").textContent();
      assert.match(announced, /Fight ended before the wait finished/);
      await page.locator("#manual-review-replay").click();
      const after = await page.locator("#run-seed").inputValue();
      assert.equal(after, seed);
      const time = await page.locator("#manual-clock").textContent();
      assert.match(time, /00:00\.0/);
      assert.equal(await page.locator("#manual-review").isHidden(), true);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("QA: accessible names, disabled Wait, icons, trays, floats and Review", async () => {
    const { context, page, errors } = await open(390);
    try {
      const duration = page.locator("#run-duration");
      if (!(await duration.isVisible())) {
        await page.locator('[data-nav-area="fight"]').click();
      }
      await duration.fill("30");
      await page.locator("#run-duration").press("Tab");
      await startManual(page);
      const firstLabel = await page
        .locator(".manual-slot")
        .first()
        .getAttribute("aria-label");
      assert.match(firstLabel ?? "", /^1 /);
      await page.addScriptTag({ content: AXE });
      const violations = await page.evaluate(async () => {
        const board = globalThis.document.getElementById("manual-board");
        const results = await globalThis.axe.run(board);
        return results.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        );
      });
      const nameMismatch = violations.filter((row) =>
        row.startsWith("label-content-name-mismatch"),
      );
      assert.equal(nameMismatch.length, 0, nameMismatch.join("\n"));
      assert.equal(violations.length, 0, violations.join("\n"));
      const srcs = await page.$$eval(".manual-slot-icon img", (images) =>
        images.map((image) => image.getAttribute("src") ?? ""),
      );
      assert.ok(srcs.length > 0, "no slot icons");
      for (const src of srcs) {
        assert.match(src, /wow\.zamimg\.com/);
        assert.doesNotMatch(src, /\/img\//);
      }
      const typography = await page.evaluate(() => {
        const empty = globalThis.document.querySelector(".manual-tray-empty");
        const root = parseFloat(
          globalThis.getComputedStyle(globalThis.document.documentElement)
            .fontSize,
        );
        const style = globalThis.getComputedStyle(empty);
        const probe = globalThis.document.createElement("span");
        probe.style.color = "var(--text-muted)";
        globalThis.document.body.append(probe);
        const muted = globalThis.getComputedStyle(probe).color;
        probe.remove();
        return {
          fontSize: parseFloat(style.fontSize),
          root,
          color: style.color,
          muted,
        };
      });
      const min = typography.root * 0.8125;
      const max = typography.root * 0.875;
      assert.ok(
        typography.fontSize + 0.05 >= min && typography.fontSize - 0.05 <= max,
        `empty tray ${typography.fontSize}px not in ${min}-${max}`,
      );
      assert.equal(typography.color, typography.muted);
      const energy = page.locator(".manual-wait[data-wait-kind='energy']");
      assert.equal(await energy.getAttribute("aria-disabled"), "true");
      const wellBefore = await page
        .locator("#manual-well-prompt")
        .textContent();
      await energy.click({ force: true });
      const announced = await page.locator("#manual-announce").textContent();
      assert.match(announced ?? "", /Already at 40\+ energy/);
      const wellAfter = await page.locator("#manual-well-prompt").textContent();
      assert.doesNotMatch(wellAfter ?? "", /Blocked/);
      assert.equal(wellAfter, wellBefore);
      const flurry = page.locator(
        ".manual-slot[data-ability-id='blade-flurry']",
      );
      if ((await flurry.count()) > 0) {
        await flurry.click();
        const chip = page.locator("#manual-buffs .manual-chip").first();
        await chip.waitFor({ state: "visible" });
        const chipBox = await chip.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const image = node.querySelector("img");
          return {
            h: box.height,
            src: image?.getAttribute("src") ?? "",
          };
        });
        assert.ok(chipBox.h + 0.01 >= TARGET_PX, `chip height ${chipBox.h}`);
        assert.match(chipBox.src, /wow\.zamimg\.com/);
      }
      await page.locator(".manual-slot").first().focus();
      await page.keyboard.press("1");
      const wellEvent = await page.locator("#manual-well-event").textContent();
      if (/Poison/.test(wellEvent ?? "")) {
        assert.doesNotMatch(wellEvent ?? "", /extra attack/);
      }
      const wellClass = await page
        .locator("#manual-well")
        .getAttribute("class");
      if (/CRIT/.test(wellEvent ?? "")) {
        assert.match(wellClass ?? "", /is-crit/);
      }
      const floatInfo = await page.evaluate(() => {
        const slots = [
          ...globalThis.document.querySelectorAll(".manual-float-slot"),
        ];
        return {
          count: slots.length,
          stacks: slots.map((slot) => ({
            stack: slot.dataset.stack,
            transform: globalThis.getComputedStyle(slot).transform,
            anim: globalThis.getComputedStyle(
              slot.querySelector(".manual-float"),
            ).animationName,
          })),
        };
      });
      assert.ok(floatInfo.count <= 3, `floats ${floatInfo.count}`);
      if (floatInfo.count > 0) {
        assert.ok(
          floatInfo.stacks.every((slot) =>
            slot.anim.includes("manual-float-rise"),
          ),
        );
      }
      for (const slot of floatInfo.stacks.filter((row) => row.stack !== "0")) {
        assert.notEqual(slot.transform, "none");
      }
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  test("Review lists fill from the fight result", async () => {
    const { context, page, errors } = await open(390);
    try {
      await page.locator("#run-duration").fill("1");
      await page.locator("#run-duration").press("Tab");
      await startManual(page);
      await page.locator(".manual-wait[data-wait-kind='time']").click();
      await page.locator(".manual-wait[data-wait-kind='time']").click();
      await page.locator("#manual-review").waitFor({ state: "visible" });
      const dps = await page.locator("#manual-review-dps").textContent();
      assert.match(dps ?? "", /DPS/);
      const breakdown = await page
        .locator("#manual-review-breakdown li")
        .count();
      const timing = await page.locator("#manual-review-timing li").count();
      assert.ok(breakdown > 0, "breakdown list was empty");
      assert.ok(timing > 0, "timing list was empty");
      const firstBreak = await page
        .locator("#manual-review-breakdown li")
        .first()
        .textContent();
      assert.match(firstBreak ?? "", /DPS/);
      const firstTime = await page
        .locator("#manual-review-timing li")
        .first()
        .textContent();
      assert.match(firstTime ?? "", /\d{2}:\d{2}\.\d /);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  });

  for (const reduced of [false, true]) {
    const label = reduced ? " (reduced motion)" : "";
    test(`Start at 360px 150% text scrolls the board into view${label}`, async () => {
      const { context, page, errors } = await open(360, {
        text: "150%",
        reduced,
      });
      try {
        await startManual(page);
        await page.waitForFunction(
          () => {
            const board = globalThis.document.getElementById("manual-board");
            const rect = board.getBoundingClientRect();
            return rect.top < globalThis.innerHeight && rect.bottom > 0;
          },
          { timeout: reduced ? 500 : 2000 },
        );
        const typography = await page.evaluate(() => {
          const empty = globalThis.document.querySelector(".manual-tray-empty");
          const root = parseFloat(
            globalThis.getComputedStyle(globalThis.document.documentElement)
              .fontSize,
          );
          const style = globalThis.getComputedStyle(empty);
          const probe = globalThis.document.createElement("span");
          probe.style.color = "var(--text-muted)";
          globalThis.document.body.append(probe);
          const muted = globalThis.getComputedStyle(probe).color;
          probe.remove();
          return {
            fontSize: parseFloat(style.fontSize),
            root,
            color: style.color,
            muted,
          };
        });
        const min = typography.root * 0.8125;
        const max = typography.root * 0.875;
        assert.ok(
          typography.fontSize + 0.05 >= min &&
            typography.fontSize - 0.05 <= max,
          `empty tray ${typography.fontSize}px not in ${min}-${max}`,
        );
        assert.equal(typography.color, typography.muted);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    });
  }
});

async function pickSubtlety(page) {
  await page.evaluate(() => {
    globalThis.location.hash = "#character";
  });
  const card = page.locator("#start-card-subtlety-daggers");
  await card.waitFor({ state: "visible" });
  await card.click();
  await page.evaluate(() => {
    globalThis.location.hash = "#fight";
  });
  await page.locator("#area-fight").waitFor({ state: "visible" });
  await page.locator("#run-button").waitFor({ state: "visible" });
}

async function pickAssassination(page) {
  await page.evaluate(() => {
    globalThis.location.hash = "#character";
  });
  const card = page.locator("#start-card-assassination-daggers");
  await card.waitFor({ state: "visible" });
  await card.click();
  await page.evaluate(() => {
    globalThis.location.hash = "#fight";
  });
  await page.locator("#area-fight").waitFor({ state: "visible" });
  await page.locator("#run-button").waitFor({ state: "visible" });
}

async function setDuration(page, seconds) {
  const duration = page.locator("#run-duration");
  if (!(await duration.isVisible())) {
    await page.locator('[data-nav-area="fight"]').click();
  }
  await duration.fill(seconds);
  await duration.press("Tab");
}

describe("arming off-GCD abilities on the board (#372)", () => {
  for (const text of ["100%", "150%"]) {
    test(`after Sinister Strike the GCD has already run out at 390px ${text} text`, async () => {
      const { context, page, errors } = await open(390, { text });
      try {
        await startManual(page);
        await page
          .locator('.manual-slot[data-ability-id="sinister-strike"]')
          .click();
        await page.waitForFunction(() =>
          (
            globalThis.document.getElementById("manual-clock")?.textContent ??
            ""
          ).startsWith("00:01.0"),
        );
        assert.equal(
          await page.locator("#manual-well-prompt").textContent(),
          "Your decision · GCD free",
        );
        assert.equal(await page.locator(".manual-continue").count(), 0);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    });

    test(`Cold Blood armed then Eviscerate land together at 390px ${text} text`, async () => {
      const { context, page, errors } = await open(390, { text });
      try {
        await pickAssassination(page);
        await startManual(page, "2");
        await page.waitForFunction(() =>
          (
            globalThis.document.getElementById("manual-clock")?.textContent ??
            ""
          ).includes("00:00.0 / 00:02"),
        );
        await page.locator('.manual-slot[data-ability-id="mutilate"]').click();
        await page.waitForFunction(() =>
          (
            globalThis.document.getElementById("manual-clock")?.textContent ??
            ""
          ).startsWith("00:01.0"),
        );
        const cold = page.locator('.manual-slot[data-ability-id="cold-blood"]');
        assert.equal(await cold.getAttribute("aria-pressed"), "false");
        await cold.click();
        assert.equal(await cold.getAttribute("aria-pressed"), "true");
        await cold.click();
        assert.equal(await cold.getAttribute("aria-pressed"), "false");
        await page.locator("#manual-well").focus();
        await page.keyboard.press("9");
        assert.equal(await cold.getAttribute("aria-pressed"), "true");
        assert.match(
          await cold.locator(".manual-slot-note").textContent(),
          /Armed/,
        );
        assert.match(await cold.getAttribute("aria-label"), /Armed/);
        assert.equal(
          await cold.evaluate((el) => el.classList.contains("is-armed")),
          true,
        );
        await page
          .locator('.manual-slot[data-ability-id="eviscerate"]')
          .click();
        await page.locator("#manual-review").waitFor({ state: "visible" });
        const timing = await page
          .locator("#manual-review-timing")
          .textContent();
        assert.match(timing, /00:00\.0\s+Mutilate/);
        assert.match(timing, /00:01\.0\s+Cold Blood/);
        assert.match(timing, /00:01\.0\s+Eviscerate/);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    });

    test(`armed Premeditation plus Wait, and un-highlight, at 390px ${text} text`, async () => {
      const { context, page, errors } = await open(390, { text });
      try {
        await pickSubtlety(page);
        await startManual(page, "1");
        await page.waitForFunction(() =>
          (
            globalThis.document.getElementById("manual-clock")?.textContent ??
            ""
          ).includes("00:00.0 / 00:01"),
        );
        const premed = page.locator(
          '.manual-slot[data-ability-id="premeditation"]',
        );
        const prep = page.locator(
          '.manual-slot[data-ability-id="preparation"]',
        );
        assert.equal(await premed.getAttribute("aria-pressed"), "false");
        assert.equal(await prep.getAttribute("aria-pressed"), null);
        await premed.click();
        assert.equal(await premed.getAttribute("aria-pressed"), "true");
        assert.match(
          await premed.locator(".manual-slot-note").textContent(),
          /Armed/,
        );
        await premed.click();
        assert.equal(await premed.getAttribute("aria-pressed"), "false");
        assert.doesNotMatch(
          await premed.locator(".manual-slot-note").textContent(),
          /Armed/,
        );
        await premed.click();
        assert.equal(await premed.getAttribute("aria-pressed"), "true");
        await page.locator("#manual-well").focus();
        await page.keyboard.press("w");
        const focused = await page.evaluate(() => {
          const el = globalThis.document.activeElement;
          return el?.classList.contains("manual-wait") === true;
        });
        assert.equal(focused, true);
        const timeWait = page.locator(".manual-wait[data-wait-kind='time']");
        await timeWait.click();
        await page.waitForFunction(() =>
          (
            globalThis.document.getElementById("manual-clock")?.textContent ??
            ""
          ).startsWith("00:00.5"),
        );
        assert.equal(await premed.getAttribute("aria-disabled"), "true");
        assert.match(await premed.getAttribute("aria-label"), /cooldown/i);
        await timeWait.click();
        await page.locator("#manual-review").waitFor({ state: "visible" });
        const timing = await page
          .locator("#manual-review-timing")
          .textContent();
        assert.match(timing, /00:00\.0\s+Premeditation/);
        assert.doesNotMatch(timing, /Preparation/);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    });

    test(`armed Premeditation then Preparation land at t=0 at 390px ${text} text`, async () => {
      const { context, page, errors } = await open(390, { text });
      try {
        await pickSubtlety(page);
        await startManual(page, "1");
        await page.waitForFunction(() =>
          (
            globalThis.document.getElementById("manual-clock")?.textContent ??
            ""
          ).includes("00:00.0 / 00:01"),
        );
        const premed = page.locator(
          '.manual-slot[data-ability-id="premeditation"]',
        );
        const prep = page.locator(
          '.manual-slot[data-ability-id="preparation"]',
        );
        await premed.click();
        assert.equal(await premed.getAttribute("aria-pressed"), "true");
        await prep.click();
        await page.locator("#manual-review").waitFor({ state: "visible" });
        const timing = await page
          .locator("#manual-review-timing")
          .textContent();
        assert.match(timing, /00:00\.0\s+Premeditation/);
        assert.match(timing, /00:00\.0\s+Preparation/);
        const premedHits = [...timing.matchAll(/00:00\.0\s+Premeditation/g)];
        assert.equal(premedHits.length, 1, timing);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    });
  }
});
