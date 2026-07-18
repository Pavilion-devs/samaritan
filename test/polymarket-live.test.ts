import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { BoundedAsyncQueueOverflowError } from "../src/domain/bounded-async-queue.js";
import { livePolymarketEvents } from "../src/ingest/polymarket/live.js";
import { MappingRegistry, sha256 } from "../src/mapping/registry.js";

const rules = "First 90 minutes plus stoppage time; extra time excluded.";

function registry(): MappingRegistry {
  return new MappingRegistry([{
    mappingId: "live-queue-total",
    status: "candidate",
    txlineFixtureId: "fixture-live",
    teams: {
      home: { canonical: "Home", aliases: [] },
      away: { canonical: "Away", aliases: [] }
    },
    kickoff: { txlineTsMs: 2_000_000, polymarketTsMs: 2_000_000 },
    polymarketEventId: "event-live",
    polymarketEventSlug: "home-away-more-markets",
    conditions: [{
      polymarketMarketId: "market-live",
      conditionId: "condition-live",
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      rulesText: rules,
      rulesSha256: sha256(rules),
      tokens: [
        { assetId: "over-live", outcome: "over", role: "canonical" },
        { assetId: "under-live", outcome: "under", role: "canonical" }
      ]
    }]
  }]);
}

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  closeCode: number | null = null;

  send(data: unknown): void {
    this.sent.push(String(data));
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  message(payload: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }

  close(code = 1000): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.closeCode = code;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  terminate(): void {
    this.close(1006);
  }
}

function book(index: number): unknown {
  return {
    market: "condition-live",
    asset_id: "over-live",
    timestamp: String(1_000_000 + index),
    event_type: "book",
    hash: `book-${index}`,
    bids: [{ price: "0.49", size: "10" }],
    asks: [{ price: "0.51", size: "10" }]
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("live Polymarket bounded event queue", () => {
  it("ends immediately when aborted after a connecting status yield", async () => {
    const controller = new AbortController();
    const createSocket = vi.fn(() => new FakeSocket() as unknown as WebSocket);
    const iterator = livePolymarketEvents({
      registry: registry(),
      signal: controller.signal,
      createSocket
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: "feed.status", status: "connecting" }
    });
    controller.abort("stop between status and socket setup");
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(createSocket).not.toHaveBeenCalled();
  });

  it("halts the socket on overflow and exposes the exact high-water mark", async () => {
    const socket = new FakeSocket();
    const states: Array<{
      depth: number;
      highWaterMark: number;
      overflowCount: number;
      state: string;
    }> = [];
    let now = 10_000;
    const iterator = livePolymarketEvents({
      registry: registry(),
      eventQueueCapacity: 2,
      now: () => { now += 1; return now; },
      createSocket: () => socket as unknown as WebSocket,
      onQueueState: (state) => { states.push(state); }
    })[Symbol.asyncIterator]();

    const connecting = await iterator.next();
    expect(connecting.value).toMatchObject({
      kind: "feed.status",
      status: "connecting",
      source: "polymarket"
    });

    const firstBook = iterator.next();
    socket.open();
    socket.message(book(1));
    await expect(firstBook).resolves.toMatchObject({
      done: false,
      value: { kind: "polymarket.book", eventId: expect.stringContaining("polymarket:book:") }
    });

    // The generator is paused at its yield. Two events fill the fixed buffer;
    // the next event is not dropped—it converts the connection into a fatal
    // queue error and closes the socket.
    socket.message(book(2));
    socket.message(book(3));
    socket.message(book(4));

    const failure = await iterator.next().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BoundedAsyncQueueOverflowError);
    expect(failure).toMatchObject({
      capacity: 2,
      highWaterMark: 2,
      overflowCount: 1
    });
    expect(socket.closeCode).toBe(1011);
    expect(states.at(-1)).toMatchObject({
      depth: 0,
      highWaterMark: 2,
      overflowCount: 1,
      state: "failed"
    });
  });

  it("removes socket and reconnect-delay abort listeners after ordinary completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const socket = new FakeSocket();
    let socketCreated = false;
    const iterator = livePolymarketEvents({
      registry: registry(),
      signal: controller.signal,
      reconnectDelayMs: 50,
      createSocket: () => {
        socketCreated = true;
        return socket as unknown as WebSocket;
      }
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: "feed.status", status: "connecting" }
    });
    const reconnecting = iterator.next();
    await Promise.resolve();
    expect(socketCreated).toBe(true);
    socket.close();
    await vi.advanceTimersByTimeAsync(50);
    await expect(reconnecting).resolves.toMatchObject({
      value: { kind: "feed.status", status: "reconnecting" }
    });

    const abortListeners = add.mock.calls
      .filter(([type]) => type === "abort")
      .map(([, listener]) => listener);
    expect(abortListeners).toHaveLength(2);
    for (const listener of abortListeners) {
      expect(remove).toHaveBeenCalledWith("abort", listener);
    }
    await iterator.return?.(undefined);
  });
});
