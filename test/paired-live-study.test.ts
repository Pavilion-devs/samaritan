import { describe, expect, it } from "vitest";
import {
  MillisecondLatencyHistogram,
  summarizeFeedOutages
} from "../src/research/paired-live-study.js";

describe("paired live-lane metrics", () => {
  it("summarizes bounded latency distributions without retaining observations", () => {
    const histogram = new MillisecondLatencyHistogram(-10, 10);
    for (const value of [-20, -5, 0, 5, 20]) histogram.add(value);
    expect(histogram.summary()).toEqual({
      count: 5,
      minimumMs: -20,
      maximumMs: 20,
      meanMs: 0,
      p50Ms: 0,
      p90Ms: 20,
      p99Ms: 20,
      histogramResolutionMs: 1,
      belowHistogramRange: 1,
      aboveHistogramRange: 1
    });
  });

  it("pairs abnormal disconnects with successful resubscriptions and ignores the clean deadline close", () => {
    const summary = summarizeFeedOutages([
      { at: "2026-07-10T20:00:00.000Z", action: "disconnect", connectionIndex: 1, code: 1006 },
      { at: "2026-07-10T20:00:02.500Z", action: "open-and-resubscribe", connectionIndex: 2 },
      { at: "2026-07-11T00:00:00.000Z", action: "disconnect", connectionIndex: 2, code: 1000, clean: true }
    ]);
    expect(summary).toEqual({
      outages: [{
        connectionIndex: 1,
        startedAt: "2026-07-10T20:00:00.000Z",
        endedAt: "2026-07-10T20:00:02.500Z",
        durationMs: 2_500,
        closeCode: 1006
      }],
      totalDowntimeMs: 2_500,
      maximumDowntimeMs: 2_500,
      unresolvedOutages: 0
    });
  });
});
