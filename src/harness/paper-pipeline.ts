import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  assertThesisMatchesSignal,
  tradeThesisSchema,
  triageDecisionSchema,
  type AnalystAgent,
  type TradeThesis,
  type TriageAgent,
  type TriageDecision
} from "../agents/contracts.js";
import type { PolymarketBookEvent } from "../bus/events.js";
import type { DetectorSignal } from "../detectors/types.js";
import type {
  PaperExecutor,
  PaperFill,
  PaperOrderIntent,
  PolymarketFeeParameters
} from "../exec/paper.js";
import { POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS } from "../exec/paper.js";
import {
  reviewPaperRisk,
  type PaperRiskConfig,
  type PaperRiskState,
  type PaperRiskVerdict
} from "../risk/paper.js";
import { DecisionLedger, type DecisionEventKind } from "../store/decision-ledger.js";
import type { JsonValue } from "../domain/json.js";

export type PaperPipelineResult = {
  caseId: string;
  status: "dropped" | "no_trade" | "vetoed" | "filled" | "partial" | "no_fill" | "failed";
  triage?: TriageDecision;
  thesis?: TradeThesis;
  riskVerdict?: PaperRiskVerdict;
  fill?: PaperFill;
  reason?: string;
};

export type PaperPipelineInput = {
  lane: PaperStudyLane;
  signal: DetectorSignal;
  book: PolymarketBookEvent;
  fees: PolymarketFeeParameters;
  riskState: PaperRiskState;
  asOfTsMs: number;
  feeValidationTsMs?: number;
  executionLatencyMs: number;
  availableShares?: number;
};

export type PreparedPaperCase = {
  caseId: string;
  status: "ready";
  triage: TriageDecision;
  thesis: TradeThesis;
  decisionLatencyMs: number;
  /** Analysis completion on the signal knowledge clock. */
  readyAtTsMs: number;
  /** First time a delayed Polymarket sports order could match. */
  orderEligibleAtTsMs: number;
  venuePlacementDelayMs: typeof POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS;
};

export type PaperAnalysisResult = PreparedPaperCase | (PaperPipelineResult & {
  decisionLatencyMs: number;
});

export type PaperStudyLane = "bounty" | "long_run";

function caseId(lane: PaperStudyLane, signalId: string): string {
  return `case_${createHash("sha256").update(`paper:${lane}:${signalId}`).digest("hex").slice(0, 24)}`;
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function assertSignalTiming(signal: DetectorSignal): void {
  if (
    !Number.isSafeInteger(signal.detectedAtTsMs) ||
    !Number.isSafeInteger(signal.observedAtTsMs) ||
    signal.detectedAtTsMs < 0 ||
    signal.observedAtTsMs < 0
  ) {
    throw new RangeError("Paper signal has impossible source/observation timestamps");
  }
}

function timestampAfter(baseTsMs: number, elapsedMs: number, label: string): number {
  const result = baseTsMs + elapsedMs;
  if (!Number.isSafeInteger(result) || result < baseTsMs) {
    throw new RangeError(`${label} timestamp is outside the safe event-time range`);
  }
  return result;
}

export class PaperCasePipeline {
  constructor(readonly dependencies: {
    triageAgent: TriageAgent;
    analystAgent: AnalystAgent;
    riskConfig: PaperRiskConfig;
    executor: PaperExecutor;
    ledger: DecisionLedger;
    now?: () => number;
  }) {}

  recordSignal(lane: PaperStudyLane, signal: DetectorSignal): string {
    assertSignalTiming(signal);
    const id = caseId(lane, signal.signalId);
    this.dependencies.ledger.append({
      entryId: `${id}:1:signal_received`,
      caseId: id,
      kind: "signal_received",
      atTsMs: signal.observedAtTsMs,
      payload: json({ lane, signal })
    });
    return id;
  }

  terminateRecordedSignal(input: {
    lane: PaperStudyLane;
    signal: DetectorSignal;
    atTsMs: number;
    reason: string;
  }): void {
    assertSignalTiming(input.signal);
    if (!Number.isSafeInteger(input.atTsMs) || input.atTsMs < input.signal.observedAtTsMs) {
      throw new RangeError("Paper terminal timestamp precedes signal knowledge time");
    }
    const id = this.recordSignal(input.lane, input.signal);
    const entrySequence = this.dependencies.ledger.entries(id).length + 1;
    this.dependencies.ledger.append({
      entryId: `${id}:${entrySequence}:case_terminal`,
      caseId: id,
      kind: "case_terminal",
      atTsMs: input.atTsMs,
      payload: json({ status: "failed", reason: input.reason })
    });
  }

  async prepare(input: {
    lane: PaperStudyLane;
    signal: DetectorSignal;
    minimumDecisionLatencyMs: number;
  }): Promise<PaperAnalysisResult> {
    if (!Number.isSafeInteger(input.minimumDecisionLatencyMs) || input.minimumDecisionLatencyMs <= 0) {
      throw new Error("Minimum decision latency must be a positive integer number of milliseconds");
    }
    const id = this.recordSignal(input.lane, input.signal);
    const monotonicNow = this.dependencies.now ?? (() => performance.now());
    const processingStartedAtMs = monotonicNow();
    let entrySequence = this.dependencies.ledger.entries(id).length;
    const append = (kind: DecisionEventKind, atTsMs: number, payload: unknown) => {
      entrySequence += 1;
      this.dependencies.ledger.append({
        entryId: `${id}:${entrySequence}:${kind}`,
        caseId: id,
        kind,
        atTsMs,
        payload: json(payload)
      });
    };
    const elapsed = () => Math.max(
      input.minimumDecisionLatencyMs,
      Math.ceil(monotonicNow() - processingStartedAtMs),
      1
    );
    const terminal = (
      status: Extract<PaperPipelineResult["status"], "dropped" | "no_trade" | "failed">,
      reason: string,
      decisionLatencyMs: number
    ) => {
      append("case_terminal", timestampAfter(
        input.signal.observedAtTsMs,
        decisionLatencyMs,
        "Terminal decision"
      ), {
        status,
        reason,
        decisionLatencyMs
      });
    };

    let triage: TriageDecision;
    try {
      triage = triageDecisionSchema.parse(await this.dependencies.triageAgent.triage({
        caseId: id,
        signal: input.signal
      }));
    } catch (error) {
      const decisionLatencyMs = elapsed();
      const reason = `triage_failed:${error instanceof Error ? error.message : String(error)}`;
      terminal("failed", reason, decisionLatencyMs);
      return { caseId: id, status: "failed", reason, decisionLatencyMs };
    }
    const triageLatencyMs = elapsed();
    append("triage_decision", timestampAfter(
      input.signal.observedAtTsMs,
      triageLatencyMs,
      "Triage decision"
    ), triage);
    if (triage.decision === "drop") {
      terminal("dropped", triage.rationale, triageLatencyMs);
      return {
        caseId: id,
        status: "dropped",
        triage,
        reason: triage.rationale,
        decisionLatencyMs: triageLatencyMs
      };
    }

    let thesis: TradeThesis;
    try {
      const submitted = tradeThesisSchema.parse(await this.dependencies.analystAgent.investigate({
        caseId: id,
        signal: input.signal,
        triage,
        asOfTsMs: timestampAfter(
          input.signal.observedAtTsMs,
          triageLatencyMs,
          "Analyst as-of"
        )
      }));
      assertThesisMatchesSignal(submitted, input.signal);
      const decisionLatencyMs = elapsed();
      const submittedAtTsMs = timestampAfter(
        input.signal.observedAtTsMs,
        decisionLatencyMs,
        "Thesis submission"
      );
      thesis = tradeThesisSchema.parse({
        ...submitted,
        submittedAtTsMs,
        expiresAtTsMs: timestampAfter(submittedAtTsMs, 15 * 60_000, "Thesis expiry")
      });
    } catch (error) {
      const decisionLatencyMs = elapsed();
      const reason = `analysis_failed:${error instanceof Error ? error.message : String(error)}`;
      terminal("failed", reason, decisionLatencyMs);
      return { caseId: id, status: "failed", triage, reason, decisionLatencyMs };
    }
    const decisionLatencyMs = thesis.submittedAtTsMs - input.signal.observedAtTsMs;
    const orderEligibleAtTsMs = timestampAfter(
      thesis.submittedAtTsMs,
      POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS,
      "Order eligibility"
    );
    append("thesis_submitted", thesis.submittedAtTsMs, thesis);
    append("analysis_completed", thesis.submittedAtTsMs, {
      signalSourceTsMs: input.signal.detectedAtTsMs,
      signalObservedTsMs: input.signal.observedAtTsMs,
      decisionLatencyMs,
      readyAtTsMs: thesis.submittedAtTsMs,
      venuePlacementDelayMs: POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS,
      orderEligibleAtTsMs,
      recommendation: thesis.recommendation
    });
    if (thesis.recommendation === "no_trade") {
      terminal("no_trade", thesis.thesisSummary, decisionLatencyMs);
      return {
        caseId: id,
        status: "no_trade",
        triage,
        thesis,
        reason: thesis.thesisSummary,
        decisionLatencyMs
      };
    }
    return {
      caseId: id,
      status: "ready",
      triage,
      thesis,
      decisionLatencyMs,
      readyAtTsMs: thesis.submittedAtTsMs,
      orderEligibleAtTsMs,
      venuePlacementDelayMs: POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS
    };
  }

  async executePrepared(input: Omit<PaperPipelineInput, "executionLatencyMs"> & {
    prepared: PreparedPaperCase;
  }): Promise<PaperPipelineResult> {
    const { prepared } = input;
    const id = caseId(input.lane, input.signal.signalId);
    if (prepared.caseId !== id) throw new Error("Prepared paper case identity mismatch");
    assertSignalTiming(input.signal);
    const expectedReadyAtTsMs = timestampAfter(
      input.signal.observedAtTsMs,
      prepared.decisionLatencyMs,
      "Prepared analysis readiness"
    );
    const expectedOrderEligibleAtTsMs = timestampAfter(
      expectedReadyAtTsMs,
      POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS,
      "Prepared order eligibility"
    );
    if (
      prepared.readyAtTsMs !== expectedReadyAtTsMs ||
      prepared.thesis.submittedAtTsMs !== expectedReadyAtTsMs ||
      prepared.orderEligibleAtTsMs !== expectedOrderEligibleAtTsMs ||
      prepared.venuePlacementDelayMs !== POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS
    ) {
      throw new Error("Prepared paper case timing invariant mismatch");
    }
    let entrySequence = this.dependencies.ledger.entries(id).length;
    const append = (kind: DecisionEventKind, atTsMs: number, payload: unknown) => {
      entrySequence += 1;
      this.dependencies.ledger.append({
        entryId: `${id}:${entrySequence}:${kind}`,
        caseId: id,
        kind,
        atTsMs,
        payload: json(payload)
      });
    };
    const terminal = (status: PaperPipelineResult["status"], reason: string) => {
      append("case_terminal", input.asOfTsMs, { status, reason });
    };

    const riskVerdict = reviewPaperRisk({
      config: this.dependencies.riskConfig,
      state: input.riskState,
      signal: input.signal,
      thesis: prepared.thesis,
      book: input.book,
      fees: input.fees,
      asOfTsMs: input.asOfTsMs,
      ...(input.feeValidationTsMs === undefined ? {} : { feeValidationTsMs: input.feeValidationTsMs }),
      executionLatencyMs: prepared.decisionLatencyMs,
      ...(input.availableShares === undefined ? {} : { availableShares: input.availableShares })
    });
    append("risk_verdict", input.asOfTsMs, riskVerdict);
    if (riskVerdict.decision === "veto") {
      const reason = riskVerdict.reasons.join(",");
      terminal("vetoed", reason);
      return {
        caseId: id,
        status: "vetoed",
        triage: prepared.triage,
        thesis: prepared.thesis,
        riskVerdict,
        reason
      };
    }

    const intent: PaperOrderIntent = {
      lane: input.lane,
      caseId: id,
      signalId: input.signal.signalId,
      fixtureId: input.signal.fixtureId,
      marketKey: input.signal.market.key,
      outcome: input.signal.outcome,
      direction: input.signal.direction,
      stakeMicroUsd: riskVerdict.stakeMicroUsd,
      limitProbability: riskVerdict.limitProbability,
      availableShares: input.availableShares ?? 0
    };
    append("execution_intent", input.asOfTsMs, intent);
    let fill: PaperFill;
    try {
      fill = await this.dependencies.executor.execute(intent, input.book, input.fees);
    } catch (error) {
      const reason = `paper_execution_failed:${error instanceof Error ? error.message : String(error)}`;
      terminal("failed", reason);
      return {
        caseId: id,
        status: "failed",
        triage: prepared.triage,
        thesis: prepared.thesis,
        riskVerdict,
        reason
      };
    }
    append("paper_execution", input.asOfTsMs, fill);
    terminal(fill.status, fill.reason ?? fill.status);
    return {
      caseId: id,
      status: fill.status,
      triage: prepared.triage,
      thesis: prepared.thesis,
      riskVerdict,
      fill
    };
  }

  async run(input: PaperPipelineInput): Promise<PaperPipelineResult> {
    const analysis = await this.prepare({
      lane: input.lane,
      signal: input.signal,
      minimumDecisionLatencyMs: input.executionLatencyMs
    });
    if (analysis.status !== "ready") return analysis;
    return this.executePrepared({
      lane: input.lane,
      signal: input.signal,
      book: input.book,
      fees: input.fees,
      riskState: input.riskState,
      asOfTsMs: input.asOfTsMs,
      prepared: analysis,
      ...(input.feeValidationTsMs === undefined ? {} : { feeValidationTsMs: input.feeValidationTsMs }),
      ...(input.availableShares === undefined ? {} : { availableShares: input.availableShares })
    });
  }
}
