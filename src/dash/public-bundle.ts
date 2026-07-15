import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { stableJson } from "../domain/json.js";
import {
  CASEBOOK_SNAPSHOT_ID,
  COMMAND_SNAPSHOT_ID,
  SPAIN_BELGIUM_MATCHROOM_ID,
  STUDY_SNAPSHOT_ID,
  TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS
} from "./public-contract.js";

export const SPAIN_BELGIUM_API_PATH = `/api/v1/matchroom/${SPAIN_BELGIUM_MATCHROOM_ID}` as const;
export const COMMAND_API_PATH = "/api/v1/command" as const;
export const CASEBOOK_API_PATH = "/api/v1/casebook" as const;
export const STUDY_API_PATH = "/api/v1/study" as const;
export const PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR = "public/artifacts/dashboard" as const;
export const PUBLIC_DASHBOARD_BUNDLE_ID = "samaritan-dashboard-public-v1" as const;
export const PUBLIC_DASHBOARD_CANONICALIZATION = "samaritan-stable-json-v1" as const;
export const PUBLIC_DASHBOARD_BUNDLE_HASH_DOMAIN = "samaritan.dashboard-public-bundle/v1" as const;
export const PUBLIC_SYNTHETIC_RECEIPT_FILENAME = "synthetic-decision-receipt.json" as const;

export const PUBLIC_DASHBOARD_FILES = [
  { apiPath: COMMAND_API_PATH, file: "command.json", snapshotId: COMMAND_SNAPSHOT_ID },
  { apiPath: CASEBOOK_API_PATH, file: "casebook.json", snapshotId: CASEBOOK_SNAPSHOT_ID },
  { apiPath: STUDY_API_PATH, file: "study.json", snapshotId: STUDY_SNAPSHOT_ID },
  { apiPath: SPAIN_BELGIUM_API_PATH, file: "matchroom-spain-belgium.json", snapshotId: SPAIN_BELGIUM_MATCHROOM_ID }
] as const;

export type PublicDashboardApiPath = typeof PUBLIC_DASHBOARD_FILES[number]["apiPath"];
export type PublicDashboardFilename = typeof PUBLIC_DASHBOARD_FILES[number]["file"];

const isoSchema = z.string().datetime();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const probabilitySchema = z.number().finite().min(0).max(1);
const finiteSchema = z.number().finite();
const nonnegativeIntegerSchema = z.number().int().nonnegative().safe();

export const publicDataPolicySchema = z.object({
  derivedOnly: z.literal(true),
  txlineProbabilityDisplay: z.literal("bucketed_movement_only"),
  txlineMovementBucketBps: z.literal(TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS),
  credentialsRequired: z.literal(false),
  walletControlsExposed: z.literal(false)
}).strict();

const publicBookPointSchema = z.object({
  offsetMs: z.number().int(),
  bestBid: probabilitySchema,
  bestAsk: probabilitySchema,
  spread: probabilitySchema,
  available: z.literal(true)
}).strict();

const replayStateSchema = z.object({
  id: z.enum(["pre", "goal", "post"]),
  label: z.string().min(1),
  offsetMs: z.number().int(),
  observedAt: isoSchema,
  consensusMoveFromBaselineBps: z.number().int().multipleOf(TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS),
  bestBid: probabilitySchema,
  bestAsk: probabilitySchema,
  spread: probabilitySchema,
  conclusionTitle: z.string().min(1),
  conclusionBody: z.string().min(1),
  decisionExplanation: z.string().min(1)
}).strict();

const decisionStageSchema = z.object({
  id: z.enum(["signal", "evidence", "pass", "execution"]),
  label: z.string().min(1),
  detail: z.string().min(1),
  status: z.enum(["complete", "passed", "locked"]),
  timingLabel: z.string().min(1)
}).strict();

const evidenceRowSchema = z.object({
  replayStateId: z.enum(["pre", "goal", "post"]),
  observedAt: isoSchema,
  offsetLabel: z.string().min(1),
  source: z.enum(["Polymarket", "TXLine", "Samaritan"]),
  observation: z.string().min(1),
  bestAsk: probabilitySchema,
  assessment: z.enum(["Moved first", "Pass", "No trade"])
}).strict();

const matchSchema = z.object({
  fixtureId: z.string().min(1),
  eventSlug: z.string().min(1),
  competition: z.literal("World Cup"),
  stage: z.literal("Captured fixture"),
  kickoffUtc: isoSchema,
  originalMatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  home: z.object({ name: z.string().min(1), code: z.string().regex(/^[A-Z0-9]{3}$/) }).strict(),
  away: z.object({ name: z.string().min(1), code: z.string().regex(/^[A-Z0-9]{3}$/) }).strict(),
  scoreAtCursor: z.object({ home: nonnegativeIntegerSchema, away: nonnegativeIntegerSchema }).strict(),
  goalOrdinal: z.number().int().positive().safe(),
  clockSeconds: nonnegativeIntegerSchema,
  clockLabel: z.string().min(1)
}).strict();

const decisionSchema = z.object({
  disposition: z.literal("no_trade"),
  semanticStatus: z.literal("disciplined_pass"),
  label: z.literal("No trade"),
  primaryReason: z.literal("Market moved before signal"),
  explanation: z.string().min(1),
  capitalMovedMicros: z.literal(0),
  ordersPlaced: z.literal(0),
  walletAccessed: z.literal(false),
  stages: z.array(decisionStageSchema).length(4)
}).strict();

const proofSchema = z.object({
  captureStatus: z.literal("verified"),
  identityParity: z.literal(true),
  identityHash: hashSchema,
  headHash: hashSchema,
  canonicalEvents: z.number().int().positive().safe(),
  replayMode: z.literal("capture-order-per-source"),
  feedOutageCount: nonnegativeIntegerSchema,
  feedDowntimeMs: nonnegativeIntegerSchema,
  maximumFeedDowntimeMs: nonnegativeIntegerSchema,
  gateCases: nonnegativeIntegerSchema,
  movedBeforeTxlineCases: nonnegativeIntegerSchema,
  noMaterialRepriceCases: nonnegativeIntegerSchema,
  cleanStaleWindows: z.literal(0),
  corpusCommitment: hashSchema,
  corpusAssurance: z.literal("local_file_sha256_not_capture_manifest_membership")
}).strict();

export const matchroomApiResponseSchema = z.object({
  data: z.object({
    schemaVersion: z.literal(2),
    snapshotId: z.literal(SPAIN_BELGIUM_MATCHROOM_ID),
    caseId: z.string().regex(/^FX-[A-Za-z0-9_-]+-G\d{2}-(?:MR|TG-\d+)$/),
    casebookCaseCount: z.number().int().positive().safe(),
    generatedAt: isoSchema,
    mode: z.literal("captured_replay"),
    executionMode: z.literal("paper"),
    realMoneyGate: z.literal("closed"),
    tradeable: z.literal(false),
    match: matchSchema,
    market: z.object({
      family: z.literal("match_result"),
      outcome: z.enum(["home", "draw", "away"]),
      label: z.string().min(1),
      period: z.literal("90 minutes plus stoppage time"),
      mappingStatus: z.literal("research_only")
    }).strict(),
    replay: z.object({
      firstSeenAt: isoSchema,
      firstSeenLatencyMs: z.number().int(),
      firstMaterialMoveLatencyMs: z.number().int(),
      preTriggerMarketMoveBps: z.number().int(),
      activeStateId: z.literal("goal"),
      states: z.array(replayStateSchema).length(3),
      chart: z.array(publicBookPointSchema).min(1),
      availabilityGaps: z.array(z.object({
        startedAt: isoSchema,
        endedAt: isoSchema,
        durationMs: nonnegativeIntegerSchema
      }).strict())
    }).strict(),
    decision: decisionSchema,
    evidence: z.array(evidenceRowSchema).length(3),
    proof: proofSchema,
    publicDataPolicy: publicDataPolicySchema
  }).strict()
}).strict().superRefine((value, context) => {
  if (value.data.casebookCaseCount !== value.data.proof.gateCases) {
    context.addIssue({
      code: "custom",
      message: "Matchroom case count must reconcile with the gate corpus"
    });
  }
});

const commandCaseSchema = z.object({
  caseId: z.string().min(1),
  matchroomId: z.literal(SPAIN_BELGIUM_MATCHROOM_ID),
  fixtureId: z.string().min(1),
  fixtureLabel: z.string().min(1),
  home: matchSchema.shape.home,
  away: matchSchema.shape.away,
  occurredAt: isoSchema,
  marketLabel: z.string().min(1),
  marketOutcomeLabel: z.string().min(1),
  candidateLabel: z.literal("Live-lane gate readout"),
  disposition: z.literal("no_trade"),
  dispositionLabel: z.string().min(1),
  reason: z.string().min(1),
  evidenceStatus: z.literal("verified_replay"),
  preTriggerMarketMoveBps: z.number().int(),
  consensusMoveFromBaselineBps: z.number().int().multipleOf(TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS),
  bestAsk: probabilitySchema,
  canonicalEvents: z.number().int().positive().safe(),
  capitalMovedMicros: z.literal(0),
  ordersPlaced: z.literal(0),
  walletAccessed: z.literal(false)
}).strict();

export const commandApiResponseSchema = z.object({
  data: z.object({
    schemaVersion: z.literal(2),
    snapshotId: z.literal(COMMAND_SNAPSHOT_ID),
    generatedAt: isoSchema,
    mode: z.literal("offline_artifact"),
    executionMode: z.literal("paper"),
    realMoneyGate: z.literal("closed"),
    tradeable: z.literal(false),
    system: z.object({
      posture: z.enum(["standing_by", "capture_window", "awaiting_verification"]),
      label: z.string().min(1),
      detail: z.string().min(1),
      feeds: z.array(z.object({
        id: z.enum(["txline", "polymarket", "decision_ledger", "replay_proof"]),
        label: z.string().min(1),
        status: z.enum(["scheduled", "running", "complete", "failed", "unknown", "initialized", "verified"]),
        statusLabel: z.string().min(1),
        detail: z.string().min(1)
      }).strict()).length(4)
    }).strict(),
    featuredCase: commandCaseSchema.extend({
      scoreLabel: z.string().min(1),
      scoreAtCursor: matchSchema.shape.scoreAtCursor,
      clockSeconds: nonnegativeIntegerSchema,
      clockLabel: z.string().min(1),
      conclusion: z.string().min(1),
      identityParity: z.literal(true),
      chart: z.array(publicBookPointSchema).min(1)
    }).strict(),
    fixtureSchedule: z.array(z.object({
      fixtureId: z.string().min(1),
      home: z.object({ name: z.string().min(1), code: z.string().min(2) }).strict(),
      away: z.object({ name: z.string().min(1), code: z.string().min(2) }).strict(),
      kickoffUtc: isoSchema,
      captureStartUtc: isoSchema,
      captureEndUtc: isoSchema,
      signalCutoffUtc: isoSchema,
      eventSlug: z.string().min(1),
      phase: z.enum(["scheduled", "running", "complete", "failed", "unknown"]),
      statusLabel: z.string().min(1),
      statusDetail: z.string().min(1),
      statusSource: z.enum(["analysis_manifest", "supervisor_status", "reviewed_config", "none"]),
      statusUpdatedAt: isoSchema.nullable(),
      terminalEvidence: z.object({
        windowStartUtc: isoSchema,
        windowEndUtc: isoSchema,
        synchronizedStartUtc: isoSchema,
        synchronizedEndUtc: isoSchema,
        streamCount: z.literal(3)
      }).strict().nullable(),
      identityStatus: z.literal("exact_match_confirmed"),
      captureOnly: z.literal(true),
      tradeable: z.literal(false)
    }).strict()).min(1),
    recentCases: z.array(commandCaseSchema).length(1),
    additionalCaseState: z.object({
      status: z.literal("waiting_for_eligible_capture"),
      label: z.literal("No active study can admit cases"),
      detail: z.string().min(1)
    }).strict(),
    study: z.object({
      protocolVersion: z.string().min(1),
      protocolStatus: z.literal("invalidated_suspended"),
      configHash: hashSchema,
      startedAt: isoSchema,
      status: z.literal("suspended"),
      statusLabel: z.literal("V1 suspended"),
      filledMatches: z.literal(0),
      requiredFilledMatches: z.number().int().positive(),
      fills: z.literal(0),
      requiredFills: z.number().int().positive(),
      bountyStatus: z.literal("exploratory"),
      stoppingRuleMet: z.literal(false),
      reason: z.string().min(1)
    }).strict(),
    proof: z.object({
      replayIdentityParity: z.literal(true),
      replayIdentityHash: hashSchema,
      canonicalEvents: z.number().int().positive().safe(),
      bountyLedgerValid: z.literal(true),
      bountyLedgerRows: z.number().int().positive(),
      longRunLedgerValid: z.literal(true),
      longRunLedgerRows: z.number().int().positive(),
      evidenceFixtures: nonnegativeIntegerSchema,
      pairedBookReplays: nonnegativeIntegerSchema,
      signalResearchOnly: nonnegativeIntegerSchema
    }).strict(),
    sourceFreshness: z.object({
      paperReportGeneratedAt: isoSchema,
      fixtureUniverseGeneratedAt: isoSchema,
      replayGeneratedAt: isoSchema
    }).strict(),
    publicDataPolicy: publicDataPolicySchema
  }).strict()
}).strict();

const casebookSummarySchema = z.object({
  caseId: z.string().regex(/^FX-[A-Za-z0-9_-]+-G\d{2}-(?:MR|TG-\d+)$/),
  matchroomId: z.literal(SPAIN_BELGIUM_MATCHROOM_ID).nullable(),
  selectedExemplar: z.boolean(),
  goalOrdinal: z.number().int().positive().safe(),
  goalClockSeconds: nonnegativeIntegerSchema,
  occurredAt: isoSchema,
  fixtureId: z.string().min(1),
  fixtureLabel: z.string().min(1),
  homeCode: z.string().min(2),
  awayCode: z.string().min(2),
  marketFamily: z.enum(["Match result", "Full-time total"]),
  marketLabel: z.string().min(1),
  lineMilli: z.number().int().nullable(),
  classification: z.enum(["polymarket_moved_before_txline", "no_material_reprice_in_window"]),
  detector: z.literal("STALE_QUOTE_FEASIBILITY"),
  disposition: z.string().min(1),
  executionOutcome: z.string().min(1),
  evidenceLane: z.literal("Research only"),
  source: z.literal("Captured replay"),
  verificationStatus: z.literal("Internally reconciled"),
  reason: z.string().min(1),
  preTriggerMarketMoveBps: z.number().int()
}).strict();

export const casebookApiResponseSchema = z.object({
  data: z.object({
    schemaVersion: z.literal(3),
    snapshotId: z.literal(CASEBOOK_SNAPSHOT_ID),
    generatedAt: isoSchema,
    mode: z.literal("offline_artifact"),
    executionMode: z.literal("paper"),
    realMoneyGate: z.literal("closed"),
    tradeable: z.literal(false),
    statistics: z.object({
      totalCases: z.number().int().positive().safe(),
      noTradeCases: z.number().int().positive().safe(),
      executedCases: z.literal(0),
      reconciledCases: z.number().int().positive().safe(),
      capitalMovedMicros: z.literal(0)
    }).strict(),
    corpus: z.object({
      unit: z.literal("goal_market_feasibility_observation"),
      coverage: z.literal("all_reported_goal_market_cases"),
      captureReplays: z.literal(1),
      fixtureCount: z.literal(1),
      goalEvents: z.number().int().positive().safe(),
      marketEventCases: z.number().int().positive().safe(),
      movedBeforeTxlineCases: nonnegativeIntegerSchema,
      noMaterialRepriceCases: nonnegativeIntegerSchema,
      cleanStaleWindows: z.literal(0),
      commitment: hashSchema,
      assurance: z.literal("local_file_sha256_not_capture_manifest_membership"),
      selectedExemplar: z.object({
        caseId: z.string().min(1),
        policy: z.literal("earliest_pretrigger_match_result_then_largest_pretrigger_ask_move"),
        detail: z.string().min(1)
      }).strict()
    }).strict(),
    filterOptions: z.object({
      fixtures: z.array(z.string()),
      marketFamilies: z.array(z.string()),
      detectors: z.array(z.string()),
      dispositions: z.array(z.string()),
      executionOutcomes: z.array(z.string()),
      evidenceLanes: z.array(z.string()),
      sources: z.array(z.string())
    }).strict(),
    cases: z.array(casebookSummarySchema).min(1),
    selectedCase: z.object({
      summary: casebookSummarySchema,
      match: matchSchema,
      decision: decisionSchema,
      lifecycle: z.array(decisionStageSchema).length(4),
      evidenceReadout: z.object({
        consensusMoveFromBaselineBps: z.number().int().multipleOf(TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS),
        bestBid: probabilitySchema,
        bestAsk: probabilitySchema,
        spread: probabilitySchema,
        preTriggerMarketMoveBps: z.number().int(),
        movementConclusion: z.literal("Polymarket moved before TXLine")
      }).strict(),
      analysis: z.object({
        thesisStatus: z.literal("not_requested"),
        thesisReason: z.string().min(1),
        invalidation: z.string().min(1),
        costStatus: z.literal("not_applicable"),
        costMicros: z.literal(0),
        costReason: z.string().min(1)
      }).strict(),
      evidence: z.array(evidenceRowSchema).length(3),
      proof: proofSchema
    }).strict(),
    nextEvidence: z.object({
      status: z.literal("waiting_for_verified_capture"),
      label: z.string().min(1),
      detail: z.string().min(1)
    }).strict(),
    publicDataPolicy: publicDataPolicySchema
  }).strict()
}).strict().superRefine((value, context) => {
  const { data } = value;
  const selectedRows = data.cases.filter((item) => item.selectedExemplar);
  if (
    data.statistics.totalCases !== data.cases.length ||
    data.statistics.noTradeCases !== data.cases.length ||
    data.statistics.reconciledCases !== data.cases.length ||
    data.corpus.marketEventCases !== data.cases.length ||
    data.corpus.movedBeforeTxlineCases + data.corpus.noMaterialRepriceCases !== data.cases.length ||
    selectedRows.length !== 1 ||
    selectedRows[0]?.caseId !== data.corpus.selectedExemplar.caseId ||
    data.selectedCase.summary.caseId !== data.corpus.selectedExemplar.caseId ||
    data.selectedCase.summary.matchroomId !== SPAIN_BELGIUM_MATCHROOM_ID ||
    data.cases.some((item) => item.selectedExemplar !== (item.matchroomId !== null))
  ) {
    context.addIssue({
      code: "custom",
      message: "Casebook corpus counts or exemplar identity do not reconcile"
    });
  }
  for (const item of data.cases) {
    const lineIsValid = item.marketFamily === "Match result" ? item.lineMilli === null : item.lineMilli !== null;
    if (!lineIsValid) {
      context.addIssue({ code: "custom", message: `Casebook market line is invalid for ${item.caseId}` });
    }
  }
});

const studyCountsSchema = z.object({
  matches: nonnegativeIntegerSchema,
  signals: nonnegativeIntegerSchema,
  filledMatches: z.literal(0),
  fills: z.literal(0),
  settledFills: z.literal(0)
}).strict();

const studyIntervalSchema = z.object({
  iterations: z.number().int().positive(),
  seed: z.number().int(),
  matches: z.number().int().positive(),
  signals: z.number().int().positive(),
  low: finiteSchema,
  median: finiteSchema,
  high: finiteSchema
}).strict();

const studyEndpointsSchema = z.object({
  meanNetClvBps: finiteSchema,
  netClvInterval: studyIntervalSchema,
  meanSettlementPnlMicroUsd: z.number().int(),
  settlementPnlInterval: studyIntervalSchema,
  noTradeBaselineClvBps: z.literal(0),
  randomDirectionControlClvBps: finiteSchema,
  fractionSettledMatchesNetPositive: probabilitySchema
}).strict();

const studyGuardrailsSchema = z.object({
  fillRate: probabilitySchema,
  fillRatePassed: z.boolean(),
  meanSlippageBps: finiteSchema.nonnegative().nullable(),
  slippagePassed: z.boolean(),
  maxDrawdownMicroUsd: nonnegativeIntegerSchema,
  drawdownPassed: z.boolean(),
  selectedDepthComplete: z.boolean(),
  closeMarksComplete: z.boolean(),
  settlementComplete: z.boolean()
}).strict();

const studyRowSchema = z.object({
  fixtureId: z.string().min(1),
  kickoffUtc: isoSchema,
  selectedLine: finiteSchema,
  signals: nonnegativeIntegerSchema,
  fills: nonnegativeIntegerSchema,
  fillRate: probabilitySchema,
  meanHalfSpreadBps: finiteSchema.nonnegative().nullable(),
  meanSlippageBps: finiteSchema.nonnegative().nullable(),
  grossClvBps: finiteSchema.nullable(),
  netClvBps: finiteSchema.nullable(),
  settlementPnlMicroUsd: z.number().int().nullable(),
  netReturnBps: finiteSchema.nullable()
}).strict();

export const correctedHistoricalCandidateSchema = z.object({
  schemaVersion: z.literal(4),
  generatedAt: isoSchema,
  protocolId: z.literal("historical-gate-causal-economic-v4-2026-07-14"),
  configurationHash: hashSchema,
  status: z.literal("historical_signal_candidate_for_forward_paper_review"),
  registration: z.literal("engineering_candidate_unregistered"),
  activeStudy: z.literal(false),
  detector: z.literal("CONSENSUS_MOVE"),
  marketFamily: z.literal("Full-time totals"),
  trainingNormalizedCases: z.literal(135),
  heldoutNormalizedCases: z.literal(38),
  heldoutFixtures: z.literal(18),
  costProxyBps: z.literal(100),
  meanNetAfterCostProxyBps: z.literal(132.7),
  matchClustered95Bps: z.object({
    iterations: z.literal(10_000),
    cluster: z.literal("fixture"),
    low: z.literal(14.3),
    high: z.literal(243.9)
  }).strict(),
  evidenceClass: z.literal("historical_sampled_price_signal_research"),
  executionEvidence: z.literal("not_established_no_historical_bid_ask_or_depth"),
  executable: z.literal(false),
  claimBoundary: z.literal("Forward paper review candidate only; not alpha, profitability, fill proof, or permission to trade.")
}).strict();

export const syntheticProofReceiptSchema = z.object({
  label: z.literal("Synthetic full-lifecycle proving fixture"),
  path: z.literal("/artifacts/dashboard/synthetic-decision-receipt.json"),
  lifecycleStatus: z.literal("filled_settled"),
  offlineVerified: z.literal(true),
  performanceUse: z.literal("excluded_synthetic"),
  externalCalls: z.literal(0),
  solanaAnchorStatus: z.literal("not_submitted"),
  explanation: z.literal("Closed-world production-component demo; separate from historical evidence and excluded from every performance claim.")
}).strict();

export const studyApiResponseSchema = z.object({
  data: z.object({
    schemaVersion: z.literal(2),
    snapshotId: z.literal(STUDY_SNAPSHOT_ID),
    generatedAt: isoSchema,
    mode: z.literal("offline_artifact"),
    executionMode: z.literal("paper"),
    realMoneyGate: z.literal("closed"),
    tradeable: z.literal(false),
    protocol: z.object({
      version: z.string().min(1),
      status: z.literal("invalidated_suspended"),
      active: z.literal(false),
      configHash: hashSchema,
      startedAt: isoSchema,
      candidate: z.object({
        detector: z.literal("CONSENSUS_MOVE"),
        marketFamily: z.literal("Full-time totals only"),
        moveAbsZ: finiteSchema.positive(),
        cusumThresholdBps: finiteSchema.positive(),
        minimumGapBps: finiteSchema.positive(),
        minimumUpdates: z.number().int().positive(),
        selector: z.literal("Closest to even"),
        minimumCoveragePoints: z.number().int().positive(),
        maximumDistanceFromEven: probabilitySchema
      }).strict(),
      evaluation: z.object({
        unitOfAnalysis: z.literal("match"),
        primaryEndpoint: z.literal("Executable CLV net of measured costs"),
        minimumFilledMatches: z.number().int().positive(),
        minimumFills: z.number().int().positive(),
        targetMatches: z.literal(30),
        bootstrapIterations: z.number().int().positive(),
        bootstrapSeed: z.number().int(),
        randomDirectionControl: z.literal("Seeded matched-cost sign flip")
      }).strict(),
      risk: z.object({
        bankrollMicroUsd: z.number().int().positive(),
        perTradeStakeMicroUsd: z.number().int().positive(),
        aggregateExposureMicroUsd: z.number().int().positive(),
        drawdownStopMicroUsd: z.number().int().positive()
      }).strict(),
      guardrailThresholds: z.object({
        minimumFillRate: probabilitySchema,
        maximumMeanSlippageBps: finiteSchema.positive(),
        maximumDrawdownMicroUsd: z.number().int().positive(),
        selectedDepthRequired: z.literal(true)
      }).strict()
    }).strict(),
    lanes: z.object({
      bounty: z.object({
        label: z.literal("Preserved v1 bounty ledger"),
        status: z.literal("exploratory"),
        statusLabel: z.literal("Exploratory"),
        reason: z.string().min(1),
        counts: studyCountsSchema,
        chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: hashSchema }).strict(),
        canSatisfyGate: z.literal(false)
      }).strict(),
      longRun: z.object({
        label: z.literal("Preserved v1 long-run ledger"),
        status: z.enum(["sealed", "accept", "reject", "inconclusive"]),
        statusLabel: z.string().min(1),
        reason: z.string().min(1),
        counts: studyCountsSchema,
        stoppingRuleMet: z.boolean(),
        chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: hashSchema }).strict(),
        canSatisfyGate: z.literal(false)
      }).strict()
    }).strict(),
    results: z.discriminatedUnion("visibility", [
      z.object({ visibility: z.literal("sealed"), rows: z.null(), endpoints: z.null(), guardrails: z.null() }).strict(),
      z.object({
        visibility: z.literal("open"),
        rows: z.array(studyRowSchema),
        endpoints: studyEndpointsSchema.nullable(),
        guardrails: studyGuardrailsSchema
      }).strict()
    ]),
    correctedHistoricalCandidate: correctedHistoricalCandidateSchema,
    syntheticProof: syntheticProofReceiptSchema,
    fixtureUniverse: z.object({
      generatedAt: isoSchema,
      evidenceFixtures: nonnegativeIntegerSchema,
      pairedBookReplays: nonnegativeIntegerSchema,
      executableBookReplays: nonnegativeIntegerSchema,
      signalResearchOnly: nonnegativeIntegerSchema,
      longRunEligible: nonnegativeIntegerSchema
    }).strict(),
    decisionRules: z.object({
      accept: z.array(z.string().min(1)).min(1),
      reject: z.array(z.string().min(1)).min(1),
      inconclusive: z.array(z.string().min(1)).min(1)
    }).strict(),
    publicDataPolicy: publicDataPolicySchema
  }).strict()
}).strict();

const manifestEntrySchema = z.object({
  apiPath: z.enum([COMMAND_API_PATH, CASEBOOK_API_PATH, STUDY_API_PATH, SPAIN_BELGIUM_API_PATH]),
  file: z.enum(["command.json", "casebook.json", "study.json", "matchroom-spain-belgium.json"]),
  snapshotId: z.enum([COMMAND_SNAPSHOT_ID, CASEBOOK_SNAPSHOT_ID, STUDY_SNAPSHOT_ID, SPAIN_BELGIUM_MATCHROOM_ID]),
  sha256: hashSchema,
  bytes: z.number().int().positive().safe()
}).strict();

export type PublicDashboardManifestEntry = z.infer<typeof manifestEntrySchema>;

const manifestDownloadSchema = z.object({
  id: z.literal("synthetic-decision-receipt"),
  file: z.literal(PUBLIC_SYNTHETIC_RECEIPT_FILENAME),
  mediaType: z.literal("application/json"),
  sha256: hashSchema,
  bytes: z.number().int().positive().safe(),
  synthetic: z.literal(true),
  performanceUse: z.literal("excluded_synthetic")
}).strict();

export type PublicDashboardManifestDownload = z.infer<typeof manifestDownloadSchema>;

export const publicDashboardManifestSchema = z.object({
  schemaVersion: z.literal(1),
  bundleId: z.literal(PUBLIC_DASHBOARD_BUNDLE_ID),
  generatedAt: isoSchema,
  canonicalization: z.literal(PUBLIC_DASHBOARD_CANONICALIZATION),
  bundleSha256: hashSchema,
  files: z.array(manifestEntrySchema).length(PUBLIC_DASHBOARD_FILES.length),
  downloads: z.array(manifestDownloadSchema).length(1),
  publicDataPolicy: publicDataPolicySchema
}).strict();

export type PublicDashboardManifest = z.infer<typeof publicDashboardManifestSchema>;

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function publicDashboardBundleHash(
  generatedAt: string,
  entries: readonly PublicDashboardManifestEntry[],
  downloads: readonly PublicDashboardManifestDownload[]
): string {
  return sha256(`${PUBLIC_DASHBOARD_BUNDLE_HASH_DOMAIN}\n${stableJson({
    schemaVersion: 1,
    bundleId: PUBLIC_DASHBOARD_BUNDLE_ID,
    generatedAt,
    canonicalization: PUBLIC_DASHBOARD_CANONICALIZATION,
    files: entries,
    downloads,
    publicDataPolicy: {
      derivedOnly: true,
      txlineProbabilityDisplay: "bucketed_movement_only",
      txlineMovementBucketBps: TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
      credentialsRequired: false,
      walletControlsExposed: false
    }
  })}`);
}

export function parsePublicDashboardResponse(pathname: PublicDashboardApiPath, value: unknown): unknown {
  if (pathname === COMMAND_API_PATH) return commandApiResponseSchema.parse(value);
  if (pathname === CASEBOOK_API_PATH) return casebookApiResponseSchema.parse(value);
  if (pathname === STUDY_API_PATH) return studyApiResponseSchema.parse(value);
  return matchroomApiResponseSchema.parse(value);
}

export function parsePublicDashboardManifest(value: unknown): PublicDashboardManifest {
  const manifest = publicDashboardManifestSchema.parse(value);
  for (const [index, definition] of PUBLIC_DASHBOARD_FILES.entries()) {
    const entry = manifest.files[index];
    if (
      !entry ||
      entry.apiPath !== definition.apiPath ||
      entry.file !== definition.file ||
      entry.snapshotId !== definition.snapshotId
    ) {
      throw new Error(`Public dashboard manifest entry ${index} does not match the frozen route map`);
    }
  }
  const expectedBundleHash = publicDashboardBundleHash(manifest.generatedAt, manifest.files, manifest.downloads);
  if (manifest.bundleSha256 !== expectedBundleHash) {
    throw new Error("Public dashboard manifest bundle hash is invalid");
  }
  return manifest;
}

export type FrozenDashboardResponse = {
  body: string;
  manifest: PublicDashboardManifest;
};

export async function readFrozenDashboardResponse(
  repoRoot: string,
  pathname: PublicDashboardApiPath
): Promise<FrozenDashboardResponse> {
  const bundleRoot = resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(resolve(bundleRoot, "manifest.json"), "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Frozen dashboard manifest is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = parsePublicDashboardManifest(manifestValue);
  const entry = manifest.files.find((candidate) => candidate.apiPath === pathname);
  if (!entry) throw new Error(`Frozen dashboard manifest has no entry for ${pathname}`);
  const body = await readFile(resolve(bundleRoot, entry.file), "utf8");
  if (Buffer.byteLength(body, "utf8") !== entry.bytes) {
    throw new Error(`Frozen dashboard artifact byte count changed for ${entry.file}`);
  }
  if (sha256(body) !== entry.sha256) {
    throw new Error(`Frozen dashboard artifact hash changed for ${entry.file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error(`Frozen dashboard artifact is invalid JSON: ${entry.file}`);
  }
  const response = parsePublicDashboardResponse(pathname, parsed) as { data?: { snapshotId?: unknown } };
  if (response.data?.snapshotId !== entry.snapshotId) {
    throw new Error(`Frozen dashboard artifact snapshot identity changed for ${entry.file}`);
  }
  return { body, manifest };
}
