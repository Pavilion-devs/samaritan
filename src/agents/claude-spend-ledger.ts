import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { stableJson } from "../domain/json.js";
import {
  CLAUDE_HARD_CEILING_NANO_USD,
  claudeUsageCostNanoUsd,
  type ClaudeModel,
  type ClaudeUsage
} from "./claude-pricing.js";

const GENESIS_HASH = "0".repeat(64);

type ReservationRow = {
  request_id: string;
  case_id: string;
  stage: ClaudeStage;
  model: ClaudeModel;
  maximum_cost_nano_usd: number;
};

export type ClaudeStage = "triage" | "analyst" | "smoke";
export type ClaudeSettlementStatus = "success" | "response_invalid" | "request_rejected" | "billing_unknown";

export type ClaudeSpendSummary = {
  actualCostNanoUsd: number;
  outstandingReservedNanoUsd: number;
  hardCeilingNanoUsd: number;
  remainingNanoUsd: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative safe integer`);
}

export class ClaudeSpendLedger {
  readonly #db: Database.Database;
  readonly hardCeilingNanoUsd: number;

  constructor(path: string, hardCeilingNanoUsd = CLAUDE_HARD_CEILING_NANO_USD) {
    assertNonnegativeInteger(hardCeilingNanoUsd, "hardCeilingNanoUsd");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.hardCeilingNanoUsd = hardCeilingNanoUsd;
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = FULL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS claude_spend_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL UNIQUE,
        request_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        model TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('reservation', 'settlement')),
        maximum_cost_nano_usd INTEGER NOT NULL,
        actual_cost_nano_usd INTEGER,
        status TEXT,
        usage_json TEXT,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE,
        inserted_at_ms INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS claude_spend_one_reservation
        ON claude_spend_events(request_id) WHERE kind = 'reservation';
      CREATE UNIQUE INDEX IF NOT EXISTS claude_spend_one_settlement
        ON claude_spend_events(request_id) WHERE kind = 'settlement';
      CREATE TRIGGER IF NOT EXISTS claude_spend_no_update
      BEFORE UPDATE ON claude_spend_events BEGIN SELECT RAISE(ABORT, 'Claude spend ledger is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS claude_spend_no_delete
      BEFORE DELETE ON claude_spend_events BEGIN SELECT RAISE(ABORT, 'Claude spend ledger is append-only'); END;
    `);
  }

  reserve(input: {
    requestId: string;
    caseId: string;
    stage: ClaudeStage;
    model: ClaudeModel;
    maximumCostNanoUsd: number;
    insertedAtMs?: number;
  }): void {
    assertNonnegativeInteger(input.maximumCostNanoUsd, "maximumCostNanoUsd");
    this.#db.transaction(() => {
      const existing = this.#reservation(input.requestId);
      if (existing) {
        if (
          existing.case_id !== input.caseId ||
          existing.stage !== input.stage ||
          existing.model !== input.model ||
          existing.maximum_cost_nano_usd !== input.maximumCostNanoUsd
        ) {
          throw new Error(`Claude request ID collision: ${input.requestId}`);
        }
        return;
      }
      const summary = this.#summary();
      const projected = summary.actualCostNanoUsd + summary.outstandingReservedNanoUsd + input.maximumCostNanoUsd;
      if (projected > this.hardCeilingNanoUsd) {
        throw new Error(`Claude hard spend ceiling would be exceeded by request ${input.requestId}`);
      }
      this.#append({
        entryId: `${input.requestId}:reservation`,
        requestId: input.requestId,
        caseId: input.caseId,
        stage: input.stage,
        model: input.model,
        kind: "reservation",
        maximumCostNanoUsd: input.maximumCostNanoUsd,
        actualCostNanoUsd: null,
        status: null,
        usageJson: null,
        insertedAtMs: input.insertedAtMs ?? Date.now()
      });
    })();
  }

  settle(input: {
    requestId: string;
    status: ClaudeSettlementStatus;
    usage?: ClaudeUsage;
    insertedAtMs?: number;
  }): void {
    this.#db.transaction(() => {
      const reservation = this.#reservation(input.requestId);
      if (!reservation) throw new Error(`No Claude spend reservation for ${input.requestId}`);
      const existing = this.#db.prepare(
        "SELECT entry_id FROM claude_spend_events WHERE request_id = ? AND kind = 'settlement'"
      ).get(input.requestId) as { entry_id: string } | undefined;
      if (existing) throw new Error(`Claude request already settled: ${input.requestId}`);

      const actualCostNanoUsd = input.status === "billing_unknown"
        ? reservation.maximum_cost_nano_usd
        : claudeUsageCostNanoUsd(reservation.model, input.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0
        });
      if (actualCostNanoUsd > reservation.maximum_cost_nano_usd) {
        throw new Error(`Claude actual cost exceeded reservation for ${input.requestId}`);
      }
      this.#append({
        entryId: `${input.requestId}:settlement`,
        requestId: input.requestId,
        caseId: reservation.case_id,
        stage: reservation.stage,
        model: reservation.model,
        kind: "settlement",
        maximumCostNanoUsd: reservation.maximum_cost_nano_usd,
        actualCostNanoUsd,
        status: input.status,
        usageJson: input.usage === undefined ? null : stableJson(input.usage),
        insertedAtMs: input.insertedAtMs ?? Date.now()
      });
    })();
  }

  summary(): ClaudeSpendSummary {
    return this.#summary();
  }

  verifyChain(): { valid: true; rows: number; headHash: string } {
    let previousHash = GENESIS_HASH;
    let rows = 0;
    for (const row of this.#db.prepare(
      "SELECT entry_id, request_id, case_id, stage, model, kind, maximum_cost_nano_usd, actual_cost_nano_usd, status, usage_json, previous_hash, entry_hash FROM claude_spend_events ORDER BY sequence"
    ).iterate() as Iterable<Record<string, string | number | null>>) {
      if (row.previous_hash !== previousHash) throw new Error(`Broken Claude spend link at ${String(row.entry_id)}`);
      const payload = stableJson({
        requestId: row.request_id,
        caseId: row.case_id,
        stage: row.stage,
        model: row.model,
        kind: row.kind,
        maximumCostNanoUsd: row.maximum_cost_nano_usd,
        actualCostNanoUsd: row.actual_cost_nano_usd,
        status: row.status,
        usageJson: row.usage_json
      });
      const expected = sha256(`${previousHash}\n${String(row.entry_id)}\n${payload}`);
      if (row.entry_hash !== expected) throw new Error(`Broken Claude spend hash at ${String(row.entry_id)}`);
      previousHash = String(row.entry_hash);
      rows += 1;
    }
    return { valid: true, rows, headHash: previousHash };
  }

  close(): void {
    this.#db.close();
  }

  #summary(): ClaudeSpendSummary {
    const row = this.#db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN kind = 'settlement' THEN actual_cost_nano_usd ELSE 0 END), 0) AS actual,
        COALESCE(SUM(CASE WHEN kind = 'reservation' AND request_id NOT IN (
          SELECT request_id FROM claude_spend_events WHERE kind = 'settlement'
        ) THEN maximum_cost_nano_usd ELSE 0 END), 0) AS outstanding
      FROM claude_spend_events
    `).get() as { actual: number; outstanding: number };
    return {
      actualCostNanoUsd: row.actual,
      outstandingReservedNanoUsd: row.outstanding,
      hardCeilingNanoUsd: this.hardCeilingNanoUsd,
      remainingNanoUsd: this.hardCeilingNanoUsd - row.actual - row.outstanding
    };
  }

  #reservation(requestId: string): ReservationRow | undefined {
    return this.#db.prepare(`
      SELECT request_id, case_id, stage, model, maximum_cost_nano_usd
      FROM claude_spend_events WHERE request_id = ? AND kind = 'reservation'
    `).get(requestId) as ReservationRow | undefined;
  }

  #append(input: {
    entryId: string;
    requestId: string;
    caseId: string;
    stage: ClaudeStage;
    model: ClaudeModel;
    kind: "reservation" | "settlement";
    maximumCostNanoUsd: number;
    actualCostNanoUsd: number | null;
    status: ClaudeSettlementStatus | null;
    usageJson: string | null;
    insertedAtMs: number;
  }): void {
    const previous = this.#db.prepare(
      "SELECT entry_hash FROM claude_spend_events ORDER BY sequence DESC LIMIT 1"
    ).get() as { entry_hash: string } | undefined;
    const previousHash = previous?.entry_hash ?? GENESIS_HASH;
    const payload = stableJson({
      requestId: input.requestId,
      caseId: input.caseId,
      stage: input.stage,
      model: input.model,
      kind: input.kind,
      maximumCostNanoUsd: input.maximumCostNanoUsd,
      actualCostNanoUsd: input.actualCostNanoUsd,
      status: input.status,
      usageJson: input.usageJson
    });
    const entryHash = sha256(`${previousHash}\n${input.entryId}\n${payload}`);
    this.#db.prepare(`
      INSERT INTO claude_spend_events
      (entry_id, request_id, case_id, stage, model, kind, maximum_cost_nano_usd,
       actual_cost_nano_usd, status, usage_json, previous_hash, entry_hash, inserted_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.entryId,
      input.requestId,
      input.caseId,
      input.stage,
      input.model,
      input.kind,
      input.maximumCostNanoUsd,
      input.actualCostNanoUsd,
      input.status,
      input.usageJson,
      previousHash,
      entryHash,
      input.insertedAtMs
    );
  }
}
