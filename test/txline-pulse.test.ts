import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDashboardApi } from "../src/dash/api.js";
import { buildNodeTxlinePulse } from "../src/dash/txline-pulse-node.js";
import {
  buildTxlinePulse,
  createTxlinePulseCache,
  TXLINE_PULSE_CACHE_TTL_MS,
  TXLINE_PULSE_API_PATH,
  TXLINE_PULSE_STALE_RETENTION_MS,
  type TxlinePulseCredentials,
  type TxlinePulseResponse
} from "../src/dash/txline-pulse.js";

const credentials: TxlinePulseCredentials = {
  jwt: "test-jwt-not-a-real-secret",
  apiToken: "test-api-token-not-a-real-secret"
};

afterEach(() => vi.unstubAllEnvs());

function sequentialNow(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function pulse(overrides: Partial<TxlinePulseResponse> = {}): TxlinePulseResponse {
  return {
    network: "mainnet",
    serviceLevel: "SL12",
    checkedAt: "2026-07-18T08:00:00.000Z",
    status: "connected",
    latencyMsRounded: 100,
    aggregateFixtureCount: 2,
    freshnessClass: "current",
    ...overrides
  };
}

describe("licence-safe TXLine connectivity pulse", () => {
  it("returns only allowlisted derived metadata from an official mainnet snapshot", async () => {
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    const nowTs = Date.parse("2026-07-18T08:00:00.000Z");
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      requested.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify([
        { FixtureId: 12345678, Participant1: "Never public", StartTime: "2026-07-18T21:00:00Z", Pct: [51, 49] },
        { FixtureId: 87654321, Participant2: "Also private", StartTime: 1_784_483_200_000, Prices: [1900, 2100] }
      ]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          date: new Date(nowTs).toUTCString()
        }
      });
    }) as typeof fetch;

    const result = await buildTxlinePulse({
      credentials,
      fetchImpl,
      now: sequentialNow(nowTs - 101, nowTs)
    });

    expect(result).toEqual({
      network: "mainnet",
      serviceLevel: "SL12",
      checkedAt: "2026-07-18T08:00:00.000Z",
      status: "connected",
      latencyMsRounded: 125,
      aggregateFixtureCount: 2,
      freshnessClass: "current"
    });
    expect(Object.keys(result)).toEqual([
      "network",
      "serviceLevel",
      "checkedAt",
      "status",
      "latencyMsRounded",
      "aggregateFixtureCount",
      "freshnessClass"
    ]);
    expect(requested[0]?.url).toBe(
      `https://txline.txodds.com/api/fixtures/snapshot?startEpochDay=${Math.floor((nowTs - 101) / 86_400_000)}`
    );
    expect(new Headers(requested[0]?.init?.headers).get("authorization")).toBe(`Bearer ${credentials.jwt}`);
    expect(new Headers(requested[0]?.init?.headers).get("x-api-token")).toBe(credentials.apiToken);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["FixtureId", "Participant1", "StartTime", "Pct", "Prices", "12345678", "Never public", credentials.jwt, credentials.apiToken]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("degrades without credentials and does not attempt a network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await buildTxlinePulse({
      credentials: null,
      fetchImpl,
      now: () => Date.parse("2026-07-18T08:01:00.000Z")
    });
    expect(result).toMatchObject({
      network: "mainnet",
      serviceLevel: "SL12",
      status: "degraded",
      latencyMsRounded: null,
      aggregateFixtureCount: null,
      freshnessClass: "unknown"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an explicit SL12 assertion for environment-loaded credentials", async () => {
    vi.stubEnv("TXLINE_JWT", credentials.jwt);
    vi.stubEnv("TXLINE_API_TOKEN", credentials.apiToken);
    vi.stubEnv("TXLINE_SERVICE_LEVEL_ID", "1");
    const fetchMock = vi.fn<typeof fetch>();
    const degraded = await buildNodeTxlinePulse("/tmp/samaritan-pulse-no-local-token", {
      fetchImpl: fetchMock,
      now: () => Date.parse("2026-07-18T08:01:30.000Z")
    });
    expect(degraded.status).toBe("degraded");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("TXLINE_SERVICE_LEVEL_ID", "12");
    const connected = await buildNodeTxlinePulse("/tmp/samaritan-pulse-no-local-token", {
      fetchImpl: vi.fn(async () => new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", date: "Sat, 18 Jul 2026 08:01:30 GMT" }
      })) as typeof fetch,
      now: () => Date.parse("2026-07-18T08:01:30.000Z")
    });
    expect(connected).toMatchObject({ status: "connected", serviceLevel: "SL12" });
  });

  it.each([
    ["non-success", new Response("unauthorized", { status: 401, headers: { "content-type": "text/plain" } })],
    ["non-array", new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })],
    ["malformed array rows", new Response(JSON.stringify([null, 1, "x"]), { status: 200, headers: { "content-type": "application/json" } })],
    ["missing fixture identity", new Response(JSON.stringify([{ Participant1: "No identity" }]), { status: 200, headers: { "content-type": "application/json" } })],
    ["oversized", new Response("[]", { status: 200, headers: { "content-type": "application/json", "content-length": "300000" } })]
  ])("returns a non-disclosing degraded state for %s responses", async (_label, response) => {
    const result = await buildTxlinePulse({
      credentials,
      fetchImpl: vi.fn(async () => response) as typeof fetch,
      now: () => Date.parse("2026-07-18T08:02:00.000Z")
    });
    expect(result).toMatchObject({
      status: "degraded",
      aggregateFixtureCount: null,
      freshnessClass: "unknown"
    });
    expect(Object.keys(result)).toHaveLength(7);
  });

  it("times out to the same degraded envelope", async () => {
    const fetchImpl = vi.fn((_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })) as typeof fetch;
    const result = await buildTxlinePulse({
      credentials,
      fetchImpl,
      timeoutMs: 100,
      now: () => Date.parse("2026-07-18T08:03:00.000Z")
    });
    expect(result).toMatchObject({ status: "degraded", aggregateFixtureCount: null, freshnessClass: "unknown" });
  });

  it("coalesces concurrent callers into one bounded upstream request", async () => {
    const cache = createTxlinePulseCache();
    let finish: ((value: TxlinePulseResponse) => void) | undefined;
    const load = vi.fn(() => new Promise<TxlinePulseResponse>((resolve) => {
      finish = resolve;
    }));

    const get = cache.get("configured", load);
    const head = cache.get("configured", load);
    expect(load).toHaveBeenCalledTimes(1);
    finish?.(pulse());

    await expect(Promise.all([get, head])).resolves.toEqual([pulse(), pulse()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches for one minute, then serves a bounded stale/degraded aggregate on refresh failure", async () => {
    const baseTsMs = Date.parse("2026-07-18T08:00:00.000Z");
    let clockTsMs = baseTsMs;
    const cache = createTxlinePulseCache({ now: () => clockTsMs });
    const connected = pulse();
    const degraded = pulse({
      checkedAt: "2026-07-18T08:01:00.000Z",
      status: "degraded",
      latencyMsRounded: null,
      aggregateFixtureCount: null,
      freshnessClass: "unknown"
    });
    const load = vi.fn(async () => load.mock.calls.length === 1 ? connected : degraded);

    await expect(cache.get("configured", load)).resolves.toEqual(connected);
    clockTsMs = baseTsMs + TXLINE_PULSE_CACHE_TTL_MS - 1;
    await expect(cache.get("configured", load)).resolves.toEqual(connected);
    expect(load).toHaveBeenCalledTimes(1);

    clockTsMs = baseTsMs + TXLINE_PULSE_CACHE_TTL_MS;
    const stale = await cache.get("configured", load);
    expect(stale).toEqual({
      ...connected,
      status: "degraded",
      latencyMsRounded: null,
      freshnessClass: "stale"
    });
    expect(Object.keys(stale)).toHaveLength(7);
    expect(load).toHaveBeenCalledTimes(2);

    clockTsMs = baseTsMs + TXLINE_PULSE_STALE_RETENTION_MS + 1;
    await expect(cache.get("configured", load)).resolves.toEqual(degraded);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("serves GET/HEAD only with no-store and never fetches on POST", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", date: "Sat, 18 Jul 2026 08:04:00 GMT" }
    }));
    const fetchImpl = fetchMock as typeof fetch;
    const options = {
      credentials,
      fetchImpl,
      now: () => Date.parse("2026-07-18T08:04:00.000Z")
    };
    const get = await handleDashboardApi(TXLINE_PULSE_API_PATH, process.cwd(), { method: "GET", txlinePulse: options });
    const head = await handleDashboardApi(TXLINE_PULSE_API_PATH, process.cwd(), { method: "HEAD", txlinePulse: options });
    const callsBeforePost = fetchMock.mock.calls.length;
    const post = await handleDashboardApi(TXLINE_PULSE_API_PATH, process.cwd(), { method: "POST", txlinePulse: options });

    expect(get).toMatchObject({ status: 200, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
    expect(JSON.parse(get!.body)).toMatchObject({ status: "connected", aggregateFixtureCount: 0 });
    expect(head?.status).toBe(200);
    expect(post).toMatchObject({ status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforePost);
  });
});
