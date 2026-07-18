import { createHash } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type FeedEvent
} from "../../bus/events.js";
import {
  BoundedAsyncQueue,
  type BoundedAsyncQueueSnapshot
} from "../../domain/bounded-async-queue.js";
import { MappingRegistry } from "../../mapping/registry.js";
import { normalizePolymarketPayload } from "./normalizer.js";

export const POLYMARKET_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
export const POLYMARKET_DEFAULT_EVENT_QUEUE_CAPACITY = 1_024;

export type PolymarketLiveOptions = {
  registry: MappingRegistry;
  signal?: AbortSignal;
  reconnectDelayMs?: number;
  discoveryIntervalMs?: number;
  refreshMappings?: () => Promise<MappingRegistry>;
  now?: () => number;
  createSocket?: (url: string) => WebSocket;
  eventQueueCapacity?: number;
  /** Synchronous operations telemetry; queue failure still wins if this throws. */
  onQueueState?: (snapshot: BoundedAsyncQueueSnapshot) => void;
};

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && typeof (value as { then?: unknown }).then === "function";
}

function statusEvent(
  status: FeedEvent["status"],
  detail: string | null,
  now: number,
  connection: number
): FeedEvent {
  const identity = `${status}:${detail ?? ""}:${now}:${connection}`;
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "feed.status",
    eventId: `polymarket:status:${createHash("sha256").update(identity).digest("hex")}`,
    source: "polymarket",
    sourceTsMs: now,
    observedTsMs: now,
    fixtureId: null,
    status,
    stream: "market-websocket",
    detail
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function subscribe(socket: WebSocket, assetIds: string[], operation?: "subscribe"): void {
  for (const group of chunks(assetIds, 100)) {
    if (group.length === 0) continue;
    socket.send(
      JSON.stringify(
        operation
          ? { assets_ids: group, operation, custom_feature_enabled: true }
          : { assets_ids: group, type: "market", custom_feature_enabled: true }
      )
    );
  }
}

function rawDataAsString(data: RawData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return data.toString("utf8");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (isAborted(signal)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function* livePolymarketEvents(options: PolymarketLiveOptions): AsyncGenerator<CanonicalEvent> {
  const now = options.now ?? Date.now;
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const discoveryIntervalMs = options.discoveryIntervalMs ?? 60_000;
  const eventQueueCapacity = options.eventQueueCapacity ?? POLYMARKET_DEFAULT_EVENT_QUEUE_CAPACITY;
  let registry = options.registry;
  const subscribed = new Set(registry.assetIds());
  let connection = 0;

  while (!isAborted(options.signal)) {
    yield statusEvent(connection === 0 ? "connecting" : "reconnecting", null, now(), connection);
    if (isAborted(options.signal)) break;
    const queue = new BoundedAsyncQueue<CanonicalEvent>({
      label: "Polymarket WebSocket canonical event queue",
      capacity: eventQueueCapacity
    });
    const socket = createSocket(POLYMARKET_MARKET_WS_URL);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let discovery: ReturnType<typeof setInterval> | undefined;
    let refreshBusy = false;
    let halted = false;

    const reportQueue = (snapshot: BoundedAsyncQueueSnapshot): void => {
      const result: unknown = options.onQueueState?.(snapshot);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new Error("Polymarket onQueueState must be synchronous");
      }
    };
    const halt = (error: unknown): void => {
      if (halted) return;
      halted = true;
      const snapshot = queue.fail(error);
      try {
        reportQueue(snapshot);
      } catch {
        // Preserve the queue/runtime failure that caused the halt.
      }
      if (socket.readyState === WebSocket.OPEN) socket.close(1011, "event queue halted");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    };
    const enqueue = (event: CanonicalEvent): boolean => {
      if (halted) return false;
      try {
        reportQueue(queue.push(event));
        return true;
      } catch (error) {
        halt(error);
        return false;
      }
    };

    const abort = () => {
      if (!halted) {
        try {
          reportQueue(queue.stop());
        } catch (error) {
          halt(error);
        }
      }
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "aborted");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (isAborted(options.signal)) abort();
    socket.on("open", () => {
      subscribe(socket, [...subscribed]);
      heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("PING");
      }, 10_000);
      if (options.refreshMappings) {
        discovery = setInterval(() => {
          if (refreshBusy || socket.readyState !== WebSocket.OPEN) return;
          refreshBusy = true;
          void options
            .refreshMappings!()
            .then((nextRegistry) => {
              registry = nextRegistry;
              const additions = registry.assetIds().filter((assetId) => !subscribed.has(assetId));
              for (const assetId of additions) subscribed.add(assetId);
              subscribe(socket, additions, "subscribe");
            })
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              enqueue(statusEvent("degraded", `mapping discovery: ${detail}`, now(), connection));
            })
            .finally(() => {
              refreshBusy = false;
            });
        }, discoveryIntervalMs);
      }
    });
    socket.on("message", (data) => {
      const observedTsMs = now();
      const raw = rawDataAsString(data);
      if (raw === "ping") {
        if (socket.readyState === WebSocket.OPEN) socket.send("pong");
        return;
      }
      if (["PING", "PONG", "pong"].includes(raw)) return;
      try {
        const payload = JSON.parse(raw) as unknown;
        for (const event of normalizePolymarketPayload(payload, observedTsMs, registry)) {
          if (!enqueue(event)) break;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        enqueue(statusEvent("degraded", `message rejected: ${detail}`, observedTsMs, connection));
      }
    });
    socket.on("error", (error) => {
      enqueue(statusEvent("degraded", error.message, now(), connection));
    });
    socket.on("close", () => {
      if (halted) return;
      try {
        reportQueue(queue.end());
      } catch (error) {
        halt(error);
      }
    });

    try {
      while (true) {
        const item = await queue.take();
        if (item.done) break;
        yield item.value;
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (discovery) clearInterval(discovery);
      options.signal?.removeEventListener("abort", abort);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "consumer ended");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    }
    connection += 1;
    if (isAborted(options.signal)) break;
    await delay(reconnectDelayMs, options.signal);
  }
}
