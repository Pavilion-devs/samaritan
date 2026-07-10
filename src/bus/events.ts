import type { JsonValue } from "../domain/json.js";
import type { Probability } from "../domain/probability.js";

export const CANONICAL_SCHEMA_VERSION = 1 as const;

export type EventSource = "txline" | "polymarket";
export type MarketFamily = "match_result" | "total_goals";
export type MarketPeriod = "full_time" | "first_half" | "extra_time" | "other";
export type CanonicalOutcome = "home" | "draw" | "away" | "over" | "under";
export type MappingStatus = "candidate" | "verified" | "rejected";

export type CanonicalMarket = {
  family: MarketFamily;
  period: MarketPeriod;
  lineMilli: number | null;
  key: string;
};

export type CanonicalEventBase = {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION;
  eventId: string;
  source: EventSource;
  sourceTsMs: number;
  observedTsMs: number;
  fixtureId: string | null;
};

export type OddsQuoteEvent = CanonicalEventBase & {
  kind: "odds.quote";
  source: "txline";
  fixtureId: string;
  market: CanonicalMarket;
  sourceMessageId: string;
  bookmaker: string;
  bookmakerId: number;
  inRunning: boolean;
  gameState: string | null;
  outcomes: Array<{
    outcome: CanonicalOutcome;
    oddsX1000: number;
    fairProbability: Probability | null;
  }>;
};

export type ScoreEvent = CanonicalEventBase & {
  kind: "score.update";
  source: "txline";
  fixtureId: string;
  action: string;
  actionId: number;
  sequence: number;
  gameState: string | null;
  confirmed: boolean | null;
  participant: number | null;
  clock: { running: boolean; seconds: number } | null;
  score: JsonValue | null;
  data: JsonValue | null;
};

export type PolymarketPriceEvent = CanonicalEventBase & {
  kind: "polymarket.price";
  source: "polymarket";
  fixtureId: string;
  market: CanonicalMarket;
  mappingStatus: MappingStatus;
  conditionId: string;
  assetId: string;
  outcome: CanonicalOutcome;
  tokenRole: "canonical" | "complement";
  observation: "sampled_history" | "last_trade" | "best_bid_ask" | "price_change";
  price: Probability | null;
  bestBid: Probability | null;
  bestAsk: Probability | null;
  size: string | null;
  side: "BUY" | "SELL" | null;
};

export type PolymarketBookEvent = CanonicalEventBase & {
  kind: "polymarket.book";
  source: "polymarket";
  fixtureId: string;
  market: CanonicalMarket;
  mappingStatus: MappingStatus;
  conditionId: string;
  assetId: string;
  outcome: CanonicalOutcome;
  tokenRole: "canonical" | "complement";
  bids: Array<{ price: Probability; size: string }>;
  asks: Array<{ price: Probability; size: string }>;
  lastTradePrice: Probability | null;
  tickSize: string | null;
};

export type FeedEvent = CanonicalEventBase & {
  kind: "feed.heartbeat" | "feed.status";
  fixtureId: null;
  status: "healthy" | "connecting" | "reconnecting" | "degraded";
  stream: string;
  detail: string | null;
};

export type CanonicalEvent =
  | OddsQuoteEvent
  | ScoreEvent
  | PolymarketPriceEvent
  | PolymarketBookEvent
  | FeedEvent;

export function marketKey(
  fixtureId: string,
  family: MarketFamily,
  period: MarketPeriod,
  lineMilli: number | null
): string {
  return `${fixtureId}:${family}:${period}:${lineMilli ?? "none"}`;
}

export function eventMarketKey(event: CanonicalEvent): string | null {
  return "market" in event ? event.market.key : null;
}
