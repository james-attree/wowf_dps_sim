import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("..", import.meta.url));
const eslintBin = resolve(root, "node_modules/eslint/bin/eslint.js");
const prettierBin = resolve(root, "node_modules/prettier/bin/prettier.cjs");

function run(bin, args, stdin) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(stdin);
    }
  });
}

function lintSource(filename, source) {
  return run(
    eslintBin,
    ["--stdin", "--stdin-filename", filename, "-f", "json"],
    source,
  );
}

function ruleIds(stdout) {
  const results = JSON.parse(stdout);
  return results.flatMap((result) =>
    result.messages.map((message) => message.ruleId),
  );
}

describe("engine lint", () => {
  const engine = "js/event-engine.js";

  it("rejects a 0.065 literal in engine code", async () => {
    const initializer = await lintSource(
      engine,
      "export const dodge = 0.065;\n",
    );
    assert.equal(initializer.code, 1, initializer.stdout);
    assert.ok(
      ruleIds(initializer.stdout).includes("engine-purity/no-numeric-literal"),
    );
    assert.match(initializer.stdout, /0\.065/);

    const expression = await lintSource(
      engine,
      "export const hit = (roll) => roll < 0.065;\n",
    );
    assert.equal(expression.code, 1, expression.stdout);
    assert.ok(ruleIds(expression.stdout).includes("no-magic-numbers"));
    assert.match(expression.stdout, /0\.065/);

    const property = await lintSource(
      engine,
      "export const table = { dodge: 0.065 };\n",
    );
    assert.equal(property.code, 1, property.stdout);
    assert.ok(ruleIds(property.stdout).includes("no-magic-numbers"));
  });

  it("allows 0, 1, and -1 in engine code", async () => {
    const result = await lintSource(
      engine,
      [
        "export const values = [0, 1, -1];",
        "export const negative = -1;",
        "export const one = 1.0;",
        "export const sum = 0 + 1 - 1;",
        "",
      ].join("\n"),
    );
    assert.equal(result.code, 0, result.stdout + result.stderr);
  });

  it("rejects other numeric literals, including -2", async () => {
    const result = await lintSource(engine, "export const shifted = -2;\n");
    assert.equal(result.code, 1, result.stdout);
    assert.ok(
      ruleIds(result.stdout).includes("engine-purity/no-numeric-literal"),
    );
  });

  it("rejects document and window, including globalThis property access", async () => {
    const result = await lintSource(
      engine,
      [
        "export const node = document.body;",
        "export const view = window;",
        "export const doc = globalThis.document;",
        "export const boxed = globalThis['window'];",
        "export const fromGlobal = global.document;",
        "export const fromSelf = self.window;",
        "",
      ].join("\n"),
    );
    assert.equal(result.code, 1, result.stdout);
    const ids = ruleIds(result.stdout);
    assert.equal(ids.filter((id) => id === "no-restricted-globals").length, 6);
    assert.match(result.stdout, /must not touch this global/);
  });

  it("exempts the UI entry, constants, tests, and dev scripts", async () => {
    const cases = [
      [
        "js/main.js",
        [
          "const dodge = 0.065;",
          "const hit = dodge < 0.065;",
          "document.body.dataset.hit = String(hit);",
          "window.addEventListener('load', () => {});",
          "",
        ].join("\n"),
      ],
      [
        "data/constants.js",
        'export const CONSTANTS = { "dodge.target": { value: 0.065 } };\n',
      ],
      ["test/attack-resolver.test.js", "export const dodge = 0.065;\n"],
      ["scripts/example.mjs", "export const port = 8000;\n"],
    ];

    for (const [filename, source] of cases) {
      const result = await lintSource(filename, source);
      assert.equal(result.code, 0, `${filename}\n${result.stdout}`);
      const ids = ruleIds(result.stdout);
      assert.equal(ids.includes("no-magic-numbers"), false, filename);
      assert.equal(
        ids.includes("engine-purity/no-numeric-literal"),
        false,
        filename,
      );
      assert.equal(ids.includes("no-restricted-globals"), false, filename);
    }
  });

  it("keeps current engine files clean and fails when a new literal is added", async () => {
    const clean = await run(eslintBin, [".", "--max-warnings", "0"]);
    assert.equal(clean.code, 0, clean.stdout + clean.stderr);

    const eslint = new ESLint({ cwd: root, applySuppressions: true });
    const filePath = resolve(root, "js/attack-resolver.js");
    const source = await readFile(filePath, "utf8");
    const [current] = await eslint.lintText(source, { filePath });
    assert.deepEqual(
      current.messages.map((message) => message.ruleId),
      [],
    );

    const [added] = await eslint.lintText(
      `${source}\nexport const extraDodge = 0.065;\n`,
      { filePath },
    );
    assert.ok(
      added.messages.some(
        (message) =>
          message.ruleId === "engine-purity/no-numeric-literal" &&
          message.message.includes("0.065"),
      ),
    );

    const [compared] = await eslint.lintText(
      `${source}\nexport const extraHit = (roll) => roll < 0.065;\n`,
      { filePath },
    );
    assert.ok(
      compared.messages.some(
        (message) =>
          message.ruleId === "no-magic-numbers" &&
          message.message.includes("0.065"),
      ),
    );
  });
});

describe("prettier coverage", () => {
  it("formats simulator sources and still skips binary icons", async () => {
    const ignore = await readFile(resolve(root, ".prettierignore"), "utf8");
    const entries = ignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    assert.deepEqual(entries, ["img"]);

    const result = await run(prettierBin, ["--check", "."]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
  });
});
