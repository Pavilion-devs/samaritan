import { describe, expect, it } from "vitest";
import {
  PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS,
  PAPER_STUDY_TOTAL_SELECTOR_CONFIG
} from "../src/config/paper-study.js";
import { buildPaperFixtureUniverse } from "../src/harness/paper-fixture-universe.js";
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

describe("paper fixture evidence universe", () => {
  it("separates executable paired capture from sampled-history-only fixtures", () => {
    const paired = mapping("paired", "paired-slug", 2_000_000);
    const sampled = mapping("sampled", "sampled-slug", 3_000_000);
    const universe = buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 4_000_000,
      mappings: [paired, sampled],
      totalEvidence: [evidence("paired", 2_000_000), evidence("sampled", 3_000_000)],
      pairedCaptures: [{
        runId: "paired-run",
        status: "verified",
        fixtureId: "paired",
        eventSlug: "paired-slug",
        logComplete: true,
        mappingConfirmed: true,
        identityParity: true,
        replayMode: "capture-order-per-source",
        rows: 100,
        firstObservedTsMs: 1_000
      }],
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
      pairedCaptures: [{
        runId: "bad-run",
        status: "verified",
        fixtureId: "fixture",
        eventSlug: "wrong-slug",
        logComplete: true,
        mappingConfirmed: true,
        identityParity: true,
        replayMode: "capture-order-per-source",
        rows: 100,
        firstObservedTsMs: 1_000
      }],
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

  it("requires post-start timing, verified mapping, and pre-match paired books for long-run admission", () => {
    const record = mapping("future", "future-slug", 2_000_000);
    record.status = "verified";
    const universe = buildPaperFixtureUniverse({
      generatedAt: "2026-07-12T00:00:00.000Z",
      laneStartTsMs: 1_000_000,
      mappings: [record],
      totalEvidence: [evidence("future", 2_000_000)],
      pairedCaptures: [{
        runId: "future-run",
        status: "verified",
        fixtureId: "future",
        eventSlug: "future-slug",
        logComplete: true,
        mappingConfirmed: true,
        identityParity: true,
        replayMode: "capture-order-per-source",
        rows: 100,
        firstObservedTsMs: 1_000_000
      }],
      sampledHistoryAssetIds: new Set(),
      selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
    });
    expect(universe.fixtures[0]?.longRunLane).toEqual({ eligible: true, reason: null });
    expect(universe.summary.longRunEligible).toBe(1);
  });
});
