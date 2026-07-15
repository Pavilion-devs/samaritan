import {
  CLAUDE_PRICING
} from "../agents/claude-pricing.js";
import { ClaudeInvocationEvidenceLedger } from "../agents/claude-evidence-ledger.js";
import type { ClaudeInvocationEvidenceRecord } from "../agents/claude-evidence-ledger.js";
import type { ClaudeInvocationEvidence } from "../agents/claude.js";
import {
  receiptAgentRunSchema,
  type ReceiptAgentRun
} from "./decision-receipt-schema.js";

export function receiptAgentRunFromClaudeEvidence(
  evidence: ClaudeInvocationEvidence,
  expectedCaseId: string,
  localInvocationAudit?: ReceiptAgentRun["localInvocationAudit"]
): ReceiptAgentRun {
  if (evidence.caseId !== expectedCaseId) {
    throw new Error("Claude invocation evidence belongs to a different decision case");
  }
  if (evidence.invocationClass !== "anthropic_api") {
    throw new Error("Injected Claude clients cannot produce Anthropic API receipt evidence");
  }
  if (!localInvocationAudit) {
    throw new Error(
      "Anthropic API receipt evidence requires a reference generated after local hash-chain verification"
    );
  }
  const pricing = CLAUDE_PRICING[evidence.model];
  return receiptAgentRunSchema.parse({
    stage: evidence.stage,
    invocationClass: "anthropic_api",
    model: evidence.model,
    promptVersion: evidence.promptVersion,
    promptSha256: evidence.promptSha256,
    responseSha256: evidence.responseSha256,
    billingEvidenceRefSha256: evidence.billingEvidenceSha256,
    status: "success",
    usage: evidence.usage,
    pricing: {
      pricingVersion: "anthropic-public-2026-07-12",
      currency: "nano_usd",
      inputNanoUsdPerToken: pricing.inputNanoUsdPerToken,
      outputNanoUsdPerToken: pricing.outputNanoUsdPerToken,
      cacheWriteNanoUsdPerToken: pricing.cacheWriteNanoUsdPerToken,
      cacheReadNanoUsdPerToken: pricing.cacheReadNanoUsdPerToken
    },
    actualCostNanoUsd: evidence.actualCostNanoUsd,
    localInvocationAudit
  });
}

function auditCommitment(
  record: ClaudeInvocationEvidenceRecord,
  verification: ReturnType<ClaudeInvocationEvidenceLedger["verifyChain"]>
): NonNullable<ReceiptAgentRun["localInvocationAudit"]> {
  return {
    assurance:
      "local_hash_chain_reference_generated_after_verification_not_offline_membership_or_provider_attestation",
    sequence: record.sequence,
    insertedAtTsMs: record.insertedAtMs,
    previousHash: record.previousHash,
    entryHash: record.entryHash,
    ledgerRowsAtGeneration: verification.rows,
    ledgerHeadHash: verification.headHash
  };
}

/**
 * Verifies the durable invocation-evidence chain and converts only the runs
 * belonging to one decision case into the public receipt shape. This is the
 * production bridge from hash-only model evidence to receipt generation.
 */
export function receiptAgentRunsFromClaudeEvidenceLedger(
  ledger: ClaudeInvocationEvidenceLedger,
  caseId: string
): ReceiptAgentRun[] {
  const verification = ledger.verifyChain();
  const records = ledger.records(caseId);
  if (records.length === 0) {
    throw new Error(`No Claude invocation evidence exists for decision case ${caseId}`);
  }
  return records.map((record) => receiptAgentRunFromClaudeEvidence(
    record.evidence,
    caseId,
    auditCommitment(record, verification)
  ));
}
