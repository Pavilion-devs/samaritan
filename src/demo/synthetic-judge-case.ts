import { CLAUDE_MODEL, CLAUDE_PRICING } from "../agents/claude-pricing.js";
import type { AnalystAgent, TriageAgent } from "../agents/contracts.js";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalEvent,
  type CanonicalMarket,
  type OddsQuoteEvent,
  type PolymarketBookEvent,
  type PolymarketResolutionEvent
} from "../bus/events.js";
import { PAPER_STUDY_TOTAL_SELECTOR_CONFIG } from "../config/paper-study.js";
import { probability } from "../domain/probability.js";
import type { PolymarketFeeParameters } from "../exec/paper.js";
import { createPersistentPaperLaneRuntime } from "../harness/paper-lane-runtime.js";
import type { PaperFixtureUniverse } from "../harness/paper-fixture-universe.js";
import type { PaperRuntimeBatch } from "../harness/paper-runtime.js";
import { runPaperSession } from "../harness/paper-session.js";
import { initializePaperStudyLedger } from "../harness/paper-study-ledger.js";
import {
  generateDecisionReceipt,
  hashJsonEvidence,
  sourceEvidenceCommitment
} from "../proof/decision-receipt.js";
import {
  receiptReferenceHash,
  sha256,
  verifyDecisionReceipt,
  type DecisionReceipt,
  type DecisionReceiptVerification,
  type ReceiptAgentRun
} from "../proof/decision-receipt-schema.js";

const BASE_TS_MS = Date.UTC(2026, 6, 1, 0, 0, 0);
const FIXTURE_ID = "synthetic-judge-fixture-v1";
const CONDITION_ID = "synthetic-judge-condition-v1";
const OVER_ASSET_ID = "synthetic-judge-over-asset-v1";
const UNDER_ASSET_ID = "synthetic-judge-under-asset-v1";
const LINE_MILLI = 2_500;
const DECISION_LATENCY_MS = 300;
const MAXIMUM_PENDING_MS = 60_000;
const KICKOFF_TS_MS = BASE_TS_MS + 4 * 60 * 60_000;
const DEMO_PROCESSING_TS_MS = Date.UTC(2026, 6, 14, 10, 0, 0);
const DEMO_RECEIPT_GENERATED_AT_TS_MS = DEMO_PROCESSING_TS_MS + 60_000;

const MARKET: CanonicalMarket = Object.freeze({
  family: "total_goals",
  period: "full_time",
  lineMilli: LINE_MILLI,
  key: `${FIXTURE_ID}:total_goals:full_time:${LINE_MILLI}`
});

const LABEL =
  "SYNTHETIC JUDGE CASE — no real match, licensed feed record, external model call, venue order, wallet, network request, or performance evidence";

type SyntheticBoundaryAudit = {
  triageStubCalls: number;
  analystStubCalls: number;
  anthropicCalls: 0;
  txlineApiCalls: 0;
  polymarketApiCalls: 0;
  walletCalls: 0;
  solanaRpcCalls: 0;
  realOrders: 0;
};

export type SyntheticJudgeCaseReport = {
  schemaVersion: 1;
  label: typeof LABEL;
  synthetic: true;
  performanceUse: "excluded_synthetic";
  protocolStatus: "engineering_candidate_unregistered";
  realMoneyGate: "closed";
  boundaries: SyntheticBoundaryAudit;
  runtime: {
    canonicalEventsPublished: number;
    rawSignals: number;
    normalizedSignals: number;
    routedSignals: number;
    paperExecutionStatus: "filled" | "partial";
    closeMarks: number;
    settlements: number;
    finalLifecycleStatus: "filled_settled" | "partial_settled";
    ledgerRows: number;
    ledgerHashSchemaVersions: number[];
    ledgerHeadSha256: string;
  };
  receiptVerification: DecisionReceiptVerification;
  receipt: DecisionReceipt;
};

function oddsQuote(sequence: number, tsMs: number, overProbability: number): OddsQuoteEvent {
  const underProbability = 1 - overProbability;
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "odds.quote",
    eventId: `synthetic-txline-quote-${sequence}`,
    source: "txline",
    sourceTsMs: tsMs,
    observedTsMs: tsMs + 10,
    fixtureId: FIXTURE_ID,
    sourceMessageId: `synthetic-message-${sequence}`,
    bookmaker: "SYNTHETIC_TXLINE_STABLE_PRICE",
    bookmakerId: 10021,
    inRunning: false,
    gameState: null,
    market: MARKET,
    outcomes: [
      {
        outcome: "over",
        oddsX1000: Math.round(1_000 / overProbability),
        fairProbability: probability(overProbability)
      },
      {
        outcome: "under",
        oddsX1000: Math.round(1_000 / underProbability),
        fairProbability: probability(underProbability)
      }
    ]
  };
}

function book(input: {
  id: string;
  sourceTsMs: number;
  observedTsMs: number;
  bid: number;
  ask: number;
  secondAsk?: number;
}): PolymarketBookEvent {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.book",
    eventId: input.id,
    source: "polymarket",
    sourceTsMs: input.sourceTsMs,
    observedTsMs: input.observedTsMs,
    fixtureId: FIXTURE_ID,
    market: MARKET,
    mappingStatus: "verified",
    conditionId: CONDITION_ID,
    assetId: OVER_ASSET_ID,
    outcome: "over",
    tokenRole: "canonical",
    bids: [{ price: probability(input.bid), size: "100" }],
    asks: input.secondAsk === undefined
      ? [{ price: probability(input.ask), size: "100" }]
      : [
          { price: probability(input.ask), size: "2" },
          { price: probability(input.secondAsk), size: "100" }
        ],
    lastTradePrice: probability((input.bid + input.ask) / 2),
    tickSize: "0.01"
  };
}

function resolution(): PolymarketResolutionEvent {
  const sourceTsMs = KICKOFF_TS_MS + 2 * 60 * 60_000;
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: "polymarket.resolution",
    eventId: "synthetic-polymarket-resolution",
    source: "polymarket",
    sourceTsMs,
    observedTsMs: sourceTsMs + 10,
    fixtureId: FIXTURE_ID,
    market: MARKET,
    mappingStatus: "verified",
    conditionId: CONDITION_ID,
    assetIds: [OVER_ASSET_ID, UNDER_ASSET_ID],
    winningAssetId: OVER_ASSET_ID,
    winningOutcomeLabel: "Over"
  };
}

function syntheticAgentRun(input: {
  stage: "triage" | "analyst";
  response: unknown;
}): ReceiptAgentRun {
  const model = input.stage === "triage" ? CLAUDE_MODEL.triage : CLAUDE_MODEL.analyst;
  const pricing = CLAUDE_PRICING[model];
  return {
    stage: input.stage,
    invocationClass: "synthetic_stub",
    model,
    promptVersion: `synthetic-judge-${input.stage}-v1`,
    promptSha256: sha256(`synthetic-judge:${input.stage}:fixed-prompt-v1`),
    responseSha256: hashJsonEvidence(input.response),
    billingEvidenceRefSha256: receiptReferenceHash("synthetic_billing", `judge:${input.stage}:zero`),
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

function requiredBatch<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function syntheticUniverse(laneStartTsMs: number): PaperFixtureUniverse {
  return {
    generatedAt: new Date(laneStartTsMs).toISOString(),
    laneStartTsMs,
    selectorConfig: structuredClone(PAPER_STUDY_TOTAL_SELECTOR_CONFIG),
    fixtures: [{
      fixtureId: FIXTURE_ID,
      home: "Synthetic Home",
      away: "Synthetic Away",
      kickoffTsMs: KICKOFF_TS_MS,
      eventSlugs: ["synthetic-judge-event-v1"],
      mappingStatus: "verified",
      selectedTotal: {
        marketId: "synthetic-judge-market-v1",
        marketKey: MARKET.key,
        conditionId: CONDITION_ID,
        lineMilli: LINE_MILLI,
        preKickoffOverProbability: 0.5,
        preKickoffPointTsMs: BASE_TS_MS,
        coveragePoints: 1_000,
        assetIds: [OVER_ASSET_ID, UNDER_ASSET_ID]
      },
      evidenceGrade: "paired_order_books",
      capabilities: {
        signalResearchReplay: true,
        executablePaperReplay: true,
        kickoffCloseReplay: true,
        publicResolutionReplay: true
      },
      bountyLane: {
        mode: "executable_book_replay",
        exploratory: true,
        reason: "Synthetic conductor proof only; permanently excluded from performance."
      },
      longRunLane: {
        eligible: false,
        reason: "predates_long_run_lane_start"
      },
      pairedCapture: {
        runId: "synthetic-judge-capture-v1",
        status: "verified",
        fixtureId: FIXTURE_ID,
        eventSlug: "synthetic-judge-event-v1",
        logComplete: true,
        mappingConfirmed: true,
        identityParity: true,
        replayMode: "capture-order-per-source",
        rows: 20,
        firstPolymarketObservedTsMs: BASE_TS_MS + 110,
        lastPolymarketObservedTsMs: KICKOFF_TS_MS + 2 * 60 * 60_000 + 10,
        firstTxlineOddsObservedTsMs: BASE_TS_MS + 10,
        lastTxlineOddsObservedTsMs: BASE_TS_MS + 8 * 60_000 + 10,
        firstTxlineScoresObservedTsMs: BASE_TS_MS + 210,
        lastTxlineScoresObservedTsMs: KICKOFF_TS_MS + 2 * 60 * 60_000 + 10,
        selectedTotal: {
          eventSlug: "synthetic-judge-event-v1",
          marketId: "synthetic-judge-market-v1",
          conditionId: CONDITION_ID,
          lineMilli: LINE_MILLI,
          assetIds: [OVER_ASSET_ID, UNDER_ASSET_ID]
        },
        selectedBookDepthComplete: true,
        exactFixtureTxlineOddsAvailable: true,
        exactFixtureTxlineScoresAvailable: true,
        exactFixtureScoreCompleted: true,
        proofCommitment: "0".repeat(64),
        kickoffCloseAvailable: true,
        publicResolutionAvailable: true,
        publicMarketResolvedNormalized: true
      }
    }],
    summary: {
      fixtures: 1,
      pairedBookReplays: 1,
      executableBookReplays: 1,
      bookLifecycleReplays: 0,
      signalResearchOnly: 0,
      unavailable: 0,
      longRunEligible: 0
    }
  };
}

async function* canonicalSequence(events: CanonicalEvent[]): AsyncGenerator<CanonicalEvent> {
  for (const event of events) yield event;
}

/**
 * Runs a closed-world proving case through the production paper components.
 * All canonical records are invented inside this module and carry synthetic
 * identities. Nothing reads a file, environment secret, API, RPC, wallet, or
 * external model, and the resulting receipt is permanently performance-excluded.
 */
export async function runSyntheticJudgeCase(): Promise<SyntheticJudgeCaseReport> {
  let durableInsertTsMs = DEMO_PROCESSING_TS_MS;
  const boundaryAudit: SyntheticBoundaryAudit = {
    triageStubCalls: 0,
    analystStubCalls: 0,
    anthropicCalls: 0,
    txlineApiCalls: 0,
    polymarketApiCalls: 0,
    walletCalls: 0,
    solanaRpcCalls: 0,
    realOrders: 0
  };
  const handle = initializePaperStudyLedger({
    path: ":memory:",
    lane: "bounty",
    startedAtTsMs: BASE_TS_MS - 60_000,
    insertedAtNow: () => durableInsertTsMs++
  });

  try {
    const triageAgent: TriageAgent = {
      triage: async () => {
        boundaryAudit.triageStubCalls += 1;
        return {
          decision: "escalate",
          priority: "normal",
          rationale: "Synthetic proving signal meets the fixed escalation path; performance use is forbidden."
        };
      }
    };
    const analystAgent: AnalystAgent = {
      investigate: async ({ signal, asOfTsMs }) => {
        boundaryAudit.analystStubCalls += 1;
        return {
          schemaVersion: 1,
          signalId: signal.signalId,
          fixtureId: signal.fixtureId,
          marketKey: signal.market.key,
          outcome: signal.outcome,
          direction: signal.direction,
          recommendation: "paper_trade",
          fairProbability: signal.evidence.consensusProbability,
          thesisSummary: "Synthetic consensus movement remains ahead of the synthetic paper book.",
          evidenceFor: ["The synthetic executable gap clears the frozen deterministic paper threshold."],
          steelmanAgainst: "The invented movement could reverse before the invented kickoff.",
          invalidationConditions: ["The synthetic ask reaches the deterministic private boundary."],
          submittedAtTsMs: asOfTsMs,
          expiresAtTsMs: asOfTsMs + 15 * 60_000,
          analystModel: CLAUDE_MODEL.analyst
        };
      }
    };
    const persistentRuntime = createPersistentPaperLaneRuntime({
      lane: "bounty",
      initialization: handle.initialization,
      universe: syntheticUniverse(handle.initialization.startedAtTsMs),
      ledger: handle.ledger,
      triageAgent,
      analystAgent,
      executionLatencyMs: DECISION_LATENCY_MS,
      maximumPendingMs: MAXIMUM_PENDING_MS,
      feeResolver: async (executionBook, asOfTsMs): Promise<PolymarketFeeParameters> => ({
        source: "polymarket_clob_market_info",
        conditionId: executionBook.conditionId,
        feesEnabled: true,
        takerFeeRate: 0.05,
        feeCurveExponent: 1,
        takerOnly: true,
        minimumOrderSize: 5,
        minimumTickSize: 0.01,
        fetchedAtTsMs: asOfTsMs
      })
    });
    const batches: Array<{ event: CanonicalEvent; batch: PaperRuntimeBatch }> = [];
    const events: CanonicalEvent[] = [];
    const baselineProbabilities = [0.5, 0.5002, 0.4999, 0.5001, 0.5, 0.5002, 0.4999, 0.5001];
    for (const [index, fair] of baselineProbabilities.entries()) {
      const tsMs = BASE_TS_MS + index * 60_000;
      events.push(oddsQuote(index, tsMs, fair));
      events.push(book({
        id: `synthetic-baseline-book-${index}`,
        sourceTsMs: tsMs + 100,
        observedTsMs: tsMs + 110,
        bid: 0.5,
        ask: 0.52
      }));
    }

    const triggerQuote = oddsQuote(8, BASE_TS_MS + 8 * 60_000, 0.55);
    events.push(triggerQuote);

    const executionBook = book({
      id: "synthetic-execution-book",
      sourceTsMs: triggerQuote.sourceTsMs + 2_000,
      observedTsMs: triggerQuote.observedTsMs + 2_000,
      bid: 0.5,
      ask: 0.52,
      secondAsk: 0.53
    });
    events.push(executionBook);
    const closeBook = book({
      id: "synthetic-closing-book",
      sourceTsMs: KICKOFF_TS_MS - 1_000,
      observedTsMs: KICKOFF_TS_MS - 990,
      bid: 0.57,
      ask: 0.59
    });
    events.push(closeBook);
    const settlementEvent = resolution();
    events.push(settlementEvent);

    const session = await runPaperSession({
      source: canonicalSequence(events),
      runtime: persistentRuntime,
      onBatch: ({ event, batch }) => { batches.push({ event, batch }); }
    });
    requiredBatch(
      batches.find(({ batch }) => batch.routedSignalIds.length === 1),
      "Frozen synthetic detector path did not route exactly one signal"
    );
    const signalBook = requiredBatch(
      batches.find(({ event }) => event.eventId === "synthetic-baseline-book-7")?.event,
      "Synthetic signal-side paper book is missing"
    );
    if (signalBook.kind !== "polymarket.book") {
      throw new Error("Synthetic signal-side evidence is not a canonical Polymarket book");
    }
    const executionBatch = requiredBatch(
      batches.find(({ batch }) => batch.caseResults.length === 1),
      "Synthetic scheduler did not produce one paper execution result"
    );
    const executionResult = requiredBatch(
      executionBatch.batch.caseResults[0],
      "Synthetic paper execution result is missing"
    );
    if (executionResult.status !== "filled" && executionResult.status !== "partial") {
      throw new Error(`Synthetic paper execution failed closed with status ${executionResult.status}`);
    }
    const lifecycleBatch = requiredBatch(
      batches.find(({ batch }) => batch.settlementResults.length === 1),
      "Synthetic lifecycle did not settle exactly one paper position"
    );
    if (lifecycleBatch.batch.closeResults.length !== 1) {
      throw new Error("Synthetic lifecycle did not create exactly one kickoff close mark");
    }

    const caseEntries = handle.ledger.entries(executionResult.caseId);
    const triageResponse = requiredBatch(
      caseEntries.find((entry) => entry.kind === "triage_decision")?.payload,
      "Synthetic triage ledger commitment is missing"
    );
    const analystResponse = requiredBatch(
      caseEntries.find((entry) => entry.kind === "thesis_submitted")?.payload,
      "Synthetic thesis ledger commitment is missing"
    );
    const sourceEvidence = [
      sourceEvidenceCommitment({
        source: "txline",
        role: "signal",
        sourceTsMs: triggerQuote.sourceTsMs,
        observedAtTsMs: triggerQuote.observedTsMs,
        payload: JSON.parse(JSON.stringify(triggerQuote))
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "signal",
        sourceTsMs: signalBook.sourceTsMs,
        observedAtTsMs: signalBook.observedTsMs,
        payload: JSON.parse(JSON.stringify(signalBook))
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "execution",
        sourceTsMs: executionBook.sourceTsMs,
        observedAtTsMs: executionBook.observedTsMs,
        payload: JSON.parse(JSON.stringify(executionBook))
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "close",
        sourceTsMs: closeBook.sourceTsMs,
        observedAtTsMs: closeBook.observedTsMs,
        payload: JSON.parse(JSON.stringify(closeBook))
      }),
      sourceEvidenceCommitment({
        source: "polymarket",
        role: "settlement",
        sourceTsMs: settlementEvent.sourceTsMs,
        observedAtTsMs: settlementEvent.observedTsMs,
        payload: JSON.parse(JSON.stringify(settlementEvent))
      })
    ];
    const receipt = generateDecisionReceipt({
      ledger: handle.ledger,
      caseId: executionResult.caseId,
      context: {
        generatedAtTsMs: DEMO_RECEIPT_GENERATED_AT_TS_MS,
        provenance: {
          evidenceClass: "synthetic_proving_fixture",
          synthetic: true,
          performanceUse: "excluded_synthetic",
          label: LABEL
        },
        build: {
          codeVersion: "synthetic-judge-case-v1",
          codeSha256: sha256("samaritan:synthetic-judge-case:v1"),
          configSha256: handle.initialization.configHash
        },
        sourceEvidence,
        agentRuns: [
          syntheticAgentRun({ stage: "triage", response: triageResponse }),
          syntheticAgentRun({ stage: "analyst", response: analystResponse })
        ],
        executionBookEvidenceRefSha256: sourceEvidence[2]!.evidenceRefSha256,
        closeBookEvidenceRefSha256: sourceEvidence[3]!.evidenceRefSha256,
        settlementEvidenceRefSha256: sourceEvidence[4]!.evidenceRefSha256,
        solanaAnchor: null
      }
    });
    const receiptVerification = verifyDecisionReceipt(receipt);
    const ledgerVerification = handle.ledger.verifyChain();
    const summary = persistentRuntime.portfolio.summary();
    if (
      boundaryAudit.triageStubCalls !== 1 ||
      boundaryAudit.analystStubCalls !== 1 ||
      summary.positions !== 1 ||
      summary.openPositions !== 0 ||
      summary.settledPositions !== 1
    ) {
      throw new Error("Synthetic proving case did not preserve its bounded one-case invariants");
    }
    if (
      receiptVerification.lifecycleStatus !== "filled_settled" &&
      receiptVerification.lifecycleStatus !== "partial_settled"
    ) {
      throw new Error(`Unexpected synthetic receipt lifecycle ${receiptVerification.lifecycleStatus}`);
    }

    return {
      schemaVersion: 1,
      label: LABEL,
      synthetic: true,
      performanceUse: "excluded_synthetic",
      protocolStatus: handle.initialization.protocolStatus,
      realMoneyGate: handle.initialization.realMoneyGate,
      boundaries: boundaryAudit,
      runtime: {
        canonicalEventsPublished: session.events,
        rawSignals: batches.reduce((sum, item) => sum + item.batch.rawSignals.length, 0),
        normalizedSignals: batches.reduce((sum, item) => sum + item.batch.signals.length, 0),
        routedSignals: batches.reduce((sum, item) => sum + item.batch.routedSignalIds.length, 0),
        paperExecutionStatus: executionResult.status,
        closeMarks: batches.reduce((sum, item) => sum + item.batch.closeResults.length, 0),
        settlements: batches.reduce((sum, item) => sum + item.batch.settlementResults.length, 0),
        finalLifecycleStatus: receiptVerification.lifecycleStatus,
        ledgerRows: ledgerVerification.rows,
        ledgerHashSchemaVersions: ledgerVerification.hashSchemaVersions,
        ledgerHeadSha256: ledgerVerification.headHash
      },
      receiptVerification,
      receipt
    };
  } finally {
    handle.ledger.close();
  }
}
