import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stableJson } from "../src/domain/json.js";
import {
  decisionReceiptBodySchema,
  hashDecisionReceiptBody,
  verifyDecisionReceipt,
  type DecisionReceipt
} from "../src/proof/decision-receipt-schema.js";
import { buildSyntheticDecisionReceipt } from "../src/proof/synthetic-decision-receipt.js";

function clone(): DecisionReceipt {
  return structuredClone(buildSyntheticDecisionReceipt());
}

function rehash(receipt: DecisionReceipt): void {
  const { integrity: _integrity, ...bodyValue } = receipt;
  const body = decisionReceiptBodySchema.parse(bodyValue);
  receipt.integrity.receiptHash = hashDecisionReceiptBody(body);
}

function recursiveKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...recursiveKeys(child)
  ]);
}

describe("decision receipt v1", () => {
  it("verifies the frozen synthetic proving fixture without claiming real evidence", () => {
    const built = buildSyntheticDecisionReceipt();
    const frozen = JSON.parse(readFileSync(
      join(process.cwd(), "proof/fixtures/decision-receipt.synthetic.v1.json"),
      "utf8"
    )) as unknown;

    expect(stableJson(frozen)).toBe(stableJson(built));
    expect(verifyDecisionReceipt(frozen)).toEqual({
      valid: true,
      receiptHash: built.integrity.receiptHash,
      committedLedgerHead: built.ledger.finalHeadHash,
      lifecycleStatus: "filled_settled",
      synthetic: true,
      solanaAnchorMetadataPresent: false,
      solanaNetworkVerificationPerformed: false,
      assurance: [
        "receipt_schema_and_canonical_hash_verified",
        "lifecycle_and_commitment_consistency_verified",
        "source_payloads_and_local_ledger_not_replayed_by_offline_verifier"
      ]
    });
    expect(built.provenance).toMatchObject({
      evidenceClass: "synthetic_proving_fixture",
      synthetic: true,
      performanceUse: "excluded_synthetic"
    });
    expect(built.agents.runs.every((run) =>
      run.invocationClass === "synthetic_stub" && run.actualCostNanoUsd === 0
    )).toBe(true);
  });

  it("requires captured Claude claims to disclose one local audit-chain boundary", () => {
    const receipt = clone();
    receipt.provenance = {
      evidenceClass: "captured_paper_case",
      synthetic: false,
      performanceUse: "excluded_unregistered",
      label: "Captured structural test; not provider attestation."
    };
    const entryHashes = ["a".repeat(64), "b".repeat(64)];
    for (const [index, run] of receipt.agents.runs.entries()) {
      run.invocationClass = "anthropic_api";
      run.localInvocationAudit = {
        assurance:
          "local_hash_chain_reference_generated_after_verification_not_offline_membership_or_provider_attestation",
        sequence: index + 1,
        insertedAtTsMs: 1_700_000_000_100 + index,
        previousHash: index === 0 ? "0".repeat(64) : entryHashes[index - 1]!,
        entryHash: entryHashes[index]!,
        ledgerRowsAtGeneration: 2,
        ledgerHeadHash: entryHashes[1]!
      };
    }
    rehash(receipt);
    expect(verifyDecisionReceipt(receipt)).toMatchObject({ valid: true, synthetic: false });

    delete receipt.agents.runs[0]!.localInvocationAudit;
    rehash(receipt);
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/local invocation-ledger reference/);
  });

  it("recursively excludes exact TXLine levels, reconstructive gaps, and raw fields", () => {
    const receipt = buildSyntheticDecisionReceipt();
    const receiptJson = JSON.stringify(receipt);
    const keys = recursiveKeys(receipt);
    for (const forbiddenKey of [
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
      "gapBps"
    ]) expect(keys).not.toContain(forbiddenKey);
    expect(receiptJson).not.toContain("private-txline-signal-source");
    expect(receiptJson).toContain("payloadSha256");
    expect(receipt.lifecycle.signal.derivedEvidence).toMatchObject({
      txlineMovementBucketBps: 25,
      relativeValueDirection: "consensus_above_venue"
    });
    for (const movement of [
      receipt.lifecycle.signal.derivedEvidence.consensusVelocityBucketBps,
      receipt.lifecycle.signal.derivedEvidence.polymarketVelocityBucketBps
    ]) {
      if (movement !== null) expect(movement % 25).toBe(0);
    }
  });

  it.each([
    ["code hash", (receipt: DecisionReceipt) => { receipt.build.codeSha256 = "1".repeat(64); }],
    ["config hash", (receipt: DecisionReceipt) => { receipt.build.configSha256 = "2".repeat(64); }],
    ["source payload", (receipt: DecisionReceipt) => { receipt.sourceEvidence[0]!.payloadSha256 = "3".repeat(64); }],
    ["signal evidence", (receipt: DecisionReceipt) => { receipt.lifecycle.signal.derivedEvidence.consensusVelocityBucketBps! += 25; }],
    ["prompt version", (receipt: DecisionReceipt) => { receipt.agents.runs[0]!.promptVersion = "tampered"; }],
    ["agent cost", (receipt: DecisionReceipt) => { receipt.agents.runs[0]!.actualCostNanoUsd += 1; }],
    ["thesis", (receipt: DecisionReceipt) => { receipt.lifecycle.thesis!.thesisPayloadSha256 = "6".repeat(64); }],
    ["risk verdict", (receipt: DecisionReceipt) => { receipt.lifecycle.risk!.stakeMicroUsd! -= 1; }],
    ["execution intent", (receipt: DecisionReceipt) => { receipt.lifecycle.intent!.stakeMicroUsd -= 1; }],
    ["post-readiness evidence", (receipt: DecisionReceipt) => { receipt.lifecycle.execution!.bookObservedTsMs += 1; }],
    ["fill", (receipt: DecisionReceipt) => { receipt.lifecycle.execution!.grossMicroUsd -= 1; }],
    ["close", (receipt: DecisionReceipt) => { receipt.lifecycle.close!.closeBid -= 0.01; }],
    ["settlement", (receipt: DecisionReceipt) => { receipt.lifecycle.settlement!.pnlMicroUsd -= 1; }],
    ["ledger head", (receipt: DecisionReceipt) => { receipt.ledger.finalHeadHash = "4".repeat(64); }]
  ])("detects %s tampering through the canonical receipt hash", (_label, mutate) => {
    const receipt = clone();
    mutate(receipt);
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/canonical hash mismatch|Invalid input/);
  });

  it("rejects reordered lifecycle commitments even when an attacker recomputes the receipt hash", () => {
    const receipt = clone();
    [receipt.lifecycle.orderedEventKinds[4], receipt.lifecycle.orderedEventKinds[5]] = [
      receipt.lifecycle.orderedEventKinds[5]!,
      receipt.lifecycle.orderedEventKinds[4]!
    ];
    [receipt.ledger.caseEntries[4], receipt.ledger.caseEntries[5]] = [
      receipt.ledger.caseEntries[5]!,
      receipt.ledger.caseEntries[4]!
    ];
    rehash(receipt);
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/ordering|sequences|hashes/);
  });

  it("rejects post-readiness look-ahead even when all disclosed timestamps are rehashed", () => {
    const receipt = clone();
    const ineligibleTsMs = receipt.lifecycle.analysis!.orderEligibleAtTsMs - 1;
    const execution = receipt.lifecycle.execution!;
    execution.bookObservedTsMs = ineligibleTsMs;
    const source = receipt.sourceEvidence.find((item) =>
      item.evidenceRefSha256 === execution.bookEvidenceRefSha256
    )!;
    source.observedAtTsMs = ineligibleTsMs;
    rehash(receipt);
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/precedes analysis readiness or venue delay/);
  });

  it("rejects inconsistent model cost even when the receipt is rehashed", () => {
    const receipt = clone();
    receipt.agents.runs[0]!.usage.inputTokens = 1;
    receipt.agents.totalActualCostNanoUsd = 0;
    rehash(receipt);
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/Agent cost/);
  });

  it("validates optional anchor metadata but explicitly performs no Solana network check", () => {
    const receipt = clone();
    receipt.solanaAnchor = {
      network: "devnet",
      transactionSignature: "1".repeat(64),
      slot: 123,
      blockTimeTsMs: receipt.generatedAtTsMs + 1,
      memoProgramId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      commitmentType: "decision_ledger_head_sha256",
      committedHash: receipt.ledger.finalHeadHash,
      networkVerification: "not_performed_by_offline_verifier"
    };
    rehash(receipt);
    expect(verifyDecisionReceipt(receipt)).toMatchObject({
      solanaAnchorMetadataPresent: true,
      solanaNetworkVerificationPerformed: false
    });

    receipt.solanaAnchor.committedHash = "5".repeat(64);
    rehash(receipt);
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/does not commit the receipt ledger head/);
  });

  it("rejects unknown fields under the strict public schema", () => {
    const receipt = clone() as DecisionReceipt & { rawTxlinePayload?: unknown };
    receipt.rawTxlinePayload = { Pct: [55, 45] };
    expect(() => verifyDecisionReceipt(receipt)).toThrow(/Unrecognized key/);
  });
});
