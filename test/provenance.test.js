import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONSTANTS } from "../data/constants.js";
import {
  DEFAULT_CONSTANTS_PATH,
  DEFAULT_REPORT_PATH,
  SOURCE_TAGS,
  checkProvenance,
  formatValue,
  renderProvenance,
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
  it("allows only the known source tags", () => {
    assert.deepEqual(SOURCE_TAGS, [
      "wowf-export",
      "wowf-designer",
      "classic-1.12",
      "cataclysm",
      "assumption",
      "engineering",
    ]);
  });

  it("accepts one entry for each source tag", () => {
    const constants = Object.fromEntries(
      SOURCE_TAGS.map((source, index) => [
        `example.${index}`,
        validEntry(
          source,
          source === "assumption" || source === "engineering"
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
      assert.doesNotMatch(passed.stdout, /Wrote /);
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

  it("rejects TBD in any case", () => {
    const result = checkProvenance({
      "attack.rollScale": validEntry("engineering", "TBD"),
      "log.maxEvents": validEntry("engineering", "tbd"),
      "sim.msPerSecond": validEntry("engineering", "  Tbd  "),
      "sim.tickEpsilon": validEntry(
        "engineering",
        "James, 22 Oct 2026: float tolerance",
      ),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      "attack.rollScale: placeholder ref",
      "log.maxEvents: placeholder ref",
      "sim.msPerSecond: placeholder ref",
    ]);
  });

  it("rejects a ref that contains fill in", () => {
    const result = checkProvenance({
      latency: validEntry("assumption", "James to fill in the delay"),
      "fight.duration": validEntry("assumption", "please FILL IN the length"),
      "target.level": validEntry(
        "assumption",
        "James, 22 Oct 2026: Classic raid boss is level 60 + 3",
      ),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      "latency: placeholder ref",
      "fight.duration: placeholder ref",
    ]);
  });

  it("rejects a ref that contains No recorded owner decision", () => {
    const result = checkProvenance({
      "fight.iterations": validEntry(
        "assumption",
        "No recorded owner decision as of 22 Oct 2026. Iteration count.",
      ),
      "poison.charges": validEntry(
        "assumption",
        "prefix no recorded owner decision suffix",
      ),
      "hackAndSlash.chain": validEntry(
        "assumption",
        "James, 22 Oct 2026: extra attacks do not chain",
      ),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      "fight.iterations: placeholder ref",
      "poison.charges: placeholder ref",
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
    assert.match(result.stdout, /Wrote docs\/provenance\.md\./);
    assert.equal(result.stderr, "");
    assert.equal(
      await readFile(DEFAULT_REPORT_PATH, "utf8"),
      await renderProvenance(CONSTANTS),
    );
  });
});

function sectionBody(markdown, heading) {
  const marker = `## ${heading}\n`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const rest = markdown.slice(start + marker.length);
  const next = rest.indexOf("\n## ");
  return next === -1 ? rest : rest.slice(0, next);
}

function hasRow(section, id) {
  return section.split("\n").some((line) => {
    if (!line.startsWith("|")) {
      return false;
    }
    const first = line.split(/(?<!\\)\|/)[1];
    return first !== undefined && first.trim() === `\`${id}\``;
  });
}

function unescapedPipes(line) {
  const matches = line.match(/(?<!\\)\|/g);
  return matches ? matches.length - 1 : 0;
}

describe("provenance report", () => {
  it("formats scalars and structured values without adding quotes", () => {
    assert.equal(formatValue(1e-9), "1e-9");
    assert.equal(formatValue(true), "true");
    assert.equal(formatValue("per ability"), "per ability");
    assert.equal(
      formatValue({ min: 110, max: 59, speed: 1.8 }),
      '{ "min": 110, "max": 59, "speed": 1.8 }',
    );
    assert.equal(
      formatValue([0.06, 0.12, 0.18, 0.24, 0.3]),
      "[ 0.06, 0.12, 0.18, 0.24, 0.3 ]",
    );
  });

  it("groups by source and leaves engineering off the retune list", async () => {
    const constants = {
      "energy.regenPerSecond": {
        ...validEntry(
          "wowf-export",
          "rogue.json → spell_desc[Rogue|Eviscerate|Rank 9]",
        ),
        value: 10,
        retune: true,
      },
      "dot.canCrit": {
        ...validEntry("wowf-designer", "James, 22 Oct 2026: DoTs can crit"),
        value: true,
        retune: false,
      },
      "dot.critMultiplier": {
        ...validEntry("wowf-designer", "James, 22 Oct 2026: DoTs crit at 2×"),
        value: 2,
      },
      "gcd.duration": validEntry("classic-1.12", "https://example.test/gcd"),
      "rupture.apByCP": {
        ...validEntry("cataclysm", "https://example.test/cata"),
        value: [0.06, 0.3],
      },
      "target.armor": validEntry(
        "assumption",
        "James, 22 Oct 2026: fixture armor",
      ),
      "fight.duration": {
        ...validEntry("assumption", "James, 22 Oct 2026: fixture duration"),
        retune: false,
      },
      "sim.tickEpsilon": {
        ...validEntry(
          "engineering",
          "James, 22 Oct 2026: tolerance for buffs, cooldowns, the GCD, DoT expiry, and weapon swings",
        ),
        value: 1e-9,
        retune: false,
      },
    };

    const markdown = await renderProvenance(constants);
    assert.match(markdown, /`engineering`/);
    let previous = -1;
    for (const heading of ["Retune list", ...SOURCE_TAGS]) {
      const index = markdown.indexOf(`## ${heading}\n`);
      assert.ok(index > previous, heading);
      previous = index;
    }
    assert.equal(markdown.includes("## Unrecognized"), false);

    const retune = sectionBody(markdown, "Retune list");
    assert.equal(hasRow(retune, "dot.critMultiplier"), true);
    assert.equal(hasRow(retune, "gcd.duration"), true);
    assert.equal(hasRow(retune, "rupture.apByCP"), true);
    assert.equal(hasRow(retune, "target.armor"), true);
    assert.equal(hasRow(retune, "energy.regenPerSecond"), false);
    assert.equal(hasRow(retune, "dot.canCrit"), false);
    assert.equal(hasRow(retune, "fight.duration"), false);
    assert.equal(hasRow(retune, "sim.tickEpsilon"), false);
    assert.match(
      sectionBody(markdown, "wowf-export"),
      /Rogue\\\|Eviscerate\\\|Rank 9/,
    );
    assert.match(retune, /`\[ 0\.06, 0\.3 \]`/);
    assert.match(
      sectionBody(markdown, "wowf-designer"),
      /`dot\.canCrit`[\s\S]*\| no\s*\|/,
    );
    assert.match(sectionBody(markdown, "engineering"), /\| no\s*\|/);
    assert.match(sectionBody(markdown, "wowf-export"), /\| yes\s*\|/);
  });

  it("does not drop an unknown source or treat it as a retune", async () => {
    const markdown = await renderProvenance({
      "dodge.target": {
        value: 1,
        unit: "s",
        source: "measured",
        ref: "x",
        note: "n",
        retune: true,
      },
      "energy.regen": null,
    });
    const extra = sectionBody(markdown, "Unrecognized");
    assert.equal(hasRow(extra, "dodge.target"), true);
    assert.equal(hasRow(extra, "energy.regen"), true);
    assert.equal(
      hasRow(sectionBody(markdown, "Retune list"), "dodge.target"),
      false,
    );
    assert.match(markdown, /2 unrecognized/);
  });

  it("writes the report only after the check passes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "provenance-report-"));
    const filePath = join(dir, "constants.mjs");
    const reportPath = join(dir, "provenance.md");
    const constants = {
      "dodge.target": validEntry("classic-1.12", "https://example.test/dodge"),
    };
    await writeFile(
      filePath,
      `export const CONSTANTS = ${JSON.stringify(constants)};\n`,
    );

    try {
      const written = await runProvenance(filePath, {
        writeReport: true,
        reportPath,
      });
      assert.equal(written.status, 0, written.message);
      assert.match(written.message, /Wrote /);
      assert.equal(
        await readFile(reportPath, "utf8"),
        await renderProvenance(constants),
      );

      const badPath = join(dir, "bad-constants.mjs");
      await writeFile(
        badPath,
        'export const CONSTANTS = { "dodge.target": { source: "classic", ref: "TBD" } };\n',
      );
      const badReport = join(dir, "bad.md");
      const outcome = await runProvenance(badPath, {
        writeReport: true,
        reportPath: badReport,
      });
      assert.equal(outcome.status, 1);
      assert.match(outcome.message, /placeholder ref/);
      assert.doesNotMatch(outcome.message, /Wrote /);
      await assert.rejects(access(badReport), { code: "ENOENT" });
      assert.equal(
        await readFile(reportPath, "utf8"),
        await renderProvenance(constants),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps docs/provenance.md equal to the generated report", async () => {
    const onDisk = await readFile(DEFAULT_REPORT_PATH, "utf8");
    assert.equal(onDisk, await renderProvenance(CONSTANTS));
    assert.match(onDisk, /Do not edit by hand/);
    assert.match(onDisk, /`engineering`/);

    const retune = sectionBody(onDisk, "Retune list");
    assert.equal(hasRow(retune, "dot.critMultiplier"), true);
    assert.equal(hasRow(retune, "rupture.apByCP"), true);
    assert.equal(hasRow(retune, "dot.canCrit"), false);
    assert.equal(hasRow(retune, "attack.rollScale"), false);
    assert.equal(hasRow(retune, "log.maxEvents"), false);
    assert.equal(hasRow(retune, "sim.msPerSecond"), false);
    assert.equal(hasRow(retune, "sim.tickEpsilon"), false);
    assert.equal(hasRow(retune, "rupture.apAtZeroCp"), false);

    for (const [id, entry] of Object.entries(CONSTANTS)) {
      const listed = hasRow(retune, id);
      const shouldList =
        entry.source !== "wowf-export" && entry.retune === true;
      assert.equal(listed, shouldList, id);
      assert.equal(hasRow(sectionBody(onDisk, entry.source), id), true, id);
    }

    for (const line of retune
      .split("\n")
      .filter((row) => row.startsWith("|"))) {
      assert.equal(unescapedPipes(line), 6, line.slice(0, 120));
    }
    for (const tag of SOURCE_TAGS) {
      const section = sectionBody(onDisk, tag);
      for (const line of section
        .split("\n")
        .filter((row) => row.startsWith("|"))) {
        assert.equal(unescapedPipes(line), 6, line.slice(0, 120));
      }
    }
  });
});
