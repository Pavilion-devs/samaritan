#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { verifyDecisionAnchorOnChain, type DecisionAnchorReadRpc } from "./decision-anchor.js";

function usage(): never {
  throw new Error(
    "Usage: pnpm anchor:verify -- --receipt <receipt.json> --signature <signature> " +
    "--network devnet [--rpc-url <devnet-rpc>]"
  );
}

function argumentsMap(): Map<string, string> {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) usage();
    values.set(key, value);
  }
  const known = new Set(["--receipt", "--signature", "--network", "--rpc-url"]);
  if ([...values.keys()].some((key) => !known.has(key))) usage();
  return values;
}

async function main(): Promise<void> {
  const values = argumentsMap();
  const receiptArgument = values.get("--receipt");
  const signature = values.get("--signature");
  const network = values.get("--network");
  if (!receiptArgument || !signature || !network) usage();
  const receiptPath = resolve(receiptArgument);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as unknown;
  const connection = new Connection(values.get("--rpc-url") ?? clusterApiUrl("devnet"), {
    commitment: "confirmed"
  });
  const rpc: DecisionAnchorReadRpc = {
    getGenesisHash: () => connection.getGenesisHash(),
    getParsedTransaction: (transactionSignature) => connection.getParsedTransaction(
      transactionSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    )
  };
  const result = await verifyDecisionAnchorOnChain({ receipt, signature, network, rpc });
  process.stdout.write(`${JSON.stringify({
    file: receiptPath,
    ...result,
    note: "Read-only Solana verification; no receipt, sidecar, wallet, or network state was modified."
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Decision anchor verification failed: ${message}\n`);
  process.exitCode = 1;
}
