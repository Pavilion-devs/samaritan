import { z } from "zod";
import type { PolymarketBookEvent } from "../../bus/events.js";
import type { PolymarketFeeParameters } from "../../exec/paper.js";

export const POLYMARKET_CLOB_ORIGIN = "https://clob.polymarket.com";

const marketInfoSchema = z.object({
  c: z.string().min(1),
  t: z.array(z.object({
    t: z.string().min(1),
    o: z.string().min(1)
  })).min(1),
  mos: z.number().finite().positive(),
  mts: z.number().finite().positive(),
  tbf: z.number().int().nonnegative(),
  fd: z.object({
    r: z.number().finite().nonnegative().nullable(),
    e: z.number().finite().nonnegative().nullable(),
    to: z.boolean().nullable()
  }).optional()
});

type CacheEntry = {
  fetchedAtTsMs: number;
  tokenIds: Set<string>;
  fees: PolymarketFeeParameters;
};

export type PolymarketClobFeeResolverOptions = {
  origin?: string;
  cacheTtlMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class PolymarketClobFeeResolver {
  readonly #origin: string;
  readonly #cacheTtlMs: number;
  readonly #requestTimeoutMs: number;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(options: PolymarketClobFeeResolverOptions = {}) {
    this.#origin = (options.origin ?? POLYMARKET_CLOB_ORIGIN).replace(/\/$/, "");
    this.#cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#cacheTtlMs) || this.#cacheTtlMs <= 0) {
      throw new RangeError("Fee cache TTL must be a positive integer number of milliseconds");
    }
    if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new RangeError("Fee request timeout must be a positive integer number of milliseconds");
    }
  }

  async resolve(book: PolymarketBookEvent): Promise<PolymarketFeeParameters> {
    const now = this.#now();
    const cached = this.#cache.get(book.conditionId);
    if (cached && now - cached.fetchedAtTsMs <= this.#cacheTtlMs) {
      if (!cached.tokenIds.has(book.assetId)) throw new Error("Cached CLOB market info does not contain book asset");
      return cached.fees;
    }

    const response = await this.#fetchImpl(
      `${this.#origin}/clob-markets/${encodeURIComponent(book.conditionId)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.#requestTimeoutMs)
      }
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Polymarket CLOB market-info request failed ${response.status}: ${text.slice(0, 300)}`);
    }
    const info = marketInfoSchema.parse(JSON.parse(text) as unknown);
    if (info.c !== book.conditionId) throw new Error("CLOB market-info condition does not match canonical book");
    const tokenIds = new Set(info.t.map((token) => token.t));
    if (!tokenIds.has(book.assetId)) throw new Error("CLOB market info does not contain canonical book asset");

    const feeDetails = info.fd;
    if (info.tbf > 0 && (!feeDetails || feeDetails.r === null || feeDetails.e === null || feeDetails.to === null)) {
      throw new Error("Fee-enabled CLOB market omitted explicit V2 fee-curve details");
    }
    const feesEnabled = (feeDetails?.r ?? 0) > 0;
    const fetchedAtTsMs = this.#now();
    const fees: PolymarketFeeParameters = {
      source: "polymarket_clob_market_info",
      conditionId: book.conditionId,
      feesEnabled,
      takerFeeRate: feesEnabled ? feeDetails!.r! : 0,
      feeCurveExponent: feesEnabled ? feeDetails!.e! : 1,
      takerOnly: feesEnabled ? feeDetails!.to! : true,
      minimumOrderSize: info.mos,
      minimumTickSize: info.mts,
      fetchedAtTsMs
    };
    this.#cache.set(book.conditionId, { fetchedAtTsMs, tokenIds, fees });
    return fees;
  }

  clear(): void {
    this.#cache.clear();
  }
}
