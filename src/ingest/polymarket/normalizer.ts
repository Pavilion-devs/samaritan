import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type PolymarketBookEvent,
  type PolymarketPriceEvent,
  type PolymarketResolutionEvent
} from "../../bus/events.js";
import { stableJson } from "../../domain/json.js";
import { probability, type Probability } from "../../domain/probability.js";
import { MappingRegistry, type MappedAsset } from "../../mapping/registry.js";

const decimalSchema = z.union([z.string(), z.number()]).transform(String);
const levelSchema = z.object({ price: decimalSchema, size: decimalSchema });

const bookSchema = z.object({
  market: z.string().min(1),
  asset_id: z.string().min(1),
  timestamp: decimalSchema,
  hash: z.string().optional(),
  bids: z.array(levelSchema),
  asks: z.array(levelSchema),
  tick_size: decimalSchema.optional(),
  last_trade_price: decimalSchema.optional(),
  event_type: z.literal("book")
});

const priceChangeSchema = z.object({
  market: z.string().min(1),
  timestamp: decimalSchema,
  event_type: z.literal("price_change"),
  price_changes: z.array(
    z.object({
      asset_id: z.string().min(1),
      price: decimalSchema,
      size: decimalSchema,
      side: z.enum(["BUY", "SELL"]),
      hash: z.string().optional(),
      best_bid: decimalSchema.optional(),
      best_ask: decimalSchema.optional()
    })
  )
});

const bestBidAskSchema = z.object({
  market: z.string().min(1),
  asset_id: z.string().min(1),
  timestamp: decimalSchema,
  event_type: z.literal("best_bid_ask"),
  best_bid: decimalSchema,
  best_ask: decimalSchema
});

const lastTradeSchema = z.object({
  market: z.string().min(1),
  asset_id: z.string().min(1),
  timestamp: decimalSchema,
  event_type: z.literal("last_trade_price"),
  price: decimalSchema,
  side: z.enum(["BUY", "SELL"]).optional(),
  size: decimalSchema.optional()
});

const marketResolvedSchema = z.object({
  market: z.string().min(1),
  assets_ids: z.array(z.string().min(1)).min(2),
  winning_asset_id: z.string().min(1),
  winning_outcome: z.string().min(1),
  timestamp: decimalSchema,
  event_type: z.literal("market_resolved")
});

function timestampMs(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new RangeError(`Invalid Polymarket timestamp: ${value}`);
  return parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
}

function priceOrNull(value: string | undefined): Probability | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return probability(parsed);
}

function validateCondition(rawConditionId: string, mapped: MappedAsset): void {
  if (rawConditionId !== mapped.conditionId) {
    throw new Error(
      `Polymarket asset ${mapped.assetId} arrived under ${rawConditionId}, expected ${mapped.conditionId}`
    );
  }
}

function basePriceEvent(
  mapped: MappedAsset,
  sourceTsMs: number,
  observedTsMs: number,
  identity: string
): Omit<PolymarketPriceEvent, "observation" | "price" | "bestBid" | "bestAsk" | "size" | "side"> {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.price",
    eventId: `polymarket:price:${createHash("sha256").update(identity).digest("hex")}`,
    source: "polymarket",
    sourceTsMs,
    observedTsMs,
    fixtureId: mapped.fixtureId,
    market: mapped.market,
    mappingStatus: mapped.mappingStatus,
    conditionId: mapped.conditionId,
    assetId: mapped.assetId,
    outcome: mapped.outcome,
    tokenRole: mapped.tokenRole
  };
}

function normalizeBook(
  value: unknown,
  observedTsMs: number,
  registry: MappingRegistry
): PolymarketBookEvent {
  const row = bookSchema.parse(value);
  const mapped = registry.resolveAsset(row.asset_id);
  validateCondition(row.market, mapped);
  const sourceTs = timestampMs(row.timestamp);
  const levels = (input: Array<{ price: string; size: string }>) =>
    input.map((level) => ({ price: probability(Number(level.price)), size: level.size }));
  const identity = stableJson(row);
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.book",
    eventId: `polymarket:book:${createHash("sha256").update(identity).digest("hex")}`,
    source: "polymarket",
    sourceTsMs: sourceTs,
    observedTsMs,
    fixtureId: mapped.fixtureId,
    market: mapped.market,
    mappingStatus: mapped.mappingStatus,
    conditionId: mapped.conditionId,
    assetId: mapped.assetId,
    outcome: mapped.outcome,
    tokenRole: mapped.tokenRole,
    bids: levels(row.bids),
    asks: levels(row.asks),
    lastTradePrice: priceOrNull(row.last_trade_price),
    tickSize: row.tick_size ?? null
  };
}

function normalizeResolution(
  value: unknown,
  observedTsMs: number,
  registry: MappingRegistry
): PolymarketResolutionEvent {
  const row = marketResolvedSchema.parse(value);
  if (!row.assets_ids.includes(row.winning_asset_id)) {
    throw new Error("Polymarket resolution winner is absent from assets_ids");
  }
  const mapped = registry.resolveAsset(row.winning_asset_id);
  validateCondition(row.market, mapped);
  for (const assetId of row.assets_ids) {
    validateCondition(row.market, registry.resolveAsset(assetId));
  }
  const sourceTsMs = timestampMs(row.timestamp);
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.resolution",
    eventId: `polymarket:resolution:${createHash("sha256").update(stableJson(row)).digest("hex")}`,
    source: "polymarket",
    sourceTsMs,
    observedTsMs,
    fixtureId: mapped.fixtureId,
    market: mapped.market,
    mappingStatus: mapped.mappingStatus,
    conditionId: mapped.conditionId,
    assetIds: row.assets_ids,
    winningAssetId: row.winning_asset_id,
    winningOutcomeLabel: row.winning_outcome
  };
}

export function normalizePolymarketPayload(
  payload: unknown,
  observedTsMs: number,
  registry: MappingRegistry
): CanonicalEvent[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => normalizePolymarketPayload(item, observedTsMs, registry));
  }
  const eventType = (payload as { event_type?: unknown } | null)?.event_type;
  if (eventType === "book") return [normalizeBook(payload, observedTsMs, registry)];
  if (eventType === "market_resolved") return [normalizeResolution(payload, observedTsMs, registry)];
  if (eventType === "price_change") {
    const row = priceChangeSchema.parse(payload);
    const sourceTs = timestampMs(row.timestamp);
    return row.price_changes.map((change) => {
      const mapped = registry.resolveAsset(change.asset_id);
      validateCondition(row.market, mapped);
      return {
        ...basePriceEvent(
          mapped,
          sourceTs,
          observedTsMs,
          stableJson({
            eventType: row.event_type,
            market: row.market,
            timestamp: row.timestamp,
            change
          })
        ),
        observation: "price_change",
        price: priceOrNull(change.price),
        bestBid: priceOrNull(change.best_bid),
        bestAsk: priceOrNull(change.best_ask),
        size: change.size,
        side: change.side
      };
    });
  }
  if (eventType === "best_bid_ask") {
    const row = bestBidAskSchema.parse(payload);
    const mapped = registry.resolveAsset(row.asset_id);
    validateCondition(row.market, mapped);
    const sourceTs = timestampMs(row.timestamp);
    return [
      {
        ...basePriceEvent(mapped, sourceTs, observedTsMs, stableJson(row)),
        observation: "best_bid_ask",
        price: null,
        bestBid: priceOrNull(row.best_bid),
        bestAsk: priceOrNull(row.best_ask),
        size: null,
        side: null
      }
    ];
  }
  if (eventType === "last_trade_price") {
    const row = lastTradeSchema.parse(payload);
    const mapped = registry.resolveAsset(row.asset_id);
    validateCondition(row.market, mapped);
    const sourceTs = timestampMs(row.timestamp);
    return [
      {
        ...basePriceEvent(mapped, sourceTs, observedTsMs, stableJson(row)),
        observation: "last_trade",
        price: priceOrNull(row.price),
        bestBid: null,
        bestAsk: null,
        size: row.size ?? null,
        side: row.side ?? null
      }
    ];
  }
  return [];
}

export function normalizeCapturedPolymarketMessage(
  message: { receivedAt: string; rawPayload: string; parseError?: string | null },
  registry: MappingRegistry
): CanonicalEvent[] {
  if (message.parseError) throw new Error(`Captured Polymarket parse error: ${message.parseError}`);
  const observedTsMs = Date.parse(message.receivedAt);
  if (!Number.isFinite(observedTsMs)) throw new Error(`Invalid Polymarket receivedAt: ${message.receivedAt}`);
  return normalizePolymarketPayload(JSON.parse(message.rawPayload) as unknown, observedTsMs, registry);
}

export function normalizePolymarketHistoryPoint(
  assetId: string,
  point: { t: number; p: number },
  registry: MappingRegistry
): PolymarketPriceEvent {
  const mapped = registry.resolveAsset(assetId);
  const sourceTs = timestampMs(String(point.t));
  return {
    ...basePriceEvent(mapped, sourceTs, sourceTs, `history:${assetId}:${point.t}`),
    observation: "sampled_history",
    price: probability(point.p),
    bestBid: null,
    bestAsk: null,
    size: null,
    side: null
  };
}
