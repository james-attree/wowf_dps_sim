import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(
  fileURLToPath(new URL("../gear-screen.css", import.meta.url)),
  "utf8",
);

// The stacked-list @container (Fran's P3) is the one that resets
// .gear-slots-right .gear-row. A later wrap-only @container must not
// be mistaken for it (Kira N2).
function stackedContainerIndex(css) {
  const marker = ".gear-slots-right .gear-row";
  const query = "@container gear (width < 20rem)";
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf(query, from);
    if (start < 0) {
      return -1;
    }
    let depth = 0;
    let end = css.indexOf("{", start);
    for (let i = end; i < css.length; i += 1) {
      depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (css.slice(start, end + 1).includes(marker)) {
      return start;
    }
    from = start + query.length;
  }
  return -1;
}

function mediaIndex(css) {
  return css.indexOf("@media (width < 64em)");
}

function swapStackedAboveMedia(css) {
  const media = mediaIndex(css);
  const container = stackedContainerIndex(css);
  const mediaOpen = css.indexOf("{", media);
  let depth = 0;
  let mediaEnd = mediaOpen;
  for (let i = mediaOpen; i < css.length; i += 1) {
    depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    if (depth === 0) {
      mediaEnd = i;
      break;
    }
  }
  let cDepth = 0;
  const cOpen = css.indexOf("{", container);
  let cEnd = cOpen;
  for (let i = cOpen; i < css.length; i += 1) {
    cDepth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    if (cDepth === 0) {
      cEnd = i;
      break;
    }
  }
  const mediaBlock = css.slice(media, mediaEnd + 1);
  const containerBlock = css.slice(container, cEnd + 1);
  return (
    css.slice(0, media) +
    containerBlock +
    css.slice(mediaEnd + 1, container) +
    mediaBlock +
    css.slice(cEnd + 1)
  );
}

describe("stacked-list @container source order (Kira N2, #385)", () => {
  it("the @container that resets .gear-slots-right .gear-row is after the <64em media rule", () => {
    const media = mediaIndex(CSS);
    const container = stackedContainerIndex(CSS);
    assert.ok(media >= 0, "the <64em media rule is present");
    assert.ok(container >= 0, "the stacked-list @container is present");
    assert.ok(
      container > media,
      "the stacked-list @container must follow @media (width < 64em)",
    );
  });

  it("M: moving that @container above the <64em media rule fails the order check", () => {
    const mutant = swapStackedAboveMedia(CSS);
    assert.notEqual(mutant, CSS);
    const media = mediaIndex(mutant);
    const container = stackedContainerIndex(mutant);
    assert.ok(media >= 0 && container >= 0);
    assert.ok(
      container < media,
      "the mutant places the stacked-list @container first",
    );
    assert.equal(
      container > media,
      false,
      "the production predicate fails on the mutant",
    );
  });
});
