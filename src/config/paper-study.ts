import type { DetectorBankConfig } from "../detectors/bank.js";
import type { FeatureEngineConfig } from "../features/engine.js";
import type { TotalLineSelectorConfig } from "../research/main-total-selector.js";

export const PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS = 15 * 60_000;
export const PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS = 180 * 60_000;

// The historical total line must be frozen before the first detector snapshot.
// Keeping this equal to the replay window makes the causal boundary explicit.
export const PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS =
  PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS;

export const PAPER_STUDY_ECONOMIC_CASE_CONFIG = Object.freeze({
  version: "binary_totals_executable_buy_v1" as const,
  marketFamily: "total_goals" as const,
  retain: "actual_buy_only" as const,
  complementarySell: "collapse_only_when_actual_buy_present" as const,
  sellOnly: "drop_unproven_complementary_ask" as const,
  matchResult: "not_in_candidate" as const
});

export const PAPER_STUDY_HISTORICAL_EVIDENCE = Object.freeze({
  protocolId: "historical-gate-causal-economic-v4-2026-07-14" as const,
  configurationHash: "9a4eeff928f697fc55ab5147a4dc07f611c40bb749501fc3bd92b211f24b2e54" as const,
  status: "historical_signal_candidate_for_forward_paper_review" as const,
  executionEvidence: "not_established_sampled_prices_only" as const
});

export const PAPER_STUDY_FEATURE_CONFIG: FeatureEngineConfig = Object.freeze({
  velocityWindowsMs: Object.freeze([60_000, 300_000, 900_000]),
  velocityEwmaHalfLifeMs: 900_000,
  cusumDriftProbability: 0.0005,
  scoreContextWindowMs: 300_000,
  freshnessMaxAgeMs: 360_000
});

export const PAPER_STUDY_DETECTOR_CONFIG: DetectorBankConfig = Object.freeze({
  velocityWindowMs: 300_000,
  consensusMoveAbsZ: 1,
  consensusCusumThreshold: 0.001,
  consensusMinimumUpdates: 5,
  consensusMinimumRawGap: 0.01,
  consensusStableAbsZ: 0,
  xmarketMinimumRawGap: 2,
  xmarketPersistenceMs: Number.MAX_SAFE_INTEGER,
  faderPolymarketAbsZ: Number.MAX_SAFE_INTEGER,
  faderMinimumRawGap: 2,
  faderPersistenceMs: Number.MAX_SAFE_INTEGER
});

export const PAPER_STUDY_TOTAL_SELECTOR_CONFIG: TotalLineSelectorConfig = Object.freeze({
  minimumCoveragePoints: 1_000,
  minimumVolume: 0,
  minimumLiquidity: 0,
  maximumDistanceFromEven: 0.15,
  weights: Object.freeze({ balance: 1, volume: 0, liquidity: 0, coverage: 0 })
});
