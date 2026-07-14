import { z } from "zod";
import { tradeThesisSchema, triageDecisionSchema } from "../agents/contracts.js";
import { stableJson, type JsonValue } from "../domain/json.js";
import {
  DECISION_LEDGER_HASH_SCHEMA_V2,
  type DecisionEventKind,
  type DecisionLedger,
  type DecisionLedgerEntry
} from "../store/decision-ledger.js";
import {
  DECISION_RECEIPT_CANONICALIZATION,
  DECISION_RECEIPT_HASH_DOMAIN,
  DECISION_RECEIPT_SCHEMA_VERSION,
  decisionReceiptBodySchema,
  decisionReceiptSchema,
  hashDecisionReceiptBody,
  receiptAgentRunSchema,
  receiptReferenceHash,
  receiptSolanaAnchorSchema,
  receiptSourceEvidenceSchema,
  sha256,
  verifyDecisionReceipt,
  type DecisionReceipt,
  type ReceiptAgentRun,
  type ReceiptSolanaAnchor,
  type ReceiptSourceEvidence
} from "./decision-receipt-schema.js";

const timestampSchema = z.number().int().nonnegative().safe();
const sha256TextSchema = z.string().regex(/^[0-9a-f]{64}$/);
const moneySchema = z.number().int().nonnegative().safe();
const probabilitySchema = z.number().finite().min(0).max(1);

const rawMarketSchema = z.object({
  family: z.enum(["match_result", "total_goals"]),
  period: z.enum(["full_time", "first_half", "extra_time", "other"]),
  lineMilli: z.number().int().safe().nullable(),
  key: z.string().min(1)
}).strict();

const rawSignalSchema = z.object({
  signalId: z.string().min(1),
  kind: z.enum(["CONSENSUS_MOVE", "XMARKET_DIVERGENCE", "FADER_CANDIDATE"]),
  detectedAtTsMs: timestampSchema,
  observedAtTsMs: timestampSchema,
  fixtureId: z.string().min(1),
  market: rawMarketSchema,
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  direction: z.enum(["buy", "sell"]),
  eligibility: z.enum(["research_only", "pretrade_review_required"]),
  reason: z.string().min(1),
  evidence: z.object({
    consensusProbability: probabilitySchema,
    polymarketProbability: probabilitySchema,
    consensusVelocity: z.number().finite().nullable(),
    consensusZScore: z.number().finite().nullable(),
    polymarketVelocity: z.number().finite().nullable(),
    polymarketZScore: z.number().finite().nullable(),
    cusumUp: z.number().finite(),
    cusumDown: z.number().finite(),
    rawGap: z.number().finite(),
    gapBasis: z.enum(["live_book", "sampled_history_proxy"]),
    persistenceMs: z.number().int().nonnegative().safe(),
    mappingStatus: z.string().min(1).nullable(),
    scoreContextActions: z.array(z.string())
  }).strict()
}).strict();

const signalPayloadSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  signal: rawSignalSchema
}).strict();

const analysisPayloadSchema = z.object({
  signalSourceTsMs: timestampSchema,
  signalObservedTsMs: timestampSchema,
  decisionLatencyMs: z.number().int().positive().safe(),
  readyAtTsMs: timestampSchema,
  venuePlacementDelayMs: z.number().int().positive().safe(),
  orderEligibleAtTsMs: timestampSchema,
  recommendation: z.enum(["paper_trade", "no_trade"])
}).strict();

const riskPayloadSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("veto"),
    reasons: z.array(z.string().min(1)).min(1)
  }).strict(),
  z.object({
    decision: z.literal("approve"),
    stakeMicroUsd: moneySchema,
    limitProbability: probabilitySchema,
    realMoneyGate: z.literal("closed")
  }).strict()
]);

const intentPayloadSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  caseId: z.string().min(1),
  signalId: z.string().min(1),
  fixtureId: z.string().min(1),
  marketKey: z.string().min(1),
  outcome: z.string().min(1),
  direction: z.enum(["buy", "sell"]),
  stakeMicroUsd: moneySchema,
  limitProbability: probabilitySchema,
  availableShares: z.number().finite().nonnegative()
}).strict();

const feePayloadSchema = z.object({
  source: z.literal("polymarket_clob_market_info"),
  conditionId: z.string().min(1),
  feesEnabled: z.boolean(),
  takerFeeRate: z.number().finite().nonnegative(),
  feeCurveExponent: z.number().finite().positive(),
  takerOnly: z.boolean(),
  minimumOrderSize: z.number().finite().positive(),
  minimumTickSize: z.number().finite().positive(),
  fetchedAtTsMs: timestampSchema
}).strict();

const fillPayloadSchema = z.object({
  adapter: z.literal("paper"),
  status: z.enum(["filled", "partial", "no_fill"]),
  reason: z.string().min(1).nullable(),
  assetId: z.string().min(1),
  conditionId: z.string().min(1),
  direction: z.enum(["buy", "sell"]),
  requestedStakeMicroUsd: moneySchema,
  grossMicroUsd: moneySchema,
  feeMicroUsd: moneySchema,
  netConsiderationMicroUsd: moneySchema,
  filledShares: z.number().finite().nonnegative(),
  averagePrice: probabilitySchema.nullable(),
  bestPrice: probabilitySchema.nullable(),
  halfSpreadBps: z.number().finite().nonnegative().nullable(),
  executableDepthUsd: z.number().finite().nonnegative(),
  slippageProbabilityBps: z.number().finite().nonnegative().nullable(),
  bookObservedTsMs: timestampSchema,
  feeParameters: feePayloadSchema
}).strict();

const closePayloadSchema = z.object({
  cutoffTsMs: timestampSchema,
  markedAtTsMs: timestampSchema,
  bookSourceTsMs: timestampSchema,
  bookObservedTsMs: timestampSchema,
  closeBid: probabilitySchema,
  closeAsk: probabilitySchema,
  closeMidpoint: probabilitySchema,
  grossMidpointClvBps: z.number().finite(),
  netMidpointClvBps: z.number().finite(),
  executableLiquidationClvBps: z.number().finite()
}).strict();

const settlementPayloadSchema = z.object({
  settledAtTsMs: timestampSchema,
  won: z.boolean(),
  payoutMicroUsd: moneySchema,
  pnlMicroUsd: z.number().int().safe(),
  returnBps: z.number().finite(),
  entryBrier: z.number().finite().min(0).max(1)
}).strict();

const positionPayloadSchema = z.object({
  caseId: z.string().min(1),
  lane: z.enum(["bounty", "long_run"]),
  signalId: z.string().min(1),
  fixtureId: z.string().min(1),
  marketKey: z.string().min(1),
  conditionId: z.string().min(1),
  assetId: z.string().min(1),
  outcome: z.string().min(1),
  selectedLineMilli: z.number().int().safe(),
  openedAtTsMs: timestampSchema,
  filledShares: z.number().finite().positive(),
  averageEntryPrice: probabilitySchema,
  entryGrossMicroUsd: moneySchema,
  entryFeeMicroUsd: moneySchema,
  entryCostMicroUsd: moneySchema,
  fillStatus: z.enum(["filled", "partial"]),
  entryHalfSpreadBps: z.number().finite().nonnegative(),
  entrySlippageBps: z.number().finite().nonnegative(),
  selectedDepthUsd: z.number().finite().nonnegative(),
  status: z.literal("open"),
  closeMark: z.null(),
  settlement: z.null()
}).strict();

const terminalPayloadSchema = z.object({
  status: z.enum(["dropped", "no_trade", "vetoed", "filled", "partial", "no_fill"]),
  reason: z.string().min(1),
  decisionLatencyMs: z.number().int().positive().safe().optional()
}).strict();

type BuildInput = {
  codeVersion: string;
  codeSha256: string;
  configSha256: string;
};

type ProvenanceInput = {
  evidenceClass: "synthetic_proving_fixture" | "captured_paper_case";
  synthetic: boolean;
  performanceUse: "excluded_synthetic" | "excluded_unregistered" | "subject_to_registered_evaluation";
  label: string;
};

export type DecisionReceiptGenerationContext = {
  generatedAtTsMs: number;
  provenance: ProvenanceInput;
  build: BuildInput;
  sourceEvidence: ReceiptSourceEvidence[];
  agentRuns: ReceiptAgentRun[];
  executionBookEvidenceRefSha256?: string;
  closeBookEvidenceRefSha256?: string;
  settlementEvidenceRefSha256?: string;
  solanaAnchor?: ReceiptSolanaAnchor | null;
};

const receiptKinds = new Set<DecisionEventKind>([
  "signal_received",
  "triage_decision",
  "thesis_submitted",
  "analysis_completed",
  "risk_verdict",
  "execution_intent",
  "paper_execution",
  "case_terminal",
  "position_opened",
  "position_closed",
  "position_settled"
]);

function one(entries: DecisionLedgerEntry[], kind: DecisionEventKind): DecisionLedgerEntry | null {
  const matching = entries.filter((entry) => entry.kind === kind);
  if (matching.length > 1) throw new Error(`Decision receipt lifecycle repeats ${kind}`);
  return matching[0] ?? null;
}

function required(entries: DecisionLedgerEntry[], kind: DecisionEventKind): DecisionLedgerEntry {
  const entry = one(entries, kind);
  if (!entry) throw new Error(`Decision receipt lifecycle is missing ${kind}`);
  return entry;
}

function reference(namespace: string, value: string | number): string {
  return receiptReferenceHash(namespace, value);
}

function bucketMovementBps(value: number): number {
  const bucketed = Math.round(value / 25) * 25;
  return Object.is(bucketed, -0) ? 0 : bucketed;
}

function lifecycleStatus(input: {
  triage: z.infer<typeof triageDecisionSchema>;
  thesis: z.infer<typeof tradeThesisSchema> | null;
  risk: z.infer<typeof riskPayloadSchema> | null;
  fill: z.infer<typeof fillPayloadSchema> | null;
  position: z.infer<typeof positionPayloadSchema> | null;
  close: z.infer<typeof closePayloadSchema> | null;
  settlement: z.infer<typeof settlementPayloadSchema> | null;
}): DecisionReceipt["lifecycle"]["finalStatus"] {
  if (input.triage.decision === "drop") return "dropped";
  if (input.thesis?.recommendation === "no_trade") return "no_trade";
  if (input.risk?.decision === "veto") return "vetoed";
  if (input.fill?.status === "no_fill") return "no_fill";
  if (!input.fill || !input.position || !["filled", "partial"].includes(input.fill.status)) {
    throw new Error("Executed decision receipt requires a fill/no-fill result and any filled position");
  }
  const suffix = input.settlement ? "settled" : input.close ? "marked" : "open";
  return `${input.fill.status}_${suffix}` as DecisionReceipt["lifecycle"]["finalStatus"];
}

function entryCommitment(entry: DecisionLedgerEntry): DecisionReceipt["ledger"]["caseEntries"][number] {
  if (entry.hashSchemaVersion !== DECISION_LEDGER_HASH_SCHEMA_V2) {
    throw new Error(`Decision receipt refuses non-v2 ledger entry ${entry.entryId}`);
  }
  if (!receiptKinds.has(entry.kind)) throw new Error(`Unsupported receipt event kind: ${entry.kind}`);
  return {
    sequence: entry.sequence,
    kind: entry.kind as DecisionReceipt["ledger"]["caseEntries"][number]["kind"],
    atTsMs: entry.atTsMs,
    insertedAtMs: entry.insertedAtMs,
    entryIdSha256: reference("decision_entry_id", entry.entryId),
    payloadSha256: sha256(stableJson(entry.payload)),
    previousHash: entry.previousHash,
    entryHash: entry.entryHash,
    hashSchemaVersion: DECISION_LEDGER_HASH_SCHEMA_V2
  };
}

function selectedSource(
  evidence: ReceiptSourceEvidence[],
  evidenceRefSha256: string | undefined,
  role: ReceiptSourceEvidence["role"]
): ReceiptSourceEvidence {
  if (!evidenceRefSha256) throw new Error(`Decision receipt context lacks ${role} evidence reference`);
  const source = evidence.find((candidate) => candidate.evidenceRefSha256 === evidenceRefSha256);
  if (!source || source.role !== role) throw new Error(`Decision receipt ${role} evidence reference is invalid`);
  return source;
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/**
 * Generates a public, licence-safe receipt from a locally verified, all-v2
 * decision ledger. Raw source payloads never leave the ledger: only their
 * caller-supplied SHA-256 commitments and derived signal metrics are exposed.
 */
export function generateDecisionReceipt(input: {
  ledger: DecisionLedger;
  caseId: string;
  context: DecisionReceiptGenerationContext;
}): DecisionReceipt {
  const verification = input.ledger.verifyChain();
  if (
    verification.rows === 0 ||
    verification.legacyV1Rows !== 0 ||
    verification.v2Rows !== verification.rows ||
    verification.hashSchemaVersions.length !== 1 ||
    verification.hashSchemaVersions[0] !== DECISION_LEDGER_HASH_SCHEMA_V2
  ) {
    throw new Error("Decision receipts require a verified, entirely v2 decision ledger");
  }
  const allEntries = input.ledger.entries();
  const studyEntries = allEntries.filter((entry) => entry.kind === "study_initialized");
  if (studyEntries.length !== 1 || studyEntries[0]!.hashSchemaVersion !== DECISION_LEDGER_HASH_SCHEMA_V2) {
    throw new Error("Decision receipts require exactly one v2 study initialization commitment");
  }
  const studyInitialization = z.object({ configHash: sha256TextSchema }).passthrough()
    .parse(studyEntries[0]!.payload);
  if (studyInitialization.configHash !== input.context.build.configSha256) {
    throw new Error("Receipt config hash does not match the ledgered study initialization");
  }
  const entries = input.ledger.entries(input.caseId);
  if (entries.length === 0) throw new Error(`No decision lifecycle exists for ${input.caseId}`);
  if (entries.some((entry) => !receiptKinds.has(entry.kind))) {
    throw new Error("Decision receipt case contains unsupported lifecycle events");
  }
  if (entries.some((entry) => entry.hashSchemaVersion !== DECISION_LEDGER_HASH_SCHEMA_V2)) {
    throw new Error("Decision receipt lifecycle must use ledger hash schema v2 only");
  }

  const signalEntry = required(entries, "signal_received");
  const triageEntry = required(entries, "triage_decision");
  const terminalEntry = required(entries, "case_terminal");
  const signalPayload = signalPayloadSchema.parse(signalEntry.payload);
  const signal = signalPayload.signal;
  const triage = triageDecisionSchema.parse(triageEntry.payload);
  const thesisEntry = one(entries, "thesis_submitted");
  const thesis = thesisEntry ? tradeThesisSchema.parse(thesisEntry.payload) : null;
  const analysisEntry = one(entries, "analysis_completed");
  const analysis = analysisEntry ? analysisPayloadSchema.parse(analysisEntry.payload) : null;
  const riskEntry = one(entries, "risk_verdict");
  const risk = riskEntry ? riskPayloadSchema.parse(riskEntry.payload) : null;
  const intentEntry = one(entries, "execution_intent");
  const intent = intentEntry ? intentPayloadSchema.parse(intentEntry.payload) : null;
  const executionEntry = one(entries, "paper_execution");
  const fill = executionEntry ? fillPayloadSchema.parse(executionEntry.payload) : null;
  const terminal = terminalPayloadSchema.parse(terminalEntry.payload);
  const positionEntry = one(entries, "position_opened");
  const position = positionEntry ? positionPayloadSchema.parse(positionEntry.payload) : null;
  const closeEntry = one(entries, "position_closed");
  const close = closeEntry ? closePayloadSchema.parse(closeEntry.payload) : null;
  const settlementEntry = one(entries, "position_settled");
  const settlement = settlementEntry ? settlementPayloadSchema.parse(settlementEntry.payload) : null;

  const status = lifecycleStatus({ triage, thesis, risk, fill, position, close, settlement });
  const signalRefSha256 = reference("signal", signal.signalId);
  const fixtureRefSha256 = reference("fixture", signal.fixtureId);
  const marketRefSha256 = reference("market", signal.market.key);
  const lineRefSha256 = signal.market.lineMilli === null
    ? null
    : reference("market_line_milli", signal.market.lineMilli);
  const sources = input.context.sourceEvidence.map((source) => receiptSourceEvidenceSchema.parse(source));
  const signalSourceRefs = sources
    .filter((source) => source.role === "signal")
    .map((source) => source.evidenceRefSha256);
  const agentRuns = input.context.agentRuns
    .map((run) => receiptAgentRunSchema.parse(run))
    .sort((left, right) => (left.stage === "triage" ? -1 : 1) - (right.stage === "triage" ? -1 : 1));
  const executionSource = fill
    ? selectedSource(sources, input.context.executionBookEvidenceRefSha256, "execution")
    : null;
  const closeSource = close
    ? selectedSource(sources, input.context.closeBookEvidenceRefSha256, "close")
    : null;
  const settlementSource = settlement
    ? selectedSource(sources, input.context.settlementEvidenceRefSha256, "settlement")
    : null;

  if (executionSource && executionSource.observedAtTsMs !== fill!.bookObservedTsMs) {
    throw new Error("Execution evidence observation time does not match the ledgered paper fill");
  }
  if (closeSource && (
    closeSource.sourceTsMs !== close!.bookSourceTsMs ||
    closeSource.observedAtTsMs !== close!.bookObservedTsMs
  )) throw new Error("Close evidence timestamps do not match the ledgered close mark");
  if (settlementSource && settlementSource.observedAtTsMs !== settlement!.settledAtTsMs) {
    throw new Error("Settlement evidence time does not match the ledgered settlement");
  }

  const ledgerHash = (entry: DecisionLedgerEntry | null): string | null => entry?.entryHash ?? null;
  const orderedEntries = [...entries].sort((left, right) => left.sequence - right.sequence);
  const bodyCandidate = {
    schemaVersion: DECISION_RECEIPT_SCHEMA_VERSION,
    receiptType: "samaritan_decision_receipt" as const,
    receiptId: reference("decision_receipt", `${input.caseId}:${verification.headHash}`),
    generatedAtTsMs: input.context.generatedAtTsMs,
    provenance: input.context.provenance,
    disclosure: {
      policy: "hashes_and_derived_signals_only" as const,
      rawTxlineFieldsIncluded: false as const
    },
    build: input.context.build,
    sourceEvidence: sources,
    agents: {
      runs: agentRuns,
      totalActualCostNanoUsd: agentRuns.reduce((sum, run) => sum + run.actualCostNanoUsd, 0)
    },
    lifecycle: {
      finalStatus: status,
      orderedEventKinds: orderedEntries.map((entry) => entry.kind),
      signal: {
        signalRefSha256,
        fixtureRefSha256,
        marketRefSha256,
        lineRefSha256,
        detector: signal.kind,
        sourceTsMs: signal.detectedAtTsMs,
        observedAtTsMs: signal.observedAtTsMs,
        marketFamily: signal.market.family,
        marketPeriod: signal.market.period,
        outcome: signal.outcome,
        direction: signal.direction,
        eligibility: signal.eligibility,
        derivedEvidence: {
          txlineMovementBucketBps: 25 as const,
          consensusVelocityBucketBps: signal.evidence.consensusVelocity === null
            ? null
            : bucketMovementBps(signal.evidence.consensusVelocity * 10_000),
          consensusZScore: signal.evidence.consensusZScore,
          polymarketVelocityBucketBps: signal.evidence.polymarketVelocity === null
            ? null
            : bucketMovementBps(signal.evidence.polymarketVelocity * 10_000),
          polymarketZScore: signal.evidence.polymarketZScore,
          cusumUpScore: signal.evidence.cusumUp,
          cusumDownScore: signal.evidence.cusumDown,
          relativeValueDirection: signal.evidence.rawGap > 0
            ? "consensus_above_venue" as const
            : signal.evidence.rawGap < 0 ? "venue_above_consensus" as const : "aligned" as const,
          gapBasis: signal.evidence.gapBasis,
          persistenceMs: signal.evidence.persistenceMs,
          mappingStatus: signal.evidence.mappingStatus,
          scoreContextActionCount: signal.evidence.scoreContextActions.length
        },
        sourceEvidenceRefs: signalSourceRefs,
        ledgerEntryHash: signalEntry.entryHash
      },
      triage: { ...triage, ledgerEntryHash: triageEntry.entryHash },
      thesis: thesis && thesisEntry ? {
        schemaVersion: thesis.schemaVersion,
        signalRefSha256: reference("signal", thesis.signalId),
        fixtureRefSha256: reference("fixture", thesis.fixtureId),
        marketRefSha256: reference("market", thesis.marketKey),
        outcome: thesis.outcome,
        direction: thesis.direction,
        recommendation: thesis.recommendation,
        disclosure: "private_payload_sha256_commitment" as const,
        thesisPayloadSha256: sha256(stableJson(thesis)),
        submittedAtTsMs: thesis.submittedAtTsMs,
        expiresAtTsMs: thesis.expiresAtTsMs,
        analystModel: thesis.analystModel,
        ledgerEntryHash: thesisEntry.entryHash
      } : null,
      analysis: analysis && analysisEntry ? {
        ...analysis,
        ledgerEntryHash: analysisEntry.entryHash
      } : null,
      risk: risk && riskEntry ? risk.decision === "approve" ? {
        decision: risk.decision,
        reasons: [],
        stakeMicroUsd: risk.stakeMicroUsd,
        limitPolicy: "deterministic_private_fair_value_boundary" as const,
        realMoneyGate: risk.realMoneyGate,
        ledgerEntryHash: riskEntry.entryHash
      } : {
        decision: risk.decision,
        reasons: risk.reasons,
        stakeMicroUsd: null,
        limitPolicy: null,
        realMoneyGate: null,
        ledgerEntryHash: riskEntry.entryHash
      } : null,
      intent: intent && intentEntry ? {
        lane: intent.lane,
        signalRefSha256: reference("signal", intent.signalId),
        fixtureRefSha256: reference("fixture", intent.fixtureId),
        marketRefSha256: reference("market", intent.marketKey),
        outcome: intent.outcome,
        direction: intent.direction,
        stakeMicroUsd: intent.stakeMicroUsd,
        limitPolicy: "deterministic_private_fair_value_boundary" as const,
        availableShares: intent.availableShares,
        ledgerEntryHash: intentEntry.entryHash
      } : null,
      execution: fill && executionEntry && executionSource ? {
        adapter: fill.adapter,
        status: fill.status,
        reason: fill.reason,
        assetRefSha256: reference("polymarket_asset", fill.assetId),
        conditionRefSha256: reference("polymarket_condition", fill.conditionId),
        direction: fill.direction,
        requestedStakeMicroUsd: fill.requestedStakeMicroUsd,
        grossMicroUsd: fill.grossMicroUsd,
        feeMicroUsd: fill.feeMicroUsd,
        netConsiderationMicroUsd: fill.netConsiderationMicroUsd,
        filledShares: fill.filledShares,
        averagePrice: fill.averagePrice,
        bestPrice: fill.bestPrice,
        halfSpreadBps: fill.halfSpreadBps,
        executableDepthUsd: fill.executableDepthUsd,
        slippageProbabilityBps: fill.slippageProbabilityBps,
        bookSourceTsMs: executionSource.sourceTsMs,
        bookObservedTsMs: fill.bookObservedTsMs,
        bookEvidenceRefSha256: executionSource.evidenceRefSha256,
        feeMetadataRefSha256: sha256(stableJson(fill.feeParameters)),
        ledgerEntryHash: executionEntry.entryHash
      } : null,
      position: position && positionEntry ? {
        lane: position.lane,
        signalRefSha256: reference("signal", position.signalId),
        fixtureRefSha256: reference("fixture", position.fixtureId),
        marketRefSha256: reference("market", position.marketKey),
        conditionRefSha256: reference("polymarket_condition", position.conditionId),
        assetRefSha256: reference("polymarket_asset", position.assetId),
        outcome: position.outcome,
        lineRefSha256: reference("market_line_milli", position.selectedLineMilli),
        openedAtTsMs: position.openedAtTsMs,
        filledShares: position.filledShares,
        averageEntryPrice: position.averageEntryPrice,
        entryGrossMicroUsd: position.entryGrossMicroUsd,
        entryFeeMicroUsd: position.entryFeeMicroUsd,
        entryCostMicroUsd: position.entryCostMicroUsd,
        fillStatus: position.fillStatus,
        entryHalfSpreadBps: position.entryHalfSpreadBps,
        entrySlippageBps: position.entrySlippageBps,
        selectedDepthUsd: position.selectedDepthUsd,
        ledgerEntryHash: positionEntry.entryHash
      } : null,
      close: close && closeEntry && closeSource ? {
        ...close,
        bookEvidenceRefSha256: closeSource.evidenceRefSha256,
        ledgerEntryHash: closeEntry.entryHash
      } : null,
      settlement: settlement && settlementEntry && settlementSource ? {
        ...settlement,
        resolutionEvidenceRefSha256: settlementSource.evidenceRefSha256,
        ledgerEntryHash: settlementEntry.entryHash
      } : null,
      terminal: {
        status: terminal.status,
        reason: terminal.reason,
        decisionLatencyMs: terminal.decisionLatencyMs ?? null,
        ledgerEntryHash: terminalEntry.entryHash
      }
    },
    ledger: {
      verificationAtGeneration: "full_v2_chain_valid" as const,
      payloadDisclosure: "sha256_commitments_only" as const,
      caseIdSha256: reference("case", input.caseId),
      rowsAtGeneration: verification.rows,
      finalHeadSequence: allEntries.at(-1)!.sequence,
      finalHeadHash: verification.headHash,
      caseEntries: orderedEntries.map(entryCommitment)
    },
    solanaAnchor: input.context.solanaAnchor === undefined || input.context.solanaAnchor === null
      ? null
      : receiptSolanaAnchorSchema.parse(input.context.solanaAnchor)
  };
  const body = decisionReceiptBodySchema.parse(bodyCandidate);
  const receipt = decisionReceiptSchema.parse({
    ...body,
    integrity: {
      algorithm: "sha256",
      canonicalization: DECISION_RECEIPT_CANONICALIZATION,
      domain: DECISION_RECEIPT_HASH_DOMAIN,
      receiptHash: hashDecisionReceiptBody(body)
    }
  });
  verifyDecisionReceipt(receipt);
  return receipt;
}

/** Helper for callers committing an already-canonical source record. */
export function sourceEvidenceCommitment(input: {
  source: ReceiptSourceEvidence["source"];
  role: ReceiptSourceEvidence["role"];
  sourceTsMs: number;
  observedAtTsMs: number;
  payload: JsonValue;
}): ReceiptSourceEvidence {
  const payloadSha256 = sha256(stableJson(input.payload));
  return receiptSourceEvidenceSchema.parse({
    evidenceRefSha256: reference(
      `${input.source}_${input.role}_evidence`,
      `${input.sourceTsMs}:${input.observedAtTsMs}:${payloadSha256}`
    ),
    source: input.source,
    role: input.role,
    sourceTsMs: input.sourceTsMs,
    observedAtTsMs: input.observedAtTsMs,
    payloadSha256,
    disclosure: "hash_only"
  });
}

export function hashJsonEvidence(value: unknown): string {
  return sha256(stableJson(json(value)));
}
