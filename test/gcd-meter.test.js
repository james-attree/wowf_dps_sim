import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { k } from "../data/constants.js";
import { applyGcdMeterAria } from "../js/gcd-meter.js";
import { Rogue } from "../js/rogue.js";
import { Simulation } from "../js/simulation.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function meterElement(initial = {}) {
  const attributes = new Map(Object.entries(initial));
  return {
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
  };
}

function pageElement() {
  const element = meterElement();
  element.style = {};
  element.classList = { toggle() {} };
  element.value = "";
  element.textContent = "";
  element.hidden = false;
  element.children = [];
  element.addEventListener = () => {};
  return element;
}

describe("GCD meter aria attributes", () => {
  it("uses the sim GCD as the max and keeps the value inside that range", () => {
    const meter = meterElement();
    const simulation = new Simulation(new Rogue());
    simulation.lastFrameTime = 0;

    applyGcdMeterAria(meter, simulation);

    assert.equal(meter.getAttribute("aria-valuemin"), "0");
    assert.equal(
      meter.getAttribute("aria-valuemax"),
      String(simulation.gcdDuration),
    );
    assert.equal(
      meter.getAttribute("aria-valuemax"),
      String(k("gcd.duration")),
    );
    assert.equal(
      meter.getAttribute("aria-valuenow"),
      simulation.gcd.toFixed(1),
    );
    assert.equal(Number(meter.getAttribute("aria-valuenow")), 0);

    simulation.gcd = simulation.gcdDuration;
    applyGcdMeterAria(meter, simulation);
    assert.equal(
      Number(meter.getAttribute("aria-valuenow")),
      Number(meter.getAttribute("aria-valuemax")),
    );

    // A different sim duration must move the max. A literal would stay put.
    simulation.gcdDuration = k("gcd.duration") + k("gcd.duration");
    simulation.gcd = k("gcd.duration");
    applyGcdMeterAria(meter, simulation);
    assert.equal(
      meter.getAttribute("aria-valuemax"),
      String(simulation.gcdDuration),
    );
    assert.notEqual(
      meter.getAttribute("aria-valuemax"),
      String(k("gcd.duration")),
    );
    assert.ok(
      Number(meter.getAttribute("aria-valuenow")) <=
        Number(meter.getAttribute("aria-valuemax")),
    );
    assert.ok(Number(meter.getAttribute("aria-valuenow")) >= 0);
  });

  it("does not hardcode a range on the GCD meter", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const openTag = html.match(/<div\s+id="gcd-meter"[\s\S]*?>/);

    assert.ok(openTag);
    assert.match(openTag[0], /role="meter"/);
    assert.match(openTag[0], /aria-label="Global cooldown remaining"/);
    assert.match(openTag[0], /aria-valuemin="0"/);
    assert.match(openTag[0], /aria-valuenow="0"/);
    assert.doesNotMatch(openTag[0], /aria-valuemax/);
    assert.doesNotMatch(openTag[0], /1\.5/);
  });

  it("sets aria-valuemax from the simulation GCD at startup", async () => {
    const elements = new Map();
    const previousDocument = globalThis.document;
    const previousFrame = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    globalThis.document = {
      querySelector(selector) {
        if (!elements.has(selector)) {
          elements.set(selector, pageElement());
        }
        return elements.get(selector);
      },
      querySelectorAll() {
        return [];
      },
    };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};

    try {
      await import("../js/main.js");

      const meter = elements.get("#gcd-meter");
      assert.ok(meter);
      assert.equal(meter.getAttribute("aria-valuemin"), "0");
      assert.equal(
        meter.getAttribute("aria-valuemax"),
        String(k("gcd.duration")),
      );
      assert.equal(meter.getAttribute("aria-valuenow"), "0.0");
    } finally {
      if (previousDocument === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = previousDocument;
      }
      if (previousFrame === undefined) {
        delete globalThis.requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = previousFrame;
      }
      if (previousCancel === undefined) {
        delete globalThis.cancelAnimationFrame;
      } else {
        globalThis.cancelAnimationFrame = previousCancel;
      }
    }
  });
});
