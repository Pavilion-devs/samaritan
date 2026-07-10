import { describe, expect, it } from "vitest";
import {
  CANONICAL_SCHEMA_VERSION,
  type OddsQuoteEvent,
  type PolymarketBookEvent,
  type PolymarketPriceEvent,
  type ScoreEvent
} from "../src/bus/events.js";
import { probability } from "../src/domain/probability.js";
import { FeatureEngine, type FeatureEngineConfig } from "../src/features/engine.js";

const config: FeatureEngineConfig = {
  velocityWindowsMs: [1_000],
  velocityEwmaHalfLifeMs: 5_000,
  cusumDriftProbability: 0.001,
  scoreContextWindowMs: 5_000,
  freshnessMaxAgeMs: 2_000
};

const market = {
  family: "match_result" as const,
  period: "full_time" as const,
  lineMilli: null,
  key: "fixture-1:match_result:full_time:none"
};

function quote(tsMs: number, home: number): OddsQuoteEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "odds.quote",
    eventId: `quote-${tsMs}-${home}`,
    source: "txline",
    sourceTsMs: tsMs,
    observedTsMs: tsMs + 10,
    fixtureId: "fixture-1",
    sourceMessageId: `message-${tsMs}-${home}`,
    bookmaker: "TXLineStablePriceDemargined",
    bookmakerId: 10021,
    inRunning: false,
    gameState: null,
    market,
    outcomes: [
      { outcome: "home", oddsX1000: Math.round(1_000 / home), fairProbability: probability(home) },
      { outcome: "draw", oddsX1000: 3333, fairProbability: probability(0.3) },
      { outcome: "away", oddsX1000: 5000, fairProbability: probability(0.2) }
    ]
  };
}

function book(tsMs: number): PolymarketBookEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.book",
    eventId: `book-${tsMs}`,
    source: "polymarket",
    sourceTsMs: tsMs,
    observedTsMs: tsMs + 15,
    fixtureId: "fixture-1",
    market,
    mappingStatus: "candidate",
    conditionId: "condition-home",
    assetId: "home-yes",
    outcome: "home",
    tokenRole: "canonical",
    bids: [
      { price: probability(0.44), size: "10" },
      { price: probability(0.45), size: "5" }
    ],
    asks: [
      { price: probability(0.48), size: "10" },
      { price: probability(0.47), size: "5" }
    ],
    lastTradePrice: probability(0.46),
    tickSize: "0.01"
  };
}

function score(tsMs: number): ScoreEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "score.update",
    eventId: `score-${tsMs}`,
    source: "txline",
    sourceTsMs: tsMs,
    observedTsMs: tsMs + 5,
    fixtureId: "fixture-1",
    action: "goal",
    actionId: 10,
    sequence: 20,
    gameState: "inplay",
    confirmed: true,
    participant: 1,
    clock: { running: true, seconds: 300 },
    score: null,
    data: null
  };
}

describe("feature engine", () => {
  it("computes canonical book mid, raw gaps, freshness, and de-vig cross-check", () => {
    const engine = new FeatureEngine(config);
    engine.ingest(quote(10_000, 0.5));
    const [snapshot] = engine.ingest(book(10_500));
    expect(snapshot?.polymarket.probability).toBeCloseTo(0.46);
    expect(snapshot?.spread.consensusMinusPolymarket).toBeCloseTo(0.04);
    expect(snapshot?.spread.rawBuyGap).toBeCloseTo(0.03);
    expect(snapshot?.spread.rawSellGap).toBeCloseTo(-0.05);
    expect(snapshot?.freshness.bothFresh).toBe(true);
    expect(snapshot?.mappingStatus).toBe("candidate");
    expect(snapshot?.consensus.devigCrossCheckProbability).toBeCloseTo(0.5, 3);
    expect(snapshot?.consensus.devigDiscrepancy).toBeLessThan(0.001);
  });

  it("tracks rolling velocity, two-sided CUSUM, and score context", () => {
    const engine = new FeatureEngine(config);
    engine.ingest(quote(10_000, 0.5));
    engine.ingest(book(10_500));
    engine.ingest(score(10_750));
    const snapshots = engine.ingest(quote(11_000, 0.51));
    const home = snapshots.find((snapshot) => snapshot.outcome === "home");
    expect(home?.consensus.velocities[0]?.velocity).toBeCloseTo(0.01);
    expect(home?.consensus.cusumUp).toBeCloseTo(0.009);
    expect(home?.consensus.cusumDown).toBe(0);
    expect(home?.scoreContext).toEqual([
      { action: "goal", confirmed: true, participant: 1, sourceTsMs: 10_750 }
    ]);
  });

  it("does not turn complement tokens into additional canonical outcomes", () => {
    const engine = new FeatureEngine(config);
    const complement: PolymarketPriceEvent = {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      kind: "polymarket.price",
      eventId: "complement",
      source: "polymarket",
      sourceTsMs: 10_000,
      observedTsMs: 10_010,
      fixtureId: "fixture-1",
      market,
      mappingStatus: "candidate",
      conditionId: "condition-home",
      assetId: "home-no",
      outcome: "home",
      tokenRole: "complement",
      observation: "sampled_history",
      price: probability(0.5),
      bestBid: null,
      bestAsk: null,
      size: null,
      side: null
    };
    expect(engine.ingest(complement)).toEqual([]);
  });
});
