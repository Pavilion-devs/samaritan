import {
  CASEBOOK_SNAPSHOT_ID,
  type CasebookApiResponse,
  type CasebookCaseSummary,
  type CasebookSnapshot
} from "./public-contract.js";
import {
  buildSpainBelgiumFeasibilityCorpus,
  buildSpainBelgiumMatchroomSnapshot
} from "./projection.js";

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export async function buildCasebookSnapshot(repoRoot: string): Promise<CasebookSnapshot> {
  const [matchroom, corpus] = await Promise.all([
    buildSpainBelgiumMatchroomSnapshot(repoRoot),
    buildSpainBelgiumFeasibilityCorpus(repoRoot)
  ]);
  if (
    matchroom.decision.disposition !== "no_trade" ||
    matchroom.decision.capitalMovedMicros !== 0 ||
    matchroom.decision.ordersPlaced !== 0 ||
    matchroom.decision.walletAccessed ||
    !matchroom.proof.identityParity
  ) {
    throw new Error("Casebook projection failed closed: verified refusal case changed");
  }
  if (
    corpus.marketEventCases !== corpus.cases.length ||
    corpus.marketEventCases !== matchroom.proof.gateCases ||
    corpus.marketEventCases !== matchroom.casebookCaseCount ||
    corpus.selectedCaseId !== matchroom.caseId ||
    corpus.corpusCommitment !== matchroom.proof.corpusCommitment
  ) {
    throw new Error("Casebook projection failed closed: corpus and exemplar do not reconcile");
  }
  const goal = matchroom.replay.states.find((state) => state.id === "goal");
  if (!goal) throw new Error("Casebook projection failed closed: selected case has no goal state");

  const cases: CasebookCaseSummary[] = corpus.cases.map((item) => ({
    caseId: item.caseId,
    matchroomId: item.selectedExemplar ? matchroom.snapshotId : null,
    selectedExemplar: item.selectedExemplar,
    goalOrdinal: item.goalOrdinal,
    goalClockSeconds: item.goalClockSeconds,
    occurredAt: item.occurredAt,
    fixtureRef: corpus.fixtureRef,
    fixtureLabel: `${corpus.home.name} vs ${corpus.away.name}`,
    homeCode: corpus.home.code,
    awayCode: corpus.away.code,
    marketFamily: item.marketFamily === "match_result" ? "Match result" : "Full-time total",
    marketLabel: item.marketLabel,
    lineMilli: item.lineMilli,
    classification: item.classification,
    detector: "STALE_QUOTE_FEASIBILITY",
    disposition: "No trade",
    executionOutcome: "Not executed",
    evidenceLane: "Research only",
    source: "Captured replay",
    verificationStatus: "Internally reconciled",
    reason: item.classification === "polymarket_moved_before_txline"
      ? "Market moved before TXLine"
      : "No material move within 30s",
    preTriggerMarketMoveBps: item.preTriggerMarketMoveBps
  }));
  const summary = cases.find((item) => item.caseId === corpus.selectedCaseId);
  if (!summary) throw new Error("Casebook projection failed closed: selected exemplar is absent from corpus");

  return {
    schemaVersion: 3,
    snapshotId: CASEBOOK_SNAPSHOT_ID,
    generatedAt: matchroom.generatedAt,
    mode: "offline_artifact",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    statistics: {
      totalCases: cases.length,
      noTradeCases: cases.length,
      executedCases: 0,
      reconciledCases: cases.length,
      capitalMovedMicros: matchroom.decision.capitalMovedMicros
    },
    corpus: {
      unit: "goal_market_feasibility_observation",
      coverage: "all_reported_goal_market_cases",
      captureReplays: 1,
      fixtureCount: 1,
      goalEvents: corpus.goalEvents,
      marketEventCases: corpus.marketEventCases,
      movedBeforeTxlineCases: corpus.movedBeforeTxlineCases,
      noMaterialRepriceCases: corpus.noMaterialRepriceCases,
      cleanStaleWindows: corpus.cleanStaleWindows,
      commitment: corpus.corpusCommitment,
      assurance: corpus.corpusAssurance,
      selectedExemplar: {
        caseId: corpus.selectedCaseId,
        policy: corpus.selectionPolicy,
        detail: "The detail pane is one deterministic Match Result exemplar; the index still contains every reported goal×market observation."
      }
    },
    filterOptions: {
      fixtures: uniqueSorted(cases.map((item) => item.fixtureLabel)),
      marketFamilies: uniqueSorted(cases.map((item) => item.marketFamily)),
      detectors: uniqueSorted(cases.map((item) => item.detector)),
      dispositions: uniqueSorted(cases.map((item) => item.disposition)),
      executionOutcomes: uniqueSorted(cases.map((item) => item.executionOutcome)),
      evidenceLanes: uniqueSorted(cases.map((item) => item.evidenceLane)),
      sources: uniqueSorted(cases.map((item) => item.source))
    },
    cases,
    selectedCase: {
      summary,
      match: matchroom.match,
      decision: matchroom.decision,
      lifecycle: matchroom.decision.stages,
      evidenceReadout: {
        consensusMoveFromBaselineBps: goal.consensusMoveFromBaselineBps,
        bestBid: goal.bestBid,
        bestAsk: goal.bestAsk,
        spread: goal.spread,
        preTriggerMarketMoveBps: matchroom.replay.preTriggerMarketMoveBps,
        movementConclusion: "Polymarket moved before TXLine"
      },
      analysis: {
        thesisStatus: "not_requested",
        thesisReason: "The deterministic evidence gate rejected the opportunity before analyst escalation.",
        invalidation: "The apparent gap is invalid if the executable market repriced before the signal reached Samaritan.",
        costStatus: "not_applicable",
        costMicros: 0,
        costReason: "Execution was outside this retrospective research lane, so no operational cost calculation ran."
      },
      evidence: matchroom.evidence,
      proof: matchroom.proof
    },
    nextEvidence: {
      status: "waiting_for_verified_capture",
      label: `Current ${cases.length}-observation corpus is complete`,
      detail: "New observations appear only after another paired capture passes identity, completeness, and replay verification."
    },
    publicDataPolicy: matchroom.publicDataPolicy
  };
}

export async function buildCasebookDashboardResponse(repoRoot: string): Promise<CasebookApiResponse> {
  return { data: await buildCasebookSnapshot(repoRoot) };
}
