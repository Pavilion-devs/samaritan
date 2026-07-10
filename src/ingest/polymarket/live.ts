import { createHash } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type FeedEvent
} from "../../bus/events.js";
import { MappingRegistry } from "../../mapping/registry.js";
import { normalizePolymarketPayload } from "./normalizer.js";

export const POLYMARKET_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export type PolymarketLiveOptions = {
  registry: MappingRegistry;
  signal?: AbortSignal;
  reconnectDelayMs?: number;
  discoveryIntervalMs?: number;
  refreshMappings?: () => Promise<MappingRegistry>;
  now?: () => number;
  createSocket?: (url: string) => WebSocket;
};

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

type QueueItem<T> = { type: "value"; value: T } | { type: "end" };

class AsyncQueue<T> {
  readonly #items: QueueItem<T>[] = [];
  #waiting: ((item: QueueItem<T>) => void) | null = null;

  push(value: T): void {
    this.#put({ type: "value", value });
  }

  end(): void {
    this.#put({ type: "end" });
  }

  #put(item: QueueItem<T>): void {
    if (this.#waiting) {
      const waiting = this.#waiting;
      this.#waiting = null;
      waiting(item);
    } else this.#items.push(item);
  }

  async take(): Promise<QueueItem<T>> {
    const item = this.#items.shift();
    if (item) return item;
    return new Promise((resolve) => {
      this.#waiting = resolve;
    });
  }
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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export async function* livePolymarketEvents(options: PolymarketLiveOptions): AsyncGenerator<CanonicalEvent> {
  const now = options.now ?? Date.now;
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const discoveryIntervalMs = options.discoveryIntervalMs ?? 60_000;
  let registry = options.registry;
  const subscribed = new Set(registry.assetIds());
  let connection = 0;

  while (!isAborted(options.signal)) {
    yield statusEvent(connection === 0 ? "connecting" : "reconnecting", null, now(), connection);
    const queue = new AsyncQueue<CanonicalEvent>();
    const socket = createSocket(POLYMARKET_MARKET_WS_URL);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let discovery: ReturnType<typeof setInterval> | undefined;
    let refreshBusy = false;

    const abort = () => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "aborted");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
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
              queue.push(statusEvent("degraded", `mapping discovery: ${detail}`, now(), connection));
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
        for (const event of normalizePolymarketPayload(payload, observedTsMs, registry)) queue.push(event);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        queue.push(statusEvent("degraded", `message rejected: ${detail}`, observedTsMs, connection));
      }
    });
    socket.on("error", (error) => {
      queue.push(statusEvent("degraded", error.message, now(), connection));
    });
    socket.on("close", () => queue.end());

    try {
      while (true) {
        const item = await queue.take();
        if (item.type === "end") break;
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
