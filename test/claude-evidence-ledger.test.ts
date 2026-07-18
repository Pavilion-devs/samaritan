import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { ClaudeInvocationEvidence } from "../src/agents/claude.js";
import { ClaudeInvocationEvidenceLedger } from "../src/agents/claude-evidence-ledger.js";
import { CLAUDE_MODEL } from "../src/agents/claude-pricing.js";
import {
  receiptAgentRunsFromClaudeEvidenceLedger
} from "../src/proof/claude-invocation-evidence.js";

function evidence(stage: "triage" | "analyst"): ClaudeInvocationEvidence {
  return {
    caseId: "case-1",
    stage,
    invocationClass: "anthropic_api",
    model: stage === "triage" ? CLAUDE_MODEL.triage : CLAUDE_MODEL.analyst,
    promptVersion: `${stage}-v1`,
    promptSha256: (stage === "triage" ? "1" : "2").repeat(64),
    responseSha256: (stage === "triage" ? "3" : "4").repeat(64),
    billingEvidenceSha256: (stage === "triage" ? "5" : "6").repeat(64),
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0
    },
    actualCostNanoUsd: stage === "triage" ? 200_000 : 1_000_000
  };
}

describe("Claude invocation evidence ledger", () => {
  it("persists hash-only evidence idempotently in one append-only chain", () => {
    const ledger = new ClaudeInvocationEvidenceLedger(":memory:");
    ledger.append(evidence("triage"), 1);
    ledger.append(evidence("triage"), 2);
    ledger.append(evidence("analyst"), 3);

    expect(ledger.entries("case-1")).toEqual([evidence("triage"), evidence("analyst")]);
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 2 });
    expect(() => ledger.append({
      ...evidence("triage"),
      responseSha256: "9".repeat(64)
    }, 4)).toThrow(/collision/);
    ledger.close();
  });

  it("supplies one verified case's real invocation runs to receipt generation", () => {
    const ledger = new ClaudeInvocationEvidenceLedger(":memory:");
    ledger.append(evidence("triage"), 1);
    ledger.append(evidence("analyst"), 2);

    expect(receiptAgentRunsFromClaudeEvidenceLedger(ledger, "case-1")).toEqual([
      expect.objectContaining({
        stage: "triage",
        invocationClass: "anthropic_api",
        model: CLAUDE_MODEL.triage,
        actualCostNanoUsd: 200_000,
        localInvocationAudit: expect.objectContaining({
          assurance:
            "local_hash_chain_reference_generated_after_verification_not_offline_membership_or_provider_attestation",
          sequence: 1,
          ledgerRowsAtGeneration: 2
        })
      }),
      expect.objectContaining({
        stage: "analyst",
        invocationClass: "anthropic_api",
        model: CLAUDE_MODEL.analyst,
        actualCostNanoUsd: 1_000_000,
        localInvocationAudit: expect.objectContaining({
          sequence: 2,
          ledgerRowsAtGeneration: 2,
          ledgerHeadHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      })
    ]);
    expect(() => receiptAgentRunsFromClaudeEvidenceLedger(ledger, "missing-case"))
      .toThrow(/No Claude invocation evidence/);
    ledger.close();
  });

  it("rejects a stage/model mismatch", () => {
    const ledger = new ClaudeInvocationEvidenceLedger(":memory:");
    expect(() => ledger.append({
      ...evidence("triage"),
      model: CLAUDE_MODEL.analyst
    })).toThrow(/stage\/model mismatch/);
    ledger.close();
  });

  it("rejects cost evidence that does not match the measured model usage", () => {
    const ledger = new ClaudeInvocationEvidenceLedger(":memory:");
    expect(() => ledger.append({
      ...evidence("triage"),
      actualCostNanoUsd: 200_001
    })).toThrow(/cost does not match model usage/);
    ledger.close();
  });

  it.each([
    ["stored identity", "entry_id", "forged:triage"],
    ["insertion timestamp", "inserted_at_ms", 99]
  ])("detects tampering with the %s", (_label, column, value) => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-claude-evidence-"));
    const path = join(directory, "evidence.sqlite");
    const ledger = new ClaudeInvocationEvidenceLedger(path);
    ledger.append(evidence("triage"), 1);
    ledger.close();

    const database = new Database(path);
    database.exec("DROP TRIGGER claude_invocation_evidence_no_update");
    database.prepare(`UPDATE claude_invocation_evidence SET ${column} = ? WHERE sequence = 1`).run(value);
    database.close();

    const tampered = new ClaudeInvocationEvidenceLedger(path);
    expect(() => tampered.verifyChain()).toThrow(/Broken Claude invocation evidence/);
    tampered.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
