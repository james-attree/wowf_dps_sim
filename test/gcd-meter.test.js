import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { k } from "../data/constants.js";
import {
  applyGcdMeterAria,
  gcdMeterAria,
  gcdReading,
  gcdReady,
  writeAria,
} from "../js/gcd-meter.js";
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
  // What the stats form view (#151) calls while it fills itself.
  element.removeAttribute = () => {};
  element.replaceChildren = () => {};
  element.append = () => {};
  element.appendChild = (node) => node;
  return element;
}

describe("GCD meter aria attributes", () => {
  it("uses the sim GCD as the max and keeps the value inside that range", () => {
    const meter = meterElement();
    const simulation = new Simulation(new Rogue());

    applyGcdMeterAria(meter, simulation);

    assert.equal(meter.getAttribute("aria-valuemin"), null, "static (#45)");
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

  // #45 (Fran, Scout): each meter's aria-valuemax is in the markup, equal to
  // its constant, so the page need not write it every frame.
  it("the meters' static aria-valuemax equals their constants", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const meters = {
      "gcd-meter": [k("gcd.duration"), "Global cooldown remaining", "Ready"],
      "combo-meter": [k("combo.max"), "Combo points", "0 of 5"],
      "energy-meter": [k("energy.max"), "Rogue energy", "0 of 100"],
    };
    for (const [id, [max, label, text]] of Object.entries(meters)) {
      const openTag = html.match(new RegExp(`<div\\s+id="${id}"[\\s\\S]*?>`));
      assert.ok(openTag, id);
      assert.match(openTag[0], /role="meter"/);
      assert.match(openTag[0], new RegExp(`aria-label="${label}"`));
      assert.match(openTag[0], /aria-valuemin="0"/);
      assert.match(openTag[0], /aria-valuenow="0"/);
      assert.equal(
        openTag[0].match(/aria-valuemax="([^"]*)"/)?.[1],
        String(max),
        id,
      );
      assert.equal(openTag[0].match(/aria-valuetext="([^"]*)"/)?.[1], text, id);
    }
    assert.equal(k("combo.max"), 5, "the valuetext above says 5");
    assert.equal(k("energy.max"), 100, "the valuetext above says 100");
  });

  // #45 (Scout): one ready test, shared by the meter and #gcd-status, at the
  // edges of the one-decimal reading.
  it("the GCD's one ready test and its valuetext at the edges", () => {
    const edges = [
      [0, "0.0", true, "Ready"],
      [0.04, "0.0", true, "Ready"],
      [0.05, "0.1", false, "0.1 seconds remaining"],
      [0.06, "0.1", false, "0.1 seconds remaining"],
      [1.0, "1.0", false, "1 second remaining"],
      [1.5, "1.5", false, "1.5 seconds remaining"],
    ];
    for (const [remaining, reading, ready, text] of edges) {
      assert.equal(gcdReading(remaining), reading, `${remaining}`);
      assert.equal(gcdReady(remaining), ready, `${remaining}`);
      const aria = gcdMeterAria({ gcd: remaining, gcdDuration: 1.5 });
      assert.equal(aria["aria-valuenow"], reading, `${remaining}`);
      assert.equal(aria["aria-valuetext"], text, `${remaining}`);
    }
    assert.equal(gcdReading(-0.01), "0.0", "never -0.0");
    assert.equal(gcdReady(-0.01), true);
  });

  it("writes aria only when it changes, with a spoken valuetext (#45)", () => {
    const meter = meterElement({ "aria-valuemax": "1" });
    const writes = [];
    const set = meter.setAttribute;
    meter.setAttribute = (name, value) => {
      writes.push(name);
      set(name, value);
    };
    applyGcdMeterAria(meter, { gcd: 0.62, gcdDuration: 1 });
    assert.deepEqual(writes, ["aria-valuenow", "aria-valuetext"]);
    assert.equal(meter.getAttribute("aria-valuetext"), "0.6 seconds remaining");
    writes.length = 0;
    applyGcdMeterAria(meter, { gcd: 0.58, gcdDuration: 1 });
    assert.deepEqual(writes, [], "the same 0.6: nothing written");
    applyGcdMeterAria(meter, { gcd: 0.04, gcdDuration: 1 });
    assert.equal(meter.getAttribute("aria-valuetext"), "Ready");
    assert.deepEqual(gcdMeterAria({ gcd: 1, gcdDuration: 1 }), {
      "aria-valuemax": "1",
      "aria-valuenow": "1.0",
      "aria-valuetext": "1 second remaining",
    });
    writes.length = 0;
    writeAria(meter, { "aria-valuemax": 1.5 });
    writeAria(meter, { "aria-valuemax": "1.5" });
    assert.deepEqual(writes, ["aria-valuemax"]);
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
      createElement: () => pageElement(),
      // The results panel (#154) builds its body with js/svg.js toDom.
      createElementNS: () => pageElement(),
      createTextNode: (text) => ({ text }),
    };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};

    try {
      await import("../js/main.js");

      const meter = elements.get("#gcd-meter");
      assert.ok(meter);
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
