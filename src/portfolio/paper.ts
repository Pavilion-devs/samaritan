import type { PolymarketBookEvent } from "../bus/events.js";
import type { DetectorSignal } from "../detectors/types.js";
import { microUsd, type MicroUsd, USD_MICRO_UNITS } from "../domain/money.js";
import type { PaperFill } from "../exec/paper.js";
import type { PaperRiskState } from "../risk/paper.js";
import { DecisionLedger } from "../store/decision-ledger.js";
import type { JsonValue } from "../domain/json.js";
import type { PaperStudyLane } from "../harness/paper-pipeline.js";

export type PaperCloseMark = {
  cutoffTsMs: number;
  markedAtTsMs: number;
  bookSourceTsMs: number;
  bookObservedTsMs: number;
  closeBid: number;
  closeAsk: number;
  closeMidpoint: number;
  grossMidpointClvBps: number;
  netMidpointClvBps: number;
  executableLiquidationClvBps: number;
};

export type PaperSettlement = {
  settledAtTsMs: number;
  won: boolean;
  payoutMicroUsd: MicroUsd;
  pnlMicroUsd: MicroUsd;
  returnBps: number;
  entryBrier: number;
};

export type PaperPosition = {
  caseId: string;
  lane: PaperStudyLane;
  signalId: string;
  fixtureId: string;
  marketKey: string;
  conditionId: string;
  assetId: string;
  outcome: string;
  selectedLineMilli: number;
  openedAtTsMs: number;
  filledShares: number;
  averageEntryPrice: number;
  entryGrossMicroUsd: MicroUsd;
  entryFeeMicroUsd: MicroUsd;
  entryCostMicroUsd: MicroUsd;
  fillStatus: "filled" | "partial";
  entryHalfSpreadBps: number;
  entrySlippageBps: number;
  selectedDepthUsd: number;
  status: "open" | "marked" | "settled";
  closeMark: PaperCloseMark | null;
  settlement: PaperSettlement | null;
};

/**
 * Trusted, already-verified state used only when rebuilding a portfolio from
 * the append-only decision ledger.  The constructor still validates the
 * aggregate arithmetic and position identities before accepting it.
 */
export type PaperPortfolioInitialState = {
  positions: readonly PaperPosition[];
  realizedPnlMicroUsd: MicroUsd;
  peakEquityMicroUsd: MicroUsd;
  currentDrawdownMicroUsd: MicroUsd;
};

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function bestBid(book: PolymarketBookEvent): number | null {
  return book.bids.length === 0 ? null : Math.max(...book.bids.map((level) => level.price));
}

function bestAsk(book: PolymarketBookEvent): number | null {
  return book.asks.length === 0 ? null : Math.min(...book.asks.map((level) => level.price));
}

export class PaperPortfolio {
  readonly #positions = new Map<string, PaperPosition>();
  #realizedPnlMicroUsd = microUsd(0);
  #peakEquityMicroUsd: MicroUsd;
  #currentDrawdownMicroUsd = microUsd(0);

  constructor(readonly options: {
    lane: PaperStudyLane;
    bankrollMicroUsd: MicroUsd;
    drawdownStopMicroUsd: MicroUsd;
    ledger: DecisionLedger;
    initialState?: PaperPortfolioInitialState;
  }) {
    if (options.bankrollMicroUsd <= 0 || options.drawdownStopMicroUsd <= 0) {
      throw new RangeError("Paper portfolio bankroll and drawdown stop must be positive");
    }
    this.#peakEquityMicroUsd = options.bankrollMicroUsd;
    if (options.initialState) this.#restore(options.initialState);
  }

  open(input: {
    caseId: string;
    signal: DetectorSignal;
    fill: PaperFill;
    openedAtTsMs: number;
  }): PaperPosition {
    if (this.#positions.has(input.caseId)) throw new Error(`Paper position already exists for ${input.caseId}`);
    if (input.fill.status === "no_fill" || input.fill.filledShares <= 0 || input.fill.averagePrice === null) {
      throw new Error("Cannot open a paper position from a no-fill result");
    }
    if (input.fill.direction !== "buy") {
      throw new Error("Opening paper positions currently requires a canonical-token buy");
    }
    if (
      input.signal.market.lineMilli === null ||
      input.fill.halfSpreadBps === null ||
      input.fill.slippageProbabilityBps === null
    ) {
      throw new Error("Paper positions require totals line, spread, and slippage evidence");
    }
    const position: PaperPosition = {
      caseId: input.caseId,
      lane: this.options.lane,
      signalId: input.signal.signalId,
      fixtureId: input.signal.fixtureId,
      marketKey: input.signal.market.key,
      conditionId: input.fill.conditionId,
      assetId: input.fill.assetId,
      outcome: input.signal.outcome,
      selectedLineMilli: input.signal.market.lineMilli,
      openedAtTsMs: input.openedAtTsMs,
      filledShares: input.fill.filledShares,
      averageEntryPrice: input.fill.averagePrice,
      entryGrossMicroUsd: input.fill.grossMicroUsd,
      entryFeeMicroUsd: input.fill.feeMicroUsd,
      entryCostMicroUsd: input.fill.netConsiderationMicroUsd,
      fillStatus: input.fill.status,
      entryHalfSpreadBps: input.fill.halfSpreadBps,
      entrySlippageBps: input.fill.slippageProbabilityBps,
      selectedDepthUsd: input.fill.executableDepthUsd,
      status: "open",
      closeMark: null,
      settlement: null
    };
    this.options.ledger.append({
      entryId: `${input.caseId}:position_opened`,
      caseId: input.caseId,
      kind: "position_opened",
      atTsMs: input.openedAtTsMs,
      payload: json(position)
    });
    this.#positions.set(input.caseId, position);
    return structuredClone(position);
  }

  markAtClose(input: {
    caseId: string;
    book: PolymarketBookEvent;
    cutoffTsMs: number;
    markedAtTsMs: number;
  }): PaperCloseMark {
    const position = this.#requiredPosition(input.caseId);
    if (position.status !== "open") throw new Error(`Paper position ${input.caseId} is not open`);
    if (!Number.isSafeInteger(input.markedAtTsMs) || input.markedAtTsMs < input.book.observedTsMs) {
      throw new Error("Closing mark timestamp cannot precede the canonical book observation time");
    }
    if (!Number.isSafeInteger(input.cutoffTsMs) || input.book.sourceTsMs > input.cutoffTsMs) {
      throw new Error("Closing book source timestamp must be at or before the registered cutoff");
    }
    if (
      input.book.fixtureId !== position.fixtureId ||
      input.book.market.key !== position.marketKey ||
      input.book.conditionId !== position.conditionId ||
      input.book.assetId !== position.assetId ||
      input.book.outcome !== position.outcome ||
      input.book.tokenRole !== "canonical"
    ) {
      throw new Error("Closing book does not match the paper position");
    }
    const closeBid = bestBid(input.book);
    const closeAsk = bestAsk(input.book);
    if (closeBid === null || closeAsk === null || closeBid > closeAsk) {
      throw new Error("Closing book must have a valid bid and ask");
    }
    const closeMidpoint = (closeBid + closeAsk) / 2;
    const unitCost = position.entryCostMicroUsd / USD_MICRO_UNITS / position.filledShares;
    const closeMark: PaperCloseMark = {
      cutoffTsMs: input.cutoffTsMs,
      markedAtTsMs: input.markedAtTsMs,
      bookSourceTsMs: input.book.sourceTsMs,
      bookObservedTsMs: input.book.observedTsMs,
      closeBid,
      closeAsk,
      closeMidpoint,
      grossMidpointClvBps: (closeMidpoint - position.averageEntryPrice) * 10_000,
      netMidpointClvBps: (closeMidpoint - unitCost) * 10_000,
      executableLiquidationClvBps: (closeBid - unitCost) * 10_000
    };
    this.options.ledger.append({
      entryId: `${input.caseId}:position_closed:${input.markedAtTsMs}`,
      caseId: input.caseId,
      kind: "position_closed",
      atTsMs: input.markedAtTsMs,
      payload: json(closeMark)
    });
    position.status = "marked";
    position.closeMark = closeMark;
    return structuredClone(closeMark);
  }

  settle(input: { caseId: string; won: boolean; settledAtTsMs: number }): PaperSettlement {
    const position = this.#requiredPosition(input.caseId);
    if (position.status !== "marked") throw new Error(`Paper position ${input.caseId} lacks a closing mark`);
    if (
      !Number.isSafeInteger(input.settledAtTsMs) ||
      input.settledAtTsMs < position.closeMark!.markedAtTsMs
    ) {
      throw new Error("Settlement timestamp cannot precede the closing mark");
    }
    const payoutMicroUsd = microUsd(input.won ? Math.floor(position.filledShares * USD_MICRO_UNITS) : 0);
    const pnlMicroUsd = microUsd(payoutMicroUsd - position.entryCostMicroUsd);
    const settlement: PaperSettlement = {
      settledAtTsMs: input.settledAtTsMs,
      won: input.won,
      payoutMicroUsd,
      pnlMicroUsd,
      returnBps: position.entryCostMicroUsd === 0 ? 0 : pnlMicroUsd / position.entryCostMicroUsd * 10_000,
      entryBrier: (position.averageEntryPrice - (input.won ? 1 : 0)) ** 2
    };
    this.options.ledger.append({
      entryId: `${input.caseId}:position_settled:${input.settledAtTsMs}`,
      caseId: input.caseId,
      kind: "position_settled",
      atTsMs: input.settledAtTsMs,
      payload: json(settlement)
    });
    position.status = "settled";
    position.settlement = settlement;
    this.#realizedPnlMicroUsd = microUsd(this.#realizedPnlMicroUsd + pnlMicroUsd);
    const equity = microUsd(this.options.bankrollMicroUsd + this.#realizedPnlMicroUsd);
    if (equity > this.#peakEquityMicroUsd) this.#peakEquityMicroUsd = equity;
    this.#currentDrawdownMicroUsd = microUsd(Math.max(0, this.#peakEquityMicroUsd - equity));
    return structuredClone(settlement);
  }

  positions(): PaperPosition[] {
    return [...this.#positions.values()].map((position) => structuredClone(position));
  }

  riskState(): PaperRiskState {
    const openExposure = [...this.#positions.values()]
      .filter((position) => position.status !== "settled")
      .reduce((sum, position) => sum + position.entryCostMicroUsd, 0);
    return {
      openExposureMicroUsd: microUsd(openExposure),
      currentDrawdownMicroUsd: this.#currentDrawdownMicroUsd,
      halted: this.#currentDrawdownMicroUsd >= this.options.drawdownStopMicroUsd
    };
  }

  summary(): {
    positions: number;
    openPositions: number;
    settledPositions: number;
    realizedPnlMicroUsd: MicroUsd;
    peakEquityMicroUsd: MicroUsd;
    currentDrawdownMicroUsd: MicroUsd;
  } {
    const positions = [...this.#positions.values()];
    return {
      positions: positions.length,
      openPositions: positions.filter((position) => position.status !== "settled").length,
      settledPositions: positions.filter((position) => position.status === "settled").length,
      realizedPnlMicroUsd: this.#realizedPnlMicroUsd,
      peakEquityMicroUsd: this.#peakEquityMicroUsd,
      currentDrawdownMicroUsd: this.#currentDrawdownMicroUsd
    };
  }

  #requiredPosition(caseId: string): PaperPosition {
    const position = this.#positions.get(caseId);
    if (!position) throw new Error(`Unknown paper position: ${caseId}`);
    return position;
  }

  #restore(initial: PaperPortfolioInitialState): void {
    const seen = new Set<string>();
    let realizedPnlMicroUsd = 0;
    for (const supplied of initial.positions) {
      if (seen.has(supplied.caseId)) {
        throw new Error(`Duplicate restored paper position: ${supplied.caseId}`);
      }
      seen.add(supplied.caseId);
      if (supplied.lane !== this.options.lane) {
        throw new Error(`Restored paper position lane mismatch: ${supplied.caseId}`);
      }
      if (supplied.status === "open" && (supplied.closeMark !== null || supplied.settlement !== null)) {
        throw new Error(`Open restored paper position has closing state: ${supplied.caseId}`);
      }
      if (supplied.status === "marked" && (supplied.closeMark === null || supplied.settlement !== null)) {
        throw new Error(`Marked restored paper position has inconsistent closing state: ${supplied.caseId}`);
      }
      if (supplied.status === "settled" && (supplied.closeMark === null || supplied.settlement === null)) {
        throw new Error(`Settled restored paper position is incomplete: ${supplied.caseId}`);
      }
      if (supplied.status === "settled") realizedPnlMicroUsd += supplied.settlement!.pnlMicroUsd;
      this.#positions.set(supplied.caseId, structuredClone(supplied));
    }
    const checkedRealized = microUsd(realizedPnlMicroUsd);
    if (checkedRealized !== initial.realizedPnlMicroUsd) {
      throw new Error("Restored paper realized P&L does not match settled positions");
    }
    const currentEquityMicroUsd = microUsd(this.options.bankrollMicroUsd + checkedRealized);
    if (
      initial.peakEquityMicroUsd < this.options.bankrollMicroUsd ||
      initial.peakEquityMicroUsd < currentEquityMicroUsd
    ) {
      throw new Error("Restored paper peak equity is inconsistent");
    }
    const expectedDrawdown = microUsd(Math.max(0, initial.peakEquityMicroUsd - currentEquityMicroUsd));
    if (expectedDrawdown !== initial.currentDrawdownMicroUsd) {
      throw new Error("Restored paper drawdown is inconsistent");
    }
    this.#realizedPnlMicroUsd = checkedRealized;
    this.#peakEquityMicroUsd = initial.peakEquityMicroUsd;
    this.#currentDrawdownMicroUsd = initial.currentDrawdownMicroUsd;
  }
}
