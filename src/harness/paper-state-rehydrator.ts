import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertThesisMatchesSignal,
  tradeThesisSchema,
  triageDecisionSchema,
  type TradeThesis,
  type TriageDecision
} from "../agents/contracts.js";
import type { DetectorSignal } from "../detectors/types.js";
import { microUsd, type MicroUsd, USD_MICRO_UNITS } from "../domain/money.js";
import { POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS, type PaperFill, type PaperOrderIntent } from "../exec/paper.js";
import type { PaperCloseMark, PaperPortfolioInitialState, PaperPosition, PaperSettlement } from "../portfolio/paper.js";
import type { PaperRiskState, PaperRiskVerdict } from "../risk/paper.js";
import type {
  DecisionLedger,
  DecisionLedgerEntry,
  DecisionLedgerVerification
} from "../store/decision-ledger.js";
import type { PreparedPaperCase, PaperStudyLane } from "./paper-pipeline.js";
import type { PaperPendingSignalState, PaperSchedulerInitialState } from "./paper-scheduler.js";

const DECISION_EVENT_KINDS = new Set([
  "study_initialized",
  "signal_received",
  "triage_decision",
  "thesis_submitted",
  "analysis_completed",
  "risk_verdict",
  "execution_intent",
  "paper_execution",
  "position_opened",
  "position_closed",
  "position_settled",
  "case_terminal"
]);

const safeInteger = z.number().refine(Number.isSafeInteger, "must be a safe integer");
const nonnegativeSafeInteger = safeInteger.refine((value) => value >= 0, "must be non-negative");
const positiveSafeInteger = safeInteger.refine((value) => value > 0, "must be positive");
const finiteNumber = z.number().finite();
const probability = finiteNumber.min(0).max(1);

const marketSchema = z.object({
  family: z.enum(["match_result", "total_goals"]),
  period: z.enum(["full_time", "first_half", "extra_time", "other"]),
  lineMilli: safeInteger.nullable(),
  key: z.string().min(1)
}).strict();

const detectorSignalSchema = z.object({
  signalId: z.string().min(1),
  kind: z.enum(["CONSENSUS_MOVE", "XMARKET_DIVERGENCE", "FADER_CANDIDATE"]),
  detectedAtTsMs: nonnegativeSafeInteger,
  observedAtTsMs: nonnegativeSafeInteger,
  fixtureId: z.string().min(1),
  market: marketSchema,
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  direction: z.enum(["buy", "sell"]),
  eligibility: z.enum(["research_only", "pretrade_review_required"]),
  reason: z.string(),
  evidence: z.object({
    consensusProbability: probability,
    polymarketProbability: probability,
    consensusVelocity: finiteNumber.nullable(),
    consensusZScore: finiteNumber.nullable(),
    polymarketVelocity: finiteNumber.nullable(),
    polymarketZScore: finiteNumber.nullable(),
    cusumUp: finiteNumber,
    cusumDown: finiteNumber,
    rawGap: finiteNumber,
    gapBasis: z.enum(["live_book", "sampled_history_proxy"]),
    persistenceMs: nonnegativeSafeInteger,
    mappingStatus: z.string().nullable(),
    scoreContextActions: z.array(z.string())
  }).strict()
}).strict();

const signalPayloadSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  signal: detectorSignalSchema
}).strict();

const analysisSchema = z.object({
  signalSourceTsMs: nonnegativeSafeInteger,
  signalObservedTsMs: nonnegativeSafeInteger,
  decisionLatencyMs: positiveSafeInteger,
  readyAtTsMs: nonnegativeSafeInteger,
  venuePlacementDelayMs: z.literal(POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS),
  orderEligibleAtTsMs: nonnegativeSafeInteger,
  recommendation: z.enum(["paper_trade", "no_trade"])
}).strict();

const riskVerdictSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("veto"),
    reasons: z.array(z.string().min(1)).min(1)
  }).strict(),
  z.object({
    decision: z.literal("approve"),
    stakeMicroUsd: positiveSafeInteger,
    limitProbability: probability,
    realMoneyGate: z.literal("closed")
  }).strict()
]);

const executionIntentSchema = z.object({
  lane: z.enum(["bounty", "long_run"]),
  caseId: z.string().min(1),
  signalId: z.string().min(1),
  fixtureId: z.string().min(1),
  marketKey: z.string().min(1),
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  direction: z.enum(["buy", "sell"]),
  stakeMicroUsd: positiveSafeInteger,
  limitProbability: probability,
  availableShares: finiteNumber.nonnegative()
}).strict();

const feeParametersSchema = z.object({
  source: z.literal("polymarket_clob_market_info"),
  conditionId: z.string().min(1),
  feesEnabled: z.boolean(),
  takerFeeRate: finiteNumber.nonnegative(),
  feeCurveExponent: finiteNumber,
  takerOnly: z.boolean(),
  minimumOrderSize: finiteNumber.positive(),
  minimumTickSize: finiteNumber.positive(),
  fetchedAtTsMs: nonnegativeSafeInteger
}).strict();

const paperFillSchema = z.object({
  adapter: z.literal("paper"),
  status: z.enum(["filled", "partial", "no_fill"]),
  reason: z.string().nullable(),
  assetId: z.string().min(1),
  conditionId: z.string().min(1),
  direction: z.enum(["buy", "sell"]),
  requestedStakeMicroUsd: positiveSafeInteger,
  grossMicroUsd: nonnegativeSafeInteger,
  feeMicroUsd: nonnegativeSafeInteger,
  netConsiderationMicroUsd: nonnegativeSafeInteger,
  filledShares: finiteNumber.nonnegative(),
  averagePrice: probability.nullable(),
  bestPrice: probability.nullable(),
  halfSpreadBps: finiteNumber.nonnegative().nullable(),
  executableDepthUsd: finiteNumber.nonnegative(),
  slippageProbabilityBps: finiteNumber.nullable(),
  bookObservedTsMs: nonnegativeSafeInteger,
  feeParameters: feeParametersSchema
}).strict();

const closeMarkSchema = z.object({
  cutoffTsMs: nonnegativeSafeInteger,
  markedAtTsMs: nonnegativeSafeInteger,
  bookSourceTsMs: nonnegativeSafeInteger,
  bookObservedTsMs: nonnegativeSafeInteger,
  closeBid: probability,
  closeAsk: probability,
  closeMidpoint: probability,
  grossMidpointClvBps: finiteNumber,
  netMidpointClvBps: finiteNumber,
  executableLiquidationClvBps: finiteNumber
}).strict();

const settlementSchema = z.object({
  settledAtTsMs: nonnegativeSafeInteger,
  won: z.boolean(),
  payoutMicroUsd: nonnegativeSafeInteger,
  pnlMicroUsd: safeInteger,
  returnBps: finiteNumber,
  entryBrier: finiteNumber.min(0).max(1)
}).strict();

const positionSchema = z.object({
  caseId: z.string().min(1),
  lane: z.enum(["bounty", "long_run"]),
  signalId: z.string().min(1),
  fixtureId: z.string().min(1),
  marketKey: z.string().min(1),
  conditionId: z.string().min(1),
  assetId: z.string().min(1),
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  selectedLineMilli: safeInteger,
  openedAtTsMs: nonnegativeSafeInteger,
  filledShares: finiteNumber.positive(),
  averageEntryPrice: probability,
  entryGrossMicroUsd: positiveSafeInteger,
  entryFeeMicroUsd: nonnegativeSafeInteger,
  entryCostMicroUsd: positiveSafeInteger,
  fillStatus: z.enum(["filled", "partial"]),
  entryHalfSpreadBps: finiteNumber.nonnegative(),
  entrySlippageBps: finiteNumber,
  selectedDepthUsd: finiteNumber.nonnegative(),
  status: z.enum(["open", "marked", "settled"]),
  closeMark: closeMarkSchema.nullable(),
  settlement: settlementSchema.nullable()
}).strict();

const terminalSchema = z.object({
  status: z.enum(["dropped", "no_trade", "vetoed", "filled", "partial", "no_fill", "failed"]),
  reason: z.string().min(1),
  decisionLatencyMs: positiveSafeInteger.optional()
}).strict();

type AnalysisEvidence = z.infer<typeof analysisSchema>;
type TerminalEvidence = z.infer<typeof terminalSchema>;

type MutableCase = {
  caseId: string;
  lastAtTsMs: number;
  signal: DetectorSignal | null;
  triage: TriageDecision | null;
  thesis: TradeThesis | null;
  analysis: AnalysisEvidence | null;
  riskVerdict: PaperRiskVerdict | null;
  intent: PaperOrderIntent | null;
  fill: PaperFill | null;
  terminal: (TerminalEvidence & { atTsMs: number }) | null;
  position: PaperPosition | null;
  closeMark: PaperCloseMark | null;
  settlement: PaperSettlement | null;
};

export type RehydratedPendingExpiration = {
  caseId: string;
  signalId: string;
  timeoutAtTsMs: number;
  kickoffAtTsMs: number;
  effectiveExpiresAtTsMs: number;
  reason: "no_post_venue_delay_executable_book_before_expiry" |
    "no_post_venue_delay_executable_book_before_kickoff";
  expiredAsOfTsMs: boolean;
};

export type RehydratedPaperCase = {
  caseId: string;
  signalId: string;
  status: "pending" | "terminal";
  terminal: (TerminalEvidence & { atTsMs: number }) | null;
  pendingExpiration: RehydratedPendingExpiration | null;
  positionStatus: "none" | "open" | "closed" | "settled";
};

export type RehydratedPaperState = {
  lane: PaperStudyLane;
  asOfTsMs: number;
  chain: DecisionLedgerVerification;
  seenSignalIds: string[];
  cases: RehydratedPaperCase[];
  pendingExpirations: RehydratedPendingExpiration[];
  positions: PaperPosition[];
  openPositions: PaperPosition[];
  closedPositions: PaperPosition[];
  settledPositions: PaperPosition[];
  aggregateExposureMicroUsd: MicroUsd;
  realizedPnlMicroUsd: MicroUsd;
  equityMicroUsd: MicroUsd;
  peakEquityMicroUsd: MicroUsd;
  currentDrawdownMicroUsd: MicroUsd;
  riskState: PaperRiskState;
  portfolioInitialState: PaperPortfolioInitialState;
  schedulerInitialState: PaperSchedulerInitialState;
};

export type RehydratePaperStateInput = {
  ledger: DecisionLedger;
  lane: PaperStudyLane;
  bankrollMicroUsd: MicroUsd;
  drawdownStopMicroUsd: MicroUsd;
  maximumPendingMs: number;
  kickoffByFixtureId: ReadonlyMap<string, number>;
  asOfTsMs: number;
};

export function paperCaseIdForSignal(lane: PaperStudyLane, signalId: string): string {
  return `case_${createHash("sha256").update(`paper:${lane}:${signalId}`).digest("hex").slice(0, 24)}`;
}

function parsePayload<T>(schema: z.ZodType<T>, entry: DecisionLedgerEntry): T {
  const parsed = schema.safeParse(entry.payload);
  if (!parsed.success) {
    throw new Error(`Malformed ${entry.kind} payload at ${entry.entryId}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function requireState(states: Map<string, MutableCase>, entry: DecisionLedgerEntry): MutableCase {
  const state = states.get(entry.caseId);
  if (!state?.signal) throw new Error(`${entry.kind} precedes signal_received for ${entry.caseId}`);
  if (entry.atTsMs < state.lastAtTsMs) {
    throw new Error(`Decision timestamp regressed for ${entry.caseId} at ${entry.entryId}`);
  }
  state.lastAtTsMs = entry.atTsMs;
  return state;
}

function assertAbsent(value: unknown, label: string, caseId: string): void {
  if (value !== null) throw new Error(`Duplicate ${label} for ${caseId}`);
}

function assertSame(actual: unknown, expected: unknown, label: string, caseId: string): void {
  if (actual !== expected) throw new Error(`${label} mismatch for ${caseId}`);
}

function assertNear(actual: number, expected: number, label: string, caseId: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label} mismatch for ${caseId}`);
  }
}

function validateFill(fill: PaperFill, intent: PaperOrderIntent, caseId: string): void {
  assertSame(fill.direction, intent.direction, "Fill direction", caseId);
  assertSame(fill.requestedStakeMicroUsd, intent.stakeMicroUsd, "Fill requested stake", caseId);
  assertSame(fill.feeParameters.conditionId, fill.conditionId, "Fill fee condition", caseId);
  if (fill.status === "no_fill") {
    if (
      fill.filledShares !== 0 ||
      fill.grossMicroUsd !== 0 ||
      fill.feeMicroUsd !== 0 ||
      fill.netConsiderationMicroUsd !== 0 ||
      fill.averagePrice !== null
    ) {
      throw new Error(`No-fill contains execution value for ${caseId}`);
    }
    return;
  }
  if (fill.filledShares <= 0 || fill.averagePrice === null) {
    throw new Error(`Filled execution lacks shares or price for ${caseId}`);
  }
  const reconstructedGross = fill.filledShares * fill.averagePrice * USD_MICRO_UNITS;
  if (Math.abs(reconstructedGross - fill.grossMicroUsd) > 1e-6) {
    throw new Error(`Fill gross amount does not match shares and average price for ${caseId}`);
  }
  const expectedConsideration = fill.direction === "buy"
    ? fill.grossMicroUsd + fill.feeMicroUsd
    : fill.grossMicroUsd - fill.feeMicroUsd;
  assertSame(fill.netConsiderationMicroUsd, expectedConsideration, "Fill net consideration", caseId);
  if (fill.direction === "buy" && fill.netConsiderationMicroUsd > intent.stakeMicroUsd) {
    throw new Error(`Buy fill exceeds approved stake for ${caseId}`);
  }
  if (fill.direction === "sell" && fill.filledShares > intent.availableShares) {
    throw new Error(`Sell fill exceeds approved inventory for ${caseId}`);
  }
}

function validateTerminal(state: MutableCase, terminal: TerminalEvidence): void {
  const { caseId } = state;
  switch (terminal.status) {
    case "dropped":
      if (state.triage?.decision !== "drop" || state.thesis || state.riskVerdict || state.fill) {
        throw new Error(`Dropped terminal lacks a drop decision for ${caseId}`);
      }
      return;
    case "no_trade":
      if (state.thesis?.recommendation !== "no_trade" || !state.analysis || state.riskVerdict || state.fill) {
        throw new Error(`No-trade terminal lacks a completed no-trade thesis for ${caseId}`);
      }
      return;
    case "vetoed":
      if (state.riskVerdict?.decision !== "veto" || state.intent || state.fill) {
        throw new Error(`Veto terminal lacks a deterministic veto for ${caseId}`);
      }
      return;
    case "filled":
    case "partial":
    case "no_fill":
      if (!state.intent || !state.fill || state.fill.status !== terminal.status) {
        throw new Error(`${terminal.status} terminal lacks its committed execution for ${caseId}`);
      }
      return;
    case "failed":
      if (state.fill || state.riskVerdict?.decision === "veto") {
        throw new Error(`Failed terminal conflicts with committed outcome for ${caseId}`);
      }
      return;
  }
}

function validatePosition(state: MutableCase, position: PaperPosition, entry: DecisionLedgerEntry, lane: PaperStudyLane): void {
  const { signal, fill, intent, terminal, caseId } = state;
  if (!signal || !fill || !intent || !terminal || !["filled", "partial"].includes(terminal.status)) {
    throw new Error(`Position opened without approved committed fill for ${caseId}`);
  }
  if (state.riskVerdict?.decision !== "approve") {
    throw new Error(`Position opened without risk approval for ${caseId}`);
  }
  if (fill.direction !== "buy") throw new Error(`Paper position is not a canonical-token buy for ${caseId}`);
  if (fill.halfSpreadBps === null || fill.slippageProbabilityBps === null) {
    throw new Error(`Paper position fill lacks spread or slippage evidence for ${caseId}`);
  }
  assertSame(position.caseId, caseId, "Position case", caseId);
  assertSame(position.lane, lane, "Position lane", caseId);
  assertSame(position.signalId, signal.signalId, "Position signal", caseId);
  assertSame(position.fixtureId, signal.fixtureId, "Position fixture", caseId);
  assertSame(position.marketKey, signal.market.key, "Position market", caseId);
  assertSame(position.outcome, signal.outcome, "Position outcome", caseId);
  assertSame(position.conditionId, fill.conditionId, "Position condition", caseId);
  assertSame(position.assetId, fill.assetId, "Position asset", caseId);
  assertSame(position.selectedLineMilli, signal.market.lineMilli, "Position selected line", caseId);
  assertSame(position.openedAtTsMs, entry.atTsMs, "Position opened timestamp", caseId);
  assertSame(position.openedAtTsMs, fill.bookObservedTsMs, "Position fill timestamp", caseId);
  assertNear(position.filledShares, fill.filledShares, "Position filled shares", caseId);
  assertNear(position.averageEntryPrice, fill.averagePrice!, "Position entry price", caseId);
  assertSame(position.entryGrossMicroUsd, fill.grossMicroUsd, "Position gross", caseId);
  assertSame(position.entryFeeMicroUsd, fill.feeMicroUsd, "Position fee", caseId);
  assertSame(position.entryCostMicroUsd, fill.netConsiderationMicroUsd, "Position cost", caseId);
  assertSame(position.fillStatus, fill.status, "Position fill status", caseId);
  assertNear(position.entryHalfSpreadBps, fill.halfSpreadBps!, "Position spread", caseId);
  assertNear(position.entrySlippageBps, fill.slippageProbabilityBps!, "Position slippage", caseId);
  assertNear(position.selectedDepthUsd, fill.executableDepthUsd, "Position depth", caseId);
  if (position.status !== "open" || position.closeMark !== null || position.settlement !== null) {
    throw new Error(`Position-opened event contains future lifecycle state for ${caseId}`);
  }
}

function validateCloseMark(position: PaperPosition, mark: PaperCloseMark, entry: DecisionLedgerEntry): void {
  const caseId = position.caseId;
  assertSame(mark.markedAtTsMs, entry.atTsMs, "Close mark timestamp", caseId);
  if (
    mark.markedAtTsMs < position.openedAtTsMs ||
    mark.markedAtTsMs < mark.bookObservedTsMs ||
    mark.bookSourceTsMs > mark.cutoffTsMs ||
    mark.closeBid > mark.closeAsk
  ) {
    throw new Error(`Impossible close-mark chronology or book for ${caseId}`);
  }
  const midpoint = (mark.closeBid + mark.closeAsk) / 2;
  const unitCost = position.entryCostMicroUsd / USD_MICRO_UNITS / position.filledShares;
  assertNear(mark.closeMidpoint, midpoint, "Close midpoint", caseId);
  assertNear(mark.grossMidpointClvBps, (midpoint - position.averageEntryPrice) * 10_000, "Gross CLV", caseId);
  assertNear(mark.netMidpointClvBps, (midpoint - unitCost) * 10_000, "Net CLV", caseId);
  assertNear(mark.executableLiquidationClvBps, (mark.closeBid - unitCost) * 10_000, "Executable CLV", caseId);
}

function validateSettlement(position: PaperPosition, settlement: PaperSettlement, entry: DecisionLedgerEntry): void {
  const caseId = position.caseId;
  assertSame(settlement.settledAtTsMs, entry.atTsMs, "Settlement timestamp", caseId);
  if (!position.closeMark || settlement.settledAtTsMs < position.closeMark.markedAtTsMs) {
    throw new Error(`Settlement precedes close evidence for ${caseId}`);
  }
  const payout = settlement.won ? Math.floor(position.filledShares * USD_MICRO_UNITS) : 0;
  const pnl = payout - position.entryCostMicroUsd;
  assertSame(settlement.payoutMicroUsd, payout, "Settlement payout", caseId);
  assertSame(settlement.pnlMicroUsd, pnl, "Settlement P&L", caseId);
  assertNear(
    settlement.returnBps,
    position.entryCostMicroUsd === 0 ? 0 : pnl / position.entryCostMicroUsd * 10_000,
    "Settlement return",
    caseId
  );
  assertNear(
    settlement.entryBrier,
    (position.averageEntryPrice - (settlement.won ? 1 : 0)) ** 2,
    "Settlement Brier score",
    caseId
  );
}

function processCaseEntry(
  states: Map<string, MutableCase>,
  signalOwners: Map<string, string>,
  entry: DecisionLedgerEntry,
  lane: PaperStudyLane
): void {
  if (entry.kind === "signal_received") {
    if (states.has(entry.caseId)) throw new Error(`Duplicate signal_received for ${entry.caseId}`);
    const payload = parsePayload(signalPayloadSchema, entry);
    if (payload.lane !== lane) throw new Error(`Signal lane mismatch for ${entry.caseId}`);
    const signal = payload.signal as DetectorSignal;
    if (entry.atTsMs !== signal.observedAtTsMs) {
      throw new Error(`Signal ledger timestamp mismatch for ${entry.caseId}`);
    }
    const expectedCaseId = paperCaseIdForSignal(lane, signal.signalId);
    if (entry.caseId !== expectedCaseId) throw new Error(`Signal case ID mismatch for ${entry.caseId}`);
    const owner = signalOwners.get(signal.signalId);
    if (owner) throw new Error(`Signal ID ${signal.signalId} is duplicated across ${owner} and ${entry.caseId}`);
    signalOwners.set(signal.signalId, entry.caseId);
    states.set(entry.caseId, {
      caseId: entry.caseId,
      lastAtTsMs: entry.atTsMs,
      signal,
      triage: null,
      thesis: null,
      analysis: null,
      riskVerdict: null,
      intent: null,
      fill: null,
      terminal: null,
      position: null,
      closeMark: null,
      settlement: null
    });
    return;
  }

  const state = requireState(states, entry);
  if (state.terminal && !["position_opened", "position_closed", "position_settled"].includes(entry.kind)) {
    throw new Error(`${entry.kind} appears after case_terminal for ${entry.caseId}`);
  }
  switch (entry.kind) {
    case "triage_decision": {
      assertAbsent(state.triage, "triage_decision", state.caseId);
      if (state.thesis || state.analysis || state.riskVerdict) throw new Error(`Triage is out of order for ${state.caseId}`);
      state.triage = parsePayload(triageDecisionSchema, entry);
      break;
    }
    case "thesis_submitted": {
      assertAbsent(state.thesis, "thesis_submitted", state.caseId);
      if (state.triage?.decision !== "escalate" || state.analysis || state.riskVerdict) {
        throw new Error(`Thesis lacks an escalation for ${state.caseId}`);
      }
      const thesis = parsePayload(tradeThesisSchema, entry);
      assertThesisMatchesSignal(thesis, state.signal!);
      assertSame(entry.atTsMs, thesis.submittedAtTsMs, "Thesis timestamp", state.caseId);
      state.thesis = thesis;
      break;
    }
    case "analysis_completed": {
      assertAbsent(state.analysis, "analysis_completed", state.caseId);
      if (!state.thesis || state.riskVerdict) throw new Error(`Analysis completion lacks a thesis for ${state.caseId}`);
      const analysis = parsePayload(analysisSchema, entry);
      assertSame(analysis.signalSourceTsMs, state.signal!.detectedAtTsMs, "Analysis source time", state.caseId);
      assertSame(analysis.signalObservedTsMs, state.signal!.observedAtTsMs, "Analysis observed time", state.caseId);
      assertSame(analysis.readyAtTsMs, state.thesis.submittedAtTsMs, "Analysis readiness", state.caseId);
      assertSame(analysis.readyAtTsMs, entry.atTsMs, "Analysis event time", state.caseId);
      assertSame(
        analysis.decisionLatencyMs,
        state.thesis.submittedAtTsMs - state.signal!.observedAtTsMs,
        "Analysis latency",
        state.caseId
      );
      assertSame(
        analysis.orderEligibleAtTsMs,
        analysis.readyAtTsMs + POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS,
        "Venue eligibility",
        state.caseId
      );
      assertSame(analysis.recommendation, state.thesis.recommendation, "Analysis recommendation", state.caseId);
      state.analysis = analysis;
      break;
    }
    case "risk_verdict": {
      assertAbsent(state.riskVerdict, "risk_verdict", state.caseId);
      if (!state.analysis || state.thesis?.recommendation !== "paper_trade") {
        throw new Error(`Risk verdict lacks a paper-trade analysis for ${state.caseId}`);
      }
      if (entry.atTsMs < state.analysis.orderEligibleAtTsMs) {
        throw new Error(`Risk verdict predates venue eligibility for ${state.caseId}`);
      }
      state.riskVerdict = parsePayload(riskVerdictSchema, entry) as PaperRiskVerdict;
      break;
    }
    case "execution_intent": {
      assertAbsent(state.intent, "execution_intent", state.caseId);
      if (state.riskVerdict?.decision !== "approve" || state.fill) {
        throw new Error(`Execution intent lacks risk approval for ${state.caseId}`);
      }
      const intent = parsePayload(executionIntentSchema, entry) as PaperOrderIntent;
      const signal = state.signal!;
      assertSame(intent.lane, lane, "Intent lane", state.caseId);
      assertSame(intent.caseId, state.caseId, "Intent case", state.caseId);
      assertSame(intent.signalId, signal.signalId, "Intent signal", state.caseId);
      assertSame(intent.fixtureId, signal.fixtureId, "Intent fixture", state.caseId);
      assertSame(intent.marketKey, signal.market.key, "Intent market", state.caseId);
      assertSame(intent.outcome, signal.outcome, "Intent outcome", state.caseId);
      assertSame(intent.direction, signal.direction, "Intent direction", state.caseId);
      assertSame(intent.stakeMicroUsd, state.riskVerdict.stakeMicroUsd, "Intent stake", state.caseId);
      assertSame(intent.limitProbability, state.riskVerdict.limitProbability, "Intent limit", state.caseId);
      state.intent = intent;
      break;
    }
    case "paper_execution": {
      assertAbsent(state.fill, "paper_execution", state.caseId);
      if (!state.intent || state.riskVerdict?.decision !== "approve") {
        throw new Error(`Paper execution lacks intent and approval for ${state.caseId}`);
      }
      const fill = parsePayload(paperFillSchema, entry) as PaperFill;
      validateFill(fill, state.intent, state.caseId);
      assertSame(entry.atTsMs, fill.bookObservedTsMs, "Execution book time", state.caseId);
      state.fill = fill;
      break;
    }
    case "case_terminal": {
      assertAbsent(state.terminal, "case_terminal", state.caseId);
      const terminal = parsePayload(terminalSchema, entry);
      validateTerminal(state, terminal);
      state.terminal = { ...terminal, atTsMs: entry.atTsMs };
      break;
    }
    case "position_opened": {
      assertAbsent(state.position, "position_opened", state.caseId);
      const position = parsePayload(positionSchema, entry) as PaperPosition;
      validatePosition(state, position, entry, lane);
      state.position = structuredClone(position);
      break;
    }
    case "position_closed": {
      assertAbsent(state.closeMark, "position_closed", state.caseId);
      if (!state.position || state.position.status !== "open" || state.settlement) {
        throw new Error(`Position close lacks an open position for ${state.caseId}`);
      }
      const mark = parsePayload(closeMarkSchema, entry) as PaperCloseMark;
      validateCloseMark(state.position, mark, entry);
      state.closeMark = mark;
      state.position.status = "marked";
      state.position.closeMark = structuredClone(mark);
      break;
    }
    case "position_settled": {
      assertAbsent(state.settlement, "position_settled", state.caseId);
      if (!state.position || state.position.status !== "marked" || !state.closeMark) {
        throw new Error(`Settlement lacks a closed position for ${state.caseId}`);
      }
      const settlement = parsePayload(settlementSchema, entry) as PaperSettlement;
      validateSettlement(state.position, settlement, entry);
      state.settlement = settlement;
      state.position.status = "settled";
      state.position.settlement = structuredClone(settlement);
      break;
    }
    case "study_initialized":
      throw new Error(`Unexpected ${entry.kind} in case lifecycle for ${entry.caseId}`);
  }
}

function validateStudyInitialization(entry: DecisionLedgerEntry, lane: PaperStudyLane): void {
  if (entry.payload === null || Array.isArray(entry.payload) || typeof entry.payload !== "object") {
    throw new Error("Malformed study_initialized payload");
  }
  const payload = entry.payload as Record<string, unknown>;
  if (payload.lane !== lane || payload.realMoneyGate !== "closed") {
    throw new Error("Paper study initialization lane or real-money gate mismatch");
  }
}

export function rehydratePaperState(input: RehydratePaperStateInput): RehydratedPaperState {
  if (input.bankrollMicroUsd <= 0 || input.drawdownStopMicroUsd <= 0) {
    throw new Error("Rehydration bankroll and drawdown stop must be positive");
  }
  if (!Number.isSafeInteger(input.maximumPendingMs) || input.maximumPendingMs <= 0) {
    throw new Error("Rehydration maximum pending time must be a positive integer");
  }
  if (!Number.isSafeInteger(input.asOfTsMs) || input.asOfTsMs < 0) {
    throw new Error("Rehydration as-of time must be a non-negative integer");
  }

  // This is deliberately the first ledger operation. No payload is trusted
  // until the complete v1/v2-compatible hash chain has verified.
  const chain = input.ledger.verifyChain();
  const entries = input.ledger.entries();
  if (
    entries.length !== chain.rows ||
    (entries.at(-1)?.entryHash ?? "0".repeat(64)) !== chain.headHash
  ) {
    throw new Error("Decision ledger changed while restart state was being read");
  }
  for (const [index, entry] of entries.entries()) {
    if (
      entry.sequence !== index + 1 ||
      !Number.isSafeInteger(entry.atTsMs) ||
      entry.atTsMs < 0 ||
      !Number.isSafeInteger(entry.insertedAtMs) ||
      entry.insertedAtMs < 0 ||
      entry.entryId.length === 0 ||
      entry.caseId.length === 0 ||
      !DECISION_EVENT_KINDS.has(entry.kind)
    ) {
      throw new Error(`Invalid decision ledger metadata at sequence ${entry.sequence}`);
    }
  }
  const caseEntryTimestamps = entries
    .filter((entry) => entry.kind !== "study_initialized")
    .map((entry) => entry.atTsMs);
  const latestCaseTsMs = caseEntryTimestamps.length === 0 ? null : Math.max(...caseEntryTimestamps);
  if (latestCaseTsMs !== null && input.asOfTsMs < latestCaseTsMs) {
    throw new Error("Rehydration as-of time precedes committed case state");
  }

  const states = new Map<string, MutableCase>();
  const signalOwners = new Map<string, string>();
  let studyInitialization: DecisionLedgerEntry | null = null;
  let sawCaseEvent = false;
  for (const entry of entries) {
    if (entry.kind === "study_initialized") {
      if (studyInitialization) throw new Error("Duplicate study_initialized event");
      if (sawCaseEvent) throw new Error("study_initialized appears after case activity");
      validateStudyInitialization(entry, input.lane);
      studyInitialization = entry;
      continue;
    }
    sawCaseEvent = true;
    processCaseEntry(states, signalOwners, entry, input.lane);
  }

  const pending: PaperPendingSignalState[] = [];
  const pendingExpirations: RehydratedPendingExpiration[] = [];
  const cases: RehydratedPaperCase[] = [];
  const positions: PaperPosition[] = [];
  for (const state of states.values()) {
    const { signal } = state;
    if (!signal) throw new Error(`Case ${state.caseId} has no signal`);
    if (!state.terminal) {
      if (
        !state.triage ||
        state.triage.decision !== "escalate" ||
        !state.thesis ||
        state.thesis.recommendation !== "paper_trade" ||
        !state.analysis ||
        state.riskVerdict ||
        state.intent ||
        state.fill ||
        state.position
      ) {
        throw new Error(`Case ${state.caseId} stopped at an unsafe, non-resumable lifecycle seam`);
      }
      const timeoutAtTsMs = state.analysis.orderEligibleAtTsMs + input.maximumPendingMs;
      if (!Number.isSafeInteger(timeoutAtTsMs)) {
        throw new Error(`Pending expiry is outside the safe timestamp range for ${state.caseId}`);
      }
      const kickoffAtTsMs = input.kickoffByFixtureId.get(signal.fixtureId);
      if (kickoffAtTsMs === undefined || !Number.isSafeInteger(kickoffAtTsMs) || kickoffAtTsMs < 0) {
        throw new Error(`Missing or invalid kickoff for pending case ${state.caseId}`);
      }
      const kickoffFirst = kickoffAtTsMs <= timeoutAtTsMs;
      const expiration: RehydratedPendingExpiration = {
        caseId: state.caseId,
        signalId: signal.signalId,
        timeoutAtTsMs,
        kickoffAtTsMs,
        effectiveExpiresAtTsMs: kickoffFirst ? kickoffAtTsMs : timeoutAtTsMs,
        reason: kickoffFirst
          ? "no_post_venue_delay_executable_book_before_kickoff"
          : "no_post_venue_delay_executable_book_before_expiry",
        expiredAsOfTsMs: input.asOfTsMs >= (kickoffFirst ? kickoffAtTsMs : timeoutAtTsMs)
      };
      const prepared: PreparedPaperCase = {
        caseId: state.caseId,
        status: "ready",
        triage: structuredClone(state.triage),
        thesis: structuredClone(state.thesis),
        decisionLatencyMs: state.analysis.decisionLatencyMs,
        readyAtTsMs: state.analysis.readyAtTsMs,
        orderEligibleAtTsMs: state.analysis.orderEligibleAtTsMs,
        venuePlacementDelayMs: state.analysis.venuePlacementDelayMs
      };
      pending.push({
        signal: structuredClone(signal),
        prepared,
        expiresAtTsMs: timeoutAtTsMs
      });
      pendingExpirations.push(expiration);
      cases.push({
        caseId: state.caseId,
        signalId: signal.signalId,
        status: "pending",
        terminal: null,
        pendingExpiration: expiration,
        positionStatus: "none"
      });
      continue;
    }

    if (state.riskVerdict || state.intent || state.fill) {
      if (state.riskVerdict?.decision === "approve" && !state.intent) {
        throw new Error(`Approved case lacks execution intent for ${state.caseId}`);
      }
      if (state.intent && !state.fill && state.terminal.status !== "failed") {
        throw new Error(`Execution intent lacks a committed fill for ${state.caseId}`);
      }
    }
    if (state.fill?.direction === "sell" && state.fill.status !== "no_fill") {
      throw new Error(`Restart reconstruction does not support an inventory sale for ${state.caseId}`);
    }
    if (
      state.fill?.direction === "buy" &&
      state.fill.status !== "no_fill" &&
      !state.position
    ) {
      throw new Error(`Committed buy fill lacks position_opened for ${state.caseId}`);
    }
    if (state.position) {
      const kickoffTsMs = input.kickoffByFixtureId.get(state.position.fixtureId);
      if (kickoffTsMs === undefined || !Number.isSafeInteger(kickoffTsMs) || kickoffTsMs < 0) {
        throw new Error(`Missing or invalid kickoff for position ${state.caseId}`);
      }
      if (state.position.closeMark && state.position.closeMark.cutoffTsMs !== kickoffTsMs) {
        throw new Error(`Position close cutoff does not match fixture kickoff for ${state.caseId}`);
      }
      positions.push(structuredClone(state.position));
    }
    const positionStatus = state.position?.status === "marked" ? "closed" : (state.position?.status ?? "none");
    cases.push({
      caseId: state.caseId,
      signalId: signal.signalId,
      status: "terminal",
      terminal: structuredClone(state.terminal),
      pendingExpiration: null,
      positionStatus
    });
  }

  let realizedPnl = 0;
  let peakEquity = input.bankrollMicroUsd;
  for (const entry of entries) {
    if (entry.kind !== "position_settled") continue;
    const settlement = parsePayload(settlementSchema, entry);
    realizedPnl += settlement.pnlMicroUsd;
    const equity = input.bankrollMicroUsd + realizedPnl;
    if (!Number.isSafeInteger(equity)) throw new Error("Rehydrated equity exceeds safe money range");
    peakEquity = Math.max(peakEquity, equity) as MicroUsd;
  }
  const realizedPnlMicroUsd = microUsd(realizedPnl);
  const equityMicroUsd = microUsd(input.bankrollMicroUsd + realizedPnlMicroUsd);
  const peakEquityMicroUsd = microUsd(peakEquity);
  const currentDrawdownMicroUsd = microUsd(Math.max(0, peakEquityMicroUsd - equityMicroUsd));
  const aggregateExposureMicroUsd = microUsd(positions
    .filter((position) => position.status !== "settled")
    .reduce((sum, position) => sum + position.entryCostMicroUsd, 0));
  const riskState: PaperRiskState = {
    openExposureMicroUsd: aggregateExposureMicroUsd,
    currentDrawdownMicroUsd,
    halted: currentDrawdownMicroUsd >= input.drawdownStopMicroUsd
  };
  const portfolioInitialState: PaperPortfolioInitialState = {
    positions: positions.map((position) => structuredClone(position)),
    realizedPnlMicroUsd,
    peakEquityMicroUsd,
    currentDrawdownMicroUsd
  };
  const schedulerInitialState: PaperSchedulerInitialState = {
    seenSignalIds: [...signalOwners.keys()],
    pending: pending.map((value) => structuredClone(value)),
    // The study registration timestamp is not part of the replay event clock.
    // Using only committed case knowledge preserves the live/replay code path.
    lastObservedTsMs: latestCaseTsMs
  };

  return {
    lane: input.lane,
    asOfTsMs: input.asOfTsMs,
    chain,
    seenSignalIds: [...signalOwners.keys()],
    cases,
    pendingExpirations,
    positions,
    openPositions: positions.filter((position) => position.status === "open"),
    closedPositions: positions.filter((position) => position.status === "marked"),
    settledPositions: positions.filter((position) => position.status === "settled"),
    aggregateExposureMicroUsd,
    realizedPnlMicroUsd,
    equityMicroUsd,
    peakEquityMicroUsd,
    currentDrawdownMicroUsd,
    riskState,
    portfolioInitialState,
    schedulerInitialState
  };
}
