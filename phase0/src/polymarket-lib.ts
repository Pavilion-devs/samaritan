import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  appendJsonl,
  ensureDir,
  logManifest,
  timestampSlug
} from "./lib.js";

export const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";
export const CLOB_ORIGIN = "https://clob.polymarket.com";
export const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
export const WORLD_CUP_START = Date.parse("2026-06-11T00:00:00Z");
export const WORLD_CUP_END = Date.parse("2026-07-20T12:00:00Z");

export type AnyRecord = Record<string, unknown>;

export type GammaTeam = AnyRecord & {
  id?: string | number;
  name?: string;
  abbreviation?: string;
  ordering?: string;
};

export type GammaMarket = AnyRecord & {
  id?: string;
  question?: string;
  slug?: string;
  conditionId?: string;
  description?: string;
  sportsMarketType?: string;
  line?: number | string | null;
  gameStartTime?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
  orderPriceMinTickSize?: number;
  orderMinSize?: number;
  makerBaseFee?: number;
  takerBaseFee?: number;
  feesEnabled?: boolean;
  feeSchedule?: AnyRecord;
  acceptingOrders?: boolean;
  acceptingOrdersTimestamp?: string;
  startDate?: string;
  endDate?: string;
  closedTime?: string;
  active?: boolean;
  closed?: boolean;
  enableOrderBook?: boolean;
  volume?: string | number;
  volumeNum?: number;
  liquidity?: string | number;
  liquidityNum?: number;
};

export type GammaEvent = AnyRecord & {
  id?: string;
  slug?: string;
  title?: string;
  description?: string;
  startDate?: string;
  creationDate?: string;
  endDate?: string;
  startTime?: string;
  eventDate?: string;
  closedTime?: string;
  active?: boolean;
  closed?: boolean;
  gameId?: string | number;
  teams?: GammaTeam[];
  tags?: AnyRecord[];
  series?: AnyRecord[];
  markets?: GammaMarket[];
};

export type SportsMetadata = AnyRecord & {
  sport?: string;
  tags?: string;
  series?: string;
  resolution?: string;
};

export type DiscoveryResult = {
  sports: SportsMetadata[];
  worldCupSport: SportsMetadata;
  sourceEvents: GammaEvent[];
  matchEvents: GammaEvent[];
  tagIds: string[];
  seriesId: string;
  discoveryId: string;
};

export type FetchResult = {
  ok: boolean;
  status: number;
  text: string;
  contentType: string;
  attempts: number;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<FetchResult> {
  const attempts = Math.max(1, options.attempts ?? 6);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 20_000);
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      if (response.ok || (response.status < 500 && response.status !== 429)) {
        return {
          ok: response.ok,
          status: response.status,
          text,
          contentType: response.headers.get("content-type") ?? "",
          attempts: attempt
        };
      }
      lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;
      if (attempt === attempts) {
        return {
          ok: false,
          status: response.status,
          text,
          contentType: response.headers.get("content-type") ?? "",
          attempts: attempt
        };
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.max(1, exponential * 0.35));
      await sleep(retryAfterMs(response.headers.get("retry-after")) ?? exponential + jitter);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) {
        const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        const jitter = Math.floor(Math.random() * Math.max(1, exponential * 0.35));
        await sleep(exponential + jitter);
      }
    }
  }
  return { ok: false, status: 0, text: lastError, contentType: "", attempts };
}

export async function writeAtomicText(path: string, text: string): Promise<void> {
  await ensureDir(dirname(path));
  const temporaryPath = `${path}.tmp-${process.pid}-${timestampSlug()}`;
  await writeFile(temporaryPath, text);
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await writeAtomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function eventSeriesIds(event: GammaEvent): string[] {
  return (event.series ?? [])
    .map((series) => String(series.id ?? ""))
    .filter(Boolean);
}

export function eventTagIds(event: GammaEvent): string[] {
  return (event.tags ?? [])
    .map((tag) => String(tag.id ?? ""))
    .filter(Boolean);
}

export function marketKickoffMs(market: GammaMarket, event: GammaEvent): number {
  for (const value of [market.gameStartTime, event.startTime, event.endDate]) {
    const parsed = Date.parse(String(value ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function eventKickoffMs(event: GammaEvent): number {
  const marketKickoffs = (event.markets ?? [])
    .map((market) => marketKickoffMs(market, event))
    .filter((value) => value > 0);
  if (marketKickoffs.length > 0) return Math.min(...marketKickoffs);
  const direct = Date.parse(String(event.startTime ?? event.endDate ?? ""));
  return Number.isFinite(direct) ? direct : 0;
}

export function isRelevantResearchMarket(market: GammaMarket): boolean {
  return market.sportsMarketType === "moneyline" || market.sportsMarketType === "totals";
}

export function relevantMarkets(events: GammaEvent[]): Array<{ event: GammaEvent; market: GammaMarket }> {
  const seen = new Set<string>();
  const rows: Array<{ event: GammaEvent; market: GammaMarket }> = [];
  for (const event of events) {
    for (const market of event.markets ?? []) {
      const id = String(market.id ?? market.conditionId ?? "");
      if (!id || seen.has(id) || !isRelevantResearchMarket(market)) continue;
      seen.add(id);
      rows.push({ event, market });
    }
  }
  return rows.sort((a, b) => {
    const kickoff = eventKickoffMs(a.event) - eventKickoffMs(b.event);
    if (kickoff !== 0) return kickoff;
    const type = String(a.market.sportsMarketType).localeCompare(String(b.market.sportsMarketType));
    if (type !== 0) return type;
    return Number(a.market.line ?? 0) - Number(b.market.line ?? 0);
  });
}

function looksLikeMatchFamily(event: GammaEvent, seriesId: string, tagIds: string[]): boolean {
  const seriesMatch = eventSeriesIds(event).includes(seriesId);
  const tagMatch = eventTagIds(event).some((id) => tagIds.includes(id));
  const hasTeams = (event.teams ?? []).filter((team) => team.name).length >= 2;
  const titleMatch = /\bvs\.?\b/i.test(String(event.title ?? ""));
  const sportsMarkets = (event.markets ?? []).filter(
    (market) => typeof market.sportsMarketType === "string" && market.sportsMarketType.length > 0
  );
  const kickoff = eventKickoffMs(event);
  const inTournament = kickoff >= WORLD_CUP_START && kickoff <= WORLD_CUP_END;
  return (seriesMatch || tagMatch) && inTournament && sportsMarkets.length > 0 && (hasTeams || titleMatch);
}

async function paginateEvents(options: {
  queryName: string;
  query: Record<string, string>;
  rawDir: string;
  logPath?: string;
}): Promise<GammaEvent[]> {
  const events: GammaEvent[] = [];
  let cursor = "";
  let page = 0;
  const seenCursors = new Set<string>();
  while (true) {
    const params = new URLSearchParams({ limit: "100", ...options.query });
    if (cursor) params.set("after_cursor", cursor);
    const url = `${GAMMA_ORIGIN}/events/keyset?${params.toString()}`;
    const response = await fetchWithRetry(url);
    const pagePath = join(options.rawDir, `${options.queryName}-page-${String(page).padStart(4, "0")}.json`);
    await writeAtomicText(pagePath, response.text.endsWith("\n") ? response.text : `${response.text}\n`);
    if (options.logPath) {
      await appendJsonl(options.logPath, {
        at: new Date().toISOString(),
        action: "gamma-page",
        queryName: options.queryName,
        page,
        status: response.status,
        attempts: response.attempts,
        path: pagePath,
        url
      });
    }
    if (!response.ok) throw new Error(`Gamma ${options.queryName} page ${page} failed ${response.status}`);
    const body = JSON.parse(response.text) as { events?: GammaEvent[]; next_cursor?: string | null };
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    const next = String(body.next_cursor ?? "");
    if (!next || pageEvents.length === 0) break;
    if (seenCursors.has(next)) throw new Error(`Gamma cursor loop detected for ${options.queryName}`);
    seenCursors.add(next);
    cursor = next;
    page += 1;
  }
  return events;
}

export async function discoverWorldCupEvents(options: {
  outDir: string;
  manifestLogPath?: string;
  openOnly?: boolean;
}): Promise<DiscoveryResult> {
  const discoveryId = timestampSlug();
  const rawDir = join(options.outDir, "discovery", discoveryId);
  await ensureDir(rawDir);

  const sportsResponse = await fetchWithRetry(`${GAMMA_ORIGIN}/sports`);
  await writeAtomicText(
    join(rawDir, "sports.json"),
    sportsResponse.text.endsWith("\n") ? sportsResponse.text : `${sportsResponse.text}\n`
  );
  if (!sportsResponse.ok) throw new Error(`Gamma /sports failed ${sportsResponse.status}`);
  const sports = JSON.parse(sportsResponse.text) as SportsMetadata[];
  const worldCupSport = sports.find((item) => item.sport === "fifwc");
  if (!worldCupSport?.series || !worldCupSport.tags) {
    throw new Error("Official Gamma sports metadata did not expose the expected fifwc series/tags");
  }
  const tagIds = worldCupSport.tags.split(",").map((item) => item.trim()).filter(Boolean);
  const worldCupTagIds = tagIds.filter((id) => id !== "1" && id !== "100639" && id !== "100350");
  const seriesId = String(worldCupSport.series);
  const querySpecs = [
    ...(options.openOnly ? [] : [{ queryName: "series-closed", query: { series_id: seriesId, closed: "true" } }]),
    { queryName: "series-open", query: { series_id: seriesId, closed: "false" } },
    ...worldCupTagIds.flatMap((tagId) => [
      ...(options.openOnly ? [] : [{ queryName: `tag-${tagId}-closed`, query: { tag_id: tagId, closed: "true" } }]),
      { queryName: `tag-${tagId}-open`, query: { tag_id: tagId, closed: "false" } }
    ])
  ];

  const sourceEventsById = new Map<string, GammaEvent>();
  for (const spec of querySpecs) {
    const events = await paginateEvents({
      ...spec,
      rawDir,
      logPath: options.manifestLogPath
    });
    for (const event of events) {
      const id = String(event.id ?? "");
      if (id) sourceEventsById.set(id, event);
    }
  }
  const sourceEvents = [...sourceEventsById.values()];
  const matchEvents = sourceEvents
    .filter((event) => looksLikeMatchFamily(event, seriesId, worldCupTagIds))
    .sort((a, b) => eventKickoffMs(a) - eventKickoffMs(b));

  const eventsDir = join(options.outDir, "events");
  for (const event of matchEvents) {
    const safeSlug = String(event.slug ?? "event").replace(/[^a-zA-Z0-9._-]+/g, "-");
    await writeAtomicJson(join(eventsDir, `${event.id}-${safeSlug}.json`), event);
  }
  await writeAtomicJson(join(options.outDir, "world-cup-events.json"), matchEvents);
  await writeAtomicJson(join(options.outDir, "discovery-metadata.json"), {
    capturedAt: new Date().toISOString(),
    discoveryId,
    sport: worldCupSport,
    seriesId,
    tagIds: worldCupTagIds,
    sourceEvents: sourceEvents.length,
    matchEvents: matchEvents.length,
    relevantMarkets: relevantMarkets(matchEvents).length
  });
  await logManifest({
    type: "polymarket-world-cup-discovery",
    endpoint: "Gamma /sports + /events/keyset",
    rows: matchEvents.length,
    path: options.outDir,
    discoveryId,
    seriesId,
    tagIds: worldCupTagIds
  });

  return {
    sports,
    worldCupSport,
    sourceEvents,
    matchEvents,
    tagIds: worldCupTagIds,
    seriesId,
    discoveryId
  };
}

export function uniqueMatchKey(event: GammaEvent): string {
  const teams = (event.teams ?? [])
    .map((team) => String(team.name ?? "").trim().toLocaleLowerCase())
    .filter(Boolean)
    .sort();
  return `${teams.join("|")}@${Math.round(eventKickoffMs(event) / 1000)}`;
}
