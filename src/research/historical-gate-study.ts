import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { DetectorBankConfig } from "../detectors/bank.js";
import { DetectorBank } from "../detectors/bank.js";
import { normalizeExecutableEconomicCases } from "../detectors/economic-cases.js";
import type { DetectorSignal, SignalKind } from "../detectors/types.js";
import type { CanonicalOutcome } from "../bus/events.js";
import { stableJson } from "../domain/json.js";
import {
  PAPER_STUDY_FEATURE_CONFIG,
  PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS,
  PAPER_STUDY_TOTAL_SELECTOR_CONFIG
} from "../config/paper-study.js";
import type { FeatureEngineConfig, FeatureSnapshot } from "../features/engine.js";
import type { ClassificationSummary } from "../metrics/classification.js";
import { ForwardOutcomeLabeler, type ForwardLabelConfig } from "../metrics/forward-labels.js";
import { StreamingDetectorStudy } from "../metrics/replay-study.js";
import {
  DetectorThresholdGrid,
  expandDetectorThresholdGrid,
  type ThresholdGridResult
} from "../metrics/threshold-grid.js";
import type { MappingRecord } from "../mapping/registry.js";
import { extractResearchFeatures, type ResearchFeatureExtractionSummary } from "./extract-features.js";
import {
  assertCausalTotalSelectorConfig,
  selectMainTotalLine,
  type TotalLineEvidence,
  type TotalLineSelection,
  type TotalLineSelectorConfig
} from "./main-total-selector.js";

const DETECTORS: SignalKind[] = ["XMARKET_DIVERGENCE", "CONSENSUS_MOVE", "FADER_CANDIDATE"];
export const HISTORICAL_GATE_PROTOCOL_ID = "historical-gate-causal-economic-v4-2026-07-14" as const;
const HISTORICAL_GATE_BOOTSTRAP_ITERATIONS = 10_000;
const HISTORICAL_GATE_BOOTSTRAP_SEED = 20_260_714;

type MappingFile = { records?: MappingRecord[] };
type TotalEvidenceFile = {
  schemaVersion?: unknown;
  selectorEvidence?: {
    asOfBeforeKickoffMs?: unknown;
    kickoffBasis?: unknown;
    probabilityRule?: unknown;
    coverageRule?: unknown;
  };
  evidence?: TotalLineEvidence[];
};

export function assertCausalTotalEvidenceFile(value: TotalEvidenceFile): void {
  if (value.schemaVersion !== 2) {
    throw new Error("Historical gate requires causal total-line evidence schemaVersion 2");
  }
  if (
    value.selectorEvidence?.asOfBeforeKickoffMs !==
    PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS
  ) {
    throw new Error("Historical gate total-line evidence has the wrong selector as-of boundary");
  }
  if (value.selectorEvidence.kickoffBasis !== "txline_kickoff_ts_ms") {
    throw new Error("Historical gate total-line evidence must use the TXLine kickoff boundary");
  }
  if (
    value.selectorEvidence.probabilityRule !== "source_ts_ms_lte_selector_cutoff" ||
    value.selectorEvidence.coverageRule !== "source_ts_ms_lte_selector_cutoff"
  ) {
    throw new Error("Historical gate total-line probability and coverage must share the causal cutoff");
  }
  if (!Array.isArray(value.evidence)) {
    throw new Error("Historical gate total-line evidence is missing its evidence rows");
  }
}

export type HistoricalFixture = {
  fixtureId: string;
  kickoffTsMs: number;
  home: string;
  away: string;
  matchResultMarketKey: string;
  selectedTotalMarketKey: string;
  selectedTotalLineMilli: number;
};

export type ChronologicalSplit<T> = {
  train: T[];
  test: T[];
  cutoffTsMs: number;
};

export function chronologicalFixtureSplit<T extends { kickoffTsMs: number; fixtureId: string }>(
  fixtures: readonly T[],
  trainFraction: number
): ChronologicalSplit<T> {
  if (!(trainFraction > 0 && trainFraction < 1)) throw new RangeError("Train fraction must be between zero and one");
  if (fixtures.length < 2) throw new Error("Chronological split requires at least two fixtures");
  const sorted = [...fixtures].sort(
    (left, right) => left.kickoffTsMs - right.kickoffTsMs || left.fixtureId.localeCompare(right.fixtureId)
  );
  const targetIndex = Math.max(0, Math.min(sorted.length - 2, Math.floor(sorted.length * trainFraction) - 1));
  const cutoffTsMs = sorted[targetIndex]!.kickoffTsMs;
  const train = sorted.filter((fixture) => fixture.kickoffTsMs <= cutoffTsMs);
  const test = sorted.filter((fixture) => fixture.kickoffTsMs > cutoffTsMs);
  if (train.length === 0 || test.length === 0) throw new Error("Chronological split produced an empty partition");
  return { train, test, cutoffTsMs };
}

type ConfusionCounts = {
  cases: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
};

export type AggregatedThresholdResult = {
  configId: string;
  config: DetectorBankConfig;
  snapshots: number;
  rawEmissions: number;
  /** Normalized economic cases; this is the only count used by sample gates. */
  signals: number;
  classification: ClassificationSummary;
};

type AggregateEntry = {
  configId: string;
  config: DetectorBankConfig;
  snapshots: number;
  rawEmissions: number;
  signals: number;
  confusion: ConfusionCounts;
};

function emptyConfusion(): ConfusionCounts {
  return { cases: 0, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
}

function classification(detector: SignalKind, counts: ConfusionCounts): ClassificationSummary {
  const predictedPositive = counts.truePositive + counts.falsePositive;
  const actualPositive = counts.truePositive + counts.falseNegative;
  const actualNegative = counts.trueNegative + counts.falsePositive;
  return {
    detector,
    ...counts,
    precision: predictedPositive === 0 ? null : counts.truePositive / predictedPositive,
    recall: actualPositive === 0 ? null : counts.truePositive / actualPositive,
    falsePositiveRate: actualNegative === 0 ? null : counts.falsePositive / actualNegative
  };
}

export class ThresholdResultAggregator {
  readonly #entries = new Map<string, AggregateEntry>();

  constructor(readonly detector: SignalKind) {}

  add(results: readonly ThresholdGridResult[]): void {
    for (const result of results) {
      const summary = result.classification.find((item) => item.detector === this.detector);
      const entry = this.#entries.get(result.configId) ?? {
        configId: result.configId,
        config: { ...result.config },
        snapshots: 0,
        rawEmissions: 0,
        signals: 0,
        confusion: emptyConfusion()
      };
      entry.snapshots += result.snapshots;
      entry.rawEmissions += result.rawSignalCounts[this.detector];
      entry.signals += result.signalCounts[this.detector];
      if (summary) {
        entry.confusion.cases += summary.cases;
        entry.confusion.truePositive += summary.truePositive;
        entry.confusion.falsePositive += summary.falsePositive;
        entry.confusion.trueNegative += summary.trueNegative;
        entry.confusion.falseNegative += summary.falseNegative;
      }
      this.#entries.set(result.configId, entry);
    }
  }

  results(): AggregatedThresholdResult[] {
    return [...this.#entries.values()].map((entry) => ({
      configId: entry.configId,
      config: { ...entry.config },
      snapshots: entry.snapshots,
      rawEmissions: entry.rawEmissions,
      signals: entry.signals,
      classification: classification(this.detector, entry.confusion)
    }));
  }
}

export type RankedTrainingConfiguration = AggregatedThresholdResult & {
  /** Backward-compatible alias for normalizedEconomicCases. */
  predictedPositive: number;
  normalizedEconomicCases: number;
  f1: number | null;
  meetsMinimumSignals: boolean;
  meetsCostFloor: boolean;
};

function f1(summary: ClassificationSummary): number | null {
  if (summary.precision === null || summary.recall === null || summary.precision + summary.recall === 0) return null;
  return (2 * summary.precision * summary.recall) / (summary.precision + summary.recall);
}

export function rankTrainingConfigurations(
  results: readonly AggregatedThresholdResult[],
  minimumSignals: number,
  detector: SignalKind,
  costFloorProbability: number
): RankedTrainingConfiguration[] {
  if (!Number.isInteger(minimumSignals) || minimumSignals < 1) throw new RangeError("Minimum signals must be positive");
  if (!Number.isFinite(costFloorProbability) || costFloorProbability < 0) {
    throw new RangeError("Cost floor must be finite and non-negative");
  }
  return results
    .map((result) => {
      const predictedPositive = result.signals;
      const configuredGap = detector === "XMARKET_DIVERGENCE"
        ? result.config.xmarketMinimumRawGap
        : detector === "CONSENSUS_MOVE"
          ? result.config.consensusMinimumRawGap
          : result.config.faderMinimumRawGap;
      return {
        ...result,
        predictedPositive,
        normalizedEconomicCases: predictedPositive,
        f1: f1(result.classification),
        meetsMinimumSignals: predictedPositive >= minimumSignals,
        meetsCostFloor: configuredGap >= costFloorProbability
      };
    })
    .sort((left, right) =>
      Number(right.meetsCostFloor) - Number(left.meetsCostFloor) ||
      Number(right.meetsMinimumSignals) - Number(left.meetsMinimumSignals) ||
      (right.f1 ?? -1) - (left.f1 ?? -1) ||
      (right.classification.precision ?? -1) - (left.classification.precision ?? -1) ||
      right.predictedPositive - left.predictedPositive ||
      left.configId.localeCompare(right.configId)
    );
}

export function selectEligibleTrainingConfiguration(
  detector: SignalKind,
  ranked: readonly RankedTrainingConfiguration[]
): RankedTrainingConfiguration {
  const selected = ranked.find((candidate) => candidate.meetsMinimumSignals && candidate.meetsCostFloor);
  if (!selected) {
    throw new Error(`Training sweep produced no sample- and cost-eligible configuration for ${detector}`);
  }
  return selected;
}

type Sweep = {
  detector: SignalKind;
  configs: DetectorBankConfig[];
};

type GroupCoverage = ResearchFeatureExtractionSummary & {
  fixtureId: string;
  marketKey: string;
};

type SignalClv = {
  detector: SignalKind;
  fixtureId: string;
  marketKey: string;
  outcome: CanonicalOutcome;
  direction: "buy" | "sell";
  detectedAtTsMs: number;
  entryProbability: number;
  closingProbability: number;
  directionalClv: number;
  netAfterCostProxy: number;
};

export type ClusteredNetClvInput = Pick<SignalClv, "fixtureId" | "netAfterCostProxy">;

export type ClvSliceSummary = {
  signals: number;
  withClosingProbability: number;
  uniqueFixtures: number;
  meanDirectionalClv: number | null;
  medianDirectionalClv: number | null;
  p25DirectionalClv: number | null;
  p75DirectionalClv: number | null;
  positiveClvRate: number | null;
  meanNetAfterCostProxy: number | null;
  matchClusteredNetClv95: {
    iterations: number;
    seed: number;
    fixtures: number;
    signals: number;
    low: number;
    median: number;
    high: number;
  } | null;
  meanNetByCostProxyBps: Record<string, number | null>;
};

export type ClvSummary = ClvSliceSummary & {
  byMarketFamily: {
    matchResult: ClvSliceSummary;
    totalGoals: ClvSliceSummary;
  };
};

export type DetectorEmissionAudit = {
  rawEmissions: number;
  normalizedEconomicCases: number;
  executableTotalGoalsCases: number;
  nonBinaryMarketSignalsPassedThrough: number;
  duplicateExecutableBuysCollapsed: number;
  complementarySellsCollapsed: number;
  sellOnlySignalsDropped: number;
  unsupportedTotalGoalsSignalsDropped: number;
};

function emptyEmissionAudit(): DetectorEmissionAudit {
  return {
    rawEmissions: 0,
    normalizedEconomicCases: 0,
    executableTotalGoalsCases: 0,
    nonBinaryMarketSignalsPassedThrough: 0,
    duplicateExecutableBuysCollapsed: 0,
    complementarySellsCollapsed: 0,
    sellOnlySignalsDropped: 0,
    unsupportedTotalGoalsSignalsDropped: 0
  };
}

function quantile(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * probability)));
  return sorted[index]!;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

export function clusteredNetClvInterval(
  signals: readonly ClusteredNetClvInput[]
): ClvSliceSummary["matchClusteredNetClv95"] {
  const byFixture = new Map<string, number[]>();
  for (const signal of signals) {
    const values = byFixture.get(signal.fixtureId) ?? [];
    values.push(signal.netAfterCostProxy);
    byFixture.set(signal.fixtureId, values);
  }
  const fixtures = [...byFixture.values()];
  if (fixtures.length === 0) return null;
  const random = mulberry32(HISTORICAL_GATE_BOOTSTRAP_SEED);
  const distribution: number[] = [];
  for (let iteration = 0; iteration < HISTORICAL_GATE_BOOTSTRAP_ITERATIONS; iteration += 1) {
    let sum = 0;
    let count = 0;
    for (let index = 0; index < fixtures.length; index += 1) {
      const sampled = fixtures[Math.floor(random() * fixtures.length)]!;
      for (const value of sampled) {
        sum += value;
        count += 1;
      }
    }
    distribution.push(sum / count);
  }
  distribution.sort((left, right) => left - right);
  return {
    iterations: HISTORICAL_GATE_BOOTSTRAP_ITERATIONS,
    seed: HISTORICAL_GATE_BOOTSTRAP_SEED,
    fixtures: fixtures.length,
    signals: signals.length,
    low: quantile(distribution, 0.025)!,
    median: quantile(distribution, 0.5)!,
    high: quantile(distribution, 0.975)!
  };
}

function summarizeClvSlice(
  signals: readonly SignalClv[],
  emittedSignals: number,
  costSensitivityBps: readonly number[]
): ClvSliceSummary {
  const values = signals.map((signal) => signal.directionalClv).sort((left, right) => left - right);
  const net = signals.map((signal) => signal.netAfterCostProxy);
  const mean = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    signals: emittedSignals,
    withClosingProbability: values.length,
    uniqueFixtures: new Set(signals.map((signal) => signal.fixtureId)).size,
    meanDirectionalClv: mean,
    medianDirectionalClv: quantile(values, 0.5),
    p25DirectionalClv: quantile(values, 0.25),
    p75DirectionalClv: quantile(values, 0.75),
    positiveClvRate: values.length === 0 ? null : values.filter((value) => value > 0).length / values.length,
    meanNetAfterCostProxy: net.length === 0 ? null : net.reduce((sum, value) => sum + value, 0) / net.length,
    matchClusteredNetClv95: clusteredNetClvInterval(signals),
    meanNetByCostProxyBps: Object.fromEntries(
      costSensitivityBps.map((costBps) => [
        String(costBps),
        mean === null ? null : mean - costBps / 10_000
      ])
    )
  };
}

function summarizeClv(
  signals: readonly SignalClv[],
  emittedSignals: number,
  costSensitivityBps: readonly number[]
): ClvSummary {
  const matchResult = signals.filter((signal) => signal.marketKey.includes(":match_result:"));
  const totalGoals = signals.filter((signal) => signal.marketKey.includes(":total_goals:"));
  return {
    ...summarizeClvSlice(signals, emittedSignals, costSensitivityBps),
    byMarketFamily: {
      matchResult: summarizeClvSlice(matchResult, matchResult.length, costSensitivityBps),
      totalGoals: summarizeClvSlice(totalGoals, totalGoals.length, costSensitivityBps)
    }
  };
}

export type HistoricalGateStudyOptions = {
  archivePath: string;
  mappingsPath: string;
  totalEvidencePath: string;
  trainFraction: number;
  windowBeforeKickoffMs: number;
  minimumTrainingSignals: number;
  costProxyProbability: number;
};

export type DetectorGateResult = {
  detector: SignalKind;
  training: {
    selected: RankedTrainingConfiguration;
    selectedTotalGoalsAudit: AggregatedThresholdResult;
    topConfigurations: RankedTrainingConfiguration[];
  };
  test: {
    result: AggregatedThresholdResult;
    emissions: DetectorEmissionAudit;
    clv: ClvSummary;
    necessaryEvidenceStatus:
      | "human_review_required"
      | "insufficient_test_signals"
      | "nonpositive_net_signal_clv"
      | "clustered_interval_not_positive"
      | "missing_classification";
  };
};

export type HistoricalGateStudy = {
  schemaVersion: 4;
  protocolId: typeof HISTORICAL_GATE_PROTOCOL_ID;
  configurationHash: string;
  generatedAt: string;
  status: "research_evidence_only";
  auditStatus: "causal_selector_and_economic_case_normalization_repaired_pending_human_review";
  realMoneyGate: "closed";
  sourceHashes: {
    algorithm: "sha256";
    archive: { name: string; bytes: number; sha256: string };
    mappings: { name: string; bytes: number; sha256: string };
    totalEvidence: { name: string; bytes: number; sha256: string };
  };
  configuration: Omit<HistoricalGateStudyOptions, "archivePath" | "mappingsPath" | "totalEvidencePath"> & {
    feature: FeatureEngineConfig;
    labels: ForwardLabelConfig;
    totalSelector: TotalLineSelectorConfig;
    totalSelectorAsOfBeforeKickoffMs: number;
    costSensitivityBps: number[];
    bootstrap: { iterations: number; seed: number; cluster: "fixture" };
    economicCaseNormalization: "binary_totals_executable_buy_v1";
    replayEndsAtKickoff: true;
  };
  causalDiagnostics: {
    evidenceRows: number;
    probabilityAfterCutoffViolations: 0;
    coverageAfterCutoffViolations: 0;
    selectorAfterEvaluationStartViolations: 0;
    nonzeroUntimestampedVolumeLiquidityRows: 0;
  };
  operatingCost: {
    modelCalls: 0;
    modelCostMicroUsd: 0;
    note: "historical_detector_replay_has_no_model_calls";
  };
  forwardPaperCandidate: {
    detector: "CONSENSUS_MOVE";
    marketFamily: "total_goals";
    configurationSelection: "training_only_before_heldout_totals_review";
    trainingNormalizedCases: number;
    heldoutNormalizedCases: number;
    heldoutFixtures: number;
    meanNetAfterCostProxy: number | null;
    matchClusteredNetClv95: ClvSliceSummary["matchClusteredNetClv95"];
    status:
      | "historical_signal_candidate_for_forward_paper_review"
      | "insufficient_historical_signal_evidence";
    executionEvidence: "not_established_sampled_prices_only";
    registration: "engineering_candidate_unregistered";
  };
  split: {
    cutoffTsMs: number;
    cutoffIso: string;
    trainFixtures: number;
    testFixtures: number;
    trainKickoffRange: [string, string];
    testKickoffRange: [string, string];
  };
  totalSelector: {
    status: "candidate_pending_human_gate_review";
    selectedFixtures: number;
    noEligibleFixtures: number;
    criteriaDisagreeFixtures: number;
    lineDistribution: Record<string, number>;
  };
  coverage: {
    train: {
      groupsAttempted: number;
      groupsWithBothSources: number;
      events: number;
      snapshots: number;
      missingGroups: Array<{ fixtureId: string; marketKey: string; txlineEvents: number; polymarketEvents: number }>;
    };
    test: {
      groupsAttempted: number;
      groupsWithBothSources: number;
      events: number;
      snapshots: number;
      missingGroups: Array<{ fixtureId: string; marketKey: string; txlineEvents: number; polymarketEvents: number }>;
    };
  };
  detectors: DetectorGateResult[];
};

const BASE_DETECTOR_CONFIG: DetectorBankConfig = {
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

const LABEL_CONFIG: ForwardLabelConfig = {
  horizonMs: 900_000,
  maximumResolutionDelayMs: 120_000,
  velocityWindowMs: 300_000,
  minimumGapClosure: 0.0025,
  minimumPolymarketReversion: 0.0025,
  maximumConsensusMoveForFader: 0.0025,
  minimumPolymarketFollow: 0.0025,
  maximumConsensusReversal: 0.0025
};

function sweeps(): Sweep[] {
  return [
    {
      detector: "XMARKET_DIVERGENCE",
      configs: expandDetectorThresholdGrid(BASE_DETECTOR_CONFIG, {
        consensusStableAbsZ: [0.5, 1],
        xmarketMinimumRawGap: [0.005, 0.0075, 0.01, 0.015, 0.02],
        xmarketPersistenceMs: [0, 60_000, 120_000]
      })
    },
    {
      detector: "CONSENSUS_MOVE",
      configs: expandDetectorThresholdGrid(BASE_DETECTOR_CONFIG, {
        consensusMoveAbsZ: [1, 1.5, 2],
        consensusCusumThreshold: [0.001, 0.0025, 0.005],
        consensusMinimumUpdates: [3, 5],
        consensusMinimumRawGap: [0.005, 0.01, 0.015, 0.02]
      })
    },
    {
      detector: "FADER_CANDIDATE",
      configs: expandDetectorThresholdGrid(BASE_DETECTOR_CONFIG, {
        consensusStableAbsZ: [0.5, 1],
        faderPolymarketAbsZ: [1, 1.5, 2],
        faderMinimumRawGap: [0.005, 0.01, 0.015, 0.02],
        faderPersistenceMs: [0, 60_000]
      })
    }
  ];
}

function buildFixtures(
  records: readonly MappingRecord[],
  evidence: readonly TotalLineEvidence[],
  windowBeforeKickoffMs: number
): { fixtures: HistoricalFixture[]; selections: TotalLineSelection[] } {
  const byFixture = new Map<string, MappingRecord[]>();
  for (const record of records) {
    const rows = byFixture.get(record.txlineFixtureId) ?? [];
    rows.push(record);
    byFixture.set(record.txlineFixtureId, rows);
  }
  const evidenceByFixture = new Map<string, TotalLineEvidence[]>();
  for (const row of evidence) {
    const rows = evidenceByFixture.get(row.fixtureId) ?? [];
    rows.push(row);
    evidenceByFixture.set(row.fixtureId, rows);
  }
  const fixtures: HistoricalFixture[] = [];
  const selections: TotalLineSelection[] = [];
  for (const [fixtureId, fixtureRecords] of byFixture) {
    const kickoffTsMs = Math.min(...fixtureRecords.map((item) => item.kickoff.txlineTsMs));
    const detectorEvaluationStartTsMs = kickoffTsMs - windowBeforeKickoffMs;
    const selection = selectMainTotalLine(
      fixtureId,
      evidenceByFixture.get(fixtureId) ?? [],
      PAPER_STUDY_TOTAL_SELECTOR_CONFIG,
      detectorEvaluationStartTsMs
    );
    selections.push(selection);
    if (selection.selected === null) continue;
    const record = fixtureRecords[0]!;
    fixtures.push({
      fixtureId,
      kickoffTsMs,
      home: record.teams.home.canonical,
      away: record.teams.away.canonical,
      matchResultMarketKey: `${fixtureId}:match_result:full_time:none`,
      selectedTotalMarketKey: selection.selected.marketKey,
      selectedTotalLineMilli: selection.selected.lineMilli
    });
  }
  return { fixtures, selections };
}

function coverageTotals(rows: readonly GroupCoverage[]): HistoricalGateStudy["coverage"]["train"] {
  return {
    groupsAttempted: rows.length,
    groupsWithBothSources: rows.filter((row) => row.txlineEvents > 0 && row.polymarketEvents > 0).length,
    events: rows.reduce((sum, row) => sum + row.events, 0),
    snapshots: rows.reduce((sum, row) => sum + row.snapshots, 0),
    missingGroups: rows
      .filter((row) => row.txlineEvents === 0 || row.polymarketEvents === 0)
      .map((row) => ({
        fixtureId: row.fixtureId,
        marketKey: row.marketKey,
        txlineEvents: row.txlineEvents,
        polymarketEvents: row.polymarketEvents
      }))
  };
}

async function runTrainingGroup(
  options: HistoricalGateStudyOptions,
  fixture: HistoricalFixture,
  marketKey: string,
  definitions: readonly Sweep[],
  aggregators: ReadonlyMap<SignalKind, ThresholdResultAggregator>,
  totalGoalsAggregators: ReadonlyMap<SignalKind, ThresholdResultAggregator>
): Promise<GroupCoverage> {
  const studies = definitions.map((definition) => ({
    definition,
    study: new StreamingDetectorStudy(
      new DetectorThresholdGrid(definition.configs),
      new ForwardOutcomeLabeler(LABEL_CONFIG)
    )
  }));
  const summary = await extractResearchFeatures({
    archivePath: options.archivePath,
    query: {
      fixtureId: fixture.fixtureId,
      marketKey,
      fromTsMs: fixture.kickoffTsMs - options.windowBeforeKickoffMs,
      toTsMs: fixture.kickoffTsMs,
      includeInRunning: false
    },
    featureConfig: PAPER_STUDY_FEATURE_CONFIG,
    onSnapshot: (snapshot) => {
      for (const item of studies) item.study.ingest(snapshot);
    }
  });
  for (const item of studies) {
    const results = item.study.finish();
    aggregators.get(item.definition.detector)!.add(results);
    if (marketKey.includes(":total_goals:")) {
      totalGoalsAggregators.get(item.definition.detector)!.add(results);
    }
  }
  return { fixtureId: fixture.fixtureId, marketKey, ...summary };
}

type TestRunner = {
  detector: SignalKind;
  config: DetectorBankConfig;
  aggregator: ThresholdResultAggregator;
};

async function runTestGroup(
  options: HistoricalGateStudyOptions,
  fixture: HistoricalFixture,
  marketKey: string,
  runners: readonly TestRunner[],
  clvSignals: Map<SignalKind, SignalClv[]>,
  emissionAudits: Map<SignalKind, DetectorEmissionAudit>
): Promise<GroupCoverage> {
  const studies = runners.map((runner) => ({
    runner,
    study: new StreamingDetectorStudy(
      new DetectorThresholdGrid([runner.config]),
      new ForwardOutcomeLabeler(LABEL_CONFIG)
    ),
    bank: new DetectorBank(runner.config)
  }));
  const signals: DetectorSignal[] = [];
  const closing = new Map<string, number>();
  const summary = await extractResearchFeatures({
    archivePath: options.archivePath,
    query: {
      fixtureId: fixture.fixtureId,
      marketKey,
      fromTsMs: fixture.kickoffTsMs - options.windowBeforeKickoffMs,
      toTsMs: fixture.kickoffTsMs,
      includeInRunning: false
    },
    featureConfig: PAPER_STUDY_FEATURE_CONFIG,
    onSnapshot: (snapshot: FeatureSnapshot) => {
      if (snapshot.consensus.probability !== null) {
        closing.set(`${snapshot.market.key}:${snapshot.outcome}`, snapshot.consensus.probability);
      }
      for (const item of studies) {
        item.study.ingest(snapshot);
        for (const signal of item.bank.ingest(snapshot)) {
          if (
            signal.kind === item.runner.detector &&
            signal.detectedAtTsMs <= fixture.kickoffTsMs - LABEL_CONFIG.horizonMs
          ) {
            signals.push(signal);
          }
        }
      }
    }
  });
  for (const item of studies) item.runner.aggregator.add(item.study.finish());
  const normalization = normalizeExecutableEconomicCases(signals);
  for (const [index, signal] of signals.entries()) {
    const disposition = normalization.dispositions[index]!;
    const audit = emissionAudits.get(signal.kind)!;
    audit.rawEmissions += 1;
    if (disposition.disposition === "retained") audit.normalizedEconomicCases += 1;
    if (disposition.reason === "executable_buy_retained") audit.executableTotalGoalsCases += 1;
    else if (disposition.reason === "non_binary_market_passthrough") {
      audit.nonBinaryMarketSignalsPassedThrough += 1;
    } else if (disposition.reason === "duplicate_executable_buy_collapsed") {
      audit.duplicateExecutableBuysCollapsed += 1;
    } else if (disposition.reason === "complementary_sell_collapsed_into_executable_buy") {
      audit.complementarySellsCollapsed += 1;
    } else if (disposition.reason === "sell_only_unproven_executable_ask") {
      audit.sellOnlySignalsDropped += 1;
    } else if (disposition.reason === "unsupported_total_goals_outcome") {
      audit.unsupportedTotalGoalsSignalsDropped += 1;
    }
  }
  for (const signal of normalization.signals) {
    const closingProbability = closing.get(`${signal.market.key}:${signal.outcome}`);
    if (closingProbability === undefined) continue;
    const entryProbability = signal.evidence.polymarketProbability;
    const directionalClv = signal.direction === "buy"
      ? closingProbability - entryProbability
      : entryProbability - closingProbability;
    clvSignals.get(signal.kind)!.push({
      detector: signal.kind,
      fixtureId: fixture.fixtureId,
      marketKey: signal.market.key,
      outcome: signal.outcome,
      direction: signal.direction,
      detectedAtTsMs: signal.detectedAtTsMs,
      entryProbability,
      closingProbability,
      directionalClv,
      netAfterCostProxy: directionalClv - options.costProxyProbability
    });
  }
  return { fixtureId: fixture.fixtureId, marketKey, ...summary };
}

function kickoffRange(fixtures: readonly HistoricalFixture[]): [string, string] {
  const values = fixtures.map((fixture) => fixture.kickoffTsMs).sort((left, right) => left - right);
  return [new Date(values[0]!).toISOString(), new Date(values.at(-1)!).toISOString()];
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function causalDiagnostics(
  evidence: readonly TotalLineEvidence[],
  records: readonly MappingRecord[],
  windowBeforeKickoffMs: number
): HistoricalGateStudy["causalDiagnostics"] {
  const kickoffByFixture = new Map<string, number>();
  for (const record of records) {
    const current = kickoffByFixture.get(record.txlineFixtureId);
    kickoffByFixture.set(
      record.txlineFixtureId,
      current === undefined ? record.kickoff.txlineTsMs : Math.min(current, record.kickoff.txlineTsMs)
    );
  }
  const probabilityAfterCutoffViolations = evidence.filter((row) =>
    row.preKickoffPointTsMs !== null && row.preKickoffPointTsMs > row.selectorCutoffTsMs
  ).length;
  const coverageAfterCutoffViolations = evidence.filter((row) =>
    row.coverageLastPointTsMs !== null && row.coverageLastPointTsMs > row.selectorCutoffTsMs
  ).length;
  const selectorAfterEvaluationStartViolations = evidence.filter((row) => {
    const kickoff = kickoffByFixture.get(row.fixtureId);
    return kickoff === undefined || row.selectorCutoffTsMs > kickoff - windowBeforeKickoffMs;
  }).length;
  const nonzeroUntimestampedVolumeLiquidityRows = evidence.filter((row) =>
    row.volume !== 0 || row.liquidity !== 0
  ).length;
  if (
    probabilityAfterCutoffViolations !== 0 ||
    coverageAfterCutoffViolations !== 0 ||
    selectorAfterEvaluationStartViolations !== 0 ||
    nonzeroUntimestampedVolumeLiquidityRows !== 0
  ) {
    throw new Error("Historical gate causal diagnostics found future or untimestamped selector inputs");
  }
  return {
    evidenceRows: evidence.length,
    probabilityAfterCutoffViolations: 0,
    coverageAfterCutoffViolations: 0,
    selectorAfterEvaluationStartViolations: 0,
    nonzeroUntimestampedVolumeLiquidityRows: 0
  };
}

export async function runHistoricalGateStudy(
  options: HistoricalGateStudyOptions,
  onProgress?: (message: string) => void
): Promise<HistoricalGateStudy> {
  if (!Number.isFinite(options.costProxyProbability) || options.costProxyProbability < 0) {
    throw new RangeError("Cost proxy probability must be non-negative");
  }
  if (!Number.isSafeInteger(options.windowBeforeKickoffMs) || options.windowBeforeKickoffMs <= 0) {
    throw new RangeError("Historical replay window must be a positive safe-integer duration");
  }
  if (options.windowBeforeKickoffMs > PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS) {
    throw new Error("Historical detector evaluation cannot begin before the frozen total-line selector cutoff");
  }
  const archiveBefore = await stat(options.archivePath);
  const [mappingText, evidenceText, archiveSha256] = await Promise.all([
    readFile(options.mappingsPath, "utf8"),
    readFile(options.totalEvidencePath, "utf8"),
    sha256File(options.archivePath)
  ]);
  const mappingFile = JSON.parse(mappingText) as MappingFile;
  const evidenceFile = JSON.parse(evidenceText) as TotalEvidenceFile;
  assertCausalTotalEvidenceFile(evidenceFile);
  assertCausalTotalSelectorConfig(PAPER_STUDY_TOTAL_SELECTOR_CONFIG);
  const costSensitivityBps = [50, 100, 150, 200];
  const records = mappingFile.records ?? [];
  const evidence = evidenceFile.evidence ?? [];
  const diagnostics = causalDiagnostics(evidence, records, options.windowBeforeKickoffMs);
  const { fixtures, selections } = buildFixtures(
    records,
    evidence,
    options.windowBeforeKickoffMs
  );
  const split = chronologicalFixtureSplit(fixtures, options.trainFraction);
  const definitions = sweeps();
  const configuration: HistoricalGateStudy["configuration"] = {
    trainFraction: options.trainFraction,
    windowBeforeKickoffMs: options.windowBeforeKickoffMs,
    minimumTrainingSignals: options.minimumTrainingSignals,
    costProxyProbability: options.costProxyProbability,
    feature: PAPER_STUDY_FEATURE_CONFIG,
    labels: LABEL_CONFIG,
    totalSelector: PAPER_STUDY_TOTAL_SELECTOR_CONFIG,
    totalSelectorAsOfBeforeKickoffMs: PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS,
    costSensitivityBps,
    bootstrap: {
      iterations: HISTORICAL_GATE_BOOTSTRAP_ITERATIONS,
      seed: HISTORICAL_GATE_BOOTSTRAP_SEED,
      cluster: "fixture"
    },
    economicCaseNormalization: "binary_totals_executable_buy_v1",
    replayEndsAtKickoff: true
  };
  const configurationHash = sha256Text(stableJson({
    protocolId: HISTORICAL_GATE_PROTOCOL_ID,
    configuration,
    detectorSweeps: definitions
  }));
  const trainingAggregators = new Map(
    DETECTORS.map((detector) => [detector, new ThresholdResultAggregator(detector)])
  );
  const trainingTotalGoalsAggregators = new Map(
    DETECTORS.map((detector) => [detector, new ThresholdResultAggregator(detector)])
  );
  const trainCoverage: GroupCoverage[] = [];
  for (const [index, fixture] of split.train.entries()) {
    for (const marketKey of [fixture.matchResultMarketKey, fixture.selectedTotalMarketKey]) {
      trainCoverage.push(await runTrainingGroup(
        options,
        fixture,
        marketKey,
        definitions,
        trainingAggregators,
        trainingTotalGoalsAggregators
      ));
    }
    if ((index + 1) % 10 === 0 || index + 1 === split.train.length) {
      onProgress?.(`training ${index + 1}/${split.train.length} fixtures`);
    }
  }

  const ranked = new Map<SignalKind, RankedTrainingConfiguration[]>();
  for (const detector of DETECTORS) {
    ranked.set(
      detector,
      rankTrainingConfigurations(
        trainingAggregators.get(detector)!.results(),
        options.minimumTrainingSignals,
        detector,
        options.costProxyProbability
      )
    );
  }
  const selected = new Map(
    DETECTORS.map((detector) => [detector, selectEligibleTrainingConfiguration(detector, ranked.get(detector) ?? [])])
  );
  const selectedTotalGoalsAudit = new Map(DETECTORS.map((detector) => {
    const selectedConfig = selected.get(detector)!;
    const audit = trainingTotalGoalsAggregators
      .get(detector)!
      .results()
      .find((candidate) => candidate.configId === selectedConfig.configId);
    if (!audit) throw new Error(`Training Total Goals audit is missing selected config for ${detector}`);
    return [detector, audit] as const;
  }));
  const testRunners: TestRunner[] = DETECTORS.map((detector) => {
    return {
      detector,
      config: selected.get(detector)!.config,
      aggregator: new ThresholdResultAggregator(detector)
    };
  });
  const clvSignals = new Map(DETECTORS.map((detector) => [detector, [] as SignalClv[]]));
  const emissionAudits = new Map(DETECTORS.map((detector) => [detector, emptyEmissionAudit()]));
  const testCoverage: GroupCoverage[] = [];
  for (const [index, fixture] of split.test.entries()) {
    for (const marketKey of [fixture.matchResultMarketKey, fixture.selectedTotalMarketKey]) {
      testCoverage.push(await runTestGroup(
        options,
        fixture,
        marketKey,
        testRunners,
        clvSignals,
        emissionAudits
      ));
    }
    if ((index + 1) % 5 === 0 || index + 1 === split.test.length) {
      onProgress?.(`test ${index + 1}/${split.test.length} fixtures`);
    }
  }

  const detectorResults: DetectorGateResult[] = DETECTORS.map((detector) => {
    const selectedConfiguration = selected.get(detector)!;
    const result = testRunners.find((runner) => runner.detector === detector)!.aggregator.results()[0];
    if (!result) throw new Error(`Held-out study produced no result for ${detector}`);
    const clv = summarizeClv(
      clvSignals.get(detector)!,
      emissionAudits.get(detector)!.normalizedEconomicCases,
      costSensitivityBps
    );
    let necessaryEvidenceStatus: DetectorGateResult["test"]["necessaryEvidenceStatus"];
    if (result.classification.precision === null) necessaryEvidenceStatus = "missing_classification";
    else if (clv.withClosingProbability < 30) necessaryEvidenceStatus = "insufficient_test_signals";
    else if (clv.meanNetAfterCostProxy === null || clv.meanNetAfterCostProxy <= 0) {
      necessaryEvidenceStatus = "nonpositive_net_signal_clv";
    } else if (clv.matchClusteredNetClv95 === null || clv.matchClusteredNetClv95.low <= 0) {
      necessaryEvidenceStatus = "clustered_interval_not_positive";
    } else necessaryEvidenceStatus = "human_review_required";
    return {
      detector,
      training: {
        selected: selectedConfiguration,
        selectedTotalGoalsAudit: selectedTotalGoalsAudit.get(detector)!,
        topConfigurations: ranked.get(detector)!.slice(0, 5)
      },
      test: { result, emissions: { ...emissionAudits.get(detector)! }, clv, necessaryEvidenceStatus }
    };
  });
  const lineDistribution: Record<string, number> = {};
  for (const fixture of fixtures) {
    const line = (fixture.selectedTotalLineMilli / 1_000).toFixed(1);
    lineDistribution[line] = (lineDistribution[line] ?? 0) + 1;
  }
  const archiveAfter = await stat(options.archivePath);
  if (archiveAfter.size !== archiveBefore.size || archiveAfter.mtimeMs !== archiveBefore.mtimeMs) {
    throw new Error("Historical source archive changed during the gate run");
  }
  const consensus = detectorResults.find((result) => result.detector === "CONSENSUS_MOVE")!;
  const consensusTotals = consensus.test.clv.byMarketFamily.totalGoals;
  const consensusTotalsInterval = consensusTotals.matchClusteredNetClv95;
  const forwardCandidatePasses =
    consensus.training.selectedTotalGoalsAudit.signals >= options.minimumTrainingSignals &&
    consensusTotals.withClosingProbability >= 30 &&
    consensusTotals.meanNetAfterCostProxy !== null &&
    consensusTotals.meanNetAfterCostProxy > 0 &&
    consensusTotalsInterval !== null &&
    consensusTotalsInterval.low > 0;
  return {
    schemaVersion: 4,
    protocolId: HISTORICAL_GATE_PROTOCOL_ID,
    configurationHash,
    generatedAt: new Date().toISOString(),
    status: "research_evidence_only",
    auditStatus: "causal_selector_and_economic_case_normalization_repaired_pending_human_review",
    realMoneyGate: "closed",
    sourceHashes: {
      algorithm: "sha256",
      archive: {
        name: basename(options.archivePath),
        bytes: archiveBefore.size,
        sha256: archiveSha256
      },
      mappings: {
        name: basename(options.mappingsPath),
        bytes: Buffer.byteLength(mappingText),
        sha256: sha256Text(mappingText)
      },
      totalEvidence: {
        name: basename(options.totalEvidencePath),
        bytes: Buffer.byteLength(evidenceText),
        sha256: sha256Text(evidenceText)
      }
    },
    configuration,
    causalDiagnostics: diagnostics,
    operatingCost: {
      modelCalls: 0,
      modelCostMicroUsd: 0,
      note: "historical_detector_replay_has_no_model_calls"
    },
    forwardPaperCandidate: {
      detector: "CONSENSUS_MOVE",
      marketFamily: "total_goals",
      configurationSelection: "training_only_before_heldout_totals_review",
      trainingNormalizedCases: consensus.training.selectedTotalGoalsAudit.signals,
      heldoutNormalizedCases: consensusTotals.withClosingProbability,
      heldoutFixtures: consensusTotals.uniqueFixtures,
      meanNetAfterCostProxy: consensusTotals.meanNetAfterCostProxy,
      matchClusteredNetClv95: consensusTotalsInterval,
      status: forwardCandidatePasses
        ? "historical_signal_candidate_for_forward_paper_review"
        : "insufficient_historical_signal_evidence",
      executionEvidence: "not_established_sampled_prices_only",
      registration: "engineering_candidate_unregistered"
    },
    split: {
      cutoffTsMs: split.cutoffTsMs,
      cutoffIso: new Date(split.cutoffTsMs).toISOString(),
      trainFixtures: split.train.length,
      testFixtures: split.test.length,
      trainKickoffRange: kickoffRange(split.train),
      testKickoffRange: kickoffRange(split.test)
    },
    totalSelector: {
      status: "candidate_pending_human_gate_review",
      selectedFixtures: fixtures.length,
      noEligibleFixtures: selections.filter((selection) => selection.selected === null).length,
      criteriaDisagreeFixtures: selections.filter((selection) => selection.criteriaDisagree).length,
      lineDistribution
    },
    coverage: { train: coverageTotals(trainCoverage), test: coverageTotals(testCoverage) },
    detectors: detectorResults
  };
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function probabilityBps(value: number | null): string {
  return value === null ? "n/a" : (value * 10_000).toFixed(1);
}

function selectedParameters(detector: SignalKind, config: DetectorBankConfig): string {
  if (detector === "XMARKET_DIVERGENCE") {
    return `gap=${probabilityBps(config.xmarketMinimumRawGap)}bps, persist=${config.xmarketPersistenceMs / 1_000}s, stableZ=${config.consensusStableAbsZ}`;
  }
  if (detector === "CONSENSUS_MOVE") {
    return `z=${config.consensusMoveAbsZ}, cusum=${probabilityBps(config.consensusCusumThreshold)}bps, gap=${probabilityBps(config.consensusMinimumRawGap)}bps, updates=${config.consensusMinimumUpdates}`;
  }
  return `pmZ=${config.faderPolymarketAbsZ}, gap=${probabilityBps(config.faderMinimumRawGap)}bps, persist=${config.faderPersistenceMs / 1_000}s, stableZ=${config.consensusStableAbsZ}`;
}

export function renderHistoricalGateStudyMarkdown(study: HistoricalGateStudy): string {
  const detectorRows = study.detectors.map((row) => {
    const train = row.training.selected.classification;
    const test = row.test.result.classification;
    const interval = row.test.clv.matchClusteredNetClv95;
    const intervalText = interval === null
      ? "n/a"
      : `[${probabilityBps(interval.low)}, ${probabilityBps(interval.high)}]`;
    return `| ${row.detector} | ${selectedParameters(row.detector, row.training.selected.config)} | ${row.training.selected.rawEmissions} | ${row.training.selected.normalizedEconomicCases} | ${percent(train.precision)} | ${percent(train.recall)} | ${row.test.emissions.rawEmissions} | ${row.test.emissions.normalizedEconomicCases} | ${row.test.clv.withClosingProbability} | ${row.test.clv.uniqueFixtures} | ${percent(test.precision)} | ${percent(test.recall)} | ${probabilityBps(row.test.clv.meanDirectionalClv)} | ${probabilityBps(row.test.clv.meanNetAfterCostProxy)} | ${intervalText} | ${probabilityBps(row.test.clv.byMarketFamily.matchResult.meanNetAfterCostProxy)} | ${probabilityBps(row.test.clv.byMarketFamily.totalGoals.meanNetAfterCostProxy)} | ${row.test.necessaryEvidenceStatus} |`;
  });
  const sensitivityRows = study.detectors.map((detector) =>
    `| ${detector.detector} | ${study.configuration.costSensitivityBps.map((cost) => probabilityBps(detector.test.clv.meanNetByCostProxyBps[String(cost)] ?? null)).join(" | ")} |`
  );
  const normalizationRows = study.detectors.map((detector) => {
    const audit = detector.test.emissions;
    return `| ${detector.detector} | ${audit.rawEmissions} | ${audit.normalizedEconomicCases} | ${audit.executableTotalGoalsCases} | ${audit.nonBinaryMarketSignalsPassedThrough} | ${audit.complementarySellsCollapsed} | ${audit.duplicateExecutableBuysCollapsed} | ${audit.sellOnlySignalsDropped} | ${audit.unsupportedTotalGoalsSignalsDropped} |`;
  });
  const topRows = study.detectors.flatMap((detector) => detector.training.topConfigurations.map((row, index) =>
    `| ${detector.detector} | ${index + 1} | ${selectedParameters(detector.detector, row.config)} | ${row.rawEmissions} | ${row.normalizedEconomicCases} | ${percent(row.classification.precision)} | ${percent(row.classification.recall)} | ${row.f1 === null ? "n/a" : row.f1.toFixed(3)} | ${row.meetsMinimumSignals ? "yes" : "no"} | ${row.meetsCostFloor ? "yes" : "no"} |`
  ));
  return [
    "# Historical Detector Gate Study",
    "",
    `Generated: ${study.generatedAt}`,
    `Protocol: \`${study.protocolId}\``,
    `Configuration SHA-256: \`${study.configurationHash}\``,
    "",
    "> Research evidence only. Historical Polymarket points are sampled prices without bid/ask or depth. Results below are signal research, not executable-fill proof. The real-money gate remains closed.",
    "> Audit status: the causal selector and binary Total Goals economic-case normalization are repaired. The result still requires Deborah's human gate review and must not be described as executable alpha.",
    `> Source SHA-256: archive \`${study.sourceHashes.archive.sha256}\`; mappings \`${study.sourceHashes.mappings.sha256}\`; causal selector evidence \`${study.sourceHashes.totalEvidence.sha256}\`.`,
    "",
    "## Design",
    "",
    `- Chronological train/test split: ${study.split.trainFixtures} / ${study.split.testFixtures} fixtures`,
    `- Training range: ${study.split.trainKickoffRange[0]} to ${study.split.trainKickoffRange[1]}`,
    `- Held-out range: ${study.split.testKickoffRange[0]} to ${study.split.testKickoffRange[1]}`,
    `- Split cutoff: ${study.split.cutoffIso}; identical kickoff timestamps never cross partitions`,
    `- Replay window: final ${(study.configuration.windowBeforeKickoffMs / 3_600_000).toFixed(1)} hours through kickoff; in-running TXLine rows excluded`,
    `- Forward label: ${(study.configuration.labels.horizonMs / 60_000).toFixed(0)} minutes with ${probabilityBps(study.configuration.labels.minimumGapClosure)} bps minimum gap closure`,
    `- Historical cost proxy: ${probabilityBps(study.configuration.costProxyProbability)} probability bps per signal`,
    `- Training selection: labeled snapshot F1, guarded by at least ${study.configuration.minimumTrainingSignals} normalized economic cases; raw emissions cannot satisfy the minimum-n gate`,
    `- Uncertainty: ${study.configuration.bootstrap.iterations.toLocaleString("en-US")} fixture-clustered bootstrap iterations, seed ${study.configuration.bootstrap.seed}`,
    `- Model operating cost: $0.00 (${study.operatingCost.modelCalls} model calls; deterministic historical replay only)`,
    "",
    "## Coverage",
    "",
    `- Training groups with both sources: ${study.coverage.train.groupsWithBothSources}/${study.coverage.train.groupsAttempted}; ${study.coverage.train.events.toLocaleString("en-US")} events; ${study.coverage.train.snapshots.toLocaleString("en-US")} snapshots`,
    `- Held-out groups with both sources: ${study.coverage.test.groupsWithBothSources}/${study.coverage.test.groupsAttempted}; ${study.coverage.test.events.toLocaleString("en-US")} events; ${study.coverage.test.snapshots.toLocaleString("en-US")} snapshots`,
    `- Causal diagnostics across ${study.causalDiagnostics.evidenceRows.toLocaleString("en-US")} selector rows: ${study.causalDiagnostics.probabilityAfterCutoffViolations} future probabilities; ${study.causalDiagnostics.coverageAfterCutoffViolations} future coverage rows; ${study.causalDiagnostics.selectorAfterEvaluationStartViolations} late selector cutoffs; ${study.causalDiagnostics.nonzeroUntimestampedVolumeLiquidityRows} nonzero untimestamped liquidity/volume rows`,
    ...(study.coverage.test.missingGroups.length === 0
      ? []
      : [`- Held-out missing groups: ${study.coverage.test.missingGroups.map((group) => `\`${group.marketKey}\``).join(", ")}`]),
    "",
    "## Dynamic Total Candidate",
    "",
    `The candidate rule freezes each exact mapped full-time total ${(study.configuration.totalSelectorAsOfBeforeKickoffMs / 3_600_000).toFixed(1)} hours before TXLine kickoff—before the first detector snapshot—then selects the line closest to 50/50. Both probability and coverage are bounded by that same as-of timestamp. It requires at least ${study.configuration.totalSelector.minimumCoveragePoints.toLocaleString("en-US")} as-of history points and fails closed beyond ${probabilityBps(study.configuration.totalSelector.maximumDistanceFromEven)} bps from even. It selected ${study.totalSelector.selectedFixtures} fixtures with ${study.totalSelector.noEligibleFixtures} failures. Distribution: ${Object.entries(study.totalSelector.lineDistribution).map(([line, count]) => `O/U ${line}: ${count}`).join(", ")}.`,
    "",
    `Status: \`${study.totalSelector.status}\`. Volume and liquidity are zeroed and forbidden as selector inputs because no timestamped historical as-of evidence exists for them.`,
    "",
    "## Forward Paper Candidate Assessment",
    "",
    `The prespecified paper family is **Total Goals only**. Its frozen \`CONSENSUS_MOVE\` configuration was chosen from training data before held-out Total Goals results were inspected. A family-specific training audit found ${study.forwardPaperCandidate.trainingNormalizedCases} normalized Total Goals cases, so the training minimum was not borrowed from Match Result.`,
    "",
    study.forwardPaperCandidate.matchClusteredNetClv95 === null
      ? "The held-out Total Goals slice has no estimable fixture-clustered interval."
      : `Held-out Total Goals: ${study.forwardPaperCandidate.heldoutNormalizedCases} normalized buy cases across ${study.forwardPaperCandidate.heldoutFixtures} fixtures; mean after the ${probabilityBps(study.configuration.costProxyProbability)} bps cost proxy ${probabilityBps(study.forwardPaperCandidate.meanNetAfterCostProxy)} bps; fixture-clustered 95% CI [${probabilityBps(study.forwardPaperCandidate.matchClusteredNetClv95.low)}, ${probabilityBps(study.forwardPaperCandidate.matchClusteredNetClv95.high)}] bps.`,
    "",
    `Status: \`${study.forwardPaperCandidate.status}\`. This is a **historical signal candidate for a fresh forward paper review**, not alpha, profitability, or executable-fill evidence. Inputs are sampled Polymarket prices without bid/ask depth; the v2 paper protocol remains \`${study.forwardPaperCandidate.registration}\` and cannot admit observations or spend Claude tokens before Deborah registers it.`,
    "",
    "## Held-Out Results",
    "",
    "| Detector | Train-selected parameters | Train raw emissions | Train normalized cases | Train snapshot precision | Train snapshot recall | Test raw emissions | Test normalized cases | Test CLV n | Fixtures | Test snapshot precision | Test snapshot recall | Mean signal CLV bps | Mean after-cost bps | Fixture-clustered 95% CI bps | Match Result net bps | Total net bps | Necessary evidence status |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|",
    ...detectorRows,
    "",
    "`human_review_required` means only that the predeclared sample, after-cost point estimate, and fixture-clustered interval checks passed. `clustered_interval_not_positive` means the point estimate was not strong enough to exclude zero after fixture clustering. Neither status is permission to trade or a substitute for Deborah's gate decision, settlement verification, risk caps, or executable-book evidence.",
    "",
    "For binary totals, `buy Over + sell Under` is one Over exposure and `buy Under + sell Over` is one Under exposure. An actual BUY is retained; duplicates and complementary sell expressions collapse into it. Sell-only totals are excluded because detector inputs do not prove an executable complementary-token ask. Three-way Match Result signals are not economically normalized.",
    "",
    "### Held-Out Normalization Audit",
    "",
    "| Detector | Raw | Normalized | Executable total buys | Match Result pass-through | Complementary sells collapsed | Duplicate buys collapsed | Sell-only totals dropped | Invalid total outcomes dropped |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...normalizationRows,
    "",
    "## Cost Sensitivity",
    "",
    `| Detector | ${study.configuration.costSensitivityBps.map((cost) => `${cost} bps proxy`).join(" | ")} |`,
    `|---|${study.configuration.costSensitivityBps.map(() => "---:").join("|")}|`,
    ...sensitivityRows,
    "",
    "Values are mean directional signal CLV after subtracting each proxy. This is a sensitivity check, not a claim about actual historical execution costs.",
    "",
    "## Training Leaderboard",
    "",
    "| Detector | Rank | Parameters | Raw emissions | Normalized cases | Snapshot precision | Snapshot recall | F1 | Minimum n met | Cost floor met |",
    "|---|---:|---|---:|---:|---:|---:|---:|---|---|",
    ...topRows,
    "",
    "## Guardrails",
    "",
    "- No held-out result influenced configuration selection.",
    "- Total-line selection uses only prices and coverage observable no later than the first detector snapshot.",
    "- Training and held-out minimum-sample checks use normalized economic cases, never raw detector emissions.",
    "- Sell-only Total Goals cases fail closed; sampled history cannot prove a complementary token was buyable at that moment.",
    "- Sampled Polymarket history cannot establish executable spread, slippage, or fill probability; the cost proxy is deliberately conservative but remains a proxy.",
    "- Candidate mappings remain non-tradeable and no settlement review is inferred from research alignment.",
    "- Thresholds in this report are exploratory until the human gate review explicitly freezes or rejects them.",
    "- STALE_QUOTE remains disabled based on the synchronized live-lane result; this historical study does not evaluate it.",
    ""
  ].join("\n");
}
