import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CANONICAL_SCHEMA_VERSION,
  marketKey,
  type CanonicalEvent,
  type CanonicalOutcome,
  type MarketFamily,
  type MarketPeriod,
  type OddsQuoteEvent,
  type ScoreEvent
} from "../../bus/events.js";
import type { JsonValue } from "../../domain/json.js";
import { decimalLineToMilli, txLinePctToProbability } from "../../domain/probability.js";
import type { IngestEnvelope } from "../sse.js";

const oddsSchema = z.object({
  FixtureId: z.union([z.number().int(), z.string().min(1)]),
  MessageId: z.string().min(1),
  Ts: z.number().int().nonnegative(),
  Bookmaker: z.string().min(1),
  BookmakerId: z.number().int(),
  SuperOddsType: z.string().min(1),
  GameState: z.string().nullable(),
  InRunning: z.boolean(),
  MarketParameters: z.string().nullable(),
  MarketPeriod: z.string().nullable(),
  PriceNames: z.array(z.string()),
  Prices: z.array(z.number().int().positive()),
  Pct: z.array(z.string())
});

const scoreSchema = z.object({
  FixtureId: z.union([z.number().int(), z.string().min(1)]),
  Ts: z.number().int().nonnegative(),
  Action: z.string().min(1),
  Id: z.number().int(),
  Seq: z.number().int(),
  GameState: z.string().nullable().optional(),
  Confirmed: z.boolean().optional(),
  Participant: z.number().int().optional(),
  Clock: z
    .object({
      Running: z.boolean(),
      Seconds: z.number().int().nonnegative()
    })
    .optional(),
  Score: z.unknown().optional(),
  Data: z.unknown().optional()
});

const heartbeatSchema = z.object({ Ts: z.number().nonnegative() });

function sourceEventId(prefix: string, identity: string): string {
  return `${prefix}:${createHash("sha256").update(identity).digest("hex")}`;
}

function sourceTsMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function periodFromTxLine(value: string | null): MarketPeriod {
  if (value === null || value.trim() === "") return "full_time";
  if (value === "half=1") return "first_half";
  if (value === "et") return "extra_time";
  return "other";
}

function marketDefinition(row: z.infer<typeof oddsSchema>): {
  family: MarketFamily;
  outcomes: CanonicalOutcome[];
  lineMilli: number | null;
} | null {
  if (row.SuperOddsType === "1X2_PARTICIPANT_RESULT") {
    if (row.PriceNames.join(",") !== "part1,draw,part2") {
      throw new Error(`Unexpected Match Result PriceNames: ${row.PriceNames.join(",")}`);
    }
    return { family: "match_result", outcomes: ["home", "draw", "away"], lineMilli: null };
  }
  if (row.SuperOddsType === "OVERUNDER_PARTICIPANT_GOALS") {
    if (row.PriceNames.join(",") !== "over,under") {
      throw new Error(`Unexpected total-goals PriceNames: ${row.PriceNames.join(",")}`);
    }
    const match = row.MarketParameters?.match(/(?:^|;)line=(-?\d+(?:\.\d{1,3})?)(?:;|$)/);
    if (!match?.[1]) throw new Error(`Total-goals row has no exact line: ${row.MarketParameters}`);
    return {
      family: "total_goals",
      outcomes: ["over", "under"],
      lineMilli: decimalLineToMilli(match[1])
    };
  }
  return null;
}

function normalizeOdds(value: unknown, envelope: IngestEnvelope): OddsQuoteEvent | null {
  const row = oddsSchema.parse(value);
  const definition = marketDefinition(row);
  if (definition === null) return null;
  if (row.Prices.length !== definition.outcomes.length || row.Pct.length !== definition.outcomes.length) {
    throw new Error(`TXLine outcome array lengths disagree for ${row.MessageId}`);
  }
  const fixtureId = String(row.FixtureId);
  const period = periodFromTxLine(row.MarketPeriod);
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "odds.quote",
    eventId: `txline:odds:${row.MessageId}`,
    source: "txline",
    sourceTsMs: sourceTsMs(row.Ts),
    observedTsMs: envelope.observedTsMs,
    fixtureId,
    sourceMessageId: row.MessageId,
    bookmaker: row.Bookmaker,
    bookmakerId: row.BookmakerId,
    inRunning: row.InRunning,
    gameState: row.GameState,
    market: {
      family: definition.family,
      period,
      lineMilli: definition.lineMilli,
      key: marketKey(fixtureId, definition.family, period, definition.lineMilli)
    },
    outcomes: definition.outcomes.map((outcome, index) => ({
      outcome,
      oddsX1000: row.Prices[index]!,
      fairProbability: txLinePctToProbability(row.Pct[index]!)
    }))
  };
}

function normalizeScore(value: unknown, envelope: IngestEnvelope): ScoreEvent {
  const row = scoreSchema.parse(value);
  const fixtureId = String(row.FixtureId);
  const identity = `${fixtureId}:${row.Id}:${row.Seq}:${row.Ts}:${row.Action}`;
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "score.update",
    eventId: sourceEventId("txline:score", identity),
    source: "txline",
    sourceTsMs: sourceTsMs(row.Ts),
    observedTsMs: envelope.observedTsMs,
    fixtureId,
    action: row.Action,
    actionId: row.Id,
    sequence: row.Seq,
    gameState: row.GameState ?? null,
    confirmed: row.Confirmed ?? null,
    participant: row.Participant ?? null,
    clock: row.Clock ? { running: row.Clock.Running, seconds: row.Clock.Seconds } : null,
    score: (row.Score as JsonValue | undefined) ?? null,
    data: (row.Data as JsonValue | undefined) ?? null
  };
}

export function normalizeTxLineEnvelope(envelope: IngestEnvelope): CanonicalEvent[] {
  if (envelope.message.data === "") return [];
  const parsed = JSON.parse(envelope.message.data) as unknown;
  if (envelope.message.event === "heartbeat") {
    const heartbeat = heartbeatSchema.parse(parsed);
    const ts = sourceTsMs(heartbeat.Ts);
    return [
      {
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        kind: "feed.heartbeat",
        eventId: `txline:heartbeat:${envelope.stream}:${ts}`,
        source: "txline",
        sourceTsMs: ts,
        observedTsMs: envelope.observedTsMs,
        fixtureId: null,
        status: "healthy",
        stream: envelope.stream,
        detail: null
      }
    ];
  }
  if (envelope.stream === "odds") {
    const event = normalizeOdds(parsed, envelope);
    return event === null ? [] : [event];
  }
  if (envelope.stream === "scores") return [normalizeScore(parsed, envelope)];
  throw new Error(`Unknown TXLine stream: ${envelope.stream}`);
}
