import { describe, expect, it } from "vitest";
import {
  PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS,
  PAPER_STUDY_TOTAL_SELECTOR_CONFIG
} from "../src/config/paper-study.js";
import {
  buildPaperFixtureUniverse,
  type PairedCaptureEvidence
} from "../src/harness/paper-fixture-universe.js";
import { sha256, type MappingRecord } from "../src/mapping/registry.js";
import type { TotalLineEvidence } from "../src/research/main-total-selector.js";

function mapping(fixtureId: string, slug: string, kickoffTsMs: number): MappingRecord {
  const rulesText = "Full-time total, regulation plus stoppage time only.";
  return {
    mappingId: `${fixtureId}:totals`,
    status: "candidate",
    txlineFixtureId: fixtureId,
    teams: {
      home: { canonical: `Home ${fixtureId}`, aliases: [] },
      away: { canonical: `Away ${fixtureId}`, aliases: [] }
    },
    kickoff: { txlineTsMs: kickoffTsMs, polymarketTsMs: kickoffTsMs },
    polymarketEventId: `event-${fixtureId}`,
    polymarketEventSlug: slug,
    conditions: [{
      polymarketMarketId: `market-${fixtureId}`,
      conditionId: `condition-${fixtureId}`,
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      rulesText,
      rulesSha256: sha256(rulesText),
      tokens: [
        { assetId: `over-${fixtureId}`, outcome: "over", role: "canonical" },
        { assetId: `under-${fixtureId}`, outcome: "under", role: "canonical" }
      ]
    }]
  };
}

function evidence(fixtureId: string, kickoffTsMs: number): TotalLineEvidence {
  const selectorCutoffTsMs = kickoffTsMs - PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS;
  return {
    fixtureId,
    marketId: `market-${fixtureId}`,
    marketKey: `${fixtureId}:total_goals:full_time:2500`,
    lineMilli: 2_500,
    mappingStatus: "candidate",
    txlineMarketObserved: true,
    selectorCutoffTsMs,
    preKickoffOverProbability: 0.52 as never,
    preKickoffPointTsMs: selectorCutoffTsMs,
    coverageFirstPointTsMs: selectorCutoffTsMs - 1_000,
    coverageLastPointTsMs: selectorCutoffTsMs,
    volume: 0,
    liquidity: 0,
    coveragePoints: 2_000
  };
}

function pairedCapture(
  fixtureId: string,
  eventSlug: string,
  kickoffTsMs: number,
  overrides: Partial<PairedCaptureEvidence> = {}
): PairedCaptureEvidence {
  const firstTsMs = Math.max(1, kickoffTsMs - 1_000_000);
  const lastTsMs = kickoffTsMs - 100_000;
  return {
    runId: `${fixtureId}-run`,
    status: "verified",
    fixtureId,
    eventSlug,
    logComplete: true,
    mappingConfirmed: false,
    identityParity: true,
    replayMode: "capture-order-per-source",
    rows: 100,
    firstPolymarketObservedTsMs: firstTsMs,
    lastPolymarketObservedTsMs: lastTsMs,
    firstTxlineOddsObservedTsMs: firstTsMs + 1,
    lastTxlineOddsObservedTsMs: lastTsMs,
    firstTxlineScoresObservedTsMs: firstTsMs + 2,
    lastTxlineScoresObservedTsMs: lastTsMs,
    selectedTotal: {
      eventSlug,
      marketId: `market-${fixtureId}`,
      conditionId: `condition-${fixtureId}`,
      lineMilli: 2_500,
      assetIds: [`over-${fixtureId}`, `under-${fixtureId}`]
    },
    selectedBookDepthComplete: true,
    exactFixtureTxlineOddsAvailable: true,
    exactFixtureTxlineScoresAvailable: true,
    exactFixtureScoreCompleted: true,
    proofCommitment: "a".repeat(64),
    kickoffCloseAvailable: true,
    publicResolutionAvailable: true,
    publicMarketResolvedNormalized: true,
    ...overrides
  };
}

describe("paper fixture evidence universe", () => {
  it("separates executable paired capture from sampled-history-only fixtures", () => {
    const paired = mapping("paired", "paired-slug", 2_000_000);
    const sampled = mapping("sampled", "sampled-slug", 3_000_000);
    const universe = buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 4_000_000,
      mappings: [paired, sampled],
      totalEvidence: [evidence("paired", 2_000_000), evidence("sampled", 3_000_000)],
      pairedCaptures: [pairedCapture("paired", "paired-slug", 2_000_000, {
        firstPolymarketObservedTsMs: 1_000,
        lastPolymarketObservedTsMs: 1_900_000,
        firstTxlineOddsObservedTsMs: 2_000,
        lastTxlineOddsObservedTsMs: 1_900_000,
        firstTxlineScoresObservedTsMs: 3_000,
        lastTxlineScoresObservedTsMs: 1_900_000
      })],
      sampledHistoryAssetIds: new Set(["over-paired", "under-paired", "over-sampled", "under-sampled"]),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    });
    expect(universe.summary).toEqual({
      fixtures: 2,
      pairedBookReplays: 1,
      executableBookReplays: 1,
      bookLifecycleReplays: 0,
      signalResearchOnly: 1,
      unavailable: 0,
      longRunEligible: 0
    });
    expect(universe.fixtures.find((fixture) => fixture.fixtureId === "paired")).toMatchObject({
      evidenceGrade: "paired_order_books",
      bountyLane: { mode: "executable_book_replay", exploratory: true },
      capabilities: { executablePaperReplay: true, kickoffCloseReplay: true }
    });
    expect(universe.fixtures.find((fixture) => fixture.fixtureId === "sampled")).toMatchObject({
      evidenceGrade: "sampled_price_history",
      bountyLane: { mode: "signal_research_only", exploratory: true },
      capabilities: { executablePaperReplay: false, signalResearchReplay: true }
    });
    expect(universe.fixtures.every((fixture) => !fixture.longRunLane.eligible)).toBe(true);
  });

  it("fails closed on a capture slug that does not belong to the fixture", () => {
    expect(() => buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 4_000_000,
      mappings: [mapping("fixture", "expected-slug", 2_000_000)],
      totalEvidence: [evidence("fixture", 2_000_000)],
      pairedCaptures: [pairedCapture("fixture", "wrong-slug", 2_000_000, {
        runId: "bad-run",
        firstPolymarketObservedTsMs: 1_000,
        lastPolymarketObservedTsMs: 1_900_000,
        firstTxlineOddsObservedTsMs: 2_000,
        lastTxlineOddsObservedTsMs: 1_900_000,
        firstTxlineScoresObservedTsMs: 3_000,
        lastTxlineScoresObservedTsMs: 1_900_000
      })],
      sampledHistoryAssetIds: new Set(["over-fixture", "under-fixture"]),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    })).toThrow(/slug/);
  });

  it("fails closed when frozen total evidence is later than detector evaluation start", () => {
    const kickoffTsMs = 20_000_000;
    const lateEvidence = evidence("late", kickoffTsMs);
    lateEvidence.selectorCutoffTsMs += 1;
    lateEvidence.preKickoffPointTsMs = lateEvidence.selectorCutoffTsMs;
    lateEvidence.coverageLastPointTsMs = lateEvidence.selectorCutoffTsMs;
    expect(() => buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000,
      mappings: [mapping("late", "late-slug", kickoffTsMs)],
      totalEvidence: [lateEvidence],
      pairedCaptures: [],
      sampledHistoryAssetIds: new Set(["over-late", "under-late"]),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    })).toThrow(/no eligible frozen total selection/);
  });

  it("rejects a forged verified mapping without Deborah's settlement review", () => {
    const forged = mapping("forged", "forged-slug", 2_000_000) as MappingRecord;
    forged.status = "verified";
    expect(() => buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000_000,
      mappings: [forged],
      totalEvidence: [evidence("forged", 2_000_000)],
      pairedCaptures: [],
      sampledHistoryAssetIds: new Set(["over-forged", "under-forged"]),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    })).toThrow(/human settlement review/);
  });

  it("rejects mapping rules whose stored hash does not match the reviewed text", () => {
    const forged = mapping("bad-rules", "bad-rules-slug", 2_000_000);
    forged.conditions[0]!.rulesSha256 = "0".repeat(64);
    expect(() => buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000_000,
      mappings: [forged],
      totalEvidence: [evidence("bad-rules", 2_000_000)],
      pairedCaptures: [],
      sampledHistoryAssetIds: new Set(["over-bad-rules", "under-bad-rules"]),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    })).toThrow(/rulesSha256/);
  });

  it("requires post-start timing, verified mapping, and pre-match paired books for long-run admission", () => {
    const record = mapping("future", "future-slug", 2_000_000);
    record.status = "verified";
    record.review = {
      settlementVerified: true,
      reviewedBy: "Deborah",
      reviewedAt: "2026-07-11T00:00:00.000Z"
    };
    const universe = buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000_000,
      mappings: [record],
      totalEvidence: [evidence("future", 2_000_000)],
      pairedCaptures: [pairedCapture("future", "future-slug", 2_000_000, {
        runId: "future-run",
        mappingConfirmed: true,
        firstPolymarketObservedTsMs: 1_000_000,
        lastPolymarketObservedTsMs: 1_900_000,
        firstTxlineOddsObservedTsMs: 1_000_001,
        lastTxlineOddsObservedTsMs: 1_900_000,
        firstTxlineScoresObservedTsMs: 1_000_002,
        lastTxlineScoresObservedTsMs: 1_900_000
      })],
      sampledHistoryAssetIds: new Set(),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    });
    expect(universe.fixtures[0]?.longRunLane).toEqual({ eligible: true, reason: null });
    expect(universe.summary.longRunEligible).toBe(1);
  });

  it("uses the later source start and rejects a capture whose TXLine overlap begins after cutoff", () => {
    const kickoffTsMs = 20_000_000;
    const record = mapping("late-txline", "late-txline-slug", kickoffTsMs);
    record.status = "verified";
    record.review = {
      settlementVerified: true,
      reviewedBy: "Deborah",
      reviewedAt: "2026-07-11T00:00:00.000Z"
    };
    const universe = buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000_000,
      mappings: [record],
      totalEvidence: [evidence("late-txline", kickoffTsMs)],
      pairedCaptures: [pairedCapture("late-txline", "late-txline-slug", kickoffTsMs, {
        runId: "late-txline-run",
        mappingConfirmed: true,
        firstPolymarketObservedTsMs: 1_000_000,
        lastPolymarketObservedTsMs: 19_800_000,
        firstTxlineOddsObservedTsMs: 19_200_000,
        lastTxlineOddsObservedTsMs: 19_800_000,
        firstTxlineScoresObservedTsMs: 1_000_002,
        lastTxlineScoresObservedTsMs: 19_800_000
      })],
      sampledHistoryAssetIds: new Set(),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    });
    expect(universe.fixtures[0]).toMatchObject({
      capabilities: { executablePaperReplay: false },
      bountyLane: { mode: "book_lifecycle_replay" },
      longRunLane: { eligible: false, reason: "executable_capture_required" }
    });
  });

  it("does not admit paired books without explicit close and normalized resolution proof", () => {
    const kickoffTsMs = 20_000_000;
    const record = mapping("no-lifecycle", "no-lifecycle-slug", kickoffTsMs);
    record.status = "verified";
    record.review = {
      settlementVerified: true,
      reviewedBy: "Deborah",
      reviewedAt: "2026-07-11T00:00:00.000Z"
    };
    const universe = buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000_000,
      mappings: [record],
      totalEvidence: [evidence("no-lifecycle", kickoffTsMs)],
      pairedCaptures: [pairedCapture("no-lifecycle", "no-lifecycle-slug", kickoffTsMs, {
        runId: "no-lifecycle-run",
        mappingConfirmed: true,
        firstPolymarketObservedTsMs: 1_000_000,
        lastPolymarketObservedTsMs: 19_800_000,
        firstTxlineOddsObservedTsMs: 1_000_001,
        lastTxlineOddsObservedTsMs: 19_800_000,
        firstTxlineScoresObservedTsMs: 1_000_002,
        lastTxlineScoresObservedTsMs: 19_800_000,
        kickoffCloseAvailable: false,
        publicResolutionAvailable: false,
        publicMarketResolvedNormalized: false
      })],
      sampledHistoryAssetIds: new Set(),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    });
    expect(universe.fixtures[0]).toMatchObject({
      evidenceGrade: "paired_order_books",
      capabilities: {
        executablePaperReplay: true,
        kickoffCloseReplay: false,
        publicResolutionReplay: false
      },
      bountyLane: { mode: "signal_research_only" },
      longRunLane: { eligible: false, reason: "lifecycle_evidence_required" }
    });
  });
});
