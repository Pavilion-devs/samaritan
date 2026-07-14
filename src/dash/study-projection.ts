import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  STUDY_SNAPSHOT_ID,
  TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
  type CorrectedHistoricalCandidate,
  type StudyApiResponse,
  type StudyEndpoints,
  type StudyGuardrails,
  type StudyMatchRow,
  type StudySnapshot
} from "./public-contract.js";

const countsSchema = z.object({
  matches: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
  filledMatches: z.number().int().nonnegative(),
  fills: z.number().int().nonnegative(),
  settledFills: z.number().int().nonnegative()
});

const intervalSchema = z.object({
  iterations: z.number().int().positive(),
  seed: z.number().int(),
  matches: z.number().int().positive(),
  signals: z.number().int().positive(),
  low: z.number().finite(),
  median: z.number().finite(),
  high: z.number().finite()
});

const endpointsSchema = z.object({
  meanNetClvBps: z.number().finite(),
  netClvInterval: intervalSchema,
  meanSettlementPnlMicroUsd: z.number().int(),
  settlementPnlInterval: intervalSchema,
  noTradeBaselineClvBps: z.literal(0),
  randomDirectionControlClvBps: z.number().finite(),
  fractionSettledMatchesNetPositive: z.number().min(0).max(1)
});

const guardrailsSchema = z.object({
  fillRate: z.number().min(0).max(1),
  fillRatePassed: z.boolean(),
  meanSlippageBps: z.number().finite().nonnegative().nullable(),
  slippagePassed: z.boolean(),
  maxDrawdownMicroUsd: z.number().int().nonnegative(),
  drawdownPassed: z.boolean(),
  selectedDepthComplete: z.boolean(),
  closeMarksComplete: z.boolean(),
  settlementComplete: z.boolean()
});

const rowSchema = z.object({
  fixtureId: z.string().min(1),
  kickoffTsMs: z.number().int().nonnegative(),
  selectedLineMilli: z.number().int(),
  signals: z.number().int().nonnegative(),
  fills: z.number().int().nonnegative(),
  fillRate: z.number().min(0).max(1),
  meanHalfSpreadBps: z.number().finite().nonnegative().nullable(),
  meanSlippageBps: z.number().finite().nonnegative().nullable(),
  grossClvBps: z.number().finite().nullable(),
  netClvBps: z.number().finite().nullable(),
  settlementPnlMicroUsd: z.number().int().nullable(),
  netReturnBps: z.number().finite().nullable()
});

const reportSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  counts: countsSchema,
  stoppingRuleMet: z.boolean(),
  status: z.enum(["sealed", "exploratory", "accept", "reject", "inconclusive"]),
  reason: z.string().min(1),
  rows: z.array(rowSchema).nullable(),
  endpoints: endpointsSchema.nullable(),
  guardrails: guardrailsSchema.nullable()
});

const initializationSchema = z.object({
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  protocolVersion: z.string().min(1),
  realMoneyGate: z.literal("closed"),
  startedAt: z.string().datetime(),
  frozenConfig: z.object({
    detector: z.object({
      consensusCusumThreshold: z.number().finite().positive(),
      consensusMinimumRawGap: z.number().finite().positive(),
      consensusMinimumUpdates: z.number().int().positive(),
      consensusMoveAbsZ: z.number().finite().positive()
    }),
    evaluation: z.object({
      bootstrapIterations: z.number().int().positive(),
      bootstrapSeed: z.number().int(),
      maximumDrawdownMicroUsd: z.number().int().positive(),
      maximumMeanSlippageBps: z.number().finite().positive(),
      minimumFilledMatches: z.number().int().positive(),
      minimumFillRate: z.number().min(0).max(1),
      minimumFills: z.number().int().positive()
    }),
    risk: z.object({
      aggregateExposureMicroUsd: z.number().int().positive(),
      bankrollMicroUsd: z.number().int().positive(),
      drawdownStopMicroUsd: z.number().int().positive(),
      perTradeStakeMicroUsd: z.number().int().positive(),
      realMoneyGate: z.literal("closed")
    }),
    selector: z.object({
      maximumDistanceFromEven: z.number().min(0).max(0.5),
      minimumCoveragePoints: z.number().int().positive()
    })
  })
});

const laneSchema = z.object({
  initialization: initializationSchema,
  chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  report: reportSchema
});

const artifactSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.string().min(1),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  realMoneyGate: z.literal("closed"),
  fixtureUniverseGeneratedAt: z.string().datetime(),
  lanes: z.object({ bounty: laneSchema, longRun: laneSchema })
});

const universeSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: z.object({
    fixtures: z.number().int().nonnegative(),
    pairedBookReplays: z.number().int().nonnegative(),
    executableBookReplays: z.number().int().nonnegative(),
    signalResearchOnly: z.number().int().nonnegative(),
    longRunEligible: z.number().int().nonnegative()
  })
});

const correctedHistoricalCandidateSourceSchema = z.object({
  schemaVersion: z.literal(4),
  generatedAt: z.string().datetime(),
  protocolId: z.literal("historical-gate-causal-economic-v4-2026-07-14"),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("research_evidence_only"),
  auditStatus: z.literal("causal_selector_and_economic_case_normalization_repaired_pending_human_review"),
  realMoneyGate: z.literal("closed"),
  configuration: z.object({
    costProxyProbability: z.literal(0.01),
    bootstrap: z.object({
      iterations: z.literal(10_000),
      seed: z.literal(20_260_714),
      cluster: z.literal("fixture")
    }).passthrough()
  }).passthrough(),
  forwardPaperCandidate: z.object({
    detector: z.literal("CONSENSUS_MOVE"),
    marketFamily: z.literal("total_goals"),
    configurationSelection: z.literal("training_only_before_heldout_totals_review"),
    trainingNormalizedCases: z.literal(135),
    heldoutNormalizedCases: z.literal(38),
    heldoutFixtures: z.literal(18),
    meanNetAfterCostProxy: z.number().finite().positive(),
    matchClusteredNetClv95: z.object({
      iterations: z.literal(10_000),
      seed: z.literal(20_260_714),
      fixtures: z.literal(18),
      signals: z.literal(38),
      low: z.number().finite().positive(),
      median: z.number().finite().positive(),
      high: z.number().finite().positive()
    }).strict(),
    status: z.literal("historical_signal_candidate_for_forward_paper_review"),
    executionEvidence: z.literal("not_established_sampled_prices_only"),
    registration: z.literal("engineering_candidate_unregistered")
  }).strict()
}).passthrough();

function validCounts(counts: z.infer<typeof countsSchema>): boolean {
  return counts.filledMatches <= counts.matches && counts.fills <= counts.signals && counts.settledFills <= counts.fills;
}

function mapRows(rows: z.infer<typeof rowSchema>[]): StudyMatchRow[] {
  return rows.map((row) => ({
    fixtureId: row.fixtureId,
    kickoffUtc: new Date(row.kickoffTsMs).toISOString(),
    selectedLine: row.selectedLineMilli / 1_000,
    signals: row.signals,
    fills: row.fills,
    fillRate: row.fillRate,
    meanHalfSpreadBps: row.meanHalfSpreadBps,
    meanSlippageBps: row.meanSlippageBps,
    grossClvBps: row.grossClvBps,
    netClvBps: row.netClvBps,
    settlementPnlMicroUsd: row.settlementPnlMicroUsd,
    netReturnBps: row.netReturnBps
  }));
}

function probabilityToOneDecimalBps(value: number): number {
  return Math.round(value * 100_000) / 10;
}

function buildCorrectedHistoricalCandidate(
  source: z.infer<typeof correctedHistoricalCandidateSourceSchema>
): CorrectedHistoricalCandidate {
  const candidate = source.forwardPaperCandidate;
  const interval = candidate.matchClusteredNetClv95;
  const meanNetAfterCostProxyBps = probabilityToOneDecimalBps(candidate.meanNetAfterCostProxy);
  const low = probabilityToOneDecimalBps(interval.low);
  const high = probabilityToOneDecimalBps(interval.high);
  if (meanNetAfterCostProxyBps !== 132.7 || low !== 14.3 || high !== 243.9 || interval.low >= interval.high) {
    throw new Error("Study projection failed closed: corrected v4 aggregate evidence changed");
  }
  return {
    schemaVersion: 4,
    generatedAt: source.generatedAt,
    protocolId: source.protocolId,
    configurationHash: source.configurationHash,
    status: candidate.status,
    registration: candidate.registration,
    activeStudy: false,
    detector: candidate.detector,
    marketFamily: "Full-time totals",
    trainingNormalizedCases: candidate.trainingNormalizedCases,
    heldoutNormalizedCases: candidate.heldoutNormalizedCases,
    heldoutFixtures: candidate.heldoutFixtures,
    costProxyBps: 100,
    meanNetAfterCostProxyBps,
    matchClustered95Bps: {
      iterations: interval.iterations,
      cluster: "fixture",
      low,
      high
    },
    evidenceClass: "historical_sampled_price_signal_research",
    executionEvidence: "not_established_no_historical_bid_ask_or_depth",
    executable: false,
    claimBoundary: "Forward paper review candidate only; not alpha, profitability, fill proof, or permission to trade."
  };
}

export async function buildStudySnapshot(repoRoot: string): Promise<StudySnapshot> {
  const [artifactValue, universeValue, correctedCandidateValue] = await Promise.all([
    readFile(resolve(repoRoot, "data/paper/reports/current.json"), "utf8").then(JSON.parse),
    readFile(resolve(repoRoot, "data/research/paper-fixture-universe.json"), "utf8").then(JSON.parse),
    readFile(resolve(repoRoot, "data/research/historical-gate-study-causal-economic-v4.json"), "utf8").then(JSON.parse)
  ]);
  const artifact = artifactSchema.parse(artifactValue);
  const universe = universeSchema.parse(universeValue);
  const correctedCandidateSource = correctedHistoricalCandidateSourceSchema.parse(correctedCandidateValue);
  const bounty = artifact.lanes.bounty;
  const longRun = artifact.lanes.longRun;
  if (artifact.protocolVersion !== "paper-study-v1-2026-07-12") {
    throw new Error("Study projection failed closed: no registered corrected protocol is approved for public display");
  }
  if (
    bounty.report.lane !== "bounty" ||
    bounty.report.status !== "exploratory" ||
    longRun.report.lane !== "long_run" ||
    longRun.report.status === "exploratory" ||
    artifact.configHash !== bounty.initialization.configHash ||
    artifact.configHash !== longRun.initialization.configHash ||
    artifact.protocolVersion !== longRun.initialization.protocolVersion ||
    artifact.fixtureUniverseGeneratedAt !== universe.generatedAt ||
    !validCounts(bounty.report.counts) ||
    !validCounts(longRun.report.counts)
  ) {
    throw new Error("Study projection failed closed: paper artifact identity or counts changed");
  }
  if (
    Object.values(bounty.report.counts).some((value) => value !== 0) ||
    Object.values(longRun.report.counts).some((value) => value !== 0)
  ) {
    throw new Error("Study projection failed closed: invalidated v1 ledger contains observations");
  }
  const sealed = longRun.report.status === "sealed";
  if (sealed && (longRun.report.stoppingRuleMet || longRun.report.rows !== null || longRun.report.endpoints !== null || longRun.report.guardrails !== null)) {
    throw new Error("Study projection failed closed: sealed long-run results leaked");
  }
  if (!sealed && (!longRun.report.stoppingRuleMet || longRun.report.rows === null || longRun.report.guardrails === null)) {
    throw new Error("Study projection failed closed: long-run results opened before the stopping rule");
  }
  if (longRun.report.status === "accept") {
    const endpoints = longRun.report.endpoints;
    const guardrails = longRun.report.guardrails;
    if (
      endpoints === null || guardrails === null ||
      endpoints.meanNetClvBps <= 0 || endpoints.netClvInterval.low <= 0 ||
      endpoints.meanSettlementPnlMicroUsd <= 0 ||
      endpoints.meanNetClvBps <= endpoints.noTradeBaselineClvBps ||
      endpoints.meanNetClvBps <= endpoints.randomDirectionControlClvBps ||
      !guardrails.fillRatePassed || !guardrails.slippagePassed || !guardrails.drawdownPassed ||
      !guardrails.selectedDepthComplete || !guardrails.closeMarksComplete || !guardrails.settlementComplete
    ) {
      throw new Error("Study projection failed closed: ACCEPT does not satisfy the registered decision rule");
    }
  }

  const frozen = longRun.initialization.frozenConfig;
  const evaluation = frozen.evaluation;
  const results: StudySnapshot["results"] = sealed ? {
    visibility: "sealed",
    rows: null,
    endpoints: null,
    guardrails: null
  } : {
    visibility: "open",
    rows: mapRows(longRun.report.rows!),
    endpoints: longRun.report.endpoints as StudyEndpoints | null,
    guardrails: longRun.report.guardrails as StudyGuardrails
  };

  return {
    schemaVersion: 2,
    snapshotId: STUDY_SNAPSHOT_ID,
    generatedAt: artifact.generatedAt,
    mode: "offline_artifact",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    protocol: {
      version: artifact.protocolVersion,
      status: "invalidated_suspended",
      active: false,
      configHash: artifact.configHash,
      startedAt: longRun.initialization.startedAt,
      candidate: {
        detector: "CONSENSUS_MOVE",
        marketFamily: "Full-time totals only",
        moveAbsZ: frozen.detector.consensusMoveAbsZ,
        cusumThresholdBps: frozen.detector.consensusCusumThreshold * 10_000,
        minimumGapBps: frozen.detector.consensusMinimumRawGap * 10_000,
        minimumUpdates: frozen.detector.consensusMinimumUpdates,
        selector: "Closest to even",
        minimumCoveragePoints: frozen.selector.minimumCoveragePoints,
        maximumDistanceFromEven: frozen.selector.maximumDistanceFromEven
      },
      evaluation: {
        unitOfAnalysis: "match",
        primaryEndpoint: "Executable CLV net of measured costs",
        minimumFilledMatches: evaluation.minimumFilledMatches,
        minimumFills: evaluation.minimumFills,
        targetMatches: 30,
        bootstrapIterations: evaluation.bootstrapIterations,
        bootstrapSeed: evaluation.bootstrapSeed,
        randomDirectionControl: "Seeded matched-cost sign flip"
      },
      risk: {
        bankrollMicroUsd: frozen.risk.bankrollMicroUsd,
        perTradeStakeMicroUsd: frozen.risk.perTradeStakeMicroUsd,
        aggregateExposureMicroUsd: frozen.risk.aggregateExposureMicroUsd,
        drawdownStopMicroUsd: frozen.risk.drawdownStopMicroUsd
      },
      guardrailThresholds: {
        minimumFillRate: evaluation.minimumFillRate,
        maximumMeanSlippageBps: evaluation.maximumMeanSlippageBps,
        maximumDrawdownMicroUsd: evaluation.maximumDrawdownMicroUsd,
        selectedDepthRequired: true
      }
    },
    lanes: {
      bounty: {
        label: "Preserved v1 bounty ledger",
        status: "exploratory",
        statusLabel: "Exploratory",
        reason: bounty.report.reason,
        counts: bounty.report.counts,
        chain: bounty.chain,
        canSatisfyGate: false
      },
      longRun: {
        label: "Preserved v1 long-run ledger",
        status: longRun.report.status as StudySnapshot["lanes"]["longRun"]["status"],
        statusLabel: "V1 suspended",
        reason: longRun.report.reason,
        counts: longRun.report.counts,
        stoppingRuleMet: longRun.report.stoppingRuleMet,
        chain: longRun.chain,
        canSatisfyGate: false
      }
    },
    results,
    correctedHistoricalCandidate: buildCorrectedHistoricalCandidate(correctedCandidateSource),
    syntheticProof: {
      label: "Synthetic full-lifecycle proving fixture",
      path: "/artifacts/dashboard/synthetic-decision-receipt.json",
      lifecycleStatus: "filled_settled",
      offlineVerified: true,
      performanceUse: "excluded_synthetic",
      externalCalls: 0,
      solanaAnchorStatus: "not_submitted",
      explanation: "Closed-world production-component demo; separate from historical evidence and excluded from every performance claim."
    },
    fixtureUniverse: {
      generatedAt: universe.generatedAt,
      evidenceFixtures: universe.summary.fixtures,
      pairedBookReplays: universe.summary.pairedBookReplays,
      executableBookReplays: universe.summary.executableBookReplays,
      signalResearchOnly: universe.summary.signalResearchOnly,
      longRunEligible: universe.summary.longRunEligible
    },
    decisionRules: {
      accept: [
        "Inactive v1 rule retained for audit only; it cannot produce an acceptance decision.",
        "Mean net executable CLV is positive and its match-clustered 95% CI lower bound is above zero.",
        "Mean settlement P&L is positive and the strategy beats no-trade and random-direction baselines.",
        "Every registered fill, slippage, drawdown, and depth guardrail holds."
      ],
      reject: [
        "V1 was invalidated before observations because upstream selection used future information.",
        "The executable CLV interval touches or falls below zero.",
        "Any registered guardrail fails materially."
      ],
      inconclusive: [
        "No active study exists; corrected v2 remains an engineering candidate until Deborah registers it.",
        "Capture-only evidence cannot authorize model spend, paper admission, or real money."
      ]
    },
    publicDataPolicy: {
      derivedOnly: true,
      txlineProbabilityDisplay: "bucketed_movement_only",
      txlineMovementBucketBps: TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
      credentialsRequired: false,
      walletControlsExposed: false
    }
  };
}

export async function buildStudyDashboardResponse(repoRoot: string): Promise<StudyApiResponse> {
  return { data: await buildStudySnapshot(repoRoot) };
}
