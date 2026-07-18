import { describe, expect, it } from "vitest";
import { runSyntheticJudgeCase } from "../src/demo/synthetic-judge-case.js";
import { PAPER_STUDY_REGISTERED_AT_TS_MS } from "../src/harness/paper-study-ledger.js";
import { verifyDecisionReceipt } from "../src/proof/decision-receipt-schema.js";

describe("synthetic judge case", () => {
  it("runs the frozen paper path through verified settlement without any external boundary", async () => {
    const report = await runSyntheticJudgeCase();

    expect(report).toMatchObject({
      synthetic: true,
      performanceUse: "excluded_synthetic",
      protocolStatus: "registered",
      realMoneyGate: "closed",
      boundaries: {
        triageStubCalls: 1,
        analystStubCalls: 1,
        anthropicCalls: 0,
        txlineApiCalls: 0,
        polymarketApiCalls: 0,
        walletCalls: 0,
        solanaRpcCalls: 0,
        realOrders: 0
      },
      runtime: {
        rawSignals: 1,
        normalizedSignals: 1,
        routedSignals: 1,
        closeMarks: 1,
        settlements: 1,
        finalLifecycleStatus: expect.stringMatching(/^(filled|partial)_settled$/),
        ledgerHashSchemaVersions: [2]
      },
      receiptVerification: {
        valid: true,
        synthetic: true,
        solanaAnchorMetadataPresent: false,
        solanaNetworkVerificationPerformed: false
      }
    });
    expect(report.runtime.canonicalEventsPublished).toBeGreaterThan(15);
    expect(report.runtime.ledgerRows).toBe(12);
    expect(report.receipt.generatedAtTsMs).toBeGreaterThanOrEqual(PAPER_STUDY_REGISTERED_AT_TS_MS);
    expect(report.receipt.sourceEvidence.every((source) =>
      source.sourceTsMs >= PAPER_STUDY_REGISTERED_AT_TS_MS &&
      source.observedAtTsMs >= PAPER_STUDY_REGISTERED_AT_TS_MS
    )).toBe(true);
    expect(report.receipt.ledger.caseEntries.every((entry) =>
      entry.atTsMs >= PAPER_STUDY_REGISTERED_AT_TS_MS &&
      entry.insertedAtMs >= PAPER_STUDY_REGISTERED_AT_TS_MS
    )).toBe(true);
    expect(verifyDecisionReceipt(report.receipt)).toEqual(report.receiptVerification);
  });

  it("emits a public-safe receipt with only commitments and bucketed TXLine movement", async () => {
    const { receipt } = await runSyntheticJudgeCase();
    const serialized = JSON.stringify(receipt);

    for (const forbidden of [
      "fairProbability",
      "consensusProbability",
      "polymarketProbability",
      "limitProbability",
      "rawGap",
      "crossMarketGapBps",
      "\"Pct\"",
      "\"Prices\""
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(receipt.disclosure).toEqual({
      policy: "hashes_and_derived_signals_only",
      rawTxlineFieldsIncluded: false
    });
    expect(receipt.lifecycle.signal.derivedEvidence.txlineMovementBucketBps).toBe(25);
    expect(receipt.provenance.label).toContain("SYNTHETIC JUDGE CASE");
  });

  it("produces the same committed receipt and ledger head on every run", async () => {
    const first = await runSyntheticJudgeCase();
    const second = await runSyntheticJudgeCase();

    expect(second.receipt.integrity.receiptHash).toBe(first.receipt.integrity.receiptHash);
    expect(second.runtime.ledgerHeadSha256).toBe(first.runtime.ledgerHeadSha256);
    expect(second.receipt).toEqual(first.receipt);
  });
});
