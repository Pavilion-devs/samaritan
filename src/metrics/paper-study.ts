import { createHash } from "node:crypto";
import type { PaperStudyLane } from "../harness/paper-pipeline.js";

export type PaperStudyFillEvidence = {
  status: "filled" | "partial";
  entryCostMicroUsd: number;
  halfSpreadBps: number;
  slippageBps: number;
  selectedDepthUsd: number | null;
  grossClvBps: number | null;
  netClvBps: number | null;
  executableLiquidationClvBps: number | null;
  settledAtTsMs: number | null;
  settlementPnlMicroUsd: number | null;
};

export type PaperStudyObservation = {
  caseId: string;
  lane: PaperStudyLane;
  fixtureId: string;
  kickoffTsMs: number;
  selectedLineMilli: number;
  signalId: string;
  fill: PaperStudyFillEvidence | null;
};

export type BootstrapInterval = {
  iterations: number;
  seed: number;
  matches: number;
  signals: number;
  low: number;
  median: number;
  high: number;
};

export type PaperMatchRow = {
  fixtureId: string;
  kickoffTsMs: number;
  selectedLineMilli: number;
  signals: number;
  fills: number;
  fillRate: number;
  meanHalfSpreadBps: number | null;
  meanSlippageBps: number | null;
  grossClvBps: number | null;
  netClvBps: number | null;
  settlementPnlMicroUsd: number | null;
  netReturnBps: number | null;
};

export type PaperStudyCounts = {
  matches: number;
  signals: number;
  filledMatches: number;
  fills: number;
  settledFills: number;
};

export type PaperStudyEndpoints = {
  meanNetClvBps: number;
  netClvInterval: BootstrapInterval;
  meanSettlementPnlMicroUsd: number;
  settlementPnlInterval: BootstrapInterval;
  noTradeBaselineClvBps: 0;
  randomDirectionControlClvBps: number;
  fractionSettledMatchesNetPositive: number;
};

export type PaperStudyGuardrails = {
  fillRate: number;
  fillRatePassed: boolean;
  meanSlippageBps: number | null;
  slippagePassed: boolean;
  maxDrawdownMicroUsd: number;
  drawdownPassed: boolean;
  selectedDepthComplete: boolean;
  closeMarksComplete: boolean;
  settlementComplete: boolean;
};

export type PaperStudyReport = {
  lane: PaperStudyLane;
  status: "sealed" | "exploratory" | "accept" | "reject" | "inconclusive";
  reason: string;
  counts: PaperStudyCounts;
  stoppingRuleMet: boolean;
  rows: PaperMatchRow[] | null;
  endpoints: PaperStudyEndpoints | null;
  guardrails: PaperStudyGuardrails | null;
  bootstrap: { iterations: number; seed: number };
  randomDirectionControl: "seeded_sign_flip_of_gross_clv_minus_observed_cost";
};

export type PaperStudyEvaluationConfig = {
  minimumFilledMatches: number;
  minimumFills: number;
  minimumFillRate: number;
  maximumMeanSlippageBps: number;
  maximumDrawdownMicroUsd: number;
  bootstrapIterations: number;
  bootstrapSeed: number;
};

export const PAPER_STUDY_EVALUATION_CANDIDATE: PaperStudyEvaluationConfig = Object.freeze({
  minimumFilledMatches: 20,
  minimumFills: 40,
  minimumFillRate: 0.6,
  maximumMeanSlippageBps: 100,
  maximumDrawdownMicroUsd: 20_000_000,
  bootstrapIterations: 10_000,
  bootstrapSeed: 20_260_714
});

export type PaperStudyEvaluationInput = {
  lane: PaperStudyLane;
  observations: readonly PaperStudyObservation[];
  config?: PaperStudyEvaluationConfig;
};

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot compute a mean without observations");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullableMean(values: readonly number[]): number | null {
  return values.length === 0 ? null : mean(values);
}

function percentile(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) throw new Error("Cannot compute a percentile without observations");
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function clusteredBootstrap(
  groups: ReadonlyMap<string, readonly number[]>,
  iterations: number,
  seed: number
): BootstrapInterval {
  const matches = [...groups.entries()];
  if (matches.length === 0 || matches.some(([, values]) => values.length === 0)) {
    throw new Error("Clustered bootstrap requires non-empty match groups");
  }
  const random = mulberry32(seed);
  const distribution: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    let count = 0;
    for (let index = 0; index < matches.length; index += 1) {
      const [, values] = matches[Math.floor(random() * matches.length)]!;
      for (const value of values) {
        total += value;
        count += 1;
      }
    }
    distribution.push(total / count);
  }
  distribution.sort((left, right) => left - right);
  return {
    iterations,
    seed,
    matches: matches.length,
    signals: matches.reduce((sum, [, values]) => sum + values.length, 0),
    low: percentile(distribution, 0.025),
    median: percentile(distribution, 0.5),
    high: percentile(distribution, 0.975)
  };
}

function randomDirectionSign(seed: number, signalId: string): 1 | -1 {
  const hash = createHash("sha256").update(`${seed}:${signalId}`).digest();
  return (hash[0]! & 1) === 0 ? 1 : -1;
}

function validateConfig(config: PaperStudyEvaluationConfig): void {
  if (
    !Number.isSafeInteger(config.minimumFilledMatches) || config.minimumFilledMatches <= 0 ||
    !Number.isSafeInteger(config.minimumFills) || config.minimumFills <= 0 ||
    !Number.isSafeInteger(config.bootstrapIterations) || config.bootstrapIterations <= 0 ||
    !Number.isSafeInteger(config.bootstrapSeed)
  ) {
    throw new Error("Paper-study count, bootstrap iteration, and seed settings must be valid integers");
  }
  if (
    !Number.isFinite(config.minimumFillRate) || config.minimumFillRate < 0 || config.minimumFillRate > 1 ||
    !Number.isFinite(config.maximumMeanSlippageBps) || config.maximumMeanSlippageBps < 0 ||
    !Number.isSafeInteger(config.maximumDrawdownMicroUsd) || config.maximumDrawdownMicroUsd <= 0
  ) {
    throw new Error("Paper-study guardrail settings are invalid");
  }
}

function validateObservations(
  observations: readonly PaperStudyObservation[],
  lane: PaperStudyLane
): void {
  const caseIds = new Set<string>();
  const signalIds = new Set<string>();
  for (const observation of observations) {
    if (observation.lane !== lane) throw new Error("Paper-study lanes cannot be mixed in one report");
    if (caseIds.has(observation.caseId) || signalIds.has(observation.signalId)) {
      throw new Error("Paper-study case and signal IDs must be unique");
    }
    caseIds.add(observation.caseId);
    signalIds.add(observation.signalId);
    if (!Number.isSafeInteger(observation.kickoffTsMs) || !Number.isSafeInteger(observation.selectedLineMilli)) {
      throw new Error("Kickoff and selected line must use integer canonical units");
    }
    const fill = observation.fill;
    if (!fill) continue;
    if (!Number.isSafeInteger(fill.entryCostMicroUsd) || fill.entryCostMicroUsd <= 0) {
      throw new Error("Filled observations require positive integer micro-USD entry cost");
    }
    if (![fill.halfSpreadBps, fill.slippageBps].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error("Spread and slippage evidence must be finite and non-negative");
    }
    if (
      ![fill.grossClvBps, fill.netClvBps, fill.executableLiquidationClvBps]
        .every((value) => value === null || Number.isFinite(value))
    ) {
      throw new Error("CLV evidence must be finite when present");
    }
    if (fill.settledAtTsMs !== null && !Number.isSafeInteger(fill.settledAtTsMs)) {
      throw new Error("Settlement timestamps must be integer milliseconds");
    }
    if (
      fill.settlementPnlMicroUsd !== null &&
      (!Number.isSafeInteger(fill.settlementPnlMicroUsd) || fill.settledAtTsMs === null)
    ) {
      throw new Error("Settlement P&L requires integer micro-USD and a settlement timestamp");
    }
  }
}

function groupValues(
  observations: readonly PaperStudyObservation[],
  value: (observation: PaperStudyObservation) => number | null
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const observation of observations) {
    const result = value(observation);
    if (result === null) continue;
    const values = groups.get(observation.fixtureId) ?? [];
    values.push(result);
    groups.set(observation.fixtureId, values);
  }
  return groups;
}

function matchRows(observations: readonly PaperStudyObservation[]): PaperMatchRow[] {
  const groups = new Map<string, PaperStudyObservation[]>();
  for (const observation of observations) {
    const rows = groups.get(observation.fixtureId) ?? [];
    rows.push(observation);
    groups.set(observation.fixtureId, rows);
  }
  return [...groups.values()]
    .sort((left, right) => left[0]!.kickoffTsMs - right[0]!.kickoffTsMs || left[0]!.fixtureId.localeCompare(right[0]!.fixtureId))
    .map((group) => {
      const reference = group[0]!;
      if (group.some((observation) => observation.selectedLineMilli !== reference.selectedLineMilli)) {
        throw new Error(`Fixture ${reference.fixtureId} contains multiple selected total lines`);
      }
      const fills = group.flatMap((observation) => observation.fill ? [observation.fill] : []);
      const settled = fills.filter(
        (fill): fill is PaperStudyFillEvidence & { settlementPnlMicroUsd: number } =>
          fill.settlementPnlMicroUsd !== null
      );
      const entryCost = settled.reduce((sum, fill) => sum + fill.entryCostMicroUsd, 0);
      const pnl = settled.reduce((sum, fill) => sum + fill.settlementPnlMicroUsd, 0);
      return {
        fixtureId: reference.fixtureId,
        kickoffTsMs: reference.kickoffTsMs,
        selectedLineMilli: reference.selectedLineMilli,
        signals: group.length,
        fills: fills.length,
        fillRate: fills.length / group.length,
        meanHalfSpreadBps: nullableMean(fills.map((fill) => fill.halfSpreadBps)),
        meanSlippageBps: nullableMean(fills.map((fill) => fill.slippageBps)),
        grossClvBps: nullableMean(fills.flatMap((fill) => fill.grossClvBps === null ? [] : [fill.grossClvBps])),
        netClvBps: nullableMean(fills.flatMap((fill) => fill.netClvBps === null ? [] : [fill.netClvBps])),
        settlementPnlMicroUsd: settled.length === 0 ? null : pnl,
        netReturnBps: entryCost === 0 ? null : pnl / entryCost * 10_000
      };
    });
}

function maximumDrawdown(observations: readonly PaperStudyObservation[]): number {
  const settlements = observations
    .flatMap((observation) => {
      const fill = observation.fill;
      return !fill || fill.settlementPnlMicroUsd === null || fill.settledAtTsMs === null
        ? []
        : [{
            atTsMs: fill.settledAtTsMs,
            caseId: observation.caseId,
            pnlMicroUsd: fill.settlementPnlMicroUsd
          }];
    })
    .sort((left, right) => left.atTsMs - right.atTsMs || left.caseId.localeCompare(right.caseId));
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const settlement of settlements) {
    equity += settlement.pnlMicroUsd;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

export function evaluatePaperStudy(input: PaperStudyEvaluationInput): PaperStudyReport {
  const { lane, observations } = input;
  const config = input.config ?? PAPER_STUDY_EVALUATION_CANDIDATE;
  validateConfig(config);
  validateObservations(observations, lane);
  const fills = observations.flatMap((observation) => observation.fill ? [observation.fill] : []);
  const fixtureIds = new Set(observations.map((observation) => observation.fixtureId));
  const filledFixtureIds = new Set(observations.filter((observation) => observation.fill).map((observation) => observation.fixtureId));
  const counts: PaperStudyCounts = {
    matches: fixtureIds.size,
    signals: observations.length,
    filledMatches: filledFixtureIds.size,
    fills: fills.length,
    settledFills: fills.filter((fill) => fill.settlementPnlMicroUsd !== null).length
  };
  const stoppingRuleMet =
    counts.filledMatches >= config.minimumFilledMatches && counts.fills >= config.minimumFills;
  const base = {
    lane,
    counts,
    stoppingRuleMet,
    bootstrap: { iterations: config.bootstrapIterations, seed: config.bootstrapSeed },
    randomDirectionControl: "seeded_sign_flip_of_gross_clv_minus_observed_cost" as const
  };
  if (lane === "long_run" && !stoppingRuleMet) {
    return {
      ...base,
      status: "sealed",
      reason: `Long-run endpoints sealed until ${config.minimumFilledMatches} filled matches and ${config.minimumFills} fills`,
      rows: null,
      endpoints: null,
      guardrails: null
    };
  }

  const rows = matchRows(observations);
  const closeMarksComplete = fills.length > 0 && fills.every((fill) =>
    fill.grossClvBps !== null && fill.netClvBps !== null && fill.executableLiquidationClvBps !== null
  );
  const settlementComplete = fills.length > 0 && fills.every((fill) =>
    fill.settledAtTsMs !== null && fill.settlementPnlMicroUsd !== null
  );
  const selectedDepthComplete = fills.length > 0 &&
    fills.every((fill) => fill.selectedDepthUsd !== null && fill.selectedDepthUsd > 0);
  const fillRate = observations.length === 0 ? 0 : fills.length / observations.length;
  const meanSlippageBps = fills.length === 0 ? null : mean(fills.map((fill) => fill.slippageBps));
  const maxDrawdownMicroUsd = maximumDrawdown(observations);
  const guardrails: PaperStudyGuardrails = {
    fillRate,
    fillRatePassed: fillRate >= config.minimumFillRate,
    meanSlippageBps,
    slippagePassed: meanSlippageBps !== null && meanSlippageBps <= config.maximumMeanSlippageBps,
    maxDrawdownMicroUsd,
    drawdownPassed: maxDrawdownMicroUsd < config.maximumDrawdownMicroUsd,
    selectedDepthComplete,
    closeMarksComplete,
    settlementComplete
  };
  if (fills.length === 0 || !closeMarksComplete || !settlementComplete) {
    return {
      ...base,
      status: lane === "bounty" ? "exploratory" : "inconclusive",
      reason: "Complete close and settlement evidence is required before endpoints are computed",
      rows,
      endpoints: null,
      guardrails
    };
  }

  const clvGroups = groupValues(observations, (observation) => observation.fill?.netClvBps ?? null);
  const pnlGroups = groupValues(observations, (observation) => observation.fill?.settlementPnlMicroUsd ?? null);
  const netClvValues = fills.map((fill) => fill.netClvBps!);
  const settlementValues = fills.map((fill) => fill.settlementPnlMicroUsd!);
  const randomDirectionValues = observations.flatMap((observation) => {
    const fill = observation.fill;
    if (!fill) return [];
    const observedCost = fill.grossClvBps! - fill.netClvBps!;
    return [randomDirectionSign(config.bootstrapSeed, observation.signalId) * fill.grossClvBps! - observedCost];
  });
  const settledRows = rows.filter((row): row is PaperMatchRow & { settlementPnlMicroUsd: number } =>
    row.settlementPnlMicroUsd !== null
  );
  const endpoints: PaperStudyEndpoints = {
    meanNetClvBps: mean(netClvValues),
    netClvInterval: clusteredBootstrap(clvGroups, config.bootstrapIterations, config.bootstrapSeed),
    meanSettlementPnlMicroUsd: mean(settlementValues),
    settlementPnlInterval: clusteredBootstrap(pnlGroups, config.bootstrapIterations, config.bootstrapSeed + 1),
    noTradeBaselineClvBps: 0,
    randomDirectionControlClvBps: mean(randomDirectionValues),
    fractionSettledMatchesNetPositive:
      settledRows.filter((row) => row.settlementPnlMicroUsd > 0).length / settledRows.length
  };
  if (lane === "bounty") {
    return {
      ...base,
      status: "exploratory",
      reason: "Bounty-lane evidence is visible but excluded from the registered profitability decision",
      rows,
      endpoints,
      guardrails
    };
  }

  const guardrailsPassed = Object.entries(guardrails).every(([key, value]) =>
    key.endsWith("Passed") || key.endsWith("Complete") ? value === true : true
  );
  const accepted =
    endpoints.meanNetClvBps > 0 &&
    endpoints.netClvInterval.low > 0 &&
    endpoints.meanSettlementPnlMicroUsd > 0 &&
    endpoints.meanNetClvBps > endpoints.randomDirectionControlClvBps &&
    guardrailsPassed;
  return {
    ...base,
    status: accepted ? "accept" : "reject",
    reason: accepted
      ? "All registered endpoints and guardrails passed; real money still requires separate approval"
      : "One or more registered endpoints or guardrails failed",
    rows,
    endpoints,
    guardrails
  };
}
