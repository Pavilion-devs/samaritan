export type BinaryClassification = {
  detector: string;
  predicted: boolean;
  actual: boolean;
};

export type ClassificationSummary = {
  detector: string;
  cases: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
};

export class ClassificationMetrics {
  readonly #cases: BinaryClassification[] = [];

  record(value: BinaryClassification): void {
    this.#cases.push(value);
  }

  summaries(): ClassificationSummary[] {
    const detectors = [...new Set(this.#cases.map((item) => item.detector))].sort();
    return detectors.map((detector) => {
      const cases = this.#cases.filter((item) => item.detector === detector);
      const truePositive = cases.filter((item) => item.predicted && item.actual).length;
      const falsePositive = cases.filter((item) => item.predicted && !item.actual).length;
      const trueNegative = cases.filter((item) => !item.predicted && !item.actual).length;
      const falseNegative = cases.filter((item) => !item.predicted && item.actual).length;
      const predictedPositive = truePositive + falsePositive;
      const actualPositive = truePositive + falseNegative;
      const actualNegative = trueNegative + falsePositive;
      return {
        detector,
        cases: cases.length,
        truePositive,
        falsePositive,
        trueNegative,
        falseNegative,
        precision: predictedPositive === 0 ? null : truePositive / predictedPositive,
        recall: actualPositive === 0 ? null : truePositive / actualPositive,
        falsePositiveRate: actualNegative === 0 ? null : falsePositive / actualNegative
      };
    });
  }
}

export function brierScore(probability: number, actual: boolean): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("Brier probability must be between 0 and 1");
  }
  return (probability - (actual ? 1 : 0)) ** 2;
}

export function closingLineValue(entryProbability: number, closingProbability: number): number {
  if (
    !Number.isFinite(entryProbability) ||
    !Number.isFinite(closingProbability) ||
    entryProbability < 0 ||
    entryProbability > 1 ||
    closingProbability < 0 ||
    closingProbability > 1
  ) {
    throw new RangeError("CLV probabilities must be between 0 and 1");
  }
  return closingProbability - entryProbability;
}
