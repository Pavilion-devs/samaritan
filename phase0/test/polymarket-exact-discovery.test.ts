import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isInScopeRealBookItem,
  pairedChildExitFailure,
  PAIRED_CHILD_DEADLINE_GRACE_MS,
  selectSupportedAssetRecords
} from "../src/capture-polymarket-ws.js";
import {
  captureStartupFailure,
  parseAbsoluteCaptureWindow
} from "../src/capture-window.js";
import {
  discoverEventsByExactSlugs,
  GAMMA_ORIGIN,
  type GammaFetch
} from "../src/polymarket-lib.js";

test("exact-slug discovery fetches only direct official event endpoints and preserves atomic evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "samaritan-gamma-slugs-"));
  const runLogPath = join(directory, "run.ndjson");
  const requested = ["fifwc-eng-arg-2026-07-15", "fifwc-eng-arg-2026-07-15-more-markets"];
  const urls: string[] = [];
  const fetcher: GammaFetch = async (url) => {
    urls.push(url);
    const slug = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ id: `id-${urls.length}`, slug, markets: [] }),
      contentType: "application/json",
      attempts: 1
    };
  };

  try {
    const result = await discoverEventsByExactSlugs({
      outDir: directory,
      eventSlugs: requested,
      manifestLogPath: runLogPath,
      fetcher
    });

    assert.deepEqual(urls, requested.map((slug) => `${GAMMA_ORIGIN}/events/slug/${slug}`));
    assert.ok(urls.every((url) => !url.includes("/events/keyset") && !url.endsWith("/sports")));
    assert.deepEqual(result.events.map((event) => event.slug), requested);

    const evidenceDir = join(directory, "exact-slug", result.discoveryId);
    const evidenceFiles = await readdir(evidenceDir);
    assert.equal(evidenceFiles.filter((name) => name.endsWith(".response.json")).length, 2);
    assert.equal(evidenceFiles.filter((name) => name.endsWith(".manifest.json")).length, 2);
    assert.equal(evidenceFiles.filter((name) => name.includes(".tmp-")).length, 0);

    const logEntries = (await readFile(runLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(logEntries.map((entry) => entry.requestedSlug), requested);
    assert.ok(logEntries.every((entry) => entry.outcome === "captured"));
    const aggregate = JSON.parse(await readFile(join(directory, "exact-slug-events.json"), "utf8"));
    assert.deepEqual(aggregate.map((event: { slug: string }) => event.slug), requested);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exact-slug discovery rejects a mismatched response after preserving raw and failure manifests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "samaritan-gamma-mismatch-"));
  const runLogPath = join(directory, "run.ndjson");
  try {
    await assert.rejects(
      discoverEventsByExactSlugs({
        outDir: directory,
        eventSlugs: ["expected-slug"],
        manifestLogPath: runLogPath,
        fetcher: async () => ({
          ok: true,
          status: 200,
          text: JSON.stringify({ id: "wrong", slug: "different-slug", markets: [] }),
          contentType: "application/json",
          attempts: 1
        })
      }),
      /slug mismatch: requested expected-slug, received different-slug/
    );

    const entry = JSON.parse((await readFile(runLogPath, "utf8")).trim());
    assert.equal(entry.outcome, "failed");
    assert.equal(entry.requestedSlug, "expected-slug");
    assert.equal(entry.returnedSlug, "different-slug");
    assert.match(await readFile(entry.path, "utf8"), /different-slug/);
    const evidenceFiles = await readdir(join(directory, "exact-slug", entry.discoveryId));
    assert.equal(evidenceFiles.filter((name) => name.endsWith(".manifest.json")).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("paired child supervision fails early or abnormal exits but allows a clean near-deadline exit", () => {
  const deadline = 1_000_000;
  assert.match(
    pairedChildExitFailure({
      exit: { code: 0, signal: null, atMs: deadline - PAIRED_CHILD_DEADLINE_GRACE_MS - 1 },
      deadline
    }) ?? "",
    /before the shared deadline/
  );
  assert.equal(pairedChildExitFailure({
    exit: { code: 0, signal: null, atMs: deadline - PAIRED_CHILD_DEADLINE_GRACE_MS },
    deadline
  }), undefined);
  assert.match(pairedChildExitFailure({
    exit: { code: 1, signal: null, atMs: deadline },
    deadline
  }) ?? "", /code 1/);
  assert.match(pairedChildExitFailure({
    exit: { code: null, signal: "SIGTERM", atMs: deadline },
    deadline
  }) ?? "", /signal SIGTERM/);
});

test("absolute capture windows cannot be shifted by discovery duration", () => {
  const window = parseAbsoluteCaptureWindow({
    startUtc: "2026-07-15T16:00:00.000Z",
    endUtc: "2026-07-15T22:00:00.000Z",
    maxStartupSkewSeconds: 120
  });
  assert.ok(window);
  assert.equal(window.endTsMs - window.startTsMs, 6 * 60 * 60_000);
  assert.equal(captureStartupFailure(window, window.startTsMs + 120_000), undefined);
  assert.match(captureStartupFailure(window, window.startTsMs + 120_001) ?? "", /reviewed window/);
  assert.match(captureStartupFailure(window, window.endTsMs) ?? "", /ended before streams started/);
  assert.throws(() => parseAbsoluteCaptureWindow({
    startUtc: window.startUtc,
    maxStartupSkewSeconds: 120
  }), /requires both/);
});

test("supported asset selection is deterministic and never truncates required strategy markets", (context) => {
  const kickoff = "2026-07-15T19:00:00.000Z";
  context.mock.method(Date, "now", () => Date.parse(kickoff) - 60 * 60_000);
  const market = (id: string, sportsMarketType: "moneyline" | "totals", line?: number) => ({
    id,
    conditionId: `condition-${id}`,
    sportsMarketType,
    ...(line === undefined ? {} : { line }),
    gameStartTime: kickoff,
    active: true,
    closed: false,
    acceptingOrders: true,
    enableOrderBook: true,
    question: `${sportsMarketType}-${id}`,
    clobTokenIds: JSON.stringify([`asset-${id}-b`, `asset-${id}-a`]),
    outcomes: JSON.stringify(sportsMarketType === "moneyline" ? ["Yes", "No"] : ["Over", "Under"])
  });
  const matchEvent = {
    id: "match",
    slug: "match-slug",
    startTime: kickoff,
    markets: [market("3", "moneyline"), market("1", "moneyline"), market("2", "moneyline")]
  };
  const totalsEvent = {
    id: "totals",
    slug: "totals-slug",
    startTime: kickoff,
    markets: [market("5", "totals", 2.5), market("4", "totals", 1.5)]
  };
  const slugs = new Set(["match-slug", "totals-slug"]);
  const selected = selectSupportedAssetRecords([totalsEvent, matchEvent], slugs, 50);
  const shuffled = selectSupportedAssetRecords([
    { ...matchEvent, markets: [...matchEvent.markets].reverse() },
    { ...totalsEvent, markets: [...totalsEvent.markets].reverse() }
  ], slugs, 50);
  assert.deepEqual(selected.map((record) => record.assetId), shuffled.map((record) => record.assetId));
  assert.equal(selected.length, 10);
  assert.throws(() => selectSupportedAssetRecords([matchEvent, totalsEvent], slugs, 9), /exceed --max-assets/);
  assert.throws(() => selectSupportedAssetRecords([matchEvent, { ...totalsEvent, markets: [] }], slugs, 50), /full-time totals/);
  const withUnsupported = selectSupportedAssetRecords([
    { ...matchEvent, markets: [...matchEvent.markets, { ...market("x", "totals", 3.5), sportsMarketType: "spreads" }] },
    totalsEvent
  ], slugs, 50);
  assert.ok(withUnsupported.every((record) => record.marketId !== "x"));
  assert.throws(() => selectSupportedAssetRecords([
    {
      ...matchEvent,
      markets: [{ ...matchEvent.markets[0]!, clobTokenIds: JSON.stringify(["only-one"]) }, ...matchEvent.markets.slice(1)]
    },
    totalsEvent
  ], slugs, 50), /required outcome pair/);
});

test("transport heartbeat cannot masquerade as an in-scope real book event", () => {
  const subscribed = new Set(["asset-1"]);
  assert.equal(isInScopeRealBookItem({ event_type: "heartbeat_pong", asset_id: "asset-1" }, subscribed), false);
  assert.equal(isInScopeRealBookItem({ event_type: "book", asset_id: "asset-1" }, subscribed), true);
  assert.equal(isInScopeRealBookItem({ event_type: "book", asset_id: "other" }, subscribed), false);
});
