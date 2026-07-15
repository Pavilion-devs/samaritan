import { describe, expect, it } from "vitest";
import {
  CANONICAL_SCHEMA_VERSION,
  marketKey,
  type CanonicalEvent,
  type OddsQuoteEvent,
  type PolymarketBookEvent,
  type PolymarketResolutionEvent,
  type ScoreEvent
} from "../src/bus/events.js";
import { probability } from "../src/domain/probability.js";
import {
  CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT,
  admittedCapturedPaperSource,
  capturedPaperIngressCapacity,
  isAdmittedCapturedPaperEvent,
  profileCapturedPaperIngress
} from "../src/harness/captured-paper-admission.js";

const identity = {
  fixtureId: "fixture-1",
  marketId: "market-1",
  conditionId: "condition-1",
  lineMilli: 2_500,
  assetIds: ["asset-over", "asset-under"]
};

function score(fixtureId: string, observedTsMs: number): ScoreEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "score.update",
    eventId: `score-${fixtureId}-${observedTsMs}`,
    source: "txline",
    sourceTsMs: observedTsMs,
    observedTsMs,
    fixtureId,
    action: "clock_updated",
    actionId: 1,
    sequence: observedTsMs,
    gameState: null,
    confirmed: null,
    participant: null,
    clock: null,
    score: null,
    data: null
  };
}

function odds(lineMilli: number, observedTsMs: number): OddsQuoteEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "odds.quote",
    eventId: `odds-${lineMilli}-${observedTsMs}`,
    source: "txline",
    sourceTsMs: observedTsMs,
    observedTsMs,
    fixtureId: identity.fixtureId,
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli,
      key: marketKey(identity.fixtureId, "total_goals", "full_time", lineMilli)
    },
    sourceMessageId: `message-${lineMilli}-${observedTsMs}`,
    bookmaker: "Test",
    bookmakerId: 1,
    inRunning: false,
    gameState: null,
    outcomes: [{ outcome: "over", oddsX1000: 2_000, fairProbability: probability(0.5) }, {
      outcome: "under",
      oddsX1000: 2_000,
      fairProbability: probability(0.5)
    }]
  };
}

function book(input: {
  assetId: string;
  conditionId?: string;
  lineMilli?: number;
  observedTsMs: number;
}): PolymarketBookEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.book",
    eventId: `book-${input.assetId}-${input.observedTsMs}`,
    source: "polymarket",
    sourceTsMs: input.observedTsMs,
    observedTsMs: input.observedTsMs,
    fixtureId: identity.fixtureId,
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: input.lineMilli ?? identity.lineMilli,
      key: marketKey(
        identity.fixtureId,
        "total_goals",
        "full_time",
        input.lineMilli ?? identity.lineMilli
      )
    },
    mappingStatus: "verified",
    conditionId: input.conditionId ?? identity.conditionId,
    assetId: input.assetId,
    outcome: input.assetId === "asset-over" ? "over" : "under",
    tokenRole: "canonical",
    bids: [{ price: probability(0.49), size: "10" }],
    asks: [{ price: probability(0.51), size: "10" }],
    lastTradePrice: probability(0.5),
    tickSize: "0.01"
  };
}

function resolution(assetIds = identity.assetIds): PolymarketResolutionEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.resolution",
    eventId: `resolution-${assetIds.join("-")}`,
    source: "polymarket",
    sourceTsMs: 500_000,
    observedTsMs: 500_000,
    fixtureId: identity.fixtureId,
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: identity.lineMilli,
      key: marketKey(identity.fixtureId, "total_goals", "full_time", identity.lineMilli)
    },
    mappingStatus: "verified",
    conditionId: identity.conditionId,
    assetIds: [...assetIds],
    winningAssetId: assetIds[0]!,
    winningOutcomeLabel: "Over"
  };
}

async function* events(values: CanonicalEvent[]): AsyncGenerator<CanonicalEvent> {
  for (const value of values) yield value;
}

describe("captured paper selected-market admission", () => {
  it("keeps fixture scores, feed health, and exact selected-market events only", async () => {
    const feed: CanonicalEvent = {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      kind: "feed.heartbeat",
      eventId: "feed-1",
      source: "txline",
      sourceTsMs: 0,
      observedTsMs: 0,
      fixtureId: null,
      status: "healthy",
      stream: "scores",
      detail: null
    };
    const selectedBook = book({ assetId: "asset-over", observedTsMs: 2 });
    const kept: CanonicalEvent[] = [];
    for await (const event of admittedCapturedPaperSource(events([
      feed,
      score(identity.fixtureId, 1),
      score("other-fixture", 1),
      odds(identity.lineMilli, 2),
      odds(3_500, 2),
      selectedBook,
      book({ assetId: "other-asset", observedTsMs: 3 }),
      book({ assetId: "asset-under", conditionId: "other-condition", observedTsMs: 4 }),
      resolution(),
      resolution(["asset-over", "other-asset"])
    ]), identity)) kept.push(event);
    expect(kept.map((event) => event.eventId)).toEqual([
      "feed-1",
      `score-${identity.fixtureId}-1`,
      `odds-${identity.lineMilli}-2`,
      selectedBook.eventId,
      resolution().eventId
    ]);
    expect(isAdmittedCapturedPaperEvent(selectedBook, identity)).toBe(true);
  });

  it("profiles the worst 240-second window and sizes for the entire finite admitted replay", async () => {
    const profile = await profileCapturedPaperIngress(events([
      score(identity.fixtureId, 0),
      book({ assetId: "asset-over", observedTsMs: 100_000 }),
      book({ assetId: "asset-under", observedTsMs: 240_000 }),
      score(identity.fixtureId, 240_001),
      score("other-fixture", 120_000)
    ]), identity);
    expect(profile).toMatchObject({
      eventCount: 4,
      maximumEventsInModelStallWindow: 3,
      counts: { fixtureScores: 2, selectedBooks: 2 }
    });
    expect(capturedPaperIngressCapacity(profile)).toBe(5);
  });

  it("fails preflight sizing above the explicit in-process hard limit", () => {
    expect(() => capturedPaperIngressCapacity({
      eventCount: CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT,
      firstObservedTsMs: 0,
      lastObservedTsMs: 1,
      modelStallBudgetMs: 240_000,
      maximumEventsInModelStallWindow: 60_000,
      counts: {
        selectedOdds: 60_000,
        fixtureScores: CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT - 60_000,
        selectedBooks: 0,
        selectedPrices: 0,
        selectedResolutions: 0,
        feedEvents: 0
      }
    })).toThrow(/above hard limit/);
  });
});
