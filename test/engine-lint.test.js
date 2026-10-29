import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
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

  it("rejects console output in engine code and allows it in scripts and tests", async () => {
    const engine = await lintSource(
      "js/event-engine.js",
      "export const tick = (damage) => console.log(damage);\n",
    );
    assert.equal(engine.code, 1, engine.stdout);
    assert.ok(ruleIds(engine.stdout).includes("no-console"));

    for (const filename of [
      "scripts/example.mjs",
      "test/attack-resolver.test.js",
    ]) {
      const result = await lintSource(filename, "console.log('ready');\n");
      assert.equal(
        result.code,
        0,
        `${filename}\n${result.stdout}${result.stderr}`,
      );
      assert.equal(ruleIds(result.stdout).includes("no-console"), false);
    }
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

  it("rejects performance and Date in engine code, including globalThis property access", async () => {
    const result = await lintSource(
      engine,
      [
        "export const now = performance.now();",
        "export const stamp = Date.now();",
        "export const created = new Date();",
        "export const viaGlobal = globalThis.performance.now();",
        "export const viaBracket = globalThis['Date'].now();",
        "export const viaSelf = self.performance;",
        "",
      ].join("\n"),
    );
    assert.equal(result.code, 1, result.stdout);
    const ids = ruleIds(result.stdout);
    assert.equal(ids.filter((id) => id === "no-restricted-globals").length, 6);
    assert.match(result.stdout, /must not read a wall clock/);

    for (const filename of ["js/simulation.js", "js/rogue.js", "js/rng.js"]) {
      const clock = await lintSource(
        filename,
        "export const now = performance.now();\n",
      );
      assert.equal(clock.code, 1, `${filename}\n${clock.stdout}`);
      assert.ok(ruleIds(clock.stdout).includes("no-restricted-globals"));
    }
  });

  it("rejects Math.random in engine code, however it is reached", async () => {
    const forms = [
      "export const roll = Math.random();",
      "export const bracket = Math['random']();",
      "export const viaGlobal = globalThis.Math.random();",
      "export const viaGlobalBracket = globalThis.Math['random']();",
      "export const viaSelf = self.Math.random();",
      "export const viaGlobalObject = global['Math'].random();",
      "export const { random } = Math;",
    ];
    for (const form of forms) {
      const result = await lintSource(engine, `${form}\n`);
      assert.equal(result.code, 1, `${form}\n${result.stdout}`);
      assert.ok(ruleIds(result.stdout).includes("no-restricted-syntax"), form);
      assert.match(result.stdout, /must not use Math\.random/, form);
    }

    for (const filename of ["js/simulation.js", "js/rogue.js", "js/rng.js"]) {
      const result = await lintSource(
        filename,
        "export const roll = Math.random();\n",
      );
      assert.equal(result.code, 1, `${filename}\n${result.stdout}`);
      assert.ok(ruleIds(result.stdout).includes("no-restricted-syntax"));
    }
  });

  it("allows other Math use in engine code", async () => {
    const result = await lintSource(
      engine,
      [
        "export const floor = Math.floor(rollTo(1));",
        "export const bracket = Math['max'](1, 0);",
        "export const viaGlobal = globalThis.Math.min(1, 0);",
        "export const { floor: down } = Math;",
        "export const random = (rng) => rng();",
        "export const draw = (rng) => rng.random;",
        "function rollTo(value) {",
        "  return value;",
        "}",
        "",
      ].join("\n"),
    );
    assert.equal(result.code, 0, result.stdout + result.stderr);
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
          "window.startedAt = performance.now();",
          "window.seedFallback = Math.random();",
          "",
        ].join("\n"),
      ],
      [
        "data/constants.js",
        'export const CONSTANTS = { "dodge.target": { value: 0.065 } };\n',
      ],
      ["test/attack-resolver.test.js", "export const dodge = 0.065;\n"],
      ["scripts/example.mjs", "export const port = 8000;\n"],
      ["scripts/stamp.mjs", "export const stamp = Date.now();\n"],
      ["test/clock.test.js", "export const now = Date.now();\n"],
      ["scripts/random.mjs", "export const roll = Math.random();\n"],
      ["test/random.test.js", "export const roll = Math.random();\n"],
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
      assert.equal(ids.includes("no-restricted-syntax"), false, filename);
    }
  });

  it("lets the batch worker hosts read a clock, and nothing else (#147)", async () => {
    for (const host of ["js/batch-worker.js", "js/batch-client.js"]) {
      const clock = await lintSource(
        host,
        "export const now = () => performance.now() + Date.now();\nqueueMicrotask(() => {});\nexport const url = new URL('./x.js', import.meta.url);\n",
      );
      assert.equal(clock.code, 0, `${host}\n${clock.stdout}`);
      for (const [source, rule] of [
        ["export const dodge = 0.065;\n", "engine-purity/no-numeric-literal"],
        ["export const hit = (roll) => roll < 0.065;\n", "no-magic-numbers"],
        ["document.title = 'x';\n", "no-restricted-globals"],
        ["export const w = window;\n", "no-restricted-globals"],
        ["export const r = Math.random();\n", "no-restricted-syntax"],
        ["console.log(1);\n", "no-console"],
      ]) {
        const result = await lintSource(host, source);
        assert.equal(result.code, 1, `${host}: ${source}`);
        assert.ok(ruleIds(result.stdout).includes(rule), `${host}: ${source}`);
      }
    }
    // The batch host itself is engine code: no clock.
    const engineClock = await lintSource(
      "js/batch-host.js",
      "export const now = () => performance.now();\n",
    );
    assert.equal(engineClock.code, 1);
    assert.ok(ruleIds(engineClock.stdout).includes("no-restricted-globals"));
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

describe("no display names in the engine (issue #94)", () => {
  const rule = "engine-purity/no-display-name";

  async function reported(filename, source) {
    const result = await lintSource(filename, source);
    return JSON.parse(result.stdout).flatMap((file) =>
      file.messages.filter((message) => message.ruleId === rule),
    );
  }

  it("rejects a spell name as a string, a template, or a key", async () => {
    for (const source of [
      'export const a = (x) => x.activeBuffs["Slice and Dice"];\n',
      'export const a = (x) => x.name === "Rupture";\n',
      "export const a = (x) => x.cooldowns[`Blade Flurry`];\n",
      "export const a = (x) => x.activeDots.Rupture;\n",
      "export const a = { Hemorrhage: 1 };\n",
      'export const a = ["Garrote", "Rupture"];\n',
      'export const a = (hand) => (hand === "Main-hand" ? 1 : 0);\n',
      'export const a = (x) => x.poison === "Deadly Poison";\n',
      'export const a = (x) => x.poison === "Instant Poison";\n',
      'export const a = (x) => x.poison === "Wound Poison";\n',
      "export const a = (x) => x.activeDots[`Crippling Poison`];\n",
    ]) {
      const found = await reported("js/event-engine.js", source);
      assert.ok(found.length > 0, source);
    }
  });

  it("lets an id, a class on Skills, and unrelated text through", async () => {
    for (const source of [
      'export const a = (x) => x.activeBuffs["slice-and-dice"];\n',
      "export const a = (x) => x.activeDots.rupture;\n",
      "export const a = (S) => new Skills.Rupture(S);\n",
      'export const a = "Rupture ticks";\n',
      'export const a = (x) => x.poison === "instant-poison";\n',
    ]) {
      const found = await reported("js/event-engine.js", source);
      assert.deepEqual(found, [], source);
    }
  });

  it("scans js/main.js, and leaves the definition sites alone", async () => {
    const source = 'export const a = (x) => x.cooldowns["Rupture"];\n';
    assert.ok((await reported("js/main.js", source)).length > 0);
    for (const file of ["js/auras.js", "js/weapon.js"]) {
      assert.deepEqual(await reported(file, source), [], file);
    }
  });

  it("names every spell the catalogue builds", async () => {
    const config = await import("../eslint.config.js");
    const entry = config.default.find(
      (block) => block.rules?.[rule] !== undefined,
    );
    const [, options] = entry.rules[rule];
    for (const name of ["Sinister Strike", "Eviscerate", "Slice and Dice"]) {
      assert.ok(options.names.includes(name), name);
    }
    assert.ok(options.names.includes("Main-hand"));
    assert.ok(options.names.includes("Off-hand"));
  });
});

describe("literal suppressions", () => {
  it("does not keep eslint-suppressions.json", async () => {
    await assert.rejects(access(resolve(root, "eslint-suppressions.json")), {
      code: "ENOENT",
    });
  });
});

describe("prettier coverage", () => {
  it("formats simulator sources and skips only binary icons and golden fixtures", async () => {
    const ignore = await readFile(resolve(root, ".prettierignore"), "utf8");
    const entries = ignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    // test/golden/ holds the generated one-row-per-line fixtures (#77).
    assert.deepEqual(entries, ["img", "test/golden/"]);

    const result = await run(prettierBin, ["--check", "."]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
  });
});
