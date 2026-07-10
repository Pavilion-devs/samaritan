import type { FeatureSnapshot } from "../features/engine.js";
import { ForwardOutcomeLabeler } from "./forward-labels.js";
import {
  DetectorThresholdGrid,
  type ThresholdGridResult
} from "./threshold-grid.js";

export class StreamingDetectorStudy {
  constructor(
    readonly grid: DetectorThresholdGrid,
    readonly labeler: ForwardOutcomeLabeler
  ) {}

  ingest(snapshot: FeatureSnapshot): void {
    const batch = this.labeler.ingest(snapshot);
    for (const caseId of batch.expiredCaseIds) this.grid.discard(caseId);
    for (const resolved of batch.resolved) this.grid.label(resolved.caseId, resolved.labels);
    if (batch.queuedCaseId === null) this.grid.ingest(snapshot);
    else {
      const predictedCaseId = this.grid.ingestDeferred(snapshot);
      if (predictedCaseId !== batch.queuedCaseId) {
        throw new Error(`Detector and forward-label case identities disagree: ${predictedCaseId}`);
      }
    }
  }

  finish(): ThresholdGridResult[] {
    for (const caseId of this.labeler.flush()) this.grid.discard(caseId);
    if (this.grid.pendingCaseCount !== 0) {
      throw new Error(`Detector study retained ${this.grid.pendingCaseCount} unresolved cases`);
    }
    return this.grid.results();
  }
}
