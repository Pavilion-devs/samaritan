import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildMappingRegistry,
  type MappingBuildOutput
} from "../../import/build-mapping-registry.js";
import { MappingRegistry, type MappingRecord } from "../../mapping/registry.js";

const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";
const WORLD_CUP_START_MS = Date.parse("2026-06-11T00:00:00Z");
const WORLD_CUP_END_MS = Date.parse("2026-07-20T12:00:00Z");

type AnyRecord = Record<string, unknown>;
type SportsMetadata = AnyRecord & {
  sport?: string;
  tags?: string;
  series?: string;
};
type GammaTeam = AnyRecord & { name?: string };
type GammaMarket = AnyRecord & {
  sportsMarketType?: string;
  gameStartTime?: string;
};
type GammaEvent = AnyRecord & {
  id?: string | number;
  slug?: string;
  title?: string;
  startTime?: string;
  endDate?: string;
  teams?: GammaTeam[];
  tags?: AnyRecord[];
  series?: AnyRecord[];
  markets?: GammaMarket[];
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, attempts = 5): Promise<T> {
  let lastError = "request not attempted";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await response.text();
      if (response.ok) return JSON.parse(text) as T;
      lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)));
  }
  throw new Error(`Gamma request failed for ${url}: ${lastError}`);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function ids(values: AnyRecord[] | undefined): string[] {
  return (values ?? []).map((value) => String(value.id ?? "")).filter(Boolean);
}

function kickoffMs(event: GammaEvent): number {
  for (const market of event.markets ?? []) {
    const parsed = Date.parse(String(market.gameStartTime ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const value of [event.startTime, event.endDate]) {
    const parsed = Date.parse(String(value ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function looksLikeMatchFamily(event: GammaEvent, seriesId: string, tagIds: string[]): boolean {
  const tournament = ids(event.series).includes(seriesId) || ids(event.tags).some((id) => tagIds.includes(id));
  const hasTeams = (event.teams ?? []).filter((team) => team.name).length >= 2;
  const titleMatch = /\bvs\.?\b/i.test(String(event.title ?? ""));
  const hasSportsMarket = (event.markets ?? []).some(
    (market) => typeof market.sportsMarketType === "string" && market.sportsMarketType.length > 0
  );
  const kickoff = kickoffMs(event);
  return (
    tournament &&
    (hasTeams || titleMatch) &&
    hasSportsMarket &&
    kickoff >= WORLD_CUP_START_MS &&
    kickoff <= WORLD_CUP_END_MS
  );
}

async function paginateOpenEvents(query: Record<string, string>): Promise<GammaEvent[]> {
  const events: GammaEvent[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({ limit: "100", closed: "false", ...query });
    if (cursor) params.set("after_cursor", cursor);
    const body = await fetchJson<{ events?: GammaEvent[]; next_cursor?: string | null }>(
      `${GAMMA_ORIGIN}/events/keyset?${params}`
    );
    const pageEvents = Array.isArray(body.events) ? body.events : [];
    events.push(...pageEvents);
    const next = String(body.next_cursor ?? "");
    if (!next || pageEvents.length === 0) return events;
    if (seenCursors.has(next)) throw new Error("Gamma keyset cursor loop detected");
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("Gamma keyset pagination exceeded 100 pages");
}

export type GammaDiscoveryResult = {
  capturedAt: string;
  seriesId: string;
  tagIds: string[];
  sourceEvents: number;
  matchEvents: GammaEvent[];
};

export async function discoverOpenWorldCupEvents(): Promise<GammaDiscoveryResult> {
  const sports = await fetchJson<SportsMetadata[]>(`${GAMMA_ORIGIN}/sports`);
  const worldCup = sports.find((item) => item.sport === "fifwc");
  if (!worldCup?.series || !worldCup.tags) {
    throw new Error("Gamma /sports did not expose the fifwc series and tags");
  }
  const seriesId = String(worldCup.series);
  const tagIds = worldCup.tags
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && !["1", "100639", "100350"].includes(value));
  const batches = await Promise.all([
    paginateOpenEvents({ series_id: seriesId }),
    ...tagIds.map((tagId) => paginateOpenEvents({ tag_id: tagId }))
  ]);
  const byId = new Map<string, GammaEvent>();
  for (const event of batches.flat()) {
    const id = String(event.id ?? "");
    if (id) byId.set(id, event);
  }
  const matchEvents = [...byId.values()]
    .filter((event) => looksLikeMatchFamily(event, seriesId, tagIds))
    .sort((left, right) => kickoffMs(left) - kickoffMs(right));
  return {
    capturedAt: new Date().toISOString(),
    seriesId,
    tagIds,
    sourceEvents: byId.size,
    matchEvents
  };
}

export type GammaMappingRefresherOptions = {
  baseMappingPath?: string;
  fixturesPath?: string;
  catalogPath?: string;
  outDir?: string;
};

export class GammaMappingRefresher {
  readonly #baseMappingPath: string;
  readonly #fixturesPath: string;
  readonly #catalogPath: string;
  readonly #outDir: string;
  #lastSummary: { discovery: GammaDiscoveryResult; build: MappingBuildOutput } | null = null;

  constructor(options: GammaMappingRefresherOptions = {}) {
    this.#baseMappingPath = resolve(
      options.baseMappingPath ?? "data/research/mappings/world-cup-candidates.json"
    );
    this.#fixturesPath = resolve(
      options.fixturesPath ?? "samples/fixtures/mainnet-world-cup-fixtures.json"
    );
    this.#catalogPath = resolve(
      options.catalogPath ?? "samples/polymarket-history/world-cup-2026-v1/txline-market-catalog.json"
    );
    this.#outDir = resolve(options.outDir ?? "data/live/gamma-discovery");
  }

  get lastSummary(): { discovery: GammaDiscoveryResult; build: MappingBuildOutput } | null {
    return this.#lastSummary;
  }

  async refresh(): Promise<MappingRegistry> {
    const discovery = await discoverOpenWorldCupEvents();
    const eventsPath = join(this.#outDir, "open-world-cup-events.json");
    const outputPath = join(this.#outDir, "candidate-mappings.json");
    const assetsOutputPath = join(this.#outDir, "candidate-assets.ndjson");
    await writeJsonAtomic(eventsPath, discovery.matchEvents);
    await writeJsonAtomic(join(this.#outDir, "discovery-metadata.json"), {
      ...discovery,
      matchEvents: discovery.matchEvents.length
    });
    const build = await buildMappingRegistry({
      eventsPath,
      fixturesPath: this.#fixturesPath,
      catalogPath: this.#catalogPath,
      outputPath,
      assetsOutputPath
    });
    const base = JSON.parse(await readFile(this.#baseMappingPath, "utf8")) as {
      records: MappingRecord[];
    };
    const merged = new Map<string, MappingRecord>();
    for (const record of build.records) merged.set(record.mappingId, record);
    for (const record of base.records) merged.set(record.mappingId, record);
    const registry = new MappingRegistry([...merged.values()]);
    if (registry.assetIds().some((assetId) => registry.resolveAsset(assetId).tradeable)) {
      throw new Error("Automated Gamma refresh attempted to produce a tradeable asset");
    }
    this.#lastSummary = { discovery, build };
    return registry;
  }
}
