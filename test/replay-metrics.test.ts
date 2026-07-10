import { describe, expect, it } from "vitest";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type EventSource
} from "../src/bus/events.js";
import {
  brierScore,
  ClassificationMetrics,
  closingLineValue
} from "../src/metrics/classification.js";
import { mergeReplaySources, type ReplayClock } from "../src/replay/merge.js";

function event(source: EventSource, sourceTsMs: number, suffix: string): CanonicalEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "feed.heartbeat",
    eventId: `${source}-${suffix}`,
    source,
    sourceTsMs,
    observedTsMs: sourceTsMs + 5,
    fixtureId: null,
    status: "healthy",
    stream: "test",
    detail: null
  };
}

async function* source(events: CanonicalEvent[]): AsyncGenerator<CanonicalEvent> {
  yield* events;
}

describe("timestamp-merged replay", () => {
  it("merges sorted sources deterministically without exposing a mode", async () => {
    const merged: CanonicalEvent[] = [];
    for await (const item of mergeReplaySources(
      [
        source([event("txline", 1_000, "a"), event("txline", 3_000, "c")]),
        source([event("polymarket", 2_000, "b"), event("polymarket", 3_000, "d")])
      ],
      { speed: Number.POSITIVE_INFINITY }
    )) {
      merged.push(item);
    }
    expect(merged.map((item) => item.eventId)).toEqual([
      "txline-a",
      "polymarket-b",
      "polymarket-d",
      "txline-c"
    ]);
    expect(merged.every((item) => !("mode" in item))).toBe(true);
  });

  it("paces finite-speed replay through an injectable clock", async () => {
    let nowMs = 0;
    const sleeps: number[] = [];
    const clock: ReplayClock = {
      nowMs: () => nowMs,
      sleep: async (ms) => {
        sleeps.push(ms);
        nowMs += ms;
      }
    };
    for await (const _item of mergeReplaySources(
      [source([event("txline", 1_000, "a"), event("txline", 2_000, "b"), event("txline", 3_000, "c")])],
      { speed: 2, clock }
    )) {
      // Drain the replay.
    }
    expect(sleeps).toEqual([0, 500, 500]);
  });

  it("fails closed when an input source moves backward in time", async () => {
    const consume = async () => {
      for await (const _item of mergeReplaySources(
        [source([event("txline", 2_000, "a"), event("txline", 1_000, "b")])],
        { speed: Number.POSITIVE_INFINITY }
      )) {
        // Drain the replay.
      }
    };
    await expect(consume()).rejects.toThrow(/moved backward/);
  });
});

describe("detector metrics primitives", () => {
  it("reports the complete confusion matrix", () => {
    const metrics = new ClassificationMetrics();
    metrics.record({ detector: "XMARKET", predicted: true, actual: true });
    metrics.record({ detector: "XMARKET", predicted: true, actual: false });
    metrics.record({ detector: "XMARKET", predicted: false, actual: true });
    metrics.record({ detector: "XMARKET", predicted: false, actual: false });
    expect(metrics.summaries()[0]).toEqual({
      detector: "XMARKET",
      cases: 4,
      truePositive: 1,
      falsePositive: 1,
      trueNegative: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
      falsePositiveRate: 0.5
    });
  });

  it("computes Brier and probability-space CLV", () => {
    expect(brierScore(0.7, true)).toBeCloseTo(0.09);
    expect(closingLineValue(0.55, 0.6)).toBeCloseTo(0.05);
    expect(() => brierScore(1.1, true)).toThrow(/between 0 and 1/);
  });
});
