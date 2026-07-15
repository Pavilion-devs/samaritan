import { describe, expect, it } from "vitest";
import type { DetectorSignal } from "../src/detectors/types.js";
import type { PaperFixtureUniverse } from "../src/harness/paper-fixture-universe.js";
import {
  applyPaperFixtureAdmission,
  createPersistentPaperLaneRuntime,
  planPaperFixtureAdmission
} from "../src/harness/paper-lane-runtime.js";
import { initializePaperStudyLedger } from "../src/harness/paper-study-ledger.js";

function fixture(input: {
  fixtureId: string;
  kickoffTsMs: number;
  bountyMode: "executable_book_replay" | "book_lifecycle_replay" | "signal_research_only";
  longRunEligible?: boolean;
}): PaperFixtureUniverse["fixtures"][number] {
  return {
    fixtureId: input.fixtureId,
    home: "Home",
    away: "Away",
    kickoffTsMs: input.kickoffTsMs,
    eventSlugs: [`event-${input.fixtureId}`],
    mappingStatus: "verified",
    selectedTotal: {
      marketId: `market-${input.fixtureId}`,
      marketKey: `${input.fixtureId}:total_goals:full_time:2500`,
      conditionId: `condition-${input.fixtureId}`,
      lineMilli: 2_500,
      preKickoffOverProbability: 0.5,
      preKickoffPointTsMs: input.kickoffTsMs - 600_000,
      coveragePoints: 2_000,
      assetIds: [`over-${input.fixtureId}`, `under-${input.fixtureId}`]
    },
    evidenceGrade: input.bountyMode === "signal_research_only" ? "sampled_price_history" : "paired_order_books",
    capabilities: {
      signalResearchReplay: true,
      executablePaperReplay: input.bountyMode === "executable_book_replay",
      kickoffCloseReplay: input.bountyMode !== "signal_research_only",
      publicResolutionReplay: input.bountyMode !== "signal_research_only"
    },
    bountyLane: {
      mode: input.bountyMode,
      exploratory: true,
      reason: "test"
    },
    longRunLane: {
      eligible: input.longRunEligible ?? false,
      reason: input.longRunEligible ? null : "predates_long_run_lane_start"
    },
    pairedCapture: input.bountyMode === "signal_research_only" ? null : {
      runId: `paired-${input.fixtureId}`,
      status: "verified",
      fixtureId: input.fixtureId,
      eventSlug: `event-${input.fixtureId}`,
      logComplete: true,
      mappingConfirmed: true,
      identityParity: true,
      replayMode: "capture-order-per-source",
      rows: 10,
      firstPolymarketObservedTsMs: 1,
      lastPolymarketObservedTsMs: Math.max(4, input.kickoffTsMs - 1),
      firstTxlineOddsObservedTsMs: 2,
      lastTxlineOddsObservedTsMs: Math.max(4, input.kickoffTsMs - 1),
      firstTxlineScoresObservedTsMs: 3,
      lastTxlineScoresObservedTsMs: Math.max(4, input.kickoffTsMs - 1),
      selectedTotal: {
        eventSlug: `event-${input.fixtureId}`,
        marketId: `market-${input.fixtureId}`,
        conditionId: `condition-${input.fixtureId}`,
        lineMilli: 2_500,
        assetIds: [`over-${input.fixtureId}`, `under-${input.fixtureId}`]
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
  };
}

function universe(fixtures: PaperFixtureUniverse["fixtures"]): PaperFixtureUniverse {
  return {
    generatedAt: "2026-07-12T00:00:00.000Z",
    laneStartTsMs: 10_000,
    selectorConfig: {
      minimumCoveragePoints: 1_000,
      minimumVolume: 0,
      minimumLiquidity: 0,
      maximumDistanceFromEven: 0.15,
      weights: { balance: 1, volume: 0, liquidity: 0, coverage: 0 }
    },
    fixtures,
    summary: {
      fixtures: fixtures.length,
      pairedBookReplays: fixtures.filter((item) => item.evidenceGrade === "paired_order_books").length,
      executableBookReplays: fixtures.filter((item) => item.bountyLane.mode === "executable_book_replay").length,
      bookLifecycleReplays: fixtures.filter((item) => item.bountyLane.mode === "book_lifecycle_replay").length,
      signalResearchOnly: fixtures.filter((item) => item.bountyLane.mode === "signal_research_only").length,
      unavailable: 0,
      longRunEligible: 0
    }
  };
}

describe("persistent paper lane runtime", () => {
  it("physically excludes sampled-history fixtures from the bounty executor", () => {
    const handle = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 10_000 });
    const runtime = createPersistentPaperLaneRuntime({
      lane: "bounty",
      initialization: handle.initialization,
      universe: universe([
        fixture({ fixtureId: "paired", kickoffTsMs: 20_000, bountyMode: "executable_book_replay" }),
        fixture({ fixtureId: "sampled", kickoffTsMs: 30_000, bountyMode: "signal_research_only" })
      ]),
      ledger: handle.ledger,
      triageAgent: { triage: async () => ({ decision: "drop", priority: "normal", rationale: "test" }) },
      analystAgent: { investigate: async () => { throw new Error("unused"); } },
      feeResolver: async () => { throw new Error("unused"); },
      executionLatencyMs: 500,
      maximumPendingMs: 5_000
    });
    expect(runtime.fixtures.map((item) => item.fixtureId)).toEqual(["paired"]);
    expect(runtime.scheduler.dependencies.config.eligibleMarketKeys).toEqual(
      new Set(["paired:total_goals:full_time:2500"])
    );
    handle.ledger.close();
  });

  it("starts a long-run runtime empty when no post-start fixture is eligible", () => {
    const handle = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 10_000 });
    const runtime = createPersistentPaperLaneRuntime({
      lane: "long_run",
      initialization: handle.initialization,
      universe: universe([fixture({ fixtureId: "past", kickoffTsMs: 9_000, bountyMode: "executable_book_replay" })]),
      ledger: handle.ledger,
      triageAgent: { triage: async () => ({ decision: "drop", priority: "normal", rationale: "test" }) },
      analystAgent: { investigate: async () => { throw new Error("unused"); } },
      feeResolver: async () => { throw new Error("unused"); },
      executionLatencyMs: 500,
      maximumPendingMs: 5_000
    });
    expect(runtime.fixtures).toEqual([]);
    expect(runtime.scheduler.dependencies.config.eligibleMarketKeys.size).toBe(0);
    handle.ledger.close();
  });

  it("admits a newly verified executable fixture without changing prior identities", () => {
    const handle = initializePaperStudyLedger({ path: ":memory:", lane: "long_run", startedAtTsMs: 10_000 });
    const runtime = createPersistentPaperLaneRuntime({
      lane: "long_run",
      initialization: handle.initialization,
      universe: universe([]),
      ledger: handle.ledger,
      triageAgent: { triage: async () => ({ decision: "drop", priority: "normal", rationale: "test" }) },
      analystAgent: { investigate: async () => { throw new Error("unused"); } },
      feeResolver: async () => { throw new Error("unused"); },
      executionLatencyMs: 500,
      maximumPendingMs: 5_000
    });
    const admitted = fixture({
      fixtureId: "future",
      kickoffTsMs: 20_000,
      bountyMode: "executable_book_replay",
      longRunEligible: true
    });
    const refreshed = universe([admitted]);
    const plan = planPaperFixtureAdmission(runtime, refreshed);
    expect(applyPaperFixtureAdmission(runtime, plan)).toEqual(["future"]);
    expect(runtime.eligibleMarketKeys).toEqual(new Set(["future:total_goals:full_time:2500"]));
    expect(runtime.kickoffByFixtureId).toEqual(new Map([["future", 20_000]]));
    expect(planPaperFixtureAdmission(runtime, refreshed).fixtures).toEqual([]);

    const changed = structuredClone(refreshed);
    changed.fixtures[0]!.selectedTotal.conditionId = "changed-condition";
    expect(() => planPaperFixtureAdmission(runtime, changed)).toThrow(/changed admitted fixture/);
    handle.ledger.close();
  });

  it("rehydrates committed seen cases before admitting any repeated model work", async () => {
    const handle = initializePaperStudyLedger({ path: ":memory:", lane: "bounty", startedAtTsMs: 10_000 });
    const admitted = fixture({
      fixtureId: "restart",
      kickoffTsMs: 20_000_000,
      bountyMode: "executable_book_replay"
    });
    const fixtureUniverse = universe([admitted]);
    const candidate: DetectorSignal = {
      signalId: "lane-restart-signal",
      kind: "CONSENSUS_MOVE",
      detectedAtTsMs: 11_000,
      observedAtTsMs: 11_000,
      fixtureId: "restart",
      market: {
        family: "total_goals",
        period: "full_time",
        lineMilli: 2_500,
        key: admitted.selectedTotal.marketKey
      },
      outcome: "over",
      direction: "buy",
      eligibility: "pretrade_review_required",
      reason: "restart test",
      evidence: {
        consensusProbability: 0.55,
        polymarketProbability: 0.52,
        consensusVelocity: 0.01,
        consensusZScore: 1.5,
        polymarketVelocity: 0,
        polymarketZScore: 0,
        cusumUp: 0.002,
        cusumDown: 0,
        rawGap: 0.03,
        gapBasis: "live_book",
        persistenceMs: 0,
        mappingStatus: "verified",
        scoreContextActions: []
      }
    };
    const first = createPersistentPaperLaneRuntime({
      lane: "bounty",
      initialization: handle.initialization,
      universe: fixtureUniverse,
      ledger: handle.ledger,
      triageAgent: { triage: async () => ({ decision: "drop", priority: "normal", rationale: "test drop" }) },
      analystAgent: { investigate: async () => { throw new Error("unused"); } },
      feeResolver: async () => { throw new Error("unused"); },
      executionLatencyMs: 500,
      maximumPendingMs: 5_000
    });
    expect(await first.scheduler.enqueue(candidate)).toBe(true);
    let triageCalls = 0;
    const restarted = createPersistentPaperLaneRuntime({
      lane: "bounty",
      initialization: handle.initialization,
      universe: fixtureUniverse,
      ledger: handle.ledger,
      triageAgent: {
        triage: async () => {
          triageCalls += 1;
          return { decision: "drop", priority: "normal", rationale: "should not run" };
        }
      },
      analystAgent: { investigate: async () => { throw new Error("unused"); } },
      feeResolver: async () => { throw new Error("unused"); },
      executionLatencyMs: 500,
      maximumPendingMs: 5_000
    });
    expect(restarted.rehydratedState.seenSignalIds).toEqual([candidate.signalId]);
    expect(restarted.scheduler.seenCount()).toBe(1);
    expect(await restarted.scheduler.enqueue(candidate)).toBe(false);
    expect(triageCalls).toBe(0);
    handle.ledger.close();
  });
});
