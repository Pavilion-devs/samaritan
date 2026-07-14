import { CLAUDE_MODEL, CLAUDE_PRICING } from "../agents/claude-pricing.js";
import { DecisionLedger, type DecisionEventKind } from "../store/decision-ledger.js";
import {
  generateDecisionReceipt,
  sourceEvidenceCommitment
} from "./decision-receipt.js";
import {
  receiptReferenceHash,
  sha256,
  type DecisionReceipt,
  type ReceiptAgentRun
} from "./decision-receipt-schema.js";

const BASE_TS_MS = 1_700_000_000_000;
const CASE_ID = "synthetic-case-receipt-v1";
const SIGNAL_ID = "synthetic-signal-receipt-v1";
const FIXTURE_ID = "synthetic-fixture-receipt-v1";
const MARKET_KEY = `${FIXTURE_ID}:total_goals:full_time:2500`;
const CONDITION_ID = "synthetic-condition-v1";
const ASSET_ID = "synthetic-over-asset-v1";

function append(
  ledger: DecisionLedger,
  sequence: number,
  kind: DecisionEventKind,
  atTsMs: number,
  payload: Parameters<DecisionLedger["append"]>[0]["payload"]
): void {
  ledger.append({
    entryId: `${CASE_ID}:${sequence}:${kind}`,
    caseId: CASE_ID,
    kind,
    atTsMs,
    insertedAtMs: atTsMs + 10,
    payload
  });
}

function syntheticRun(stage: "triage" | "analyst"): ReceiptAgentRun {
  const model = stage === "triage" ? CLAUDE_MODEL.triage : CLAUDE_MODEL.analyst;
  const pricing = CLAUDE_PRICING[model];
  return {
    stage,
    invocationClass: "synthetic_stub",
    model,
    promptVersion: stage === "triage" ? "triage-v1" : "analyst-v1",
    promptSha256: sha256(`synthetic:${stage}:prompt`),
    responseSha256: sha256(`synthetic:${stage}:response`),
    billingEvidenceRefSha256: receiptReferenceHash("synthetic_billing", stage),
    status: "success",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0
    },
    pricing: {
      pricingVersion: "anthropic-public-2026-07-12",
      currency: "nano_usd",
      inputNanoUsdPerToken: pricing.inputNanoUsdPerToken,
      outputNanoUsdPerToken: pricing.outputNanoUsdPerToken,
      cacheWriteNanoUsdPerToken: pricing.cacheWriteNanoUsdPerToken,
      cacheReadNanoUsdPerToken: pricing.cacheReadNanoUsdPerToken
    },
    actualCostNanoUsd: 0
  };
}

/**
 * Deterministic proving fixture. It is synthetic, invokes no external model,
 * venue, API, wallet, or chain, and is permanently excluded from performance.
 */
export function buildSyntheticDecisionReceipt(): DecisionReceipt {
  const ledger = new DecisionLedger(":memory:");
  try {
    ledger.append({
      entryId: "synthetic-study-initialized-v1",
      caseId: "synthetic-study",
      kind: "study_initialized",
      atTsMs: BASE_TS_MS - 1_000,
      insertedAtMs: BASE_TS_MS - 990,
      payload: {
        protocolVersion: "synthetic-proof-only-v1",
        configHash: sha256("synthetic-config-v1"),
        realMoneyGate: "closed",
        performanceEligible: false
      }
    });

    const averageEntryPrice = 2.93 / 5.5;
    const unitCost = 3 / 5.5;
    append(ledger, 1, "signal_received", BASE_TS_MS, {
      lane: "bounty",
      signal: {
        signalId: SIGNAL_ID,
        kind: "CONSENSUS_MOVE",
        detectedAtTsMs: BASE_TS_MS,
        observedAtTsMs: BASE_TS_MS,
        fixtureId: FIXTURE_ID,
        market: {
          family: "total_goals",
          period: "full_time",
          lineMilli: 2_500,
          key: MARKET_KEY
        },
        outcome: "over",
        direction: "buy",
        eligibility: "pretrade_review_required",
        reason: "Synthetic proving signal; never a performance observation.",
        evidence: {
          consensusProbability: 0.55,
          polymarketProbability: 0.52,
          consensusVelocity: 0.01,
          consensusZScore: 1.5,
          polymarketVelocity: 0,
          polymarketZScore: 0,
          cusumUp: 0.002,
          cusumDown: 0,
          rawGap: 0.03,
          gapBasis: "live_book",
          persistenceMs: 60_000,
          mappingStatus: "verified",
          scoreContextActions: []
        }
      }
    });
    append(ledger, 2, "triage_decision", BASE_TS_MS + 100, {
      decision: "escalate",
      priority: "normal",
      rationale: "Synthetic evidence satisfies the proving-fixture escalation path."
    });
    append(ledger, 3, "thesis_submitted", BASE_TS_MS + 300, {
      schemaVersion: 1,
      signalId: SIGNAL_ID,
      fixtureId: FIXTURE_ID,
      marketKey: MARKET_KEY,
      outcome: "over",
      direction: "buy",
      recommendation: "paper_trade",
      fairProbability: 0.55,
      thesisSummary: "Synthetic consensus movement remains ahead of the synthetic paper book.",
      evidenceFor: ["The synthetic executable gap exceeds the frozen proving threshold."],
      steelmanAgainst: "The synthetic movement could reverse before the synthetic cutoff.",
      invalidationConditions: ["The synthetic ask reaches the deterministic limit."],
      submittedAtTsMs: BASE_TS_MS + 300,
      expiresAtTsMs: BASE_TS_MS + 900_300,
      analystModel: CLAUDE_MODEL.analyst
    });
    append(ledger, 4, "analysis_completed", BASE_TS_MS + 300, {
      signalSourceTsMs: BASE_TS_MS,
      signalObservedTsMs: BASE_TS_MS,
      decisionLatencyMs: 300,
      readyAtTsMs: BASE_TS_MS + 300,
      venuePlacementDelayMs: 1_000,
      orderEligibleAtTsMs: BASE_TS_MS + 1_300,
      recommendation: "paper_trade"
    });
    append(ledger, 5, "risk_verdict", BASE_TS_MS + 2_500, {
      decision: "approve",
      stakeMicroUsd: 3_000_000,
      limitProbability: 0.54,
      realMoneyGate: "closed"
    });
    append(ledger, 6, "execution_intent", BASE_TS_MS + 2_500, {
      lane: "bounty",
      caseId: CASE_ID,
      signalId: SIGNAL_ID,
      fixtureId: FIXTURE_ID,
      marketKey: MARKET_KEY,
      outcome: "over",
      direction: "buy",
      stakeMicroUsd: 3_000_000,
      limitProbability: 0.54,
      availableShares: 0
    });
    append(ledger, 7, "paper_execution", BASE_TS_MS + 2_500, {
      adapter: "paper",
      status: "filled",
      reason: null,
      assetId: ASSET_ID,
      conditionId: CONDITION_ID,
      direction: "buy",
      requestedStakeMicroUsd: 3_000_000,
      grossMicroUsd: 2_930_000,
      feeMicroUsd: 70_000,
      netConsiderationMicroUsd: 3_000_000,
      filledShares: 5.5,
      averagePrice: averageEntryPrice,
      bestPrice: 0.52,
      halfSpreadBps: 100,
      executableDepthUsd: 10,
      slippageProbabilityBps: (averageEntryPrice - 0.52) * 10_000,
      bookObservedTsMs: BASE_TS_MS + 2_500,
      feeParameters: {
        source: "polymarket_clob_market_info",
        conditionId: CONDITION_ID,
        feesEnabled: true,
        takerFeeRate: 0.05,
        feeCurveExponent: 1,
        takerOnly: true,
        minimumOrderSize: 5,
        minimumTickSize: 0.01,
        fetchedAtTsMs: BASE_TS_MS + 2_500
      }
    });
    append(ledger, 8, "case_terminal", BASE_TS_MS + 2_500, {
      status: "filled",
      reason: "filled"
    });
    append(ledger, 9, "position_opened", BASE_TS_MS + 2_500, {
      caseId: CASE_ID,
      lane: "bounty",
      signalId: SIGNAL_ID,
      fixtureId: FIXTURE_ID,
      marketKey: MARKET_KEY,
      conditionId: CONDITION_ID,
      assetId: ASSET_ID,
      outcome: "over",
      selectedLineMilli: 2_500,
      openedAtTsMs: BASE_TS_MS + 2_500,
      filledShares: 5.5,
      averageEntryPrice,
      entryGrossMicroUsd: 2_930_000,
      entryFeeMicroUsd: 70_000,
      entryCostMicroUsd: 3_000_000,
      fillStatus: "filled",
      entryHalfSpreadBps: 100,
      entrySlippageBps: (averageEntryPrice - 0.52) * 10_000,
      selectedDepthUsd: 10,
      status: "open",
      closeMark: null,
      settlement: null
    });
    append(ledger, 10, "position_closed", BASE_TS_MS + 5_000, {
      cutoffTsMs: BASE_TS_MS + 5_000,
      markedAtTsMs: BASE_TS_MS + 5_000,
      bookSourceTsMs: BASE_TS_MS + 4_930,
      bookObservedTsMs: BASE_TS_MS + 5_000,
      closeBid: 0.57,
      closeAsk: 0.59,
      closeMidpoint: 0.58,
      grossMidpointClvBps: (0.58 - averageEntryPrice) * 10_000,
      netMidpointClvBps: (0.58 - unitCost) * 10_000,
      executableLiquidationClvBps: (0.57 - unitCost) * 10_000
    });
    append(ledger, 11, "position_settled", BASE_TS_MS + 10_000, {
      settledAtTsMs: BASE_TS_MS + 10_000,
      won: true,
      payoutMicroUsd: 5_500_000,
      pnlMicroUsd: 2_500_000,
      returnBps: 2_500_000 / 3_000_000 * 10_000,
      entryBrier: (averageEntryPrice - 1) ** 2
    });

    const sourceEvidence = [
      sourceEvidenceCommitment({
        source: "txline",
        role: "signal",
        sourceTsMs: BASE_TS_MS - 64,
        observedAtTsMs: BASE_TS_MS,
        payload: { synthetic: true, record: "private-txline-signal-source" }
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "signal",
        sourceTsMs: BASE_TS_MS - 25,
        observedAtTsMs: BASE_TS_MS,
        payload: { synthetic: true, record: "private-polymarket-signal-source" }
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "execution",
        sourceTsMs: BASE_TS_MS + 2_436,
        observedAtTsMs: BASE_TS_MS + 2_500,
        payload: { synthetic: true, record: "private-execution-book" }
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "close",
        sourceTsMs: BASE_TS_MS + 4_930,
        observedAtTsMs: BASE_TS_MS + 5_000,
        payload: { synthetic: true, record: "private-close-book" }
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "settlement",
        sourceTsMs: BASE_TS_MS + 9_950,
        observedAtTsMs: BASE_TS_MS + 10_000,
        payload: { synthetic: true, record: "private-resolution-event" }
      })
    ];

    return generateDecisionReceipt({
      ledger,
      caseId: CASE_ID,
      context: {
        generatedAtTsMs: BASE_TS_MS + 11_000,
        provenance: {
          evidenceClass: "synthetic_proving_fixture",
          synthetic: true,
          performanceUse: "excluded_synthetic",
          label: "SYNTHETIC PROVING FIXTURE — no real match, feed, model call, order, fill, or performance evidence"
        },
        build: {
          codeVersion: "decision-receipt-v1-synthetic-fixture",
          codeSha256: sha256("synthetic-code-bundle-v1"),
          configSha256: sha256("synthetic-config-v1")
        },
        sourceEvidence,
        agentRuns: [syntheticRun("triage"), syntheticRun("analyst")],
        executionBookEvidenceRefSha256: sourceEvidence[2]!.evidenceRefSha256,
        closeBookEvidenceRefSha256: sourceEvidence[3]!.evidenceRefSha256,
        settlementEvidenceRefSha256: sourceEvidence[4]!.evidenceRefSha256,
        solanaAnchor: null
      }
    });
  } finally {
    ledger.close();
  }
}
