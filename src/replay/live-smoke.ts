import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CanonicalEventBus } from "../bus/event-bus.js";
import { livePolymarketEvents } from "../ingest/polymarket/live.js";
import { GammaMappingRefresher } from "../ingest/polymarket/gamma-discovery.js";
import { liveTxLineEvents } from "../ingest/txline/live.js";
import { TxLineSessionManager } from "../ingest/txline/session.js";
import { MappingRegistry, type MappingRecord } from "../mapping/registry.js";
import { AppendOnlyJournal } from "../store/journal.js";
import { TimeSeriesStore } from "../store/time-series.js";

function stringArgument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function numberArgument(name: string, fallback: number): number {
  const parsed = Number(stringArgument(name, String(fallback)));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be positive`);
  return parsed;
}

const fixtureId = stringArgument("fixture-id", "18218149");
const durationSeconds = numberArgument("duration-seconds", 20);
const mappingPath = resolve(
  stringArgument("mappings", "data/research/mappings/world-cup-candidates.json")
);
const tokenPath = resolve(stringArgument("token", "phase0/.tokens/mainnet.json"));
const mappingFile = JSON.parse(await readFile(mappingPath, "utf8")) as { records: MappingRecord[] };
const refresher = new GammaMappingRefresher({ baseMappingPath: mappingPath });
const refreshFixtureMappings = async (): Promise<MappingRegistry> => {
  const globalRegistry = await refresher.refresh();
  const fixtureRecords = globalRegistry.records().filter((record) => record.txlineFixtureId === fixtureId);
  if (fixtureRecords.length === 0) throw new Error(`No candidate mappings for fixture ${fixtureId}`);
  return new MappingRegistry(fixtureRecords);
};
const baseRecords = mappingFile.records.filter((record) => record.txlineFixtureId === fixtureId);
if (baseRecords.length === 0) throw new Error(`No base candidate mappings for fixture ${fixtureId}`);
const registry = await refreshFixtureMappings();
const session = await TxLineSessionManager.fromTokenFile(tokenPath);
const controller = new AbortController();
const stopTimer = setTimeout(() => controller.abort(), durationSeconds * 1_000);
const journal = new AppendOnlyJournal(":memory:");
const timeSeries = await TimeSeriesStore.create();
const bus = new CanonicalEventBus();
const counts: Record<string, number> = {};

bus.subscribe((event) => {
  const key = `${event.source}:${event.kind}`;
  counts[key] = (counts[key] ?? 0) + 1;
  journal.append(event);
});
bus.subscribe((event) => timeSeries.append(event));

try {
  await Promise.all([
    bus.consume(
      liveTxLineEvents({
        network: "mainnet",
        stream: "odds",
        fixtureId,
        session,
        signal: controller.signal
      })
    ),
    bus.consume(
      liveTxLineEvents({
        network: "mainnet",
        stream: "scores",
        fixtureId,
        session,
        signal: controller.signal
      })
    ),
    bus.consume(
      livePolymarketEvents({
        registry,
        signal: controller.signal,
        refreshMappings: refreshFixtureMappings
      })
    )
  ]);
  const chain = journal.verifyChain();
  const result = {
    fixtureId,
    durationSeconds,
    mappedAssets: registry.assetIds().length,
    counts,
    stored: await timeSeries.count(),
    journalRows: chain.rows,
    hashChainValid: chain.valid,
    hasTxLineOdds: (counts["txline:odds.quote"] ?? 0) > 0,
    hasPolymarketBook: (counts["polymarket:polymarket.book"] ?? 0) > 0
  };
  if (!result.hasTxLineOdds || !result.hasPolymarketBook || result.stored !== result.journalRows) {
    throw new Error(`Live smoke invariant failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(stopTimer);
  controller.abort();
  journal.close();
  timeSeries.close();
}
