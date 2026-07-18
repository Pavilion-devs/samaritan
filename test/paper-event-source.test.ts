import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type FeedEvent
} from "../src/bus/events.js";
import {
  capturedPaperReplaySource,
  capturedPaperReplaySnapshotSource,
  fanInLiveCanonicalSources
} from "../src/harness/paper-event-source.js";
import { stableJson } from "../src/domain/json.js";
import { createPersistentPaperLaneRuntime } from "../src/harness/paper-lane-runtime.js";
import type { PaperFixtureUniverse } from "../src/harness/paper-fixture-universe.js";
import { runPaperSession } from "../src/harness/paper-session.js";
import { initializePaperStudyLedger } from "../src/harness/paper-study-ledger.js";
import { MappingRegistry, sha256 } from "../src/mapping/registry.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function heartbeat(id: string, observedTsMs: number): FeedEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "feed.heartbeat",
    eventId: id,
    source: "txline",
    sourceTsMs: observedTsMs,
    observedTsMs,
    fixtureId: null,
    status: "healthy",
    stream: "test",
    detail: null
  };
}

async function* source(
  values: CanonicalEvent[],
  finalized: () => void
): AsyncGenerator<CanonicalEvent> {
  try {
    for (const value of values) {
      await Promise.resolve();
      yield value;
    }
  } finally {
    finalized();
  }
}

function registry(): MappingRegistry {
  const rulesText = "First 90 minutes plus stoppage time; extra time excluded.";
  return new MappingRegistry([{
    mappingId: "fixture-total",
    status: "candidate",
    txlineFixtureId: "18241006",
    teams: {
      home: { canonical: "England", aliases: ["ENG"] },
      away: { canonical: "Argentina", aliases: ["ARG"] }
    },
    kickoff: { txlineTsMs: 1_800_000_000_000, polymarketTsMs: 1_800_000_000_000 },
    polymarketEventId: "event-1",
    polymarketEventSlug: "fixture-more-markets",
    conditions: [{
      polymarketMarketId: "market-1",
      conditionId: "condition-1",
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      rulesText,
      rulesSha256: sha256(rulesText),
      tokens: [
        { assetId: "over-token", outcome: "over", role: "canonical" },
        { assetId: "under-token", outcome: "under", role: "canonical" }
      ]
    }]
  }]);
}

function emptyUniverse(): PaperFixtureUniverse {
  return {
    generatedAt: "2026-07-15T00:00:00.000Z",
    laneStartTsMs: 1_000,
    selectorConfig: {
      minimumCoveragePoints: 1_000,
      minimumVolume: 0,
      minimumLiquidity: 0,
      maximumDistanceFromEven: 0.15,
      weights: { balance: 1, volume: 0, liquidity: 0, coverage: 0 }
    },
    fixtures: [],
    summary: {
      fixtures: 0,
      pairedBookReplays: 0,
      executableBookReplays: 0,
      bookLifecycleReplays: 0,
      signalResearchOnly: 0,
      unavailable: 0,
      longRunEligible: 0
    }
  };
}

describe("paper event sources", () => {
  it("fans live sources into one arrival stream and closes every source on early return", async () => {
    let finalized = 0;
    const merged = fanInLiveCanonicalSources([
      source([heartbeat("one", 1)], () => { finalized += 1; }),
      source([heartbeat("two", 2)], () => { finalized += 1; })
    ]);
    const seen: string[] = [];
    for await (const event of merged) {
      seen.push(event.eventId);
      if (seen.length === 1) break;
    }

    expect(seen).toHaveLength(1);
    expect(finalized).toBe(2);
  });

  it("normalizes and merges captured TXLine + Polymarket files without a mode field", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-source-"));
    directories.push(directory);
    const oddsPath = join(directory, "odds.ndjson");
    const scoresPath = join(directory, "scores.ndjson");
    const polymarketPath = join(directory, "polymarket.ndjson");
    const receivedAt = "2026-07-15T16:00:00.100Z";
    const odds = {
      FixtureId: 18241006,
      MessageId: "odds-1",
      Ts: Date.parse("2026-07-15T16:00:00.000Z"),
      Bookmaker: "TXLineStablePriceDemargined",
      BookmakerId: 10021,
      SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
      GameState: null,
      InRunning: false,
      MarketParameters: "line=2.5",
      MarketPeriod: null,
      PriceNames: ["over", "under"],
      Prices: [2000, 2000],
      Pct: ["50.000", "50.000"]
    };
    const oddsFile = `${JSON.stringify({
      receivedAt,
      stream: "odds",
      rawFrame: `data: ${JSON.stringify(odds)}\nid: odds-1`
    })}\n`;
    const scoresFile = `${JSON.stringify({
      receivedAt: "2026-07-15T16:00:00.200Z",
      stream: "scores",
      rawFrame: `event: heartbeat\ndata: ${JSON.stringify({ Ts: 1_800_000_000 })}`
    })}\n`;
    const polymarketFile = `${JSON.stringify({
      receivedAt: "2026-07-15T16:00:00.300Z",
      rawPayload: JSON.stringify({
        market: "condition-1",
        asset_id: "over-token",
        timestamp: String(Date.parse("2026-07-15T16:00:00.050Z")),
        event_type: "book",
        bids: [{ price: "0.49", size: "10" }],
        asks: [{ price: "0.51", size: "10" }]
      })
    })}\n`;
    writeFileSync(oddsPath, oddsFile);
    writeFileSync(scoresPath, scoresFile);
    writeFileSync(polymarketPath, polymarketFile);

    const events: CanonicalEvent[] = [];
    const reportedHashes: Array<readonly [string, string]> = [];
    for await (const event of capturedPaperReplaySource({
      txlineOddsFramesPath: oddsPath,
      txlineScoresFramesPath: scoresPath,
      polymarketMessagesPath: polymarketPath,
      registry: registry(),
      speed: Number.POSITIVE_INFINITY,
      onInputHash: (name, digest) => { reportedHashes.push([name, digest]); }
    })) events.push(event);

    expect(events.map((event) => event.kind)).toEqual([
      "odds.quote",
      "feed.heartbeat",
      "polymarket.book"
    ]);
    expect(events.every((event) => !("mode" in event))).toBe(true);
    expect(reportedHashes).toHaveLength(3);
    expect(Object.fromEntries(reportedHashes)).toEqual({
      txlineOdds: sha256(oddsFile),
      txlineScores: sha256(scoresFile),
      polymarketMessages: sha256(polymarketFile)
    });

    const eventJson = events.map((event) => stableJson(event));
    writeFileSync(oddsPath, "mutated after verified snapshot\n");
    writeFileSync(scoresPath, "mutated after verified snapshot\n");
    writeFileSync(polymarketPath, "mutated after verified snapshot\n");
    const snapshottedEvents: CanonicalEvent[] = [];
    for await (const event of capturedPaperReplaySnapshotSource({
      eventJson,
      speed: Number.POSITIVE_INFINITY
    })) snapshottedEvents.push(event);
    expect(snapshottedEvents.map((event) => stableJson(event))).toEqual(eventJson);

    writeFileSync(oddsPath, oddsFile);
    writeFileSync(scoresPath, scoresFile);
    writeFileSync(polymarketPath, polymarketFile);

    const handle = initializePaperStudyLedger({
      path: ":memory:",
      lane: "bounty",
      startedAtTsMs: 1_000,
      testOnlyAllowPreRegistrationStart: true
    });
    try {
      const runtime = createPersistentPaperLaneRuntime({
        lane: "bounty",
        initialization: handle.initialization,
        universe: emptyUniverse(),
        ledger: handle.ledger,
        triageAgent: { triage: async () => ({ decision: "drop", priority: "low", rationale: "unused" }) },
        analystAgent: { investigate: async () => { throw new Error("unused"); } },
        feeResolver: async () => { throw new Error("unused"); },
        executionLatencyMs: 1,
        maximumPendingMs: 1_000
      });
      const session = await runPaperSession({
        source: capturedPaperReplaySource({
          txlineOddsFramesPath: oddsPath,
          txlineScoresFramesPath: scoresPath,
          polymarketMessagesPath: polymarketPath,
          registry: registry(),
          speed: Number.POSITIVE_INFINITY
        }),
        runtime
      });
      expect(session).toMatchObject({
        status: "completed",
        events: 3,
        runtimeBatches: 3,
        pendingCases: 0
      });
    } finally {
      handle.ledger.close();
    }
  });
});
