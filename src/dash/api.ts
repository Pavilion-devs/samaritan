import type { ServerResponse } from "node:http";
import {
  CASEBOOK_API_PATH,
  COMMAND_API_PATH,
  readFrozenDashboardResponse,
  SPAIN_BELGIUM_API_PATH,
  STUDY_API_PATH,
  type PublicDashboardApiPath
} from "./public-bundle.js";
import { buildJudgeEvidenceResponse, JUDGE_EVIDENCE_API_PATH } from "./judge-evidence.js";
import { buildNodeTxlinePulse, type NodeTxlinePulseOptions } from "./txline-pulse-node.js";
import { TXLINE_PULSE_API_PATH } from "./txline-pulse.js";

export { CASEBOOK_API_PATH, COMMAND_API_PATH, SPAIN_BELGIUM_API_PATH, STUDY_API_PATH } from "./public-bundle.js";
export { JUDGE_EVIDENCE_API_PATH } from "./judge-evidence.js";
export { TXLINE_PULSE_API_PATH } from "./txline-pulse.js";

export type DashboardApiResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function jsonResult(status: number, value: unknown): DashboardApiResult {
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    },
    body: JSON.stringify(value)
  };
}

function frozenJsonResult(body: string, bundleSha256: string): DashboardApiResult {
  return {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-samaritan-public-bundle": bundleSha256
    },
    body
  };
}

function methodNotAllowedResult(): DashboardApiResult {
  const result = jsonResult(405, { error: "method_not_allowed" });
  return {
    ...result,
    headers: {
      ...result.headers,
      allow: "GET, HEAD"
    }
  };
}

export type DashboardApiSource = "frozen" | "private";

async function privateProjection(pathname: PublicDashboardApiPath, repoRoot: string): Promise<unknown> {
  if (pathname === COMMAND_API_PATH) {
    const { buildCommandDashboardResponse } = await import("./command-projection.js");
    return buildCommandDashboardResponse(repoRoot);
  }
  if (pathname === CASEBOOK_API_PATH) {
    const { buildCasebookDashboardResponse } = await import("./casebook-projection.js");
    return buildCasebookDashboardResponse(repoRoot);
  }
  if (pathname === STUDY_API_PATH) {
    const { buildStudyDashboardResponse } = await import("./study-projection.js");
    return buildStudyDashboardResponse(repoRoot);
  }
  const { buildSpainBelgiumDashboardResponse } = await import("./projection.js");
  return buildSpainBelgiumDashboardResponse(repoRoot);
}

export async function handleDashboardApi(
  pathname: string,
  repoRoot: string,
  options: { source?: DashboardApiSource; method?: string; txlinePulse?: NodeTxlinePulseOptions } = {}
): Promise<DashboardApiResult | null> {
  const method = (options.method ?? "GET").toUpperCase();
  if (pathname.startsWith("/api/") && method !== "GET" && method !== "HEAD") {
    return methodNotAllowedResult();
  }
  if (pathname === TXLINE_PULSE_API_PATH) {
    return jsonResult(200, await buildNodeTxlinePulse(repoRoot, options.txlinePulse));
  }
  if (pathname === JUDGE_EVIDENCE_API_PATH) {
    try {
      return jsonResult(200, await buildJudgeEvidenceResponse(repoRoot));
    } catch {
      return jsonResult(503, { error: "evidence_unavailable" });
    }
  }
  if (pathname === "/api/v1/health") {
    return jsonResult(200, { status: "ok", service: "samaritan-dashboard", readOnly: true });
  }
  const definition = [COMMAND_API_PATH, CASEBOOK_API_PATH, STUDY_API_PATH, SPAIN_BELGIUM_API_PATH]
    .find((candidate) => candidate === pathname) as PublicDashboardApiPath | undefined;
  if (definition) {
    if (options.source === "private") return jsonResult(200, await privateProjection(definition, repoRoot));
    const frozen = await readFrozenDashboardResponse(repoRoot, definition);
    return frozenJsonResult(frozen.body, frozen.manifest.bundleSha256);
  }
  if (pathname.startsWith("/api/")) {
    return jsonResult(404, { error: "not_found" });
  }
  return null;
}

export function writeApiResult(response: ServerResponse, result: DashboardApiResult, headOnly = false): void {
  response.writeHead(result.status, result.headers);
  response.end(headOnly ? undefined : result.body);
}
