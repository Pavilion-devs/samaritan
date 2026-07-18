#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOLANA_ANCHOR_RPC_URL_ENV,
  SOLANA_ANCHOR_SIGNER_PATH_ENV,
  submitDecisionAnchorWithDefaultDependencies
} from "./decision-anchor-submit.js";

type SubmitCliArguments = {
  receiptPath: string;
  intentPath: string;
  network: string;
  confirmedReceiptHash: string;
  signerPath?: string;
  rpcUrl?: string;
  humanApproved: boolean;
};

function usage(): never {
  throw new Error(
    "Usage: pnpm anchor:submit -- --receipt <receipt.json> --intent <intent.json> " +
    "--network devnet --confirm-receipt-hash <64-hex> --approve-devnet-write " +
    `[--signer <ignored-keypair.json>] [--rpc-url <devnet-rpc>] (signer env: ${SOLANA_ANCHOR_SIGNER_PATH_ENV})`
  );
}

function parseArguments(): SubmitCliArguments {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const values = new Map<string, string>();
  let humanApproved = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--approve-devnet-write") {
      humanApproved = true;
      continue;
    }
    if (!argument?.startsWith("--")) usage();
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(argument, value);
    index += 1;
  }
  const receiptPath = values.get("--receipt");
  const intentPath = values.get("--intent");
  const network = values.get("--network");
  const confirmedReceiptHash = values.get("--confirm-receipt-hash");
  if (!receiptPath || !intentPath || !network || !confirmedReceiptHash) usage();
  const known = new Set([
    "--receipt",
    "--intent",
    "--network",
    "--confirm-receipt-hash",
    "--signer",
    "--rpc-url"
  ]);
  if ([...values.keys()].some((key) => !known.has(key))) usage();
  const signerPath = values.get("--signer") ?? process.env[SOLANA_ANCHOR_SIGNER_PATH_ENV];
  const rpcUrl = values.get("--rpc-url") ?? process.env[SOLANA_ANCHOR_RPC_URL_ENV];
  return {
    receiptPath: resolve(receiptPath),
    intentPath: resolve(intentPath),
    network,
    confirmedReceiptHash,
    ...(signerPath === undefined ? {} : { signerPath }),
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
    humanApproved
  };
}

async function main(): Promise<void> {
  const args = parseArguments();
  const receipt = JSON.parse(readFileSync(args.receiptPath, "utf8")) as unknown;
  const intent = JSON.parse(readFileSync(args.intentPath, "utf8")) as unknown;
  const result = await submitDecisionAnchorWithDefaultDependencies({
    receipt,
    intent,
    network: args.network,
    confirmedReceiptHash: args.confirmedReceiptHash,
    humanApproved: args.humanApproved,
    ...(args.signerPath === undefined ? {} : { signerPath: args.signerPath }),
    ...(args.rpcUrl === undefined ? {} : { rpcUrl: args.rpcUrl })
  });
  process.stdout.write(`${JSON.stringify({
    ...result,
    note: "Devnet write completed after explicit human approval; the source receipt was not modified."
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Decision anchor submission failed: ${message}\n`);
  process.exitCode = 1;
}
