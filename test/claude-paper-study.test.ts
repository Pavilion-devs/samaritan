import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicMessagesClient,
  type ClaudeInvocationEvidence,
  type ClaudeMessagesClient
} from "../src/agents/claude.js";
import { ClaudeSpendLedger } from "../src/agents/claude-spend-ledger.js";
import { ClaudeInvocationEvidenceLedger } from "../src/agents/claude-evidence-ledger.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { createPersistentClaudePaperStudy } from "../src/harness/claude-paper-study.js";
import type { PaperFixtureUniverse } from "../src/harness/paper-fixture-universe.js";
import { initializePaperStudyLedger } from "../src/harness/paper-study-ledger.js";
import type { PaperStudyInitialization } from "../src/harness/paper-study-ledger.js";

const fixtureId = "future-fixture";
const marketKey = `${fixtureId}:total_goals:full_time:2500`;

function universe(): PaperFixtureUniverse {
  return {
    generatedAt: "2026-07-12T00:00:00.000Z",
    laneStartTsMs: 1_000,
    selectorConfig: {
      minimumCoveragePoints: 1_000,
      minimumVolume: 0,
      minimumLiquidity: 0,
      maximumDistanceFromEven: 0.15,
      weights: { balance: 1, volume: 0, liquidity: 0, coverage: 0 }
    },
    fixtures: [{
      fixtureId,
      home: "Home",
      away: "Away",
      kickoffTsMs: 2_000_000,
      eventSlugs: ["future-event"],
      mappingStatus: "verified",
      selectedTotal: {
        marketId: "market-1",
        marketKey,
        conditionId: "condition-1",
        lineMilli: 2_500,
        preKickoffOverProbability: 0.5,
        preKickoffPointTsMs: 10_000,
        coveragePoints: 2_000,
        assetIds: ["over", "under"]
      },
      evidenceGrade: "paired_order_books",
      capabilities: {
        signalResearchReplay: true,
        executablePaperReplay: true,
        kickoffCloseReplay: true,
        publicResolutionReplay: true
      },
      bountyLane: {
        mode: "executable_book_replay",
        exploratory: true,
        reason: "test"
      },
      longRunLane: { eligible: true, reason: null },
      pairedCapture: {
        runId: "paired-future-fixture",
        status: "verified",
        fixtureId,
        eventSlug: "future-event",
        logComplete: true,
        mappingConfirmed: true,
        identityParity: true,
        replayMode: "capture-order-per-source",
        rows: 10,
        firstPolymarketObservedTsMs: 1,
        lastPolymarketObservedTsMs: 1_999_999,
        firstTxlineOddsObservedTsMs: 2,
        lastTxlineOddsObservedTsMs: 1_999_999,
        firstTxlineScoresObservedTsMs: 3,
        lastTxlineScoresObservedTsMs: 1_999_999,
        selectedTotal: {
          eventSlug: "future-event",
          marketId: "market-1",
          conditionId: "condition-1",
          lineMilli: 2_500,
          assetIds: ["over", "under"]
        },
        selectedBookDepthComplete: true,
        exactFixtureTxlineOddsAvailable: true,
        exactFixtureTxlineScoresAvailable: true,
        exactFixtureScoreCompleted: true,
        proofCommitment: "a".repeat(64),
        kickoffCloseAvailable: true,
        publicResolutionAvailable: true,
        publicMarketResolvedNormalized: true
      }
    }],
    summary: {
      fixtures: 1,
      pairedBookReplays: 1,
      executableBookReplays: 1,
      bookLifecycleReplays: 0,
      signalResearchOnly: 0,
      unavailable: 0,
      longRunEligible: 1
    }
  };
}

function signal(
  id: string,
  fixture = fixtureId,
  eligibility: DetectorSignal["eligibility"] = "pretrade_review_required"
): DetectorSignal {
  return {
    signalId: id,
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: 10_000,
    observedAtTsMs: 10_000,
    fixtureId: fixture,
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: fixture === fixtureId ? marketKey : `${fixture}:total_goals:full_time:2500`
    },
    outcome: "over",
    direction: "buy",
    eligibility,
    reason: "test",
    evidence: {
      consensusProbability: 0.55,
      polymarketProbability: 0.51,
      consensusVelocity: 0.01,
      consensusZScore: 1.2,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0.001,
      cusumDown: 0,
      rawGap: 0.04,
      gapBasis: "live_book",
      persistenceMs: 0,
      mappingStatus: "verified",
      scoreContextActions: []
    }
  };
}

function triageDropMessage(): Message {
  return {
    id: "msg-triage",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{
      type: "tool_use",
      id: "tool-triage",
      name: "submit_triage",
      input: { decision: "drop", priority: "low", rationale: "Test drop." },
      caller: { type: "direct" }
    }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      service_tier: "standard"
    }
  } as Message;
}

describe("persistent Claude paper study composition", () => {
  it("refuses real Anthropic clients while the corrected protocol is unregistered", () => {
    const bounty = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 1_000 });
    const longRun = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 1_000 });
    const spendLedger = new ClaudeSpendLedger(":memory:");
    const evidenceLedger = new ClaudeInvocationEvidenceLedger(":memory:");
    try {
      expect(() => createPersistentClaudePaperStudy({
        apiKey: "not-a-real-key",
        spendLedger,
        bounty,
        longRun,
        universe: universe(),
        feeResolver: async () => { throw new Error("unused"); },
        maximumPendingMs: 5_000
      })).toThrow(/API use is disabled.*engineering_candidate_unregistered/);
      expect(() => createPersistentClaudePaperStudy({
        client: createAnthropicMessagesClient("not-a-real-key"),
        spendLedger,
        bounty,
        longRun,
        universe: universe(),
        feeResolver: async () => { throw new Error("unused"); },
        evidenceLedger,
        maximumPendingMs: 5_000
      })).toThrow(/API use is disabled.*engineering_candidate_unregistered/);
      expect(spendLedger.verifyChain()).toMatchObject({ valid: true, rows: 0 });
      expect(evidenceLedger.verifyChain()).toMatchObject({ valid: true, rows: 0 });
    } finally {
      bounty.ledger.close();
      longRun.ledger.close();
      spendLedger.close();
      evidenceLedger.close();
    }
  });

  it("requires a durable evidence ledger instead of a callback for a real client", () => {
    const bounty = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 1_000 });
    const longRun = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 1_000 });
    const spendLedger = new ClaudeSpendLedger(":memory:");
    const asRegistered = (value: PaperStudyInitialization): PaperStudyInitialization => ({
      ...value,
      protocolStatus: "registered"
    } as unknown as PaperStudyInitialization);
    try {
      expect(() => createPersistentClaudePaperStudy({
        apiKey: "not-a-real-key",
        spendLedger,
        bounty: { ...bounty, initialization: asRegistered(bounty.initialization) },
        longRun: { ...longRun, initialization: asRegistered(longRun.initialization) },
        universe: universe(),
        feeResolver: async () => { throw new Error("unused"); },
        evidenceSink: () => undefined,
        maximumPendingMs: 5_000
      })).toThrow(/requires an opened persistent invocation-evidence ledger/);
      expect(spendLedger.verifyChain()).toMatchObject({ valid: true, rows: 0 });
    } finally {
      bounty.ledger.close();
      longRun.ledger.close();
      spendLedger.close();
    }
  });

  it("rejects a closed persistent invocation-evidence ledger at construction", () => {
    const bounty = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 1_000 });
    const longRun = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 1_000 });
    const spendLedger = new ClaudeSpendLedger(":memory:");
    const evidenceLedger = new ClaudeInvocationEvidenceLedger(":memory:");
    evidenceLedger.close();
    try {
      expect(() => createPersistentClaudePaperStudy({
        client: { create: vi.fn() },
        spendLedger,
        bounty,
        longRun,
        universe: universe(),
        feeResolver: async () => { throw new Error("unused"); },
        evidenceLedger,
        maximumPendingMs: 5_000
      })).toThrow();
      expect(spendLedger.verifyChain()).toMatchObject({ valid: true, rows: 0 });
    } finally {
      bounty.ledger.close();
      longRun.ledger.close();
      spendLedger.close();
    }
  });

  it("shares one bounded client and spend chain across isolated paper lanes", async () => {
    const bounty = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 1_000 });
    const longRun = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 1_000 });
    const spendLedger = new ClaudeSpendLedger(":memory:");
    const create = vi.fn(async () => triageDropMessage());
    const client: ClaudeMessagesClient = { create };
    const invocationEvidence: ClaudeInvocationEvidence[] = [];
    const study = createPersistentClaudePaperStudy({
      client,
      spendLedger,
      bounty,
      longRun,
      universe: universe(),
      feeResolver: async () => { throw new Error("unused"); },
      evidenceSink: (evidence) => { invocationEvidence.push(evidence); },
      maximumPendingMs: 5_000
    });
    try {
      expect(study.invocationEvidence).toBeNull();
      expect(study.bounty.scheduler.dependencies.pipeline.dependencies.triageAgent).toBe(study.agents.triage);
      expect(study.longRun.scheduler.dependencies.pipeline.dependencies.analystAgent).toBe(study.agents.analyst);

      await expect(study.bounty.scheduler.enqueue(signal("ineligible", "other"))).resolves.toBe(false);
      await expect(study.bounty.scheduler.enqueue(
        signal("research-only", fixtureId, "research_only")
      )).resolves.toBe(false);
      expect(create).not.toHaveBeenCalled();
      expect(spendLedger.verifyChain()).toMatchObject({ valid: true, rows: 0 });

      await expect(study.bounty.scheduler.enqueue(signal("bounty-signal"))).resolves.toBe(true);
      await expect(study.longRun.scheduler.enqueue(signal("long-run-signal"))).resolves.toBe(true);
      expect(create).toHaveBeenCalledTimes(2);
      expect(invocationEvidence).toHaveLength(2);
      expect(invocationEvidence.map((evidence) => evidence.invocationClass))
        .toEqual(["injected_client", "injected_client"]);
      expect(new Set(invocationEvidence.map((evidence) => evidence.caseId)).size).toBe(2);
      expect(spendLedger.verifyChain()).toMatchObject({ valid: true, rows: 4 });
      expect(spendLedger.summary().outstandingReservedNanoUsd).toBe(0);
      expect(bounty.ledger.entries().map((entry) => entry.kind)).toEqual([
        "study_initialized",
        "signal_received",
        "triage_decision",
        "case_terminal"
      ]);
      expect(longRun.ledger.entries().map((entry) => entry.kind)).toEqual([
        "study_initialized",
        "signal_received",
        "triage_decision",
        "case_terminal"
      ]);
    } finally {
      bounty.ledger.close();
      longRun.ledger.close();
      spendLedger.close();
    }
  });

  it("rejects a spend ledger configured above the locked project ceiling", () => {
    const bounty = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 1_000 });
    const longRun = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 1_000 });
    const spendLedger = new ClaudeSpendLedger(":memory:", 300_000_000_001);
    try {
      expect(() => createPersistentClaudePaperStudy({
        client: { create: vi.fn() },
        spendLedger,
        bounty,
        longRun,
        universe: universe(),
        feeResolver: async () => { throw new Error("unused"); },
        maximumPendingMs: 5_000
      })).toThrow(/locked project maximum/);
    } finally {
      bounty.ledger.close();
      longRun.ledger.close();
      spendLedger.close();
    }
  });
});
