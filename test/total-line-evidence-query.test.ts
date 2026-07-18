import { DuckDBInstance } from "@duckdb/node-api";
import { describe, expect, it } from "vitest";
import { probability } from "../src/domain/probability.js";
import {
  selectMainTotalLine,
  type TotalLineEvidence
} from "../src/research/main-total-selector.js";
import { buildTotalLineHistoryEvidenceQuery } from "../src/research/total-line-evidence-query.js";

type EvidenceRow = {
  marketId: string;
  selectorCutoffTsMs: number;
  coveragePoints: number;
  coverageFirstPointTsMs: number | null;
  coverageLastPointTsMs: number | null;
  probability: number | null;
  probabilityPointTsMs: number | null;
};

function parseRows(rows: Record<string, unknown>[]): EvidenceRow[] {
  return rows.map((row) => ({
    marketId: String(row["market_id"]),
    selectorCutoffTsMs: Number(row["selector_cutoff_ts_ms"]),
    coveragePoints: Number(row["coverage_points"]),
    coverageFirstPointTsMs:
      row["coverage_first_point_ts_ms"] === null
        ? null
        : Number(row["coverage_first_point_ts_ms"]),
    coverageLastPointTsMs:
      row["coverage_last_point_ts_ms"] === null
        ? null
        : Number(row["coverage_last_point_ts_ms"]),
    probability:
      row["pre_kickoff_probability"] === null
        ? null
        : Number(row["pre_kickoff_probability"]),
    probabilityPointTsMs:
      row["pre_kickoff_point_ts_ms"] === null
        ? null
        : Number(row["pre_kickoff_point_ts_ms"])
  }));
}

function selectedMarket(rows: readonly EvidenceRow[]): string | undefined {
  const evidence: TotalLineEvidence[] = rows.map((row, index) => ({
    fixtureId: "fixture-1",
    marketId: row.marketId,
    marketKey: `fixture-1:total_goals:full_time:${index === 0 ? 2500 : 3500}`,
    lineMilli: index === 0 ? 2_500 : 3_500,
    mappingStatus: "candidate",
    txlineMarketObserved: true,
    selectorCutoffTsMs: row.selectorCutoffTsMs,
    preKickoffOverProbability: row.probability === null ? null : probability(row.probability),
    preKickoffPointTsMs: row.probabilityPointTsMs,
    coverageFirstPointTsMs: row.coverageFirstPointTsMs,
    coverageLastPointTsMs: row.coverageLastPointTsMs,
    volume: 0,
    liquidity: 0,
    coveragePoints: row.coveragePoints
  }));
  return selectMainTotalLine("fixture-1", evidence, {
    minimumCoveragePoints: 2,
    minimumVolume: 0,
    minimumLiquidity: 0,
    maximumDistanceFromEven: 0.5,
    weights: { balance: 1, volume: 0, liquidity: 0, coverage: 0 }
  }, 2_000).selected?.marketId;
}

describe("causal total-line history evidence query", () => {
  it("does not let future prices or future coverage affect evidence", async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    try {
      await connection.run(`
        CREATE TABLE polymarket_history(
          event_id VARCHAR,
          asset_id VARCHAR,
          source_ts_ms BIGINT,
          price DOUBLE
        );
        INSERT INTO polymarket_history VALUES
          ('a-early', 'asset-a', 1000, 0.40),
          ('a-cutoff', 'asset-a', 2000, 0.49),
          ('b-early', 'asset-b', 1000, 0.60),
          ('b-cutoff', 'asset-b', 2000, 0.55)
      `);
      const query = buildTotalLineHistoryEvidenceQuery([
        { marketId: "market-a", assetId: "asset-a", selectorCutoffTsMs: 2_000 },
        { marketId: "market-b", assetId: "asset-b", selectorCutoffTsMs: 2_000 }
      ]);
      const beforeFutureRows = parseRows(
        (await connection.runAndReadAll(query)).getRowObjectsJson() as Record<string, unknown>[]
      );

      await connection.run(`
        INSERT INTO polymarket_history VALUES
          ('a-future-1', 'asset-a', 2001, 0.99),
          ('a-future-2', 'asset-a', 3000, 0.01),
          ('b-future-1', 'asset-b', 2001, 0.01)
      `);
      const afterFutureRows = parseRows(
        (await connection.runAndReadAll(query)).getRowObjectsJson() as Record<string, unknown>[]
      );

      expect(afterFutureRows).toEqual(beforeFutureRows);
      expect(selectedMarket(beforeFutureRows)).toBe("market-a");
      expect(selectedMarket(afterFutureRows)).toBe("market-a");
      expect(afterFutureRows).toEqual([
        {
          marketId: "market-a",
          selectorCutoffTsMs: 2_000,
          coveragePoints: 2,
          coverageFirstPointTsMs: 1_000,
          coverageLastPointTsMs: 2_000,
          probability: 0.49,
          probabilityPointTsMs: 2_000
        },
        {
          marketId: "market-b",
          selectorCutoffTsMs: 2_000,
          coveragePoints: 2,
          coverageFirstPointTsMs: 1_000,
          coverageLastPointTsMs: 2_000,
          probability: 0.55,
          probabilityPointTsMs: 2_000
        }
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
});
