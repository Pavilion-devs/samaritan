import type { CanonicalEvent } from "../bus/events.js";
import {
  FeatureEngine,
  type FeatureEngineConfig,
  type FeatureSnapshot
} from "../features/engine.js";
import { mergeReplaySources } from "../replay/merge.js";
import {
  DuckDbResearchArchive,
  type ResearchReplayQuery
} from "../replay/research-archive.js";

export type ResearchFeatureExtractionOptions = {
  archivePath: string;
  query: ResearchReplayQuery;
  featureConfig: FeatureEngineConfig;
  signal?: AbortSignal;
  onEvent?: (event: CanonicalEvent) => void | Promise<void>;
  onSnapshot?: (snapshot: FeatureSnapshot) => void | Promise<void>;
};

export type ResearchFeatureExtractionSummary = {
  events: number;
  snapshots: number;
  txlineEvents: number;
  polymarketEvents: number;
  firstSourceTsMs: number | null;
  lastSourceTsMs: number | null;
};

export async function extractResearchFeatures(
  options: ResearchFeatureExtractionOptions
): Promise<ResearchFeatureExtractionSummary> {
  const archive = await DuckDbResearchArchive.open(options.archivePath);
  const engine = new FeatureEngine(options.featureConfig);
  let events = 0;
  let snapshots = 0;
  let txlineEvents = 0;
  let polymarketEvents = 0;
  let firstSourceTsMs: number | null = null;
  let lastSourceTsMs: number | null = null;
  try {
    for await (const event of mergeReplaySources(archive.sources(options.query), {
      speed: Number.POSITIVE_INFINITY,
      ...(options.signal ? { signal: options.signal } : {})
    })) {
      events += 1;
      if (event.source === "txline") txlineEvents += 1;
      else polymarketEvents += 1;
      firstSourceTsMs ??= event.sourceTsMs;
      lastSourceTsMs = event.sourceTsMs;
      await options.onEvent?.(event);
      for (const snapshot of engine.ingest(event)) {
        snapshots += 1;
        await options.onSnapshot?.(snapshot);
      }
    }
  } finally {
    archive.close();
  }
  return {
    events,
    snapshots,
    txlineEvents,
    polymarketEvents,
    firstSourceTsMs,
    lastSourceTsMs
  };
}
