import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../domain/json.js";
import {
  pairedCaptureEvidenceSchema,
  type PairedCaptureEvidence
} from "./paper-fixture-universe.js";
import {
  CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT,
  CAPTURED_PAPER_MODEL_STALL_BUDGET_MS,
  capturedPaperIngressCapacity
} from "./captured-paper-admission.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nonnegativeCountSchema = z.number().int().nonnegative();
const pairedCaptureInputHashesSchema = z.object({
  captureConfig: hashSchema,
  txlineFixtureSnapshot: hashSchema,
  polymarketEventSnapshot: hashSchema,
  polymarketTerminalManifest: hashSchema,
  txlineTerminalManifest: hashSchema,
  subscriptions: hashSchema,
  polymarketMessages: hashSchema,
  txlineOdds: hashSchema,
  txlineScores: hashSchema,
  mappings: hashSchema,
  causalTotalEvidence: hashSchema
}).strict();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortedDistinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

export const selectedTotalBindingSchema = z.object({
  eventSlug: z.string().min(1),
  marketId: z.string().min(1),
  conditionId: z.string().min(1),
  lineMilli: z.number().int().positive().safe(),
  assetIds: z.array(z.string().min(1)).length(2)
}).strict().superRefine((binding, context) => {
  if (!sortedDistinct(binding.assetIds)) {
    context.addIssue({
      code: "custom",
      message: "Selected-total asset IDs must be distinct and lexicographically sorted",
      path: ["assetIds"]
    });
  }
});

const selectedBookAssetEvidenceSchema = z.object({
  assetId: z.string().min(1),
  outcome: z.enum(["over", "under"]),
  bookEvents: z.number().int().positive(),
  usableDepthSnapshots: z.number().int().positive(),
  firstUsableObservedAt: z.string().datetime(),
  lastUsableObservedAt: z.string().datetime(),
  latestPreKickoffObservedAt: z.string().datetime().nullable()
}).strict();

const selectedMarketEvidenceSchema = z.object({
  assets: z.array(selectedBookAssetEvidenceSchema).length(2),
  txline: z.object({
    exactFixtureOddsFrames: z.number().int().positive(),
    exactFixtureScoreFrames: z.number().int().positive(),
    completedExactFixtureScoreFrames: z.number().int().positive(),
    selectedTotalUsableOddsFrames: z.number().int().positive(),
    selectedTotalFirstObservedAt: z.string().datetime(),
    selectedTotalLastObservedAt: z.string().datetime(),
    finalScore: z.object({
      homeGoals: z.number().int().nonnegative(),
      awayGoals: z.number().int().nonnegative()
    }).strict()
  }).strict(),
  kickoffClose: z.object({
    available: z.boolean(),
    txlineObservedAt: z.string().datetime().nullable(),
    polymarketAssetObservedAt: z.record(z.string().min(1), z.string().datetime())
  }).strict(),
  resolution: z.object({
    available: z.boolean(),
    normalized: z.boolean(),
    conditionId: z.string().min(1).nullable(),
    assetIds: z.array(z.string().min(1)),
    winningAssetId: z.string().min(1).nullable(),
    winningOutcome: z.enum(["over", "under"]).nullable(),
    observedAt: z.string().datetime().nullable()
  }).strict(),
  canonicalIngress: z.object({
    eventCount: z.number().int().positive().safe(),
    firstObservedAt: z.string().datetime(),
    lastObservedAt: z.string().datetime(),
    modelStallBudgetMs: z.literal(CAPTURED_PAPER_MODEL_STALL_BUDGET_MS),
    maximumEventsInModelStallWindow: z.number().int().positive().safe(),
    requiredIngressCapacity: z.number().int().positive().max(CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT),
    counts: z.object({
      selectedOdds: nonnegativeCountSchema,
      fixtureScores: nonnegativeCountSchema,
      selectedBooks: nonnegativeCountSchema,
      selectedPrices: nonnegativeCountSchema,
      selectedResolutions: nonnegativeCountSchema,
      feedEvents: nonnegativeCountSchema
    }).strict()
  }).strict()
}).strict();

export const verifiedPairedAnalysisManifestSchema = z.object({
  schemaVersion: z.literal(2),
  runId: z.string().min(1),
  checkedAt: z.string().datetime(),
  status: z.literal("verified"),
  fixtureId: z.string().min(1),
  eventSlug: z.string().min(1),
  totalsEventSlug: z.string().min(1),
  capture: z.object({
    logPath: z.string().min(1),
    txlineDir: z.string().min(1),
    polymarketDir: z.string().min(1),
    logComplete: z.literal(true),
    pidStale: z.boolean(),
    mappingConfirmed: z.boolean(),
    scheduledStartUtc: z.string().datetime(),
    scheduledEndUtc: z.string().datetime(),
    kickoffUtc: z.string().datetime(),
    signalCutoffUtc: z.string().datetime(),
    firstPolymarketObservedAt: z.string().datetime(),
    lastPolymarketObservedAt: z.string().datetime(),
    firstTxlineOddsObservedAt: z.string().datetime(),
    lastTxlineOddsObservedAt: z.string().datetime(),
    firstTxlineScoresObservedAt: z.string().datetime(),
    lastTxlineScoresObservedAt: z.string().datetime(),
    expectedDurationMinutes: z.number().int().positive(),
    observedSpanMinutes: z.number().nonnegative(),
    mappedAssetCount: z.number().int().positive(),
    mappingRegistryRecords: z.number().int().positive()
  }).strict(),
  selectedTotal: selectedTotalBindingSchema,
  selectedMarketEvidence: selectedMarketEvidenceSchema,
  verification: z.object({
    node: z.string().regex(/^v22\./),
    replayMode: z.literal("capture-order-per-source"),
    identityParity: z.literal(true),
    identityHash: hashSchema,
    headHash: hashSchema,
    rows: z.number().int().positive(),
    counts: z.record(z.string().min(1), nonnegativeCountSchema),
    hasModeField: z.literal(false),
    selectedBookDepthComplete: z.literal(true),
    exactFixtureTxlineOddsAvailable: z.literal(true),
    exactFixtureTxlineScoresAvailable: z.literal(true),
    exactFixtureScoreCompleted: z.literal(true),
    kickoffCloseAvailable: z.boolean(),
    publicResolutionAvailable: z.boolean(),
    publicMarketResolvedNormalized: z.boolean(),
    sourceRegression: z.object({
      sourceTsRegressionsObserved: nonnegativeCountSchema,
      observedTsRegressionsRejected: nonnegativeCountSchema
    }).strict().optional()
  }).strict(),
  proof: z.object({
    algorithm: z.literal("sha256"),
    inputCommitment: hashSchema,
    analysisCommitment: hashSchema,
    inputHashes: pairedCaptureInputHashesSchema
  }).strict(),
  admission: z.object({
    status: z.enum(["eligible", "failed_closed"]),
    missingGates: z.array(z.string().min(1))
  }).strict(),
  failures: z.array(z.never()).max(0),
  notes: z.array(z.string().min(1))
}).strict().superRefine((manifest, context) => {
  if (manifest.proof.inputCommitment !== sha256(stableJson(manifest.proof.inputHashes))) {
    context.addIssue({
      code: "custom",
      message: "Input commitment must hash the exact committed input-hash set",
      path: ["proof", "inputCommitment"]
    });
  }
  const requiredPositiveStreams = ["odds.quote", "score.update", "polymarket.book"] as const;
  for (const stream of requiredPositiveStreams) {
    if ((manifest.verification.counts[stream] ?? 0) <= 0) {
      context.addIssue({
        code: "custom",
        message: `Verified paired capture requires a positive ${stream} count`,
        path: ["verification", "counts", stream]
      });
    }
  }
  const polymarketStart = Date.parse(manifest.capture.firstPolymarketObservedAt);
  const polymarketEnd = Date.parse(manifest.capture.lastPolymarketObservedAt);
  const txlineOddsStart = Date.parse(manifest.capture.firstTxlineOddsObservedAt);
  const txlineOddsEnd = Date.parse(manifest.capture.lastTxlineOddsObservedAt);
  const txlineScoresStart = Date.parse(manifest.capture.firstTxlineScoresObservedAt);
  const txlineScoresEnd = Date.parse(manifest.capture.lastTxlineScoresObservedAt);
  if (polymarketEnd <= polymarketStart || txlineOddsEnd <= txlineOddsStart || txlineScoresEnd <= txlineScoresStart) {
    context.addIssue({
      code: "custom",
      message: "Each paired source requires a positive observation window",
      path: ["capture", "lastPolymarketObservedAt"]
    });
  }
  if (
    Math.min(polymarketEnd, txlineOddsEnd, txlineScoresEnd) <=
    Math.max(polymarketStart, txlineOddsStart, txlineScoresStart)
  ) {
    context.addIssue({
      code: "custom",
      message: "Verified paired sources require a positive synchronized overlap",
      path: ["capture", "firstTxlineOddsObservedAt"]
    });
  }
  const selectedAssets = manifest.selectedTotal.assetIds;
  if (manifest.selectedTotal.eventSlug !== manifest.totalsEventSlug) {
    context.addIssue({
      code: "custom",
      message: "Selected total must belong to the exact captured totals event",
      path: ["selectedTotal", "eventSlug"]
    });
  }
  const bookAssets = manifest.selectedMarketEvidence.assets.map((asset) => asset.assetId).sort();
  if (JSON.stringify(selectedAssets) !== JSON.stringify(bookAssets)) {
    context.addIssue({
      code: "custom",
      message: "Selected book evidence must cover exactly both selected-total assets",
      path: ["selectedMarketEvidence", "assets"]
    });
  }
  const outcomes = manifest.selectedMarketEvidence.assets.map((asset) => asset.outcome).sort();
  if (JSON.stringify(outcomes) !== JSON.stringify(["over", "under"])) {
    context.addIssue({
      code: "custom",
      message: "Selected book evidence requires Over and Under depth",
      path: ["selectedMarketEvidence", "assets"]
    });
  }
  const kickoff = Date.parse(manifest.capture.kickoffUtc);
  for (const [index, asset] of manifest.selectedMarketEvidence.assets.entries()) {
    if (Date.parse(asset.lastUsableObservedAt) < Date.parse(asset.firstUsableObservedAt)) {
      context.addIssue({
        code: "custom",
        message: "Selected book evidence cannot end before it begins",
        path: ["selectedMarketEvidence", "assets", index, "lastUsableObservedAt"]
      });
    }
    if (asset.latestPreKickoffObservedAt !== null && Date.parse(asset.latestPreKickoffObservedAt) >= kickoff) {
      context.addIssue({
        code: "custom",
        message: "Selected book close must be observed strictly before kickoff",
        path: ["selectedMarketEvidence", "assets", index, "latestPreKickoffObservedAt"]
      });
    }
  }
  if (
    Date.parse(manifest.selectedMarketEvidence.txline.selectedTotalLastObservedAt) <
    Date.parse(manifest.selectedMarketEvidence.txline.selectedTotalFirstObservedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Selected TXLine total evidence cannot end before it begins",
      path: ["selectedMarketEvidence", "txline", "selectedTotalLastObservedAt"]
    });
  }
  const close = manifest.selectedMarketEvidence.kickoffClose;
  if (close.available) {
    const closeAssets = Object.keys(close.polymarketAssetObservedAt).sort();
    if (
      close.txlineObservedAt === null ||
      JSON.stringify(closeAssets) !== JSON.stringify(selectedAssets)
    ) {
      context.addIssue({
        code: "custom",
        message: "Available kickoff close requires selected TXLine and both Polymarket assets",
        path: ["selectedMarketEvidence", "kickoffClose"]
      });
    } else if (
      Date.parse(close.txlineObservedAt) >= kickoff ||
      Object.values(close.polymarketAssetObservedAt).some((value) => Date.parse(value) >= kickoff)
    ) {
      context.addIssue({
        code: "custom",
        message: "Kickoff-close evidence must be observed strictly before kickoff",
        path: ["selectedMarketEvidence", "kickoffClose"]
      });
    } else if (
      manifest.selectedMarketEvidence.assets.some((asset) =>
        asset.latestPreKickoffObservedAt !== close.polymarketAssetObservedAt[asset.assetId]
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Kickoff close must bind the exact latest selected-asset observations",
        path: ["selectedMarketEvidence", "kickoffClose"]
      });
    }
  } else if (close.txlineObservedAt !== null || Object.keys(close.polymarketAssetObservedAt).length !== 0) {
    context.addIssue({
      code: "custom",
      message: "Unavailable kickoff close cannot carry partial evidence",
      path: ["selectedMarketEvidence", "kickoffClose"]
    });
  }
  const resolution = manifest.selectedMarketEvidence.resolution;
  if (resolution.available) {
    if (
      !resolution.normalized ||
      resolution.conditionId !== manifest.selectedTotal.conditionId ||
      JSON.stringify(resolution.assetIds) !== JSON.stringify(selectedAssets) ||
      resolution.winningAssetId === null ||
      !selectedAssets.includes(resolution.winningAssetId) ||
      resolution.winningOutcome === null ||
      resolution.observedAt === null ||
      manifest.selectedMarketEvidence.assets.find((asset) => asset.assetId === resolution.winningAssetId)?.outcome !==
        resolution.winningOutcome
    ) {
      context.addIssue({
        code: "custom",
        message: "Public resolution must normalize the exact selected condition and assets",
        path: ["selectedMarketEvidence", "resolution"]
      });
    } else {
      const finalScore = manifest.selectedMarketEvidence.txline.finalScore;
      const finalTotalMilli = (finalScore.homeGoals + finalScore.awayGoals) * 1_000;
      const expectedWinner = finalTotalMilli > manifest.selectedTotal.lineMilli ? "over"
        : finalTotalMilli < manifest.selectedTotal.lineMilli ? "under"
          : null;
      if (expectedWinner === null || resolution.winningOutcome !== expectedWinner) {
        context.addIssue({
          code: "custom",
          message: "Public resolution must agree with the exact-fixture TXLine final score",
          path: ["selectedMarketEvidence", "resolution", "winningOutcome"]
        });
      }
      if (Date.parse(resolution.observedAt) < kickoff) {
        context.addIssue({
          code: "custom",
          message: "Public resolution cannot precede kickoff",
          path: ["selectedMarketEvidence", "resolution", "observedAt"]
        });
      }
    }
  } else if (
    resolution.normalized || resolution.conditionId !== null || resolution.assetIds.length !== 0 ||
    resolution.winningAssetId !== null || resolution.winningOutcome !== null || resolution.observedAt !== null
  ) {
    context.addIssue({
      code: "custom",
      message: "Unavailable public resolution cannot carry partial evidence",
      path: ["selectedMarketEvidence", "resolution"]
    });
  }
  if (
    manifest.verification.kickoffCloseAvailable !== close.available ||
    manifest.verification.publicResolutionAvailable !== resolution.available ||
    manifest.verification.publicMarketResolvedNormalized !== resolution.normalized
  ) {
    context.addIssue({
      code: "custom",
      message: "Capability flags must equal their selected-condition evidence",
      path: ["verification"]
    });
  }
  const ingress = manifest.selectedMarketEvidence.canonicalIngress;
  const ingressProfile = {
    eventCount: ingress.eventCount,
    firstObservedTsMs: Date.parse(ingress.firstObservedAt),
    lastObservedTsMs: Date.parse(ingress.lastObservedAt),
    modelStallBudgetMs: ingress.modelStallBudgetMs,
    maximumEventsInModelStallWindow: ingress.maximumEventsInModelStallWindow,
    counts: ingress.counts
  };
  if (Date.parse(ingress.lastObservedAt) < Date.parse(ingress.firstObservedAt)) {
    context.addIssue({
      code: "custom",
      message: "Selected canonical ingress cannot end before it begins",
      path: ["selectedMarketEvidence", "canonicalIngress", "lastObservedAt"]
    });
  }
  try {
    if (capturedPaperIngressCapacity(ingressProfile) !== ingress.requiredIngressCapacity) {
      context.addIssue({
        code: "custom",
        message: "Selected canonical ingress capacity does not match its committed event profile",
        path: ["selectedMarketEvidence", "canonicalIngress", "requiredIngressCapacity"]
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
      path: ["selectedMarketEvidence", "canonicalIngress"]
    });
  }
  if (manifest.admission.status === "eligible" && manifest.admission.missingGates.length > 0) {
    context.addIssue({ code: "custom", message: "Eligible admission cannot have missing gates", path: ["admission"] });
  }
  if (manifest.admission.status === "failed_closed" && manifest.admission.missingGates.length === 0) {
    context.addIssue({ code: "custom", message: "Failed-closed admission requires a missing gate", path: ["admission"] });
  }
  if (
    manifest.admission.status === "eligible" &&
    (!manifest.capture.mappingConfirmed || !close.available || !resolution.available || !resolution.normalized)
  ) {
    context.addIssue({
      code: "custom",
      message: "Eligible admission requires reviewed mapping, selected kickoff close, and normalized resolution",
      path: ["admission", "status"]
    });
  }
  const synchronizedStart = Math.max(polymarketStart, txlineOddsStart, txlineScoresStart);
  if (
    manifest.admission.status === "eligible" &&
    synchronizedStart > Date.parse(manifest.capture.signalCutoffUtc)
  ) {
    context.addIssue({
      code: "custom",
      message: "Eligible admission requires synchronized capture before the signal cutoff",
      path: ["capture", "signalCutoffUtc"]
    });
  }
  if (manifest.verification.headHash !== manifest.proof.analysisCommitment) {
    context.addIssue({
      code: "custom",
      message: "Verification head hash must equal the deterministic analysis commitment",
      path: ["verification", "headHash"]
    });
  }
});

const manifestStatusSchema = z.object({
  schemaVersion: z.number().int().optional(),
  status: z.string()
}).passthrough();

export type SelectedTotalBinding = z.infer<typeof selectedTotalBindingSchema>;
export type VerifiedPairedAnalysisManifest = z.infer<typeof verifiedPairedAnalysisManifestSchema>;

/**
 * Only schema-v2 manifests with an exact selected-total evidence binding carry
 * admission authority. Legacy `status: verified` records remain visible audit
 * history but cannot silently authorize a selected market.
 */
export function parseVerifiedPairedAnalysisManifest(value: unknown): VerifiedPairedAnalysisManifest | null {
  const header = manifestStatusSchema.parse(value);
  if (header.status !== "verified" || header.schemaVersion !== 2) return null;
  return verifiedPairedAnalysisManifestSchema.parse(value);
}

export function pairedCaptureEvidenceFromManifest(
  manifest: VerifiedPairedAnalysisManifest
): PairedCaptureEvidence {
  const timestamp = (value: string): number => Date.parse(value);
  return pairedCaptureEvidenceSchema.parse({
    runId: manifest.runId,
    status: manifest.status,
    fixtureId: manifest.fixtureId,
    eventSlug: manifest.eventSlug,
    logComplete: manifest.capture.logComplete,
    mappingConfirmed: manifest.capture.mappingConfirmed,
    identityParity: manifest.verification.identityParity,
    replayMode: manifest.verification.replayMode,
    rows: manifest.verification.rows,
    firstPolymarketObservedTsMs: timestamp(manifest.capture.firstPolymarketObservedAt),
    lastPolymarketObservedTsMs: timestamp(manifest.capture.lastPolymarketObservedAt),
    firstTxlineOddsObservedTsMs: timestamp(manifest.capture.firstTxlineOddsObservedAt),
    lastTxlineOddsObservedTsMs: timestamp(manifest.capture.lastTxlineOddsObservedAt),
    firstTxlineScoresObservedTsMs: timestamp(manifest.capture.firstTxlineScoresObservedAt),
    lastTxlineScoresObservedTsMs: timestamp(manifest.capture.lastTxlineScoresObservedAt),
    selectedTotal: manifest.selectedTotal,
    selectedBookDepthComplete: manifest.verification.selectedBookDepthComplete,
    exactFixtureTxlineOddsAvailable: manifest.verification.exactFixtureTxlineOddsAvailable,
    exactFixtureTxlineScoresAvailable: manifest.verification.exactFixtureTxlineScoresAvailable,
    exactFixtureScoreCompleted: manifest.verification.exactFixtureScoreCompleted,
    proofCommitment: manifest.proof.analysisCommitment,
    kickoffCloseAvailable: manifest.verification.kickoffCloseAvailable,
    publicResolutionAvailable: manifest.verification.publicResolutionAvailable,
    publicMarketResolvedNormalized: manifest.verification.publicMarketResolvedNormalized
  });
}
