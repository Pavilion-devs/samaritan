import {
  CASEBOOK_SNAPSHOT_ID,
  SPAIN_BELGIUM_MATCHROOM_ID,
  type CasebookApiResponse,
  type CasebookCaseSummary,
  type CasebookSnapshot
} from "./public-contract.js";
import { buildSpainBelgiumMatchroomSnapshot } from "./projection.js";

export async function buildCasebookSnapshot(repoRoot: string): Promise<CasebookSnapshot> {
  const matchroom = await buildSpainBelgiumMatchroomSnapshot(repoRoot);
  if (
    matchroom.decision.disposition !== "no_trade" ||
    matchroom.decision.capitalMovedMicros !== 0 ||
    matchroom.decision.ordersPlaced !== 0 ||
    matchroom.decision.walletAccessed ||
    !matchroom.proof.identityParity
  ) {
    throw new Error("Casebook projection failed closed: verified refusal case changed");
  }
  const goal = matchroom.replay.states.find((state) => state.id === "goal");
  if (!goal) throw new Error("Casebook projection failed closed: selected case has no goal state");

  const summary: CasebookCaseSummary = {
    caseId: "ESP-BEL-01",
    matchroomId: SPAIN_BELGIUM_MATCHROOM_ID,
    occurredAt: matchroom.replay.firstSeenAt,
    fixtureId: matchroom.match.fixtureId,
    fixtureLabel: "Spain vs Belgium",
    homeCode: "ESP",
    awayCode: "BEL",
    marketFamily: "Match result",
    marketLabel: "Match result · Draw",
    detector: "STALE_QUOTE_FEASIBILITY",
    disposition: "No trade",
    executionOutcome: "Not executed",
    evidenceLane: "Research only",
    source: "Captured replay",
    verificationStatus: "Verified",
    reason: "Market moved before signal",
    preTriggerMarketMoveBps: matchroom.replay.preTriggerMarketMoveBps
  };

  return {
    schemaVersion: 2,
    snapshotId: CASEBOOK_SNAPSHOT_ID,
    generatedAt: matchroom.generatedAt,
    mode: "offline_artifact",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    statistics: {
      totalCases: 1,
      noTradeCases: 1,
      executedCases: 0,
      verifiedCases: 1,
      capitalMovedMicros: 0
    },
    filterOptions: {
      fixtures: [summary.fixtureLabel],
      marketFamilies: [summary.marketFamily],
      detectors: [summary.detector],
      dispositions: [summary.disposition],
      executionOutcomes: [summary.executionOutcome],
      evidenceLanes: [summary.evidenceLane],
      sources: [summary.source]
    },
    cases: [summary],
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
        costReason: "No order was constructed, so spread, slippage, and fee costs were not incurred."
      },
      evidence: matchroom.evidence,
      proof: matchroom.proof
    },
    nextEvidence: {
      status: "waiting_for_verified_capture",
      label: "One verified case, without survivorship filtering",
      detail: "New cases appear only after a paired capture passes identity, completeness, and replay verification."
    },
    publicDataPolicy: matchroom.publicDataPolicy
  };
}

export async function buildCasebookDashboardResponse(repoRoot: string): Promise<CasebookApiResponse> {
  return { data: await buildCasebookSnapshot(repoRoot) };
}
