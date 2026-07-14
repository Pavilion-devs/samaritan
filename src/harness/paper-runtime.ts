import type { CanonicalEvent } from "../bus/events.js";
import { PAPER_STUDY_DETECTOR_CONFIG, PAPER_STUDY_FEATURE_CONFIG } from "../config/paper-study.js";
import { DetectorBank } from "../detectors/bank.js";
import {
  normalizeExecutableEconomicCases,
  type EconomicCaseNormalizationSummary
} from "../detectors/economic-cases.js";
import type { DetectorSignal } from "../detectors/types.js";
import { FeatureEngine, type FeatureSnapshot } from "../features/engine.js";
import type { PaperCloseResult, PaperCloseScheduler } from "../portfolio/paper-close-scheduler.js";
import type {
  PaperSettlementResult,
  PaperSettlementScheduler
} from "../portfolio/paper-settlement-scheduler.js";
import { PaperCaseScheduler } from "./paper-scheduler.js";
import type { PaperPipelineResult } from "./paper-pipeline.js";

export type FeatureProcessor = {
  ingest(event: CanonicalEvent): FeatureSnapshot[];
};

export type DetectorProcessor = {
  ingest(snapshot: FeatureSnapshot): DetectorSignal[];
};

export type PaperRuntimeBatch = {
  rawSignals: DetectorSignal[];
  /** Total Goals emissions normalized to actual executable BUY cases. */
  signals: DetectorSignal[];
  economicCaseNormalization: EconomicCaseNormalizationSummary;
  routedSignalIds: string[];
  caseResults: PaperPipelineResult[];
  closeResults: PaperCloseResult[];
  settlementResults: PaperSettlementResult[];
};

export class PaperStudyRuntime {
  constructor(readonly dependencies: {
    featureProcessor: FeatureProcessor;
    detectorProcessor: DetectorProcessor;
    scheduler: PaperCaseScheduler;
    closeScheduler?: PaperCloseScheduler;
    settlementScheduler?: PaperSettlementScheduler;
  }) {}

  async ingest(event: CanonicalEvent): Promise<PaperRuntimeBatch> {
    // Existing cases see this event before a signal created by the same event can be queued.
    const caseResults = await this.dependencies.scheduler.ingest(event);
    const closeResults = this.dependencies.closeScheduler?.ingest(event) ?? [];
    const settlementResults = this.dependencies.settlementScheduler?.ingest(event) ?? [];
    const rawSignals = this.dependencies.featureProcessor
      .ingest(event)
      .flatMap((snapshot) => this.dependencies.detectorProcessor.ingest(snapshot));
    const normalization = normalizeExecutableEconomicCases(rawSignals);
    const signals = normalization.signals;
    const routedSignalIds: string[] = [];
    for (const signal of signals) {
      if (await this.dependencies.scheduler.enqueue(signal)) routedSignalIds.push(signal.signalId);
    }
    return {
      rawSignals,
      signals,
      economicCaseNormalization: normalization.summary,
      routedSignalIds,
      caseResults,
      closeResults,
      settlementResults
    };
  }
}

export function createFrozenPaperStudyRuntime(
  scheduler: PaperCaseScheduler,
  lifecycle: {
    closeScheduler?: PaperCloseScheduler;
    settlementScheduler?: PaperSettlementScheduler;
  } = {}
): PaperStudyRuntime {
  return new PaperStudyRuntime({
    featureProcessor: new FeatureEngine(PAPER_STUDY_FEATURE_CONFIG),
    detectorProcessor: new DetectorBank(PAPER_STUDY_DETECTOR_CONFIG),
    scheduler,
    ...lifecycle
  });
}
