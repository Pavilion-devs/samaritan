import { describe, expect, it } from "vitest";
import type { DetectorBankConfig } from "../src/detectors/bank.js";
import { assertCausalTotalSelectorConfig } from "../src/research/main-total-selector.js";
import {
  ThresholdResultAggregator,
  assertCausalTotalEvidenceFile,
  clusteredNetClvInterval,
  chronologicalFixtureSplit,
  rankTrainingConfigurations,
  selectEligibleTrainingConfiguration
} from "../src/research/historical-gate-study.js";

const config: DetectorBankConfig = {
  velocityWindowMs: 300_000,
  consensusMoveAbsZ: 1.5,
  consensusCusumThreshold: 0.0025,
  consensusMinimumUpdates: 3,
  consensusMinimumRawGap: 0.005,
  consensusStableAbsZ: 1,
  xmarketMinimumRawGap: 0.005,
  xmarketPersistenceMs: 60_000,
  faderPolymarketAbsZ: 1.5,
  faderMinimumRawGap: 0.005,
  faderPersistenceMs: 60_000
};

function normalization(rawEmissions: number, normalizedCases: number) {
  return {
    rawEmissions,
    normalizedCases,
    executableTotalGoalsCases: normalizedCases,
    nonBinaryMarketSignalsPassedThrough: 0,
    duplicateExecutableBuysCollapsed: rawEmissions - normalizedCases,
    complementarySellsCollapsed: 0,
    sellOnlySignalsDropped: 0,
    unsupportedTotalGoalsSignalsDropped: 0
  };
}

describe("historical gate study primitives", () => {
  it("computes a deterministic fixture-clustered interval instead of treating signals as independent", () => {
    const inputs = [
      { fixtureId: "one", netAfterCostProxy: 0.01 },
      { fixtureId: "one", netAfterCostProxy: -0.005 }
    ];
    const first = clusteredNetClvInterval(inputs);
    const second = clusteredNetClvInterval(inputs);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      iterations: 10_000,
      seed: 20_260_714,
      fixtures: 1,
      signals: 2,
      low: 0.0025,
      median: 0.0025,
      high: 0.0025
    });
  });

  it("rejects legacy or non-causal total-line evidence artifacts", () => {
    expect(() => assertCausalTotalEvidenceFile({ schemaVersion: 1, evidence: [] })).toThrow(
      /schemaVersion 2/
    );
    expect(() => assertCausalTotalEvidenceFile({
      schemaVersion: 2,
      selectorEvidence: {
        asOfBeforeKickoffMs: 180 * 60_000,
        kickoffBasis: "txline_kickoff_ts_ms",
        probabilityRule: "source_ts_ms_lte_selector_cutoff",
        coverageRule: "unbounded"
      },
      evidence: []
    })).toThrow(/share the causal cutoff/);
  });

  it("rejects unbounded volume or liquidity as causal selection inputs", () => {
    expect(() => assertCausalTotalSelectorConfig({
      minimumCoveragePoints: 1,
      minimumVolume: 0,
      minimumLiquidity: 0,
      maximumDistanceFromEven: 0.15,
      weights: { balance: 1, volume: 1, liquidity: 0, coverage: 0 }
    })).toThrow(/cannot use volume or liquidity/);
  });

  it("keeps fixtures with identical kickoff timestamps in one chronological partition", () => {
    const split = chronologicalFixtureSplit([
      { fixtureId: "a", kickoffTsMs: 1 },
      { fixtureId: "b", kickoffTsMs: 2 },
      { fixtureId: "c", kickoffTsMs: 2 },
      { fixtureId: "d", kickoffTsMs: 3 }
    ], 0.5);
    expect(split.train.map((fixture) => fixture.fixtureId)).toEqual(["a", "b", "c"]);
    expect(split.test.map((fixture) => fixture.fixtureId)).toEqual(["d"]);
  });

  it("aggregates confusion matrices before ranking configurations", () => {
    const aggregator = new ThresholdResultAggregator("XMARKET_DIVERGENCE");
    aggregator.add([{
      configId: "config-a",
      config,
      snapshots: 10,
      signalCounts: {
        XMARKET_DIVERGENCE: 3,
        CONSENSUS_MOVE: 0,
        FADER_CANDIDATE: 0
      },
      rawSignalCounts: {
        XMARKET_DIVERGENCE: 6,
        CONSENSUS_MOVE: 0,
        FADER_CANDIDATE: 0
      },
      economicCaseNormalization: normalization(6, 3),
      classification: [{
        detector: "XMARKET_DIVERGENCE",
        cases: 4,
        truePositive: 2,
        falsePositive: 1,
        trueNegative: 1,
        falseNegative: 0,
        precision: 2 / 3,
        recall: 1,
        falsePositiveRate: 0.5
      }]
    }]);
    aggregator.add([{
      configId: "config-a",
      config,
      snapshots: 8,
      signalCounts: {
        XMARKET_DIVERGENCE: 2,
        CONSENSUS_MOVE: 0,
        FADER_CANDIDATE: 0
      },
      rawSignalCounts: {
        XMARKET_DIVERGENCE: 4,
        CONSENSUS_MOVE: 0,
        FADER_CANDIDATE: 0
      },
      economicCaseNormalization: normalization(4, 2),
      classification: [{
        detector: "XMARKET_DIVERGENCE",
        cases: 3,
        truePositive: 1,
        falsePositive: 0,
        trueNegative: 1,
        falseNegative: 1,
        precision: 1,
        recall: 0.5,
        falsePositiveRate: 0
      }]
    }]);
    const [result] = rankTrainingConfigurations(
      aggregator.results(),
      4,
      "XMARKET_DIVERGENCE",
      0.005
    );
    expect(result).toMatchObject({
      snapshots: 18,
      rawEmissions: 10,
      signals: 5,
      predictedPositive: 5,
      meetsMinimumSignals: true,
      meetsCostFloor: true,
      classification: {
        cases: 7,
        truePositive: 3,
        falsePositive: 1,
        trueNegative: 2,
        falseNegative: 1,
        precision: 0.75,
        recall: 0.75
      }
    });
    expect(result?.f1).toBe(0.75);
  });

  it("fails closed when training produces no sample- and cost-eligible configuration", () => {
    const candidate = {
      configId: "under-cost-floor",
      config,
      snapshots: 10,
      rawEmissions: 5,
      signals: 5,
      classification: {
        detector: "XMARKET_DIVERGENCE" as const,
        cases: 10,
        truePositive: 3,
        falsePositive: 1,
        trueNegative: 5,
        falseNegative: 1,
        precision: 0.75,
        recall: 0.75,
        falsePositiveRate: 1 / 6
      }
    };
    const ranked = rankTrainingConfigurations(
      [candidate],
      4,
      "XMARKET_DIVERGENCE",
      0.01
    );
    expect(ranked[0]?.meetsMinimumSignals).toBe(true);
    expect(ranked[0]?.meetsCostFloor).toBe(false);
    expect(() => selectEligibleTrainingConfiguration("XMARKET_DIVERGENCE", ranked)).toThrow(
      /no sample- and cost-eligible configuration/
    );
  });

  it("uses normalized cases rather than inflated raw predictions for the training minimum", () => {
    const [ranked] = rankTrainingConfigurations([{
      configId: "complement-inflated",
      config,
      snapshots: 100,
      rawEmissions: 20,
      signals: 3,
      classification: {
        detector: "XMARKET_DIVERGENCE",
        cases: 100,
        truePositive: 8,
        falsePositive: 2,
        trueNegative: 88,
        falseNegative: 2,
        precision: 0.8,
        recall: 0.8,
        falsePositiveRate: 2 / 90
      }
    }], 5, "XMARKET_DIVERGENCE", 0.005);

    expect(ranked).toMatchObject({
      rawEmissions: 20,
      predictedPositive: 3,
      meetsMinimumSignals: false
    });
  });
});
