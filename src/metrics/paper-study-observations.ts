import type { DetectorSignal } from "../detectors/types.js";
import type { JsonValue } from "../domain/json.js";
import type { PaperStudyLane } from "../harness/paper-pipeline.js";
import type { PaperCloseMark, PaperPosition, PaperSettlement } from "../portfolio/paper.js";
import type { DecisionLedger } from "../store/decision-ledger.js";
import {
  evaluatePaperStudy,
  type PaperStudyEvaluationConfig,
  type PaperStudyObservation,
  type PaperStudyReport
} from "./paper-study.js";

function record(value: JsonValue): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Expected an object in the paper decision ledger");
  }
  return value;
}

function signalFromPayload(payload: JsonValue): { lane: PaperStudyLane; signal: DetectorSignal } {
  const value = record(payload);
  if (value["lane"] !== "bounty" && value["lane"] !== "long_run") {
    throw new Error("Signal ledger entry is missing its paper-study lane");
  }
  const signal = record(value["signal"] ?? null);
  const market = record(signal["market"] ?? null);
  if (
    typeof signal["signalId"] !== "string" ||
    typeof signal["fixtureId"] !== "string" ||
    typeof market["lineMilli"] !== "number"
  ) {
    throw new Error("Signal ledger entry is missing canonical identity fields");
  }
  return { lane: value["lane"], signal: signal as unknown as DetectorSignal };
}

export function buildPaperStudyObservations(input: {
  lane: PaperStudyLane;
  ledger: DecisionLedger;
  kickoffByFixtureId: ReadonlyMap<string, number>;
}): PaperStudyObservation[] {
  const entries = input.ledger.entries();
  const opened = new Map<string, PaperPosition>();
  const closed = new Map<string, PaperCloseMark>();
  const settled = new Map<string, PaperSettlement>();
  for (const entry of entries) {
    if (entry.kind === "position_opened") opened.set(entry.caseId, entry.payload as unknown as PaperPosition);
    if (entry.kind === "position_closed") closed.set(entry.caseId, entry.payload as unknown as PaperCloseMark);
    if (entry.kind === "position_settled") settled.set(entry.caseId, entry.payload as unknown as PaperSettlement);
  }
  return entries
    .filter((entry) => entry.kind === "signal_received")
    .map((entry) => {
      const { lane, signal } = signalFromPayload(entry.payload);
      if (lane !== input.lane) throw new Error("Decision ledger contains a different paper-study lane");
      const kickoffTsMs = input.kickoffByFixtureId.get(signal.fixtureId);
      if (kickoffTsMs === undefined) throw new Error(`Missing kickoff for fixture ${signal.fixtureId}`);
      if (signal.market.lineMilli === null) throw new Error("Paper-study signal is missing a totals line");
      const position = opened.get(entry.caseId);
      if (position && position.signalId !== signal.signalId) {
        throw new Error(`Position ${entry.caseId} does not match its ledgered signal`);
      }
      const closeMark = closed.get(entry.caseId) ?? null;
      const settlement = settled.get(entry.caseId) ?? null;
      return {
        caseId: entry.caseId,
        lane,
        fixtureId: signal.fixtureId,
        kickoffTsMs,
        selectedLineMilli: signal.market.lineMilli,
        signalId: signal.signalId,
        fill: position ? {
          status: position.fillStatus,
          entryCostMicroUsd: position.entryCostMicroUsd,
          halfSpreadBps: position.entryHalfSpreadBps,
          slippageBps: position.entrySlippageBps,
          selectedDepthUsd: position.selectedDepthUsd,
          grossClvBps: closeMark?.grossMidpointClvBps ?? null,
          netClvBps: closeMark?.netMidpointClvBps ?? null,
          executableLiquidationClvBps: closeMark?.executableLiquidationClvBps ?? null,
          settledAtTsMs: settlement?.settledAtTsMs ?? null,
          settlementPnlMicroUsd: settlement?.pnlMicroUsd ?? null
        } : null
      } satisfies PaperStudyObservation;
    });
}

export function evaluatePaperStudyLedger(input: {
  lane: PaperStudyLane;
  ledger: DecisionLedger;
  kickoffByFixtureId: ReadonlyMap<string, number>;
  config?: PaperStudyEvaluationConfig;
}): PaperStudyReport {
  const observations = buildPaperStudyObservations(input);
  return evaluatePaperStudy({
    lane: input.lane,
    observations,
    ...(input.config === undefined ? {} : { config: input.config })
  });
}
