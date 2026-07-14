import { createHash } from "node:crypto";
import { DetectorBank, type DetectorBankConfig } from "../detectors/bank.js";
import {
  normalizeExecutableEconomicCases,
  type EconomicCaseNormalizationSummary
} from "../detectors/economic-cases.js";
import type { DetectorSignal, SignalKind } from "../detectors/types.js";
import { stableJson } from "../domain/json.js";
import type { FeatureSnapshot } from "../features/engine.js";
import {
  ClassificationMetrics,
  type ClassificationSummary
} from "./classification.js";

export type DetectorLabels = Partial<Record<SignalKind, boolean>>;

export function detectorCaseId(snapshot: FeatureSnapshot): string {
  return `${snapshot.triggerEventId}:${snapshot.market.key}:${snapshot.outcome}`;
}

export type ThresholdGridResult = {
  configId: string;
  config: DetectorBankConfig;
  snapshots: number;
  /** Executable economic cases after binary Total Goals normalization. */
  signalCounts: Record<SignalKind, number>;
  /** Raw detector emissions retained for audit, never for minimum-n gates. */
  rawSignalCounts: Record<SignalKind, number>;
  economicCaseNormalization: EconomicCaseNormalizationSummary;
  classification: ClassificationSummary[];
};

type GridEntry = {
  configId: string;
  config: DetectorBankConfig;
  bank: DetectorBank;
  metrics: ClassificationMetrics;
  snapshots: number;
  rawSignalCounts: Record<SignalKind, number>;
  rawSignals: Array<{ signal: DetectorSignal; caseId: string }>;
};

const signalKinds: SignalKind[] = [
  "CONSENSUS_MOVE",
  "XMARKET_DIVERGENCE",
  "FADER_CANDIDATE"
];

function configId(config: DetectorBankConfig): string {
  return createHash("sha256").update(stableJson(config)).digest("hex").slice(0, 16);
}

function emptySignalCounts(): Record<SignalKind, number> {
  return {
    CONSENSUS_MOVE: 0,
    XMARKET_DIVERGENCE: 0,
    FADER_CANDIDATE: 0
  };
}

export function expandDetectorThresholdGrid(
  base: DetectorBankConfig,
  dimensions: Partial<{ [Key in keyof DetectorBankConfig]: readonly number[] }>
): DetectorBankConfig[] {
  let configs: DetectorBankConfig[] = [{ ...base }];
  for (const key of Object.keys(dimensions).sort() as Array<keyof DetectorBankConfig>) {
    const values = dimensions[key];
    if (!values || values.length === 0) throw new Error(`Threshold grid dimension ${key} is empty`);
    configs = configs.flatMap((config) => values.map((value) => ({ ...config, [key]: value })));
  }
  const unique = new Map(configs.map((config) => [stableJson(config), config]));
  return [...unique.values()];
}

export class DetectorThresholdGrid {
  readonly #entries: GridEntry[];
  readonly #pendingPredictions = new Map<string, Map<string, Set<SignalKind>>>();
  readonly #labeledCaseIds = new Set<string>();

  constructor(configs: readonly DetectorBankConfig[]) {
    if (configs.length === 0) throw new Error("Threshold grid requires at least one detector configuration");
    const uniqueIds = new Set<string>();
    this.#entries = configs.map((config) => {
      const id = configId(config);
      if (uniqueIds.has(id)) throw new Error(`Duplicate detector configuration: ${id}`);
      uniqueIds.add(id);
      return {
        configId: id,
        config: { ...config },
        bank: new DetectorBank(config),
        metrics: new ClassificationMetrics(),
        snapshots: 0,
        rawSignalCounts: emptySignalCounts(),
        rawSignals: []
      };
    });
  }

  ingest(snapshot: FeatureSnapshot, labels: DetectorLabels = {}): void {
    const id = detectorCaseId(snapshot);
    const predictions = this.#predict(snapshot);
    this.#recordLabels(predictions, labels);
    this.#labeledCaseIds.add(id);
  }

  ingestDeferred(snapshot: FeatureSnapshot): string {
    const id = detectorCaseId(snapshot);
    if (this.#pendingPredictions.has(id)) throw new Error(`Duplicate deferred detector case: ${id}`);
    this.#pendingPredictions.set(id, this.#predict(snapshot));
    return id;
  }

  label(caseId: string, labels: DetectorLabels): void {
    const predictions = this.#pendingPredictions.get(caseId);
    if (!predictions) throw new Error(`Unknown deferred detector case: ${caseId}`);
    this.#recordLabels(predictions, labels);
    this.#pendingPredictions.delete(caseId);
    this.#labeledCaseIds.add(caseId);
  }

  discard(caseId: string): void {
    if (!this.#pendingPredictions.delete(caseId)) {
      throw new Error(`Unknown deferred detector case: ${caseId}`);
    }
  }

  get pendingCaseCount(): number {
    return this.#pendingPredictions.size;
  }

  #predict(snapshot: FeatureSnapshot): Map<string, Set<SignalKind>> {
    const predictions = new Map<string, Set<SignalKind>>();
    const caseId = detectorCaseId(snapshot);
    for (const entry of this.#entries) {
      entry.snapshots += 1;
      const signals = entry.bank.ingest(snapshot);
      const predictedKinds = new Set(signals.map((signal) => signal.kind));
      predictions.set(entry.configId, predictedKinds);
      for (const signal of signals) {
        entry.rawSignalCounts[signal.kind] += 1;
        entry.rawSignals.push({ signal, caseId });
      }
    }
    return predictions;
  }

  #recordLabels(predictions: Map<string, Set<SignalKind>>, labels: DetectorLabels): void {
    for (const entry of this.#entries) {
      const predictedKinds = predictions.get(entry.configId);
      if (!predictedKinds) throw new Error(`Missing predictions for detector config ${entry.configId}`);
      for (const kind of signalKinds) {
        const actual = labels[kind];
        if (actual === undefined) continue;
        entry.metrics.record({ detector: kind, predicted: predictedKinds.has(kind), actual });
      }
    }
  }

  results(): ThresholdGridResult[] {
    return this.#entries.map((entry) => {
      const labeledSignals = entry.rawSignals
        .filter((item) => this.#labeledCaseIds.has(item.caseId))
        .map((item) => item.signal);
      const normalization = normalizeExecutableEconomicCases(labeledSignals);
      const signalCounts = emptySignalCounts();
      for (const signal of normalization.signals) signalCounts[signal.kind] += 1;
      return {
        configId: entry.configId,
        config: { ...entry.config },
        snapshots: entry.snapshots,
        signalCounts,
        rawSignalCounts: { ...entry.rawSignalCounts },
        economicCaseNormalization: normalization.summary,
        classification: entry.metrics.summaries()
      };
    });
  }
}
