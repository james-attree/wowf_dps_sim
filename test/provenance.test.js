import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONSTANTS_PATH,
  SOURCE_TAGS,
  checkProvenance,
  runProvenance,
} from "../scripts/provenance.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = resolve(root, "scripts/provenance.mjs");

function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root });
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
  });
}

async function writeFixture(source) {
  const dir = await mkdtemp(join(tmpdir(), "provenance-"));
  const filePath = join(dir, "constants.mjs");
  await writeFile(filePath, source);
  return {
    filePath,
    async remove() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const validEntry = (source, ref = "https://example.test/ref") => ({
  value: 1,
  unit: "s",
  source,
  ref,
  note: "fixture",
  retune: true,
});

describe("provenance check", () => {
  it("allows only the five source tags", () => {
    assert.deepEqual(SOURCE_TAGS, [
      "wowf-export",
      "wowf-designer",
      "classic-1.12",
      "cataclysm",
      "assumption",
    ]);
  });

  it("accepts one entry for each source tag", () => {
    const constants = Object.fromEntries(
      SOURCE_TAGS.map((source, index) => [
        `example.${index}`,
        validEntry(
          source,
          source === "assumption"
            ? "James, 22 Oct 2026: fixture default"
            : `ref-${source}`,
        ),
      ]),
    );

    const result = checkProvenance(constants);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts an empty constants object", () => {
    const result = checkProvenance({});
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("fails when CONSTANTS is not a plain object", () => {
    for (const value of [undefined, null, [], "constants", 1]) {
      const result = checkProvenance(value);
      assert.equal(result.ok, false);
      assert.deepEqual(result.errors, [
        "CONSTANTS must be a plain object keyed by id",
      ]);
    }
  });

  it("fails when an entry is not an object", () => {
    const result = checkProvenance({
      "dodge.target": null,
      "energy.regen": ["wowf-export"],
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      "dodge.target: entry must be an object",
      "energy.regen: entry must be an object",
    ]);
  });

  it("fails on an unknown source and a missing ref", () => {
    const result = checkProvenance({
      "dodge.target": { source: "classic", ref: "" },
      "energy.regen": { source: "wowf-export" },
      "target.armor": { source: " assumption", ref: "   " },
      "fight.duration": { ref: "https://example.test/fight" },
      "crit.melee": { source: "classic-1.12", ref: 12 },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      'dodge.target: unknown source "classic"',
      "dodge.target: missing ref",
      "energy.regen: missing ref",
      'target.armor: unknown source " assumption"',
      "target.armor: missing ref",
      "fight.duration: unknown source undefined",
      "crit.melee: missing ref",
    ]);
  });

  it("keeps checking after one bad constant", () => {
    const result = checkProvenance({
      "gcd.duration": validEntry("classic-1.12"),
      "dot.critMultiplier": { source: "measured", ref: "James" },
      latency: validEntry("assumption", "James, 22 Oct 2026: no input delay"),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      'dot.critMultiplier: unknown source "measured"',
    ]);
  });
});

describe("provenance CLI", () => {
  it("passes a fixture and fails one with a missing ref", async () => {
    const good = await writeFixture(
      [
        "export const CONSTANTS = {",
        '  "dodge.target": {',
        '    source: "classic-1.12",',
        '    ref: "https://example.test/hit",',
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    const bad = await writeFixture(
      [
        "export const CONSTANTS = {",
        '  "dodge.target": { source: "classic-1.12", ref: "" },',
        "};",
        "",
      ].join("\n"),
    );

    try {
      const passed = await runCli([good.filePath]);
      assert.equal(passed.code, 0, passed.stderr);
      assert.match(passed.stdout, /Provenance check passed \(1 constant\)/);
      assert.equal(passed.stderr, "");

      const failed = await runCli([bad.filePath]);
      assert.equal(failed.code, 1);
      assert.equal(failed.stdout, "");
      assert.match(failed.stderr, /Provenance check failed/);
      assert.match(failed.stderr, /dodge\.target: missing ref/);
    } finally {
      await good.remove();
      await bad.remove();
    }
  });

  it("fails when the constants file is not present", async () => {
    const missing = join(tmpdir(), "provenance-missing", "constants.mjs");
    const outcome = await runProvenance(missing);
    assert.equal(outcome.status, 1);
    assert.match(outcome.message, /Provenance check failed/);
    assert.match(outcome.message, /is not present/);
    assert.doesNotMatch(outcome.message, /skipped/i);

    const cli = await runCli([missing]);
    assert.equal(cli.code, 1);
    assert.equal(cli.stdout, "");
    assert.match(cli.stderr, /is not present/);
  });

  it("rejects an empty ref and a bare dash", () => {
    const result = checkProvenance({
      "target.armor": validEntry("assumption", ""),
      "target.behind": validEntry("assumption", "   "),
      "fight.duration": validEntry("assumption", "-"),
      latency: validEntry("assumption", "–"),
      "fight.iterations": validEntry("assumption", " - "),
      "poison.charges": validEntry("assumption", " – "),
      "hackAndSlash.chain": validEntry(
        "assumption",
        "James, 22 Oct 2026: extra attacks do not chain",
      ),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      "target.armor: missing ref",
      "target.behind: missing ref",
      "fight.duration: bare dash ref",
      "latency: bare dash ref",
      "fight.iterations: bare dash ref",
      "poison.charges: bare dash ref",
    ]);
  });

  it("fails when the constants file cannot be loaded", async () => {
    const broken = await writeFixture("export const CONSTANTS = {\n");
    try {
      const result = await runCli([broken.filePath]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Failed to load/);
      assert.equal(result.stdout, "");
    } finally {
      await broken.remove();
    }
  });

  it("checks the repository constants file", async () => {
    await access(DEFAULT_CONSTANTS_PATH);
    const result = await runCli([]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /Provenance check passed \(\d+ constants\) for data\/constants\.js/,
    );
    assert.equal(result.stderr, "");
  });
});
