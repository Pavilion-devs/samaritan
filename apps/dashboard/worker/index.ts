import edgeManifestValue from "../../../public/artifacts/edge/manifest.json";
import {
  buildTxlinePulse,
  createTxlinePulseCache,
  TXLINE_PULSE_API_PATH
} from "../../../src/dash/txline-pulse.js";

type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

export type SamaritanWorkerEnv = {
  ASSETS: AssetFetcher;
  TXLINE_JWT?: string;
  TXLINE_API_TOKEN?: string;
  TXLINE_SERVICE_LEVEL_ID?: string;
};

type EdgeRoute = {
  apiPath: string;
  assetPath: string;
  bytes: number;
  sha256: string;
};

type EdgeManifest = {
  sourceBundleSha256: string;
  edgeBundleSha256: string;
  routes: EdgeRoute[];
};

const edgeManifest = edgeManifestValue as EdgeManifest;
const apiRoutes = new Map(edgeManifest.routes.map((route) => [route.apiPath, route]));
const txlinePulseCache = createTxlinePulseCache();

const securityHeaders: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

function secureHeaders(source?: HeadersInit): Headers {
  const headers = new Headers(source);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  return headers;
}

function jsonResponse(
  status: number,
  value: unknown,
  options: { headOnly?: boolean; headers?: HeadersInit } = {}
): Response {
  const body = `${JSON.stringify(value)}\n`;
  const headers = secureHeaders(options.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
  return new Response(options.headOnly ? null : body, { status, headers });
}

function methodNotAllowed(headOnly: boolean): Response {
  return jsonResponse(405, { error: "method_not_allowed" }, {
    headOnly,
    headers: { allow: "GET, HEAD" }
  });
}

function unavailable(headOnly: boolean): Response {
  return jsonResponse(503, { error: "evidence_unavailable" }, { headOnly });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function frozenApiResponse(
  request: Request,
  env: SamaritanWorkerEnv,
  route: EdgeRoute
): Promise<Response> {
  try {
    const assetUrl = new URL(route.assetPath, request.url);
    const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, {
      method: "GET",
      headers: { accept: "application/json" }
    }));
    if (!assetResponse.ok) return unavailable(request.method === "HEAD");
    const body = await assetResponse.arrayBuffer();
    const bytes = new Uint8Array(body);
    if (bytes.byteLength !== route.bytes || await sha256Hex(body) !== route.sha256) {
      return unavailable(request.method === "HEAD");
    }
    const headers = secureHeaders({
      "cache-control": "no-store",
      "content-length": String(bytes.byteLength),
      "content-type": "application/json; charset=utf-8",
      "x-samaritan-edge-bundle": edgeManifest.edgeBundleSha256,
      "x-samaritan-public-bundle": edgeManifest.sourceBundleSha256
    });
    return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
  } catch {
    return unavailable(request.method === "HEAD");
  }
}

function isSpaRoute(pathname: string): boolean {
  const finalSegment = pathname.split("/").at(-1) ?? "";
  return pathname === "/" || pathname.endsWith("/") || !finalSegment.includes(".");
}

function staticResponse(request: Request, response: Response, spaFallback: boolean): Response {
  const headers = secureHeaders(response.headers);
  const pathname = new URL(request.url).pathname;
  if (spaFallback || pathname === "/" || pathname === "/index.html") {
    headers.set("cache-control", "no-cache");
  } else if (pathname.startsWith("/artifacts/")) {
    headers.set("cache-control", "no-store");
  } else if (pathname.startsWith("/assets/") && response.ok) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else if (!response.ok) {
    headers.set("cache-control", "no-store");
  }
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function assetResponse(request: Request, env: SamaritanWorkerEnv): Promise<Response> {
  const direct = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  if (direct.status !== 404 || !isSpaRoute(url.pathname)) {
    return staticResponse(request, direct, false);
  }
  const fallbackUrl = new URL("/index.html", url);
  const fallback = await env.ASSETS.fetch(new Request(fallbackUrl, {
    method: request.method,
    headers: request.headers
  }));
  return staticResponse(request, fallback, true);
}

async function handleRequest(request: Request, env: SamaritanWorkerEnv): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return methodNotAllowed(false);

  const pathname = new URL(request.url).pathname;
  const route = apiRoutes.get(pathname);
  if (route) return frozenApiResponse(request, env, route);
  if (pathname === TXLINE_PULSE_API_PATH) {
    const credentials = env.TXLINE_SERVICE_LEVEL_ID === "12" && env.TXLINE_JWT && env.TXLINE_API_TOKEN
      ? { jwt: env.TXLINE_JWT, apiToken: env.TXLINE_API_TOKEN }
      : null;
    const pulse = await txlinePulseCache.get(
      credentials === null ? "unconfigured" : "configured",
      () => buildTxlinePulse({ credentials })
    );
    return jsonResponse(200, pulse, { headOnly: method === "HEAD" });
  }
  if (pathname === "/api/v1/health") {
    return jsonResponse(200, { status: "ok", service: "samaritan-dashboard", readOnly: true }, {
      headOnly: method === "HEAD"
    });
  }
  if (pathname.startsWith("/api/")) {
    return jsonResponse(404, { error: "not_found" }, { headOnly: method === "HEAD" });
  }
  return assetResponse(request, env);
}

export default {
  fetch(request: Request, env: SamaritanWorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  }
};
