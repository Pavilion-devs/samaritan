import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableJson } from "../src/domain/json.js";
import { handleDashboardApi, STUDY_API_PATH } from "../src/dash/api.js";
import { exportPublicDashboardBundle } from "../src/dash/export-public-bundle.js";
import {
  PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR,
  PUBLIC_DASHBOARD_FILES,
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
  parsePublicDashboardManifest,
  parsePublicDashboardResponse,
  readFrozenDashboardResponse,
  type PublicDashboardApiPath
} from "../src/dash/public-bundle.js";
import { auditPublicArtifacts } from "../src/public/artifact-safety.js";
import { verifyDecisionReceipt } from "../src/proof/decision-receipt-schema.js";

const repoRoot = resolve(import.meta.dirname, "..");
const trackedBundle = resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
const privateProjectionEvidenceAvailable = process.env.SAMARITAN_TEST_NO_PRIVATE_DATA !== "1" && [
  "data/research/historical-gate-study-causal-economic-v4.json",
  "data/paper/v2/reports/current.json",
  "data/paper/v2/fixture-universe.json"
].every((path) => existsSync(resolve(repoRoot, path)));
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "samaritan-dashboard-bundle-"));
  directories.push(directory);
  return directory;
}

function copyTrackedBundle(targetRepoRoot: string): string {
  const target = resolve(targetRepoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  mkdirSync(target, { recursive: true });
  for (const filename of [
    ...PUBLIC_DASHBOARD_FILES.map((entry) => entry.file),
    PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
    "manifest.json"
  ]) {
    copyFileSync(resolve(trackedBundle, filename), resolve(target, filename));
  }
  return target;
}

describe("tracked public dashboard bundle", () => {
  it("has a valid deterministic manifest, response hashes, strict schemas, and public-data audit", async () => {
    const manifest = parsePublicDashboardManifest(JSON.parse(readFileSync(resolve(trackedBundle, "manifest.json"), "utf8")));

    expect(manifest.files.map((entry) => entry.apiPath)).toEqual(PUBLIC_DASHBOARD_FILES.map((entry) => entry.apiPath));
    for (const definition of PUBLIC_DASHBOARD_FILES) {
      const frozen = await readFrozenDashboardResponse(repoRoot, definition.apiPath);
      expect(frozen.manifest.bundleSha256).toBe(manifest.bundleSha256);
      expect(JSON.parse(frozen.body)).toHaveProperty("data.snapshotId", definition.snapshotId);
    }
    const audit = await auditPublicArtifacts({ allowlistedPaths: [trackedBundle], cwd: repoRoot });
    expect(audit.ok, JSON.stringify(audit.violations, null, 2)).toBe(true);
    const receipt = JSON.parse(readFileSync(resolve(trackedBundle, PUBLIC_SYNTHETIC_RECEIPT_FILENAME), "utf8")) as {
      generatedAtTsMs: number;
    };
    expect(Date.parse(manifest.generatedAt)).toBeGreaterThanOrEqual(receipt.generatedAtTsMs);
    expect(verifyDecisionReceipt(receipt)).toMatchObject({
      valid: true,
      synthetic: true,
      lifecycleStatus: "filled_settled",
      solanaNetworkVerificationPerformed: false
    });
    expect(manifest.downloads).toEqual([
      expect.objectContaining({
        file: PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
        synthetic: true,
        performanceUse: "excluded_synthetic"
      })
    ]);

    const dashboardPayload = PUBLIC_DASHBOARD_FILES
      .map((entry) => readFileSync(resolve(trackedBundle, entry.file), "utf8"))
      .join("\n");
    expect(dashboardPayload).not.toContain('"fixtureId"');
    for (const txlineFixtureId of ["18218149", "18237038", "18241006", "18257865", "18257739"]) {
      expect(dashboardPayload).not.toContain(txlineFixtureId);
    }
  });

  it("serves from a clean-clone-shaped root containing no ignored data directory", async () => {
    const cleanRoot = temporaryDirectory();
    copyTrackedBundle(cleanRoot);

    const response = await handleDashboardApi(STUDY_API_PATH, cleanRoot);

    expect(response).toMatchObject({ status: 200, headers: { "x-samaritan-public-bundle": expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(JSON.parse(response!.body)).toMatchObject({
      data: {
        protocol: {
          version: "paper-study-v2-2026-07-18",
          status: "registered",
          activity: "active_forward_paper",
          active: true,
          registeredAt: "2026-07-18T07:03:55Z",
          qualifyingCounts: { matches: 0, signals: 0, filledMatches: 0, fills: 0, settledFills: 0 },
          realMoneyGate: "closed"
        },
        historicalV1: {
          protocolVersion: "paper-study-v1-2026-07-12",
          status: "invalidated_suspended",
          active: false,
          invalidatedBeforeObservations: true
        },
        correctedHistoricalCandidate: {
          trainingNormalizedCases: 135,
          heldoutNormalizedCases: 38,
          heldoutFixtures: 18,
          meanNetAfterCostProxyBps: 132.7,
          matchClustered95Bps: { low: 14.3, high: 243.9 },
          activeStudyAtGeneration: false,
          executable: false,
          sourceRegistrationAtGeneration: "engineering_candidate_unregistered"
        },
        syntheticProof: {
          lifecycleStatus: "filled_settled",
          offlineVerified: true,
          performanceUse: "excluded_synthetic",
          externalCalls: 0,
          solanaAnchorStatus: "not_submitted"
        }
      }
    });
  });

  it("rejects response-byte tampering before parsing", async () => {
    const cleanRoot = temporaryDirectory();
    const bundle = copyTrackedBundle(cleanRoot);
    const commandPath = resolve(bundle, "command.json");
    writeFileSync(commandPath, `${readFileSync(commandPath, "utf8")} `);

    await expect(readFrozenDashboardResponse(cleanRoot, "/api/v1/command")).rejects.toThrow(/byte count changed/);
  });

  it("rejects manifest tampering and route-map substitution", () => {
    const source = JSON.parse(readFileSync(resolve(trackedBundle, "manifest.json"), "utf8")) as {
      bundleSha256: string;
      files: Array<{ file: string }>;
    };
    const changedHash = structuredClone(source);
    changedHash.bundleSha256 = "0".repeat(64);
    expect(() => parsePublicDashboardManifest(changedHash)).toThrow(/bundle hash is invalid/);

    const changedRoute = structuredClone(source);
    changedRoute.files[0]!.file = "study.json";
    expect(() => parsePublicDashboardManifest(changedRoute)).toThrow(/route map/);
  });

  it("rejects schema additions and corrected-evidence claim drift even with valid JSON", () => {
    const command = JSON.parse(readFileSync(resolve(trackedBundle, "command.json"), "utf8")) as {
      data: Record<string, unknown>;
    };
    command.data.Pct = ["51.000", "49.000"];
    expect(() => parsePublicDashboardResponse("/api/v1/command", command)).toThrow();

    const study = JSON.parse(readFileSync(resolve(trackedBundle, "study.json"), "utf8")) as {
      data: { correctedHistoricalCandidate: { meanNetAfterCostProxyBps: number } };
    };
    study.data.correctedHistoricalCandidate.meanNetAfterCostProxyBps = 999;
    expect(() => parsePublicDashboardResponse(STUDY_API_PATH, study)).toThrow();
  });

  it.runIf(privateProjectionEvidenceAvailable)("re-exports byte-identically from unchanged private projections", async () => {
    const first = temporaryDirectory();
    const second = temporaryDirectory();
    const firstResult = await exportPublicDashboardBundle({ repoRoot, outputDir: first });
    const secondResult = await exportPublicDashboardBundle({ repoRoot, outputDir: second });

    expect(secondResult.manifest.bundleSha256).toBe(firstResult.manifest.bundleSha256);
    expect(stableJson(secondResult.manifest)).toBe(stableJson(firstResult.manifest));
    for (const filename of [
      ...PUBLIC_DASHBOARD_FILES.map((entry) => entry.file),
      PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
      "manifest.json"
    ]) {
      expect(readFileSync(resolve(second, filename), "utf8")).toBe(readFileSync(resolve(first, filename), "utf8"));
    }
  });

  it.each(PUBLIC_DASHBOARD_FILES)("strictly serves frozen $apiPath", async ({ apiPath, snapshotId }) => {
    const response = await handleDashboardApi(apiPath as PublicDashboardApiPath, repoRoot);
    expect(response?.status).toBe(200);
    expect(JSON.parse(response!.body)).toHaveProperty("data.snapshotId", snapshotId);
  });
});
