import type { CanonicalEvent } from "../../bus/events.js";
import { readJsonArray, readNdjson } from "../../replay/files.js";
import { capturedFrameToEnvelope, type IngestEnvelope } from "../sse.js";
import { normalizeTxLineEnvelope } from "./normalizer.js";

type CapturedFrame = {
  receivedAt: string;
  stream: "odds" | "scores";
  rawFrame: string;
};

export async function* replayCapturedTxLineFrames(path: string): AsyncGenerator<CanonicalEvent> {
  for await (const frame of readNdjson<CapturedFrame>(path)) {
    const envelope = capturedFrameToEnvelope(frame);
    if (envelope === null) continue;
    yield* normalizeTxLineEnvelope(envelope);
  }
}

export async function* replayHistoricalTxLineArray(
  path: string,
  stream: "odds" | "scores"
): AsyncGenerator<CanonicalEvent> {
  for await (const row of readJsonArray<Record<string, unknown>>(path)) {
    const ts = typeof row.Ts === "number" ? row.Ts : 0;
    const observedTsMs = ts < 1_000_000_000_000 ? ts * 1_000 : ts;
    const envelope: IngestEnvelope = {
      stream,
      observedTsMs,
      message: { id: null, event: null, data: JSON.stringify(row), retryMs: null }
    };
    yield* normalizeTxLineEnvelope(envelope);
  }
}
