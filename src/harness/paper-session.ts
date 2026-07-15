import { CanonicalEventBus } from "../bus/event-bus.js";
import type { CanonicalEvent } from "../bus/events.js";
import {
  BoundedAsyncQueue,
  BoundedAsyncQueueOverflowError,
  type BoundedAsyncQueueSnapshot
} from "../domain/bounded-async-queue.js";
import type { DecisionLedger, DecisionLedgerEntry } from "../store/decision-ledger.js";
import type { PersistentPaperLaneRuntime } from "./paper-lane-runtime.js";
import type { PaperRuntimeBatch } from "./paper-runtime.js";

/**
 * Memory-safety default, not a model-latency guarantee. The Spain-Belgium
 * corpus peaked around 344 normalized events/s, so 4,096 is only ~11.9s at
 * that unfiltered rate. Runnable deployments must filter to admitted markets,
 * use causal replay pacing, and explicitly size this bound from measured rate.
 */
export const PAPER_SESSION_DEFAULT_INGRESS_CAPACITY = 4_096;
export const PAPER_SESSION_DEFAULT_SOURCE_SHUTDOWN_TIMEOUT_MS = 1_000;
/**
 * Runtime/ledger mutation remains strictly ordered. This is deliberately one,
 * below the harness-wide maximum of three concurrent investigations; safely
 * raising it requires staged per-case ledger commits, not concurrent appends.
 */
export const PAPER_SESSION_RUNTIME_CONCURRENCY = 1 as const;

export type PaperSessionStatus = "completed" | "aborted" | "failed";

export type PaperSessionHaltCode =
  | "ingress_queue_overflow"
  | "ingress_failed"
  | "source_shutdown_timeout"
  | "runtime_failed"
  | "completion_invariant_failed";

export type PaperSessionHalt = {
  code: PaperSessionHaltCode;
  reason: string;
};

export type PaperSessionCounters = {
  /** Canonical events pulled and timestamped by the source boundary. */
  observedEvents: number;
  /** Canonical events that completed the ordered paper runtime. */
  events: number;
  runtimeBatches: number;
  terminalCases: number;
  rawSignals: number;
  signals: number;
  routedSignals: number;
  caseResults: number;
  closeResults: number;
  settlementResults: number;
  ingressQueueHighWaterMark: number;
  ingressQueueOverflows: number;
};

export type PaperSessionSummary = PaperSessionCounters & {
  status: PaperSessionStatus;
  lane: PersistentPaperLaneRuntime["lane"];
  pendingCases: number;
  ledgerRows: number;
  ledgerHeadHash: string;
  ingressQueueCapacity: number;
  runtimeConcurrency: typeof PAPER_SESSION_RUNTIME_CONCURRENCY;
  sourceShutdownTimeoutMs: number;
  sourceShutdownTimedOut: boolean;
  halt: PaperSessionHalt | null;
};

export type PaperSessionIngressObservation = {
  event: CanonicalEvent;
  sourceSequence: number;
  queueDepthBefore: number;
  queueCapacity: number;
};

export type PaperSessionBatchObservation = {
  event: CanonicalEvent;
  batch: PaperRuntimeBatch;
  counters: PaperSessionCounters;
};

export type PaperSessionTerminalObservation = {
  event: CanonicalEvent;
  terminal: DecisionLedgerEntry;
  counters: PaperSessionCounters;
};

export type PaperSessionSource =
  | AsyncIterable<CanonicalEvent>
  | ((signal: AbortSignal) => AsyncIterable<CanonicalEvent>);

export type RunPaperSessionOptions = {
  /**
   * A caller-assembled canonical source. Live and replay assembly deliberately
   * remain outside this conductor so both modes traverse this exact path. A
   * factory is preferred for live sources because the conductor can abort it
   * immediately on an overload or runtime halt.
   */
  source: PaperSessionSource;
  /** Exactly one already-admitted, persistent, paper-only lane runtime. */
  runtime: PersistentPaperLaneRuntime;
  signal?: AbortSignal;
  ingressQueueCapacity?: number;
  sourceShutdownTimeoutMs?: number;
  /**
   * Synchronous canonical-observation hook. Append-only journaling/accounting
   * belongs here: it runs immediately after source receipt, before queueing and
   * without waiting for Haiku/Opus analysis. Promise-returning hooks are
   * rejected because an async observer would recreate feed backpressure.
   */
  onIngress?: (observation: PaperSessionIngressObservation) => void;
  onBatch?: (observation: PaperSessionBatchObservation) => void | Promise<void>;
  onTerminal?: (observation: PaperSessionTerminalObservation) => void | Promise<void>;
};

const activeRuntimes = new WeakSet<PersistentPaperLaneRuntime>();

class PaperSessionIngressError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "PaperSessionIngressError";
  }
}

class PaperSessionRuntimeError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "PaperSessionRuntimeError";
  }
}

class PaperSessionSourceShutdownError extends Error {
  constructor(timeoutMs: number) {
    super(`Canonical source did not stop within ${timeoutMs}ms after cancellation`);
    this.name = "PaperSessionSourceShutdownError";
  }
}

class PaperSessionCompletionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PaperSessionCompletionError";
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && typeof (value as { then?: unknown }).then === "function";
}

function zeroCounters(): PaperSessionCounters {
  return {
    observedEvents: 0,
    events: 0,
    runtimeBatches: 0,
    terminalCases: 0,
    rawSignals: 0,
    signals: 0,
    routedSignals: 0,
    caseResults: 0,
    closeResults: 0,
    settlementResults: 0,
    ingressQueueHighWaterMark: 0,
    ingressQueueOverflows: 0
  };
}

function copyCounters(counters: PaperSessionCounters): PaperSessionCounters {
  return { ...counters };
}

function assertPaperOnlyRuntime(runtime: PersistentPaperLaneRuntime): DecisionLedger {
  if (runtime.initialization.lane !== runtime.lane) {
    throw new Error("Paper session lane does not match its persistent initialization");
  }
  if (runtime.initialization.realMoneyGate !== "closed") {
    throw new Error("Paper session requires a closed real-money gate");
  }
  if (runtime.runtime.dependencies.scheduler !== runtime.scheduler) {
    throw new Error("Paper session runtime is not connected to its persistent scheduler");
  }
  if (runtime.scheduler.dependencies.config.lane !== runtime.lane) {
    throw new Error("Paper session scheduler lane mismatch");
  }
  if (runtime.portfolio.options.lane !== runtime.lane) {
    throw new Error("Paper session portfolio lane mismatch");
  }
  const ledger = runtime.scheduler.dependencies.pipeline.dependencies.ledger;
  if (runtime.portfolio.options.ledger !== ledger) {
    throw new Error("Paper session scheduler and portfolio do not share one decision ledger");
  }
  return ledger;
}

function updateBatchCounters(counters: PaperSessionCounters, batch: PaperRuntimeBatch): void {
  counters.events += 1;
  counters.runtimeBatches += 1;
  counters.rawSignals += batch.rawSignals.length;
  counters.signals += batch.signals.length;
  counters.routedSignals += batch.routedSignalIds.length;
  counters.caseResults += batch.caseResults.length;
  counters.closeResults += batch.closeResults.length;
  counters.settlementResults += batch.settlementResults.length;
}

function updateQueueCounters(
  counters: PaperSessionCounters,
  snapshot: BoundedAsyncQueueSnapshot
): void {
  counters.ingressQueueHighWaterMark = Math.max(
    counters.ingressQueueHighWaterMark,
    snapshot.highWaterMark
  );
  counters.ingressQueueOverflows = Math.max(
    counters.ingressQueueOverflows,
    snapshot.overflowCount
  );
}

function sessionSummary(
  status: PaperSessionStatus,
  runtime: PersistentPaperLaneRuntime,
  ledger: DecisionLedger,
  counters: PaperSessionCounters,
  queue: BoundedAsyncQueue<CanonicalEvent>,
  sourceShutdownTimeoutMs: number,
  sourceShutdownTimedOut: boolean,
  halt: PaperSessionHalt | null
): PaperSessionSummary {
  const entries = ledger.entries();
  const queueSnapshot = queue.snapshot();
  updateQueueCounters(counters, queueSnapshot);
  return {
    status,
    lane: runtime.lane,
    ...copyCounters(counters),
    pendingCases: runtime.scheduler.pendingCount(),
    ledgerRows: entries.length,
    ledgerHeadHash: entries.at(-1)?.entryHash ?? "0".repeat(64),
    ingressQueueCapacity: queueSnapshot.capacity,
    runtimeConcurrency: PAPER_SESSION_RUNTIME_CONCURRENCY,
    sourceShutdownTimeoutMs,
    sourceShutdownTimedOut,
    halt
  };
}

function classifyHalt(error: unknown): PaperSessionHalt {
  if (error instanceof BoundedAsyncQueueOverflowError) {
    return { code: "ingress_queue_overflow", reason: error.message };
  }
  if (error instanceof PaperSessionIngressError) {
    return { code: "ingress_failed", reason: error.message };
  }
  if (error instanceof PaperSessionSourceShutdownError) {
    return { code: "source_shutdown_timeout", reason: error.message };
  }
  if (error instanceof PaperSessionRuntimeError) {
    return { code: "runtime_failed", reason: error.message };
  }
  return { code: "completion_invariant_failed", reason: errorMessage(error) };
}

export class PaperSessionError extends Error {
  readonly summary: PaperSessionSummary;

  constructor(message: string, summary: PaperSessionSummary, cause: unknown) {
    super(message, { cause });
    this.name = "PaperSessionError";
    this.summary = summary;
  }
}

type SettledTask = { ok: true } | { ok: false; error: unknown };

function taskOutcome(task: Promise<void>): Promise<SettledTask> {
  return task.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error })
  );
}

type TimedTaskOutcome =
  | { timedOut: false; outcome: SettledTask }
  | { timedOut: true };

async function waitForTask(
  task: Promise<SettledTask>,
  timeoutMs: number
): Promise<TimedTaskOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimedTaskOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const result = await Promise.race([
    task.then((outcome): TimedTaskOutcome => ({ timedOut: false, outcome })),
    timeout
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

/**
 * Consume one mode-agnostic canonical stream through one persistent paper
 * lane. Source receipt is decoupled from the ordered runtime by a hard-bounded
 * queue: observation timestamps and synchronous journaling continue during a
 * slow model call, while runtime/ledger mutation remains serial and
 * deterministic. Capacity exhaustion halts the source and discards the
 * backlog; it never drops an event silently or acts on a partial stream.
 */
export async function runPaperSession(options: RunPaperSessionOptions): Promise<PaperSessionSummary> {
  const ledger = assertPaperOnlyRuntime(options.runtime);
  const sourceShutdownTimeoutMs = options.sourceShutdownTimeoutMs ??
    PAPER_SESSION_DEFAULT_SOURCE_SHUTDOWN_TIMEOUT_MS;
  if (!Number.isSafeInteger(sourceShutdownTimeoutMs) || sourceShutdownTimeoutMs <= 0) {
    throw new RangeError("Paper session source shutdown timeout must be a positive safe integer");
  }
  const counters = zeroCounters();
  let lastObservedTsMs = options.runtime.initialization.startedAtTsMs;
  let sourceShutdownTimedOut = false;
  const terminalCaseIds = new Set<string>();
  let ledgerCursor = ledger.entries().at(-1)?.sequence ?? 0;
  const bus = new CanonicalEventBus();
  const queue = new BoundedAsyncQueue<CanonicalEvent>({
    label: "paper-session canonical ingress queue",
    capacity: options.ingressQueueCapacity ?? PAPER_SESSION_DEFAULT_INGRESS_CAPACITY
  });
  const sourceController = new AbortController();

  const collectTerminals = (): DecisionLedgerEntry[] => {
    const additions = ledger.entriesAfter(ledgerCursor);
    const latest = additions.at(-1);
    if (latest) ledgerCursor = latest.sequence;
    const terminals = additions.filter((entry) => entry.kind === "case_terminal");
    for (const terminal of terminals) {
      if (terminalCaseIds.has(terminal.caseId)) {
        throw new Error(`Paper session observed duplicate terminal case ${terminal.caseId}`);
      }
      terminalCaseIds.add(terminal.caseId);
      counters.terminalCases += 1;
    }
    return terminals;
  };

  const haltRuntimePending = (reason: string): void => {
    options.runtime.scheduler.haltPending(lastObservedTsMs, reason);
    collectTerminals();
  };

  bus.subscribe(async (event) => {
    // The same operation halt reaches every awaited runtime boundary. Work not
    // yet invoked is terminalized; an executor already invoked is allowed to
    // finish and ledger its result atomically before this batch returns.
    const batch = await options.runtime.runtime.ingest(event, {
      haltSignal: sourceController.signal
    });
    updateBatchCounters(counters, batch);
    const terminals = collectTerminals();
    const observation = structuredClone({
      event,
      batch,
      counters: copyCounters(counters)
    });
    await options.onBatch?.(observation);
    for (const terminal of terminals) {
      await options.onTerminal?.(structuredClone({
        event,
        terminal,
        counters: copyCounters(counters)
      }));
    }
  });

  if (activeRuntimes.has(options.runtime)) {
    throw new Error("A paper session is already consuming this persistent runtime");
  }
  if (isAborted(options.signal)) sourceController.abort(options.signal?.reason);
  const source = typeof options.source === "function"
    ? options.source(sourceController.signal)
    : options.source;
  const iterator = source[Symbol.asyncIterator]();
  activeRuntimes.add(options.runtime);

  let iteratorReturnOutcome: Promise<SettledTask> | null = null;
  const requestIteratorReturn = (): Promise<SettledTask> | null => {
    if (!iterator.return) return null;
    if (iteratorReturnOutcome === null) {
      const close = iterator.return;
      iteratorReturnOutcome = taskOutcome(Promise.resolve().then(async () => {
        await close.call(iterator);
      }));
    }
    return iteratorReturnOutcome;
  };

  const abortFromCaller = () => {
    sourceController.abort(options.signal?.reason);
    updateQueueCounters(counters, queue.stop());
    haltRuntimePending("session_halted:caller_abort");
  };
  if (isAborted(options.signal)) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const produce = async (): Promise<void> => {
    let sourceDone = false;
    try {
      while (!sourceController.signal.aborted) {
        const next = await iterator.next();
        if (next.done) {
          sourceDone = true;
          updateQueueCounters(counters, queue.end());
          return;
        }
        if (sourceController.signal.aborted) {
          updateQueueCounters(counters, queue.stop());
          return;
        }
        counters.observedEvents += 1;
        if (
          Number.isSafeInteger(next.value.observedTsMs) &&
          next.value.observedTsMs >= lastObservedTsMs
        ) {
          lastObservedTsMs = next.value.observedTsMs;
        }
        const observerResult: unknown = options.onIngress?.(structuredClone({
          event: next.value,
          sourceSequence: counters.observedEvents,
          queueDepthBefore: queue.snapshot().depth,
          queueCapacity: queue.snapshot().capacity
        }));
        if (isPromiseLike(observerResult)) {
          void Promise.resolve(observerResult).catch(() => undefined);
          throw new Error("Paper session onIngress must be synchronous");
        }
        updateQueueCounters(counters, queue.push(next.value));
      }
      updateQueueCounters(counters, queue.stop());
    } catch (error) {
      if (sourceController.signal.aborted && !(error instanceof BoundedAsyncQueueOverflowError)) {
        updateQueueCounters(counters, queue.stop());
        return;
      }
      const failure = error instanceof BoundedAsyncQueueOverflowError
        ? error
        : new PaperSessionIngressError(
          `Canonical source or ingress observer failed: ${errorMessage(error)}`,
          error
        );
      updateQueueCounters(counters, queue.fail(failure));
      sourceController.abort(failure);
      haltRuntimePending("session_halted:ingress_failure");
      throw failure;
    } finally {
      if (!sourceDone) {
        const closeOutcome = await requestIteratorReturn();
        if (closeOutcome && !closeOutcome.ok && !sourceController.signal.aborted) {
          throw closeOutcome.error;
        }
      }
    }
  };

  const consume = async (): Promise<void> => {
    while (true) {
      const next = await queue.take();
      if (next.done) return;
      try {
        await bus.publish(next.value);
      } catch (error) {
        throw new PaperSessionRuntimeError(
          `Ordered paper runtime failed: ${errorMessage(error)}`,
          error
        );
      }
    }
  };

  try {
    // Verify before accepting any new event, then verify the complete chain at
    // the terminal boundary. Runtime construction already validates semantic
    // state; this keeps the session boundary independently fail closed.
    ledger.verifyChain();
    const consumerOutcomePromise = taskOutcome(consume());
    const producerOutcomePromise = taskOutcome(produce());
    const consumerOutcome = await consumerOutcomePromise;
    if (!consumerOutcome.ok) {
      sourceController.abort(consumerOutcome.error);
      updateQueueCounters(counters, queue.fail(consumerOutcome.error));
      haltRuntimePending("session_halted:runtime_failure");
    }
    if (sourceController.signal.aborted) requestIteratorReturn();
    const producerWait = await waitForTask(producerOutcomePromise, sourceShutdownTimeoutMs);
    if (producerWait.timedOut) sourceShutdownTimedOut = true;
    if (!consumerOutcome.ok) throw consumerOutcome.error;
    if (producerWait.timedOut) throw new PaperSessionSourceShutdownError(sourceShutdownTimeoutMs);
    const producerOutcome = producerWait.outcome;
    if (!producerOutcome.ok) throw producerOutcome.error;
    if (counters.events !== counters.runtimeBatches) {
      throw new PaperSessionCompletionError("Paper session bus/runtime delivery count mismatch");
    }
    if (!isAborted(options.signal) && options.runtime.scheduler.pendingCount() !== 0) {
      const pendingCases = options.runtime.scheduler.pendingCount();
      haltRuntimePending("session_halted:source_completed_with_pending");
      throw new PaperSessionCompletionError(
        `Finite paper source ended with ${pendingCases} pending case(s)`
      );
    }
    ledger.verifyChain();
    return sessionSummary(
      isAborted(options.signal) ? "aborted" : "completed",
      options.runtime,
      ledger,
      counters,
      queue,
      sourceShutdownTimeoutMs,
      sourceShutdownTimedOut,
      null
    );
  } catch (error) {
    sourceController.abort(error);
    updateQueueCounters(counters, queue.fail(error));
    haltRuntimePending("session_halted:session_failure");
    // A runtime may have committed a fail-closed terminal before surfacing an
    // error. Count that durable fact even though no successful batch exists.
    try {
      collectTerminals();
    } catch {
      // Preserve the original failure; ledger verification remains available
      // to the caller and no further event will be delivered.
    }
    const classified = classifyHalt(error);
    const halt = sourceShutdownTimedOut && classified.code !== "source_shutdown_timeout"
      ? {
          ...classified,
          reason: `${classified.reason}; canonical source shutdown exceeded ${sourceShutdownTimeoutMs}ms`
        }
      : classified;
    throw new PaperSessionError(
      `Paper session stopped fail closed: ${halt.reason}`,
      sessionSummary(
        "failed",
        options.runtime,
        ledger,
        counters,
        queue,
        sourceShutdownTimeoutMs,
        sourceShutdownTimedOut,
        halt
      ),
      error
    );
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
    sourceController.abort();
    requestIteratorReturn();
    activeRuntimes.delete(options.runtime);
  }
}
