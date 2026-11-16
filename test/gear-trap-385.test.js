import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const VIEW = readFileSync(
  fileURLToPath(new URL("../js/views/gear-screen.js", import.meta.url)),
  "utf8",
);
const STYLES = readFileSync(
  fileURLToPath(new URL("../styles.css", import.meta.url)),
  "utf8",
);
const GEAR_CSS = readFileSync(
  fileURLToPath(new URL("../gear-screen.css", import.meta.url)),
  "utf8",
);

const TAB_WRAP =
  /else if \(!event\.shiftKey && doc\.activeElement === last\) \{\s*event\.preventDefault\(\);\s*first\.focus\(\);\s*\}/;
const SHIFT_WRAP =
  /if \(event\.shiftKey && doc\.activeElement === first\) \{\s*event\.preventDefault\(\);\s*last\.focus\(\);\s*\}/;

describe("phone picker focus trap source (Kira N1, #385)", () => {
  it("the picker traps Tab from the last control and Shift+Tab from the first", () => {
    assert.match(VIEW, TAB_WRAP);
    assert.match(VIEW, SHIFT_WRAP);
    assert.match(
      VIEW,
      /event\.key !== KEY\.tab \|\| picker\.hidden \|\| !phonePicker\(\)/,
    );
  });

  it("M: deleting the Tab wrap fails the trap predicate", () => {
    assert.match(VIEW, TAB_WRAP);
    const mutant = VIEW.replace(TAB_WRAP, "");
    assert.notEqual(mutant, VIEW);
    assert.doesNotMatch(mutant, TAB_WRAP);
    assert.match(
      mutant,
      SHIFT_WRAP,
      "Shift+Tab is still there; only Tab was cut",
    );
  });
});

describe("the cramped phone stats summary is gone (#385)", () => {
  it("styles.css has no 0.65rem rule and no #character-stats-summary size override", () => {
    assert.doesNotMatch(STYLES, /0\.65rem/);
    assert.doesNotMatch(STYLES, /#character-stats-summary\s*\{[^}]*font-size/);
  });

  it("the 3-column doll does not mid-word wrap; anywhere is only in the stacked blocks", () => {
    const anywhere = [];
    const needle = "overflow-wrap: anywhere";
    let from = 0;
    while (from < GEAR_CSS.length) {
      const at = GEAR_CSS.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      anywhere.push(at);
      from = at + needle.length;
    }
    assert.ok(anywhere.length >= 1, "stacked layouts still mid-word wrap");
    const media = GEAR_CSS.indexOf("@media (width < 64em)");
    const lastContainer = GEAR_CSS.lastIndexOf(
      "@container gear (width < 20rem)",
    );
    for (const at of anywhere) {
      assert.ok(
        at > media,
        "overflow-wrap: anywhere is not on the default 3-column doll",
      );
      const before = GEAR_CSS.lastIndexOf("@", at);
      const query = GEAR_CSS.slice(before, at);
      assert.ok(
        query.includes("@media (width < 64em)") ||
          query.includes("@container gear (width < 20rem)") ||
          at > lastContainer,
        "anywhere only appears inside a stacked query",
      );
    }
  });
});
