import type { CanonicalEvent } from "../bus/events.js";
import { marketKey } from "../bus/events.js";

/** Haiku (60s) and Opus (180s) are serial in the paper case path. */
export const CAPTURED_PAPER_MODEL_STALL_BUDGET_MS = 240_000;
/** 25% queue headroom above the entire finite admitted replay. */
export const CAPTURED_PAPER_INGRESS_HEADROOM_NUMERATOR = 5;
export const CAPTURED_PAPER_INGRESS_HEADROOM_DENOMINATOR = 4;
/** A captured replay that needs more queued events is not safe to run in-process. */
export const CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT = 65_536;
/** Bound the normalized in-memory snapshot held across the model boundary. */
export const CAPTURED_PAPER_EVENT_SNAPSHOT_HARD_LIMIT_BYTES = 256 * 1_024 * 1_024;

export type CapturedPaperAdmissionIdentity = {
  fixtureId: string;
  marketId: string;
  conditionId: string;
  lineMilli: number;
  assetIds: readonly [string, string] | readonly string[];
};

export type CapturedPaperIngressProfile = {
  eventCount: number;
  firstObservedTsMs: number;
  lastObservedTsMs: number;
  modelStallBudgetMs: typeof CAPTURED_PAPER_MODEL_STALL_BUDGET_MS;
  maximumEventsInModelStallWindow: number;
  counts: {
    selectedOdds: number;
    fixtureScores: number;
    selectedBooks: number;
    selectedPrices: number;
    selectedResolutions: number;
    feedEvents: number;
  };
};

function exactAssetSet(actual: readonly string[], expected: ReadonlySet<string>): boolean {
  return actual.length === expected.size &&
    new Set(actual).size === actual.length &&
    actual.every((assetId) => expected.has(assetId));
}

/**
 * A source-mode-agnostic allowlist for the one reviewed paper market. It keeps
 * exact fixture scores and transport health, while dropping unrelated books,
 * prices, odds, and resolutions before they can consume the model queue.
 */
export function isAdmittedCapturedPaperEvent(
  event: CanonicalEvent,
  identity: CapturedPaperAdmissionIdentity
): boolean {
  if (event.kind === "feed.heartbeat" || event.kind === "feed.status") return true;
  if (event.kind === "score.update") return event.fixtureId === identity.fixtureId;
  const selectedMarketKey = marketKey(
    identity.fixtureId,
    "total_goals",
    "full_time",
    identity.lineMilli
  );
  if (event.kind === "odds.quote") {
    return event.fixtureId === identity.fixtureId && event.market.key === selectedMarketKey;
  }
  if (
    event.fixtureId !== identity.fixtureId ||
    event.market.key !== selectedMarketKey ||
    event.conditionId !== identity.conditionId
  ) return false;
  const assets = new Set(identity.assetIds);
  if (event.kind === "polymarket.resolution") {
    return exactAssetSet(event.assetIds, assets) && assets.has(event.winningAssetId);
  }
  return assets.has(event.assetId);
}

export async function* admittedCapturedPaperSource(
  source: AsyncIterable<CanonicalEvent>,
  identity: CapturedPaperAdmissionIdentity
): AsyncGenerator<CanonicalEvent> {
  for await (const event of source) {
    if (isAdmittedCapturedPaperEvent(event, identity)) yield event;
  }
}

export async function profileCapturedPaperIngress(
  source: AsyncIterable<CanonicalEvent>,
  identity: CapturedPaperAdmissionIdentity
): Promise<CapturedPaperIngressProfile> {
  const timestamps: number[] = [];
  const counts: CapturedPaperIngressProfile["counts"] = {
    selectedOdds: 0,
    fixtureScores: 0,
    selectedBooks: 0,
    selectedPrices: 0,
    selectedResolutions: 0,
    feedEvents: 0
  };
  for await (const event of admittedCapturedPaperSource(source, identity)) {
    if (!Number.isSafeInteger(event.observedTsMs) || event.observedTsMs < 0) {
      throw new Error(`Admitted canonical event has invalid observedTsMs: ${event.eventId}`);
    }
    timestamps.push(event.observedTsMs);
    if (event.kind === "odds.quote") counts.selectedOdds += 1;
    else if (event.kind === "score.update") counts.fixtureScores += 1;
    else if (event.kind === "polymarket.book") counts.selectedBooks += 1;
    else if (event.kind === "polymarket.price") counts.selectedPrices += 1;
    else if (event.kind === "polymarket.resolution") counts.selectedResolutions += 1;
    else counts.feedEvents += 1;
  }
  if (timestamps.length === 0) throw new Error("Selected captured-paper admission stream is empty");
  timestamps.sort((left, right) => left - right);
  let windowStart = 0;
  let maximumEventsInModelStallWindow = 0;
  for (let windowEnd = 0; windowEnd < timestamps.length; windowEnd += 1) {
    while (
      timestamps[windowEnd]! - timestamps[windowStart]! > CAPTURED_PAPER_MODEL_STALL_BUDGET_MS
    ) windowStart += 1;
    maximumEventsInModelStallWindow = Math.max(
      maximumEventsInModelStallWindow,
      windowEnd - windowStart + 1
    );
  }
  return {
    eventCount: timestamps.length,
    firstObservedTsMs: timestamps[0]!,
    lastObservedTsMs: timestamps.at(-1)!,
    modelStallBudgetMs: CAPTURED_PAPER_MODEL_STALL_BUDGET_MS,
    maximumEventsInModelStallWindow,
    counts
  };
}

export function capturedPaperIngressCapacity(profile: CapturedPaperIngressProfile): number {
  const counted = Object.values(profile.counts).reduce((sum, count) => sum + count, 0);
  if (
    !Number.isSafeInteger(profile.eventCount) || profile.eventCount <= 0 ||
    counted !== profile.eventCount ||
    profile.modelStallBudgetMs !== CAPTURED_PAPER_MODEL_STALL_BUDGET_MS ||
    !Number.isSafeInteger(profile.maximumEventsInModelStallWindow) ||
    profile.maximumEventsInModelStallWindow <= 0 ||
    profile.maximumEventsInModelStallWindow > profile.eventCount
  ) {
    throw new Error("Captured-paper ingress profile is internally inconsistent");
  }
  const required = Math.max(
    profile.eventCount + 1,
    Math.ceil(
      profile.eventCount *
      CAPTURED_PAPER_INGRESS_HEADROOM_NUMERATOR /
      CAPTURED_PAPER_INGRESS_HEADROOM_DENOMINATOR
    )
  );
  if (required > CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT) {
    throw new Error(
      `Captured replay requires ingress capacity ${required}, above hard limit ` +
      `${CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT}`
    );
  }
  return required;
}
