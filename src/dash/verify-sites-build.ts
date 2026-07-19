#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPublicEdgeBundle } from "./edge-bundle.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dashboardRoot = resolve(repoRoot, "apps/dashboard");
const distRoot = resolve(dashboardRoot, "dist");
const clientRoot = resolve(distRoot, "client");
const workerPath = resolve(distRoot, "server/index.js");

type WorkerEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TXLINE_JWT?: string;
  TXLINE_API_TOKEN?: string;
  TXLINE_SERVICE_LEVEL_ID?: string;
};

type WorkerModule = {
  default: {
    fetch(request: Request, env: WorkerEnv): Promise<Response>;
  };
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2"
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class LocalAssetBinding {
  readonly requests: string[] = [];

  constructor(private readonly corruptPath: string | null = null) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.requests.push(`${request.method} ${url.pathname}`);
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const candidate = resolve(clientRoot, relative);
    if (candidate !== clientRoot && !candidate.startsWith(`${clientRoot}${sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    try {
      if (!(await stat(candidate)).isFile()) return new Response("Not found", { status: 404 });
      const file = await readFile(candidate);
      const body = decoded === this.corruptPath
        ? new Uint8Array([...file, 0x20])
        : new Uint8Array(file);
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: {
          "content-type": contentTypes[extname(candidate)] ?? "application/octet-stream"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
}

async function verifyLayout(): Promise<void> {
  for (const path of [
    workerPath,
    resolve(clientRoot, "index.html"),
    resolve(clientRoot, "artifacts/dashboard/manifest.json"),
    resolve(clientRoot, "artifacts/edge/manifest.json"),
    resolve(clientRoot, "artifacts/edge/judge-evidence.json")
  ]) {
    assert((await stat(path)).isFile(), `Sites build is missing ${path.slice(distRoot.length + 1)}`);
  }
  const assets = await readdir(resolve(clientRoot, "assets"));
  assert(assets.some((name) => name.endsWith(".js")), "Sites build has no browser JavaScript asset");
  assert(assets.some((name) => name.endsWith(".css")), "Sites build has no browser stylesheet asset");
  const workerSource = await readFile(workerPath, "utf8");
  assert(!workerSource.includes("node:"), "Sites Worker bundle contains a Node builtin import");
  assert(workerSource.includes("ASSETS.fetch"), "Sites Worker bundle does not use the ASSETS binding");
}

async function verifyRuntime(): Promise<void> {
  const verified = await verifyPublicEdgeBundle(repoRoot);
  const workerModule = await import(`${pathToFileURL(workerPath).href}?verify=${Date.now()}`) as WorkerModule;
  const binding = new LocalAssetBinding();
  const env: WorkerEnv = { ASSETS: binding };

  for (const route of verified.manifest.routes) {
    const get = await workerModule.default.fetch(new Request(`https://samaritan.test${route.apiPath}`), env);
    assert(get.status === 200, `Sites Worker GET failed for ${route.apiPath}`);
    assert(get.headers.get("cache-control") === "no-store", `Sites Worker cached ${route.apiPath}`);
    assert(get.headers.get("x-content-type-options") === "nosniff", `Sites Worker lacks nosniff for ${route.apiPath}`);
    assert(
      get.headers.get("x-samaritan-edge-bundle") === verified.manifest.edgeBundleSha256,
      `Sites Worker edge commitment changed for ${route.apiPath}`
    );
    const expected = await readFile(resolve(clientRoot, route.assetPath.replace(/^\/+/, "")), "utf8");
    assert(await get.text() === expected, `Sites Worker body changed for ${route.apiPath}`);

    const head = await workerModule.default.fetch(new Request(`https://samaritan.test${route.apiPath}`, {
      method: "HEAD"
    }), env);
    assert(head.status === 200, `Sites Worker HEAD failed for ${route.apiPath}`);
    assert(await head.text() === "", `Sites Worker HEAD returned a body for ${route.apiPath}`);
  }

  const health = await workerModule.default.fetch(new Request("https://samaritan.test/api/v1/health"), env);
  assert(health.status === 200, "Sites Worker health route failed");
  assert((await health.json() as { readOnly?: unknown }).readOnly === true, "Sites Worker health route is not read-only");

  const pulse = await workerModule.default.fetch(new Request("https://samaritan.test/api/v1/txline/pulse"), env);
  assert(pulse.status === 200, "Sites Worker TXLine pulse did not fail degraded without credentials");
  const pulseValue = await pulse.json() as Record<string, unknown>;
  assert(pulseValue.status === "degraded", "Sites Worker TXLine pulse claimed connectivity without credentials");
  assert(pulseValue.aggregateFixtureCount === null, "Sites Worker TXLine pulse exposed fixture data while degraded");
  assert(
    Object.keys(pulseValue).sort().join(",") === [
      "aggregateFixtureCount",
      "checkedAt",
      "freshnessClass",
      "latencyMsRounded",
      "network",
      "serviceLevel",
      "status"
    ].sort().join(","),
    "Sites Worker TXLine pulse response crossed its derived-metadata allowlist"
  );
  assert(pulse.headers.get("cache-control") === "no-store", "Sites Worker cached the TXLine pulse");
  const pulseHead = await workerModule.default.fetch(new Request("https://samaritan.test/api/v1/txline/pulse", {
    method: "HEAD"
  }), env);
  assert(pulseHead.status === 200 && await pulseHead.text() === "", "Sites Worker TXLine pulse HEAD semantics changed");

  const originalFetch = globalThis.fetch;
  let upstreamPulseCalls = 0;
  globalThis.fetch = async (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> => {
    upstreamPulseCalls += 1;
    const upstream = new Request(input, init);
    assert(
      upstream.url.startsWith("https://txline.txodds.com/api/fixtures/snapshot?startEpochDay="),
      "Sites Worker pulse called a non-official origin"
    );
    assert(upstream.headers.get("authorization") === "Bearer test-jwt-value", "Sites Worker pulse omitted the JWT");
    assert(upstream.headers.get("x-api-token") === "test-api-token", "Sites Worker pulse omitted the API token");
    return new Response(JSON.stringify([
      { Participant1: "must-not-cross-boundary", FixtureId: 1, StartTime: "2026-07-18T21:00:00Z" },
      { Participant2: "must-not-cross-boundary", FixtureId: 2, StartTime: "2026-07-19T19:00:00Z" }
    ]), {
      status: 200,
      headers: {
        "content-type": "application/json",
        date: new Date().toUTCString()
      }
    });
  };
  try {
    const configuredEnv = {
      ASSETS: binding,
      TXLINE_JWT: "test-jwt-value",
      TXLINE_API_TOKEN: "test-api-token",
      TXLINE_SERVICE_LEVEL_ID: "12"
    };
    const [connectedPulse, connectedHead, connectedGet] = await Promise.all([
      workerModule.default.fetch(new Request("https://samaritan.test/api/v1/txline/pulse"), configuredEnv),
      workerModule.default.fetch(new Request("https://samaritan.test/api/v1/txline/pulse", {
        method: "HEAD"
      }), configuredEnv),
      workerModule.default.fetch(new Request("https://samaritan.test/api/v1/txline/pulse"), configuredEnv)
    ]);
    const connectedValue = await connectedPulse.json() as Record<string, unknown>;
    assert(connectedHead.status === 200 && await connectedHead.text() === "", "Cached Worker pulse HEAD semantics changed");
    assert(
      JSON.stringify(await connectedGet.json()) === JSON.stringify(connectedValue),
      "Concurrent Worker pulse callers did not share one cached result"
    );
    assert(upstreamPulseCalls === 1, "Concurrent Worker pulse callers fanned out authenticated requests");
    const cachedPulse = await workerModule.default.fetch(
      new Request("https://samaritan.test/api/v1/txline/pulse"),
      configuredEnv
    );
    assert(cachedPulse.status === 200, "Cached Worker pulse failed");
    assert(upstreamPulseCalls === 1, "Worker pulse did not retain its bounded one-minute cache");
    assert(connectedValue.status === "connected", "Sites Worker did not use hosted TXLine credentials");
    assert(connectedValue.aggregateFixtureCount === 2, "Sites Worker pulse did not derive the aggregate fixture count");
    assert(
      !JSON.stringify(connectedValue).includes("must-not-cross-boundary"),
      "Sites Worker pulse exposed a raw TXLine fixture row"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const wrongTierPulse = await workerModule.default.fetch(
    new Request("https://samaritan.test/api/v1/txline/pulse"),
    {
      ASSETS: binding,
      TXLINE_JWT: "test-jwt-value",
      TXLINE_API_TOKEN: "test-api-token",
      TXLINE_SERVICE_LEVEL_ID: "1"
    }
  );
  assert(
    (await wrongTierPulse.json() as { status?: unknown }).status === "degraded",
    "Sites Worker pulse accepted a non-SL12 credential context"
  );

  const unknownApi = await workerModule.default.fetch(new Request("https://samaritan.test/api/v1/private-state"), env);
  assert(unknownApi.status === 404, "Sites Worker exposed an unknown API route");
  const arbitraryFile = await workerModule.default.fetch(new Request("https://samaritan.test/package.json"), env);
  assert(arbitraryFile.status === 404, "Sites Worker exposed a repository file outside dist");

  const post = await workerModule.default.fetch(new Request("https://samaritan.test/api/v1/command", {
    method: "POST"
  }), env);
  assert(post.status === 405 && post.headers.get("allow") === "GET, HEAD", "Sites Worker accepted a mutating method");

  for (const pathname of ["/command", "/study", "/proof", "/casebook", "/matchroom", "/architecture"]) {
    const deepRoute = await workerModule.default.fetch(new Request(`https://samaritan.test${pathname}`), env);
    assert(deepRoute.status === 200, `Sites Worker SPA fallback failed for ${pathname}`);
    assert((await deepRoute.text()).includes("<div id=\"root\"></div>"), `Sites Worker did not return the SPA for ${pathname}`);
    assert(deepRoute.headers.has("content-security-policy"), `Sites Worker omitted CSP for ${pathname}`);
  }

  const corruptRoute = verified.manifest.routes[0];
  assert(corruptRoute, "Sites edge manifest has no frozen route");
  const corruptBinding = new LocalAssetBinding(corruptRoute.assetPath);
  const corrupt = await workerModule.default.fetch(new Request(`https://samaritan.test${corruptRoute.apiPath}`), {
    ASSETS: corruptBinding
  });
  assert(corrupt.status === 503, "Sites Worker served a frozen API artifact after integrity failure");
  assert((await corrupt.json() as { error?: unknown }).error === "evidence_unavailable", "Integrity failure disclosed internals");
}

async function main(): Promise<void> {
  try {
    await verifyLayout();
    await verifyRuntime();
    process.stdout.write("Verified Sites Worker layout, frozen APIs, SPA fallback, and fail-closed integrity\n");
  } catch (error) {
    process.stderr.write(`Sites build verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
