import { describe, expect, it } from "vitest";
import { normalizeExecutableEconomicCases } from "../src/detectors/economic-cases.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { PaperStudyRuntime } from "../src/harness/paper-runtime.js";
import type { PaperCaseScheduler } from "../src/harness/paper-scheduler.js";

function totalSignal(overrides: Partial<DetectorSignal> = {}): DetectorSignal {
  const outcome = overrides.outcome ?? "over";
  const direction = overrides.direction ?? "buy";
  return {
    signalId: overrides.signalId ?? `${direction}-${outcome}`,
    kind: "XMARKET_DIVERGENCE",
    detectedAtTsMs: 1_000,
    observedAtTsMs: 1_005,
    fixtureId: "fixture-1",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-1:total_goals:full_time:2500"
    },
    outcome,
    direction,
    eligibility: "research_only",
    reason: "test",
    evidence: {
      consensusProbability: 0.55,
      polymarketProbability: 0.5,
      consensusVelocity: 0,
      consensusZScore: 0,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0,
      cusumDown: 0,
      rawGap: 0.05,
      gapBasis: "sampled_history_proxy",
      persistenceMs: 0,
      mappingStatus: "candidate",
      scoreContextActions: []
    },
    ...overrides
  };
}

describe("executable economic-case normalization", () => {
  it("retains buy Over and collapses its sell Under complement", () => {
    const sellUnder = totalSignal({ signalId: "sell-under", outcome: "under", direction: "sell" });
    const buyOver = totalSignal({ signalId: "buy-over", outcome: "over", direction: "buy" });
    const result = normalizeExecutableEconomicCases([sellUnder, buyOver]);

    expect(result.signals).toEqual([buyOver]);
    expect(result.dispositions).toEqual([
      {
        signalId: "sell-under",
        disposition: "collapsed",
        reason: "complementary_sell_collapsed_into_executable_buy",
        economicOutcome: "over"
      },
      {
        signalId: "buy-over",
        disposition: "retained",
        reason: "executable_buy_retained",
        economicOutcome: "over"
      }
    ]);
    expect(result.summary).toMatchObject({
      rawEmissions: 2,
      normalizedCases: 1,
      executableTotalGoalsCases: 1,
      complementarySellsCollapsed: 1,
      sellOnlySignalsDropped: 0
    });
  });

  it("retains buy Under and collapses its sell Over complement", () => {
    const buyUnder = totalSignal({ signalId: "buy-under", outcome: "under", direction: "buy" });
    const sellOver = totalSignal({ signalId: "sell-over", outcome: "over", direction: "sell" });
    const result = normalizeExecutableEconomicCases([buyUnder, sellOver]);

    expect(result.signals).toEqual([buyUnder]);
    expect(result.summary.complementarySellsCollapsed).toBe(1);
    expect(result.dispositions.map((item) => item.economicOutcome)).toEqual(["under", "under"]);
  });

  it("prefers the first actual executable buy over duplicate buys and complements", () => {
    const firstBuy = totalSignal({ signalId: "buy-a" });
    const duplicateBuy = totalSignal({ signalId: "buy-b" });
    const complement = totalSignal({ signalId: "sell-under", outcome: "under", direction: "sell" });
    const result = normalizeExecutableEconomicCases([firstBuy, complement, duplicateBuy]);

    expect(result.signals).toEqual([firstBuy]);
    expect(result.summary).toMatchObject({
      rawEmissions: 3,
      normalizedCases: 1,
      duplicateExecutableBuysCollapsed: 1,
      complementarySellsCollapsed: 1
    });
  });

  it("fails closed for sell-only total cases because signals prove no complementary ask", () => {
    const sellUnder = totalSignal({ signalId: "sell-under", outcome: "under", direction: "sell" });
    const sellOver = totalSignal({ signalId: "sell-over", outcome: "over", direction: "sell" });
    const result = normalizeExecutableEconomicCases([sellUnder, sellOver]);

    expect(result.signals).toEqual([]);
    expect(result.summary.sellOnlySignalsDropped).toBe(2);
    expect(result.dispositions.every((item) =>
      item.reason === "sell_only_unproven_executable_ask" && item.disposition === "dropped"
    )).toBe(true);
  });

  it("keeps distinct detector, source-time, and knowledge-time economic cases", () => {
    const signals = [
      totalSignal({ signalId: "base" }),
      totalSignal({ signalId: "detector", kind: "CONSENSUS_MOVE" }),
      totalSignal({ signalId: "source-time", detectedAtTsMs: 1_001 }),
      totalSignal({ signalId: "knowledge-time", observedAtTsMs: 1_006 })
    ];
    const result = normalizeExecutableEconomicCases(signals);

    expect(result.signals).toEqual(signals);
    expect(result.summary.normalizedCases).toBe(4);
  });

  it("does not normalize or deduplicate three-way Match Result signals", () => {
    const market = {
      family: "match_result" as const,
      period: "full_time" as const,
      lineMilli: null,
      key: "fixture-1:match_result:full_time:none"
    };
    const buyHome = totalSignal({ signalId: "buy-home", market, outcome: "home", direction: "buy" });
    const duplicateBuyHome = totalSignal({ signalId: "buy-home-duplicate", market, outcome: "home", direction: "buy" });
    const sellAway = totalSignal({ signalId: "sell-away", market, outcome: "away", direction: "sell" });
    const raw = [buyHome, duplicateBuyHome, sellAway];
    const result = normalizeExecutableEconomicCases(raw);

    expect(result.signals).toEqual(raw);
    expect(result.signals[0]).toBe(buyHome);
    expect(result.signals[2]).toBe(sellAway);
    expect(result.summary).toMatchObject({
      rawEmissions: 3,
      normalizedCases: 3,
      nonBinaryMarketSignalsPassedThrough: 3,
      duplicateExecutableBuysCollapsed: 0,
      sellOnlySignalsDropped: 0
    });
  });

  it("drops an impossible Total Goals outcome instead of guessing a complement", () => {
    const malformed = totalSignal({ signalId: "bad-total", outcome: "home" });
    const result = normalizeExecutableEconomicCases([malformed]);

    expect(result.signals).toEqual([]);
    expect(result.summary.unsupportedTotalGoalsSignalsDropped).toBe(1);
    expect(result.dispositions[0]?.reason).toBe("unsupported_total_goals_outcome");
  });

  it("routes the normalized buy, not raw complementary emissions, in the forward runtime", async () => {
    const buyOver = totalSignal({ signalId: "buy-over" });
    const sellUnder = totalSignal({ signalId: "sell-under", outcome: "under", direction: "sell" });
    const routed: DetectorSignal[] = [];
    let detectorCall = 0;
    const scheduler = {
      ingest: async () => [],
      enqueue: async (candidate: DetectorSignal) => {
        routed.push(candidate);
        return true;
      }
    } as unknown as PaperCaseScheduler;
    const runtime = new PaperStudyRuntime({
      featureProcessor: { ingest: () => [{} as never, {} as never] },
      detectorProcessor: {
        ingest: () => detectorCall++ === 0 ? [sellUnder] : [buyOver]
      },
      scheduler
    });

    const batch = await runtime.ingest({ kind: "feed.heartbeat" } as never);

    expect(batch.rawSignals).toEqual([sellUnder, buyOver]);
    expect(batch.signals).toEqual([buyOver]);
    expect(batch.routedSignalIds).toEqual(["buy-over"]);
    expect(routed).toEqual([buyOver]);
    expect(batch.economicCaseNormalization).toMatchObject({
      rawEmissions: 2,
      normalizedCases: 1,
      complementarySellsCollapsed: 1
    });
  });
});
