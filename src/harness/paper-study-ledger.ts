import { createHash } from "node:crypto";
import type { JsonValue } from "../domain/json.js";
import { stableJson } from "../domain/json.js";
import { PAPER_STUDY_EVALUATION_CANDIDATE } from "../metrics/paper-study.js";
import { APPROVED_PAPER_RISK_CONFIG } from "../risk/paper.js";
import { POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS } from "../exec/paper.js";
import { DecisionLedger } from "../store/decision-ledger.js";
import {
  PAPER_STUDY_DETECTOR_CONFIG,
  PAPER_STUDY_ECONOMIC_CASE_CONFIG,
  PAPER_STUDY_FEATURE_CONFIG,
  PAPER_STUDY_HISTORICAL_EVIDENCE,
  PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS,
  PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS,
  PAPER_STUDY_TOTAL_SELECTOR_CONFIG
} from "../config/paper-study.js";
import type { PaperStudyLane } from "./paper-pipeline.js";

export const PAPER_STUDY_PROTOCOL_VERSION = "paper-study-v2-candidate-2026-07-14";
export const PAPER_STUDY_PROTOCOL_STATUS = "engineering_candidate_unregistered" as const;

export type PaperStudyInitialization = {
  protocolVersion: typeof PAPER_STUDY_PROTOCOL_VERSION;
  protocolStatus: typeof PAPER_STUDY_PROTOCOL_STATUS;
  lane: PaperStudyLane;
  startedAtTsMs: number;
  startedAt: string;
  configHash: string;
  realMoneyGate: "closed";
  frozenConfig: {
    feature: typeof PAPER_STUDY_FEATURE_CONFIG;
    detector: typeof PAPER_STUDY_DETECTOR_CONFIG;
    selector: typeof PAPER_STUDY_TOTAL_SELECTOR_CONFIG;
    selectorAsOfBeforeKickoffMs: typeof PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS;
    economicCases: typeof PAPER_STUDY_ECONOMIC_CASE_CONFIG;
    historicalEvidence: typeof PAPER_STUDY_HISTORICAL_EVIDENCE;
    minimumSignalToKickoffMs: number;
    executionTiming: {
      readinessClock: "observed_ts_ms";
      decisionLatency: "max_measured_or_minimum";
      venuePlacementDelayMs: typeof POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS;
    };
    risk: typeof APPROVED_PAPER_RISK_CONFIG;
    evaluation: typeof PAPER_STUDY_EVALUATION_CANDIDATE;
  };
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function frozenConfig(): PaperStudyInitialization["frozenConfig"] {
  return {
    feature: PAPER_STUDY_FEATURE_CONFIG,
    detector: PAPER_STUDY_DETECTOR_CONFIG,
    selector: PAPER_STUDY_TOTAL_SELECTOR_CONFIG,
    selectorAsOfBeforeKickoffMs: PAPER_STUDY_TOTAL_SELECTOR_AS_OF_BEFORE_KICKOFF_MS,
    economicCases: PAPER_STUDY_ECONOMIC_CASE_CONFIG,
    historicalEvidence: PAPER_STUDY_HISTORICAL_EVIDENCE,
    minimumSignalToKickoffMs: PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS,
    executionTiming: {
      readinessClock: "observed_ts_ms",
      decisionLatency: "max_measured_or_minimum",
      venuePlacementDelayMs: POLYMARKET_SPORTS_MARKETABLE_ORDER_DELAY_MS
    },
    risk: APPROVED_PAPER_RISK_CONFIG,
    evaluation: PAPER_STUDY_EVALUATION_CANDIDATE
  };
}

function initialization(lane: PaperStudyLane, startedAtTsMs: number): PaperStudyInitialization {
  if (!Number.isSafeInteger(startedAtTsMs) || startedAtTsMs < 0) {
    throw new Error("Paper study start must be non-negative integer milliseconds");
  }
  const config = frozenConfig();
  return {
    protocolVersion: PAPER_STUDY_PROTOCOL_VERSION,
    protocolStatus: PAPER_STUDY_PROTOCOL_STATUS,
    lane,
    startedAtTsMs,
    startedAt: new Date(startedAtTsMs).toISOString(),
    configHash: sha256(stableJson(config)),
    realMoneyGate: "closed",
    frozenConfig: config
  };
}

function parseInitialization(payload: JsonValue): PaperStudyInitialization {
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("Paper study initialization payload is malformed");
  }
  return payload as unknown as PaperStudyInitialization;
}

export function initializePaperStudyLedger(input: {
  path: string;
  lane: PaperStudyLane;
  startedAtTsMs: number;
  insertedAtNow?: () => number;
}): { ledger: DecisionLedger; initialization: PaperStudyInitialization; created: boolean } {
  const ledger = new DecisionLedger(input.path, {
    ...(input.insertedAtNow === undefined ? {} : { now: input.insertedAtNow })
  });
  const entries = ledger.entries();
  const existing = entries.find((entry) => entry.kind === "study_initialized");
  if (existing) {
    const value = parseInitialization(existing.payload);
    const expected = initialization(input.lane, value.startedAtTsMs);
    if (
      value.lane !== input.lane ||
      value.protocolVersion !== expected.protocolVersion ||
      value.protocolStatus !== expected.protocolStatus ||
      value.configHash !== expected.configHash ||
      value.realMoneyGate !== "closed" ||
      stableJson(value.frozenConfig) !== stableJson(expected.frozenConfig)
    ) {
      ledger.close();
      throw new Error(`Existing ${input.lane} paper-study ledger does not match the frozen protocol`);
    }
    return { ledger, initialization: value, created: false };
  }
  if (entries.length > 0) {
    ledger.close();
    throw new Error(`Cannot initialize non-empty ${input.lane} ledger without a study start record`);
  }
  const value = initialization(input.lane, input.startedAtTsMs);
  ledger.append({
    entryId: `study:${input.lane}:initialized:${PAPER_STUDY_PROTOCOL_VERSION}`,
    caseId: `study:${input.lane}`,
    kind: "study_initialized",
    atTsMs: input.startedAtTsMs,
    payload: JSON.parse(JSON.stringify(value)) as JsonValue
  });
  return { ledger, initialization: value, created: true };
}
