import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { CanonicalEvent } from "../bus/events.js";
import { eventMarketKey } from "../bus/events.js";
import { stableJson } from "../domain/json.js";

const GENESIS_HASH = "0".repeat(64);

type AppendResult = { sequence: number; appended: boolean; hash: string };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function eventIdentity(event: CanonicalEvent): string {
  const { observedTsMs: _redeliveryTime, ...identity } = event;
  return stableJson(identity);
}

export class AppendOnlyJournal {
  readonly #db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = FULL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        source_ts_ms INTEGER NOT NULL,
        observed_ts_ms INTEGER NOT NULL,
        fixture_id TEXT,
        market_key TEXT,
        identity_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL UNIQUE,
        inserted_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS raw_ingress (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        ingress_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        stream TEXT NOT NULL,
        observed_ts_ms INTEGER NOT NULL,
        raw_payload TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        row_hash TEXT NOT NULL UNIQUE,
        inserted_at_ms INTEGER NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS canonical_events_no_update
      BEFORE UPDATE ON canonical_events BEGIN SELECT RAISE(ABORT, 'canonical event journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS canonical_events_no_delete
      BEFORE DELETE ON canonical_events BEGIN SELECT RAISE(ABORT, 'canonical event journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS raw_ingress_no_update
      BEFORE UPDATE ON raw_ingress BEGIN SELECT RAISE(ABORT, 'raw ingress journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS raw_ingress_no_delete
      BEFORE DELETE ON raw_ingress BEGIN SELECT RAISE(ABORT, 'raw ingress journal is append-only'); END;
    `);
  }

  append(event: CanonicalEvent, insertedAtMs = Date.now()): AppendResult {
    return this.#db.transaction(() => {
      const identityJson = eventIdentity(event);
      const payloadJson = stableJson(event);
      const existing = this.#db
        .prepare("SELECT sequence, identity_json, event_hash FROM canonical_events WHERE event_id = ?")
        .get(event.eventId) as
        | { sequence: number; identity_json: string; event_hash: string }
        | undefined;
      if (existing) {
        if (existing.identity_json !== identityJson) {
          throw new Error(`Event ID collision with different immutable content: ${event.eventId}`);
        }
        return { sequence: existing.sequence, appended: false, hash: existing.event_hash };
      }

      const previous = this.#db
        .prepare("SELECT event_hash FROM canonical_events ORDER BY sequence DESC LIMIT 1")
        .get() as { event_hash: string } | undefined;
      const previousHash = previous?.event_hash ?? GENESIS_HASH;
      const eventHash = sha256(`${previousHash}\n${event.eventId}\n${payloadJson}`);
      const result = this.#db
        .prepare(
          `INSERT INTO canonical_events
           (event_id, kind, source, source_ts_ms, observed_ts_ms, fixture_id, market_key,
            identity_json, payload_json, previous_hash, event_hash, inserted_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.eventId,
          event.kind,
          event.source,
          event.sourceTsMs,
          event.observedTsMs,
          event.fixtureId,
          eventMarketKey(event),
          identityJson,
          payloadJson,
          previousHash,
          eventHash,
          insertedAtMs
        );
      return { sequence: Number(result.lastInsertRowid), appended: true, hash: eventHash };
    })();
  }

  appendRaw(input: {
    ingressId: string;
    source: string;
    stream: string;
    observedTsMs: number;
    rawPayload: string;
    insertedAtMs?: number;
  }): AppendResult {
    return this.#db.transaction(() => {
      const payloadHash = sha256(input.rawPayload);
      const existing = this.#db
        .prepare("SELECT sequence, payload_sha256, row_hash FROM raw_ingress WHERE ingress_id = ?")
        .get(input.ingressId) as
        | { sequence: number; payload_sha256: string; row_hash: string }
        | undefined;
      if (existing) {
        if (existing.payload_sha256 !== payloadHash) {
          throw new Error(`Raw ingress ID collision with different content: ${input.ingressId}`);
        }
        return { sequence: existing.sequence, appended: false, hash: existing.row_hash };
      }
      const previous = this.#db
        .prepare("SELECT row_hash FROM raw_ingress ORDER BY sequence DESC LIMIT 1")
        .get() as { row_hash: string } | undefined;
      const previousHash = previous?.row_hash ?? GENESIS_HASH;
      const rowHash = sha256(`${previousHash}\n${input.ingressId}\n${payloadHash}`);
      const result = this.#db
        .prepare(
          `INSERT INTO raw_ingress
           (ingress_id, source, stream, observed_ts_ms, raw_payload, payload_sha256,
            previous_hash, row_hash, inserted_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.ingressId,
          input.source,
          input.stream,
          input.observedTsMs,
          input.rawPayload,
          payloadHash,
          previousHash,
          rowHash,
          input.insertedAtMs ?? Date.now()
        );
      return { sequence: Number(result.lastInsertRowid), appended: true, hash: rowHash };
    })();
  }

  count(): number {
    const row = this.#db.prepare("SELECT COUNT(*) AS count FROM canonical_events").get() as { count: number };
    return row.count;
  }

  verifyChain(): { valid: true; rows: number; headHash: string } {
    let previousHash = GENESIS_HASH;
    let rows = 0;
    for (const row of this.#db
      .prepare("SELECT event_id, payload_json, previous_hash, event_hash FROM canonical_events ORDER BY sequence")
      .iterate() as Iterable<{
      event_id: string;
      payload_json: string;
      previous_hash: string;
      event_hash: string;
    }>) {
      if (row.previous_hash !== previousHash) throw new Error(`Broken journal link at ${row.event_id}`);
      const expected = sha256(`${previousHash}\n${row.event_id}\n${row.payload_json}`);
      if (row.event_hash !== expected) throw new Error(`Broken journal hash at ${row.event_id}`);
      previousHash = row.event_hash;
      rows += 1;
    }
    return { valid: true, rows, headHash: previousHash };
  }

  close(): void {
    this.#db.close();
  }
}
