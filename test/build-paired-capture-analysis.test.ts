import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAndWritePairedCaptureAnalysis,
  parsePairedCaptureAnalysisArgs,
  type BuildPairedCaptureAnalysisOptions
} from "../src/harness/build-paired-capture-analysis.js";
import type { CaptureConfig } from "../src/harness/capture-config.js";
import { parseVerifiedPairedAnalysisManifest } from "../src/harness/paired-capture-manifest.js";
import { sha256 } from "../src/mapping/registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

type FixtureOptions = {
  includeOtherMarket?: boolean;
  selectedUnderBooks?: boolean;
  resolutionAssetIds?: string[];
  pct?: string[];
  finalAction?: string;
};

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeNdjson(path: string, values: unknown[]): Promise<void> {
  await writeFile(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

function sse(value: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(value)}\n`;
}

async function captureFixture(overrides: FixtureOptions = {}): Promise<BuildPairedCaptureAnalysisOptions> {
  const repoRoot = await mkdtemp(join(tmpdir(), "samaritan-capture-analysis-"));
  temporaryDirectories.push(repoRoot);
  const runId = "paired-test-fixture-2026-07-15";
  const fixtureId = "fixture-1";
  const startUtc = "2026-07-15T16:00:00.000Z";
  const kickoffUtc = "2026-07-15T19:00:00.000Z";
  const endUtc = "2026-07-15T22:00:00.000Z";
  const startTsMs = Date.parse(startUtc);
  const kickoffTsMs = Date.parse(kickoffUtc);
  const endTsMs = Date.parse(endUtc);
  const mainSlug = "test-home-test-away-2026-07-15";
  const totalsSlug = `${mainSlug}-more-markets`;
  const selected = {
    marketId: "market-25",
    conditionId: "condition-25",
    lineMilli: 2_500,
    over: "asset-25-over",
    under: "asset-25-under"
  };
  const other = {
    marketId: "market-35",
    conditionId: "condition-35",
    lineMilli: 3_500,
    over: "asset-35-over",
    under: "asset-35-under"
  };
  const polymarketDir = join(repoRoot, "samples/polymarket-live", runId);
  const txlineDir = join(repoRoot, "samples/odds-sse/mainnet", runId);
  const outputPath = join(repoRoot, "data/live", runId, "analysis-manifest.json");
  await mkdir(polymarketDir, { recursive: true });
  await mkdir(txlineDir, { recursive: true });

  const fixturesPath = join(repoRoot, "fixtures.json");
  const eventsPath = join(repoRoot, "events.json");
  const configPath = join(repoRoot, "capture.json");
  const mappingsPath = join(repoRoot, "mappings.json");
  const totalEvidencePath = join(repoRoot, "causal-evidence.json");
  const config: CaptureConfig = {
    captureId: runId,
    status: "human_confirmed_for_capture_only",
    tradeable: false,
    confirmedBy: "Deborah",
    confirmedAt: "2026-07-15",
    txline: {
      fixtureId,
      home: "Test Home",
      away: "Test Away",
      kickoffUtc
    },
    polymarket: {
      eventId: "event-main",
      eventSlug: mainSlug,
      totalsEventId: "event-totals",
      totalsEventSlug: totalsSlug,
      home: "Test Home",
      away: "Test Away",
      kickoffUtc,
      rulesPeriod: "first_90_minutes_plus_stoppage_time"
    },
    capture: {
      scheduledStartUtc: startUtc,
      scheduledEndUtc: endUtc,
      durationMinutes: 360,
      runLabel: runId,
      polymarketMaxAssets: 20,
      discoveryIntervalSeconds: 900,
      startupGraceSeconds: 180,
      streamStaleSeconds: 300,
      maxStartupSkewSeconds: 120
    },
    evidence: {
      txlineFixtures: "fixtures.json",
      polymarketEvents: "events.json",
      readinessReport: "readiness.md"
    },
    note: "Capture-only test fixture; never tradeable."
  };
  await writeJson(fixturesPath, [{
    FixtureId: fixtureId,
    Participant1: "Test Home",
    Participant2: "Test Away",
    StartTime: kickoffTsMs
  }]);
  await writeJson(eventsPath, [{
    id: "event-main",
    slug: mainSlug,
    teams: [{ name: "Test Home" }, { name: "Test Away" }],
    startTime: kickoffUtc,
    markets: [{ sportsMarketType: "moneyline", gameStartTime: kickoffUtc }]
  }, {
    id: "event-totals",
    slug: totalsSlug,
    teams: [{ name: "Test Home" }, { name: "Test Away" }],
    startTime: kickoffUtc,
    markets: [{
      sportsMarketType: "totals",
      gameStartTime: kickoffUtc,
      description: "This market is the first 90 minutes of regular play plus stoppage time."
    }]
  }]);
  await writeJson(configPath, config);

  const subscription = (input: {
    assetId: string;
    outcome: string;
    eventSlug: string;
    marketId: string;
    conditionId: string;
    sportsMarketType: string;
    line: number | null;
  }) => ({
    ...input,
    teams: ["Test Home", "Test Away"],
    kickoffMs: kickoffTsMs
  });
  const subscriptions = [subscription({
    assetId: "asset-main-home",
    outcome: "Test Home",
    eventSlug: mainSlug,
    marketId: "market-main",
    conditionId: "condition-main",
    sportsMarketType: "moneyline",
    line: null
  }), subscription({
    assetId: selected.over,
    outcome: "Over",
    eventSlug: totalsSlug,
    marketId: selected.marketId,
    conditionId: selected.conditionId,
    sportsMarketType: "totals",
    line: 2.5
  }), subscription({
    assetId: selected.under,
    outcome: "Under",
    eventSlug: totalsSlug,
    marketId: selected.marketId,
    conditionId: selected.conditionId,
    sportsMarketType: "totals",
    line: 2.5
  })];
  if (overrides.includeOtherMarket) {
    subscriptions.push(subscription({
      assetId: other.over,
      outcome: "Over",
      eventSlug: totalsSlug,
      marketId: other.marketId,
      conditionId: other.conditionId,
      sportsMarketType: "totals",
      line: 3.5
    }), subscription({
      assetId: other.under,
      outcome: "Under",
      eventSlug: totalsSlug,
      marketId: other.marketId,
      conditionId: other.conditionId,
      sportsMarketType: "totals",
      line: 3.5
    }));
  }
  await writeJson(join(polymarketDir, "subscriptions.json"), subscriptions);

  const book = (assetId: string, conditionId: string, timestamp: number) => ({
    event_type: "book",
    market: conditionId,
    asset_id: assetId,
    timestamp: String(timestamp),
    bids: [{ price: "0.49", size: "100" }],
    asks: [{ price: "0.51", size: "100" }],
    tick_size: "0.01",
    last_trade_price: "0.50"
  });
  const messages: unknown[] = [{
    receivedAt: new Date(startTsMs + 10_000).toISOString(),
    rawPayload: JSON.stringify(book(selected.over, selected.conditionId, startTsMs + 10_000)),
    parseError: null
  }];
  if (overrides.selectedUnderBooks !== false) {
    messages.push({
      receivedAt: new Date(startTsMs + 11_000).toISOString(),
      rawPayload: JSON.stringify(book(selected.under, selected.conditionId, startTsMs + 11_000)),
      parseError: null
    });
  }
  if (overrides.includeOtherMarket) {
    messages.push({
      receivedAt: new Date(startTsMs + 12_000).toISOString(),
      rawPayload: JSON.stringify(book(other.over, other.conditionId, startTsMs + 12_000)),
      parseError: null
    }, {
      receivedAt: new Date(startTsMs + 13_000).toISOString(),
      rawPayload: JSON.stringify(book(other.under, other.conditionId, startTsMs + 13_000)),
      parseError: null
    });
  }
  messages.push({
    receivedAt: new Date(kickoffTsMs - 2_000).toISOString(),
    rawPayload: JSON.stringify(book(selected.over, selected.conditionId, kickoffTsMs - 2_000)),
    parseError: null
  });
  if (overrides.selectedUnderBooks !== false) {
    messages.push({
      receivedAt: new Date(kickoffTsMs - 1_000).toISOString(),
      rawPayload: JSON.stringify(book(selected.under, selected.conditionId, kickoffTsMs - 1_000)),
      parseError: null
    });
  }
  messages.push({
    receivedAt: new Date(kickoffTsMs - 600_000).toISOString(),
    rawPayload: JSON.stringify({
      event_type: "price_change",
      market: selected.conditionId,
      timestamp: String(kickoffTsMs - 600_000),
      price_changes: [{
        asset_id: selected.over,
        price: "0.52",
        size: "10",
        side: "BUY",
        best_bid: "0.51",
        best_ask: "0.53"
      }, {
        asset_id: selected.under,
        price: "0.48",
        size: "10",
        side: "SELL",
        best_bid: "0.47",
        best_ask: "0.49"
      }]
    }),
    parseError: null
  }, {
    receivedAt: new Date(kickoffTsMs + 2 * 60 * 60_000).toISOString(),
    rawPayload: JSON.stringify({
      event_type: "market_resolved",
      id: selected.marketId,
      market: selected.conditionId,
      assets_ids: overrides.resolutionAssetIds ?? [selected.over, selected.under],
      winning_asset_id: selected.over,
      winning_outcome: "over",
      timestamp: String(kickoffTsMs + 2 * 60 * 60_000)
    }),
    parseError: null
  }, {
    receivedAt: new Date(endTsMs - 10_000).toISOString(),
    rawPayload: "pong",
    parseError: null
  });
  messages.sort((left, right) =>
    Date.parse((left as { receivedAt: string }).receivedAt) -
    Date.parse((right as { receivedAt: string }).receivedAt)
  );
  await writeNdjson(join(polymarketDir, "messages.ndjson"), messages);

  const odds = (line: number, observedTsMs: number, messageId: string) => ({
    FixtureId: fixtureId,
    MessageId: messageId,
    Ts: observedTsMs,
    Bookmaker: "Test Book",
    BookmakerId: 1,
    SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
    GameState: "PreMatch",
    InRunning: false,
    MarketParameters: `line=${line}`,
    MarketPeriod: null,
    PriceNames: ["over", "under"],
    Prices: [1_961, 2_041],
    Pct: overrides.pct ?? ["51", "49"]
  });
  const oddsFrames: unknown[] = [{
    receivedAt: new Date(startTsMs + 20_000).toISOString(),
    stream: "odds",
    rawFrame: sse(odds(2.5, startTsMs + 20_000, "odds-1"))
  }];
  if (overrides.includeOtherMarket) {
    oddsFrames.push({
      receivedAt: new Date(startTsMs + 21_000).toISOString(),
      stream: "odds",
      rawFrame: sse(odds(3.5, startTsMs + 21_000, "odds-other"))
    });
  }
  oddsFrames.push({
    receivedAt: new Date(kickoffTsMs - 60_000).toISOString(),
    stream: "odds",
    rawFrame: sse(odds(2.5, kickoffTsMs - 60_000, "odds-2"))
  }, {
    receivedAt: new Date(endTsMs - 20_000).toISOString(),
    stream: "odds",
    rawFrame: sse({ Ts: endTsMs - 20_000 }, "heartbeat")
  });
  await writeNdjson(join(txlineDir, "odds.frames.ndjson"), oddsFrames);

  const firstScore = {
    FixtureId: fixtureId,
    Ts: startTsMs + 30_000,
    Action: "clock_updated",
    Id: 1,
    Seq: 1,
    GameState: "PreMatch"
  };
  const finalScore = {
    FixtureId: fixtureId,
    Ts: kickoffTsMs + 2 * 60 * 60_000,
    Action: overrides.finalAction ?? "game_finalised",
    StatusId: 100,
    Id: 2,
    Seq: 2,
    GameState: "Final",
    Score: {
      Participant1: { Total: { Goals: 2 } },
      Participant2: { Total: { Goals: 1 } }
    }
  };
  await writeNdjson(join(txlineDir, "scores.frames.ndjson"), [{
    receivedAt: new Date(startTsMs + 30_000).toISOString(),
    stream: "scores",
    rawFrame: sse(firstScore)
  }, {
    receivedAt: new Date(kickoffTsMs + 2 * 60 * 60_000).toISOString(),
    stream: "scores",
    rawFrame: sse(finalScore)
  }, {
    receivedAt: new Date(endTsMs - 30_000).toISOString(),
    stream: "scores",
    rawFrame: sse({ Ts: endTsMs - 30_000 }, "heartbeat")
  }]);

  await writeJson(join(polymarketDir, "capture-manifest.json"), {
    schemaVersion: 2,
    runId,
    status: "completed",
    startedAt: startUtc,
    captureStartedAt: new Date(startTsMs + 5_000).toISOString(),
    endedAt: endUtc,
    deadlineAt: endUtc,
    captureWindow: { startUtc, endUtc, maxStartupSkewSeconds: 120 },
    endpoint: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    paired: true,
    txlineFixtureId: fixtureId,
    exactEventSlugs: [mainSlug, totalsSlug],
    fullWorldCupDiscovery: false,
    stats: {
      messages: messages.length,
      parsedItems: messages.length - 1,
      parseErrors: 0,
      transportHeartbeats: 1,
      inScopeBookEvents: messages.length,
      inScopeBookSnapshots: messages.length,
      discoveredAssets: subscriptions.length,
      subscribedAssets: subscriptions.length,
      connects: 1,
      opens: 1,
      disconnects: 1,
      reconnects: 0,
      forcedReconnects: 0,
      eventTypes: { book: 2, price_change: 1, market_resolved: 1, heartbeat_pong: 1 }
    },
    pairedChildExit: { code: 0, signal: null, atMs: endTsMs },
    error: null
  });
  await writeJson(join(txlineDir, "txline-capture-manifest.json"), {
    schemaVersion: 1,
    network: "mainnet",
    runId,
    fixtureId,
    startedAt: startUtc,
    deadlineAt: endUtc,
    captureWindow: { startUtc, endUtc, maxStartupSkewSeconds: 120 },
    status: "completed",
    endedAt: endUtc,
    streams: [{
      stream: "odds",
      frames: oddsFrames.length,
      jsonDataFrames: oddsFrames.length - 1,
      exactFixtureDataFrames: oddsFrames.length - 1,
      usableExactFixtureOddsFrames: oddsFrames.length - 1,
      completedExactFixtureScoreFrames: 0,
      firstReceivedAt: new Date(startTsMs + 20_000).toISOString(),
      lastReceivedAt: new Date(endTsMs - 20_000).toISOString()
    }, {
      stream: "scores",
      frames: 3,
      jsonDataFrames: 2,
      exactFixtureDataFrames: 2,
      usableExactFixtureOddsFrames: 0,
      completedExactFixtureScoreFrames: 1,
      firstReceivedAt: new Date(startTsMs + 30_000).toISOString(),
      lastReceivedAt: new Date(endTsMs - 30_000).toISOString()
    }],
    error: null
  });

  const rulesText = "Full-time total, first 90 minutes plus stoppage time.";
  const conditions = [{
    polymarketMarketId: selected.marketId,
    conditionId: selected.conditionId,
    family: "total_goals",
    period: "full_time",
    lineMilli: selected.lineMilli,
    rulesText,
    rulesSha256: sha256(rulesText),
    tokens: [{ assetId: selected.over, outcome: "over", role: "canonical" }, {
      assetId: selected.under,
      outcome: "under",
      role: "canonical"
    }]
  }];
  if (overrides.includeOtherMarket) {
    conditions.push({
      polymarketMarketId: other.marketId,
      conditionId: other.conditionId,
      family: "total_goals",
      period: "full_time",
      lineMilli: other.lineMilli,
      rulesText,
      rulesSha256: sha256(rulesText),
      tokens: [{ assetId: other.over, outcome: "over", role: "canonical" }, {
        assetId: other.under,
        outcome: "under",
        role: "canonical"
      }]
    });
  }
  await writeJson(mappingsPath, { records: [{
    mappingId: `${fixtureId}:totals`,
    status: "verified",
    txlineFixtureId: fixtureId,
    teams: {
      home: { canonical: "Test Home", aliases: [] },
      away: { canonical: "Test Away", aliases: [] }
    },
    kickoff: { txlineTsMs: kickoffTsMs, polymarketTsMs: kickoffTsMs },
    polymarketEventId: "event-totals",
    polymarketEventSlug: totalsSlug,
    conditions,
    review: {
      settlementVerified: true,
      reviewedBy: "Deborah",
      reviewedAt: "2026-07-15T23:00:00.000Z"
    }
  }] });
  const selectorCutoffTsMs = kickoffTsMs - 180 * 60_000;
  await writeJson(totalEvidencePath, { evidence: [{
    fixtureId,
    marketId: selected.marketId,
    marketKey: `${fixtureId}:total_goals:full_time:${selected.lineMilli}`,
    lineMilli: selected.lineMilli,
    mappingStatus: "verified",
    txlineMarketObserved: true,
    selectorCutoffTsMs,
    preKickoffOverProbability: 0.51,
    preKickoffPointTsMs: selectorCutoffTsMs,
    coverageFirstPointTsMs: selectorCutoffTsMs - 1_000,
    coverageLastPointTsMs: selectorCutoffTsMs,
    volume: 0,
    liquidity: 0,
    coveragePoints: 2_000
  }] });
  return {
    repoRoot,
    captureConfigPath: configPath,
    mappingsPath,
    totalEvidencePath,
    outputPath
  };
}

describe("deterministic paired capture analysis bridge", () => {
  it("accepts pnpm 11's leading script-argument separator", async () => {
    const options = await captureFixture();
    expect(parsePairedCaptureAnalysisArgs([
      "--",
      "--capture-config", options.captureConfigPath,
      "--mappings", options.mappingsPath,
      "--total-evidence", options.totalEvidencePath,
      "--output", options.outputPath
    ], options.repoRoot)).toEqual(options);
    expect(() => parsePairedCaptureAnalysisArgs([
      "--capture-config", options.captureConfigPath,
      "--output", options.outputPath,
      "--output", options.captureConfigPath
    ], options.repoRoot)).toThrow(/Duplicate paired-capture analysis option/);
  });

  it("refuses to overwrite or alias sealed capture-analysis inputs", async () => {
    const direct = await captureFixture();
    const configBefore = await readFile(direct.captureConfigPath, "utf8");
    await expect(buildAndWritePairedCaptureAnalysis({
      ...direct,
      outputPath: direct.captureConfigPath
    })).rejects.toThrow(/sealed run path/);
    expect(await readFile(direct.captureConfigPath, "utf8")).toBe(configBefore);

    const aliased = await captureFixture();
    const mappingBefore = await readFile(aliased.mappingsPath, "utf8");
    await mkdir(join(aliased.repoRoot, "data/live/paired-test-fixture-2026-07-15"), {
      recursive: true
    });
    await symlink(aliased.mappingsPath, aliased.outputPath);
    await expect(buildAndWritePairedCaptureAnalysis(aliased)).rejects.toThrow(
      /output and input paths must be distinct/
    );
    expect(await readFile(aliased.mappingsPath, "utf8")).toBe(mappingBefore);
  });

  it("atomically binds exact selected depth, TXLine odds/scores, close, resolution, and ingress proof", async () => {
    const options = await captureFixture();
    const first = await buildAndWritePairedCaptureAnalysis({
      ...options,
      checkedAt: "2026-07-16T00:00:00.000Z"
    });
    expect(first).toMatchObject({
      schemaVersion: 2,
      status: "verified",
      fixtureId: "fixture-1",
      selectedTotal: {
        eventSlug: "test-home-test-away-2026-07-15-more-markets",
        marketId: "market-25",
        conditionId: "condition-25",
        lineMilli: 2_500,
        assetIds: ["asset-25-over", "asset-25-under"]
      },
      verification: {
        selectedBookDepthComplete: true,
        exactFixtureTxlineOddsAvailable: true,
        exactFixtureTxlineScoresAvailable: true,
        exactFixtureScoreCompleted: true,
        kickoffCloseAvailable: true,
        publicMarketResolvedNormalized: true
      },
      admission: { status: "eligible", missingGates: [] }
    });
    expect(Object.keys(first.proof.inputHashes).sort()).toEqual([
      "captureConfig",
      "causalTotalEvidence",
      "mappings",
      "polymarketEventSnapshot",
      "polymarketMessages",
      "polymarketTerminalManifest",
      "subscriptions",
      "txlineFixtureSnapshot",
      "txlineOdds",
      "txlineScores",
      "txlineTerminalManifest"
    ].sort());
    expect(first.proof.inputHashes).toMatchObject({
      txlineFixtureSnapshot: sha256(await readFile(join(options.repoRoot, "fixtures.json"), "utf8")),
      polymarketEventSnapshot: sha256(await readFile(join(options.repoRoot, "events.json"), "utf8"))
    });
    const verified = parseVerifiedPairedAnalysisManifest(first);
    expect(verified?.selectedMarketEvidence.canonicalIngress).toMatchObject({
      eventCount: 13,
      maximumEventsInModelStallWindow: expect.any(Number),
      requiredIngressCapacity: 17,
      counts: {
        selectedOdds: 2,
        fixtureScores: 2,
        selectedBooks: 4,
        selectedPrices: 2,
        selectedResolutions: 1,
        feedEvents: 2
      }
    });
    const persisted = await readFile(options.outputPath, "utf8");
    expect(persisted).not.toContain("PriceNames");
    expect((await readdir(join(options.repoRoot, "data/live/paired-test-fixture-2026-07-15")))
      .filter((name) => name.includes(".tmp-"))).toEqual([]);

    const second = await buildAndWritePairedCaptureAnalysis({
      ...options,
      checkedAt: "2026-07-16T00:01:00.000Z"
    });
    expect(second.proof.inputCommitment).toBe(first.proof.inputCommitment);
    expect(second.proof.analysisCommitment).toBe(first.proof.analysisCommitment);
    expect(second.checkedAt).not.toBe(first.checkedAt);
  });

  it("commits evidence-snapshot changes and fails closed when fixture identity is mutated", async () => {
    const options = await captureFixture();
    const fixturesPath = join(options.repoRoot, "fixtures.json");
    const first = await buildAndWritePairedCaptureAnalysis(options);
    const fixtures = JSON.parse(await readFile(fixturesPath, "utf8")) as Array<Record<string, unknown>>;
    fixtures.push({
      FixtureId: "fixture-unrelated",
      Participant1: "Other Home",
      Participant2: "Other Away",
      StartTime: Date.parse("2026-07-17T19:00:00.000Z")
    });
    await writeJson(fixturesPath, fixtures);

    const recommitted = await buildAndWritePairedCaptureAnalysis(options);
    expect(recommitted.status).toBe("verified");
    expect(recommitted.proof.inputHashes.txlineFixtureSnapshot).not.toBe(
      first.proof.inputHashes.txlineFixtureSnapshot
    );
    expect(recommitted.proof.inputCommitment).not.toBe(first.proof.inputCommitment);

    fixtures[0]!.Participant1 = "Mutated Home";
    await writeJson(fixturesPath, fixtures);
    const failed = await buildAndWritePairedCaptureAnalysis(options);
    expect(failed).toMatchObject({
      status: "failed_closed",
      admission: { status: "failed_closed" },
      failures: [{ code: "capture_analysis_failed" }]
    });
    expect(JSON.parse(await readFile(options.outputPath, "utf8"))).toMatchObject({
      status: "failed_closed",
      admission: { status: "failed_closed" }
    });
  });

  it("verifies capture-only evidence but withholds admission when reviewed mapping/causal selection is absent", async () => {
    const options = await captureFixture();
    const manifest = await buildAndWritePairedCaptureAnalysis({
      ...options,
      mappingsPath: join(options.repoRoot, "missing-mappings.json"),
      totalEvidencePath: join(options.repoRoot, "missing-causal-evidence.json")
    });
    expect(manifest).toMatchObject({
      status: "verified_capture",
      selectedTotal: null,
      captureVerification: { status: "verified" },
      admission: { status: "failed_closed" }
    });
    expect(parseVerifiedPairedAnalysisManifest(manifest)).toBeNull();
  });

  it("does not let complete books on another total authorize an incomplete selected total", async () => {
    const options = await captureFixture({ includeOtherMarket: true, selectedUnderBooks: false });
    const manifest = await buildAndWritePairedCaptureAnalysis(options);
    expect(manifest).toMatchObject({
      status: "failed_closed",
      failures: [{ code: "selected_market_depth_incomplete" }],
      admission: { status: "failed_closed" }
    });
  });

  it("durably fails closed on tampered selected resolution, invalid Pct, or missing exact completion", async () => {
    const cases: Array<{ fixture: FixtureOptions; code: string }> = [{
      fixture: { resolutionAssetIds: ["asset-25-over", "other-asset"] },
      code: "resolution_assets_mismatch"
    }, {
      fixture: { pct: ["80", "30"] },
      code: "exact_fixture_odds_invalid"
    }, {
      fixture: { finalAction: "clock_updated" },
      code: "exact_fixture_score_completion_missing"
    }];
    for (const item of cases) {
      const options = await captureFixture(item.fixture);
      const manifest = await buildAndWritePairedCaptureAnalysis(options);
      expect(manifest.status).toBe("failed_closed");
      expect(manifest.failures[0]?.code).toBe(item.code);
      expect(JSON.parse(await readFile(options.outputPath, "utf8"))).toMatchObject({
        status: "failed_closed",
        admission: { status: "failed_closed" }
      });
    }
  });
});
