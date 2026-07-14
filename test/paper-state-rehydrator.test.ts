import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { TradeThesis } from "../src/agents/contracts.js";
import type { CanonicalEvent, PolymarketBookEvent } from "../src/bus/events.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { microUsd } from "../src/domain/money.js";
import { probability } from "../src/domain/probability.js";
import { OrderBookPaperExecutor, type PaperFill, type PolymarketFeeParameters } from "../src/exec/paper.js";
import { PaperCasePipeline } from "../src/harness/paper-pipeline.js";
import {
  paperCaseIdForSignal,
  rehydratePaperState
} from "../src/harness/paper-state-rehydrator.js";
import { PaperCaseScheduler } from "../src/harness/paper-scheduler.js";
import { PaperPortfolio } from "../src/portfolio/paper.js";
import { APPROVED_PAPER_RISK_CONFIG } from "../src/risk/paper.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function signal(): DetectorSignal {
  return {
    signalId: "restart-signal-1",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: 10_000,
    observedAtTsMs: 10_000,
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
    reason: "restart fixture",
    evidence: {
      consensusProbability: 0.56,
      polymarketProbability: 0.52,
      consensusVelocity: 0.02,
      consensusZScore: 1.5,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0.002,
      cusumDown: 0,
      rawGap: 0.04,
      gapBasis: "live_book",
      persistenceMs: 0,
      mappingStatus: "verified",
      scoreContextActions: []
    }
  };
}

function thesis(candidate: DetectorSignal): TradeThesis {
  return {
    schemaVersion: 1,
    signalId: candidate.signalId,
    fixtureId: candidate.fixtureId,
    marketKey: candidate.market.key,
    outcome: candidate.outcome,
    direction: candidate.direction,
    recommendation: "paper_trade",
    fairProbability: 0.56,
    thesisSummary: "Executable book remains behind consensus after review.",
    evidenceFor: ["The canonical ask remains inside the deterministic limit."],
    steelmanAgainst: "Consensus can reverse before kickoff.",
    invalidationConditions: ["The canonical ask catches up."],
    submittedAtTsMs: 1,
    expiresAtTsMs: 2,
    analystModel: "restart-test"
  };
}

function book(observedTsMs = 11_500): PolymarketBookEvent {
  return {
    schemaVersion: 1,
    kind: "polymarket.book",
    eventId: `book-${observedTsMs}`,
    source: "polymarket",
    sourceTsMs: observedTsMs,
    observedTsMs,
    fixtureId: "fixture-1",
    market: signal().market,
    mappingStatus: "verified",
    conditionId: "condition-1",
    assetId: "asset-over",
    outcome: "over",
    tokenRole: "canonical",
    bids: [{ price: probability(0.51), size: "100" }],
    asks: [{ price: probability(0.52), size: "100" }],
    lastTradePrice: probability(0.515),
    tickSize: "0.01"
  };
}

function fees(asOfTsMs: number): PolymarketFeeParameters {
  return {
    source: "polymarket_clob_market_info",
    conditionId: "condition-1",
    feesEnabled: true,
    takerFeeRate: 0.05,
    feeCurveExponent: 1,
    takerOnly: true,
    minimumOrderSize: 5,
    minimumTickSize: 0.01,
    fetchedAtTsMs: asOfTsMs
  };
}

function pipeline(ledger: DecisionLedger, spend?: { triage: number; analyst: number }): PaperCasePipeline {
  return new PaperCasePipeline({
    triageAgent: {
      triage: async () => {
        if (spend) spend.triage += 1;
        return { decision: "escalate", priority: "normal", rationale: "Restart-safe candidate." };
      }
    },
    analystAgent: {
      investigate: async ({ signal: candidate }) => {
        if (spend) spend.analyst += 1;
        return thesis(candidate);
      }
    },
    riskConfig: APPROVED_PAPER_RISK_CONFIG,
    executor: new OrderBookPaperExecutor(),
    ledger,
    now: () => 0
  });
}

function scheduler(input: {
  ledger: DecisionLedger;
  portfolio: PaperPortfolio;
  maximumPendingMs: number;
  spend?: { triage: number; analyst: number };
  initialState?: ReturnType<typeof rehydratePaperState>["schedulerInitialState"];
}): PaperCaseScheduler {
  return new PaperCaseScheduler({
    config: {
      lane: "bounty",
      executionLatencyMs: 500,
      maximumPendingMs: input.maximumPendingMs,
      minimumSignalToKickoffMs: 1_000,
      eligibleMarketKeys: new Set([signal().market.key]),
      kickoffByFixtureId: new Map([["fixture-1", 20_000]])
    },
    pipeline: pipeline(input.ledger, input.spend),
    feeResolver: async (_book, asOfTsMs) => fees(asOfTsMs),
    portfolio: input.portfolio,
    ...(input.initialState === undefined ? {} : { initialState: input.initialState })
  });
}

function freshPortfolio(ledger: DecisionLedger, initialState?: ReturnType<typeof rehydratePaperState>["portfolioInitialState"]): PaperPortfolio {
  return new PaperPortfolio({
    lane: "bounty",
    bankrollMicroUsd: APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd,
    drawdownStopMicroUsd: APPROVED_PAPER_RISK_CONFIG.drawdownStopMicroUsd,
    ledger,
    ...(initialState === undefined ? {} : { initialState })
  });
}

function rehydrate(ledger: DecisionLedger, asOfTsMs: number, maximumPendingMs = 5_000) {
  return rehydratePaperState({
    ledger,
    lane: "bounty",
    bankrollMicroUsd: APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd,
    drawdownStopMicroUsd: APPROVED_PAPER_RISK_CONFIG.drawdownStopMicroUsd,
    maximumPendingMs,
    kickoffByFixtureId: new Map([["fixture-1", 20_000]]),
    asOfTsMs
  });
}

describe("paper restart state rehydration", () => {
  it("rebuilds an open position, exposure, and portfolio state exactly", async () => {
    const ledger = new DecisionLedger(":memory:");
    const originalPortfolio = freshPortfolio(ledger);
    const originalScheduler = scheduler({ ledger, portfolio: originalPortfolio, maximumPendingMs: 5_000 });
    expect(await originalScheduler.enqueue(signal())).toBe(true);
    const results = await originalScheduler.ingest(book());
    expect(results[0]?.status).toBe("filled");
    expect(originalPortfolio.positions()).toHaveLength(1);

    const restored = rehydrate(ledger, 11_500);
    expect(restored.chain).toMatchObject({ valid: true, legacyV1Rows: 0, v2Rows: 9 });
    expect(restored.openPositions).toEqual(originalPortfolio.positions());
    expect(restored.closedPositions).toEqual([]);
    expect(restored.settledPositions).toEqual([]);
    expect(restored.aggregateExposureMicroUsd).toBe(originalPortfolio.riskState().openExposureMicroUsd);
    expect(restored.realizedPnlMicroUsd).toBe(0);
    expect(restored.equityMicroUsd).toBe(APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd);

    const rebuiltPortfolio = freshPortfolio(ledger, restored.portfolioInitialState);
    expect(rebuiltPortfolio.positions()).toEqual(originalPortfolio.positions());
    expect(rebuiltPortfolio.summary()).toEqual(originalPortfolio.summary());
    expect(rebuiltPortfolio.riskState()).toEqual(originalPortfolio.riskState());
    ledger.close();
  });

  it("restores the seen marker so duplicate signals cannot spend either model again", async () => {
    const ledger = new DecisionLedger(":memory:");
    const originalPortfolio = freshPortfolio(ledger);
    const originalScheduler = scheduler({ ledger, portfolio: originalPortfolio, maximumPendingMs: 5_000 });
    await originalScheduler.enqueue(signal());
    await originalScheduler.ingest(book());
    const restored = rehydrate(ledger, 11_500);
    const spend = { triage: 0, analyst: 0 };
    const rebuiltPortfolio = freshPortfolio(ledger, restored.portfolioInitialState);
    const rebuiltScheduler = scheduler({
      ledger,
      portfolio: rebuiltPortfolio,
      maximumPendingMs: 5_000,
      spend,
      initialState: restored.schedulerInitialState
    });

    expect(rebuiltScheduler.seenCount()).toBe(1);
    expect(await rebuiltScheduler.enqueue(signal())).toBe(false);
    expect(spend).toEqual({ triage: 0, analyst: 0 });
    expect(ledger.entries().filter((entry) => entry.kind === "signal_received")).toHaveLength(1);
    ledger.close();
  });

  it("rebuilds closed and settled positions plus historical peak equity and drawdown", async () => {
    const ledger = new DecisionLedger(":memory:");
    const originalPortfolio = freshPortfolio(ledger);
    const originalScheduler = scheduler({ ledger, portfolio: originalPortfolio, maximumPendingMs: 5_000 });
    await originalScheduler.enqueue(signal());
    await originalScheduler.ingest(book());
    const secondSignal: DetectorSignal = {
      ...structuredClone(signal()),
      signalId: "restart-signal-2",
      detectedAtTsMs: 12_000,
      observedAtTsMs: 12_000
    };
    await originalScheduler.enqueue(secondSignal);
    await originalScheduler.ingest(book(13_500));
    const open = originalPortfolio.positions();
    expect(open).toHaveLength(2);
    const closingBook: PolymarketBookEvent = {
      ...book(19_900),
      bids: [{ price: probability(0.57), size: "100" }],
      asks: [{ price: probability(0.59), size: "100" }]
    };
    for (const position of open) {
      originalPortfolio.markAtClose({
        caseId: position.caseId,
        book: closingBook,
        cutoffTsMs: 20_000,
        markedAtTsMs: 20_000
      });
    }

    const closed = rehydrate(ledger, 20_000);
    expect(closed.openPositions).toEqual([]);
    expect(closed.closedPositions).toHaveLength(2);
    expect(closed.settledPositions).toEqual([]);
    expect(closed.aggregateExposureMicroUsd).toBe(
      open.reduce((sum, position) => sum + position.entryCostMicroUsd, 0)
    );

    originalPortfolio.settle({ caseId: open[0]!.caseId, won: true, settledAtTsMs: 21_000 });
    originalPortfolio.settle({ caseId: open[1]!.caseId, won: false, settledAtTsMs: 22_000 });
    const settled = rehydrate(ledger, 22_000);
    const originalSummary = originalPortfolio.summary();
    expect(settled.settledPositions).toHaveLength(2);
    expect(settled.aggregateExposureMicroUsd).toBe(0);
    expect(settled.realizedPnlMicroUsd).toBe(originalSummary.realizedPnlMicroUsd);
    expect(settled.peakEquityMicroUsd).toBe(originalSummary.peakEquityMicroUsd);
    expect(settled.currentDrawdownMicroUsd).toBe(originalSummary.currentDrawdownMicroUsd);
    expect(settled.equityMicroUsd).toBe(
      APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd + originalSummary.realizedPnlMicroUsd
    );
    expect(settled.currentDrawdownMicroUsd).toBeGreaterThan(0);
    const rebuiltPortfolio = freshPortfolio(ledger, settled.portfolioInitialState);
    expect(rebuiltPortfolio.summary()).toEqual(originalSummary);
    expect(rebuiltPortfolio.positions()).toEqual(originalPortfolio.positions());
    ledger.close();
  });

  it("derives and restores one deterministic pending expiry without repeating analysis", async () => {
    const ledger = new DecisionLedger(":memory:");
    const originalPortfolio = freshPortfolio(ledger);
    const originalScheduler = scheduler({ ledger, portfolio: originalPortfolio, maximumPendingMs: 2_000 });
    await originalScheduler.enqueue(signal());

    const beforeExpiry = rehydrate(ledger, 13_499, 2_000);
    expect(beforeExpiry.pendingExpirations).toEqual([expect.objectContaining({
      timeoutAtTsMs: 13_500,
      effectiveExpiresAtTsMs: 13_500,
      reason: "no_post_venue_delay_executable_book_before_expiry",
      expiredAsOfTsMs: false
    })]);
    const atExpiry = rehydrate(ledger, 13_500, 2_000);
    expect(atExpiry.pendingExpirations[0]?.expiredAsOfTsMs).toBe(true);
    const spend = { triage: 0, analyst: 0 };
    const rebuiltPortfolio = freshPortfolio(ledger, atExpiry.portfolioInitialState);
    const rebuiltScheduler = scheduler({
      ledger,
      portfolio: rebuiltPortfolio,
      maximumPendingMs: 2_000,
      spend,
      initialState: atExpiry.schedulerInitialState
    });
    expect(rebuiltScheduler.pendingCount()).toBe(1);
    const heartbeat: CanonicalEvent = {
      schemaVersion: 1,
      kind: "feed.heartbeat",
      eventId: "restart-heartbeat",
      source: "polymarket",
      sourceTsMs: 13_500,
      observedTsMs: 13_500,
      fixtureId: null,
      status: "healthy",
      stream: "polymarket",
      detail: null
    };
    expect(await rebuiltScheduler.ingest(heartbeat)).toEqual([]);
    expect(rebuiltScheduler.pendingCount()).toBe(0);
    expect(spend).toEqual({ triage: 0, analyst: 0 });
    expect(ledger.entries().at(-1)).toMatchObject({
      kind: "case_terminal",
      atTsMs: 13_500,
      payload: { status: "failed", reason: "no_post_venue_delay_executable_book_before_expiry" }
    });
    ledger.close();
  });

  it("refuses lifecycle ordering that executes without approval and intent", () => {
    const ledger = new DecisionLedger(":memory:");
    const candidate = signal();
    const caseId = paperCaseIdForSignal("bounty", candidate.signalId);
    ledger.append({
      entryId: `${caseId}:1:signal_received`,
      caseId,
      kind: "signal_received",
      atTsMs: candidate.observedAtTsMs,
      payload: JSON.parse(JSON.stringify({ lane: "bounty", signal: candidate }))
    });
    const invalidFill: PaperFill = {
      adapter: "paper",
      status: "filled",
      reason: null,
      assetId: "asset-over",
      conditionId: "condition-1",
      direction: "buy",
      requestedStakeMicroUsd: microUsd(3_000_000),
      grossMicroUsd: microUsd(2_990_000),
      feeMicroUsd: microUsd(10_000),
      netConsiderationMicroUsd: microUsd(3_000_000),
      filledShares: 5.75,
      averagePrice: 0.52,
      bestPrice: 0.52,
      halfSpreadBps: 50,
      executableDepthUsd: 52,
      slippageProbabilityBps: 0,
      bookObservedTsMs: 11_500,
      feeParameters: fees(11_500)
    };
    ledger.append({
      entryId: `${caseId}:2:paper_execution`,
      caseId,
      kind: "paper_execution",
      atTsMs: 11_500,
      payload: JSON.parse(JSON.stringify(invalidFill))
    });
    expect(() => rehydrate(ledger, 11_500)).toThrow(/lacks intent and approval/);
    ledger.close();
  });

  it("verifies the hash chain before parsing otherwise plausible state", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-rehydrate-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ledger.sqlite");
    const ledger = new DecisionLedger(path);
    const candidate = signal();
    const caseId = paperCaseIdForSignal("bounty", candidate.signalId);
    ledger.append({
      entryId: `${caseId}:1:signal_received`,
      caseId,
      kind: "signal_received",
      atTsMs: candidate.observedAtTsMs,
      payload: JSON.parse(JSON.stringify({ lane: "bounty", signal: candidate }))
    });
    const raw = new Database(path);
    raw.exec("DROP TRIGGER decision_events_no_update");
    raw.prepare("UPDATE decision_events SET payload_json = ? WHERE sequence = 1").run("{}");
    raw.close();
    expect(() => rehydrate(ledger, 10_000)).toThrow(/Broken decision hash/);
    ledger.close();
  });
});
