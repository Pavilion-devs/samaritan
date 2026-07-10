import { describe, expect, it } from "vitest";
import { DetectorBank, type DetectorBankConfig } from "../src/detectors/bank.js";
import { probability } from "../src/domain/probability.js";
import type { FeatureSnapshot, VelocityFeature } from "../src/features/engine.js";

const config: DetectorBankConfig = {
  velocityWindowMs: 60_000,
  consensusMoveAbsZ: 2,
  consensusCusumThreshold: 0.02,
  consensusMinimumUpdates: 4,
  consensusMinimumRawGap: 0.02,
  consensusStableAbsZ: 0.5,
  xmarketMinimumRawGap: 0.03,
  xmarketPersistenceMs: 1_000,
  faderPolymarketAbsZ: 2,
  faderMinimumRawGap: 0.03,
  faderPersistenceMs: 0
};

function velocity(value: number, zScore: number): VelocityFeature {
  return {
    windowMs: 60_000,
    velocity: value,
    zScore,
    baselineMean: 0,
    baselineStdDev: 0.01
  };
}

function snapshot(overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return {
    triggerEventId: "trigger-1",
    triggerSource: "polymarket",
    asOfTsMs: 10_000,
    fixtureId: "fixture-1",
    market: {
      family: "match_result",
      period: "full_time",
      lineMilli: null,
      key: "fixture-1:match_result:full_time:none"
    },
    outcome: "home",
    mappingStatus: "candidate",
    consensus: {
      probability: probability(0.55),
      sourceTsMs: 10_000,
      updateCount: 10,
      velocities: [velocity(0, 0.1)],
      cusumUp: 0,
      cusumDown: 0,
      devigCrossCheckProbability: 0.55,
      devigDiscrepancy: 0
    },
    polymarket: {
      probability: probability(0.5),
      sourceTsMs: 10_000,
      updateCount: 10,
      velocities: [velocity(0, 0.1)],
      bestBid: probability(0.49),
      bestAsk: probability(0.5),
      observation: "book"
    },
    spread: {
      consensusMinusPolymarket: 0.05,
      rawBuyGap: 0.05,
      rawSellGap: -0.06
    },
    freshness: {
      txlineAgeMs: 0,
      polymarketAgeMs: 0,
      bothFresh: true,
      clockOrderHealthy: true
    },
    scoreContext: [],
    ...overrides
  };
}

describe("detector bank", () => {
  it("requires XMARKET persistence and keeps candidates research-only", () => {
    const bank = new DetectorBank(config);
    expect(bank.ingest(snapshot())).toEqual([]);
    const [signal] = bank.ingest(snapshot({ asOfTsMs: 11_000, triggerEventId: "trigger-2" }));
    expect(signal?.kind).toBe("XMARKET_DIVERGENCE");
    expect(signal?.direction).toBe("buy");
    expect(signal?.eligibility).toBe("research_only");
    expect(signal?.evidence.persistenceMs).toBe(1_000);
    expect(bank.ingest(snapshot({ asOfTsMs: 12_000 }))).toEqual([]);
  });

  it("emits a consensus move once and never bypasses pretrade review", () => {
    const bank = new DetectorBank(config);
    const moving = snapshot({
      mappingStatus: "verified",
      triggerSource: "txline",
      consensus: {
        ...snapshot().consensus,
        velocities: [velocity(0.04, 3)],
        cusumUp: 0.04
      }
    });
    const [signal] = bank.ingest(moving);
    expect(signal?.kind).toBe("CONSENSUS_MOVE");
    expect(signal?.eligibility).toBe("pretrade_review_required");
    expect(bank.ingest({ ...moving, triggerEventId: "next" })).toEqual([]);
  });

  it("identifies a fade direction and suppresses score-explained moves", () => {
    const bank = new DetectorBank(config);
    const fader = snapshot({
      consensus: { ...snapshot().consensus, probability: probability(0.5) },
      polymarket: {
        ...snapshot().polymarket,
        probability: probability(0.6),
        velocities: [velocity(0.06, 3)]
      },
      spread: {
        consensusMinusPolymarket: -0.1,
        rawBuyGap: -0.11,
        rawSellGap: 0.09
      }
    });
    const signals = bank.ingest(fader);
    expect(signals.find((signal) => signal.kind === "FADER_CANDIDATE")?.direction).toBe("sell");

    const withGoal = {
      ...fader,
      asOfTsMs: 11_000,
      scoreContext: [{ action: "goal", confirmed: true, participant: 1, sourceTsMs: 10_900 }]
    };
    expect(bank.ingest(withGoal)).toEqual([]);
  });
});
