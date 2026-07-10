import type { SignalKind } from "../detectors/types.js";
import type { FeatureSnapshot } from "../features/engine.js";
import { detectorCaseId, type DetectorLabels } from "./threshold-grid.js";

export type ForwardLabelConfig = {
  horizonMs: number;
  maximumResolutionDelayMs: number;
  velocityWindowMs: number;
  minimumGapClosure: number;
  minimumPolymarketReversion: number;
  maximumConsensusMoveForFader: number;
  minimumPolymarketFollow: number;
  maximumConsensusReversal: number;
};

export type ResolvedForwardLabels = {
  caseId: string;
  labels: Record<SignalKind, boolean>;
  baseTsMs: number;
  resolvedAtTsMs: number;
};

export type ForwardLabelBatch = {
  queuedCaseId: string | null;
  resolved: ResolvedForwardLabels[];
  expiredCaseIds: string[];
};

type PendingCase = {
  caseId: string;
  baseTsMs: number;
  targetTsMs: number;
  consensusProbability: number;
  polymarketProbability: number;
  consensusVelocity: number | null;
};

type PendingQueue = { cases: PendingCase[]; cursor: number };

function seriesKey(snapshot: FeatureSnapshot): string {
  return `${snapshot.market.key}:${snapshot.outcome}`;
}

function sign(value: number | null): -1 | 0 | 1 {
  if (value === null || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

export class ForwardOutcomeLabeler {
  readonly #pending = new Map<string, PendingQueue>();

  constructor(readonly config: ForwardLabelConfig) {
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError(`Forward label parameter ${name} must be non-negative`);
    }
    if (config.horizonMs <= 0 || config.velocityWindowMs <= 0) {
      throw new RangeError("Forward label horizon and velocity window must be positive");
    }
  }

  ingest(snapshot: FeatureSnapshot): ForwardLabelBatch {
    const key = seriesKey(snapshot);
    const queue = this.#pending.get(key) ?? { cases: [], cursor: 0 };
    this.#pending.set(key, queue);
    const resolved: ResolvedForwardLabels[] = [];
    const expiredCaseIds: string[] = [];
    const futureConsensus = snapshot.consensus.probability;
    const futurePolymarket = snapshot.polymarket.probability;

    while (queue.cursor < queue.cases.length) {
      const pending = queue.cases[queue.cursor]!;
      if (snapshot.asOfTsMs < pending.targetTsMs) break;
      if (snapshot.asOfTsMs > pending.targetTsMs + this.config.maximumResolutionDelayMs) {
        expiredCaseIds.push(pending.caseId);
        queue.cursor += 1;
        continue;
      }
      if (futureConsensus === null || futurePolymarket === null || !snapshot.freshness.bothFresh) break;
      resolved.push(this.#resolve(pending, futureConsensus, futurePolymarket, snapshot.asOfTsMs));
      queue.cursor += 1;
    }

    if (queue.cursor > 1_024 && queue.cursor * 2 > queue.cases.length) {
      queue.cases.splice(0, queue.cursor);
      queue.cursor = 0;
    }

    let queuedCaseId: string | null = null;
    if (
      snapshot.consensus.probability !== null &&
      snapshot.polymarket.probability !== null &&
      snapshot.freshness.bothFresh
    ) {
      queuedCaseId = detectorCaseId(snapshot);
      const velocity = snapshot.consensus.velocities.find(
        (feature) => feature.windowMs === this.config.velocityWindowMs
      )?.velocity ?? null;
      queue.cases.push({
        caseId: queuedCaseId,
        baseTsMs: snapshot.asOfTsMs,
        targetTsMs: snapshot.asOfTsMs + this.config.horizonMs,
        consensusProbability: snapshot.consensus.probability,
        polymarketProbability: snapshot.polymarket.probability,
        consensusVelocity: velocity
      });
    }

    return { queuedCaseId, resolved, expiredCaseIds };
  }

  flush(): string[] {
    const caseIds: string[] = [];
    for (const queue of this.#pending.values()) {
      for (let index = queue.cursor; index < queue.cases.length; index += 1) {
        caseIds.push(queue.cases[index]!.caseId);
      }
    }
    this.#pending.clear();
    return caseIds;
  }

  #resolve(
    pending: PendingCase,
    futureConsensus: number,
    futurePolymarket: number,
    resolvedAtTsMs: number
  ): ResolvedForwardLabels {
    const initialGap = pending.consensusProbability - pending.polymarketProbability;
    const gapDirection = sign(initialGap);
    const futureGap = futureConsensus - futurePolymarket;
    const polymarketTowardConsensus =
      gapDirection * (futurePolymarket - pending.polymarketProbability);
    const consensusDelta = futureConsensus - pending.consensusProbability;
    const consensusDirection = sign(pending.consensusVelocity);
    const polymarketFollow =
      consensusDirection * (futurePolymarket - pending.polymarketProbability);
    const signedConsensusChange = consensusDirection * consensusDelta;
    const labels: Record<SignalKind, boolean> = {
      XMARKET_DIVERGENCE:
        gapDirection !== 0 &&
        Math.abs(futureGap) <= Math.abs(initialGap) - this.config.minimumGapClosure,
      FADER_CANDIDATE:
        gapDirection !== 0 &&
        polymarketTowardConsensus >= this.config.minimumPolymarketReversion &&
        Math.abs(consensusDelta) <= this.config.maximumConsensusMoveForFader,
      CONSENSUS_MOVE:
        consensusDirection !== 0 &&
        polymarketFollow >= this.config.minimumPolymarketFollow &&
        signedConsensusChange >= -this.config.maximumConsensusReversal
    };
    return { caseId: pending.caseId, labels, baseTsMs: pending.baseTsMs, resolvedAtTsMs };
  }
}
