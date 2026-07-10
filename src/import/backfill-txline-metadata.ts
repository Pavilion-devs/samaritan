import { resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback);
}

const databasePath = argument("db", "data/research/samaritan-research-v1.duckdb");
const txlineGlob = argument("txline-glob", "samples/odds-historical/mainnet/*/*.json");
const instance = await DuckDBInstance.create(databasePath, {
  threads: String(Math.max(2, Math.min(8, Number(process.env.SAMARITAN_IMPORT_THREADS ?? 6)))),
  memory_limit: process.env.SAMARITAN_IMPORT_MEMORY_LIMIT ?? "8GB"
});
const connection = await instance.connect();

try {
  const existing = await connection.runAndReadAll(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = 'main' AND table_name = 'txline_quote_metadata'`
  );
  const count = Number(existing.getRowObjectsJson()[0]?.["count"] ?? 0);
  if (count > 0) {
    console.log(`[metadata-backfill] already present in ${databasePath}`);
  } else {
    console.log(`[metadata-backfill] scanning ${txlineGlob}`);
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
    const result = await connection.runAndReadAll(
      `SELECT COUNT(*) AS rows,
              COUNT(DISTINCT event_id) AS event_ids,
              COUNT(DISTINCT bookmaker_id) AS bookmakers,
              COUNT(*) FILTER (WHERE in_running) AS in_running_rows
       FROM txline_quote_metadata`
    );
    console.log(JSON.stringify(result.getRowObjectsJson()[0], null, 2));
  }
} finally {
  connection.closeSync();
  instance.closeSync();
}
