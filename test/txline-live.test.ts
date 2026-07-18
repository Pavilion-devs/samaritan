import { afterEach, describe, expect, it, vi } from "vitest";
import { liveTxLineEvents } from "../src/ingest/txline/live.js";
import { TxLineSessionManager } from "../src/ingest/txline/session.js";

function session(): TxLineSessionManager {
  return new TxLineSessionManager({ jwt: "test.jwt.value", apiToken: "test-token" });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("live TXLine cancellation", () => {
  it("passes AbortSignal to snapshot backfill and performs no body work after abort", async () => {
    const controller = new AbortController();
    const text = vi.fn(async () => "[]");
    let requestSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | null ?? null;
      controller.abort("test snapshot cancellation");
      return {
        ok: true,
        status: 200,
        body: null,
        text
      } as unknown as Response;
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const iterator = liveTxLineEvents({
      network: "mainnet",
      stream: "odds",
      fixtureId: "fixture-1",
      session: session(),
      signal: controller.signal,
      fetchImpl
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: "feed.status", status: "connecting" }
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/odds/snapshot/fixture-1");
    expect(requestSignal).toBe(controller.signal);
    expect(text).not.toHaveBeenCalled();
  });

  it("removes the reconnect abort listener when the timer completes normally", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline test feed");
    }) as unknown as typeof fetch;
    const iterator = liveTxLineEvents({
      network: "mainnet",
      stream: "scores",
      session: session(),
      signal: controller.signal,
      reconnectDelayMs: 50,
      fetchImpl
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: "feed.status", status: "connecting" }
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { kind: "feed.status", status: "degraded" }
    });

    const reconnecting = iterator.next();
    await vi.advanceTimersByTimeAsync(50);
    await expect(reconnecting).resolves.toMatchObject({
      value: { kind: "feed.status", status: "reconnecting" }
    });

    const delayListener = add.mock.calls.find(([type]) => type === "abort")?.[1];
    expect(delayListener).toBeTypeOf("function");
    expect(remove).toHaveBeenCalledWith("abort", delayListener);
    await iterator.return?.(undefined);
  });
});
