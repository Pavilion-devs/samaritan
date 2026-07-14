import type { AnalystAgent, TriageAgent } from "../agents/contracts.js";
import { PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS } from "../config/paper-study.js";
import { OrderBookPaperExecutor } from "../exec/paper.js";
import { PaperCloseScheduler } from "../portfolio/paper-close-scheduler.js";
import { PaperSettlementScheduler } from "../portfolio/paper-settlement-scheduler.js";
import { PaperPortfolio } from "../portfolio/paper.js";
import { APPROVED_PAPER_RISK_CONFIG } from "../risk/paper.js";
import type { DecisionLedger } from "../store/decision-ledger.js";
import { stableJson } from "../domain/json.js";
import { PaperCasePipeline, type PaperStudyLane } from "./paper-pipeline.js";
import type { PaperFixtureEvidence, PaperFixtureUniverse } from "./paper-fixture-universe.js";
import { createFrozenPaperStudyRuntime, type PaperStudyRuntime } from "./paper-runtime.js";
import { PaperCaseScheduler, type PolymarketFeeResolver } from "./paper-scheduler.js";
import type { PaperStudyInitialization } from "./paper-study-ledger.js";
import { rehydratePaperState, type RehydratedPaperState } from "./paper-state-rehydrator.js";

export type PersistentPaperLaneRuntime = {
  lane: PaperStudyLane;
  initialization: PaperStudyInitialization;
  fixtures: PaperFixtureEvidence[];
  runtime: PaperStudyRuntime;
  scheduler: PaperCaseScheduler;
  portfolio: PaperPortfolio;
  eligibleMarketKeys: Set<string>;
  kickoffByFixtureId: Map<string, number>;
  rehydratedState: RehydratedPaperState;
};

export function eligiblePaperLaneFixtures(
  lane: PaperStudyLane,
  initialization: PaperStudyInitialization,
  universe: PaperFixtureUniverse
): PaperFixtureEvidence[] {
  return universe.fixtures.filter((fixture) => {
    const executable = fixture.capabilities.executablePaperReplay &&
      fixture.bountyLane.mode === "executable_book_replay" &&
      fixture.mappingStatus === "verified";
    if (lane === "bounty") return executable;
    return executable && fixture.longRunLane.eligible && fixture.kickoffTsMs >= initialization.startedAtTsMs;
  });
}

export type PaperFixtureAdmissionPlan = {
  lane: PaperStudyLane;
  fixtures: PaperFixtureEvidence[];
};

function executionIdentity(fixture: PaperFixtureEvidence): unknown {
  return {
    fixtureId: fixture.fixtureId,
    home: fixture.home,
    away: fixture.away,
    kickoffTsMs: fixture.kickoffTsMs,
    eventSlugs: fixture.eventSlugs,
    mappingStatus: fixture.mappingStatus,
    selectedTotal: fixture.selectedTotal,
    capabilities: fixture.capabilities,
    bountyLane: fixture.bountyLane,
    longRunLane: fixture.longRunLane
  };
}

export function planPaperFixtureAdmission(
  runtime: PersistentPaperLaneRuntime,
  universe: PaperFixtureUniverse
): PaperFixtureAdmissionPlan {
  if (universe.laneStartTsMs !== runtime.initialization.startedAtTsMs) {
    throw new Error("Refreshed fixture universe does not match the persistent lane start");
  }
  const candidates = eligiblePaperLaneFixtures(runtime.lane, runtime.initialization, universe);
  const candidateById = new Map(candidates.map((fixture) => [fixture.fixtureId, fixture]));
  for (const existing of runtime.fixtures) {
    const next = candidateById.get(existing.fixtureId);
    if (!next) throw new Error(`Refreshed universe removed admitted fixture ${existing.fixtureId}`);
    if (stableJson(executionIdentity(existing)) !== stableJson(executionIdentity(next))) {
      throw new Error(`Refreshed universe changed admitted fixture ${existing.fixtureId}`);
    }
  }
  const existingIds = new Set(runtime.fixtures.map((fixture) => fixture.fixtureId));
  const existingMarketOwners = new Map(runtime.fixtures.map((fixture) => [
    fixture.selectedTotal.marketKey,
    fixture.fixtureId
  ]));
  const additions = candidates
    .filter((fixture) => !existingIds.has(fixture.fixtureId))
    .sort((left, right) => left.kickoffTsMs - right.kickoffTsMs || left.fixtureId.localeCompare(right.fixtureId));
  for (const fixture of additions) {
    const owner = existingMarketOwners.get(fixture.selectedTotal.marketKey);
    if (owner && owner !== fixture.fixtureId) {
      throw new Error(`Market key collision between fixtures ${owner} and ${fixture.fixtureId}`);
    }
    existingMarketOwners.set(fixture.selectedTotal.marketKey, fixture.fixtureId);
  }
  return { lane: runtime.lane, fixtures: additions };
}

export function applyPaperFixtureAdmission(
  runtime: PersistentPaperLaneRuntime,
  plan: PaperFixtureAdmissionPlan
): string[] {
  if (plan.lane !== runtime.lane) throw new Error("Fixture admission plan lane mismatch");
  for (const fixture of plan.fixtures) {
    runtime.fixtures.push(structuredClone(fixture));
    runtime.eligibleMarketKeys.add(fixture.selectedTotal.marketKey);
    runtime.kickoffByFixtureId.set(fixture.fixtureId, fixture.kickoffTsMs);
  }
  return plan.fixtures.map((fixture) => fixture.fixtureId);
}

export function createPersistentPaperLaneRuntime(input: {
  lane: PaperStudyLane;
  initialization: PaperStudyInitialization;
  universe: PaperFixtureUniverse;
  ledger: DecisionLedger;
  triageAgent: TriageAgent;
  analystAgent: AnalystAgent;
  feeResolver: PolymarketFeeResolver;
  executionLatencyMs: number;
  maximumPendingMs: number;
  /** Knowledge-clock position at restart; defaults to the latest committed event. */
  rehydrationAsOfTsMs?: number;
  processingNow?: () => number;
}): PersistentPaperLaneRuntime {
  if (input.initialization.lane !== input.lane) {
    throw new Error("Paper runtime lane does not match its persistent ledger initialization");
  }
  if (input.initialization.realMoneyGate !== "closed") {
    throw new Error("Persistent paper runtime requires a closed real-money gate");
  }
  const committedEntries = input.ledger.entries();
  const studyEntries = committedEntries.filter((entry) => entry.kind === "study_initialized");
  if (
    studyEntries.length !== 1 ||
    stableJson(studyEntries[0]!.payload) !== stableJson(input.initialization)
  ) {
    throw new Error("Persistent paper runtime initialization does not match its committed study record");
  }
  const fixtures = eligiblePaperLaneFixtures(input.lane, input.initialization, input.universe);
  const kickoffByFixtureId = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture.kickoffTsMs]));
  const eligibleMarketKeys = new Set(fixtures.map((fixture) => fixture.selectedTotal.marketKey));
  const caseEntries = committedEntries.filter((entry) => entry.kind !== "study_initialized");
  const latestCommittedCaseTsMs = caseEntries.length === 0
    ? input.initialization.startedAtTsMs
    : Math.max(...caseEntries.map((entry) => entry.atTsMs));
  const rehydratedState = rehydratePaperState({
    ledger: input.ledger,
    lane: input.lane,
    bankrollMicroUsd: APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd,
    drawdownStopMicroUsd: APPROVED_PAPER_RISK_CONFIG.drawdownStopMicroUsd,
    maximumPendingMs: input.maximumPendingMs,
    kickoffByFixtureId,
    asOfTsMs: input.rehydrationAsOfTsMs ?? latestCommittedCaseTsMs
  });
  const pipeline = new PaperCasePipeline({
    triageAgent: input.triageAgent,
    analystAgent: input.analystAgent,
    riskConfig: APPROVED_PAPER_RISK_CONFIG,
    executor: new OrderBookPaperExecutor(),
    ledger: input.ledger
  });
  const portfolio = new PaperPortfolio({
    lane: input.lane,
    bankrollMicroUsd: APPROVED_PAPER_RISK_CONFIG.bankrollMicroUsd,
    drawdownStopMicroUsd: APPROVED_PAPER_RISK_CONFIG.drawdownStopMicroUsd,
    ledger: input.ledger,
    initialState: rehydratedState.portfolioInitialState
  });
  const scheduler = new PaperCaseScheduler({
    config: {
      lane: input.lane,
      executionLatencyMs: input.executionLatencyMs,
      maximumPendingMs: input.maximumPendingMs,
      minimumSignalToKickoffMs: PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS,
      eligibleMarketKeys,
      kickoffByFixtureId
    },
    pipeline,
    feeResolver: input.feeResolver,
    portfolio,
    initialState: rehydratedState.schedulerInitialState,
    ...(input.processingNow === undefined ? {} : { processingNow: input.processingNow })
  });
  const closeScheduler = new PaperCloseScheduler({ portfolio, kickoffByFixtureId });
  const settlementScheduler = new PaperSettlementScheduler(portfolio);
  return {
    lane: input.lane,
    initialization: input.initialization,
    fixtures,
    scheduler,
    portfolio,
    eligibleMarketKeys,
    kickoffByFixtureId,
    rehydratedState,
    runtime: createFrozenPaperStudyRuntime(scheduler, { closeScheduler, settlementScheduler })
  };
}
