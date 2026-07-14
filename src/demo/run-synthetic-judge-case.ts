#!/usr/bin/env node
import { runSyntheticJudgeCase } from "./synthetic-judge-case.js";

try {
  const report = await runSyntheticJudgeCase();
  const { receipt, ...summary } = report;
  process.stdout.write(`${JSON.stringify({
    ...summary,
    receiptCommitment: {
      receiptId: receipt.receiptId,
      receiptHash: receipt.integrity.receiptHash,
      committedLedgerHead: receipt.ledger.finalHeadHash,
      lifecycleStatus: receipt.lifecycle.finalStatus,
      disclosure: receipt.disclosure,
      solanaAnchor: receipt.solanaAnchor
    }
  }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`SYNTHETIC JUDGE CASE FAILED: ${message}\n`);
  process.exitCode = 1;
}
