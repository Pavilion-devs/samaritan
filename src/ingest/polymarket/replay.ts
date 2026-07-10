import type { CanonicalEvent } from "../../bus/events.js";
import { MappingRegistry } from "../../mapping/registry.js";
import { readNdjson, readNestedJsonArray } from "../../replay/files.js";
import {
  normalizeCapturedPolymarketMessage,
  normalizePolymarketHistoryPoint
} from "./normalizer.js";

type CapturedMessage = {
  receivedAt: string;
  rawPayload: string;
  parseError?: string | null;
};

export async function* replayCapturedPolymarketMessages(
  path: string,
  registry: MappingRegistry
): AsyncGenerator<CanonicalEvent> {
  for await (const message of readNdjson<CapturedMessage>(path)) {
    yield* normalizeCapturedPolymarketMessage(message, registry);
  }
}

export async function* replayPolymarketHistory(
  path: string,
  assetId: string,
  registry: MappingRegistry
): AsyncGenerator<CanonicalEvent> {
  for await (const point of readNestedJsonArray<{ t: number; p: number }>(path, "history")) {
    yield normalizePolymarketHistoryPoint(assetId, point, registry);
  }
}
