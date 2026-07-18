import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  PAPER_STUDY_DETECTOR_CONFIG,
  PAPER_STUDY_TOTAL_SELECTOR_CONFIG
} from "../config/paper-study.js";
import { PAPER_STUDY_EVALUATION_CANDIDATE } from "../metrics/paper-study.js";
import { APPROVED_PAPER_RISK_CONFIG } from "../risk/paper.js";
import {
  FORWARD_PAPER_CONFIG_HASH,
  FORWARD_PAPER_PROTOCOL_ID,
  FORWARD_PAPER_REGISTERED_AT,
  STUDY_SNAPSHOT_ID,
  TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
  type CorrectedHistoricalCandidate,
  type StudyApiResponse,
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
  protocolStatus: z.literal("registered").optional(),
  realMoneyGate: z.literal("closed"),
  startedAtTsMs: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  registration: z.object({
    protocolId: z.literal(FORWARD_PAPER_PROTOCOL_ID),
    status: z.literal("registered"),
    registeredBy: z.literal("Deborah"),
    registeredAt: z.literal(FORWARD_PAPER_REGISTERED_AT),
    scope: z.literal("forward_paper_only"),
    realMoneyGate: z.literal("closed")
  }).strict().optional(),
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
}).passthrough();

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
    sourceRegistrationAtGeneration: candidate.registration,
    activeStudyAtGeneration: false,
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
    claimBoundary: "Historical sampled-price evidence justified review only; the separate v2 registration does not turn it into alpha, fill proof, profitability, or permission for real money."
  };
}

export async function buildStudySnapshot(repoRoot: string): Promise<StudySnapshot> {
  const [artifactValue, universeValue, registeredArtifactValue, registeredUniverseValue, correctedCandidateValue] = await Promise.all([
    readFile(resolve(repoRoot, "data/paper/reports/current.json"), "utf8").then(JSON.parse),
    readFile(resolve(repoRoot, "data/research/paper-fixture-universe.json"), "utf8").then(JSON.parse),
    readFile(resolve(repoRoot, "data/paper/v2/reports/current.json"), "utf8").then(JSON.parse),
    readFile(resolve(repoRoot, "data/paper/v2/fixture-universe.json"), "utf8").then(JSON.parse),
    readFile(resolve(repoRoot, "data/research/historical-gate-study-causal-economic-v4.json"), "utf8").then(JSON.parse)
  ]);
  const artifact = artifactSchema.parse(artifactValue);
  const universe = universeSchema.parse(universeValue);
  const registeredArtifact = artifactSchema.parse(registeredArtifactValue);
  const registeredUniverse = universeSchema.parse(registeredUniverseValue);
  const correctedCandidateSource = correctedHistoricalCandidateSourceSchema.parse(correctedCandidateValue);
  const bounty = artifact.lanes.bounty;
  const longRun = artifact.lanes.longRun;
  if (artifact.protocolVersion !== "paper-study-v1-2026-07-12") {
    throw new Error("Study projection failed closed: preserved v1 audit identity changed");
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
  if (
    longRun.report.status !== "sealed" ||
    longRun.report.stoppingRuleMet ||
    longRun.report.rows !== null ||
    longRun.report.endpoints !== null ||
    longRun.report.guardrails !== null
  ) {
    throw new Error("Study projection failed closed: invalidated v1 long-run evidence is not sealed");
  }

  const registeredBounty = registeredArtifact.lanes.bounty;
  const registeredLongRun = registeredArtifact.lanes.longRun;
  const registeredAtTsMs = Date.parse(FORWARD_PAPER_REGISTERED_AT);
  if (
    registeredArtifact.protocolVersion !== FORWARD_PAPER_PROTOCOL_ID ||
    registeredArtifact.configHash !== FORWARD_PAPER_CONFIG_HASH ||
    registeredArtifact.fixtureUniverseGeneratedAt !== registeredUniverse.generatedAt ||
    registeredBounty.initialization.protocolVersion !== FORWARD_PAPER_PROTOCOL_ID ||
    registeredLongRun.initialization.protocolVersion !== FORWARD_PAPER_PROTOCOL_ID ||
    registeredBounty.initialization.protocolStatus !== "registered" ||
    registeredLongRun.initialization.protocolStatus !== "registered" ||
    registeredBounty.initialization.registration?.registeredAt !== FORWARD_PAPER_REGISTERED_AT ||
    registeredLongRun.initialization.registration?.registeredAt !== FORWARD_PAPER_REGISTERED_AT ||
    registeredBounty.initialization.configHash !== FORWARD_PAPER_CONFIG_HASH ||
    registeredLongRun.initialization.configHash !== FORWARD_PAPER_CONFIG_HASH ||
    registeredBounty.initialization.startedAtTsMs < registeredAtTsMs ||
    registeredLongRun.initialization.startedAtTsMs < registeredAtTsMs ||
    registeredBounty.initialization.startedAt !== new Date(registeredBounty.initialization.startedAtTsMs).toISOString() ||
    registeredLongRun.initialization.startedAt !== new Date(registeredLongRun.initialization.startedAtTsMs).toISOString() ||
    !validCounts(registeredBounty.report.counts) ||
    !validCounts(registeredLongRun.report.counts)
  ) {
    throw new Error("Study projection failed closed: registered v2 report does not match the frozen forward protocol");
  }
  if (
    registeredLongRun.report.status !== "sealed" ||
    registeredLongRun.report.stoppingRuleMet ||
    registeredLongRun.report.rows !== null ||
    registeredLongRun.report.endpoints !== null ||
    registeredLongRun.report.guardrails !== null
  ) {
    throw new Error("Study projection failed closed: v2 crossed its stopping gate without a refreshed public result contract");
  }

  const results: StudySnapshot["results"] = {
    visibility: "sealed",
    rows: null,
    endpoints: null,
    guardrails: null
  };
  const qualifyingCounts = registeredLongRun.report.counts;
  const observationStatus = qualifyingCounts.signals === 0
    ? "awaiting_fresh_evidence" as const
    : "collecting_forward_evidence" as const;

  return {
    schemaVersion: 3,
    snapshotId: STUDY_SNAPSHOT_ID,
    generatedAt: registeredArtifact.generatedAt,
    mode: "offline_artifact",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    protocol: {
      version: FORWARD_PAPER_PROTOCOL_ID,
      status: "registered",
      activity: "active_forward_paper",
      active: true,
      registeredAt: FORWARD_PAPER_REGISTERED_AT,
      configHash: FORWARD_PAPER_CONFIG_HASH,
      realMoneyGate: "closed",
      observationStatus,
      evidencePolicy: "fresh_forward_only",
      qualifyingCounts,
      candidate: {
        detector: "CONSENSUS_MOVE",
        marketFamily: "Full-time totals only",
        moveAbsZ: PAPER_STUDY_DETECTOR_CONFIG.consensusMoveAbsZ,
        cusumThresholdBps: PAPER_STUDY_DETECTOR_CONFIG.consensusCusumThreshold * 10_000,
        minimumGapBps: PAPER_STUDY_DETECTOR_CONFIG.consensusMinimumRawGap * 10_000,
        minimumUpdates: PAPER_STUDY_DETECTOR_CONFIG.consensusMinimumUpdates,
        selector: "Closest to even",
        minimumCoveragePoints: PAPER_STUDY_TOTAL_SELECTOR_CONFIG.minimumCoveragePoints,
        maximumDistanceFromEven: PAPER_STUDY_TOTAL_SELECTOR_CONFIG.maximumDistanceFromEven
      },
      evaluation: {
        unitOfAnalysis: "match",
        primaryEndpoint: "Executable CLV net of measured costs",
        minimumFilledMatches: PAPER_STUDY_EVALUATION_CANDIDATE.minimumFilledMatches,
        minimumFills: PAPER_STUDY_EVALUATION_CANDIDATE.minimumFills,
        targetMatches: 30,
        bootstrapIterations: PAPER_STUDY_EVALUATION_CANDIDATE.bootstrapIterations,
        bootstrapSeed: PAPER_STUDY_EVALUATION_CANDIDATE.bootstrapSeed,
        randomDirectionControl: "Seeded matched-cost sign flip"
      },
      risk: {
        bankrollMicroUsd: APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd,
        perTradeStakeMicroUsd: APPROVED_PAPER_RISK_CONFIG.perTradeStakeMicroUsd,
        aggregateExposureMicroUsd: APPROVED_PAPER_RISK_CONFIG.aggregateExposureMicroUsd,
        drawdownStopMicroUsd: APPROVED_PAPER_RISK_CONFIG.drawdownStopMicroUsd
      },
      guardrailThresholds: {
        minimumFillRate: PAPER_STUDY_EVALUATION_CANDIDATE.minimumFillRate,
        maximumMeanSlippageBps: PAPER_STUDY_EVALUATION_CANDIDATE.maximumMeanSlippageBps,
        maximumDrawdownMicroUsd: PAPER_STUDY_EVALUATION_CANDIDATE.maximumDrawdownMicroUsd,
        selectedDepthRequired: true
      }
    },
    historicalV1: {
      protocolVersion: artifact.protocolVersion,
      status: "invalidated_suspended",
      active: false,
      invalidatedBeforeObservations: true,
      configHash: artifact.configHash,
      startedAt: longRun.initialization.startedAt,
      lanes: {
        bounty: {
          label: "Preserved invalidated v1 bounty ledger",
          sourceStatus: "exploratory",
          statusLabel: "V1 invalidated",
          reason: bounty.report.reason,
          counts: bounty.report.counts,
          chain: bounty.chain,
          canSatisfyGate: false
        },
        longRun: {
          label: "Preserved invalidated v1 long-run ledger",
          sourceStatus: "sealed",
          statusLabel: "V1 invalidated",
          reason: longRun.report.reason,
          counts: longRun.report.counts,
          stoppingRuleMet: false,
          chain: longRun.chain,
          canSatisfyGate: false
        }
      },
      results: { visibility: "sealed", rows: null, endpoints: null, guardrails: null }
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
      generatedAt: registeredUniverse.generatedAt,
      evidenceFixtures: registeredUniverse.summary.fixtures,
      pairedBookReplays: registeredUniverse.summary.pairedBookReplays,
      executableBookReplays: registeredUniverse.summary.executableBookReplays,
      signalResearchOnly: registeredUniverse.summary.signalResearchOnly,
      longRunEligible: registeredUniverse.summary.longRunEligible
    },
    decisionRules: {
      accept: [
        "Only fresh observations at or after v2 registration may count toward a decision.",
        "Mean net executable CLV is positive and its match-clustered 95% CI lower bound is above zero.",
        "Mean settlement P&L is positive and the strategy beats no-trade and random-direction baselines.",
        "Every registered fill, slippage, drawdown, and depth guardrail holds."
      ],
      reject: [
        "The executable CLV interval touches or falls below zero.",
        "The strategy fails to beat no-trade or the seeded random-direction control.",
        "Any registered guardrail fails materially."
      ],
      inconclusive: [
        "The registered v2 study has not yet reached 20 filled matches and 40 fills from fresh evidence.",
        "Capture-only evidence cannot authorize model spend, paper admission, or real money."
      ]
    },
    publicDataPolicy: {
      derivedOnly: true,
      txlineProbabilityDisplay: "bucketed_movement_only",
      txlineMovementBucketBps: TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
      txlineFixtureIdentifiersExposed: false,
      credentialsRequired: false,
      walletControlsExposed: false
    }
  };
}

export async function buildStudyDashboardResponse(repoRoot: string): Promise<StudyApiResponse> {
  return { data: await buildStudySnapshot(repoRoot) };
}
