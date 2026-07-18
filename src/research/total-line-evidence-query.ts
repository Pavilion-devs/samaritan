export type TotalLineHistoryTarget = {
  marketId: string;
  assetId: string;
  selectorCutoffTsMs: number;
};

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function validateTarget(target: TotalLineHistoryTarget): void {
  if (target.marketId.trim() === "") throw new Error("Total-line history target requires a marketId");
  if (target.assetId.trim() === "") throw new Error("Total-line history target requires an assetId");
  if (!Number.isSafeInteger(target.selectorCutoffTsMs) || target.selectorCutoffTsMs <= 0) {
    throw new RangeError("Total-line selector cutoff must be a positive safe-integer timestamp");
  }
}

/**
 * Builds the causal evidence query used by the historical main-total selector.
 * Probability and every coverage statistic are bounded by the same per-market
 * selector cutoff. Rows observed after that cutoff cannot affect the result.
 */
export function buildTotalLineHistoryEvidenceQuery(
  targets: readonly TotalLineHistoryTarget[]
): string {
  if (targets.length === 0) throw new Error("Total-line history evidence requires at least one target");
  for (const target of targets) validateTarget(target);
  const duplicateMarketIds = targets
    .map((target) => target.marketId)
    .filter((marketId, index, marketIds) => marketIds.indexOf(marketId) !== index);
  if (duplicateMarketIds.length > 0) {
    throw new Error(`Duplicate total-line history target: ${duplicateMarketIds[0]}`);
  }
  const valuesSql = targets
    .map((target) =>
      `(${sqlString(target.marketId)}, ${sqlString(target.assetId)}, ${target.selectorCutoffTsMs})`
    )
    .join(",\n");
  return `
    WITH targets(market_id, asset_id, selector_cutoff_ts_ms) AS (VALUES ${valuesSql})
    SELECT
      targets.market_id,
      targets.selector_cutoff_ts_ms,
      COUNT(history.event_id)
        FILTER (WHERE history.source_ts_ms <= targets.selector_cutoff_ts_ms) AS coverage_points,
      MIN(history.source_ts_ms)
        FILTER (WHERE history.source_ts_ms <= targets.selector_cutoff_ts_ms) AS coverage_first_point_ts_ms,
      MAX(history.source_ts_ms)
        FILTER (WHERE history.source_ts_ms <= targets.selector_cutoff_ts_ms) AS coverage_last_point_ts_ms,
      arg_max(history.price, history.source_ts_ms)
        FILTER (WHERE history.source_ts_ms <= targets.selector_cutoff_ts_ms) AS pre_kickoff_probability,
      MAX(history.source_ts_ms)
        FILTER (WHERE history.source_ts_ms <= targets.selector_cutoff_ts_ms) AS pre_kickoff_point_ts_ms
    FROM targets
    LEFT JOIN polymarket_history history ON history.asset_id = targets.asset_id
    GROUP BY targets.market_id, targets.selector_cutoff_ts_ms
    ORDER BY targets.market_id
  `;
}
