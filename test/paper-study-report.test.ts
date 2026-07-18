import { describe, expect, it } from "vitest";
import { initializePaperStudyLedger } from "../src/harness/paper-study-ledger.js";
import { evaluatePaperStudy } from "../src/metrics/paper-study.js";
import {
  renderPaperStudyEvidence,
  type PaperStudyEvidenceArtifact
} from "../src/metrics/paper-study-report.js";

function artifact(): PaperStudyEvidenceArtifact {
  const bounty = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 1_000, testOnlyAllowPreRegistrationStart: true });
  const longRun = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 1_000, testOnlyAllowPreRegistrationStart: true });
  try {
    return {
      generatedAt: "2026-07-12T12:00:00.000Z",
      protocolVersion: bounty.initialization.protocolVersion,
      configHash: bounty.initialization.configHash,
      realMoneyGate: "closed",
      fixtureUniverseGeneratedAt: "2026-07-12T11:00:00.000Z",
      lanes: {
        bounty: {
          initialization: bounty.initialization,
          chain: bounty.ledger.verifyChain(),
          report: evaluatePaperStudy({ lane: "bounty", observations: [] })
        },
        longRun: {
          initialization: longRun.initialization,
          chain: longRun.ledger.verifyChain(),
          report: evaluatePaperStudy({ lane: "long_run", observations: [] })
        }
      }
    };
  } finally {
    bounty.ledger.close();
    longRun.ledger.close();
  }
}

describe("paper-study evidence report", () => {
  it("renders chain evidence while keeping long-run endpoints sealed", () => {
    const markdown = renderPaperStudyEvidence(artifact());
    expect(markdown).toContain("Real-money gate: **CLOSED**");
    expect(markdown).toContain("Long-Run Profitability Lane");
    expect(markdown).toContain("Primary endpoints and per-match rows are sealed");
    expect(markdown).toContain("0 matches / 0 signals");
  });

  it("refuses to render a sealed report carrying leaked rows", () => {
    const value = artifact();
    value.lanes.longRun.report.rows = [{
      fixtureId: "leaked-fixture",
      kickoffTsMs: 1_000,
      selectedLineMilli: 2_500,
      signals: 1,
      fills: 0,
      fillRate: 0,
      meanHalfSpreadBps: null,
      meanSlippageBps: null,
      grossClvBps: null,
      netClvBps: null,
      settlementPnlMicroUsd: null,
      netReturnBps: null
    }];
    expect(() => renderPaperStudyEvidence(value)).toThrow(/unsealed results/);
  });
});
