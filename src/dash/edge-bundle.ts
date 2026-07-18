import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { stableJson } from "../domain/json.js";
import { assertPublicArtifactsSafe, auditPublicArtifacts } from "../public/artifact-safety.js";
import { buildJudgeEvidenceResponse, JUDGE_EVIDENCE_API_PATH, judgeEvidenceResponseSchema } from "./judge-evidence.js";
import {
  PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR,
  PUBLIC_DASHBOARD_FILES,
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
  parsePublicDashboardManifest,
  readFrozenDashboardResponse,
  sha256,
  type PublicDashboardApiPath,
  type PublicDashboardManifest
} from "./public-bundle.js";

export const PUBLIC_EDGE_BUNDLE_RELATIVE_DIR = "public/artifacts/edge" as const;
export const PUBLIC_EDGE_BUNDLE_ID = "samaritan-dashboard-edge-v1" as const;
export const PUBLIC_EDGE_BUNDLE_HASH_DOMAIN = "samaritan.dashboard-edge-bundle/v1" as const;
export const PUBLIC_JUDGE_EVIDENCE_FILENAME = "judge-evidence.json" as const;
export const PUBLIC_EDGE_MANIFEST_FILENAME = "manifest.json" as const;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const mainApiPathSchema = z.enum(PUBLIC_DASHBOARD_FILES.map((definition) => definition.apiPath) as [
  PublicDashboardApiPath,
  ...PublicDashboardApiPath[]
]);
const edgeApiPathSchema = z.union([mainApiPathSchema, z.literal(JUDGE_EVIDENCE_API_PATH)]);

const edgeRouteSchema = z.object({
  apiPath: edgeApiPathSchema,
  assetPath: z.string().regex(/^\/artifacts\/(?:dashboard|edge)\/[a-z0-9-]+\.json$/u),
  bytes: z.number().int().positive().safe(),
  sha256: hashSchema,
  source: z.enum(["public_dashboard_manifest", "buildJudgeEvidenceResponse"])
}).strict();

export type PublicEdgeRoute = z.infer<typeof edgeRouteSchema>;

export const publicEdgeBundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  bundleId: z.literal(PUBLIC_EDGE_BUNDLE_ID),
  generatedAt: z.string().datetime(),
  sourceBundleSha256: hashSchema,
  edgeBundleSha256: hashSchema,
  routes: z.array(edgeRouteSchema).length(PUBLIC_DASHBOARD_FILES.length + 1),
  publicDataPolicy: z.object({
    derivedOnly: z.literal(true),
    credentialsRequired: z.literal(false),
    walletControlsExposed: z.literal(false),
    judgeEvidenceSource: z.literal("verified_node_builder"),
    buildCommitDisclosure: z.literal("omitted_from_frozen_artifact")
  }).strict()
}).strict();

export type PublicEdgeBundleManifest = z.infer<typeof publicEdgeBundleManifestSchema>;

export type ExportPublicEdgeBundleOptions = {
  repoRoot: string;
  outputDir?: string;
};

export type ExportPublicEdgeBundleResult = {
  outputDir: string;
  manifest: PublicEdgeBundleManifest;
};

export type VerifiedPublicEdgeBundle = {
  edgeRoot: string;
  manifest: PublicEdgeBundleManifest;
  judgeEvidenceBody: string;
};

const expectedRoutes = [
  ...PUBLIC_DASHBOARD_FILES.map((definition) => ({
    apiPath: definition.apiPath,
    assetPath: `/artifacts/dashboard/${definition.file}`,
    source: "public_dashboard_manifest" as const
  })),
  {
    apiPath: JUDGE_EVIDENCE_API_PATH,
    assetPath: `/artifacts/edge/${PUBLIC_JUDGE_EVIDENCE_FILENAME}`,
    source: "buildJudgeEvidenceResponse" as const
  }
] as const;

function canonicalJson(value: unknown): string {
  return `${stableJson(value)}\n`;
}

function edgeBundleHash(
  generatedAt: string,
  sourceBundleSha256: string,
  routes: readonly PublicEdgeRoute[]
): string {
  return sha256(`${PUBLIC_EDGE_BUNDLE_HASH_DOMAIN}\n${stableJson({
    schemaVersion: 1,
    bundleId: PUBLIC_EDGE_BUNDLE_ID,
    generatedAt,
    sourceBundleSha256,
    routes,
    publicDataPolicy: {
      derivedOnly: true,
      credentialsRequired: false,
      walletControlsExposed: false,
      judgeEvidenceSource: "verified_node_builder",
      buildCommitDisclosure: "omitted_from_frozen_artifact"
    }
  })}`);
}

export function parsePublicEdgeBundleManifest(value: unknown): PublicEdgeBundleManifest {
  const manifest = publicEdgeBundleManifestSchema.parse(value);
  for (const [index, expected] of expectedRoutes.entries()) {
    const actual = manifest.routes[index];
    if (
      !actual ||
      actual.apiPath !== expected.apiPath ||
      actual.assetPath !== expected.assetPath ||
      actual.source !== expected.source
    ) {
      throw new Error(`Public edge manifest route ${index} does not match the frozen route map`);
    }
  }
  const expectedHash = edgeBundleHash(manifest.generatedAt, manifest.sourceBundleSha256, manifest.routes);
  if (manifest.edgeBundleSha256 !== expectedHash) {
    throw new Error("Public edge manifest bundle hash is invalid");
  }
  return manifest;
}

async function readPublicDashboardManifest(repoRoot: string): Promise<PublicDashboardManifest> {
  const path = resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR, "manifest.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Public edge export requires the frozen dashboard manifest: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  return parsePublicDashboardManifest(value);
}

async function copyVerifiedDashboardBundle(repoRoot: string, temporaryRepoRoot: string): Promise<void> {
  const sourceRoot = resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  const targetRoot = resolve(temporaryRepoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  await mkdir(targetRoot, { recursive: true });
  for (const filename of [
    ...PUBLIC_DASHBOARD_FILES.map((definition) => definition.file),
    PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
    "manifest.json"
  ]) {
    await writeFile(resolve(targetRoot, filename), await readFile(resolve(sourceRoot, filename)));
  }
}

async function buildFrozenJudgeEvidence(repoRoot: string): Promise<string> {
  const temporaryRepoRoot = await mkdtemp(join(tmpdir(), "samaritan-edge-judge-"));
  try {
    await copyVerifiedDashboardBundle(repoRoot, temporaryRepoRoot);
    const response = judgeEvidenceResponseSchema.parse(await buildJudgeEvidenceResponse(temporaryRepoRoot, {
      buildCommit: null
    }));
    if (response.app.buildCommit !== null) {
      throw new Error("Frozen judge evidence must omit a deployment commit rather than publish a stale one");
    }
    return canonicalJson(response);
  } finally {
    await rm(temporaryRepoRoot, { recursive: true, force: true });
  }
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
  const expected = new Set<string>([PUBLIC_JUDGE_EVIDENCE_FILENAME, PUBLIC_EDGE_MANIFEST_FILENAME]);
  const unexpected = names.filter((name) => !expected.has(name));
  if (unexpected.length > 0) {
    throw new Error(`Public edge export refuses output directory with unexpected files: ${unexpected.join(", ")}`);
  }
}

export async function exportPublicEdgeBundle(
  options: ExportPublicEdgeBundleOptions
): Promise<ExportPublicEdgeBundleResult> {
  const repoRoot = resolve(options.repoRoot);
  const outputDir = resolve(options.outputDir ?? resolve(repoRoot, PUBLIC_EDGE_BUNDLE_RELATIVE_DIR));
  const sourceManifest = await readPublicDashboardManifest(repoRoot);
  const frozenResponses = await Promise.all(
    PUBLIC_DASHBOARD_FILES.map((definition) => readFrozenDashboardResponse(repoRoot, definition.apiPath))
  );
  if (frozenResponses.some((response) => response.manifest.bundleSha256 !== sourceManifest.bundleSha256)) {
    throw new Error("Public edge export requires one coherent verified dashboard bundle");
  }

  const judgeEvidenceBody = await buildFrozenJudgeEvidence(repoRoot);
  const routes: PublicEdgeRoute[] = [
    ...PUBLIC_DASHBOARD_FILES.map((definition, index) => {
      const body = frozenResponses[index]?.body;
      const entry = sourceManifest.files[index];
      if (!body || !entry || entry.apiPath !== definition.apiPath || entry.file !== definition.file) {
        throw new Error(`Public edge export cannot reconcile ${definition.apiPath}`);
      }
      return {
        apiPath: definition.apiPath,
        assetPath: `/artifacts/dashboard/${definition.file}`,
        bytes: Buffer.byteLength(body, "utf8"),
        sha256: sha256(body),
        source: "public_dashboard_manifest" as const
      };
    }),
    {
      apiPath: JUDGE_EVIDENCE_API_PATH,
      assetPath: `/artifacts/edge/${PUBLIC_JUDGE_EVIDENCE_FILENAME}`,
      bytes: Buffer.byteLength(judgeEvidenceBody, "utf8"),
      sha256: sha256(judgeEvidenceBody),
      source: "buildJudgeEvidenceResponse" as const
    }
  ];
  const manifest = parsePublicEdgeBundleManifest({
    schemaVersion: 1,
    bundleId: PUBLIC_EDGE_BUNDLE_ID,
    generatedAt: sourceManifest.generatedAt,
    sourceBundleSha256: sourceManifest.bundleSha256,
    edgeBundleSha256: edgeBundleHash(sourceManifest.generatedAt, sourceManifest.bundleSha256, routes),
    routes,
    publicDataPolicy: {
      derivedOnly: true,
      credentialsRequired: false,
      walletControlsExposed: false,
      judgeEvidenceSource: "verified_node_builder",
      buildCommitDisclosure: "omitted_from_frozen_artifact"
    }
  });
  const manifestBody = canonicalJson(manifest);

  const stagingDir = await mkdtemp(join(tmpdir(), "samaritan-public-edge-"));
  try {
    await writeFile(resolve(stagingDir, PUBLIC_JUDGE_EVIDENCE_FILENAME), judgeEvidenceBody, "utf8");
    await writeFile(resolve(stagingDir, PUBLIC_EDGE_MANIFEST_FILENAME), manifestBody, "utf8");
    const audit = await auditPublicArtifacts({ allowlistedPaths: [stagingDir], cwd: stagingDir });
    assertPublicArtifactsSafe(audit);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

  await mkdir(outputDir, { recursive: true });
  await refuseUnexpectedOutputFiles(outputDir);
  await atomicWrite(resolve(outputDir, PUBLIC_JUDGE_EVIDENCE_FILENAME), judgeEvidenceBody);
  await atomicWrite(resolve(outputDir, PUBLIC_EDGE_MANIFEST_FILENAME), manifestBody);
  return { outputDir, manifest };
}

export async function verifyPublicEdgeBundle(repoRootInput: string): Promise<VerifiedPublicEdgeBundle> {
  const repoRoot = resolve(repoRootInput);
  const edgeRoot = resolve(repoRoot, PUBLIC_EDGE_BUNDLE_RELATIVE_DIR);
  const sourceManifest = await readPublicDashboardManifest(repoRoot);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(resolve(edgeRoot, PUBLIC_EDGE_MANIFEST_FILENAME), "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Frozen public edge manifest is unavailable: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  const manifest = parsePublicEdgeBundleManifest(manifestValue);
  if (
    manifest.generatedAt !== sourceManifest.generatedAt ||
    manifest.sourceBundleSha256 !== sourceManifest.bundleSha256
  ) {
    throw new Error("Frozen public edge manifest does not commit to the current dashboard bundle");
  }

  for (const [index, definition] of PUBLIC_DASHBOARD_FILES.entries()) {
    const route = manifest.routes[index];
    const frozen = await readFrozenDashboardResponse(repoRoot, definition.apiPath);
    if (
      !route ||
      route.bytes !== Buffer.byteLength(frozen.body, "utf8") ||
      route.sha256 !== sha256(frozen.body)
    ) {
      throw new Error(`Frozen public edge route changed for ${definition.apiPath}`);
    }
  }

  const judgeRoute = manifest.routes.at(-1);
  if (!judgeRoute || judgeRoute.apiPath !== JUDGE_EVIDENCE_API_PATH) {
    throw new Error("Frozen public edge bundle lacks judge evidence");
  }
  const judgeEvidenceBody = await readFile(resolve(edgeRoot, basename(judgeRoute.assetPath)), "utf8");
  if (
    Buffer.byteLength(judgeEvidenceBody, "utf8") !== judgeRoute.bytes ||
    sha256(judgeEvidenceBody) !== judgeRoute.sha256
  ) {
    throw new Error("Frozen judge evidence bytes do not match the public edge manifest");
  }
  let judgeValue: unknown;
  try {
    judgeValue = JSON.parse(judgeEvidenceBody) as unknown;
  } catch {
    throw new Error("Frozen judge evidence is invalid JSON");
  }
  const judgeEvidence = judgeEvidenceResponseSchema.parse(judgeValue);
  if (
    judgeEvidence.generatedAt !== sourceManifest.generatedAt ||
    judgeEvidence.app.buildCommit !== null ||
    judgeEvidence.access.source !== "verified_frozen_public_bundle" ||
    judgeEvidence.access.disclosure !== "derived_metadata_only"
  ) {
    throw new Error("Frozen judge evidence disclosure boundary changed");
  }
  const rebuiltJudgeEvidenceBody = await buildFrozenJudgeEvidence(repoRoot);
  if (rebuiltJudgeEvidenceBody !== judgeEvidenceBody) {
    throw new Error("Frozen judge evidence no longer matches buildJudgeEvidenceResponse");
  }

  const audit = await auditPublicArtifacts({
    allowlistedPaths: [resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR), edgeRoot],
    cwd: repoRoot
  });
  assertPublicArtifactsSafe(audit);
  return { edgeRoot, manifest, judgeEvidenceBody };
}
