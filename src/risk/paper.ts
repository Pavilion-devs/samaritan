import type { PolymarketBookEvent } from "../bus/events.js";
import type { DetectorSignal } from "../detectors/types.js";
import { microUsd, nonnegativeMicroUsd, type MicroUsd } from "../domain/money.js";
import { probability, type Probability } from "../domain/probability.js";
import type { TradeThesis } from "../agents/contracts.js";
import {
  POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS,
  takerFeePerShare,
  type PolymarketFeeParameters
} from "../exec/paper.js";

export type PaperRiskConfig = {
  bankrollMicroUsd: MicroUsd;
  perTradeStakeMicroUsd: MicroUsd;
  aggregateExposureMicroUsd: MicroUsd;
  drawdownStopMicroUsd: MicroUsd;
  minimumRawGap: number;
  maxBookAgeMs: number;
  maxFeeMetadataAgeMs: number;
  realMoneyGate: "closed";
};

export const APPROVED_PAPER_RISK_CONFIG: PaperRiskConfig = Object.freeze({
  bankrollMicroUsd: microUsd(50_000_000),
  perTradeStakeMicroUsd: microUsd(3_000_000),
  aggregateExposureMicroUsd: microUsd(15_000_000),
  drawdownStopMicroUsd: microUsd(20_000_000),
  minimumRawGap: 0.01,
  maxBookAgeMs: 5_000,
  maxFeeMetadataAgeMs: 300_000,
  realMoneyGate: "closed"
});

export type PaperRiskState = {
  openExposureMicroUsd: MicroUsd;
  currentDrawdownMicroUsd: MicroUsd;
  halted: boolean;
};

export function paperRiskState(input: {
  openExposureMicroUsd?: number;
  currentDrawdownMicroUsd?: number;
  halted?: boolean;
} = {}): PaperRiskState {
  return {
    openExposureMicroUsd: nonnegativeMicroUsd(input.openExposureMicroUsd ?? 0),
    currentDrawdownMicroUsd: nonnegativeMicroUsd(input.currentDrawdownMicroUsd ?? 0),
    halted: input.halted ?? false
  };
}

export type PaperRiskVerdict =
  | { decision: "veto"; reasons: string[] }
  | {
      decision: "approve";
      stakeMicroUsd: MicroUsd;
      limitProbability: Probability;
      realMoneyGate: "closed";
    };

function bestAsk(book: PolymarketBookEvent): number | null {
  return book.asks.length === 0 ? null : Math.min(...book.asks.map((level) => level.price));
}

function bestBid(book: PolymarketBookEvent): number | null {
  return book.bids.length === 0 ? null : Math.max(...book.bids.map((level) => level.price));
}

export function reviewPaperRisk(input: {
  config: PaperRiskConfig;
  state: PaperRiskState;
  signal: DetectorSignal;
  thesis: TradeThesis;
  book: PolymarketBookEvent;
  fees: PolymarketFeeParameters;
  asOfTsMs: number;
  feeValidationTsMs?: number;
  executionLatencyMs: number;
  availableShares?: number;
}): PaperRiskVerdict {
  const { config, state, signal, thesis, book, fees } = input;
  const reasons: string[] = [];
  if (config.realMoneyGate !== "closed") reasons.push("real_money_gate_not_closed");
  if (
    config.bankrollMicroUsd <= 0 ||
    config.perTradeStakeMicroUsd <= 0 ||
    config.aggregateExposureMicroUsd <= 0 ||
    config.drawdownStopMicroUsd <= 0 ||
    config.perTradeStakeMicroUsd > config.aggregateExposureMicroUsd ||
    config.aggregateExposureMicroUsd > config.bankrollMicroUsd ||
    config.drawdownStopMicroUsd > config.bankrollMicroUsd ||
    !(config.minimumRawGap > 0) ||
    !(config.maxBookAgeMs > 0) ||
    !(config.maxFeeMetadataAgeMs > 0)
  ) {
    reasons.push("invalid_risk_configuration");
  }
  if (state.halted) reasons.push("paper_lane_halted");
  if (state.currentDrawdownMicroUsd >= config.drawdownStopMicroUsd) reasons.push("drawdown_stop_reached");
  if (state.openExposureMicroUsd + config.perTradeStakeMicroUsd > config.aggregateExposureMicroUsd) {
    reasons.push("aggregate_exposure_cap");
  }
  if (signal.kind !== "CONSENSUS_MOVE") reasons.push("detector_not_approved");
  if (signal.eligibility !== "pretrade_review_required") reasons.push("signal_research_only");
  if (signal.market.family !== "total_goals" || signal.market.period !== "full_time") {
    reasons.push("market_not_approved");
  }
  if (signal.evidence.gapBasis !== "live_book") reasons.push("non_executable_signal_basis");
  if (signal.evidence.rawGap < config.minimumRawGap) reasons.push("edge_below_locked_gap");
  if (signal.evidence.consensusZScore === null || Math.abs(signal.evidence.consensusZScore) < 1) {
    reasons.push("consensus_z_below_locked_threshold");
  }
  const directionalCusum = signal.direction === "buy"
    ? signal.evidence.cusumUp
    : signal.evidence.cusumDown;
  if (directionalCusum < 0.001) reasons.push("cusum_below_locked_threshold");
  if (signal.evidence.scoreContextActions.length > 0) reasons.push("score_context_present");
  if (thesis.recommendation !== "paper_trade") reasons.push("analyst_no_trade");
  if (thesis.expiresAtTsMs < input.asOfTsMs) reasons.push("thesis_expired");
  const asOfTimestampValid = Number.isSafeInteger(input.asOfTsMs) && input.asOfTsMs >= 0;
  if (!asOfTimestampValid) reasons.push("invalid_as_of_timestamp");
  const executionLatencyValid =
    Number.isSafeInteger(input.executionLatencyMs) && input.executionLatencyMs > 0;
  if (!executionLatencyValid) {
    reasons.push("invalid_execution_latency");
  }
  const signalTimestampValid =
    Number.isSafeInteger(signal.detectedAtTsMs) &&
    Number.isSafeInteger(signal.observedAtTsMs) &&
    signal.detectedAtTsMs >= 0 &&
    signal.observedAtTsMs >= 0;
  if (!signalTimestampValid) reasons.push("invalid_signal_timestamp");
  if (
    book.fixtureId !== signal.fixtureId ||
    book.market.key !== signal.market.key ||
    book.outcome !== signal.outcome ||
    book.tokenRole !== "canonical"
  ) {
    reasons.push("book_identity_mismatch");
  }
  if (book.mappingStatus === "rejected") reasons.push("mapping_rejected");
  const bookTimestampValid =
    Number.isSafeInteger(book.sourceTsMs) &&
    Number.isSafeInteger(book.observedTsMs) &&
    book.sourceTsMs >= 0 &&
    book.observedTsMs >= 0;
  if (!bookTimestampValid) reasons.push("invalid_book_timestamp");
  if (signalTimestampValid && executionLatencyValid) {
    const decisionReadyAtTsMs = signal.observedAtTsMs + input.executionLatencyMs;
    const orderEligibleAtTsMs = decisionReadyAtTsMs + POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS;
    if (!Number.isSafeInteger(decisionReadyAtTsMs) || !Number.isSafeInteger(orderEligibleAtTsMs)) {
      reasons.push("invalid_execution_ready_timestamp");
    } else {
      if (thesis.submittedAtTsMs !== decisionReadyAtTsMs) reasons.push("thesis_timestamp_mismatch");
      if (bookTimestampValid && book.observedTsMs < decisionReadyAtTsMs) {
        reasons.push("book_precedes_execution_latency");
      } else if (bookTimestampValid && book.observedTsMs < orderEligibleAtTsMs) {
        reasons.push("book_precedes_venue_placement_delay");
      }
    }
  }
  if (
    !bookTimestampValid ||
    !asOfTimestampValid ||
    book.observedTsMs > input.asOfTsMs ||
    input.asOfTsMs - book.observedTsMs > config.maxBookAgeMs
  ) {
    reasons.push("book_stale_or_from_future");
  }
  const feeValidationTsMs = input.feeValidationTsMs ?? input.asOfTsMs;
  if (
    fees.conditionId !== book.conditionId ||
    !Number.isSafeInteger(fees.fetchedAtTsMs) ||
    !Number.isSafeInteger(feeValidationTsMs) ||
    Math.abs(feeValidationTsMs - fees.fetchedAtTsMs) > config.maxFeeMetadataAgeMs
  ) {
    reasons.push("fee_metadata_invalid");
  }
  if (!fees.feesEnabled && fees.takerFeeRate !== 0) reasons.push("disabled_fee_has_nonzero_rate");
  if (fees.feesEnabled && (!(fees.takerFeeRate > 0) || !Number.isFinite(fees.takerFeeRate))) {
    reasons.push("enabled_fee_missing_rate");
  }
  if (
    fees.feeCurveExponent !== 1 ||
    !fees.takerOnly ||
    !(fees.minimumOrderSize > 0) ||
    !(fees.minimumTickSize > 0)
  ) {
    reasons.push("unsupported_market_execution_parameters");
  }
  if (signal.direction === "sell" && (input.availableShares ?? 0) <= 0) {
    reasons.push("sell_requires_owned_inventory");
  }

  const quote = signal.direction === "buy" ? bestAsk(book) : bestBid(book);
  if (quote === null) reasons.push("empty_executable_book_side");
  else {
    const executableGap = signal.direction === "buy"
      ? signal.evidence.consensusProbability - quote
      : quote - signal.evidence.consensusProbability;
    if (executableGap < config.minimumRawGap) reasons.push("live_edge_below_locked_gap");
    const totalPerShare = quote + takerFeePerShare(quote, fees);
    if (config.perTradeStakeMicroUsd / 1_000_000 / totalPerShare < fees.minimumOrderSize) {
      reasons.push("stake_below_minimum_order_size");
    }
  }

  if (reasons.length > 0) return { decision: "veto", reasons };
  const deterministicLimit = signal.direction === "buy"
    ? signal.evidence.consensusProbability - config.minimumRawGap
    : signal.evidence.consensusProbability + config.minimumRawGap;
  return {
    decision: "approve",
    stakeMicroUsd: config.perTradeStakeMicroUsd,
    limitProbability: probability(deterministicLimit),
    realMoneyGate: "closed"
  };
}
