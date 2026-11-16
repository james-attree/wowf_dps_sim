import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// #403: leftover component edges must use --control and keep 3:1
// against the backgrounds they actually sit on (WCAG 1.4.11). Text
// that used the same leftover hex must keep 4.5:1 on --text-muted.
// --connector-unlit stays the decorative unlit path and is not a
// component edge.

const STYLES = readFileSync(
  fileURLToPath(new URL("../styles.css", import.meta.url)),
  "utf8",
);
const ROTATION = readFileSync(
  fileURLToPath(new URL("../rotation-builder.css", import.meta.url)),
  "utf8",
);
const TREE = readFileSync(
  fileURLToPath(new URL("../talent-tree.css", import.meta.url)),
  "utf8",
);

const HEX = /^#([0-9a-fA-F]{6})$/;
const CONTROL = "#7d6c50";
const OLD_EDGE = "#54452b";
const OLD_TEXT = "#81745c";
const NON_TEXT = 3;
const TEXT = 4.5;

function srgbChannel(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const match = HEX.exec(hex);
  assert.ok(match, `not a 6-digit hex colour: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (
    0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
  );
}

export function contrastRatio(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (high + 0.05) / (low + 0.05);
}

function rootTokens(css) {
  const start = css.indexOf(":root {");
  assert.ok(start >= 0, ":root token block");
  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === "{") {
      depth += 1;
    } else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = css.slice(start, end + 1);
  const tokens = new Map();
  for (const line of block.split("\n")) {
    const match = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
    if (!match) {
      continue;
    }
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function resolve(tokens, name, seen = new Set()) {
  const raw = tokens.get(name);
  assert.ok(raw, `missing token ${name}`);
  if (HEX.test(raw)) {
    return raw.toLowerCase();
  }
  const ref = raw.match(/^var\((--[\w-]+)\)$/);
  assert.ok(ref, `${name} is not a hex or a var() alias: ${raw}`);
  assert.equal(seen.has(name), false, `token cycle at ${name}`);
  seen.add(name);
  return resolve(tokens, ref[1], seen);
}

const tokens = rootTokens(STYLES);
const control = resolve(tokens, "--control");
const muted = resolve(tokens, "--text-muted");
const page = resolve(tokens, "--page");
const surface = resolve(tokens, "--surface");
const raised = resolve(tokens, "--surface-raised");
const tooltip = resolve(tokens, "--tooltip-bg");

// Actual fills and parents the leftover edges sat on, from the component
// rules (not only the token surfaces).
const EDGE_BACKGROUNDS = Object.freeze([
  ["--page", page],
  ["--surface", surface],
  ["--surface-raised", raised],
  ["--tooltip-bg", tooltip],
  [".chip fill #15120d", "#15120d"],
  [".live-indicator.is-paused / .config-edited #292114", "#292114"],
  [".config-toast #2a2419", "#2a2419"],
  [".results-progress #120f0b", "#120f0b"],
  [".previous-label #15120e", "#15120e"],
  [".talent-rank / .talent-lock / .lg #100f0c", "#100f0c"],
  [".talent-tree / selected tab #13110d", "#13110d"],
  [".talent-cov.is-notsim #2a2112", "#2a2112"],
]);

const TEXT_BACKGROUNDS = Object.freeze([
  [".value-divider on --surface-raised", raised],
  ["inactive sort icon on --surface-raised", raised],
  ["inactive sort icon on --page", page],
]);

describe("non-text contrast of --control (#403)", () => {
  it("resolves --control to the control-border token, not the unlit path", () => {
    assert.equal(control, CONTROL);
    assert.equal(resolve(tokens, "--control-border"), CONTROL);
    assert.equal(resolve(tokens, "--connector-unlit"), OLD_EDGE.toLowerCase());
    assert.notEqual(control, resolve(tokens, "--connector-unlit"));
  });

  it("keeps at least 3:1 against every background these edges sit on", () => {
    for (const [use, background] of EDGE_BACKGROUNDS) {
      const ratio = contrastRatio(control, background);
      assert.ok(
        ratio >= NON_TEXT,
        `${use}: --control ${control} on ${background} is ${ratio.toFixed(2)}:1`,
      );
    }
  });

  it("M: reverting --control to #54452b fails the 3:1 chip check", () => {
    const chip = "#15120d";
    assert.ok(contrastRatio(control, chip) >= NON_TEXT);
    const reverted = contrastRatio(OLD_EDGE, chip);
    assert.ok(
      reverted < NON_TEXT,
      `reverted chip edge should be under 3:1, got ${reverted.toFixed(2)}:1`,
    );
    // The known leftover: 2.01:1 on the chip fill.
    assert.ok(reverted > 2 && reverted < 2.1);
  });
});

describe("text contrast of --text-muted (#403)", () => {
  it("keeps at least 4.5:1 where leftover #81745c was used as text", () => {
    for (const [use, background] of TEXT_BACKGROUNDS) {
      const ratio = contrastRatio(muted, background);
      assert.ok(
        ratio >= TEXT,
        `${use}: --text-muted ${muted} on ${background} is ${ratio.toFixed(2)}:1`,
      );
      assert.ok(
        contrastRatio(OLD_TEXT, background) < TEXT,
        `${use}: leftover #81745c was already under 4.5:1 and must not return`,
      );
    }
  });
});

describe("leftover hexes are off component edges (#403)", () => {
  const sources = [
    ["styles.css", STYLES],
    ["rotation-builder.css", ROTATION],
    ["talent-tree.css", TREE],
  ];

  it("does not hard-code #81745c", () => {
    for (const [name, css] of sources) {
      assert.doesNotMatch(css, /#81745c/i, `${name} still hard-codes #81745c`);
    }
  });

  it("keeps #54452b only as --connector-unlit", () => {
    const allowed =
      /\/\*[\s\S]*?#54452b[\s\S]*?\*\/|--connector-unlit:\s*#54452b;/gi;
    for (const [name, css] of sources) {
      const leftover = css.replaceAll(allowed, "");
      assert.doesNotMatch(
        leftover,
        /#54452b/i,
        `${name} still uses #54452b outside --connector-unlit and comments`,
      );
    }
    assert.match(STYLES, /--connector-unlit:\s*#54452b;/);
  });
});
