import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import type { DetectorSignal } from "../detectors/types.js";
import { ClaudeAnalystAgent, createAnthropicMessagesClient } from "./claude.js";
import { CLAUDE_MODEL } from "./claude-pricing.js";
import { ClaudeSpendLedger } from "./claude-spend-ledger.js";

loadEnvFile(resolve(process.cwd(), ".env"));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

const nowTsMs = Date.now();
const smokeSignal: DetectorSignal = {
  signalId: `claude-opus-smoke-${nowTsMs}`,
  kind: "CONSENSUS_MOVE",
  detectedAtTsMs: nowTsMs,
  observedAtTsMs: nowTsMs,
  fixtureId: "synthetic-opus-smoke-fixture",
  market: {
    family: "total_goals",
    period: "full_time",
    lineMilli: 2_500,
    key: "synthetic-opus-smoke-fixture:total_goals:full_time:2500"
  },
  outcome: "over",
  direction: "buy",
  eligibility: "research_only",
  reason: "Synthetic analyst adapter smoke with no executable fixture.",
  evidence: {
    consensusProbability: 0.55,
    polymarketProbability: 0.51,
    consensusVelocity: 0.02,
    consensusZScore: 1.2,
    polymarketVelocity: 0,
    polymarketZScore: 0,
    cusumUp: 0.001,
    cusumDown: 0,
    rawGap: 0.04,
    gapBasis: "sampled_history_proxy",
    persistenceMs: 5_000,
    mappingStatus: null,
    scoreContextActions: []
  }
};

const ledger = new ClaudeSpendLedger(resolve("data/agents/claude-spend.sqlite"));
try {
  const agent = new ClaudeAnalystAgent({
    client: createAnthropicMessagesClient(apiKey),
    spendLedger: ledger
  });
  const thesis = await agent.investigate({
    caseId: `case-${smokeSignal.signalId}`,
    signal: smokeSignal,
    asOfTsMs: nowTsMs,
    triage: {
      decision: "escalate",
      priority: "low",
      rationale: "Synthetic adapter contract verification only."
    }
  });
  const summary = ledger.summary();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    model: CLAUDE_MODEL.analyst,
    thesis,
    totalSpendNanoUsd: summary.actualCostNanoUsd,
    outstandingReservedNanoUsd: summary.outstandingReservedNanoUsd,
    spendChain: ledger.verifyChain()
  }, null, 2)}\n`);
} finally {
  ledger.close();
}
