import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import type { DetectorSignal } from "../detectors/types.js";
import { ClaudeTriageAgent, createAnthropicMessagesClient } from "./claude.js";
import { CLAUDE_MODEL } from "./claude-pricing.js";
import { ClaudeSpendLedger } from "./claude-spend-ledger.js";

loadEnvFile(resolve(process.cwd(), ".env"));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

const nowTsMs = Date.now();
const smokeSignal: DetectorSignal = {
  signalId: `claude-smoke-${nowTsMs}`,
  kind: "CONSENSUS_MOVE",
  detectedAtTsMs: nowTsMs,
  observedAtTsMs: nowTsMs,
  fixtureId: "synthetic-smoke-fixture",
  market: {
    family: "total_goals",
    period: "full_time",
    lineMilli: 2_500,
    key: "synthetic-smoke-fixture:total_goals:full_time:2500"
  },
  outcome: "over",
  direction: "buy",
  eligibility: "research_only",
  reason: "Synthetic adapter smoke; no executable market and no trade authorization.",
  evidence: {
    consensusProbability: 0.51,
    polymarketProbability: 0.51,
    consensusVelocity: 0,
    consensusZScore: 0,
    polymarketVelocity: 0,
    polymarketZScore: 0,
    cusumUp: 0,
    cusumDown: 0,
    rawGap: 0,
    gapBasis: "sampled_history_proxy",
    persistenceMs: 0,
    mappingStatus: null,
    scoreContextActions: []
  }
};

const ledger = new ClaudeSpendLedger(resolve("data/agents/claude-spend.sqlite"));
try {
  const agent = new ClaudeTriageAgent({
    client: createAnthropicMessagesClient(apiKey),
    spendLedger: ledger
  });
  const decision = await agent.triage({
    caseId: `case-${smokeSignal.signalId}`,
    signal: smokeSignal
  });
  const summary = ledger.summary();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    model: CLAUDE_MODEL.triage,
    decision,
    spendNanoUsd: summary.actualCostNanoUsd,
    outstandingReservedNanoUsd: summary.outstandingReservedNanoUsd,
    spendChain: ledger.verifyChain()
  }, null, 2)}\n`);
} finally {
  ledger.close();
}
