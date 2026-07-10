import { describe, expect, it } from "vitest";
import { probability } from "../src/domain/probability.js";
import {
  selectMainTotalLine,
  type TotalLineEvidence,
  type TotalLineSelectorConfig
} from "../src/research/main-total-selector.js";

function row(
  marketId: string,
  lineMilli: number,
  price: number,
  volume: number,
  liquidity: number,
  coveragePoints: number
): TotalLineEvidence {
  return {
    fixtureId: "fixture-1",
    marketId,
    marketKey: `fixture-1:total_goals:full_time:${lineMilli}`,
    lineMilli,
    mappingStatus: "candidate",
    txlineMarketObserved: true,
    preKickoffOverProbability: probability(price),
    preKickoffPointTsMs: 10_000,
    volume,
    liquidity,
    coveragePoints
  };
}

const baseConfig: TotalLineSelectorConfig = {
  minimumCoveragePoints: 1,
  minimumVolume: 0,
  minimumLiquidity: 0,
  maximumDistanceFromEven: 0.5,
  weights: { balance: 1, volume: 0, liquidity: 0, coverage: 0 }
};

describe("dynamic main total selector", () => {
  it("selects from evidence and exposes criterion disagreement", () => {
    const result = selectMainTotalLine(
      "fixture-1",
      [row("m15", 1_500, 0.7, 100, 1_000, 50), row("m25", 2_500, 0.51, 10, 20, 10)],
      baseConfig
    );
    expect(result.selected?.lineMilli).toBe(2_500);
    expect(result.criteriaDisagree).toBe(true);
    expect(result.selected?.criterionWins.closestToEven).toBe(true);
    expect(result.ranked[0]?.score).toBeGreaterThan(result.ranked[1]?.score ?? 0);
  });

  it("changes deterministically when an injected evidence weight changes", () => {
    const evidence = [
      row("balanced", 2_500, 0.5, 10, 10, 10),
      row("liquid", 3_500, 0.6, 1_000_000, 1_000_000, 1_000)
    ];
    const selected = selectMainTotalLine("fixture-1", evidence, {
      ...baseConfig,
      weights: { balance: 0, volume: 1, liquidity: 1, coverage: 1 }
    });
    expect(selected.selected?.marketId).toBe("liquid");
  });

  it("fails closed when every line misses injected eligibility requirements", () => {
    const selected = selectMainTotalLine(
      "fixture-1",
      [row("thin", 2_500, 0.5, 0, 0, 1)],
      { ...baseConfig, minimumCoveragePoints: 10, minimumLiquidity: 1 }
    );
    expect(selected.status).toBe("no_eligible_line");
    expect(selected.selected).toBeNull();
    expect(selected.excluded[0]?.reasons).toEqual([
      "insufficient_coverage",
      "insufficient_liquidity"
    ]);
  });
});
