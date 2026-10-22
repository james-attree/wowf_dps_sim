import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CREDIT_URL,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_SNAPSHOT_PATH,
  EXPORT_URL,
  HELP_TEXT,
  LICENSE,
  LICENSE_URL,
  assertSnapshot,
  buildManifest,
  collectSpells,
  collectTalents,
  diffSnapshot,
  formatSnapshot,
  parseArgs,
  poisonNames,
  readBuild,
  refreshData,
  spellNameFromKey,
  utcDate,
} from "../scripts/refresh-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = resolve(root, "scripts/refresh-data.mjs");

function talent(name, extra = {}) {
  return { name, max: 1, row: 1, col: 1, desc: ["Rank one."], ...extra };
}

function snapshot(overrides = {}) {
  const spellDesc = {
    "Rogue|Sinister Strike|Rank 8": {
      d: "An instant strike that causes 68 damage.",
    },
    "Rogue|Instant Poison|Rank 6": {
      d: "20% chance, 76 to 100 Nature damage.",
    },
    ...(overrides.spellDesc ?? {}),
  };
  return {
    _readme: "talentsforever.com data under CC BY 4.0",
    generated: "2026-10-20",
    class: "Rogue",
    talents: {
      source: "Talent trees from build 1.60.1.70425.",
      trees: [
        {
          name: "Combat",
          talents: overrides.talents ?? [
            talent("Precision", { max: 3 }),
            talent("Deflection"),
          ],
          removed: overrides.removed ?? [
            {
              name: "Improved Backstab",
              max: 3,
              text: "Increases the critical strike chance of your Backstab ability by 10%.",
            },
          ],
        },
      ],
    },
    spellbook: {
      build: "1.60.1.70425",
      tabs: [
        {
          name: "Poisons",
          spells: [
            ["Instant Poison", "Rank 6"],
            ["Blinding Powder", ""],
          ],
        },
      ],
    },
    spell_desc: spellDesc,
    class_abilities: [["Energy", "10 a second"]],
  };
}

function jsonResponse(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return text;
    },
  };
}

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

function serve(body, status = 200) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const server = createServer((request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(payload);
  });
  return new Promise((resolveServer, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveServer({
        url: `http://127.0.0.1:${port}/rogue.json`,
        close() {
          return new Promise((resolveClose, rejectClose) => {
            server.close((error) =>
              error ? rejectClose(error) : resolveClose(),
            );
          });
        },
      });
    });
  });
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), "refresh-data-"));
}

describe("manifest", () => {
  it("reads the client build from spellbook.build, then talents.source", () => {
    assert.equal(readBuild(snapshot()), "1.60.1.70425");
    const fromSource = snapshot();
    delete fromSource.spellbook.build;
    assert.equal(readBuild(fromSource), "1.60.1.70425");
    assert.equal(readBuild({ talents: { source: "no build here" } }), "");
  });

  it("records generated, build, fetch date, and the CC BY 4.0 credit", () => {
    const manifest = buildManifest(snapshot(), "2026-10-22");
    assert.equal(manifest.source, EXPORT_URL);
    assert.equal(manifest.credit, "talentsforever.com");
    assert.equal(manifest.creditUrl, CREDIT_URL);
    assert.equal(manifest.license, LICENSE);
    assert.equal(manifest.licenseUrl, LICENSE_URL);
    assert.match(manifest.note, /talentsforever\.com/);
    assert.match(manifest.note, /CC BY 4\.0/);
    assert.equal(manifest.generated, "2026-10-20");
    assert.equal(manifest.build, "1.60.1.70425");
    assert.equal(manifest.fetched, "2026-10-22");
  });

  it("rejects a fetch date that is not YYYY-MM-DD", () => {
    assert.throws(
      () => buildManifest(snapshot(), "22 Oct 2026"),
      /Fetch date must be YYYY-MM-DD/,
    );
  });

  it("rejects an export that cannot be pinned", () => {
    assert.throws(() => assertSnapshot(null), /Export must be a JSON object/);
    assert.throws(
      () => assertSnapshot({ generated: "2026-10-20", spell_desc: {} }),
      /missing talents\.trees/,
    );
    const missingBuild = snapshot();
    delete missingBuild.spellbook;
    missingBuild.talents.source = "beta client";
    assert.throws(
      () => assertSnapshot(missingBuild, "Existing snapshot"),
      /Existing snapshot is missing the client build/,
    );
  });

  it("formats the fetch date in UTC", () => {
    assert.equal(utcDate(new Date("2026-10-22T23:30:00Z")), "2026-10-22");
    assert.equal(utcDate(new Date("2026-10-22T00:30:00+05:00")), "2026-10-21");
  });
});

describe("snapshot diff", () => {
  it("lists added, removed, and changed talents, spells, and poisons", () => {
    const before = snapshot();
    const after = snapshot({
      talents: [
        talent("Precision", { max: 5 }),
        talent("Dual Wield Specialization"),
      ],
      spellDesc: {
        "Rogue|Gouge|Rank 1": { d: "Incapacitates." },
        "Rogue|Instant Poison|Rank 6": { d: "30% chance." },
        "Rogue|Deadly Poison|Rank 5": { d: "92 over 12 sec." },
        "Rogue|Blinding Powder|": { d: "Thrown dust." },
        "Rogue|Venom|": { d: "Your poisons do 30% more." },
      },
    });

    const diff = diffSnapshot(before, after);
    assert.deepEqual(diff.talents.added, [
      "Combat / Dual Wield Specialization",
    ]);
    assert.deepEqual(diff.talents.removed, ["Combat / Deflection"]);
    assert.deepEqual(
      diff.talents.changed.map((change) => change.id),
      ["Combat / Precision"],
    );
    const maxChange = diff.talents.changed[0].fields.find(
      (field) => field.path === "max",
    );
    assert.equal(maxChange.before, 3);
    assert.equal(maxChange.after, 5);

    // Venom's tooltip mentions poisons; the name is what classifies it.
    assert.deepEqual(diff.spells.added, ["Rogue|Gouge|Rank 1", "Rogue|Venom|"]);
    assert.deepEqual(diff.spells.removed, []);
    assert.deepEqual(diff.spells.changed, []);
    assert.equal(collectSpells(after).spells.has("Rogue|Venom|"), true);
    assert.equal(collectSpells(after).poisons.has("Rogue|Venom|"), false);

    // Blinding Powder is on the Poisons tab and does not contain "Poison".
    assert.deepEqual(diff.poisons.added, [
      "Rogue|Blinding Powder|",
      "Rogue|Deadly Poison|Rank 5",
    ]);
    assert.deepEqual(diff.poisons.removed, []);
    assert.deepEqual(
      diff.poisons.changed.map((change) => change.id),
      ["Rogue|Instant Poison|Rank 6"],
    );
    assert.equal(poisonNames(after).has("Blinding Powder"), true);
    assert.equal(
      spellNameFromKey("Rogue|Instant Poison|Rank 6"),
      "Instant Poison",
    );
  });

  it("treats a not-in-tree talent edit as a talent change", () => {
    const before = snapshot();
    const after = snapshot({
      removed: [
        {
          name: "Improved Backstab",
          max: 3,
          text: "Restored in a later build.",
        },
      ],
    });
    const diff = diffSnapshot(before, after);
    assert.deepEqual(
      diff.talents.changed.map((change) => change.id),
      ["Combat / Improved Backstab [not in tree]"],
    );
    assert.deepEqual(diff.talents.added, []);
    assert.deepEqual(diff.talents.removed, []);
  });

  it("ignores key order and reports other sections by name", () => {
    const before = snapshot();
    const after = snapshot();
    after.talents.trees[0].talents[0] = {
      desc: ["Rank one."],
      name: "Precision",
      col: 1,
      row: 1,
      max: 3,
    };
    after.class_abilities = [["Energy", "still 10 a second", "extra"]];
    const diff = diffSnapshot(before, after);
    assert.deepEqual(diff.talents.changed, []);
    assert.deepEqual(diff.sections, ["class_abilities"]);
  });

  it("rejects a duplicate talent id", () => {
    const data = snapshot({
      talents: [talent("Precision"), talent("Precision", { row: 2 })],
    });
    assert.throws(
      () => collectTalents(data),
      /Duplicate talent id Combat \/ Precision/,
    );
  });
});

describe("refreshData", () => {
  it("updates the snapshot and lists added, removed, and changed records", async () => {
    const dir = await tempDir();
    const snapshotPath = join(dir, "rogue.json");
    const manifestPath = join(dir, "manifest.json");
    const before = snapshot();
    await writeFile(snapshotPath, await formatSnapshot(before));

    const after = snapshot({
      talents: [talent("Precision", { max: 5, icon: "ability_marksmanship" })],
    });
    after.spell_desc["Rogue|Deadly Poison|Rank 5"] = { d: "92 over 12 sec." };
    delete after.spell_desc["Rogue|Sinister Strike|Rank 8"];

    try {
      const outcome = await refreshData({
        url: "http://fixture.test/rogue.json",
        snapshotPath,
        manifestPath,
        fetched: "2026-10-22",
        fetchImpl: async () => jsonResponse(after),
      });

      assert.match(outcome.report, /Talents: 0 added, 1 removed, 1 changed/);
      assert.match(outcome.report, /- Combat \/ Deflection/);
      assert.match(outcome.report, /~ Combat \/ Precision/);
      assert.match(outcome.report, /max: 3 -> 5/);
      assert.match(
        outcome.report,
        /icon: \(absent\) -> "ability_marksmanship"/,
      );
      assert.match(outcome.report, /Spells: 0 added, 1 removed, 0 changed/);
      assert.match(outcome.report, /- Rogue\|Sinister Strike\|Rank 8/);
      assert.match(outcome.report, /Poisons: 1 added, 0 removed, 0 changed/);
      assert.match(outcome.report, /\+ Rogue\|Deadly Poison\|Rank 5/);
      assert.match(outcome.report, /generated: 2026-10-20/);
      assert.match(outcome.report, /build: 1\.60\.1\.70425/);
      assert.match(outcome.report, /fetched: 2026-10-22/);
      assert.match(
        outcome.report,
        /credit: talentsforever\.com \(https:\/\/talentsforever\.com\/\) under CC BY 4\.0/,
      );
      assert.match(outcome.report, /Other sections: \(none\)/);

      const written = JSON.parse(await readFile(snapshotPath, "utf8"));
      assert.equal(written.talents.trees[0].talents.length, 1);
      assert.equal(
        await readFile(snapshotPath, "utf8"),
        await formatSnapshot(after),
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(manifest.source, EXPORT_URL);
      assert.equal(manifest.credit, "talentsforever.com");
      assert.equal(manifest.license, "CC BY 4.0");
      assert.equal(manifest.generated, "2026-10-20");
      assert.equal(manifest.build, "1.60.1.70425");
      assert.equal(manifest.fetched, "2026-10-22");
      assert.equal(
        await readFile(manifestPath, "utf8"),
        await formatSnapshot(manifest),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists every record as added when no snapshot exists yet", async () => {
    const dir = await tempDir();
    const snapshotPath = join(dir, "nested", "rogue.json");
    const manifestPath = join(dir, "nested", "manifest.json");
    try {
      const outcome = await refreshData({
        snapshotPath,
        manifestPath,
        fetched: "2026-10-22",
        fetchImpl: async () => jsonResponse(snapshot()),
      });
      assert.match(
        outcome.report,
        /No previous snapshot; every talent, spell, and poison is listed as added\./,
      );
      assert.match(outcome.report, /\+ Combat \/ Precision/);
      assert.match(
        outcome.report,
        /\+ Combat \/ Improved Backstab \[not in tree\]/,
      );
      assert.match(outcome.report, /\+ Rogue\|Sinister Strike\|Rank 8/);
      assert.match(outcome.report, /\+ Rogue\|Instant Poison\|Rank 6/);
      assert.match(outcome.report, /Other sections: \(no previous snapshot\)/);
      await access(snapshotPath);
      await access(manifestPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not replace the pin when the fetch fails or the export is unusable", async () => {
    const dir = await tempDir();
    const snapshotPath = join(dir, "rogue.json");
    const manifestPath = join(dir, "manifest.json");
    const original = await formatSnapshot(snapshot());
    await writeFile(snapshotPath, original);

    try {
      await assert.rejects(
        refreshData({
          snapshotPath,
          manifestPath,
          fetchImpl: async () => jsonResponse("nope", 500),
        }),
        /Failed to fetch/,
      );
      assert.equal(await readFile(snapshotPath, "utf8"), original);
      await assert.rejects(access(manifestPath));

      await assert.rejects(
        refreshData({
          snapshotPath,
          manifestPath,
          fetchImpl: async () => jsonResponse("<html>nope</html>"),
        }),
        /is not JSON/,
      );
      assert.equal(await readFile(snapshotPath, "utf8"), original);

      const duplicate = snapshot({
        talents: [talent("Precision"), talent("Precision")],
      });
      await assert.rejects(
        refreshData({
          snapshotPath,
          manifestPath,
          fetched: "2026-10-22",
          fetchImpl: async () => jsonResponse(duplicate),
        }),
        /Duplicate talent id/,
      );
      assert.equal(await readFile(snapshotPath, "utf8"), original);
      await assert.rejects(access(manifestPath));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to diff a corrupt existing snapshot", async () => {
    const dir = await tempDir();
    const snapshotPath = join(dir, "rogue.json");
    const manifestPath = join(dir, "manifest.json");
    await writeFile(snapshotPath, "{");
    try {
      await assert.rejects(
        refreshData({
          snapshotPath,
          manifestPath,
          fetched: "2026-10-22",
          fetchImpl: async () => jsonResponse(snapshot()),
        }),
        /Existing snapshot .* is not JSON/,
      );
      assert.equal(await readFile(snapshotPath, "utf8"), "{");
      await assert.rejects(access(manifestPath));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("refresh CLI", () => {
  it("prints help and rejects an unknown argument", async () => {
    const help = await runCli(["--help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.equal(help.stdout, `${HELP_TEXT}\n`);
    assert.match(help.stdout, /talents, spells, and poisons/);
    assert.match(help.stdout, /talentsforever\.com/);

    const unknown = await runCli(["--force"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /Unknown argument: --force/);
    assert.equal(unknown.stdout, "");
  });

  it("updates the snapshot and lists the diff", async () => {
    const dir = await tempDir();
    const snapshotPath = join(dir, "rogue.json");
    const manifestPath = join(dir, "manifest.json");
    await writeFile(snapshotPath, await formatSnapshot(snapshot()));
    const next = snapshot({ talents: [talent("Blade Flurry")] });
    const server = await serve(next);
    try {
      const result = await runCli([
        "--url",
        server.url,
        "--snapshot",
        snapshotPath,
        "--manifest",
        manifestPath,
      ]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Talents: 1 added, 2 removed, 0 changed/);
      assert.match(result.stdout, /\+ Combat \/ Blade Flurry/);
      assert.match(result.stdout, /- Combat \/ Precision/);
      assert.match(result.stdout, /- Combat \/ Deflection/);
      assert.match(result.stdout, /Spells: 0 added, 0 removed, 0 changed/);
      assert.match(result.stdout, /Poisons: 0 added, 0 removed, 0 changed/);
      assert.match(result.stdout, /generated: 2026-10-20/);
      assert.match(result.stdout, /build: 1\.60\.1\.70425/);
      assert.match(result.stdout, /fetched: \d{4}-\d{2}-\d{2}/);
      assert.match(result.stdout, /credit: talentsforever\.com/);
      assert.equal(result.stderr, "");

      const written = JSON.parse(await readFile(snapshotPath, "utf8"));
      assert.equal(written.talents.trees[0].talents[0].name, "Blade Flurry");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(manifest.source, EXPORT_URL);
      assert.equal(manifest.creditUrl, CREDIT_URL);
      assert.equal(manifest.license, LICENSE);
      assert.equal(manifest.build, "1.60.1.70425");
      assert.match(manifest.fetched, /^\d{4}-\d{2}-\d{2}$/);
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves an existing snapshot in place when the server fails", async () => {
    const dir = await tempDir();
    const snapshotPath = join(dir, "rogue.json");
    const manifestPath = join(dir, "manifest.json");
    const original = await formatSnapshot(snapshot());
    await writeFile(snapshotPath, original);
    const server = await serve("down", 503);
    try {
      const result = await runCli([
        "--url",
        server.url,
        "--snapshot",
        snapshotPath,
        "--manifest",
        manifestPath,
      ]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Failed to fetch/);
      assert.equal(result.stdout, "");
      assert.equal(await readFile(snapshotPath, "utf8"), original);
      await assert.rejects(access(manifestPath));
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("vendored snapshot", () => {
  it("pins the rogue export with a matching manifest and credit", async () => {
    const snapshotText = await readFile(DEFAULT_SNAPSHOT_PATH, "utf8");
    const manifestText = await readFile(DEFAULT_MANIFEST_PATH, "utf8");
    const data = JSON.parse(snapshotText);
    const manifest = JSON.parse(manifestText);

    assert.equal(snapshotText, await formatSnapshot(data));
    assert.equal(manifestText, await formatSnapshot(manifest));
    assertSnapshot(data);
    assert.equal(data.generated, "2026-10-20");
    assert.equal(data.spellbook.build, "1.60.1.70425");
    assert.match(data._readme, /talentsforever\.com/);
    assert.match(data._readme, /CC BY 4\.0/);
    assert.equal(manifest.source, EXPORT_URL);
    assert.equal(manifest.credit, "talentsforever.com");
    assert.equal(manifest.creditUrl, CREDIT_URL);
    assert.equal(manifest.license, LICENSE);
    assert.equal(manifest.licenseUrl, LICENSE_URL);
    assert.equal(manifest.generated, data.generated);
    assert.equal(manifest.build, data.spellbook.build);
    assert.equal(manifest.fetched, "2026-10-22");

    const trees = data.talents.trees.map((tree) => tree.name);
    assert.deepEqual(trees, ["Assassination", "Combat", "Subtlety"]);
    const talents = collectTalents(data);
    assert.equal(talents.has("Combat / Blade Flurry"), true);
    assert.equal(talents.has("Combat / Adrenaline Rush"), true);
    assert.equal(talents.has("Combat / Improved Backstab [not in tree]"), true);

    const { spells, poisons } = collectSpells(data);
    assert.equal(spells.has("Rogue|Sinister Strike|Rank 8"), true);
    assert.equal(poisons.has("Rogue|Sinister Strike|Rank 8"), false);
    assert.equal(poisons.has("Rogue|Instant Poison|Rank 6"), true);
    assert.equal(poisons.has("Rogue|Deadly Poison|Rank 5"), true);
    assert.equal(poisons.has("Rogue|Blinding Powder|"), true);
    assert.equal(spells.has("Rogue|Venom|"), true);

    const diff = diffSnapshot(data, data);
    assert.deepEqual(diff.talents.added, []);
    assert.deepEqual(diff.talents.removed, []);
    assert.deepEqual(diff.talents.changed, []);
    assert.deepEqual(diff.spells.added, []);
    assert.deepEqual(diff.spells.removed, []);
    assert.deepEqual(diff.spells.changed, []);
    assert.deepEqual(diff.poisons.added, []);
    assert.deepEqual(diff.poisons.removed, []);
    assert.deepEqual(diff.poisons.changed, []);
    assert.deepEqual(diff.sections, []);
  });

  it("does not fetch the export from the page or engine", async () => {
    const files = ["index.html", "styles.css"];
    for (const name of await readdir(resolve(root, "js"))) {
      if (name.endsWith(".js")) {
        files.push(`js/${name}`);
      }
    }
    for (const file of files) {
      const text = await readFile(resolve(root, file), "utf8");
      assert.equal(/https?:\/\/talentsforever\.com/.test(text), false, file);
    }
  });
});

describe("argument parsing", () => {
  it("defaults to the vendored paths and the talentsforever export", () => {
    const options = parseArgs([]);
    assert.equal(options.url, EXPORT_URL);
    assert.equal(options.snapshotPath, DEFAULT_SNAPSHOT_PATH);
    assert.equal(options.manifestPath, DEFAULT_MANIFEST_PATH);
    assert.equal(options.help, false);
  });

  it("requires a value for --url", () => {
    assert.throws(() => parseArgs(["--url"]), /Missing value for --url/);
  });
});
