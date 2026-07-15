import { describe, expect, it, vi } from "vitest";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type FeedEvent,
  type PolymarketBookEvent
} from "../src/bus/events.js";
import type { DetectorSignal } from "../src/detectors/types.js";
import { probability } from "../src/domain/probability.js";
import type { PolymarketFeeParameters } from "../src/exec/paper.js";
import {
  createPersistentPaperLaneRuntime,
  type PersistentPaperLaneRuntime
} from "../src/harness/paper-lane-runtime.js";
import type { PaperFixtureUniverse } from "../src/harness/paper-fixture-universe.js";
import {
  PAPER_SESSION_RUNTIME_CONCURRENCY,
  PaperSessionError,
  runPaperSession
} from "../src/harness/paper-session.js";
import { initializePaperStudyLedger } from "../src/harness/paper-study-ledger.js";

function emptyUniverse(): PaperFixtureUniverse {
  return {
    generatedAt: "2026-07-15T00:00:00.000Z",
    laneStartTsMs: 1_000,
    selectorConfig: {
      minimumCoveragePoints: 1_000,
      minimumVolume: 0,
      minimumLiquidity: 0,
      maximumDistanceFromEven: 0.15,
      weights: { balance: 1, volume: 0, liquidity: 0, coverage: 0 }
    },
    fixtures: [],
    summary: {
      fixtures: 0,
      pairedBookReplays: 0,
      executableBookReplays: 0,
      bookLifecycleReplays: 0,
      signalResearchOnly: 0,
      unavailable: 0,
      longRunEligible: 0
    }
  };
}

function persistentRuntime(overrides: Partial<Pick<
  Parameters<typeof createPersistentPaperLaneRuntime>[0],
  "triageAgent" | "analystAgent" | "feeResolver" | "executionLatencyMs" | "maximumPendingMs"
>> = {}): {
  lane: PersistentPaperLaneRuntime;
  close: () => void;
} {
  const handle = initializePaperStudyLedger({
    path: ":memory:",
    lane: "bounty",
    startedAtTsMs: 1_000
  });
  return {
    lane: createPersistentPaperLaneRuntime({
      lane: "bounty",
      initialization: handle.initialization,
      universe: emptyUniverse(),
      ledger: handle.ledger,
      triageAgent: overrides.triageAgent ?? {
        triage: async () => ({ decision: "drop", priority: "normal", rationale: "test" })
      },
      analystAgent: overrides.analystAgent ?? {
        investigate: async () => { throw new Error("unused"); }
      },
      feeResolver: overrides.feeResolver ?? (async () => { throw new Error("unused"); }),
      executionLatencyMs: overrides.executionLatencyMs ?? 500,
      maximumPendingMs: overrides.maximumPendingMs ?? 5_000
    }),
    close: () => handle.ledger.close()
  };
}

function heartbeat(index: number): FeedEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "feed.heartbeat",
    eventId: `heartbeat-${index}`,
    source: "txline",
    sourceTsMs: 2_000 + index,
    observedTsMs: 2_100 + index,
    fixtureId: null,
    status: "healthy",
    stream: "test",
    detail: null
  };
}

async function* events(items: CanonicalEvent[]): AsyncGenerator<CanonicalEvent> {
  for (const event of items) yield event;
}

function terminalSignal(): DetectorSignal {
  return {
    signalId: "session-terminal-signal",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: 2_000,
    observedAtTsMs: 2_100,
    fixtureId: "fixture-terminal",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-terminal:total_goals:full_time:2500"
    },
    outcome: "over",
    direction: "buy",
    eligibility: "pretrade_review_required",
    reason: "conductor terminal accounting test",
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

function executableSignal(): DetectorSignal {
  return {
    signalId: "session-executable-signal",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: 10_000,
    observedAtTsMs: 10_000,
    fixtureId: "fixture-executable",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-executable:total_goals:full_time:2500"
    },
    outcome: "over",
    direction: "buy",
    eligibility: "pretrade_review_required",
    reason: "session halt execution-boundary regression",
    evidence: {
      consensusProbability: 0.55,
      polymarketProbability: 0.515,
      consensusVelocity: 0.02,
      consensusZScore: 1.5,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0.002,
      cusumDown: 0,
      rawGap: 0.035,
      gapBasis: "live_book",
      persistenceMs: 0,
      mappingStatus: "verified",
      scoreContextActions: []
    }
  };
}

function executableBook(index: number): PolymarketBookEvent {
  const signal = executableSignal();
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.book",
    eventId: `executable-book-${index}`,
    source: "polymarket",
    sourceTsMs: 11_500 + index,
    observedTsMs: 11_500 + index,
    fixtureId: signal.fixtureId,
    market: signal.market,
    mappingStatus: "verified",
    conditionId: "condition-executable",
    assetId: "asset-over",
    outcome: signal.outcome,
    tokenRole: "canonical",
    bids: [{ price: probability(0.51), size: "20" }],
    asks: [
      { price: probability(0.52), size: "20" },
      { price: probability(0.53), size: "20" }
    ],
    lastTradePrice: probability(0.52),
    tickSize: "0.01"
  };
}

function executableFees(asOfTsMs: number): PolymarketFeeParameters {
  return {
    source: "polymarket_clob_market_info",
    conditionId: "condition-executable",
    feesEnabled: true,
    takerFeeRate: 0.05,
    feeCurveExponent: 1,
    takerOnly: true,
    minimumOrderSize: 5,
    minimumTickSize: 0.01,
    fetchedAtTsMs: asOfTsMs
  };
}

function executableRuntime(overrides: Partial<Pick<
  Parameters<typeof createPersistentPaperLaneRuntime>[0],
  "feeResolver"
>> = {}): ReturnType<typeof persistentRuntime> {
  const candidate = executableSignal();
  const runtime = persistentRuntime({
    triageAgent: {
      triage: async () => ({
        decision: "escalate",
        priority: "normal",
        rationale: "Admitted execution-boundary candidate."
      })
    },
    analystAgent: {
      investigate: async ({ signal }) => ({
        schemaVersion: 1,
        signalId: signal.signalId,
        fixtureId: signal.fixtureId,
        marketKey: signal.market.key,
        outcome: signal.outcome,
        direction: signal.direction,
        recommendation: "paper_trade",
        fairProbability: 0.55,
        thesisSummary: "Executable consensus gap remains after model review.",
        evidenceFor: ["Canonical ask remains below deterministic fair value."],
        steelmanAgainst: "The move may reverse before kickoff.",
        invalidationConditions: ["Canonical ask reaches the locked limit."],
        submittedAtTsMs: signal.observedAtTsMs + 1,
        expiresAtTsMs: signal.observedAtTsMs + 60_000,
        analystModel: "test-analyst"
      })
    },
    feeResolver: overrides.feeResolver ?? (async (_book, asOfTsMs) => executableFees(asOfTsMs))
  });
  runtime.lane.eligibleMarketKeys.add(candidate.market.key);
  runtime.lane.kickoffByFixtureId.set(candidate.fixtureId, 2_000_000);
  return runtime;
}

describe("paper session conductor", () => {
  it("routes a canonical source through one persistent runtime and observes every batch", async () => {
    const runtime = persistentRuntime();
    const observations: string[] = [];
    try {
      const summary = await runPaperSession({
        source: events([heartbeat(1), heartbeat(2)]),
        runtime: runtime.lane,
        onBatch: ({ event, counters }) => {
          observations.push(event.eventId);
          expect(counters.events).toBe(observations.length);
          expect(counters.runtimeBatches).toBe(observations.length);
        }
      });

      expect(observations).toEqual(["heartbeat-1", "heartbeat-2"]);
      expect(summary).toMatchObject({
        status: "completed",
        lane: "bounty",
        observedEvents: 2,
        events: 2,
        runtimeBatches: 2,
        terminalCases: 0,
        pendingCases: 0,
        ledgerRows: 1,
        ingressQueueCapacity: 4_096,
        runtimeConcurrency: PAPER_SESSION_RUNTIME_CONCURRENCY,
        sourceShutdownTimeoutMs: 1_000,
        sourceShutdownTimedOut: false,
        halt: null
      });
      expect(runtime.lane.runtime.dependencies.scheduler).toBe(runtime.lane.scheduler);
    } finally {
      runtime.close();
    }
  });

  it("counts terminal cases from the authoritative ledger even when absent from the batch", async () => {
    const runtime = persistentRuntime();
    const originalIngest = runtime.lane.runtime.ingest.bind(runtime.lane.runtime);
    const terminal = terminalSignal();
    const observedTerminals: string[] = [];
    vi.spyOn(runtime.lane.runtime, "ingest").mockImplementation(async (event) => {
      const batch = await originalIngest(event);
      runtime.lane.scheduler.dependencies.pipeline.terminateRecordedSignal({
        lane: runtime.lane.lane,
        signal: terminal,
        atTsMs: terminal.observedAtTsMs + 1,
        reason: "test_terminal"
      });
      return batch;
    });
    try {
      const summary = await runPaperSession({
        source: events([heartbeat(1)]),
        runtime: runtime.lane,
        onTerminal: ({ terminal: entry }) => {
          observedTerminals.push(entry.caseId);
        }
      });

      expect(summary.terminalCases).toBe(1);
      expect(summary.caseResults).toBe(0);
      expect(observedTerminals).toHaveLength(1);
      expect(runtime.lane.scheduler.dependencies.pipeline.dependencies.ledger.entries()
        .map((entry) => entry.kind)).toEqual([
        "study_initialized",
        "signal_received",
        "case_terminal"
      ]);
    } finally {
      runtime.close();
    }
  });

  it("stops queued runtime delivery when aborted even if ingress already observed ahead", async () => {
    const runtime = persistentRuntime();
    const controller = new AbortController();
    let pulled = 0;
    let finalized = false;
    async function* source(): AsyncGenerator<CanonicalEvent> {
      try {
        pulled += 1;
        yield heartbeat(1);
        pulled += 1;
        yield heartbeat(2);
      } finally {
        finalized = true;
      }
    }
    try {
      const summary = await runPaperSession({
        source: source(),
        runtime: runtime.lane,
        signal: controller.signal,
        onBatch: () => controller.abort()
      });

      expect(summary).toMatchObject({
        status: "aborted",
        observedEvents: 2,
        events: 1,
        runtimeBatches: 1,
        halt: null
      });
      expect(pulled).toBe(2);
      expect(finalized).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it("fails closed on runtime errors and finalizes the source without processing another event", async () => {
    const runtime = persistentRuntime();
    let pulled = 0;
    let finalized = false;
    async function* source(): AsyncGenerator<CanonicalEvent> {
      try {
        pulled += 1;
        yield heartbeat(1);
        pulled += 1;
        yield heartbeat(2);
      } finally {
        finalized = true;
      }
    }
    vi.spyOn(runtime.lane.runtime, "ingest").mockRejectedValue(new Error("runtime exploded"));
    try {
      const failure = await runPaperSession({
        source: source(),
        runtime: runtime.lane
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(PaperSessionError);
      expect(failure).toMatchObject({
        summary: {
          status: "failed",
          observedEvents: 2,
          events: 0,
          runtimeBatches: 0,
          terminalCases: 0,
          halt: { code: "runtime_failed" }
        }
      });
      expect((failure as Error).message).toMatch(/stopped fail closed.*runtime exploded/);
      expect(pulled).toBe(2);
      expect(finalized).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it("bounds shutdown when a direct source ignores abort and iterator return", async () => {
    const runtime = persistentRuntime();
    let nextCalls = 0;
    let returnCalls = 0;
    let markSecondNextStarted!: () => void;
    let rejectReturn!: (error: unknown) => void;
    const secondNextStarted = new Promise<void>((resolve) => { markSecondNextStarted = resolve; });
    const neverNext = new Promise<IteratorResult<CanonicalEvent>>(() => undefined);
    const source: AsyncIterable<CanonicalEvent> = {
      [Symbol.asyncIterator](): AsyncIterator<CanonicalEvent> {
        return {
          next: () => {
            nextCalls += 1;
            if (nextCalls === 1) {
              return Promise.resolve({ done: false, value: heartbeat(1) });
            }
            markSecondNextStarted();
            return neverNext;
          },
          return: () => {
            returnCalls += 1;
            return new Promise<IteratorResult<CanonicalEvent>>((_, reject) => {
              rejectReturn = reject;
            });
          }
        };
      }
    };
    vi.spyOn(runtime.lane.runtime, "ingest").mockImplementation(async () => {
      await secondNextStarted;
      throw new Error("runtime stopped while source ignored cancellation");
    });

    try {
      const startedAt = Date.now();
      const failure = await runPaperSession({
        source,
        runtime: runtime.lane,
        sourceShutdownTimeoutMs: 20
      }).catch((error: unknown) => error);

      expect(Date.now() - startedAt).toBeLessThan(500);
      expect(failure).toBeInstanceOf(PaperSessionError);
      expect(failure).toMatchObject({
        summary: {
          status: "failed",
          observedEvents: 1,
          events: 0,
          sourceShutdownTimeoutMs: 20,
          sourceShutdownTimedOut: true,
          halt: { code: "runtime_failed" }
        }
      });
      expect((failure as PaperSessionError).summary.halt?.reason).toMatch(
        /source shutdown exceeded 20ms/
      );
      expect(nextCalls).toBe(2);
      expect(returnCalls).toBe(1);

      // A late rejection from the ignored return request is already observed
      // by the conductor's settled-task wrapper, so it cannot become an
      // unhandled rejection after runPaperSession has returned.
      rejectReturn(new Error("late iterator return rejection"));
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      runtime.close();
    }
  });

  it("does not call a finite replay complete while cases remain pending", async () => {
    const runtime = persistentRuntime();
    vi.spyOn(runtime.lane.scheduler, "pendingCount").mockReturnValue(1);
    try {
      const failure = await runPaperSession({
        source: events([heartbeat(1)]),
        runtime: runtime.lane
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(PaperSessionError);
      expect(failure).toMatchObject({
        summary: {
          status: "failed",
          events: 1,
          runtimeBatches: 1,
          pendingCases: 1,
          halt: { code: "completion_invariant_failed" }
        }
      });
      expect((failure as Error).message).toMatch(/source ended with 1 pending case/);
    } finally {
      runtime.close();
    }
  });

  it("durably terminalizes prepared cases when the caller aborts without another runtime event", async () => {
    const runtime = executableRuntime();
    const controller = new AbortController();
    const candidate = executableSignal();
    try {
      expect(await runtime.lane.scheduler.enqueue(candidate)).toBe(true);
      expect(runtime.lane.scheduler.pendingCount()).toBe(1);
      controller.abort(new Error("operator stopped session"));

      const summary = await runPaperSession({
        source: events([heartbeat(1)]),
        runtime: runtime.lane,
        signal: controller.signal
      });

      expect(summary).toMatchObject({
        status: "aborted",
        observedEvents: 0,
        events: 0,
        terminalCases: 1,
        pendingCases: 0,
        halt: null
      });
      const caseEntries = runtime.lane.scheduler.dependencies.pipeline.dependencies.ledger
        .entries()
        .filter((entry) => entry.kind !== "study_initialized");
      expect(caseEntries.map((entry) => entry.kind)).toEqual([
        "signal_received",
        "triage_decision",
        "thesis_submitted",
        "analysis_completed",
        "case_terminal"
      ]);
      expect(caseEntries.at(-1)?.payload).toEqual({
        status: "failed",
        reason: "session_halted:caller_abort"
      });
    } finally {
      runtime.close();
    }
  });

  it("terminalizes a real fee-gated case when ingress overflows before execution", async () => {
    const capacity = 2;
    let releaseFee!: () => void;
    let markFeeStarted!: () => void;
    const feeGate = new Promise<void>((resolve) => { releaseFee = resolve; });
    const feeStarted = new Promise<void>((resolve) => { markFeeStarted = resolve; });
    let operationSignal: AbortSignal | undefined;
    const runtime = executableRuntime({
      feeResolver: async (_book, asOfTsMs, haltSignal) => {
        operationSignal = haltSignal;
        markFeeStarted();
        await feeGate;
        return executableFees(asOfTsMs);
      }
    });
    const candidate = executableSignal();
    const executor = runtime.lane.scheduler.dependencies.pipeline.dependencies.executor;
    const execute = vi.spyOn(executor, "execute");
    let pulled = 0;
    let finalized = false;
    async function* busyBooks(): AsyncGenerator<CanonicalEvent> {
      try {
        pulled += 1;
        yield executableBook(1);
        await feeStarted;
        for (let index = 2; index <= 10; index += 1) {
          pulled += 1;
          yield executableBook(index);
        }
      } finally {
        finalized = true;
      }
    }

    try {
      expect(await runtime.lane.scheduler.enqueue(candidate)).toBe(true);
      expect(runtime.lane.scheduler.pendingCount()).toBe(1);
      const session = runPaperSession({
        source: busyBooks(),
        runtime: runtime.lane,
        ingressQueueCapacity: capacity
      }).catch((error: unknown) => error);

      await feeStarted;
      await vi.waitFor(() => {
        expect(pulled).toBe(capacity + 2);
        expect(finalized).toBe(true);
      });
      expect(operationSignal?.aborted).toBe(true);
      releaseFee();

      const failure = await session;
      expect(failure).toBeInstanceOf(PaperSessionError);
      expect(failure).toMatchObject({
        summary: {
          status: "failed",
          observedEvents: capacity + 2,
          events: 1,
          caseResults: 1,
          terminalCases: 1,
          pendingCases: 0,
          ingressQueueOverflows: 1,
          halt: { code: "ingress_queue_overflow" }
        }
      });
      expect(execute).not.toHaveBeenCalled();
      const caseEntries = runtime.lane.scheduler.dependencies.pipeline.dependencies.ledger
        .entries()
        .filter((entry) => entry.kind !== "study_initialized");
      expect(caseEntries.map((entry) => entry.kind)).toEqual([
        "signal_received",
        "triage_decision",
        "thesis_submitted",
        "analysis_completed",
        "case_terminal"
      ]);
      expect(caseEntries.at(-1)?.payload).toEqual({
        status: "failed",
        reason: "session_halted:after_fee_resolution"
      });
    } finally {
      releaseFee();
      runtime.close();
    }
  });

  it("finishes and ledgers an executor action already invoked before ingress overflow", async () => {
    const capacity = 2;
    const runtime = executableRuntime();
    const candidate = executableSignal();
    const executor = runtime.lane.scheduler.dependencies.pipeline.dependencies.executor;
    const originalExecute = executor.execute.bind(executor);
    let releaseExecution!: () => void;
    let markExecutionStarted!: () => void;
    const executionGate = new Promise<void>((resolve) => { releaseExecution = resolve; });
    const executionStarted = new Promise<void>((resolve) => { markExecutionStarted = resolve; });
    const execute = vi.spyOn(executor, "execute").mockImplementation(async (intent, book, fees) => {
      markExecutionStarted();
      await executionGate;
      return originalExecute(intent, book, fees);
    });
    let pulled = 0;
    let finalized = false;
    async function* busyBooks(): AsyncGenerator<CanonicalEvent> {
      try {
        pulled += 1;
        yield executableBook(1);
        await executionStarted;
        for (let index = 2; index <= 10; index += 1) {
          pulled += 1;
          yield executableBook(index);
        }
      } finally {
        finalized = true;
      }
    }

    try {
      expect(await runtime.lane.scheduler.enqueue(candidate)).toBe(true);
      const session = runPaperSession({
        source: busyBooks(),
        runtime: runtime.lane,
        ingressQueueCapacity: capacity
      }).catch((error: unknown) => error);

      await executionStarted;
      await vi.waitFor(() => {
        expect(pulled).toBe(capacity + 2);
        expect(finalized).toBe(true);
      });
      releaseExecution();

      const failure = await session;
      expect(failure).toBeInstanceOf(PaperSessionError);
      expect(failure).toMatchObject({
        summary: {
          status: "failed",
          events: 1,
          caseResults: 1,
          terminalCases: 1,
          pendingCases: 0,
          ingressQueueOverflows: 1,
          halt: { code: "ingress_queue_overflow" }
        }
      });
      expect(execute).toHaveBeenCalledTimes(1);
      const kinds = runtime.lane.scheduler.dependencies.pipeline.dependencies.ledger
        .entries()
        .map((entry) => entry.kind);
      expect(kinds).toContain("execution_intent");
      expect(kinds).toContain("paper_execution");
      expect(kinds).toContain("position_opened");
      expect(kinds.at(-2)).toBe("case_terminal");
      expect(kinds.at(-1)).toBe("position_opened");
    } finally {
      releaseExecution();
      runtime.close();
    }
  });

  it("keeps receiving during slow analysis, then halts deterministically at the hard bound", async () => {
    const runtime = persistentRuntime();
    const capacity = 2;
    let releaseRuntime!: () => void;
    let markRuntimeStarted!: () => void;
    const runtimeGate = new Promise<void>((resolve) => { releaseRuntime = resolve; });
    const runtimeStarted = new Promise<void>((resolve) => { markRuntimeStarted = resolve; });
    const originalIngest = runtime.lane.runtime.ingest.bind(runtime.lane.runtime);
    const runtimeEvents: string[] = [];
    vi.spyOn(runtime.lane.runtime, "ingest").mockImplementation(async (event) => {
      runtimeEvents.push(event.eventId);
      markRuntimeStarted();
      await runtimeGate;
      return originalIngest(event);
    });

    let pulled = 0;
    let finalized = false;
    async function* busySource(): AsyncGenerator<CanonicalEvent> {
      try {
        for (let index = 1; index <= 10; index += 1) {
          pulled += 1;
          yield heartbeat(index);
        }
      } finally {
        finalized = true;
      }
    }
    const ingressEvents: string[] = [];
    try {
      const session = runPaperSession({
        source: busySource(),
        runtime: runtime.lane,
        ingressQueueCapacity: capacity,
        onIngress: ({ event }) => { ingressEvents.push(event.eventId); }
      }).catch((error: unknown) => error);

      await runtimeStarted;
      await vi.waitFor(() => {
        expect(pulled).toBe(capacity + 2);
        expect(finalized).toBe(true);
      });

      // Receipt/journaling hooks run at ingress, independently of the blocked
      // Haiku/Opus-shaped runtime stage. Only one ordered runtime is active.
      expect(ingressEvents).toEqual([
        "heartbeat-1",
        "heartbeat-2",
        "heartbeat-3",
        "heartbeat-4"
      ]);
      expect(runtimeEvents).toEqual(["heartbeat-1"]);

      releaseRuntime();
      const failure = await session;
      expect(failure).toBeInstanceOf(PaperSessionError);
      expect(failure).toMatchObject({
        summary: {
          status: "failed",
          observedEvents: 4,
          events: 1,
          runtimeBatches: 1,
          ingressQueueCapacity: capacity,
          ingressQueueHighWaterMark: capacity,
          ingressQueueOverflows: 1,
          runtimeConcurrency: 1,
          halt: { code: "ingress_queue_overflow" }
        }
      });
      expect((failure as Error).message).toMatch(/overflowed at capacity 2/);
      expect(runtimeEvents).toEqual(["heartbeat-1"]);
    } finally {
      releaseRuntime();
      runtime.close();
    }
  });
});
