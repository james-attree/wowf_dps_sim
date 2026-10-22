import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("dev package", () => {
  it("exposes serve, test, lint, provenance, and data:refresh with no runtime dependencies", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );

    assert.equal(pkg.private, true);
    assert.equal(pkg.type, "module");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.scripts.serve, "node scripts/serve.mjs");
    assert.equal(pkg.scripts.test, "node --test");
    assert.equal(
      pkg.scripts.lint,
      "eslint . --max-warnings 0 && prettier --check .",
    );
    assert.equal(pkg.scripts.provenance, "node scripts/provenance.mjs");
    assert.equal(pkg.scripts["data:refresh"], "node scripts/refresh-data.mjs");
    // @eslint/js ships the recommended config; ESLint 10 does not bundle it.
    assert.deepEqual(Object.keys(pkg.devDependencies).sort(), [
      "@eslint/js",
      "eslint",
      "prettier",
    ]);
  });

  it("keeps index.html assets on local relative URLs", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8");

    assert.match(html, /<script type="module" src="js\/main\.js"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="styles\.css" \/>/);
    assert.doesNotMatch(html, /node_modules/);
    assert.doesNotMatch(html, /\s(?:src|href)=["']\//);

    const withoutCredit = html
      .replaceAll("https://talentsforever.com/", "")
      .replaceAll("https://creativecommons.org/licenses/by/4.0/", "");
    assert.doesNotMatch(withoutCredit, /https?:/);
  });
});
