import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { capturedFrameToEnvelope } from "../ingest/sse.js";
import { decimalLineToMilli } from "../domain/probability.js";
import { stableJson } from "../domain/json.js";
import {
  assertDistinctFilesystemPaths,
  assertFilesystemPathWithin
} from "../domain/filesystem-paths.js";
import { MappingRegistry, type MappingRecord } from "../mapping/registry.js";
import { readNdjson } from "../replay/files.js";
import {
  PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS,
  PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS,
  PAPER_STUDY_TOTAL_SELECTOR_CONFIG
} from "../config/paper-study.js";
import {
  selectMainTotalLine,
  type TotalLineEvidence
} from "../research/main-total-selector.js";
import {
  validateCaptureConfig,
  type CaptureConfig
} from "./capture-config.js";
import {
  verifyTerminalCaptureEvidence,
  type SynchronizedCaptureEvidence
} from "./run-scheduled-capture.js";
import {
  verifiedPairedAnalysisManifestSchema,
  type SelectedTotalBinding,
  type VerifiedPairedAnalysisManifest
} from "./paired-capture-manifest.js";
import { capturedPaperReplaySource } from "./paper-event-source.js";
import {
  capturedPaperIngressCapacity,
  profileCapturedPaperIngress
} from "./captured-paper-admission.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TXLINE_DEVIG_SUM_MIN = 99.5;
const TXLINE_DEVIG_SUM_MAX = 100.5;

type JsonRecord = Record<string, unknown>;

type Subscription = {
  assetId: string;
  outcome: "over" | "under";
  eventSlug: string;
  marketId: string;
  conditionId: string;
  lineMilli: number;
};

type MarketGroup = {
  eventSlug: string;
  marketId: string;
  conditionId: string;
  lineMilli: number;
  assets: Subscription[];
};

type BookAssetAccumulator = {
  assetId: string;
  outcome: "over" | "under";
  bookEvents: number;
  usableDepthSnapshots: number;
  firstUsableObservedTsMs: number | null;
  lastUsableObservedTsMs: number | null;
  latestPreKickoffObservedTsMs: number | null;
};

type ResolutionEvidence = {
  conditionId: string;
  assetIds: string[];
  winningAssetId: string;
  winningOutcome: "over" | "under";
  observedTsMs: number;
};

type MarketAccumulator = {
  group: MarketGroup;
  assets: Map<string, BookAssetAccumulator>;
  resolution: ResolutionEvidence | null;
};

type PolymarketScan = {
  messages: number;
  parsedItems: number;
  books: number;
  prices: number;
  resolutions: number;
  firstObservedTsMs: number;
  lastObservedTsMs: number;
  markets: Map<string, MarketAccumulator>;
};

type TxlineLineEvidence = {
  lineMilli: number;
  usableFrames: number;
  firstObservedTsMs: number | null;
  lastObservedTsMs: number | null;
  latestPreKickoffObservedTsMs: number | null;
};

type TxlineScan = {
  oddsFrames: number;
  exactFixtureOddsFrames: number;
  usableOddsFrames: number;
  scoreFrames: number;
  exactFixtureScoreFrames: number;
  completedExactFixtureScoreFrames: number;
  finalScore: { homeGoals: number; awayGoals: number };
  firstOddsObservedTsMs: number;
  lastOddsObservedTsMs: number;
  firstScoresObservedTsMs: number;
  lastScoresObservedTsMs: number;
  totalsByLine: Map<number, TxlineLineEvidence>;
};

type SelectionResult = {
  selectedTotal: SelectedTotalBinding | null;
  mappingConfirmed: boolean;
  mappingRecords: number;
  missingGates: string[];
};

export type PairedCaptureAnalysisStatus = "verified" | "verified_capture" | "failed_closed";

export type PairedCaptureAnalysisManifest = VerifiedPairedAnalysisManifest | {
  schemaVersion: 2;
  runId: string;
  checkedAt: string;
  status: Exclude<PairedCaptureAnalysisStatus, "verified">;
  fixtureId: string;
  eventSlug: string;
  totalsEventSlug: string;
  captureVerification: {
    status: "verified" | "failed_closed";
    terminalEvidenceAvailable: boolean;
  };
  selectedTotal: SelectedTotalBinding | null;
  marketEvidence: unknown[];
  proof: {
    algorithm: "sha256";
    inputCommitment: string;
    analysisCommitment: string;
    inputHashes: Record<string, string | null>;
  };
  admission: {
    status: "failed_closed";
    missingGates: string[];
  };
  failures: Array<{ code: string; detail: string }>;
  notes: string[];
};

export type BuildPairedCaptureAnalysisOptions = {
  repoRoot: string;
  captureConfigPath: string;
  mappingsPath: string;
  totalEvidencePath: string;
  outputPath: string;
  checkedAt?: string;
};

class CaptureAnalysisError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CaptureAnalysisError";
  }
}

const subscriptionSchema = z.object({
  assetId: z.string().min(1),
  outcome: z.string().min(1),
  eventSlug: z.string().min(1),
  teams: z.array(z.string().min(1)).length(2),
  kickoffMs: z.number().int().positive().safe(),
  marketId: z.string().min(1),
  conditionId: z.string().min(1),
  sportsMarketType: z.string().min(1),
  line: z.union([z.number(), z.string(), z.null()])
}).passthrough();

const capturedMessageSchema = z.object({
  receivedAt: z.string().datetime(),
  rawPayload: z.string(),
  parseError: z.string().nullable().optional()
}).passthrough();

const capturedFrameSchema = z.object({
  receivedAt: z.string().datetime(),
  stream: z.enum(["odds", "scores"]),
  rawFrame: z.string()
}).passthrough();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function optionalFileHash(path: string): Promise<string | null> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return null;
    return await sha256File(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function relativePath(repoRoot: string, path: string): string {
  return relative(repoRoot, path) || ".";
}

function verifiedInputHashes(
  hashes: Record<string, string | null>
): VerifiedPairedAnalysisManifest["proof"]["inputHashes"] {
  const required = (name: string): string => {
    const hash = hashes[name];
    if (hash === null || hash === undefined || !HASH_PATTERN.test(hash)) {
      throw new Error(`Verified input hash missing: ${name}`);
    }
    return hash;
  };
  return {
    captureConfig: required("captureConfig"),
    txlineFixtureSnapshot: required("txlineFixtureSnapshot"),
    polymarketEventSnapshot: required("polymarketEventSnapshot"),
    polymarketTerminalManifest: required("polymarketTerminalManifest"),
    txlineTerminalManifest: required("txlineTerminalManifest"),
    subscriptions: required("subscriptions"),
    polymarketMessages: required("polymarketMessages"),
    txlineOdds: required("txlineOdds"),
    txlineScores: required("txlineScores"),
    mappings: required("mappings"),
    causalTotalEvidence: required("causalTotalEvidence")
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function finitePositive(value: unknown): boolean {
  const parsed = typeof value === "string" && value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function usableDepth(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((level) => {
    const record = asRecord(level);
    if (!record || !finitePositive(record.size)) return false;
    const price = Number(record.price);
    return Number.isFinite(price) && price > 0 && price < 1;
  });
}

function isUsableTxlineOdds(record: JsonRecord): boolean {
  if (
    record.SuperOddsType !== "1X2_PARTICIPANT_RESULT" &&
    record.SuperOddsType !== "OVERUNDER_PARTICIPANT_GOALS"
  ) return false;
  const expectedNames = record.SuperOddsType === "1X2_PARTICIPANT_RESULT"
    ? ["part1", "draw", "part2"]
    : ["over", "under"];
  if (
    !Array.isArray(record.PriceNames) || !Array.isArray(record.Prices) || !Array.isArray(record.Pct) ||
    record.PriceNames.length === 0 || record.Prices.length !== record.PriceNames.length ||
    record.Pct.length !== record.PriceNames.length
  ) return false;
  if (stableJson(record.PriceNames) !== stableJson(expectedNames)) return false;
  if (!record.Prices.every((value) => typeof value === "number" && Number.isInteger(value) && value > 0)) return false;
  if (!record.Pct.every((value) => {
    if (typeof value !== "string" || value.trim() === "") return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  })) return false;
  const sum = record.Pct.reduce((total, value) => total + Number(value), 0);
  return sum >= TXLINE_DEVIG_SUM_MIN && sum <= TXLINE_DEVIG_SUM_MAX;
}

function fullTimeTotalLine(record: JsonRecord): number | null {
  if (record.SuperOddsType !== "OVERUNDER_PARTICIPANT_GOALS") return null;
  if (record.MarketPeriod !== null && String(record.MarketPeriod ?? "").trim() !== "") return null;
  const match = String(record.MarketParameters ?? "").match(/(?:^|;)line=(-?\d+(?:\.\d{1,3})?)(?:;|$)/);
  return match?.[1] ? decimalLineToMilli(match[1]) : null;
}

function parseFinalScore(record: JsonRecord): { homeGoals: number; awayGoals: number } | null {
  if (record.Action !== "game_finalised" || record.StatusId !== 100) return null;
  const score = asRecord(record.Score);
  const homeTotal = asRecord(asRecord(score?.Participant1)?.Total);
  const awayTotal = asRecord(asRecord(score?.Participant2)?.Total);
  const homeGoals = homeTotal?.Goals;
  const awayGoals = awayTotal?.Goals;
  if (
    typeof homeGoals !== "number" || !Number.isInteger(homeGoals) || homeGoals < 0 ||
    typeof awayGoals !== "number" || !Number.isInteger(awayGoals) || awayGoals < 0
  ) {
    throw new CaptureAnalysisError(
      "invalid_final_score",
      "Exact-fixture game_finalised frame lacks non-negative integer total goals"
    );
  }
  return { homeGoals, awayGoals };
}

function expectedOutcome(finalScore: { homeGoals: number; awayGoals: number }, lineMilli: number): "over" | "under" {
  const totalMilli = (finalScore.homeGoals + finalScore.awayGoals) * 1_000;
  if (totalMilli === lineMilli) {
    throw new CaptureAnalysisError("unsupported_total_push", "Selected binary total resolves exactly on its line");
  }
  return totalMilli > lineMilli ? "over" : "under";
}

const captureEvidenceEnvelopeSchema = z.object({
  evidence: z.object({
    txlineFixtures: z.string().min(1),
    polymarketEvents: z.string().min(1)
  }).passthrough()
}).passthrough();

function validateStableCaptureConfig(
  options: BuildPairedCaptureAnalysisOptions,
  raw: unknown,
  fixturesText: string,
  eventsText: string
): CaptureConfig {
  const fixtures = JSON.parse(fixturesText) as unknown[];
  const events = JSON.parse(eventsText) as unknown[];
  return validateCaptureConfig({
    repoRoot: options.repoRoot,
    config: raw,
    txlineFixtures: fixtures as Parameters<typeof validateCaptureConfig>[0]["txlineFixtures"],
    polymarketEvents: events as Parameters<typeof validateCaptureConfig>[0]["polymarketEvents"],
    nowTsMs: Number.MAX_SAFE_INTEGER
  }).config;
}

function subscriptionGroups(value: unknown, config: CaptureConfig): {
  groups: MarketGroup[];
  allAssetCount: number;
} {
  const records = z.array(subscriptionSchema).min(1).parse(value);
  const kickoffTsMs = Date.parse(config.txline.kickoffUtc);
  const allowedSlugs = new Set([config.polymarket.eventSlug, config.polymarket.totalsEventSlug]);
  const seenAssets = new Set<string>();
  const groups = new Map<string, MarketGroup>();
  let mainEventAssets = 0;
  for (const record of records) {
    if (!allowedSlugs.has(record.eventSlug)) {
      throw new CaptureAnalysisError("subscription_slug_mismatch", `Unexpected captured event slug ${record.eventSlug}`);
    }
    if (record.teams.join("|") !== `${config.polymarket.home}|${config.polymarket.away}` || record.kickoffMs !== kickoffTsMs) {
      throw new CaptureAnalysisError("subscription_fixture_mismatch", `Subscription ${record.assetId} changed teams or kickoff`);
    }
    if (seenAssets.has(record.assetId)) {
      throw new CaptureAnalysisError("duplicate_subscription_asset", `Duplicate subscribed asset ${record.assetId}`);
    }
    seenAssets.add(record.assetId);
    if (record.eventSlug === config.polymarket.eventSlug) mainEventAssets += 1;
    if (record.eventSlug !== config.polymarket.totalsEventSlug || record.sportsMarketType !== "totals") continue;
    if (record.line === null) {
      throw new CaptureAnalysisError("total_line_missing", `Total subscription ${record.assetId} has no line`);
    }
    const normalizedOutcome = record.outcome.toLocaleLowerCase();
    if (normalizedOutcome !== "over" && normalizedOutcome !== "under") {
      throw new CaptureAnalysisError("total_outcome_invalid", `Total subscription ${record.assetId} has outcome ${record.outcome}`);
    }
    const lineMilli = decimalLineToMilli(String(record.line));
    const key = `${record.marketId}|${record.conditionId}|${lineMilli}`;
    const group = groups.get(key) ?? {
      eventSlug: record.eventSlug,
      marketId: record.marketId,
      conditionId: record.conditionId,
      lineMilli,
      assets: []
    };
    group.assets.push({
      assetId: record.assetId,
      outcome: normalizedOutcome,
      eventSlug: record.eventSlug,
      marketId: record.marketId,
      conditionId: record.conditionId,
      lineMilli
    });
    groups.set(key, group);
  }
  if (mainEventAssets <= 0) throw new CaptureAnalysisError("match_result_subscriptions_missing", "No exact match-result assets were subscribed");
  const totals = [...groups.values()].sort((left, right) =>
    left.lineMilli - right.lineMilli || left.marketId.localeCompare(right.marketId)
  );
  if (totals.length === 0) throw new CaptureAnalysisError("total_subscriptions_missing", "No exact full-time total was subscribed");
  for (const group of totals) {
    group.assets.sort((left, right) => left.assetId.localeCompare(right.assetId));
    const outcomes = group.assets.map((asset) => asset.outcome).sort();
    if (group.assets.length !== 2 || stableJson(outcomes) !== stableJson(["over", "under"])) {
      throw new CaptureAnalysisError(
        "total_outcome_pair_incomplete",
        `Total ${group.marketId}/${group.conditionId} requires exactly Over and Under assets`
      );
    }
  }
  return { groups: totals, allAssetCount: seenAssets.size };
}

function payloadItems(rawPayload: string): JsonRecord[] {
  if (["ping", "pong"].includes(rawPayload.trim().toLocaleLowerCase())) return [];
  const parsed = JSON.parse(rawPayload) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => {
    const record = asRecord(item);
    if (!record) throw new CaptureAnalysisError("polymarket_payload_invalid", "Captured Polymarket item is not an object");
    return record;
  });
}

function itemAssetIds(item: JsonRecord): string[] {
  const values = new Set<string>();
  if (item.asset_id !== undefined) values.add(String(item.asset_id));
  if (Array.isArray(item.assets_ids)) for (const value of item.assets_ids) values.add(String(value));
  if (Array.isArray(item.price_changes)) {
    for (const change of item.price_changes) {
      const record = asRecord(change);
      if (record?.asset_id !== undefined) values.add(String(record.asset_id));
    }
  }
  return [...values];
}

async function scanPolymarket(
  path: string,
  groups: readonly MarketGroup[],
  kickoffTsMs: number
): Promise<PolymarketScan> {
  const byAsset = new Map(groups.flatMap((group) => group.assets.map((asset) => [asset.assetId, group] as const)));
  const markets = new Map<string, MarketAccumulator>();
  for (const group of groups) {
    const assets = new Map<string, BookAssetAccumulator>();
    for (const asset of group.assets) {
      assets.set(asset.assetId, {
        assetId: asset.assetId,
        outcome: asset.outcome,
        bookEvents: 0,
        usableDepthSnapshots: 0,
        firstUsableObservedTsMs: null,
        lastUsableObservedTsMs: null,
        latestPreKickoffObservedTsMs: null
      });
    }
    markets.set(group.conditionId, { group, assets, resolution: null });
  }
  let messages = 0;
  let parsedItems = 0;
  let books = 0;
  let prices = 0;
  let resolutions = 0;
  let firstObservedTsMs = Number.POSITIVE_INFINITY;
  let lastObservedTsMs = Number.NEGATIVE_INFINITY;
  for await (const raw of readNdjson<unknown>(path)) {
    const message = capturedMessageSchema.parse(raw);
    if (message.parseError) {
      throw new CaptureAnalysisError("polymarket_parse_error", message.parseError);
    }
    const observedTsMs = Date.parse(message.receivedAt);
    firstObservedTsMs = Math.min(firstObservedTsMs, observedTsMs);
    lastObservedTsMs = Math.max(lastObservedTsMs, observedTsMs);
    messages += 1;
    let items: JsonRecord[];
    try {
      items = payloadItems(message.rawPayload);
    } catch (error) {
      if (error instanceof CaptureAnalysisError) throw error;
      throw new CaptureAnalysisError(
        "polymarket_payload_parse_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
    parsedItems += items.length;
    for (const item of items) {
      if (Object.hasOwn(item, "mode")) {
        throw new CaptureAnalysisError("mode_discriminator_present", "Captured source item contains a mode field");
      }
      const eventType = String(item.event_type ?? "");
      const assets = itemAssetIds(item);
      for (const assetId of assets) {
        const group = byAsset.get(assetId);
        if (group && String(item.market ?? "") !== group.conditionId) {
          throw new CaptureAnalysisError(
            "polymarket_condition_mismatch",
            `Asset ${assetId} arrived under condition ${String(item.market ?? "<missing>")}`
          );
        }
      }
      if (eventType === "book") {
        books += 1;
        const assetId = String(item.asset_id ?? "");
        const group = byAsset.get(assetId);
        if (!group) continue;
        const accumulator = markets.get(group.conditionId)!.assets.get(assetId)!;
        accumulator.bookEvents += 1;
        if (!usableDepth(item.bids) || !usableDepth(item.asks)) continue;
        accumulator.usableDepthSnapshots += 1;
        accumulator.firstUsableObservedTsMs ??= observedTsMs;
        accumulator.lastUsableObservedTsMs = observedTsMs;
        if (observedTsMs < kickoffTsMs) accumulator.latestPreKickoffObservedTsMs = observedTsMs;
      } else if (["price_change", "best_bid_ask", "last_trade_price"].includes(eventType)) {
        prices += 1;
      } else if (eventType === "market_resolved") {
        resolutions += 1;
        const conditionId = String(item.market ?? "");
        const market = markets.get(conditionId);
        if (!market) continue;
        if (item.id !== undefined && String(item.id) !== market.group.marketId) {
          throw new CaptureAnalysisError("resolution_market_mismatch", `Resolution ${conditionId} changed marketId`);
        }
        if (!Array.isArray(item.assets_ids)) {
          throw new CaptureAnalysisError("resolution_assets_missing", `Resolution ${conditionId} lacks assets_ids`);
        }
        const resolutionAssets = item.assets_ids.map(String).sort();
        const expectedAssets = market.group.assets.map((asset) => asset.assetId).sort();
        if (stableJson(resolutionAssets) !== stableJson(expectedAssets)) {
          throw new CaptureAnalysisError("resolution_assets_mismatch", `Resolution ${conditionId} changed its outcome assets`);
        }
        const winningAssetId = String(item.winning_asset_id ?? "");
        const winner = market.group.assets.find((asset) => asset.assetId === winningAssetId);
        if (!winner || String(item.winning_outcome ?? "").toLocaleLowerCase() !== winner.outcome) {
          throw new CaptureAnalysisError("resolution_winner_invalid", `Resolution ${conditionId} winner is not normalized`);
        }
        const resolution: ResolutionEvidence = {
          conditionId,
          assetIds: expectedAssets,
          winningAssetId,
          winningOutcome: winner.outcome,
          observedTsMs
        };
        if (market.resolution !== null && stableJson(market.resolution) !== stableJson(resolution)) {
          throw new CaptureAnalysisError("resolution_conflict", `Condition ${conditionId} has conflicting resolutions`);
        }
        market.resolution = resolution;
      }
    }
  }
  if (!Number.isFinite(firstObservedTsMs) || lastObservedTsMs <= firstObservedTsMs) {
    throw new CaptureAnalysisError("polymarket_window_invalid", "Polymarket messages lack a positive observation window");
  }
  return { messages, parsedItems, books, prices, resolutions, firstObservedTsMs, lastObservedTsMs, markets };
}

async function scanTxline(
  oddsPath: string,
  scoresPath: string,
  fixtureId: string,
  kickoffTsMs: number
): Promise<TxlineScan> {
  let oddsFrames = 0;
  let exactFixtureOddsFrames = 0;
  let usableOddsFrames = 0;
  let firstOddsObservedTsMs = Number.POSITIVE_INFINITY;
  let lastOddsObservedTsMs = Number.NEGATIVE_INFINITY;
  const totalsByLine = new Map<number, TxlineLineEvidence>();
  for await (const raw of readNdjson<unknown>(oddsPath)) {
    const frame = capturedFrameSchema.parse(raw);
    if (frame.stream !== "odds") throw new CaptureAnalysisError("txline_stream_mismatch", "Odds file contains a non-odds frame");
    const observedTsMs = Date.parse(frame.receivedAt);
    firstOddsObservedTsMs = Math.min(firstOddsObservedTsMs, observedTsMs);
    lastOddsObservedTsMs = Math.max(lastOddsObservedTsMs, observedTsMs);
    oddsFrames += 1;
    const envelope = capturedFrameToEnvelope(frame);
    if (!envelope || envelope.message.event === "heartbeat" || envelope.message.data === "") continue;
    const record = asRecord(JSON.parse(envelope.message.data) as unknown);
    if (!record) throw new CaptureAnalysisError("txline_odds_payload_invalid", "TXLine odds data is not an object");
    if (Object.hasOwn(record, "mode")) throw new CaptureAnalysisError("mode_discriminator_present", "TXLine odds contains a mode field");
    if (String(record.FixtureId ?? "") !== fixtureId) {
      throw new CaptureAnalysisError("txline_fixture_mismatch", `Odds frame belongs to fixture ${String(record.FixtureId ?? "<missing>")}`);
    }
    exactFixtureOddsFrames += 1;
    const supported = record.SuperOddsType === "1X2_PARTICIPANT_RESULT" ||
      record.SuperOddsType === "OVERUNDER_PARTICIPANT_GOALS";
    if (!supported) continue;
    const emptyQuote = Array.isArray(record.Prices) && record.Prices.length === 0 &&
      Array.isArray(record.Pct) && record.Pct.length === 0;
    if (emptyQuote) {
      const expectedNames = record.SuperOddsType === "1X2_PARTICIPANT_RESULT"
        ? ["part1", "draw", "part2"]
        : ["over", "under"];
      if (stableJson(record.PriceNames) !== stableJson(expectedNames)) {
        throw new CaptureAnalysisError("exact_fixture_odds_invalid", "Empty quote has unexpected outcome names");
      }
      continue;
    }
    if (!isUsableTxlineOdds(record)) {
      throw new CaptureAnalysisError(
        "exact_fixture_odds_invalid",
        "Supported exact-fixture TXLine odds contain invalid outcomes, Prices, or de-vig Pct values"
      );
    }
    usableOddsFrames += 1;
    const lineMilli = fullTimeTotalLine(record);
    if (lineMilli === null) continue;
    const current = totalsByLine.get(lineMilli) ?? {
      lineMilli,
      usableFrames: 0,
      firstObservedTsMs: null,
      lastObservedTsMs: null,
      latestPreKickoffObservedTsMs: null
    };
    current.usableFrames += 1;
    current.firstObservedTsMs ??= observedTsMs;
    current.lastObservedTsMs = observedTsMs;
    if (observedTsMs < kickoffTsMs) current.latestPreKickoffObservedTsMs = observedTsMs;
    totalsByLine.set(lineMilli, current);
  }

  let scoreFrames = 0;
  let exactFixtureScoreFrames = 0;
  let completedExactFixtureScoreFrames = 0;
  let firstScoresObservedTsMs = Number.POSITIVE_INFINITY;
  let lastScoresObservedTsMs = Number.NEGATIVE_INFINITY;
  let finalScore: { homeGoals: number; awayGoals: number } | null = null;
  for await (const raw of readNdjson<unknown>(scoresPath)) {
    const frame = capturedFrameSchema.parse(raw);
    if (frame.stream !== "scores") throw new CaptureAnalysisError("txline_stream_mismatch", "Scores file contains a non-scores frame");
    const observedTsMs = Date.parse(frame.receivedAt);
    firstScoresObservedTsMs = Math.min(firstScoresObservedTsMs, observedTsMs);
    lastScoresObservedTsMs = Math.max(lastScoresObservedTsMs, observedTsMs);
    scoreFrames += 1;
    const envelope = capturedFrameToEnvelope(frame);
    if (!envelope || envelope.message.event === "heartbeat" || envelope.message.data === "") continue;
    const record = asRecord(JSON.parse(envelope.message.data) as unknown);
    if (!record) throw new CaptureAnalysisError("txline_score_payload_invalid", "TXLine score data is not an object");
    if (Object.hasOwn(record, "mode")) throw new CaptureAnalysisError("mode_discriminator_present", "TXLine scores contains a mode field");
    if (String(record.FixtureId ?? "") !== fixtureId) {
      throw new CaptureAnalysisError("txline_fixture_mismatch", `Score frame belongs to fixture ${String(record.FixtureId ?? "<missing>")}`);
    }
    exactFixtureScoreFrames += 1;
    const completed = parseFinalScore(record);
    if (completed === null) continue;
    completedExactFixtureScoreFrames += 1;
    if (finalScore !== null && stableJson(finalScore) !== stableJson(completed)) {
      throw new CaptureAnalysisError("final_score_conflict", "TXLine emitted conflicting exact-fixture final scores");
    }
    finalScore = completed;
  }
  if (
    !Number.isFinite(firstOddsObservedTsMs) || lastOddsObservedTsMs <= firstOddsObservedTsMs ||
    !Number.isFinite(firstScoresObservedTsMs) || lastScoresObservedTsMs <= firstScoresObservedTsMs
  ) {
    throw new CaptureAnalysisError("txline_window_invalid", "TXLine odds/scores lack positive observation windows");
  }
  if (exactFixtureOddsFrames <= 0 || usableOddsFrames <= 0) {
    throw new CaptureAnalysisError("exact_fixture_odds_missing", "No usable exact-fixture TXLine odds were captured");
  }
  if (exactFixtureScoreFrames <= 0 || completedExactFixtureScoreFrames <= 0 || finalScore === null) {
    throw new CaptureAnalysisError("exact_fixture_score_completion_missing", "No exact-fixture TXLine game_finalised score was captured");
  }
  return {
    oddsFrames,
    exactFixtureOddsFrames,
    usableOddsFrames,
    scoreFrames,
    exactFixtureScoreFrames,
    completedExactFixtureScoreFrames,
    finalScore,
    firstOddsObservedTsMs,
    lastOddsObservedTsMs,
    firstScoresObservedTsMs,
    lastScoresObservedTsMs,
    totalsByLine
  };
}

function exactTotalRecord(records: readonly MappingRecord[], config: CaptureConfig): MappingRecord {
  const candidates = records.filter((record) =>
    record.txlineFixtureId === config.txline.fixtureId &&
    record.polymarketEventId === config.polymarket.totalsEventId &&
    record.polymarketEventSlug === config.polymarket.totalsEventSlug &&
    record.conditions.some((condition) => condition.family === "total_goals" && condition.period === "full_time")
  );
  if (candidates.length !== 1) {
    throw new CaptureAnalysisError(
      "exact_total_mapping_missing",
      `Fixture ${config.txline.fixtureId} requires exactly one exact totals-event mapping record`
    );
  }
  const record = candidates[0]!;
  const kickoffTsMs = Date.parse(config.txline.kickoffUtc);
  if (
    record.teams.home.canonical !== config.txline.home || record.teams.away.canonical !== config.txline.away ||
    record.kickoff.txlineTsMs !== kickoffTsMs || record.kickoff.polymarketTsMs !== kickoffTsMs
  ) {
    throw new CaptureAnalysisError("mapping_fixture_mismatch", "Exact totals mapping changed teams or kickoff");
  }
  return record;
}

async function selectTotal(
  options: BuildPairedCaptureAnalysisOptions,
  config: CaptureConfig,
  groups: readonly MarketGroup[]
): Promise<SelectionResult> {
  const missingGates: string[] = [];
  let mappingRecords = 0;
  try {
    const [mappingRaw, evidenceRaw] = await Promise.all([
      readFile(options.mappingsPath, "utf8"),
      readFile(options.totalEvidencePath, "utf8")
    ]);
    const mappingDocument = z.object({ records: z.array(z.unknown()) }).passthrough()
      .parse(JSON.parse(mappingRaw) as unknown);
    const evidenceDocument = z.object({ evidence: z.array(z.unknown()) }).passthrough()
      .parse(JSON.parse(evidenceRaw) as unknown);
    const registry = new MappingRegistry(mappingDocument.records);
    mappingRecords = registry.records().length;
    const record = exactTotalRecord(registry.records(), config);
    const fixtureEvidence = evidenceDocument.evidence.filter((row) =>
      asRecord(row)?.fixtureId === config.txline.fixtureId
    ) as TotalLineEvidence[];
    const kickoffTsMs = Date.parse(config.txline.kickoffUtc);
    const selection = selectMainTotalLine(
      config.txline.fixtureId,
      fixtureEvidence,
      PAPER_STUDY_TOTAL_SELECTOR_CONFIG,
      kickoffTsMs - PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS
    );
    if (!selection.selected) {
      missingGates.push("causal_selected_total_required");
      return { selectedTotal: null, mappingConfirmed: false, mappingRecords, missingGates };
    }
    const condition = record.conditions.find((candidate) =>
      candidate.family === "total_goals" && candidate.period === "full_time" &&
      candidate.lineMilli === selection.selected!.lineMilli &&
      candidate.polymarketMarketId === selection.selected!.marketId
    );
    if (!condition || condition.lineMilli === null) {
      throw new CaptureAnalysisError("selected_total_mapping_mismatch", "Causal selection is absent from the exact totals mapping");
    }
    const assets = condition.tokens
      .filter((token) => token.role === "canonical" && (token.outcome === "over" || token.outcome === "under"))
      .map((token) => token.assetId)
      .sort();
    if (assets.length !== 2 || new Set(assets).size !== 2) {
      throw new CaptureAnalysisError("selected_total_assets_invalid", "Selected total mapping lacks distinct Over/Under assets");
    }
    const captured = groups.find((group) =>
      group.eventSlug === config.polymarket.totalsEventSlug &&
      group.marketId === condition.polymarketMarketId && group.conditionId === condition.conditionId &&
      group.lineMilli === condition.lineMilli
    );
    if (!captured || stableJson(captured.assets.map((asset) => asset.assetId).sort()) !== stableJson(assets)) {
      throw new CaptureAnalysisError("selected_total_subscription_mismatch", "Selected total is absent from exact capture subscriptions");
    }
    const mappingConfirmed = record.status === "verified" && record.review?.settlementVerified === true;
    if (!mappingConfirmed) missingGates.push("deborah_reviewed_mapping_required");
    return {
      selectedTotal: {
        eventSlug: record.polymarketEventSlug,
        marketId: condition.polymarketMarketId,
        conditionId: condition.conditionId,
        lineMilli: condition.lineMilli,
        assetIds: assets
      },
      mappingConfirmed,
      mappingRecords,
      missingGates
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      missingGates.push("mapping_and_causal_selection_artifacts_required");
    } else if (error instanceof CaptureAnalysisError && error.code === "exact_total_mapping_missing") {
      missingGates.push("exact_total_mapping_required", "causal_selected_total_required");
    } else {
      throw error;
    }
    return { selectedTotal: null, mappingConfirmed: false, mappingRecords, missingGates };
  }
}

function iso(tsMs: number | null): string | null {
  return tsMs === null ? null : new Date(tsMs).toISOString();
}

function derivedMarketEvidence(scan: PolymarketScan, txline: TxlineScan): unknown[] {
  return [...scan.markets.values()]
    .sort((left, right) => left.group.lineMilli - right.group.lineMilli || left.group.marketId.localeCompare(right.group.marketId))
    .map((market) => ({
      eventSlug: market.group.eventSlug,
      marketId: market.group.marketId,
      conditionId: market.group.conditionId,
      lineMilli: market.group.lineMilli,
      assetIds: market.group.assets.map((asset) => asset.assetId).sort(),
      assetDepth: [...market.assets.values()]
        .sort((left, right) => left.assetId.localeCompare(right.assetId))
        .map((asset) => ({
          assetId: asset.assetId,
          outcome: asset.outcome,
          bookEvents: asset.bookEvents,
          usableDepthSnapshots: asset.usableDepthSnapshots,
          firstUsableObservedAt: iso(asset.firstUsableObservedTsMs),
          lastUsableObservedAt: iso(asset.lastUsableObservedTsMs),
          latestPreKickoffObservedAt: iso(asset.latestPreKickoffObservedTsMs)
        })),
      txlineUsableOddsFrames: txline.totalsByLine.get(market.group.lineMilli)?.usableFrames ?? 0,
      publicResolutionNormalized: market.resolution !== null
    }));
}

function selectedEvidence(input: {
  selected: SelectedTotalBinding;
  polymarket: PolymarketScan;
  txline: TxlineScan;
  kickoffTsMs: number;
}): Omit<VerifiedPairedAnalysisManifest["selectedMarketEvidence"], "canonicalIngress"> {
  const market = input.polymarket.markets.get(input.selected.conditionId);
  if (
    !market || market.group.marketId !== input.selected.marketId || market.group.lineMilli !== input.selected.lineMilli ||
    market.group.eventSlug !== input.selected.eventSlug
  ) {
    throw new CaptureAnalysisError("selected_market_evidence_missing", "Selected condition has no exact captured market evidence");
  }
  const assets = input.selected.assetIds.map((assetId) => market.assets.get(assetId));
  if (assets.some((asset) => !asset || asset.usableDepthSnapshots <= 0)) {
    throw new CaptureAnalysisError(
      "selected_market_depth_incomplete",
      "Both selected outcomes require a usable full-depth book snapshot"
    );
  }
  const txlineLine = input.txline.totalsByLine.get(input.selected.lineMilli);
  if (!txlineLine || txlineLine.usableFrames <= 0 || txlineLine.firstObservedTsMs === null || txlineLine.lastObservedTsMs === null) {
    throw new CaptureAnalysisError("selected_txline_odds_missing", "Selected total lacks usable exact-fixture TXLine odds");
  }
  const typedAssets = assets as BookAssetAccumulator[];
  const closeAvailable = txlineLine.latestPreKickoffObservedTsMs !== null &&
    typedAssets.every((asset) => asset.latestPreKickoffObservedTsMs !== null);
  const resolution = market.resolution;
  if (resolution && resolution.winningOutcome !== expectedOutcome(input.txline.finalScore, input.selected.lineMilli)) {
    throw new CaptureAnalysisError(
      "cross_source_resolution_mismatch",
      "Selected Polymarket resolution disagrees with the exact-fixture TXLine final score"
    );
  }
  return {
    assets: typedAssets
      .map((asset) => ({
        assetId: asset.assetId,
        outcome: asset.outcome,
        bookEvents: asset.bookEvents,
        usableDepthSnapshots: asset.usableDepthSnapshots,
        firstUsableObservedAt: iso(asset.firstUsableObservedTsMs)!,
        lastUsableObservedAt: iso(asset.lastUsableObservedTsMs)!,
        latestPreKickoffObservedAt: iso(asset.latestPreKickoffObservedTsMs)
      }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId)),
    txline: {
      exactFixtureOddsFrames: input.txline.exactFixtureOddsFrames,
      exactFixtureScoreFrames: input.txline.exactFixtureScoreFrames,
      completedExactFixtureScoreFrames: input.txline.completedExactFixtureScoreFrames,
      selectedTotalUsableOddsFrames: txlineLine.usableFrames,
      selectedTotalFirstObservedAt: iso(txlineLine.firstObservedTsMs)!,
      selectedTotalLastObservedAt: iso(txlineLine.lastObservedTsMs)!,
      finalScore: input.txline.finalScore
    },
    kickoffClose: closeAvailable ? {
      available: true,
      txlineObservedAt: iso(txlineLine.latestPreKickoffObservedTsMs),
      polymarketAssetObservedAt: Object.fromEntries(typedAssets.map((asset) => [
        asset.assetId,
        iso(asset.latestPreKickoffObservedTsMs)!
      ]))
    } : {
      available: false,
      txlineObservedAt: null,
      polymarketAssetObservedAt: {}
    },
    resolution: resolution ? {
      available: true,
      normalized: true,
      conditionId: resolution.conditionId,
      assetIds: resolution.assetIds,
      winningAssetId: resolution.winningAssetId,
      winningOutcome: resolution.winningOutcome,
      observedAt: iso(resolution.observedTsMs)
    } : {
      available: false,
      normalized: false,
      conditionId: null,
      assetIds: [],
      winningAssetId: null,
      winningOutcome: null,
      observedAt: null
    }
  };
}

async function canonicalIngressEvidence(input: {
  mappingsPath: string;
  oddsPath: string;
  scoresPath: string;
  messagesPath: string;
  selected: SelectedTotalBinding;
  fixtureId: string;
}): Promise<VerifiedPairedAnalysisManifest["selectedMarketEvidence"]["canonicalIngress"]> {
  const mappingDocument = z.object({ records: z.array(z.unknown()).min(1) }).passthrough()
    .parse(JSON.parse(await readFile(input.mappingsPath, "utf8")) as unknown);
  const registry = new MappingRegistry(mappingDocument.records);
  const profile = await profileCapturedPaperIngress(capturedPaperReplaySource({
    txlineOddsFramesPath: input.oddsPath,
    txlineScoresFramesPath: input.scoresPath,
    polymarketMessagesPath: input.messagesPath,
    registry,
    speed: Number.POSITIVE_INFINITY
  }), {
    fixtureId: input.fixtureId,
    marketId: input.selected.marketId,
    conditionId: input.selected.conditionId,
    lineMilli: input.selected.lineMilli,
    assetIds: input.selected.assetIds
  });
  return {
    eventCount: profile.eventCount,
    firstObservedAt: new Date(profile.firstObservedTsMs).toISOString(),
    lastObservedAt: new Date(profile.lastObservedTsMs).toISOString(),
    modelStallBudgetMs: profile.modelStallBudgetMs,
    maximumEventsInModelStallWindow: profile.maximumEventsInModelStallWindow,
    requiredIngressCapacity: capturedPaperIngressCapacity(profile),
    counts: profile.counts
  };
}

async function pidStale(path: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(path, "utf8")).trim());
    if (!Number.isInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function terminalStream(terminal: SynchronizedCaptureEvidence, name: string): SynchronizedCaptureEvidence["streams"][number] {
  const stream = terminal.streams.find((candidate) => candidate.name === name);
  if (!stream) throw new CaptureAnalysisError("terminal_stream_missing", `Terminal evidence lacks ${name}`);
  return stream;
}

async function analyzeVerifiedInputs(
  options: BuildPairedCaptureAnalysisOptions,
  config: CaptureConfig,
  terminal: SynchronizedCaptureEvidence,
  checkedAt: string,
  inputHashes: Record<string, string | null>,
  inputCommitment: string
): Promise<PairedCaptureAnalysisManifest> {
  const runId = config.capture.runLabel;
  const polymarketDir = resolve(options.repoRoot, "samples/polymarket-live", runId);
  const txlineDir = resolve(options.repoRoot, "samples/odds-sse/mainnet", runId);
  const subscriptionsPath = resolve(polymarketDir, "subscriptions.json");
  const messagesPath = resolve(polymarketDir, "messages.ndjson");
  const oddsPath = resolve(txlineDir, "odds.frames.ndjson");
  const scoresPath = resolve(txlineDir, "scores.frames.ndjson");
  const subscriptionDocument = JSON.parse(await readFile(subscriptionsPath, "utf8")) as unknown;
  const subscriptions = subscriptionGroups(subscriptionDocument, config);
  const kickoffTsMs = Date.parse(config.txline.kickoffUtc);
  const [polymarket, txline] = await Promise.all([
    scanPolymarket(messagesPath, subscriptions.groups, kickoffTsMs),
    scanTxline(oddsPath, scoresPath, config.txline.fixtureId, kickoffTsMs)
  ]);
  const captureMarkets = derivedMarketEvidence(polymarket, txline);
  const captureMarketUsable = [...polymarket.markets.values()].some((market) =>
    [...market.assets.values()].every((asset) => asset.usableDepthSnapshots > 0) &&
    (txline.totalsByLine.get(market.group.lineMilli)?.usableFrames ?? 0) > 0
  );
  if (!captureMarketUsable) {
    throw new CaptureAnalysisError(
      "capture_microstructure_incomplete",
      "No exact full-time total has both-outcome book depth and matching TXLine odds"
    );
  }
  const selection = await selectTotal(options, config, subscriptions.groups);
  if (selection.selectedTotal === null) {
    const deterministic = {
      schemaVersion: 2,
      runId,
      fixtureId: config.txline.fixtureId,
      captureWindow: {
        startUtc: config.capture.scheduledStartUtc,
        endUtc: config.capture.scheduledEndUtc
      },
      captureMarkets,
      txline: {
        exactFixtureOddsFrames: txline.exactFixtureOddsFrames,
        exactFixtureScoreFrames: txline.exactFixtureScoreFrames,
        completedExactFixtureScoreFrames: txline.completedExactFixtureScoreFrames,
        finalScore: txline.finalScore
      },
      inputCommitment,
      admissionMissingGates: [...new Set(selection.missingGates)].sort()
    };
    const analysisCommitment = sha256(stableJson(deterministic));
    return {
      schemaVersion: 2,
      runId,
      checkedAt,
      status: "verified_capture",
      fixtureId: config.txline.fixtureId,
      eventSlug: config.polymarket.eventSlug,
      totalsEventSlug: config.polymarket.totalsEventSlug,
      captureVerification: { status: "verified", terminalEvidenceAvailable: true },
      selectedTotal: null,
      marketEvidence: captureMarkets,
      proof: { algorithm: "sha256", inputCommitment, analysisCommitment, inputHashes },
      admission: {
        status: "failed_closed",
        missingGates: [...new Set(selection.missingGates)].sort()
      },
      failures: [],
      notes: [
        "Completed capture and per-market microstructure verified; no market was admitted without causal selection evidence.",
        "Derived metadata only; no raw TXLine payload is written to this manifest."
      ]
    };
  }

  const evidence = {
    ...selectedEvidence({ selected: selection.selectedTotal, polymarket, txline, kickoffTsMs }),
    canonicalIngress: await canonicalIngressEvidence({
      mappingsPath: options.mappingsPath,
      oddsPath,
      scoresPath,
      messagesPath,
      selected: selection.selectedTotal,
      fixtureId: config.txline.fixtureId
    })
  } satisfies VerifiedPairedAnalysisManifest["selectedMarketEvidence"];
  const polymarketTerminal = terminalStream(terminal, "polymarket");
  const oddsTerminal = terminalStream(terminal, "txline_odds");
  const scoresTerminal = terminalStream(terminal, "txline_scores");
  const synchronizedStartTsMs = Math.max(
    polymarketTerminal.firstReceivedTsMs,
    oddsTerminal.firstReceivedTsMs,
    scoresTerminal.firstReceivedTsMs
  );
  const admissionMissing = [...selection.missingGates];
  if (synchronizedStartTsMs > kickoffTsMs - PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS) {
    admissionMissing.push("synchronized_pre_cutoff_capture_required");
  }
  if (!evidence.kickoffClose.available) admissionMissing.push("selected_condition_kickoff_close_required");
  if (!evidence.resolution.available || !evidence.resolution.normalized) {
    admissionMissing.push("selected_condition_public_resolution_required");
  }
  const missingGates = [...new Set(admissionMissing)].sort();
  const admission = missingGates.length === 0
    ? { status: "eligible" as const, missingGates }
    : { status: "failed_closed" as const, missingGates };
  const counts = {
    "odds.quote": txline.usableOddsFrames,
    "score.update": txline.exactFixtureScoreFrames,
    "polymarket.book": polymarket.books,
    "polymarket.price": polymarket.prices,
    "polymarket.resolution": polymarket.resolutions
  };
  const identityMaterial = {
    fixtureId: config.txline.fixtureId,
    home: config.txline.home,
    away: config.txline.away,
    kickoffUtc: config.txline.kickoffUtc,
    eventSlug: config.polymarket.eventSlug,
    selectedTotal: selection.selectedTotal
  };
  const deterministic = {
    schemaVersion: 2,
    runId,
    identity: identityMaterial,
    captureWindow: {
      scheduledStartUtc: config.capture.scheduledStartUtc,
      scheduledEndUtc: config.capture.scheduledEndUtc,
      synchronizedStartUtc: terminal.synchronizedStartUtc,
      synchronizedEndUtc: terminal.synchronizedEndUtc
    },
    selectedMarketEvidence: evidence,
    counts,
    mappingConfirmed: selection.mappingConfirmed,
    admission,
    inputCommitment
  };
  const analysisCommitment = sha256(stableJson(deterministic));
  const manifest: VerifiedPairedAnalysisManifest = {
    schemaVersion: 2,
    runId,
    checkedAt,
    status: "verified",
    fixtureId: config.txline.fixtureId,
    eventSlug: config.polymarket.eventSlug,
    totalsEventSlug: config.polymarket.totalsEventSlug,
    capture: {
      logPath: relativePath(options.repoRoot, resolve(options.repoRoot, "samples/_logs", `${runId}.log`)),
      txlineDir: relativePath(options.repoRoot, txlineDir),
      polymarketDir: relativePath(options.repoRoot, polymarketDir),
      logComplete: true,
      pidStale: await pidStale(resolve(options.repoRoot, "samples/_logs", `${runId}.pid`)),
      mappingConfirmed: selection.mappingConfirmed,
      scheduledStartUtc: config.capture.scheduledStartUtc,
      scheduledEndUtc: config.capture.scheduledEndUtc,
      kickoffUtc: config.txline.kickoffUtc,
      signalCutoffUtc: new Date(kickoffTsMs - PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS).toISOString(),
      firstPolymarketObservedAt: polymarketTerminal.firstReceivedAt,
      lastPolymarketObservedAt: polymarketTerminal.lastReceivedAt,
      firstTxlineOddsObservedAt: oddsTerminal.firstReceivedAt,
      lastTxlineOddsObservedAt: oddsTerminal.lastReceivedAt,
      firstTxlineScoresObservedAt: scoresTerminal.firstReceivedAt,
      lastTxlineScoresObservedAt: scoresTerminal.lastReceivedAt,
      expectedDurationMinutes: config.capture.durationMinutes,
      observedSpanMinutes: (Date.parse(terminal.synchronizedEndUtc) - Date.parse(terminal.synchronizedStartUtc)) / 60_000,
      mappedAssetCount: subscriptions.allAssetCount,
      mappingRegistryRecords: selection.mappingRecords
    },
    selectedTotal: selection.selectedTotal,
    selectedMarketEvidence: evidence,
    verification: {
      node: process.version,
      replayMode: "capture-order-per-source",
      identityParity: true,
      identityHash: sha256(stableJson(identityMaterial)),
      headHash: analysisCommitment,
      rows: Object.values(counts).reduce((sum, count) => sum + count, 0),
      counts,
      hasModeField: false,
      selectedBookDepthComplete: true,
      exactFixtureTxlineOddsAvailable: true,
      exactFixtureTxlineScoresAvailable: true,
      exactFixtureScoreCompleted: true,
      kickoffCloseAvailable: evidence.kickoffClose.available,
      publicResolutionAvailable: evidence.resolution.available,
      publicMarketResolvedNormalized: evidence.resolution.normalized
    },
    proof: {
      algorithm: "sha256",
      inputCommitment,
      analysisCommitment,
      inputHashes: verifiedInputHashes(inputHashes)
    },
    admission,
    failures: [],
    notes: [
      "Selected full-time total is bound to exact fixture, event, market, condition, line, and sorted outcome assets.",
      "Book depth, TXLine odds/scores, kickoff close, and public resolution are evaluated only for that selected condition.",
      "Derived metadata only; no raw TXLine payload is written to this manifest."
    ]
  };
  return verifiedPairedAnalysisManifestSchema.parse(manifest);
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function safeDetail(error: unknown, repoRoot: string): string {
  return (error instanceof Error ? error.message : String(error)).replaceAll(repoRoot, "<repo>");
}

export async function buildAndWritePairedCaptureAnalysis(
  options: BuildPairedCaptureAnalysisOptions
): Promise<PairedCaptureAnalysisManifest> {
  const repoRoot = resolve(options.repoRoot);
  const normalizedOptions = {
    ...options,
    repoRoot,
    captureConfigPath: resolve(options.captureConfigPath),
    mappingsPath: resolve(options.mappingsPath),
    totalEvidencePath: resolve(options.totalEvidencePath),
    outputPath: resolve(options.outputPath)
  };
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("checkedAt must be an ISO timestamp");
  let runId = "unknown-capture";
  let fixtureId = "unknown-fixture";
  let eventSlug = "unknown-event";
  let totalsEventSlug = "unknown-totals-event";
  let inputHashes: Record<string, string | null> = {};
  let inputCommitment = sha256(stableJson(inputHashes));
  let terminalEvidenceAvailable = false;
  let outputVerifiedSafe = false;
  try {
    // This is the only config read used by the analysis. The exact bytes parsed
    // here are committed below alongside the two evidence snapshots they name.
    const configText = await readFile(normalizedOptions.captureConfigPath, "utf8");
    const rawConfig = JSON.parse(configText) as JsonRecord;
    const evidenceEnvelope = captureEvidenceEnvelopeSchema.parse(rawConfig);
    const txlineFixtureSnapshotPath = resolve(repoRoot, evidenceEnvelope.evidence.txlineFixtures);
    const polymarketEventSnapshotPath = resolve(repoRoot, evidenceEnvelope.evidence.polymarketEvents);
    runId = String(asRecord(rawConfig.capture)?.runLabel ?? rawConfig.captureId ?? runId);
    fixtureId = String(asRecord(rawConfig.txline)?.fixtureId ?? fixtureId);
    eventSlug = String(asRecord(rawConfig.polymarket)?.eventSlug ?? eventSlug);
    totalsEventSlug = String(asRecord(rawConfig.polymarket)?.totalsEventSlug ?? totalsEventSlug);
    const polymarketDir = resolve(repoRoot, "samples/polymarket-live", runId);
    const txlineDir = resolve(repoRoot, "samples/odds-sse/mainnet", runId);
    const requiredOutputPath = resolve(repoRoot, "data/live", runId, "analysis-manifest.json");
    if (normalizedOptions.outputPath !== requiredOutputPath) {
      throw new CaptureAnalysisError(
        "analysis_output_path_invalid",
        `Analysis output must be the sealed run path ${relativePath(repoRoot, requiredOutputPath)}`
      );
    }
    const files = {
      captureConfig: normalizedOptions.captureConfigPath,
      txlineFixtureSnapshot: txlineFixtureSnapshotPath,
      polymarketEventSnapshot: polymarketEventSnapshotPath,
      polymarketTerminalManifest: resolve(polymarketDir, "capture-manifest.json"),
      txlineTerminalManifest: resolve(txlineDir, "txline-capture-manifest.json"),
      subscriptions: resolve(polymarketDir, "subscriptions.json"),
      polymarketMessages: resolve(polymarketDir, "messages.ndjson"),
      txlineOdds: resolve(txlineDir, "odds.frames.ndjson"),
      txlineScores: resolve(txlineDir, "scores.frames.ndjson"),
      mappings: normalizedOptions.mappingsPath,
      causalTotalEvidence: normalizedOptions.totalEvidencePath
    };
    await assertFilesystemPathWithin(
      normalizedOptions.outputPath,
      repoRoot,
      "Capture analysis output"
    );
    await Promise.all([
      assertFilesystemPathWithin(
        txlineFixtureSnapshotPath,
        repoRoot,
        "TXLine fixture evidence snapshot"
      ),
      assertFilesystemPathWithin(
        polymarketEventSnapshotPath,
        repoRoot,
        "Polymarket event evidence snapshot"
      )
    ]);
    await assertDistinctFilesystemPaths(
      [normalizedOptions.outputPath, ...Object.values(files)],
      "Capture analysis output and input"
    );
    outputVerifiedSafe = true;
    const [txlineFixtureSnapshotText, polymarketEventSnapshotText] = await Promise.all([
      readFile(txlineFixtureSnapshotPath, "utf8"),
      readFile(polymarketEventSnapshotPath, "utf8")
    ]);
    inputHashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [
      name,
      await optionalFileHash(path)
    ] as const)));
    if (
      inputHashes.captureConfig !== sha256(configText) ||
      inputHashes.txlineFixtureSnapshot !== sha256(txlineFixtureSnapshotText) ||
      inputHashes.polymarketEventSnapshot !== sha256(polymarketEventSnapshotText)
    ) {
      throw new CaptureAnalysisError(
        "capture_inputs_changed_before_analysis",
        "Capture config or referenced evidence changed while the stable input snapshot was being established"
      );
    }
    inputCommitment = sha256(stableJson(inputHashes));
    const config = validateStableCaptureConfig(
      normalizedOptions,
      rawConfig,
      txlineFixtureSnapshotText,
      polymarketEventSnapshotText
    );
    if (config.capture.runLabel !== runId) {
      throw new CaptureAnalysisError(
        "capture_config_identity_changed",
        "Validated capture run label does not match the committed config identity"
      );
    }
    const terminal = await verifyTerminalCaptureEvidence(repoRoot, config);
    terminalEvidenceAvailable = true;
    const manifest = await analyzeVerifiedInputs(
      normalizedOptions,
      config,
      terminal,
      checkedAt,
      inputHashes,
      inputCommitment
    );
    const hashesAfterAnalysis = Object.fromEntries(await Promise.all(
      Object.entries(files).map(async ([name, path]) => [name, await optionalFileHash(path)] as const)
    ));
    if (stableJson(hashesAfterAnalysis) !== stableJson(inputHashes)) {
      throw new CaptureAnalysisError(
        "capture_inputs_changed_during_analysis",
        "One or more capture-analysis inputs changed while they were being scanned"
      );
    }
    await atomicWriteJson(normalizedOptions.outputPath, manifest);
    return manifest;
  } catch (error) {
    if (!outputVerifiedSafe) throw error;
    const code = error instanceof CaptureAnalysisError ? error.code : "capture_analysis_failed";
    const failures = [{ code, detail: safeDetail(error, repoRoot) }];
    const deterministic = {
      schemaVersion: 2,
      runId,
      fixtureId,
      eventSlug,
      totalsEventSlug,
      inputCommitment,
      failures
    };
    const manifest: PairedCaptureAnalysisManifest = {
      schemaVersion: 2,
      runId,
      checkedAt,
      status: "failed_closed",
      fixtureId,
      eventSlug,
      totalsEventSlug,
      captureVerification: { status: "failed_closed", terminalEvidenceAvailable },
      selectedTotal: null,
      marketEvidence: [],
      proof: {
        algorithm: "sha256",
        inputCommitment,
        analysisCommitment: sha256(stableJson(deterministic)),
        inputHashes
      },
      admission: {
        status: "failed_closed",
        missingGates: [code]
      },
      failures,
      notes: [
        "Analysis failed closed and this atomic manifest carries no fixture-admission authority.",
        "Derived metadata only; no raw TXLine payload is written to this manifest."
      ]
    };
    await atomicWriteJson(normalizedOptions.outputPath, manifest);
    return manifest;
  }
}

export function parsePairedCaptureAnalysisArgs(argv: readonly string[], cwd = process.cwd()): BuildPairedCaptureAnalysisOptions {
  // pnpm 11 forwards the conventional script-argument separator. Strip only
  // one leading separator; a separator anywhere else remains an unknown token.
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const allowed = new Set(["capture-config", "mappings", "total-evidence", "output"]);
  const values = new Map<string, string>();
  for (let index = 0; index < normalizedArgv.length; index += 2) {
    const token = normalizedArgv[index];
    if (!token?.startsWith("--") || !allowed.has(token.slice(2))) {
      throw new Error(`Unknown paired-capture analysis option: ${token ?? "<missing>"}`);
    }
    const name = token.slice(2);
    if (values.has(name)) throw new Error(`Duplicate paired-capture analysis option: --${name}`);
    const value = normalizedArgv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    values.set(name, value);
  }
  const configValue = values.get("capture-config");
  if (!configValue) throw new Error("--capture-config is required; no fixture is selected implicitly");
  const captureConfigPath = resolve(cwd, configValue);
  const raw = JSON.parse(readFileSync(captureConfigPath, "utf8")) as JsonRecord;
  const runId = String(asRecord(raw.capture)?.runLabel ?? raw.captureId ?? "");
  if (!/^paired-[a-z0-9-]+$/.test(runId)) throw new Error("Capture config does not contain a safe paired run label");
  return {
    repoRoot: cwd,
    captureConfigPath,
    mappingsPath: resolve(cwd, values.get("mappings") ?? "data/research/mappings/world-cup-candidates.json"),
    totalEvidencePath: resolve(cwd, values.get("total-evidence") ?? "data/research/main-total-line-evidence-causal-v2.json"),
    outputPath: resolve(cwd, values.get("output") ?? `data/live/${runId}/analysis-manifest.json`)
  };
}

async function main(): Promise<void> {
  const options = parsePairedCaptureAnalysisArgs(process.argv.slice(2));
  const manifest = await buildAndWritePairedCaptureAnalysis(options);
  process.stdout.write(`${JSON.stringify({
    outputPath: options.outputPath,
    status: manifest.status,
    admission: manifest.admission
  }, null, 2)}\n`);
  if (manifest.status === "failed_closed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
