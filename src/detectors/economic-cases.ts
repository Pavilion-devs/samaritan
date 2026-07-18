import { stableJson } from "../domain/json.js";
import type { CanonicalOutcome } from "../bus/events.js";
import type { DetectorSignal } from "./types.js";

export type EconomicCaseDispositionReason =
  | "executable_buy_retained"
  | "duplicate_executable_buy_collapsed"
  | "complementary_sell_collapsed_into_executable_buy"
  | "sell_only_unproven_executable_ask"
  | "unsupported_total_goals_outcome"
  | "non_binary_market_passthrough";

export type EconomicCaseDisposition = {
  signalId: string;
  disposition: "retained" | "collapsed" | "dropped";
  reason: EconomicCaseDispositionReason;
  economicOutcome: "over" | "under" | null;
};

export type EconomicCaseNormalizationSummary = {
  rawEmissions: number;
  normalizedCases: number;
  executableTotalGoalsCases: number;
  nonBinaryMarketSignalsPassedThrough: number;
  duplicateExecutableBuysCollapsed: number;
  complementarySellsCollapsed: number;
  sellOnlySignalsDropped: number;
  unsupportedTotalGoalsSignalsDropped: number;
};

export type EconomicCaseNormalizationResult = {
  /**
   * Signals safe to pass to the next stage. Total-goals entries in this list are
   * always actual BUY signals; non-binary markets are deliberately untouched.
   */
  signals: DetectorSignal[];
  dispositions: EconomicCaseDisposition[];
  summary: EconomicCaseNormalizationSummary;
};

type IndexedSignal = { signal: DetectorSignal; index: number; economicOutcome: "over" | "under" };

function isBinaryTotalOutcome(outcome: CanonicalOutcome): outcome is "over" | "under" {
  return outcome === "over" || outcome === "under";
}

function complement(outcome: "over" | "under"): "over" | "under" {
  return outcome === "over" ? "under" : "over";
}

function economicOutcome(signal: DetectorSignal): "over" | "under" {
  const outcome = signal.outcome as "over" | "under";
  return signal.direction === "buy" ? outcome : complement(outcome);
}

function economicCaseKey(item: IndexedSignal): string {
  const { signal } = item;
  return stableJson({
    detector: signal.kind,
    fixtureId: signal.fixtureId,
    marketKey: signal.market.key,
    detectedAtTsMs: signal.detectedAtTsMs,
    observedAtTsMs: signal.observedAtTsMs,
    economicOutcome: item.economicOutcome
  });
}

/**
 * Convert raw binary Total Goals detector emissions into executable economic
 * cases without ever synthesizing an order. A Total Goals sell is only an
 * economic description of buying the complementary token; DetectorSignal does
 * not carry proof of that token's executable ask, so a sell-only case fails
 * closed. When the same batch contains the actual complementary BUY, that BUY
 * is retained and the sell expression is collapsed into it.
 *
 * Match Result is three-way and therefore has no one-token complement. Those
 * signals pass through byte-for-byte and are not deduplicated by this module.
 */
export function normalizeExecutableEconomicCases(
  rawSignals: readonly DetectorSignal[]
): EconomicCaseNormalizationResult {
  const dispositions: Array<EconomicCaseDisposition | undefined> = new Array(rawSignals.length);
  const retainedIndexes = new Set<number>();
  const groups = new Map<string, IndexedSignal[]>();

  for (const [index, signal] of rawSignals.entries()) {
    if (signal.market.family !== "total_goals") {
      retainedIndexes.add(index);
      dispositions[index] = {
        signalId: signal.signalId,
        disposition: "retained",
        reason: "non_binary_market_passthrough",
        economicOutcome: null
      };
      continue;
    }
    if (!isBinaryTotalOutcome(signal.outcome)) {
      dispositions[index] = {
        signalId: signal.signalId,
        disposition: "dropped",
        reason: "unsupported_total_goals_outcome",
        economicOutcome: null
      };
      continue;
    }
    const item: IndexedSignal = { signal, index, economicOutcome: economicOutcome(signal) };
    const key = economicCaseKey(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const executableBuy = group.find(({ signal, economicOutcome: outcome }) =>
      signal.direction === "buy" && signal.outcome === outcome
    );
    if (!executableBuy) {
      for (const item of group) {
        dispositions[item.index] = {
          signalId: item.signal.signalId,
          disposition: "dropped",
          reason: "sell_only_unproven_executable_ask",
          economicOutcome: item.economicOutcome
        };
      }
      continue;
    }

    retainedIndexes.add(executableBuy.index);
    dispositions[executableBuy.index] = {
      signalId: executableBuy.signal.signalId,
      disposition: "retained",
      reason: "executable_buy_retained",
      economicOutcome: executableBuy.economicOutcome
    };
    for (const item of group) {
      if (item.index === executableBuy.index) continue;
      const isDuplicateBuy = item.signal.direction === "buy";
      dispositions[item.index] = {
        signalId: item.signal.signalId,
        disposition: "collapsed",
        reason: isDuplicateBuy
          ? "duplicate_executable_buy_collapsed"
          : "complementary_sell_collapsed_into_executable_buy",
        economicOutcome: item.economicOutcome
      };
    }
  }

  const completeDispositions = dispositions.map((item, index) => {
    if (!item) throw new Error(`Missing economic-case disposition for signal index ${index}`);
    return item;
  });
  const signals = rawSignals.filter((_, index) => retainedIndexes.has(index));
  return {
    signals,
    dispositions: completeDispositions,
    summary: {
      rawEmissions: rawSignals.length,
      normalizedCases: signals.length,
      executableTotalGoalsCases: completeDispositions.filter(
        (item) => item.disposition === "retained" && item.reason === "executable_buy_retained"
      ).length,
      nonBinaryMarketSignalsPassedThrough: completeDispositions.filter(
        (item) => item.reason === "non_binary_market_passthrough"
      ).length,
      duplicateExecutableBuysCollapsed: completeDispositions.filter(
        (item) => item.reason === "duplicate_executable_buy_collapsed"
      ).length,
      complementarySellsCollapsed: completeDispositions.filter(
        (item) => item.reason === "complementary_sell_collapsed_into_executable_buy"
      ).length,
      sellOnlySignalsDropped: completeDispositions.filter(
        (item) => item.reason === "sell_only_unproven_executable_ask"
      ).length,
      unsupportedTotalGoalsSignalsDropped: completeDispositions.filter(
        (item) => item.reason === "unsupported_total_goals_outcome"
      ).length
    }
  };
}
