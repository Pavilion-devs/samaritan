import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleDashboardApi, writeApiResult } from "./api.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const staticRoot = resolve(repoRoot, "apps/dashboard/dist");
const port = Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 4173);
const host = process.env.DASHBOARD_HOST ?? process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("DASHBOARD_PORT/PORT must be an integer between 1 and 65535");
}
if (host.trim().length === 0 || /[\s/]/.test(host)) {
  throw new Error("DASHBOARD_HOST/HOST is invalid");
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

const securityHeaders: Record<string, string> = {
  "content-security-policy": "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};

async function staticFilePath(pathname: string): Promise<string | null> {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(staticRoot, relative);
  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) return null;
  try {
    if ((await stat(candidate)).isFile()) return candidate;
  } catch {
    // SPA routes fall through to index.html.
  }
  if (extname(relative) !== "") return null;
  const index = resolve(staticRoot, "index.html");
  try {
    return (await stat(index)).isFile() ? index : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  try {
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD", "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    const apiResult = await handleDashboardApi(url.pathname, repoRoot);
    if (apiResult) {
      writeApiResult(response, apiResult, request.method === "HEAD");
      return;
    }
    const path = await staticFilePath(url.pathname);
    if (!path) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const body = await readFile(path);
    response.writeHead(200, {
      "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "internal_error" }));
  }
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`Samaritan dashboard listening at http://${displayHost}:${port} (bound ${host})`);
});
