import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COMMAND_API_PATH, handleDashboardApi, JUDGE_EVIDENCE_API_PATH } from "../src/dash/api.js";
import { judgeEvidenceResponseSchema } from "../src/dash/judge-evidence.js";
import { TXLINE_PULSE_API_PATH } from "../src/dash/txline-pulse.js";
import {
  PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR,
  PUBLIC_DASHBOARD_FILES,
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME
} from "../src/dash/public-bundle.js";

const repoRoot = resolve(import.meta.dirname, "..");
const trackedBundle = resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "samaritan-judge-evidence-"));
  temporaryRoots.push(root);
  return root;
}

function copyFrozenBundle(root: string): string {
  const target = resolve(root, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR);
  mkdirSync(target, { recursive: true });
  for (const file of [
    ...PUBLIC_DASHBOARD_FILES.map((definition) => definition.file),
    PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
    "manifest.json"
  ]) {
    copyFileSync(resolve(trackedBundle, file), resolve(target, file));
  }
  return target;
}

function recursiveKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => [key, ...recursiveKeys(child)]);
}

describe("judge evidence API", () => {
  it("serves a strict no-login summary derived from the verified frozen bundle", async () => {
    const result = await handleDashboardApi(JUDGE_EVIDENCE_API_PATH, repoRoot, { method: "GET" });

    expect(result).toMatchObject({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8"
      }
    });
    const response = judgeEvidenceResponseSchema.parse(JSON.parse(result!.body));
    expect(response.trackCriteria.map((criterion) => criterion.id)).toEqual([
      "core_functionality_and_data_ingestion",
      "autonomous_operation",
      "deterministic_logic_and_architecture",
      "innovation_and_novelty",
      "production_readiness"
    ]);
    expect(response.trackCriteria.find((criterion) => criterion.id === "autonomous_operation")?.evidence)
      .toContainEqual({ label: "Bounded lifecycle proof", route: "/proof" });
    expect(response.trackCriteria.find((criterion) => criterion.id === "core_functionality_and_data_ingestion")?.evidence)
      .toContainEqual({ label: "Live derived TXLine connectivity pulse", route: TXLINE_PULSE_API_PATH });
    expect(response.txlineIntegration.endpointsUsed.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
      "POST /auth/guest/start",
      "POST /api/token/activate",
      "GET /api/fixtures/snapshot",
      "GET /api/odds/stream",
      "GET /api/scores/stream",
      "GET /api/odds/snapshot/{fixtureId}",
      "GET /api/scores/snapshot/{fixtureId}",
      "GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}",
      "GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}",
      "GET /api/scores/historical/{fixtureId}"
    ]);
    expect(response.evidenceClassCounts).toMatchObject({
      capturedReplayFixtures: 1,
      capturedReplayObservations: 18,
      capturedNoTradeObservations: 18,
      historicalTrainingObservations: 135,
      historicalHeldoutObservations: 38,
      historicalHeldoutFixtures: 18,
      syntheticLifecycleReceipts: 1,
      verifiedCapturedAgentLifecycleReceipts: 0
    });
    expect(response.gates).toMatchObject({
      executionMode: "paper",
      realMoney: { gate: "closed", ordersEnabled: false },
      paperProtocol: {
        riskLimits: {
          bankrollMicroUsd: 50_000_000,
          perTradeStakeMicroUsd: 3_000_000,
          aggregateExposureMicroUsd: 15_000_000,
          drawdownStopMicroUsd: 20_000_000
        }
      }
    });
    expect(response.syntheticReceipt).toEqual({
      route: "/artifacts/dashboard/synthetic-decision-receipt.json",
      orderedEventCount: 11,
      verificationStatus: "offline_verified",
      lifecycleStatus: "filled_settled",
      synthetic: true,
      externalCalls: 0,
      performanceUse: "excluded_synthetic",
      solanaAnchorStatus: "not_submitted"
    });
  });

  it("does not expose licensed rows, identities, market values, secrets, wallets, or proof payloads", async () => {
    const result = await handleDashboardApi(JUDGE_EVIDENCE_API_PATH, repoRoot);
    const response = JSON.parse(result!.body) as unknown;
    const serialized = JSON.stringify(response);
    const keys = recursiveKeys(response);

    for (const forbiddenKey of [
      "fixtureId",
      "participant1",
      "participant2",
      "Pct",
      "Prices",
      "bestBid",
      "bestAsk",
      "fairProbability",
      "rawPayload",
      "payloadSha256",
      "receiptHash",
      "headHash",
      "wallet",
      "privateKey",
      "apiKey",
      "tokenId",
      "assetId"
    ]) {
      expect(keys).not.toContain(forbiddenKey);
    }
    expect(serialized).not.toMatch(
      /\/Users\/|Deborah|Spain|Belgium|England|Argentina|France|TXLineStablePriceDemargined/i
    );
  });

  it("accepts HEAD and rejects POST without reading or mutating private state", async () => {
    const head = await handleDashboardApi(JUDGE_EVIDENCE_API_PATH, repoRoot, { method: "HEAD" });
    const post = await handleDashboardApi(JUDGE_EVIDENCE_API_PATH, repoRoot, { method: "POST" });
    const frozenPost = await handleDashboardApi(COMMAND_API_PATH, repoRoot, { method: "POST" });
    const healthPost = await handleDashboardApi("/api/v1/health", repoRoot, { method: "POST" });
    const unknownPost = await handleDashboardApi("/api/not-a-route", repoRoot, { method: "POST" });

    expect(head?.status).toBe(200);
    expect(post).toMatchObject({ status: 405, headers: { allow: "GET, HEAD" } });
    expect(JSON.parse(post!.body)).toEqual({ error: "method_not_allowed" });
    for (const result of [frozenPost, healthPost, unknownPost]) {
      expect(result).toMatchObject({ status: 405, headers: { allow: "GET, HEAD" } });
      expect(JSON.parse(result!.body)).toEqual({ error: "method_not_allowed" });
    }
  });

  it("fails closed with a non-disclosing response when the bundle is missing or malformed", async () => {
    const missingRoot = temporaryRoot();
    const malformedRoot = temporaryRoot();
    const bundle = copyFrozenBundle(malformedRoot);
    const casebookPath = resolve(bundle, "casebook.json");
    writeFileSync(casebookPath, `${readFileSync(casebookPath, "utf8")} `);

    for (const root of [missingRoot, malformedRoot]) {
      const result = await handleDashboardApi(JUDGE_EVIDENCE_API_PATH, root);
      expect(result?.status).toBe(503);
      expect(JSON.parse(result!.body)).toEqual({ error: "evidence_unavailable" });
      expect(result!.body).not.toContain(root);
    }
  });

  it("fails closed when the independently verified receipt no longer matches its manifest", async () => {
    const root = temporaryRoot();
    const bundle = copyFrozenBundle(root);
    const receiptPath = resolve(bundle, PUBLIC_SYNTHETIC_RECEIPT_FILENAME);
    const receipt = readFileSync(receiptPath, "utf8");
    writeFileSync(receiptPath, `${receipt.slice(0, -1)} `);

    const result = await handleDashboardApi(JUDGE_EVIDENCE_API_PATH, root);
    expect(result?.status).toBe(503);
    expect(JSON.parse(result!.body)).toEqual({ error: "evidence_unavailable" });
  });
});
