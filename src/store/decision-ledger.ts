import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { stableJson, type JsonValue } from "../domain/json.js";

const GENESIS_HASH = "0".repeat(64);
const V2_HASH_DOMAIN = "samaritan.decision-ledger.entry/v2";

export const DECISION_LEDGER_HASH_SCHEMA_V1 = 1 as const;
export const DECISION_LEDGER_HASH_SCHEMA_V2 = 2 as const;

export type DecisionLedgerHashSchemaVersion =
  | typeof DECISION_LEDGER_HASH_SCHEMA_V1
  | typeof DECISION_LEDGER_HASH_SCHEMA_V2;

export type DecisionEventKind =
  | "study_initialized"
  | "signal_received"
  | "triage_decision"
  | "thesis_submitted"
  | "analysis_completed"
  | "risk_verdict"
  | "execution_intent"
  | "paper_execution"
  | "position_opened"
  | "position_closed"
  | "position_settled"
  | "case_terminal";

export type DecisionLedgerEntry = {
  sequence: number;
  entryId: string;
  caseId: string;
  kind: DecisionEventKind;
  atTsMs: number;
  insertedAtMs: number;
  payload: JsonValue;
  previousHash: string;
  entryHash: string;
  hashSchemaVersion: DecisionLedgerHashSchemaVersion;
};

export type DecisionLedgerV2HashEnvelope = {
  schemaVersion: typeof DECISION_LEDGER_HASH_SCHEMA_V2;
  sequence: number;
  entryId: string;
  caseId: string;
  kind: DecisionEventKind;
  atTsMs: number;
  insertedAtMs: number;
  payload: JsonValue;
  previousHash: string;
};

export type DecisionLedgerVerification = {
  valid: true;
  rows: number;
  headHash: string;
  hashSchemaVersions: DecisionLedgerHashSchemaVersion[];
  legacyV1Rows: number;
  v2Rows: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Returns the domain-separated hash of the canonical v2 proof envelope.
 * Exported so an independent verifier can reproduce a decision receipt.
 */
export function hashDecisionLedgerV2Entry(
  input: Omit<DecisionLedgerV2HashEnvelope, "schemaVersion">
): string {
  const envelope: DecisionLedgerV2HashEnvelope = {
    schemaVersion: DECISION_LEDGER_HASH_SCHEMA_V2,
    sequence: input.sequence,
    entryId: input.entryId,
    caseId: input.caseId,
    kind: input.kind,
    atTsMs: input.atTsMs,
    insertedAtMs: input.insertedAtMs,
    payload: input.payload,
    previousHash: input.previousHash
  };
  return sha256(`${V2_HASH_DOMAIN}\n${stableJson(envelope)}`);
}

function legacyV1Hash(previousHash: string, entryId: string, payloadJson: string): string {
  return sha256(`${previousHash}\n${entryId}\n${payloadJson}`);
}

function readHashSchemaVersion(value: number | null): DecisionLedgerHashSchemaVersion {
  // The original schema had no version column. ALTER TABLE leaves those rows
  // NULL so their weaker v1 proof remains explicit instead of being relabelled.
  if (value === null || value === DECISION_LEDGER_HASH_SCHEMA_V1) {
    return DECISION_LEDGER_HASH_SCHEMA_V1;
  }
  if (value === DECISION_LEDGER_HASH_SCHEMA_V2) return DECISION_LEDGER_HASH_SCHEMA_V2;
  throw new Error(`Unsupported decision hash schema version: ${value}`);
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export class DecisionLedger {
  readonly #db: Database.Database;
  readonly #now: () => number;

  constructor(path: string, options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = FULL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS decision_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL UNIQUE,
        case_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at_ts_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE,
        inserted_at_ms INTEGER NOT NULL,
        hash_schema_version INTEGER NOT NULL CHECK (hash_schema_version >= 1)
      );
      CREATE TRIGGER IF NOT EXISTS decision_events_no_update
      BEFORE UPDATE ON decision_events BEGIN SELECT RAISE(ABORT, 'decision ledger is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS decision_events_no_delete
      BEFORE DELETE ON decision_events BEGIN SELECT RAISE(ABORT, 'decision ledger is append-only'); END;
    `);
    this.#db.transaction(() => {
      const columns = this.#db.prepare("PRAGMA table_info(decision_events)").all() as Array<{
        name: string;
      }>;
      if (!columns.some((column) => column.name === "hash_schema_version")) {
        // Non-destructive evolution: legacy rows retain NULL, which is read and
        // reported as v1. No historical append-only row is rewritten.
        this.#db.exec("ALTER TABLE decision_events ADD COLUMN hash_schema_version INTEGER");
      }
    }).immediate();
  }

  append(input: {
    entryId: string;
    caseId: string;
    kind: DecisionEventKind;
    atTsMs: number;
    payload: JsonValue;
    insertedAtMs?: number;
  }): DecisionLedgerEntry {
    return this.#db.transaction(() => {
      assertTimestamp(input.atTsMs, "Decision event timestamp");
      const payloadJson = stableJson(input.payload);
      const existing = this.#db.prepare(
        `SELECT sequence, case_id, kind, at_ts_ms, payload_json, previous_hash, entry_hash,
                inserted_at_ms, hash_schema_version
         FROM decision_events WHERE entry_id = ?`
      ).get(input.entryId) as {
        sequence: number;
        case_id: string;
        kind: DecisionEventKind;
        at_ts_ms: number;
        payload_json: string;
        previous_hash: string;
        entry_hash: string;
        inserted_at_ms: number;
        hash_schema_version: number | null;
      } | undefined;
      if (existing) {
        if (
          existing.case_id !== input.caseId ||
          existing.kind !== input.kind ||
          existing.at_ts_ms !== input.atTsMs ||
          existing.payload_json !== payloadJson ||
          (input.insertedAtMs !== undefined && existing.inserted_at_ms !== input.insertedAtMs)
        ) {
          throw new Error(`Decision entry ID collision with different content: ${input.entryId}`);
        }
        return {
          sequence: existing.sequence,
          entryId: input.entryId,
          caseId: input.caseId,
          kind: input.kind,
          atTsMs: input.atTsMs,
          insertedAtMs: existing.inserted_at_ms,
          payload: input.payload,
          previousHash: existing.previous_hash,
          entryHash: existing.entry_hash,
          hashSchemaVersion: readHashSchemaVersion(existing.hash_schema_version)
        };
      }
      const insertedAtMs = input.insertedAtMs ?? this.#now();
      assertTimestamp(insertedAtMs, "Decision insertion timestamp");
      const next = this.#db.prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM decision_events"
      ).get() as { sequence: number };
      const sequence = next.sequence;
      const previous = this.#db.prepare(
        "SELECT entry_hash FROM decision_events ORDER BY sequence DESC LIMIT 1"
      ).get() as { entry_hash: string } | undefined;
      const previousHash = previous?.entry_hash ?? GENESIS_HASH;
      const entryHash = hashDecisionLedgerV2Entry({
        sequence,
        entryId: input.entryId,
        caseId: input.caseId,
        kind: input.kind,
        atTsMs: input.atTsMs,
        insertedAtMs,
        payload: input.payload,
        previousHash
      });
      this.#db.prepare(
        `INSERT INTO decision_events
         (sequence, entry_id, case_id, kind, at_ts_ms, payload_json, previous_hash, entry_hash,
          inserted_at_ms, hash_schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        sequence,
        input.entryId,
        input.caseId,
        input.kind,
        input.atTsMs,
        payloadJson,
        previousHash,
        entryHash,
        insertedAtMs,
        DECISION_LEDGER_HASH_SCHEMA_V2
      );
      return {
        sequence,
        entryId: input.entryId,
        caseId: input.caseId,
        kind: input.kind,
        atTsMs: input.atTsMs,
        insertedAtMs,
        payload: input.payload,
        previousHash,
        entryHash,
        hashSchemaVersion: DECISION_LEDGER_HASH_SCHEMA_V2
      };
    }).immediate();
  }

  entries(caseId?: string): DecisionLedgerEntry[] {
    const rows = (caseId === undefined
      ? this.#db.prepare("SELECT * FROM decision_events ORDER BY sequence").all()
      : this.#db.prepare("SELECT * FROM decision_events WHERE case_id = ? ORDER BY sequence").all(caseId)
    ) as Array<{
      sequence: number;
      entry_id: string;
      case_id: string;
      kind: DecisionEventKind;
      at_ts_ms: number;
      payload_json: string;
      previous_hash: string;
      entry_hash: string;
      inserted_at_ms: number;
      hash_schema_version: number | null;
    }>;
    return rows.map((row) => ({
      sequence: row.sequence,
      entryId: row.entry_id,
      caseId: row.case_id,
      kind: row.kind,
      atTsMs: row.at_ts_ms,
      insertedAtMs: row.inserted_at_ms,
      payload: JSON.parse(row.payload_json) as JsonValue,
      previousHash: row.previous_hash,
      entryHash: row.entry_hash,
      hashSchemaVersion: readHashSchemaVersion(row.hash_schema_version)
    }));
  }

  verifyChain(): DecisionLedgerVerification {
    let previousHash = GENESIS_HASH;
    let rows = 0;
    let legacyV1Rows = 0;
    let v2Rows = 0;
    let reachedV2 = false;
    for (const row of this.#db.prepare(
      `SELECT sequence, entry_id, case_id, kind, at_ts_ms, payload_json, previous_hash,
              entry_hash, inserted_at_ms, hash_schema_version
       FROM decision_events ORDER BY sequence`
    ).iterate() as Iterable<{
      sequence: number;
      entry_id: string;
      case_id: string;
      kind: DecisionEventKind;
      at_ts_ms: number;
      payload_json: string;
      previous_hash: string;
      entry_hash: string;
      inserted_at_ms: number;
      hash_schema_version: number | null;
    }>) {
      if (row.previous_hash !== previousHash) throw new Error(`Broken decision link at ${row.entry_id}`);
      const hashSchemaVersion = readHashSchemaVersion(row.hash_schema_version);
      if (reachedV2 && hashSchemaVersion === DECISION_LEDGER_HASH_SCHEMA_V1) {
        throw new Error(`Decision hash schema downgrade at ${row.entry_id}`);
      }
      let expected: string;
      if (hashSchemaVersion === DECISION_LEDGER_HASH_SCHEMA_V1) {
        expected = legacyV1Hash(previousHash, row.entry_id, row.payload_json);
        legacyV1Rows += 1;
      } else {
        reachedV2 = true;
        expected = hashDecisionLedgerV2Entry({
          sequence: row.sequence,
          entryId: row.entry_id,
          caseId: row.case_id,
          kind: row.kind,
          atTsMs: row.at_ts_ms,
          insertedAtMs: row.inserted_at_ms,
          payload: JSON.parse(row.payload_json) as JsonValue,
          previousHash
        });
        v2Rows += 1;
      }
      if (row.entry_hash !== expected) throw new Error(`Broken decision hash at ${row.entry_id}`);
      previousHash = row.entry_hash;
      rows += 1;
    }
    return {
      valid: true,
      rows,
      headHash: previousHash,
      hashSchemaVersions: [
        ...(legacyV1Rows > 0 ? [DECISION_LEDGER_HASH_SCHEMA_V1] : []),
        ...(v2Rows > 0 ? [DECISION_LEDGER_HASH_SCHEMA_V2] : [])
      ],
      legacyV1Rows,
      v2Rows
    };
  }

  close(): void {
    this.#db.close();
  }
}
