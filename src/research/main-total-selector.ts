import type { MappingStatus } from "../bus/events.js";
import { probability, type Probability } from "../domain/probability.js";

export type TotalLineEvidence = {
  fixtureId: string;
  marketId: string;
  marketKey: string;
  lineMilli: number;
  mappingStatus: MappingStatus;
  txlineMarketObserved: boolean;
  selectorCutoffTsMs: number;
  preKickoffOverProbability: Probability | null;
  preKickoffPointTsMs: number | null;
  coverageFirstPointTsMs: number | null;
  coverageLastPointTsMs: number | null;
  volume: number;
  liquidity: number;
  coveragePoints: number;
};

export type TotalLineSelectorConfig = {
  minimumCoveragePoints: number;
  minimumVolume: number;
  minimumLiquidity: number;
  maximumDistanceFromEven: number;
  weights: {
    balance: number;
    volume: number;
    liquidity: number;
    coverage: number;
  };
};

export type RankedTotalLine = TotalLineEvidence & {
  score: number;
  components: {
    balance: number;
    volume: number;
    liquidity: number;
    coverage: number;
  };
  criterionWins: {
    closestToEven: boolean;
    maxVolume: boolean;
    maxLiquidity: boolean;
    maxCoverage: boolean;
  };
};

export type TotalLineSelection = {
  fixtureId: string;
  latestAllowedSelectorCutoffTsMs: number | null;
  status: "selected" | "no_eligible_line";
  selected: RankedTotalLine | null;
  ranked: RankedTotalLine[];
  excluded: Array<{ marketId: string; reasons: string[] }>;
  criteriaDisagree: boolean;
};

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
}

function validateConfig(config: TotalLineSelectorConfig): void {
  finiteNonNegative(config.minimumCoveragePoints, "minimumCoveragePoints");
  if (!Number.isInteger(config.minimumCoveragePoints)) {
    throw new RangeError("minimumCoveragePoints must be an integer");
  }
  finiteNonNegative(config.minimumVolume, "minimumVolume");
  finiteNonNegative(config.minimumLiquidity, "minimumLiquidity");
  finiteNonNegative(config.maximumDistanceFromEven, "maximumDistanceFromEven");
  if (config.maximumDistanceFromEven > 0.5) {
    throw new RangeError("maximumDistanceFromEven cannot exceed 0.5");
  }
  for (const [name, weight] of Object.entries(config.weights)) finiteNonNegative(weight, `weights.${name}`);
  if (Object.values(config.weights).every((weight) => weight === 0)) {
    throw new RangeError("At least one total-line selector weight must be positive");
  }
}

export function assertCausalTotalSelectorConfig(config: TotalLineSelectorConfig): void {
  validateConfig(config);
  if (
    config.minimumVolume !== 0 ||
    config.minimumLiquidity !== 0 ||
    config.weights.volume !== 0 ||
    config.weights.liquidity !== 0
  ) {
    throw new Error(
      "Causal total selector cannot use volume or liquidity without timestamped as-of evidence"
    );
  }
}

function normalizedLog(value: number, maximum: number): number {
  return maximum <= 0 ? 0 : Math.log1p(value) / Math.log1p(maximum);
}

function winners(rows: TotalLineEvidence[]): {
  closestToEven: Set<string>;
  maxVolume: Set<string>;
  maxLiquidity: Set<string>;
  maxCoverage: Set<string>;
} {
  const minimumDistance = Math.min(
    ...rows.map((row) => Math.abs(row.preKickoffOverProbability! - 0.5))
  );
  const maxVolume = Math.max(...rows.map((row) => row.volume));
  const maxLiquidity = Math.max(...rows.map((row) => row.liquidity));
  const maxCoverage = Math.max(...rows.map((row) => row.coveragePoints));
  return {
    closestToEven: new Set(
      rows
        .filter((row) => Math.abs(row.preKickoffOverProbability! - 0.5) === minimumDistance)
        .map((row) => row.marketId)
    ),
    maxVolume: new Set(rows.filter((row) => row.volume === maxVolume).map((row) => row.marketId)),
    maxLiquidity: new Set(rows.filter((row) => row.liquidity === maxLiquidity).map((row) => row.marketId)),
    maxCoverage: new Set(
      rows.filter((row) => row.coveragePoints === maxCoverage).map((row) => row.marketId)
    )
  };
}

export function selectMainTotalLine(
  fixtureId: string,
  evidence: readonly TotalLineEvidence[],
  config: TotalLineSelectorConfig,
  latestAllowedSelectorCutoffTsMs?: number
): TotalLineSelection {
  validateConfig(config);
  if (fixtureId.trim() === "") throw new Error("Total-line selection requires a fixtureId");
  if (
    latestAllowedSelectorCutoffTsMs !== undefined &&
    !Number.isSafeInteger(latestAllowedSelectorCutoffTsMs)
  ) {
    throw new RangeError("Latest allowed selector cutoff must be a safe-integer timestamp");
  }
  const excluded: Array<{ marketId: string; reasons: string[] }> = [];
  const eligible: TotalLineEvidence[] = [];
  for (const row of evidence) {
    if (row.fixtureId !== fixtureId) throw new Error(`Total-line evidence belongs to ${row.fixtureId}, not ${fixtureId}`);
    if (!Number.isInteger(row.lineMilli) || row.lineMilli <= 0) {
      throw new Error(`Total line ${row.marketId} has an invalid lineMilli`);
    }
    const expectedMarketKey = `${fixtureId}:total_goals:full_time:${row.lineMilli}`;
    if (row.marketKey !== expectedMarketKey) {
      throw new Error(`Total line ${row.marketId} has inconsistent market key ${row.marketKey}`);
    }
    finiteNonNegative(row.volume, `volume:${row.marketId}`);
    finiteNonNegative(row.liquidity, `liquidity:${row.marketId}`);
    finiteNonNegative(row.coveragePoints, `coveragePoints:${row.marketId}`);
    if (!Number.isInteger(row.coveragePoints)) {
      throw new Error(`Total line ${row.marketId} has non-integer coverage`);
    }
    if (row.preKickoffPointTsMs !== null && !Number.isSafeInteger(row.preKickoffPointTsMs)) {
      throw new Error(`Total line ${row.marketId} has invalid pre-kickoff point timestamp`);
    }
    if (row.coverageFirstPointTsMs !== null && !Number.isSafeInteger(row.coverageFirstPointTsMs)) {
      throw new Error(`Total line ${row.marketId} has invalid first coverage timestamp`);
    }
    if (row.coverageLastPointTsMs !== null && !Number.isSafeInteger(row.coverageLastPointTsMs)) {
      throw new Error(`Total line ${row.marketId} has invalid last coverage timestamp`);
    }
    if (row.preKickoffOverProbability !== null) probability(row.preKickoffOverProbability);
    const reasons: string[] = [];
    if (row.mappingStatus === "rejected") reasons.push("mapping_rejected");
    if (!row.txlineMarketObserved) reasons.push("txline_line_unobserved");
    const hasValidSelectorCutoff = Number.isSafeInteger(row.selectorCutoffTsMs);
    if (!hasValidSelectorCutoff) reasons.push("missing_selector_cutoff");
    else if (
      latestAllowedSelectorCutoffTsMs !== undefined &&
      row.selectorCutoffTsMs > latestAllowedSelectorCutoffTsMs
    ) {
      reasons.push("selector_cutoff_after_evaluation_start");
    }
    if (row.preKickoffOverProbability === null) reasons.push("missing_pre_kickoff_probability");
    else if (row.preKickoffPointTsMs === null) reasons.push("missing_pre_kickoff_probability_timestamp");
    else if (hasValidSelectorCutoff && row.preKickoffPointTsMs > row.selectorCutoffTsMs) {
      reasons.push("probability_after_selector_cutoff");
    }
    else if (Math.abs(row.preKickoffOverProbability - 0.5) > config.maximumDistanceFromEven) {
      reasons.push("too_far_from_even");
    }
    if (
      row.coveragePoints > 0 &&
      (row.coverageFirstPointTsMs === null || row.coverageLastPointTsMs === null)
    ) {
      reasons.push("missing_coverage_cutoff_evidence");
    } else if (
      hasValidSelectorCutoff &&
      row.coverageLastPointTsMs !== null &&
      row.coverageLastPointTsMs > row.selectorCutoffTsMs
    ) {
      reasons.push("coverage_after_selector_cutoff");
    }
    if (row.coveragePoints < config.minimumCoveragePoints) reasons.push("insufficient_coverage");
    if (row.volume < config.minimumVolume) reasons.push("insufficient_volume");
    if (row.liquidity < config.minimumLiquidity) reasons.push("insufficient_liquidity");
    if (reasons.length > 0) excluded.push({ marketId: row.marketId, reasons });
    else eligible.push({ ...row });
  }

  if (eligible.length === 0) {
    return {
      fixtureId,
      latestAllowedSelectorCutoffTsMs: latestAllowedSelectorCutoffTsMs ?? null,
      status: "no_eligible_line",
      selected: null,
      ranked: [],
      excluded,
      criteriaDisagree: false
    };
  }

  const criterionWinners = winners(eligible);
  const criteriaSets = Object.values(criterionWinners);
  const commonWinner = [...criteriaSets[0]!].some((marketId) =>
    criteriaSets.every((set) => set.has(marketId))
  );
  const maximumVolume = Math.max(...eligible.map((row) => row.volume));
  const maximumLiquidity = Math.max(...eligible.map((row) => row.liquidity));
  const maximumCoverage = Math.max(...eligible.map((row) => row.coveragePoints));
  const weightTotal = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
  const ranked = eligible
    .map((row): RankedTotalLine => {
      const components = {
        balance: 1 - Math.abs(row.preKickoffOverProbability! - 0.5) / 0.5,
        volume: normalizedLog(row.volume, maximumVolume),
        liquidity: normalizedLog(row.liquidity, maximumLiquidity),
        coverage: maximumCoverage === 0 ? 0 : row.coveragePoints / maximumCoverage
      };
      const score =
        (components.balance * config.weights.balance +
          components.volume * config.weights.volume +
          components.liquidity * config.weights.liquidity +
          components.coverage * config.weights.coverage) /
        weightTotal;
      return {
        ...row,
        preKickoffOverProbability: probability(row.preKickoffOverProbability!),
        score,
        components,
        criterionWins: {
          closestToEven: criterionWinners.closestToEven.has(row.marketId),
          maxVolume: criterionWinners.maxVolume.has(row.marketId),
          maxLiquidity: criterionWinners.maxLiquidity.has(row.marketId),
          maxCoverage: criterionWinners.maxCoverage.has(row.marketId)
        }
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.components.balance - left.components.balance ||
        right.coveragePoints - left.coveragePoints ||
        left.lineMilli - right.lineMilli ||
        left.marketId.localeCompare(right.marketId)
    );
  return {
    fixtureId,
    latestAllowedSelectorCutoffTsMs: latestAllowedSelectorCutoffTsMs ?? null,
    status: "selected",
    selected: ranked[0]!,
    ranked,
    excluded,
    criteriaDisagree: !commonWinner
  };
}
