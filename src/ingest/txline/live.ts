import { createHash } from "node:crypto";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type FeedEvent
} from "../../bus/events.js";
import { decodeSse, type IngestEnvelope } from "../sse.js";
import { normalizeTxLineEnvelope } from "./normalizer.js";
import { TXLINE_ORIGINS, TxLineSessionManager, type TxLineNetwork } from "./session.js";

export type TxLineStream = "odds" | "scores";

export type TxLineLiveOptions = {
  network: TxLineNetwork;
  stream: TxLineStream;
  session: TxLineSessionManager;
  fixtureId?: string;
  signal?: AbortSignal;
  reconnectDelayMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function statusEvent(
  stream: TxLineStream,
  status: FeedEvent["status"],
  detail: string | null,
  now: number,
  attempt: number
): FeedEvent {
  const identity = `${stream}:${status}:${now}:${attempt}:${detail ?? ""}`;
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "feed.status",
    eventId: `txline:status:${createHash("sha256").update(identity).digest("hex")}`,
    source: "txline",
    sourceTsMs: now,
    observedTsMs: now,
    fixtureId: null,
    status,
    stream,
    detail
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
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

async function* snapshotBackfill(options: TxLineLiveOptions): AsyncGenerator<CanonicalEvent> {
  if (!options.fixtureId || isAborted(options.signal)) return;
  const request = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const origin = TXLINE_ORIGINS[options.network];
  const asOf = options.stream === "odds" ? `?asOf=${now()}` : "";
  const url = `${origin}/api/${options.stream}/snapshot/${encodeURIComponent(options.fixtureId)}${asOf}`;
  const headers = await options.session.headers(now());
  if (isAborted(options.signal)) return;
  const requestInit: RequestInit = { headers };
  if (options.signal !== undefined) requestInit.signal = options.signal;
  const response = await request(url, requestInit);
  if (isAborted(options.signal)) return;
  const text = await response.text();
  if (isAborted(options.signal)) return;
  if (!response.ok) throw new Error(`TXLine ${options.stream} backfill failed ${response.status}: ${text.slice(0, 200)}`);
  const payload = JSON.parse(text) as unknown;
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (isAborted(options.signal)) return;
    const envelope: IngestEnvelope = {
      stream: options.stream,
      observedTsMs: now(),
      message: { id: null, event: null, data: JSON.stringify(row), retryMs: null }
    };
    for (const event of normalizeTxLineEnvelope(envelope)) {
      if (isAborted(options.signal)) return;
      yield event;
    }
  }
}

export async function* liveTxLineEvents(options: TxLineLiveOptions): AsyncGenerator<CanonicalEvent> {
  const request = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const origin = TXLINE_ORIGINS[options.network];
  const query = options.fixtureId ? `?fixtureId=${encodeURIComponent(options.fixtureId)}` : "";
  let lastEventId = "";
  let attempt = 0;

  while (!isAborted(options.signal)) {
    yield statusEvent(options.stream, attempt === 0 ? "connecting" : "reconnecting", null, now(), attempt);
    if (isAborted(options.signal)) break;
    if (options.fixtureId) {
      try {
        yield* snapshotBackfill(options);
      } catch (error) {
        if (isAborted(options.signal)) break;
        const detail = error instanceof Error ? error.message : String(error);
        yield statusEvent(options.stream, "degraded", detail, now(), attempt);
      }
    }
    if (isAborted(options.signal)) break;

    try {
      const headers: Record<string, string> = {
        ...(await options.session.headers(now())),
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "gzip"
      };
      if (lastEventId !== "") headers["Last-Event-ID"] = lastEventId;
      const requestInit: RequestInit = { headers };
      if (options.signal !== undefined) requestInit.signal = options.signal;
      const response = await request(`${origin}/api/${options.stream}/stream${query}`, requestInit);
      if (isAborted(options.signal)) break;
      if (!response.ok || response.body === null) {
        const text = await response.text();
        if (isAborted(options.signal)) break;
        throw new Error(`TXLine ${options.stream} SSE failed ${response.status}: ${text.slice(0, 200)}`);
      }
      for await (const envelope of decodeSse(response.body, options.stream, now)) {
        if (isAborted(options.signal)) break;
        if (envelope.message.id !== null) lastEventId = envelope.message.id;
        for (const event of normalizeTxLineEnvelope(envelope)) {
          if (isAborted(options.signal)) break;
          yield event;
        }
      }
    } catch (error) {
      if (isAborted(options.signal)) break;
      const detail = error instanceof Error ? error.message : String(error);
      yield statusEvent(options.stream, "degraded", detail, now(), attempt);
    }
    attempt += 1;
    await abortableDelay(reconnectDelayMs, options.signal);
  }
}
