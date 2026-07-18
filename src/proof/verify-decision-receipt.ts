#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyDecisionReceipt } from "./decision-receipt-schema.js";

function usage(): never {
  throw new Error("Usage: pnpm receipt:verify -- <decision-receipt.json>");
}

function main(): void {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length !== 1 || !args[0]) usage();
  const path = resolve(args[0]);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const result = verifyDecisionReceipt(parsed);
  process.stdout.write(`${JSON.stringify({
    file: path,
    ...result,
    note: "Offline verification only: no Solana RPC or source API was queried."
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Decision receipt verification failed: ${message}\n`);
  process.exitCode = 1;
}
