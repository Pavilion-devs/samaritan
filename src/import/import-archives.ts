import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

type AssetRow = {
  assetId: string;
  fixtureId: string;
  marketKey: string;
  family: "match_result" | "total_goals";
  period: string;
  lineMilli: number | null;
  conditionId: string;
  outcome: string;
  tokenRole: string;
  mappingStatus: string;
  tradeable: boolean;
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback);
}

function numberArgument(name: string): number | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) return null;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function elapsed(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1_000).toFixed(1)}s`;
}

const databasePath = argument("db", "data/research/samaritan-research-v1.duckdb");
const assetsPath = argument("assets", "data/research/mappings/world-cup-assets.ndjson");
const txlineGlob = argument("txline-glob", "samples/odds-historical/mainnet/*/*.json");
const historiesDir = argument(
  "histories-dir",
  "samples/polymarket-history/world-cup-2026-v1/histories"
);
const historyLimit = numberArgument("history-limit");
const manifestPath = `${databasePath}.manifest.json`;

if (existsSync(databasePath)) {
  throw new Error(`Refusing to replace existing research database: ${databasePath}`);
}

const assetRows = (await readFile(assetsPath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as AssetRow);
const historyPaths = assetRows
  .map((asset) => join(historiesDir, `${asset.assetId}.json`))
  .slice(0, historyLimit ?? assetRows.length);
const missingHistories = historyPaths.filter((path) => !existsSync(path));
if (missingHistories.length > 0) {
  throw new Error(`Mapped history files are missing (${missingHistories.length}); first: ${missingHistories[0]}`);
}

await mkdir(dirname(databasePath), { recursive: true });
const startedAt = Date.now();
const instance = await DuckDBInstance.create(databasePath, {
  threads: String(Math.max(2, Math.min(8, Number(process.env.SAMARITAN_IMPORT_THREADS ?? 6)))),
  memory_limit: process.env.SAMARITAN_IMPORT_MEMORY_LIMIT ?? "8GB",
  temp_directory: `${databasePath}.tmp`
});
const connection = await instance.connect();

try {
  console.log(`[archive-import] loading mapping assets (${assetRows.length})`);
  await connection.run(
    `CREATE TABLE mapping_assets AS
     SELECT * FROM read_json_auto($assetsPath, format = 'newline_delimited')`,
    { assetsPath }
  );

  console.log(`[archive-import] importing normalized TXLine quotes from ${txlineGlob}`);
  await connection.run(
    `CREATE TABLE txline_quote_outcomes AS
     WITH raw AS (
       SELECT *
       FROM read_json(
         $txlineGlob,
         format = 'array',
         columns = {
           FixtureId: 'UBIGINT', MessageId: 'VARCHAR', Ts: 'UBIGINT',
           Bookmaker: 'VARCHAR', BookmakerId: 'INTEGER', SuperOddsType: 'VARCHAR',
           GameState: 'VARCHAR', InRunning: 'BOOLEAN', MarketParameters: 'VARCHAR',
           MarketPeriod: 'VARCHAR', PriceNames: 'VARCHAR[]', Prices: 'INTEGER[]', Pct: 'VARCHAR[]'
         }
       )
       WHERE SuperOddsType IN ('1X2_PARTICIPANT_RESULT', 'OVERUNDER_PARTICIPANT_GOALS')
     ), normalized AS (
       SELECT
         FixtureId::VARCHAR AS fixture_id,
         MessageId,
         Ts::BIGINT AS source_ts_ms,
         SuperOddsType,
         CASE
           WHEN MarketPeriod IS NULL OR MarketPeriod = '' THEN 'full_time'
           WHEN MarketPeriod = 'half=1' THEN 'first_half'
           WHEN MarketPeriod = 'et' THEN 'extra_time'
           ELSE 'other'
         END AS period,
         CASE
           WHEN SuperOddsType = 'OVERUNDER_PARTICIPANT_GOALS'
           THEN CAST(ROUND(CAST(regexp_extract(MarketParameters, 'line=(-?[0-9]+(?:\\.[0-9]+)?)', 1) AS DOUBLE) * 1000) AS INTEGER)
           ELSE NULL
         END AS line_milli,
         Prices,
         Pct
       FROM raw
       WHERE
         (SuperOddsType = '1X2_PARTICIPANT_RESULT' AND len(Prices) = 3 AND len(Pct) = 3)
         OR
         (SuperOddsType = 'OVERUNDER_PARTICIPANT_GOALS' AND len(Prices) = 2 AND len(Pct) = 2
          AND regexp_matches(MarketParameters, '^line=-?[0-9]+(?:\\.[0-9]+)?$'))
     ), expanded AS (
       SELECT normalized.*, index
       FROM normalized
       CROSS JOIN UNNEST(range(1, len(Prices) + 1)) AS outcome_index(index)
     )
     SELECT DISTINCT
       'txline:odds:' || MessageId AS event_id,
       fixture_id,
       source_ts_ms,
       fixture_id || ':' ||
         CASE WHEN SuperOddsType = '1X2_PARTICIPANT_RESULT' THEN 'match_result' ELSE 'total_goals' END || ':' ||
         period || ':' || COALESCE(line_milli::VARCHAR, 'none') AS market_key,
       CASE
         WHEN SuperOddsType = '1X2_PARTICIPANT_RESULT' AND index = 1 THEN 'home'
         WHEN SuperOddsType = '1X2_PARTICIPANT_RESULT' AND index = 2 THEN 'draw'
         WHEN SuperOddsType = '1X2_PARTICIPANT_RESULT' AND index = 3 THEN 'away'
         WHEN SuperOddsType = 'OVERUNDER_PARTICIPANT_GOALS' AND index = 1 THEN 'over'
         ELSE 'under'
       END AS outcome,
       Prices[index]::INTEGER AS odds_x1000,
       CASE WHEN Pct[index] = 'NA' THEN NULL ELSE CAST(Pct[index] AS DOUBLE) / 100 END AS probability
     FROM expanded`
    , { txlineGlob }
  );
  console.log(`[archive-import] TXLine complete (${elapsed(startedAt)})`);

  console.log("[archive-import] retaining TXLine source metadata for canonical replay");
  await connection.run(
    `CREATE TABLE txline_quote_metadata AS
     SELECT DISTINCT
       'txline:odds:' || MessageId AS event_id,
       Bookmaker::VARCHAR AS bookmaker,
       BookmakerId::INTEGER AS bookmaker_id,
       InRunning::BOOLEAN AS in_running,
       GameState::VARCHAR AS game_state
     FROM read_json(
       $txlineGlob,
       format = 'array',
       columns = {
         MessageId: 'VARCHAR', Bookmaker: 'VARCHAR', BookmakerId: 'INTEGER',
         SuperOddsType: 'VARCHAR', GameState: 'VARCHAR', InRunning: 'BOOLEAN'
       }
     )
     WHERE SuperOddsType IN ('1X2_PARTICIPANT_RESULT', 'OVERUNDER_PARTICIPANT_GOALS')`,
    { txlineGlob }
  );
  await connection.run(
    `CREATE UNIQUE INDEX txline_metadata_event_lookup ON txline_quote_metadata (event_id)`
  );

  const historyList = `[${historyPaths.map(sqlString).join(",")}]`;
  console.log(`[archive-import] importing mapped Polymarket histories (${historyPaths.length} files)`);
  await connection.run(
    `CREATE TABLE polymarket_history AS
     WITH histories AS (
       SELECT
         regexp_extract(filename, '/([0-9]+)\\.json$', 1) AS asset_id,
         UNNEST(history) AS point
       FROM read_json(
         ${historyList},
         filename = true,
         columns = {history: 'STRUCT(t UBIGINT, p DOUBLE)[]'}
       )
     )
     SELECT
       'polymarket:price:' || sha256('history:' || histories.asset_id || ':' || histories.point.t::VARCHAR) AS event_id,
       mapping_assets.fixtureId::VARCHAR AS fixture_id,
       mapping_assets.marketKey::VARCHAR AS market_key,
       histories.point.t::BIGINT * 1000 AS source_ts_ms,
       histories.asset_id,
       mapping_assets.conditionId::VARCHAR AS condition_id,
       mapping_assets.outcome::VARCHAR AS outcome,
       mapping_assets.tokenRole::VARCHAR AS token_role,
       mapping_assets.mappingStatus::VARCHAR AS mapping_status,
       histories.point.p::DOUBLE AS price,
       'sampled_history'::VARCHAR AS observation
     FROM histories
     INNER JOIN mapping_assets ON mapping_assets.assetId = histories.asset_id`
  );
  console.log(`[archive-import] Polymarket complete (${elapsed(startedAt)})`);

  await connection.run(`CREATE INDEX txline_series_lookup ON txline_quote_outcomes (fixture_id, market_key, source_ts_ms)`);
  await connection.run(`CREATE INDEX polymarket_series_lookup ON polymarket_history (fixture_id, market_key, source_ts_ms)`);

  const summary = await connection.runAndReadAll(`
    SELECT 'txline_quote_outcomes' AS table_name, COUNT(*) AS rows,
           COUNT(DISTINCT fixture_id) AS fixtures, MIN(source_ts_ms) AS first_ts_ms, MAX(source_ts_ms) AS last_ts_ms
    FROM txline_quote_outcomes
    UNION ALL
    SELECT 'txline_quote_metadata', COUNT(*), NULL, NULL, NULL
    FROM txline_quote_metadata
    UNION ALL
    SELECT 'polymarket_history', COUNT(*), COUNT(DISTINCT fixture_id), MIN(source_ts_ms), MAX(source_ts_ms)
    FROM polymarket_history
  `);
  const tables = summary.getRowObjectsJson();
  const manifest = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - startedAt) / 1_000,
    databasePath,
    databaseFile: basename(databasePath),
    inputs: { assetsPath, txlineGlob, historiesDir, mappedHistoryFiles: historyPaths.length },
    invariants: {
      mappingStatus: "candidate",
      tradeable: false,
      polymarketHistoryIsExecutableBookData: false,
      txlinePctScaleDivisor: 100
    },
    tables
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  await writeFile(
    `${databasePath}.failed.json`,
    `${JSON.stringify({ failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`
  );
  throw error;
} finally {
  connection.closeSync();
  instance.closeSync();
}
