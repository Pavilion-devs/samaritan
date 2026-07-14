import { describe, expect, it } from "vitest";
import type { PolymarketResolutionEvent } from "../src/bus/events.js";
import { microUsd } from "../src/domain/money.js";
import { PaperSettlementScheduler } from "../src/portfolio/paper-settlement-scheduler.js";
import { PaperPortfolio } from "../src/portfolio/paper.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import type { PaperFill } from "../src/exec/paper.js";
import type { PolymarketBookEvent } from "../src/bus/events.js";
import { probability } from "../src/domain/probability.js";

const market = {
  family: "total_goals" as const,
  period: "full_time" as const,
  lineMilli: 2_500,
  key: "fixture-1:total_goals:full_time:2500"
};

const signal: DetectorSignal = {
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

const fill: PaperFill = {
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

const closeBook: PolymarketBookEvent = {
  schemaVersion: 1,
  kind: "polymarket.book",
  eventId: "close",
  source: "polymarket",
  sourceTsMs: 4_900,
  observedTsMs: 4_920,
  fixtureId: "fixture-1",
  market,
  mappingStatus: "candidate",
  conditionId: "condition-1",
  assetId: "asset-over",
  outcome: "over",
  tokenRole: "canonical",
  bids: [{ price: probability(0.57), size: "100" }],
  asks: [{ price: probability(0.59), size: "100" }],
  lastTradePrice: probability(0.58),
  tickSize: "0.01"
};

function resolution(winningAssetId: string): PolymarketResolutionEvent {
  return {
    schemaVersion: 1,
    kind: "polymarket.resolution",
    eventId: "resolution",
    source: "polymarket",
    sourceTsMs: 10_000,
    observedTsMs: 10_010,
    fixtureId: "fixture-1",
    market,
    mappingStatus: "candidate",
    conditionId: "condition-1",
    assetIds: ["asset-over", "asset-under"],
    winningAssetId,
    winningOutcomeLabel: winningAssetId === "asset-over" ? "Over" : "Under"
  };
}

describe("paper settlement scheduler", () => {
  it("settles a marked position from the public winning asset ID", () => {
    const ledger = new DecisionLedger(":memory:");
    const portfolio = new PaperPortfolio({
      lane: "long_run",
      bankrollMicroUsd: microUsd(50_000_000),
      drawdownStopMicroUsd: microUsd(20_000_000),
      ledger
    });
    portfolio.open({ caseId: "case-1", signal, fill, openedAtTsMs: 1_500 });
    portfolio.markAtClose({ caseId: "case-1", book: closeBook, cutoffTsMs: 5_000, markedAtTsMs: 5_000 });
    const scheduler = new PaperSettlementScheduler(portfolio);
    const [result] = scheduler.ingest(resolution("asset-under"));
    expect(result).toMatchObject({ caseId: "case-1", won: false });
    expect(portfolio.positions()[0]?.status).toBe("settled");
    expect(portfolio.summary().realizedPnlMicroUsd).toBe(-3_000_000);
    expect(ledger.entries().map((entry) => entry.kind)).toEqual([
      "position_opened",
      "position_closed",
      "position_settled"
    ]);
    ledger.close();
  });

  it("does not settle before the registered kickoff close exists", () => {
    const ledger = new DecisionLedger(":memory:");
    const portfolio = new PaperPortfolio({
      lane: "long_run",
      bankrollMicroUsd: microUsd(50_000_000),
      drawdownStopMicroUsd: microUsd(20_000_000),
      ledger
    });
    portfolio.open({ caseId: "case-1", signal, fill, openedAtTsMs: 1_500 });
    expect(new PaperSettlementScheduler(portfolio).ingest(resolution("asset-over"))).toEqual([]);
    expect(portfolio.positions()[0]?.status).toBe("open");
    ledger.close();
  });
});
