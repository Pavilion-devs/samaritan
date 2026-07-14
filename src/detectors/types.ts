import type { CanonicalMarket, CanonicalOutcome } from "../bus/events.js";

export type SignalKind = "CONSENSUS_MOVE" | "XMARKET_DIVERGENCE" | "FADER_CANDIDATE";
export type SignalDirection = "buy" | "sell";

export type DetectorSignal = {
  signalId: string;
  kind: SignalKind;
  /** Market/source time of the triggering evidence; retained for provenance and ordering. */
  detectedAtTsMs: number;
  /** Knowledge time when Samaritan actually observed and could process the signal. */
  observedAtTsMs: number;
  fixtureId: string;
  market: CanonicalMarket;
  outcome: CanonicalOutcome;
  direction: SignalDirection;
  eligibility: "research_only" | "pretrade_review_required";
  reason: string;
  evidence: {
    consensusProbability: number;
    polymarketProbability: number;
    consensusVelocity: number | null;
    consensusZScore: number | null;
    polymarketVelocity: number | null;
    polymarketZScore: number | null;
    cusumUp: number;
    cusumDown: number;
    rawGap: number;
    gapBasis: "live_book" | "sampled_history_proxy";
    persistenceMs: number;
    mappingStatus: string | null;
    scoreContextActions: string[];
  };
};
