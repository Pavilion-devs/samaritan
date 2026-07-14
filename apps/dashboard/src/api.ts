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
