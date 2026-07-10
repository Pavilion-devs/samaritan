import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
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

type AssetRecord = {
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

function activeAssetRecords(
  events: GammaEvent[],
  eventSlugs: Set<string>,
  maxAssets: number
): AssetRecord[] {
  const now = Date.now();
  const records: AssetRecord[] = [];
  for (const { event, market } of relevantMarkets(events)) {
    if (eventSlugs.size > 0 && !eventSlugs.has(String(event.slug ?? ""))) continue;
    if (market.closed === true || market.active === false || market.acceptingOrders === false || market.enableOrderBook === false) continue;
    const kickoffMs = marketKickoffMs(market, event);
    if (kickoffMs < now - 6 * 60 * 60_000) continue;
    const tokenIds = parseStringArray(market.clobTokenIds);
    const outcomes = parseStringArray(market.outcomes);
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
      if (records.length >= maxAssets) return records;
    }
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
}): Promise<AssetRecord[]> {
  const discovery = await discoverWorldCupEvents({
    outDir: join(options.outDir, "discovery"),
    manifestLogPath: options.runLogPath,
    openOnly: true
  });
  return activeAssetRecords(discovery.matchEvents, options.eventSlugs, options.maxAssets);
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
        void discoverAssets(options)
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
        if (items.length === 0) eventTypes.push(rawPayload.toLocaleLowerCase() === "pong" ? "heartbeat_pong" : "unparsed");
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
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "capture deadline");
      } else finish();
    }, Math.max(1, options.deadline - Date.now()));
  });

  if (forcedTimer) clearTimeout(forcedTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (discoveryTimer) clearInterval(discoveryTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
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
  durationMinutes: number;
  runLabel: string;
}): ChildProcess {
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
      "--duration-minutes",
      String(options.durationMinutes),
      "--run-label",
      options.runLabel
    ],
    { cwd: PHASE0_DIR, stdio: "inherit" }
  );
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
  nextFixture?: TxFixture;
}): Promise<void> {
  const nextTeams = options.nextFixture
    ? `${options.nextFixture.Participant1 ?? ""}-${options.nextFixture.Participant2 ?? ""}`.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "next-world-cup-match";
  const nextDate = options.nextFixture ? new Date(fixtureStartMs(options.nextFixture)).toISOString().slice(0, 10) : "date";
  const fullCommand = options.nextFixture
    ? `cd phase0 && pnpm capture:paired -- --network mainnet --txline-fixture-id ${options.nextFixture.FixtureId} --duration-minutes 300 --run-label paired-${nextTeams}-${nextDate}`
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
    `Started: ${options.startedAt}`,
    `Ended: ${options.endedAt}`,
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
    "Rolling Gamma discovery remains enabled during capture and dynamically subscribes newly listed in-scope Match Result/full-time totals asset IDs.",
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

async function main(): Promise<void> {
  const args = parseArgs();
  const runLabel = (stringArg(args, "run-label", `polymarket-ws-smoke-${timestampSlug()}`) ?? timestampSlug())
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  const durationMinutes = numberArg(args, "duration-minutes", 0);
  const durationSeconds = numberArg(args, "duration-seconds", durationMinutes > 0 ? durationMinutes * 60 : 45);
  const maxAssets = Math.max(1, Math.floor(numberArg(args, "max-assets", 500)));
  const discoveryIntervalMs = Math.max(15_000, numberArg(args, "discovery-interval-seconds", 60) * 1000);
  const forceReconnectAfterMs = Math.max(0, numberArg(args, "force-reconnect-after-seconds", 0) * 1000);
  const eventSlugs = new Set((stringArg(args, "event-slugs", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const explicitAssetIds = (stringArg(args, "asset-ids", "") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const paired = boolArg(args.paired);
  const txlineFixtureId = stringArg(args, "txline-fixture-id", "") ?? "";
  if (paired && !txlineFixtureId) throw new Error("--paired requires --txline-fixture-id after human mapping confirmation");

  const outDir = join(SAMPLES_DIR, "polymarket-live", runLabel);
  const runLogPath = join(outDir, "reconnects.ndjson");
  await ensureDir(outDir);
  const initialRecords = await discoverAssets({ outDir, runLogPath, eventSlugs, maxAssets });
  const discoveredAssets = new Map(initialRecords.map((record) => [record.assetId, record]));
  const subscribedAssets = new Set([...explicitAssetIds, ...initialRecords.map((record) => record.assetId)].slice(0, maxAssets));
  if (subscribedAssets.size === 0) throw new Error("No active in-scope asset IDs were discovered; pass --asset-ids for an explicit smoke test");
  await writeAtomicJson(join(outDir, "subscriptions.json"), [...discoveredAssets.values()]);

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
    discoveredAssets,
    subscribedAssets
  };
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationSeconds * 1000;
  const stopState: { stopped: boolean; socket?: WebSocket } = { stopped: false };
  let txlineChild: ChildProcess | undefined;
  const stop = () => {
    stopState.stopped = true;
    if (stopState.socket?.readyState === WebSocket.OPEN || stopState.socket?.readyState === WebSocket.CONNECTING) {
      stopState.socket.close(1000, "process signal");
    }
    if (txlineChild && txlineChild.exitCode === null) txlineChild.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await logManifest({
    type: "polymarket-ws-run-start",
    endpoint: POLYMARKET_WS_URL,
    runId: runLabel,
    rows: subscribedAssets.size,
    path: outDir,
    paired,
    txlineFixtureId: txlineFixtureId || undefined
  });
  if (paired) {
    txlineChild = spawnTxlineCapture({
      network: stringArg(args, "network", "mainnet") ?? "mainnet",
      fixtureId: txlineFixtureId,
      durationMinutes: durationSeconds / 60,
      runLabel
    });
  }
  let captureError: unknown;
  try {
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
  } catch (error) {
    captureError = error;
    stop();
  }
  if (txlineChild) {
    const exitCode = await new Promise<number | null>((resolve) => {
      if (txlineChild!.exitCode !== null) resolve(txlineChild!.exitCode);
      else txlineChild!.once("exit", resolve);
    });
    if (exitCode !== 0 && captureError === undefined) captureError = new Error(`TXLine capture exited with code ${exitCode}`);
  }
  const endedAt = new Date().toISOString();
  const nextFixture = await nextPairedFixture([...discoveredAssets.values()]);
  await writeLiveReport({
    reportPath: join(SAMPLES_DIR, "POLYMARKET-LIVE.md"),
    outDir,
    runLabel,
    startedAt,
    endedAt,
    stats,
    nextFixture
  });
  await logManifest({
    type: "polymarket-ws-run-end",
    endpoint: POLYMARKET_WS_URL,
    runId: runLabel,
    rows: stats.messages,
    path: outDir,
    eventTypes: Object.fromEntries(stats.eventTypes),
    reconnects: stats.reconnects
  });
  if (captureError) throw captureError;
  console.log(`Polymarket WebSocket capture complete: ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
