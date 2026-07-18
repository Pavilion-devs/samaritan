import { createHash } from "node:crypto";
import { z } from "zod";
import { CLAUDE_MODEL, CLAUDE_PRICING } from "../agents/claude-pricing.js";
import { stableJson } from "../domain/json.js";
import type { DecisionEventKind } from "../store/decision-ledger.js";

export const DECISION_RECEIPT_SCHEMA_VERSION = 1 as const;
export const DECISION_RECEIPT_HASH_DOMAIN = "samaritan.decision-receipt/v1" as const;
export const DECISION_RECEIPT_CANONICALIZATION = "samaritan-stable-json-v1" as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.number().int().nonnegative().safe();
const nonnegativeIntegerSchema = z.number().int().nonnegative().safe();
const probabilitySchema = z.number().finite().min(0).max(1);

const provenanceSchema = z.object({
  evidenceClass: z.enum(["synthetic_proving_fixture", "captured_paper_case"]),
  synthetic: z.boolean(),
  performanceUse: z.enum([
    "excluded_synthetic",
    "excluded_unregistered",
    "subject_to_registered_evaluation"
  ]),
  label: z.string().min(1).max(300)
}).strict();

const buildCommitmentSchema = z.object({
  codeVersion: z.string().min(1).max(100),
  codeSha256: sha256Schema,
  configSha256: sha256Schema
}).strict();

export const receiptSourceEvidenceSchema = z.object({
  evidenceRefSha256: sha256Schema,
  source: z.enum(["txline", "polymarket", "public_web", "internal"]),
  role: z.enum(["signal", "execution", "close", "settlement"]),
  sourceTsMs: timestampSchema,
  observedAtTsMs: timestampSchema,
  payloadSha256: sha256Schema,
  disclosure: z.literal("hash_only")
}).strict();

const usageSchema = z.object({
  inputTokens: nonnegativeIntegerSchema,
  outputTokens: nonnegativeIntegerSchema,
  cacheCreationInputTokens: nonnegativeIntegerSchema,
  cacheReadInputTokens: nonnegativeIntegerSchema
}).strict();

const pricingSchema = z.object({
  pricingVersion: z.literal("anthropic-public-2026-07-12"),
  currency: z.literal("nano_usd"),
  inputNanoUsdPerToken: nonnegativeIntegerSchema,
  outputNanoUsdPerToken: nonnegativeIntegerSchema,
  cacheWriteNanoUsdPerToken: nonnegativeIntegerSchema,
  cacheReadNanoUsdPerToken: nonnegativeIntegerSchema
}).strict();

export const receiptAgentRunSchema = z.object({
  stage: z.enum(["triage", "analyst"]),
  invocationClass: z.enum(["anthropic_api", "synthetic_stub"]),
  model: z.enum([CLAUDE_MODEL.triage, CLAUDE_MODEL.analyst]),
  promptVersion: z.string().min(1).max(100),
  promptSha256: sha256Schema,
  responseSha256: sha256Schema,
  billingEvidenceRefSha256: sha256Schema,
  status: z.literal("success"),
  usage: usageSchema,
  pricing: pricingSchema,
  actualCostNanoUsd: nonnegativeIntegerSchema,
  localInvocationAudit: z.object({
    assurance: z.literal(
      "local_hash_chain_reference_generated_after_verification_not_offline_membership_or_provider_attestation"
    ),
    sequence: z.number().int().positive().safe(),
    insertedAtTsMs: timestampSchema,
    previousHash: sha256Schema,
    entryHash: sha256Schema,
    ledgerRowsAtGeneration: z.number().int().positive().safe(),
    ledgerHeadHash: sha256Schema
  }).strict().optional()
}).strict();

const signalEvidenceSchema = z.object({
  signalRefSha256: sha256Schema,
  fixtureRefSha256: sha256Schema,
  marketRefSha256: sha256Schema,
  lineRefSha256: sha256Schema.nullable(),
  detector: z.enum(["CONSENSUS_MOVE", "XMARKET_DIVERGENCE", "FADER_CANDIDATE"]),
  sourceTsMs: timestampSchema,
  observedAtTsMs: timestampSchema,
  marketFamily: z.enum(["match_result", "total_goals"]),
  marketPeriod: z.enum(["full_time", "first_half", "extra_time", "other"]),
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  direction: z.enum(["buy", "sell"]),
  eligibility: z.enum(["research_only", "pretrade_review_required"]),
  derivedEvidence: z.object({
    txlineMovementBucketBps: z.literal(25),
    consensusVelocityBucketBps: z.number().finite().nullable(),
    consensusZScore: z.number().finite().nullable(),
    polymarketVelocityBucketBps: z.number().finite().nullable(),
    polymarketZScore: z.number().finite().nullable(),
    cusumUpScore: z.number().finite(),
    cusumDownScore: z.number().finite(),
    relativeValueDirection: z.enum(["consensus_above_venue", "venue_above_consensus", "aligned"]),
    gapBasis: z.enum(["live_book", "sampled_history_proxy"]),
    persistenceMs: nonnegativeIntegerSchema,
    mappingStatus: z.string().min(1).max(100).nullable(),
    scoreContextActionCount: nonnegativeIntegerSchema
  }).strict(),
  sourceEvidenceRefs: z.array(sha256Schema).min(1),
  ledgerEntryHash: sha256Schema
}).strict();

const triageReceiptSchema = z.object({
  decision: z.enum(["drop", "escalate"]),
  priority: z.enum(["low", "normal", "high"]),
  rationale: z.string().min(1).max(500),
  ledgerEntryHash: sha256Schema
}).strict();

const thesisReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  signalRefSha256: sha256Schema,
  fixtureRefSha256: sha256Schema,
  marketRefSha256: sha256Schema,
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  direction: z.enum(["buy", "sell"]),
  recommendation: z.enum(["paper_trade", "no_trade"]),
  disclosure: z.literal("private_payload_sha256_commitment"),
  thesisPayloadSha256: sha256Schema,
  submittedAtTsMs: timestampSchema,
  expiresAtTsMs: timestampSchema,
  analystModel: z.enum([CLAUDE_MODEL.analyst]),
  ledgerEntryHash: sha256Schema
}).strict();

const analysisReceiptSchema = z.object({
  signalSourceTsMs: timestampSchema,
  signalObservedTsMs: timestampSchema,
  decisionLatencyMs: z.number().int().positive().safe(),
  readyAtTsMs: timestampSchema,
  venuePlacementDelayMs: z.number().int().positive().safe(),
  orderEligibleAtTsMs: timestampSchema,
  recommendation: z.enum(["paper_trade", "no_trade"]),
  ledgerEntryHash: sha256Schema
}).strict();

const riskReceiptSchema = z.object({
  decision: z.enum(["approve", "veto"]),
  reasons: z.array(z.string().min(1).max(300)),
  stakeMicroUsd: nonnegativeIntegerSchema.nullable(),
  limitPolicy: z.literal("deterministic_private_fair_value_boundary").nullable(),
  realMoneyGate: z.literal("closed").nullable(),
  ledgerEntryHash: sha256Schema
}).strict();

const intentReceiptSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  signalRefSha256: sha256Schema,
  fixtureRefSha256: sha256Schema,
  marketRefSha256: sha256Schema,
  outcome: z.string().min(1).max(100),
  direction: z.enum(["buy", "sell"]),
  stakeMicroUsd: nonnegativeIntegerSchema,
  limitPolicy: z.literal("deterministic_private_fair_value_boundary"),
  availableShares: z.number().finite().nonnegative(),
  ledgerEntryHash: sha256Schema
}).strict();

const executionReceiptSchema = z.object({
  adapter: z.literal("paper"),
  status: z.enum(["filled", "partial", "no_fill"]),
  reason: z.string().min(1).max(300).nullable(),
  assetRefSha256: sha256Schema,
  conditionRefSha256: sha256Schema,
  direction: z.enum(["buy", "sell"]),
  requestedStakeMicroUsd: nonnegativeIntegerSchema,
  grossMicroUsd: nonnegativeIntegerSchema,
  feeMicroUsd: nonnegativeIntegerSchema,
  netConsiderationMicroUsd: nonnegativeIntegerSchema,
  filledShares: z.number().finite().nonnegative(),
  averagePrice: probabilitySchema.nullable(),
  bestPrice: probabilitySchema.nullable(),
  halfSpreadBps: z.number().finite().nonnegative().nullable(),
  executableDepthUsd: z.number().finite().nonnegative(),
  slippageProbabilityBps: z.number().finite().nonnegative().nullable(),
  bookSourceTsMs: timestampSchema,
  bookObservedTsMs: timestampSchema,
  bookEvidenceRefSha256: sha256Schema,
  feeMetadataRefSha256: sha256Schema,
  ledgerEntryHash: sha256Schema
}).strict();

const positionReceiptSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  signalRefSha256: sha256Schema,
  fixtureRefSha256: sha256Schema,
  marketRefSha256: sha256Schema,
  conditionRefSha256: sha256Schema,
  assetRefSha256: sha256Schema,
  outcome: z.string().min(1).max(100),
  lineRefSha256: sha256Schema,
  openedAtTsMs: timestampSchema,
  filledShares: z.number().finite().positive(),
  averageEntryPrice: probabilitySchema,
  entryGrossMicroUsd: nonnegativeIntegerSchema,
  entryFeeMicroUsd: nonnegativeIntegerSchema,
  entryCostMicroUsd: nonnegativeIntegerSchema,
  fillStatus: z.enum(["filled", "partial"]),
  entryHalfSpreadBps: z.number().finite().nonnegative(),
  entrySlippageBps: z.number().finite().nonnegative(),
  selectedDepthUsd: z.number().finite().nonnegative(),
  ledgerEntryHash: sha256Schema
}).strict();

const closeReceiptSchema = z.object({
  cutoffTsMs: timestampSchema,
  markedAtTsMs: timestampSchema,
  bookSourceTsMs: timestampSchema,
  bookObservedTsMs: timestampSchema,
  closeBid: probabilitySchema,
  closeAsk: probabilitySchema,
  closeMidpoint: probabilitySchema,
  grossMidpointClvBps: z.number().finite(),
  netMidpointClvBps: z.number().finite(),
  executableLiquidationClvBps: z.number().finite(),
  bookEvidenceRefSha256: sha256Schema,
  ledgerEntryHash: sha256Schema
}).strict();

const settlementReceiptSchema = z.object({
  settledAtTsMs: timestampSchema,
  won: z.boolean(),
  payoutMicroUsd: nonnegativeIntegerSchema,
  pnlMicroUsd: z.number().int().safe(),
  returnBps: z.number().finite(),
  entryBrier: z.number().finite().min(0).max(1),
  resolutionEvidenceRefSha256: sha256Schema,
  ledgerEntryHash: sha256Schema
}).strict();

const terminalReceiptSchema = z.object({
  status: z.enum(["dropped", "no_trade", "vetoed", "filled", "partial", "no_fill"]),
  reason: z.string().min(1).max(1_000),
  decisionLatencyMs: z.number().int().positive().safe().nullable(),
  ledgerEntryHash: sha256Schema
}).strict();

const finalStatusSchema = z.enum([
  "dropped",
  "no_trade",
  "vetoed",
  "no_fill",
  "filled_open",
  "filled_marked",
  "filled_settled",
  "partial_open",
  "partial_marked",
  "partial_settled"
]);

const decisionEventKindSchema = z.enum([
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

const lifecycleSchema = z.object({
  finalStatus: finalStatusSchema,
  orderedEventKinds: z.array(decisionEventKindSchema).min(3),
  signal: signalEvidenceSchema,
  triage: triageReceiptSchema,
  thesis: thesisReceiptSchema.nullable(),
  analysis: analysisReceiptSchema.nullable(),
  risk: riskReceiptSchema.nullable(),
  intent: intentReceiptSchema.nullable(),
  execution: executionReceiptSchema.nullable(),
  position: positionReceiptSchema.nullable(),
  close: closeReceiptSchema.nullable(),
  settlement: settlementReceiptSchema.nullable(),
  terminal: terminalReceiptSchema
}).strict();

const ledgerEntryCommitmentSchema = z.object({
  sequence: z.number().int().positive().safe(),
  kind: decisionEventKindSchema,
  atTsMs: timestampSchema,
  insertedAtMs: timestampSchema,
  entryIdSha256: sha256Schema,
  payloadSha256: sha256Schema,
  previousHash: sha256Schema,
  entryHash: sha256Schema,
  hashSchemaVersion: z.literal(2)
}).strict();

const ledgerCommitmentSchema = z.object({
  verificationAtGeneration: z.literal("full_v2_chain_valid"),
  payloadDisclosure: z.literal("sha256_commitments_only"),
  caseIdSha256: sha256Schema,
  rowsAtGeneration: z.number().int().positive().safe(),
  finalHeadSequence: z.number().int().positive().safe(),
  finalHeadHash: sha256Schema,
  caseEntries: z.array(ledgerEntryCommitmentSchema).min(3)
}).strict();

export const receiptSolanaAnchorSchema = z.object({
  network: z.enum(["mainnet-beta", "devnet"]),
  transactionSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
  slot: z.number().int().nonnegative().safe(),
  blockTimeTsMs: timestampSchema.nullable(),
  memoProgramId: z.literal("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
  commitmentType: z.literal("decision_ledger_head_sha256"),
  committedHash: sha256Schema,
  networkVerification: z.literal("not_performed_by_offline_verifier")
}).strict();

export const decisionReceiptBodySchema = z.object({
  schemaVersion: z.literal(DECISION_RECEIPT_SCHEMA_VERSION),
  receiptType: z.literal("samaritan_decision_receipt"),
  receiptId: sha256Schema,
  generatedAtTsMs: timestampSchema,
  provenance: provenanceSchema,
  disclosure: z.object({
    policy: z.literal("hashes_and_derived_signals_only"),
    rawTxlineFieldsIncluded: z.literal(false)
  }).strict(),
  build: buildCommitmentSchema,
  sourceEvidence: z.array(receiptSourceEvidenceSchema).min(1),
  agents: z.object({
    runs: z.array(receiptAgentRunSchema).min(1).max(2),
    totalActualCostNanoUsd: nonnegativeIntegerSchema
  }).strict(),
  lifecycle: lifecycleSchema,
  ledger: ledgerCommitmentSchema,
  solanaAnchor: receiptSolanaAnchorSchema.nullable()
}).strict();

export const decisionReceiptSchema = decisionReceiptBodySchema.extend({
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.literal(DECISION_RECEIPT_CANONICALIZATION),
    domain: z.literal(DECISION_RECEIPT_HASH_DOMAIN),
    receiptHash: sha256Schema
  }).strict()
}).strict();

export type DecisionReceiptBody = z.infer<typeof decisionReceiptBodySchema>;
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;
export type ReceiptSourceEvidence = z.infer<typeof receiptSourceEvidenceSchema>;
export type ReceiptAgentRun = z.infer<typeof receiptAgentRunSchema>;
export type ReceiptSolanaAnchor = z.infer<typeof receiptSolanaAnchorSchema>;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function receiptReferenceHash(namespace: string, value: string | number): string {
  return sha256(`samaritan.receipt.reference/v1\n${namespace}\n${String(value)}`);
}

export function hashDecisionReceiptBody(body: DecisionReceiptBody): string {
  return sha256(`${DECISION_RECEIPT_HASH_DOMAIN}\n${stableJson(body)}`);
}

function expectedKinds(status: z.infer<typeof finalStatusSchema>): DecisionEventKind[] {
  if (status === "dropped") {
    return ["signal_received", "triage_decision", "case_terminal"];
  }
  if (status === "no_trade") {
    return [
      "signal_received",
      "triage_decision",
      "thesis_submitted",
      "analysis_completed",
      "case_terminal"
    ];
  }
  if (status === "vetoed") {
    return [
      "signal_received",
      "triage_decision",
      "thesis_submitted",
      "analysis_completed",
      "risk_verdict",
      "case_terminal"
    ];
  }
  const base: DecisionEventKind[] = [
    "signal_received",
    "triage_decision",
    "thesis_submitted",
    "analysis_completed",
    "risk_verdict",
    "execution_intent",
    "paper_execution",
    "case_terminal"
  ];
  if (status === "no_fill") return base;
  base.push("position_opened");
  if (status.endsWith("_marked") || status.endsWith("_settled")) base.push("position_closed");
  if (status.endsWith("_settled")) base.push("position_settled");
  return base;
}

function cost(run: ReceiptAgentRun): number {
  return (
    run.usage.inputTokens * run.pricing.inputNanoUsdPerToken +
    run.usage.outputTokens * run.pricing.outputNanoUsdPerToken +
    run.usage.cacheCreationInputTokens * run.pricing.cacheWriteNanoUsdPerToken +
    run.usage.cacheReadInputTokens * run.pricing.cacheReadNanoUsdPerToken
  );
}

/**
 * Checks relationships a canonical hash alone cannot express. This is kept
 * separate from the structural Zod schema so both the generator and offline
 * verifier execute the exact same semantic checks.
 */
export function assertDecisionReceiptSemantics(receipt: DecisionReceipt): void {
  const issues: string[] = [];
  const fail = (message: string) => issues.push(message);
  const { lifecycle, ledger } = receipt;

  const forbiddenPublicKeys = new Set([
    "fairProbability",
    "consensusProbability",
    "polymarketProbability",
    "marketProbability",
    "limitProbability",
    "Pct",
    "Prices",
    "rawGap",
    "crossMarketGapBps",
    "executableGap",
    "exactGap",
    "gapBps",
    "consensusVelocityBps",
    "polymarketVelocityBps"
  ]);
  const visitKeys = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visitKeys(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenPublicKeys.has(key)) fail(`Receipt contains forbidden public field ${key}`);
      visitKeys(child);
    }
  };
  visitKeys(receipt);

  if (receipt.provenance.synthetic) {
    if (receipt.provenance.evidenceClass !== "synthetic_proving_fixture") {
      fail("Synthetic provenance must use the synthetic proving-fixture class");
    }
    if (receipt.provenance.performanceUse !== "excluded_synthetic") {
      fail("Synthetic receipts must be excluded from performance evidence");
    }
    if (receipt.agents.runs.some((run) => run.invocationClass !== "synthetic_stub")) {
      fail("Synthetic receipts cannot claim Anthropic API invocations");
    }
  } else {
    if (receipt.provenance.evidenceClass !== "captured_paper_case") {
      fail("Captured receipts must use the captured paper-case class");
    }
    if (receipt.provenance.performanceUse === "excluded_synthetic") {
      fail("Captured receipts cannot use the synthetic performance classification");
    }
    if (receipt.agents.runs.some((run) => run.invocationClass !== "anthropic_api")) {
      fail("Captured receipts require real invocation evidence");
    }
  }

  const sourceRefs = new Set<string>();
  for (const source of receipt.sourceEvidence) {
    if (sourceRefs.has(source.evidenceRefSha256)) fail("Source evidence references must be unique");
    sourceRefs.add(source.evidenceRefSha256);
    const expectedReference = receiptReferenceHash(
      `${source.source}_${source.role}_evidence`,
      `${source.sourceTsMs}:${source.observedAtTsMs}:${source.payloadSha256}`
    );
    if (source.evidenceRefSha256 !== expectedReference) {
      fail("Source evidence reference does not match its disclosed commitment fields");
    }
  }
  for (const reference of lifecycle.signal.sourceEvidenceRefs) {
    const source = receipt.sourceEvidence.find((candidate) => candidate.evidenceRefSha256 === reference);
    if (!source || source.role !== "signal") fail("Signal evidence reference is missing or has the wrong role");
  }
  for (const bucketed of [
    lifecycle.signal.derivedEvidence.consensusVelocityBucketBps,
    lifecycle.signal.derivedEvidence.polymarketVelocityBucketBps
  ]) {
    if (bucketed !== null && Math.abs(bucketed / 25 - Math.round(bucketed / 25)) > 1e-12) {
      fail("TXLine-derived movement evidence must use 25-bps buckets");
    }
  }
  if (!lifecycle.signal.sourceEvidenceRefs.some((reference) =>
    receipt.sourceEvidence.some((source) =>
      source.evidenceRefSha256 === reference && source.source === "txline" && source.role === "signal"
    ))) {
    fail("Signal evidence must commit at least one TXLine source record");
  }

  const stages = receipt.agents.runs.map((run) => run.stage);
  if (new Set(stages).size !== stages.length) fail("Agent stages must be unique");
  const expectedStages = lifecycle.thesis === null ? ["triage"] : ["triage", "analyst"];
  if (stableJson(stages) !== stableJson(expectedStages)) fail("Agent runs do not match the decision stages");
  for (const run of receipt.agents.runs) {
    const expectedPricing = CLAUDE_PRICING[run.model];
    if (
      run.pricing.inputNanoUsdPerToken !== expectedPricing.inputNanoUsdPerToken ||
      run.pricing.outputNanoUsdPerToken !== expectedPricing.outputNanoUsdPerToken ||
      run.pricing.cacheWriteNanoUsdPerToken !== expectedPricing.cacheWriteNanoUsdPerToken ||
      run.pricing.cacheReadNanoUsdPerToken !== expectedPricing.cacheReadNanoUsdPerToken
    ) fail(`Embedded pricing does not match the frozen schedule for ${run.stage}`);
    if (run.actualCostNanoUsd !== cost(run)) fail(`Agent cost does not match embedded usage for ${run.stage}`);
    if (receipt.provenance.synthetic && run.actualCostNanoUsd !== 0) {
      fail("Synthetic stubs must have zero cost");
    }
    if (receipt.provenance.synthetic && run.localInvocationAudit !== undefined) {
      fail("Synthetic stubs cannot claim a local invocation-ledger reference");
    }
    if (!receipt.provenance.synthetic && run.localInvocationAudit === undefined) {
      fail("Captured Claude runs require a generation-time local invocation-ledger reference");
    }
  }
  const localAudits = receipt.agents.runs
    .map((run) => run.localInvocationAudit)
    .filter((audit): audit is NonNullable<typeof audit> => audit !== undefined);
  if (localAudits.length > 0) {
    const [first] = localAudits;
    if (localAudits.some((audit) =>
      audit.ledgerRowsAtGeneration !== first!.ledgerRowsAtGeneration ||
      audit.ledgerHeadHash !== first!.ledgerHeadHash
    )) fail("Claude runs do not share one invocation-evidence chain boundary");
    if (new Set(localAudits.map((audit) => audit.sequence)).size !== localAudits.length) {
      fail("Claude invocation-evidence sequences must be unique");
    }
    if (localAudits.some((audit) => audit.sequence > audit.ledgerRowsAtGeneration)) {
      fail("Claude invocation-evidence sequence exceeds its chain boundary");
    }
    for (const audit of localAudits) {
      if (
        audit.sequence === audit.ledgerRowsAtGeneration &&
        audit.entryHash !== audit.ledgerHeadHash
      ) fail("Final Claude invocation-evidence row does not match its disclosed head");
    }
  }
  const totalCost = receipt.agents.runs.reduce((sum, run) => sum + run.actualCostNanoUsd, 0);
  if (receipt.agents.totalActualCostNanoUsd !== totalCost) fail("Total agent cost is inconsistent");
  const analyst = receipt.agents.runs.find((run) => run.stage === "analyst");
  if (lifecycle.thesis && analyst?.model !== lifecycle.thesis.analystModel) {
    fail("Thesis model does not match analyst invocation evidence");
  }

  const expected = expectedKinds(lifecycle.finalStatus);
  if (stableJson(lifecycle.orderedEventKinds) !== stableJson(expected)) {
    fail("Lifecycle event ordering does not match final status");
  }
  if (stableJson(ledger.caseEntries.map((entry) => entry.kind)) !== stableJson(expected)) {
    fail("Ledger case commitments do not match lifecycle event ordering");
  }
  if (ledger.caseEntries.length !== lifecycle.orderedEventKinds.length) {
    fail("Ledger case commitment count does not match lifecycle");
  }
  for (let index = 0; index < ledger.caseEntries.length; index += 1) {
    const entry = ledger.caseEntries[index]!;
    const prior = ledger.caseEntries[index - 1];
    if (prior && entry.sequence <= prior.sequence) fail("Ledger case sequences must increase");
    if (prior && entry.atTsMs < prior.atTsMs) fail("Lifecycle event timestamps must not move backward");
    if (prior && entry.sequence === prior.sequence + 1 && entry.previousHash !== prior.entryHash) {
      fail("Contiguous ledger case commitments have a broken hash link");
    }
  }
  const finalCaseEntry = ledger.caseEntries.at(-1)!;
  if (ledger.finalHeadSequence < finalCaseEntry.sequence) fail("Ledger head sequence precedes the case lifecycle");
  if (ledger.finalHeadSequence === finalCaseEntry.sequence && ledger.finalHeadHash !== finalCaseEntry.entryHash) {
    fail("Final ledger head does not match the final case entry");
  }

  const lifecycleHashes = [
    lifecycle.signal.ledgerEntryHash,
    lifecycle.triage.ledgerEntryHash,
    lifecycle.thesis?.ledgerEntryHash,
    lifecycle.analysis?.ledgerEntryHash,
    lifecycle.risk?.ledgerEntryHash,
    lifecycle.intent?.ledgerEntryHash,
    lifecycle.execution?.ledgerEntryHash,
    lifecycle.terminal.ledgerEntryHash,
    lifecycle.position?.ledgerEntryHash,
    lifecycle.close?.ledgerEntryHash,
    lifecycle.settlement?.ledgerEntryHash
  ].filter((value): value is string => value !== undefined);
  if (stableJson(lifecycleHashes) !== stableJson(ledger.caseEntries.map((entry) => entry.entryHash))) {
    fail("Lifecycle records do not bind to the ordered ledger entry hashes");
  }

  if (lifecycle.triage.decision === "drop") {
    if (lifecycle.finalStatus !== "dropped" || lifecycle.thesis !== null) fail("Dropped lifecycle is inconsistent");
  } else if (lifecycle.thesis === null || lifecycle.analysis === null) {
    fail("Escalated lifecycle requires a thesis and analysis evidence");
  }
  if (lifecycle.thesis) {
    if (
      lifecycle.thesis.signalRefSha256 !== lifecycle.signal.signalRefSha256 ||
      lifecycle.thesis.fixtureRefSha256 !== lifecycle.signal.fixtureRefSha256 ||
      lifecycle.thesis.marketRefSha256 !== lifecycle.signal.marketRefSha256 ||
      lifecycle.thesis.outcome !== lifecycle.signal.outcome ||
      lifecycle.thesis.direction !== lifecycle.signal.direction
    ) fail("Thesis identity does not match the signal");
    if (lifecycle.thesis.expiresAtTsMs <= lifecycle.thesis.submittedAtTsMs) {
      fail("Thesis expiry must be after submission");
    }
  }
  if (lifecycle.analysis) {
    if (
      lifecycle.analysis.signalSourceTsMs !== lifecycle.signal.sourceTsMs ||
      lifecycle.analysis.signalObservedTsMs !== lifecycle.signal.observedAtTsMs ||
      lifecycle.analysis.readyAtTsMs !== lifecycle.signal.observedAtTsMs + lifecycle.analysis.decisionLatencyMs ||
      lifecycle.analysis.orderEligibleAtTsMs !==
        lifecycle.analysis.readyAtTsMs + lifecycle.analysis.venuePlacementDelayMs
    ) fail("Analysis readiness timing is inconsistent");
    if (lifecycle.thesis && lifecycle.analysis.recommendation !== lifecycle.thesis.recommendation) {
      fail("Analysis recommendation does not match the thesis");
    }
  }

  if (lifecycle.finalStatus === "no_trade") {
    if (lifecycle.thesis?.recommendation !== "no_trade" || lifecycle.risk !== null) {
      fail("No-trade lifecycle is inconsistent");
    }
  }
  if (lifecycle.finalStatus === "vetoed") {
    if (lifecycle.risk?.decision !== "veto" || lifecycle.intent !== null || lifecycle.execution !== null) {
      fail("Vetoed lifecycle is inconsistent");
    }
  }
  if (lifecycle.risk?.decision === "approve" && (
    lifecycle.risk.reasons.length !== 0 ||
    lifecycle.risk.stakeMicroUsd === null || lifecycle.risk.stakeMicroUsd <= 0 ||
    lifecycle.risk.limitPolicy !== "deterministic_private_fair_value_boundary" ||
    lifecycle.risk.realMoneyGate !== "closed"
  )) fail("Deterministic approval fields are inconsistent");
  if (lifecycle.risk?.decision === "veto" && (
    lifecycle.risk.reasons.length === 0 ||
    lifecycle.risk.stakeMicroUsd !== null ||
    lifecycle.risk.limitPolicy !== null ||
    lifecycle.risk.realMoneyGate !== null
  )) fail("Deterministic veto fields are inconsistent");
  const execution = lifecycle.execution;
  if (execution) {
    if (lifecycle.risk?.decision !== "approve" || lifecycle.intent === null || lifecycle.analysis === null) {
      fail("Execution requires analysis, deterministic approval, and intent");
    } else {
      if (
        lifecycle.intent.signalRefSha256 !== lifecycle.signal.signalRefSha256 ||
        lifecycle.intent.fixtureRefSha256 !== lifecycle.signal.fixtureRefSha256 ||
        lifecycle.intent.marketRefSha256 !== lifecycle.signal.marketRefSha256 ||
        lifecycle.intent.outcome !== lifecycle.signal.outcome ||
        lifecycle.intent.direction !== lifecycle.signal.direction ||
        lifecycle.intent.stakeMicroUsd !== lifecycle.risk.stakeMicroUsd ||
        lifecycle.intent.limitPolicy !== lifecycle.risk.limitPolicy
      ) fail("Execution intent does not match signal identity or deterministic risk approval");
      if (execution.requestedStakeMicroUsd !== lifecycle.intent.stakeMicroUsd) {
        fail("Paper execution stake does not match intent");
      }
      if (execution.direction !== lifecycle.intent.direction) {
        fail("Paper execution direction does not match intent");
      }
      if (
        execution.bookObservedTsMs < lifecycle.analysis.orderEligibleAtTsMs ||
        execution.bookObservedTsMs < lifecycle.analysis.readyAtTsMs
      ) fail("Execution evidence precedes analysis readiness or venue delay");
    }
    const executionSource = receipt.sourceEvidence.find((source) =>
      source.evidenceRefSha256 === execution.bookEvidenceRefSha256
    );
    if (
      !executionSource || executionSource.source !== "polymarket" || executionSource.role !== "execution" ||
      executionSource.sourceTsMs !== execution.bookSourceTsMs ||
      executionSource.observedAtTsMs !== execution.bookObservedTsMs
    ) fail("Execution book commitment is missing or inconsistent");
  }

  if (lifecycle.finalStatus === "no_fill") {
    if (lifecycle.execution?.status !== "no_fill" || lifecycle.position !== null) {
      fail("No-fill lifecycle is inconsistent");
    }
    if (lifecycle.execution && (
      lifecycle.execution.filledShares !== 0 ||
      lifecycle.execution.grossMicroUsd !== 0 ||
      lifecycle.execution.feeMicroUsd !== 0 ||
      lifecycle.execution.netConsiderationMicroUsd !== 0 ||
      lifecycle.execution.averagePrice !== null ||
      lifecycle.execution.reason === null
    )) fail("No-fill accounting is inconsistent");
  }
  const positionStatus = lifecycle.finalStatus.startsWith("filled_")
    ? "filled"
    : lifecycle.finalStatus.startsWith("partial_") ? "partial" : null;
  if (positionStatus) {
    if (lifecycle.execution && (
      lifecycle.execution.filledShares <= 0 ||
      lifecycle.execution.averagePrice === null ||
      lifecycle.execution.bestPrice === null ||
      lifecycle.execution.halfSpreadBps === null ||
      lifecycle.execution.slippageProbabilityBps === null
    )) fail("Filled paper execution lacks required market evidence");
    if (lifecycle.execution?.status !== positionStatus || lifecycle.position?.fillStatus !== positionStatus) {
      fail("Position status does not match the paper fill");
    }
    if (
      lifecycle.position?.signalRefSha256 !== lifecycle.signal.signalRefSha256 ||
      lifecycle.position.fixtureRefSha256 !== lifecycle.signal.fixtureRefSha256 ||
      lifecycle.position.marketRefSha256 !== lifecycle.signal.marketRefSha256 ||
      lifecycle.position.lineRefSha256 !== lifecycle.signal.lineRefSha256 ||
      lifecycle.position.openedAtTsMs < (lifecycle.execution?.bookObservedTsMs ?? Number.MAX_SAFE_INTEGER)
    ) fail("Position identity or opening time is inconsistent");
    if (lifecycle.position && lifecycle.execution && (
      lifecycle.position.conditionRefSha256 !== lifecycle.execution.conditionRefSha256 ||
      lifecycle.position.assetRefSha256 !== lifecycle.execution.assetRefSha256 ||
      lifecycle.position.outcome !== lifecycle.signal.outcome ||
      lifecycle.position.filledShares !== lifecycle.execution.filledShares ||
      lifecycle.position.averageEntryPrice !== lifecycle.execution.averagePrice ||
      lifecycle.position.entryGrossMicroUsd !== lifecycle.execution.grossMicroUsd ||
      lifecycle.position.entryFeeMicroUsd !== lifecycle.execution.feeMicroUsd ||
      lifecycle.position.entryCostMicroUsd !== lifecycle.execution.netConsiderationMicroUsd ||
      lifecycle.position.entryHalfSpreadBps !== lifecycle.execution.halfSpreadBps ||
      lifecycle.position.entrySlippageBps !== lifecycle.execution.slippageProbabilityBps ||
      lifecycle.position.selectedDepthUsd !== lifecycle.execution.executableDepthUsd
    )) fail("Position accounting does not match the paper fill");
  }
  if (lifecycle.finalStatus.endsWith("_open") && (lifecycle.close !== null || lifecycle.settlement !== null)) {
    fail("Open lifecycle cannot contain close or settlement evidence");
  }
  if (lifecycle.finalStatus.endsWith("_marked") && (lifecycle.close === null || lifecycle.settlement !== null)) {
    fail("Marked lifecycle must contain only close evidence");
  }
  if (lifecycle.finalStatus.endsWith("_settled") && (lifecycle.close === null || lifecycle.settlement === null)) {
    fail("Settled lifecycle requires close and settlement evidence");
  }
  if (lifecycle.close) {
    if (
      lifecycle.close.closeBid > lifecycle.close.closeAsk ||
      lifecycle.close.bookSourceTsMs > lifecycle.close.cutoffTsMs ||
      lifecycle.close.markedAtTsMs < lifecycle.close.bookObservedTsMs
    ) fail("Close evidence has impossible price or timing relationships");
    const closeSource = receipt.sourceEvidence.find((source) =>
      source.evidenceRefSha256 === lifecycle.close?.bookEvidenceRefSha256
    );
    if (
      !closeSource || closeSource.source !== "polymarket" || closeSource.role !== "close" ||
      closeSource.sourceTsMs !== lifecycle.close.bookSourceTsMs ||
      closeSource.observedAtTsMs !== lifecycle.close.bookObservedTsMs
    ) fail("Close book commitment is missing or inconsistent");
    if (lifecycle.position) {
      const expectedMidpoint = (lifecycle.close.closeBid + lifecycle.close.closeAsk) / 2;
      const unitCost = lifecycle.position.entryCostMicroUsd / 1_000_000 / lifecycle.position.filledShares;
      const tolerance = 1e-8;
      if (
        Math.abs(lifecycle.close.closeMidpoint - expectedMidpoint) > tolerance ||
        Math.abs(
          lifecycle.close.grossMidpointClvBps -
          (expectedMidpoint - lifecycle.position.averageEntryPrice) * 10_000
        ) > tolerance ||
        Math.abs(lifecycle.close.netMidpointClvBps - (expectedMidpoint - unitCost) * 10_000) > tolerance ||
        Math.abs(lifecycle.close.executableLiquidationClvBps - (lifecycle.close.closeBid - unitCost) * 10_000) > tolerance
      ) fail("Close CLV arithmetic is inconsistent");
    }
  }
  if (lifecycle.settlement) {
    if (lifecycle.close && lifecycle.settlement.settledAtTsMs < lifecycle.close.markedAtTsMs) {
      fail("Settlement precedes the close mark");
    }
    const settlementSource = receipt.sourceEvidence.find((source) =>
      source.evidenceRefSha256 === lifecycle.settlement?.resolutionEvidenceRefSha256
    );
    if (
      !settlementSource || settlementSource.source !== "polymarket" ||
      settlementSource.role !== "settlement" ||
      settlementSource.observedAtTsMs !== lifecycle.settlement.settledAtTsMs
    ) fail("Settlement commitment is missing or inconsistent");
    if (lifecycle.position) {
      const expectedPayout = lifecycle.settlement.won
        ? Math.floor(lifecycle.position.filledShares * 1_000_000)
        : 0;
      const expectedPnl = expectedPayout - lifecycle.position.entryCostMicroUsd;
      const expectedReturnBps = lifecycle.position.entryCostMicroUsd === 0
        ? 0
        : expectedPnl / lifecycle.position.entryCostMicroUsd * 10_000;
      const expectedBrier = (
        lifecycle.position.averageEntryPrice - (lifecycle.settlement.won ? 1 : 0)
      ) ** 2;
      if (
        lifecycle.settlement.payoutMicroUsd !== expectedPayout ||
        lifecycle.settlement.pnlMicroUsd !== expectedPnl ||
        Math.abs(lifecycle.settlement.returnBps - expectedReturnBps) > 1e-8 ||
        Math.abs(lifecycle.settlement.entryBrier - expectedBrier) > 1e-12
      ) fail("Settlement accounting is inconsistent");
    }
  }

  const expectedTerminalStatus = positionStatus ?? lifecycle.finalStatus;
  if (lifecycle.terminal.status !== expectedTerminalStatus) {
    fail("Terminal decision status does not match lifecycle status");
  }
  if (receipt.solanaAnchor) {
    if (receipt.solanaAnchor.committedHash !== ledger.finalHeadHash) {
      fail("Solana anchor metadata does not commit the receipt ledger head");
    }
    if (
      receipt.solanaAnchor.blockTimeTsMs !== null &&
      receipt.solanaAnchor.blockTimeTsMs < finalCaseEntry.atTsMs
    ) fail("Solana anchor block time precedes the committed lifecycle");
  }

  if (issues.length > 0) throw new Error(issues.join("; "));
}

export type DecisionReceiptVerification = {
  valid: true;
  receiptHash: string;
  committedLedgerHead: string;
  lifecycleStatus: DecisionReceipt["lifecycle"]["finalStatus"];
  synthetic: boolean;
  solanaAnchorMetadataPresent: boolean;
  solanaNetworkVerificationPerformed: false;
  assurance: [
    "receipt_schema_and_canonical_hash_verified",
    "lifecycle_and_commitment_consistency_verified",
    "source_payloads_and_local_ledger_not_replayed_by_offline_verifier"
  ];
};

/** Offline-only verification. It deliberately does not access Solana or source APIs. */
export function verifyDecisionReceipt(value: unknown): DecisionReceiptVerification {
  const receipt = decisionReceiptSchema.parse(value);
  const { integrity: _integrity, ...bodyValue } = receipt;
  const body = decisionReceiptBodySchema.parse(bodyValue);
  const expectedHash = hashDecisionReceiptBody(body);
  if (receipt.integrity.receiptHash !== expectedHash) {
    throw new Error("Decision receipt canonical hash mismatch");
  }
  assertDecisionReceiptSemantics(receipt);
  return {
    valid: true,
    receiptHash: receipt.integrity.receiptHash,
    committedLedgerHead: receipt.ledger.finalHeadHash,
    lifecycleStatus: receipt.lifecycle.finalStatus,
    synthetic: receipt.provenance.synthetic,
    solanaAnchorMetadataPresent: receipt.solanaAnchor !== null,
    solanaNetworkVerificationPerformed: false,
    assurance: [
      "receipt_schema_and_canonical_hash_verified",
      "lifecycle_and_commitment_consistency_verified",
      "source_payloads_and_local_ledger_not_replayed_by_offline_verifier"
    ]
  };
}
