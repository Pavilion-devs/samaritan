import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureCommandArgs,
  acquireSupervisorLock,
  fetchExactEvents,
  releaseSupervisorLock,
  writeExclusiveSupervisorPid,
  streamFreshnessFailure,
  validateCaptureToken,
  validateSynchronizedCoverage,
  verifyTerminalCaptureEvidence,
  type CaptureStreamCoverage
} from "../src/harness/run-scheduled-capture.js";
import type { CaptureConfig } from "../src/harness/capture-config.js";

const config = {
  captureId: "paired-england-argentina-2026-07-15",
  status: "human_confirmed_for_capture_only",
  tradeable: false,
  confirmedBy: "Deborah",
  confirmedAt: "2026-07-12",
  txline: { fixtureId: "18241006", home: "England", away: "Argentina", kickoffUtc: "2026-07-15T19:00:00.000Z" },
  polymarket: {
    eventId: "694581",
    eventSlug: "fifwc-eng-arg-2026-07-15",
    totalsEventId: "694786",
    totalsEventSlug: "fifwc-eng-arg-2026-07-15-more-markets",
    home: "England",
    away: "Argentina",
    kickoffUtc: "2026-07-15T19:00:00.000Z",
    rulesPeriod: "first_90_minutes_plus_stoppage_time"
  },
  capture: {
    scheduledStartUtc: "2026-07-15T16:00:00.000Z",
    scheduledEndUtc: "2026-07-15T22:00:00.000Z",
    durationMinutes: 360,
    runLabel: "paired-england-argentina-2026-07-15",
    polymarketMaxAssets: 50,
    discoveryIntervalSeconds: 900,
    startupGraceSeconds: 180,
    streamStaleSeconds: 300,
    maxStartupSkewSeconds: 120
  },
  evidence: { txlineFixtures: "fixtures", polymarketEvents: "events", readinessReport: "readiness" },
  note: "Capture only."
} satisfies CaptureConfig;

function jwt(expSeconds: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.signature`;
}

describe("scheduled capture supervisor", () => {
  it("builds a bounded exact-fixture capture invocation from reviewed config", () => {
    expect(captureCommandArgs(config)).toEqual([
      "capture:paired", "--", "--network", "mainnet", "--txline-fixture-id", "18241006",
      "--capture-start-utc", "2026-07-15T16:00:00.000Z",
      "--capture-end-utc", "2026-07-15T22:00:00.000Z",
      "--max-startup-skew-seconds", "120",
      "--run-label", "paired-england-argentina-2026-07-15",
      "--event-slugs", "fifwc-eng-arg-2026-07-15,fifwc-eng-arg-2026-07-15-more-markets",
      "--max-assets", "50", "--discovery-interval-seconds", "900"
    ]);
  });

  it("accepts only a mainnet SL12 token that outlives the run", () => {
    const requiredThrough = Date.parse("2026-07-15T22:00:00.000Z");
    expect(() => validateCaptureToken({
      network: "mainnet",
      serviceLevelId: 12,
      jwt: jwt(requiredThrough / 1_000 + 60),
      apiToken: "present"
    }, requiredThrough)).not.toThrow();
    expect(() => validateCaptureToken({
      network: "mainnet",
      serviceLevelId: 12,
      jwt: jwt(requiredThrough / 1_000),
      apiToken: "present"
    }, requiredThrough)).toThrow(/expires/);
    expect(() => validateCaptureToken({
      network: "mainnet",
      serviceLevelId: 1,
      jwt: jwt(requiredThrough / 1_000 + 60),
      apiToken: "present"
    }, requiredThrough)).toThrow(/SL12/);
  });

  it("bounds Gamma retry and timeout by the startup deadline", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string | URL | Request) => {
      calls += 1;
      if (calls === 1) return new Response("temporary", { status: 503 });
      const slug = calls === 2 ? config.polymarket.eventSlug : config.polymarket.totalsEventSlug;
      return new Response(JSON.stringify({ slug }), { status: 200 });
    }) as typeof fetch;
    await expect(fetchExactEvents({
      config,
      fetchImpl,
      startupDeadlineTsMs: Date.now() + 2_000
    })).resolves.toHaveLength(2);
    expect(calls).toBe(3);

    const startedAt = Date.now();
    await expect(fetchExactEvents({
      config,
      fetchImpl: (() => new Promise<Response>(() => undefined)) as typeof fetch,
      startupDeadlineTsMs: Date.now() + 30
    })).rejects.toThrow(/maximum startup skew/);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("allows one active supervisor owner and reclaims only stale locks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "samaritan-supervisor-lock-"));
    const path = join(directory, "capture.lock");
    try {
      const owner = await acquireSupervisorLock({
        path,
        captureId: config.captureId,
        pid: 101,
        isPidAlive: () => true
      });
      await expect(acquireSupervisorLock({
        path,
        captureId: config.captureId,
        pid: 202,
        isPidAlive: (pid) => pid === 101
      })).rejects.toThrow(/already active with PID 101/);
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ pid: 101, nonce: owner.nonce });
      await releaseSupervisorLock(owner);

      await writeFile(path, `${JSON.stringify({ pid: 999, nonce: "stale" })}\n`);
      const replacement = await acquireSupervisorLock({
        path,
        captureId: config.captureId,
        pid: 303,
        isPidAlive: () => false
      });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ pid: 303, nonce: replacement.nonce });
      await releaseSupervisorLock(replacement);
      await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      const pidPath = join(directory, "capture.pid");
      await writeFile(pidPath, "404\n");
      await expect(writeExclusiveSupervisorPid({
        path: pidPath,
        pid: 505,
        isPidAlive: (pid) => pid === 404
      })).rejects.toThrow(/Legacy capture supervisor already active/);
      await writeFile(pidPath, "404\n");
      await writeExclusiveSupervisorPid({ path: pidPath, pid: 505, isPidAlive: () => false });
      expect(await readFile(pidPath, "utf8")).toBe("505\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when any of the three capture artifacts is missing or stale", () => {
    const startupDeadlineTsMs = 10_000;
    const streams = (["polymarket", "txline_odds", "txline_scores"] as const).map((name) => ({
      name,
      path: `/tmp/${name}`,
      exists: true,
      size: 10,
      mtimeMs: 9_500
    }));
    expect(streamFreshnessFailure({
      nowTsMs: startupDeadlineTsMs - 1,
      startupDeadlineTsMs,
      staleAfterMs: 1_000,
      streams: [{ ...streams[0]!, exists: false, size: 0 }, ...streams.slice(1)]
    })).toBeUndefined();
    expect(streamFreshnessFailure({
      nowTsMs: startupDeadlineTsMs,
      startupDeadlineTsMs,
      staleAfterMs: 1_000,
      streams: [{ ...streams[0]!, exists: false, size: 0 }, ...streams.slice(1)]
    })).toMatch(/polymarket did not produce/);
    expect(streamFreshnessFailure({
      nowTsMs: 11_001,
      startupDeadlineTsMs,
      staleAfterMs: 1_000,
      streams
    })).toMatch(/capture stream stalled/);
    expect(streamFreshnessFailure({
      nowTsMs: 10_000,
      startupDeadlineTsMs,
      staleAfterMs: 1_000,
      streams
    })).toBeUndefined();
  });

  it("requires positive synchronized coverage from all three streams", () => {
    const coverage = (["polymarket", "txline_odds", "txline_scores"] as const).map((name, index): CaptureStreamCoverage => ({
      name,
      path: `/tmp/${name}`,
      bytes: 100,
      firstReceivedAt: new Date(1_000 + index * 100).toISOString(),
      lastReceivedAt: new Date(9_000 - index * 100).toISOString(),
      firstReceivedTsMs: 1_000 + index * 100,
      lastReceivedTsMs: 9_000 - index * 100
    }));
    expect(validateSynchronizedCoverage({
      windowStartTsMs: 1_000,
      windowEndTsMs: 9_000,
      startupGraceMs: 1_000,
      streamStaleMs: 1_000,
      streams: coverage
    })).toEqual({ synchronizedStartTsMs: 1_200, synchronizedEndTsMs: 8_800 });
    expect(() => validateSynchronizedCoverage({
      windowStartTsMs: 1_000,
      windowEndTsMs: 9_000,
      startupGraceMs: 1_000,
      streamStaleMs: 1_000,
      streams: coverage.map((stream) => stream.name === "txline_scores"
        ? { ...stream, firstReceivedTsMs: 8_900, firstReceivedAt: new Date(8_900).toISOString() }
        : stream)
    })).toThrow(/startup grace|synchronized coverage/);
  });

  it("accepts only a completed exact-window manifest backed by boundary evidence", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "samaritan-terminal-capture-"));
    const polymarketDir = join(repoRoot, "samples/polymarket-live", config.capture.runLabel);
    const txlineDir = join(repoRoot, "samples/odds-sse/mainnet", config.capture.runLabel);
    const row = (receivedAt: string, extra: Record<string, unknown> = {}) => `${JSON.stringify({ receivedAt, ...extra })}\n`;
    const startTsMs = Date.parse(config.capture.scheduledStartUtc);
    const endTsMs = Date.parse(config.capture.scheduledEndUtc);
    try {
      await mkdir(polymarketDir, { recursive: true });
      await mkdir(txlineDir, { recursive: true });
      await writeFile(join(polymarketDir, "subscriptions.json"), "[{}]\n");
      await writeFile(join(polymarketDir, "messages.ndjson"),
        row(new Date(startTsMs + 10_000).toISOString()) + row(new Date(endTsMs - 10_000).toISOString()));
      await writeFile(join(txlineDir, "odds.frames.ndjson"),
        row(new Date(startTsMs + 20_000).toISOString(), { stream: "odds" }) +
        row(new Date(endTsMs - 20_000).toISOString(), { stream: "odds" }));
      await writeFile(join(txlineDir, "scores.frames.ndjson"),
        row(new Date(startTsMs + 30_000).toISOString(), { stream: "scores" }) +
        row(new Date(endTsMs - 30_000).toISOString(), { stream: "scores" }));
      const manifest = {
        schemaVersion: 2,
        runId: config.capture.runLabel,
        status: "completed",
        startedAt: config.capture.scheduledStartUtc,
        captureStartedAt: new Date(startTsMs + 5_000).toISOString(),
        endedAt: config.capture.scheduledEndUtc,
        deadlineAt: config.capture.scheduledEndUtc,
        captureWindow: {
          startUtc: config.capture.scheduledStartUtc,
          endUtc: config.capture.scheduledEndUtc,
          maxStartupSkewSeconds: config.capture.maxStartupSkewSeconds
        },
        endpoint: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
        paired: true,
        txlineFixtureId: config.txline.fixtureId,
        exactEventSlugs: [config.polymarket.eventSlug, config.polymarket.totalsEventSlug],
        fullWorldCupDiscovery: false,
        stats: {
          messages: 2,
          parsedItems: 2,
          parseErrors: 0,
          transportHeartbeats: 20,
          inScopeBookEvents: 2,
          inScopeBookSnapshots: 2,
          discoveredAssets: 2,
          subscribedAssets: 2,
          connects: 1,
          opens: 1,
          disconnects: 1,
          reconnects: 0,
          forcedReconnects: 0,
          eventTypes: { book: 2 }
        },
        pairedChildExit: { code: 0, signal: null, atMs: endTsMs },
        error: null
      };
      await writeFile(join(polymarketDir, "capture-manifest.json"), `${JSON.stringify(manifest)}\n`);
      const txlineManifest = {
        schemaVersion: 1,
        network: "mainnet",
        runId: config.capture.runLabel,
        fixtureId: config.txline.fixtureId,
        startedAt: config.capture.scheduledStartUtc,
        deadlineAt: config.capture.scheduledEndUtc,
        captureWindow: {
          startUtc: config.capture.scheduledStartUtc,
          endUtc: config.capture.scheduledEndUtc,
          maxStartupSkewSeconds: config.capture.maxStartupSkewSeconds
        },
        status: "completed",
        endedAt: config.capture.scheduledEndUtc,
        streams: [
          {
            stream: "odds",
            frames: 2,
            jsonDataFrames: 2,
            exactFixtureDataFrames: 2,
            usableExactFixtureOddsFrames: 2,
            completedExactFixtureScoreFrames: 0,
            firstReceivedAt: new Date(startTsMs + 20_000).toISOString(),
            lastReceivedAt: new Date(endTsMs - 20_000).toISOString()
          },
          {
            stream: "scores",
            frames: 2,
            jsonDataFrames: 2,
            exactFixtureDataFrames: 2,
            usableExactFixtureOddsFrames: 0,
            completedExactFixtureScoreFrames: 1,
            firstReceivedAt: new Date(startTsMs + 30_000).toISOString(),
            lastReceivedAt: new Date(endTsMs - 30_000).toISOString()
          }
        ],
        error: null
      };
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify(txlineManifest)}\n`);
      await expect(verifyTerminalCaptureEvidence(repoRoot, config)).resolves.toMatchObject({
        windowStartUtc: config.capture.scheduledStartUtc,
        windowEndUtc: config.capture.scheduledEndUtc,
        synchronizedStartUtc: new Date(startTsMs + 30_000).toISOString(),
        synchronizedEndUtc: new Date(endTsMs - 30_000).toISOString()
      });
      await writeFile(join(polymarketDir, "capture-manifest.json"), `${JSON.stringify({
        ...manifest,
        stats: {
          ...manifest.stats,
          inScopeBookEvents: 0,
          eventTypes: { heartbeat_pong: 20 }
        }
      })}\n`);
      await expect(verifyTerminalCaptureEvidence(repoRoot, config)).rejects.toThrow();
      await writeFile(join(polymarketDir, "capture-manifest.json"), `${JSON.stringify(manifest)}\n`);
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify({
        ...txlineManifest,
        streams: txlineManifest.streams.map((stream) => stream.stream === "odds"
          ? { ...stream, exactFixtureDataFrames: 0, usableExactFixtureOddsFrames: 0 }
          : stream)
      })}\n`);
      await expect(verifyTerminalCaptureEvidence(repoRoot, config)).rejects.toThrow(/usable TXLine odds/);
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify(txlineManifest)}\n`);
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify({
        ...txlineManifest,
        streams: txlineManifest.streams.map((stream) => stream.stream === "scores"
          ? { ...stream, exactFixtureDataFrames: 0 }
          : stream)
      })}\n`);
      await expect(verifyTerminalCaptureEvidence(repoRoot, config)).rejects.toThrow(/scores for the exact fixture/);
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify(txlineManifest)}\n`);
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify({
        ...txlineManifest,
        streams: txlineManifest.streams.map((stream) => stream.stream === "scores"
          ? { ...stream, completedExactFixtureScoreFrames: 0 }
          : stream)
      })}\n`);
      await expect(verifyTerminalCaptureEvidence(repoRoot, config)).rejects.toThrow(/game_finalised/);
      await writeFile(join(txlineDir, "txline-capture-manifest.json"), `${JSON.stringify(txlineManifest)}\n`);
      await writeFile(join(polymarketDir, "capture-manifest.json"), `${JSON.stringify({ ...manifest, status: "failed" })}\n`);
      await expect(verifyTerminalCaptureEvidence(repoRoot, config)).rejects.toThrow();
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
