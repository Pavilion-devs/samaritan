import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type CanonicalMarket,
  type CanonicalOutcome,
  type MappingStatus,
  type OddsQuoteEvent,
  type PolymarketPriceEvent
} from "../bus/events.js";
import { probability } from "../domain/probability.js";

export type ResearchReplayQuery = {
  fixtureId: string;
  marketKey?: string;
  fromTsMs?: number;
  toTsMs?: number;
  fullTimeOnly?: boolean;
  includeInRunning?: boolean;
};

type QueryParts = {
  sql: string;
  values: Record<string, string | number>;
};

function textValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Archive row has invalid ${name}`);
  return value;
}

function nullableText(value: unknown, name: string): string | null {
  if (value === null) return null;
  return textValue(value, name);
}

function numberValue(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Archive row has invalid ${name}`);
  return parsed;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Archive row has invalid ${name}`);
  return value;
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Archive row has invalid ${name}`);
  return value;
}

function canonicalOutcome(value: unknown): CanonicalOutcome {
  if (value === "home" || value === "draw" || value === "away" || value === "over" || value === "under") {
    return value;
  }
  throw new Error(`Archive row has invalid outcome: ${String(value)}`);
}

function mappingStatus(value: unknown): MappingStatus {
  if (value === "candidate" || value === "verified" || value === "rejected") return value;
  throw new Error(`Archive row has invalid mapping status: ${String(value)}`);
}

function tokenRole(value: unknown): "canonical" | "complement" {
  if (value === "canonical" || value === "complement") return value;
  throw new Error(`Archive row has invalid token role: ${String(value)}`);
}

export function parseCanonicalMarketKey(key: string, expectedFixtureId?: string): CanonicalMarket {
  const [fixtureId, family, period, line, ...rest] = key.split(":");
  if (!fixtureId || !family || !period || !line || rest.length > 0) {
    throw new Error(`Invalid canonical market key: ${key}`);
  }
  if (expectedFixtureId !== undefined && fixtureId !== expectedFixtureId) {
    throw new Error(`Market key ${key} does not belong to fixture ${expectedFixtureId}`);
  }
  if (family !== "match_result" && family !== "total_goals") {
    throw new Error(`Invalid market family in key: ${key}`);
  }
  if (period !== "full_time" && period !== "first_half" && period !== "extra_time" && period !== "other") {
    throw new Error(`Invalid market period in key: ${key}`);
  }
  const lineMilli = line === "none" ? null : Number(line);
  if (lineMilli !== null && !Number.isInteger(lineMilli)) {
    throw new Error(`Invalid line in market key: ${key}`);
  }
  if ((family === "match_result") !== (lineMilli === null)) {
    throw new Error(`Market family and line disagree in key: ${key}`);
  }
  return { family, period, lineMilli, key };
}

function validateQuery(query: ResearchReplayQuery): void {
  if (query.fixtureId.trim() === "") throw new Error("Research replay requires a fixtureId");
  if (query.marketKey !== undefined) parseCanonicalMarketKey(query.marketKey, query.fixtureId);
  for (const [name, value] of [
    ["fromTsMs", query.fromTsMs],
    ["toTsMs", query.toTsMs]
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  if (query.fromTsMs !== undefined && query.toTsMs !== undefined && query.fromTsMs > query.toTsMs) {
    throw new RangeError("fromTsMs cannot be after toTsMs");
  }
}

function filters(query: ResearchReplayQuery, alias: string, txline: boolean): QueryParts {
  validateQuery(query);
  const clauses = [`${alias}.fixture_id = $fixtureId`];
  const values: Record<string, string | number> = { fixtureId: query.fixtureId };
  if (query.marketKey !== undefined) {
    clauses.push(`${alias}.market_key = $marketKey`);
    values["marketKey"] = query.marketKey;
  } else if (query.fullTimeOnly !== false) {
    clauses.push(`split_part(${alias}.market_key, ':', 3) = 'full_time'`);
  }
  if (query.fromTsMs !== undefined) {
    clauses.push(`${alias}.source_ts_ms >= $fromTsMs`);
    values["fromTsMs"] = query.fromTsMs;
  }
  if (query.toTsMs !== undefined) {
    clauses.push(`${alias}.source_ts_ms <= $toTsMs`);
    values["toTsMs"] = query.toTsMs;
  }
  if (txline && query.includeInRunning === false) clauses.push("NOT metadata.in_running");
  return { sql: clauses.join(" AND "), values };
}

async function* rowObjects(
  connection: DuckDBConnection,
  sql: string,
  values: Record<string, string | number>
): AsyncGenerator<Record<string, unknown>> {
  const result = await connection.stream(sql, values);
  for await (const chunk of result.yieldRowObjectJson()) {
    for (const row of chunk) yield row as Record<string, unknown>;
  }
}

export class DuckDbResearchArchive {
  readonly #instance: DuckDBInstance;
  #closed = false;

  private constructor(instance: DuckDBInstance) {
    this.#instance = instance;
  }

  static async open(path: string): Promise<DuckDbResearchArchive> {
    const instance = await DuckDBInstance.create(path, { access_mode: "READ_ONLY" });
    const connection = await instance.connect();
    try {
      const result = await connection.runAndReadAll(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = 'main'
           AND table_name IN ('txline_quote_outcomes', 'txline_quote_metadata', 'polymarket_history')`
      );
      const count = Number(result.getRowObjectsJson()[0]?.["count"] ?? 0);
      if (count !== 3) {
        throw new Error(
          "Research archive is missing canonical replay tables; run pnpm import:txline-metadata or rebuild the archive"
        );
      }
    } catch (error) {
      connection.closeSync();
      instance.closeSync();
      throw error;
    }
    connection.closeSync();
    return new DuckDbResearchArchive(instance);
  }

  txlineEvents(query: ResearchReplayQuery): AsyncIterable<OddsQuoteEvent> {
    this.#assertOpen();
    const archive = this;
    return (async function* () {
      const connection = await archive.#instance.connect();
      const where = filters(query, "quotes", true);
      try {
        const sql = `
          SELECT
            quotes.event_id,
            quotes.fixture_id,
            quotes.source_ts_ms,
            quotes.market_key,
            metadata.bookmaker,
            metadata.bookmaker_id,
            metadata.in_running,
            metadata.game_state,
            list(quotes.outcome ORDER BY
              CASE quotes.outcome WHEN 'home' THEN 1 WHEN 'draw' THEN 2 WHEN 'away' THEN 3
                                  WHEN 'over' THEN 4 WHEN 'under' THEN 5 ELSE 6 END) AS outcomes,
            list(quotes.odds_x1000 ORDER BY
              CASE quotes.outcome WHEN 'home' THEN 1 WHEN 'draw' THEN 2 WHEN 'away' THEN 3
                                  WHEN 'over' THEN 4 WHEN 'under' THEN 5 ELSE 6 END) AS odds,
            list(quotes.probability ORDER BY
              CASE quotes.outcome WHEN 'home' THEN 1 WHEN 'draw' THEN 2 WHEN 'away' THEN 3
                                  WHEN 'over' THEN 4 WHEN 'under' THEN 5 ELSE 6 END) AS probabilities
          FROM txline_quote_outcomes quotes
          INNER JOIN txline_quote_metadata metadata USING (event_id)
          WHERE ${where.sql}
          GROUP BY ALL
          ORDER BY quotes.source_ts_ms, quotes.event_id`;
        for await (const row of rowObjects(connection, sql, where.values)) {
          const fixtureId = textValue(row["fixture_id"], "fixture_id");
          const sourceTsMs = numberValue(row["source_ts_ms"], "source_ts_ms");
          const outcomes = arrayValue(row["outcomes"], "outcomes");
          const odds = arrayValue(row["odds"], "odds");
          const probabilities = arrayValue(row["probabilities"], "probabilities");
          if (outcomes.length !== odds.length || outcomes.length !== probabilities.length) {
            throw new Error("TXLine archive outcome arrays are misaligned");
          }
          const eventId = textValue(row["event_id"], "event_id");
          yield {
            schemaVersion: CANONICAL_SCHEMA_VERSION,
            kind: "odds.quote",
            eventId,
            source: "txline",
            sourceTsMs,
            observedTsMs: sourceTsMs,
            fixtureId,
            market: parseCanonicalMarketKey(textValue(row["market_key"], "market_key"), fixtureId),
            sourceMessageId: eventId.replace(/^txline:odds:/, ""),
            bookmaker: textValue(row["bookmaker"], "bookmaker"),
            bookmakerId: numberValue(row["bookmaker_id"], "bookmaker_id"),
            inRunning: booleanValue(row["in_running"], "in_running"),
            gameState: nullableText(row["game_state"], "game_state"),
            outcomes: outcomes.map((outcome, index) => {
              const fair = probabilities[index];
              return {
                outcome: canonicalOutcome(outcome),
                oddsX1000: numberValue(odds[index], "odds_x1000"),
                fairProbability: fair === null ? null : probability(numberValue(fair, "probability"))
              };
            })
          };
        }
      } finally {
        connection.closeSync();
      }
    })();
  }

  polymarketEvents(query: ResearchReplayQuery): AsyncIterable<PolymarketPriceEvent> {
    this.#assertOpen();
    const archive = this;
    return (async function* () {
      const connection = await archive.#instance.connect();
      const where = filters(query, "history", false);
      try {
        const sql = `
          SELECT *
          FROM polymarket_history history
          WHERE ${where.sql}
          ORDER BY history.source_ts_ms, history.event_id`;
        for await (const row of rowObjects(connection, sql, where.values)) {
          const fixtureId = textValue(row["fixture_id"], "fixture_id");
          const sourceTsMs = numberValue(row["source_ts_ms"], "source_ts_ms");
          const observed = textValue(row["observation"], "observation");
          if (observed !== "sampled_history") {
            throw new Error(`Unexpected historical Polymarket observation: ${observed}`);
          }
          const priceValue = row["price"];
          yield {
            schemaVersion: CANONICAL_SCHEMA_VERSION,
            kind: "polymarket.price",
            eventId: textValue(row["event_id"], "event_id"),
            source: "polymarket",
            sourceTsMs,
            observedTsMs: sourceTsMs,
            fixtureId,
            market: parseCanonicalMarketKey(textValue(row["market_key"], "market_key"), fixtureId),
            mappingStatus: mappingStatus(row["mapping_status"]),
            conditionId: textValue(row["condition_id"], "condition_id"),
            assetId: textValue(row["asset_id"], "asset_id"),
            outcome: canonicalOutcome(row["outcome"]),
            tokenRole: tokenRole(row["token_role"]),
            observation: "sampled_history",
            price: priceValue === null ? null : probability(numberValue(priceValue, "price")),
            bestBid: null,
            bestAsk: null,
            size: null,
            side: null
          };
        }
      } finally {
        connection.closeSync();
      }
    })();
  }

  sources(query: ResearchReplayQuery): AsyncIterable<CanonicalEvent>[] {
    return [this.txlineEvents(query), this.polymarketEvents(query)];
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#instance.closeSync();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Research archive is closed");
  }
}
