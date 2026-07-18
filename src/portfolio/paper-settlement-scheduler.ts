import type { CanonicalEvent } from "../bus/events.js";
import type { PaperPortfolio, PaperSettlement } from "./paper.js";

export type PaperSettlementResult = {
  caseId: string;
  fixtureId: string;
  conditionId: string;
  winningAssetId: string;
  won: boolean;
  settlement: PaperSettlement;
};

export class PaperSettlementScheduler {
  constructor(readonly portfolio: PaperPortfolio) {}

  ingest(event: CanonicalEvent): PaperSettlementResult[] {
    if (event.kind !== "polymarket.resolution") return [];
    const results: PaperSettlementResult[] = [];
    for (const position of this.portfolio.positions()) {
      if (
        position.status !== "marked" ||
        position.fixtureId !== event.fixtureId ||
        position.marketKey !== event.market.key ||
        position.conditionId !== event.conditionId
      ) {
        continue;
      }
      const won = position.assetId === event.winningAssetId;
      const settlement = this.portfolio.settle({
        caseId: position.caseId,
        won,
        settledAtTsMs: event.observedTsMs
      });
      results.push({
        caseId: position.caseId,
        fixtureId: position.fixtureId,
        conditionId: position.conditionId,
        winningAssetId: event.winningAssetId,
        won,
        settlement
      });
    }
    return results;
  }
}
