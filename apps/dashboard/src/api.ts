import type {
  CasebookApiResponse,
  CasebookSnapshot,
  CommandApiResponse,
  CommandSnapshot,
  DashboardApiResponse,
  MatchroomSnapshot,
  StudyApiResponse,
  StudySnapshot
} from "../../../src/dash/public-contract";

export const MATCHROOM_API_PATH = "/api/v1/matchroom/paired-spain-belgium-2026-07-10";
export const COMMAND_API_PATH = "/api/v1/command";
export const CASEBOOK_API_PATH = "/api/v1/casebook";
export const STUDY_API_PATH = "/api/v1/study";
export const TXLINE_PULSE_API_PATH = "/api/v1/txline/pulse";

export type TxlinePulse = {
  network: "mainnet";
  serviceLevel: "SL12";
  checkedAt: string;
  status: "connected" | "degraded";
  latencyMsRounded: number | null;
  aggregateFixtureCount: number | null;
  freshnessClass: "current" | "stale" | "unknown";
};

function parseTxlinePulse(value: unknown): TxlinePulse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Pulse payload is invalid");
  const record = value as Record<string, unknown>;
  const expectedKeys = ["aggregateFixtureCount", "checkedAt", "freshnessClass", "latencyMsRounded", "network", "serviceLevel", "status"];
  if (Object.keys(record).sort().join("|") !== expectedKeys.join("|")) throw new Error("Pulse payload crossed its public allowlist");
  if (
    record.network !== "mainnet" ||
    record.serviceLevel !== "SL12" ||
    (record.status !== "connected" && record.status !== "degraded") ||
    typeof record.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(record.checkedAt)) ||
    (record.freshnessClass !== "current" && record.freshnessClass !== "stale" && record.freshnessClass !== "unknown") ||
    (record.latencyMsRounded !== null && (typeof record.latencyMsRounded !== "number" || !Number.isSafeInteger(record.latencyMsRounded) || record.latencyMsRounded < 0)) ||
    (record.aggregateFixtureCount !== null && (typeof record.aggregateFixtureCount !== "number" || !Number.isSafeInteger(record.aggregateFixtureCount) || record.aggregateFixtureCount < 0))
  ) throw new Error("Pulse payload values are invalid");
  return record as TxlinePulse;
}

export async function loadTxlinePulse(signal: AbortSignal): Promise<TxlinePulse> {
  const response = await fetch(TXLINE_PULSE_API_PATH, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal
  });
  if (!response.ok) throw new Error(`TXLine pulse request failed with status ${response.status}`);
  return parseTxlinePulse(await response.json() as unknown);
}

export async function loadStudy(signal: AbortSignal): Promise<StudySnapshot> {
  const response = await fetch(STUDY_API_PATH, {
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) throw new Error(`Study request failed with status ${response.status}`);
  const payload = (await response.json()) as StudyApiResponse;
  return payload.data;
}

export async function loadCasebook(signal: AbortSignal): Promise<CasebookSnapshot> {
  const response = await fetch(CASEBOOK_API_PATH, {
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) throw new Error(`Casebook request failed with status ${response.status}`);
  const payload = (await response.json()) as CasebookApiResponse;
  return payload.data;
}

export async function loadCommand(signal: AbortSignal): Promise<CommandSnapshot> {
  const response = await fetch(COMMAND_API_PATH, {
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) throw new Error(`Command request failed with status ${response.status}`);
  const payload = (await response.json()) as CommandApiResponse;
  return payload.data;
}

export async function loadMatchroom(signal: AbortSignal): Promise<MatchroomSnapshot> {
  const response = await fetch(MATCHROOM_API_PATH, {
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) throw new Error(`Matchroom request failed with status ${response.status}`);
  const payload = (await response.json()) as DashboardApiResponse;
  return payload.data;
}
