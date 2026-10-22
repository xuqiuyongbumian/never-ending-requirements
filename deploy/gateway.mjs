import { createServer, request } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

const ROOT = resolve(process.env.STATIC_ROOT ?? "/root/project/never-ending-requirements/dist");
const API_HOST = process.env.API_HOST ?? "127.0.0.1";
const API_PORT = Number(process.env.API_PORT ?? 8787);
const PORT = Number(process.env.PORT ?? 8000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8"
};

function proxy(req, res) {
  const headers = { ...req.headers, host: API_HOST + ":" + API_PORT };
  const upstream = request({ host: API_HOST, port: API_PORT, path: req.url, method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "upstream_unavailable", message: String(err && err.message) } }));
  });
  req.pipe(upstream);
}

function serveFile(res, filePath, cacheable) {
  const stat = statSync(filePath);
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cacheable ? "public, max-age=3600" : "no-cache"
  });
  createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end("bad request");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = resolve(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    serveFile(res, filePath, extname(filePath).toLowerCase() !== ".html");
    return;
  }
  const indexPath = join(ROOT, "index.html");
  if (existsSync(indexPath)) {
    serveFile(res, indexPath, false);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}

const server = createServer((req, res) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const line = [req.method, req.url, res.statusCode, Date.now() - startedAt + "ms"].join(" ");
    if (res.statusCode >= 400) console.error("MISS " + line);
    else console.log(line);
  });
  if (req.url && req.url.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("epochrush gateway listening on 0.0.0.0:" + PORT + " static=" + ROOT + " api=" + API_HOST + ":" + API_PORT);
});
