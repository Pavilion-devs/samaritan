import { describe, expect, it } from "vitest";
import type { DetectorBankConfig } from "../src/detectors/bank.js";
import { probability } from "../src/domain/probability.js";
import type { FeatureSnapshot, VelocityFeature } from "../src/features/engine.js";
import {
  ForwardOutcomeLabeler,
  type ForwardLabelConfig
} from "../src/metrics/forward-labels.js";
import { StreamingDetectorStudy } from "../src/metrics/replay-study.js";
import { DetectorThresholdGrid } from "../src/metrics/threshold-grid.js";

const labelsConfig: ForwardLabelConfig = {
  horizonMs: 1_000,
  maximumResolutionDelayMs: 100,
  velocityWindowMs: 1_000,
  minimumGapClosure: 0.01,
  minimumPolymarketReversion: 0.02,
  maximumConsensusMoveForFader: 0.005,
  minimumPolymarketFollow: 0.02,
  maximumConsensusReversal: 0.005
};

function velocity(value: number): VelocityFeature {
  return {
    windowMs: 1_000,
    velocity: value,
    accelerationPerSecond: null,
    zScore: 0.1,
    baselineMean: 0,
    baselineStdDev: 0.01
  };
}

function snapshot(tsMs: number, consensus: number, polymarket: number): FeatureSnapshot {
  return {
    triggerEventId: `event-${tsMs}`,
    triggerSource: "polymarket",
    asOfTsMs: tsMs,
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
      probability: probability(consensus),
      sourceTsMs: tsMs,
      updateCount: 10,
      velocities: [velocity(0.02)],
      cusumUp: 0,
      cusumDown: 0,
      devigCrossCheckProbability: consensus,
      devigDiscrepancy: 0
    },
    polymarket: {
      probability: probability(polymarket),
      sourceTsMs: tsMs,
      updateCount: 10,
      velocities: [velocity(0)],
      bestBid: null,
      bestAsk: null,
      observation: "sampled_history"
    },
    spread: {
      consensusMinusPolymarket: consensus - polymarket,
      rawBuyGap: null,
      rawSellGap: null
    },
    freshness: {
      txlineAgeMs: 0,
      polymarketAgeMs: 0,
      bothFresh: true,
      clockOrderHealthy: true
    },
    scoreContext: []
  };
}

const detectorConfig: DetectorBankConfig = {
  velocityWindowMs: 1_000,
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

describe("forward outcome labels", () => {
  it("separates convergence, consensus-follow, and fader outcomes", () => {
    const labeler = new ForwardOutcomeLabeler(labelsConfig);
    const base = labeler.ingest(snapshot(1_000, 0.55, 0.5));
    expect(base.queuedCaseId).not.toBeNull();
    const future = labeler.ingest(snapshot(2_000, 0.56, 0.54));
    expect(future.resolved[0]?.labels).toEqual({
      XMARKET_DIVERGENCE: true,
      FADER_CANDIDATE: false,
      CONSENSUS_MOVE: true
    });
  });

  it("streams detector predictions and applies labels only after the horizon", () => {
    const study = new StreamingDetectorStudy(
      new DetectorThresholdGrid([detectorConfig]),
      new ForwardOutcomeLabeler(labelsConfig)
    );
    study.ingest(snapshot(1_000, 0.55, 0.5));
    study.ingest(snapshot(2_000, 0.55, 0.54));
    const [result] = study.finish();
    const xmarket = result?.classification.find(
      (summary) => summary.detector === "XMARKET_DIVERGENCE"
    );
    expect(xmarket).toMatchObject({ cases: 1, truePositive: 1, falseNegative: 0 });
  });
});
