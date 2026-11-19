import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// #403 / #412: leftover component edges must resolve to a colour that
// keeps 3:1 against the background they sit on (WCAG 1.4.11). Text that
// used the leftover hex must keep 4.5:1. --connector-unlit stays the
// decorative unlit path and is not a component edge.
//
// #412 (Kira N1): comments are stripped one at a time, so a match can
// never span from an earlier /* across a rule to a later */.
// #412 (Kira N2): each guarded rule's edge or foreground is resolved
// (following var() through custom properties) rather than banning only
// the two old hexes.
//
// #287 PR 2 (Kira's #413 N1): status chip and rule borders resolve
// through --ok-border, --error-border and --warning-border, and stay
// at least 3:1 against their fill, the card, and the page.

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

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const CONTROL = "#7d6c50";
const OLD_EDGE = "#54452b";
const NON_TEXT = 3;
const TEXT = 4.5;

const FILES = Object.freeze({
  "styles.css": STYLES,
  "rotation-builder.css": ROTATION,
  "talent-tree.css": TREE,
});

// One comment at a time: *? ends at the first */, so a comment can never
// start at an earlier /* and swallow a later rule to a later */ (#412 N1).
const ONE_COMMENT = /\/\*[\s\S]*?\*\//g;

export function stripComments(css) {
  return css.replace(ONE_COMMENT, "");
}

function srgbChannel(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function expandHex(value) {
  const match = HEX.exec(value.trim());
  if (!match) {
    return null;
  }
  const digits = match[1];
  if (digits.length === 6) {
    return `#${digits.toLowerCase()}`;
  }
  const [r, g, b] = digits;
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

function luminance(hex) {
  const expanded = expandHex(hex);
  assert.ok(expanded, `not a hex colour: ${hex}`);
  const n = Number.parseInt(expanded.slice(1), 16);
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

function cssTokens(value) {
  const parts = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /\s/.test(value[i])) {
      i += 1;
    }
    if (i >= value.length) {
      break;
    }
    if (value.startsWith("var(", i)) {
      let depth = 0;
      let j = i;
      for (; j < value.length; j += 1) {
        if (value[j] === "(") {
          depth += 1;
        } else if (value[j] === ")") {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      parts.push(value.slice(i, j));
      i = j;
    } else {
      let j = i;
      while (j < value.length && !/\s/.test(value[j])) {
        j += 1;
      }
      parts.push(value.slice(i, j));
      i = j;
    }
  }
  return parts;
}

function colourToken(value) {
  for (const part of cssTokens(value).toReversed()) {
    if (part.startsWith("var(") || expandHex(part)) {
      return part;
    }
  }
  return null;
}

function rootTokens(css) {
  const start = css.indexOf(":root {");
  assert.ok(start >= 0, ":root token block is missing from styles.css");
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
  const block = stripComments(css.slice(start, end + 1));
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

export function resolveColor(value, tokens, seen = new Set()) {
  const trimmed = value.trim();
  const hex = expandHex(trimmed);
  if (hex) {
    return hex;
  }
  const ref = trimmed.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\s*\)$/s);
  assert.ok(ref, `cannot resolve colour ${JSON.stringify(value)}`);
  const name = ref[1];
  const fallback = ref[2];
  if (tokens.has(name)) {
    assert.equal(seen.has(name), false, `token cycle at ${name}`);
    seen.add(name);
    return resolveColor(tokens.get(name), tokens, seen);
  }
  assert.ok(fallback !== undefined, `custom property ${name} is not defined`);
  return resolveColor(fallback.trim(), tokens, seen);
}

function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const char = prelude[i];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(prelude.slice(start).trim());
  return parts.filter((part) => part !== "");
}

function parseDeclarations(body) {
  const decls = new Map();
  for (const part of body.split(";")) {
    const cut = part.indexOf(":");
    if (cut < 0) {
      continue;
    }
    const property = part.slice(0, cut).trim().toLowerCase();
    const value = part.slice(cut + 1).trim();
    if (property === "" || property.includes("{") || value.includes("{")) {
      continue;
    }
    decls.set(property, value);
  }
  return decls;
}

function walkRules(css, rules = []) {
  let i = 0;
  const length = css.length;
  while (i < length) {
    while (i < length && /\s/.test(css[i])) {
      i += 1;
    }
    if (i >= length) {
      break;
    }
    const open = css.indexOf("{", i);
    if (open < 0) {
      break;
    }
    const prelude = css.slice(i, open).trim();
    let depth = 0;
    let close = open;
    for (let at = open; at < length; at += 1) {
      if (css[at] === "{") {
        depth += 1;
      } else if (css[at] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = at;
          break;
        }
      }
    }
    const body = css.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      const kind = prelude.split(/\s+/, 1)[0];
      if (
        kind === "@media" ||
        kind === "@container" ||
        kind === "@supports" ||
        kind === "@layer"
      ) {
        walkRules(body, rules);
      }
    } else if (prelude !== "") {
      rules.push({
        selectors: splitSelectors(prelude),
        decls: parseDeclarations(body),
      });
    }
    i = close + 1;
  }
  return rules;
}

function declarationsFor(css, selector) {
  const rules = walkRules(stripComments(css));
  const merged = new Map();
  let found = false;
  for (const rule of rules) {
    if (rule.selectors.includes(selector)) {
      found = true;
      for (const [property, value] of rule.decls) {
        merged.set(property, value);
      }
    }
  }
  return found ? merged : null;
}

function declaredEdge(decls) {
  if (decls.has("border-color")) {
    return decls.get("border-color");
  }
  if (decls.has("border-top-color")) {
    return decls.get("border-top-color");
  }
  for (const property of [
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
  ]) {
    if (decls.has(property)) {
      const colour = colourToken(decls.get(property));
      if (colour) {
        return colour;
      }
    }
  }
  return null;
}

function declaredFill(decls) {
  const raw = decls.get("background-color") ?? decls.get("background");
  if (!raw) {
    return null;
  }
  return colourToken(raw);
}

// Each row of the #403 contrast table. `background` is the fill or the
// parent immediately behind the edge when the rule itself has no fill.
const EDGE_RULES = Object.freeze([
  {
    name: ".chip",
    selector: ".chip",
    file: "rotation-builder.css",
    background: "#15120d",
  },
  {
    name: ".chip.is-alt",
    selector: ".chip.is-alt",
    file: "rotation-builder.css",
    background: "#15120d",
  },
  {
    name: ".chip.is-skip",
    selector: ".chip.is-skip",
    file: "rotation-builder.css",
    background: "#15120d",
  },
  {
    name: ".chip.is-ok",
    selector: ".chip.is-ok",
    file: "rotation-builder.css",
    background: "#15120d",
    against: ["var(--surface-raised)", "var(--page)"],
  },
  {
    name: ".chip.is-error",
    selector: ".chip.is-error",
    file: "rotation-builder.css",
    background: "#2a1613",
    against: ["var(--surface-raised)", "var(--page)"],
  },
  {
    name: ".chip.is-warning",
    selector: ".chip.is-warning",
    file: "rotation-builder.css",
    background: "#2a2112",
    against: ["var(--surface-raised)", "var(--page)"],
  },
  {
    name: ".rule.has-error",
    selector: ".rule.has-error",
    file: "rotation-builder.css",
    background: "var(--surface-raised)",
    against: ["var(--page)"],
  },
  {
    name: ".rule.has-warning",
    selector: ".rule.has-warning",
    file: "rotation-builder.css",
    background: "var(--surface-raised)",
    against: ["var(--page)"],
  },
  {
    name: ".cond.has-error",
    selector: ".cond.has-error",
    file: "rotation-builder.css",
    background: "var(--surface)",
    against: ["var(--page)"],
  },
  {
    name: ".rot-banner.is-error",
    selector: ".rot-banner.is-error",
    file: "rotation-builder.css",
    background: "#2a1613",
    against: ["var(--surface-raised)", "var(--page)"],
  },
  {
    name: ".rot-banner.is-warning",
    selector: ".rot-banner.is-warning",
    file: "rotation-builder.css",
    background: "#2a2112",
    against: ["var(--surface-raised)", "var(--page)"],
  },
  {
    name: ".rule-icon",
    selector: ".rule-icon",
    file: "rotation-builder.css",
    background: "var(--surface-raised)",
  },
  {
    name: ".live-indicator.is-paused",
    selector: ".live-indicator.is-paused",
    file: "styles.css",
    background: "#292114",
  },
  {
    name: ".config-edited",
    selector: ".config-edited",
    file: "styles.css",
    background: "#292114",
  },
  {
    name: ".config-toast",
    selector: ".config-toast",
    file: "styles.css",
    background: "#2a2419",
  },
  {
    name: ".talent-rank",
    selector: ".talent-rank",
    file: "talent-tree.css",
    background: "#100f0c",
  },
  {
    name: ".talent-lock",
    selector: ".talent-lock",
    file: "talent-tree.css",
    background: "#100f0c",
  },
  {
    name: ".lg",
    selector: ".lg",
    file: "talent-tree.css",
    background: "#100f0c",
  },
  {
    name: ".tag-noDps",
    selector: ".tag-noDps",
    file: "talent-tree.css",
    background: "var(--tooltip-bg)",
  },
  {
    name: ".tag-classic",
    selector: ".tag-classic",
    file: "talent-tree.css",
    background: "var(--tooltip-bg)",
  },
  {
    name: ".talents-tab-points",
    selector: ".talents-tab-points",
    file: "talent-tree.css",
    background: "#13110d",
  },
  {
    name: ".talent-cov.is-notsim",
    selector: ".talent-cov.is-notsim",
    file: "talent-tree.css",
    background: "#2a2112",
  },
  {
    name: ".lg-cov.is-notsim",
    selector: ".lg-cov.is-notsim",
    file: "talent-tree.css",
    background: "#2a2112",
  },
  {
    name: ".results-progress",
    selector: ".results-progress progress",
    file: "styles.css",
    background: "#120f0b",
  },
  {
    name: ".previous-label",
    selector: ".previous-label",
    file: "styles.css",
    background: "#15120e",
  },
]);

const TEXT_RULES = Object.freeze([
  {
    name: ".value-divider",
    selector: ".value-divider",
    file: "styles.css",
    background: "var(--surface-raised)",
  },
  {
    name: "inactive sort icon",
    selector: 'th[aria-sort="none"] .sort-icon::after',
    file: "styles.css",
    background: "var(--surface-raised)",
  },
]);

function ruleColour(files, tokens, rule, kind) {
  const css = files[rule.file];
  assert.ok(css !== undefined, `no CSS loaded for ${rule.file}`);
  const decls = declarationsFor(css, rule.selector);
  assert.ok(
    decls,
    `guarded rule ${rule.name} (${rule.selector}) was not found in ${rule.file}`,
  );
  const raw =
    kind === "text" ? (decls.get("color") ?? null) : declaredEdge(decls);
  assert.ok(
    raw,
    `guarded rule ${rule.name} (${rule.selector}) has no ${kind === "text" ? "foreground" : "edge"} colour in ${rule.file}`,
  );
  const foreground = resolveColor(raw, tokens);
  const fill = declaredFill(decls);
  const background = resolveColor(fill ?? rule.background, tokens);
  return {
    foreground,
    background,
    raw,
    ratio: contrastRatio(foreground, background),
  };
}

function edgeProblems(files) {
  const tokens = rootTokens(files["styles.css"]);
  const problems = [];
  for (const rule of EDGE_RULES) {
    try {
      const { foreground, background, raw, ratio } = ruleColour(
        files,
        tokens,
        rule,
        "edge",
      );
      if (ratio < NON_TEXT) {
        problems.push(
          `${rule.name}: resolved ${raw} → ${foreground} on ${background} is ${ratio.toFixed(2)}:1 (need ${NON_TEXT}:1)`,
        );
      }
      for (const extra of rule.against ?? []) {
        const adjacent = resolveColor(extra, tokens);
        const adjacentRatio = contrastRatio(foreground, adjacent);
        if (adjacentRatio < NON_TEXT) {
          problems.push(
            `${rule.name}: resolved ${raw} → ${foreground} on adjacent ${adjacent} is ${adjacentRatio.toFixed(2)}:1 (need ${NON_TEXT}:1)`,
          );
        }
      }
    } catch (error) {
      problems.push(`${rule.name}: ${error.message}`);
    }
  }
  return problems;
}

function textProblems(files) {
  const tokens = rootTokens(files["styles.css"]);
  const problems = [];
  for (const rule of TEXT_RULES) {
    try {
      const { foreground, background, raw, ratio } = ruleColour(
        files,
        tokens,
        rule,
        "text",
      );
      if (ratio < TEXT) {
        problems.push(
          `${rule.name}: resolved ${raw} → ${foreground} on ${background} is ${ratio.toFixed(2)}:1 (need ${TEXT}:1)`,
        );
      }
    } catch (error) {
      problems.push(`${rule.name}: ${error.message}`);
    }
  }
  return problems;
}

const tokens = rootTokens(STYLES);
const control = resolveColor("var(--control)", tokens);

describe("comment stripping (#412 N1)", () => {
  it("strips one comment at a time and cannot span across comments", () => {
    const css = `/* earlier note */
.rule-icon {
  border: 1px solid #54452b;
}
/* historical: was #54452b */
`;
    const stripped = stripComments(css);
    assert.match(
      stripped,
      /border:\s*1px solid #54452b/,
      "a hex between two comments must remain after stripping",
    );
    assert.doesNotMatch(stripped, /\/\*/);
    // The #403 allow-regex lazily ran from any earlier /* to a later */,
    // so it swallowed the rule's hex as if it were inside a comment.
    const spanning = /\/\*[\s\S]*?#54452b[\s\S]*?\*\//gi;
    assert.doesNotMatch(
      css.replaceAll(spanning, ""),
      /#54452b/,
      "sanity: the old spanning regex would have hidden this hex",
    );
  });
});

describe("resolved edge colours (#412 N2 / #403)", () => {
  it("resolves --control to the control-border token, not the unlit path", () => {
    assert.equal(control, CONTROL);
    assert.equal(resolveColor("var(--control-border)", tokens), CONTROL);
    assert.equal(resolveColor("var(--connector-unlit)", tokens), OLD_EDGE);
    assert.notEqual(control, resolveColor("var(--connector-unlit)", tokens));
  });

  it("resolves status borders through the shared tokens (#287 PR 2)", () => {
    assert.equal(resolveColor("var(--ok-border)", tokens), "#5e7149");
    assert.equal(resolveColor("var(--error-border)", tokens), "#9f564e");
    assert.equal(resolveColor("var(--warning-border)", tokens), "#866a34");
  });

  it("every guarded edge is at least 3:1 against that rule's background", () => {
    const problems = edgeProblems(FILES);
    assert.deepEqual(problems, [], problems.join("\n"));
  });

  it("every guarded text use is at least 4.5:1 against that rule's background", () => {
    const problems = textProblems(FILES);
    assert.deepEqual(problems, [], problems.join("\n"));
  });

  it("fails loudly when a guarded rule is missing", () => {
    const files = {
      ...FILES,
      "rotation-builder.css": FILES["rotation-builder.css"].replaceAll(
        /\.chip\s*\{[\s\S]*?\n\}/g,
        "",
      ),
    };
    const problems = edgeProblems(files);
    assert.ok(
      problems.some((line) => /chip/i.test(line) && /not found/i.test(line)),
      `expected a missing .chip rule, got:\n${problems.join("\n")}`,
    );
  });
});

describe("Kira's mutants now fail (#412)", () => {
  it("M: #54452b back on .rule-icon fails the resolved 3:1 check", () => {
    const source = FILES["rotation-builder.css"];
    const mutated = source.replace(
      ".rule-icon {\n  margin-top: 6px;\n  border-radius: 6px;\n  border: 1px solid var(--control);\n}",
      ".rule-icon {\n  margin-top: 6px;\n  border-radius: 6px;\n  border: 1px solid #54452b;\n}",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({
      ...FILES,
      "rotation-builder.css": mutated,
    });
    assert.ok(
      problems.some((line) => line.includes(".rule-icon") && /3:1/.test(line)),
      `expected a 3:1 failure for .rule-icon, got:\n${problems.join("\n")}`,
    );
  });

  it("M: #3a3020 on .tag-classic fails the resolved 3:1 check", () => {
    const source = FILES["talent-tree.css"];
    const mutated = source.replace(
      ".tag-classic {\n  border-color: var(--control);\n",
      ".tag-classic {\n  border-color: #3a3020;\n",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({ ...FILES, "talent-tree.css": mutated });
    assert.ok(
      problems.some(
        (line) => line.includes(".tag-classic") && /3:1/.test(line),
      ),
      `expected a 3:1 failure for .tag-classic, got:\n${problems.join("\n")}`,
    );
  });

  it("M: var(--connector-unlit) on .live-indicator.is-paused fails the resolved 3:1 check", () => {
    const source = FILES["styles.css"];
    const mutated = source.replace(
      ".live-indicator.is-paused {\n  border-color: var(--control);\n",
      ".live-indicator.is-paused {\n  border-color: var(--connector-unlit);\n",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({ ...FILES, "styles.css": mutated });
    assert.ok(
      problems.some(
        (line) =>
          line.includes(".live-indicator.is-paused") && /3:1/.test(line),
      ),
      `expected a 3:1 failure for .live-indicator.is-paused, got:\n${problems.join("\n")}`,
    );
  });

  it("M: a deleted .chip border rule fails loudly", () => {
    const source = FILES["rotation-builder.css"];
    const mutated = source.replace(
      "  border: 1px solid var(--control);\n  border-radius: 999px;\n  background: #15120d;\n",
      "  border-radius: 999px;\n  background: #15120d;\n",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({
      ...FILES,
      "rotation-builder.css": mutated,
    });
    assert.ok(
      problems.some(
        (line) => /chip/i.test(line) && /no edge colour|not found/i.test(line),
      ),
      `expected a missing .chip edge colour, got:\n${problems.join("\n")}`,
    );
  });
});

describe("status border mutants now fail (#287 PR 2 / #413 N1)", () => {
  it("M: #4a5a37 back on .chip.is-ok fails the resolved 3:1 check", () => {
    const source = FILES["rotation-builder.css"];
    const mutated = source.replace(
      ".chip.is-ok {\n  color: #b9d99a;\n  border-color: var(--ok-border);\n}",
      ".chip.is-ok {\n  color: #b9d99a;\n  border-color: #4a5a37;\n}",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({
      ...FILES,
      "rotation-builder.css": mutated,
    });
    assert.ok(
      problems.some((line) => line.includes(".chip.is-ok") && /3:1/.test(line)),
      `expected a 3:1 failure for .chip.is-ok, got:\n${problems.join("\n")}`,
    );
  });

  it("M: #7a3b34 back on .chip.is-error fails the resolved 3:1 check", () => {
    const source = FILES["rotation-builder.css"];
    const mutated = source.replace(
      ".chip.is-error {\n  color: #f19389;\n  border-color: var(--error-border);\n",
      ".chip.is-error {\n  color: #f19389;\n  border-color: #7a3b34;\n",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({
      ...FILES,
      "rotation-builder.css": mutated,
    });
    assert.ok(
      problems.some(
        (line) => line.includes(".chip.is-error") && /3:1/.test(line),
      ),
      `expected a 3:1 failure for .chip.is-error, got:\n${problems.join("\n")}`,
    );
  });

  it("M: #6b5426 back on .chip.is-warning fails the resolved 3:1 check", () => {
    const source = FILES["rotation-builder.css"];
    const mutated = source.replace(
      ".chip.is-warning {\n  color: #f0c46a;\n  border-color: var(--warning-border);\n",
      ".chip.is-warning {\n  color: #f0c46a;\n  border-color: #6b5426;\n",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({
      ...FILES,
      "rotation-builder.css": mutated,
    });
    assert.ok(
      problems.some(
        (line) => line.includes(".chip.is-warning") && /3:1/.test(line),
      ),
      `expected a 3:1 failure for .chip.is-warning, got:\n${problems.join("\n")}`,
    );
  });

  it("M: #7a3b34 back on .rule.has-error fails the resolved 3:1 check", () => {
    const source = FILES["rotation-builder.css"];
    const mutated = source.replace(
      ".rule.has-error {\n  border-color: var(--error-border);\n}",
      ".rule.has-error {\n  border-color: #7a3b34;\n}",
    );
    assert.notEqual(mutated, source);
    const problems = edgeProblems({
      ...FILES,
      "rotation-builder.css": mutated,
    });
    assert.ok(
      problems.some(
        (line) => line.includes(".rule.has-error") && /3:1/.test(line),
      ),
      `expected a 3:1 failure for .rule.has-error, got:\n${problems.join("\n")}`,
    );
  });
});

describe("leftover hexes after per-comment stripping (#403 / #412 N1)", () => {
  it("does not hard-code #81745c outside comments", () => {
    for (const [name, css] of Object.entries(FILES)) {
      assert.doesNotMatch(
        stripComments(css),
        /#81745c/i,
        `${name} still hard-codes #81745c`,
      );
    }
  });

  it("does not hard-code the old status borders outside comments", () => {
    for (const [name, css] of Object.entries(FILES)) {
      const leftover = stripComments(css);
      assert.doesNotMatch(
        leftover,
        /#4a5a37|#7a3b34|#6b5426/i,
        `${name} still hard-codes an old status border`,
      );
    }
  });

  it("keeps #54452b only as --connector-unlit", () => {
    for (const [name, css] of Object.entries(FILES)) {
      const leftover = stripComments(css).replace(
        /--connector-unlit:\s*#54452b;/g,
        "",
      );
      assert.doesNotMatch(
        leftover,
        /#54452b/i,
        `${name} still uses #54452b outside --connector-unlit`,
      );
    }
    assert.match(STYLES, /--connector-unlit:\s*#54452b;/);
  });
});
