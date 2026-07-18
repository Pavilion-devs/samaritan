import type { PolymarketBookEvent } from "../bus/events.js";
import type { SignalDirection } from "../detectors/types.js";
import { microUsd, type MicroUsd, USD_MICRO_UNITS } from "../domain/money.js";
import type { Probability } from "../domain/probability.js";

/** Current Polymarket delay before marketable sports orders are eligible to match. */
export const POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS = 1_000 as const;

export type PolymarketFeeParameters = {
  source: "polymarket_clob_market_info";
  conditionId: string;
  feesEnabled: boolean;
  takerFeeRate: number;
  feeCurveExponent: number;
  takerOnly: boolean;
  minimumOrderSize: number;
  minimumTickSize: number;
  fetchedAtTsMs: number;
};

export type PaperOrderIntent = {
  lane: "bounty" | "long_run";
  caseId: string;
  signalId: string;
  fixtureId: string;
  marketKey: string;
  outcome: string;
  direction: SignalDirection;
  stakeMicroUsd: MicroUsd;
  limitProbability: Probability;
  availableShares: number;
};

export type PaperFill = {
  adapter: "paper";
  status: "filled" | "partial" | "no_fill";
  reason: string | null;
  assetId: string;
  conditionId: string;
  direction: SignalDirection;
  requestedStakeMicroUsd: MicroUsd;
  grossMicroUsd: MicroUsd;
  feeMicroUsd: MicroUsd;
  netConsiderationMicroUsd: MicroUsd;
  filledShares: number;
  averagePrice: number | null;
  bestPrice: number | null;
  halfSpreadBps: number | null;
  executableDepthUsd: number;
  slippageProbabilityBps: number | null;
  bookObservedTsMs: number;
  feeParameters: PolymarketFeeParameters;
};

export type PaperExecutor = {
  execute(
    intent: PaperOrderIntent,
    book: PolymarketBookEvent,
    fees: PolymarketFeeParameters
  ): Promise<PaperFill>;
};

type FillAccumulator = {
  shares: number;
  grossMicro: number;
  feeMicro: number;
};

type BookEvidence = {
  halfSpreadBps: number | null;
  executableDepthUsd: number;
};

function parseSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new RangeError(`Invalid order-book size: ${value}`);
  return parsed;
}

export function takerFeePerShare(price: number, fees: PolymarketFeeParameters): number {
  return fees.feesEnabled ? fees.takerFeeRate * price * (1 - price) : 0;
}

function floorShares(value: number): number {
  return Math.floor(value * 1_000_000) / 1_000_000;
}

function roundedFeeMicro(value: number): number {
  return Math.ceil(value / 10) * 10;
}

function tickAligned(price: number, tickSize: number): boolean {
  return Math.abs(price / tickSize - Math.round(price / tickSize)) < 1e-8;
}

function fillStatus(requestedMicro: number, usedMicro: number): "filled" | "partial" {
  return requestedMicro - usedMicro <= Math.max(10, Math.ceil(requestedMicro / 1_000_000))
    ? "filled"
    : "partial";
}

function bookEvidence(intent: PaperOrderIntent, book: PolymarketBookEvent): BookEvidence {
  const bid = book.bids.length === 0 ? null : Math.max(...book.bids.map((level) => level.price));
  const ask = book.asks.length === 0 ? null : Math.min(...book.asks.map((level) => level.price));
  const levels = intent.direction === "buy"
    ? book.asks.filter((level) => level.price <= intent.limitProbability)
    : book.bids.filter((level) => level.price >= intent.limitProbability);
  return {
    halfSpreadBps: bid === null || ask === null || bid > ask ? null : (ask - bid) / 2 * 10_000,
    executableDepthUsd: levels.reduce((sum, level) => sum + parseSize(level.size) * level.price, 0)
  };
}

export class OrderBookPaperExecutor implements PaperExecutor {
  async execute(
    intent: PaperOrderIntent,
    book: PolymarketBookEvent,
    fees: PolymarketFeeParameters
  ): Promise<PaperFill> {
    if (!Number.isSafeInteger(intent.stakeMicroUsd) || intent.stakeMicroUsd <= 0) {
      throw new RangeError("Paper stake must be a positive integer USD micro-unit amount");
    }
    if (!Number.isFinite(intent.availableShares) || intent.availableShares < 0) {
      throw new RangeError("Available shares must be finite and non-negative");
    }
    if (!Number.isFinite(intent.limitProbability) || intent.limitProbability < 0 || intent.limitProbability > 1) {
      throw new RangeError("Paper limit probability must be between zero and one");
    }
    if (
      book.fixtureId !== intent.fixtureId ||
      book.market.key !== intent.marketKey ||
      book.outcome !== intent.outcome ||
      book.tokenRole !== "canonical"
    ) {
      throw new Error("Paper order intent does not match the canonical order book");
    }
    if (
      !Number.isSafeInteger(book.sourceTsMs) ||
      !Number.isSafeInteger(book.observedTsMs) ||
      book.sourceTsMs < 0 ||
      book.observedTsMs < 0
    ) {
      throw new Error("Canonical order book has impossible timestamps");
    }
    if (book.mappingStatus === "rejected") throw new Error("Rejected mappings cannot be paper executed");
    if (fees.conditionId !== book.conditionId) throw new Error("Fee metadata does not match the order book");
    if (!Number.isSafeInteger(fees.fetchedAtTsMs) || fees.fetchedAtTsMs < 0) {
      throw new RangeError("Fee metadata timestamp must be a non-negative integer");
    }
    if (!fees.feesEnabled && fees.takerFeeRate !== 0) {
      throw new Error("Fee-disabled market supplied a non-zero taker rate");
    }
    if (fees.feesEnabled && (!(fees.takerFeeRate > 0) || !Number.isFinite(fees.takerFeeRate))) {
      throw new Error("Fee-enabled market is missing a valid taker rate");
    }
    if (fees.feeCurveExponent !== 1) {
      throw new Error(`Unsupported fee-curve exponent: ${fees.feeCurveExponent}`);
    }
    if (!fees.takerOnly) throw new Error("Paper executor currently supports taker-only fee metadata");
    if (!(fees.minimumOrderSize > 0) || !Number.isFinite(fees.minimumOrderSize)) {
      throw new Error("Market is missing a valid minimum order size");
    }
    if (!(fees.minimumTickSize > 0) || !Number.isFinite(fees.minimumTickSize)) {
      throw new Error("Market is missing a valid minimum tick size");
    }
    if (book.tickSize !== null && Number(book.tickSize) !== fees.minimumTickSize) {
      throw new Error("Canonical book tick size disagrees with CLOB market info");
    }
    if ([...book.bids, ...book.asks].some((level) => !tickAligned(level.price, fees.minimumTickSize))) {
      throw new Error("Canonical book contains a price outside the market tick grid");
    }
    if (intent.direction === "sell" && intent.availableShares <= 0) {
      return this.#empty(intent, book, fees, "sell_requires_owned_inventory");
    }
    return intent.direction === "buy"
      ? this.#buy(intent, book, fees)
      : this.#sell(intent, book, fees);
  }

  #buy(intent: PaperOrderIntent, book: PolymarketBookEvent, fees: PolymarketFeeParameters): PaperFill {
    const evidence = bookEvidence(intent, book);
    const levels = [...book.asks]
      .sort((left, right) => left.price - right.price)
      .filter((level) => level.price <= intent.limitProbability);
    if (levels.length === 0) return this.#empty(intent, book, fees, "no_ask_within_limit");
    const bestPrice = levels[0]!.price;
    const filled: FillAccumulator = { shares: 0, grossMicro: 0, feeMicro: 0 };
    for (const level of levels) {
      const remainingMicro = intent.stakeMicroUsd - filled.grossMicro - filled.feeMicro;
      if (remainingMicro <= 11) break;
      const grossPerShareMicro = level.price * USD_MICRO_UNITS;
      const feePerShareMicro = takerFeePerShare(level.price, fees) * USD_MICRO_UNITS;
      const shares = floorShares(Math.min(
        parseSize(level.size),
        (remainingMicro - 11) / (grossPerShareMicro + feePerShareMicro)
      ));
      if (shares <= 0) continue;
      const grossMicro = Math.ceil(shares * grossPerShareMicro);
      const feeMicro = roundedFeeMicro(shares * feePerShareMicro);
      if (grossMicro + feeMicro > remainingMicro) continue;
      filled.shares += shares;
      filled.grossMicro += grossMicro;
      filled.feeMicro += feeMicro;
    }
    if (filled.shares === 0) return this.#empty(intent, book, fees, "insufficient_ask_depth");
    if (filled.shares < fees.minimumOrderSize) {
      return this.#empty(intent, book, fees, "below_minimum_order_size");
    }
    const averagePrice = filled.grossMicro / USD_MICRO_UNITS / filled.shares;
    const consideration = filled.grossMicro + filled.feeMicro;
    return {
      adapter: "paper",
      status: fillStatus(intent.stakeMicroUsd, consideration),
      reason: null,
      assetId: book.assetId,
      conditionId: book.conditionId,
      direction: intent.direction,
      requestedStakeMicroUsd: intent.stakeMicroUsd,
      grossMicroUsd: microUsd(filled.grossMicro),
      feeMicroUsd: microUsd(filled.feeMicro),
      netConsiderationMicroUsd: microUsd(consideration),
      filledShares: filled.shares,
      averagePrice,
      bestPrice,
      ...evidence,
      slippageProbabilityBps: (averagePrice - bestPrice) * 10_000,
      bookObservedTsMs: book.observedTsMs,
      feeParameters: fees
    };
  }

  #sell(intent: PaperOrderIntent, book: PolymarketBookEvent, fees: PolymarketFeeParameters): PaperFill {
    const evidence = bookEvidence(intent, book);
    const levels = [...book.bids]
      .sort((left, right) => right.price - left.price)
      .filter((level) => level.price >= intent.limitProbability);
    if (levels.length === 0) return this.#empty(intent, book, fees, "no_bid_within_limit");
    const bestPrice = levels[0]!.price;
    const filled: FillAccumulator = { shares: 0, grossMicro: 0, feeMicro: 0 };
    let remainingShares = intent.availableShares;
    for (const level of levels) {
      const remainingGrossTarget = intent.stakeMicroUsd - filled.grossMicro;
      if (remainingGrossTarget <= 0 || remainingShares <= 0) break;
      const shares = floorShares(Math.min(
        parseSize(level.size),
        remainingShares,
        remainingGrossTarget / (level.price * USD_MICRO_UNITS)
      ));
      if (shares <= 0) continue;
      const grossMicro = Math.floor(shares * level.price * USD_MICRO_UNITS);
      const feeMicro = roundedFeeMicro(shares * takerFeePerShare(level.price, fees) * USD_MICRO_UNITS);
      filled.shares += shares;
      filled.grossMicro += grossMicro;
      filled.feeMicro += feeMicro;
      remainingShares -= shares;
    }
    if (filled.shares === 0) return this.#empty(intent, book, fees, "insufficient_bid_depth");
    if (filled.shares < fees.minimumOrderSize) {
      return this.#empty(intent, book, fees, "below_minimum_order_size");
    }
    const averagePrice = filled.grossMicro / USD_MICRO_UNITS / filled.shares;
    return {
      adapter: "paper",
      status: fillStatus(intent.stakeMicroUsd, filled.grossMicro),
      reason: null,
      assetId: book.assetId,
      conditionId: book.conditionId,
      direction: intent.direction,
      requestedStakeMicroUsd: intent.stakeMicroUsd,
      grossMicroUsd: microUsd(filled.grossMicro),
      feeMicroUsd: microUsd(filled.feeMicro),
      netConsiderationMicroUsd: microUsd(filled.grossMicro - filled.feeMicro),
      filledShares: filled.shares,
      averagePrice,
      bestPrice,
      ...evidence,
      slippageProbabilityBps: (bestPrice - averagePrice) * 10_000,
      bookObservedTsMs: book.observedTsMs,
      feeParameters: fees
    };
  }

  #empty(
    intent: PaperOrderIntent,
    book: PolymarketBookEvent,
    fees: PolymarketFeeParameters,
    reason: string
  ): PaperFill {
    const evidence = bookEvidence(intent, book);
    return {
      adapter: "paper",
      status: "no_fill",
      reason,
      assetId: book.assetId,
      conditionId: book.conditionId,
      direction: intent.direction,
      requestedStakeMicroUsd: intent.stakeMicroUsd,
      grossMicroUsd: microUsd(0),
      feeMicroUsd: microUsd(0),
      netConsiderationMicroUsd: microUsd(0),
      filledShares: 0,
      averagePrice: null,
      bestPrice: null,
      ...evidence,
      slippageProbabilityBps: null,
      bookObservedTsMs: book.observedTsMs,
      feeParameters: fees
    };
  }
}
