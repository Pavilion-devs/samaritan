import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { judgeEvidenceResponseSchema } from "../src/dash/judge-evidence.js";
import {
  PUBLIC_EDGE_BUNDLE_RELATIVE_DIR,
  PUBLIC_EDGE_MANIFEST_FILENAME,
  PUBLIC_JUDGE_EVIDENCE_FILENAME,
  exportPublicEdgeBundle,
  verifyPublicEdgeBundle
} from "../src/dash/edge-bundle.js";
import {
  PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR,
  PUBLIC_DASHBOARD_FILES,
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME
} from "../src/dash/public-bundle.js";

const repoRoot = resolve(import.meta.dirname, "..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "samaritan-edge-bundle-test-"));
  temporaryRoots.push(root);
  return root;
}

function cleanCloneRoot(): string {
  const root = temporaryRoot();
  const source = resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  const target = resolve(root, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  mkdirSync(target, { recursive: true });
  for (const filename of [
    ...PUBLIC_DASHBOARD_FILES.map((definition) => definition.file),
    PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
    "manifest.json"
  ]) {
    copyFileSync(resolve(source, filename), resolve(target, filename));
  }
  return root;
}

describe("Sites frozen edge bundle", () => {
  it("exports deterministic judge evidence from the verified Node builder", async () => {
    const root = cleanCloneRoot();
    const first = resolve(root, "edge-one");
    const second = resolve(root, "edge-two");
    const previousGithubSha = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = "a".repeat(40);
    let firstResult: Awaited<ReturnType<typeof exportPublicEdgeBundle>>;
    let secondResult: Awaited<ReturnType<typeof exportPublicEdgeBundle>>;
    try {
      firstResult = await exportPublicEdgeBundle({ repoRoot: root, outputDir: first });
      secondResult = await exportPublicEdgeBundle({ repoRoot: root, outputDir: second });
    } finally {
      if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousGithubSha;
    }

    expect(firstResult.manifest).toEqual(secondResult.manifest);
    expect(readFileSync(resolve(first, PUBLIC_EDGE_MANIFEST_FILENAME), "utf8")).toBe(
      readFileSync(resolve(second, PUBLIC_EDGE_MANIFEST_FILENAME), "utf8")
    );
    const judgeBody = readFileSync(resolve(first, PUBLIC_JUDGE_EVIDENCE_FILENAME), "utf8");
    expect(judgeBody).toBe(readFileSync(resolve(second, PUBLIC_JUDGE_EVIDENCE_FILENAME), "utf8"));
    const judge = judgeEvidenceResponseSchema.parse(JSON.parse(judgeBody));
    expect(judge).toMatchObject({
      app: { buildCommit: null },
      access: {
        authenticationRequired: false,
        readOnly: true,
        source: "verified_frozen_public_bundle",
        disclosure: "derived_metadata_only"
      },
      gates: { executionMode: "paper", realMoney: { gate: "closed", ordersEnabled: false } }
    });
    expect(firstResult.manifest.routes.map((route) => route.apiPath)).toEqual([
      ...PUBLIC_DASHBOARD_FILES.map((definition) => definition.apiPath),
      "/api/judge/evidence"
    ]);
  });

  it("verifies the tracked bundle and fails closed on judge-evidence tampering", async () => {
    const verified = await verifyPublicEdgeBundle(repoRoot);
    expect(verified.manifest.routes).toHaveLength(5);

    const root = cleanCloneRoot();
    const edgeTarget = resolve(root, PUBLIC_EDGE_BUNDLE_RELATIVE_DIR);
    mkdirSync(edgeTarget, { recursive: true });
    for (const filename of [PUBLIC_EDGE_MANIFEST_FILENAME, PUBLIC_JUDGE_EVIDENCE_FILENAME]) {
      copyFileSync(resolve(repoRoot, PUBLIC_EDGE_BUNDLE_RELATIVE_DIR, filename), resolve(edgeTarget, filename));
    }
    const judgePath = resolve(edgeTarget, PUBLIC_JUDGE_EVIDENCE_FILENAME);
    writeFileSync(judgePath, `${readFileSync(judgePath, "utf8")} `);
    await expect(verifyPublicEdgeBundle(root)).rejects.toThrow(/judge evidence bytes/i);
  });
});
