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
  family: z.string(),
  firstMaterialMoveLatencyMs: z.number().int().nullable(),
  preTriggerFiveSecondMove: probabilitySchema.nullable(),
  classification: z.string(),
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
    decisionExplanation: "The candidate arrived after the market had already moved. Samaritan preserved capital."
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

function drawOutcome(snapshot: ParsedSnapshot): z.infer<typeof outcomeSchema> {
  const draw = snapshot.book.outcomes.find((outcome) => outcome.outcome === "draw");
  if (!draw) throw new Error(`Dashboard projection is missing draw outcome at ${snapshot.horizonMs}ms`);
  return draw;
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

function createReplayState(
  id: ReplayStepId,
  snapshot: ParsedSnapshot,
  firstSeenObservedTsMs: number,
  consensusBaseline: number
): ReplayState {
  const configuration = replayStateConfiguration[id];
  const draw = drawOutcome(snapshot);
  const consensusProbability = requiredNumber(draw.consensusProbability, `${id} consensus probability`);
  const bestBid = requiredNumber(draw.bestBid, `${id} best bid`);
  const bestAsk = requiredNumber(draw.bestAsk, `${id} best ask`);
  return {
    id,
    label: configuration.label,
    offsetMs: configuration.horizonMs,
    observedAt: new Date(firstSeenObservedTsMs + configuration.horizonMs).toISOString(),
    consensusMoveFromBaselineBps: bucketedConsensusMoveBps(consensusProbability, consensusBaseline),
    bestBid,
    bestAsk,
    spread: requiredNumber(draw.spread, `${id} spread`),
    conclusionTitle: configuration.conclusionTitle,
    conclusionBody: configuration.conclusionBody,
    decisionExplanation: configuration.decisionExplanation
  };
}

function createEvidence(states: Record<ReplayStepId, ReplayState>): EvidenceRow[] {
  return [
    {
      replayStateId: "pre",
      observedAt: states.pre.observedAt,
      offsetLabel: "T−5.000s",
      source: "Polymarket",
      observation: "Draw ask begins repricing",
      bestAsk: states.pre.bestAsk,
      assessment: "Moved first"
    },
    {
      replayStateId: "goal",
      observedAt: states.goal.observedAt,
      offsetLabel: "First seen",
      source: "TXLine",
      observation: "Spain goal delivered at 29:21",
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

export async function buildSpainBelgiumMatchroomSnapshot(repoRoot: string): Promise<MatchroomSnapshot> {
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

  const firstGoal = study.goals[0]!;
  if (firstGoal.participant !== 1 || firstGoal.clockSeconds !== 1761) {
    throw new Error("Dashboard projection failed closed: first goal identity changed");
  }
  const matchResult = firstGoal.markets.find((market) => market.family === "match_result");
  if (!matchResult || matchResult.classification !== "polymarket_moved_before_txline") {
    throw new Error("Dashboard projection requires verified pre-trigger match-result repricing");
  }
  if (study.gateReadout.postTxlineRepriceObserved !== 0) {
    throw new Error("Dashboard projection failed closed: clean stale-window result changed");
  }

  const consensusBaseline = requiredNumber(
    drawOutcome(findSnapshot(matchResult.snapshots, -5000)).consensusProbability,
    "consensus movement baseline"
  );
  const states = {
    pre: createReplayState("pre", findSnapshot(matchResult.snapshots, -5000), firstGoal.firstSeenObservedTsMs, consensusBaseline),
    goal: createReplayState("goal", findSnapshot(matchResult.snapshots, 0), firstGoal.firstSeenObservedTsMs, consensusBaseline),
    post: createReplayState("post", findSnapshot(matchResult.snapshots, 30000), firstGoal.firstSeenObservedTsMs, consensusBaseline)
  } satisfies Record<ReplayStepId, ReplayState>;

  const chart: PublicBookPoint[] = matchResult.snapshots.map((snapshot) => {
    const draw = drawOutcome(snapshot);
    return {
      offsetMs: snapshot.horizonMs,
      bestBid: requiredNumber(draw.bestBid, "chart best bid"),
      bestAsk: requiredNumber(draw.bestAsk, "chart best ask"),
      spread: requiredNumber(draw.spread, "chart spread"),
      available: true
    };
  });

  const firstSeenAt = new Date(firstGoal.firstSeenObservedTsMs).toISOString();
  const windowStart = firstGoal.firstSeenObservedTsMs - 5000;
  const windowEnd = firstGoal.firstSeenObservedTsMs + 30000;
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
    generatedAt: study.generatedAt,
    mode: "captured_replay",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    match: {
      fixtureId: study.fixtureId,
      eventSlug: manifest.eventSlug,
      competition: "World Cup",
      stage: "Round of 16",
      kickoffUtc: config.txline.kickoffUtc,
      originalMatchDate: config.txline.kickoffUtc.slice(0, 10),
      home: { name: config.txline.home, code: "ESP" },
      away: { name: config.txline.away, code: "BEL" },
      scoreAtCursor: { home: 1, away: 0 },
      clockSeconds: firstGoal.clockSeconds,
      clockLabel: clockLabel(firstGoal.clockSeconds)
    },
    market: {
      family: "match_result",
      outcome: "draw",
      label: "Match result · Draw",
      period: "90 minutes plus stoppage time",
      mappingStatus: "research_only"
    },
    replay: {
      firstSeenAt,
      firstSeenLatencyMs: firstGoal.txlineFirstSeenLatencyMs,
      firstMaterialMoveLatencyMs: requiredNumber(matchResult.firstMaterialMoveLatencyMs, "material move latency"),
      preTriggerMarketMoveBps: Math.round(requiredNumber(matchResult.preTriggerFiveSecondMove, "pre-trigger move") * 10_000),
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
      capitalMovedMicros: 0,
      ordersPlaced: 0,
      walletAccessed: false,
      stages: [
        { id: "signal", label: "Goal observed", detail: "STALE_QUOTE feasibility · research only", status: "complete", timingLabel: "+0ms" },
        { id: "evidence", label: "Evidence checked", detail: "First material update", status: "complete", timingLabel: `+${requiredNumber(matchResult.firstMaterialMoveLatencyMs, "material move latency")}ms` },
        { id: "pass", label: "Opportunity passed", detail: "No clean stale window", status: "passed", timingLabel: "Final" },
        { id: "execution", label: "Execution not reached", detail: "Gate remained closed", status: "locked", timingLabel: "$0.00" }
      ]
    },
    evidence: createEvidence(states),
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
      cleanStaleWindows: 0
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
