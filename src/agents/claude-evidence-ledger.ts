import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { stableJson } from "../domain/json.js";
import {
  CLAUDE_MODEL,
  claudeUsageCostNanoUsd,
  type ClaudeUsage
} from "./claude-pricing.js";
import type { ClaudeInvocationEvidence } from "./claude.js";

const GENESIS_HASH = "0".repeat(64);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().safe(),
  outputTokens: z.number().int().nonnegative().safe(),
  cacheCreationInputTokens: z.number().int().nonnegative().safe(),
  cacheReadInputTokens: z.number().int().nonnegative().safe()
}).strict();
const evidenceSchema = z.object({
  caseId: z.string().min(1),
  stage: z.enum(["triage", "analyst"]),
  invocationClass: z.enum(["anthropic_api", "injected_client"]),
  model: z.enum([CLAUDE_MODEL.triage, CLAUDE_MODEL.analyst]),
  promptVersion: z.string().min(1).max(100),
  promptSha256: sha256Schema,
  responseSha256: sha256Schema,
  billingEvidenceSha256: sha256Schema,
  usage: usageSchema,
  actualCostNanoUsd: z.number().int().nonnegative().safe()
}).strict().superRefine((evidence, context) => {
  const expectedModel = evidence.stage === "triage" ? CLAUDE_MODEL.triage : CLAUDE_MODEL.analyst;
  if (evidence.model !== expectedModel) {
    context.addIssue({ code: "custom", path: ["model"], message: "Claude evidence stage/model mismatch" });
  }
  if (evidence.actualCostNanoUsd !== claudeUsageCostNanoUsd(evidence.model, evidence.usage)) {
    context.addIssue({
      code: "custom",
      path: ["actualCostNanoUsd"],
      message: "Claude evidence cost does not match model usage"
    });
  }
});

type EvidenceRow = {
  sequence: number;
  entry_id: string;
  case_id: string;
  stage: "triage" | "analyst";
  invocation_class: "anthropic_api" | "injected_client";
  model: typeof CLAUDE_MODEL.triage | typeof CLAUDE_MODEL.analyst;
  prompt_version: string;
  prompt_sha256: string;
  response_sha256: string;
  billing_evidence_sha256: string;
  usage_json: string;
  actual_cost_nano_usd: number;
  previous_hash: string;
  entry_hash: string;
  inserted_at_ms: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fromRow(row: EvidenceRow): ClaudeInvocationEvidence {
  return evidenceSchema.parse({
    caseId: row.case_id,
    stage: row.stage,
    invocationClass: row.invocation_class,
    model: row.model,
    promptVersion: row.prompt_version,
    promptSha256: row.prompt_sha256,
    responseSha256: row.response_sha256,
    billingEvidenceSha256: row.billing_evidence_sha256,
    usage: JSON.parse(row.usage_json) as ClaudeUsage,
    actualCostNanoUsd: row.actual_cost_nano_usd
  });
}

export type ClaudeInvocationEvidenceRecord = {
  sequence: number;
  entryId: string;
  insertedAtMs: number;
  previousHash: string;
  entryHash: string;
  evidence: ClaudeInvocationEvidence;
};

function recordFromRow(row: EvidenceRow): ClaudeInvocationEvidenceRecord {
  return {
    sequence: row.sequence,
    entryId: row.entry_id,
    insertedAtMs: row.inserted_at_ms,
    previousHash: row.previous_hash,
    entryHash: row.entry_hash,
    evidence: fromRow(row)
  };
}

export class ClaudeInvocationEvidenceLedger {
  readonly #db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = FULL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS claude_invocation_evidence (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL UNIQUE,
        case_id TEXT NOT NULL,
        stage TEXT NOT NULL CHECK(stage IN ('triage', 'analyst')),
        invocation_class TEXT NOT NULL CHECK(invocation_class IN ('anthropic_api', 'injected_client')),
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        prompt_sha256 TEXT NOT NULL,
        response_sha256 TEXT NOT NULL,
        billing_evidence_sha256 TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        actual_cost_nano_usd INTEGER NOT NULL,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE,
        inserted_at_ms INTEGER NOT NULL,
        UNIQUE(case_id, stage)
      );
      CREATE TRIGGER IF NOT EXISTS claude_invocation_evidence_no_update
      BEFORE UPDATE ON claude_invocation_evidence
      BEGIN SELECT RAISE(ABORT, 'Claude invocation evidence is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS claude_invocation_evidence_no_delete
      BEFORE DELETE ON claude_invocation_evidence
      BEGIN SELECT RAISE(ABORT, 'Claude invocation evidence is append-only'); END;
    `);
  }

  append(value: ClaudeInvocationEvidence, insertedAtMs = Date.now()): ClaudeInvocationEvidenceRecord {
    const evidence = evidenceSchema.parse(value);
    if (!Number.isSafeInteger(insertedAtMs) || insertedAtMs < 0) {
      throw new Error("Claude invocation evidence insertion time is invalid");
    }
    return this.#db.transaction(() => {
      const existing = this.#db.prepare(
        "SELECT * FROM claude_invocation_evidence WHERE case_id = ? AND stage = ?"
      ).get(evidence.caseId, evidence.stage) as EvidenceRow | undefined;
      if (existing) {
        if (stableJson(fromRow(existing)) !== stableJson(evidence)) {
          throw new Error(`Claude invocation evidence collision for ${evidence.caseId}:${evidence.stage}`);
        }
        return recordFromRow(existing);
      }
      const previous = this.#db.prepare(
        "SELECT entry_hash FROM claude_invocation_evidence ORDER BY sequence DESC LIMIT 1"
      ).get() as { entry_hash: string } | undefined;
      const previousHash = previous?.entry_hash ?? GENESIS_HASH;
      const entryId = `${evidence.caseId}:${evidence.stage}`;
      const payload = stableJson({ evidence, insertedAtMs });
      const entryHash = sha256(`${previousHash}\n${entryId}\n${payload}`);
      const inserted = this.#db.prepare(`
        INSERT INTO claude_invocation_evidence
        (entry_id, case_id, stage, invocation_class, model, prompt_version, prompt_sha256, response_sha256,
         billing_evidence_sha256, usage_json, actual_cost_nano_usd, previous_hash,
         entry_hash, inserted_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId,
        evidence.caseId,
        evidence.stage,
        evidence.invocationClass,
        evidence.model,
        evidence.promptVersion,
        evidence.promptSha256,
        evidence.responseSha256,
        evidence.billingEvidenceSha256,
        stableJson(evidence.usage),
        evidence.actualCostNanoUsd,
        previousHash,
        entryHash,
        insertedAtMs
      );
      const row = this.#db.prepare(
        "SELECT * FROM claude_invocation_evidence WHERE sequence = ?"
      ).get(Number(inserted.lastInsertRowid)) as EvidenceRow | undefined;
      if (!row) throw new Error("Claude invocation evidence append was not durable");
      return recordFromRow(row);
    })();
  }

  entries(caseId?: string): ClaudeInvocationEvidence[] {
    const rows = caseId === undefined
      ? this.#db.prepare("SELECT * FROM claude_invocation_evidence ORDER BY sequence").all()
      : this.#db.prepare(
        "SELECT * FROM claude_invocation_evidence WHERE case_id = ? ORDER BY sequence"
      ).all(caseId);
    return (rows as EvidenceRow[]).map(fromRow);
  }

  records(caseId?: string): ClaudeInvocationEvidenceRecord[] {
    const rows = caseId === undefined
      ? this.#db.prepare("SELECT * FROM claude_invocation_evidence ORDER BY sequence").all()
      : this.#db.prepare(
        "SELECT * FROM claude_invocation_evidence WHERE case_id = ? ORDER BY sequence"
      ).all(caseId);
    return (rows as EvidenceRow[]).map(recordFromRow);
  }

  verifyChain(): ClaudeInvocationEvidenceChainVerification {
    let previousHash = GENESIS_HASH;
    let rows = 0;
    for (const row of this.#db.prepare(
      "SELECT * FROM claude_invocation_evidence ORDER BY sequence"
    ).iterate() as Iterable<EvidenceRow>) {
      if (!Number.isSafeInteger(row.sequence) || row.sequence <= 0) {
        throw new Error("Claude invocation evidence sequence is invalid");
      }
      if (!Number.isSafeInteger(row.inserted_at_ms) || row.inserted_at_ms < 0) {
        throw new Error(`Claude invocation evidence insertion time is invalid at sequence ${row.sequence}`);
      }
      if (row.previous_hash !== previousHash) {
        throw new Error(`Broken Claude invocation evidence link at ${row.case_id}:${row.stage}`);
      }
      const evidence = fromRow(row);
      const entryId = `${evidence.caseId}:${evidence.stage}`;
      if (row.entry_id !== entryId) {
        throw new Error(`Broken Claude invocation evidence identity at sequence ${row.sequence}`);
      }
      const expectedHash = sha256(
        `${previousHash}\n${entryId}\n${stableJson({ evidence, insertedAtMs: row.inserted_at_ms })}`
      );
      if (row.entry_hash !== expectedHash) {
        throw new Error(`Broken Claude invocation evidence hash at ${entryId}`);
      }
      previousHash = row.entry_hash;
      rows += 1;
    }
    return { valid: true, rows, headHash: previousHash };
  }

  close(): void {
    this.#db.close();
  }
}

export type ClaudeInvocationEvidenceChainVerification = {
  valid: true;
  rows: number;
  headHash: string;
};
