import { describe, expect, it } from "vitest";
import { CanonicalEventBus } from "../src/bus/event-bus.js";
import { CANONICAL_SCHEMA_VERSION, type OddsQuoteEvent } from "../src/bus/events.js";
import { probability } from "../src/domain/probability.js";
import { AppendOnlyJournal } from "../src/store/journal.js";
import { TimeSeriesStore } from "../src/store/time-series.js";

function quote(observedTsMs = 2000, eventId = "txline:odds:message-1"): OddsQuoteEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "odds.quote",
    eventId,
    source: "txline",
    sourceTsMs: 1000,
    observedTsMs,
    fixtureId: "fixture-1",
    sourceMessageId: "message-1",
    bookmaker: "TXLineStablePriceDemargined",
    bookmakerId: 10021,
    inRunning: false,
    gameState: null,
    market: {
      family: "match_result",
      period: "full_time",
      lineMilli: null,
      key: "fixture-1:match_result:full_time:none"
    },
    outcomes: [
      { outcome: "home", oddsX1000: 2000, fairProbability: probability(0.5) },
      { outcome: "draw", oddsX1000: 4000, fairProbability: probability(0.25) },
      { outcome: "away", oddsX1000: 4000, fairProbability: probability(0.25) }
    ]
  };
}

describe("canonical bus and append-only stores", () => {
  it("deduplicates reconnect delivery while preserving a valid hash chain", async () => {
    const journal = new AppendOnlyJournal(":memory:");
    const store = await TimeSeriesStore.create();
    const bus = new CanonicalEventBus();
    bus.subscribe((event) => {
      journal.append(event, 3000);
    });
    bus.subscribe((event) => store.append(event));

    await bus.publish(quote());
    await bus.publish(quote(5000));

    expect(journal.count()).toBe(1);
    expect(journal.verifyChain()).toMatchObject({ valid: true, rows: 1 });
    expect(await store.count()).toBe(1);
    expect(await store.count("quote_outcomes")).toBe(3);
    journal.close();
    store.close();
  });

  it("rejects reuse of an event ID for different immutable content", () => {
    const journal = new AppendOnlyJournal(":memory:");
    journal.append(quote());
    const collision = { ...quote(), sourceTsMs: 1001 };
    expect(() => journal.append(collision)).toThrow(/collision/);
    journal.close();
  });

  it("hash-chains raw ingress independently", () => {
    const journal = new AppendOnlyJournal(":memory:");
    const first = journal.appendRaw({
      ingressId: "raw-1",
      source: "txline",
      stream: "odds",
      observedTsMs: 1000,
      rawPayload: "payload"
    });
    const duplicate = journal.appendRaw({
      ingressId: "raw-1",
      source: "txline",
      stream: "odds",
      observedTsMs: 2000,
      rawPayload: "payload"
    });
    expect(first.appended).toBe(true);
    expect(duplicate.appended).toBe(false);
    expect(() =>
      journal.appendRaw({
        ingressId: "raw-1",
        source: "txline",
        stream: "odds",
        observedTsMs: 3000,
        rawPayload: "different"
      })
    ).toThrow(/collision/);
    journal.close();
  });

  it("serializes concurrent publishers for transactional sinks", async () => {
    const bus = new CanonicalEventBus();
    const delivered: string[] = [];
    bus.subscribe(async (event) => {
      if (event.eventId.endsWith("first")) await new Promise((resolve) => setTimeout(resolve, 5));
      delivered.push(event.eventId);
    });
    await Promise.all([
      bus.publish(quote(2000, "txline:odds:first")),
      bus.publish(quote(2001, "txline:odds:second"))
    ]);
    expect(delivered).toEqual(["txline:odds:first", "txline:odds:second"]);
  });
});
