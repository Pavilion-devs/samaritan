import { z } from "zod";
import type { DetectorSignal } from "../detectors/types.js";

export const triageDecisionSchema = z.object({
  decision: z.enum(["drop", "escalate"]),
  priority: z.enum(["low", "normal", "high"]),
  rationale: z.string().min(1).max(500)
}).strict();

export type TriageDecision = z.infer<typeof triageDecisionSchema>;

export const tradeThesisSchema = z.object({
  schemaVersion: z.literal(1),
  signalId: z.string().min(1),
  fixtureId: z.string().min(1),
  marketKey: z.string().min(1),
  outcome: z.enum(["home", "draw", "away", "over", "under"]),
  direction: z.enum(["buy", "sell"]),
  recommendation: z.enum(["paper_trade", "no_trade"]),
  fairProbability: z.number().finite().min(0).max(1),
  thesisSummary: z.string().min(1).max(2_000),
  evidenceFor: z.array(z.string().min(1).max(500)).min(1).max(12),
  steelmanAgainst: z.string().min(1).max(2_000),
  invalidationConditions: z.array(z.string().min(1).max(500)).min(1).max(12),
  submittedAtTsMs: z.number().int().nonnegative(),
  expiresAtTsMs: z.number().int().nonnegative(),
  analystModel: z.string().min(1).max(100)
}).strict().superRefine((thesis, context) => {
  if (thesis.expiresAtTsMs <= thesis.submittedAtTsMs) {
    context.addIssue({
      code: "custom",
      message: "Thesis expiry must be after submission",
      path: ["expiresAtTsMs"]
    });
  }
});

export type TradeThesis = z.infer<typeof tradeThesisSchema>;

export type TriageAgent = {
  triage(input: { caseId: string; signal: DetectorSignal }): Promise<unknown>;
};

export type AnalystAgent = {
  investigate(input: {
    caseId: string;
    signal: DetectorSignal;
    triage: TriageDecision;
    asOfTsMs: number;
  }): Promise<unknown>;
};

export function assertThesisMatchesSignal(thesis: TradeThesis, signal: DetectorSignal): void {
  if (
    thesis.signalId !== signal.signalId ||
    thesis.fixtureId !== signal.fixtureId ||
    thesis.marketKey !== signal.market.key ||
    thesis.outcome !== signal.outcome ||
    thesis.direction !== signal.direction
  ) {
    throw new Error("Trade thesis identity or direction does not match the detector signal");
  }
}
