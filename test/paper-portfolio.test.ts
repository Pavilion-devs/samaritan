import { describe, expect, it } from "vitest";
import type { PolymarketBookEvent } from "../src/bus/events.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { microUsd } from "../src/domain/money.js";
import { probability } from "../src/domain/probability.js";
import type { PaperFill } from "../src/exec/paper.js";
import { PaperPortfolio } from "../src/portfolio/paper.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";

function signal(): DetectorSignal {
  return {
    signalId: "portfolio-signal",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: 1_000,
    observedAtTsMs: 1_000,
    fixtureId: "fixture-1",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-1:total_goals:full_time:2500"
    },
    outcome: "over",
    direction: "buy",
    eligibility: "research_only",
    reason: "paper candidate",
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
    grossMicroUsd: microUsd(2_930_000),
    feeMicroUsd: microUsd(70_000),
    netConsiderationMicroUsd: microUsd(3_000_000),
    filledShares: 5.5,
    averagePrice: 2.93 / 5.5,
    bestPrice: 0.52,
    halfSpreadBps: 100,
    executableDepthUsd: 10,
    slippageProbabilityBps: 127.2727,
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

function closingBook(): PolymarketBookEvent {
  return {
    schemaVersion: 1,
    kind: "polymarket.book",
    eventId: "closing-book",
    source: "polymarket",
    sourceTsMs: 5_000,
    observedTsMs: 5_000,
    fixtureId: "fixture-1",
    market: signal().market,
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
}

describe("paper portfolio evidence", () => {
  it("separates midpoint CLV, executable liquidation CLV, and settlement P&L", () => {
    const ledger = new DecisionLedger(":memory:");
    const portfolio = new PaperPortfolio({
      lane: "long_run",
      bankrollMicroUsd: microUsd(50_000_000),
      drawdownStopMicroUsd: microUsd(20_000_000),
      ledger
    });
    portfolio.open({ caseId: "case-1", signal: signal(), fill: fill(), openedAtTsMs: 1_500 });
    expect(portfolio.riskState().openExposureMicroUsd).toBe(3_000_000);

    const mark = portfolio.markAtClose({
      caseId: "case-1",
      book: closingBook(),
      cutoffTsMs: 5_000,
      markedAtTsMs: 5_000
    });
    expect(mark.closeMidpoint).toBeCloseTo(0.58);
    expect(mark.grossMidpointClvBps).toBeGreaterThan(mark.netMidpointClvBps);
    expect(mark.netMidpointClvBps).toBeGreaterThan(mark.executableLiquidationClvBps);

    const settlement = portfolio.settle({ caseId: "case-1", won: true, settledAtTsMs: 10_000 });
    expect(settlement.payoutMicroUsd).toBe(5_500_000);
    expect(settlement.pnlMicroUsd).toBe(2_500_000);
    expect(portfolio.riskState().openExposureMicroUsd).toBe(0);
    expect(portfolio.summary()).toMatchObject({
      positions: 1,
      openPositions: 0,
      settledPositions: 1,
      realizedPnlMicroUsd: 2_500_000,
      currentDrawdownMicroUsd: 0
    });
    expect(ledger.entries().map((entry) => entry.kind)).toEqual([
      "position_opened",
      "position_closed",
      "position_settled"
    ]);
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 3 });
    ledger.close();
  });

  it("updates drawdown from settled losses and exposes the risk halt state", () => {
    const ledger = new DecisionLedger(":memory:");
    const portfolio = new PaperPortfolio({
      lane: "bounty",
      bankrollMicroUsd: microUsd(50_000_000),
      drawdownStopMicroUsd: microUsd(3_000_000),
      ledger
    });
    portfolio.open({ caseId: "case-loss", signal: signal(), fill: fill(), openedAtTsMs: 1_500 });
    portfolio.markAtClose({
      caseId: "case-loss",
      book: closingBook(),
      cutoffTsMs: 5_000,
      markedAtTsMs: 5_000
    });
    portfolio.settle({ caseId: "case-loss", won: false, settledAtTsMs: 10_000 });
    expect(portfolio.riskState()).toMatchObject({
      openExposureMicroUsd: 0,
      currentDrawdownMicroUsd: 3_000_000,
      halted: true
    });
    ledger.close();
  });
});
