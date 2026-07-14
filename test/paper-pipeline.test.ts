import { describe, expect, it } from "vitest";
import { tradeThesisSchema, type TradeThesis } from "../src/agents/contracts.js";
import type { PolymarketBookEvent } from "../src/bus/events.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { probability } from "../src/domain/probability.js";
import {
  OrderBookPaperExecutor,
  type PaperExecutor,
  type PolymarketFeeParameters
} from "../src/exec/paper.js";
import { PaperCasePipeline } from "../src/harness/paper-pipeline.js";
import { PaperStudyRuntime } from "../src/harness/paper-runtime.js";
import { PaperCaseScheduler } from "../src/harness/paper-scheduler.js";
import {
  APPROVED_PAPER_RISK_CONFIG,
  paperRiskState,
  reviewPaperRisk
} from "../src/risk/paper.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";

const detectedAtTsMs = 10_000;

function signal(overrides: Partial<DetectorSignal> = {}): DetectorSignal {
  return {
    signalId: "signal-1",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs,
    observedAtTsMs: detectedAtTsMs,
    fixtureId: "fixture-1",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-1:total_goals:full_time:2500"
    },
    outcome: "over",
    direction: "buy",
    eligibility: "pretrade_review_required",
    reason: "locked paper candidate",
    evidence: {
      consensusProbability: 0.55,
      polymarketProbability: 0.515,
      consensusVelocity: 0.02,
      consensusZScore: 1.5,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0.002,
      cusumDown: 0,
      rawGap: 0.03,
      gapBasis: "live_book",
      persistenceMs: 0,
      mappingStatus: "candidate",
      scoreContextActions: []
    },
    ...overrides
  };
}

function book(overrides: Partial<PolymarketBookEvent> = {}): PolymarketBookEvent {
  return {
    schemaVersion: 1,
    kind: "polymarket.book",
    eventId: "book-1",
    source: "polymarket",
    sourceTsMs: 11_500,
    observedTsMs: 11_500,
    fixtureId: "fixture-1",
    market: signal().market,
    mappingStatus: "candidate",
    conditionId: "condition-1",
    assetId: "asset-over",
    outcome: "over",
    tokenRole: "canonical",
    bids: [{ price: probability(0.51), size: "20" }],
    asks: [
      { price: probability(0.52), size: "2" },
      { price: probability(0.53), size: "20" }
    ],
    lastTradePrice: probability(0.52),
    tickSize: "0.01",
    ...overrides
  };
}

const fees: PolymarketFeeParameters = {
  source: "polymarket_clob_market_info",
  conditionId: "condition-1",
  feesEnabled: true,
  takerFeeRate: 0.05,
  feeCurveExponent: 1,
  takerOnly: true,
  minimumOrderSize: 5,
  minimumTickSize: 0.01,
  fetchedAtTsMs: 10_400
};

function thesis(overrides: Partial<TradeThesis> = {}): TradeThesis {
  return {
    schemaVersion: 1,
    signalId: "signal-1",
    fixtureId: "fixture-1",
    marketKey: "fixture-1:total_goals:full_time:2500",
    outcome: "over",
    direction: "buy",
    recommendation: "paper_trade",
    fairProbability: 0.55,
    thesisSummary: "Consensus moved while the executable total remained behind.",
    evidenceFor: ["Live ask remains below locked fair-value boundary."],
    steelmanAgainst: "The consensus move may reverse before kickoff.",
    invalidationConditions: ["Live ask reaches the deterministic limit."],
    submittedAtTsMs: 10_500,
    expiresAtTsMs: 20_000,
    analystModel: "test-analyst",
    ...overrides
  };
}

function timingHarness(executionLatencyMs = 500): {
  ledger: DecisionLedger;
  scheduler: PaperCaseScheduler;
} {
  const ledger = new DecisionLedger(":memory:");
  const pipeline = new PaperCasePipeline({
    triageAgent: {
      triage: async () => ({
        decision: "escalate",
        priority: "normal",
        rationale: "Eligible timing test signal."
      })
    },
    analystAgent: {
      investigate: async ({ signal: candidate }) => thesis({
        signalId: candidate.signalId,
        fixtureId: candidate.fixtureId,
        marketKey: candidate.market.key,
        outcome: candidate.outcome,
        direction: candidate.direction
      })
    },
    riskConfig: APPROVED_PAPER_RISK_CONFIG,
    executor: new OrderBookPaperExecutor(),
    ledger
  });
  const scheduler = new PaperCaseScheduler({
    config: {
      lane: "bounty",
      executionLatencyMs,
      maximumPendingMs: 10_000,
      minimumSignalToKickoffMs: 900_000,
      eligibleMarketKeys: new Set([signal().market.key]),
      kickoffByFixtureId: new Map([["fixture-1", 2_000_000]])
    },
    pipeline,
    feeResolver: async (executionBook, asOfTsMs) => ({
      ...fees,
      conditionId: executionBook.conditionId,
      fetchedAtTsMs: asOfTsMs
    })
  });
  return { ledger, scheduler };
}

describe("paper decision pipeline", () => {
  it("rejects thesis fields that could let an analyst size or construct an order", () => {
    expect(() => tradeThesisSchema.parse({
      ...thesis(),
      stakeMicroUsd: 50_000_000
    })).toThrow();
  });

  it("walks real book depth and applies the documented per-market taker fee", async () => {
    const executor = new OrderBookPaperExecutor();
    const fill = await executor.execute({
      lane: "bounty",
      caseId: "case-1",
      signalId: "signal-1",
      fixtureId: "fixture-1",
      marketKey: signal().market.key,
      outcome: "over",
      direction: "buy",
      stakeMicroUsd: APPROVED_PAPER_RISK_CONFIG.perTradeStakeMicroUsd,
      limitProbability: probability(0.54),
      availableShares: 0
    }, book(), fees);
    expect(fill.status).toBe("filled");
    expect(fill.filledShares).toBeGreaterThan(5);
    expect(fill.averagePrice).toBeGreaterThan(0.52);
    expect(fill.feeMicroUsd).toBeGreaterThan(0);
    expect(fill.feeMicroUsd % 10).toBe(0);
    expect(fill.netConsiderationMicroUsd).toBeLessThanOrEqual(3_000_000);
    expect(fill.slippageProbabilityBps).toBeGreaterThan(0);
  });

  it("makes the paper adapter fail closed on malformed fee metadata", async () => {
    const executor = new OrderBookPaperExecutor();
    await expect(executor.execute({
      lane: "bounty",
      caseId: "case-1",
      signalId: "signal-1",
      fixtureId: "fixture-1",
      marketKey: signal().market.key,
      outcome: "over",
      direction: "buy",
      stakeMicroUsd: APPROVED_PAPER_RISK_CONFIG.perTradeStakeMicroUsd,
      limitProbability: probability(0.54),
      availableShares: 0
    }, book(), { ...fees, feesEnabled: false })).rejects.toThrow(/non-zero taker rate/);
  });

  it("records no fill when the fixed stake cannot satisfy the market minimum shares", async () => {
    const executor = new OrderBookPaperExecutor();
    const fillResult = await executor.execute({
      lane: "bounty",
      caseId: "case-minimum",
      signalId: "signal-minimum",
      fixtureId: "fixture-1",
      marketKey: signal().market.key,
      outcome: "over",
      direction: "buy",
      stakeMicroUsd: APPROVED_PAPER_RISK_CONFIG.perTradeStakeMicroUsd,
      limitProbability: probability(0.8),
      availableShares: 0
    }, book({
      bids: [{ price: probability(0.69), size: "100" }],
      asks: [{ price: probability(0.7), size: "100" }],
      lastTradePrice: probability(0.7)
    }), fees);
    expect(fillResult).toMatchObject({
      status: "no_fill",
      reason: "below_minimum_order_size",
      filledShares: 0
    });
  });

  it("vetoes the lane at the locked drawdown stop", () => {
    const verdict = reviewPaperRisk({
      config: APPROVED_PAPER_RISK_CONFIG,
      state: paperRiskState({ currentDrawdownMicroUsd: 20_000_000 }),
      signal: signal(),
      thesis: thesis(),
      book: book(),
      fees,
      asOfTsMs: 11_600,
      executionLatencyMs: 500
    });
    expect(verdict).toEqual({ decision: "veto", reasons: ["drawdown_stop_reached"] });
  });

  it("vetoes research-only signals even if they bypass scheduler fixture filtering", () => {
    const verdict = reviewPaperRisk({
      config: APPROVED_PAPER_RISK_CONFIG,
      state: paperRiskState(),
      signal: signal({ eligibility: "research_only" }),
      thesis: thesis(),
      book: book(),
      fees,
      asOfTsMs: 11_600,
      executionLatencyMs: 500
    });
    expect(verdict).toMatchObject({ decision: "veto" });
    if (verdict.decision === "veto") expect(verdict.reasons).toContain("signal_research_only");
  });

  it("validates replay fee freshness on processing time without rewriting event time", () => {
    const verdict = reviewPaperRisk({
      config: APPROVED_PAPER_RISK_CONFIG,
      state: paperRiskState(),
      signal: signal(),
      thesis: thesis(),
      book: book(),
      fees: { ...fees, fetchedAtTsMs: 1_000_000 },
      asOfTsMs: 11_600,
      feeValidationTsMs: 1_000_100,
      executionLatencyMs: 500
    });
    expect(verdict).toMatchObject({ decision: "approve" });
  });

  it("ledgers every decision and the execution intent before a paper fill", async () => {
    const ledger = new DecisionLedger(":memory:");
    const delegate = new OrderBookPaperExecutor();
    const executor: PaperExecutor = {
      execute: async (intent, executionBook, executionFees) => {
        expect(ledger.entries().map((entry) => entry.kind)).toEqual([
          "signal_received",
          "triage_decision",
          "thesis_submitted",
          "analysis_completed",
          "risk_verdict",
          "execution_intent"
        ]);
        return delegate.execute(intent, executionBook, executionFees);
      }
    };
    const pipeline = new PaperCasePipeline({
      triageAgent: {
        triage: async () => ({
          decision: "escalate",
          priority: "normal",
          rationale: "Locked candidate with a live executable gap."
        })
      },
      analystAgent: { investigate: async () => thesis() },
      riskConfig: APPROVED_PAPER_RISK_CONFIG,
      executor,
      ledger
    });
    const result = await pipeline.run({
      lane: "bounty",
      signal: signal(),
      book: book(),
      fees,
      riskState: paperRiskState(),
      asOfTsMs: 11_600,
      executionLatencyMs: 500
    });
    expect(result.status).toBe("filled");
    expect(ledger.entries().map((entry) => entry.kind)).toEqual([
      "signal_received",
      "triage_decision",
      "thesis_submitted",
      "analysis_completed",
      "risk_verdict",
      "execution_intent",
      "paper_execution",
      "case_terminal"
    ]);
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 8 });
    ledger.close();
  });

  it("records at detection and waits for the first post-latency canonical book", async () => {
    const ledger = new DecisionLedger(":memory:");
    let wallNowMs = 1_000;
    const pipeline = new PaperCasePipeline({
      triageAgent: {
        triage: async () => {
          wallNowMs += 100;
          return {
            decision: "escalate",
            priority: "normal",
            rationale: "Eligible locked paper signal."
          };
        }
      },
      analystAgent: {
        investigate: async () => {
          wallNowMs += 300;
          return thesis();
        }
      },
      riskConfig: APPROVED_PAPER_RISK_CONFIG,
      executor: new OrderBookPaperExecutor(),
      ledger,
      now: () => wallNowMs
    });
    const scheduler = new PaperCaseScheduler({
      config: {
        lane: "bounty",
        executionLatencyMs: 1,
        maximumPendingMs: 5_000,
        minimumSignalToKickoffMs: 900_000,
        eligibleMarketKeys: new Set([signal().market.key]),
        kickoffByFixtureId: new Map([["fixture-1", 1_000_000]])
      },
      pipeline,
      feeResolver: async (executionBook, asOfTsMs) => ({
        ...fees,
        conditionId: executionBook.conditionId,
        fetchedAtTsMs: asOfTsMs
      })
    });
    expect(await scheduler.enqueue(signal())).toBe(true);
    expect(await scheduler.enqueue(signal({
      signalId: "late-signal",
      detectedAtTsMs: 100_001,
      observedAtTsMs: 100_001
    }))).toBe(false);
    expect(ledger.entries().map((entry) => entry.kind)).toEqual([
      "signal_received",
      "triage_decision",
      "thesis_submitted",
      "analysis_completed"
    ]);

    expect(await scheduler.ingest(book({
      eventId: "early-book",
      sourceTsMs: 10_399,
      observedTsMs: 10_399
    }))).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);

    const [result] = await scheduler.ingest(book());
    expect(result?.status).toBe("filled");
    expect(scheduler.pendingCount()).toBe(0);
    expect(scheduler.riskState().openExposureMicroUsd).toBeGreaterThan(0);
    expect(ledger.entries().find((entry) => entry.kind === "analysis_completed")?.payload).toEqual({
      signalSourceTsMs: 10_000,
      signalObservedTsMs: 10_000,
      decisionLatencyMs: 400,
      readyAtTsMs: 10_400,
      venuePlacementDelayMs: 1_000,
      orderEligibleAtTsMs: 11_400,
      recommendation: "paper_trade"
    });
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 8 });
    ledger.close();
  });

  it("starts analysis readiness from delayed observation time, never the source timestamp", async () => {
    const { ledger, scheduler } = timingHarness();
    const delayedSignal = signal({
      detectedAtTsMs: 10_000,
      observedAtTsMs: 20_000
    });
    expect(await scheduler.enqueue(delayedSignal)).toBe(true);
    expect(ledger.entries()[0]).toMatchObject({
      kind: "signal_received",
      atTsMs: 20_000,
      payload: {
        signal: { detectedAtTsMs: 10_000, observedAtTsMs: 20_000 }
      }
    });

    expect(await scheduler.ingest(book({
      eventId: "retroactive-source-book",
      sourceTsMs: 10_500,
      observedTsMs: 21_499
    }))).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);

    const [result] = await scheduler.ingest(book({
      eventId: "first-knowledge-eligible-book",
      sourceTsMs: 21_564,
      observedTsMs: 21_500
    }));
    expect(result?.status).toBe("filled");
    expect(ledger.entries().find((entry) => entry.kind === "analysis_completed")?.payload).toMatchObject({
      signalSourceTsMs: 10_000,
      signalObservedTsMs: 20_000,
      decisionLatencyMs: 500,
      readyAtTsMs: 20_500,
      venuePlacementDelayMs: 1_000,
      orderEligibleAtTsMs: 21_500
    });
    ledger.close();
  });

  it("rejects reconnect catch-up books without rejecting small venue clock lead", async () => {
    const { ledger, scheduler } = timingHarness();
    const skewedSignal = signal({
      detectedAtTsMs: 10_064,
      observedAtTsMs: 10_000
    });
    await scheduler.ingest(book({
      eventId: "detection-book",
      sourceTsMs: 10_064,
      observedTsMs: 10_000
    }));
    expect(await scheduler.enqueue(skewedSignal)).toBe(true);

    expect(await scheduler.ingest(book({
      eventId: "reconnect-catch-up-book",
      sourceTsMs: 9_500,
      observedTsMs: 11_500
    }))).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);

    const [result] = await scheduler.ingest(book({
      eventId: "fresh-post-reconnect-book",
      sourceTsMs: 11_564,
      observedTsMs: 11_500
    }));
    expect(result?.status).toBe("filled");
    ledger.close();
  });

  it("does not fill a favorable book observed inside the sports placement delay", async () => {
    const { ledger, scheduler } = timingHarness();
    expect(await scheduler.enqueue(signal())).toBe(true);

    expect(await scheduler.ingest(book({
      eventId: "favorable-inside-delay",
      sourceTsMs: 11_000,
      observedTsMs: 11_000,
      asks: [{ price: probability(0.52), size: "100" }]
    }))).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);

    const [result] = await scheduler.ingest(book({
      eventId: "unfavorable-after-delay",
      sourceTsMs: 11_500,
      observedTsMs: 11_500,
      bids: [{ price: probability(0.53), size: "100" }],
      asks: [{ price: probability(0.55), size: "100" }],
      lastTradePrice: probability(0.55)
    }));
    expect(result?.status).toBe("vetoed");
    expect(result?.reason).toContain("live_edge_below_locked_gap");
    expect(scheduler.riskState().openExposureMicroUsd).toBe(0);
    expect(ledger.entries().some((entry) => entry.kind === "paper_execution")).toBe(false);
    ledger.close();
  });

  it("fails closed on malformed or regressing observed knowledge timestamps", async () => {
    const { ledger, scheduler } = timingHarness();
    expect(await scheduler.enqueue(signal({
      signalId: "invalid-observed-signal",
      observedAtTsMs: Number.NaN
    }))).toBe(false);
    expect(ledger.entries()).toEqual([]);

    await scheduler.ingest(book({
      eventId: "clock-primer",
      sourceTsMs: 10_064,
      observedTsMs: 10_000
    }));
    expect(await scheduler.enqueue(signal({
      signalId: "valid-after-primer",
      detectedAtTsMs: 10_064,
      observedAtTsMs: 10_000
    }))).toBe(true);
    expect(await scheduler.ingest(book({
      eventId: "regressing-observation",
      sourceTsMs: 10_500,
      observedTsMs: 9_999
    }))).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);
    expect(ledger.entries().some((entry) => entry.kind === "paper_execution")).toBe(false);
    ledger.close();
  });

  it("persists the signal before a slow triage request resolves", async () => {
    const ledger = new DecisionLedger(":memory:");
    let releaseTriage!: (value: unknown) => void;
    const triageResult = new Promise<unknown>((resolve) => { releaseTriage = resolve; });
    const pipeline = new PaperCasePipeline({
      triageAgent: { triage: async () => triageResult },
      analystAgent: { investigate: async () => thesis() },
      riskConfig: APPROVED_PAPER_RISK_CONFIG,
      executor: new OrderBookPaperExecutor(),
      ledger
    });
    const scheduler = new PaperCaseScheduler({
      config: {
        lane: "bounty",
        executionLatencyMs: 1,
        maximumPendingMs: 5_000,
        minimumSignalToKickoffMs: 900_000,
        eligibleMarketKeys: new Set([signal().market.key]),
        kickoffByFixtureId: new Map([["fixture-1", 1_000_000]])
      },
      pipeline,
      feeResolver: async () => fees
    });

    const enqueue = scheduler.enqueue(signal());
    expect(ledger.entries().map((entry) => entry.kind)).toEqual(["signal_received"]);
    releaseTriage({ decision: "drop", priority: "low", rationale: "Slow test drop." });
    await expect(enqueue).resolves.toBe(true);
    expect(ledger.entries().map((entry) => entry.kind)).toEqual([
      "signal_received",
      "triage_decision",
      "case_terminal"
    ]);
    ledger.close();
  });

  it("cannot convert a pre-match signal into an in-play entry when analysis finishes late", async () => {
    const ledger = new DecisionLedger(":memory:");
    const pipeline = new PaperCasePipeline({
      triageAgent: {
        triage: async () => ({ decision: "escalate", priority: "normal", rationale: "test" })
      },
      analystAgent: { investigate: async () => thesis() },
      riskConfig: APPROVED_PAPER_RISK_CONFIG,
      executor: new OrderBookPaperExecutor(),
      ledger
    });
    const scheduler = new PaperCaseScheduler({
      config: {
        lane: "bounty",
        executionLatencyMs: 1_000_000,
        maximumPendingMs: 5_000,
        minimumSignalToKickoffMs: 900_000,
        eligibleMarketKeys: new Set([signal().market.key]),
        kickoffByFixtureId: new Map([["fixture-1", 1_000_000]])
      },
      pipeline,
      feeResolver: async () => fees
    });

    await expect(scheduler.enqueue(signal())).resolves.toBe(true);
    expect(scheduler.pendingCount()).toBe(0);
    expect(ledger.entries().at(-1)?.payload).toEqual({
      status: "failed",
      reason: "order_became_eligible_at_or_after_kickoff"
    });
    ledger.close();
  });

  it("expires a recorded signal when no post-latency executable book arrives", async () => {
    const ledger = new DecisionLedger(":memory:");
    const pipeline = new PaperCasePipeline({
      triageAgent: {
        triage: async () => ({ decision: "escalate", priority: "normal", rationale: "test" })
      },
      analystAgent: { investigate: async () => thesis() },
      riskConfig: APPROVED_PAPER_RISK_CONFIG,
      executor: new OrderBookPaperExecutor(),
      ledger
    });
    const scheduler = new PaperCaseScheduler({
      config: {
        lane: "long_run",
        executionLatencyMs: 500,
        maximumPendingMs: 1_000,
        minimumSignalToKickoffMs: 900_000,
        eligibleMarketKeys: new Set([signal().market.key]),
        kickoffByFixtureId: new Map([["fixture-1", 1_000_000]])
      },
      pipeline,
      feeResolver: async () => fees
    });
    await scheduler.enqueue(signal());
    await scheduler.ingest(book({
      eventId: "unrelated-book",
      observedTsMs: 12_500,
      sourceTsMs: 12_500,
      outcome: "under"
    }));
    expect(scheduler.pendingCount()).toBe(0);
    expect(ledger.entries().map((entry) => entry.kind)).toEqual([
      "signal_received",
      "triage_decision",
      "thesis_submitted",
      "analysis_completed",
      "case_terminal"
    ]);
    ledger.close();
  });

  it("routes canonical events through detector output without reprocessing a seen signal", async () => {
    const ledger = new DecisionLedger(":memory:");
    const pipeline = new PaperCasePipeline({
      triageAgent: {
        triage: async () => ({ decision: "escalate", priority: "normal", rationale: "Eligible signal." })
      },
      analystAgent: { investigate: async () => thesis() },
      riskConfig: APPROVED_PAPER_RISK_CONFIG,
      executor: new OrderBookPaperExecutor(),
      ledger
    });
    const scheduler = new PaperCaseScheduler({
      config: {
        lane: "bounty",
        executionLatencyMs: 500,
        maximumPendingMs: 5_000,
        minimumSignalToKickoffMs: 900_000,
        eligibleMarketKeys: new Set([signal().market.key]),
        kickoffByFixtureId: new Map([["fixture-1", 1_000_000]])
      },
      pipeline,
      feeResolver: async (executionBook, asOfTsMs) => ({
        ...fees,
        conditionId: executionBook.conditionId,
        fetchedAtTsMs: asOfTsMs
      })
    });
    const runtime = new PaperStudyRuntime({
      featureProcessor: { ingest: () => [{} as never] },
      detectorProcessor: { ingest: () => [signal()] },
      scheduler
    });

    const detected = await runtime.ingest(book({
      eventId: "detection-book",
      sourceTsMs: 10_000,
      observedTsMs: 10_000
    }));
    expect(detected.routedSignalIds).toEqual(["signal-1"]);
    expect(detected.caseResults).toEqual([]);

    const executed = await runtime.ingest(book());
    expect(executed.caseResults[0]?.status).toBe("filled");
    expect(executed.routedSignalIds).toEqual([]);
    expect(scheduler.seenCount()).toBe(1);
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 8 });
    ledger.close();
  });
});
