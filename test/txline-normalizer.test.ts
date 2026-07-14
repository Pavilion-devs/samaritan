import { describe, expect, it } from "vitest";
import { normalizeTxLineEnvelope } from "../src/ingest/txline/normalizer.js";
import { capturedFrameToEnvelope, parseSseBlock } from "../src/ingest/sse.js";

// Deliberately invented TXLine-shaped values. Never paste captured feed rows into tests.
const receivedAt = "2030-01-01T00:00:01.000Z";
const odds = {
  FixtureId: 90_000_001,
  MessageId: "synthetic-odds-1",
  Ts: Date.parse("2030-01-01T00:00:00.000Z"),
  Bookmaker: "SyntheticDemarginedBook",
  BookmakerId: 90_001,
  SuperOddsType: "1X2_PARTICIPANT_RESULT",
  GameState: null,
  InRunning: false,
  MarketParameters: null,
  MarketPeriod: null,
  PriceNames: ["part1", "draw", "part2"],
  Prices: [2_000, 4_000, 4_000],
  Pct: ["50.000", "25.000", "25.000"]
};

function envelope(data: unknown, stream = "odds") {
  return {
    stream,
    observedTsMs: Date.parse(receivedAt),
    message: { id: "synthetic-sse-1", event: null, data: JSON.stringify(data), retryMs: null }
  };
}

describe("TXLine normalization", () => {
  it("converts synthetic TXLine-shaped Pct from 0-100 strings into 0-1 probability", () => {
    const [event] = normalizeTxLineEnvelope(envelope(odds));
    expect(event?.kind).toBe("odds.quote");
    if (event?.kind !== "odds.quote") throw new Error("expected quote");
    expect(event.market).toEqual({
      family: "match_result",
      period: "full_time",
      lineMilli: null,
      key: "90000001:match_result:full_time:none"
    });
    expect(event.outcomes.map((outcome) => outcome.fairProbability)).toEqual([
      0.5, 0.25, 0.25
    ]);
    expect(event.outcomes.map((outcome) => outcome.oddsX1000)).toEqual([2_000, 4_000, 4_000]);
  });

  it("retains the exact totals line and missing fair probabilities", () => {
    const total = {
      ...odds,
      MessageId: "total-1",
      SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
      MarketParameters: "line=2.5",
      PriceNames: ["over", "under"],
      Prices: [2_000, 2_000],
      Pct: ["NA", "NA"]
    };
    const [event] = normalizeTxLineEnvelope(envelope(total));
    if (event?.kind !== "odds.quote") throw new Error("expected quote");
    expect(event.market.lineMilli).toBe(2500);
    expect(event.outcomes.map((outcome) => outcome.fairProbability)).toEqual([null, null]);
  });

  it("skips a mapped market row when both quote arrays are empty", () => {
    const suspended = {
      ...odds,
      MessageId: "total-empty",
      SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
      MarketParameters: "line=1.75",
      PriceNames: ["over", "under"],
      Prices: [],
      Pct: []
    };
    expect(normalizeTxLineEnvelope(envelope(suspended))).toEqual([]);

    expect(() => normalizeTxLineEnvelope(envelope({ ...suspended, Prices: [2000] }))).toThrow(
      /outcome array lengths disagree/
    );
  });

  it("uses the same normalizer for a synthetic replay-shaped frame and a live envelope", () => {
    const rawFrame = `data: ${JSON.stringify(odds)}\nid: synthetic-sse-1`;
    const replayEnvelope = capturedFrameToEnvelope({ receivedAt, stream: "odds", rawFrame });
    expect(replayEnvelope).not.toBeNull();
    const replay = normalizeTxLineEnvelope(replayEnvelope!);
    const live = normalizeTxLineEnvelope(envelope(odds));
    expect(replay).toEqual(live);
    expect("mode" in replay[0]!).toBe(false);
  });

  it("parses standard multiline SSE data and heartbeat seconds", () => {
    expect(parseSseBlock("data: one\ndata: two\nevent: custom\nid: abc")).toEqual({
      data: "one\ntwo",
      event: "custom",
      id: "abc",
      retryMs: null
    });
    const [heartbeat] = normalizeTxLineEnvelope({
      stream: "odds",
      observedTsMs: 1_893_456_790_000,
      message: { id: null, event: "heartbeat", data: '{"Ts":1893456789}', retryMs: null }
    });
    expect(heartbeat?.sourceTsMs).toBe(1_893_456_789_000);
  });
});
