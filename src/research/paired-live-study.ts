import { readFile } from "node:fs/promises";
import type {
  CanonicalOutcome,
  OddsQuoteEvent,
  PolymarketBookEvent,
  PolymarketPriceEvent,
  ScoreEvent
} from "../bus/events.js";
import {
  normalizePolymarketPayload
} from "../ingest/polymarket/normalizer.js";
import { replayCapturedTxLineFrames } from "../ingest/txline/replay.js";
import { MappingRegistry, type MappedAsset, type MappingRecord } from "../mapping/registry.js";
import { readNdjson } from "../replay/files.js";

type CandidateFile = { records?: unknown[] };

type CapturedPolymarketMessage = {
  receivedAt: string;
  eventType: string;
  assetIds?: string[];
  rawPayload: string;
  parseError?: string | null;
};

export type ReconnectRecord = {
  at?: string;
  action?: string;
  connectionIndex?: number;
  code?: number;
  clean?: boolean;
};

export type FeedOutage = {
  connectionIndex: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  closeCode: number | null;
};

export type FeedOutageSummary = {
  outages: FeedOutage[];
  totalDowntimeMs: number;
  maximumDowntimeMs: number;
  unresolvedOutages: number;
};

export type LatencySummary = {
  count: number;
  minimumMs: number | null;
  maximumMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p99Ms: number | null;
  histogramResolutionMs: 1;
  belowHistogramRange: number;
  aboveHistogramRange: number;
};

export class MillisecondLatencyHistogram {
  readonly #bins: Uint32Array;
  #count = 0;
  #sum = 0;
  #minimum = Number.POSITIVE_INFINITY;
  #maximum = Number.NEGATIVE_INFINITY;
  #below = 0;
  #above = 0;

  constructor(
    readonly minimumBinMs = -60_000,
    readonly maximumBinMs = 60_000
  ) {
    if (!Number.isInteger(minimumBinMs) || !Number.isInteger(maximumBinMs) || minimumBinMs >= maximumBinMs) {
      throw new RangeError("Latency histogram requires increasing integer millisecond bounds");
    }
    this.#bins = new Uint32Array(maximumBinMs - minimumBinMs + 1);
  }

  add(valueMs: number): void {
    if (!Number.isFinite(valueMs)) throw new RangeError("Latency must be finite");
    const rounded = Math.round(valueMs);
    this.#count += 1;
    this.#sum += valueMs;
    this.#minimum = Math.min(this.#minimum, valueMs);
    this.#maximum = Math.max(this.#maximum, valueMs);
    if (rounded < this.minimumBinMs) this.#below += 1;
    else if (rounded > this.maximumBinMs) this.#above += 1;
    else {
      const index = rounded - this.minimumBinMs;
      this.#bins[index] = this.#bins[index]! + 1;
    }
  }

  summary(): LatencySummary {
    return {
      count: this.#count,
      minimumMs: this.#count === 0 ? null : this.#minimum,
      maximumMs: this.#count === 0 ? null : this.#maximum,
      meanMs: this.#count === 0 ? null : this.#sum / this.#count,
      p50Ms: this.#quantile(0.5),
      p90Ms: this.#quantile(0.9),
      p99Ms: this.#quantile(0.99),
      histogramResolutionMs: 1,
      belowHistogramRange: this.#below,
      aboveHistogramRange: this.#above
    };
  }

  #quantile(probability: number): number | null {
    if (this.#count === 0) return null;
    const target = Math.max(1, Math.ceil(this.#count * probability));
    if (target <= this.#below) return Math.round(this.#minimum);
    let cumulative = this.#below;
    for (let index = 0; index < this.#bins.length; index += 1) {
      cumulative += this.#bins[index]!;
      if (cumulative >= target) return this.minimumBinMs + index;
    }
    return Math.round(this.#maximum);
  }
}

export function summarizeFeedOutages(records: readonly ReconnectRecord[]): FeedOutageSummary {
  const outages: FeedOutage[] = [];
  let pending: { atMs: number; record: ReconnectRecord } | null = null;
  for (const record of records) {
    if (record.action === "disconnect") {
      if (record.code === 1000 && record.clean === true) continue;
      const atMs = Date.parse(record.at ?? "");
      if (!Number.isFinite(atMs)) throw new Error(`Invalid reconnect timestamp: ${String(record.at)}`);
      pending = { atMs, record };
      continue;
    }
    if (record.action !== "open-and-resubscribe" || pending === null) continue;
    const endedAtMs = Date.parse(record.at ?? "");
    if (!Number.isFinite(endedAtMs) || endedAtMs < pending.atMs) {
      throw new Error(`Invalid reconnect completion timestamp: ${String(record.at)}`);
    }
    outages.push({
      connectionIndex: pending.record.connectionIndex ?? null,
      startedAt: new Date(pending.atMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - pending.atMs,
      closeCode: pending.record.code ?? null
    });
    pending = null;
  }
  if (pending !== null) {
    outages.push({
      connectionIndex: pending.record.connectionIndex ?? null,
      startedAt: new Date(pending.atMs).toISOString(),
      endedAt: null,
      durationMs: null,
      closeCode: pending.record.code ?? null
    });
  }
  const durations = outages.flatMap((outage) => outage.durationMs === null ? [] : [outage.durationMs]);
  return {
    outages,
    totalDowntimeMs: durations.reduce((sum, duration) => sum + duration, 0),
    maximumDowntimeMs: durations.length === 0 ? 0 : Math.max(...durations),
    unresolvedOutages: outages.filter((outage) => outage.durationMs === null).length
  };
}

type BookState = {
  bids: Map<number, number>;
  asks: Map<number, number>;
  bestBid: number | null;
  bestAsk: number | null;
  observedTsMs: number | null;
  sourceTsMs: number | null;
};

type GroupDefinition = {
  marketKey: string;
  family: "match_result" | "total_goals";
  lineMilli: number | null;
  mappingStatus: "candidate" | "verified" | "rejected";
  assets: MappedAsset[];
};

type QuotePoint = { observedTsMs: number; event: OddsQuoteEvent };

export type OutcomeBookSnapshot = {
  outcome: CanonicalOutcome;
  assetId: string;
  consensusProbability: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spread: number | null;
  bestBidSize: number | null;
  bestAskSize: number | null;
  quoteAgeMs: number | null;
  executableBuyGap: number | null;
};

export type GroupBookSnapshot = {
  marketKey: string;
  family: "match_result" | "total_goals";
  lineMilli: number | null;
  mappingStatus: "candidate" | "verified" | "rejected";
  atTsMs: number;
  probabilitySum: number | null;
  maximumSpread: number | null;
  outcomes: OutcomeBookSnapshot[];
};

type GoalPoint = {
  actionId: number;
  participant: number | null;
  clockSeconds: number | null;
  firstSeenSourceTsMs: number;
  firstSeenObservedTsMs: number;
  firstSeenConfirmed: boolean | null;
  firstConfirmedSourceTsMs: number | null;
  firstConfirmedObservedTsMs: number | null;
};

type GoalTracker = {
  goal: GoalPoint;
  snapshots: Map<number, GroupBookSnapshot[]>;
  firstMarketEventMs: Map<string, number>;
  firstQuoteUpdateMs: Map<string, number>;
  firstMaterialMoveMs: Map<string, number>;
};

export type RepricingEvidence = {
  marketKey: string;
  family: "match_result" | "total_goals";
  lineMilli: number | null;
  firstMarketEventLatencyMs: number | null;
  firstQuoteUpdateLatencyMs: number | null;
  firstMaterialMoveLatencyMs: number | null;
  preTriggerFiveSecondMove: number | null;
  classification:
    | "polymarket_moved_before_txline"
    | "post_txline_reprice_observed"
    | "no_material_reprice_in_window"
    | "insufficient_book_state";
  outageAtTrigger: boolean;
  outageBeforeMaterialMove: boolean;
  snapshots: Array<{ horizonMs: number; book: GroupBookSnapshot }>;
};

export type GoalStudy = GoalPoint & {
  txlineFirstSeenLatencyMs: number;
  confirmationDelayMs: number | null;
  markets: RepricingEvidence[];
};

export type PairedLiveStudyOptions = {
  fixtureId: string;
  mappingPath: string;
  polymarketMessagesPath: string;
  polymarketReconnectsPath: string;
  txlineOddsPath: string;
  txlineScoresPath: string;
  materialMoveProbability: number;
  snapshotHorizonsMs?: readonly number[];
};

export type PairedLiveStudy = {
  schemaVersion: 1;
  generatedAt: string;
  status: "research_evidence_only";
  tradeable: false;
  fixtureId: string;
  configuration: {
    materialMoveProbability: number;
    materialMoveProbabilityBps: number;
    reconnectRecoveryExclusionMs: number;
    snapshotHorizonsMs: number[];
  };
  sourcePaths: Omit<PairedLiveStudyOptions, "fixtureId" | "materialMoveProbability" | "snapshotHorizonsMs">;
  mapping: {
    records: number;
    groups: number;
    canonicalAssets: number;
    statuses: string[];
  };
  analysisWindow: {
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    stoppedAt: string;
    messagesScanned: number;
    targetMessages: number;
    normalizedEvents: number;
    eventTypes: Record<string, number>;
  };
  feedHealth: {
    polymarketOutages: FeedOutageSummary;
    txlineOddsLatency: LatencySummary;
    txlineScoreLatency: LatencySummary;
    polymarketVenueTimestampAgeAllCanonicalEvents: LatencySummary;
    polymarketVenueTimestampAgeNonBookOutsideRecovery: LatencySummary;
    polymarketVenueTimestampAgeByObservation: Record<string, LatencySummary>;
  };
  goals: GoalStudy[];
  gateReadout: {
    marketEventCases: number;
    polymarketMovedBeforeTxline: number;
    postTxlineRepriceObserved: number;
    noMaterialRepriceInWindow: number;
    insufficientBookState: number;
    staleQuoteHypothesis: "not_supported_by_this_match" | "requires_more_evidence";
  };
};

function midpoint(state: BookState): number | null {
  return state.bestBid === null || state.bestAsk === null
    ? null
    : (state.bestBid + state.bestAsk) / 2;
}

function bestLevel(levels: Map<number, number>, side: "bid" | "ask"): number | null {
  if (levels.size === 0) return null;
  const prices = [...levels.keys()];
  return side === "bid" ? Math.max(...prices) : Math.min(...prices);
}

function updateBookState(
  state: BookState,
  event: PolymarketBookEvent | PolymarketPriceEvent
): boolean {
  let quoteUpdated = false;
  if (event.kind === "polymarket.book") {
    state.bids = new Map(event.bids.map((level) => [level.price, Number(level.size)]));
    state.asks = new Map(event.asks.map((level) => [level.price, Number(level.size)]));
    state.bestBid = bestLevel(state.bids, "bid");
    state.bestAsk = bestLevel(state.asks, "ask");
    quoteUpdated = true;
  } else {
    if (event.observation === "price_change" && event.price !== null && event.size !== null && event.side !== null) {
      const levels = event.side === "BUY" ? state.bids : state.asks;
      const size = Number(event.size);
      if (Number.isFinite(size) && size > 0) levels.set(event.price, size);
      else levels.delete(event.price);
      quoteUpdated = true;
    }
    if (event.bestBid !== null) {
      state.bestBid = event.bestBid;
      quoteUpdated = true;
    } else if (event.observation === "price_change") state.bestBid = bestLevel(state.bids, "bid");
    if (event.bestAsk !== null) {
      state.bestAsk = event.bestAsk;
      quoteUpdated = true;
    } else if (event.observation === "price_change") state.bestAsk = bestLevel(state.asks, "ask");
  }
  state.observedTsMs = event.observedTsMs;
  state.sourceTsMs = event.sourceTsMs;
  return quoteUpdated;
}

function latestQuote(points: readonly QuotePoint[], atTsMs: number): OddsQuoteEvent | null {
  let low = 0;
  let high = points.length - 1;
  let found: OddsQuoteEvent | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = points[middle]!;
    if (point.observedTsMs <= atTsMs) {
      found = point.event;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

function snapshotGroup(
  group: GroupDefinition,
  states: ReadonlyMap<string, BookState>,
  quoteHistory: ReadonlyMap<string, QuotePoint[]>,
  atTsMs: number
): GroupBookSnapshot {
  const consensus = latestQuote(quoteHistory.get(group.marketKey) ?? [], atTsMs);
  const outcomes = group.assets.map((asset): OutcomeBookSnapshot => {
    const state = states.get(asset.assetId);
    const fair = consensus?.outcomes.find((outcome) => outcome.outcome === asset.outcome)?.fairProbability ?? null;
    const bid = state?.bestBid ?? null;
    const ask = state?.bestAsk ?? null;
    const mid = state ? midpoint(state) : null;
    return {
      outcome: asset.outcome,
      assetId: asset.assetId,
      consensusProbability: fair,
      bestBid: bid,
      bestAsk: ask,
      midpoint: mid,
      spread: bid === null || ask === null ? null : ask - bid,
      bestBidSize: bid === null ? null : (state?.bids.get(bid) ?? null),
      bestAskSize: ask === null ? null : (state?.asks.get(ask) ?? null),
      quoteAgeMs: state?.observedTsMs === null || state?.observedTsMs === undefined
        ? null
        : atTsMs - state.observedTsMs,
      executableBuyGap: fair === null || ask === null ? null : fair - ask
    };
  });
  const mids = outcomes.flatMap((outcome) => outcome.midpoint === null ? [] : [outcome.midpoint]);
  const spreads = outcomes.flatMap((outcome) => outcome.spread === null ? [] : [outcome.spread]);
  return {
    marketKey: group.marketKey,
    family: group.family,
    lineMilli: group.lineMilli,
    mappingStatus: group.mappingStatus,
    atTsMs,
    probabilitySum: mids.length === outcomes.length ? mids.reduce((sum, value) => sum + value, 0) : null,
    maximumSpread: spreads.length === 0 ? null : Math.max(...spreads),
    outcomes
  };
}

function maximumMidpointMove(left: GroupBookSnapshot, right: GroupBookSnapshot): number | null {
  const changes: number[] = [];
  for (const outcome of left.outcomes) {
    const other = right.outcomes.find((candidate) => candidate.assetId === outcome.assetId);
    if (outcome.midpoint !== null && other?.midpoint !== null && other?.midpoint !== undefined) {
      changes.push(Math.abs(other.midpoint - outcome.midpoint));
    }
  }
  return changes.length === 0 ? null : Math.max(...changes);
}

function targetPayload(value: unknown, assetIds: ReadonlySet<string>): unknown | null {
  if (Array.isArray(value)) {
    const filtered = value.flatMap((item) => {
      const target = targetPayload(item, assetIds);
      return target === null ? [] : [target];
    });
    return filtered.length === 0 ? null : filtered;
  }
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row["event_type"] === "price_change" && Array.isArray(row["price_changes"])) {
    const changes = row["price_changes"].filter((change) => {
      if (change === null || typeof change !== "object") return false;
      return assetIds.has(String((change as Record<string, unknown>)["asset_id"] ?? ""));
    });
    return changes.length === 0 ? null : { ...row, price_changes: changes };
  }
  const assetId = String(row["asset_id"] ?? "");
  return assetIds.has(assetId) ? row : null;
}

function groupDefinitions(registry: MappingRegistry): GroupDefinition[] {
  const groups = new Map<string, GroupDefinition>();
  for (const assetId of registry.assetIds()) {
    const asset = registry.resolveAsset(assetId);
    if (asset.tokenRole !== "canonical") continue;
    const group = groups.get(asset.market.key) ?? {
      marketKey: asset.market.key,
      family: asset.market.family,
      lineMilli: asset.market.lineMilli,
      mappingStatus: asset.mappingStatus,
      assets: []
    };
    group.assets.push(asset);
    groups.set(asset.market.key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, assets: group.assets.sort((a, b) => a.outcome.localeCompare(b.outcome)) }))
    .sort((left, right) =>
      left.family.localeCompare(right.family) ||
      (left.lineMilli ?? -1) - (right.lineMilli ?? -1)
    );
}

async function targetRegistry(path: string, fixtureId: string): Promise<{ registry: MappingRegistry; records: MappingRecord[] }> {
  const file = JSON.parse(await readFile(path, "utf8")) as CandidateFile;
  const all = new MappingRegistry(file.records ?? []);
  const records = all.records().filter((record) => record.txlineFixtureId === fixtureId);
  if (records.length === 0) throw new Error(`No mapping records found for fixture ${fixtureId}`);
  return { registry: new MappingRegistry(records), records: [...records] };
}

function outageContains(outages: readonly FeedOutage[], timestampMs: number): boolean {
  return outages.some((outage) => {
    const start = Date.parse(outage.startedAt);
    const end = outage.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(outage.endedAt);
    return timestampMs >= start && timestampMs <= end;
  });
}

function outageOverlaps(outages: readonly FeedOutage[], fromMs: number, toMs: number): boolean {
  return outages.some((outage) => {
    const start = Date.parse(outage.startedAt);
    const end = outage.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(outage.endedAt);
    return start <= toMs && end >= fromMs;
  });
}

function reconnectRecoveryContains(
  outages: readonly FeedOutage[],
  timestampMs: number,
  recoveryExclusionMs: number
): boolean {
  return outages.some((outage) => {
    if (outage.endedAt === null) return false;
    const end = Date.parse(outage.endedAt);
    return timestampMs >= end && timestampMs <= end + recoveryExclusionMs;
  });
}

function trackerSnapshots(
  tracker: GoalTracker,
  groups: readonly GroupDefinition[],
  states: ReadonlyMap<string, BookState>,
  quotes: ReadonlyMap<string, QuotePoint[]>,
  horizons: readonly number[],
  nextObservedTsMs: number
): void {
  for (const horizon of horizons) {
    if (tracker.snapshots.has(horizon)) continue;
    const boundary = tracker.goal.firstSeenObservedTsMs + horizon;
    if (nextObservedTsMs < boundary) continue;
    tracker.snapshots.set(
      horizon,
      groups.map((group) => snapshotGroup(group, states, quotes, boundary))
    );
  }
}

function groupSnapshot(tracker: GoalTracker, horizon: number, marketKey: string): GroupBookSnapshot | null {
  return tracker.snapshots.get(horizon)?.find((snapshot) => snapshot.marketKey === marketKey) ?? null;
}

export async function analyzePairedLiveCapture(options: PairedLiveStudyOptions): Promise<PairedLiveStudy> {
  if (!(options.materialMoveProbability > 0 && options.materialMoveProbability < 1)) {
    throw new RangeError("Material move probability must be between zero and one");
  }
  const horizons = [...new Set(options.snapshotHorizonsMs ?? [-5_000, -1_000, 0, 250, 500, 1_000, 2_000, 5_000, 10_000, 30_000])]
    .sort((left, right) => left - right);
  if (!horizons.includes(0) || horizons[0]! >= 0 || horizons.at(-1)! <= 0) {
    throw new Error("Snapshot horizons must include negative, zero, and positive offsets");
  }

  const { registry, records } = await targetRegistry(options.mappingPath, options.fixtureId);
  const groups = groupDefinitions(registry);
  const canonicalAssets = new Set(groups.flatMap((group) => group.assets.map((asset) => asset.assetId)));
  const quoteHistory = new Map<string, QuotePoint[]>();
  const oddsLatency = new MillisecondLatencyHistogram();
  const scoreLatency = new MillisecondLatencyHistogram();
  const goalsById = new Map<number, { first: ScoreEvent; confirmed: ScoreEvent | null }>();

  for await (const event of replayCapturedTxLineFrames(options.txlineScoresPath)) {
    if (event.kind !== "score.update" || event.fixtureId !== options.fixtureId) continue;
    scoreLatency.add(event.observedTsMs - event.sourceTsMs);
    if (event.action !== "goal") continue;
    const existing = goalsById.get(event.actionId);
    if (!existing) goalsById.set(event.actionId, { first: event, confirmed: event.confirmed === true ? event : null });
    else if (event.confirmed === true && existing.confirmed === null) existing.confirmed = event;
  }
  const goals: GoalPoint[] = [...goalsById.values()]
    .map(({ first, confirmed }) => ({
      actionId: first.actionId,
      participant: first.participant,
      clockSeconds: first.clock?.seconds ?? null,
      firstSeenSourceTsMs: first.sourceTsMs,
      firstSeenObservedTsMs: first.observedTsMs,
      firstSeenConfirmed: first.confirmed,
      firstConfirmedSourceTsMs: confirmed?.sourceTsMs ?? null,
      firstConfirmedObservedTsMs: confirmed?.observedTsMs ?? null
    }))
    .sort((left, right) => left.firstSeenObservedTsMs - right.firstSeenObservedTsMs);
  if (goals.length === 0) throw new Error(`No goal events found for fixture ${options.fixtureId}`);

  const groupKeys = new Set(groups.map((group) => group.marketKey));
  for await (const event of replayCapturedTxLineFrames(options.txlineOddsPath)) {
    if (event.kind !== "odds.quote" || event.fixtureId !== options.fixtureId || !groupKeys.has(event.market.key)) continue;
    oddsLatency.add(event.observedTsMs - event.sourceTsMs);
    const points = quoteHistory.get(event.market.key) ?? [];
    points.push({ observedTsMs: event.observedTsMs, event });
    quoteHistory.set(event.market.key, points);
  }

  const reconnectRecords: ReconnectRecord[] = [];
  for await (const record of readNdjson<ReconnectRecord>(options.polymarketReconnectsPath)) {
    reconnectRecords.push(record);
  }
  const outageSummary = summarizeFeedOutages(reconnectRecords);
  const trackers: GoalTracker[] = goals.map((goal) => ({
    goal,
    snapshots: new Map(),
    firstMarketEventMs: new Map(),
    firstQuoteUpdateMs: new Map(),
    firstMaterialMoveMs: new Map()
  }));
  const states = new Map<string, BookState>();
  for (const assetId of canonicalAssets) {
    states.set(assetId, {
      bids: new Map(),
      asks: new Map(),
      bestBid: null,
      bestAsk: null,
      observedTsMs: null,
      sourceTsMs: null
    });
  }

  const polymarketLatency = new MillisecondLatencyHistogram();
  const polymarketSteadyStateLatency = new MillisecondLatencyHistogram();
  const polymarketLatencyByObservation = new Map<string, MillisecondLatencyHistogram>();
  const reconnectRecoveryExclusionMs = 5_000;
  const eventTypes: Record<string, number> = {};
  const analysisStopMs = goals.at(-1)!.firstSeenObservedTsMs + horizons.at(-1)!;
  let firstMessageMs: number | null = null;
  let lastMessageMs: number | null = null;
  let messagesScanned = 0;
  let targetMessages = 0;
  let normalizedEvents = 0;

  for await (const message of readNdjson<CapturedPolymarketMessage>(options.polymarketMessagesPath)) {
    const observedTsMs = Date.parse(message.receivedAt);
    if (!Number.isFinite(observedTsMs)) throw new Error(`Invalid captured Polymarket timestamp: ${message.receivedAt}`);
    firstMessageMs ??= observedTsMs;
    lastMessageMs = observedTsMs;
    messagesScanned += 1;
    for (const tracker of trackers) {
      trackerSnapshots(tracker, groups, states, quoteHistory, horizons, observedTsMs);
    }
    if (observedTsMs > analysisStopMs) break;
    if (message.parseError) throw new Error(`Captured Polymarket parse error: ${message.parseError}`);
    if (message.assetIds && !message.assetIds.some((assetId) => canonicalAssets.has(assetId))) continue;
    const payload = targetPayload(JSON.parse(message.rawPayload) as unknown, canonicalAssets);
    if (payload === null) continue;
    targetMessages += 1;
    eventTypes[message.eventType] = (eventTypes[message.eventType] ?? 0) + 1;
    const events = normalizePolymarketPayload(payload, observedTsMs, registry);
    for (const event of events) {
      if (event.kind !== "polymarket.book" && event.kind !== "polymarket.price") continue;
      if (!canonicalAssets.has(event.assetId)) continue;
      normalizedEvents += 1;
      const sourceAgeMs = event.observedTsMs - event.sourceTsMs;
      const observation = event.kind === "polymarket.book" ? "book" : event.observation;
      const observationHistogram = polymarketLatencyByObservation.get(observation) ?? new MillisecondLatencyHistogram();
      observationHistogram.add(sourceAgeMs);
      polymarketLatencyByObservation.set(observation, observationHistogram);
      polymarketLatency.add(sourceAgeMs);
      if (event.kind !== "polymarket.book" &&
        event.observedTsMs > firstMessageMs + reconnectRecoveryExclusionMs &&
        !reconnectRecoveryContains(outageSummary.outages, event.observedTsMs, reconnectRecoveryExclusionMs)
      ) {
        polymarketSteadyStateLatency.add(sourceAgeMs);
      }
      const state = states.get(event.assetId)!;
      const quoteUpdated = updateBookState(state, event);
      for (const tracker of trackers) {
        if (event.observedTsMs < tracker.goal.firstSeenObservedTsMs) continue;
        const marketKey = event.market.key;
        if (!tracker.firstMarketEventMs.has(marketKey)) {
          tracker.firstMarketEventMs.set(marketKey, event.observedTsMs);
        }
        if (quoteUpdated && !tracker.firstQuoteUpdateMs.has(marketKey)) {
          tracker.firstQuoteUpdateMs.set(marketKey, event.observedTsMs);
        }
        if (tracker.firstMaterialMoveMs.has(marketKey)) continue;
        const baseline = groupSnapshot(tracker, 0, marketKey);
        const group = groups.find((candidate) => candidate.marketKey === marketKey);
        if (!baseline || !group) continue;
        const current = snapshotGroup(group, states, quoteHistory, event.observedTsMs);
        const movement = maximumMidpointMove(baseline, current);
        if (movement !== null && movement + Number.EPSILON >= options.materialMoveProbability) {
          tracker.firstMaterialMoveMs.set(marketKey, event.observedTsMs);
        }
      }
    }
  }
  for (const tracker of trackers) {
    trackerSnapshots(tracker, groups, states, quoteHistory, horizons, Number.POSITIVE_INFINITY);
  }

  const goalStudies: GoalStudy[] = trackers.map((tracker) => {
    const trigger = tracker.goal.firstSeenObservedTsMs;
    const markets = groups.map((group): RepricingEvidence => {
      const before = groupSnapshot(tracker, -5_000, group.marketKey);
      const baseline = groupSnapshot(tracker, 0, group.marketKey);
      const preMove = before && baseline ? maximumMidpointMove(before, baseline) : null;
      const firstMaterialAt = tracker.firstMaterialMoveMs.get(group.marketKey) ?? null;
      let classification: RepricingEvidence["classification"];
      if (preMove === null || baseline === null) classification = "insufficient_book_state";
      else if (preMove + Number.EPSILON >= options.materialMoveProbability) classification = "polymarket_moved_before_txline";
      else if (firstMaterialAt !== null) classification = "post_txline_reprice_observed";
      else classification = "no_material_reprice_in_window";
      return {
        marketKey: group.marketKey,
        family: group.family,
        lineMilli: group.lineMilli,
        firstMarketEventLatencyMs: tracker.firstMarketEventMs.has(group.marketKey)
          ? tracker.firstMarketEventMs.get(group.marketKey)! - trigger
          : null,
        firstQuoteUpdateLatencyMs: tracker.firstQuoteUpdateMs.has(group.marketKey)
          ? tracker.firstQuoteUpdateMs.get(group.marketKey)! - trigger
          : null,
        firstMaterialMoveLatencyMs: firstMaterialAt === null ? null : firstMaterialAt - trigger,
        preTriggerFiveSecondMove: preMove,
        classification,
        outageAtTrigger: outageContains(outageSummary.outages, trigger),
        outageBeforeMaterialMove: firstMaterialAt === null
          ? false
          : outageOverlaps(outageSummary.outages, trigger, firstMaterialAt),
        snapshots: horizons.map((horizon) => ({
          horizonMs: horizon,
          book: groupSnapshot(tracker, horizon, group.marketKey)!
        }))
      };
    });
    return {
      ...tracker.goal,
      txlineFirstSeenLatencyMs: tracker.goal.firstSeenObservedTsMs - tracker.goal.firstSeenSourceTsMs,
      confirmationDelayMs: tracker.goal.firstConfirmedObservedTsMs === null
        ? null
        : tracker.goal.firstConfirmedObservedTsMs - tracker.goal.firstSeenObservedTsMs,
      markets
    };
  });
  const classifications = goalStudies.flatMap((goal) => goal.markets.map((market) => market.classification));
  const movedBefore = classifications.filter((value) => value === "polymarket_moved_before_txline").length;
  const postTxline = classifications.filter((value) => value === "post_txline_reprice_observed").length;
  const noMaterial = classifications.filter((value) => value === "no_material_reprice_in_window").length;
  const insufficient = classifications.filter((value) => value === "insufficient_book_state").length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "research_evidence_only",
    tradeable: false,
    fixtureId: options.fixtureId,
    configuration: {
      materialMoveProbability: options.materialMoveProbability,
      materialMoveProbabilityBps: options.materialMoveProbability * 10_000,
      reconnectRecoveryExclusionMs,
      snapshotHorizonsMs: horizons
    },
    sourcePaths: {
      mappingPath: options.mappingPath,
      polymarketMessagesPath: options.polymarketMessagesPath,
      polymarketReconnectsPath: options.polymarketReconnectsPath,
      txlineOddsPath: options.txlineOddsPath,
      txlineScoresPath: options.txlineScoresPath
    },
    mapping: {
      records: records.length,
      groups: groups.length,
      canonicalAssets: canonicalAssets.size,
      statuses: [...new Set(records.map((record) => record.status))].sort()
    },
    analysisWindow: {
      firstMessageAt: firstMessageMs === null ? null : new Date(firstMessageMs).toISOString(),
      lastMessageAt: lastMessageMs === null ? null : new Date(lastMessageMs).toISOString(),
      stoppedAt: new Date(analysisStopMs).toISOString(),
      messagesScanned,
      targetMessages,
      normalizedEvents,
      eventTypes
    },
    feedHealth: {
      polymarketOutages: outageSummary,
      txlineOddsLatency: oddsLatency.summary(),
      txlineScoreLatency: scoreLatency.summary(),
      polymarketVenueTimestampAgeAllCanonicalEvents: polymarketLatency.summary(),
      polymarketVenueTimestampAgeNonBookOutsideRecovery: polymarketSteadyStateLatency.summary(),
      polymarketVenueTimestampAgeByObservation: Object.fromEntries(
        [...polymarketLatencyByObservation.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([observation, histogram]) => [observation, histogram.summary()])
      )
    },
    goals: goalStudies,
    gateReadout: {
      marketEventCases: classifications.length,
      polymarketMovedBeforeTxline: movedBefore,
      postTxlineRepriceObserved: postTxline,
      noMaterialRepriceInWindow: noMaterial,
      insufficientBookState: insufficient,
      staleQuoteHypothesis: postTxline === 0 && movedBefore > 0
        ? "not_supported_by_this_match"
        : "requires_more_evidence"
    }
  };
}

function milliseconds(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(0);
}

function probabilityPoints(value: number | null): string {
  return value === null ? "n/a" : (value * 100).toFixed(3);
}

export function renderPairedLiveStudyMarkdown(study: PairedLiveStudy): string {
  const rows = study.goals.flatMap((goal, goalIndex) => goal.markets.map((market) =>
    `| ${goalIndex + 1} | ${goal.clockSeconds ?? ""} | ${market.family}${market.lineMilli === null ? "" : ` ${(market.lineMilli / 1_000).toFixed(1)}`} | ${milliseconds(market.firstQuoteUpdateLatencyMs)} | ${milliseconds(market.firstMaterialMoveLatencyMs)} | ${probabilityPoints(market.preTriggerFiveSecondMove)} | ${market.classification} | ${market.outageBeforeMaterialMove ? "yes" : "no"} |`
  ));
  const outageRows = study.feedHealth.polymarketOutages.outages.map((outage) =>
    `| ${outage.startedAt} | ${outage.endedAt ?? "unresolved"} | ${milliseconds(outage.durationMs)} | ${outage.closeCode ?? ""} |`
  );
  const goalRows = study.goals.map((goal, index) =>
    `| ${index + 1} | ${new Date(goal.firstSeenObservedTsMs).toISOString()} | ${goal.participant ?? ""} | ${goal.clockSeconds ?? ""} | ${milliseconds(goal.txlineFirstSeenLatencyMs)} | ${milliseconds(goal.confirmationDelayMs)} |`
  );
  const polymarketAgeRows = Object.entries(study.feedHealth.polymarketVenueTimestampAgeByObservation)
    .map(([observation, summary]) =>
      `| ${observation} | ${summary.count.toLocaleString("en-US")} | ${milliseconds(summary.p50Ms)} | ${milliseconds(summary.p90Ms)} | ${milliseconds(summary.p99Ms)} |`
    );
  return [
    "# Spain-Belgium Paired Live-Lane Evidence",
    "",
    `Generated: ${study.generatedAt}`,
    "",
    "> Research evidence only. The mapping is capture-confirmed but not settlement-verified, every in-play result remains paper-only, and the material-move threshold is exploratory rather than an approved detector threshold.",
    "",
    "## Scope",
    "",
    `- Fixture: \`${study.fixtureId}\``,
    `- Canonical target assets: ${study.mapping.canonicalAssets} across ${study.mapping.groups} exact market groups`,
    `- Material midpoint move: ${study.configuration.materialMoveProbabilityBps.toFixed(0)} probability bps`,
    `- Polymarket messages scanned through the last response window: ${study.analysisWindow.messagesScanned.toLocaleString("en-US")}`,
    `- Canonical Polymarket events normalized: ${study.analysisWindow.normalizedEvents.toLocaleString("en-US")}`,
    "",
    "## Feed Health",
    "",
    `- TXLine odds receive latency p50/p90/p99: ${milliseconds(study.feedHealth.txlineOddsLatency.p50Ms)} / ${milliseconds(study.feedHealth.txlineOddsLatency.p90Ms)} / ${milliseconds(study.feedHealth.txlineOddsLatency.p99Ms)} ms`,
    `- TXLine score receive latency p50/p90/p99: ${milliseconds(study.feedHealth.txlineScoreLatency.p50Ms)} / ${milliseconds(study.feedHealth.txlineScoreLatency.p90Ms)} / ${milliseconds(study.feedHealth.txlineScoreLatency.p99Ms)} ms`,
    `- Polymarket non-book venue-timestamp age outside reconnect recovery p50/p90/p99: ${milliseconds(study.feedHealth.polymarketVenueTimestampAgeNonBookOutsideRecovery.p50Ms)} / ${milliseconds(study.feedHealth.polymarketVenueTimestampAgeNonBookOutsideRecovery.p90Ms)} / ${milliseconds(study.feedHealth.polymarketVenueTimestampAgeNonBookOutsideRecovery.p99Ms)} ms`,
    `- Polymarket all-event venue-timestamp age p50/p90/p99: ${milliseconds(study.feedHealth.polymarketVenueTimestampAgeAllCanonicalEvents.p50Ms)} / ${milliseconds(study.feedHealth.polymarketVenueTimestampAgeAllCanonicalEvents.p90Ms)} / ${milliseconds(study.feedHealth.polymarketVenueTimestampAgeAllCanonicalEvents.p99Ms)} ms`,
    "- Polymarket payload timestamps show event age, not a pure network-latency clock; stale/repeated venue timestamps remain visible outside reconnect windows and must be treated as feed-health evidence rather than transport timing alone.",
    `- Public WebSocket outages: ${study.feedHealth.polymarketOutages.outages.length}; total ${milliseconds(study.feedHealth.polymarketOutages.totalDowntimeMs)} ms; max ${milliseconds(study.feedHealth.polymarketOutages.maximumDowntimeMs)} ms`,
    "",
    "| Outage start | Reconnected | Duration ms | Code |",
    "|---|---|---:|---:|",
    ...(outageRows.length === 0 ? ["| none | | | |"] : outageRows),
    "",
    "| Polymarket observation | Events | Age p50 ms | Age p90 ms | Age p99 ms |",
    "|---|---:|---:|---:|---:|",
    ...polymarketAgeRows,
    "",
    "## Goal Delivery",
    "",
    "| Goal | First seen | Participant | Match clock sec | TXLine receive latency ms | Confirmation delay ms |",
    "|---:|---|---:|---:|---:|---:|",
    ...goalRows,
    "",
    "## Repricing Evidence",
    "",
    "A pre-trigger move compares the book at T-5s with the last state before TXLine delivered the goal. Material movement before T0 means the venue had already reacted before Samaritan received the score event; that is evidence against a post-TXLine stale-quote window for that market instance.",
    "",
    "| Goal | Clock sec | Market | First quote update ms | First material move ms | Pre-trigger move pp | Classification | Outage overlap |",
    "|---:|---:|---|---:|---:|---:|---|---|",
    ...rows,
    "",
    "## Gate Readout",
    "",
    `- Market-event cases measured: ${study.gateReadout.marketEventCases}`,
    `- Polymarket moved at least the exploratory threshold before TXLine first delivery: ${study.gateReadout.polymarketMovedBeforeTxline}`,
    `- Material post-TXLine repricing observed without a prior move: ${study.gateReadout.postTxlineRepriceObserved}`,
    `- No material move inside the 30-second response window: ${study.gateReadout.noMaterialRepriceInWindow}`,
    `- Result for STALE_QUOTE: \`${study.gateReadout.staleQuoteHypothesis}\``,
    "",
    "For this match, Polymarket was already repricing before the first TXLine goal event arrived whenever a material move was visible. The capture therefore does not support a post-TXLine stale-order edge. STALE_QUOTE remains disabled and paper-only; more synchronized matches may add evidence but cannot reverse this result by assumption.",
    "",
    "## Interpretation Guardrails",
    "",
    "- These are three event instances from one match, not a fitted latency distribution.",
    "- A code-1006 reconnect interval is unavailable data, never evidence that a quote stayed unchanged.",
    "- Match Result is grouped from the three canonical Yes tokens; complement No tokens are not double-counted.",
    "- Every mapped totals line is reported. No O/U line is hard-coded as the production main total.",
    "- No trading, fill simulation, or real-money claim is authorized by this report.",
    ""
  ].join("\n");
}
