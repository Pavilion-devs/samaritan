import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CASEBOOK_API_PATH, COMMAND_API_PATH, SPAIN_BELGIUM_API_PATH, STUDY_API_PATH, handleDashboardApi } from "../src/dash/api.js";
import { buildCasebookSnapshot } from "../src/dash/casebook-projection.js";
import { buildCommandSnapshot, resolveCaptureOutcome } from "../src/dash/command-projection.js";
import { casebookApiResponseSchema } from "../src/dash/public-bundle.js";
import { buildSpainBelgiumMatchroomSnapshot } from "../src/dash/projection.js";
import { buildStudySnapshot } from "../src/dash/study-projection.js";

const repoRoot = resolve(import.meta.dirname, "..");
const privateProjectionEvidenceAvailable = process.env.SAMARITAN_TEST_NO_PRIVATE_DATA !== "1" && [
  "data/paper/reports/current.json",
  "data/paper/v2/reports/current.json",
  "data/paper/v2/fixture-universe.json",
  "data/research/paper-fixture-universe.json",
  "data/research/historical-gate-study-causal-economic-v4.json",
  "data/research/paired-spain-belgium-2026-07-10-live-lane.json",
  "data/live/paired-spain-belgium-2026-07-10/analysis-manifest.json",
  "samples/fixtures/mainnet-world-cup-fixtures.json"
].every((path) => existsSync(resolve(repoRoot, path)));
const franceAnalysisAvailable = process.env.SAMARITAN_TEST_NO_PRIVATE_DATA !== "1" && existsSync(resolve(
  repoRoot,
  "data/live/paired-france-spain-2026-07-14/analysis-manifest.json"
));

function publicKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(publicKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...publicKeys(nested)]);
}

const franceCaptureIdentity = {
  captureId: "paired-france-spain-2026-07-14",
  runLabel: "paired-france-spain-2026-07-14",
  fixtureId: "18237038",
  eventSlug: "fifwc-fra-esp-2026-07-14",
  captureStartUtc: "2026-07-14T16:00:00.000Z",
  captureEndUtc: "2026-07-14T22:00:00.000Z"
};

function supervisorTerminalEvidence() {
  const windowStartTsMs = Date.parse(franceCaptureIdentity.captureStartUtc);
  const windowEndTsMs = Date.parse(franceCaptureIdentity.captureEndUtc);
  const rows = ([
    ["polymarket", 10_000],
    ["txline_odds", 20_000],
    ["txline_scores", 30_000]
  ] as const).map(([name, offset]) => ({
    name,
    path: `/private/${name}.ndjson`,
    bytes: 100,
    firstReceivedAt: new Date(windowStartTsMs + offset).toISOString(),
    lastReceivedAt: new Date(windowEndTsMs - offset).toISOString(),
    firstReceivedTsMs: windowStartTsMs + offset,
    lastReceivedTsMs: windowEndTsMs - offset
  }));
  return {
    manifestPath: "/private/capture-manifest.json",
    windowStartUtc: franceCaptureIdentity.captureStartUtc,
    windowEndUtc: franceCaptureIdentity.captureEndUtc,
    synchronizedStartUtc: rows[2]!.firstReceivedAt,
    synchronizedEndUtc: rows[2]!.lastReceivedAt,
    streams: rows
  };
}

describe("Command capture outcome projection", () => {
  it.runIf(franceAnalysisAvailable)("surfaces the reviewed France-Spain analysis as explicitly failed closed", () => {
    const manifest = JSON.parse(readFileSync(resolve(
      repoRoot,
      "data/live/paired-france-spain-2026-07-14/analysis-manifest.json"
    ), "utf8")) as unknown;
    expect(resolveCaptureOutcome({
      ...franceCaptureIdentity,
      nowTsMs: Date.parse("2026-07-15T01:00:00.000Z"),
      analysisManifest: { present: true, value: manifest },
      supervisorStatus: { present: false, value: null }
    })).toMatchObject({
      phase: "failed",
      statusLabel: "Failed closed",
      statusSource: "analysis_manifest",
      statusUpdatedAt: "2026-07-15T00:23:23.588Z"
    });
  });

  it("reports unknown after launch time when no local outcome artifact exists", () => {
    expect(resolveCaptureOutcome({
      ...franceCaptureIdentity,
      nowTsMs: Date.parse("2026-07-14T17:00:00.000Z"),
      analysisManifest: { present: false, value: null },
      supervisorStatus: { present: false, value: null }
    })).toEqual({
      phase: "unknown",
      statusLabel: "Outcome unknown",
      statusDetail: "No terminal analysis or current supervisor outcome is available",
      statusSource: "none",
      statusUpdatedAt: null,
      terminalEvidence: null
    });
  });

  it("uses explicit supervisor completion but keeps analysis verification separate", () => {
    const outcome = resolveCaptureOutcome({
      ...franceCaptureIdentity,
      nowTsMs: Date.parse("2026-07-14T22:10:00.000Z"),
      analysisManifest: { present: false, value: null },
      supervisorStatus: { present: true, value: {
        schemaVersion: 1,
        captureId: franceCaptureIdentity.captureId,
        runLabel: franceCaptureIdentity.runLabel,
        state: "completed",
        updatedAt: "2026-07-14T22:05:00.000Z",
        supervisorPid: 123,
        scheduledStartUtc: franceCaptureIdentity.captureStartUtc,
        scheduledEndUtc: franceCaptureIdentity.captureEndUtc,
        childPid: 456,
        exitCode: 0,
        terminalEvidence: supervisorTerminalEvidence()
      } }
    });
    expect(outcome).toMatchObject({
      phase: "complete",
      statusLabel: "Capture complete",
      statusSource: "supervisor_status",
      statusDetail: expect.stringContaining("verification is still separate"),
      terminalEvidence: {
        windowStartUtc: franceCaptureIdentity.captureStartUtc,
        windowEndUtc: franceCaptureIdentity.captureEndUtc,
        synchronizedStartUtc: "2026-07-14T16:00:30.000Z",
        synchronizedEndUtc: "2026-07-14T21:59:30.000Z",
        streamCount: 3
      }
    });
    expect(JSON.stringify(outcome)).not.toContain("/private/");
    expect(outcome).not.toHaveProperty("terminalEvidence.manifestPath");
  });

  it("does not treat supervisor completion without terminal evidence as complete", () => {
    expect(resolveCaptureOutcome({
      ...franceCaptureIdentity,
      nowTsMs: Date.parse("2026-07-14T22:10:00.000Z"),
      analysisManifest: { present: false, value: null },
      supervisorStatus: { present: true, value: {
        schemaVersion: 1,
        captureId: franceCaptureIdentity.captureId,
        runLabel: franceCaptureIdentity.runLabel,
        state: "completed",
        updatedAt: "2026-07-14T22:05:00.000Z",
        supervisorPid: 123,
        scheduledStartUtc: franceCaptureIdentity.captureStartUtc,
        scheduledEndUtc: franceCaptureIdentity.captureEndUtc,
        childPid: 456,
        exitCode: 0
      } }
    })).toMatchObject({
      phase: "unknown",
      statusSource: "supervisor_status",
      terminalEvidence: null
    });
  });

  it("does not fall back to a supervisor success when an analysis record is malformed", () => {
    expect(resolveCaptureOutcome({
      ...franceCaptureIdentity,
      nowTsMs: Date.parse("2026-07-14T22:10:00.000Z"),
      analysisManifest: { present: true, value: { status: "verified" } },
      supervisorStatus: { present: true, value: {
        schemaVersion: 1,
        captureId: franceCaptureIdentity.captureId,
        runLabel: franceCaptureIdentity.runLabel,
        state: "completed",
        updatedAt: "2026-07-14T22:05:00.000Z",
        supervisorPid: 123,
        scheduledStartUtc: franceCaptureIdentity.captureStartUtc,
        exitCode: 0
      } }
    })).toMatchObject({
      phase: "unknown",
      statusSource: "analysis_manifest"
    });
  });
});

describe.runIf(privateProjectionEvidenceAvailable)("public dashboard private projection", () => {
  it("builds Command from confirmed fixtures, sealed study evidence, and the verified replay", async () => {
    const snapshot = await buildCommandSnapshot(repoRoot, Date.parse("2026-07-18T08:00:00.000Z"));
    expect(snapshot).toMatchObject({
      schemaVersion: 3,
      mode: "offline_artifact",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      system: { posture: "standing_by", label: "Standing by for paired capture" },
      featuredCase: {
        caseId: "SB-20260710-G01-MR",
        fixtureLabel: "Spain vs Belgium",
        home: { name: "Spain", code: "ESP" },
        away: { name: "Belgium", code: "BEL" },
        marketOutcomeLabel: "draw",
        disposition: "no_trade",
        consensusMoveFromBaselineBps: 25,
        preTriggerMarketMoveBps: 775,
        scoreAtCursor: { home: 1, away: 0 },
        clockSeconds: 1761,
        capitalMovedMicros: 0,
        ordersPlaced: 0,
        walletAccessed: false,
        identityParity: true,
        canonicalEvents: 2_470_342
      },
      study: {
        protocolVersion: "paper-study-v2-2026-07-18",
        protocolStatus: "registered",
        status: "active_forward_paper",
        registeredAt: "2026-07-18T07:03:55Z",
        observationStatus: "awaiting_fresh_evidence",
        qualifyingCounts: { matches: 0, signals: 0, filledMatches: 0, fills: 0, settledFills: 0 },
        requiredFilledMatches: 20,
        requiredFills: 40,
        stoppingRuleMet: false,
        realMoneyGate: "closed",
        historicalV1: {
          protocolVersion: "paper-study-v1-2026-07-12",
          protocolStatus: "invalidated_suspended",
          zeroObservationAudit: true
        }
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
      expect.objectContaining({ captureId: "paired-france-spain-2026-07-14", home: { name: "France", code: "FRA" }, away: { name: "Spain", code: "ESP" }, phase: "failed", identityStatus: "historical_reviewed_config", captureOnly: true, tradeable: false }),
      expect.objectContaining({ captureId: "paired-england-argentina-2026-07-15", home: { name: "England", code: "ENG" }, away: { name: "Argentina", code: "ARG" }, phase: "failed", identityStatus: "historical_reviewed_config", captureOnly: true, tradeable: false }),
      expect.objectContaining({ captureId: "paired-france-england-2026-07-18", home: { name: "France", code: "FRA" }, away: { name: "England", code: "ENG" }, phase: "scheduled", identityStatus: "exact_match_confirmed", captureOnly: true, tradeable: false }),
      expect.objectContaining({ captureId: "paired-spain-argentina-2026-07-19", home: { name: "Spain", code: "ESP" }, away: { name: "Argentina", code: "ARG" }, phase: "scheduled", identityStatus: "exact_match_confirmed", captureOnly: true, tradeable: false })
    ]);
    expect(snapshot.recentCases).toHaveLength(1);
  });

  it("uses terminal manifests for ended captures and current-source validation for future captures", async () => {
    const snapshot = await buildCommandSnapshot(repoRoot, Date.parse("2026-07-18T08:00:00.000Z"));
    expect(snapshot.fixtureSchedule.find((fixture) => fixture.captureId === "paired-france-spain-2026-07-14")).toMatchObject({
      phase: "failed",
      statusLabel: "Failed closed",
      statusSource: "analysis_manifest",
      statusUpdatedAt: "2026-07-15T00:23:23.588Z",
      identityStatus: "historical_reviewed_config"
    });
    expect(snapshot.fixtureSchedule.find((fixture) => fixture.captureId === "paired-england-argentina-2026-07-15")).toMatchObject({
      phase: "failed",
      statusSource: "analysis_manifest",
      identityStatus: "historical_reviewed_config"
    });
    expect(snapshot.fixtureSchedule.find((fixture) => fixture.captureId === "paired-france-england-2026-07-18")).toMatchObject({
      phase: "scheduled",
      statusSource: "supervisor_status",
      identityStatus: "exact_match_confirmed"
    });
  });

  it("projects verified Spain-Belgium evidence without inventing an executable edge", async () => {
    const snapshot = await buildSpainBelgiumMatchroomSnapshot(repoRoot);
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      caseId: "SB-20260710-G01-MR",
      casebookCaseCount: 18,
      mode: "captured_replay",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      match: {
        fixtureRef: "paired-spain-belgium-2026-07-10",
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
    expect(snapshot.decision.explanation).toBe("The candidate arrived after the market had already moved. This retrospective feasibility observation never entered an execution runtime.");
    expect(snapshot.replay.states.find((state) => state.id === "goal")?.decisionExplanation).toBe(snapshot.decision.explanation);
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
      cleanStaleWindows: 0,
      corpusAssurance: "local_file_sha256_not_capture_manifest_membership"
    });
  });

  it("projects the complete reported feasibility corpus and labels one deterministic detail exemplar", async () => {
    const snapshot = await buildCasebookSnapshot(repoRoot);
    expect(snapshot).toMatchObject({
      schemaVersion: 3,
      mode: "offline_artifact",
      executionMode: "paper",
      realMoneyGate: "closed",
      tradeable: false,
      statistics: {
        totalCases: 18,
        noTradeCases: 18,
        executedCases: 0,
        reconciledCases: 18,
        capitalMovedMicros: 0
      },
      corpus: {
        unit: "goal_market_feasibility_observation",
        coverage: "all_reported_goal_market_cases",
        goalEvents: 3,
        marketEventCases: 18,
        movedBeforeTxlineCases: 12,
        noMaterialRepriceCases: 6,
        cleanStaleWindows: 0,
        assurance: "local_file_sha256_not_capture_manifest_membership",
        selectedExemplar: {
          caseId: "SB-20260710-G01-MR",
          policy: "earliest_pretrigger_match_result_then_largest_pretrigger_ask_move"
        }
      },
      selectedCase: {
        summary: {
          caseId: "SB-20260710-G01-MR",
          fixtureLabel: "Spain vs Belgium",
          homeCode: "ESP",
          awayCode: "BEL",
          marketLabel: "Match result",
          selectedExemplar: true,
          goalOrdinal: 1,
          goalClockSeconds: 1761,
          detector: "STALE_QUOTE_FEASIBILITY",
          disposition: "No trade",
          executionOutcome: "Not executed",
          evidenceLane: "Research only",
          source: "Captured replay"
        },
        decision: {
          explanation: "The candidate arrived after the market had already moved. This retrospective feasibility observation never entered an execution runtime.",
          ordersPlaced: 0,
          walletAccessed: false
        },
        evidenceReadout: { consensusMoveFromBaselineBps: 25, preTriggerMarketMoveBps: 775 },
        analysis: { thesisStatus: "not_requested", costStatus: "not_applicable", costMicros: 0 },
        proof: { identityParity: true, canonicalEvents: 2_470_342 }
      }
    });
    expect(snapshot.cases).toHaveLength(18);
    expect(snapshot.corpus.commitment).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.selectedCase.proof.corpusCommitment).toBe(snapshot.corpus.commitment);
    expect(new Set(snapshot.cases.map((item) => item.caseId))).toHaveProperty("size", 18);
    expect(snapshot.cases.filter((item) => item.marketFamily === "Match result")).toHaveLength(3);
    expect(snapshot.cases.filter((item) => item.marketFamily === "Full-time total")).toHaveLength(15);
    expect(snapshot.cases.filter((item) => item.classification === "polymarket_moved_before_txline")).toHaveLength(12);
    expect(snapshot.cases.filter((item) => item.classification === "no_material_reprice_in_window")).toHaveLength(6);
    expect(snapshot.cases.filter((item) => item.selectedExemplar)).toEqual([snapshot.selectedCase.summary]);
    expect(casebookApiResponseSchema.parse({ data: snapshot })).toEqual({ data: snapshot });
    const truncated = structuredClone(snapshot);
    truncated.cases.pop();
    expect(casebookApiResponseSchema.safeParse({ data: truncated }).success).toBe(false);
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
        version: "paper-study-v2-2026-07-18",
        status: "registered",
        activity: "active_forward_paper",
        active: true,
        registeredAt: "2026-07-18T07:03:55Z",
        observationStatus: "awaiting_fresh_evidence",
        evidencePolicy: "fresh_forward_only",
        qualifyingCounts: { matches: 0, signals: 0, filledMatches: 0, fills: 0, settledFills: 0 },
        evaluation: { minimumFilledMatches: 20, minimumFills: 40, bootstrapIterations: 10_000 },
        risk: { bankrollMicroUsd: 50_000_000, perTradeStakeMicroUsd: 3_000_000, aggregateExposureMicroUsd: 15_000_000, drawdownStopMicroUsd: 20_000_000 },
        guardrailThresholds: { minimumFillRate: 0.6, maximumMeanSlippageBps: 100 }
      },
      historicalV1: {
        protocolVersion: "paper-study-v1-2026-07-12",
        status: "invalidated_suspended",
        active: false,
        invalidatedBeforeObservations: true,
        lanes: {
          bounty: { sourceStatus: "exploratory", canSatisfyGate: false },
          longRun: { sourceStatus: "sealed", stoppingRuleMet: false, canSatisfyGate: false }
        },
        results: { visibility: "sealed", rows: null, endpoints: null, guardrails: null }
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
        sourceRegistrationAtGeneration: "engineering_candidate_unregistered",
        activeStudyAtGeneration: false,
        executable: false
      },
      syntheticProof: {
        lifecycleStatus: "filled_settled",
        offlineVerified: true,
        performanceUse: "excluded_synthetic",
        externalCalls: 0,
        solanaAnchorStatus: "not_submitted"
      },
      fixtureUniverse: { evidenceFixtures: 0, pairedBookReplays: 0, executableBookReplays: 0, longRunEligible: 0 }
    });
  });

  it("exposes bucketed TXLine movement without exact levels, reconstructive gaps, or raw fields", async () => {
    const projections = {
      matchroom: await buildSpainBelgiumMatchroomSnapshot(repoRoot),
      command: await buildCommandSnapshot(repoRoot, Date.parse("2026-07-18T08:00:00.000Z")),
      casebook: await buildCasebookSnapshot(repoRoot),
      study: await buildStudySnapshot(repoRoot)
    };
    const serialized = JSON.stringify(projections);
    const keys = publicKeys(projections);

    for (const forbiddenKey of ["fairProbability", "consensusProbability", "Pct", "executableGap", "fixtureId"]) {
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
    for (const txlineFixtureId of ["18218149", "18237038", "18241006", "18257865", "18257739"]) {
      expect(serialized).not.toContain(txlineFixtureId);
    }
  });

  it("serves only the explicit read-only public API routes", async () => {
    const command = await handleDashboardApi(COMMAND_API_PATH, repoRoot);
    expect(command).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(command!.body)).toHaveProperty("data.study.status", "active_forward_paper");
    const match = await handleDashboardApi(SPAIN_BELGIUM_API_PATH, repoRoot);
    expect(match).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(match!.body)).toHaveProperty("data.publicDataPolicy.txlineProbabilityDisplay", "bucketed_movement_only");
    const casebook = await handleDashboardApi(CASEBOOK_API_PATH, repoRoot);
    expect(casebook).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(casebook!.body)).toHaveProperty("data.selectedCase.analysis.thesisStatus", "not_requested");
    const study = await handleDashboardApi(STUDY_API_PATH, repoRoot);
    expect(study).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect(JSON.parse(study!.body)).toMatchObject({
      data: {
        protocol: { status: "registered", activity: "active_forward_paper", qualifyingCounts: { fills: 0 } },
        historicalV1: { status: "invalidated_suspended" },
        results: { visibility: "sealed", endpoints: null },
        realMoneyGate: "closed"
      }
    });
    expect(await handleDashboardApi("/api/v1/wallet", repoRoot)).toMatchObject({ status: 404 });
    expect(await handleDashboardApi("/matchroom", repoRoot)).toBeNull();
  });
});
