import { describe, expect, it } from "vitest";
import type { PolymarketBookEvent } from "../src/bus/events.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { microUsd } from "../src/domain/money.js";
import { probability } from "../src/domain/probability.js";
import type { PaperFill } from "../src/exec/paper.js";
import { PaperCloseScheduler } from "../src/portfolio/paper-close-scheduler.js";
import { PaperPortfolio } from "../src/portfolio/paper.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";

const market = {
  family: "total_goals" as const,
  period: "full_time" as const,
  lineMilli: 2_500,
  key: "fixture-1:total_goals:full_time:2500"
};

function signal(): DetectorSignal {
  return {
    signalId: "signal-1",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: 1_000,
    observedAtTsMs: 1_000,
    fixtureId: "fixture-1",
    market,
    outcome: "over",
    direction: "buy",
    eligibility: "research_only",
    reason: "test",
    evidence: {
      consensusProbability: 0.55,
      polymarketProbability: 0.52,
      consensusVelocity: 0.01,
      consensusZScore: 1.5,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0.002,
      cusumDown: 0,
      rawGap: 0.03,
      gapBasis: "live_book",
      persistenceMs: 0,
      mappingStatus: "candidate",
      scoreContextActions: []
    }
  };
}

function fill(): PaperFill {
  return {
    adapter: "paper",
    status: "filled",
    reason: null,
    assetId: "asset-over",
    conditionId: "condition-1",
    direction: "buy",
    requestedStakeMicroUsd: microUsd(3_000_000),
    grossMicroUsd: microUsd(2_990_000),
    feeMicroUsd: microUsd(10_000),
    netConsiderationMicroUsd: microUsd(3_000_000),
    filledShares: 5.5,
    averagePrice: 2.99 / 5.5,
    bestPrice: 0.54,
    halfSpreadBps: 100,
    executableDepthUsd: 54,
    slippageProbabilityBps: 36.36,
    bookObservedTsMs: 1_500,
    feeParameters: {
      source: "polymarket_clob_market_info",
      conditionId: "condition-1",
      feesEnabled: true,
      takerFeeRate: 0.05,
      feeCurveExponent: 1,
      takerOnly: true,
      minimumOrderSize: 5,
      minimumTickSize: 0.01,
      fetchedAtTsMs: 1_400
    }
  };
}

function book(sourceTsMs: number, observedTsMs: number, bid: number, ask: number): PolymarketBookEvent {
  return {
    schemaVersion: 1,
    kind: "polymarket.book",
    eventId: `book-${sourceTsMs}-${observedTsMs}`,
    source: "polymarket",
    sourceTsMs,
    observedTsMs,
    fixtureId: "fixture-1",
    market,
    mappingStatus: "candidate",
    conditionId: "condition-1",
    assetId: "asset-over",
    outcome: "over",
    tokenRole: "canonical",
    bids: [{ price: probability(bid), size: "100" }],
    asks: [{ price: probability(ask), size: "100" }],
    lastTradePrice: probability((bid + ask) / 2),
    tickSize: "0.01"
  };
}

function setup() {
  const ledger = new DecisionLedger(":memory:");
  const portfolio = new PaperPortfolio({
    lane: "long_run",
    bankrollMicroUsd: microUsd(50_000_000),
    drawdownStopMicroUsd: microUsd(20_000_000),
    ledger
  });
  portfolio.open({ caseId: "case-1", signal: signal(), fill: fill(), openedAtTsMs: 1_500 });
  const scheduler = new PaperCloseScheduler({
    portfolio,
    kickoffByFixtureId: new Map([["fixture-1", 5_000]])
  });
  return { ledger, portfolio, scheduler };
}

describe("paper close scheduler", () => {
  it("marks from the latest canonical source book at or before kickoff", () => {
    const { ledger, portfolio, scheduler } = setup();
    expect(scheduler.ingest(book(4_000, 4_010, 0.55, 0.57))).toEqual([]);
    expect(scheduler.ingest(book(4_900, 4_920, 0.57, 0.59))).toEqual([]);
    const [result] = scheduler.ingest(book(5_100, 5_120, 0.6, 0.62));
    expect(result?.mark).toMatchObject({
      cutoffTsMs: 5_000,
      markedAtTsMs: 5_120,
      bookSourceTsMs: 4_900,
      bookObservedTsMs: 4_920,
      closeMidpoint: 0.58
    });
    expect(portfolio.positions()[0]?.status).toBe("marked");
    ledger.close();
  });

  it("does not let a regressing capture-order book replace newer close evidence", () => {
    const { ledger, scheduler } = setup();
    scheduler.ingest(book(4_900, 4_910, 0.57, 0.59));
    scheduler.ingest(book(4_800, 4_950, 0.1, 0.2));
    const [result] = scheduler.ingest(book(5_100, 5_110, 0.6, 0.62));
    expect(result?.mark.bookSourceTsMs).toBe(4_900);
    expect(result?.mark.closeMidpoint).toBeCloseTo(0.58);
    ledger.close();
  });

  it("fails closed when no pre-kickoff book was captured", () => {
    const { ledger, portfolio, scheduler } = setup();
    expect(scheduler.ingest(book(5_100, 5_110, 0.6, 0.62))).toEqual([]);
    expect(portfolio.positions()[0]?.status).toBe("open");
    ledger.close();
  });
});
