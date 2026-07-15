import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  SPAIN_BELGIUM_MATCHROOM_ID,
  TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
  type DashboardApiResponse,
  type EvidenceRow,
  type MatchroomSnapshot,
  type PublicBookPoint,
  type ReplayState,
  type ReplayStepId
} from "./public-contract.js";

const probabilitySchema = z.number().min(0).max(1);
// This historical feasibility artifact never entered an execution runtime.
// These literal boundary values are structural non-execution markers, not
// ledger-derived trading/account balances.
const NON_EXECUTION_CAPITAL_MOVED_MICROS = 0 as const;
const NON_EXECUTION_ORDERS_PLACED = 0 as const;
const RESEARCH_PATH_WALLET_ACCESSED = false as const;

const outcomeSchema = z.object({
  outcome: z.string(),
  consensusProbability: probabilitySchema.nullable(),
  bestBid: probabilitySchema.nullable(),
  bestAsk: probabilitySchema.nullable(),
  spread: probabilitySchema.nullable()
});

const snapshotSchema = z.object({
  horizonMs: z.number().int(),
  book: z.object({
    outcomes: z.array(outcomeSchema)
  })
});

const marketSchema = z.object({
  marketKey: z.string().min(1),
  family: z.enum(["match_result", "total_goals"]),
  lineMilli: z.number().int().nullable(),
  firstMaterialMoveLatencyMs: z.number().int().nullable(),
  preTriggerFiveSecondMove: probabilitySchema.nullable(),
  classification: z.enum(["polymarket_moved_before_txline", "no_material_reprice_in_window"]),
  snapshots: z.array(snapshotSchema)
});

const studySchema = z.object({
  generatedAt: z.string().datetime(),
  status: z.literal("research_evidence_only"),
  tradeable: z.literal(false),
  fixtureId: z.string(),
  feedHealth: z.object({
    polymarketOutages: z.object({
      outages: z.array(z.object({
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime().nullable(),
        durationMs: z.number().int().nullable()
      })),
      totalDowntimeMs: z.number().int().nonnegative(),
      maximumDowntimeMs: z.number().int().nonnegative()
    })
  }),
  gateReadout: z.object({
    marketEventCases: z.number().int().nonnegative(),
    polymarketMovedBeforeTxline: z.number().int().nonnegative(),
    postTxlineRepriceObserved: z.number().int().nonnegative(),
    noMaterialRepriceInWindow: z.number().int().nonnegative(),
    staleQuoteHypothesis: z.literal("not_supported_by_this_match")
  }),
  goals: z.array(z.object({
    participant: z.number().int().nullable(),
    clockSeconds: z.number().int().nonnegative(),
    firstSeenObservedTsMs: z.number().int(),
    txlineFirstSeenLatencyMs: z.number().int(),
    markets: z.array(marketSchema)
  })).min(1)
});

const captureConfigSchema = z.object({
  captureId: z.literal(SPAIN_BELGIUM_MATCHROOM_ID),
  tradeable: z.literal(false),
  txline: z.object({
    fixtureId: z.string(),
    home: z.string(),
    away: z.string(),
    kickoffUtc: z.string().datetime()
  }),
  polymarket: z.object({
    eventSlug: z.string(),
    home: z.string(),
    away: z.string(),
    kickoffUtc: z.string().datetime(),
    matchResultRulesPeriod: z.literal("first_90_minutes_plus_stoppage_time")
  })
});

const manifestSchema = z.object({
  runId: z.literal(SPAIN_BELGIUM_MATCHROOM_ID),
  status: z.literal("verified"),
  fixtureId: z.string(),
  eventSlug: z.string(),
  verification: z.object({
    replayMode: z.literal("capture-order-per-source"),
    identityParity: z.literal(true),
    identityHash: z.string().regex(/^[a-f0-9]{64}$/),
    headHash: z.string().regex(/^[a-f0-9]{64}$/),
    rows: z.number().int().positive()
  })
});

type ParsedSnapshot = z.infer<typeof snapshotSchema>;
type ParsedStudy = z.infer<typeof studySchema>;
type ParsedGoal = ParsedStudy["goals"][number];
type ParsedMarket = ParsedGoal["markets"][number];
type ParsedCaptureConfig = z.infer<typeof captureConfigSchema>;
type ParsedManifest = z.infer<typeof manifestSchema>;

export const MATCHROOM_EXEMPLAR_SELECTION_POLICY =
  "earliest_pretrigger_match_result_then_largest_pretrigger_ask_move" as const;

export type SpainBelgiumFeasibilityCase = {
  caseId: string;
  goalOrdinal: number;
  goalClockSeconds: number;
  occurredAt: string;
  marketFamily: "match_result" | "total_goals";
  lineMilli: number | null;
  marketLabel: string;
  classification: "polymarket_moved_before_txline" | "no_material_reprice_in_window";
  preTriggerMarketMoveBps: number;
  selectedExemplar: boolean;
};

export type SpainBelgiumFeasibilityCorpus = {
  corpusCommitment: string;
  corpusAssurance: "local_file_sha256_not_capture_manifest_membership";
  generatedAt: string;
  fixtureId: string;
  home: { name: string; code: string };
  away: { name: string; code: string };
  goalEvents: number;
  marketEventCases: number;
  movedBeforeTxlineCases: number;
  noMaterialRepriceCases: number;
  cleanStaleWindows: 0;
  selectionPolicy: typeof MATCHROOM_EXEMPLAR_SELECTION_POLICY;
  selectedCaseId: string;
  cases: SpainBelgiumFeasibilityCase[];
};

const replayStateConfiguration: Record<ReplayStepId, {
  horizonMs: -5000 | 0 | 30000;
  label: string;
  conclusionTitle: string;
  conclusionBody: string;
  decisionExplanation: string;
}> = {
  pre: {
    horizonMs: -5000,
    label: "T−5 seconds",
    conclusionTitle: "Repricing had begun.",
    conclusionBody: "Polymarket was already moving before TXLine delivered the goal.",
    decisionExplanation: "The market was moving before the trigger entered Samaritan's event bus."
  },
  goal: {
    horizonMs: 0,
    label: "Goal first seen",
    conclusionTitle: "Polymarket moved first.",
    conclusionBody: "It repriced before TXLine delivered the goal. No stale quote remained.",
    decisionExplanation: "The candidate arrived after the market had already moved. This retrospective feasibility observation never entered an execution runtime."
  },
  post: {
    horizonMs: 30000,
    label: "T+30 seconds",
    conclusionTitle: "The window stayed invalid.",
    conclusionBody: "A tighter spread did not restore an opportunity that disappeared before the trigger.",
    decisionExplanation: "The spread tightened after repricing, but the candidate remained ineligible for execution."
  }
};

function requiredNumber(value: number | null, field: string): number {
  if (value === null) throw new Error(`Dashboard projection requires ${field}`);
  return value;
}

function bucketedConsensusMoveBps(value: number, baseline: number): number {
  const exactMoveBps = (value - baseline) * 10_000;
  const bucketed = Math.round(exactMoveBps / TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS) * TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS;
  return Object.is(bucketed, -0) ? 0 : bucketed;
}

function outcomeAt(snapshot: ParsedSnapshot, outcomeName: string): z.infer<typeof outcomeSchema> {
  const outcome = snapshot.book.outcomes.find((candidate) => candidate.outcome === outcomeName);
  if (!outcome) throw new Error(`Dashboard projection is missing ${outcomeName} outcome at ${snapshot.horizonMs}ms`);
  return outcome;
}

function findSnapshot(snapshots: readonly ParsedSnapshot[], horizonMs: number): ParsedSnapshot {
  const snapshot = snapshots.find((candidate) => candidate.horizonMs === horizonMs);
  if (!snapshot) throw new Error(`Dashboard projection is missing ${horizonMs}ms snapshot`);
  return snapshot;
}

function clockLabel(clockSeconds: number): string {
  const minutes = Math.floor(clockSeconds / 60);
  const seconds = clockSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}

function marketLabel(market: ParsedMarket): string {
  if (market.family === "match_result") {
    if (market.lineMilli !== null) throw new Error("Dashboard projection requires a null Match Result line");
    return "Match result";
  }
  if (market.lineMilli === null) throw new Error("Dashboard projection requires a totals line");
  return `Full-time total · O/U ${(market.lineMilli / 1_000).toFixed(1)}`;
}

function marketCaseId(fixtureId: string, goalOrdinal: number, market: ParsedMarket): string {
  const marketCode = market.family === "match_result" ? "MR" : `TG-${market.lineMilli ?? "UNKNOWN"}`;
  return `FX-${fixtureId}-G${goalOrdinal.toString().padStart(2, "0")}-${marketCode}`;
}

function orderedGoals(study: ParsedStudy): ParsedGoal[] {
  return [...study.goals].sort((left, right) =>
    left.firstSeenObservedTsMs - right.firstSeenObservedTsMs ||
    left.clockSeconds - right.clockSeconds
  );
}

function orderedMarkets(goal: ParsedGoal): ParsedMarket[] {
  return [...goal.markets].sort((left, right) => {
    if (left.family !== right.family) return left.family === "match_result" ? -1 : 1;
    return (left.lineMilli ?? -1) - (right.lineMilli ?? -1) || left.marketKey.localeCompare(right.marketKey);
  });
}

function selectExemplar(study: ParsedStudy): { goal: ParsedGoal; market: ParsedMarket; goalOrdinal: number } {
  for (const [goalIndex, goal] of orderedGoals(study).entries()) {
    const market = orderedMarkets(goal).find((candidate) =>
      candidate.family === "match_result" &&
      candidate.classification === "polymarket_moved_before_txline"
    );
    if (market) return { goal, market, goalOrdinal: goalIndex + 1 };
  }
  throw new Error("Dashboard projection requires a pre-trigger Match Result exemplar");
}

function selectExemplarOutcome(market: ParsedMarket): string {
  const pre = findSnapshot(market.snapshots, -5000);
  const trigger = findSnapshot(market.snapshots, 0);
  const candidates = pre.book.outcomes.flatMap((preOutcome) => {
    const triggerOutcome = trigger.book.outcomes.find((candidate) => candidate.outcome === preOutcome.outcome);
    if (!triggerOutcome || preOutcome.bestAsk === null || triggerOutcome.bestAsk === null) return [];
    return [{
      outcome: preOutcome.outcome,
      absoluteAskMove: Math.abs(triggerOutcome.bestAsk - preOutcome.bestAsk)
    }];
  }).sort((left, right) => right.absoluteAskMove - left.absoluteAskMove || left.outcome.localeCompare(right.outcome));
  const selected = candidates[0];
  if (!selected) throw new Error("Dashboard projection requires a comparable pre-trigger outcome");
  return selected.outcome;
}

function teamCodes(eventSlug: string): { home: string; away: string } {
  const match = /^fifwc-([a-z0-9]{3})-([a-z0-9]{3})-\d{4}-\d{2}-\d{2}$/i.exec(eventSlug);
  if (!match) throw new Error("Dashboard projection requires a canonical World Cup event slug");
  return { home: match[1]!.toUpperCase(), away: match[2]!.toUpperCase() };
}

function scoreAtGoal(goals: readonly ParsedGoal[], selected: ParsedGoal): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const goal of goals) {
    if (goal.firstSeenObservedTsMs > selected.firstSeenObservedTsMs) break;
    if (goal.participant === 1) home += 1;
    if (goal.participant === 2) away += 1;
  }
  return { home, away };
}

function scoringTeam(config: ParsedCaptureConfig, goal: ParsedGoal): string {
  if (goal.participant === 1) return config.txline.home;
  if (goal.participant === 2) return config.txline.away;
  throw new Error("Dashboard projection requires the selected goal's participant identity");
}

function verifyCorpus(study: ParsedStudy): void {
  const markets = study.goals.flatMap((goal) => goal.markets);
  const moved = markets.filter((market) => market.classification === "polymarket_moved_before_txline").length;
  const noMaterial = markets.filter((market) => market.classification === "no_material_reprice_in_window").length;
  if (
    markets.length !== study.gateReadout.marketEventCases ||
    moved !== study.gateReadout.polymarketMovedBeforeTxline ||
    noMaterial !== study.gateReadout.noMaterialRepriceInWindow ||
    moved + noMaterial !== markets.length ||
    study.gateReadout.postTxlineRepriceObserved !== 0
  ) {
    throw new Error("Dashboard projection failed closed: feasibility corpus does not reconcile with gate readout");
  }
  for (const market of markets) marketLabel(market);
}

async function loadProjectionEvidence(repoRoot: string): Promise<{
  study: ParsedStudy;
  config: ParsedCaptureConfig;
  manifest: ParsedManifest;
  corpusCommitment: string;
}> {
  const [studyRaw, configRaw, manifestRaw] = await Promise.all([
    readFile(resolve(repoRoot, "data/research/paired-spain-belgium-2026-07-10-live-lane.json"), "utf8"),
    readFile(resolve(repoRoot, "config/captures/spain-belgium-2026-07-10.json"), "utf8"),
    readFile(resolve(repoRoot, "data/live/paired-spain-belgium-2026-07-10/analysis-manifest.json"), "utf8")
  ]);
  const study = studySchema.parse(JSON.parse(studyRaw));
  const config = captureConfigSchema.parse(JSON.parse(configRaw));
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));

  if (
    study.fixtureId !== config.txline.fixtureId ||
    study.fixtureId !== manifest.fixtureId ||
    config.polymarket.eventSlug !== manifest.eventSlug ||
    config.txline.home !== config.polymarket.home ||
    config.txline.away !== config.polymarket.away ||
    config.txline.kickoffUtc !== config.polymarket.kickoffUtc
  ) {
    throw new Error("Dashboard projection failed closed: capture identity mismatch");
  }
  verifyCorpus(study);
  return {
    study,
    config,
    manifest,
    corpusCommitment: createHash("sha256").update(studyRaw).digest("hex")
  };
}

function createReplayState(
  id: ReplayStepId,
  snapshot: ParsedSnapshot,
  firstSeenObservedTsMs: number,
  consensusBaseline: number,
  outcomeName: string
): ReplayState {
  const configuration = replayStateConfiguration[id];
  const outcome = outcomeAt(snapshot, outcomeName);
  const consensusProbability = requiredNumber(outcome.consensusProbability, `${id} consensus probability`);
  const bestBid = requiredNumber(outcome.bestBid, `${id} best bid`);
  const bestAsk = requiredNumber(outcome.bestAsk, `${id} best ask`);
  return {
    id,
    label: configuration.label,
    offsetMs: configuration.horizonMs,
    observedAt: new Date(firstSeenObservedTsMs + configuration.horizonMs).toISOString(),
    consensusMoveFromBaselineBps: bucketedConsensusMoveBps(consensusProbability, consensusBaseline),
    bestBid,
    bestAsk,
    spread: requiredNumber(outcome.spread, `${id} spread`),
    conclusionTitle: configuration.conclusionTitle,
    conclusionBody: configuration.conclusionBody,
    decisionExplanation: configuration.decisionExplanation
  };
}

function createEvidence(
  states: Record<ReplayStepId, ReplayState>,
  scoringTeamName: string,
  goalClockLabel: string,
  outcomeName: string
): EvidenceRow[] {
  return [
    {
      replayStateId: "pre",
      observedAt: states.pre.observedAt,
      offsetLabel: "T−5.000s",
      source: "Polymarket",
      observation: `${titleCase(outcomeName)} ask begins repricing`,
      bestAsk: states.pre.bestAsk,
      assessment: "Moved first"
    },
    {
      replayStateId: "goal",
      observedAt: states.goal.observedAt,
      offsetLabel: "First seen",
      source: "TXLine",
      observation: `${scoringTeamName} goal delivered at ${goalClockLabel}`,
      bestAsk: states.goal.bestAsk,
      assessment: "Pass"
    },
    {
      replayStateId: "post",
      observedAt: states.post.observedAt,
      offsetLabel: "T+30.000s",
      source: "Samaritan",
      observation: "Spread tightens after repricing",
      bestAsk: states.post.bestAsk,
      assessment: "No trade"
    }
  ];
}

export async function buildSpainBelgiumFeasibilityCorpus(repoRoot: string): Promise<SpainBelgiumFeasibilityCorpus> {
  const { study, config, manifest, corpusCommitment } = await loadProjectionEvidence(repoRoot);
  const goals = orderedGoals(study);
  const exemplar = selectExemplar(study);
  const codes = teamCodes(manifest.eventSlug);
  const selectedCaseId = marketCaseId(study.fixtureId, exemplar.goalOrdinal, exemplar.market);
  const cases = goals.flatMap((goal, goalIndex) => orderedMarkets(goal).map((market) => {
    const goalOrdinal = goalIndex + 1;
    const caseId = marketCaseId(study.fixtureId, goalOrdinal, market);
    return {
      caseId,
      goalOrdinal,
      goalClockSeconds: goal.clockSeconds,
      occurredAt: new Date(goal.firstSeenObservedTsMs).toISOString(),
      marketFamily: market.family,
      lineMilli: market.lineMilli,
      marketLabel: marketLabel(market),
      classification: market.classification,
      preTriggerMarketMoveBps: Math.round(requiredNumber(market.preTriggerFiveSecondMove, "case pre-trigger move") * 10_000),
      selectedExemplar: caseId === selectedCaseId
    } satisfies SpainBelgiumFeasibilityCase;
  }));
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) {
    throw new Error("Dashboard projection failed closed: duplicate feasibility case identity");
  }
  if (cases.filter((item) => item.selectedExemplar).length !== 1) {
    throw new Error("Dashboard projection failed closed: selected exemplar is not unique");
  }
  return {
    corpusCommitment,
    corpusAssurance: "local_file_sha256_not_capture_manifest_membership",
    generatedAt: study.generatedAt,
    fixtureId: study.fixtureId,
    home: { name: config.txline.home, code: codes.home },
    away: { name: config.txline.away, code: codes.away },
    goalEvents: goals.length,
    marketEventCases: study.gateReadout.marketEventCases,
    movedBeforeTxlineCases: study.gateReadout.polymarketMovedBeforeTxline,
    noMaterialRepriceCases: study.gateReadout.noMaterialRepriceInWindow,
    cleanStaleWindows: 0,
    selectionPolicy: MATCHROOM_EXEMPLAR_SELECTION_POLICY,
    selectedCaseId,
    cases
  };
}

export async function buildSpainBelgiumMatchroomSnapshot(repoRoot: string): Promise<MatchroomSnapshot> {
  const { study, config, manifest, corpusCommitment } = await loadProjectionEvidence(repoRoot);
  const goals = orderedGoals(study);
  const exemplar = selectExemplar(study);
  const selectedOutcome = selectExemplarOutcome(exemplar.market);
  const codes = teamCodes(manifest.eventSlug);
  const score = scoreAtGoal(goals, exemplar.goal);
  const selectedGoalClockLabel = clockLabel(exemplar.goal.clockSeconds);
  const consensusBaseline = requiredNumber(
    outcomeAt(findSnapshot(exemplar.market.snapshots, -5000), selectedOutcome).consensusProbability,
    "consensus movement baseline"
  );
  const states = {
    pre: createReplayState("pre", findSnapshot(exemplar.market.snapshots, -5000), exemplar.goal.firstSeenObservedTsMs, consensusBaseline, selectedOutcome),
    goal: createReplayState("goal", findSnapshot(exemplar.market.snapshots, 0), exemplar.goal.firstSeenObservedTsMs, consensusBaseline, selectedOutcome),
    post: createReplayState("post", findSnapshot(exemplar.market.snapshots, 30000), exemplar.goal.firstSeenObservedTsMs, consensusBaseline, selectedOutcome)
  } satisfies Record<ReplayStepId, ReplayState>;

  const chart: PublicBookPoint[] = exemplar.market.snapshots.map((snapshot) => {
    const outcome = outcomeAt(snapshot, selectedOutcome);
    return {
      offsetMs: snapshot.horizonMs,
      bestBid: requiredNumber(outcome.bestBid, "chart best bid"),
      bestAsk: requiredNumber(outcome.bestAsk, "chart best ask"),
      spread: requiredNumber(outcome.spread, "chart spread"),
      available: true
    };
  });

  const firstSeenAt = new Date(exemplar.goal.firstSeenObservedTsMs).toISOString();
  const windowStart = exemplar.goal.firstSeenObservedTsMs - 5000;
  const windowEnd = exemplar.goal.firstSeenObservedTsMs + 30000;
  const availabilityGaps = study.feedHealth.polymarketOutages.outages.flatMap((outage) => {
    if (outage.endedAt === null || outage.durationMs === null) return [];
    const start = Date.parse(outage.startedAt);
    const end = Date.parse(outage.endedAt);
    return end < windowStart || start > windowEnd ? [] : [{
      startedAt: outage.startedAt,
      endedAt: outage.endedAt,
      durationMs: outage.durationMs
    }];
  });

  return {
    schemaVersion: 2,
    snapshotId: SPAIN_BELGIUM_MATCHROOM_ID,
    caseId: marketCaseId(study.fixtureId, exemplar.goalOrdinal, exemplar.market),
    casebookCaseCount: study.gateReadout.marketEventCases,
    generatedAt: study.generatedAt,
    mode: "captured_replay",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    match: {
      fixtureId: study.fixtureId,
      eventSlug: manifest.eventSlug,
      competition: "World Cup",
      stage: "Captured fixture",
      kickoffUtc: config.txline.kickoffUtc,
      originalMatchDate: config.txline.kickoffUtc.slice(0, 10),
      home: { name: config.txline.home, code: codes.home },
      away: { name: config.txline.away, code: codes.away },
      scoreAtCursor: score,
      goalOrdinal: exemplar.goalOrdinal,
      clockSeconds: exemplar.goal.clockSeconds,
      clockLabel: selectedGoalClockLabel
    },
    market: {
      family: "match_result",
      outcome: selectedOutcome,
      label: `Match result · ${titleCase(selectedOutcome)}`,
      period: "90 minutes plus stoppage time",
      mappingStatus: "research_only"
    },
    replay: {
      firstSeenAt,
      firstSeenLatencyMs: exemplar.goal.txlineFirstSeenLatencyMs,
      firstMaterialMoveLatencyMs: requiredNumber(exemplar.market.firstMaterialMoveLatencyMs, "material move latency"),
      preTriggerMarketMoveBps: Math.round(requiredNumber(exemplar.market.preTriggerFiveSecondMove, "pre-trigger move") * 10_000),
      activeStateId: "goal",
      states: [states.pre, states.goal, states.post],
      chart,
      availabilityGaps
    },
    decision: {
      disposition: "no_trade",
      semanticStatus: "disciplined_pass",
      label: "No trade",
      primaryReason: "Market moved before signal",
      explanation: states.goal.decisionExplanation,
      capitalMovedMicros: NON_EXECUTION_CAPITAL_MOVED_MICROS,
      ordersPlaced: NON_EXECUTION_ORDERS_PLACED,
      walletAccessed: RESEARCH_PATH_WALLET_ACCESSED,
      stages: [
        { id: "signal", label: "Goal observed", detail: "STALE_QUOTE feasibility · research only", status: "complete", timingLabel: "+0ms" },
        { id: "evidence", label: "Evidence checked", detail: "First material update", status: "complete", timingLabel: `+${requiredNumber(exemplar.market.firstMaterialMoveLatencyMs, "material move latency")}ms` },
        { id: "pass", label: "Opportunity passed", detail: "No clean stale window", status: "passed", timingLabel: "Final" },
        { id: "execution", label: "Execution not reached", detail: "Research path ended before an execution runtime", status: "locked", timingLabel: "N/A" }
      ]
    },
    evidence: createEvidence(
      states,
      scoringTeam(config, exemplar.goal),
      selectedGoalClockLabel,
      selectedOutcome
    ),
    proof: {
      captureStatus: "verified",
      identityParity: manifest.verification.identityParity,
      identityHash: manifest.verification.identityHash,
      headHash: manifest.verification.headHash,
      canonicalEvents: manifest.verification.rows,
      replayMode: manifest.verification.replayMode,
      feedOutageCount: study.feedHealth.polymarketOutages.outages.length,
      feedDowntimeMs: study.feedHealth.polymarketOutages.totalDowntimeMs,
      maximumFeedDowntimeMs: study.feedHealth.polymarketOutages.maximumDowntimeMs,
      gateCases: study.gateReadout.marketEventCases,
      movedBeforeTxlineCases: study.gateReadout.polymarketMovedBeforeTxline,
      noMaterialRepriceCases: study.gateReadout.noMaterialRepriceInWindow,
      cleanStaleWindows: 0,
      corpusCommitment,
      corpusAssurance: "local_file_sha256_not_capture_manifest_membership"
    },
    publicDataPolicy: {
      derivedOnly: true,
      txlineProbabilityDisplay: "bucketed_movement_only",
      txlineMovementBucketBps: TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
      credentialsRequired: false,
      walletControlsExposed: false
    }
  };
}

export async function buildSpainBelgiumDashboardResponse(repoRoot: string): Promise<DashboardApiResponse> {
  return { data: await buildSpainBelgiumMatchroomSnapshot(repoRoot) };
}
