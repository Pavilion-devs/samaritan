import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { marketKey } from "../bus/events.js";
import { probability } from "../domain/probability.js";
import { MappingRegistry } from "../mapping/registry.js";
import { readJsonArray } from "../replay/files.js";
import type { TotalLineEvidence } from "./main-total-selector.js";

type CandidateFile = { records?: unknown[] };
type GammaMarket = {
  id?: string | number;
  volume?: string | number;
  volumeNum?: number;
  liquidity?: string | number;
  liquidityNum?: number;
};
type GammaEvent = { markets?: GammaMarket[] };
type Target = {
  fixtureId: string;
  marketId: string;
  marketKey: string;
  lineMilli: number;
  mappingStatus: "candidate" | "verified" | "rejected";
  txlineMarketObserved: boolean;
  overAssetId: string;
  cutoffTsMs: number;
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function finiteMetadata(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const databasePath = argument("db", "data/research/samaritan-research-v1.duckdb");
const candidatesPath = argument("candidates", "data/research/mappings/world-cup-candidates.json");
const eventsPath = argument(
  "events",
  "samples/polymarket-history/world-cup-2026-v1/world-cup-events.json"
);
const outputPath = argument("output", "data/research/main-total-line-evidence.json");
const candidateFile = JSON.parse(await readFile(candidatesPath, "utf8")) as CandidateFile;
const registry = new MappingRegistry(candidateFile.records ?? []);
const targets: Target[] = [];
const targetIds = new Set<string>();

for (const record of registry.records()) {
  for (const condition of record.conditions) {
    if (condition.family !== "total_goals" || condition.period !== "full_time" || condition.lineMilli === null) {
      continue;
    }
    const over = condition.tokens.find(
      (token) => token.role === "canonical" && token.outcome === "over"
    );
    if (!over) throw new Error(`Total market ${condition.polymarketMarketId} has no canonical Over token`);
    if (targetIds.has(condition.polymarketMarketId)) {
      throw new Error(`Duplicate total market target: ${condition.polymarketMarketId}`);
    }
    targetIds.add(condition.polymarketMarketId);
    targets.push({
      fixtureId: record.txlineFixtureId,
      marketId: condition.polymarketMarketId,
      marketKey: marketKey(
        record.txlineFixtureId,
        condition.family,
        condition.period,
        condition.lineMilli
      ),
      lineMilli: condition.lineMilli,
      mappingStatus: record.status,
      txlineMarketObserved: condition.evidence?.txlineMarketObserved === true,
      overAssetId: over.assetId,
      cutoffTsMs: record.kickoff.polymarketTsMs - 5 * 60_000
    });
  }
}

const metadata = new Map<string, { volume: number; liquidity: number }>();
for await (const event of readJsonArray<GammaEvent>(eventsPath)) {
  for (const market of event.markets ?? []) {
    const id = String(market.id ?? "");
    if (!targetIds.has(id) || metadata.has(id)) continue;
    metadata.set(id, {
      volume: finiteMetadata(market.volumeNum ?? market.volume),
      liquidity: finiteMetadata(market.liquidityNum ?? market.liquidity)
    });
  }
  if (metadata.size === targetIds.size) break;
}
const missingMetadata = targets.filter((target) => !metadata.has(target.marketId));
if (missingMetadata.length > 0) {
  throw new Error(
    `Gamma metadata missing for ${missingMetadata.length} total markets; first ${missingMetadata[0]!.marketId}`
  );
}

const valuesSql = targets
  .map(
    (target) =>
      `(${sqlString(target.marketId)}, ${sqlString(target.overAssetId)}, ${target.cutoffTsMs})`
  )
  .join(",\n");
const instance = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
const connection = await instance.connect();
let historyRows: Record<string, unknown>[];
try {
  const result = await connection.runAndReadAll(`
    WITH targets(market_id, asset_id, cutoff_ts_ms) AS (VALUES ${valuesSql})
    SELECT
      targets.market_id,
      COUNT(history.event_id) AS coverage_points,
      arg_max(history.price, history.source_ts_ms)
        FILTER (WHERE history.source_ts_ms <= targets.cutoff_ts_ms) AS pre_kickoff_probability,
      MAX(history.source_ts_ms)
        FILTER (WHERE history.source_ts_ms <= targets.cutoff_ts_ms) AS pre_kickoff_point_ts_ms
    FROM targets
    LEFT JOIN polymarket_history history ON history.asset_id = targets.asset_id
    GROUP BY targets.market_id
    ORDER BY targets.market_id
  `);
  historyRows = result.getRowObjectsJson() as Record<string, unknown>[];
} finally {
  connection.closeSync();
  instance.closeSync();
}
const history = new Map(historyRows.map((row) => [String(row["market_id"]), row]));
const evidence: TotalLineEvidence[] = targets.map((target) => {
  const marketMetadata = metadata.get(target.marketId)!;
  const historyRow = history.get(target.marketId);
  const priceValue = historyRow?.["pre_kickoff_probability"];
  return {
    fixtureId: target.fixtureId,
    marketId: target.marketId,
    marketKey: target.marketKey,
    lineMilli: target.lineMilli,
    mappingStatus: target.mappingStatus,
    txlineMarketObserved: target.txlineMarketObserved,
    preKickoffOverProbability:
      priceValue === null || priceValue === undefined ? null : probability(Number(priceValue)),
    preKickoffPointTsMs:
      historyRow?.["pre_kickoff_point_ts_ms"] === null ||
      historyRow?.["pre_kickoff_point_ts_ms"] === undefined
        ? null
        : Number(historyRow["pre_kickoff_point_ts_ms"]),
    volume: marketMetadata.volume,
    liquidity: marketMetadata.liquidity,
    coveragePoints: Number(historyRow?.["coverage_points"] ?? 0)
  };
});

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: "research_evidence_only",
  selectionRuleFrozen: false,
  preKickoffCutoffMinutes: 5,
  sourcePaths: { databasePath, candidatesPath, eventsPath },
  counts: {
    fixtures: new Set(evidence.map((row) => row.fixtureId)).size,
    lines: evidence.length,
    withPreKickoffProbability: evidence.filter((row) => row.preKickoffOverProbability !== null).length
  },
  evidence
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...payload.counts }, null, 2));
