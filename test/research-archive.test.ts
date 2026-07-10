import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it } from "vitest";
import { mergeReplaySources } from "../src/replay/merge.js";
import { DuckDbResearchArchive } from "../src/replay/research-archive.js";
import { extractResearchFeatures } from "../src/research/extract-features.js";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DuckDB research archive replay", () => {
  it("streams normalized TXLine and sampled Polymarket rows through canonical events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "samaritan-archive-"));
    paths.push(directory);
    const databasePath = join(directory, "research.duckdb");
    const instance = await DuckDBInstance.create(databasePath);
    const connection = await instance.connect();
    await connection.run(`
      CREATE TABLE txline_quote_outcomes(
        event_id VARCHAR, fixture_id VARCHAR, source_ts_ms BIGINT, market_key VARCHAR,
        outcome VARCHAR, odds_x1000 INTEGER, probability DOUBLE
      );
      INSERT INTO txline_quote_outcomes VALUES
        ('txline:odds:m1', 'f1', 1000, 'f1:match_result:full_time:none', 'home', 2000, 0.5),
        ('txline:odds:m1', 'f1', 1000, 'f1:match_result:full_time:none', 'draw', 3333, 0.3),
        ('txline:odds:m1', 'f1', 1000, 'f1:match_result:full_time:none', 'away', 5000, 0.2);
      CREATE TABLE txline_quote_metadata(
        event_id VARCHAR, bookmaker VARCHAR, bookmaker_id INTEGER, in_running BOOLEAN, game_state VARCHAR
      );
      INSERT INTO txline_quote_metadata VALUES
        ('txline:odds:m1', 'TXLineStablePriceDemargined', 10021, false, NULL);
      CREATE TABLE polymarket_history(
        event_id VARCHAR, fixture_id VARCHAR, market_key VARCHAR, source_ts_ms BIGINT,
        asset_id VARCHAR, condition_id VARCHAR, outcome VARCHAR, token_role VARCHAR,
        mapping_status VARCHAR, price DOUBLE, observation VARCHAR
      );
      INSERT INTO polymarket_history VALUES
        ('polymarket:price:p1', 'f1', 'f1:match_result:full_time:none', 1500,
         'asset-home', 'condition-home', 'home', 'canonical', 'candidate', 0.45, 'sampled_history')
    `);
    connection.closeSync();
    instance.closeSync();

    const archive = await DuckDbResearchArchive.open(databasePath);
    const events = [];
    try {
      for await (const event of mergeReplaySources(archive.sources({ fixtureId: "f1" }), {
        speed: Number.POSITIVE_INFINITY
      })) {
        events.push(event);
      }
    } finally {
      archive.close();
    }

    expect(events.map((event) => event.kind)).toEqual(["odds.quote", "polymarket.price"]);
    expect(events[0]).toMatchObject({
      eventId: "txline:odds:m1",
      sourceTsMs: 1000,
      observedTsMs: 1000,
      inRunning: false,
      outcomes: [
        { outcome: "home", fairProbability: 0.5 },
        { outcome: "draw", fairProbability: 0.3 },
        { outcome: "away", fairProbability: 0.2 }
      ]
    });
    expect(events[1]).toMatchObject({
      eventId: "polymarket:price:p1",
      observation: "sampled_history",
      mappingStatus: "candidate",
      tokenRole: "canonical"
    });
    expect(events.every((event) => !("mode" in event))).toBe(true);

    const snapshotKinds: string[] = [];
    const summary = await extractResearchFeatures({
      archivePath: databasePath,
      query: { fixtureId: "f1" },
      featureConfig: {
        velocityWindowsMs: [1_000],
        velocityEwmaHalfLifeMs: 5_000,
        cusumDriftProbability: 0.001,
        scoreContextWindowMs: 5_000,
        freshnessMaxAgeMs: 2_000
      },
      onSnapshot: (snapshot) => {
        snapshotKinds.push(snapshot.triggerSource);
      }
    });
    expect(summary).toMatchObject({ events: 2, snapshots: 4, txlineEvents: 1, polymarketEvents: 1 });
    expect(snapshotKinds).toEqual(["txline", "txline", "txline", "polymarket"]);
  });
});
