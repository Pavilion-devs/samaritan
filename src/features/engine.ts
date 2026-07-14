import type {
  CanonicalEvent,
  CanonicalMarket,
  CanonicalOutcome,
  MappingStatus,
  ScoreEvent
} from "../bus/events.js";
import type { Probability } from "../domain/probability.js";
import { EwmaMoments, RollingSeries, TwoSidedCusum, type EwmaObservation } from "./rolling.js";

export type FeatureEngineConfig = {
  velocityWindowsMs: readonly number[];
  velocityEwmaHalfLifeMs: number;
  cusumDriftProbability: number;
  scoreContextWindowMs: number;
  freshnessMaxAgeMs: number;
};

export type FeatureEngineDiagnostics = {
  rejectedSourceRegressions: {
    txline: number;
    polymarket: number;
  };
  rejectedObservedRegressions: {
    txline: number;
    polymarket: number;
  };
  rejectedInvalidTimestamps: number;
  sourceObservationDeltaMs: {
    txline: { minimum: number | null; maximum: number | null };
    polymarket: { minimum: number | null; maximum: number | null };
  };
};

export type VelocityFeature = EwmaObservation & {
  windowMs: number;
  velocity: number | null;
  accelerationPerSecond: number | null;
};

export type FeatureSnapshot = {
  triggerEventId: string;
  triggerSource: "txline" | "polymarket";
  /** Market/source clock for the event that caused this snapshot. */
  asOfTsMs: number;
  /** Knowledge clock: when Samaritan actually observed the triggering event. */
  observedAtTsMs: number;
  fixtureId: string;
  market: CanonicalMarket;
  outcome: CanonicalOutcome;
  mappingStatus: MappingStatus | null;
  consensus: {
    probability: Probability | null;
    sourceTsMs: number | null;
    updateCount: number;
    velocities: VelocityFeature[];
    cusumUp: number;
    cusumDown: number;
    devigCrossCheckProbability: number | null;
    devigDiscrepancy: number | null;
  };
  polymarket: {
    probability: Probability | null;
    sourceTsMs: number | null;
    updateCount: number;
    velocities: VelocityFeature[];
    bestBid: Probability | null;
    bestAsk: Probability | null;
    observation: string | null;
  };
  spread: {
    consensusMinusPolymarket: number | null;
    rawBuyGap: number | null;
    rawSellGap: number | null;
  };
  freshness: {
    txlineAgeMs: number | null;
    polymarketAgeMs: number | null;
    bothFresh: boolean;
    clockOrderHealthy: boolean;
  };
  scoreContext: Array<{
    action: string;
    confirmed: boolean | null;
    participant: number | null;
    sourceTsMs: number;
  }>;
};

type SourceState = {
  series: RollingSeries;
  moments: Map<number, EwmaMoments>;
  probability: Probability | null;
  sourceTsMs: number | null;
  updateCount: number;
  velocities: VelocityFeature[];
  previousVelocity: Map<number, { value: number; tsMs: number }>;
};

type OutcomeState = {
  fixtureId: string;
  market: CanonicalMarket;
  outcome: CanonicalOutcome;
  consensus: SourceState;
  polymarket: SourceState;
  cusum: TwoSidedCusum;
  cusumUp: number;
  cusumDown: number;
  bestBid: Probability | null;
  bestAsk: Probability | null;
  polymarketObservation: string | null;
  mappingStatus: MappingStatus | null;
  devigCrossCheckProbability: number | null;
  devigDiscrepancy: number | null;
};

function stateKey(market: CanonicalMarket, outcome: CanonicalOutcome): string {
  return `${market.key}:${outcome}`;
}

function bestBid(levels: Array<{ price: Probability }>): Probability | null {
  return levels.length === 0 ? null : (Math.max(...levels.map((level) => level.price)) as Probability);
}

function bestAsk(levels: Array<{ price: Probability }>): Probability | null {
  return levels.length === 0 ? null : (Math.min(...levels.map((level) => level.price)) as Probability);
}

export class FeatureEngine {
  readonly #states = new Map<string, OutcomeState>();
  readonly #scores = new Map<string, ScoreEvent[]>();
  readonly #lastObservedTsMs = new Map<"txline" | "polymarket", number>();
  readonly #retentionMs: number;
  readonly #diagnostics: FeatureEngineDiagnostics = {
    rejectedSourceRegressions: { txline: 0, polymarket: 0 },
    rejectedObservedRegressions: { txline: 0, polymarket: 0 },
    rejectedInvalidTimestamps: 0,
    sourceObservationDeltaMs: {
      txline: { minimum: null, maximum: null },
      polymarket: { minimum: null, maximum: null }
    }
  };

  constructor(readonly config: FeatureEngineConfig) {
    if (config.velocityWindowsMs.length === 0 || config.velocityWindowsMs.some((window) => window <= 0)) {
      throw new RangeError("At least one positive velocity window is required");
    }
    if (config.freshnessMaxAgeMs <= 0 || config.scoreContextWindowMs < 0) {
      throw new RangeError("Feature freshness must be positive and score context cannot be negative");
    }
    this.#retentionMs = Math.max(...config.velocityWindowsMs) + config.velocityEwmaHalfLifeMs * 2;
  }

  ingest(event: CanonicalEvent): FeatureSnapshot[] {
    if (!this.#acceptEventTimestamp(event)) return [];
    if (event.kind === "score.update") {
      const scores = this.#scores.get(event.fixtureId) ?? [];
      scores.push(event);
      this.#scores.set(
        event.fixtureId,
        scores.filter((score) => score.sourceTsMs >= event.sourceTsMs - this.config.scoreContextWindowMs * 2)
      );
      return [];
    }
    if (event.kind === "odds.quote") {
      const rawImplied = event.outcomes.map((outcome) => 1_000 / outcome.oddsX1000);
      const rawSum = rawImplied.reduce((sum, value) => sum + value, 0);
      return event.outcomes.flatMap((outcome, index) => {
        if (outcome.fairProbability === null) return [];
        const state = this.#state(event.fixtureId, event.market, outcome.outcome);
        if (!this.#updateSource(state.consensus, outcome.fairProbability, event.sourceTsMs, "txline")) {
          return [];
        }
        const crossCheck = rawSum > 0 ? rawImplied[index]! / rawSum : null;
        state.devigCrossCheckProbability = crossCheck;
        state.devigDiscrepancy = crossCheck === null ? null : Math.abs(outcome.fairProbability - crossCheck);
        const previous = state.consensus.series.latest;
        if (previous && previous.tsMs === event.sourceTsMs && state.consensus.updateCount > 1) {
          const deltaPoint = state.consensus.series.valueAtOrBefore(event.sourceTsMs - 1);
          if (deltaPoint) {
            const cusum = state.cusum.update(outcome.fairProbability - deltaPoint.value);
            state.cusumUp = cusum.up;
            state.cusumDown = cusum.down;
          }
        }
        return [this.#snapshot(state, event.eventId, event.source, event.sourceTsMs, event.observedTsMs)];
      });
    }
    if (event.kind === "polymarket.price") {
      if (event.tokenRole !== "canonical") return [];
      const state = this.#state(event.fixtureId, event.market, event.outcome);
      const proposedBid = event.bestBid ?? state.bestBid;
      const proposedAsk = event.bestAsk ?? state.bestAsk;
      const value =
        proposedBid !== null && proposedAsk !== null
          ? ((proposedBid + proposedAsk) / 2 as Probability)
          : event.price;
      if (value === null) {
        if (this.#isSourceRegression(state.polymarket, event.sourceTsMs, "polymarket")) return [];
      } else if (!this.#updateSource(state.polymarket, value, event.sourceTsMs, "polymarket")) {
        return [];
      }
      state.mappingStatus = event.mappingStatus;
      state.polymarketObservation = event.observation;
      state.bestBid = proposedBid;
      state.bestAsk = proposedAsk;
      return [this.#snapshot(state, event.eventId, event.source, event.sourceTsMs, event.observedTsMs)];
    }
    if (event.kind === "polymarket.book") {
      if (event.tokenRole !== "canonical") return [];
      const state = this.#state(event.fixtureId, event.market, event.outcome);
      const proposedBid = bestBid(event.bids);
      const proposedAsk = bestAsk(event.asks);
      if (proposedBid !== null && proposedAsk !== null) {
        if (
          !this.#updateSource(
            state.polymarket,
            ((proposedBid + proposedAsk) / 2) as Probability,
            event.sourceTsMs,
            "polymarket"
          )
        ) {
          return [];
        }
      } else if (this.#isSourceRegression(state.polymarket, event.sourceTsMs, "polymarket")) {
        return [];
      }
      state.mappingStatus = event.mappingStatus;
      state.polymarketObservation = "book";
      state.bestBid = proposedBid;
      state.bestAsk = proposedAsk;
      return [this.#snapshot(state, event.eventId, event.source, event.sourceTsMs, event.observedTsMs)];
    }
    return [];
  }

  diagnostics(): FeatureEngineDiagnostics {
    return structuredClone(this.#diagnostics);
  }

  #acceptEventTimestamp(event: CanonicalEvent): boolean {
    if (
      !Number.isSafeInteger(event.sourceTsMs) ||
      !Number.isSafeInteger(event.observedTsMs) ||
      event.sourceTsMs < 0 ||
      event.observedTsMs < 0
    ) {
      this.#diagnostics.rejectedInvalidTimestamps += 1;
      return false;
    }
    const previous = this.#lastObservedTsMs.get(event.source);
    if (previous !== undefined && event.observedTsMs < previous) {
      this.#diagnostics.rejectedObservedRegressions[event.source] += 1;
      return false;
    }
    this.#lastObservedTsMs.set(event.source, event.observedTsMs);
    const delta = event.observedTsMs - event.sourceTsMs;
    const deltas = this.#diagnostics.sourceObservationDeltaMs[event.source];
    deltas.minimum = deltas.minimum === null ? delta : Math.min(deltas.minimum, delta);
    deltas.maximum = deltas.maximum === null ? delta : Math.max(deltas.maximum, delta);
    return true;
  }

  #sourceState(): SourceState {
    return {
      series: new RollingSeries(this.#retentionMs),
      moments: new Map(
        this.config.velocityWindowsMs.map((window) => [
          window,
          new EwmaMoments(this.config.velocityEwmaHalfLifeMs)
        ])
      ),
      probability: null,
      sourceTsMs: null,
      updateCount: 0,
      previousVelocity: new Map(),
      velocities: this.config.velocityWindowsMs.map((windowMs) => ({
        windowMs,
        velocity: null,
        accelerationPerSecond: null,
        zScore: null,
        baselineMean: null,
        baselineStdDev: null
      }))
    };
  }

  #state(fixtureId: string, market: CanonicalMarket, outcome: CanonicalOutcome): OutcomeState {
    const key = stateKey(market, outcome);
    let state = this.#states.get(key);
    if (!state) {
      state = {
        fixtureId,
        market,
        outcome,
        consensus: this.#sourceState(),
        polymarket: this.#sourceState(),
        cusum: new TwoSidedCusum(this.config.cusumDriftProbability),
        cusumUp: 0,
        cusumDown: 0,
        bestBid: null,
        bestAsk: null,
        polymarketObservation: null,
        mappingStatus: null,
        devigCrossCheckProbability: null,
        devigDiscrepancy: null
      };
      this.#states.set(key, state);
    }
    return state;
  }

  #updateSource(
    source: SourceState,
    value: Probability,
    tsMs: number,
    sourceName: "txline" | "polymarket"
  ): boolean {
    const previous = source.series.latest;
    const added = source.series.add({ tsMs, value });
    if (!added.accepted) {
      this.#diagnostics.rejectedSourceRegressions[sourceName] += 1;
      return false;
    }
    source.probability = value;
    source.sourceTsMs = tsMs;
    source.updateCount += 1;
    source.velocities = this.config.velocityWindowsMs.map((windowMs) => {
      const anchor = source.series.valueAtOrBefore(tsMs - windowMs);
      if (!anchor || previous === null) {
        return {
          windowMs,
          velocity: null,
          accelerationPerSecond: null,
          zScore: null,
          baselineMean: null,
          baselineStdDev: null
        };
      }
      const velocity = value - anchor.value;
      const priorVelocity = source.previousVelocity.get(windowMs);
      const accelerationPerSecond =
        priorVelocity && tsMs > priorVelocity.tsMs
          ? (velocity - priorVelocity.value) / ((tsMs - priorVelocity.tsMs) / 1_000)
          : null;
      source.previousVelocity.set(windowMs, { value: velocity, tsMs });
      return {
        windowMs,
        velocity,
        accelerationPerSecond,
        ...source.moments.get(windowMs)!.observe(velocity, tsMs)
      };
    });
    return true;
  }

  #isSourceRegression(
    source: SourceState,
    tsMs: number,
    sourceName: "txline" | "polymarket"
  ): boolean {
    if (source.sourceTsMs === null || tsMs >= source.sourceTsMs) return false;
    this.#diagnostics.rejectedSourceRegressions[sourceName] += 1;
    return true;
  }

  #snapshot(
    state: OutcomeState,
    triggerEventId: string,
    triggerSource: "txline" | "polymarket",
    asOfTsMs: number,
    observedAtTsMs: number
  ): FeatureSnapshot {
    const txAge = state.consensus.sourceTsMs === null ? null : asOfTsMs - state.consensus.sourceTsMs;
    const pmAge = state.polymarket.sourceTsMs === null ? null : asOfTsMs - state.polymarket.sourceTsMs;
    const clockOrderHealthy = (txAge === null || txAge >= 0) && (pmAge === null || pmAge >= 0);
    const bothFresh =
      clockOrderHealthy &&
      txAge !== null &&
      pmAge !== null &&
      txAge <= this.config.freshnessMaxAgeMs &&
      pmAge <= this.config.freshnessMaxAgeMs;
    const consensus = state.consensus.probability;
    const polymarket = state.polymarket.probability;
    const scores = (this.#scores.get(state.fixtureId) ?? [])
      .filter((score) => score.sourceTsMs >= asOfTsMs - this.config.scoreContextWindowMs && score.sourceTsMs <= asOfTsMs)
      .map((score) => ({
        action: score.action,
        confirmed: score.confirmed,
        participant: score.participant,
        sourceTsMs: score.sourceTsMs
      }));
    return {
      triggerEventId,
      triggerSource,
      asOfTsMs,
      observedAtTsMs,
      fixtureId: state.fixtureId,
      market: state.market,
      outcome: state.outcome,
      mappingStatus: state.mappingStatus,
      consensus: {
        probability: consensus,
        sourceTsMs: state.consensus.sourceTsMs,
        updateCount: state.consensus.updateCount,
        velocities: state.consensus.velocities,
        cusumUp: state.cusumUp,
        cusumDown: state.cusumDown,
        devigCrossCheckProbability: state.devigCrossCheckProbability,
        devigDiscrepancy: state.devigDiscrepancy
      },
      polymarket: {
        probability: polymarket,
        sourceTsMs: state.polymarket.sourceTsMs,
        updateCount: state.polymarket.updateCount,
        velocities: state.polymarket.velocities,
        bestBid: state.bestBid,
        bestAsk: state.bestAsk,
        observation: state.polymarketObservation
      },
      spread: {
        consensusMinusPolymarket:
          consensus === null || polymarket === null ? null : consensus - polymarket,
        rawBuyGap: consensus === null || state.bestAsk === null ? null : consensus - state.bestAsk,
        rawSellGap: consensus === null || state.bestBid === null ? null : state.bestBid - consensus
      },
      freshness: {
        txlineAgeMs: txAge,
        polymarketAgeMs: pmAge,
        bothFresh,
        clockOrderHealthy
      },
      scoreContext: scores
    };
  }
}
