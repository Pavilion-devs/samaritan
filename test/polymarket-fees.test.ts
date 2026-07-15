import { describe, expect, it } from "vitest";
import type { PolymarketBookEvent } from "../src/bus/events.js";
import { probability } from "../src/domain/probability.js";
import { PolymarketClobFeeResolver } from "../src/ingest/polymarket/fees.js";

function book(): PolymarketBookEvent {
  return {
    schemaVersion: 1,
    kind: "polymarket.book",
    eventId: "fee-book",
    source: "polymarket",
    sourceTsMs: 1_000,
    observedTsMs: 1_000,
    fixtureId: "fixture-1",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-1:total_goals:full_time:2500"
    },
    mappingStatus: "candidate",
    conditionId: "condition-1",
    assetId: "asset-over",
    outcome: "over",
    tokenRole: "canonical",
    bids: [{ price: probability(0.49), size: "10" }],
    asks: [{ price: probability(0.51), size: "10" }],
    lastTradePrice: probability(0.5),
    tickSize: "0.01"
  };
}

function marketInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    c: "condition-1",
    t: [
      { t: "asset-over", o: "Over" },
      { t: "asset-under", o: "Under" }
    ],
    mos: 5,
    mts: 0.01,
    tbf: 1_000,
    fd: { r: 0.05, e: 1, to: true },
    ...overrides
  };
}

describe("Polymarket public fee resolver", () => {
  it("combines the request deadline with an operator halt signal", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const resolver = new PolymarketClobFeeResolver({
      fetchImpl: async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
        });
      }
    });

    const pending = resolver.resolve(book(), controller.signal);
    await Promise.resolve();
    controller.abort(new Error("operator halt"));
    await expect(pending).rejects.toThrow(/operator halt/);
    expect(requestSignal?.aborted).toBe(true);
  });

  it("parses and caches explicit V2 fee-curve and market execution parameters", async () => {
    let requests = 0;
    let now = 2_000;
    const resolver = new PolymarketClobFeeResolver({
      now: () => now,
      fetchImpl: async () => {
        requests += 1;
        return new Response(JSON.stringify(marketInfo()), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    await expect(resolver.resolve(book())).resolves.toEqual({
      source: "polymarket_clob_market_info",
      conditionId: "condition-1",
      feesEnabled: true,
      takerFeeRate: 0.05,
      feeCurveExponent: 1,
      takerOnly: true,
      minimumOrderSize: 5,
      minimumTickSize: 0.01,
      fetchedAtTsMs: 2_000
    });
    now = 2_500;
    await resolver.resolve(book());
    expect(requests).toBe(1);
  });

  it("rejects legacy fee metadata without an explicit V2 fee curve", async () => {
    const resolver = new PolymarketClobFeeResolver({
      fetchImpl: async () => new Response(JSON.stringify(marketInfo({ fd: undefined })), { status: 200 })
    });
    await expect(resolver.resolve(book())).rejects.toThrow(/omitted explicit V2 fee-curve/);
  });

  it("rejects market info that does not contain the canonical asset", async () => {
    const resolver = new PolymarketClobFeeResolver({
      fetchImpl: async () => new Response(JSON.stringify(marketInfo({
        t: [{ t: "different-asset", o: "Over" }]
      })), { status: 200 })
    });
    await expect(resolver.resolve(book())).rejects.toThrow(/does not contain canonical book asset/);
  });
});
