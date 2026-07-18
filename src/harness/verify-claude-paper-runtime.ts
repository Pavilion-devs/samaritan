import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { ClaudeInvocationEvidenceLedger } from "../agents/claude-evidence-ledger.js";
import { ClaudeSpendLedger } from "../agents/claude-spend-ledger.js";
import { PolymarketClobFeeResolver } from "../ingest/polymarket/fees.js";
import { createPersistentClaudePaperStudy } from "./claude-paper-study.js";
import type { PaperFixtureUniverse } from "./paper-fixture-universe.js";
import {
  PAPER_STUDY_FROZEN_CONFIG_SHA256,
  PAPER_STUDY_PROTOCOL_STATUS,
  PAPER_STUDY_PROTOCOL_VERSION,
  initializePaperStudyLedger
} from "./paper-study-ledger.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

if (PAPER_STUDY_PROTOCOL_STATUS !== ("registered" as string)) {
  throw new Error(
    `Claude paper runtime is disabled: protocol status is ${PAPER_STUDY_PROTOCOL_STATUS}. ` +
    "Deborah must register the corrected paper protocol before any model spend or study admission."
  );
}

loadEnvFile(resolve(argument("env", ".env")));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

const manifest = JSON.parse(await readFile(resolve(
  argument("manifest", "data/paper/v2/study-ledgers.json")
), "utf8")) as {
  protocolVersion: string;
  protocolStatus: string;
  configHash: string;
  realMoneyGate: string;
  bounty: { path: string; startedAtTsMs: number };
  longRun: { path: string; startedAtTsMs: number };
};
if (
  manifest.protocolVersion !== PAPER_STUDY_PROTOCOL_VERSION ||
  manifest.protocolStatus !== PAPER_STUDY_PROTOCOL_STATUS ||
  manifest.configHash !== PAPER_STUDY_FROZEN_CONFIG_SHA256 ||
  manifest.realMoneyGate !== "closed"
) {
  throw new Error("Claude paper runtime requires the registered v2 paper-study manifest");
}
const universe = JSON.parse(
  await readFile(resolve(argument("universe", "data/paper/v2/fixture-universe.json")), "utf8")
) as PaperFixtureUniverse;
const bounty = initializePaperStudyLedger({
  path: resolve(manifest.bounty.path),
  lane: "bounty",
  startedAtTsMs: manifest.bounty.startedAtTsMs
});
const longRun = initializePaperStudyLedger({
  path: resolve(manifest.longRun.path),
  lane: "long_run",
  startedAtTsMs: manifest.longRun.startedAtTsMs
});
const spendLedger = new ClaudeSpendLedger(resolve(
  argument("spend-ledger", "data/paper/v2/agents/claude-spend.sqlite")
));
const evidenceLedger = new ClaudeInvocationEvidenceLedger(
  resolve(argument(
    "invocation-evidence-ledger",
    "data/paper/v2/agents/claude-invocation-evidence.sqlite"
  ))
);
try {
  const spendBefore = spendLedger.verifyChain();
  const evidenceBefore = evidenceLedger.verifyChain();
  const feeResolver = new PolymarketClobFeeResolver();
  const study = createPersistentClaudePaperStudy({
    apiKey,
    spendLedger,
    bounty,
    longRun,
    universe,
    feeResolver: (book) => feeResolver.resolve(book),
    evidenceLedger,
    maximumPendingMs: 5 * 60_000
  });
  const spendAfter = spendLedger.verifyChain();
  if (spendAfter.rows !== spendBefore.rows || spendAfter.headHash !== spendBefore.headHash) {
    throw new Error("Claude runtime readiness unexpectedly changed the spend ledger");
  }
  const evidenceAfter = study.invocationEvidence?.verifyChain();
  if (!evidenceAfter) throw new Error("Claude runtime readiness lacks persistent invocation evidence");
  if (
    evidenceAfter.rows !== evidenceBefore.rows ||
    evidenceAfter.headHash !== evidenceBefore.headHash
  ) {
    throw new Error("Claude runtime readiness unexpectedly changed the invocation-evidence ledger");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    realMoneyGate: "closed",
    apiKeyConfigured: true,
    apiRequestsPerformed: 0,
    spendChain: spendAfter,
    invocationEvidenceChain: evidenceAfter,
    bounty: {
      decisionChain: bounty.ledger.verifyChain(),
      eligibleFixtures: study.bounty.fixtures.map((fixture) => fixture.fixtureId)
    },
    longRun: {
      decisionChain: longRun.ledger.verifyChain(),
      eligibleFixtures: study.longRun.fixtures.map((fixture) => fixture.fixtureId)
    }
  }, null, 2)}\n`);
} finally {
  try {
    evidenceLedger.verifyChain();
  } finally {
    evidenceLedger.close();
    bounty.ledger.close();
    longRun.ledger.close();
    spendLedger.close();
  }
}
