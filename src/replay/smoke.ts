import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CanonicalEventBus } from "../bus/event-bus.js";
import { replayPolymarketHistory } from "../ingest/polymarket/replay.js";
import { replayCapturedTxLineFrames } from "../ingest/txline/replay.js";
import { MappingRegistry, type MappingRecord } from "../mapping/registry.js";
import { AppendOnlyJournal } from "../store/journal.js";
import { TimeSeriesStore } from "../store/time-series.js";

const path = resolve(
  process.cwd(),
  "samples/odds-sse/mainnet/mainnet-france-morocco-2026-07-09/odds.frames.ndjson"
);
const journal = new AppendOnlyJournal(":memory:");
const timeSeries = await TimeSeriesStore.create();
const bus = new CanonicalEventBus();
let hasModeField = false;
let quotes = 0;
let polymarketPrices = 0;

bus.subscribe((event) => {
  hasModeField ||= "mode" in event;
  if (event.kind === "odds.quote") quotes += 1;
  if (event.kind === "polymarket.price") polymarketPrices += 1;
  journal.append(event);
});
bus.subscribe((event) => timeSeries.append(event));

let deliveredTxLine = 0;
for await (const event of replayCapturedTxLineFrames(path)) {
  await bus.publish(event);
  deliveredTxLine += 1;
  if (deliveredTxLine >= 250) break;
}

const mappingFile = JSON.parse(
  await readFile(resolve(process.cwd(), "data/research/mappings/world-cup-candidates.json"), "utf8")
) as { records: MappingRecord[] };
const registry = new MappingRegistry(
  mappingFile.records.filter((record) => record.txlineFixtureId === "18218149")
);
const assetId = registry
  .assetIds()
  .find((candidate) => registry.resolveAsset(candidate).tokenRole === "canonical");
if (!assetId) throw new Error("Spain–Belgium registry has no canonical asset");
const historyPath = join(
  process.cwd(),
  "samples/polymarket-history/world-cup-2026-v1/histories",
  `${assetId}.json`
);
let deliveredPolymarket = 0;
for await (const event of replayPolymarketHistory(historyPath, assetId, registry)) {
  await bus.publish(event);
  deliveredPolymarket += 1;
  if (deliveredPolymarket >= 250) break;
}

const chain = journal.verifyChain();
const stored = await timeSeries.count();
if (quotes === 0 || polymarketPrices === 0 || hasModeField || stored !== chain.rows) {
  throw new Error(
    `Replay smoke invariant failed: ${JSON.stringify({ quotes, polymarketPrices, hasModeField, stored, chain })}`
  );
}

console.log(
  JSON.stringify(
    {
      deliveredTxLine,
      deliveredPolymarket,
      quotes,
      polymarketPrices,
      stored,
      hashChainValid: chain.valid,
      hasModeField
    },
    null,
    2
  )
);
journal.close();
timeSeries.close();
