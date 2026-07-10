import { createHash } from "node:crypto";
import { stableJson } from "../domain/json.js";
import type { FeatureSnapshot, VelocityFeature } from "../features/engine.js";
import type { DetectorSignal, SignalDirection, SignalKind } from "./types.js";

export type DetectorBankConfig = {
  velocityWindowMs: number;
  consensusMoveAbsZ: number;
  consensusCusumThreshold: number;
  consensusMinimumUpdates: number;
  consensusMinimumRawGap: number;
  consensusStableAbsZ: number;
  xmarketMinimumRawGap: number;
  xmarketPersistenceMs: number;
  faderPolymarketAbsZ: number;
  faderMinimumRawGap: number;
  faderPersistenceMs: number;
};

type PersistenceState = { startedAtTsMs: number; emitted: boolean };

function velocityAt(features: VelocityFeature[], windowMs: number): VelocityFeature | null {
  return features.find((feature) => feature.windowMs === windowMs) ?? null;
}

function eligibility(snapshot: FeatureSnapshot): DetectorSignal["eligibility"] {
  return snapshot.mappingStatus === "verified" && snapshot.polymarket.observation !== "sampled_history"
    ? "pretrade_review_required"
    : "research_only";
}

function signalId(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export class DetectorBank {
  readonly #persistence = new Map<string, PersistenceState>();
  readonly #active = new Set<string>();

  constructor(readonly config: DetectorBankConfig) {
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError(`Detector parameter ${name} must be non-negative`);
    }
    if (config.velocityWindowMs <= 0 || config.consensusMinimumUpdates < 1) {
      throw new RangeError("Detector velocity window and minimum updates must be positive");
    }
  }

  ingest(snapshot: FeatureSnapshot): DetectorSignal[] {
    const consensus = velocityAt(snapshot.consensus.velocities, this.config.velocityWindowMs);
    const polymarket = velocityAt(snapshot.polymarket.velocities, this.config.velocityWindowMs);
    if (
      snapshot.consensus.probability === null ||
      snapshot.polymarket.probability === null ||
      consensus === null ||
      polymarket === null
    ) {
      this.#clearForSnapshot(snapshot);
      return [];
    }
    return [
      this.#consensusMove(snapshot, consensus, polymarket),
      this.#xmarket(snapshot, consensus, polymarket),
      this.#fader(snapshot, consensus, polymarket)
    ].filter((signal): signal is DetectorSignal => signal !== null);
  }

  #consensusMove(
    snapshot: FeatureSnapshot,
    consensus: VelocityFeature,
    polymarket: VelocityFeature
  ): DetectorSignal | null {
    const direction: SignalDirection | null =
      consensus.zScore === null ? null : consensus.zScore > 0 ? "buy" : "sell";
    const gap = direction === "buy" ? snapshot.spread.rawBuyGap : snapshot.spread.rawSellGap;
    const cusum = direction === "buy" ? snapshot.consensus.cusumUp : snapshot.consensus.cusumDown;
    const key = this.#key("CONSENSUS_MOVE", snapshot, direction);
    const condition =
      direction !== null &&
      consensus.zScore !== null &&
      Math.abs(consensus.zScore) >= this.config.consensusMoveAbsZ &&
      cusum >= this.config.consensusCusumThreshold &&
      snapshot.consensus.updateCount >= this.config.consensusMinimumUpdates &&
      gap !== null &&
      gap >= this.config.consensusMinimumRawGap &&
      snapshot.freshness.bothFresh &&
      snapshot.scoreContext.length === 0;
    if (!condition || direction === null || gap === null) {
      this.#clearDetector(snapshot, "CONSENSUS_MOVE");
      return null;
    }
    this.#clearDetector(snapshot, "CONSENSUS_MOVE", key);
    if (this.#active.has(key)) return null;
    this.#active.add(key);
    return this.#signal(
      "CONSENSUS_MOVE",
      snapshot,
      direction,
      consensus,
      polymarket,
      gap,
      0,
      "StablePrice made an unusual persistent move while a live Polymarket gap remained."
    );
  }

  #xmarket(
    snapshot: FeatureSnapshot,
    consensus: VelocityFeature,
    polymarket: VelocityFeature
  ): DetectorSignal | null {
    const midGap = snapshot.spread.consensusMinusPolymarket;
    const direction: SignalDirection | null = midGap === null ? null : midGap >= 0 ? "buy" : "sell";
    const liveGap = direction === "buy" ? snapshot.spread.rawBuyGap : snapshot.spread.rawSellGap;
    const gap = liveGap ?? (midGap === null ? null : Math.abs(midGap));
    const key = this.#key("XMARKET_DIVERGENCE", snapshot, direction);
    const condition =
      direction !== null &&
      gap !== null &&
      gap >= this.config.xmarketMinimumRawGap &&
      consensus.zScore !== null &&
      Math.abs(consensus.zScore) <= this.config.consensusStableAbsZ &&
      snapshot.freshness.bothFresh &&
      snapshot.scoreContext.length === 0;
    if (!condition) this.#clearDetector(snapshot, "XMARKET_DIVERGENCE");
    else this.#clearDetector(snapshot, "XMARKET_DIVERGENCE", key);
    const persistence = this.#persist(key, condition, snapshot.asOfTsMs, this.config.xmarketPersistenceMs);
    if (!persistence.ready || direction === null || gap === null) return null;
    return this.#signal(
      "XMARKET_DIVERGENCE",
      snapshot,
      direction,
      consensus,
      polymarket,
      gap,
      persistence.durationMs,
      "Consensus stayed stable while a persistent cross-market probability gap remained."
    );
  }

  #fader(
    snapshot: FeatureSnapshot,
    consensus: VelocityFeature,
    polymarket: VelocityFeature
  ): DetectorSignal | null {
    const pmVelocity = polymarket.velocity;
    const consensusProbability = snapshot.consensus.probability!;
    const pmProbability = snapshot.polymarket.probability!;
    const pmMovedUpAway = pmVelocity !== null && pmVelocity > 0 && pmProbability > consensusProbability;
    const pmMovedDownAway = pmVelocity !== null && pmVelocity < 0 && pmProbability < consensusProbability;
    const direction: SignalDirection | null = pmMovedUpAway ? "sell" : pmMovedDownAway ? "buy" : null;
    const gap = Math.abs(consensusProbability - pmProbability);
    const key = this.#key("FADER_CANDIDATE", snapshot, direction);
    const condition =
      direction !== null &&
      polymarket.zScore !== null &&
      Math.abs(polymarket.zScore) >= this.config.faderPolymarketAbsZ &&
      consensus.zScore !== null &&
      Math.abs(consensus.zScore) <= this.config.consensusStableAbsZ &&
      gap >= this.config.faderMinimumRawGap &&
      snapshot.freshness.bothFresh &&
      snapshot.scoreContext.length === 0;
    if (!condition) this.#clearDetector(snapshot, "FADER_CANDIDATE");
    else this.#clearDetector(snapshot, "FADER_CANDIDATE", key);
    const persistence = this.#persist(key, condition, snapshot.asOfTsMs, this.config.faderPersistenceMs);
    if (!persistence.ready || direction === null) return null;
    return this.#signal(
      "FADER_CANDIDATE",
      snapshot,
      direction,
      consensus,
      polymarket,
      gap,
      persistence.durationMs,
      "Polymarket moved away from stable consensus without a score-event explanation."
    );
  }

  #persist(
    key: string,
    condition: boolean,
    nowTsMs: number,
    requiredMs: number
  ): { ready: boolean; durationMs: number } {
    if (!condition) {
      this.#persistence.delete(key);
      return { ready: false, durationMs: 0 };
    }
    let state = this.#persistence.get(key);
    if (!state) {
      state = { startedAtTsMs: nowTsMs, emitted: false };
      this.#persistence.set(key, state);
    }
    const durationMs = Math.max(0, nowTsMs - state.startedAtTsMs);
    if (state.emitted || durationMs < requiredMs) return { ready: false, durationMs };
    state.emitted = true;
    return { ready: true, durationMs };
  }

  #signal(
    kind: SignalKind,
    snapshot: FeatureSnapshot,
    direction: SignalDirection,
    consensus: VelocityFeature,
    polymarket: VelocityFeature,
    rawGap: number,
    persistenceMs: number,
    reason: string
  ): DetectorSignal {
    const identity = {
      kind,
      fixtureId: snapshot.fixtureId,
      marketKey: snapshot.market.key,
      outcome: snapshot.outcome,
      direction,
      detectedAtTsMs: snapshot.asOfTsMs,
      triggerEventId: snapshot.triggerEventId
    };
    return {
      signalId: signalId(identity),
      kind,
      detectedAtTsMs: snapshot.asOfTsMs,
      fixtureId: snapshot.fixtureId,
      market: snapshot.market,
      outcome: snapshot.outcome,
      direction,
      eligibility: eligibility(snapshot),
      reason,
      evidence: {
        consensusProbability: snapshot.consensus.probability!,
        polymarketProbability: snapshot.polymarket.probability!,
        consensusVelocity: consensus.velocity,
        consensusZScore: consensus.zScore,
        polymarketVelocity: polymarket.velocity,
        polymarketZScore: polymarket.zScore,
        cusumUp: snapshot.consensus.cusumUp,
        cusumDown: snapshot.consensus.cusumDown,
        rawGap,
        gapBasis:
          snapshot.polymarket.bestBid !== null && snapshot.polymarket.bestAsk !== null
            ? "live_book"
            : "sampled_history_proxy",
        persistenceMs,
        mappingStatus: snapshot.mappingStatus,
        scoreContextActions: snapshot.scoreContext.map((event) => event.action)
      }
    };
  }

  #key(kind: SignalKind, snapshot: FeatureSnapshot, direction: SignalDirection | null): string {
    return `${kind}:${snapshot.market.key}:${snapshot.outcome}:${direction ?? "none"}`;
  }

  #clearForSnapshot(snapshot: FeatureSnapshot): void {
    for (const kind of ["CONSENSUS_MOVE", "XMARKET_DIVERGENCE", "FADER_CANDIDATE"] as const) {
      for (const direction of ["buy", "sell", "none"] as const) {
        const key = `${kind}:${snapshot.market.key}:${snapshot.outcome}:${direction}`;
        this.#active.delete(key);
        this.#persistence.delete(key);
      }
    }
  }

  #clearDetector(snapshot: FeatureSnapshot, kind: SignalKind, keepKey?: string): void {
    for (const direction of ["buy", "sell", "none"] as const) {
      const key = `${kind}:${snapshot.market.key}:${snapshot.outcome}:${direction}`;
      if (key === keepKey) continue;
      this.#active.delete(key);
      this.#persistence.delete(key);
    }
  }
}
