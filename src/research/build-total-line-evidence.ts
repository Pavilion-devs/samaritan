import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { marketKey } from "../bus/events.js";
import { probability } from "../domain/probability.js";
import { MappingRegistry } from "../mapping/registry.js";
import { PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS } from "../config/paper-study.js";
import type { TotalLineEvidence } from "./main-total-selector.js";
import { buildTotalLineHistoryEvidenceQuery } from "./total-line-evidence-query.js";

type CandidateFile = { records?: unknown[] };
type Target = {
  fixtureId: string;
  marketId: string;
  marketKey: string;
  lineMilli: number;
  mappingStatus: "candidate" | "verified" | "rejected";
  txlineMarketObserved: boolean;
  overAssetId: string;
  selectorCutoffTsMs: number;
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback);
}

const databasePath = argument("db", "data/research/samaritan-research-v1.duckdb");
const candidatesPath = argument("candidates", "data/research/mappings/world-cup-candidates.json");
const outputPath = argument("output", "data/research/main-total-line-evidence-causal-v2.json");
if (existsSync(outputPath)) {
  throw new Error(`Refusing to replace existing total-line evidence: ${outputPath}`);
}
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
      selectorCutoffTsMs:
        record.kickoff.txlineTsMs - PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS
    });
  }
}

const instance = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
const connection = await instance.connect();
let historyRows: Record<string, unknown>[];
try {
  const result = await connection.runAndReadAll(buildTotalLineHistoryEvidenceQuery(
    targets.map((target) => ({
      marketId: target.marketId,
      assetId: target.overAssetId,
      selectorCutoffTsMs: target.selectorCutoffTsMs
    }))
  ));
  historyRows = result.getRowObjectsJson() as Record<string, unknown>[];
} finally {
  connection.closeSync();
  instance.closeSync();
}
const history = new Map(historyRows.map((row) => [String(row["market_id"]), row]));
const evidence: TotalLineEvidence[] = targets.map((target) => {
  const historyRow = history.get(target.marketId);
  const priceValue = historyRow?.["pre_kickoff_probability"];
  return {
    fixtureId: target.fixtureId,
    marketId: target.marketId,
    marketKey: target.marketKey,
    lineMilli: target.lineMilli,
    mappingStatus: target.mappingStatus,
    txlineMarketObserved: target.txlineMarketObserved,
    selectorCutoffTsMs: target.selectorCutoffTsMs,
    preKickoffOverProbability:
      priceValue === null || priceValue === undefined ? null : probability(Number(priceValue)),
    preKickoffPointTsMs:
      historyRow?.["pre_kickoff_point_ts_ms"] === null ||
      historyRow?.["pre_kickoff_point_ts_ms"] === undefined
        ? null
        : Number(historyRow["pre_kickoff_point_ts_ms"]),
    coverageFirstPointTsMs:
      historyRow?.["coverage_first_point_ts_ms"] === null ||
      historyRow?.["coverage_first_point_ts_ms"] === undefined
        ? null
        : Number(historyRow["coverage_first_point_ts_ms"]),
    coverageLastPointTsMs:
      historyRow?.["coverage_last_point_ts_ms"] === null ||
      historyRow?.["coverage_last_point_ts_ms"] === undefined
        ? null
        : Number(historyRow["coverage_last_point_ts_ms"]),
    // The captured Gamma volume/liquidity snapshot is post-close and has no
    // historical timestamp. It is deliberately excluded from causal evidence.
    volume: 0,
    liquidity: 0,
    coveragePoints: Number(historyRow?.["coverage_points"] ?? 0)
  };
});

const payload = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  status: "research_evidence_only",
  selectionRuleFrozen: false,
  selectorEvidence: {
    asOfBeforeKickoffMs: PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS,
    kickoffBasis: "txline_kickoff_ts_ms",
    probabilityRule: "source_ts_ms_lte_selector_cutoff",
    coverageRule: "source_ts_ms_lte_selector_cutoff",
    volumeAndLiquidity: "unavailable_zeroed_no_timestamped_as_of_evidence"
  },
  sourcePaths: { databasePath, candidatesPath },
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
