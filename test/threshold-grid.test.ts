import { describe, expect, it } from "vitest";
import type { DetectorBankConfig } from "../src/detectors/bank.js";
import { probability } from "../src/domain/probability.js";
import type { FeatureSnapshot, VelocityFeature } from "../src/features/engine.js";
import {
  DetectorThresholdGrid,
  expandDetectorThresholdGrid
} from "../src/metrics/threshold-grid.js";

const base: DetectorBankConfig = {
  velocityWindowMs: 60_000,
  consensusMoveAbsZ: 2,
  consensusCusumThreshold: 0.02,
  consensusMinimumUpdates: 4,
  consensusMinimumRawGap: 0.02,
  consensusStableAbsZ: 0.5,
  xmarketMinimumRawGap: 0.03,
  xmarketPersistenceMs: 0,
  faderPolymarketAbsZ: 2,
  faderMinimumRawGap: 0.03,
  faderPersistenceMs: 0
};

function velocity(): VelocityFeature {
  return {
    windowMs: 60_000,
    velocity: 0,
    accelerationPerSecond: 0,
    zScore: 0.1,
    baselineMean: 0,
    baselineStdDev: 0.01
  };
}

function snapshot(): FeatureSnapshot {
  return {
    triggerEventId: "trigger",
    triggerSource: "polymarket",
    asOfTsMs: 10_000,
    observedAtTsMs: 10_000,
    fixtureId: "fixture-1",
    market: {
      family: "match_result",
      period: "full_time",
      lineMilli: null,
      key: "fixture-1:match_result:full_time:none"
    },
    outcome: "home",
    mappingStatus: "candidate",
    consensus: {
      probability: probability(0.55),
      sourceTsMs: 10_000,
      updateCount: 10,
      velocities: [velocity()],
      cusumUp: 0,
      cusumDown: 0,
      devigCrossCheckProbability: 0.55,
      devigDiscrepancy: 0
    },
    polymarket: {
      probability: probability(0.5),
      sourceTsMs: 10_000,
      updateCount: 10,
      velocities: [velocity()],
      bestBid: null,
      bestAsk: null,
      observation: "sampled_history"
    },
    spread: { consensusMinusPolymarket: 0.05, rawBuyGap: null, rawSellGap: null },
    freshness: {
      txlineAgeMs: 0,
      polymarketAgeMs: 0,
      bothFresh: true,
      clockOrderHealthy: true
    },
    scoreContext: []
  };
}

describe("detector threshold grid", () => {
  it("expands injected dimensions and scores every labeled opportunity", () => {
    const configs = expandDetectorThresholdGrid(base, {
      xmarketMinimumRawGap: [0.03, 0.06]
    });
    const grid = new DetectorThresholdGrid(configs);
    grid.ingest(snapshot(), { XMARKET_DIVERGENCE: true });

    const results = grid.results().sort(
      (left, right) => left.config.xmarketMinimumRawGap - right.config.xmarketMinimumRawGap
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.signalCounts.XMARKET_DIVERGENCE).toBe(1);
    expect(results[0]?.classification[0]).toMatchObject({ truePositive: 1, falseNegative: 0 });
    expect(results[1]?.signalCounts.XMARKET_DIVERGENCE).toBe(0);
    expect(results[1]?.classification[0]).toMatchObject({ truePositive: 0, falseNegative: 1 });
    expect(results.every((result) => result.snapshots === 1)).toBe(true);
  });

  it("deduplicates repeated dimension values", () => {
    expect(
      expandDetectorThresholdGrid(base, { xmarketPersistenceMs: [0, 0, 1_000] })
    ).toHaveLength(2);
  });

  it("scores future labels without retaining them in detector order", () => {
    const grid = new DetectorThresholdGrid([base]);
    const caseId = grid.ingestDeferred(snapshot());
    expect(grid.pendingCaseCount).toBe(1);
    grid.label(caseId, { XMARKET_DIVERGENCE: true });
    expect(grid.pendingCaseCount).toBe(0);
    expect(grid.results()[0]?.classification[0]?.truePositive).toBe(1);
  });

  it("uses normalized total-goals cases for grid signal counts while retaining raw audit counts", () => {
    const grid = new DetectorThresholdGrid([base]);
    const totalMarket = {
      family: "total_goals" as const,
      period: "full_time" as const,
      lineMilli: 2_500,
      key: "fixture-1:total_goals:full_time:2500"
    };
    const over = { ...snapshot(), triggerEventId: "over", market: totalMarket, outcome: "over" as const };
    const under = {
      ...snapshot(),
      triggerEventId: "under",
      market: totalMarket,
      outcome: "under" as const,
      consensus: { ...snapshot().consensus, probability: probability(0.45) },
      spread: { consensusMinusPolymarket: -0.05, rawBuyGap: null, rawSellGap: null }
    };

    grid.ingest(over, { XMARKET_DIVERGENCE: true });
    grid.ingest(under, { XMARKET_DIVERGENCE: true });
    const result = grid.results()[0]!;

    expect(result.rawSignalCounts.XMARKET_DIVERGENCE).toBe(2);
    expect(result.signalCounts.XMARKET_DIVERGENCE).toBe(1);
    expect(result.economicCaseNormalization).toMatchObject({
      rawEmissions: 2,
      normalizedCases: 1,
      complementarySellsCollapsed: 1
    });
  });
});
