import type { CanonicalEvent, PolymarketBookEvent } from "../bus/events.js";
import type { DetectorSignal } from "../detectors/types.js";
import { microUsd } from "../domain/money.js";
import type { PolymarketFeeParameters } from "../exec/paper.js";
import type { PaperPortfolio } from "../portfolio/paper.js";
import { paperRiskState, type PaperRiskState } from "../risk/paper.js";
import {
  PaperCasePipeline,
  type PreparedPaperCase,
  type PaperPipelineResult,
  type PaperStudyLane
} from "./paper-pipeline.js";

export type PolymarketFeeResolver = (
  book: PolymarketBookEvent,
  asOfTsMs: number,
  haltSignal?: AbortSignal
) => Promise<PolymarketFeeParameters>;

export type PaperSchedulerConfig = {
  lane: PaperStudyLane;
  executionLatencyMs: number;
  maximumPendingMs: number;
  minimumSignalToKickoffMs: number;
  eligibleMarketKeys: ReadonlySet<string>;
  kickoffByFixtureId: ReadonlyMap<string, number>;
};

export type PaperPendingSignalState = {
  signal: DetectorSignal;
  prepared: PreparedPaperCase;
  expiresAtTsMs: number;
};

export type PaperSchedulerInitialState = {
  seenSignalIds: readonly string[];
  pending: readonly PaperPendingSignalState[];
  lastObservedTsMs: number | null;
};

export type PaperSchedulerOperationOptions = {
  haltSignal?: AbortSignal;
};

function isHalted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class PaperCaseScheduler {
  readonly #pending = new Map<string, PaperPendingSignalState>();
  readonly #seen = new Set<string>();
  readonly #lastBookSourceTsMs = new Map<string, number>();
  #lastObservedTsMs: number | null = null;
  #riskState: PaperRiskState;

  constructor(readonly dependencies: {
    config: PaperSchedulerConfig;
    pipeline: PaperCasePipeline;
    feeResolver: PolymarketFeeResolver;
    portfolio?: PaperPortfolio;
    initialRiskState?: PaperRiskState;
    initialState?: PaperSchedulerInitialState;
    processingNow?: () => number;
  }) {
    if (!Number.isSafeInteger(dependencies.config.executionLatencyMs) || dependencies.config.executionLatencyMs <= 0) {
      throw new RangeError("Execution latency must be a positive integer number of milliseconds");
    }
    if (!Number.isSafeInteger(dependencies.config.maximumPendingMs) || dependencies.config.maximumPendingMs <= 0) {
      throw new RangeError("Maximum pending time must be a positive integer number of milliseconds");
    }
    if (
      !Number.isSafeInteger(dependencies.config.minimumSignalToKickoffMs) ||
      dependencies.config.minimumSignalToKickoffMs <= 0
    ) {
      throw new RangeError("Minimum signal-to-kickoff time must be a positive integer number of milliseconds");
    }
    if (dependencies.portfolio) {
      if (dependencies.initialRiskState) {
        throw new Error("Portfolio-backed scheduling cannot also accept independent initial risk state");
      }
      if (dependencies.portfolio.options.lane !== dependencies.config.lane) {
        throw new Error("Paper portfolio lane does not match scheduler lane");
      }
      if (dependencies.portfolio.options.ledger !== dependencies.pipeline.dependencies.ledger) {
        throw new Error("Paper portfolio and pipeline must share one decision ledger");
      }
    }
    this.#riskState = dependencies.initialRiskState ?? paperRiskState();
    if (dependencies.initialState) this.#restore(dependencies.initialState);
  }

  async enqueue(
    signal: DetectorSignal,
    options: PaperSchedulerOperationOptions = {}
  ): Promise<boolean> {
    const kickoffTsMs = this.dependencies.config.kickoffByFixtureId.get(signal.fixtureId);
    if (
      !Number.isSafeInteger(signal.detectedAtTsMs) ||
      !Number.isSafeInteger(signal.observedAtTsMs) ||
      signal.detectedAtTsMs < 0 ||
      signal.observedAtTsMs < 0 ||
      signal.kind !== "CONSENSUS_MOVE" ||
      signal.eligibility !== "pretrade_review_required" ||
      signal.market.family !== "total_goals" ||
      signal.market.period !== "full_time" ||
      !this.dependencies.config.eligibleMarketKeys.has(signal.market.key) ||
      kickoffTsMs === undefined ||
      signal.detectedAtTsMs > kickoffTsMs - this.dependencies.config.minimumSignalToKickoffMs ||
      signal.observedAtTsMs > kickoffTsMs - this.dependencies.config.minimumSignalToKickoffMs
    ) {
      return false;
    }
    if (this.#lastObservedTsMs !== null && signal.observedAtTsMs < this.#lastObservedTsMs) return false;
    if (this.#seen.has(signal.signalId)) return false;
    this.#lastObservedTsMs = signal.observedAtTsMs;
    this.#seen.add(signal.signalId);
    const prepared = await this.dependencies.pipeline.prepare({
      lane: this.dependencies.config.lane,
      signal,
      minimumDecisionLatencyMs: this.dependencies.config.executionLatencyMs,
      ...(options.haltSignal === undefined ? {} : { haltSignal: options.haltSignal })
    });
    if (isHalted(options.haltSignal)) {
      const haltedAtTsMs = signal.observedAtTsMs + prepared.decisionLatencyMs;
      if (prepared.status === "ready") {
        this.dependencies.pipeline.terminateRecordedSignal({
          lane: this.dependencies.config.lane,
          signal,
          atTsMs: haltedAtTsMs,
          reason: "session_halted:after_analysis_before_pending"
        });
      }
      this.haltPending(haltedAtTsMs, "session_halted:analysis_queue");
      return true;
    }
    if (prepared.status !== "ready") return true;
    if (prepared.orderEligibleAtTsMs >= kickoffTsMs) {
      this.dependencies.pipeline.terminateRecordedSignal({
        lane: this.dependencies.config.lane,
        signal,
        atTsMs: prepared.orderEligibleAtTsMs,
        reason: "order_became_eligible_at_or_after_kickoff"
      });
      return true;
    }
    const expiresAtTsMs = prepared.orderEligibleAtTsMs + this.dependencies.config.maximumPendingMs;
    if (!Number.isSafeInteger(expiresAtTsMs)) {
      this.dependencies.pipeline.terminateRecordedSignal({
        lane: this.dependencies.config.lane,
        signal,
        atTsMs: prepared.orderEligibleAtTsMs,
        reason: "pending_expiry_timestamp_out_of_range"
      });
      return true;
    }
    this.#pending.set(signal.signalId, {
      signal,
      prepared,
      expiresAtTsMs
    });
    return true;
  }

  async ingest(
    event: CanonicalEvent,
    options: PaperSchedulerOperationOptions = {}
  ): Promise<PaperPipelineResult[]> {
    if (isHalted(options.haltSignal)) {
      const atTsMs = Number.isSafeInteger(event.observedTsMs) && event.observedTsMs >= 0
        ? event.observedTsMs
        : 0;
      return this.haltPending(atTsMs, "session_halted:before_scheduler_ingest");
    }
    if (!this.#acceptEventTimestamp(event)) return [];
    this.#expire(event.observedTsMs);
    if (event.kind !== "polymarket.book" || event.tokenRole !== "canonical") return [];
    const bookClockKey = `${event.conditionId}:${event.assetId}`;
    const previousSourceTsMs = this.#lastBookSourceTsMs.get(bookClockKey);
    if (previousSourceTsMs !== undefined && event.sourceTsMs < previousSourceTsMs) return [];
    this.#lastBookSourceTsMs.set(bookClockKey, event.sourceTsMs);
    const ready = [...this.#pending.values()].filter(({ signal, prepared }) =>
      signal.fixtureId === event.fixtureId &&
      signal.market.key === event.market.key &&
      signal.outcome === event.outcome &&
      event.sourceTsMs < (this.dependencies.config.kickoffByFixtureId.get(signal.fixtureId) ?? 0) &&
      event.observedTsMs < (this.dependencies.config.kickoffByFixtureId.get(signal.fixtureId) ?? 0) &&
      event.observedTsMs >= prepared.orderEligibleAtTsMs
    );
    const results: PaperPipelineResult[] = [];
    for (const pending of ready) {
      this.#pending.delete(pending.signal.signalId);
      let fees: PolymarketFeeParameters;
      try {
        fees = await this.dependencies.feeResolver(
          event,
          event.observedTsMs,
          options.haltSignal
        );
      } catch (error) {
        if (isHalted(options.haltSignal)) {
          results.push(this.dependencies.pipeline.terminateRecordedSignal({
            lane: this.dependencies.config.lane,
            signal: pending.signal,
            atTsMs: event.observedTsMs,
            reason: "session_halted:after_fee_resolution"
          }));
          results.push(...this.haltPending(
            event.observedTsMs,
            "session_halted:fee_resolution_queue"
          ));
          return results;
        }
        this.dependencies.pipeline.terminateRecordedSignal({
          lane: this.dependencies.config.lane,
          signal: pending.signal,
          atTsMs: event.observedTsMs,
          reason: `fee_resolution_failed:${error instanceof Error ? error.message : String(error)}`
        });
        continue;
      }
      if (isHalted(options.haltSignal)) {
        results.push(this.dependencies.pipeline.terminateRecordedSignal({
          lane: this.dependencies.config.lane,
          signal: pending.signal,
          atTsMs: event.observedTsMs,
          reason: "session_halted:after_fee_resolution"
        }));
        results.push(...this.haltPending(
          event.observedTsMs,
          "session_halted:fee_resolution_queue"
        ));
        return results;
      }
      const result = await this.dependencies.pipeline.executePrepared({
        lane: this.dependencies.config.lane,
        signal: pending.signal,
        book: event,
        fees,
        riskState: this.dependencies.portfolio?.riskState() ?? this.#riskState,
        asOfTsMs: event.observedTsMs,
        feeValidationTsMs: this.dependencies.processingNow?.() ?? event.observedTsMs,
        prepared: pending.prepared,
        ...(options.haltSignal === undefined ? {} : { haltSignal: options.haltSignal })
      });
      results.push(result);
      if (result.fill && result.fill.direction === "buy" && result.fill.status !== "no_fill") {
        if (this.dependencies.portfolio) {
          this.dependencies.portfolio.open({
            caseId: result.caseId,
            signal: pending.signal,
            fill: result.fill,
            openedAtTsMs: event.observedTsMs
          });
        }
        this.#riskState = {
          ...this.#riskState,
          openExposureMicroUsd: microUsd(
            this.#riskState.openExposureMicroUsd + result.fill.netConsiderationMicroUsd
          )
        };
      }
      if (isHalted(options.haltSignal)) {
        results.push(...this.haltPending(
          event.observedTsMs,
          "session_halted:after_started_execution_queue"
        ));
        return results;
      }
    }
    return results;
  }

  /** Durably terminal every not-yet-executing prepared case and clear memory. */
  haltPending(atTsMs: number, reason: string): PaperPipelineResult[] {
    if (!Number.isSafeInteger(atTsMs) || atTsMs < 0) {
      throw new RangeError("Pending halt timestamp must be a non-negative safe integer");
    }
    const results: PaperPipelineResult[] = [];
    for (const [signalId, pending] of this.#pending) {
      results.push(this.dependencies.pipeline.terminateRecordedSignal({
        lane: this.dependencies.config.lane,
        signal: pending.signal,
        atTsMs: Math.max(atTsMs, pending.signal.observedAtTsMs),
        reason
      }));
      this.#pending.delete(signalId);
    }
    return results;
  }

  pendingCount(): number {
    return this.#pending.size;
  }

  seenCount(): number {
    return this.#seen.size;
  }

  riskState(): PaperRiskState {
    return { ...(this.dependencies.portfolio?.riskState() ?? this.#riskState) };
  }

  #restore(initial: PaperSchedulerInitialState): void {
    if (
      initial.lastObservedTsMs !== null &&
      (!Number.isSafeInteger(initial.lastObservedTsMs) || initial.lastObservedTsMs < 0)
    ) {
      throw new Error("Restored scheduler observation timestamp is invalid");
    }
    for (const signalId of initial.seenSignalIds) {
      if (signalId.length === 0 || this.#seen.has(signalId)) {
        throw new Error(`Duplicate or empty restored signal ID: ${signalId}`);
      }
      this.#seen.add(signalId);
    }
    for (const pending of initial.pending) {
      const { signal, prepared, expiresAtTsMs } = pending;
      if (!this.#seen.has(signal.signalId)) {
        throw new Error(`Restored pending signal was not marked seen: ${signal.signalId}`);
      }
      if (this.#pending.has(signal.signalId)) {
        throw new Error(`Duplicate restored pending signal: ${signal.signalId}`);
      }
      if (
        prepared.thesis.signalId !== signal.signalId ||
        prepared.thesis.fixtureId !== signal.fixtureId ||
        prepared.thesis.marketKey !== signal.market.key ||
        prepared.thesis.outcome !== signal.outcome ||
        prepared.thesis.direction !== signal.direction
      ) {
        throw new Error(`Restored pending identity mismatch: ${signal.signalId}`);
      }
      if (
        !this.dependencies.config.eligibleMarketKeys.has(signal.market.key) ||
        this.dependencies.config.kickoffByFixtureId.get(signal.fixtureId) === undefined
      ) {
        throw new Error(`Restored pending signal is outside the admitted fixture universe: ${signal.signalId}`);
      }
      if (
        prepared.readyAtTsMs !== signal.observedAtTsMs + prepared.decisionLatencyMs ||
        prepared.thesis.submittedAtTsMs !== prepared.readyAtTsMs ||
        prepared.orderEligibleAtTsMs !== prepared.readyAtTsMs + prepared.venuePlacementDelayMs
      ) {
        throw new Error(`Restored pending timing mismatch: ${signal.signalId}`);
      }
      const expectedExpiry = prepared.orderEligibleAtTsMs + this.dependencies.config.maximumPendingMs;
      if (!Number.isSafeInteger(expectedExpiry) || expiresAtTsMs !== expectedExpiry) {
        throw new Error(`Restored pending expiry mismatch: ${signal.signalId}`);
      }
      if (initial.lastObservedTsMs !== null && signal.observedAtTsMs > initial.lastObservedTsMs) {
        throw new Error(`Restored pending signal is newer than the scheduler clock: ${signal.signalId}`);
      }
      this.#pending.set(signal.signalId, structuredClone(pending));
    }
    this.#lastObservedTsMs = initial.lastObservedTsMs;
  }

  #acceptEventTimestamp(event: CanonicalEvent): boolean {
    if (
      !Number.isSafeInteger(event.sourceTsMs) ||
      !Number.isSafeInteger(event.observedTsMs) ||
      event.sourceTsMs < 0 ||
      event.observedTsMs < 0 ||
      (this.#lastObservedTsMs !== null && event.observedTsMs < this.#lastObservedTsMs)
    ) {
      return false;
    }
    this.#lastObservedTsMs = event.observedTsMs;
    return true;
  }

  #expire(asOfTsMs: number): void {
    for (const [signalId, pending] of this.#pending) {
      const kickoffTsMs = this.dependencies.config.kickoffByFixtureId.get(pending.signal.fixtureId);
      const kickoffReached = kickoffTsMs !== undefined && asOfTsMs >= kickoffTsMs;
      if (!kickoffReached && asOfTsMs < pending.expiresAtTsMs) continue;
      this.dependencies.pipeline.terminateRecordedSignal({
        lane: this.dependencies.config.lane,
        signal: pending.signal,
        atTsMs: asOfTsMs,
        reason: kickoffReached
          ? "no_post_venue_delay_executable_book_before_kickoff"
          : "no_post_venue_delay_executable_book_before_expiry"
      });
      this.#pending.delete(signalId);
    }
  }
}
