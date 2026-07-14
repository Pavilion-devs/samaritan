import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { stableJson, type JsonValue } from "../src/domain/json.js";
import {
  DECISION_LEDGER_HASH_SCHEMA_V1,
  DECISION_LEDGER_HASH_SCHEMA_V2,
  DecisionLedger,
  hashDecisionLedgerV2Entry
} from "../src/store/decision-ledger.js";

const GENESIS_HASH = "0".repeat(64);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function ledgerPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "samaritan-decision-ledger-"));
  directories.push(directory);
  return join(directory, "decision-ledger.sqlite");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function legacyV1Hash(previousHash: string, entryId: string, payloadJson: string): string {
  return sha256(`${previousHash}\n${entryId}\n${payloadJson}`);
}

function createLegacyV1Ledger(path: string): void {
  const db = new Database(path);
  const payloadJson = stableJson({ status: "initialized" });
  db.exec(`
    CREATE TABLE decision_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL UNIQUE,
      case_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      at_ts_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL UNIQUE,
      inserted_at_ms INTEGER NOT NULL
    );
    CREATE TRIGGER decision_events_no_update
    BEFORE UPDATE ON decision_events BEGIN SELECT RAISE(ABORT, 'decision ledger is append-only'); END;
    CREATE TRIGGER decision_events_no_delete
    BEFORE DELETE ON decision_events BEGIN SELECT RAISE(ABORT, 'decision ledger is append-only'); END;
  `);
  db.prepare(
    `INSERT INTO decision_events
     (sequence, entry_id, case_id, kind, at_ts_ms, payload_json, previous_hash, entry_hash, inserted_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    1,
    "legacy-entry",
    "legacy-case",
    "study_initialized",
    1_000,
    payloadJson,
    GENESIS_HASH,
    legacyV1Hash(GENESIS_HASH, "legacy-entry", payloadJson),
    1_001
  );
  db.close();
}

function appendV2Fixture(path: string, count = 1): void {
  const ledger = new DecisionLedger(path);
  for (let index = 1; index <= count; index += 1) {
    ledger.append({
      entryId: `entry-${index}`,
      caseId: "case-1",
      kind: index === 1 ? "signal_received" : "triage_decision",
      atTsMs: 1_000 + index,
      insertedAtMs: 2_000 + index,
      payload: index === 1 ? { z: 2, a: { y: 1, x: 0 } } : { decision: "drop" }
    });
  }
  ledger.close();
}

function mutate(path: string, sql: string, parameters: unknown[] = []): void {
  const db = new Database(path);
  db.exec("DROP TRIGGER IF EXISTS decision_events_no_update");
  db.exec("DROP TRIGGER IF EXISTS decision_events_no_delete");
  db.prepare(sql).run(...parameters);
  db.close();
}

describe("decision-ledger v2 proof envelope", () => {
  it("commits every proof field through a canonical, domain-separated v2 hash", () => {
    const path = ledgerPath();
    const ledger = new DecisionLedger(path);
    const payload: JsonValue = { z: 2, a: { y: 1, x: 0 } };
    const entry = ledger.append({
      entryId: "entry-1",
      caseId: "case-1",
      kind: "signal_received",
      atTsMs: 1_001,
      insertedAtMs: 2_001,
      payload
    });

    expect(entry).toMatchObject({
      sequence: 1,
      insertedAtMs: 2_001,
      hashSchemaVersion: DECISION_LEDGER_HASH_SCHEMA_V2
    });
    expect(entry.entryHash).toBe(hashDecisionLedgerV2Entry({
      sequence: 1,
      entryId: "entry-1",
      caseId: "case-1",
      kind: "signal_received",
      atTsMs: 1_001,
      insertedAtMs: 2_001,
      payload: { a: { x: 0, y: 1 }, z: 2 },
      previousHash: GENESIS_HASH
    }));
    expect(ledger.verifyChain()).toMatchObject({
      valid: true,
      rows: 1,
      hashSchemaVersions: [DECISION_LEDGER_HASH_SCHEMA_V2],
      legacyV1Rows: 0,
      v2Rows: 1
    });
    ledger.close();
  });

  it.each([
    ["entry ID", "entry_id", "tampered-entry"],
    ["case ID", "case_id", "tampered-case"],
    ["event kind", "kind", "risk_verdict"],
    ["event timestamp", "at_ts_ms", 9_001],
    ["insertion timestamp", "inserted_at_ms", 9_002]
  ])("rejects tampered %s metadata", (_label, column, value) => {
    const path = ledgerPath();
    appendV2Fixture(path);
    mutate(path, `UPDATE decision_events SET ${column} = ? WHERE sequence = 1`, [value]);

    const ledger = new DecisionLedger(path);
    expect(() => ledger.verifyChain()).toThrow(/Broken decision hash/);
    ledger.close();
  });

  it("rejects a tampered canonical payload", () => {
    const path = ledgerPath();
    appendV2Fixture(path);
    mutate(path, "UPDATE decision_events SET payload_json = ? WHERE sequence = 1", [
      stableJson({ a: { x: 0, y: 999 }, z: 2 })
    ]);

    const ledger = new DecisionLedger(path);
    expect(() => ledger.verifyChain()).toThrow(/Broken decision hash/);
    ledger.close();
  });

  it("rejects a relabelled hash schema and a replaced previous link", () => {
    const relabelledPath = ledgerPath();
    appendV2Fixture(relabelledPath);
    mutate(relabelledPath, "UPDATE decision_events SET hash_schema_version = 1 WHERE sequence = 1");
    const relabelled = new DecisionLedger(relabelledPath);
    expect(() => relabelled.verifyChain()).toThrow(/Broken decision hash/);
    relabelled.close();

    const relinkedPath = ledgerPath();
    appendV2Fixture(relinkedPath);
    mutate(relinkedPath, "UPDATE decision_events SET previous_hash = ? WHERE sequence = 1", [
      "1".repeat(64)
    ]);
    const relinked = new DecisionLedger(relinkedPath);
    expect(() => relinked.verifyChain()).toThrow(/Broken decision link/);
    relinked.close();
  });

  it("rejects reordered rows because sequence is committed", () => {
    const path = ledgerPath();
    appendV2Fixture(path, 2);
    const db = new Database(path);
    db.exec("DROP TRIGGER IF EXISTS decision_events_no_update");
    db.exec("UPDATE decision_events SET sequence = -1 WHERE sequence = 1");
    db.exec("UPDATE decision_events SET sequence = 1 WHERE sequence = 2");
    db.exec("UPDATE decision_events SET sequence = 2 WHERE sequence = -1");
    db.close();

    const ledger = new DecisionLedger(path);
    expect(() => ledger.verifyChain()).toThrow(/Broken decision (link|hash)/);
    ledger.close();
  });
});

describe("decision-ledger hash-schema compatibility", () => {
  it("preserves legacy rows as identifiable v1 and appends a linked v2 suffix", () => {
    const path = ledgerPath();
    createLegacyV1Ledger(path);

    const ledger = new DecisionLedger(path);
    expect(ledger.entries()[0]).toMatchObject({
      entryId: "legacy-entry",
      insertedAtMs: 1_001,
      hashSchemaVersion: DECISION_LEDGER_HASH_SCHEMA_V1
    });
    expect(ledger.verifyChain()).toMatchObject({
      valid: true,
      rows: 1,
      hashSchemaVersions: [DECISION_LEDGER_HASH_SCHEMA_V1],
      legacyV1Rows: 1,
      v2Rows: 0
    });

    const appended = ledger.append({
      entryId: "v2-entry",
      caseId: "legacy-case",
      kind: "signal_received",
      atTsMs: 2_000,
      insertedAtMs: 2_001,
      payload: { status: "received" }
    });
    expect(appended).toMatchObject({ sequence: 2, hashSchemaVersion: DECISION_LEDGER_HASH_SCHEMA_V2 });
    expect(ledger.verifyChain()).toMatchObject({
      valid: true,
      rows: 2,
      hashSchemaVersions: [
        DECISION_LEDGER_HASH_SCHEMA_V1,
        DECISION_LEDGER_HASH_SCHEMA_V2
      ],
      legacyV1Rows: 1,
      v2Rows: 1
    });
    ledger.close();

    const db = new Database(path, { readonly: true });
    const versions = db.prepare(
      "SELECT hash_schema_version AS version FROM decision_events ORDER BY sequence"
    ).all() as Array<{ version: number | null }>;
    expect(versions).toEqual([{ version: null }, { version: DECISION_LEDGER_HASH_SCHEMA_V2 }]);
    db.close();
  });

  it("rejects a legacy writer downgrade after the ledger has transitioned to v2", () => {
    const path = ledgerPath();
    createLegacyV1Ledger(path);
    const ledger = new DecisionLedger(path);
    const v2 = ledger.append({
      entryId: "v2-entry",
      caseId: "legacy-case",
      kind: "signal_received",
      atTsMs: 2_000,
      insertedAtMs: 2_001,
      payload: { status: "received" }
    });
    ledger.close();

    const payloadJson = stableJson({ decision: "drop" });
    const db = new Database(path);
    db.prepare(
      `INSERT INTO decision_events
       (sequence, entry_id, case_id, kind, at_ts_ms, payload_json, previous_hash, entry_hash,
        inserted_at_ms, hash_schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      3,
      "downgraded-entry",
      "legacy-case",
      "triage_decision",
      3_000,
      payloadJson,
      v2.entryHash,
      legacyV1Hash(v2.entryHash, "downgraded-entry", payloadJson),
      3_001
    );
    db.close();

    const reopened = new DecisionLedger(path);
    expect(() => reopened.verifyChain()).toThrow(/hash schema downgrade/);
    reopened.close();
  });
});
