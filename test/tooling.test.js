import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("README and package.json agree on Node", () => {
  it("quotes the engines range exactly (#92 carry-over)", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    assert.ok(pkg.engines.node.length > 0);
    assert.ok(
      readme.includes(`\`${pkg.engines.node}\``),
      `README.md should quote the engines range ${pkg.engines.node}`,
    );
    assert.doesNotMatch(readme, /Node 20\.19\+ is the/);
  });
});

describe("dev package", () => {
  it("exposes serve, test, lint, provenance, data:refresh, golden:update, and bench with no runtime dependencies", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );

    assert.equal(pkg.private, true);
    assert.equal(pkg.type, "module");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.scripts.serve, "node scripts/serve.mjs");
    assert.equal(pkg.scripts.test, "node --test");
    // The browser tests (#204, Fran's QA of #208) sit outside test/, so
    // `npm test` never needs Chrome; CI runs them as their own step.
    assert.equal(
      pkg.scripts["test:browser"],
      'node --test "browser-tests/*.browser.mjs"',
    );
    assert.equal(
      pkg.scripts.lint,
      "eslint . --max-warnings 0 && prettier --check .",
    );
    assert.equal(pkg.scripts.provenance, "node scripts/provenance.mjs");
    assert.equal(pkg.scripts["data:refresh"], "node scripts/refresh-data.mjs");
    assert.equal(
      pkg.scripts["talents:coverage"],
      "node scripts/talent-coverage.mjs",
    );
    // Not part of test, lint, or provenance: fixtures change only on purpose.
    assert.equal(
      pkg.scripts["golden:update"],
      "node scripts/golden-update.mjs",
    );
    // Timing is machine dependent, so it is not part of test, lint, or
    // provenance either. test/bench.test.js has the CI check, with a loose bound.
    assert.equal(pkg.scripts.bench, "node scripts/bench.mjs");
    for (const name of ["test", "lint", "provenance"]) {
      assert.doesNotMatch(pkg.scripts[name], /golden|bench/);
    }
    // @eslint/js ships the recommended config; ESLint 10 does not bundle it.
    assert.deepEqual(Object.keys(pkg.devDependencies).sort(), [
      "@eslint/js",
      "eslint",
      "playwright-core",
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
