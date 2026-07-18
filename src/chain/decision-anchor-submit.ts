import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  Transaction,
  clusterApiUrl,
  type ParsedTransactionWithMeta,
  type Signer
} from "@solana/web3.js";
import { decisionReceiptSchema, verifyDecisionReceipt } from "../proof/decision-receipt-schema.js";
import {
  SOLANA_DEVNET_GENESIS_HASH,
  assertDevnetOnly,
  buildDecisionAnchorInstruction,
  verifyDecisionAnchorIntent,
  verifyDecisionAnchorOnChain,
  type DecisionAnchorIntent,
  type DecisionAnchorNetworkVerification,
  type DecisionAnchorReadRpc
} from "./decision-anchor.js";

export const SOLANA_ANCHOR_SIGNER_PATH_ENV = "SAMARITAN_SOLANA_ANCHOR_KEYPAIR_PATH" as const;
export const SOLANA_ANCHOR_RPC_URL_ENV = "SAMARITAN_SOLANA_DEVNET_RPC_URL" as const;

export type DecisionAnchorSubmitRpc = DecisionAnchorReadRpc & {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(rawTransaction: Buffer): Promise<string>;
  confirmTransaction(input: {
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }): Promise<{ value: { err: unknown | null } }>;
};

export type DecisionAnchorSubmitDependencies = {
  assertSignerPathIgnored(path: string): void | Promise<void>;
  connect(rpcUrl: string): DecisionAnchorSubmitRpc;
  loadSigner(path: string): Signer | Promise<Signer>;
  signAndSend(input: {
    rpc: DecisionAnchorSubmitRpc;
    signer: Signer;
    intent: DecisionAnchorIntent;
  }): Promise<string>;
};

export type DecisionAnchorSubmitRequest = {
  receipt: unknown;
  intent: unknown;
  network: string;
  confirmedReceiptHash: string;
  signerPath?: string;
  humanApproved: boolean;
  rpcUrl?: string;
};

function checkedRpcUrl(value: string | undefined): string {
  const rpcUrl = value ?? clusterApiUrl("devnet");
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("Solana RPC URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Solana RPC URL must use http or https");
  }
  return rpcUrl;
}

export function authorizeDecisionAnchorSubmission(input: DecisionAnchorSubmitRequest): {
  receiptHash: string;
  signerPath: string;
  rpcUrl: string;
  intent: DecisionAnchorIntent;
} {
  assertDevnetOnly(input.network);
  if (!input.humanApproved) {
    throw new Error("Human approval is required: pass the explicit devnet write approval flag");
  }
  if (!input.signerPath?.trim()) {
    throw new Error(
      `A signer path is required via --signer or ${SOLANA_ANCHOR_SIGNER_PATH_ENV}`
    );
  }
  verifyDecisionReceipt(input.receipt);
  const receipt = decisionReceiptSchema.parse(input.receipt);
  if (input.confirmedReceiptHash !== receipt.integrity.receiptHash) {
    throw new Error("Exact receipt-hash confirmation does not match the supplied receipt");
  }
  const intent = verifyDecisionAnchorIntent(input.intent, receipt);
  return {
    receiptHash: receipt.integrity.receiptHash,
    signerPath: resolve(input.signerPath),
    rpcUrl: checkedRpcUrl(input.rpcUrl),
    intent
  };
}

/**
 * The only write-capable entry point. Every fail-closed authorization check,
 * ignored-path check, and RPC genesis check runs before the signer is read.
 */
export async function submitDecisionAnchor(
  input: DecisionAnchorSubmitRequest,
  dependencies: DecisionAnchorSubmitDependencies
): Promise<DecisionAnchorNetworkVerification> {
  const authorized = authorizeDecisionAnchorSubmission(input);
  await dependencies.assertSignerPathIgnored(authorized.signerPath);
  const rpc = dependencies.connect(authorized.rpcUrl);
  const genesisHash = await rpc.getGenesisHash();
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(
      `Solana RPC network mismatch: anchor submission refuses genesis ${genesisHash}`
    );
  }
  const signer = await dependencies.loadSigner(authorized.signerPath);
  const signature = await dependencies.signAndSend({
    rpc,
    signer,
    intent: authorized.intent
  });
  try {
    return await verifyDecisionAnchorOnChain({
      receipt: input.receipt,
      signature,
      network: "devnet",
      rpc
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Anchor transaction ${signature} was submitted; post-submit verification failed: ${message}. ` +
      "Verify this signature before any retry."
    );
  }
}

function assertSignerPathIsGitIgnored(path: string): void {
  const result = spawnSync("git", ["check-ignore", "-q", "--", path], {
    cwd: process.cwd(),
    stdio: "ignore"
  });
  if (result.status !== 0) {
    throw new Error(
      "Signer path is not covered by this repository's .gitignore; place it under .wallet/"
    );
  }
}

function loadSolanaKeypair(path: string): Keypair {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new Error("Signer file must contain a Solana 64-byte secret-key JSON array");
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function createDecisionAnchorSubmitRpc(rpcUrl: string): DecisionAnchorSubmitRpc {
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  return {
    getGenesisHash: () => connection.getGenesisHash(),
    getParsedTransaction: (signature: string): Promise<ParsedTransactionWithMeta | null> =>
      connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      }),
    getLatestBlockhash: () => connection.getLatestBlockhash("confirmed"),
    sendRawTransaction: (rawTransaction: Buffer) => connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3
    }),
    confirmTransaction: async (confirmation) => {
      const result = await connection.confirmTransaction(confirmation, "confirmed");
      return { value: { err: result.value.err } };
    }
  };
}

async function signAndSendDecisionAnchor(input: {
  rpc: DecisionAnchorSubmitRpc;
  signer: Signer;
  intent: DecisionAnchorIntent;
}): Promise<string> {
  const latestBlockhash = await input.rpc.getLatestBlockhash();
  const transaction = new Transaction({
    feePayer: input.signer.publicKey,
    recentBlockhash: latestBlockhash.blockhash
  }).add(buildDecisionAnchorInstruction(input.intent));
  transaction.sign(input.signer);
  const signature = await input.rpc.sendRawTransaction(transaction.serialize());
  let confirmation: { value: { err: unknown | null } };
  try {
    confirmation = await input.rpc.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Solana returned anchor signature ${signature}, but confirmation failed: ${message}. ` +
      "Verify this signature before any retry."
    );
  }
  if (confirmation.value.err !== null) {
    throw new Error(`Solana anchor transaction ${signature} failed during confirmation`);
  }
  return signature;
}

const defaultDecisionAnchorSubmitDependencies: DecisionAnchorSubmitDependencies = {
  assertSignerPathIgnored: assertSignerPathIsGitIgnored,
  connect: createDecisionAnchorSubmitRpc,
  loadSigner: loadSolanaKeypair,
  signAndSend: signAndSendDecisionAnchor
};

/** Production wrapper: callers cannot reach the signer/send backend without the guards. */
export function submitDecisionAnchorWithDefaultDependencies(
  input: DecisionAnchorSubmitRequest
): Promise<DecisionAnchorNetworkVerification> {
  return submitDecisionAnchor(input, defaultDecisionAnchorSubmitDependencies);
}
