import { describe, expect, it } from "vitest";
import type { DetectorSignal } from "../src/detectors/types.js";
import { microUsd } from "../src/domain/money.js";
import type { PaperFill } from "../src/exec/paper.js";
import { PaperCasePipeline } from "../src/harness/paper-pipeline.js";
import {
  buildPaperStudyObservations,
  evaluatePaperStudyLedger
} from "../src/metrics/paper-study-observations.js";
import { PaperPortfolio } from "../src/portfolio/paper.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";

const signal: DetectorSignal = {
  signalId: "signal-1",
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

describe("paper-study observation builder", () => {
  it("derives filled and unfilled study cases from the immutable ledger", () => {
    const ledger = new DecisionLedger(":memory:");
    const pipeline = new PaperCasePipeline({
      triageAgent: { triage: async () => ({ decision: "drop", priority: "normal", rationale: "unused" }) },
      analystAgent: { investigate: async () => { throw new Error("unused"); } },
      riskConfig: {} as never,
      executor: { execute: async () => { throw new Error("unused"); } },
      ledger
    });
    const filledCaseId = pipeline.recordSignal("long_run", signal);
    pipeline.recordSignal("long_run", { ...signal, signalId: "signal-2" });
    const portfolio = new PaperPortfolio({
      lane: "long_run",
      bankrollMicroUsd: microUsd(50_000_000),
      drawdownStopMicroUsd: microUsd(20_000_000),
      ledger
    });
    portfolio.open({ caseId: filledCaseId, signal, fill, openedAtTsMs: 1_500 });

    const result = buildPaperStudyObservations({
      lane: "long_run",
      ledger,
      kickoffByFixtureId: new Map([["fixture-1", 5_000]])
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      caseId: filledCaseId,
      selectedLineMilli: 2_500,
      fill: { halfSpreadBps: 100, slippageBps: 36.36, selectedDepthUsd: 54 }
    });
    expect(result[1]?.fill).toBeNull();
    expect(evaluatePaperStudyLedger({
      lane: "long_run",
      ledger,
      kickoffByFixtureId: new Map([["fixture-1", 5_000]])
    })).toMatchObject({ status: "sealed", counts: { signals: 2, fills: 1 } });
    ledger.close();
  });
});
