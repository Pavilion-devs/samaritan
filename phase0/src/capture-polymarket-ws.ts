import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import {
  captureStartupFailure,
  parseAbsoluteCaptureWindow,
  type AbsoluteCaptureWindow
} from "./capture-window.js";
import {
  appendJsonl,
  boolArg,
  ensureDir,
  logManifest,
  numberArg,
  parseArgs,
  PHASE0_DIR,
  readJson,
  SAMPLES_DIR,
  stringArg,
  timestampSlug
} from "./lib.js";
import {
  type AnyRecord,
  discoverEventsByExactSlugs,
  discoverWorldCupEvents,
  type GammaEvent,
  type GammaMarket,
  marketKickoffMs,
  parseStringArray,
  POLYMARKET_WS_URL,
  relevantMarkets,
  sleep,
  writeAtomicJson,
  writeAtomicText
} from "./polymarket-lib.js";

export type AssetRecord = {
  assetId: string;
  outcome: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  teams: string[];
  kickoffMs: number;
  marketId: string;
  conditionId: string;
  question: string;
  sportsMarketType: string;
  line: number | string | null;
};

type TxFixture = AnyRecord & {
  FixtureId?: number;
  Participant1?: string;
  Participant2?: string;
  StartTime?: number | string;
};

type CaptureStats = {
  messages: number;
  parsedItems: number;
  eventTypes: Map<string, number>;
  connects: number;
  opens: number;
  disconnects: number;
  reconnects: number;
  forcedReconnects: number;
  parseErrors: number;
  transportHeartbeats: number;
  inScopeBookEvents: number;
  inScopeBookSnapshots: number;
  discoveredAssets: Map<string, AssetRecord>;
  subscribedAssets: Set<string>;
};

const WALL_CLOCK_ANCHOR_NS = BigInt(Date.now()) * 1_000_000n;
const MONOTONIC_ANCHOR_NS = process.hrtime.bigint();

function receiveTiming(): { unixNs: string; monotonicNs: string } {
  const monotonic = process.hrtime.bigint();
  return {
    unixNs: (WALL_CLOCK_ANCHOR_NS + monotonic - MONOTONIC_ANCHOR_NS).toString(),
    monotonicNs: monotonic.toString()
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function eventTeams(event: GammaEvent): string[] {
  const enriched = (event.teams ?? []).map((team) => String(team.name ?? "").trim()).filter(Boolean);
  if (enriched.length >= 2) return enriched.slice(0, 2);
  const title = String(event.title ?? "").split(" - ")[0];
  const parts = title.split(/\s+vs\.?\s+/i).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? parts : [];
}

function marketSortKey(event: GammaEvent, market: GammaMarket): string {
  const typePriority = market.sportsMarketType === "moneyline" ? "0" : "1";
  const line = typeof market.line === "number" ? String(market.line + 1_000).padStart(8, "0") : "00000000";
  return [
    typePriority,
    line,
    String(event.slug ?? ""),
    String(market.id ?? market.conditionId ?? ""),
    String(market.question ?? "")
  ].join("|");
}

export function selectSupportedAssetRecords(
  events: GammaEvent[],
  eventSlugs: Set<string>,
  maxAssets: number
): AssetRecord[] {
  const now = Date.now();
  const records: AssetRecord[] = [];
  const supported = relevantMarkets(events)
    .filter(({ event, market }) => {
      if (eventSlugs.size > 0 && !eventSlugs.has(String(event.slug ?? ""))) return false;
      return market.closed !== true && market.active !== false &&
        market.acceptingOrders !== false && market.enableOrderBook !== false &&
        marketKickoffMs(market, event) >= now - 6 * 60 * 60_000;
    })
    .sort((left, right) => marketSortKey(left.event, left.market).localeCompare(marketSortKey(right.event, right.market)));
  if (eventSlugs.size > 0) {
    const [matchResultSlug, totalsSlug] = [...eventSlugs];
    const matchResultMarkets = supported.filter(({ event, market }) =>
      event.slug === matchResultSlug && market.sportsMarketType === "moneyline"
    );
    const totalsMarkets = supported.filter(({ event, market }) =>
      event.slug === totalsSlug && market.sportsMarketType === "totals"
    );
    if (matchResultMarkets.length !== 3) {
      throw new Error(`Exact capture requires three active Match Result conditions; found ${matchResultMarkets.length}`);
    }
    if (totalsMarkets.length === 0) {
      throw new Error("Exact capture requires at least one active full-time totals condition");
    }
  }
  for (const { event, market } of supported) {
    if (eventSlugs.size > 0 && !eventSlugs.has(String(event.slug ?? ""))) continue;
    const kickoffMs = marketKickoffMs(market, event);
    const tokenIds = parseStringArray(market.clobTokenIds);
    const outcomes = parseStringArray(market.outcomes);
    if (tokenIds.length !== 2 || outcomes.length !== 2) {
      throw new Error(`Supported market ${String(market.id ?? market.conditionId ?? "<unknown>")} lacks its required outcome pair`);
    }
    for (const [index, assetId] of tokenIds.entries()) {
      records.push({
        assetId,
        outcome: outcomes[index] ?? `outcome-${index}`,
        eventId: String(event.id ?? ""),
        eventSlug: String(event.slug ?? ""),
        eventTitle: String(event.title ?? ""),
        teams: eventTeams(event),
        kickoffMs,
        marketId: String(market.id ?? ""),
        conditionId: String(market.conditionId ?? ""),
        question: String(market.question ?? ""),
        sportsMarketType: String(market.sportsMarketType ?? ""),
        line: market.line ?? null
      });
    }
  }
  records.sort((left, right) => {
    const type = (left.sportsMarketType === "moneyline" ? 0 : 1) - (right.sportsMarketType === "moneyline" ? 0 : 1);
    if (type !== 0) return type;
    const line = Number(left.line ?? -1) - Number(right.line ?? -1);
    if (line !== 0) return line;
    const market = left.marketId.localeCompare(right.marketId);
    if (market !== 0) return market;
    return left.assetId.localeCompare(right.assetId);
  });
  if (records.length > maxAssets) {
    throw new Error(`Required supported strategy assets (${records.length}) exceed --max-assets ${maxAssets}`);
  }
  return records;
}

async function dataAsString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (typeof Blob !== "undefined" && data instanceof Blob) return Buffer.from(await data.arrayBuffer()).toString("utf8");
  return String(data);
}

function parsedItems(raw: string): AnyRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed.filter((item): item is AnyRecord => Boolean(item) && typeof item === "object");
  return parsed && typeof parsed === "object" ? [parsed as AnyRecord] : [];
}

function itemAssetIds(item: AnyRecord): string[] {
  const ids = new Set<string>();
  if (item.asset_id !== undefined) ids.add(String(item.asset_id));
  if (Array.isArray(item.assets_ids)) for (const value of item.assets_ids) ids.add(String(value));
  if (Array.isArray(item.price_changes)) {
    for (const value of item.price_changes) {
      if (value && typeof value === "object" && (value as AnyRecord).asset_id !== undefined) {
        ids.add(String((value as AnyRecord).asset_id));
      }
    }
  }
  return [...ids];
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

async function discoverAssets(options: {
  outDir: string;
  runLogPath: string;
  eventSlugs: Set<string>;
  maxAssets: number;
  deadlineTsMs?: number;
}): Promise<AssetRecord[]> {
  const discoveryOutDir = join(options.outDir, "discovery");
  const events = options.eventSlugs.size > 0
    ? (await discoverEventsByExactSlugs({
        outDir: discoveryOutDir,
        eventSlugs: options.eventSlugs,
        manifestLogPath: options.runLogPath,
        deadlineTsMs: options.deadlineTsMs
      })).events
    : (await discoverWorldCupEvents({
        outDir: discoveryOutDir,
        manifestLogPath: options.runLogPath,
        openOnly: true
      })).matchEvents;
  return selectSupportedAssetRecords(events, options.eventSlugs, options.maxAssets);
}

const REAL_BOOK_EVENT_TYPES = new Set(["book", "price_change", "best_bid_ask"]);

export function isInScopeRealBookItem(item: AnyRecord, subscribedAssets: ReadonlySet<string>): boolean {
  const eventType = String(item.event_type ?? "");
  if (!REAL_BOOK_EVENT_TYPES.has(eventType)) return false;
  const assets = itemAssetIds(item);
  return assets.length > 0 && assets.some((assetId) => subscribedAssets.has(assetId));
}

function subscribe(socket: WebSocket, assetIds: string[], operation?: "subscribe"): void {
  for (const group of chunks(assetIds, 100)) {
    if (group.length === 0) continue;
    socket.send(JSON.stringify(operation
      ? { assets_ids: group, operation, custom_feature_enabled: true }
      : { assets_ids: group, type: "market", custom_feature_enabled: true }));
  }
}

async function connectionCycle(options: {
  connectionIndex: number;
  deadline: number;
  outDir: string;
  runLogPath: string;
  stats: CaptureStats;
  eventSlugs: Set<string>;
  maxAssets: number;
  discoveryIntervalMs: number;
  forceReconnectAfterMs: number;
  forceState: { used: boolean };
  stopState: { stopped: boolean; socket?: WebSocket };
}): Promise<void> {
  const socket = new WebSocket(POLYMARKET_WS_URL);
  options.stopState.socket = socket;
  options.stats.connects += 1;
  await appendJsonl(options.runLogPath, {
    at: new Date().toISOString(),
    action: "connect",
    connectionIndex: options.connectionIndex,
    assets: options.stats.subscribedAssets.size
  });

  let writeQueue = Promise.resolve();
  let discoveryBusy = false;
  let opened = false;
  let forcedTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let discoveryTimer: ReturnType<typeof setInterval> | undefined;
  let discoveryTask: Promise<void> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    socket.addEventListener("open", () => {
      opened = true;
      options.stats.opens += 1;
      if (options.connectionIndex > 0) options.stats.reconnects += 1;
      subscribe(socket, [...options.stats.subscribedAssets]);
      writeQueue = writeQueue.then(() => appendJsonl(options.runLogPath, {
        at: new Date().toISOString(),
        action: "open-and-resubscribe",
        connectionIndex: options.connectionIndex,
        assets: options.stats.subscribedAssets.size
      }));
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("PING");
      }, 10_000);
      discoveryTimer = setInterval(() => {
        if (discoveryBusy || options.stopState.stopped || Date.now() >= options.deadline) return;
        discoveryBusy = true;
        discoveryTask = discoverAssets({
          ...options,
          deadlineTsMs: Math.min(options.deadline, Date.now() + 60_000)
        })
          .then(async (records) => {
            const additions: string[] = [];
            for (const record of records) {
              options.stats.discoveredAssets.set(record.assetId, record);
              if (!options.stats.subscribedAssets.has(record.assetId)) {
                options.stats.subscribedAssets.add(record.assetId);
                additions.push(record.assetId);
              }
            }
            if (additions.length > 0 && socket.readyState === WebSocket.OPEN) {
              subscribe(socket, additions, "subscribe");
              await appendJsonl(options.runLogPath, {
                at: new Date().toISOString(),
                action: "rolling-discovery-subscribe",
                connectionIndex: options.connectionIndex,
                additions
              });
              await writeAtomicJson(join(options.outDir, "subscriptions.json"), [...options.stats.discoveredAssets.values()]);
            }
          })
          .catch((error: unknown) => appendJsonl(options.runLogPath, {
            at: new Date().toISOString(),
            action: "rolling-discovery-error",
            error: error instanceof Error ? error.message : String(error)
          }))
          .finally(() => {
            discoveryBusy = false;
          });
      }, options.discoveryIntervalMs);
      if (options.forceReconnectAfterMs > 0 && !options.forceState.used) {
        forcedTimer = setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) {
            options.forceState.used = true;
            options.stats.forcedReconnects += 1;
            void appendJsonl(options.runLogPath, {
              at: new Date().toISOString(),
              action: "intentional-smoke-reconnect",
              connectionIndex: options.connectionIndex
            });
            socket.close(4000, "intentional smoke reconnect");
          }
        }, options.forceReconnectAfterMs);
      }
    });
    socket.addEventListener("message", (message) => {
      const receivedAt = new Date();
      const timing = receiveTiming();
      writeQueue = writeQueue.then(async () => {
        const rawPayload = await dataAsString(message.data);
        options.stats.messages += 1;
        if (rawPayload === "ping") {
          if (socket.readyState === WebSocket.OPEN) socket.send("pong");
        }
        let items: AnyRecord[] = [];
        let parseError = "";
        if (rawPayload !== "PONG" && rawPayload !== "PING" && rawPayload !== "ping" && rawPayload !== "pong") {
          try {
            items = parsedItems(rawPayload);
          } catch (error) {
            options.stats.parseErrors += 1;
            parseError = error instanceof Error ? error.message : String(error);
          }
        }
        const eventTypes = items.map((item) => String(item.event_type ?? "unknown"));
        if (items.length === 0) {
          const heartbeat = rawPayload.toLocaleLowerCase() === "pong";
          eventTypes.push(heartbeat ? "heartbeat_pong" : "unparsed");
          if (heartbeat) options.stats.transportHeartbeats += 1;
        }
        const inScopeBookItems = items.filter((item) =>
          isInScopeRealBookItem(item, options.stats.subscribedAssets)
        );
        options.stats.inScopeBookEvents += inScopeBookItems.length;
        options.stats.inScopeBookSnapshots += inScopeBookItems.filter((item) => item.event_type === "book").length;
        const assetIds = [...new Set(items.flatMap(itemAssetIds))];
        for (const eventType of eventTypes) increment(options.stats.eventTypes, eventType);
        options.stats.parsedItems += items.length;
        await appendJsonl(join(options.outDir, "messages.ndjson"), {
          receivedAt: receivedAt.toISOString(),
          receivedAtUnixNs: timing.unixNs,
          receivedAtMonotonicNs: timing.monotonicNs,
          assetId: assetIds.length === 1 ? assetIds[0] : null,
          assetIds,
          eventType: eventTypes.length === 1 ? eventTypes[0] : "batch",
          eventTypes,
          rawPayload,
          parseError: parseError || null
        });
      });
    });
    socket.addEventListener("error", () => {
      writeQueue = writeQueue.then(() => appendJsonl(options.runLogPath, {
        at: new Date().toISOString(),
        action: "socket-error",
        connectionIndex: options.connectionIndex
      }));
    });
    socket.addEventListener("close", (close) => {
      options.stats.disconnects += 1;
      writeQueue = writeQueue.then(() => appendJsonl(options.runLogPath, {
        at: new Date().toISOString(),
        action: "disconnect",
        connectionIndex: options.connectionIndex,
        opened,
        code: close.code,
        reason: close.reason,
        clean: close.wasClean
      }));
      finish();
    });
    deadlineTimer = setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "capture deadline");
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      } else finish();
    }, Math.max(1, options.deadline - Date.now()));
  });

  if (forcedTimer) clearTimeout(forcedTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (discoveryTimer) clearInterval(discoveryTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (discoveryTask) await discoveryTask;
  await writeQueue;
}

async function runCapture(options: {
  deadline: number;
  outDir: string;
  runLogPath: string;
  stats: CaptureStats;
  eventSlugs: Set<string>;
  maxAssets: number;
  discoveryIntervalMs: number;
  forceReconnectAfterMs: number;
  stopState: { stopped: boolean; socket?: WebSocket };
}): Promise<void> {
  const forceState = { used: false };
  let connectionIndex = 0;
  while (!options.stopState.stopped && Date.now() < options.deadline) {
    await connectionCycle({ ...options, connectionIndex, forceState });
    if (options.stopState.stopped || Date.now() >= options.deadline) break;
    const delay = Math.min(15_000, 1_000 * 2 ** Math.min(connectionIndex, 4)) + Math.floor(Math.random() * 500);
    await appendJsonl(options.runLogPath, {
      at: new Date().toISOString(),
      action: "reconnect-backoff",
      connectionIndex,
      delayMs: delay
    });
    await sleep(Math.min(delay, Math.max(0, options.deadline - Date.now())));
    connectionIndex += 1;
  }
}

function spawnTxlineCapture(options: {
  network: string;
  fixtureId: string;
  runLabel: string;
  durationMinutes?: number;
  captureWindow?: AbsoluteCaptureWindow;
}): ChildProcess {
  const timingArgs = options.captureWindow
    ? [
        "--capture-start-utc",
        options.captureWindow.startUtc,
        "--capture-end-utc",
        options.captureWindow.endUtc,
        "--max-startup-skew-seconds",
        String(options.captureWindow.maxStartupSkewSeconds)
      ]
    : ["--duration-minutes", String(options.durationMinutes)];
  return spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      "src/capture-sse.ts",
      "--network",
      options.network,
      "--fixture-id",
      options.fixtureId,
      ...timingArgs,
      "--run-label",
      options.runLabel
    ],
    { cwd: PHASE0_DIR, stdio: "inherit" }
  );
}

export type PairedChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  atMs: number;
  spawnError?: string;
};

export const PAIRED_CHILD_DEADLINE_GRACE_MS = 15_000;

export function pairedChildExitFailure(options: {
  exit: PairedChildExit;
  deadline: number;
  nearDeadlineGraceMs?: number;
}): string | undefined {
  if (options.exit.spawnError) return `TXLine capture failed to spawn: ${options.exit.spawnError}`;
  if (options.exit.code !== 0) {
    const detail = options.exit.signal ? `signal ${options.exit.signal}` : `code ${String(options.exit.code)}`;
    return `TXLine capture exited with ${detail}`;
  }
  const remainingMs = options.deadline - options.exit.atMs;
  const graceMs = options.nearDeadlineGraceMs ?? PAIRED_CHILD_DEADLINE_GRACE_MS;
  if (remainingMs > graceMs) {
    return `TXLine capture exited ${remainingMs}ms before the shared deadline`;
  }
  return undefined;
}

function waitForChildExit(child: ChildProcess): Promise<PairedChildExit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode, atMs: Date.now() });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exit: PairedChildExit) => {
      if (settled) return;
      settled = true;
      child.off("error", onError);
      child.off("exit", onExit);
      resolve(exit);
    };
    const onError = (error: Error) => finish({
      code: child.exitCode,
      signal: child.signalCode,
      atMs: Date.now(),
      spawnError: error.message
    });
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish({
      code,
      signal,
      atMs: Date.now()
    });
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function fixtureStartMs(fixture: TxFixture): number {
  if (typeof fixture.StartTime === "number") return fixture.StartTime;
  const numeric = Number(fixture.StartTime);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(fixture.StartTime ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTeam(value: unknown): string {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ({
    usa: "united states",
    "korea republic": "south korea",
    czechia: "czech republic",
    turkiye: "turkey",
    "cabo verde": "cape verde"
  } as Record<string, string>)[normalized] ?? normalized;
}

async function nextPairedFixture(records: AssetRecord[]): Promise<TxFixture | undefined> {
  const fixturesPath = join(SAMPLES_DIR, "fixtures", "mainnet-world-cup-fixtures.json");
  if (!existsSync(fixturesPath)) return undefined;
  const fixtures = await readJson<TxFixture[]>(fixturesPath);
  const now = Date.now();
  return fixtures
    .filter((fixture) => fixtureStartMs(fixture) > now)
    .sort((a, b) => fixtureStartMs(a) - fixtureStartMs(b))
    .find((fixture) => records.some((record) => {
      const sameTeams = record.teams.map(normalizeTeam).sort().join("|") ===
        [fixture.Participant1, fixture.Participant2].map(normalizeTeam).sort().join("|");
      return sameTeams && Math.abs(record.kickoffMs - fixtureStartMs(fixture)) <= 15 * 60_000;
    }));
}

async function writeLiveReport(options: {
  reportPath: string;
  outDir: string;
  runLabel: string;
  startedAt: string;
  endedAt: string;
  stats: CaptureStats;
  status: "completed" | "failed";
  error?: string;
  eventSlugs: Set<string>;
  pairedChildExit?: PairedChildExit;
  nextFixture?: TxFixture;
}): Promise<void> {
  const nextTeams = options.nextFixture
    ? `${options.nextFixture.Participant1 ?? ""}-${options.nextFixture.Participant2 ?? ""}`.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "next-world-cup-match";
  const nextDate = options.nextFixture ? new Date(fixtureStartMs(options.nextFixture)).toISOString().slice(0, 10) : "date";
  const exactSlugArgument = options.eventSlugs.size > 0
    ? ` --event-slugs ${[...options.eventSlugs].join(",")}`
    : "";
  const fullCommand = options.nextFixture
    ? `cd phase0 && pnpm capture:paired -- --network mainnet --txline-fixture-id ${options.nextFixture.FixtureId} --duration-minutes 300 --run-label paired-${nextTeams}-${nextDate}${exactSlugArgument}`
    : "No exact TXLine↔Polymarket candidate is currently available; rerun discovery and human-confirm a fixture before a paired capture.";
  const expectedEventTypes = [
    "book",
    "price_change",
    "best_bid_ask",
    "last_trade_price",
    "tick_size_change",
    "new_market",
    "market_resolved",
    "heartbeat_pong"
  ];
  const eventTypeRows = [...new Set([...expectedEventTypes, ...options.stats.eventTypes.keys()])]
    .map((eventType) => [eventType, options.stats.eventTypes.get(eventType) ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const ready = (options.stats.eventTypes.get("book") ?? 0) > 0 && options.stats.subscribedAssets.size > 0;
  const lines = [
    "# Polymarket Live WebSocket Capture",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Read-only public market channel; no wallet, API key, authentication, order, approval, deposit, or money movement was used.",
    "",
    "## Smoke capture",
    "",
    `Run label: ${options.runLabel}`,
    `Terminal status: ${options.status}`,
    ...(options.error ? [`Failure: ${options.error}`] : []),
    `Started: ${options.startedAt}`,
    `Ended: ${options.endedAt}`,
    `Paired TXLine exit: ${options.pairedChildExit ? JSON.stringify(options.pairedChildExit) : "not paired / not observed"}`,
    `Raw output: ${options.outDir}`,
    `Raw socket messages: ${options.stats.messages}`,
    `Parsed event items: ${options.stats.parsedItems}`,
    `Parse errors: ${options.stats.parseErrors}`,
    `Subscribed asset IDs: ${options.stats.subscribedAssets.size}`,
    `Connection attempts: ${options.stats.connects}`,
    `Successful opens: ${options.stats.opens}`,
    `Disconnects: ${options.stats.disconnects}`,
    `Successful reconnects/resubscriptions: ${options.stats.reconnects}`,
    `Intentional smoke reconnects: ${options.stats.forcedReconnects}`,
    `Ready for a full paired capture: ${ready ? "yes" : "no — no initial book snapshot was observed"}`,
    "",
    "### Messages by event type",
    "",
    "| Event type | Count |",
    "|---|---:|",
    ...eventTypeRows.map(([eventType, count]) => `| ${eventType} | ${count} |`),
    "",
    "### Subscribed tokens",
    "",
    "| Asset ID | Outcome | Event | Market type | Line | Condition ID | Question |",
    "|---|---|---|---|---:|---|---|",
    ...[...options.stats.subscribedAssets].map((assetId) => {
      const record = options.stats.discoveredAssets.get(assetId);
      return `| ${assetId} | ${String(record?.outcome ?? "explicit").replaceAll("|", "\\|")} | ${String(record?.eventSlug ?? "").replaceAll("|", "\\|")} | ${record?.sportsMarketType ?? ""} | ${record?.line ?? ""} | ${record?.conditionId ?? ""} | ${String(record?.question ?? "").replaceAll("|", "\\|")} |`;
    }),
    "",
    "## Reconnect behavior",
    "",
    options.stats.forcedReconnects > 0
      ? `The smoke run intentionally closed one socket and observed ${options.stats.reconnects} successful reconnect/resubscription(s). Exact connect, close, backoff, and resubscription records are in \`reconnects.ndjson\`.`
      : "No reconnect was forced. Any natural disconnect and resubscription is recorded in `reconnects.ndjson`.",
    options.eventSlugs.size > 0
      ? `Rolling Gamma refresh was bounded to these exact event slugs; full World Cup pagination was disabled: ${[...options.eventSlugs].join(", ")}.`
      : "Rolling Gamma discovery remained enabled during capture and dynamically subscribed newly listed in-scope Match Result/full-time totals asset IDs.",
    "",
    "## Exact next full-match paired command",
    "",
    "```bash",
    fullCommand,
    "```",
    "",
    "The paired command runs the existing TXLine SSE recorder and this public Polymarket recorder under the same run label and waits for both processes to end. Human confirmation of the mapping remains mandatory."
  ];
  await writeAtomicText(options.reportPath, lines.join("\n"));
}

function captureStatsSnapshot(stats: CaptureStats): Record<string, unknown> {
  return {
    messages: stats.messages,
    parsedItems: stats.parsedItems,
    parseErrors: stats.parseErrors,
    transportHeartbeats: stats.transportHeartbeats,
    inScopeBookEvents: stats.inScopeBookEvents,
    inScopeBookSnapshots: stats.inScopeBookSnapshots,
    discoveredAssets: stats.discoveredAssets.size,
    subscribedAssets: stats.subscribedAssets.size,
    connects: stats.connects,
    opens: stats.opens,
    disconnects: stats.disconnects,
    reconnects: stats.reconnects,
    forcedReconnects: stats.forcedReconnects,
    eventTypes: Object.fromEntries(stats.eventTypes)
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function main(): Promise<void> {
  const args = parseArgs();
  const runLabel = (stringArg(args, "run-label", `polymarket-ws-smoke-${timestampSlug()}`) ?? timestampSlug())
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  const durationMinutes = numberArg(args, "duration-minutes", 0);
  const durationSeconds = numberArg(args, "duration-seconds", durationMinutes > 0 ? durationMinutes * 60 : 45);
  const maxAssets = Math.max(1, Math.floor(numberArg(args, "max-assets", 500)));
  const discoveryIntervalMs = Math.max(15_000, numberArg(args, "discovery-interval-seconds", 60) * 1000);
  const forceReconnectAfterMs = Math.max(0, numberArg(args, "force-reconnect-after-seconds", 0) * 1000);
  const captureWindow = parseAbsoluteCaptureWindow({
    startUtc: stringArg(args, "capture-start-utc"),
    endUtc: stringArg(args, "capture-end-utc"),
    maxStartupSkewSeconds: numberArg(args, "max-startup-skew-seconds", 120)
  });
  const eventSlugs = new Set((stringArg(args, "event-slugs", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const explicitAssetIds = (stringArg(args, "asset-ids", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const paired = boolArg(args.paired);
  const txlineFixtureId = stringArg(args, "txline-fixture-id", "") ?? "";
  if (paired && !txlineFixtureId) throw new Error("--paired requires --txline-fixture-id after human mapping confirmation");

  const outDir = join(SAMPLES_DIR, "polymarket-live", runLabel);
  const runLogPath = join(outDir, "reconnects.ndjson");
  const terminalManifestPath = join(outDir, "capture-manifest.json");
  await ensureDir(outDir);
  const discoveredAssets = new Map<string, AssetRecord>();
  const subscribedAssets = new Set<string>();
  const stats: CaptureStats = {
    messages: 0,
    parsedItems: 0,
    eventTypes: new Map(),
    connects: 0,
    opens: 0,
    disconnects: 0,
    reconnects: 0,
    forcedReconnects: 0,
    parseErrors: 0,
    transportHeartbeats: 0,
    inScopeBookEvents: 0,
    inScopeBookSnapshots: 0,
    discoveredAssets,
    subscribedAssets
  };
  const startedAt = new Date().toISOString();
  let captureStartedAt: string | null = null;
  let deadline = captureWindow?.endTsMs ?? 0;
  const stopState: { stopped: boolean; socket?: WebSocket } = { stopped: false };
  let txlineChild: ChildProcess | undefined;
  let txlineExitPromise: Promise<PairedChildExit> | undefined;
  let pairedChildExit: PairedChildExit | undefined;
  let pairedChildError: Error | undefined;
  let interruptedSignal: "SIGINT" | "SIGTERM" | undefined;
  const stop = () => {
    stopState.stopped = true;
    if (stopState.socket?.readyState === WebSocket.OPEN) {
      stopState.socket.close(1000, "process signal");
    } else if (stopState.socket?.readyState === WebSocket.CONNECTING) {
      stopState.socket.terminate();
    }
    if (txlineChild && txlineChild.exitCode === null && txlineChild.signalCode === null) txlineChild.kill("SIGTERM");
  };
  const onSigint = () => {
    interruptedSignal = "SIGINT";
    stop();
  };
  const onSigterm = () => {
    interruptedSignal = "SIGTERM";
    stop();
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const writeRunManifest = async (
    status: "running" | "completed" | "failed",
    endedAt?: string,
    error?: string
  ) => writeAtomicJson(terminalManifestPath, {
    schemaVersion: 2,
    runId: runLabel,
    status,
    startedAt,
    captureStartedAt,
    endedAt: endedAt ?? null,
    deadlineAt: deadline > 0 ? new Date(deadline).toISOString() : null,
    captureWindow: captureWindow === null ? null : {
      startUtc: captureWindow.startUtc,
      endUtc: captureWindow.endUtc,
      maxStartupSkewSeconds: captureWindow.maxStartupSkewSeconds
    },
    endpoint: POLYMARKET_WS_URL,
    paired,
    txlineFixtureId: txlineFixtureId || null,
    exactEventSlugs: [...eventSlugs],
    fullWorldCupDiscovery: eventSlugs.size === 0,
    stats: captureStatsSnapshot(stats),
    pairedChildExit: pairedChildExit ?? null,
    error: error ?? null
  });

  await writeRunManifest("running");
  try {
    await logManifest({
      type: "polymarket-ws-run-start",
      endpoint: POLYMARKET_WS_URL,
      runId: runLabel,
      rows: 0,
      path: outDir,
      paired,
      txlineFixtureId: txlineFixtureId || undefined,
      exactEventSlugs: [...eventSlugs]
    });

    const initialRecords = await discoverAssets({
      outDir,
      runLogPath,
      eventSlugs,
      maxAssets,
      ...(captureWindow ? {
        deadlineTsMs: captureWindow.startTsMs + captureWindow.maxStartupSkewSeconds * 1_000
      } : {})
    });
    for (const record of initialRecords) discoveredAssets.set(record.assetId, record);
    for (const assetId of [...explicitAssetIds, ...initialRecords.map((record) => record.assetId)].slice(0, maxAssets)) {
      subscribedAssets.add(assetId);
    }
    if (subscribedAssets.size === 0) {
      throw new Error("No active in-scope asset IDs were discovered; pass --asset-ids for an explicit smoke test");
    }
    await writeAtomicJson(join(outDir, "subscriptions.json"), [...discoveredAssets.values()]);
    if (interruptedSignal) throw new Error(`Capture interrupted by ${interruptedSignal}`);
    if (captureWindow) {
      const waitMs = captureWindow.startTsMs - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      const startupFailure = captureStartupFailure(captureWindow, Date.now());
      if (startupFailure) throw new Error(startupFailure);
      deadline = captureWindow.endTsMs;
    } else {
      deadline = Date.now() + durationSeconds * 1_000;
    }
    captureStartedAt = new Date().toISOString();
    await writeRunManifest("running");

    if (paired) {
      txlineChild = spawnTxlineCapture({
        network: stringArg(args, "network", "mainnet") ?? "mainnet",
        fixtureId: txlineFixtureId,
        runLabel,
        ...(captureWindow ? { captureWindow } : { durationMinutes: durationSeconds / 60 })
      });
      txlineExitPromise = waitForChildExit(txlineChild);
      void txlineExitPromise.then((exit) => {
        pairedChildExit = exit;
        const failure = pairedChildExitFailure({ exit, deadline });
        if (!failure) return;
        pairedChildError = new Error(failure);
        stop();
      });
    }

    await runCapture({
      deadline,
      outDir,
      runLogPath,
      stats,
      eventSlugs,
      maxAssets,
      discoveryIntervalMs,
      forceReconnectAfterMs,
      stopState
    });
    if (txlineExitPromise) pairedChildExit = await txlineExitPromise;
    if (pairedChildError) throw pairedChildError;
    if (interruptedSignal) throw new Error(`Capture interrupted by ${interruptedSignal}`);

    const endedAt = new Date().toISOString();
    const nextFixture = await nextPairedFixture([...discoveredAssets.values()]);
    const reportOptions = {
      outDir,
      runLabel,
      startedAt,
      endedAt,
      stats,
      status: "completed" as const,
      eventSlugs,
      pairedChildExit,
      nextFixture
    };
    await writeLiveReport({ ...reportOptions, reportPath: join(outDir, "REPORT.md") });
    await writeLiveReport({ ...reportOptions, reportPath: join(SAMPLES_DIR, "POLYMARKET-LIVE.md") });
    await writeRunManifest("completed", endedAt);
    await logManifest({
      type: "polymarket-ws-run-end",
      status: "completed",
      endpoint: POLYMARKET_WS_URL,
      runId: runLabel,
      rows: stats.messages,
      path: outDir,
      eventTypes: Object.fromEntries(stats.eventTypes),
      reconnects: stats.reconnects,
      pairedChildExit: pairedChildExit ?? null
    });
    console.log(`Polymarket WebSocket capture complete: ${outDir}`);
  } catch (error) {
    stop();
    if (txlineExitPromise) pairedChildExit = await txlineExitPromise;
    const endedAt = new Date().toISOString();
    const failure = errorMessage(error);
    const nextFixture = await nextPairedFixture([...discoveredAssets.values()]).catch(() => undefined);
    const reportOptions = {
      outDir,
      runLabel,
      startedAt,
      endedAt,
      stats,
      status: "failed" as const,
      error: failure,
      eventSlugs,
      pairedChildExit,
      nextFixture
    };
    let reportError = "";
    try {
      await writeLiveReport({ ...reportOptions, reportPath: join(outDir, "REPORT.md") });
      await writeLiveReport({ ...reportOptions, reportPath: join(SAMPLES_DIR, "POLYMARKET-LIVE.md") });
    } catch (writeError) {
      reportError = errorMessage(writeError);
    }
    const terminalError = reportError ? `${failure}\nReport write failed: ${reportError}` : failure;
    await writeRunManifest("failed", endedAt, terminalError);
    await logManifest({
      type: "polymarket-ws-run-end",
      status: "failed",
      endpoint: POLYMARKET_WS_URL,
      runId: runLabel,
      rows: stats.messages,
      path: outDir,
      eventTypes: Object.fromEntries(stats.eventTypes),
      reconnects: stats.reconnects,
      pairedChildExit: pairedChildExit ?? null,
      error: terminalError
    }).catch(() => undefined);
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
