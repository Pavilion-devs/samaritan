#!/usr/bin/env node
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stableJson } from "../domain/json.js";
import { runSyntheticJudgeCase } from "../demo/synthetic-judge-case.js";
import { assertPublicArtifactsSafe, auditPublicArtifacts } from "../public/artifact-safety.js";
import { verifyDecisionReceipt } from "../proof/decision-receipt-schema.js";
import { buildCasebookDashboardResponse } from "./casebook-projection.js";
import { buildCommandDashboardResponse } from "./command-projection.js";
import { buildSpainBelgiumDashboardResponse } from "./projection.js";
import {
  PUBLIC_DASHBOARD_BUNDLE_ID,
  PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR,
  PUBLIC_DASHBOARD_CANONICALIZATION,
  PUBLIC_DASHBOARD_FILES,
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
  parsePublicDashboardManifest,
  parsePublicDashboardResponse,
  publicDashboardBundleHash,
  sha256,
  type PublicDashboardApiPath,
  type PublicDashboardFilename,
  type PublicDashboardManifest,
  type PublicDashboardManifestDownload,
  type PublicDashboardManifestEntry
} from "./public-bundle.js";
import { TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS } from "./public-contract.js";
import { buildStudyDashboardResponse } from "./study-projection.js";

const canonicalRepoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUTPUT_FILENAMES = new Set<string>([
  ...PUBLIC_DASHBOARD_FILES.map((definition) => definition.file),
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
  "manifest.json"
]);

export type ExportPublicDashboardBundleOptions = {
  repoRoot: string;
  outputDir?: string;
};

export type ExportPublicDashboardBundleResult = {
  outputDir: string;
  manifest: PublicDashboardManifest;
};

function canonicalJson(value: unknown): string {
  return `${stableJson(value)}\n`;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, path);
}

async function refuseUnexpectedOutputFiles(outputDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(outputDir);
  } catch {
    return;
  }
  const unexpected = names.filter((name) => !OUTPUT_FILENAMES.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Public dashboard export refuses output directory with unexpected files: ${unexpected.join(", ")}`);
  }
}

export async function exportPublicDashboardBundle(
  options: ExportPublicDashboardBundleOptions
): Promise<ExportPublicDashboardBundleResult> {
  const repoRoot = resolve(options.repoRoot);
  const outputDir = resolve(options.outputDir ?? resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR));

  // The corrected study, local capture outcomes, and bundled receipt supply a
  // stable as-of time. The manifest must never predate an artifact it commits to.
  const syntheticReport = await runSyntheticJudgeCase();
  const syntheticReceipt = syntheticReport.receipt;
  if (!Number.isSafeInteger(syntheticReceipt.generatedAtTsMs)) {
    throw new Error("Synthetic decision receipt has an invalid generation timestamp");
  }
  const syntheticReceiptGeneratedAt = new Date(syntheticReceipt.generatedAtTsMs).toISOString();
  const study = await buildStudyDashboardResponse(repoRoot);
  const outcomeProbe = await buildCommandDashboardResponse(repoRoot, Date.parse("2100-01-01T00:00:00.000Z"));
  const generatedAt = [
    study.data.correctedHistoricalCandidate.generatedAt,
    syntheticReceiptGeneratedAt,
    ...outcomeProbe.data.fixtureSchedule.map((fixture) => fixture.statusUpdatedAt).filter((value): value is string => value !== null)
  ].sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!;
  const asOfTsMs = Date.parse(generatedAt);
  if (!Number.isSafeInteger(asOfTsMs)) throw new Error("Corrected historical candidate has an invalid export timestamp");

  const [command, casebook, matchroom] = await Promise.all([
    buildCommandDashboardResponse(repoRoot, asOfTsMs),
    buildCasebookDashboardResponse(repoRoot),
    buildSpainBelgiumDashboardResponse(repoRoot)
  ]);
  const responseByPath = new Map<PublicDashboardApiPath, unknown>([
    [PUBLIC_DASHBOARD_FILES[0].apiPath, command],
    [PUBLIC_DASHBOARD_FILES[1].apiPath, casebook],
    [PUBLIC_DASHBOARD_FILES[2].apiPath, study],
    [PUBLIC_DASHBOARD_FILES[3].apiPath, matchroom]
  ]);

  const bodies = new Map<PublicDashboardFilename, string>();
  const entries: PublicDashboardManifestEntry[] = [];
  for (const definition of PUBLIC_DASHBOARD_FILES) {
    const response = responseByPath.get(definition.apiPath);
    if (!response) throw new Error(`Public dashboard export lacks ${definition.apiPath}`);
    const parsed = parsePublicDashboardResponse(definition.apiPath, response) as { data?: { snapshotId?: unknown } };
    if (parsed.data?.snapshotId !== definition.snapshotId) {
      throw new Error(`Public dashboard export snapshot mismatch for ${definition.apiPath}`);
    }
    const body = canonicalJson(parsed);
    bodies.set(definition.file, body);
    entries.push({
      apiPath: definition.apiPath,
      file: definition.file,
      snapshotId: definition.snapshotId,
      sha256: sha256(body),
      bytes: Buffer.byteLength(body, "utf8")
    });
  }

  // Export the receipt produced by the same production-component proving path
  // exposed through `pnpm demo`, so the CLI and downloadable judge artifact
  // commit to one case rather than two merely similar synthetic fixtures.
  const receiptVerification = verifyDecisionReceipt(syntheticReceipt);
  const syntheticProof = study.data.syntheticProof;
  if (
    !receiptVerification.valid ||
    !receiptVerification.synthetic ||
    receiptVerification.lifecycleStatus !== "filled_settled" ||
    syntheticReceipt.solanaAnchor !== null ||
    syntheticReport.performanceUse !== "excluded_synthetic" ||
    syntheticReport.boundaries.anthropicCalls !== 0 ||
    syntheticReport.boundaries.txlineApiCalls !== 0 ||
    syntheticReport.boundaries.polymarketApiCalls !== 0 ||
    syntheticReport.boundaries.walletCalls !== 0 ||
    syntheticReport.boundaries.solanaRpcCalls !== 0 ||
    syntheticReport.boundaries.realOrders !== 0 ||
    !syntheticProof.offlineVerified ||
    syntheticProof.lifecycleStatus !== receiptVerification.lifecycleStatus ||
    syntheticProof.performanceUse !== syntheticReport.performanceUse ||
    syntheticProof.externalCalls !== 0 ||
    syntheticProof.solanaAnchorStatus !== "not_submitted"
  ) {
    throw new Error("Synthetic decision receipt does not satisfy the frozen proving-fixture contract");
  }
  const syntheticReceiptBody = canonicalJson(syntheticReceipt);
  const downloads: PublicDashboardManifestDownload[] = [{
    id: "synthetic-decision-receipt",
    file: PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
    mediaType: "application/json",
    sha256: sha256(syntheticReceiptBody),
    bytes: Buffer.byteLength(syntheticReceiptBody, "utf8"),
    synthetic: true,
    performanceUse: "excluded_synthetic"
  }];

  const manifest = parsePublicDashboardManifest({
    schemaVersion: 1,
    bundleId: PUBLIC_DASHBOARD_BUNDLE_ID,
    generatedAt,
    canonicalization: PUBLIC_DASHBOARD_CANONICALIZATION,
    bundleSha256: publicDashboardBundleHash(generatedAt, entries, downloads),
    files: entries,
    downloads,
    publicDataPolicy: {
      derivedOnly: true,
      txlineProbabilityDisplay: "bucketed_movement_only",
      txlineMovementBucketBps: TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS,
      credentialsRequired: false,
      walletControlsExposed: false,
      txlineFixtureIdentifiersExposed: false
    }
  });
  const manifestBody = canonicalJson(manifest);

  const stagingDir = await mkdtemp(join(tmpdir(), "samaritan-public-dashboard-"));
  try {
    for (const [filename, body] of bodies) await writeFile(resolve(stagingDir, filename), body, "utf8");
    await writeFile(resolve(stagingDir, PUBLIC_SYNTHETIC_RECEIPT_FILENAME), syntheticReceiptBody, "utf8");
    await writeFile(resolve(stagingDir, "manifest.json"), manifestBody, "utf8");
    const audit = await auditPublicArtifacts({ allowlistedPaths: [stagingDir], cwd: stagingDir });
    assertPublicArtifactsSafe(audit);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

  await mkdir(outputDir, { recursive: true });
  await refuseUnexpectedOutputFiles(outputDir);
  for (const [filename, body] of bodies) await atomicWrite(resolve(outputDir, filename), body);
  await atomicWrite(resolve(outputDir, PUBLIC_SYNTHETIC_RECEIPT_FILENAME), syntheticReceiptBody);
  await atomicWrite(resolve(outputDir, "manifest.json"), manifestBody);
  return { outputDir, manifest };
}

function parseRepoRoot(args: readonly string[]): string {
  if (args.length === 0) return canonicalRepoRoot;
  if (args.length === 2 && args[0] === "--repo-root" && args[1]) return resolve(args[1]);
  throw new Error("Usage: pnpm dash:export-public [-- --repo-root <path>]");
}

async function main(): Promise<void> {
  try {
    const result = await exportPublicDashboardBundle({ repoRoot: parseRepoRoot(process.argv.slice(2)) });
    process.stdout.write(
      `Exported ${result.manifest.files.length} deterministic dashboard responses to ${basename(result.outputDir)} ` +
      `(bundle ${result.manifest.bundleSha256})\n`
    );
  } catch (error) {
    process.stderr.write(`Public dashboard export failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
