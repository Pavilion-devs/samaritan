import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decimalLineToMilli } from "../domain/probability.js";
import { MappingRegistry, sha256, type MappingRecord } from "../mapping/registry.js";
import { readJsonArray } from "../replay/files.js";

type AnyRecord = Record<string, unknown>;
type Fixture = AnyRecord & {
  FixtureId?: number | string;
  Participant1?: string;
  Participant2?: string;
  Participant1IsHome?: boolean;
  StartTime?: number | string;
};
type GammaTeam = AnyRecord & { name?: string };
type GammaMarket = AnyRecord & {
  id?: string | number;
  question?: string;
  conditionId?: string;
  description?: string;
  sportsMarketType?: string;
  line?: number | string | null;
  gameStartTime?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
};
type GammaEvent = AnyRecord & {
  id?: string | number;
  slug?: string;
  title?: string;
  startTime?: string;
  endDate?: string;
  teams?: GammaTeam[];
  markets?: GammaMarket[];
};
type TxMarketCatalog = Record<
  string,
  { marketTypes: string[]; periods: string[]; totalsLines: number[] }
>;

const TEAM_ALIASES: Record<string, string> = {
  usa: "united states",
  "united states of america": "united states",
  "u s a": "united states",
  "korea republic": "south korea",
  "republic of korea": "south korea",
  "korea south": "south korea",
  "ir iran": "iran",
  "iran islamic republic": "iran",
  czechia: "czech republic",
  turkiye: "turkey",
  "türkiye": "turkey",
  "cabo verde": "cape verde",
  "cote d ivoire": "ivory coast",
  "côte d ivoire": "ivory coast",
  "congo dr": "dr congo",
  "congo democratic republic": "dr congo",
  "democratic republic of congo": "dr congo",
  ksa: "saudi arabia"
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.trim() === "") return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTeam(value: unknown): string {
  const normalized = normalizeText(value);
  return TEAM_ALIASES[normalized] ?? normalized;
}

function eventTeams(event: GammaEvent): [string, string] | null {
  const enriched = (event.teams ?? []).map((team) => String(team.name ?? "").trim()).filter(Boolean);
  if (enriched.length >= 2) return [enriched[0]!, enriched[1]!];
  const title = String(event.title ?? "").split(" - ")[0]!;
  const parts = title.split(/\s+vs\.?\s+/i).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? [parts[0]!, parts[1]!] : null;
}

function fixtureStartMs(fixture: Fixture): number {
  const numeric = Number(fixture.StartTime);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(fixture.StartTime ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketKickoffMs(market: GammaMarket, event: GammaEvent): number {
  for (const value of [market.gameStartTime, event.startTime, event.endDate]) {
    const parsed = Date.parse(String(value ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function eventKickoffMs(event: GammaEvent): number {
  const marketKickoffs = (event.markets ?? [])
    .map((market) => marketKickoffMs(market, event))
    .filter((value) => value > 0);
  return marketKickoffs.length > 0 ? Math.min(...marketKickoffs) : 0;
}

function matchFixture(event: GammaEvent, fixtures: Fixture[]): {
  fixture: Fixture;
  kickoffDifferenceSeconds: number;
  confidence: "high" | "medium";
  reason: string;
} | null {
  const teams = eventTeams(event);
  if (!teams) return null;
  const pair = teams.map(normalizeTeam).sort().join("|");
  const kickoff = eventKickoffMs(event);
  const matches = fixtures.filter((fixture) => {
    const fixturePair = [fixture.Participant1, fixture.Participant2].map(normalizeTeam).sort().join("|");
    return fixturePair === pair && Math.abs(fixtureStartMs(fixture) - kickoff) <= 15 * 60_000;
  });
  if (matches.length !== 1) return null;
  const fixture = matches[0]!;
  const difference = Math.round((kickoff - fixtureStartMs(fixture)) / 1_000);
  return {
    fixture,
    kickoffDifferenceSeconds: difference,
    confidence: Math.abs(difference) <= 60 ? "high" : "medium",
    reason: `${Math.abs(difference) <= 60 ? "Exact" : "Alias-normalized"} participant pair; kickoff differs by ${difference} seconds; no fuzzy matching used.`
  };
}

function fixtureHomeAway(fixture: Fixture): [string, string] {
  const participant1 = String(fixture.Participant1 ?? "");
  const participant2 = String(fixture.Participant2 ?? "");
  return fixture.Participant1IsHome === false
    ? [participant2, participant1]
    : [participant1, participant2];
}

function aliases(canonical: string, observed: string[]): string[] {
  return [...new Set(observed.filter((value) => value && value !== canonical))].sort();
}

function moneylineOutcome(
  question: string,
  homeNames: string[],
  awayNames: string[]
): "home" | "draw" | "away" | null {
  const normalizedQuestion = normalizeText(question);
  if (/\bdraw\b/.test(normalizedQuestion)) return "draw";
  const hasHome = homeNames.some((name) => normalizedQuestion.includes(normalizeText(name)));
  const hasAway = awayNames.some((name) => normalizedQuestion.includes(normalizeText(name)));
  if (hasHome && !hasAway) return "home";
  if (hasAway && !hasHome) return "away";
  return null;
}

function conditionFor(
  market: GammaMarket,
  homeNames: string[],
  awayNames: string[],
  catalog: TxMarketCatalog[string]
): MappingRecord["conditions"][number] | null {
  const marketType = String(market.sportsMarketType ?? "");
  const outcomes = parseStringArray(market.outcomes);
  const tokens = parseStringArray(market.clobTokenIds);
  const rulesText = String(market.description ?? "").trim();
  const question = String(market.question ?? "").trim();
  const conditionId = String(market.conditionId ?? "");
  const polymarketMarketId = String(market.id ?? "");
  if (!rulesText || !question || !conditionId || !polymarketMarketId || outcomes.length !== tokens.length) {
    return null;
  }

  if (marketType === "moneyline") {
    if (!catalog.marketTypes.includes("1X2_PARTICIPANT_RESULT")) return null;
    const outcome = moneylineOutcome(question, homeNames, awayNames);
    const yesIndex = outcomes.findIndex((value) => value.toLocaleLowerCase() === "yes");
    const noIndex = outcomes.findIndex((value) => value.toLocaleLowerCase() === "no");
    if (outcome === null || yesIndex < 0 || noIndex < 0 || !tokens[yesIndex] || !tokens[noIndex]) return null;
    return {
      polymarketMarketId,
      conditionId,
      family: "match_result",
      period: "full_time",
      lineMilli: null,
      rulesText,
      rulesSha256: sha256(rulesText),
      tokens: [
        { assetId: tokens[yesIndex]!, outcome, role: "canonical" },
        { assetId: tokens[noIndex]!, outcome, role: "complement" }
      ],
      evidence: {
        polymarketQuestion: question,
        txlineMarketType: "1X2_PARTICIPANT_RESULT",
        txlineMarketObserved: true
      }
    };
  }

  if (marketType === "totals" && market.line !== null && market.line !== undefined) {
    const line = Number(market.line);
    if (!Number.isFinite(line) || !catalog.marketTypes.includes("OVERUNDER_PARTICIPANT_GOALS")) return null;
    if (!catalog.totalsLines.includes(line)) return null;
    const overIndex = outcomes.findIndex((value) => value.toLocaleLowerCase() === "over");
    const underIndex = outcomes.findIndex((value) => value.toLocaleLowerCase() === "under");
    if (overIndex < 0 || underIndex < 0 || !tokens[overIndex] || !tokens[underIndex]) return null;
    return {
      polymarketMarketId,
      conditionId,
      family: "total_goals",
      period: "full_time",
      lineMilli: decimalLineToMilli(market.line),
      rulesText,
      rulesSha256: sha256(rulesText),
      tokens: [
        { assetId: tokens[overIndex]!, outcome: "over", role: "canonical" },
        { assetId: tokens[underIndex]!, outcome: "under", role: "canonical" }
      ],
      evidence: {
        polymarketQuestion: question,
        txlineMarketType: "OVERUNDER_PARTICIPANT_GOALS",
        txlineMarketObserved: true
      }
    };
  }
  return null;
}

export type MappingBuildOptions = {
  eventsPath: string;
  fixturesPath: string;
  catalogPath: string;
  outputPath: string;
  assetsOutputPath: string;
};

export type MappingBuildOutput = {
  schemaVersion: 1;
  generatedAt: string;
  tradeable: false;
  note: string;
  counts: {
    txlineFixtures: number;
    mappedFixtures: number;
    mappingRecords: number;
    conditions: number;
    assets: number;
  };
  unmatchedFixtureIds: string[];
  rejectionCounts: Record<string, number>;
  records: MappingRecord[];
};

export async function buildMappingRegistry(options: MappingBuildOptions): Promise<MappingBuildOutput> {
  const { eventsPath, fixturesPath, catalogPath, outputPath, assetsOutputPath } = options;
  const [fixtures, catalog] = await Promise.all([
    readFile(fixturesPath, "utf8").then((text) => JSON.parse(text) as Fixture[]),
    readFile(catalogPath, "utf8").then((text) => JSON.parse(text) as TxMarketCatalog)
  ]);

  const records: MappingRecord[] = [];
  const seenEventIds = new Set<string>();
  const mappedFixtureIds = new Set<string>();
  const rejectionCounts = new Map<string, number>();
  const reject = (reason: string) => rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);

  for await (const event of readJsonArray<GammaEvent>(eventsPath)) {
    const eventId = String(event.id ?? "");
    if (!eventId || seenEventIds.has(eventId)) continue;
    seenEventIds.add(eventId);
    const match = matchFixture(event, fixtures);
    if (!match) {
      reject("fixture_unmatched_or_ambiguous");
      continue;
    }
    const fixtureId = String(match.fixture.FixtureId ?? "");
    const txCatalog = catalog[fixtureId];
    if (!fixtureId || !txCatalog) {
      reject("txline_market_catalog_missing");
      continue;
    }
    const [home, away] = fixtureHomeAway(match.fixture);
    const observedTeams = eventTeams(event) ?? [home, away];
    const homeNames = [
      home,
      ...observedTeams.filter((team) => normalizeTeam(team) === normalizeTeam(home))
    ];
    const awayNames = [
      away,
      ...observedTeams.filter((team) => normalizeTeam(team) === normalizeTeam(away))
    ];
    const conditions = (event.markets ?? [])
      .map((market) => conditionFor(market, homeNames, awayNames, txCatalog))
      .filter((condition): condition is MappingRecord["conditions"][number] => condition !== null);
    if (conditions.length === 0) {
      reject("no_cross_market_condition");
      continue;
    }
    const pmKickoff = eventKickoffMs(event);
    records.push({
      mappingId: `${fixtureId}:${eventId}`,
      status: "candidate",
      txlineFixtureId: fixtureId,
      teams: {
        home: {
          canonical: home,
          aliases: aliases(home, observedTeams.filter((team) => normalizeTeam(team) === normalizeTeam(home)))
        },
        away: {
          canonical: away,
          aliases: aliases(away, observedTeams.filter((team) => normalizeTeam(team) === normalizeTeam(away)))
        }
      },
      kickoff: { txlineTsMs: fixtureStartMs(match.fixture), polymarketTsMs: pmKickoff },
      polymarketEventId: eventId,
      polymarketEventSlug: String(event.slug ?? "event-slug-missing"),
      conditions,
      evidence: {
        confidence: match.confidence,
        kickoffDifferenceSeconds: match.kickoffDifferenceSeconds,
        reason: match.reason,
        sourcePaths: [relative(process.cwd(), fixturesPath), relative(process.cwd(), eventsPath)]
      }
    });
    mappedFixtureIds.add(fixtureId);
  }

  const registry = new MappingRegistry(records);
  const unmatchedFixtureIds = fixtures
    .map((fixture) => String(fixture.FixtureId ?? ""))
    .filter((fixtureId) => !mappedFixtureIds.has(fixtureId));
  const output: MappingBuildOutput = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tradeable: false,
    note: "Research candidates only. Human settlement verification is intentionally absent.",
    counts: {
      txlineFixtures: fixtures.length,
      mappedFixtures: mappedFixtureIds.size,
      mappingRecords: records.length,
      conditions: records.reduce((sum, record) => sum + record.conditions.length, 0),
      assets: registry.assetIds().length
    },
    unmatchedFixtureIds,
    rejectionCounts: Object.fromEntries([...rejectionCounts].sort(([left], [right]) => left.localeCompare(right))),
    records
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  const assetRows = registry.assetIds().map((assetId) => {
    const asset = registry.resolveAsset(assetId);
    return {
      assetId: asset.assetId,
      fixtureId: asset.fixtureId,
      marketKey: asset.market.key,
      family: asset.market.family,
      period: asset.market.period,
      lineMilli: asset.market.lineMilli,
      conditionId: asset.conditionId,
      outcome: asset.outcome,
      tokenRole: asset.tokenRole,
      mappingStatus: asset.mappingStatus,
      tradeable: asset.tradeable
    };
  });
  await mkdir(dirname(assetsOutputPath), { recursive: true });
  await writeFile(assetsOutputPath, `${assetRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options: MappingBuildOptions = {
    eventsPath: argument("events", "samples/polymarket-history/world-cup-2026-v1/world-cup-events.json"),
    fixturesPath: argument("fixtures", "samples/fixtures/mainnet-world-cup-fixtures.json"),
    catalogPath: argument("catalog", "samples/polymarket-history/world-cup-2026-v1/txline-market-catalog.json"),
    outputPath: argument("output", "data/research/mappings/world-cup-candidates.json"),
    assetsOutputPath: argument("assets-output", "data/research/mappings/world-cup-assets.ndjson")
  };
  const output = await buildMappingRegistry(options);
  console.log(
    JSON.stringify(
      {
        outputPath: options.outputPath,
        assetsOutputPath: options.assetsOutputPath,
        ...output.counts,
        unmatchedFixtureIds: output.unmatchedFixtureIds
      },
      null,
      2
    )
  );
}
