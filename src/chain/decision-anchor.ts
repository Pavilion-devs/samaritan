import {
  PublicKey,
  TransactionInstruction,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction
} from "@solana/web3.js";
import { z } from "zod";
import { stableJson } from "../domain/json.js";
import {
  DECISION_RECEIPT_SCHEMA_VERSION,
  decisionReceiptSchema,
  sha256,
  verifyDecisionReceipt,
  type DecisionReceipt
} from "../proof/decision-receipt-schema.js";

export const DECISION_ANCHOR_SCHEMA_VERSION = 1 as const;
export const DECISION_ANCHOR_MEMO_DOMAIN = "samaritan.decision-receipt.anchor/v1" as const;
export const DECISION_ANCHOR_INTENT_HASH_DOMAIN =
  "samaritan.decision-receipt.anchor-intent/v1" as const;
export const DECISION_ANCHOR_COMMITMENT_TYPE =
  "decision_receipt_and_ledger_head_sha256" as const;
export const SOLANA_MEMO_PROGRAM_ID =
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as const;
export const SOLANA_DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
export const SOLANA_MAINNET_BETA_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;
export const SOLANA_MEMO_MAX_BYTES = 566 as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const signatureSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);

export const decisionAnchorMemoPayloadSchema = z.object({
  schemaVersion: z.literal(DECISION_ANCHOR_SCHEMA_VERSION),
  anchorType: z.literal("samaritan_decision_receipt_anchor"),
  network: z.literal("devnet"),
  commitmentType: z.literal(DECISION_ANCHOR_COMMITMENT_TYPE),
  receipt: z.object({
    schemaVersion: z.literal(DECISION_RECEIPT_SCHEMA_VERSION),
    hash: sha256Schema
  }).strict(),
  ledgerHead: z.object({
    hashSchemaVersion: z.literal(2),
    sequence: z.number().int().positive().safe(),
    hash: sha256Schema
  }).strict()
}).strict();

export type DecisionAnchorMemoPayload = z.infer<typeof decisionAnchorMemoPayloadSchema>;

const decisionAnchorIntentBodySchema = z.object({
  schemaVersion: z.literal(DECISION_ANCHOR_SCHEMA_VERSION),
  intentType: z.literal("samaritan_unsigned_solana_memo_transaction_intent"),
  network: z.literal("devnet"),
  transaction: z.object({
    format: z.literal("legacy"),
    feePayer: z.literal("supplied_only_at_submit"),
    recentBlockhash: z.literal("fetched_only_at_submit"),
    signatures: z.literal("none"),
    instructionCount: z.literal(1)
  }).strict(),
  instruction: z.object({
    programId: z.literal(SOLANA_MEMO_PROGRAM_ID),
    keys: z.array(z.string()).max(0),
    dataEncoding: z.literal("utf8"),
    data: z.string().min(1)
  }).strict(),
  commitment: decisionAnchorMemoPayloadSchema,
  preparation: z.object({
    offline: z.literal(true),
    signerAccessed: z.literal(false),
    networkAccessed: z.literal(false)
  }).strict()
}).strict();

export const decisionAnchorIntentSchema = decisionAnchorIntentBodySchema.extend({
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.literal("samaritan-stable-json-v1"),
    domain: z.literal(DECISION_ANCHOR_INTENT_HASH_DOMAIN),
    intentHash: sha256Schema
  }).strict()
}).strict();

export type DecisionAnchorIntent = z.infer<typeof decisionAnchorIntentSchema>;

export function assertDevnetOnly(network: string): asserts network is "devnet" {
  if (network !== "devnet") {
    throw new Error(
      `Solana decision anchoring is devnet-only; ${network || "an empty network"} is forbidden`
    );
  }
}

export function buildDecisionAnchorMemoPayload(
  receiptValue: unknown,
  network = "devnet"
): DecisionAnchorMemoPayload {
  assertDevnetOnly(network);
  verifyDecisionReceipt(receiptValue);
  const receipt = decisionReceiptSchema.parse(receiptValue);
  return decisionAnchorMemoPayloadSchema.parse({
    schemaVersion: DECISION_ANCHOR_SCHEMA_VERSION,
    anchorType: "samaritan_decision_receipt_anchor",
    network,
    commitmentType: DECISION_ANCHOR_COMMITMENT_TYPE,
    receipt: {
      schemaVersion: receipt.schemaVersion,
      hash: receipt.integrity.receiptHash
    },
    ledgerHead: {
      hashSchemaVersion: 2,
      sequence: receipt.ledger.finalHeadSequence,
      hash: receipt.ledger.finalHeadHash
    }
  });
}

export function canonicalDecisionAnchorMemo(payloadValue: unknown): string {
  const payload = decisionAnchorMemoPayloadSchema.parse(payloadValue);
  const memo = `${DECISION_ANCHOR_MEMO_DOMAIN}\n${stableJson(payload)}`;
  const bytes = Buffer.byteLength(memo, "utf8");
  if (bytes > SOLANA_MEMO_MAX_BYTES) {
    throw new Error(`Decision anchor memo is ${bytes} bytes; maximum is ${SOLANA_MEMO_MAX_BYTES}`);
  }
  return memo;
}

export function parseCanonicalDecisionAnchorMemo(memo: string): DecisionAnchorMemoPayload {
  const prefix = `${DECISION_ANCHOR_MEMO_DOMAIN}\n`;
  if (!memo.startsWith(prefix)) throw new Error("Solana memo has the wrong Samaritan domain");
  let parsed: unknown;
  try {
    parsed = JSON.parse(memo.slice(prefix.length)) as unknown;
  } catch {
    throw new Error("Solana memo payload is not valid JSON");
  }
  const payload = decisionAnchorMemoPayloadSchema.parse(parsed);
  if (canonicalDecisionAnchorMemo(payload) !== memo) {
    throw new Error("Solana memo payload is valid but not canonically encoded");
  }
  return payload;
}

function hashIntentBody(body: z.infer<typeof decisionAnchorIntentBodySchema>): string {
  return sha256(`${DECISION_ANCHOR_INTENT_HASH_DOMAIN}\n${stableJson(body)}`);
}

/**
 * Builds a deterministic unsigned transaction intent. This function does not
 * construct or read a signer, request a blockhash, or make an RPC call.
 */
export function buildDecisionAnchorIntent(
  receiptValue: unknown,
  network = "devnet"
): DecisionAnchorIntent {
  const commitment = buildDecisionAnchorMemoPayload(receiptValue, network);
  const memo = canonicalDecisionAnchorMemo(commitment);
  const body = decisionAnchorIntentBodySchema.parse({
    schemaVersion: DECISION_ANCHOR_SCHEMA_VERSION,
    intentType: "samaritan_unsigned_solana_memo_transaction_intent",
    network: commitment.network,
    transaction: {
      format: "legacy",
      feePayer: "supplied_only_at_submit",
      recentBlockhash: "fetched_only_at_submit",
      signatures: "none",
      instructionCount: 1
    },
    instruction: {
      programId: SOLANA_MEMO_PROGRAM_ID,
      keys: [],
      dataEncoding: "utf8",
      data: memo
    },
    commitment,
    preparation: {
      offline: true,
      signerAccessed: false,
      networkAccessed: false
    }
  });
  return decisionAnchorIntentSchema.parse({
    ...body,
    integrity: {
      algorithm: "sha256",
      canonicalization: "samaritan-stable-json-v1",
      domain: DECISION_ANCHOR_INTENT_HASH_DOMAIN,
      intentHash: hashIntentBody(body)
    }
  });
}

export function verifyDecisionAnchorIntent(
  intentValue: unknown,
  receiptValue: unknown
): DecisionAnchorIntent {
  assertDevnetOnly(
    typeof intentValue === "object" && intentValue !== null && "network" in intentValue
      ? String(intentValue.network)
      : ""
  );
  const intent = decisionAnchorIntentSchema.parse(intentValue);
  const { integrity: _integrity, ...bodyValue } = intent;
  const body = decisionAnchorIntentBodySchema.parse(bodyValue);
  if (intent.integrity.intentHash !== hashIntentBody(body)) {
    throw new Error("Decision anchor intent canonical hash mismatch");
  }
  const expected = buildDecisionAnchorIntent(receiptValue, "devnet");
  if (stableJson(intent) !== stableJson(expected)) {
    throw new Error("Decision anchor intent does not match the supplied decision receipt");
  }
  const memoPayload = parseCanonicalDecisionAnchorMemo(intent.instruction.data);
  if (stableJson(memoPayload) !== stableJson(intent.commitment)) {
    throw new Error("Decision anchor instruction and commitment payload differ");
  }
  return intent;
}

export function buildDecisionAnchorInstruction(intentValue: unknown): TransactionInstruction {
  const intent = decisionAnchorIntentSchema.parse(intentValue);
  assertDevnetOnly(intent.network);
  parseCanonicalDecisionAnchorMemo(intent.instruction.data);
  return new TransactionInstruction({
    keys: [],
    programId: new PublicKey(SOLANA_MEMO_PROGRAM_ID),
    data: Buffer.from(intent.instruction.data, "utf8")
  });
}

export type DecisionAnchorReadRpc = {
  getGenesisHash(): Promise<string>;
  getParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null>;
};

function memoText(
  instruction: ParsedInstruction | PartiallyDecodedInstruction
): string | null {
  if (!instruction.programId.equals(new PublicKey(SOLANA_MEMO_PROGRAM_ID))) return null;
  if (!("parsed" in instruction)) {
    throw new Error("Solana RPC returned an undecoded Memo instruction");
  }
  if (typeof instruction.parsed === "string") return instruction.parsed;
  if (
    typeof instruction.parsed === "object" &&
    instruction.parsed !== null &&
    "memo" in instruction.parsed &&
    typeof instruction.parsed.memo === "string"
  ) return instruction.parsed.memo;
  throw new Error("Solana RPC returned an unsupported parsed Memo instruction");
}

export type DecisionAnchorNetworkVerification = {
  schemaVersion: typeof DECISION_ANCHOR_SCHEMA_VERSION;
  verificationType: "samaritan_solana_decision_anchor_verification";
  network: "devnet";
  genesisHash: typeof SOLANA_DEVNET_GENESIS_HASH;
  transactionSignature: string;
  slot: number;
  blockTimeTsMs: number | null;
  rpcCommitment: "confirmed";
  memoProgramId: typeof SOLANA_MEMO_PROGRAM_ID;
  commitmentType: typeof DECISION_ANCHOR_COMMITMENT_TYPE;
  receiptSchemaVersion: typeof DECISION_RECEIPT_SCHEMA_VERSION;
  receiptHash: string;
  ledgerHeadSequence: number;
  ledgerHeadHash: string;
  assurance: [
    "devnet_genesis_hash_verified",
    "transaction_succeeded_at_confirmed_commitment",
    "canonical_memo_matches_receipt_and_ledger_head"
  ];
};

/**
 * Performs only Solana read calls. It does not sign, send, persist, or mutate
 * either the receipt or an anchor sidecar.
 */
export async function verifyDecisionAnchorOnChain(input: {
  receipt: unknown;
  signature: string;
  network: string;
  rpc: DecisionAnchorReadRpc;
}): Promise<DecisionAnchorNetworkVerification> {
  assertDevnetOnly(input.network);
  const signature = signatureSchema.parse(input.signature);
  verifyDecisionReceipt(input.receipt);
  const receipt: DecisionReceipt = decisionReceiptSchema.parse(input.receipt);
  const genesisHash = await input.rpc.getGenesisHash();
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(
      `Solana RPC network mismatch: expected devnet genesis ${SOLANA_DEVNET_GENESIS_HASH}, received ${genesisHash}`
    );
  }
  const transaction = await input.rpc.getParsedTransaction(signature);
  if (!transaction) throw new Error(`Solana transaction ${signature} was not found at confirmed commitment`);
  if (!transaction.transaction.signatures.includes(signature)) {
    throw new Error("Solana RPC transaction does not contain the requested signature");
  }
  if (!transaction.meta) throw new Error("Solana transaction metadata is unavailable");
  if (transaction.meta.err !== null) throw new Error("Solana anchor transaction failed on-chain");

  const memos = transaction.transaction.message.instructions
    .map(memoText)
    .filter((value): value is string => value !== null);
  if (memos.length !== 1) {
    throw new Error(`Expected exactly one Solana Memo instruction, found ${memos.length}`);
  }
  const payload = parseCanonicalDecisionAnchorMemo(memos[0]!);
  if (payload.network !== input.network) throw new Error("Solana memo commits the wrong network");
  if (payload.receipt.schemaVersion !== receipt.schemaVersion) {
    throw new Error("Solana memo commits the wrong decision receipt schema version");
  }
  if (payload.receipt.hash !== receipt.integrity.receiptHash) {
    throw new Error("Solana memo receipt hash does not match the supplied receipt");
  }
  if (
    payload.ledgerHead.sequence !== receipt.ledger.finalHeadSequence ||
    payload.ledgerHead.hash !== receipt.ledger.finalHeadHash
  ) {
    throw new Error("Solana memo ledger head does not match the supplied receipt");
  }

  const blockTimeTsMs = transaction.blockTime === null || transaction.blockTime === undefined
    ? null
    : transaction.blockTime * 1_000;
  return {
    schemaVersion: DECISION_ANCHOR_SCHEMA_VERSION,
    verificationType: "samaritan_solana_decision_anchor_verification",
    network: "devnet",
    genesisHash: SOLANA_DEVNET_GENESIS_HASH,
    transactionSignature: signature,
    slot: transaction.slot,
    blockTimeTsMs,
    rpcCommitment: "confirmed",
    memoProgramId: SOLANA_MEMO_PROGRAM_ID,
    commitmentType: DECISION_ANCHOR_COMMITMENT_TYPE,
    receiptSchemaVersion: receipt.schemaVersion,
    receiptHash: receipt.integrity.receiptHash,
    ledgerHeadSequence: receipt.ledger.finalHeadSequence,
    ledgerHeadHash: receipt.ledger.finalHeadHash,
    assurance: [
      "devnet_genesis_hash_verified",
      "transaction_succeeded_at_confirmed_commitment",
      "canonical_memo_matches_receipt_and_ledger_head"
    ]
  };
}
