import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const PAGES_ORIGIN = "https://james-attree.github.io";
const SITE = `${PAGES_ORIGIN}/wowf_dps_sim/`;

function assembleScript(workflow) {
  const lines = workflow.split("\n");
  const start = lines.findIndex(
    (line) => line.trim() === "- name: Assemble site",
  );
  assert.notEqual(start, -1, "Assemble site step");
  const run = lines[start + 1];
  assert.match(run, /^\s+run: \|$/);
  const keyIndent = run.match(/^\s*/)[0].length;
  const body = [];
  let contentIndent;
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= keyIndent) {
      break;
    }
    if (contentIndent === undefined) {
      contentIndent = indent;
    }
    assert.ok(indent >= contentIndent, line);
    body.push(line.slice(contentIndent));
  }
  return body.join("\n").trim();
}

async function missing(path) {
  await assert.rejects(access(path), { code: "ENOENT" });
}

function assertOnSite(url, label) {
  assert.equal(url.origin, PAGES_ORIGIN, label);
  assert.ok(
    url.pathname === "/wowf_dps_sim" ||
      url.pathname.startsWith("/wowf_dps_sim/"),
    `${label} resolved to ${url.href}`,
  );
}

function sitePath(url) {
  const pathname = decodeURIComponent(url.pathname);
  let rel = pathname.slice("/wowf_dps_sim/".length);
  if (rel === "" || rel.endsWith("/")) {
    rel += "index.html";
  }
  assert.equal(rel.includes(".."), false, pathname);
  return rel;
}

describe("data credit footer", () => {
  it("credits talentsforever.com outside the simulator", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const main = html.match(/<main\b[\s\S]*<\/main>/);
    assert.ok(main);
    assert.doesNotMatch(main[0], /<footer\b/);

    const footer = html.match(
      /<footer class="site-footer" aria-label="Data credit">[\s\S]*<\/footer>/,
    );
    assert.ok(footer, "footer landmark");
    const credit = footer[0];
    assert.match(credit, /Talent, spell, and poison data comes from/);
    assert.equal(
      credit.match(/href="https:\/\/talentsforever\.com\/"/g)?.length,
      1,
    );
    assert.match(
      credit,
      /<a\b[^>]*href="https:\/\/talentsforever\.com\/"[^>]*>\s*talentsforever\.com\s*<\/a>/,
    );
    assert.match(
      credit,
      /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/,
    );
    assert.match(credit, /rel="license"/);
    assert.match(credit, />\s*CC BY 4\.0\s*</);
    assert.match(
      credit,
      /World of Warcraft names, icons, and tooltip text belong to Blizzard\s+Entertainment\./,
    );
    assert.match(
      credit,
      /This project is not affiliated with Blizzard\s+Entertainment or\s+talentsforever\.com\./,
    );
    assert.doesNotMatch(credit, /talentsforever\.com\/export/);
  });
});

describe("Pages workflow", () => {
  it("deploys main with the official actions and minimum permissions", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/pages.yml"),
      "utf8",
    );

    assert.match(workflow, /^name: Pages$/m);
    assert.match(
      workflow,
      /^"on":\n {2}push:\n {4}branches:\n {6}- main\n {2}workflow_dispatch:\n/m,
    );
    assert.doesNotMatch(workflow, /pull_request/);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);

    const permissions = workflow.match(/^permissions:\n((?: {2}\S.*\n)+)/m);
    assert.ok(permissions);
    assert.deepEqual(
      permissions[1]
        .trim()
        .split("\n")
        .map((line) => line.trim()),
      ["contents: read", "pages: write", "id-token: write"],
    );
    assert.doesNotMatch(workflow, /contents: write/);

    const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(uses, [
      "actions/checkout@v7",
      "actions/configure-pages@v6",
      "actions/upload-pages-artifact@v5",
      "actions/deploy-pages@v5",
    ]);

    assert.match(workflow, /name: github-pages/);
    assert.match(
      workflow,
      /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/,
    );
    assert.match(workflow, /id: deployment/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /runs-on: ubuntu-latest/);
    assert.match(workflow, /^\s*path: _site$/m);
    assert.doesNotMatch(workflow, /^\s*path:\s*\.\s*$/m);

    assert.equal(
      assembleScript(workflow),
      [
        "mkdir -p _site",
        "cp index.html styles.css _site/",
        "cp -R js data img _site/",
      ].join("\n"),
    );
  });

  it("publishes the app and leaves dev folders out of the artifact", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/pages.yml"),
      "utf8",
    );
    const commands = assembleScript(workflow).split("\n");
    assert.deepEqual(commands, [
      "mkdir -p _site",
      "cp index.html styles.css _site/",
      "cp -R js data img _site/",
    ]);

    const site = await mkdtemp(join(tmpdir(), "wowf-pages-"));
    try {
      const script = commands
        .map((command) => command.replaceAll("_site", site))
        .join("\n");
      await execFileAsync("bash", ["-lc", script], { cwd: root });

      assert.deepEqual((await readdir(site)).sort(), [
        "data",
        "img",
        "index.html",
        "js",
        "styles.css",
      ]);
      for (const file of [
        "index.html",
        "styles.css",
        "js/main.js",
        "js/ability.js",
        "data/constants.js",
        "data/talentsforever/rogue.json",
        "data/talentsforever/manifest.json",
        "img/backstab.jpg",
      ]) {
        const info = await stat(join(site, file));
        assert.equal(info.isFile(), true, file);
      }
      for (const excluded of [
        "test",
        "scripts",
        "node_modules",
        "docs",
        "package.json",
        "package-lock.json",
        "README.md",
        "eslint.config.js",
        ".github",
      ]) {
        await missing(join(site, excluded));
      }

      const html = await readFile(join(site, "index.html"), "utf8");
      assert.match(html, /talentsforever\.com/);
      assert.match(html, /not affiliated with Blizzard\s+Entertainment/);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});

describe("project site paths", () => {
  it("resolves modules and assets under /wowf_dps_sim/", async () => {
    const html = await readFile(resolve(root, "index.html"), "utf8");
    const css = await readFile(resolve(root, "styles.css"), "utf8");
    assert.doesNotMatch(html, /(?:src|href)=["']\//);
    assert.doesNotMatch(html, /(?:src|href)=["']\/\//);
    assert.doesNotMatch(css, /url\(\s*["']?\//);
    assert.doesNotMatch(css, /url\(\s*["']\/\//);

    const documentBases = [SITE, new URL("index.html", SITE).href];
    for (const base of documentBases) {
      for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
        const value = match[1];
        if (/^https?:\/\//.test(value)) {
          continue;
        }
        assert.doesNotMatch(value, /^\//, value);
        const url = new URL(value, base);
        assertOnSite(url, `${base} ${value}`);
        const info = await stat(resolve(root, sitePath(url)));
        assert.equal(info.isFile(), true, value);
      }
    }

    const pending = ["js/main.js"];
    const seen = new Set();
    while (pending.length > 0) {
      const modulePath = pending.pop();
      if (seen.has(modulePath)) {
        continue;
      }
      seen.add(modulePath);
      const source = await readFile(resolve(root, modulePath), "utf8");
      assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*["']\//, modulePath);
      assert.doesNotMatch(source, /fetch\(\s*["']\//, modulePath);
      const moduleUrl = new URL(modulePath, SITE);
      const imports = new Set();
      for (const match of source.matchAll(
        /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g,
      )) {
        const spec = match[1];
        imports.add(spec);
        const url = new URL(spec, moduleUrl);
        assertOnSite(url, `${modulePath} ${spec}`);
        const rel = sitePath(url);
        const info = await stat(resolve(root, rel));
        assert.equal(info.isFile(), true, rel);
        if (rel.endsWith(".js")) {
          pending.push(rel);
        }
      }

      // A module loaded by URL from its own module (the batch worker,
      // new URL("./batch-worker.js", import.meta.url)) resolves like an import.
      for (const match of source.matchAll(
        /new URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url/g,
      )) {
        const spec = match[1];
        imports.add(spec);
        const url = new URL(spec, moduleUrl);
        assertOnSite(url, `${modulePath} ${spec}`);
        const rel = sitePath(url);
        const info = await stat(resolve(root, rel));
        assert.equal(info.isFile(), true, rel);
        if (rel.endsWith(".js")) {
          pending.push(rel);
        }
      }

      if (!modulePath.startsWith("js/")) {
        continue;
      }
      for (const match of source.matchAll(/["'](\.{1,2}\/[^"']+)["']/g)) {
        const spec = match[1];
        if (imports.has(spec)) {
          continue;
        }
        for (const base of documentBases) {
          const url = new URL(spec, base);
          assertOnSite(url, `${modulePath} asset ${spec} from ${base}`);
          const info = await stat(resolve(root, sitePath(url)));
          assert.equal(info.isFile(), true, spec);
        }
      }
    }

    assert.ok(seen.has("js/ability.js"));
    assert.ok(seen.has("js/simulation.js"));
    assert.ok(seen.has("data/constants.js"));

    const publishedJs = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if (entry.name.endsWith(".js")) {
          publishedJs.push(relative(root, path).split(sep).join("/"));
        }
      }
    }
    await walk(resolve(root, "js"));
    // Modules the page does not import yet. js/sim-runner.js (#136) drives
    // the live page since #153 (through js/live-run.js). js/rotation-schema.js (#138) is wired in by the
    // rotation builder and interpreter (R3, the builder); remove it then. So
    // are js/rotation-conditions.js and js/rotation-state.js (#139).
    // js/rotation-summary.js (R4, #141) is the display-edge text for a rule;
    // the rotation builder imports it (through js/rotation-presets.js, for the
    // preset list), so remove it then. js/rotation-presets.js (R5, #142) is the
    // preset list's API: the page has no config UI to call it yet (#149,
    // #150).
    // js/rotation-io.js (R6, #143) is the text side of a rotation: the page has
    // no file or clipboard UI to call it yet (#149, #150).
    // The control bar's batch mode (#153) wires js/batch-client.js, and with
    // it js/batch-host.js, js/batch-runner.js, js/running-stats.js,
    // js/ability-breakdown.js, js/fight-metrics.js and js/damage-timeline.js.
    // The worker js/batch-worker.js is loaded by URL from the client (new
    // URL(..., import.meta.url)), which the walk above follows. js/charts.js and
    // js/svg.js (#148) draw the batch charts: the results UI (#149, #150)
    // puts them on the page; until then only the demo harness
    // demo/charts.html (not deployed) uses them.
    // js/rotation-validator.js is wired through the interpreter. The stats
    // form (#151, js/config-form.js) wires js/rotation-summary.js,
    // js/rotation-presets.js and js/rotation-io.js.
    const notWiredYet = new Set(["js/charts.js", "js/svg.js"]);
    for (const file of publishedJs) {
      if (notWiredYet.has(file)) {
        assert.equal(seen.has(file), false, `${file} is wired: drop it above`);
        continue;
      }
      assert.ok(seen.has(file), `${file} is published but not imported`);
    }
  });

  it("publishes the batch worker where its client loads it (#147)", async () => {
    const client = await readFile(resolve(root, "js/batch-client.js"), "utf8");
    const spec = client.match(/new URL\("(\.\/[^"]+)", import\.meta\.url\)/);
    assert.ok(spec, "the client builds the worker URL from import.meta.url");
    const workerUrl = new URL(spec[1], new URL("js/batch-client.js", SITE));
    assertOnSite(workerUrl, "worker");
    assert.equal(sitePath(workerUrl), "js/batch-worker.js");

    // The worker's and the client's module graphs resolve on the site, and
    // they are published with js/ by the Pages workflow.
    const pending = ["js/batch-client.js", sitePath(workerUrl)];
    const seen = new Set();
    while (pending.length > 0) {
      const modulePath = pending.pop();
      if (seen.has(modulePath)) {
        continue;
      }
      seen.add(modulePath);
      const source = await readFile(resolve(root, modulePath), "utf8");
      for (const match of source.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
        const url = new URL(match[1], new URL(modulePath, SITE));
        assertOnSite(url, `${modulePath} ${match[1]}`);
        const rel = sitePath(url);
        assert.equal((await stat(resolve(root, rel))).isFile(), true, rel);
        if (rel.endsWith(".js")) {
          pending.push(rel);
        }
      }
    }
    for (const file of [
      "js/batch-host.js",
      "js/batch-runner.js",
      "data/constants.js",
    ]) {
      assert.ok(seen.has(file), file);
    }
    const workflow = await readFile(
      resolve(root, ".github/workflows/pages.yml"),
      "utf8",
    );
    assert.match(assembleScript(workflow), /cp -R js data img _site\//);
  });

  it("says the site deploys once Pages is enabled", async () => {
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    assert.match(
      readme,
      /The site deploys to\s+https:\/\/james-attree\.github\.io\/wowf_dps_sim\/ once Pages is enabled\./,
    );
    assert.match(readme, /\.github\/workflows\/pages\.yml/);
    assert.doesNotMatch(readme, /hosting on GitHub Pages is planned/i);
  });
});
