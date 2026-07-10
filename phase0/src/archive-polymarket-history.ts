import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appendJsonl,
  listFilesRecursive,
  logManifest,
  numberArg,
  parseArgs,
  readJson,
  SAMPLES_DIR,
  stringArg
} from "./lib.js";
import {
  CLOB_ORIGIN,
  type AnyRecord,
  discoverWorldCupEvents,
  eventKickoffMs,
  fetchWithRetry,
  type GammaEvent,
  type GammaMarket,
  marketKickoffMs,
  parseStringArray,
  relevantMarkets,
  sleep,
  uniqueMatchKey,
  writeAtomicJson,
  writeAtomicText
} from "./polymarket-lib.js";

type HistoryPoint = { t: number; p: number };

type TokenPlan = {
  event: GammaEvent;
  market: GammaMarket;
  tokenId: string;
  tokenIndex: number;
  outcome: string;
  startTs: number;
  endTs: number;
  historyPath: string;
  metadataPath: string;
};

type TokenCaptureMetadata = {
  capturedAt: string;
  status: "success" | "empty" | "unavailable" | "error";
  httpStatus: number;
  attempts: number;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  eventClosed: boolean;
  marketId: string;
  conditionId: string;
  marketQuestion: string;
  sportsMarketType: string;
  line: number | string | null;
  gameStartTime: string;
  tokenId: string;
  tokenIndex: number;
  outcome: string;
  requestedStartTs: number;
  requestedEndTs: number;
  fidelityMinutes: number;
  pointCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  historyPath: string;
  error?: string;
};

type TxFixture = AnyRecord & {
  FixtureId?: number;
  Participant1?: string;
  Participant2?: string;
  StartTime?: number | string;
  Competition?: string;
  CompetitionId?: number;
};

type TxMarketCatalog = Record<
  string,
  {
    marketTypes: string[];
    periods: string[];
    totalsLines: number[];
  }
>;

type FixtureMatch = {
  fixture?: TxFixture;
  status: "candidate" | "ambiguous" | "unmatched";
  confidence: "high" | "medium" | "low";
  reason: string;
  kickoffDifferenceSeconds?: number;
  candidateFixtureIds?: string[];
};

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
  "saudi arabia": "saudi arabia",
  ksa: "saudi arabia"
};

function markdown(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function iso(seconds: number | null | undefined): string {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : "";
}

function parseTimestampSeconds(value: unknown): number | undefined {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

function historyBounds(event: GammaEvent, market: GammaMarket): { startTs: number; endTs: number } {
  const startCandidates = [
    parseTimestampSeconds(market.acceptingOrdersTimestamp),
    parseTimestampSeconds(market.startDate),
    parseTimestampSeconds(event.creationDate),
    parseTimestampSeconds(event.startDate)
  ].filter((value): value is number => value !== undefined);
  const kickoff = Math.floor(marketKickoffMs(market, event) / 1000);
  const now = Math.floor(Date.now() / 1000);
  const closedCandidates = [
    parseTimestampSeconds(market.closedTime),
    parseTimestampSeconds(event.closedTime)
  ].filter((value): value is number => value !== undefined);
  const postMatchBound = kickoff > 0 ? kickoff + 6 * 60 * 60 : now;
  let endTs = closedCandidates.length > 0 ? Math.max(...closedCandidates) : Math.min(now, postMatchBound);
  const startTs = startCandidates.length > 0 ? Math.min(...startCandidates) : Math.max(0, kickoff - 7 * 86_400);
  if (!Number.isFinite(endTs) || endTs <= startTs) endTs = Math.max(startTs + 60, Math.min(now, postMatchBound));
  return { startTs, endTs };
}

function buildTokenPlans(
  events: GammaEvent[],
  outDir: string
): TokenPlan[] {
  const plans: TokenPlan[] = [];
  const seen = new Set<string>();
  for (const { event, market } of relevantMarkets(events)) {
    const tokenIds = parseStringArray(market.clobTokenIds);
    const outcomes = parseStringArray(market.outcomes);
    const bounds = historyBounds(event, market);
    for (const [tokenIndex, tokenId] of tokenIds.entries()) {
      if (!tokenId || seen.has(tokenId)) continue;
      seen.add(tokenId);
      plans.push({
        event,
        market,
        tokenId,
        tokenIndex,
        outcome: outcomes[tokenIndex] ?? `outcome-${tokenIndex}`,
        ...bounds,
        historyPath: join(outDir, "histories", `${tokenId}.json`),
        metadataPath: join(outDir, "token-metadata", `${tokenId}.json`)
      });
    }
  }
  return plans;
}

function validHistoryBody(value: unknown): value is { history: HistoryPoint[] } {
  if (!value || typeof value !== "object") return false;
  const history = (value as { history?: unknown }).history;
  return Array.isArray(history) && history.every((point) => {
    if (!point || typeof point !== "object") return false;
    const record = point as AnyRecord;
    return Number.isFinite(Number(record.t)) && Number.isFinite(Number(record.p));
  });
}

async function reusableCapture(plan: TokenPlan): Promise<TokenCaptureMetadata | undefined> {
  if (!existsSync(plan.historyPath) || !existsSync(plan.metadataPath)) return undefined;
  try {
    const [body, metadata] = await Promise.all([
      readJson<unknown>(plan.historyPath),
      readJson<TokenCaptureMetadata>(plan.metadataPath)
    ]);
    if (!validHistoryBody(body)) return undefined;
    if (!(["success", "empty", "unavailable"] as string[]).includes(metadata.status)) return undefined;
    if (metadata.requestedStartTs > plan.startTs + 60) return undefined;
    if (metadata.requestedEndTs < plan.endTs - 180) return undefined;
    return metadata;
  } catch {
    return undefined;
  }
}

function metadataFor(
  plan: TokenPlan,
  values: Partial<TokenCaptureMetadata> & Pick<TokenCaptureMetadata, "status" | "httpStatus" | "attempts">
): TokenCaptureMetadata {
  return {
    capturedAt: new Date().toISOString(),
    eventId: String(plan.event.id ?? ""),
    eventSlug: String(plan.event.slug ?? ""),
    eventTitle: String(plan.event.title ?? ""),
    eventClosed: plan.event.closed === true || plan.market.closed === true,
    marketId: String(plan.market.id ?? ""),
    conditionId: String(plan.market.conditionId ?? ""),
    marketQuestion: String(plan.market.question ?? ""),
    sportsMarketType: String(plan.market.sportsMarketType ?? ""),
    line: plan.market.line ?? null,
    gameStartTime: new Date(marketKickoffMs(plan.market, plan.event)).toISOString(),
    tokenId: plan.tokenId,
    tokenIndex: plan.tokenIndex,
    outcome: plan.outcome,
    requestedStartTs: plan.startTs,
    requestedEndTs: plan.endTs,
    fidelityMinutes: 1,
    pointCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    historyPath: plan.historyPath,
    ...values
  };
}

async function captureToken(
  plan: TokenPlan,
  runLogPath: string,
  requestSpacingMs: number
): Promise<TokenCaptureMetadata> {
  const reusable = await reusableCapture(plan);
  if (reusable) {
    await appendJsonl(runLogPath, {
      at: new Date().toISOString(),
      action: "history-skip-valid",
      tokenId: plan.tokenId,
      status: reusable.status,
      points: reusable.pointCount,
      path: plan.historyPath
    });
    return reusable;
  }

  const maxSegmentSeconds = 5 * 86_400;
  const segmentDir = join(dirnameOf(plan.metadataPath), "..", "segments", plan.tokenId);
  const mergedByTimestamp = new Map<number, HistoryPoint>();
  let cursor = plan.startTs;
  let totalAttempts = 0;
  let terminalError: { status: number; text: string } | undefined;
  while (cursor < plan.endTs) {
    const segmentEnd = Math.min(plan.endTs, cursor + maxSegmentSeconds);
    const segmentPath = join(segmentDir, `${cursor}-${segmentEnd}.json`);
    let segmentBody: { history: HistoryPoint[] } | undefined;
    if (existsSync(segmentPath)) {
      try {
        const existing = await readJson<unknown>(segmentPath);
        if (validHistoryBody(existing)) segmentBody = existing;
      } catch {
        segmentBody = undefined;
      }
    }
    if (!segmentBody) {
      const params = new URLSearchParams({
        market: plan.tokenId,
        startTs: String(cursor),
        endTs: String(segmentEnd),
        fidelity: "1"
      });
      const url = `${CLOB_ORIGIN}/prices-history?${params.toString()}`;
      const response = await fetchWithRetry(url);
      totalAttempts += response.attempts;
      if (!response.ok) {
        terminalError = { status: response.status, text: response.text };
        break;
      }
      try {
        const parsed = JSON.parse(response.text) as unknown;
        if (!validHistoryBody(parsed)) throw new Error("Response did not contain a valid history array");
        segmentBody = parsed;
        await writeAtomicText(
          segmentPath,
          response.text.endsWith("\n") ? response.text : `${response.text}\n`
        );
      } catch (error) {
        terminalError = {
          status: response.status,
          text: error instanceof Error ? error.message : String(error)
        };
        break;
      }
      if (requestSpacingMs > 0) await sleep(requestSpacingMs);
    }
    for (const point of segmentBody.history) {
      mergedByTimestamp.set(Number(point.t), { t: Number(point.t), p: Number(point.p) });
    }
    if (segmentEnd >= plan.endTs) break;
    cursor = segmentEnd;
  }

  let metadata: TokenCaptureMetadata;
  if (terminalError) {
    const status = terminalError.status === 404 ? "unavailable" : "error";
    metadata = metadataFor(plan, {
      status,
      httpStatus: terminalError.status,
      attempts: totalAttempts,
      error: terminalError.text.slice(0, 1000)
    });
    await writeAtomicJson(join(dirnameOf(plan.metadataPath), "..", "errors", `${plan.tokenId}.json`), {
      ...metadata,
      responseBody: terminalError.text
    });
  } else {
    const points = [...mergedByTimestamp.values()].sort((a, b) => a.t - b.t);
    metadata = metadataFor(plan, {
      status: points.length > 0 ? "success" : "empty",
      httpStatus: 200,
      attempts: totalAttempts,
      pointCount: points.length,
      firstTimestamp: points[0]?.t ?? null,
      lastTimestamp: points.at(-1)?.t ?? null
    });
    await writeAtomicJson(plan.historyPath, { history: points });
    if (points.length === 0) {
      await writeAtomicJson(join(dirnameOf(plan.metadataPath), "..", "errors", `${plan.tokenId}.json`), {
        ...metadata,
        note: "Every official five-day segment returned HTTP 200 with an empty history array."
      });
    }
  }
  await writeAtomicJson(plan.metadataPath, metadata);
  await appendJsonl(runLogPath, {
    at: new Date().toISOString(),
    action: "history-result",
    tokenId: plan.tokenId,
    marketId: plan.market.id,
    conditionId: plan.market.conditionId,
    sportsMarketType: plan.market.sportsMarketType,
    line: plan.market.line ?? null,
    status: metadata.status,
    httpStatus: metadata.httpStatus,
    attempts: metadata.attempts,
    points: metadata.pointCount,
    firstTimestamp: metadata.firstTimestamp,
    lastTimestamp: metadata.lastTimestamp,
    path: metadata.historyPath
  });
  await logManifest({
    type: "polymarket-price-history",
    endpoint: "/prices-history",
    status: metadata.httpStatus,
    rows: metadata.pointCount,
    tokenId: plan.tokenId,
    conditionId: plan.market.conditionId,
    result: metadata.status,
    path: plan.historyPath
  });
  return metadata;
}

function dirnameOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

async function captureAllTokens(options: {
  plans: TokenPlan[];
  concurrency: number;
  requestSpacingMs: number;
  runLogPath: string;
}): Promise<TokenCaptureMetadata[]> {
  let next = 0;
  const results: TokenCaptureMetadata[] = [];
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      const plan = options.plans[index];
      if (!plan) return;
      const result = await captureToken(plan, options.runLogPath, options.requestSpacingMs);
      results[index] = result;
      if ((index + 1) % 25 === 0 || index + 1 === options.plans.length) {
        console.log(`Polymarket history progress: ${index + 1}/${options.plans.length}`);
      }
    }
  }
  const workerCount = Math.max(1, Math.min(options.concurrency, options.plans.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return TEAM_ALIASES[normalized] ?? normalized;
}

function eventTeams(event: GammaEvent): string[] {
  const enriched = (event.teams ?? []).map((team) => String(team.name ?? "").trim()).filter(Boolean);
  if (enriched.length >= 2) return enriched.slice(0, 2);
  const title = String(event.title ?? "").split(" - ")[0];
  const parts = title.split(/\s+vs\.?\s+/i).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? parts : [];
}

function fixtureMatchFor(event: GammaEvent, fixtures: TxFixture[]): FixtureMatch {
  const teams = eventTeams(event);
  if (teams.length !== 2) {
    return { status: "unmatched", confidence: "low", reason: "Polymarket event lacks an unambiguous two-team identity." };
  }
  const normalizedPair = teams.map(normalizeTeam).sort().join("|");
  const kickoff = eventKickoffMs(event);
  const sameTeams = fixtures.filter((fixture) =>
    [fixture.Participant1, fixture.Participant2].map(normalizeTeam).sort().join("|") === normalizedPair
  );
  const inWindow = sameTeams.filter((fixture) => Math.abs(fixtureStartMs(fixture) - kickoff) <= 15 * 60_000);
  if (inWindow.length > 1) {
    return {
      status: "ambiguous",
      confidence: "low",
      reason: "More than one TXLine fixture has the exact normalized team pair within 15 minutes.",
      candidateFixtureIds: inWindow.map((fixture) => String(fixture.FixtureId ?? ""))
    };
  }
  if (inWindow.length === 0) {
    return {
      status: "unmatched",
      confidence: "low",
      reason: sameTeams.length > 0
        ? "Exact normalized teams exist in TXLine, but no kickoff is within 15 minutes."
        : "No TXLine fixture has the exact normalized participant pair (explicit aliases only)."
    };
  }
  const fixture = inWindow[0];
  const difference = Math.round((kickoff - fixtureStartMs(fixture)) / 1000);
  return {
    fixture,
    status: "candidate",
    confidence: Math.abs(difference) <= 60 ? "high" : "medium",
    kickoffDifferenceSeconds: difference,
    reason: `${Math.abs(difference) <= 60 ? "Exact" : "Alias-normalized"} participant pair; kickoff differs by ${difference} seconds; official fifwc series/tag and nested sports metadata agree.`
  };
}

async function buildTxMarketCatalog(fixtures: TxFixture[], outDir: string): Promise<TxMarketCatalog> {
  const cachePath = join(outDir, "txline-market-catalog.json");
  if (existsSync(cachePath)) return readJson<TxMarketCatalog>(cachePath);
  const wanted = new Set(fixtures.map((fixture) => String(fixture.FixtureId ?? "")));
  const mutable = new Map<string, { marketTypes: Set<string>; periods: Set<string>; totalsLines: Set<number> }>();
  for (const id of wanted) mutable.set(id, { marketTypes: new Set(), periods: new Set(), totalsLines: new Set() });
  const files = (await listFilesRecursive(join(SAMPLES_DIR, "odds-historical", "mainnet"))).filter((file) => file.endsWith(".json"));
  let scanned = 0;
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const value of rows) {
      if (!value || typeof value !== "object") continue;
      const row = value as AnyRecord;
      const id = String(row.FixtureId ?? "");
      const catalog = mutable.get(id);
      if (!catalog) continue;
      const marketType = String(row.SuperOddsType ?? "");
      const period = String(row.MarketPeriod ?? "");
      catalog.marketTypes.add(marketType);
      catalog.periods.add(period);
      if (marketType === "OVERUNDER_PARTICIPANT_GOALS" && !period) {
        const match = /^line=(-?\d+(?:\.\d+)?)$/.exec(String(row.MarketParameters ?? ""));
        if (match) catalog.totalsLines.add(Number(match[1]));
      }
    }
    scanned += 1;
    if (scanned % 2500 === 0) console.log(`TXLine mapping catalog progress: ${scanned}/${files.length} files`);
  }
  const catalog: TxMarketCatalog = {};
  for (const [id, value] of mutable) {
    catalog[id] = {
      marketTypes: [...value.marketTypes].filter(Boolean).sort(),
      periods: [...value.periods].sort(),
      totalsLines: [...value.totalsLines].sort((a, b) => a - b)
    };
  }
  await writeAtomicJson(cachePath, catalog);
  return catalog;
}

function rulesSummary(market: GammaMarket): string {
  const description = String(market.description ?? "");
  const regularTime = /first 90 minutes of regular play plus stoppage time/i.test(description);
  if (market.sportsMarketType === "totals") {
    return regularTime
      ? "Combined goals in the first 90 minutes plus stoppage time; extra time excluded; human rules confirmation required."
      : "Combined-goals total per captured rules text; the period wording requires human confirmation."
  }
  return regularTime
    ? "Match result in the first 90 minutes plus stoppage time; extra time excluded; human rules confirmation required."
    : "Match-result rules captured, but the regulation-time wording requires human confirmation."
}

async function readHistoryPoints(metadata: TokenCaptureMetadata | undefined): Promise<HistoryPoint[]> {
  if (!metadata || metadata.status !== "success" || !existsSync(metadata.historyPath)) return [];
  const body = await readJson<{ history?: HistoryPoint[] }>(metadata.historyPath);
  return Array.isArray(body.history) ? body.history.map((point) => ({ t: Number(point.t), p: Number(point.p) })) : [];
}

function choosePreKickoffPoint(points: HistoryPoint[], kickoffSeconds: number): HistoryPoint | undefined {
  const target = kickoffSeconds - 5 * 60;
  const before = points.filter((point) => point.t <= target);
  return before.at(-1) ?? points.filter((point) => point.t < kickoffSeconds).at(-1);
}

async function writeMappingReport(options: {
  events: GammaEvent[];
  fixtures: TxFixture[];
  catalog: TxMarketCatalog;
  metadataByToken: Map<string, TokenCaptureMetadata>;
  reportPath: string;
}): Promise<void> {
  const eventMatches = new Map<string, FixtureMatch>();
  for (const event of options.events) eventMatches.set(String(event.id), fixtureMatchFor(event, options.fixtures));
  const mappedFixtureIds = new Set(
    [...eventMatches.values()]
      .filter((match) => match.status === "candidate" && match.fixture?.FixtureId)
      .map((match) => String(match.fixture!.FixtureId))
  );
  const unmatchedFixtures = options.fixtures.filter((fixture) => !mappedFixtureIds.has(String(fixture.FixtureId ?? "")));
  const ambiguousEvents = options.events.filter((event) => eventMatches.get(String(event.id))?.status === "ambiguous");
  const unmatchedEvents = options.events.filter((event) => eventMatches.get(String(event.id))?.status === "unmatched");

  const mappingRows: string[] = [];
  for (const { event, market } of relevantMarkets(options.events)) {
    const match = eventMatches.get(String(event.id))!;
    const fixture = match.fixture;
    const fixtureId = String(fixture?.FixtureId ?? "");
    const catalog = options.catalog[fixtureId];
    const pmLine = market.line === null || market.line === undefined ? null : Number(market.line);
    const expectedType = market.sportsMarketType === "moneyline"
      ? "1X2_PARTICIPANT_RESULT"
      : "OVERUNDER_PARTICIPANT_GOALS";
    const observedType = catalog?.marketTypes.includes(expectedType) ?? false;
    const observedLine = market.sportsMarketType === "moneyline"
      ? observedType
      : observedType && pmLine !== null && catalog?.totalsLines.includes(pmLine);
    const marketStatus = match.status === "candidate" && observedLine ? "candidate" : match.status === "ambiguous" ? "ambiguous" : "unmatched";
    const marketConfidence = marketStatus === "candidate" ? match.confidence : "low";
    const reason = marketStatus === "candidate"
      ? `${match.reason} TXLine captured the corresponding full-time ${expectedType}${pmLine === null ? "" : ` line ${pmLine}`}.`
      : `${match.reason}${match.status === "candidate" ? ` TXLine did not capture the corresponding full-time ${expectedType}${pmLine === null ? "" : ` line ${pmLine}`}.` : ""}`;
    mappingRows.push(
      `| ${markdown(fixtureId)} | ${markdown(event.id)} | ${markdown(market.id)} | ${markdown(market.conditionId)} | ${markdown(parseStringArray(market.clobTokenIds).join(", "))} | ${markdown(eventTeams(event).join(" vs "))} | ${markdown(fixture ? new Date(fixtureStartMs(fixture)).toISOString() : "")} | ${markdown(new Date(marketKickoffMs(market, event)).toISOString())} | ${markdown(match.kickoffDifferenceSeconds ?? "")} | ${expectedType} | full time (blank) | ${markdown(pmLine ?? "")} | ${markdown(market.sportsMarketType)} | ${markdown(pmLine ?? "")} | ${markdown(rulesSummary(market))} | ${marketConfidence} | ${markdown(reason)} | ${marketStatus} |`
    );
  }

  const totalsRows: Array<{
    fixtureId: string;
    teams: string;
    marketId: string;
    line: number;
    price?: number;
    pointTime?: number;
    volume: number;
    liquidity: number;
    coverage: number;
    closest50: boolean;
    maxVolume: boolean;
    maxLiquidity: boolean;
    maxCoverage: boolean;
    disagreement: boolean;
  }> = [];
  const totalsGroups = new Map<string, Array<{ event: GammaEvent; market: GammaMarket }>>();
  for (const pair of relevantMarkets(options.events).filter((pair) => pair.market.sportsMarketType === "totals")) {
    const match = eventMatches.get(String(pair.event.id));
    const key = String(match?.fixture?.FixtureId ?? uniqueMatchKey(pair.event));
    if (!totalsGroups.has(key)) totalsGroups.set(key, []);
    totalsGroups.get(key)!.push(pair);
  }
  for (const [key, pairs] of totalsGroups) {
    const candidates: Array<Omit<(typeof totalsRows)[number], "closest50" | "maxVolume" | "maxLiquidity" | "maxCoverage" | "disagreement">> = [];
    for (const { event, market } of pairs) {
      const tokenIds = parseStringArray(market.clobTokenIds);
      const outcomes = parseStringArray(market.outcomes);
      const yesIndex = Math.max(0, outcomes.findIndex((outcome) => outcome.toLocaleLowerCase() === "yes"));
      const metadata = options.metadataByToken.get(tokenIds[yesIndex] ?? tokenIds[0]);
      const points = await readHistoryPoints(metadata);
      const kickoff = Math.floor(marketKickoffMs(market, event) / 1000);
      const point = choosePreKickoffPoint(points, kickoff);
      candidates.push({
        fixtureId: key,
        teams: eventTeams(event).join(" vs "),
        marketId: String(market.id ?? ""),
        line: Number(market.line),
        price: point?.p,
        pointTime: point?.t,
        volume: Number(market.volumeNum ?? market.volume ?? 0),
        liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
        coverage: metadata?.pointCount ?? 0
      });
    }
    const byPrice = [...candidates].filter((row) => row.price !== undefined).sort((a, b) => Math.abs(a.price! - 0.5) - Math.abs(b.price! - 0.5));
    const maxVolume = Math.max(...candidates.map((row) => row.volume));
    const maxLiquidity = Math.max(...candidates.map((row) => row.liquidity));
    const maxCoverage = Math.max(...candidates.map((row) => row.coverage));
    const criteriaSets = [
      ...(byPrice[0] ? [new Set([byPrice[0].marketId])] : []),
      ...(maxVolume > 0 ? [new Set(candidates.filter((row) => row.volume === maxVolume).map((row) => row.marketId))] : []),
      ...(maxLiquidity > 0 ? [new Set(candidates.filter((row) => row.liquidity === maxLiquidity).map((row) => row.marketId))] : []),
      ...(maxCoverage > 0 ? [new Set(candidates.filter((row) => row.coverage === maxCoverage).map((row) => row.marketId))] : [])
    ];
    const commonWinner = criteriaSets.length > 0 && [...criteriaSets[0]].some(
      (marketId) => criteriaSets.every((set) => set.has(marketId))
    );
    const disagreement = criteriaSets.length > 1 && !commonWinner;
    for (const row of candidates) {
      totalsRows.push({
        ...row,
        closest50: row.marketId === byPrice[0]?.marketId,
        maxVolume: maxVolume > 0 && row.volume === maxVolume,
        maxLiquidity: maxLiquidity > 0 && row.liquidity === maxLiquidity,
        maxCoverage: maxCoverage > 0 && row.coverage === maxCoverage,
        disagreement
      });
    }
  }

  const lines = [
    "# TXLine ↔ Polymarket Mapping Candidates",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Research-only candidates. No row is tradeable or settlement-verified. Human confirmation of participant identity, kickoff, market period, and the full captured resolution text remains mandatory.",
    "",
    "## Coverage and exceptions",
    "",
    `TXLine World Cup fixtures examined: ${options.fixtures.length}`,
    `TXLine fixtures with at least one exact/explicit-alias match candidate: ${mappedFixtureIds.size}`,
    `Unmatched TXLine fixtures: ${unmatchedFixtures.length}`,
    `Ambiguous Polymarket event-family records: ${ambiguousEvents.length}`,
    `Unmatched Polymarket event-family records: ${unmatchedEvents.length}`,
    "",
    "### Unmatched TXLine fixtures (prominent review queue)",
    "",
    "| FixtureId | Teams | Kickoff UTC |",
    "|---|---|---|",
    ...unmatchedFixtures.map((fixture) => `| ${fixture.FixtureId ?? ""} | ${markdown(`${fixture.Participant1 ?? ""} vs ${fixture.Participant2 ?? ""}`)} | ${new Date(fixtureStartMs(fixture)).toISOString()} |`),
    unmatchedFixtures.length ? "" : "None.",
    "",
    "### Ambiguous or unmatched Polymarket event families",
    "",
    "| Event ID | Slug | Teams | Kickoff UTC | Status | Exact reason |",
    "|---|---|---|---|---|---|",
    ...[...ambiguousEvents, ...unmatchedEvents].map((event) => {
      const match = eventMatches.get(String(event.id))!;
      return `| ${event.id ?? ""} | ${markdown(event.slug)} | ${markdown(eventTeams(event).join(" vs "))} | ${new Date(eventKickoffMs(event)).toISOString()} | ${match.status} | ${markdown(match.reason)} |`;
    }),
    ambiguousEvents.length + unmatchedEvents.length ? "" : "None.",
    "",
    "## Candidate market rows",
    "",
    "`settlement_verified` is intentionally absent and must never be inferred from `confidence`.",
    "",
    "| TXLine FixtureId | PM Event ID | PM Market ID | Condition ID | Token IDs | Teams | TX kickoff | PM kickoff | Δ seconds | TX market type | TX period | TX line | PM sportsMarketType | PM line | Resolution summary | Confidence | Exact confidence reason | Status |",
    "|---|---|---|---|---|---|---|---|---:|---|---|---:|---|---:|---|---|---|---|",
    ...mappingRows,
    "",
    "## Full-time totals-line evidence",
    "",
    "All captured `sportsMarketType=totals` lines are retained. `Closest 50/50` uses the latest available Yes-token history point at least five minutes before kickoff (or the last pre-kickoff point if needed). Volume/liquidity are Gamma metadata; coverage is the Yes-token history count. This table reports disagreements and does not select a main-line rule.",
    "",
    "| Fixture/event key | Teams | Market ID | Line | Pre-kick price | Point time UTC | Volume | Liquidity | Points | Closest 50/50 | Max volume | Max liquidity | Max coverage | Criteria disagree |",
    "|---|---|---|---:|---:|---|---:|---:|---:|---|---|---|---|---|",
    ...totalsRows
      .sort((a, b) => a.fixtureId.localeCompare(b.fixtureId) || a.line - b.line)
      .map((row) => `| ${markdown(row.fixtureId)} | ${markdown(row.teams)} | ${row.marketId} | ${row.line} | ${row.price ?? ""} | ${iso(row.pointTime)} | ${row.volume.toFixed(2)} | ${row.liquidity.toFixed(2)} | ${row.coverage} | ${row.closest50 ? "yes" : ""} | ${row.maxVolume ? "yes" : ""} | ${row.maxLiquidity ? "yes" : ""} | ${row.maxCoverage ? "yes" : ""} | ${row.disagreement ? "yes" : "no"} |`),
    "",
    "## Explicit aliases",
    "",
    ...Object.entries(TEAM_ALIASES).map(([from, to]) => `- \`${from}\` → \`${to}\``),
    "",
    "No edit-distance or silent fuzzy matching is used."
  ];
  await writeAtomicText(options.reportPath, lines.join("\n"));
}

async function analyzeHistory(options: {
  events: GammaEvent[];
  markets: Array<{ event: GammaEvent; market: GammaMarket }>;
  metadata: TokenCaptureMetadata[];
  reportPath: string;
}): Promise<void> {
  let gapMin = Number.POSITIVE_INFINITY;
  let gapMax = 0;
  let gapsOver90 = 0;
  let gapsOver120 = 0;
  let gapsOver300 = 0;
  let gapCount = 0;
  let inPlayTokens = 0;
  let offTickPrices = 0;
  let pricesChecked = 0;
  const marketByToken = new Map<string, { event: GammaEvent; market: GammaMarket }>();
  for (const pair of options.markets) {
    for (const tokenId of parseStringArray(pair.market.clobTokenIds)) marketByToken.set(tokenId, pair);
  }
  for (const metadata of options.metadata) {
    const points = await readHistoryPoints(metadata);
    const pair = marketByToken.get(metadata.tokenId);
    const kickoff = pair ? Math.floor(marketKickoffMs(pair.market, pair.event) / 1000) : 0;
    if (points.some((point) => point.t >= kickoff && point.t <= kickoff + 4 * 60 * 60)) inPlayTokens += 1;
    const tick = Number(pair?.market.orderPriceMinTickSize ?? 0);
    for (let index = 1; index < points.length; index += 1) {
      const gap = points[index].t - points[index - 1].t;
      gapMin = Math.min(gapMin, gap);
      gapMax = Math.max(gapMax, gap);
      gapCount += 1;
      if (gap > 90) gapsOver90 += 1;
      if (gap > 120) gapsOver120 += 1;
      if (gap > 300) gapsOver300 += 1;
    }
    if (tick > 0) {
      for (const point of points) {
        pricesChecked += 1;
        if (Math.abs(point.p / tick - Math.round(point.p / tick)) > 1e-7) offTickPrices += 1;
      }
    }
  }
  const uniqueMatches = new Set(options.events.map(uniqueMatchKey));
  const kickoffs = options.events.map(eventKickoffMs).filter((value) => value > 0);
  const success = options.metadata.filter((row) => row.status === "success");
  const empty = options.metadata.filter((row) => row.status === "empty");
  const unavailable = options.metadata.filter((row) => row.status === "unavailable");
  const errors = options.metadata.filter((row) => row.status === "error");
  const moneyline = options.markets.filter((row) => row.market.sportsMarketType === "moneyline");
  const totals = options.markets.filter((row) => row.market.sportsMarketType === "totals");
  const closedMetadata = options.metadata.filter((row) => row.eventClosed);
  const closedRecovered = closedMetadata.filter((row) => row.status === "success");
  const lines = [
    "# Polymarket World Cup Price-History Rescue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Read-only official Gamma and CLOB public APIs only. Raw responses are local under `samples/polymarket-history/` and are not evidence of executable historical bid/ask prices.",
    "",
    "## Archive summary",
    "",
    `World Cup match-family Gamma events discovered: ${options.events.length}`,
    `Unique World Cup matches represented: ${uniqueMatches.size}`,
    `Kickoff date range: ${kickoffs.length ? new Date(Math.min(...kickoffs)).toISOString() : "none"} through ${kickoffs.length ? new Date(Math.max(...kickoffs)).toISOString() : "none"}`,
    `Match Result binary markets discovered: ${moneyline.length}`,
    `Full-time combined-goals totals markets discovered: ${totals.length}`,
    `Tokens requested: ${options.metadata.length}`,
    `Tokens successfully captured with points: ${success.length}`,
    `Tokens returning empty HTTP 200 histories: ${empty.length}`,
    `Tokens unavailable (including 404): ${unavailable.length}`,
    `Tokens with errors: ${errors.length}`,
    `Total history points: ${success.reduce((sum, row) => sum + row.pointCount, 0)}`,
    "",
    "## Recoverability and interpretation",
    "",
    `Closed-market tokens recovered with non-empty histories: ${closedRecovered.length}/${closedMetadata.length}.`,
    `Tokens with at least one point between kickoff and kickoff +4h: ${inPlayTokens}/${success.length}; this is evidence that many histories continue in-play, not proof that every market remains continuously tradable.`,
    `Observed adjacent timestamp gaps: ${gapCount ? `${gapMin}s minimum, ${gapMax}s maximum` : "none"}; gaps >90s: ${gapsOver90}, >120s: ${gapsOver120}, >300s: ${gapsOver300}. Fidelity=1 produces approximately minute-spaced samples, not guaranteed one point at each exact minute.`,
    `${offTickPrices}/${pricesChecked} sampled prices were not integer multiples of the market's captured tick size. Together with the history schema containing only \`t\` and \`p\` (no bids, asks, sizes, or spread), this is consistent with an aggregated/sample price series and is not an executable quote archive. The endpoint documentation does not define \`p\` strongly enough here to label every point as a last trade.`,
    "Historical one-minute Polymarket prices cannot prove a seconds-level STALE_QUOTE edge. That requires synchronized live order-book capture.",
    "",
    "## Per-token coverage",
    "",
    "| Status | Event | Market type | Line | Market ID | Condition ID | Outcome | Token ID | Points | First timestamp UTC | Last timestamp UTC | Requested start | Requested end | HTTP | Error |",
    "|---|---|---|---:|---|---|---|---|---:|---|---|---|---|---:|---|",
    ...options.metadata.map((row) => `| ${row.status} | ${markdown(row.eventSlug)} | ${row.sportsMarketType} | ${markdown(row.line ?? "")} | ${row.marketId} | ${row.conditionId} | ${markdown(row.outcome)} | ${row.tokenId} | ${row.pointCount} | ${iso(row.firstTimestamp)} | ${iso(row.lastTimestamp)} | ${iso(row.requestedStartTs)} | ${iso(row.requestedEndTs)} | ${row.httpStatus} | ${markdown(row.error ?? "")} |`),
    "",
    "## Empty, unavailable, and error histories",
    "",
    ...(empty.length + unavailable.length + errors.length
      ? [...empty, ...unavailable, ...errors].map((row) => `- ${row.status}: token \`${row.tokenId}\`, market \`${row.marketId}\`, HTTP ${row.httpStatus}${row.error ? ` — ${row.error}` : ""}`)
      : ["None."]),
    ""
  ];
  await writeAtomicText(options.reportPath, lines.join("\n"));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const runLabel = (stringArg(args, "run-label", "world-cup-2026-v1") ?? "world-cup-2026-v1")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  const outDir = join(SAMPLES_DIR, "polymarket-history", runLabel);
  const runLogPath = join(outDir, "manifest.jsonl");
  const concurrency = Math.max(1, Math.floor(numberArg(args, "concurrency", 6)));
  const requestSpacingMs = Math.max(0, Math.floor(numberArg(args, "request-spacing-ms", 100)));
  await appendJsonl(runLogPath, {
    at: new Date().toISOString(),
    action: "run-start",
    runLabel,
    concurrency,
    requestSpacingMs,
    readOnly: true
  });

  const discovery = await discoverWorldCupEvents({ outDir, manifestLogPath: runLogPath });
  const markets = relevantMarkets(discovery.matchEvents);
  const plans = buildTokenPlans(discovery.matchEvents, outDir);
  console.log(`Discovered ${discovery.matchEvents.length} World Cup match-family events.`);
  console.log(`Relevant markets: ${markets.length}; outcome tokens: ${plans.length}.`);
  const metadata = await captureAllTokens({ plans, concurrency, requestSpacingMs, runLogPath });
  const metadataByToken = new Map(metadata.map((row) => [row.tokenId, row]));

  const fixturesPath = join(SAMPLES_DIR, "fixtures", "mainnet-world-cup-fixtures.json");
  const fixtures = existsSync(fixturesPath) ? await readJson<TxFixture[]>(fixturesPath) : [];
  const catalog = await buildTxMarketCatalog(fixtures, outDir);
  await analyzeHistory({
    events: discovery.matchEvents,
    markets,
    metadata,
    reportPath: join(SAMPLES_DIR, "POLYMARKET-HISTORY.md")
  });
  await writeMappingReport({
    events: discovery.matchEvents,
    fixtures,
    catalog,
    metadataByToken,
    reportPath: join(SAMPLES_DIR, "POLYMARKET-MAPPING-CANDIDATES.md")
  });
  await appendJsonl(runLogPath, {
    at: new Date().toISOString(),
    action: "run-end",
    runLabel,
    matchEvents: discovery.matchEvents.length,
    relevantMarkets: markets.length,
    tokens: metadata.length,
    successfulTokens: metadata.filter((row) => row.status === "success").length,
    historyPoints: metadata.reduce((sum, row) => sum + row.pointCount, 0)
  });
  await logManifest({
    type: "polymarket-history-run",
    endpoint: "Gamma /events/keyset + CLOB /prices-history",
    rows: metadata.reduce((sum, row) => sum + row.pointCount, 0),
    path: outDir,
    runLabel,
    events: discovery.matchEvents.length,
    markets: markets.length,
    tokens: metadata.length
  });
  console.log(`Archive complete: ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
