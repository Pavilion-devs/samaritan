import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stableJson } from "../src/domain/json.js";
import {
  pairedCaptureEvidenceFromManifest,
  parseVerifiedPairedAnalysisManifest
} from "../src/harness/paired-capture-manifest.js";

function verifiedManifest() {
  const inputHashes = {
    captureConfig: "d".repeat(64),
    txlineFixtureSnapshot: "6".repeat(64),
    polymarketEventSnapshot: "7".repeat(64),
    polymarketTerminalManifest: "4".repeat(64),
    txlineTerminalManifest: "5".repeat(64),
    subscriptions: "e".repeat(64),
    polymarketMessages: "f".repeat(64),
    txlineOdds: "0".repeat(64),
    txlineScores: "1".repeat(64),
    mappings: "2".repeat(64),
    causalTotalEvidence: "3".repeat(64)
  };
  return {
    schemaVersion: 2,
    runId: "paired-test-2026-07-15",
    checkedAt: "2026-07-15T23:00:00.000Z",
    status: "verified",
    fixtureId: "fixture-1",
    eventSlug: "match-event-slug",
    totalsEventSlug: "totals-event-slug",
    capture: {
      logPath: "samples/_logs/paired-test-2026-07-15.log",
      txlineDir: "samples/odds-sse/mainnet/paired-test-2026-07-15",
      polymarketDir: "samples/polymarket-live/paired-test-2026-07-15",
      logComplete: true,
      pidStale: true,
      mappingConfirmed: true,
      scheduledStartUtc: "2026-07-15T16:00:00.000Z",
      scheduledEndUtc: "2026-07-15T23:00:00.000Z",
      kickoffUtc: "2026-07-15T18:00:00.000Z",
      signalCutoffUtc: "2026-07-15T17:45:00.000Z",
      firstPolymarketObservedAt: "2026-07-15T16:00:00.000Z",
      lastPolymarketObservedAt: "2026-07-15T23:00:00.000Z",
      firstTxlineOddsObservedAt: "2026-07-15T16:00:01.000Z",
      lastTxlineOddsObservedAt: "2026-07-15T23:00:00.000Z",
      firstTxlineScoresObservedAt: "2026-07-15T16:00:02.000Z",
      lastTxlineScoresObservedAt: "2026-07-15T23:00:00.000Z",
      expectedDurationMinutes: 420,
      observedSpanMinutes: 419.9,
      mappedAssetCount: 5,
      mappingRegistryRecords: 2
    },
    selectedTotal: {
      eventSlug: "totals-event-slug",
      marketId: "market-total-25",
      conditionId: "condition-total-25",
      lineMilli: 2_500,
      assetIds: ["asset-over", "asset-under"]
    },
    selectedMarketEvidence: {
      assets: [{
        assetId: "asset-over",
        outcome: "over",
        bookEvents: 20,
        usableDepthSnapshots: 10,
        firstUsableObservedAt: "2026-07-15T16:01:00.000Z",
        lastUsableObservedAt: "2026-07-15T22:00:00.000Z",
        latestPreKickoffObservedAt: "2026-07-15T17:59:58.000Z"
      }, {
        assetId: "asset-under",
        outcome: "under",
        bookEvents: 20,
        usableDepthSnapshots: 10,
        firstUsableObservedAt: "2026-07-15T16:01:01.000Z",
        lastUsableObservedAt: "2026-07-15T22:00:01.000Z",
        latestPreKickoffObservedAt: "2026-07-15T17:59:59.000Z"
      }],
      txline: {
        exactFixtureOddsFrames: 20,
        exactFixtureScoreFrames: 8,
        completedExactFixtureScoreFrames: 1,
        selectedTotalUsableOddsFrames: 12,
        selectedTotalFirstObservedAt: "2026-07-15T16:00:01.000Z",
        selectedTotalLastObservedAt: "2026-07-15T17:59:57.000Z",
        finalScore: { homeGoals: 2, awayGoals: 1 }
      },
      kickoffClose: {
        available: true,
        txlineObservedAt: "2026-07-15T17:59:57.000Z",
        polymarketAssetObservedAt: {
          "asset-over": "2026-07-15T17:59:58.000Z",
          "asset-under": "2026-07-15T17:59:59.000Z"
        }
      },
      resolution: {
        available: true,
        normalized: true,
        conditionId: "condition-total-25",
        assetIds: ["asset-over", "asset-under"],
        winningAssetId: "asset-over",
        winningOutcome: "over",
        observedAt: "2026-07-15T20:00:00.000Z"
      },
      canonicalIngress: {
        eventCount: 100,
        firstObservedAt: "2026-07-15T16:00:00.000Z",
        lastObservedAt: "2026-07-15T23:00:00.000Z",
        modelStallBudgetMs: 240_000,
        maximumEventsInModelStallWindow: 10,
        requiredIngressCapacity: 125,
        counts: {
          selectedOdds: 20,
          fixtureScores: 8,
          selectedBooks: 40,
          selectedPrices: 31,
          selectedResolutions: 1,
          feedEvents: 0
        }
      }
    },
    verification: {
      node: "v22.23.1",
      replayMode: "capture-order-per-source",
      identityParity: true,
      identityHash: "a".repeat(64),
      headHash: "c".repeat(64),
      rows: 100,
      counts: {
        "odds.quote": 20,
        "score.update": 8,
        "polymarket.book": 40,
        "polymarket.price": 31,
        "polymarket.resolution": 1
      },
      hasModeField: false,
      selectedBookDepthComplete: true,
      exactFixtureTxlineOddsAvailable: true,
      exactFixtureTxlineScoresAvailable: true,
      exactFixtureScoreCompleted: true,
      kickoffCloseAvailable: true,
      publicResolutionAvailable: true,
      publicMarketResolvedNormalized: true
    },
    proof: {
      algorithm: "sha256",
      inputCommitment: createHash("sha256").update(stableJson(inputHashes)).digest("hex"),
      analysisCommitment: "c".repeat(64),
      inputHashes
    },
    admission: { status: "eligible", missingGates: [] as string[] },
    failures: [],
    notes: ["Verified exact selected-total proof."]
  };
}

describe("paired capture analysis manifest admission", () => {
  it("parses exact schema-v2 evidence into a selected-condition admission record", () => {
    const manifest = parseVerifiedPairedAnalysisManifest(verifiedManifest());
    expect(manifest).not.toBeNull();
    expect(pairedCaptureEvidenceFromManifest(manifest!)).toEqual({
      runId: "paired-test-2026-07-15",
      status: "verified",
      fixtureId: "fixture-1",
      eventSlug: "match-event-slug",
      logComplete: true,
      mappingConfirmed: true,
      identityParity: true,
      replayMode: "capture-order-per-source",
      rows: 100,
      firstPolymarketObservedTsMs: Date.parse("2026-07-15T16:00:00.000Z"),
      lastPolymarketObservedTsMs: Date.parse("2026-07-15T23:00:00.000Z"),
      firstTxlineOddsObservedTsMs: Date.parse("2026-07-15T16:00:01.000Z"),
      lastTxlineOddsObservedTsMs: Date.parse("2026-07-15T23:00:00.000Z"),
      firstTxlineScoresObservedTsMs: Date.parse("2026-07-15T16:00:02.000Z"),
      lastTxlineScoresObservedTsMs: Date.parse("2026-07-15T23:00:00.000Z"),
      selectedTotal: {
        eventSlug: "totals-event-slug",
        marketId: "market-total-25",
        conditionId: "condition-total-25",
        lineMilli: 2_500,
        assetIds: ["asset-over", "asset-under"]
      },
      selectedBookDepthComplete: true,
      exactFixtureTxlineOddsAvailable: true,
      exactFixtureTxlineScoresAvailable: true,
      exactFixtureScoreCompleted: true,
      proofCommitment: "c".repeat(64),
      kickoffCloseAvailable: true,
      publicResolutionAvailable: true,
      publicMarketResolvedNormalized: true
    });
  });

  it("rejects an input-hash set that no longer matches its commitment", () => {
    const malformed = verifiedManifest();
    malformed.proof.inputHashes.mappings = "9".repeat(64);
    expect(() => parseVerifiedPairedAnalysisManifest(malformed)).toThrow(
      /Input commitment must hash the exact committed input-hash set/
    );
  });

  it("permits capture proof with an unreviewed mapping only when admission remains failed closed", () => {
    const manifest = verifiedManifest();
    manifest.capture.mappingConfirmed = false;
    manifest.admission = {
      status: "failed_closed",
      missingGates: ["deborah_reviewed_mapping_required"]
    };
    expect(parseVerifiedPairedAnalysisManifest(manifest)?.capture.mappingConfirmed).toBe(false);

    manifest.admission = { status: "eligible", missingGates: [] };
    expect(() => parseVerifiedPairedAnalysisManifest(manifest)).toThrow(/reviewed mapping/);
  });

  it("does not let other-market book evidence authorize the selected assets", () => {
    const malformed = verifiedManifest();
    malformed.selectedMarketEvidence.assets[1]!.assetId = "other-market-asset";
    expect(() => parseVerifiedPairedAnalysisManifest(malformed)).toThrow(/exactly both selected-total assets/);
  });

  it("rejects partial selected book depth", () => {
    const malformed = verifiedManifest();
    malformed.selectedMarketEvidence.assets[1]!.usableDepthSnapshots = 0;
    expect(() => parseVerifiedPairedAnalysisManifest(malformed)).toThrow(/expected number to be >0/);
  });

  it("rejects a resolution for another condition or a winner that disagrees with the final score", () => {
    const wrongCondition = verifiedManifest();
    wrongCondition.selectedMarketEvidence.resolution.conditionId = "other-condition";
    expect(() => parseVerifiedPairedAnalysisManifest(wrongCondition)).toThrow(/exact selected condition/);

    const wrongWinner = verifiedManifest();
    wrongWinner.selectedMarketEvidence.resolution.winningAssetId = "asset-under";
    wrongWinner.selectedMarketEvidence.resolution.winningOutcome = "under";
    expect(() => parseVerifiedPairedAnalysisManifest(wrongWinner)).toThrow(/final score/);
  });

  it("rejects partial or mismatched selected kickoff-close evidence", () => {
    const malformed = verifiedManifest();
    Reflect.deleteProperty(
      malformed.selectedMarketEvidence.kickoffClose.polymarketAssetObservedAt,
      "asset-under"
    );
    expect(() => parseVerifiedPairedAnalysisManifest(malformed)).toThrow(/both Polymarket assets/);
  });

  it("rejects missing executable observations and mode discriminators", () => {
    const noBooks = verifiedManifest();
    noBooks.verification.counts["polymarket.book"] = 0;
    expect(() => parseVerifiedPairedAnalysisManifest(noBooks)).toThrow(/positive polymarket\.book count/);

    const hasMode = verifiedManifest();
    hasMode.verification.hasModeField = true;
    expect(() => parseVerifiedPairedAnalysisManifest(hasMode)).toThrow(/hasModeField/);
  });

  it("requires positive synchronized odds, scores, and book overlap", () => {
    const malformed = verifiedManifest();
    malformed.capture.firstTxlineScoresObservedAt = "2026-07-16T00:00:00.000Z";
    malformed.capture.lastTxlineScoresObservedAt = "2026-07-16T01:00:00.000Z";
    expect(() => parseVerifiedPairedAnalysisManifest(malformed)).toThrow(/positive synchronized overlap/);
  });

  it("ignores failed-closed and legacy verified manifests because neither has v2 admission authority", () => {
    expect(parseVerifiedPairedAnalysisManifest({ status: "failed_closed" })).toBeNull();
    expect(parseVerifiedPairedAnalysisManifest({
      schemaVersion: 1,
      status: "verified",
      note: "Synthetic legacy shape without v2 selected-condition admission authority."
    })).toBeNull();
  });
});
