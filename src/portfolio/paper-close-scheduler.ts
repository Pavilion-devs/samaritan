import type { CanonicalEvent, PolymarketBookEvent } from "../bus/events.js";
import type { PaperCloseMark, PaperPortfolio } from "./paper.js";

export type PaperCloseResult = {
  caseId: string;
  fixtureId: string;
  cutoffTsMs: number;
  mark: PaperCloseMark;
};

function bookKey(book: PolymarketBookEvent): string {
  return `${book.fixtureId}:${book.market.key}:${book.conditionId}:${book.assetId}:${book.outcome}`;
}

function positionKey(position: {
  fixtureId: string;
  marketKey: string;
  conditionId: string;
  assetId: string;
  outcome: string;
}): string {
  return `${position.fixtureId}:${position.marketKey}:${position.conditionId}:${position.assetId}:${position.outcome}`;
}

export class PaperCloseScheduler {
  readonly #books = new Map<string, PolymarketBookEvent>();

  constructor(readonly dependencies: {
    portfolio: PaperPortfolio;
    kickoffByFixtureId: ReadonlyMap<string, number>;
  }) {}

  ingest(event: CanonicalEvent): PaperCloseResult[] {
    if (event.kind === "polymarket.book" && event.tokenRole === "canonical") {
      this.#cachePreKickoffBook(event);
    }
    return this.#markReadyPositions(event.observedTsMs);
  }

  cachedBookCount(): number {
    return this.#books.size;
  }

  #cachePreKickoffBook(book: PolymarketBookEvent): void {
    const kickoffTsMs = this.dependencies.kickoffByFixtureId.get(book.fixtureId);
    if (kickoffTsMs === undefined || book.sourceTsMs > kickoffTsMs) return;
    const key = bookKey(book);
    const current = this.#books.get(key);
    if (
      current &&
      (book.sourceTsMs < current.sourceTsMs ||
        (book.sourceTsMs === current.sourceTsMs && book.observedTsMs <= current.observedTsMs))
    ) {
      return;
    }
    this.#books.set(key, structuredClone(book));
  }

  #markReadyPositions(asOfTsMs: number): PaperCloseResult[] {
    const results: PaperCloseResult[] = [];
    for (const position of this.dependencies.portfolio.positions()) {
      if (position.status !== "open") continue;
      const cutoffTsMs = this.dependencies.kickoffByFixtureId.get(position.fixtureId);
      if (cutoffTsMs === undefined || asOfTsMs < cutoffTsMs) continue;
      const book = this.#books.get(positionKey(position));
      if (!book) continue;
      const mark = this.dependencies.portfolio.markAtClose({
        caseId: position.caseId,
        book,
        cutoffTsMs,
        markedAtTsMs: asOfTsMs
      });
      results.push({ caseId: position.caseId, fixtureId: position.fixtureId, cutoffTsMs, mark });
    }
    return results;
  }
}
