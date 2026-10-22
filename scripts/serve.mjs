import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Dev-only static server. The page is native ES modules and loads nothing from here.
export const DEFAULT_PORT = 8000;
export const HOST = "127.0.0.1";
export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const STATUS_TEXT = {
  400: "Bad request",
  403: "Forbidden",
  404: "Not found",
  500: "Internal server error",
};

export function parsePort(value, fallback = DEFAULT_PORT) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(
      `Invalid PORT "${value}". Expected an integer from 0 to 65535.`,
    );
  }

  const port = Number(text);
  if (port > 65535) {
    throw new Error(
      `Invalid PORT "${value}". Expected an integer from 0 to 65535.`,
    );
  }
  return port;
}

export function resolveStaticPath(rootDir, pathname) {
  const root = resolve(rootDir);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes("\0")) {
    return { status: 400 };
  }

  const segments = [];
  for (const segment of decoded.split(/[/\\]+/)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === ".." || segment.startsWith(".")) {
      return { status: 403 };
    }
    segments.push(segment);
  }

  const filePath = resolve(root, ...segments);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return { status: 403 };
  }
  return { status: 200, filePath };
}

function contentType(filePath) {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  );
}

async function locateFile(rootDir, pathname) {
  const resolved = resolveStaticPath(rootDir, pathname);
  if (resolved.status !== 200) {
    return resolved;
  }

  let filePath = resolved.filePath;
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { status: 404 };
    }
    throw error;
  }

  if (info.isDirectory()) {
    filePath = join(filePath, "index.html");
    try {
      info = await stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return { status: 404 };
      }
      throw error;
    }
  }

  if (!info.isFile()) {
    return { status: 404 };
  }

  const realRoot = await realpath(rootDir);
  const realFile = await realpath(filePath);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) {
    return { status: 403 };
  }
  return { status: 200, filePath: realFile };
}

function sendText(res, status) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(STATUS_TEXT[status] ?? "Error");
}

export function createStaticServer({ root = ROOT } = {}) {
  const rootDir = resolve(root);

  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, {
          Allow: "GET, HEAD",
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("Method not allowed");
        return;
      }

      let url;
      try {
        url = new URL(req.url || "/", "http://127.0.0.1");
      } catch {
        sendText(res, 400);
        return;
      }

      const located = await locateFile(rootDir, url.pathname);
      if (located.status !== 200) {
        sendText(res, located.status);
        return;
      }

      const body = await readFile(located.filePath);
      res.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": body.length,
        "Content-Type": contentType(located.filePath),
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        sendText(res, 500);
        return;
      }
      res.end();
    }
  });
}

export function startStaticServer({ port = 0, host = HOST, root = ROOT } = {}) {
  const server = createStaticServer({ root });
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    function onListening() {
      server.off("error", onError);
      resolveListen(server);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  try {
    const port = parsePort(process.env.PORT, DEFAULT_PORT);
    const server = createStaticServer();
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, HOST, () => {
      const bound = server.address().port;
      console.log(`Serving ${ROOT} at http://${HOST}:${bound}/`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
