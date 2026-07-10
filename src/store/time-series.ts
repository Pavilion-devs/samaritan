import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { CanonicalEvent } from "../bus/events.js";
import { eventMarketKey } from "../bus/events.js";
import { stableJson } from "../domain/json.js";

export class TimeSeriesStore {
  readonly #instance: DuckDBInstance;
  readonly #connection: DuckDBConnection;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection) {
    this.#instance = instance;
    this.#connection = connection;
  }

  static async create(path = ":memory:"): Promise<TimeSeriesStore> {
    if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
    const instance = await DuckDBInstance.create(path);
    const connection = await instance.connect();
    const store = new TimeSeriesStore(instance, connection);
    await store.#initialize();
    return store;
  }

  async #initialize(): Promise<void> {
    await this.#connection.run(`
      CREATE TABLE IF NOT EXISTS canonical_events (
        event_id VARCHAR PRIMARY KEY,
        kind VARCHAR NOT NULL,
        source VARCHAR NOT NULL,
        source_ts_ms BIGINT NOT NULL,
        observed_ts_ms BIGINT NOT NULL,
        fixture_id VARCHAR,
        market_key VARCHAR,
        payload_json JSON NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quote_outcomes (
        event_id VARCHAR NOT NULL,
        fixture_id VARCHAR NOT NULL,
        market_key VARCHAR NOT NULL,
        source_ts_ms BIGINT NOT NULL,
        outcome VARCHAR NOT NULL,
        probability DOUBLE,
        odds_x1000 INTEGER NOT NULL,
        PRIMARY KEY (event_id, outcome)
      );
      CREATE TABLE IF NOT EXISTS polymarket_observations (
        event_id VARCHAR PRIMARY KEY,
        fixture_id VARCHAR NOT NULL,
        market_key VARCHAR NOT NULL,
        source_ts_ms BIGINT NOT NULL,
        asset_id VARCHAR NOT NULL,
        outcome VARCHAR NOT NULL,
        token_role VARCHAR NOT NULL,
        observation VARCHAR NOT NULL,
        price DOUBLE,
        best_bid DOUBLE,
        best_ask DOUBLE,
        mapping_status VARCHAR NOT NULL
      );
      CREATE TABLE IF NOT EXISTS score_events (
        event_id VARCHAR PRIMARY KEY,
        fixture_id VARCHAR NOT NULL,
        source_ts_ms BIGINT NOT NULL,
        sequence INTEGER NOT NULL,
        action VARCHAR NOT NULL,
        confirmed BOOLEAN,
        clock_seconds INTEGER,
        payload_json JSON NOT NULL
      );
    `);
  }

  async append(event: CanonicalEvent): Promise<void> {
    await this.#connection.run("BEGIN TRANSACTION");
    try {
      await this.#connection.run(
        `INSERT OR IGNORE INTO canonical_events VALUES (?, ?, ?, ?, ?, ?, ?, ?::JSON)`,
        [
          event.eventId,
          event.kind,
          event.source,
          BigInt(event.sourceTsMs),
          BigInt(event.observedTsMs),
          event.fixtureId,
          eventMarketKey(event),
          stableJson(event)
        ]
      );
      if (event.kind === "odds.quote") {
        for (const outcome of event.outcomes) {
          await this.#connection.run(
            `INSERT OR IGNORE INTO quote_outcomes VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              event.eventId,
              event.fixtureId,
              event.market.key,
              BigInt(event.sourceTsMs),
              outcome.outcome,
              outcome.fairProbability,
              outcome.oddsX1000
            ]
          );
        }
      } else if (event.kind === "polymarket.price") {
        await this.#connection.run(
          `INSERT OR IGNORE INTO polymarket_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            event.eventId,
            event.fixtureId,
            event.market.key,
            BigInt(event.sourceTsMs),
            event.assetId,
            event.outcome,
            event.tokenRole,
            event.observation,
            event.price,
            event.bestBid,
            event.bestAsk,
            event.mappingStatus
          ]
        );
      } else if (event.kind === "score.update") {
        await this.#connection.run(
          `INSERT OR IGNORE INTO score_events VALUES (?, ?, ?, ?, ?, ?, ?, ?::JSON)`,
          [
            event.eventId,
            event.fixtureId,
            BigInt(event.sourceTsMs),
            event.sequence,
            event.action,
            event.confirmed,
            event.clock?.seconds ?? null,
            stableJson(event)
          ]
        );
      }
      await this.#connection.run("COMMIT");
    } catch (error) {
      await this.#connection.run("ROLLBACK");
      throw error;
    }
  }

  async count(table = "canonical_events"): Promise<number> {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
    const result = await this.#connection.runAndReadAll(`SELECT COUNT(*) AS count FROM ${table}`);
    const row = result.getRowObjectsJS()[0];
    return Number(row?.count ?? 0);
  }

  close(): void {
    this.#connection.closeSync();
    this.#instance.closeSync();
  }
}
