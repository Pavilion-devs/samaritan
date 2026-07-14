import { describe, expect, it } from "vitest";
import { normalizePolymarketPayload } from "../src/ingest/polymarket/normalizer.js";
import { MappingRegistry, sha256, UnmappedPolymarketAssetError } from "../src/mapping/registry.js";

const rules = "First 90 minutes of regular play plus stoppage time; extra time excluded.";

function mapping(status: "candidate" | "verified" = "candidate") {
  return {
    mappingId: "esp-bel-total-2.5",
    status,
    txlineFixtureId: "18218149",
    teams: {
      home: { canonical: "Spain", aliases: ["ESP"] },
      away: { canonical: "Belgium", aliases: ["BEL"] }
    },
    kickoff: { txlineTsMs: 1783710000000, polymarketTsMs: 1783710000000 },
    polymarketEventId: "676406",
    polymarketEventSlug: "fifwc-esp-bel-2026-07-10-more-markets",
    conditions: [
      {
        polymarketMarketId: "2829383",
        conditionId: "0xcondition",
        family: "total_goals",
        period: "full_time",
        lineMilli: 2500,
        rulesText: rules,
        rulesSha256: sha256(rules),
        tokens: [
          { assetId: "over-token", outcome: "over", role: "canonical" },
          { assetId: "under-token", outcome: "under", role: "canonical" }
        ]
      }
    ],
    ...(status === "verified"
      ? {
          review: {
            settlementVerified: true as const,
            reviewedBy: "Deborah",
            reviewedAt: "2026-07-10T12:00:00.000Z"
          }
        }
      : {})
  };
}

describe("evidence-bearing mappings and Polymarket normalization", () => {
  it("keeps candidates non-tradeable and requires an exact mapped asset", () => {
    const registry = new MappingRegistry([mapping()]);
    expect(registry.resolveAsset("over-token").tradeable).toBe(false);
    expect(() => registry.resolveAsset("unknown")).toThrow(UnmappedPolymarketAssetError);
  });

  it("only marks a human-reviewed verified mapping tradeable", () => {
    const registry = new MappingRegistry([mapping("verified")]);
    expect(registry.resolveAsset("over-token").tradeable).toBe(true);
    const invalid = { ...mapping(), status: "verified" };
    expect(() => new MappingRegistry([invalid])).toThrow(/human settlement review/);
  });

  it("rejects altered rules and duplicate canonical outcomes", () => {
    const badHash = mapping();
    badHash.conditions[0]!.rulesText = `${rules} altered`;
    expect(() => new MappingRegistry([badHash])).toThrow(/rulesSha256/);

    const duplicate = mapping();
    duplicate.conditions[0]!.tokens.push({
      assetId: "over-token-2",
      outcome: "over",
      role: "canonical"
    });
    expect(() => new MappingRegistry([duplicate])).toThrow(/Duplicate canonical/);
  });

  it("normalizes prices/books without treating candidates as verified", () => {
    const registry = new MappingRegistry([mapping()]);
    const [price] = normalizePolymarketPayload(
      {
        market: "0xcondition",
        timestamp: "1783674712671",
        event_type: "price_change",
        price_changes: [
          {
            asset_id: "over-token",
            price: "0.61",
            size: "125.5",
            side: "BUY",
            hash: "change-1",
            best_bid: "0.60",
            best_ask: "0.62"
          }
        ]
      },
      1783674712923,
      registry
    );
    if (price?.kind !== "polymarket.price") throw new Error("expected price");
    expect(price.mappingStatus).toBe("candidate");
    expect(price.market.key).toBe("18218149:total_goals:full_time:2500");
    expect(price.price).toBe(0.61);
    expect(price.bestBid).toBe(0.6);
    expect(price.bestAsk).toBe(0.62);

    const [book] = normalizePolymarketPayload(
      {
        market: "0xcondition",
        asset_id: "under-token",
        timestamp: "1783674713000",
        event_type: "book",
        hash: "book-1",
        bids: [{ price: "0.37", size: "10" }],
        asks: [{ price: "0.39", size: "12" }],
        tick_size: "0.01",
        last_trade_price: "0.38"
      },
      1783674713020,
      registry
    );
    if (book?.kind !== "polymarket.book") throw new Error("expected book");
    expect(book.outcome).toBe("under");
    expect(book.bids[0]).toEqual({ price: 0.37, size: "10" });
  });

  it("normalizes public market resolution by winning asset without inferring from price", () => {
    const registry = new MappingRegistry([mapping()]);
    const [resolution] = normalizePolymarketPayload(
      {
        market: "0xcondition",
        assets_ids: ["over-token", "under-token"],
        winning_asset_id: "under-token",
        winning_outcome: "Under",
        timestamp: "1783717968900",
        event_type: "market_resolved"
      },
      1783717968929,
      registry
    );
    expect(resolution).toMatchObject({
      kind: "polymarket.resolution",
      fixtureId: "18218149",
      conditionId: "0xcondition",
      winningAssetId: "under-token",
      winningOutcomeLabel: "Under",
      sourceTsMs: 1783717968900,
      observedTsMs: 1783717968929
    });
  });
});
