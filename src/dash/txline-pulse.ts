export const TXLINE_PULSE_API_PATH = "/api/v1/txline/pulse" as const;
export const TXLINE_PULSE_ORIGIN = "https://txline.txodds.com" as const;
export const TXLINE_PULSE_TIMEOUT_MS = 4_000;
export const TXLINE_PULSE_MAX_RESPONSE_BYTES = 256 * 1_024;
export const TXLINE_PULSE_CACHE_TTL_MS = 60_000;
export const TXLINE_PULSE_STALE_RETENTION_MS = 5 * 60_000;

export type TxlinePulseCredentials = {
  jwt: string;
  apiToken: string;
};

export type TxlinePulseResponse = {
  network: "mainnet";
  serviceLevel: "SL12";
  checkedAt: string;
  status: "connected" | "degraded";
  latencyMsRounded: number | null;
  aggregateFixtureCount: number | null;
  freshnessClass: "current" | "stale" | "unknown";
};

export type TxlinePulseOptions = {
  credentials: TxlinePulseCredentials | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type TxlinePulseCacheScope = "configured" | "unconfigured";

export type TxlinePulseCache = {
  get(scope: TxlinePulseCacheScope, load: () => Promise<TxlinePulseResponse>): Promise<TxlinePulseResponse>;
};

type CachedPulse = {
  value: TxlinePulseResponse;
  cachedAtTsMs: number;
  expiresAtTsMs: number;
};

type PulseCacheSlot = {
  served: CachedPulse | null;
  lastConnected: CachedPulse | null;
  inFlight: Promise<TxlinePulseResponse> | null;
};

function validCredential(value: string): boolean {
  return value.trim().length >= 12 && !/[\r\n]/.test(value);
}

function roundedLatency(startedAt: number, checkedAt: number): number {
  const elapsed = Math.max(0, checkedAt - startedAt);
  return Math.max(25, Math.ceil(elapsed / 25) * 25);
}

function responseFreshness(response: Response, checkedAt: number): TxlinePulseResponse["freshnessClass"] {
  const responseDate = response.headers.get("date");
  if (!responseDate) return "unknown";
  const responseTs = Date.parse(responseDate);
  if (!Number.isFinite(responseTs)) return "unknown";
  return Math.abs(checkedAt - responseTs) <= 2 * 60_000 ? "current" : "stale";
}

async function cappedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("TXLine pulse response exceeds the public-derivation cap");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new Error("TXLine pulse response exceeds the public-derivation cap");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error("TXLine pulse response exceeds the public-derivation cap");
    }
    chunks.push(next.value);
  }
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function basePulse(checkedAt: number): TxlinePulseResponse {
  return {
    network: "mainnet",
    serviceLevel: "SL12",
    checkedAt: new Date(checkedAt).toISOString(),
    status: "degraded",
    latencyMsRounded: null,
    aggregateFixtureCount: null,
    freshnessClass: "unknown"
  };
}

/**
 * Keeps the public Worker pulse bounded to one upstream request per credential
 * state and cache window. Concurrent callers share one promise. A failed
 * refresh may retain only the previous aggregate count for five minutes, and
 * is explicitly downgraded to stale/degraded before it crosses the boundary.
 */
export function createTxlinePulseCache(options: {
  now?: () => number;
  ttlMs?: number;
  staleRetentionMs?: number;
} = {}): TxlinePulseCache {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? TXLINE_PULSE_CACHE_TTL_MS;
  const staleRetentionMs = options.staleRetentionMs ?? TXLINE_PULSE_STALE_RETENTION_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60_000) {
    throw new Error("TXLine pulse cache TTL must be between 1 and 300 seconds");
  }
  if (
    !Number.isSafeInteger(staleRetentionMs) ||
    staleRetentionMs < ttlMs ||
    staleRetentionMs > 15 * 60_000
  ) {
    throw new Error("TXLine pulse stale retention must be between the cache TTL and 15 minutes");
  }
  const slots: Record<TxlinePulseCacheScope, PulseCacheSlot> = {
    configured: { served: null, lastConnected: null, inFlight: null },
    unconfigured: { served: null, lastConnected: null, inFlight: null }
  };

  return {
    get(scope, load) {
      const slot = slots[scope];
      const requestedAtTsMs = now();
      if (slot.served && requestedAtTsMs < slot.served.expiresAtTsMs) {
        return Promise.resolve(slot.served.value);
      }
      if (slot.inFlight) return slot.inFlight;

      const request = (async (): Promise<TxlinePulseResponse> => {
        let loaded: TxlinePulseResponse;
        try {
          loaded = await load();
        } catch {
          loaded = basePulse(now());
        }
        const completedAtTsMs = now();
        if (loaded.status === "connected") {
          const connected = {
            value: loaded,
            cachedAtTsMs: completedAtTsMs,
            expiresAtTsMs: completedAtTsMs + ttlMs
          };
          slot.lastConnected = connected;
          slot.served = connected;
          return loaded;
        }

        const lastConnected = slot.lastConnected;
        if (
          lastConnected &&
          Math.max(0, completedAtTsMs - lastConnected.cachedAtTsMs) <= staleRetentionMs
        ) {
          const stale: TxlinePulseResponse = {
            ...lastConnected.value,
            status: "degraded",
            latencyMsRounded: null,
            freshnessClass: "stale"
          };
          slot.served = {
            value: stale,
            cachedAtTsMs: completedAtTsMs,
            expiresAtTsMs: completedAtTsMs + ttlMs
          };
          return stale;
        }

        slot.lastConnected = null;
        slot.served = {
          value: loaded,
          cachedAtTsMs: completedAtTsMs,
          expiresAtTsMs: completedAtTsMs + ttlMs
        };
        return loaded;
      })();
      slot.inFlight = request;
      const clearInFlight = () => {
        if (slot.inFlight === request) slot.inFlight = null;
      };
      void request.then(clearInFlight, clearInFlight);
      return request;
    }
  };
}

function validFixtureIdentityRow(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length === 0) return false;
  const fixtureId = row.FixtureId;
  const validFixtureId =
    (typeof fixtureId === "number" && Number.isSafeInteger(fixtureId) && fixtureId > 0) ||
    (typeof fixtureId === "string" && /^[1-9][0-9]*$/.test(fixtureId));
  if (!validFixtureId) return false;
  const startTime = row.StartTime;
  if (typeof startTime === "number") return Number.isFinite(startTime) && startTime > 0;
  if (typeof startTime !== "string" || startTime.trim().length === 0) return false;
  const numeric = Number(startTime);
  return (Number.isFinite(numeric) && numeric > 0) || Number.isFinite(Date.parse(startTime));
}

/**
 * Calls the official fixture snapshot only, then destroys the payload after
 * deriving an aggregate count and response-header freshness class. No raw row,
 * identity, market value, source timestamp, or credential crosses this return
 * boundary. The function is Worker-portable; credential loading stays outside.
 */
export async function buildTxlinePulse(options: TxlinePulseOptions): Promise<TxlinePulseResponse> {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? TXLINE_PULSE_TIMEOUT_MS;
  const maximumBytes = options.maxResponseBytes ?? TXLINE_PULSE_MAX_RESPONSE_BYTES;
  const startedAt = now();
  const degraded = () => basePulse(now());
  const credentials = options.credentials;
  if (!credentials || !validCredential(credentials.jwt) || !validCredential(credentials.apiToken)) return degraded();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) return degraded();
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1_024 || maximumBytes > 1_048_576) return degraded();

  const epochDay = Math.floor(startedAt / 86_400_000);
  const url = `${TXLINE_PULSE_ORIGIN}/api/fixtures/snapshot?startEpochDay=${epochDay}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("TXLine pulse timed out"));
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${credentials.jwt}`,
          "X-Api-Token": credentials.apiToken
        },
        signal: controller.signal
      }),
      timeout
    ]);
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return {
        ...basePulse(now()),
        latencyMsRounded: roundedLatency(startedAt, now())
      };
    }
    const text = await cappedResponseText(response, maximumBytes);
    const rows = JSON.parse(text) as unknown;
    if (!Array.isArray(rows) || !rows.every(validFixtureIdentityRow)) return {
      ...basePulse(now()),
      latencyMsRounded: roundedLatency(startedAt, now())
    };
    const checkedAt = now();
    return {
      network: "mainnet",
      serviceLevel: "SL12",
      checkedAt: new Date(checkedAt).toISOString(),
      status: "connected",
      latencyMsRounded: roundedLatency(startedAt, checkedAt),
      aggregateFixtureCount: rows.length,
      freshnessClass: responseFreshness(response, checkedAt)
    };
  } catch {
    return degraded();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
