#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDecisionAnchorIntent } from "./decision-anchor.js";

function usage(): never {
  throw new Error(
    "Usage: pnpm anchor:prepare -- <decision-receipt.json> [--network devnet]"
  );
}

function main(): void {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const receiptArgument = args[0];
  if (!receiptArgument || receiptArgument.startsWith("--")) usage();
  let network = "devnet";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--network") {
      const value = args[index + 1];
      if (!value) usage();
      network = value;
      index += 1;
      continue;
    }
    usage();
  }
  const receiptPath = resolve(receiptArgument);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as unknown;
  const intent = buildDecisionAnchorIntent(receipt, network);
  process.stdout.write(`${JSON.stringify(intent, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Decision anchor preparation failed: ${message}\n`);
  process.exitCode = 1;
}
