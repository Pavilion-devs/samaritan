import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CASEBOOK_API_PATH, COMMAND_API_PATH, SPAIN_BELGIUM_API_PATH, STUDY_API_PATH, handleDashboardApi } from "../src/dash/api.js";
import { buildCasebookSnapshot } from "../src/dash/casebook-projection.js";
import { buildCommandSnapshot } from "../src/dash/command-projection.js";
import { buildSpainBelgiumMatchroomSnapshot } from "../src/dash/projection.js";
import { buildStudySnapshot } from "../src/dash/study-projection.js";

const repoRoot = resolve(import.meta.dirname, "..");
const privateProjectionEvidenceAvailable = process.env.SAMARITAN_TEST_NO_PRIVATE_DATA !== "1" && [
  "data/paper/reports/current.json",
  "data/research/paper-fixture-universe.json",
  "data/research/historical-gate-study-causal-economic-v4.json",
  "data/research/paired-spain-belgium-2026-07-10-live-lane.json",
  "data/live/paired-spain-belgium-2026-07-10/analysis-manifest.json",
  "samples/fixtures/mainnet-world-cup-fixtures.json"
].every((path) => existsSync(resolve(repoRoot, path)));

function publicKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(publicKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...publicKeys(nested)]);
}

describe.runIf(privateProjectionEvidenceAvailable)("public dashboard private projection", () => {
  it("builds Command from confirmed fixtures, sealed study evidence, and the verified replay", async () => {
    const snapshot = await buildCommandSnapshot(repoRoot, Date.parse("2026-07-13T12:00:00.000Z"));
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      mode: "offline_artifact",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      system: { posture: "standing_by", label: "Standing by for paired capture" },
      featuredCase: {
        caseId: "ESP-BEL-01",
        disposition: "no_trade",
        consensusMoveFromBaselineBps: 25,
        preTriggerMarketMoveBps: 775,
        identityParity: true,
        canonicalEvents: 2_470_342
      },
      study: {
        protocolStatus: "invalidated_suspended",
        status: "suspended",
        filledMatches: 0,
        requiredFilledMatches: 20,
        fills: 0,
        requiredFills: 40,
        stoppingRuleMet: false
      },
      proof: {
        replayIdentityParity: true,
        bountyLedgerValid: true,
        longRunLedgerValid: true,
        evidenceFixtures: 3,
        pairedBookReplays: 1,
        signalResearchOnly: 2
      }
    });
    expect(snapshot.fixtureSchedule).toEqual([
      expect.objectContaining({ fixtureId: "18237038", home: { name: "France", code: "FRA" }, away: { name: "Spain", code: "ESP" }, phase: "scheduled", captureOnly: true, tradeable: false }),
      expect.objectContaining({ fixtureId: "18241006", home: { name: "England", code: "ENG" }, away: { name: "Argentina", code: "ARG" }, phase: "scheduled", captureOnly: true, tradeable: false })
    ]);
    expect(snapshot.recentCases).toHaveLength(1);
  });

  it("projects verified Spain-Belgium evidence without inventing an executable edge", async () => {
    const snapshot = await buildSpainBelgiumMatchroomSnapshot(repoRoot);
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      mode: "captured_replay",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      match: {
        fixtureId: "18218149",
        eventSlug: "fifwc-esp-bel-2026-07-10",
        home: { name: "Spain", code: "ESP" },
        away: { name: "Belgium", code: "BEL" },
        scoreAtCursor: { home: 1, away: 0 },
        clockLabel: "29:21"
      },
      decision: {
        disposition: "no_trade",
        semanticStatus: "disciplined_pass",
        capitalMovedMicros: 0,
        ordersPlaced: 0,
        walletAccessed: false
      }
    });
    expect(snapshot.replay.states).toEqual([
      expect.objectContaining({ id: "pre", consensusMoveFromBaselineBps: 0, bestBid: 0.245, bestAsk: 0.26 }),
      expect.objectContaining({ id: "goal", consensusMoveFromBaselineBps: 25, bestBid: 0.17, bestAsk: 0.18 }),
      expect.objectContaining({ id: "post", consensusMoveFromBaselineBps: 25, bestBid: 0.16, bestAsk: 0.1625 })
    ]);
    expect(snapshot.replay.preTriggerMarketMoveBps).toBe(775);
    expect(snapshot.replay.states.every((state) => state.consensusMoveFromBaselineBps % snapshot.publicDataPolicy.txlineMovementBucketBps === 0)).toBe(true);
    expect(snapshot.publicDataPolicy).toMatchObject({
      derivedOnly: true,
      txlineProbabilityDisplay: "bucketed_movement_only",
      txlineMovementBucketBps: 25
    });
    expect(snapshot.replay.firstMaterialMoveLatencyMs).toBe(228);
    expect(snapshot.proof).toMatchObject({
      identityParity: true,
      canonicalEvents: 2_470_342,
      feedOutageCount: 8,
      feedDowntimeMs: 91_171,
      gateCases: 18,
      movedBeforeTxlineCases: 12,
      noMaterialRepriceCases: 6,
      cleanStaleWindows: 0
    });
  });

  it("builds Casebook from the complete verified refusal record", async () => {
    const snapshot = await buildCasebookSnapshot(repoRoot);
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      mode: "offline_artifact",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      statistics: {
        totalCases: 1,
        noTradeCases: 1,
        executedCases: 0,
        verifiedCases: 1,
        capitalMovedMicros: 0
      },
      selectedCase: {
        summary: {
          caseId: "ESP-BEL-01",
          detector: "STALE_QUOTE_FEASIBILITY",
          disposition: "No trade",
          executionOutcome: "Not executed",
          evidenceLane: "Research only",
          source: "Captured replay"
        },
        decision: { ordersPlaced: 0, walletAccessed: false },
        evidenceReadout: { consensusMoveFromBaselineBps: 25, preTriggerMarketMoveBps: 775 },
        analysis: { thesisStatus: "not_requested", costStatus: "not_applicable", costMicros: 0 },
        proof: { identityParity: true, canonicalEvents: 2_470_342 }
      }
    });
    expect(snapshot.cases).toHaveLength(1);
    expect(snapshot.selectedCase.lifecycle).toHaveLength(4);
    expect(snapshot.selectedCase.lifecycle[0]).toMatchObject({
      label: "Goal observed",
      detail: "STALE_QUOTE feasibility · research only"
    });
    expect(snapshot.selectedCase.evidence).toHaveLength(3);
  });

  it("keeps long-run Study endpoints sealed while exposing the frozen protocol", async () => {
    const snapshot = await buildStudySnapshot(repoRoot);
    expect(snapshot).toMatchObject({
      mode: "offline_artifact",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      protocol: {
        evaluation: { minimumFilledMatches: 20, minimumFills: 40, bootstrapIterations: 10_000 },
        risk: { bankrollMicroUsd: 50_000_000, perTradeStakeMicroUsd: 3_000_000, aggregateExposureMicroUsd: 15_000_000, drawdownStopMicroUsd: 20_000_000 },
        guardrailThresholds: { minimumFillRate: 0.6, maximumMeanSlippageBps: 100 }
      },
      lanes: {
        bounty: { status: "exploratory", canSatisfyGate: false },
        longRun: { status: "sealed", stoppingRuleMet: false, canSatisfyGate: false }
      },
      results: { visibility: "sealed", rows: null, endpoints: null, guardrails: null },
      correctedHistoricalCandidate: {
        protocolId: "historical-gate-causal-economic-v4-2026-07-14",
        trainingNormalizedCases: 135,
        heldoutNormalizedCases: 38,
        heldoutFixtures: 18,
        costProxyBps: 100,
        meanNetAfterCostProxyBps: 132.7,
        matchClustered95Bps: { iterations: 10_000, cluster: "fixture", low: 14.3, high: 243.9 },
        registration: "engineering_candidate_unregistered",
        activeStudy: false,
        executable: false
      },
      syntheticProof: {
        lifecycleStatus: "filled_settled",
        offlineVerified: true,
        performanceUse: "excluded_synthetic",
        externalCalls: 0,
        solanaAnchorStatus: "not_submitted"
      },
      fixtureUniverse: { evidenceFixtures: 3, pairedBookReplays: 1, executableBookReplays: 0, longRunEligible: 0 }
    });
  });

  it("exposes bucketed TXLine movement without exact levels, reconstructive gaps, or raw fields", async () => {
    const projections = {
      matchroom: await buildSpainBelgiumMatchroomSnapshot(repoRoot),
      command: await buildCommandSnapshot(repoRoot, Date.parse("2026-07-13T12:00:00.000Z")),
      casebook: await buildCasebookSnapshot(repoRoot),
      study: await buildStudySnapshot(repoRoot)
    };
    const serialized = JSON.stringify(projections);
    const keys = publicKeys(projections);

    for (const forbiddenKey of ["fairProbability", "consensusProbability", "Pct", "executableGap"]) {
      expect(keys).not.toContain(forbiddenKey);
    }
    expect(keys.filter((key) => key.toLowerCase().startsWith("raw"))).toEqual([]);
    expect(serialized).not.toContain("0.26681");
    expect(serialized).not.toContain("0.2681");
    expect(projections.matchroom.replay.states.map((state) => state.consensusMoveFromBaselineBps)).toEqual([0, 25, 25]);
    expect(projections.command.featuredCase.consensusMoveFromBaselineBps).toBe(25);
    expect(projections.casebook.selectedCase.evidenceReadout.consensusMoveFromBaselineBps).toBe(25);

    for (const forbidden of [
      "sourcePaths",
      "assetId",
      "rawPayload",
      "odds.frames.ndjson",
      "scores.frames.ndjson",
      "/Users/",
      "privateKey",
      "apiKey",
      "tokenId"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("serves only the explicit read-only public API routes", async () => {
    const command = await handleDashboardApi(COMMAND_API_PATH, repoRoot);
    expect(command).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(command!.body)).toHaveProperty("data.study.status", "suspended");
    const match = await handleDashboardApi(SPAIN_BELGIUM_API_PATH, repoRoot);
    expect(match).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(match!.body)).toHaveProperty("data.publicDataPolicy.txlineProbabilityDisplay", "bucketed_movement_only");
    const casebook = await handleDashboardApi(CASEBOOK_API_PATH, repoRoot);
    expect(casebook).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(casebook!.body)).toHaveProperty("data.selectedCase.analysis.thesisStatus", "not_requested");
    const study = await handleDashboardApi(STUDY_API_PATH, repoRoot);
    expect(study).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(study!.body)).toMatchObject({ data: { results: { visibility: "sealed", endpoints: null }, realMoneyGate: "closed" } });
    expect(await handleDashboardApi("/api/v1/wallet", repoRoot)).toMatchObject({ status: 404 });
    expect(await handleDashboardApi("/matchroom", repoRoot)).toBeNull();
  });
});
