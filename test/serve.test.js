import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PORT,
  parsePort,
  resolveStaticPath,
  startStaticServer,
} from "../scripts/serve.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function rawRequest(port, path, method = "GET") {
  return new Promise((resolveResponse, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolveResponse({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function readLine(stream, timeoutMs = 3000) {
  let data = "";
  return new Promise((resolveLine, reject) => {
    const timer = setTimeout(() => {
      stream.off("data", onData);
      reject(
        new Error(
          `Timed out waiting for server output. Got: ${JSON.stringify(data)}`,
        ),
      );
    }, timeoutMs);

    function onData(chunk) {
      data += chunk;
      const newline = data.indexOf("\n");
      if (newline === -1) {
        return;
      }
      clearTimeout(timer);
      stream.off("data", onData);
      resolveLine(data.slice(0, newline));
    }

    stream.on("data", onData);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolveWait) => {
      setTimeout(() => resolveWait(false), 1000);
    }),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

describe("parsePort", () => {
  it("defaults to 8000 and accepts an ephemeral port", () => {
    assert.equal(DEFAULT_PORT, 8000);
    assert.equal(parsePort(undefined), 8000);
    assert.equal(parsePort(""), 8000);
    assert.equal(parsePort("0"), 0);
    assert.equal(parsePort("65535"), 65535);
  });

  it("rejects values that are not a port", () => {
    for (const value of ["nope", "-1", "1.5", "65536", "0x10", " 80"]) {
      assert.throws(() => parsePort(value), /Invalid PORT/);
    }
  });
});

describe("resolveStaticPath", () => {
  const site = "/tmp/wowf-site";

  it("resolves a file inside the root", () => {
    const resolved = resolveStaticPath(site, "/js/main.js");
    assert.equal(resolved.status, 200);
    assert.equal(resolved.filePath, resolve(site, "js/main.js"));
  });

  it("rejects traversal, dotfiles, and bad encoding", () => {
    assert.equal(resolveStaticPath(site, "/../etc/passwd").status, 403);
    assert.equal(resolveStaticPath(site, "/js/../../etc/passwd").status, 403);
    assert.equal(resolveStaticPath(site, "/%2e%2e/etc/passwd").status, 403);
    assert.equal(resolveStaticPath(site, "/.git/config").status, 403);
    assert.equal(resolveStaticPath(site, "/%00.js").status, 400);
    assert.equal(resolveStaticPath(site, "/%E0%A4%A").status, 400);
  });
});

describe("static server", () => {
  let server;
  let base;
  let port;

  before(async () => {
    server = await startStaticServer({ port: 0, root });
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  });

  it("serves the page, stylesheet, script graph, and an image", async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html\b/);
    const html = await page.text();
    assert.match(html, /WoW Forever Rogue Simulator/);

    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /^text\/css\b/);
    assert.match(await css.text(), /simulator/);

    const seen = new Set();
    const pending = ["/js/main.js"];
    while (pending.length > 0) {
      const pathname = pending.pop();
      if (seen.has(pathname)) {
        continue;
      }
      seen.add(pathname);
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, pathname);
      // A JSON module (import ... with { type: "json" }) must come back as
      // application/json, or the browser refuses to import it.
      assert.match(
        response.headers.get("content-type"),
        pathname.endsWith(".json")
          ? /^application\/json\b/
          : /^text\/javascript\b/,
        pathname,
      );
      const source = await response.text();
      if (pathname.endsWith(".json")) {
        JSON.parse(source);
        continue;
      }
      for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        pending.push(new URL(match[1], `${base}${pathname}`).pathname);
      }
    }
    assert.ok(seen.has("/js/attack-resolver.js"));
    assert.ok(seen.has("/js/skill.js"));
    assert.ok(seen.has("/js/weapon.js"));
    assert.ok(seen.has("/data/talentsforever/manifest.json"));

    const image = await fetch(`${base}/img/backstab.jpg`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /^image\/jpeg\b/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.ok(bytes.length > 8);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
  });

  it("answers HEAD without a body and rejects other methods", async () => {
    const head = await rawRequest(port, "/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.match(head.headers["content-type"], /^text\/html\b/);

    const post = await rawRequest(port, "/", "POST");
    assert.equal(post.status, 405);
    assert.match(post.headers.allow, /GET/);
  });

  it("does not read files outside the site root", async () => {
    const missing = await fetch(`${base}/js/missing.js`);
    assert.equal(missing.status, 404);

    // The URL parser collapses this to /etc/passwd, which is then looked up inside the root.
    const collapsed = await rawRequest(port, "/%2e%2e/%2e%2e/etc/passwd");
    assert.equal(collapsed.status, 404);
    assert.doesNotMatch(collapsed.body.toString("utf8"), /root:/);

    // %2f stays encoded through the URL parser, so the handler must reject it itself.
    const encodedSlash = await rawRequest(
      port,
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    );
    assert.equal(encodedSlash.status, 403);
    assert.doesNotMatch(encodedSlash.body.toString("utf8"), /root:/);
  });

  it("does not follow a symlink out of the site root", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "wowf-serve-"));
    const site = resolve(dir, "site");
    const outside = resolve(dir, "secret.txt");
    try {
      await mkdir(site);
      await writeFile(resolve(site, "index.html"), "<title>Temp</title>");
      await writeFile(outside, "secret-value");
      await symlink(outside, resolve(site, "leak.txt"));

      const isolated = await startStaticServer({ port: 0, root: site });
      try {
        const isolatedPort = isolated.address().port;
        const leaked = await fetch(`http://127.0.0.1:${isolatedPort}/leak.txt`);
        assert.equal(leaked.status, 403);
        assert.doesNotMatch(await leaked.text(), /secret-value/);

        const page = await fetch(`http://127.0.0.1:${isolatedPort}/`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Temp/);
      } finally {
        await new Promise((resolveClose, reject) => {
          isolated.close((error) => (error ? reject(error) : resolveClose()));
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("serve CLI", () => {
  it("prints the bound URL and serves index.html", async () => {
    const child = spawn(process.execPath, ["scripts/serve.mjs"], {
      cwd: root,
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const line = await readLine(child.stdout);
      const match = line.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      assert.ok(match, line);
      const response = await fetch(match[0]);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /WoW Forever Rogue Simulator/);
    } finally {
      await stopChild(child);
    }
  });

  it("exits non-zero when PORT is invalid", async () => {
    const child = spawn(process.execPath, ["scripts/serve.mjs"], {
      cwd: root,
      env: { ...process.env, PORT: "nope" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const [code] = await once(child, "exit");
    assert.notEqual(code, 0);
    assert.match(stderr, /Invalid PORT/);
  });
});
